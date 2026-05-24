import { afterEach, describe, expect, it, vi } from 'vitest';

import { LogSource } from '../constants/log-source.constant';
import { Logger } from './logger';

describe('Logger', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    ['debug', 'debug'],
    ['info', 'info'],
    ['warn', 'warn'],
    ['error', 'error'],
  ] as const)('%s() routes to console.%s with the source prefix', (method, consoleMethod) => {
    const spy = vi.spyOn(console, consoleMethod).mockImplementation(() => {});
    new Logger(LogSource.MapComponent)[method]('hi');
    expect(spy).toHaveBeenCalledWith(`[${LogSource.MapComponent}]`, 'hi');
  });

  it('appends payload as a trailing arg when present', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const err = { code: 42 };
    new Logger(LogSource.MapComponent).error('failed', err);
    expect(spy).toHaveBeenCalledWith(`[${LogSource.MapComponent}]`, 'failed', err);
  });

  it('omits payload when not provided (no trailing undefined)', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    new Logger(LogSource.SignalStore).warn('just a message');
    expect(spy).toHaveBeenCalledWith(`[${LogSource.SignalStore}]`, 'just a message');
    // Specifically, two args — not three with a trailing undefined.
    expect(spy.mock.calls[0]).toHaveLength(2);
  });

  it('tags each instance with its own source', () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
    new Logger(LogSource.SignalStore).info('a');
    new Logger(LogSource.MapComponent).info('b');
    expect(spy).toHaveBeenNthCalledWith(1, `[${LogSource.SignalStore}]`, 'a');
    expect(spy).toHaveBeenNthCalledWith(2, `[${LogSource.MapComponent}]`, 'b');
  });
});
