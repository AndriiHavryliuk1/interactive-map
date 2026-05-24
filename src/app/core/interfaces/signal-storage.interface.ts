import { RadarSignal } from '../../shared/models/signal.model';

export interface SignalStorage {
  save(signals: readonly RadarSignal[]): Promise<void>;
  getInRange(start: number, end: number): Promise<RadarSignal[]>;
  close(): void;
}
