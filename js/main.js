import { VisionTracker } from './camera.js';
import { Game } from './game.js';
import { Renderer } from './renderer.js';
import { unlockAudio, playCatch, playTick, playGo, playEnd } from './audio.js';
import { CONFIG } from './config.js';
import { SessionLogger } from './logger.js';

const $ = id => document.getElementById(id);
const video = $('video'), canvas = $('canvas');

const renderer = new Renderer(canvas, video);
const tracker = new VisionTracker(video, canvas);
const logger = new SessionLogger(tracker);
const game = new Game({
  onEvent: (type, data) => logger.event(type, data),
  onCatch: info => {
    playCatch(info);
    const s = $('score');
    s.textContent = info.score;
    s.parentElement.classList.remove('pop'); void s.parentElement.offsetWidth; s.parentElement.classList.add('pop');
  },
  onCountdown: n => playTick(n),
  onStart: () => { playGo(); $('hud').classList.remove('hidden'); },
});
let ready = false, last = performance.now();

window.addEventListener('resize', () => game.resize(canvas.width, canvas.height));

function startGame() {
  unlockAudio();
  game.reset(canvas.width, canvas.height);
  game.start();
  logger.start();
  $('score').textContent = '0';
  $('time').textContent = CONFIG.gameSeconds;
  $('startScreen').classList.add('hidden');
  $('gameOver').classList.add('hidden');
  $('hud').classList.add('hidden'); // aparece al terminar la cuenta regresiva
}

$('startBtn').onclick = async () => {
  const btn = $('startBtn'); btn.disabled = true;
  if (!ready) {
    try {
      $('status').textContent = 'Cargando cámara y modelos…';
      await tracker.init();
      tracker.start();
      ready = true;
    } catch (e) {
      console.error(e);
      $('status').textContent = 'Error: ' + e.message + ' (usa localhost/https y permite la cámara)';
      btn.disabled = false;
      return;
    }
  }
  btn.disabled = false;
  startGame();
};
$('restartBtn').onclick = startGame;

function loop(now) {
  const dt = Math.min(0.15, (now - last) / 1000); // tope alto: con pocos fps el juego sigue en tiempo real
  last = now;
  const prev = game.state;
  const hands = tracker.predictedHands(now);
  game.update(dt, hands);
  renderer.draw(game, tracker, hands);
  if (game.state === 'playing') logger.frame(now, hands);

  if (game.state === 'playing') {
    const t = Math.ceil(game.timeLeft);
    $('time').textContent = t;
    $('time').parentElement.classList.toggle('low', t <= 5);
  }
  if (prev === 'playing' && game.state === 'over') {
    playEnd();
    logger.end(game.score);
    $('finalScore').textContent = game.score;
    $('hud').classList.add('hidden');
    $('gameOver').classList.remove('hidden');
  }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
