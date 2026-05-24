import { LogSource } from '../constants/log-source.constant';

export class Logger {
  constructor(private readonly source: LogSource) {}

  debug(message: string, payload?: unknown): void {
    this.emit(console.debug, message, payload);
  }

  info(message: string, payload?: unknown): void {
    this.emit(console.info, message, payload);
  }

  warn(message: string, payload?: unknown): void {
    this.emit(console.warn, message, payload);
  }

  error(message: string, payload?: unknown): void {
    this.emit(console.error, message, payload);
  }

  private emit(method: (...args: unknown[]) => void, message: string, payload?: unknown): void {
    const prefix = `[${this.source}]`;
    if (payload !== undefined) {
      method(prefix, message, payload);
    } else {
      method(prefix, message);
    }
  }
}
