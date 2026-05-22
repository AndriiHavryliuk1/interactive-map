import { PlaybackMode } from './playback.model';
import { RadarSignal } from './signal.model';

export interface StateFrame {
  mode: PlaybackMode;
  cursor: number;
  visibleSignals: RadarSignal[];
  burstAtCursor: RadarSignal[];
}

export type ControlCommand =
  | { type: 'PLAY' }
  | { type: 'PAUSE' }
  | { type: 'GO_LIVE' }
  | { type: 'SEEK'; timestamp: number }
  | { type: 'INIT_PORTS'; port: MessagePort };
