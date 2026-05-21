import { ChangeDetectionStrategy, Component, signal } from '@angular/core';

import { ControlPanelComponent } from './features/controls/control-panel.component';
import { CoordinatesPanelContainerComponent } from './features/coordinates-panel-container/coordinates-panel.container.component';
import { MapComponent } from './features/map/map.component';

@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MapComponent, ControlPanelComponent, CoordinatesPanelContainerComponent],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  protected readonly sidebarCollapsed = signal(false);

  protected toggleSidebar(): void {
    this.sidebarCollapsed.update((v) => !v);
  }
}
