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
  private readonly _visibleSignals = signal<readonly RadarSignal[]>([]);
  private readonly _burstAtCursor = signal<readonly RadarSignal[]>([]);

  private networkWorker: Worker;
  private dbWorker: Worker;

  readonly mode: Signal<PlaybackMode> = this._mode.asReadonly();
  readonly cursor: Signal<number> = this._cursor.asReadonly();
  readonly visibleSignals: Signal<readonly RadarSignal[]> = this._visibleSignals.asReadonly();
  readonly burstAtCursor: Signal<readonly RadarSignal[]> = this._burstAtCursor.asReadonly();

  readonly windowStart = computed(() => this._cursor() - HISTORY_WINDOW_MS);
  readonly windowEnd = computed(() => this._cursor());

  constructor() {
    // Note: In Angular CLI, workers are usually created via new Worker(new URL('...', import.meta.url))
    this.networkWorker = new Worker(new URL('../workers/network.worker', import.meta.url), { type: 'module' });
    this.dbWorker = new Worker(new URL('../workers/db.worker', import.meta.url), { type: 'module' });

    const channel = new MessageChannel();

    this.networkWorker.postMessage({ type: 'INIT_PORTS' }, [channel.port1]);
    this.dbWorker.postMessage({ type: 'INIT_PORTS' }, [channel.port2]);

    this.dbWorker.onmessage = (event: MessageEvent) => {
      if (event.data?.type === 'FRAME') {
        const frame = event.data.payload as StateFrame;
        this._mode.set(frame.mode);
        this._cursor.set(frame.cursor);
        this._visibleSignals.set(frame.visibleSignals);
        this._burstAtCursor.set(frame.burstAtCursor);
      }
    };
  }

  ngOnDestroy(): void {
    this.networkWorker.terminate();
    this.dbWorker.terminate();
  }

  play(): void {
    this.sendCommand({ type: 'PLAY' });
  }

  pause(): void {
    this.sendCommand({ type: 'PAUSE' });
  }

  goLive(): void {
    this.sendCommand({ type: 'GO_LIVE' });
  }

  seekTo(timestamp: number): void {
    this.sendCommand({ type: 'SEEK', timestamp });
  }

  private sendCommand(cmd: ControlCommand): void {
    this.dbWorker.postMessage(cmd);
  }
}
