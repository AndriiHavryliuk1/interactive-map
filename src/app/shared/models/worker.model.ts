import { ChannelMessageType } from '../constants/worker.constants';
import { PlaybackMode } from './playback.model';
import { RadarSignal, SignalMessage } from './signal.model';

export interface StateFrame {
  mode: PlaybackMode;
  cursor: number;
  now: number;
  addedSignals: RadarSignal[];
  removedSignalIds: string[];
  burstAtCursor: RadarSignal[];
}

/** Commands the PlaybackEngine handles via its dispatcher. */
export type DispatchableCommand =
  | { type: 'PLAY' }
  | { type: 'PAUSE' }
  | { type: 'GO_LIVE' }
  | { type: 'SEEK'; timestamp: number };

/** Lifecycle commands handled by the worker entry point — never reach the engine. */
export type LifecycleCommand = { type: 'INIT_PORTS'; port: MessagePort } | { type: 'DISPOSE' };

export type ControlCommand = DispatchableCommand | LifecycleCommand;

/** Envelope used on the worker-to-worker MessageChannel. */
export interface ChannelNewSignal {
  type: typeof ChannelMessageType.NewSignal;
  payload: SignalMessage;
}

export function isChannelNewSignal(data: unknown): data is ChannelNewSignal {
  return (
    typeof data === 'object' &&
    data !== null &&
    'type' in data &&
    data.type === ChannelMessageType.NewSignal
  );
}
