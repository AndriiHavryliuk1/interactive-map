/// <reference lib="webworker" />

import { LogSource } from '../../shared/constants/log-source.constant';
import { Logger } from '../../shared/utils/logger';
import { ControlCommand } from '../../shared/models/worker.model';
import { ControlMessageType } from '../../shared/constants/worker.constants';
import { WorkerHost } from '../interfaces/worker-host.interface';
import { NetworkGateway } from './network-gateway';

export interface NetworkWorkerSetupDeps {
  /** Override the gateway instance — tests pass a fake. */
  gateway?: NetworkGateway;
  logger?: Logger;
}

/**
 * Wire the network worker's message dispatch onto a host. Exported so the
 * wiring is unit-testable with a mock host; called at module-load time in
 * real workers via the guard below.
 */
export function setupNetworkWorker(host: WorkerHost, deps: NetworkWorkerSetupDeps = {}): void {
  const logger = deps.logger ?? new Logger(LogSource.NetworkWorker);
  const gateway = deps.gateway ?? new NetworkGateway({ logger });

  host.addEventListener('message', (event: MessageEvent<ControlCommand>) => {
    const command = event.data;

    if (command.type === ControlMessageType.InitPorts) {
      if (event.ports.length > 0) {
        gateway.attachPort(event.ports[0]);
      }
      return;
    }

    if (command.type === ControlMessageType.Dispose) {
      gateway.dispose();
      return;
    }
  });
}

// Production wiring: see db.worker.ts for rationale.
declare const WorkerGlobalScope: { prototype: object } | undefined;
if (typeof WorkerGlobalScope !== 'undefined') {
  setupNetworkWorker(self as unknown as WorkerHost);
}
