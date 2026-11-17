// Log por partida: métricas por segundo, eventos y resumen. Se guarda en ./logs vía server.py
// (si no hay server.py, descarga el JSON como archivo).
import { CONFIG } from './config.js';

const pct = (arr, p) => { if (!arr.length) return 0; const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };
const avg = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const r1 = n => Math.round(n * 10) / 10;

export class SessionLogger {
  constructor(tracker) { this.tracker = tracker; this.active = false; }

  start() {
    const t = this.tracker, v = t.video;
    this.active = true; this._started = false;
    this.t0 = performance.now();
    this.samples = [];      // 1 por segundo
    this.events = [];       // eventos notables
    this.counts = {};       // contadores de todos los eventos
    this.gaps = [];         // periodos sin manos durante el juego
    this._frames = 0; this._lastSample = this.t0;
    this._hadHands = false; this._gapStart = null;
    this._closed = {}; this.toggles = 0; this.handTime = 0; this._lastFrame = this.t0;
    this.meta = {
      startedAt: new Date().toISOString(),
      userAgent: navigator.userAgent,
      screen: `${window.innerWidth}x${window.innerHeight}`,
      video: `${v.videoWidth}x${v.videoHeight}`,
      camera: t.cameraInfo || null,
      cameraLabel: t.cameraLabel || null,
      delegate: t.delegate, mode: t.mode,
      config: { ...CONFIG },
    };
  }

  event(type, data = {}) {
    if (!this.active) return;
    this.counts[type] = (this.counts[type] || 0) + 1;
    if (type === 'spawn') return; // demasiado frecuente: solo se cuenta
    this.events.push({ t: r1((performance.now() - this.t0) / 1000), type, ...data });
  }

  /** Llamar en cada frame de render mientras se juega */
  frame(now, hands) {
    if (!this.active) return;
    if (!this._started) { this._started = true; this._lastSample = now; this._lastFrame = now; this.t0 = now; return; } // el log empieza al terminar la cuenta regresiva
    this._frames++;
    const dt = (now - this._lastFrame) / 1000; this._lastFrame = now;
    const tt = r1((now - this.t0) / 1000);

    // Presencia de manos / huecos de tracking
    const has = hands.length > 0;
    if (has) this.handTime += dt;
    if (!has && this._hadHands && this._gapStart === null) this._gapStart = now;
    if (has && this._gapStart !== null) {
      const gap = (now - this._gapStart) / 1000;
      if (gap > 0.3) { this.gaps.push({ t: tt, seconds: r1(gap) }); this.event('hand_gap', { seconds: r1(gap) }); }
      this._gapStart = null;
    }
    if (has) this._hadHands = true;

    // Parpadeo del estado abierta/cerrada
    for (const h of hands) {
      if (this._closed[h.id] !== undefined && this._closed[h.id] !== h.closed) this.toggles++;
      this._closed[h.id] = h.closed;
    }

    if (now - this._lastSample >= 1000) {
      const secs = (now - this._lastSample) / 1000;
      this.samples.push({
        t: Math.round(tt), renderFps: r1(this._frames / secs), detFps: this.tracker.fps,
        inferMs: this.tracker.inferMs, hands: hands.length,
        handSize: hands.map(h => +h.size.toFixed(2)), closed: hands.map(h => h.closed),
      });
      this._frames = 0; this._lastSample = now;
    }
  }

  end(score) {
    if (!this.active) return;
    this.active = false;
    const s = this.samples;
    const dur = (performance.now() - this.t0) / 1000;
    const c = this.counts;
    const spawned = c.spawn || 0, catches = c.catch || 0;
    const summary = {
      score, durationSec: r1(dur),
      renderFps: { avg: r1(avg(s.map(x => x.renderFps))), min: r1(Math.min(...s.map(x => x.renderFps), 999)) },
      detectionFps: { avg: r1(avg(s.map(x => x.detFps))), min: Math.min(...s.map(x => x.detFps), 999) },
      inferenceMs: { avg: r1(avg(s.map(x => x.inferMs))), p95: pct(s.map(x => x.inferMs), 0.95), max: Math.max(...s.map(x => x.inferMs), 0) },
      handsVisiblePct: r1(100 * this.handTime / dur),
      trackingGaps: this.gaps.length, longestGapSec: Math.max(0, ...this.gaps.map(g => g.seconds)),
      openCloseToggles: this.toggles, togglesPerMin: r1(this.toggles / dur * 60),
      nuggetsSpawned: spawned, caught: catches, missed: c.miss || 0,
      catchRatePct: spawned ? r1(100 * catches / spawned) : 0,
      releasedByMaxHold: c.release_maxhold || 0, releasedByOpen: c.release_open || 0,
    };
    // Diagnóstico automático en lenguaje simple
    const hints = [];
    if (summary.inferenceMs.avg > 35) hints.push(`Inferencia lenta (${summary.inferenceMs.avg} ms): ${this.meta.delegate === 'CPU' ? 'está en CPU, no GPU' : 'revisar carga del PC/otras pestañas'}.`);
    if (summary.detectionFps.avg < 20) hints.push(`Detección baja (${summary.detectionFps.avg} fps): se pierde fluidez al mover rápido.`);
    if (summary.handsVisiblePct < 60) hints.push(`Manos visibles solo ${summary.handsVisiblePct}% del tiempo: revisar distancia/umbrales (minHandSize, handDetectConf).`);
    if (summary.trackingGaps > 5) hints.push(`${summary.trackingGaps} pérdidas de tracking (la más larga ${summary.longestGapSec}s).`);
    if (summary.togglesPerMin > 400) hints.push(`El estado abierta/cerrada parpadea de forma anormal (${summary.togglesPerMin}/min): ajustar curlRatio.`);
    if ((c.release_maxhold || 0) > catches * 0.5) hints.push('Muchos nuggets se sueltan por tiempo máximo: el puño no se detecta bien o maxHoldSec es corto.');
    summary.hints = hints.length ? hints : ['Sin problemas evidentes.'];

    const payload = { summary, meta: this.meta, counts: c, gaps: this.gaps, events: this.events, perSecond: s };
    window.__lastLog = payload;
    console.log('[LOG partida]', summary);
    this._save(payload);
  }

  async _save(payload) {
    try {
      const res = await fetch('/log', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (!res.ok) throw new Error(res.status);
      console.log('[LOG] guardado en logs/', await res.text());
    } catch {
      const isLocal = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
      if (!isLocal) {
        console.warn('[LOG] /log no disponible en remoto; omitiendo descarga automática');
        return;
      }
      const blob = new Blob([JSON.stringify(payload, null, 1)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `pilgrims-session-${Date.now()}.json`;
      a.click();
    }
  }
}
