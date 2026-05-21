import { Injectable, OnDestroy } from '@angular/core';
import { Observable, Subject } from 'rxjs';

import {
  DEFAULT_WS_URL,
  INITIAL_RECONNECT_DELAY_MS,
  MAX_RECONNECT_DELAY_MS,
} from './gateway.constants';
import { generateRandomHistory } from './random-signal.factory';
import { SignalGateway } from './signal-gateway';
import { SignalMessage } from '../../shared/models/signal.model';

@Injectable({ providedIn: 'root' })
export class WebSocketSignalGateway implements SignalGateway, OnDestroy {
  private readonly url = DEFAULT_WS_URL;
  private readonly liveSubject = new Subject<SignalMessage>();
  private socket: WebSocket | null = null;
  private reconnectHandle: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private disposed = false;

  readonly liveSignals$: Observable<SignalMessage> = this.liveSubject.asObservable();
  // TODO: replace with a real REST history endpoint when a backend exists.
  readonly historicalSignals: readonly SignalMessage[] = generateRandomHistory();

  constructor() {
    this.connect();
  }

  ngOnDestroy(): void {
    this.disposed = true;
    if (this.reconnectHandle !== null) {
      clearTimeout(this.reconnectHandle);
    }
    this.socket?.close();
    this.liveSubject.complete();
  }

  private connect(): void {
    const socket = new WebSocket(this.url);
    this.socket = socket;

    socket.addEventListener('open', () => {
      this.reconnectAttempt = 0;
    });

    socket.addEventListener('message', (event) => this.handleFrame(event));

    // `close` fires after `error` for failed connections too, so one
    // reconnect path covers both transient drops and server-down startup.
    socket.addEventListener('close', () => {
      if (this.disposed) return;
      this.scheduleReconnect();
    });
  }

  private handleFrame(event: MessageEvent<string>): void {
    try {
      this.liveSubject.next(JSON.parse(event.data) as SignalMessage);
    } catch {
      // malformed frame — drop silently, the next one will be fine
    }
  }

  private scheduleReconnect(): void {
    const delay = Math.min(
      MAX_RECONNECT_DELAY_MS,
      INITIAL_RECONNECT_DELAY_MS * 2 ** this.reconnectAttempt,
    );
    this.reconnectAttempt++;
    this.reconnectHandle = setTimeout(() => this.connect(), delay);
  }
}
