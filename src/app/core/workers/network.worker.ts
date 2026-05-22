/// <reference lib="webworker" />

import { DEFAULT_WS_URL, INITIAL_RECONNECT_DELAY_MS, MAX_RECONNECT_DELAY_MS } from '../gateway/gateway.constants';
import { SignalMessage } from '../../shared/models/signal.model';

let dbPort: MessagePort | null = null;
let socket: WebSocket | null = null;
let reconnectAttempt = 0;
let reconnectHandle: ReturnType<typeof setTimeout> | null = null;
let disposed = false;

addEventListener('message', (event: MessageEvent) => {
  if (event.data?.type === 'INIT_PORTS' && event.ports.length > 0) {
    dbPort = event.ports[0];
    connect();
  } else if (event.data?.type === 'DISPOSE') {
    disposed = true;
    shutdown();
  }
});

function shutdown(): void {
  cleanupSocket();
  if (dbPort) {
    dbPort.close();
    dbPort = null;
  }
}

function cleanupSocket(): void {
  if (reconnectHandle) {
    clearTimeout(reconnectHandle);
    reconnectHandle = null;
  }
  if (socket) {
    const oldSocket = socket;
    socket = null;
    oldSocket.onopen = null;
    oldSocket.onmessage = null;
    oldSocket.onerror = null;
    oldSocket.onclose = null;
    oldSocket.close();
  }
}

function connect(): void {
  if (disposed) return;
  cleanupSocket();
  
  const s = new WebSocket(DEFAULT_WS_URL);
  socket = s;

  s.onopen = () => {
    if (socket !== s) return;
    reconnectAttempt = 0;
  };

  s.onmessage = (event) => {
    if (socket !== s) return;
    try {
      const msg = JSON.parse(event.data) as SignalMessage;
      if (dbPort) {
        dbPort.postMessage({ type: 'NEW_SIGNAL', payload: msg });
      }
    } catch {
      // drop malformed
    }
  };

  s.onclose = () => {
    if (socket !== s) return;
    if (!disposed) {
      scheduleReconnect();
    }
  };
}

function scheduleReconnect(): void {
  if (disposed) return;
  
  const delay = Math.min(
    MAX_RECONNECT_DELAY_MS,
    INITIAL_RECONNECT_DELAY_MS * 2 ** reconnectAttempt
  );
  reconnectAttempt++;
  if (reconnectHandle) clearTimeout(reconnectHandle);
  reconnectHandle = setTimeout(() => connect(), delay);
}
