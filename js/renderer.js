// Todo el dibujo. Para cambiar assets: edita ASSETS en config.js (o drawItem()).
import { CONFIG, ASSETS, COLORS } from './config.js';

const BONES = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],
  [9,13],[13,14],[14,15],[15,16],[13,17],[17,18],[18,19],[19,20],[0,17]];
const FONT = '"Lilita One", Impact, sans-serif';

export class Renderer {
  constructor(canvas, video) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.video = video;
    this.images = {};
    for (const [k, src] of Object.entries(ASSETS)) {
      if (!src) continue;
      const img = new Image();
      img.onload = () => (this.images[k] = img);
      img.src = src;
    }
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
  }

  draw(game, tracker, hands) {
    const nowT = performance.now(); // fps de render (suavizado) para el overlay de depuración
    this._rf = (this._rf || 60) * 0.9 + (1000 / Math.max(1, nowT - (this._rl || nowT - 16))) * 0.1; this._rl = nowT;
    const { ctx, canvas: c } = this;
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.save();
    if (game.shake > 0) { // screen shake
      const m = game.shake * 14;
      ctx.translate((Math.random() - 0.5) * m, (Math.random() - 0.5) * m);
    }
    this._drawVideo();
    for (const it of game.items) this.drawItem(it);
    this._drawEffects(game);
    if (CONFIG.showDebug) this._drawHands(tracker, hands);
    ctx.restore();

    if (game.state === 'playing') this._drawCombo(game);
    if (game.state === 'countdown') this._drawCountdown(game);
  }

  _drawVideo() {
    const { ctx, canvas: c, video: v } = this;
    if (!v.videoWidth) return;
    const s = Math.max(c.width / v.videoWidth, c.height / v.videoHeight);
    const w = v.videoWidth * s, h = v.videoHeight * s;
    ctx.save();
    ctx.translate(c.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(v, (c.width - w) / 2, (c.height - h) / 2, w, h);
    ctx.restore();
  }

  _vignette() {
    const { ctx, canvas: c } = this;
    const g = ctx.createRadialGradient(c.width / 2, c.height / 2, c.height * 0.4, c.width / 2, c.height / 2, c.height * 0.95);
    g.addColorStop(0, 'rgba(0,22,137,0)'); g.addColorStop(1, 'rgba(0,22,137,0.55)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, c.width, c.height);
  }

  drawItem(it) {
    const { ctx } = this;
    const S = CONFIG.nuggetSize;
    ctx.save();
    ctx.translate(it.x, it.y);
    // sombra suave
    ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.beginPath(); ctx.ellipse(6, S * .5, S * .38, S * .1, 0, 0, 6.28); ctx.fill();
    // aparece con "pop" y se agranda al agarrarlo
    const pop = Math.min(1, it.age * 6);
    let sc = (0.6 + 0.4 * pop) * (it.state === 'grabbed' ? 1.25 : 1);
    if (it.type === 'golden') {
      sc *= 1 + Math.sin(it.age * 8) * 0.06;
      const g = ctx.createRadialGradient(0, 0, S * .3, 0, 0, S * 1.1);
      g.addColorStop(0, 'rgba(255,210,0,.7)'); g.addColorStop(1, 'rgba(255,210,0,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, S * 1.1, 0, 6.28); ctx.fill();
    }
    ctx.scale(sc, sc);
    ctx.rotate(it.rot);

    const img = this.images[it.type];
    if (img) {
      const k = S / Math.max(img.width, img.height); // conserva proporción, el lado mayor = nuggetSize
      ctx.drawImage(img, -img.width * k / 2, -img.height * k / 2, img.width * k, img.height * k);
    } else if (it.type === 'popcorn') {
      ctx.fillStyle = '#d98b2b'; ctx.strokeStyle = '#8a4b08'; ctx.lineWidth = 4;
      for (const [dx, dy, r] of [[0, 0, .3], [-.18, -.12, .2], [.18, -.1, .2], [0, .18, .2]]) {
        ctx.beginPath(); ctx.arc(dx * S, dy * S, r * S, 0, 6.28); ctx.fill(); ctx.stroke();
      }
    } else { // nugget y golden (placeholder)
      const gold = it.type === 'golden';
      ctx.fillStyle = gold ? '#FFC800' : '#e0a030'; ctx.strokeStyle = gold ? '#B27A00' : '#8a4b08'; ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(-S * .5, 0); ctx.quadraticCurveTo(-S * .4, -S * .45, 0, -S * .4);
      ctx.quadraticCurveTo(S * .5, -S * .45, S * .5, 0);
      ctx.quadraticCurveTo(S * .45, S * .4, 0, S * .4);
      ctx.quadraticCurveTo(-S * .5, S * .45, -S * .5, 0);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = 'rgba(255,240,170,.7)';
      ctx.beginPath(); ctx.ellipse(-S * .12, -S * .12, S * .15, S * .09, 0, 0, 6.28); ctx.fill();
      if (gold) { ctx.fillStyle = COLORS.red; ctx.font = `${S * .4}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('x5', 0, 2); }
    }
    ctx.restore();
  }

  _drawEffects(game) {
    const { ctx } = this;
    for (const p of game.effects) { // migajas
      ctx.globalAlpha = Math.max(0, p.life / p.max);
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      ctx.fillStyle = p.color; ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.7);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
    for (const p of game.popups) { // "+5"
      const t = 1 - p.life / p.max;
      const sc = t < 0.2 ? 0.5 + t * 4 : 1.3 - t * 0.3;
      ctx.save(); ctx.globalAlpha = Math.min(1, p.life / 0.3);
      ctx.translate(p.x, p.y); ctx.scale(sc, sc);
      ctx.font = `${p.golden ? 80 : 60}px ${FONT}`; ctx.textAlign = 'center'; ctx.lineJoin = 'round';
      ctx.lineWidth = 12; ctx.strokeStyle = COLORS.blue; ctx.strokeText(p.text, 0, 0);
      ctx.fillStyle = p.golden ? COLORS.yellow : COLORS.red; ctx.fillText(p.text, 0, 0);
      ctx.restore();
    }
  }

  _drawCombo(game) {
    if (game.combo < 2) return;
    const { ctx, canvas: c } = this;
    const bar = Math.max(0, game.comboT / CONFIG.comboWindowSec);
    const pulse = 1 + Math.sin(performance.now() / 90) * 0.04 * game.multiplier;
    ctx.save();
    ctx.translate(c.width / 2, 110); ctx.scale(pulse, pulse); ctx.textAlign = 'center'; ctx.lineJoin = 'round';
    ctx.font = `64px ${FONT}`; ctx.lineWidth = 12; ctx.strokeStyle = COLORS.blue;
    const txt = `COMBO x${game.combo}` + (game.multiplier > 1 ? `  ·  ×${game.multiplier} PUNTOS` : '');
    ctx.strokeText(txt, 0, 0); ctx.fillStyle = COLORS.yellow; ctx.fillText(txt, 0, 0);
    ctx.fillStyle = COLORS.blue; ctx.fillRect(-150, 20, 300, 14);
    ctx.fillStyle = COLORS.red; ctx.fillRect(-150, 20, 300 * bar, 14);
    ctx.restore();
  }

  _drawCountdown(game) {
    const { ctx, canvas: c } = this;
    const n = Math.ceil(game.cdLeft);
    const frac = game.cdLeft - Math.floor(game.cdLeft); // 1→0 dentro de cada número
    const sc = 1 + (1 - frac) * 0.6;
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.translate(c.width / 2, c.height / 2); ctx.scale(sc, sc);
    ctx.globalAlpha = Math.min(1, frac * 3 + 0.3);
    ctx.font = `300px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
    ctx.lineWidth = 30; ctx.strokeStyle = COLORS.blue; ctx.strokeText(n, 0, 0);
    ctx.fillStyle = COLORS.yellow; ctx.fillText(n, 0, 0);
    ctx.restore();
  }

  _drawHands(t, hands) {
    const { ctx } = this;
    ctx.font = '18px monospace'; ctx.textAlign = 'left'; ctx.fillStyle = '#FFD200';
    ctx.fillText(`[${t.mode}/${t.delegate}] render: ${Math.round(this._rf)} fps · detección: ${t.fps} fps · inferencia: ${t.inferMs} ms · manos: ${hands.length}` + (hands.length ? ` · tamaño palma: ${hands.map(h => h.size.toFixed(2)).join(', ')}` : ''), 16, this.canvas.height - 16);
    for (const h of hands) {
      const col = h.closed ? COLORS.yellow : '#2f7bff';
      ctx.lineCap = 'round';
      ctx.strokeStyle = COLORS.blue; ctx.lineWidth = 10; this._bones(h);
      ctx.strokeStyle = col; ctx.lineWidth = 5; this._bones(h);
      ctx.fillStyle = COLORS.red;
      for (const p of h.points) { ctx.beginPath(); ctx.arc(p.x, p.y, 6, 0, 6.28); ctx.fill(); }
      ctx.font = `28px ${FONT}`; ctx.textAlign = 'center'; ctx.lineJoin = 'round';
      ctx.lineWidth = 8; ctx.strokeStyle = COLORS.blue; ctx.fillStyle = col;
      const label = h.closed ? 'CERRADA' : 'ABIERTA';
      ctx.strokeText(label, h.x, h.y - 70); ctx.fillText(label, h.x, h.y - 70);
    }
  }

  _bones(h) {
    const { ctx } = this;
    ctx.beginPath();
    for (const [a, b] of BONES) { ctx.moveTo(h.points[a].x, h.points[a].y); ctx.lineTo(h.points[b].x, h.points[b].y); }
    ctx.stroke();
  }
}
