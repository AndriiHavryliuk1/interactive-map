import { Provider } from '@angular/core';

import { SIGNAL_GATEWAY } from './signal-gateway';
import { WebSocketSignalGateway } from './websocket-signal.gateway';

export function provideWebSocketSignalGateway(): Provider[] {
  return [
    WebSocketSignalGateway,
    { provide: SIGNAL_GATEWAY, useExisting: WebSocketSignalGateway },
  ];
}
