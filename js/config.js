// Configuración central: ajusta aquí sin tocar la lógica.
export const COLORS = {
  blue: '#001689',   // Pilgrim's azul
  red: '#D7282F',    // Pilgrim's rojo
  yellow: '#FFD200',
};

export const CONFIG = {
  gameSeconds: 30,
  countdownSeconds: 3,     // 3-2-1 antes de empezar
  useFace: false,          // false = solo manos (sin cara/boca)

  // Caída y dificultad (sube linealmente con el tiempo jugado)
  gravity: 240,            // px/s² al inicio
  spawnEveryMs: 800,       // intervalo al inicio
  difficultyRamp: 1.8,     // al final del juego: gravedad ×1.8 y aparición 1.8× más frecuente
  nuggetSize: 90,
  goldenChance: 0.1,       // probabilidad de nugget dorado
  goldenPoints: 5,

  // Combos
  comboWindowSec: 1.4,     // tiempo máximo entre atrapadas para mantener el combo
  comboStep: 3,            // cada N atrapadas seguidas sube el multiplicador
  maxMultiplier: 5,

  // Manos
  touchRadiusFactor: 0.55, // radio de contacto (× nuggetSize) entre cualquier punto de la mano y el nugget
  curlRatio: 1.0,          // dedo doblado si dist(punta,muñeca) < dist(PIP,muñeca) × este valor
  maxHoldSec: 0.7,         // el nugget se libera solo; nunca se traba
  releaseGraceSec: 0.15,   // tolerancia antes de soltar si se pierde el tracking

  // Rendimiento: worker DESACTIVADO. En las pruebas (GPU integrada) dio 5 fps de detección / 132 ms
  // contra ~25-38 fps / 26-38 ms en el hilo principal. Puede probarse de nuevo en otro equipo con GPU dedicada.
  useWorker: false,
  // Dónde corre el modelo de manos. Prueba rápida sin editar: abre /?delegate=cpu  (o ?delegate=gpu)
  handDelegate: (new URLSearchParams(location.search).get('delegate') || 'GPU').toUpperCase(),
  workerFrameWidth: 640,   // ancho del frame que se envía al worker (menos = más rápido; el modelo lo reduce igual)

  // Detección de manos (más bajo = detecta más lejos/borroso y suelta menos, con algo más de falsos positivos)
  handDetectConf: 0.3,
  handPresenceConf: 0.3,
  handTrackConf: 0.3,
  // Multitud (expo): ignora manos lejanas y limita a los jugadores
  minHandSize: 0.07,       // tamaño mínimo de palma (fracción del alto del video). ~0.15 a 1 m, ~0.08 a 2 m. Sube = ignora más lejos
  maxPlayersHands: Number(new URLSearchParams(location.search).get('hands')) || 1,   // manos que cuentan (1 por defecto: rinde mejor en equipos modestos). Prueba 2 manos: /?hands=2
  maxHandsDetected: Number(new URLSearchParams(location.search).get('hands')) || 1,  // manos que busca el modelo (cada una suma ~10-15 ms)

  handLostGraceSec: 0.25,  // si un frame no ve la mano, se conserva la última pose este tiempo
  handPrediction: false,   // predicción de movimiento: DESACTIVADA (empeoraba la sensación)
  handLeadSec: 0.05,       // (solo si handPrediction = true) adelanta la mano estos segundos
  handLeadMaxPx: 220,      // límite de adelanto en px (evita saltos con detecciones erráticas)

  faceEveryNFrames: 2,
  showDebug: true,         // esqueleto de la mano; false = oculto para el evento
};

// Para usar los PNG definitivos: pon la ruta aquí (null = forma de canvas).
export const ASSETS = {
  nugget: null,   // ej. 'assets/nugget.png'
  popcorn: null,  // ej. 'assets/popcorn.png'
  golden: null,   // ej. 'assets/golden.png'
};

