// Classic Web Worker: corre MediaPipe HandLandmarker fuera del hilo principal.
// Protocolo:  main → {type:'init', delegate, options}  |  {type:'detect', bitmap, ts}
//             worker → {type:'ready', delegate} | {type:'error', message} | {type:'result', landmarks, ms}
const VISION = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
const MODEL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

// jsDelivr sirve el .cjs como "application/node" y Chrome lo bloquea en importScripts.
// Solución: descargarlo como texto y cargarlo desde un Blob con MIME de JavaScript.
let lib = null;
async function loadLib() {
  if (lib) return lib;
  const src = await (await fetch(`${VISION}/vision_bundle.cjs`)).text();
  self.module = { exports: {} };            // el bundle CommonJS espera `module`/`exports`
  self.exports = self.module.exports;
  const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
  importScripts(url);
  URL.revokeObjectURL(url);
  lib = self.module.exports;
  if (!lib.HandLandmarker) lib = self.exports.HandLandmarker ? self.exports : self;
  return lib;
}
let landmarker = null;

async function create(fileset, delegate, options) {
  return lib.HandLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: MODEL, delegate },
    runningMode: 'VIDEO', ...options,
  });
}

self.onmessage = async ({ data }) => {
  if (data.type === 'init') {
    try {
      await loadLib();
      const fileset = await lib.FilesetResolver.forVisionTasks(`${VISION}/wasm`);
      let used = data.delegate;
      try { landmarker = await create(fileset, used, data.options); }
      catch (e) { used = 'CPU'; landmarker = await create(fileset, 'CPU', data.options); }
      // calentamiento con un frame vacío
      try {
        const c = new OffscreenCanvas(64, 64); c.getContext('2d');
        for (let k = 0; k < 2; k++) landmarker.detectForVideo(c, k + 1);
      } catch (e) { /* no crítico */ }
      self.postMessage({ type: 'ready', delegate: used });
    } catch (e) {
      self.postMessage({ type: 'error', message: String(e && e.message || e) });
    }
  } else if (data.type === 'detect') {
    const { bitmap, ts } = data;
    if (!landmarker) { bitmap.close(); self.postMessage({ type: 'result', landmarks: [], ms: 0 }); return; }
    try {
      const t0 = performance.now();
      const res = landmarker.detectForVideo(bitmap, ts);
      const landmarks = (res.landmarks || []).map(h => h.map(p => ({ x: p.x, y: p.y, z: p.z })));
      self.postMessage({ type: 'result', landmarks, ms: performance.now() - t0 });
    } catch (e) {
      self.postMessage({ type: 'error', message: String(e && e.message || e), fatal: false });
      self.postMessage({ type: 'result', landmarks: [], ms: 0 });
    } finally {
      bitmap.close();
    }
  }
};

