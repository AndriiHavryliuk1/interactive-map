/// <reference lib="webworker" />

import { LogSource } from '../../shared/constants/log-source.constant';
import { Logger } from '../../shared/utils/logger';
import { SignalRepository } from '../db/signal-repository';
import { SignalStorage } from '../interfaces/signal-storage.interface';
import { WorkerHost } from '../interfaces/worker-host.interface';
import { ControlCommand, StateFrame, isChannelNewSignal } from '../../shared/models/worker.model';
import { ControlMessageType, FrameMessageType } from '../../shared/constants/worker.constants';
import { PlaybackEngine } from './playback-engine';

export interface DbWorkerSetupDeps {
  openStorage?: () => Promise<SignalStorage>;
  logger?: Logger;
}

export function setupDbWorker(host: WorkerHost, deps: DbWorkerSetupDeps = {}): void {
  const logger = deps.logger ?? new Logger(LogSource.DBWorker);
  const openStorage = deps.openStorage ?? (() => SignalRepository.open());

  let engine: PlaybackEngine | null = null;
  let networkPort: MessagePort | null = null;
  let disposed = false;

  openStorage()
    .then((repository) => {
      if (disposed) {
        repository.close();
        return;
      }
      engine = new PlaybackEngine({
        repository,
        logger,
        postFrame: (frame: StateFrame) => {
          host.postMessage({ type: FrameMessageType.Frame, payload: frame });
        },
      });
      engine.start();
      // The MessageChannel port may have been received before the engine
      // was ready. MessagePort buffers messages until onmessage is set, so
      // wiring the handler now drains any backfill signals queued during
      // IDB open.
      wireNetworkPort();
    })
    .catch((err) => logger.error('Failed to open SignalRepository', err));

  host.addEventListener('message', (event: MessageEvent<ControlCommand>) => {
    const command = event.data;

    // Two unconditional-return branches so TS narrows `command` to
    // DispatchableCommand at the dispatch call below.
    if (command.type === ControlMessageType.InitPorts) {
      if (event.ports.length > 0) {
        networkPort = event.ports[0];
        wireNetworkPort();
      }
      return;
    }

    if (command.type === ControlMessageType.Dispose) {
      disposed = true;
      cleanup();
      return;
    }

    engine?.dispatch(command);
  });

  /**
   * Idempotent: safe to call from either the INIT_PORTS handler (engine
   * may not yet exist) or the openStorage resolution (port may not yet
   * exist). Whichever path runs second installs the handler.
   */
  function wireNetworkPort(): void {
    if (engine === null || networkPort === null) {
      return;
    }
    const enginePtr = engine;
    networkPort.onmessage = (e) => {
      if (disposed) {
        return;
      }
      if (isChannelNewSignal(e.data)) {
        enginePtr.ingestNewSignal(e.data.payload);
      } else {
        logger.warn('Unhandled channel message', e.data);
      }
    };
  }

  function cleanup(): void {
    if (engine !== null) {
      engine.dispose();
      engine = null;
    }
    if (networkPort !== null) {
      networkPort.close();
      networkPort = null;
    }
  }
}

declare const WorkerGlobalScope: { prototype: object } | undefined;
if (typeof WorkerGlobalScope !== 'undefined') {
  setupDbWorker(self as unknown as WorkerHost);
}
