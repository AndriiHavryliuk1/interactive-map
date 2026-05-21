import { DatePipe, DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, input } from '@angular/core';

import { FORMAT_DATETIME_FULL } from '../../shared/constants/datetime-formats.constant';
import {
  FORMAT_COORDINATE,
  FORMAT_FREQUENCY,
} from '../../shared/constants/number-formats.constant';
import { RadarSignal } from '../../shared/models/signal.model';
import { VertexCountLabelPipe } from '../../shared/pipes/vertex-count-label.pipe';

@Component({
  selector: 'app-coordinates-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, DecimalPipe, VertexCountLabelPipe],
  templateUrl: './coordinates-panel.component.html',
  styleUrl: './coordinates-panel.component.scss',
})
export class CoordinatesPanelComponent {
  readonly radarSignal = input.required<RadarSignal>();
  readonly index = input.required<number>();
  readonly total = input.required<number>();

  protected readonly datetimeFormat = FORMAT_DATETIME_FULL;
  protected readonly frequencyFormat = FORMAT_FREQUENCY;
  protected readonly coordinateFormat = FORMAT_COORDINATE;
}
