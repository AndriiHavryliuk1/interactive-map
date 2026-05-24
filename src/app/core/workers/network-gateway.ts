import {
  DEFAULT_WS_URL,
  INITIAL_RECONNECT_DELAY_MS,
  MAX_RECONNECT_DELAY_MS,
} from '../constants/gateway.constants';
import { LogSource } from '../../shared/constants/log-source.constant';
import { Logger } from '../../shared/utils/logger';
import { SignalMessage } from '../../shared/models/signal.model';

import {
  ChannelMessageType,
  RECONNECT_BACKOFF_BASE,
} from '../../shared/constants/worker.constants';

type TimeoutHandle = ReturnType<typeof setTimeout>;

export interface NetworkGatewayDeps {
  url?: string;
  logger?: Logger;
  socketFactory?: (url: string) => WebSocket;
}

/**
 * Owns the WebSocket connection. Forwards parsed SignalMessage payloads
 * to a peer port (the DB worker). Implements exponential-backoff reconnect.
 */
export class NetworkGateway {
  private readonly url: string;
  private readonly logger: Logger;
  private readonly socketFactory: (url: string) => WebSocket;

  private dbPort: MessagePort | null = null;
  private socket: WebSocket | null = null;
  private reconnectAttempt = 0;
  private reconnectHandle: TimeoutHandle | null = null;
  private disposed = false;

  constructor(deps: NetworkGatewayDeps = {}) {
    this.url = deps.url ?? DEFAULT_WS_URL;
    this.logger = deps.logger ?? new Logger(LogSource.NetworkGateway);
    this.socketFactory = deps.socketFactory ?? ((u) => new WebSocket(u));
  }

  attachPort(port: MessagePort): void {
    if (this.disposed) {
      return;
    }
    this.dbPort = port;
    this.connect();
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.cleanupSocket();
    if (this.dbPort !== null) {
      this.dbPort.close();
      this.dbPort = null;
    }
  }

  private connect(): void {
    if (this.disposed) {
      return;
    }
    this.cleanupSocket();

    const socket = this.socketFactory(this.url);
    this.socket = socket;

    socket.onopen = () => {
      if (this.socket !== socket) {
        return;
      }
      this.reconnectAttempt = 0;
      this.logger.info('WebSocket connected');
    };

    socket.onmessage = (event) => {
      if (this.socket !== socket) {
        return;
      }
      this.forwardMessage(event.data);
    };

    socket.onclose = () => {
      if (this.socket !== socket) {
        return;
      }
      if (!this.disposed) {
        this.scheduleReconnect();
      }
    };

    socket.onerror = () => {
      if (this.socket !== socket) {
        return;
      }
      this.logger.warn('WebSocket error — reconnect will follow close');
    };
  }

  private forwardMessage(raw: unknown): void {
    if (this.dbPort === null) {
      return;
    }
    if (typeof raw !== 'string') {
      return;
    }
    let parsed: SignalMessage;
    try {
      parsed = JSON.parse(raw) as SignalMessage;
    } catch {
      this.logger.warn('Dropped malformed WS payload');
      return;
    }
    this.dbPort.postMessage({
      type: ChannelMessageType.NewSignal,
      payload: parsed,
    });
  }

  private scheduleReconnect(): void {
    if (this.disposed) {
      return;
    }
    const delay = Math.min(
      MAX_RECONNECT_DELAY_MS,
      INITIAL_RECONNECT_DELAY_MS * RECONNECT_BACKOFF_BASE ** this.reconnectAttempt,
    );
    this.reconnectAttempt++;
    if (this.reconnectHandle !== null) {
      clearTimeout(this.reconnectHandle);
    }
    this.reconnectHandle = setTimeout(() => this.connect(), delay);
  }

  private cleanupSocket(): void {
    if (this.reconnectHandle !== null) {
      clearTimeout(this.reconnectHandle);
      this.reconnectHandle = null;
    }
    if (this.socket !== null) {
      const old = this.socket;
      this.socket = null;
      old.onopen = null;
      old.onmessage = null;
      old.onerror = null;
      old.onclose = null;
      old.close();
    }
  }
}
