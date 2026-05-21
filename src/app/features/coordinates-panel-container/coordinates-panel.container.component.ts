import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
} from '@angular/core';

import { FORMAT_TIME_HMS } from '../../shared/constants/datetime-formats.constant';
import { SignalStore } from '../../core/state/signal-store';
import { CoordinatesPanelComponent } from '../coordinates/coordinates-panel.component';

@Component({
  selector: 'app-coordinates-panel-container',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CoordinatesPanelComponent, DatePipe],
  templateUrl: './coordinates-panel.container.component.html',
  styleUrl: './coordinates-panel.container.component.scss',
})
export class CoordinatesPanelContainerComponent {
  private readonly store = inject(SignalStore);

  readonly collapsed = input<boolean>(false);
  readonly toggleCollapsed = output<void>();

  protected readonly currentBurst = this.store.burstAtCursor;
  protected readonly mode = this.store.mode;
  protected readonly cursor = this.store.cursor;
  protected readonly visibleCount = computed(() => this.store.visibleSignals().length);
  protected readonly timeFormat = FORMAT_TIME_HMS;

  protected readonly modeLabel = computed(() => {
    switch (this.mode()) {
      case 'live':
        return 'НАЖИВО';
      case 'playing':
        return 'ВІДТВОРЕННЯ';
      case 'paused':
        return 'ПАУЗА';
    }
  });

  protected readonly toggleLabel = computed(() =>
    this.collapsed() ? 'Розгорнути панель' : 'Згорнути панель',
  );

  protected onToggleClick(): void {
    this.toggleCollapsed.emit();
  }
}
