import { provideZonelessChangeDetection, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SignalStore } from '../../core/state/signal-store';
import { HISTORY_WINDOW_MS } from '../../shared/constants/time.constants';
import { PlaybackMode } from '../../shared/models/playback.model';
import { ControlPanelComponent } from './control-panel.component';

const NOW = 1_700_000_000_000;
const TRACK_WIDTH = 1000;

class MockSignalStore {
  mode = signal<PlaybackMode>('live');
  cursor = signal<number>(NOW);
  windowStart = signal<number>(NOW - HISTORY_WINDOW_MS);
  windowEnd = signal<number>(NOW);

  play = vi.fn(() => this.mode.set('playing'));
  pause = vi.fn(() => this.mode.set('paused'));
  goLive = vi.fn(() => {
    this.cursor.set(this.windowEnd());
    this.mode.set('live');
  });
  seekTo = vi.fn((ts: number) => {
    this.cursor.set(ts);
    this.mode.set('paused');
  });
}

function setUp(): {
  fixture: ComponentFixture<ControlPanelComponent>;
  store: MockSignalStore;
  el: HTMLElement;
  track: HTMLElement;
  transport: HTMLButtonElement;
  live: HTMLButtonElement;
} {
  const mockStore = new MockSignalStore();

  TestBed.configureTestingModule({
    imports: [ControlPanelComponent],
    providers: [provideZonelessChangeDetection(), { provide: SignalStore, useValue: mockStore }],
  });

  const fixture = TestBed.createComponent(ControlPanelComponent);
  fixture.detectChanges();

  const el = fixture.nativeElement as HTMLElement;
  const track = el.querySelector('.track') as HTMLElement;
  vi.spyOn(track, 'getBoundingClientRect').mockReturnValue({
    left: 0,
    right: TRACK_WIDTH,
    width: TRACK_WIDTH,
    top: 0,
    bottom: 20,
    height: 20,
    x: 0,
    y: 0,
    toJSON: () => '',
  });

  // setPointerCapture / releasePointerCapture are not implemented in jsdom.
  track.setPointerCapture = () => {};
  track.releasePointerCapture = () => {};

  return {
    fixture,
    store: mockStore,
    el,
    track,
    transport: el.querySelector('.transport') as HTMLButtonElement,
    live: el.querySelector('.live') as HTMLButtonElement,
  };
}

function pointerEvent(type: string, clientX: number, pointerId = 1): PointerEvent {
  return new PointerEvent(type, { clientX, pointerId, bubbles: true });
}

describe('ControlPanelComponent', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    vi.useRealTimers();
  });

  describe('transport button', () => {
    it('shows the pause glyph while in live mode', () => {
      const { transport } = setUp();
      expect(transport.textContent?.trim()).toBe('❚❚');
      expect(transport.getAttribute('aria-label')).toBe('Pause');
    });

    it('shows the play glyph after pause()', () => {
      const { fixture, store, transport } = setUp();
      store.pause();
      fixture.detectChanges();
      expect(transport.textContent?.trim()).toBe('▶');
      expect(transport.getAttribute('aria-label')).toBe('Play');
    });

    it('pauses live playback when clicked', () => {
      const { store, transport } = setUp();
      expect(store.mode()).toBe('live');
      transport.click();
      expect(store.mode()).toBe('paused');
    });

    it('resumes playback when clicked from paused', () => {
      const { fixture, store, transport } = setUp();
      store.pause();
      fixture.detectChanges();
      transport.click();
      expect(store.mode()).toBe('playing');
    });

    it('pauses again when clicked from playing', () => {
      const { fixture, store, transport } = setUp();
      store.pause();
      store.play();
      fixture.detectChanges();
      transport.click();
      expect(store.mode()).toBe('paused');
    });
  });

  describe('LIVE button', () => {
    it('is marked active while in live mode', () => {
      const { live } = setUp();
      expect(live.classList.contains('is-live')).toBe(true);
    });

    it('drops the active class once paused', () => {
      const { fixture, store, live } = setUp();
      store.pause();
      fixture.detectChanges();
      expect(live.classList.contains('is-live')).toBe(false);
    });

    it('snaps the cursor back to "now" when clicked', () => {
      const { fixture, store, live } = setUp();
      store.seekTo(NOW - 60_000);
      fixture.detectChanges();
      expect(store.mode()).toBe('paused');

      live.click();
      expect(store.mode()).toBe('live');
      expect(store.cursor()).toBe(NOW);
    });
  });

  describe('scrubber position', () => {
    it('places the scrubber at 100% in live mode', () => {
      const { el } = setUp();
      const scrubber = el.querySelector('.scrubber') as HTMLElement;
      expect(scrubber.style.left).toBe('100%');
    });

    it('places the scrubber at 0% when seeking to windowStart', () => {
      const { fixture, store, el } = setUp();
      store.seekTo(NOW - HISTORY_WINDOW_MS);
      fixture.detectChanges();
      const scrubber = el.querySelector('.scrubber') as HTMLElement;
      expect(scrubber.style.left).toBe('0%');
    });

    it('places the scrubber at 50% when seeking to the midpoint', () => {
      const { fixture, store, el } = setUp();
      store.seekTo(NOW - HISTORY_WINDOW_MS / 2);
      fixture.detectChanges();
      const scrubber = el.querySelector('.scrubber') as HTMLElement;
      expect(scrubber.style.left).toBe('50%');
    });
  });

  describe('drag-to-seek', () => {
    it('seeks proportionally to where the pointer goes down on the track', () => {
      const { store, track } = setUp();
      track.dispatchEvent(pointerEvent('pointerdown', TRACK_WIDTH / 4));
      // 25% across track → 25% across the 12-hour window
      expect(store.cursor()).toBe(NOW - (HISTORY_WINDOW_MS * 3) / 4);
      expect(store.mode()).toBe('paused');
    });

    it('updates the cursor continuously during a drag (not only on release)', () => {
      const { store, track } = setUp();
      track.dispatchEvent(pointerEvent('pointerdown', 0));
      const atStart = store.cursor();

      track.dispatchEvent(pointerEvent('pointermove', TRACK_WIDTH / 2));
      const midDrag = store.cursor();

      expect(midDrag).toBeGreaterThan(atStart);
      expect(midDrag).toBe(NOW - HISTORY_WINDOW_MS / 2);
    });

    it('clamps to the track when the pointer goes past either edge', () => {
      const { store, track } = setUp();
      track.dispatchEvent(pointerEvent('pointerdown', -500));
      expect(store.cursor()).toBe(NOW - HISTORY_WINDOW_MS);

      track.dispatchEvent(pointerEvent('pointermove', TRACK_WIDTH + 500));
      expect(store.cursor()).toBe(NOW);
    });

    it('does nothing when the track has zero width (unrendered edge case)', () => {
      const { store, track } = setUp();
      vi.spyOn(track, 'getBoundingClientRect').mockReturnValueOnce({
        left: 0,
        right: 0,
        width: 0,
        top: 0,
        bottom: 0,
        height: 0,
        x: 0,
        y: 0,
        toJSON: () => '',
      });
      track.dispatchEvent(pointerEvent('pointerdown', 100));
      // cursor should stay where it was — at NOW in live mode
      expect(store.cursor()).toBe(NOW);
    });
  });
});
