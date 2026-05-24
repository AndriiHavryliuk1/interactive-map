import { computed, Injectable, OnDestroy, Signal, signal } from '@angular/core';

import { HISTORY_WINDOW_MS } from '../../shared/constants/time.constants';
import { LogSource } from '../../shared/constants/log-source.constant';
import { Logger } from '../../shared/utils/logger';
import { PlaybackMode } from '../../shared/models/playback.model';
import { RadarSignal } from '../../shared/models/signal.model';
import { ControlCommand, StateFrame } from '../../shared/models/worker.model';
import {
  ControlMessageType,
  FrameMessageType,
  WORKER_TERMINATE_GRACE_MS,
} from '../../shared/constants/worker.constants';

@Injectable({
  providedIn: 'root',
})
export class SignalStore implements OnDestroy {
  private readonly _mode = signal<PlaybackMode>('live');
  private readonly _cursor = signal<number>(Date.now());
  private readonly _now = signal<number>(Date.now());
  private readonly _visibleSignalsMap = new Map<string, RadarSignal>();
  private readonly _visibleSignals = signal<readonly RadarSignal[]>([]);
  private readonly _burstAtCursor = signal<readonly RadarSignal[]>([]);

  private readonly logger = new Logger(LogSource.SignalStore);
  private readonly networkWorker: Worker;
  private readonly dbWorker: Worker;

  readonly mode: Signal<PlaybackMode> = this._mode.asReadonly();
  readonly cursor: Signal<number> = this._cursor.asReadonly();
  readonly visibleSignals: Signal<readonly RadarSignal[]> = this._visibleSignals.asReadonly();
  readonly burstAtCursor: Signal<readonly RadarSignal[]> = this._burstAtCursor.asReadonly();

  readonly windowStart = computed(() => this._now() - HISTORY_WINDOW_MS);
  readonly windowEnd = this._now.asReadonly();

  constructor() {
    this.networkWorker = new Worker(new URL('../workers/network.worker.ts', import.meta.url), {
      type: 'module',
    });
    this.dbWorker = new Worker(new URL('../workers/db.worker.ts', import.meta.url), {
      type: 'module',
    });

    this.networkWorker.onerror = (e) => this.logger.error('NetworkWorker error', e);
    this.dbWorker.onerror = (e) => this.logger.error('DBWorker error', e);

    const channel = new MessageChannel();

    this.networkWorker.postMessage(
      { type: ControlMessageType.InitPorts, port: channel.port1 } as ControlCommand,
      [channel.port1],
    );
    this.dbWorker.postMessage(
      { type: ControlMessageType.InitPorts, port: channel.port2 } as ControlCommand,
      [channel.port2],
    );

    this.dbWorker.onmessage = (event: MessageEvent) => this.onWorkerMessage(event);
  }

  ngOnDestroy(): void {
    this.networkWorker.postMessage({ type: ControlMessageType.Dispose });
    this.dbWorker.postMessage({ type: ControlMessageType.Dispose });
    setTimeout(() => {
      this.networkWorker.terminate();
      this.dbWorker.terminate();
    }, WORKER_TERMINATE_GRACE_MS);
  }

  play(): void {
    this.sendCommand({ type: ControlMessageType.Play });
  }

  pause(): void {
    this.sendCommand({ type: ControlMessageType.Pause });
  }

  goLive(): void {
    this.sendCommand({ type: ControlMessageType.GoLive });
  }

  seekTo(timestamp: number): void {
    this.sendCommand({ type: ControlMessageType.Seek, timestamp });
  }

  private onWorkerMessage(event: MessageEvent): void {
    if (event.data?.type !== FrameMessageType.Frame) {
      return;
    }
    const frame = event.data.payload as StateFrame;

    this._mode.set(frame.mode);
    this._cursor.set(frame.cursor);
    this._now.set(frame.now);
    this._burstAtCursor.set(frame.burstAtCursor);

    let changed = false;
    for (const id of frame.removedSignalIds) {
      if (this._visibleSignalsMap.delete(id)) {
        changed = true;
      }
    }
    for (const radarSignal of frame.addedSignals) {
      this._visibleSignalsMap.set(radarSignal.id, radarSignal);
      changed = true;
    }
    if (changed) {
      this._visibleSignals.set(Array.from(this._visibleSignalsMap.values()));
    }
  }

  private sendCommand(cmd: ControlCommand): void {
    this.dbWorker.postMessage(cmd);
  }
}
