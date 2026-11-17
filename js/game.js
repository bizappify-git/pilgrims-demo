// Lógica pura del juego (sin dibujo ni cámara).
// Cierra la mano con cualquier parte de ella (palma o dedo) sobre un nugget → lo agarras.
// Estados: idle → countdown → playing → over
import { CONFIG } from './config.js';

export class Game {
  constructor({ onCatch, onCountdown, onStart, onEvent } = {}) {
    this.onEvent = onEvent || (() => {});
    this.onCatch = onCatch || (() => {});
    this.onCountdown = onCountdown || (() => {});
    this.onStart = onStart || (() => {});
    this.reset(1280, 720);
  }

  reset(w, h) {
    this.w = w; this.h = h;
    this.items = [];
    this.effects = [];   // partículas
    this.popups = [];    // textos flotantes "+5"
    this.score = 0;
    this.combo = 0;
    this.comboT = 0;     // tiempo restante para mantener combo
    this.multiplier = 1;
    this.timeLeft = CONFIG.gameSeconds;
    this.cdLeft = CONFIG.countdownSeconds;
    this.shake = 0;
    this.state = 'idle';
    this._spawnAcc = 0;
    this._lastCd = null;
  }

  start() { this.state = 'countdown'; this.cdLeft = CONFIG.countdownSeconds; this._lastCd = null; }
  resize(w, h) { this.w = w; this.h = h; }

  /** 0 → 1 a lo largo de la partida */
  get progress() { return 1 - this.timeLeft / CONFIG.gameSeconds; }
  get _diff() { return 1 + (CONFIG.difficultyRamp - 1) * this.progress; }

  _spawn() {
    this.onEvent('spawn');
    const r = CONFIG.nuggetSize / 2;
    const golden = Math.random() < CONFIG.goldenChance;
    this.items.push({
      type: golden ? 'golden' : (Math.random() < 0.7 ? 'nugget' : 'popcorn'),
      x: r + Math.random() * (this.w - 2 * r),
      y: -r,
      vx: (Math.random() - 0.5) * 60 * this._diff,
      vy: (15 + Math.random() * 25) * this._diff,
      rot: Math.random() * 6.28,
      vr: (Math.random() - 0.5) * 4,
      state: 'falling', // falling | grabbed
      holder: null, lostT: 0, holdT: 0, age: 0,
    });
  }

  update(dt, hands) {
    // Efectos siempre activos (para que no se congelen)
    for (const p of this.effects) { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 700 * dt; p.rot += p.vr * dt; p.life -= dt; }
    this.effects = this.effects.filter(p => p.life > 0);
    for (const p of this.popups) { p.y -= 80 * dt; p.life -= dt; }
    this.popups = this.popups.filter(p => p.life > 0);
    this.shake = Math.max(0, this.shake - dt * 3);

    if (this.state === 'countdown') {
      this.cdLeft -= dt;
      const n = Math.ceil(this.cdLeft);
      if (n !== this._lastCd && n > 0) { this._lastCd = n; this.onCountdown(n); }
      if (this.cdLeft <= 0) { this.state = 'playing'; this.onStart(); }
      return;
    }
    if (this.state !== 'playing') return;

    this.timeLeft -= dt;
    if (this.timeLeft <= 0) { this.timeLeft = 0; this.state = 'over'; return; }

    // Combo: expira si pasa la ventana
    if (this.combo > 0) {
      this.comboT -= dt;
      if (this.comboT <= 0) { this.combo = 0; this.multiplier = 1; }
    }

    // Aparición con dificultad progresiva
    this._spawnAcc += dt * 1000;
    const every = CONFIG.spawnEveryMs / this._diff;
    while (this._spawnAcc >= every) { this._spawnAcc -= every; this._spawn(); }

    const hitR = CONFIG.nuggetSize * CONFIG.touchRadiusFactor;
    const handById = new Map(hands.map(h => [h.id, h]));

    // 1) Soltar
    for (const it of this.items) {
      if (it.state !== 'grabbed') continue;
      const h = handById.get(it.holder);
      it.holdT += dt;
      if (it.holdT > CONFIG.maxHoldSec) { it.eaten = true; this.onEvent('release_maxhold', { handClosed: !!(h && h.closed) }); this._crumbs(it.x, it.y, 8, it.type); continue; }
      if (h && h.closed) { it.lostT = 0; continue; }
      it.lostT += dt;
      if (it.lostT > CONFIG.releaseGraceSec) { it.eaten = true; this.onEvent('release_open', { handLost: !h }); this._crumbs(it.x, it.y, 8, it.type); }
    }

    // 2) Agarrar: mano cerrada y cualquier punto (palma o dedo) toca el nugget
    for (const h of hands) {
      if (!h.closed) continue;
      if (this.items.some(i => i.holder === h.id && !i.eaten)) continue;
      let best = null, bd = hitR;
      for (const it of this.items) {
        if (it.state !== 'falling') continue;
        for (const p of h.points) {
          const d = Math.hypot(it.x - p.x, it.y - p.y);
          if (d < bd) { bd = d; best = it; }
        }
      }
      if (best) this._catch(best, h);
    }

    // 3) Física
    for (const it of this.items) {
      it.age += dt;
      if (it.state === 'grabbed') {
        const h = handById.get(it.holder);
        if (h) { it.x += (h.x - it.x) * 0.7; it.y += (h.y - it.y) * 0.7; }
        it.vy = 0;
      } else {
        it.vy += CONFIG.gravity * this._diff * dt;
        it.x += it.vx * dt;
        it.y += it.vy * dt;
      }
      it.rot += it.vr * dt;
    }
    // Si un nugget cae sin atraparse, se rompe el combo
    for (const it of this.items) {
      if (it.state === 'falling' && it.y >= this.h + CONFIG.nuggetSize && this.combo > 0) { /* se perdió: el combo expira solo */ }
    }
    for (const i of this.items) if (!i.eaten && i.state === 'falling' && i.y >= this.h + CONFIG.nuggetSize) this.onEvent('miss', { nugget: i.type });
    this.items = this.items.filter(i => !i.eaten && i.y < this.h + CONFIG.nuggetSize);
  }

  _catch(it, hand) {
    it.state = 'grabbed'; it.holder = hand.id; it.holdT = 0; it.lostT = 0;
    this.combo++;
    this.comboT = CONFIG.comboWindowSec;
    this.multiplier = Math.min(CONFIG.maxMultiplier, 1 + Math.floor((this.combo - 1) / CONFIG.comboStep));
    const golden = it.type === 'golden';
    const points = (golden ? CONFIG.goldenPoints : 1) * this.multiplier;
    this.score += points;
    this.shake = golden ? 0.8 : 0.35;
    this._crumbs(it.x, it.y, golden ? 26 : 14, it.type);
    this.popups.push({ x: it.x, y: it.y - 30, text: `+${points}`, golden, life: 0.9, max: 0.9 });
    this.onEvent('catch', { nugget: it.type, points, combo: this.combo, handSize: +(hand.size || 0).toFixed(2), curled: hand.curled, x: Math.round(it.x), y: Math.round(it.y) });
    this.onCatch({ points, combo: this.combo, multiplier: this.multiplier, golden, score: this.score });
  }

  _crumbs(x, y, n, type) {
    const cols = type === 'golden' ? ['#FFD200', '#FFF3A0', '#FFB300'] : ['#E0A030', '#B8741A', '#FFD200', '#D7282F'];
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.28, s = 120 + Math.random() * 320;
      this.effects.push({
        x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 180,
        size: 3 + Math.random() * 6, color: cols[(Math.random() * cols.length) | 0],
        rot: Math.random() * 6, vr: (Math.random() - 0.5) * 12, life: 0.7, max: 0.7,
      });
    }
  }
}
