import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  signal,
  viewChild,
} from '@angular/core';

import { FORMAT_TIME_HM } from '../../shared/constants/datetime-formats.constant';
import { LogSource } from '../../shared/constants/log-source.constant';
import { SignalStore } from '../../core/state/signal-store';
import { PlaybackMode } from '../../shared/models/playback.model';
import { Logger } from '../../shared/utils/logger';

@Component({
  selector: 'app-control-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe],
  templateUrl: './control-panel.component.html',
  styleUrl: './control-panel.component.scss',
})
export class ControlPanelComponent {
  private readonly store = inject(SignalStore);
  private readonly destroyRef = inject(DestroyRef);
  private readonly logger = new Logger(LogSource.ControlPanelComponent);

  private readonly track = viewChild.required<ElementRef<HTMLDivElement>>('track');
  private readonly draggingPointerId = signal<number | null>(null);
  private dragTeardown: (() => void) | null = null;

  protected readonly windowStart = this.store.windowStart;
  protected readonly windowEnd = this.store.windowEnd;
  protected readonly cursor = this.store.cursor;
  protected readonly mode = this.store.mode;
  protected readonly tickTimeFormat = FORMAT_TIME_HM;

  protected readonly isDragging = computed(() => this.draggingPointerId() !== null);

  protected readonly isPlaying = computed(() => {
    const mode = this.mode();
    return mode === 'live' || mode === 'playing';
  });

  protected readonly isLive = computed(() => this.mode() === 'live');

  protected readonly cursorPercent = computed(() => {
    const start = this.windowStart();
    const end = this.windowEnd();
    const span = end - start;
    if (span <= 0) {
      return 100;
    }

    const ratio = (this.cursor() - start) / span;
    return Math.max(0, Math.min(100, ratio * 100));
  });

  protected readonly cursorLabel = computed(() =>
    new Date(this.cursor()).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }),
  );

  constructor() {
    this.destroyRef.onDestroy(() => this.dragTeardown?.());
    this.logModeTransitions();
  }

  private logModeTransitions(): void {
    let previous: PlaybackMode | null = null;
    effect(() => {
      const current = this.mode();
      if (previous !== null && previous !== current) {
        this.logger.info(`mode: ${previous} → ${current}`);
      }
      previous = current;
    });
  }

  protected toggleTransport(): void {
    if (this.isPlaying()) {
      this.store.pause();
    } else {
      this.store.play();
    }
  }

  protected goLive(): void {
    this.store.goLive();
  }

  protected onTrackPointerDown(event: PointerEvent): void {
    const trackEl = this.track().nativeElement;
    // setPointerCapture can throw InvalidPointerId when the pointer is
    // already released (fast tap + release before this handler runs).
    // Capture is best-effort: if it fails we still register the drag
    // listeners, just without explicit capture.
    try {
      trackEl.setPointerCapture(event.pointerId);
    } catch {
      // expected for stale pointers; nothing to recover
    }
    this.draggingPointerId.set(event.pointerId);

    this.seekFromPointer(event);

    const onMove = (e: PointerEvent) => {
      if (e.pointerId !== this.draggingPointerId()) {
        return;
      }
      this.seekFromPointer(e);
    };

    const teardown = () => {
      trackEl.removeEventListener('pointermove', onMove);
      trackEl.removeEventListener('pointerup', onEnd);
      trackEl.removeEventListener('pointercancel', onEnd);
      this.dragTeardown = null;
    };

    const onEnd = (e: PointerEvent) => {
      if (e.pointerId !== this.draggingPointerId()) {
        return;
      }
      try {
        trackEl.releasePointerCapture(e.pointerId);
      } catch {
        // expected if capture was never established or already released
      }
      teardown();
      this.draggingPointerId.set(null);
    };

    trackEl.addEventListener('pointermove', onMove);
    trackEl.addEventListener('pointerup', onEnd);
    trackEl.addEventListener('pointercancel', onEnd);

    this.dragTeardown = teardown;
  }

  private seekFromPointer(event: PointerEvent): void {
    const trackEl = this.track().nativeElement;
    const rect = trackEl.getBoundingClientRect();
    if (rect.width === 0) {
      return;
    }

    const ratio = (event.clientX - rect.left) / rect.width;
    const clampedRatio = Math.max(0, Math.min(1, ratio));

    const start = this.windowStart();
    const end = this.windowEnd();
    const targetTimestamp = start + clampedRatio * (end - start);

    this.store.seekTo(targetTimestamp);
  }
}
