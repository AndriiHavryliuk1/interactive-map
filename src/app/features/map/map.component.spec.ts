import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SIGNAL_GATEWAY, SignalGateway } from '../../core/gateway/signal-gateway';
import { SignalStore } from '../../core/state/signal-store';
import { ZONE_STYLE_FOCUSED, ZONE_STYLE_IDLE } from '../../shared/constants/map-styles.constant';
import { SignalMessage } from '../../shared/models/signal.model';
import { MapComponent } from './map.component';

interface FakeMarker {
  latlng: [number, number];
  addTo: ReturnType<typeof vi.fn>;
  bindPopup: ReturnType<typeof vi.fn>;
}
interface FakePolygon {
  coords: [number, number][];
  style: unknown;
  addTo: ReturnType<typeof vi.fn>;
  setStyle: ReturnType<typeof vi.fn>;
}
interface FakeMap {
  remove: ReturnType<typeof vi.fn>;
  removeLayer: ReturnType<typeof vi.fn>;
}

const tracker = vi.hoisted(() => ({
  map: null as FakeMap | null,
  markers: [] as FakeMarker[],
  polygons: [] as FakePolygon[],
}));

vi.mock('leaflet', () => {
  return {
    Icon: { Default: { mergeOptions: () => {}, imagePath: '' } },
    map: vi.fn(() => {
      const m: FakeMap = { remove: vi.fn(), removeLayer: vi.fn() };
      tracker.map = m;
      return m;
    }),
    tileLayer: vi.fn(() => ({ addTo: () => ({}) })),
    marker: vi.fn((latlng: [number, number]) => {
      const m: FakeMarker = {
        latlng,
        addTo: vi.fn().mockReturnThis() as never,
        bindPopup: vi.fn().mockReturnThis() as never,
      };
      tracker.markers.push(m);
      return m;
    }),
    polygon: vi.fn((coords: [number, number][], style: unknown) => {
      const p: FakePolygon = {
        coords,
        style,
        addTo: vi.fn().mockReturnThis() as never,
        setStyle: vi.fn(),
      };
      tracker.polygons.push(p);
      return p;
    }),
  };
});

const NOW = 1_700_000_000_000;

function frame(timestamp: number, opts: Partial<SignalMessage> = {}): SignalMessage {
  return {
    timestamp,
    frequency: opts.frequency ?? 100,
    point: opts.point ?? { lat: 50, lon: 30 },
    zone: opts.zone ?? [{ lat: 50.001, lon: 30 }, { lat: 50.002, lon: 30.001 }],
  };
}

class FakeGateway implements SignalGateway {
  readonly liveSubject = new Subject<SignalMessage>();
  readonly liveSignals$ = this.liveSubject.asObservable();
  constructor(public historicalSignals: SignalMessage[] = []) {}
}

function setUp(historical: SignalMessage[] = []): {
  fixture: ComponentFixture<MapComponent>;
  store: SignalStore;
  gateway: FakeGateway;
} {
  const gateway = new FakeGateway(historical);
  TestBed.configureTestingModule({
    imports: [MapComponent],
    providers: [
      provideZonelessChangeDetection(),
      { provide: SIGNAL_GATEWAY, useValue: gateway },
    ],
  });

  const store = TestBed.inject(SignalStore);
  const fixture = TestBed.createComponent(MapComponent);
  fixture.detectChanges(); // triggers afterNextRender → initLeaflet → mapReady=true → effects flush
  return { fixture, store, gateway };
}

describe('MapComponent', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
    tracker.map = null;
    tracker.markers.length = 0;
    tracker.polygons.length = 0;
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    vi.useRealTimers();
  });

  it('initializes a Leaflet map exactly once', () => {
    setUp();
    expect(tracker.map).not.toBeNull();
  });

  it('renders a marker for each visible signal on first paint', () => {
    setUp([frame(NOW - 1_000), frame(NOW - 5_000)]);
    expect(tracker.markers).toHaveLength(2);
  });

  it('renders a polygon for a signal whose zone has vertices', () => {
    setUp([frame(NOW - 1_000)]);
    expect(tracker.polygons).toHaveLength(1);
  });

  it('skips the polygon entirely when zone is empty', () => {
    setUp([frame(NOW - 1_000, { zone: [] })]);
    expect(tracker.markers).toHaveLength(1);
    expect(tracker.polygons).toHaveLength(0);
  });

  it('adds layers when a new live signal arrives', () => {
    const { fixture, gateway } = setUp();
    expect(tracker.markers).toHaveLength(0);

    gateway.liveSubject.next(frame(NOW));
    fixture.detectChanges();

    expect(tracker.markers).toHaveLength(1);
    expect(tracker.polygons).toHaveLength(1);
  });

  it('removes layers when a signal ages out of the visible window', () => {
    const { fixture, store } = setUp([frame(NOW)]);
    expect(tracker.markers).toHaveLength(1);

    // Scrub to a moment 5 minutes before that signal → it falls outside [cursor-30s, cursor].
    store.seekTo(NOW - 5 * 60_000);
    fixture.detectChanges();

    const map = tracker.map!;
    expect(map.removeLayer).toHaveBeenCalledWith(expect.objectContaining({ latlng: [50, 30] }));
  });

  it('applies the FOCUSED zone style to every polygon in the current burst', () => {
    const { fixture } = setUp([frame(NOW - 100, { frequency: 1 }), frame(NOW - 100, { frequency: 2 })]);
    fixture.detectChanges();

    expect(tracker.polygons).toHaveLength(2);
    for (const polygon of tracker.polygons) {
      expect(polygon.setStyle).toHaveBeenCalledWith(ZONE_STYLE_FOCUSED);
    }
  });

  it('reverts a polygon to IDLE when a newer burst displaces it', () => {
    // Initial state: a single signal at NOW - 100 is the closest, so it's FOCUSED.
    const { fixture, gateway } = setUp([frame(NOW - 100, { frequency: 1 })]);
    const oldPolygon = tracker.polygons[0];
    expect(oldPolygon.setStyle).toHaveBeenCalledWith(ZONE_STYLE_FOCUSED);

    // A fresh signal arrives exactly at the cursor — it becomes the closest,
    // and the old polygon (still on the map) should revert to IDLE.
    gateway.liveSubject.next(frame(NOW, { frequency: 2 }));
    fixture.detectChanges();

    expect(oldPolygon.setStyle).toHaveBeenLastCalledWith(ZONE_STYLE_IDLE);
  });

  it('tears down the Leaflet map on component destroy', () => {
    const { fixture } = setUp();
    const map = tracker.map!;
    fixture.destroy();
    expect(map.remove).toHaveBeenCalled();
  });
});
