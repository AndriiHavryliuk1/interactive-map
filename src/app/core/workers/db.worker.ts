/// <reference lib="webworker" />

import { initDB, saveSignals, getSignalsInRange } from '../db/indexed-db.util';
import { SignalMessage, RadarSignal } from '../../shared/models/signal.model';
import { StateFrame, ControlCommand } from '../../shared/models/worker.model';
import { PLAYBACK_TICK_MS, SIGNAL_VISIBLE_DURATION_MS } from '../../shared/constants/time.constants';
import { PlaybackMode } from '../../shared/models/playback.model';

let db: IDBDatabase | null = null;
let networkPort: MessagePort | null = null;
let dbReady = false;
let disposed = false;

// State Machine
let mode: PlaybackMode = 'live';
let cursorOverride: number | null = null;
let clockHandle: ReturnType<typeof setInterval> | null = null;
let batchHandle: ReturnType<typeof setInterval> | null = null;

// Batching buffer
let buffer: RadarSignal[] = [];
const BATCH_INTERVAL_MS = 100;
let nextSignalSequence = 0;

initDB().then(database => {
  db = database;
  dbReady = true;
  startEngine();
  startBatchWriter();
});

addEventListener('message', (event: MessageEvent<ControlCommand>) => {
  const command = event.data;
  if (command.type === 'INIT_PORTS' && event.ports.length > 0) {
    networkPort = event.ports[0];
    networkPort.onmessage = (e) => handleNetworkMessage(e.data);
  } else if (command.type === 'DISPOSE') {
    disposed = true;
    cleanup();
  } else if (command.type === 'PLAY') {
    if (mode === 'live') cursorOverride = Date.now();
    mode = 'playing';
  } else if (command.type === 'PAUSE') {
    if (mode === 'live') cursorOverride = Date.now();
    mode = 'paused';
  } else if (command.type === 'GO_LIVE') {
    cursorOverride = null;
    mode = 'live';
  } else if (command.type === 'SEEK') {
    cursorOverride = command.timestamp;
    if (mode === 'live') mode = 'paused';
  }
});

function cleanup(): void {
  if (clockHandle) {
    clearInterval(clockHandle);
    clockHandle = null;
  }
  if (batchHandle) {
    clearInterval(batchHandle);
    batchHandle = null;
  }
  if (db) {
    db.close();
    db = null;
  }
  if (networkPort) {
    networkPort.close();
    networkPort = null;
  }
}

function handleNetworkMessage(data: any): void {
  if (disposed) return;
  if (data.type === 'NEW_SIGNAL') {
    const msg = data.payload as SignalMessage;
    const signal: RadarSignal = {
      id: `${msg.timestamp}-${nextSignalSequence++}`,
      timestamp: msg.timestamp,
      frequency: msg.frequency,
      point: msg.point,
      zone: msg.zone,
    };
    buffer.push(signal);
  }
}

function startBatchWriter(): void {
  batchHandle = setInterval(() => {
    if (buffer.length > 0 && dbReady && db) {
      const toSave = [...buffer];
      buffer = [];
      saveSignals(db, toSave).catch(err => console.error('DB Save error', err));
    }
  }, BATCH_INTERVAL_MS);
}

let lastVisibleIds = new Set<string>();

function startEngine(): void {
  clockHandle = setInterval(async () => {
    if (!dbReady || !db) return;

    let now = Date.now();
    if (mode === 'playing') {
      const next = (cursorOverride ?? now) + PLAYBACK_TICK_MS;
      if (next >= now) {
         mode = 'live';
         cursorOverride = null;
      } else {
         cursorOverride = next;
      }
    }
    
    const cursor = (mode === 'live' || cursorOverride === null) ? Date.now() : cursorOverride;
    
    const windowStart = cursor - SIGNAL_VISIBLE_DURATION_MS;
    const windowEnd = cursor + SIGNAL_VISIBLE_DURATION_MS; // Grab a bit ahead to find burst
    
    try {
      const signals = await getSignalsInRange(db, windowStart, windowEnd);
      
      const visibleSignals = signals.filter(s => s.timestamp >= cursor - SIGNAL_VISIBLE_DURATION_MS && s.timestamp <= cursor);
      
      const currentIds = new Set(visibleSignals.map(s => s.id));
      const addedSignals = visibleSignals.filter(s => !lastVisibleIds.has(s.id));
      const removedSignalIds = Array.from(lastVisibleIds).filter(id => !currentIds.has(id));
      
      lastVisibleIds = currentIds;

      // Calculate burst (simplified for worker: exact timestamp match of closest)
      let burstAtCursor: RadarSignal[] = [];
      if (signals.length > 0) {
          // Find closest
          let closest = signals[0];
          let minDiff = Math.abs(signals[0].timestamp - cursor);
          for(let i=1; i<signals.length; i++) {
              const diff = Math.abs(signals[i].timestamp - cursor);
              if (diff < minDiff) {
                  minDiff = diff;
                  closest = signals[i];
              }
          }
          if (minDiff <= SIGNAL_VISIBLE_DURATION_MS) {
              burstAtCursor = signals.filter(s => s.timestamp === closest.timestamp);
          }
      }

      const frame: StateFrame = {
        mode,
        cursor,
        now,
        visibleSignals,
        addedSignals,
        removedSignalIds,
        burstAtCursor
      };
      
      postMessage({ type: 'FRAME', payload: frame });
    } catch (e) {
      console.error('Frame gen error', e);
    }

  }, PLAYBACK_TICK_MS);
}
