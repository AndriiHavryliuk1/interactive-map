import {
  computed,
  Injectable,
  OnDestroy,
  Signal,
  signal,
} from '@angular/core';

import { HISTORY_WINDOW_MS } from '../../shared/constants/time.constants';
import { PlaybackMode } from '../../shared/models/playback.model';
import { RadarSignal } from '../../shared/models/signal.model';
import { StateFrame, ControlCommand } from '../../shared/models/worker.model';

@Injectable({ providedIn: 'root' })
export class SignalStore implements OnDestroy {
  private readonly _mode = signal<PlaybackMode>('live');
  private readonly _cursor = signal<number>(Date.now());
  private readonly _now = signal<number>(Date.now());
  private readonly _visibleSignalsMap = new Map<string, RadarSignal>();
  private readonly _visibleSignals = signal<readonly RadarSignal[]>([]);
  private readonly _burstAtCursor = signal<readonly RadarSignal[]>([]);
  
  private networkWorker: Worker;
  private dbWorker: Worker;

  readonly mode: Signal<PlaybackMode> = this._mode.asReadonly();
  readonly cursor: Signal<number> = this._cursor.asReadonly();
  readonly visibleSignals: Signal<readonly RadarSignal[]> = this._visibleSignals.asReadonly();
  readonly burstAtCursor: Signal<readonly RadarSignal[]> = this._burstAtCursor.asReadonly();
  
  readonly windowStart = computed(() => this._now() - HISTORY_WINDOW_MS);
  readonly windowEnd = this._now.asReadonly();

  constructor() {
    this.networkWorker = new Worker(new URL('../workers/network.worker.ts', import.meta.url), { type: 'module' });
    this.dbWorker = new Worker(new URL('../workers/db.worker.ts', import.meta.url), { type: 'module' });

    this.networkWorker.onerror = (e) => console.error('Network Worker error:', e);
    this.dbWorker.onerror = (e) => console.error('DB Worker error:', e);

    const channel = new MessageChannel();

    this.networkWorker.postMessage({ type: 'INIT_PORTS', port: channel.port1 } as ControlCommand, [channel.port1]);
    this.dbWorker.postMessage({ type: 'INIT_PORTS', port: channel.port2 } as ControlCommand, [channel.port2]);

    this.dbWorker.onmessage = (event: MessageEvent) => {
      if (event.data?.type === 'FRAME') {
        const frame = event.data.payload as StateFrame;
        this._mode.set(frame.mode);
        this._cursor.set(frame.cursor);
        this._now.set(frame.now);
        this._burstAtCursor.set(frame.burstAtCursor);

        // Delta-based update of the visible signals map
        let changed = false;
        for (const id of frame.removedSignalIds) {
          if (this._visibleSignalsMap.delete(id)) changed = true;
        }
        for (const signal of frame.addedSignals) {
          this._visibleSignalsMap.set(signal.id, signal);
          changed = true;
        }

        if (changed) {
          this._visibleSignals.set(Array.from(this._visibleSignalsMap.values()));
        }
      }
    };
  }

  ngOnDestroy(): void {
    this.networkWorker.postMessage({ type: 'DISPOSE' });
    this.dbWorker.postMessage({ type: 'DISPOSE' });
    // Give them a moment to cleanup before hard terminate
    setTimeout(() => {
      this.networkWorker.terminate();
      this.dbWorker.terminate();
    }, 50);
  }

  play(): void {
    this._mode.set('playing');
    this.sendCommand({ type: 'PLAY' });
  }

  pause(): void {
    this._mode.set('paused');
    this.sendCommand({ type: 'PAUSE' });
  }

  goLive(): void {
    this._mode.set('live');
    this.sendCommand({ type: 'GO_LIVE' });
  }

  seekTo(timestamp: number): void {
    this._cursor.set(timestamp);
    this._mode.set('paused');
    this.sendCommand({ type: 'SEEK', timestamp });
  }
  
  private sendCommand(cmd: ControlCommand): void {
     this.dbWorker.postMessage(cmd);
  }
}
