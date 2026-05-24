export const BATCH_WRITE_INTERVAL_MS = 100;
export const WORKER_TERMINATE_GRACE_MS = 50;
export const RECONNECT_BACKOFF_BASE = 2;

export const ControlMessageType = {
  Play: 'PLAY',
  Pause: 'PAUSE',
  GoLive: 'GO_LIVE',
  Seek: 'SEEK',
  InitPorts: 'INIT_PORTS',
  Dispose: 'DISPOSE',
} as const;

export const ChannelMessageType = {
  NewSignal: 'NEW_SIGNAL',
} as const;

export const FrameMessageType = {
  Frame: 'FRAME',
} as const;

export type ControlMessageKind = (typeof ControlMessageType)[keyof typeof ControlMessageType];
