import {
  computed,
  DestroyRef,
  effect,
  inject,
  Injectable,
  OnDestroy,
  Signal,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { SIGNAL_GATEWAY } from '../gateway/signal-gateway';
import {
  HISTORY_WINDOW_MS,
  ONE_SECOND_MS,
  PLAYBACK_TICK_MS,
  SIGNAL_VISIBLE_DURATION_MS,
} from '../../shared/constants/time.constants';
import { PlaybackMode } from '../../shared/models/playback.model';
import { RadarSignal, SignalMessage } from '../../shared/models/signal.model';
import { clamp, lowerBound } from '../../shared/utils/utils';

const byTimestamp = (s: RadarSignal) => s.timestamp;

@Injectable({ providedIn: 'root' })
export class SignalStore implements OnDestroy {
  private readonly _now = signal(Date.now());
  // Sorted ascending by `timestamp`. Insert position is found via binary
  // search so the array stays sorted even when frames arrive out of order.
  private readonly _signals = signal<readonly RadarSignal[]>([]);
  private readonly _mode = signal<PlaybackMode>('live');
  // null = follow wall clock (live mode invariant).
  private readonly _cursorOverride = signal<number | null>(null);

  private readonly clockHandle: ReturnType<typeof setInterval>;
  private nextSignalSequence = 0;

  readonly mode: Signal<PlaybackMode> = this._mode.asReadonly();
  readonly windowStart = computed(() => this._now() - HISTORY_WINDOW_MS);
  readonly windowEnd = computed(() => this._now());

  readonly cursor: Signal<number> = computed(() => {
    if (this._mode() === 'live') return this._now();
    const override = this._cursorOverride();
    if (override === null) return this._now();
    return clamp(override, this.windowStart(), this.windowEnd());
  });

  readonly visibleSignals: Signal<readonly RadarSignal[]> = computed(() => {
    const cursor = this.cursor();
    const earliest = cursor - SIGNAL_VISIBLE_DURATION_MS;
    const arr = this._signals();
    const startIdx = lowerBound(arr, byTimestamp, earliest);

    const visible: RadarSignal[] = [];
    for (let i = startIdx; i < arr.length && arr[i].timestamp <= cursor; i++) {
      visible.push(arr[i]);
    }
    return visible;
  });

  // All signals sharing the timestamp of whichever signal lives closest to
  // the cursor — strict equality on `timestamp` is what keeps the
  // "N одночасно" badge truthful (fuzzy windows leak neighbour ticks in).
  readonly burstAtCursor: Signal<readonly RadarSignal[]> = computed(() => {
    const cursor = this.cursor();
    const arr = this._signals();
    if (arr.length === 0) return [];

    const idx = lowerBound(arr, byTimestamp, cursor);
    let closestTimestamp: number | null = null;
    let minDistance = Infinity;

    if (idx > 0) {
      const before = arr[idx - 1];
      const distance = cursor - before.timestamp;
      if (distance <= SIGNAL_VISIBLE_DURATION_MS) {
        closestTimestamp = before.timestamp;
        minDistance = distance;
      }
    }
    if (idx < arr.length) {
      const after = arr[idx];
      const distance = after.timestamp - cursor;
      if (distance <= SIGNAL_VISIBLE_DURATION_MS && distance < minDistance) {
        closestTimestamp = after.timestamp;
      }
    }

    if (closestTimestamp === null) return [];

    const burstStart = lowerBound(arr, byTimestamp, closestTimestamp);
    const burst: RadarSignal[] = [];
    for (let i = burstStart; i < arr.length && arr[i].timestamp === closestTimestamp; i++) {
      burst.push(arr[i]);
    }
    return burst;
  });

  private readonly gateway = inject(SIGNAL_GATEWAY);
  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    this.ingestHistory();
    this.ingestLiveStream(this.destroyRef);

    this.clockHandle = setInterval(() => this._now.set(Date.now()), ONE_SECOND_MS);

    // Mode-scoped playback timer: only ticks while in 'playing', cleaned
    // up automatically by `effect` on every other mode transition.
    effect((onCleanup) => {
      if (this._mode() !== 'playing') return;
      const handle = setInterval(() => this.advancePlayingCursor(), PLAYBACK_TICK_MS);
      onCleanup(() => clearInterval(handle));
    });
  }

  ngOnDestroy(): void {
    clearInterval(this.clockHandle);
  }

  play(): void {
    if (this._mode() === 'live') return;
    if (this._cursorOverride() === null) {
      this._cursorOverride.set(this.cursor());
    }
    this._mode.set('playing');
  }

  pause(): void {
    if (this._mode() === 'live') {
      this._cursorOverride.set(this._now());
    }
    this._mode.set('paused');
  }

  goLive(): void {
    this._cursorOverride.set(null);
    this._mode.set('live');
  }

  seekTo(timestamp: number): void {
    this._cursorOverride.set(clamp(timestamp, this.windowStart(), this.windowEnd()));
    if (this._mode() === 'live') {
      this._mode.set('paused');
    }
  }

  private ingestHistory(): void {
    const seeded: RadarSignal[] = [];
    for (const message of this.gateway.historicalSignals) {
      seeded.push(this.toDomain(message));
    }
    seeded.sort((a, b) => a.timestamp - b.timestamp);
    this._signals.set(seeded);
  }

  private ingestLiveStream(destroyRef: DestroyRef): void {
    this.gateway.liveSignals$
      .pipe(takeUntilDestroyed(destroyRef))
      .subscribe((message) => this.appendSignal(message));
  }

  private appendSignal(message: SignalMessage): void {
    const incoming = this.toDomain(message);
    const earliestKept = this._now() - HISTORY_WINDOW_MS;
    if (incoming.timestamp < earliestKept) return;

    const current = this._signals();
    const cutoffIdx = lowerBound(current, byTimestamp, earliestKept);
    const insertAt = lowerBound(current, byTimestamp, incoming.timestamp);

    const next: RadarSignal[] = new Array(current.length - cutoffIdx + 1);
    let outIdx = 0;
    for (let i = cutoffIdx; i < insertAt; i++) next[outIdx++] = current[i];
    next[outIdx++] = incoming;
    for (let i = insertAt; i < current.length; i++) next[outIdx++] = current[i];
    this._signals.set(next);
  }

  private advancePlayingCursor(): void {
    const next = (this._cursorOverride() ?? this._now()) + PLAYBACK_TICK_MS;
    if (next >= this._now()) {
      this.goLive();
      return;
    }
    this._cursorOverride.set(next);
  }

  private toDomain(message: SignalMessage): RadarSignal {
    return {
      id: `${message.timestamp}-${this.nextSignalSequence++}`,
      timestamp: message.timestamp,
      frequency: message.frequency,
      point: message.point,
      zone: message.zone,
    };
  }
}

