import { GeoPoint } from './geo.model';

export interface SignalMessage {
  readonly timestamp: number;
  readonly frequency: number;
  readonly point: GeoPoint;
  readonly zone: readonly GeoPoint[];
}

export interface RadarSignal {
  readonly id: string;
  readonly timestamp: number;
  readonly frequency: number;
  readonly point: GeoPoint;
  readonly zone: readonly GeoPoint[];
}
