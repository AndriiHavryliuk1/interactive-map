/**
 * Subset of the worker global scope that the *.worker.setup functions need.
 * In real workers, `self` satisfies this. In tests, a mock host captures
 * the registered message handler and any outbound postMessage calls so the
 * setup wiring can be exercised without a real Worker.
 */
export interface WorkerHost {
  addEventListener(type: 'message', handler: (event: MessageEvent) => void): void;
  postMessage(message: unknown): void;
}
