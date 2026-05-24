import { provideZonelessChangeDetection, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SignalStore } from '../../core/state/signal-store';
import { RadarSignal } from '../../shared/models/signal.model';
import { PlaybackMode } from '../../shared/models/playback.model';
import { CoordinatesPanelContainerComponent } from './coordinates-panel.container.component';

const NOW = 1_700_000_000_000;

function frame(id: string, timestamp: number, frequency = 100): RadarSignal {
  return {
    id,
    timestamp,
    frequency,
    point: { lat: 50, lon: 30 },
    zone: [],
  };
}

class MockSignalStore {
  mode = signal<PlaybackMode>('live');
  visibleSignals = signal<readonly RadarSignal[]>([]);
  burstAtCursor = signal<readonly RadarSignal[]>([]);
  cursor = signal<number>(NOW);

  pause = vi.fn(() => this.mode.set('paused'));
  play = vi.fn(() => this.mode.set('playing'));
  goLive = vi.fn(() => this.mode.set('live'));
  seekTo = vi.fn((ts: number) => {
    this.cursor.set(ts);
    this.mode.set('paused');
  });
}

function setUp(historical: RadarSignal[] = []): {
  fixture: ComponentFixture<CoordinatesPanelContainerComponent>;
  store: MockSignalStore;
  el: HTMLElement;
} {
  const mockStore = new MockSignalStore();
  mockStore.visibleSignals.set(historical);
  // Simple heuristic for burstAtCursor in tests: if any signal matches the cursor
  const burst = historical.filter((s) => s.timestamp === mockStore.cursor());
  mockStore.burstAtCursor.set(burst);

  TestBed.configureTestingModule({
    imports: [CoordinatesPanelContainerComponent],
    providers: [provideZonelessChangeDetection(), { provide: SignalStore, useValue: mockStore }],
  });

  const fixture = TestBed.createComponent(CoordinatesPanelContainerComponent);
  fixture.detectChanges();

  return { fixture, store: mockStore, el: fixture.nativeElement as HTMLElement };
}

describe('CoordinatesPanelContainerComponent', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    vi.useRealTimers();
  });

  describe('mode label', () => {
    it('shows НАЖИВО while in live mode', () => {
      const { el } = setUp();
      expect(el.querySelector('.mode')?.textContent?.trim()).toBe('НАЖИВО');
    });

    it('shows ПАУЗА after pause()', () => {
      const { fixture, store, el } = setUp();
      store.pause();
      fixture.detectChanges();
      expect(el.querySelector('.mode')?.textContent?.trim()).toBe('ПАУЗА');
    });

    it('shows ВІДТВОРЕННЯ while playing', () => {
      const { fixture, store, el } = setUp();
      store.pause();
      store.play();
      fixture.detectChanges();
      expect(el.querySelector('.mode')?.textContent?.trim()).toBe('ВІДТВОРЕННЯ');
    });

    it('tags the mode element with a data-mode attribute', () => {
      const { fixture, store, el } = setUp();
      expect(el.querySelector('.mode')?.getAttribute('data-mode')).toBe('live');

      store.pause();
      fixture.detectChanges();
      expect(el.querySelector('.mode')?.getAttribute('data-mode')).toBe('paused');
    });
  });

  describe('burst rendering', () => {
    it('renders an empty state when no burst is in range', () => {
      const { el } = setUp();
      expect(el.querySelector('.empty')).toBeTruthy();
      expect(el.querySelectorAll('app-coordinates-panel')).toHaveLength(0);
    });

    it('renders one card per signal in the burst', () => {
      const { store, fixture, el } = setUp();
      const signals = [frame('1', NOW, 144), frame('2', NOW, 200), frame('3', NOW, 500)];
      store.burstAtCursor.set(signals);
      fixture.detectChanges();
      expect(el.querySelectorAll('app-coordinates-panel')).toHaveLength(3);
    });

    it('hides the burst badge for a solo signal', () => {
      const { store, fixture, el } = setUp();
      store.burstAtCursor.set([frame('1', NOW)]);
      fixture.detectChanges();
      expect(el.querySelector('.burst-badge')).toBeNull();
    });

    it('shows a compact ×N badge for a multi-signal burst', () => {
      const { store, fixture, el } = setUp();
      store.burstAtCursor.set([frame('1', NOW, 144), frame('2', NOW, 200)]);
      fixture.detectChanges();
      const badge = el.querySelector('.burst-badge');
      expect(badge).toBeTruthy();
      expect(badge?.textContent?.trim()).toBe('×2');
      // Full phrase stays accessible via the title attribute.
      expect(badge?.getAttribute('title')).toContain('одночасно');
    });
  });

  describe('visible counter', () => {
    it('shows zero when nothing is visible', () => {
      const { el } = setUp();
      expect(el.querySelector('.footer')?.textContent).toContain('Видимих зараз: 0');
    });

    it('reflects the number of signals in the trailing 30s window', () => {
      const { el } = setUp([
        frame('1', NOW - 25_000),
        frame('2', NOW - 10_000),
        frame('3', NOW - 1_000),
      ]);
      expect(el.querySelector('.footer')?.textContent).toContain('Видимих зараз: 3');
    });
  });

  describe('collapse / expand', () => {
    it('renders the toggle button by default', () => {
      const { el } = setUp();
      const toggle = el.querySelector('.toggle') as HTMLButtonElement;
      expect(toggle).toBeTruthy();
      expect(toggle.getAttribute('aria-expanded')).toBe('true');
      expect(toggle.getAttribute('aria-label')).toBe('Згорнути панель');
    });

    it('emits toggleCollapsed when the button is clicked', () => {
      const { fixture, el } = setUp();
      const emitted = vi.fn();
      fixture.componentInstance.toggleCollapsed.subscribe(emitted);

      (el.querySelector('.toggle') as HTMLButtonElement).click();
      expect(emitted).toHaveBeenCalledTimes(1);
    });

    it('hides body content and footer when [collapsed]="true"', () => {
      const { fixture, el } = setUp([frame('1', NOW - 1_000)]);
      fixture.componentRef.setInput('collapsed', true);
      fixture.detectChanges();

      expect(el.querySelector('.signal-list')).toBeNull();
      expect(el.querySelector('.footer')).toBeNull();
      expect(el.querySelector('h2')).toBeNull();
      // Toggle button is still reachable to expand again.
      expect(el.querySelector('.toggle')).toBeTruthy();
    });

    it('marks the panel with is-collapsed and flips aria-expanded', () => {
      const { fixture, el } = setUp();
      fixture.componentRef.setInput('collapsed', true);
      fixture.detectChanges();

      expect(el.querySelector('.panel')?.classList.contains('is-collapsed')).toBe(true);
      const toggle = el.querySelector('.toggle') as HTMLButtonElement;
      expect(toggle.getAttribute('aria-expanded')).toBe('false');
      expect(toggle.getAttribute('aria-label')).toBe('Розгорнути панель');
    });
  });
});
