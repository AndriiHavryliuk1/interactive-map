import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SignalStore } from './signal-store';

const NOW = 1_700_000_000_000;

class MockWorker {
  postMessage = vi.fn();
  terminate = vi.fn();
  onmessage: ((ev: MessageEvent) => any) | null = null;
  onerror: ((ev: ErrorEvent) => any) | null = null;

  simulateMessage(data: any) {
    if (this.onmessage) {
      this.onmessage({ data } as MessageEvent);
    }
  }
}

let networkWorkerMock: MockWorker;
let dbWorkerMock: MockWorker;
let workerConstructorCount = 0;

// SignalStore constructs networkWorker first, then dbWorker. After bundling,
// the resolved Worker URL no longer contains the original filename, so we
// can't disambiguate by URL — distinguish by construction order instead.
vi.stubGlobal(
  'Worker',
  class {
    constructor(public url: URL) {
      const mock = workerConstructorCount === 0 ? networkWorkerMock : dbWorkerMock;
      workerConstructorCount++;
      return mock as any;
    }
  },
);

function makeFrame(extras: Record<string, unknown> = {}) {
  return {
    mode: 'live',
    cursor: NOW,
    now: NOW,
    addedSignals: [],
    removedSignalIds: [],
    burstAtCursor: [],
    ...extras,
  };
}

function setUpStore(): SignalStore {
  TestBed.configureTestingModule({
    providers: [provideZonelessChangeDetection(), SignalStore],
  });
  return TestBed.inject(SignalStore);
}

describe('SignalStore', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
    networkWorkerMock = new MockWorker();
    dbWorkerMock = new MockWorker();
    workerConstructorCount = 0;
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    vi.useRealTimers();
  });

  describe('initialization', () => {
    it('creates workers and exchanges ports', () => {
      setUpStore();
      expect(workerConstructorCount).toBe(2);
      expect(networkWorkerMock.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'INIT_PORTS' }),
        expect.any(Array),
      );
      expect(dbWorkerMock.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'INIT_PORTS' }),
        expect.any(Array),
      );
    });
  });

  describe('state updates from worker', () => {
    it('updates signals when the worker sends a FRAME', () => {
      const store = setUpStore();
      const signal = { id: '1', timestamp: NOW, frequency: 100, point: { lat: 0, lon: 0 }, zone: [] };
      const frame = makeFrame({
        addedSignals: [signal],
        burstAtCursor: [signal],
      });

      dbWorkerMock.simulateMessage({ type: 'FRAME', payload: frame });

      expect(store.mode()).toBe('live');
      expect(store.cursor()).toBe(NOW);
      expect(store.visibleSignals()).toHaveLength(1);
      expect(store.burstAtCursor()).toHaveLength(1);
    });
  });

  describe('command forwarding', () => {
    // Commands are pure forwarders — the store does not write _mode or
    // _cursor locally. The worker is the single source of truth and echoes
    // the resulting state on the next FRAME (which it emits synchronously
    // after handling each command).

    it('forwards play() to the worker without touching local state', () => {
      const store = setUpStore();
      store.play();
      expect(dbWorkerMock.postMessage).toHaveBeenCalledWith({ type: 'PLAY' });
      expect(store.mode()).toBe('live'); // still the initial mode
    });

    it('forwards pause() to the worker without touching local state', () => {
      const store = setUpStore();
      store.pause();
      expect(dbWorkerMock.postMessage).toHaveBeenCalledWith({ type: 'PAUSE' });
      expect(store.mode()).toBe('live');
    });

    it('forwards goLive() to the worker without touching local state', () => {
      const store = setUpStore();
      store.goLive();
      expect(dbWorkerMock.postMessage).toHaveBeenCalledWith({ type: 'GO_LIVE' });
    });

    it('forwards seekTo() raw — clamping happens in the worker', () => {
      const store = setUpStore();
      store.seekTo(NOW + 60_000); // future timestamp
      expect(dbWorkerMock.postMessage).toHaveBeenCalledWith({
        type: 'SEEK',
        timestamp: NOW + 60_000,
      });
      expect(store.cursor()).toBe(NOW); // still the initial cursor
    });

    it('reflects worker mode/cursor after the FRAME comes back', () => {
      const store = setUpStore();
      store.pause();
      dbWorkerMock.simulateMessage({
        type: 'FRAME',
        payload: makeFrame({ mode: 'paused', cursor: NOW - 1000 }),
      });
      expect(store.mode()).toBe('paused');
      expect(store.cursor()).toBe(NOW - 1000);
    });
  });

  describe('cleanup', () => {
    it('disposes workers on destroy', () => {
      const store = setUpStore();
      store.ngOnDestroy();
      expect(dbWorkerMock.postMessage).toHaveBeenCalledWith({ type: 'DISPOSE' });
      expect(networkWorkerMock.postMessage).toHaveBeenCalledWith({ type: 'DISPOSE' });

      vi.advanceTimersByTime(100);
      expect(dbWorkerMock.terminate).toHaveBeenCalled();
      expect(networkWorkerMock.terminate).toHaveBeenCalled();
    });
  });
});
