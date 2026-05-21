import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  INITIAL_RECONNECT_DELAY_MS,
  MAX_RECONNECT_DELAY_MS,
} from './gateway.constants';
import { SignalMessage } from '../../shared/models/signal.model';
import { WebSocketSignalGateway } from './websocket-signal.gateway';

type Listener = (event: unknown) => void;

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  static readonly OPEN = 1;
  static readonly CLOSED = 3;

  readonly url: string;
  readyState = 0;
  private readonly listeners = new Map<string, Listener>();

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  addEventListener(event: string, cb: Listener): void {
    this.listeners.set(event, cb);
  }

  close(): void {
    this.readyState = MockWebSocket.CLOSED;
    this.listeners.get('close')?.({});
  }

  open(): void {
    this.readyState = MockWebSocket.OPEN;
    this.listeners.get('open')?.({});
  }

  receive(data: string): void {
    this.listeners.get('message')?.({ data });
  }

  fail(): void {
    this.listeners.get('error')?.({});
    this.close();
  }
}

const validFrame: SignalMessage = {
  timestamp: 1_700_000_000_000,
  frequency: 460,
  point: { lat: 50, lon: 30 },
  zone: [{ lat: 50.01, lon: 30.01 }],
};

function createGateway(): WebSocketSignalGateway {
  TestBed.configureTestingModule({
    providers: [provideZonelessChangeDetection()],
  });
  return TestBed.inject(WebSocketSignalGateway);
}

describe('WebSocketSignalGateway', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    MockWebSocket.instances = [];
    vi.stubGlobal('WebSocket', MockWebSocket);
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('opens a single WebSocket connection on construction', () => {
    createGateway();
    expect(MockWebSocket.instances).toHaveLength(1);
    expect(MockWebSocket.instances[0].url).toBe('ws://localhost:8080');
  });

  it('exposes a 12-hour historical back-fill', () => {
    const gateway = createGateway();
    expect(gateway.historicalSignals.length).toBeGreaterThan(0);
    expect(gateway.historicalSignals.every((s) => typeof s.timestamp === 'number')).toBe(true);
  });

  it('forwards a valid frame from the socket to liveSignals$', () => {
    const gateway = createGateway();
    const received: SignalMessage[] = [];
    gateway.liveSignals$.subscribe((m) => received.push(m));

    MockWebSocket.instances[0].open();
    MockWebSocket.instances[0].receive(JSON.stringify(validFrame));

    expect(received).toEqual([validFrame]);
  });

  it('silently drops a malformed JSON frame', () => {
    const gateway = createGateway();
    const received: SignalMessage[] = [];
    gateway.liveSignals$.subscribe((m) => received.push(m));

    MockWebSocket.instances[0].open();
    MockWebSocket.instances[0].receive('{ this is not json');
    MockWebSocket.instances[0].receive(JSON.stringify(validFrame));

    // Stream stays alive; the next valid frame goes through.
    expect(received).toEqual([validFrame]);
  });

  it('reconnects after a close with the initial backoff delay', () => {
    createGateway();
    expect(MockWebSocket.instances).toHaveLength(1);

    MockWebSocket.instances[0].close();
    expect(MockWebSocket.instances).toHaveLength(1); // not yet — backoff pending

    vi.advanceTimersByTime(INITIAL_RECONNECT_DELAY_MS);
    expect(MockWebSocket.instances).toHaveLength(2);
  });

  it('caps the reconnect delay at MAX_RECONNECT_DELAY_MS', () => {
    createGateway();

    // Hammer many failures in a row — by the time backoff is doubled past
    // the cap, advancing exactly MAX_RECONNECT_DELAY_MS must still trigger
    // the next reconnect attempt.
    for (let i = 0; i < 10; i++) {
      MockWebSocket.instances[MockWebSocket.instances.length - 1].close();
      vi.advanceTimersByTime(MAX_RECONNECT_DELAY_MS);
    }

    expect(MockWebSocket.instances.length).toBeGreaterThanOrEqual(10);
  });

  it('resets the backoff after a successful open', () => {
    createGateway();

    MockWebSocket.instances[0].close();
    vi.advanceTimersByTime(INITIAL_RECONNECT_DELAY_MS);
    expect(MockWebSocket.instances).toHaveLength(2);

    MockWebSocket.instances[1].close();
    vi.advanceTimersByTime(INITIAL_RECONNECT_DELAY_MS * 2);
    expect(MockWebSocket.instances).toHaveLength(3);

    MockWebSocket.instances[2].open(); // success — backoff resets
    MockWebSocket.instances[2].close();
    vi.advanceTimersByTime(INITIAL_RECONNECT_DELAY_MS); // initial again
    expect(MockWebSocket.instances).toHaveLength(4);
  });

  it('stops reconnecting after destroy', () => {
    const gateway = createGateway();
    gateway.ngOnDestroy();

    MockWebSocket.instances[0].close();
    vi.advanceTimersByTime(MAX_RECONNECT_DELAY_MS * 2);

    expect(MockWebSocket.instances).toHaveLength(1);
  });
});
