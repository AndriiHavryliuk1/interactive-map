/// <reference lib="webworker" />

import { DEFAULT_WS_URL, INITIAL_RECONNECT_DELAY_MS, MAX_RECONNECT_DELAY_MS } from '../gateway/gateway.constants';
import { SignalMessage } from '../../shared/models/signal.model';

let dbPort: MessagePort | null = null;
let socket: WebSocket | null = null;
let reconnectAttempt = 0;
let reconnectHandle: ReturnType<typeof setTimeout> | null = null;

addEventListener('message', (event: MessageEvent) => {
  if (event.data?.type === 'INIT_PORTS' && event.ports.length > 0) {
    dbPort = event.ports[0];
    connect();
  }
});

function connect(): void {
  if (socket) {
    socket.close();
  }
  
  socket = new WebSocket(DEFAULT_WS_URL);

  socket.addEventListener('open', () => {
    reconnectAttempt = 0;
  });

  socket.addEventListener('message', (event) => {
    try {
      const msg = JSON.parse(event.data) as SignalMessage;
      if (dbPort) {
        dbPort.postMessage({ type: 'NEW_SIGNAL', payload: msg });
      }
    } catch {
      // drop malformed
    }
  });

  socket.addEventListener('close', () => scheduleReconnect());
}

function scheduleReconnect(): void {
  const delay = Math.min(
    MAX_RECONNECT_DELAY_MS,
    INITIAL_RECONNECT_DELAY_MS * 2 ** reconnectAttempt
  );
  reconnectAttempt++;
  if (reconnectHandle) clearTimeout(reconnectHandle);
  reconnectHandle = setTimeout(() => connect(), delay);
}
