import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SIGNAL_GATEWAY, SignalGateway } from '../gateway/signal-gateway';
import {
  HISTORY_WINDOW_MS,
  PLAYBACK_TICK_MS,
  SIGNAL_VISIBLE_DURATION_MS,
} from '../../shared/constants/time.constants';
import { SignalMessage } from '../../shared/models/signal.model';
import { SignalStore } from './signal-store';

const NOW = 1_700_000_000_000;

function frame(timestamp: number, frequency = 100, zoneSize = 0): SignalMessage {
  return {
    timestamp,
    frequency,
    point: { lat: 50, lon: 30 },
    zone: Array.from({ length: zoneSize }, (_, i) => ({ lat: 50 + i * 0.001, lon: 30 })),
  };
}

class FakeGateway implements SignalGateway {
  readonly liveSubject = new Subject<SignalMessage>();
  readonly liveSignals$ = this.liveSubject.asObservable();
  constructor(public historicalSignals: SignalMessage[] = []) {}
}

function setUpStore(historical: SignalMessage[] = []): {
  store: SignalStore;
  gateway: FakeGateway;
} {
  const gateway = new FakeGateway(historical);
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      { provide: SIGNAL_GATEWAY, useValue: gateway },
    ],
  });
  return { store: TestBed.inject(SignalStore), gateway };
}

const flushEffects = () => Promise.resolve();

describe('SignalStore', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    vi.useRealTimers();
  });

  describe('initial state', () => {
    it('starts in live mode', () => {
      const { store } = setUpStore();
      expect(store.mode()).toBe('live');
    });

    it('cursor equals the current wall clock', () => {
      const { store } = setUpStore();
      expect(store.cursor()).toBe(NOW);
    });

    it('window covers the last 12 hours', () => {
      const { store } = setUpStore();
      expect(store.windowStart()).toBe(NOW - HISTORY_WINDOW_MS);
      expect(store.windowEnd()).toBe(NOW);
    });

    it('exposes empty queries when there are no signals', () => {
      const { store } = setUpStore();
      expect(store.visibleSignals()).toEqual([]);
      expect(store.burstAtCursor()).toEqual([]);
    });
  });

  describe('history ingestion', () => {
    it('seeds the store with signals from the gateway', () => {
      const { store } = setUpStore([
        frame(NOW - 20_000),
        frame(NOW - 10_000),
        frame(NOW - 1_000),
      ]);
      // visibleSignals only includes those inside the trailing 30 s window.
      expect(store.visibleSignals()).toHaveLength(3);
    });

    it('sorts unordered history by timestamp ascending', () => {
      const { store } = setUpStore([
        frame(NOW - 1_000, 101),
        frame(NOW - 20_000, 102),
        frame(NOW - 10_000, 103),
      ]);
      const ordered = store.visibleSignals().map((s) => s.timestamp);
      expect(ordered).toEqual([NOW - 20_000, NOW - 10_000, NOW - 1_000]);
    });
  });

  describe('mode transitions', () => {
    it('play() is a no-op while in live mode', () => {
      const { store } = setUpStore();
      store.play();
      expect(store.mode()).toBe('live');
    });

    it('pause() from live captures wall clock as the cursor override', () => {
      const { store } = setUpStore();
      store.pause();
      expect(store.mode()).toBe('paused');
      expect(store.cursor()).toBe(NOW);

      // Advance wall clock; cursor must stay frozen.
      vi.setSystemTime(new Date(NOW + 5_000));
      vi.advanceTimersByTime(1_000);
      expect(store.cursor()).toBe(NOW);
    });

    it('play() after pause sets mode to playing while preserving the cursor', () => {
      const { store } = setUpStore();
      store.pause();
      const paused = store.cursor();
      store.play();
      expect(store.mode()).toBe('playing');
      expect(store.cursor()).toBe(paused);
    });

    it('goLive() clears the override and snaps the cursor back to "now"', () => {
      const { store } = setUpStore();
      store.seekTo(NOW - 60_000);
      expect(store.cursor()).toBe(NOW - 60_000);

      store.goLive();
      expect(store.mode()).toBe('live');
      expect(store.cursor()).toBe(NOW);
    });

    it('pause() from playing keeps the cursor where it is', () => {
      const { store } = setUpStore();
      store.seekTo(NOW - 30_000);
      store.play();
      expect(store.mode()).toBe('playing');

      store.pause();
      expect(store.mode()).toBe('paused');
      expect(store.cursor()).toBe(NOW - 30_000);
    });
  });

  describe('seekTo', () => {
    it('clamps a target above the current wall clock to windowEnd', () => {
      const { store } = setUpStore();
      store.seekTo(NOW + 60_000);
      expect(store.cursor()).toBe(NOW);
    });

    it('clamps a target below the earliest window to windowStart', () => {
      const { store } = setUpStore();
      store.seekTo(NOW - HISTORY_WINDOW_MS - 60_000);
      expect(store.cursor()).toBe(NOW - HISTORY_WINDOW_MS);
    });

    it('switches from live to paused on first scrub', () => {
      const { store } = setUpStore();
      store.seekTo(NOW - 30_000);
      expect(store.mode()).toBe('paused');
    });

    it('keeps mode unchanged when seeking while already paused', () => {
      const { store } = setUpStore();
      store.pause();
      store.seekTo(NOW - 30_000);
      expect(store.mode()).toBe('paused');
    });

    it('keeps mode unchanged when seeking while playing', () => {
      const { store } = setUpStore();
      store.seekTo(NOW - 60_000);
      store.play();
      expect(store.mode()).toBe('playing');

      store.seekTo(NOW - 45_000);
      expect(store.mode()).toBe('playing');
      expect(store.cursor()).toBe(NOW - 45_000);
    });
  });

  describe('live signal ingestion', () => {
    it('forwards a frame from the gateway into visibleSignals', () => {
      const { store, gateway } = setUpStore();
      gateway.liveSubject.next(frame(NOW));
      expect(store.visibleSignals()).toHaveLength(1);
    });

    it('drops a frame older than HISTORY_WINDOW_MS at ingestion time', () => {
      const { store, gateway } = setUpStore();
      gateway.liveSubject.next(frame(NOW - HISTORY_WINDOW_MS - 1));
      expect(store.visibleSignals()).toHaveLength(0);
    });

    it('keeps frames sorted even when they arrive out of order', () => {
      const { store, gateway } = setUpStore([frame(NOW - 10_000)]);
      gateway.liveSubject.next(frame(NOW - 20_000));
      gateway.liveSubject.next(frame(NOW - 5_000));
      gateway.liveSubject.next(frame(NOW - 15_000));

      const order = store.visibleSignals().map((s) => s.timestamp);
      expect(order).toEqual([NOW - 20_000, NOW - 15_000, NOW - 10_000, NOW - 5_000]);
    });

    it('groups multiple frames sharing one timestamp as a burst', () => {
      const { store, gateway } = setUpStore();
      gateway.liveSubject.next(frame(NOW - 100, 144));
      gateway.liveSubject.next(frame(NOW - 100, 200));
      gateway.liveSubject.next(frame(NOW - 100, 500));

      const burst = store.burstAtCursor();
      expect(burst).toHaveLength(3);
      expect(new Set(burst.map((s) => s.frequency))).toEqual(new Set([144, 200, 500]));
    });
  });

  describe('visibleSignals', () => {
    it('includes signals within [cursor - 30s, cursor]', () => {
      const { store } = setUpStore([
        frame(NOW - SIGNAL_VISIBLE_DURATION_MS),
        frame(NOW - SIGNAL_VISIBLE_DURATION_MS / 2),
        frame(NOW),
      ]);
      expect(store.visibleSignals()).toHaveLength(3);
    });

    it('excludes signals older than the 30s trailing window', () => {
      const { store } = setUpStore([
        frame(NOW - SIGNAL_VISIBLE_DURATION_MS - 1),
        frame(NOW - 100),
      ]);
      expect(store.visibleSignals()).toHaveLength(1);
    });

    it('excludes signals that lie in the future of the cursor (scrub mode)', () => {
      const { store } = setUpStore([
        frame(NOW - 60_000), // past
        frame(NOW - 30_000), // past
        frame(NOW), // "future" relative to the paused cursor below
      ]);
      store.seekTo(NOW - 45_000);
      // Only the past signals within [cursor - 30s, cursor] should remain.
      const visible = store.visibleSignals();
      expect(visible).toHaveLength(1);
      expect(visible[0].timestamp).toBe(NOW - 60_000);
    });
  });

  describe('burstAtCursor', () => {
    it('returns the burst at the closest timestamp, not nearby ones', () => {
      const { store } = setUpStore([
        frame(NOW - 10_000, 100), // closer burst (one signal)
        frame(NOW - 10_500, 200), // 500 ms older — must NOT leak in
        frame(NOW - 9_800, 300), // 200 ms newer than closest — must NOT leak in
      ]);
      store.seekTo(NOW - 10_000);

      const burst = store.burstAtCursor();
      expect(burst).toHaveLength(1);
      expect(burst[0].frequency).toBe(100);
    });

    it('returns all signals sharing the closest timestamp', () => {
      const { store } = setUpStore([
        frame(NOW - 5_000, 144),
        frame(NOW - 5_000, 200),
        frame(NOW - 5_000, 500),
        frame(NOW - 5_500, 999), // adjacent, must not leak
      ]);
      store.seekTo(NOW - 5_000);

      const burst = store.burstAtCursor();
      expect(burst).toHaveLength(3);
      expect(new Set(burst.map((s) => s.frequency))).toEqual(new Set([144, 200, 500]));
    });

    it('picks the closer of [before-cursor, after-cursor] candidates', () => {
      const { store } = setUpStore([
        frame(NOW - 8_000, 100),
        frame(NOW - 2_000, 200),
      ]);
      store.seekTo(NOW - 3_000);
      // before = -8000 (5 s away), after = -2000 (1 s away). after wins.
      expect(store.burstAtCursor()[0].frequency).toBe(200);
    });

    it('prefers the past candidate on a tie (playback semantics)', () => {
      const { store } = setUpStore([
        frame(NOW - 10_000, 100),
        frame(NOW - 6_000, 200),
      ]);
      store.seekTo(NOW - 8_000);
      // Both candidates 2 s away from the cursor — the earlier one wins.
      expect(store.burstAtCursor()[0].frequency).toBe(100);
    });

    it('returns empty when the closest signal is further than 30s away', () => {
      const { store } = setUpStore([
        frame(NOW - SIGNAL_VISIBLE_DURATION_MS - 100, 100),
      ]);
      store.seekTo(NOW);
      expect(store.burstAtCursor()).toEqual([]);
    });

    it('returns the signal exactly at the 30s boundary (inclusive)', () => {
      const { store } = setUpStore([frame(NOW - SIGNAL_VISIBLE_DURATION_MS, 100)]);
      store.seekTo(NOW);
      expect(store.burstAtCursor()).toHaveLength(1);
    });

    it('returns empty when the store has no signals at all', () => {
      const { store } = setUpStore();
      expect(store.burstAtCursor()).toEqual([]);
    });
  });

  describe('playback timer', () => {
    it('advances the cursor by PLAYBACK_TICK_MS on each tick while playing', async () => {
      const { store } = setUpStore();
      store.seekTo(NOW - 60_000);
      store.play();
      await flushEffects();

      vi.advanceTimersByTime(PLAYBACK_TICK_MS);
      expect(store.cursor()).toBe(NOW - 60_000 + PLAYBACK_TICK_MS);

      vi.advanceTimersByTime(PLAYBACK_TICK_MS * 4);
      expect(store.cursor()).toBe(NOW - 60_000 + PLAYBACK_TICK_MS * 5);
    });

    it('auto-snaps to live once the cursor catches up to wall clock', async () => {
      const { store } = setUpStore();
      store.seekTo(NOW - PLAYBACK_TICK_MS);
      store.play();
      await flushEffects();

      // One tick should be enough to catch up to NOW.
      vi.advanceTimersByTime(PLAYBACK_TICK_MS);
      expect(store.mode()).toBe('live');
    });

    it('does not advance the cursor when not in playing mode', async () => {
      const { store } = setUpStore();
      store.seekTo(NOW - 60_000); // sets mode to paused
      await flushEffects();

      vi.advanceTimersByTime(PLAYBACK_TICK_MS * 10);
      expect(store.cursor()).toBe(NOW - 60_000);
    });
  });
});
