import { RadarSignal } from '../../shared/models/signal.model';

/**
 * Abstraction over signal persistence. `PlaybackEngine` depends on this
 * interface, not the concrete IDB-backed `SignalRepository`, so tests can
 * supply a trivial in-memory implementation without spinning up
 * fake-indexeddb.
 */
export interface SignalStorage {
  save(signals: readonly RadarSignal[]): Promise<void>;
  getInRange(start: number, end: number): Promise<RadarSignal[]>;
  close(): void;
}
