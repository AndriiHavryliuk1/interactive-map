import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  HISTORY_WINDOW_MS,
  PLAYBACK_TICK_MS,
} from '../../shared/constants/time.constants';
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

const networkWorkerMock = new MockWorker();
const dbWorkerMock = new MockWorker();

vi.stubGlobal('Worker', class {
  onmessage: any;
  onerror: any;
  constructor(public url: URL) {
    const mock = url.toString().includes('network.worker') ? networkWorkerMock : dbWorkerMock;
    return mock as any;
  }
});

function setUpStore(): SignalStore {
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      SignalStore,
    ],
  });
  return TestBed.inject(SignalStore);
}

describe('SignalStore', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
    vi.clearAllMocks();
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    vi.useRealTimers();
  });

  describe('initialization', () => {
    it('creates workers and exchanges ports', () => {
      const spy = vi.spyOn(window, 'Worker');
      setUpStore();
      expect(spy).toHaveBeenCalledTimes(2);
      expect(networkWorkerMock.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'INIT_PORTS' }),
        expect.any(Array)
      );
      expect(dbWorkerMock.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'INIT_PORTS' }),
        expect.any(Array)
      );
    });
  });

  describe('state updates from worker', () => {
    it('updates signals when the worker sends a FRAME', () => {
      const store = setUpStore();
      const frame = {
        mode: 'live',
        cursor: NOW,
        visibleSignals: [{ id: '1', timestamp: NOW, frequency: 100, point: { lat: 0, lon: 0 }, zone: [] }],
        burstAtCursor: [{ id: '1', timestamp: NOW, frequency: 100, point: { lat: 0, lon: 0 }, zone: [] }],
      };

      dbWorkerMock.simulateMessage({ type: 'FRAME', payload: frame });

      expect(store.mode()).toBe('live');
      expect(store.cursor()).toBe(NOW);
      expect(store.visibleSignals()).toHaveLength(1);
      expect(store.burstAtCursor()).toHaveLength(1);
    });
  });

  describe('command forwarding', () => {
    it('forwards play() to the worker', () => {
      const store = setUpStore();
      store.play();
      expect(dbWorkerMock.postMessage).toHaveBeenCalledWith({ type: 'PLAY' });
      expect(store.mode()).toBe('playing');
    });

    it('forwards pause() to the worker', () => {
      const store = setUpStore();
      store.pause();
      expect(dbWorkerMock.postMessage).toHaveBeenCalledWith({ type: 'PAUSE' });
      expect(store.mode()).toBe('paused');
    });

    it('forwards goLive() to the worker', () => {
      const store = setUpStore();
      store.goLive();
      expect(dbWorkerMock.postMessage).toHaveBeenCalledWith({ type: 'GO_LIVE' });
      expect(store.mode()).toBe('live');
    });

    it('forwards seekTo() to the worker', () => {
      const store = setUpStore();
      store.seekTo(NOW - 60_000);
      expect(dbWorkerMock.postMessage).toHaveBeenCalledWith({ type: 'SEEK', timestamp: NOW - 60_000 });
      expect(store.cursor()).toBe(NOW - 60_000);
      expect(store.mode()).toBe('paused');
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
