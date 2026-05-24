export const LogSource = {
  SignalStore: 'SignalStore',
  PlaybackEngine: 'PlaybackEngine',
  NetworkGateway: 'NetworkGateway',
  DBWorker: 'DBWorker',
  NetworkWorker: 'NetworkWorker',
  MapComponent: 'MapComponent',
  ControlPanelComponent: 'ControlPanelComponent',
} as const;

export type LogSource = (typeof LogSource)[keyof typeof LogSource];
