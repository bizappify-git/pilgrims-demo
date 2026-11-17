// Sonidos sintetizados con Web Audio (sin archivos). Para usar un archivo: setSample('crunch', 'assets/crunch.mp3').
let ctx = null;
const samples = {};

export function unlockAudio() {
  ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') ctx.resume();
}

export function setSample(name, src) { samples[name] = new Audio(src); }

function playSample(name) {
  if (!samples[name]) return false;
  samples[name].cloneNode().play();
  return true;
}

function noise(t, len, freq, vol = 0.8, type = 'bandpass') {
  const buf = ctx.createBuffer(1, Math.max(1, ctx.sampleRate * len), ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  const s = ctx.createBufferSource(); s.buffer = buf;
  const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq;
  const g = ctx.createGain(); g.gain.value = vol;
  s.connect(f).connect(g).connect(ctx.destination); s.start(t);
}

function tone(t, freq, len, vol = 0.25, type = 'triangle', slideTo = null) {
  const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + len);
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + len);
  o.connect(g).connect(ctx.destination); o.start(t); o.stop(t + len);
}

/** Atrapar: whoosh + crunch + ding que sube con el combo */
export function playCatch({ golden, combo }) {
  if (!ctx) return;
  if (playSample('crunch')) return;
  const t = ctx.currentTime;
  noise(t, 0.12, 900, 0.25, 'highpass');                    // whoosh
  for (let k = 0; k < 3; k++) noise(t + 0.04 + k * 0.05, 0.05, 1500 + Math.random() * 2500, 0.9); // crunch
  const base = 520 * Math.pow(1.0595, Math.min(combo, 12)); // sube un semitono por combo
  tone(t + 0.02, base, 0.18, 0.18, 'triangle');
  if (golden) { tone(t, base * 1.5, 0.4, 0.2, 'sine'); tone(t + 0.1, base * 2, 0.5, 0.2, 'sine'); }
}

export function playTick(n) { if (ctx) tone(ctx.currentTime, 440, 0.15, 0.3, 'square'); }
export function playGo() {
  if (!ctx) return;
  const t = ctx.currentTime;
  tone(t, 660, 0.12, 0.3, 'square'); tone(t + 0.12, 880, 0.3, 0.3, 'square');
}
export function playEnd() {
  if (!ctx) return;
  const t = ctx.currentTime;
  [784, 659, 523, 392].forEach((f, i) => tone(t + i * 0.14, f, 0.25, 0.3, 'sawtooth'));
}
