// Cámara + MediaPipe. Modo "worker" (por defecto): detección de manos en un Web Worker, el render queda fluido.
// Modo "main" (respaldo automático): Tasks Vision en el hilo principal.
// Expone coordenadas ya mapeadas a pantalla (espejo en X).
import { CONFIG } from './config.js';

const VISION = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
const MODELS = 'https://storage.googleapis.com/mediapipe-models';

export class VisionTracker {
  constructor(video, canvas) {
    this.video = video;
    this.canvas = canvas;
    this.hands = [];   // [{ id, x, y, closed, curled, points, size, ... }] en px de canvas
    this.mouth = null;
    this._pinchState = {};
    this._frame = 0;
    this._lastTime = -1;
    this._lastTs = 0;
    this._running = false;
    this._lastHandSeen = 0;
    this._raw = {};
    this.delegate = 'GPU';
    this.mode = 'main';
    this.inferMs = 0;
    this.fps = 0; this._fpsN = 0; this._fpsT = performance.now();
  }

  // ---------- Inicialización ----------
  async init() {
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 960 }, height: { ideal: 540 }, frameRate: { ideal: 30 }, facingMode: 'user' }, audio: false,
    });
    this.video.srcObject = this.stream;
    const vt = this.stream.getVideoTracks()[0];
    this.cameraInfo = vt.getSettings(); this.cameraLabel = vt.label; // para el log
    await this.video.play();

    const handOpts = {
      numHands: CONFIG.maxHandsDetected,
      minHandDetectionConfidence: CONFIG.handDetectConf,
      minHandPresenceConfidence: CONFIG.handPresenceConf,
      minTrackingConfidence: CONFIG.handTrackConf,
    };

    if (CONFIG.useWorker && !CONFIG.useFace && typeof Worker !== 'undefined' && typeof createImageBitmap === 'function') {
      try {
        await this._initWorker(handOpts);
        this.mode = 'worker';
        return;
      } catch (e) {
        console.warn('Worker falló, usando hilo principal:', e);
        if (this.worker) { this.worker.terminate(); this.worker = null; }
      }
    }
    await this._initMain(handOpts);
    this.mode = 'main';
  }

  _initWorker(handOpts) {
    return new Promise((resolve, reject) => {
      const w = new Worker('js/vision.worker.js'); // clásico (importScripts)
      this.worker = w;
      const timer = setTimeout(() => reject(new Error('timeout iniciando worker')), 30000);
      w.onerror = e => { clearTimeout(timer); reject(new Error(e.message || 'error en worker')); };
      w.onmessage = ({ data }) => {
        if (data.type === 'ready') {
          clearTimeout(timer);
          this.delegate = data.delegate;
          w.onmessage = m => this._onWorkerMsg(m.data);
          w.onerror = e => console.error('worker', e.message);
          resolve();
        } else if (data.type === 'error') {
          clearTimeout(timer); reject(new Error(data.message));
        }
      };
      w.postMessage({ type: 'init', delegate: 'GPU', options: handOpts });
    });
  }

  async _initMain(handOpts) {
    const { FilesetResolver, HandLandmarker, FaceLandmarker } = await import(`${VISION}/vision_bundle.mjs`);
    const fileset = await FilesetResolver.forVisionTasks(`${VISION}/wasm`);
    const hand = 'hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
    const face = 'face_landmarker/face_landmarker/float16/1/face_landmarker.task';
    const make = (Cls, path, delegate, extra) => Cls.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: `${MODELS}/${path}`, delegate }, runningMode: 'VIDEO', ...extra,
    });
    const build = async delegate => {
      this.handModel = await make(HandLandmarker, hand, delegate, handOpts);
      this.faceModel = CONFIG.useFace ? await make(FaceLandmarker, face, delegate, { numFaces: 1 }) : null;
    };
    try { await build(CONFIG.handDelegate); this.delegate = CONFIG.handDelegate; }
    catch (e) { console.warn('GPU no disponible, usando CPU', e); this.delegate = 'CPU'; await build('CPU'); }
  }

  // ---------- Bucle de detección ----------
  start() {
    this._running = true;
    if (this.mode === 'worker') this._loopWorker(); else this._loopMain();
  }

  stop() { this._running = false; }

  _tick(ms) { // contador de fps de detección
    this._fpsN++;
    const now = performance.now();
    if (now - this._fpsT > 1000) { this.fps = Math.round(this._fpsN * 1000 / (now - this._fpsT)); this._fpsN = 0; this._fpsT = now; }
    this.inferMs = Math.round(this.inferMs * 0.8 + ms * 0.2);
  }

  _loopWorker() {
    const v = this.video;
    this._busy = false; this._busySince = 0;
    const schedule = () => (v.requestVideoFrameCallback ? v.requestVideoFrameCallback(tick) : requestAnimationFrame(tick));
    const tick = () => {
      if (!this._running) return;
      const now = performance.now();
      if (this._busy && now - this._busySince > 2000) this._busy = false; // seguro anti-bloqueo
      if (!this._busy && v.readyState >= 2) {
        this._busy = true; this._busySince = now;
        const ts = Math.max(now, this._lastTs + 1); this._lastTs = ts;
        const w = Math.min(CONFIG.workerFrameWidth, v.videoWidth);
        const h = Math.round(w * v.videoHeight / v.videoWidth);
        createImageBitmap(v, { resizeWidth: w, resizeHeight: h, resizeQuality: 'low' })
          .then(bmp => this.worker.postMessage({ type: 'detect', bitmap: bmp, ts }, [bmp]))
          .catch(() => { this._busy = false; });
      }
      schedule();
    };
    schedule();
  }

  _onWorkerMsg(m) {
    if (m.type === 'result') {
      this._busy = false;
      this._onHands({ landmarks: m.landmarks });
      this._tick(m.ms);
    } else if (m.type === 'error') {
      console.warn('worker:', m.message);
    }
  }

  _loopMain() {
    // Warm-up: la primera inferencia es lenta
    try {
      const ts = performance.now();
      for (let k = 0; k < 3; k++) this.handModel.detectForVideo(this.video, ts + k);
      this._lastTs = ts + 3;
    } catch (e) { console.warn('warmup', e); }
    const loop = () => {
      if (!this._running) return;
      const v = this.video;
      if (v.readyState >= 2 && v.currentTime !== this._lastTime) {
        this._lastTime = v.currentTime;
        const ts = Math.max(performance.now(), this._lastTs + 1);
        this._lastTs = ts;
        try {
          const t0 = performance.now();
          this._onHands(this.handModel.detectForVideo(v, ts));
          this._tick(performance.now() - t0);
          if (this.faceModel && this._frame++ % CONFIG.faceEveryNFrames === 0) {
            this._onFace(this.faceModel.detectForVideo(v, ts + 0.5));
          }
        } catch (e) { console.warn(e); }
      }
      requestAnimationFrame(loop);
    };
    loop();
  }

  // ---------- Coordenadas ----------
  /** Landmark normalizado (0-1 del video) → px de canvas, con object-fit:cover y espejo en X. */
  toScreen(lm) {
    const W = this.canvas.width, H = this.canvas.height;
    const vw = this.video.videoWidth, vh = this.video.videoHeight;
    const s = Math.max(W / vw, H / vh);
    const ox = (W - vw * s) / 2, oy = (H - vh * s) / 2;
    const x = lm.x * vw * s + ox;
    const y = lm.y * vh * s + oy;
    return { x: W - x, y };
  }

  /**
   * Manos (opcionalmente adelantadas en el tiempo; desactivado por defecto: handPrediction=false).
   */
  predictedHands(now = performance.now()) {
    if (!CONFIG.handPrediction) return this.hands;
    return this.hands.map(h => {
      const age = Math.min(0.1, (now - h.t) / 1000);
      let dx = h.vx * (age + CONFIG.handLeadSec), dy = h.vy * (age + CONFIG.handLeadSec);
      const m = Math.hypot(dx, dy), max = CONFIG.handLeadMaxPx;
      if (m > max) { dx *= max / m; dy *= max / m; }
      return { ...h, x: h.x + dx, y: h.y + dy, points: h.points.map(p => ({ x: p.x + dx, y: p.y + dy })) };
    });
  }

  _onHands(res) {
    const out = [];
    const FINGERS = [[8, 6], [12, 10], [16, 14], [20, 18]]; // [punta, PIP] índice..meñique
    (res.landmarks || []).forEach((lm, i) => {
      const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
      // Tamaño de la palma relativo al alto del frame: la gente lejana (detrás/curiosos) se ve más pequeña
      const vw = this.video.videoWidth, vh = this.video.videoHeight;
      const palmSize = Math.hypot((lm[0].x - lm[9].x) * vw, (lm[0].y - lm[9].y) * vh) / vh;
      if (palmSize < CONFIG.minHandSize) return;
      // Dedo doblado = su punta está casi tan cerca de la muñeca como su articulación PIP
      const curled = FINGERS.filter(([tip, pip]) => d(lm[tip], lm[0]) < d(lm[pip], lm[0]) * CONFIG.curlRatio).length;
      // Sin zona intermedia: >=3 doblados = cerrada, si no, abierta (abrir se detecta al instante)
      const closed = curled >= 3;
      this._pinchState[i] = closed;
      const points = lm.map(p => this.toScreen(p)); // los 21 puntos en px de canvas
      const palm = [0, 5, 9, 13, 17].map(k => points[k]);
      const x = palm.reduce((s, p) => s + p.x, 0) / palm.length;
      const y = palm.reduce((s, p) => s + p.y, 0) / palm.length;
      // Velocidad de la palma (px/s, suavizada), solo se usa si handPrediction = true
      const tNow = performance.now(), pv = this._raw[i];
      let vx = 0, vy = 0;
      if (pv && tNow - pv.t < 200) {
        const dtS = Math.max(0.001, (tNow - pv.t) / 1000);
        vx = (x - pv.x) / dtS * 0.6 + pv.vx * 0.4; vy = (y - pv.y) / dtS * 0.6 + pv.vy * 0.4;
        if (Math.hypot(vx, vy) < 40) { vx = 0; vy = 0; }
      }
      this._raw[i] = { x, y, vx, vy, t: tNow };
      out.push({ id: i, x, y, closed, curled, points, vx, vy, t: tNow, size: palmSize });
    });
    // Solo las N manos más grandes (= las más cercanas a la cámara = jugadores, no el público)
    out.sort((a, b) => b.size - a.size);
    out.length = Math.min(out.length, CONFIG.maxPlayersHands);
    // Si un frame no detecta nada, conserva la última pose un instante (evita parpadeos)
    const now = performance.now();
    if (out.length) { this.hands = out; this._lastHandSeen = now; }
    else if (now - this._lastHandSeen > CONFIG.handLostGraceSec * 1000) this.hands = [];
  }

  _onFace(res) {
    const f = res.faceLandmarks && res.faceLandmarks[0];
    if (!f) { this.mouth = null; return; }
    const up = f[13], lo = f[14]; // labios internos
    this.mouth = this.toScreen({ x: (up.x + lo.x) / 2, y: (up.y + lo.y) / 2 });
  }
}
