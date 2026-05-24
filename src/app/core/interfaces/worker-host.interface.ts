export interface WorkerHost {
  addEventListener(type: 'message', handler: (event: MessageEvent) => void): void;
  postMessage(message: unknown): void;
}
