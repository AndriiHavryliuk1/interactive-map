import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  signal,
  viewChild,
} from '@angular/core';

import { FORMAT_TIME_HM } from '../../shared/constants/datetime-formats.constant';
import { SignalStore } from '../../core/state/signal-store';

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
    if (span <= 0) return 100;

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
    trackEl.setPointerCapture(event.pointerId);
    this.draggingPointerId.set(event.pointerId);

    this.seekFromPointer(event);

    const onMove = (e: PointerEvent) => {
      if (e.pointerId !== this.draggingPointerId()) return;
      this.seekFromPointer(e);
    };

    const teardown = () => {
      trackEl.removeEventListener('pointermove', onMove);
      trackEl.removeEventListener('pointerup', onEnd);
      trackEl.removeEventListener('pointercancel', onEnd);
      this.dragTeardown = null;
    };

    const onEnd = (e: PointerEvent) => {
      if (e.pointerId !== this.draggingPointerId()) return;
      trackEl.releasePointerCapture(e.pointerId);
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
    if (rect.width === 0) return;

    const ratio = (event.clientX - rect.left) / rect.width;
    const clampedRatio = Math.max(0, Math.min(1, ratio));

    const start = this.windowStart();
    const end = this.windowEnd();
    const targetTimestamp = start + clampedRatio * (end - start);

    this.store.seekTo(targetTimestamp);
  }
}
