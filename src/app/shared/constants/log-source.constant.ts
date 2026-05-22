/**
 * All recognized log sources. Centralized so `new Logger('Typo')` is a
 * type error and a `grep LogSource` lists every subsystem that emits logs.
 */
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
