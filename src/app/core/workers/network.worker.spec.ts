import { describe, expect, it, vi } from 'vitest';

import { WorkerHost } from '../interfaces/worker-host.interface';
import { NetworkGateway } from './network-gateway';
import { setupNetworkWorker } from './network.worker';

class FakeHost implements WorkerHost {
  handler: ((e: MessageEvent) => void) | null = null;
  posted: unknown[] = [];

  addEventListener(_type: 'message', handler: (e: MessageEvent) => void): void {
    this.handler = handler;
  }
  postMessage(message: unknown): void {
    this.posted.push(message);
  }

  send(data: unknown, ports: MessagePort[] = []): void {
    this.handler?.({ data, ports } as unknown as MessageEvent);
  }
}

function makeFakeGateway() {
  return {
    attachPort: vi.fn(),
    dispose: vi.fn(),
  } as unknown as NetworkGateway & {
    attachPort: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
  };
}

describe('setupNetworkWorker', () => {
  it('registers a single message listener', () => {
    const host = new FakeHost();
    setupNetworkWorker(host, { gateway: makeFakeGateway() });
    expect(host.handler).not.toBeNull();
  });

  describe('INIT_PORTS', () => {
    it('forwards the first transferred port to gateway.attachPort', () => {
      const host = new FakeHost();
      const gateway = makeFakeGateway();
      setupNetworkWorker(host, { gateway });

      const port = {} as MessagePort;
      host.send({ type: 'INIT_PORTS' }, [port]);

      expect(gateway.attachPort).toHaveBeenCalledTimes(1);
      expect(gateway.attachPort).toHaveBeenCalledWith(port);
    });

    it('is a no-op when no ports are transferred', () => {
      const host = new FakeHost();
      const gateway = makeFakeGateway();
      setupNetworkWorker(host, { gateway });

      host.send({ type: 'INIT_PORTS' }, []);

      expect(gateway.attachPort).not.toHaveBeenCalled();
    });
  });

  describe('DISPOSE', () => {
    it('calls gateway.dispose', () => {
      const host = new FakeHost();
      const gateway = makeFakeGateway();
      setupNetworkWorker(host, { gateway });

      host.send({ type: 'DISPOSE' });

      expect(gateway.dispose).toHaveBeenCalledTimes(1);
    });
  });

  describe('unknown commands', () => {
    it('ignores commands the network worker does not handle', () => {
      const host = new FakeHost();
      const gateway = makeFakeGateway();
      setupNetworkWorker(host, { gateway });

      host.send({ type: 'PLAY' });
      host.send({ type: 'SEEK', timestamp: 0 });

      expect(gateway.attachPort).not.toHaveBeenCalled();
      expect(gateway.dispose).not.toHaveBeenCalled();
    });
  });
});
