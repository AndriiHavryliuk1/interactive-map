import {
  HISTORY_WINDOW_MS,
  PLAYBACK_TICK_MS,
  SIGNAL_VISIBLE_DURATION_MS,
} from '../../shared/constants/time.constants';
import { LogSource } from '../../shared/constants/log-source.constant';
import { Logger } from '../../shared/utils/logger';
import { PlaybackMode } from '../../shared/models/playback.model';
import { RadarSignal, SignalMessage } from '../../shared/models/signal.model';
import { DispatchableCommand, StateFrame } from '../../shared/models/worker.model';
import { SignalStorage } from '../interfaces/signal-storage.interface';
import { clamp } from '../../shared/utils/utils';

import {
  BATCH_WRITE_INTERVAL_MS,
  ControlMessageType,
} from '../../shared/constants/worker.constants';

type TimeoutHandle = ReturnType<typeof setTimeout>;

type CommandHandler = (command: DispatchableCommand) => void;

export interface PlaybackEngineDeps {
  repository: SignalStorage;
  postFrame: (frame: StateFrame) => void;
  logger?: Logger;
  now?: () => number;
}

/**
 * Owns playback state, the batch writer, and the per-tick delta computation.
 * Replaces the module-level variables that previously lived in db.worker.ts.
 */
export class PlaybackEngine {
  private readonly repository: SignalStorage;
  private readonly postFrame: (frame: StateFrame) => void;
  private readonly logger: Logger;
  private readonly now: () => number;

  private mode: PlaybackMode = 'live';
  private cursorOverride: number | null = null;

  // Both timers are self-rescheduling setTimeouts (not setInterval) so an
  // overrun in tick() / flushBuffer() can never overlap with the next firing.
  // setInterval would fire every PLAYBACK_TICK_MS regardless of whether the
  // previous async callback resolved, producing concurrent IDB reads,
  // out-of-order FRAME posts, and torn cursor/mode samples.
  private clockHandle: TimeoutHandle | null = null;
  private batchHandle: TimeoutHandle | null = null;

  private buffer: RadarSignal[] = [];
  private lastVisibleIds = new Set<string>();
  private disposed = false;

  // Promise chain that serializes emitFrame() calls. The scheduled tick and
  // the dispatch path both call emitFrame, and IDB readonly transactions
  // can complete in either order — without this chain, two in-flight calls
  // would race on lastVisibleIds and produce torn deltas.
  private framePromise: Promise<void> = Promise.resolve();

  private readonly commandHandlers: ReadonlyMap<DispatchableCommand['type'], CommandHandler>;

  constructor(deps: PlaybackEngineDeps) {
    this.repository = deps.repository;
    this.postFrame = deps.postFrame;
    this.logger = deps.logger ?? new Logger(LogSource.PlaybackEngine);
    this.now = deps.now ?? (() => Date.now());

    this.commandHandlers = new Map<DispatchableCommand['type'], CommandHandler>([
      [ControlMessageType.Play, () => this.handlePlay()],
      [ControlMessageType.Pause, () => this.handlePause()],
      [ControlMessageType.GoLive, () => this.handleGoLive()],
      [ControlMessageType.Seek, (c) => this.handleSeek(c)],
    ]);
  }

  start(): void {
    if (this.disposed) return;
    this.scheduleNextTick();
    this.scheduleNextFlush();
  }

  private scheduleNextTick(): void {
    if (this.disposed) return;
    this.clockHandle = setTimeout(async () => {
      this.clockHandle = null;
      await this.tick();
      this.scheduleNextTick();
    }, PLAYBACK_TICK_MS);
  }

  private scheduleNextFlush(): void {
    if (this.disposed) return;
    this.batchHandle = setTimeout(async () => {
      this.batchHandle = null;
      await this.flushBuffer();
      this.scheduleNextFlush();
    }, BATCH_WRITE_INTERVAL_MS);
  }

  dispatch(command: DispatchableCommand): void {
    if (this.disposed) return;
    const handler = this.commandHandlers.get(command.type);
    if (!handler) {
      this.logger.warn('Unhandled command', command);
      return;
    }
    handler(command);
    // Emit a frame right away so the UI reflects the new state within one
    // event-loop tick, not on the next 100ms tick boundary. Fire-and-forget;
    // errors are logged inside emitFrame.
    void this.emitFrame();
  }

  ingestNewSignal(message: SignalMessage): void {
    if (this.disposed) return;
    this.buffer.push({
      // Content-derived id: same logical signal → same id → IDB dedups by
      // keyPath. Survives reconnects (where the server re-sends backfill)
      // and page refreshes (where a session counter would have collided).
      id: this.deriveId(message),
      timestamp: message.timestamp,
      frequency: message.frequency,
      point: message.point,
      zone: message.zone,
    });
  }

  private deriveId(m: SignalMessage): string {
    const lat = m.point.lat.toFixed(5);
    const lon = m.point.lon.toFixed(5);
    return `${m.timestamp}-${m.frequency.toFixed(1)}-${lat}-${lon}`;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.clockHandle !== null) {
      clearTimeout(this.clockHandle);
      this.clockHandle = null;
    }
    if (this.batchHandle !== null) {
      clearTimeout(this.batchHandle);
      this.batchHandle = null;
    }
    this.repository.close();
  }

  private handlePlay(): void {
    if (this.mode === 'live') this.cursorOverride = this.now();
    this.mode = 'playing';
  }

  private handlePause(): void {
    if (this.mode === 'live') this.cursorOverride = this.now();
    this.mode = 'paused';
  }

  private handleGoLive(): void {
    this.cursorOverride = null;
    this.mode = 'live';
  }

  private handleSeek(command: DispatchableCommand): void {
    if (command.type !== ControlMessageType.Seek) return;
    const wallNow = this.now();
    this.cursorOverride = clamp(command.timestamp, wallNow - HISTORY_WINDOW_MS, wallNow);
    if (this.mode === 'live') this.mode = 'paused';
  }

  private async flushBuffer(): Promise<void> {
    if (this.disposed || this.buffer.length === 0) return;
    const toSave = this.buffer;
    this.buffer = [];
    try {
      await this.repository.save(toSave);
    } catch (err) {
      this.logger.error('DB save failed', err);
    }
  }

  private async tick(): Promise<void> {
    if (this.disposed) return;

    // Apply the per-tick playback advance synchronously, then defer to
    // emitFrame() for the IDB-bound work.
    if (this.mode === 'playing') {
      const wallNow = this.now();
      const next = (this.cursorOverride ?? wallNow) + PLAYBACK_TICK_MS;
      if (next >= wallNow) {
        this.mode = 'live';
        this.cursorOverride = null;
      } else {
        this.cursorOverride = next;
      }
    }

    await this.emitFrame();
  }

  /**
   * Build and post a single FRAME. Calls are serialized via `framePromise`
   * so a dispatch-triggered emit can't race the scheduled tick's emit —
   * both would otherwise mutate `lastVisibleIds` after their IDB await and
   * produce torn deltas (IDB doesn't FIFO concurrent readonly transactions).
   *
   * Mode and cursor are snapshotted before the await so the emitted frame
   * is internally consistent across the IDB round-trip.
   */
  private emitFrame(): Promise<void> {
    this.framePromise = this.framePromise.then(() => this.emitFrameImpl());
    return this.framePromise;
  }

  private async emitFrameImpl(): Promise<void> {
    // Entire body wrapped — even prelude property reads could in principle
    // throw, and the dispatch path uses `void emitFrame()` so a rejection
    // would surface as unhandled.
    try {
      if (this.disposed) return;

      const wallNow = this.now();
      const modeSnapshot = this.mode;
      const cursor =
        modeSnapshot === 'live' || this.cursorOverride === null
          ? wallNow
          : this.cursorOverride;

      const windowStart = cursor - SIGNAL_VISIBLE_DURATION_MS;
      const windowEnd = cursor + SIGNAL_VISIBLE_DURATION_MS;

      const signals = await this.repository.getInRange(windowStart, windowEnd);
      if (this.disposed) return;

      const visibleSignals = signals.filter(
        (s) => s.timestamp >= cursor - SIGNAL_VISIBLE_DURATION_MS && s.timestamp <= cursor,
      );

      const currentIds = new Set(visibleSignals.map((s) => s.id));
      const addedSignals = visibleSignals.filter((s) => !this.lastVisibleIds.has(s.id));
      const removedSignalIds = Array.from(this.lastVisibleIds).filter((id) => !currentIds.has(id));

      this.lastVisibleIds = currentIds;

      const burstAtCursor = this.computeBurstAtCursor(signals, cursor);

      this.postFrame({
        mode: modeSnapshot,
        cursor,
        now: wallNow,
        addedSignals,
        removedSignalIds,
        burstAtCursor,
      });
    } catch (err) {
      this.logger.error('Frame generation failed', err);
    }
  }

  private computeBurstAtCursor(signals: RadarSignal[], cursor: number): RadarSignal[] {
    if (signals.length === 0) return [];

    let closest = signals[0];
    let minDiff = Math.abs(signals[0].timestamp - cursor);
    for (let i = 1; i < signals.length; i++) {
      const candidate = signals[i];
      const diff = Math.abs(candidate.timestamp - cursor);
      const tieBreakerWins = diff === minDiff && candidate.timestamp < closest.timestamp;
      if (diff < minDiff || tieBreakerWins) {
        minDiff = diff;
        closest = candidate;
      }
    }
    if (minDiff > SIGNAL_VISIBLE_DURATION_MS) return [];
    return signals.filter((s) => s.timestamp === closest.timestamp);
  }
}
