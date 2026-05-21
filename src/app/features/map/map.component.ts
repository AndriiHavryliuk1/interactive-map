import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import * as L from 'leaflet';

import { ZONE_STYLE_FOCUSED, ZONE_STYLE_IDLE } from '../../shared/constants/map-styles.constant';
import { FORMAT_DATETIME_FULL } from '../../shared/constants/datetime-formats.constant';
import {
  COORDINATE_DECIMAL_PLACES,
  FREQUENCY_DECIMAL_PLACES,
} from '../../shared/constants/number-formats.constant';
import { SignalStore } from '../../core/state/signal-store';
import { RadarSignal } from '../../shared/models/signal.model';
import { DatePipe } from '@angular/common';

interface RenderedSignal {
  readonly marker: L.Marker;
  readonly polygon: L.Polygon | null;
}

@Component({
  selector: 'app-map',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './map.component.html',
  styleUrl: './map.component.scss',
  providers: [DatePipe]
})
export class MapComponent {
  private readonly store = inject(SignalStore);
  private readonly destroyRef = inject(DestroyRef);
  private readonly datePipe = inject(DatePipe);
  private readonly mapHost = viewChild.required<ElementRef<HTMLDivElement>>('mapHost');

  private map: L.Map | null = null;
  private readonly mapReady = signal(false);
  private readonly renderedLayers = new Map<string, RenderedSignal>();
  private highlightedIds = new Set<string>();

  constructor() {
    this.syncLayersToStore();
    this.syncHighlightToStore();

    afterNextRender(() => {
      this.initLeaflet();
      this.mapReady.set(true);

      const resizeObserver = new ResizeObserver(() => this.map?.invalidateSize());
      resizeObserver.observe(this.mapHost().nativeElement);
      this.destroyRef.onDestroy(() => resizeObserver.disconnect());
    });

    this.destroyRef.onDestroy(() => {
      this.map?.remove();
      this.map = null;
    });
  }

  private initLeaflet(): void {
    L.Icon.Default.imagePath = '';
    L.Icon.Default.mergeOptions({
      iconRetinaUrl: 'assets/leaflet/marker-icon-2x.png',
      iconUrl: 'assets/leaflet/marker-icon.png',
      shadowUrl: 'assets/leaflet/marker-shadow.png',
    });

    this.map = L.map(this.mapHost().nativeElement, {
      center: [50.4501, 30.5234],
      zoom: 11,
      zoomControl: true,
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(this.map);
  }

  private syncLayersToStore(): void {
    effect(() => {
      if (!this.mapReady()) return;
      const map = this.map;
      if (map === null) return;

      const currentSignals = this.store.visibleSignals();
      const desiredIds = new Set(currentSignals.map((s) => s.id));

      for (const [id, rendered] of this.renderedLayers) {
        if (!desiredIds.has(id)) {
          map.removeLayer(rendered.marker);
          if (rendered.polygon !== null) {
            map.removeLayer(rendered.polygon);
          }
          this.renderedLayers.delete(id);
        }
      }

      for (const radarSignal of currentSignals) {
        if (!this.renderedLayers.has(radarSignal.id)) {
          this.renderedLayers.set(radarSignal.id, this.createLayersFor(radarSignal, map));
        }
      }
    });
  }

  private syncHighlightToStore(): void {
    effect(() => {
      if (!this.mapReady()) return;

      const nextIds = new Set(this.store.burstAtCursor().map((s) => s.id));

      for (const id of this.highlightedIds) {
        if (!nextIds.has(id)) {
          this.renderedLayers.get(id)?.polygon?.setStyle(ZONE_STYLE_IDLE);
        }
      }
      for (const id of nextIds) {
        if (!this.highlightedIds.has(id)) {
          this.renderedLayers.get(id)?.polygon?.setStyle(ZONE_STYLE_FOCUSED);
        }
      }

      this.highlightedIds = nextIds;
    });
  }

  private createLayersFor(radarSignal: RadarSignal, map: L.Map): RenderedSignal {
    const marker = L.marker([radarSignal.point.lat, radarSignal.point.lon])
      .addTo(map)
      .bindPopup(this.popupHtmlFor(radarSignal));

    let polygon: L.Polygon | null = null;
    if (radarSignal.zone.length > 0) {
      polygon = L.polygon(
        radarSignal.zone.map((p) => [p.lat, p.lon] as L.LatLngTuple),
        ZONE_STYLE_IDLE,
      ).addTo(map);
    }

    return { marker, polygon };
  }

  private popupHtmlFor(radarSignal: RadarSignal): string {
    const time = this.datePipe.transform(radarSignal.timestamp, FORMAT_DATETIME_FULL);
    return `
      <strong>${radarSignal.frequency.toFixed(FREQUENCY_DECIMAL_PLACES)} MHz</strong><br />
      ${radarSignal.point.lat.toFixed(COORDINATE_DECIMAL_PLACES)}, ${radarSignal.point.lon.toFixed(COORDINATE_DECIMAL_PLACES)}<br />
      <small>${time}</small>
    `;
  }
}
