import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { INITIAL_RECONNECT_DELAY_MS, MAX_RECONNECT_DELAY_MS } from '../constants/gateway.constants';
import { ChannelMessageType } from '../../shared/constants/worker.constants';
import { NetworkGateway } from './network-gateway';

type Handler<E> = ((e: E) => void) | null;

class FakeSocket {
  static readonly OPEN = 1;
  static readonly CLOSED = 3;

  onopen: Handler<Event> = null;
  onmessage: Handler<MessageEvent<string>> = null;
  onclose: Handler<CloseEvent> = null;
  onerror: Handler<Event> = null;
  closed = false;

  constructor(public readonly url: string) {}

  close(): void {
    this.closed = true;
  }

  emitOpen(): void {
    this.onopen?.(new Event('open'));
  }
  emitMessage(data: string): void {
    this.onmessage?.({ data } as MessageEvent<string>);
  }
  emitClose(): void {
    this.onclose?.(new CloseEvent('close'));
  }
  emitError(): void {
    this.onerror?.(new Event('error'));
  }
}

class FakePort {
  posted: unknown[] = [];
  closed = false;
  postMessage(msg: unknown): void {
    this.posted.push(msg);
  }
  close(): void {
    this.closed = true;
  }
}

function makeGateway(opts: { url?: string } = {}) {
  const sockets: FakeSocket[] = [];
  const factory = (url: string): WebSocket => {
    const s = new FakeSocket(url);
    sockets.push(s);
    return s as unknown as WebSocket;
  };
  const gateway = new NetworkGateway({
    url: opts.url ?? 'ws://test.invalid:9999',
    socketFactory: factory,
  });
  return { gateway, sockets };
}

describe('NetworkGateway', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('attachPort', () => {
    it('opens a WebSocket to the configured URL', () => {
      const { gateway, sockets } = makeGateway({ url: 'ws://example:1234' });
      gateway.attachPort(new FakePort() as unknown as MessagePort);
      expect(sockets).toHaveLength(1);
      expect(sockets[0].url).toBe('ws://example:1234');
    });

    it('does nothing once disposed', () => {
      const { gateway, sockets } = makeGateway();
      gateway.dispose();
      gateway.attachPort(new FakePort() as unknown as MessagePort);
      expect(sockets).toHaveLength(0);
    });
  });

  describe('onmessage forwarding', () => {
    it('parses JSON and forwards a NEW_SIGNAL envelope to the port', () => {
      const { gateway, sockets } = makeGateway();
      const port = new FakePort();
      gateway.attachPort(port as unknown as MessagePort);

      const payload = { timestamp: 1, frequency: 100, point: { lat: 0, lon: 0 }, zone: [] };
      sockets[0].emitMessage(JSON.stringify(payload));

      expect(port.posted).toEqual([{ type: ChannelMessageType.NewSignal, payload }]);
    });

    it('drops malformed JSON silently (next valid frame still forwards)', () => {
      const { gateway, sockets } = makeGateway();
      const port = new FakePort();
      gateway.attachPort(port as unknown as MessagePort);

      sockets[0].emitMessage('{ not json');
      const payload = { timestamp: 1, frequency: 100, point: { lat: 0, lon: 0 }, zone: [] };
      sockets[0].emitMessage(JSON.stringify(payload));

      expect(port.posted).toHaveLength(1);
      expect(port.posted[0]).toMatchObject({ type: ChannelMessageType.NewSignal });
    });

    it('does not crash if dbPort is absent (defensive)', () => {
      const { gateway, sockets } = makeGateway();
      // Trigger a connect by attaching, then dispose to clear dbPort,
      // and emit a message on the stale socket — should no-op.
      const port = new FakePort();
      gateway.attachPort(port as unknown as MessagePort);
      gateway.dispose();
      expect(() =>
        sockets[0].emitMessage('{"timestamp":1,"frequency":1,"point":{"lat":0,"lon":0},"zone":[]}'),
      ).not.toThrow();
    });
  });

  describe('reconnect backoff', () => {
    it('opens a new socket after INITIAL_RECONNECT_DELAY_MS on close', () => {
      const { gateway, sockets } = makeGateway();
      gateway.attachPort(new FakePort() as unknown as MessagePort);
      sockets[0].emitClose();

      // Before the delay elapses, no new socket.
      vi.advanceTimersByTime(INITIAL_RECONNECT_DELAY_MS - 1);
      expect(sockets).toHaveLength(1);

      vi.advanceTimersByTime(1);
      expect(sockets).toHaveLength(2);
    });

    it('doubles the delay between attempts (exponential backoff)', () => {
      const { gateway, sockets } = makeGateway();
      gateway.attachPort(new FakePort() as unknown as MessagePort);

      sockets[0].emitClose();
      vi.advanceTimersByTime(INITIAL_RECONNECT_DELAY_MS);
      expect(sockets).toHaveLength(2);

      sockets[1].emitClose();
      vi.advanceTimersByTime(INITIAL_RECONNECT_DELAY_MS * 2);
      expect(sockets).toHaveLength(3);

      sockets[2].emitClose();
      vi.advanceTimersByTime(INITIAL_RECONNECT_DELAY_MS * 4);
      expect(sockets).toHaveLength(4);
    });

    it('caps the delay at MAX_RECONNECT_DELAY_MS', () => {
      const { gateway, sockets } = makeGateway();
      gateway.attachPort(new FakePort() as unknown as MessagePort);

      // Drive enough failures that doubled delay exceeds the cap.
      for (let i = 0; i < 10; i++) {
        sockets[sockets.length - 1].emitClose();
        vi.advanceTimersByTime(MAX_RECONNECT_DELAY_MS);
      }
      expect(sockets.length).toBeGreaterThanOrEqual(10);
    });

    it('resets the backoff after a successful onopen', () => {
      const { gateway, sockets } = makeGateway();
      gateway.attachPort(new FakePort() as unknown as MessagePort);

      sockets[0].emitClose();
      vi.advanceTimersByTime(INITIAL_RECONNECT_DELAY_MS);
      expect(sockets).toHaveLength(2);

      sockets[1].emitOpen(); // success → backoff resets
      sockets[1].emitClose();
      vi.advanceTimersByTime(INITIAL_RECONNECT_DELAY_MS);
      expect(sockets).toHaveLength(3);
    });
  });

  describe('socket-replaced guards', () => {
    it('ignores messages from a superseded socket', () => {
      const { gateway, sockets } = makeGateway();
      const port = new FakePort();
      gateway.attachPort(port as unknown as MessagePort);

      // Force a reconnect — sockets[0] is now superseded.
      sockets[0].emitClose();
      vi.advanceTimersByTime(INITIAL_RECONNECT_DELAY_MS);
      expect(sockets).toHaveLength(2);

      // The cleanup pass nulls out the old socket's onmessage; sanity-check
      // that emitting on the old socket no longer forwards.
      sockets[0].emitMessage(
        JSON.stringify({ timestamp: 1, frequency: 1, point: { lat: 0, lon: 0 }, zone: [] }),
      );
      expect(port.posted).toHaveLength(0);

      // The new socket forwards normally.
      sockets[1].emitMessage(
        JSON.stringify({ timestamp: 2, frequency: 2, point: { lat: 0, lon: 0 }, zone: [] }),
      );
      expect(port.posted).toHaveLength(1);
    });
  });

  describe('dispose', () => {
    it('closes the active socket and the port, and stops reconnecting', () => {
      const { gateway, sockets } = makeGateway();
      const port = new FakePort();
      gateway.attachPort(port as unknown as MessagePort);

      gateway.dispose();

      expect(sockets[0].closed).toBe(true);
      expect(port.closed).toBe(true);

      // A close event after dispose should not schedule another connect.
      sockets[0].emitClose();
      vi.advanceTimersByTime(MAX_RECONNECT_DELAY_MS * 2);
      expect(sockets).toHaveLength(1);
    });

    it('is idempotent', () => {
      const { gateway } = makeGateway();
      gateway.attachPort(new FakePort() as unknown as MessagePort);
      gateway.dispose();
      expect(() => gateway.dispose()).not.toThrow();
    });
  });
});
