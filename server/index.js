// Minimal local WebSocket "radar" server.
// Each tick emits a 1..10-signal burst with a shared timestamp, then
// schedules the next tick 0.3-3.3s later. Run with `npm run server`.

const { WebSocketServer } = require('ws');

const PORT = Number(process.env.PORT ?? 8080);
const MIN_TICK_DELAY_MS = 300;
const MAX_TICK_DELAY_RANGE_MS = 3000;
const MAX_BURST_SIZE = 10;
const BURST_GROWTH_PROBABILITY = 0.3;
const WS_OPEN = 1;

const CENTERS = [
  [50.4501, 30.5234], [50.6800, 30.2300], [50.6500, 30.8800],
  [50.1800, 30.2500], [50.2000, 30.9500], [50.5200, 29.9000],
  [50.3800, 31.1500], [50.7800, 30.5500], [50.1200, 30.5800],
  [50.5500, 30.2800], [50.3200, 30.8000], [50.4000, 30.1000],
];

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function buildZone(lat, lon) {
  if (Math.random() < 0.1) return [];
  const n = 6 + Math.floor(Math.random() * 4);
  const baseR = 0.008 + Math.random() * 0.012;
  const zone = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const r = baseR * (0.6 + Math.random() * 0.8);
    zone.push({ lat: lat + Math.sin(a) * r, lon: lon + Math.cos(a) * r });
  }
  return zone;
}

function makeSignal(timestamp) {
  const [lat, lon] = pick(CENTERS);
  const angle = Math.random() * Math.PI * 2;
  const radius = Math.random() * 0.025;
  return {
    timestamp,
    frequency: Math.round((144 + Math.random() * 806) * 10) / 10,
    point: { lat: lat + Math.sin(angle) * radius, lon: lon + Math.cos(angle) * radius },
    zone: buildZone(lat, lon),
  };
}

// Geometric distribution — heavily weighted toward solo signals, with a
// rare tail to MAX_BURST_SIZE.
function pickBurstSize() {
  let size = 1;
  while (size < MAX_BURST_SIZE && Math.random() < BURST_GROWTH_PROBABILITY) size++;
  return size;
}

const wss = new WebSocketServer({ port: PORT });

wss.on('connection', () => {
  console.log(`[ws] client connected — total clients: ${wss.clients.size}`);
});

(function tick() {
  // One timestamp per whole burst so the client can group signals by
  // strict equality on `timestamp` and trust the "N одночасно" semantics.
  const burstTimestamp = Date.now();
  const burstSize = pickBurstSize();
  for (let i = 0; i < burstSize; i++) {
    const payload = JSON.stringify(makeSignal(burstTimestamp));
    for (const client of wss.clients) {
      if (client.readyState === WS_OPEN) client.send(payload);
    }
  }
  setTimeout(tick, MIN_TICK_DELAY_MS + Math.floor(Math.random() * MAX_TICK_DELAY_RANGE_MS));
})();

console.log(`[ws] signal server listening on ws://localhost:${PORT}`);
