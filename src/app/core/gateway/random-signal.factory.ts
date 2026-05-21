import { HISTORY_WINDOW_MS, ONE_MINUTE_MS } from '../../shared/constants/time.constants';
import { GeoPoint } from '../../shared/models/geo.model';
import { SignalMessage } from '../../shared/models/signal.model';

const KYIV_EMITTER_CENTERS: readonly GeoPoint[] = [
  { lat: 50.4501, lon: 30.5234 },
  { lat: 50.6800, lon: 30.2300 },
  { lat: 50.6500, lon: 30.8800 },
  { lat: 50.1800, lon: 30.2500 },
  { lat: 50.2000, lon: 30.9500 },
  { lat: 50.5200, lon: 29.9000 },
  { lat: 50.3800, lon: 31.1500 },
  { lat: 50.7800, lon: 30.5500 },
  { lat: 50.1200, lon: 30.5800 },
  { lat: 50.5500, lon: 30.2800 },
  { lat: 50.3200, lon: 30.8000 },
  { lat: 50.4000, lon: 30.1000 },
];

const FREQUENCY_MIN_MHZ = 144;
const FREQUENCY_MAX_MHZ = 950;
const POINT_JITTER_DEG = 0.025;
const EMPTY_ZONE_PROBABILITY = 0.1;
const MIN_ZONE_VERTICES = 6;
const MAX_ZONE_VERTEX_BONUS = 4;

export function createRandomSignal(timestamp: number): SignalMessage {
  const center = pickEmitterCenter();
  return {
    timestamp,
    frequency: pickFrequency(),
    point: jitterAroundCenter(center, POINT_JITTER_DEG),
    zone: buildZoneAround(center),
  };
}

export function generateRandomHistory(): SignalMessage[] {
  const now = Date.now();
  const history: SignalMessage[] = [];

  for (let t = now - HISTORY_WINDOW_MS; t < now; t += ONE_MINUTE_MS) {
    const jitter = Math.floor((Math.random() - 0.5) * ONE_MINUTE_MS);
    history.push(createRandomSignal(t + jitter));
  }
  return history;
}

function pickEmitterCenter(): GeoPoint {
  return KYIV_EMITTER_CENTERS[Math.floor(Math.random() * KYIV_EMITTER_CENTERS.length)]!;
}

function pickFrequency(): number {
  const span = FREQUENCY_MAX_MHZ - FREQUENCY_MIN_MHZ;
  return Math.round((FREQUENCY_MIN_MHZ + Math.random() * span) * 10) / 10;
}

function jitterAroundCenter(center: GeoPoint, radiusDeg: number): GeoPoint {
  const angle = Math.random() * Math.PI * 2;
  const r = Math.random() * radiusDeg;
  return {
    lat: center.lat + Math.sin(angle) * r,
    lon: center.lon + Math.cos(angle) * r,
  };
}

function buildZoneAround(center: GeoPoint): GeoPoint[] {
  // Spec explicitly says zone.length can be 0 — exercise the branch.
  if (Math.random() < EMPTY_ZONE_PROBABILITY) return [];

  const vertexCount = MIN_ZONE_VERTICES + Math.floor(Math.random() * MAX_ZONE_VERTEX_BONUS);
  const baseRadius = 0.008 + Math.random() * 0.012;
  const vertices: GeoPoint[] = [];

  for (let i = 0; i < vertexCount; i++) {
    const angle = (i / vertexCount) * Math.PI * 2;
    const radius = baseRadius * (0.6 + Math.random() * 0.8);
    vertices.push({
      lat: center.lat + Math.sin(angle) * radius,
      lon: center.lon + Math.cos(angle) * radius,
    });
  }
  return vertices;
}
