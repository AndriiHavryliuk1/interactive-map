import { describe, expect, it } from 'vitest';

import { clamp, lowerBound } from './utils';

describe('clamp', () => {
  it('returns the value when it falls within [min, max]', () => {
    expect(clamp(5, 0, 10)).toBe(5);
  });

  it('returns min when the value is below', () => {
    expect(clamp(-3, 0, 10)).toBe(0);
  });

  it('returns max when the value is above', () => {
    expect(clamp(15, 0, 10)).toBe(10);
  });

  it('treats the boundaries as inclusive', () => {
    expect(clamp(0, 0, 10)).toBe(0);
    expect(clamp(10, 0, 10)).toBe(10);
  });

  it('works with fully negative ranges', () => {
    expect(clamp(-5, -10, -1)).toBe(-5);
    expect(clamp(-20, -10, -1)).toBe(-10);
    expect(clamp(0, -10, -1)).toBe(-1);
  });

  it('returns the single allowed value when min === max', () => {
    expect(clamp(5, 7, 7)).toBe(7);
    expect(clamp(9, 7, 7)).toBe(7);
    expect(clamp(7, 7, 7)).toBe(7);
  });

  it('preserves non-integer values within range', () => {
    expect(clamp(1.5, 1, 2)).toBe(1.5);
    expect(clamp(2.5, 1, 2)).toBe(2);
  });
});

describe('lowerBound', () => {
  const byTimestamp = (x: { timestamp: number }) => x.timestamp;

  it('returns 0 on an empty array', () => {
    expect(lowerBound([], byTimestamp, 5)).toBe(0);
  });

  it('returns 0 when the target is before all elements', () => {
    const arr = [{ timestamp: 5 }, { timestamp: 10 }, { timestamp: 15 }];
    expect(lowerBound(arr, byTimestamp, 0)).toBe(0);
  });

  it('returns arr.length when the target is after all elements', () => {
    const arr = [{ timestamp: 5 }, { timestamp: 10 }, { timestamp: 15 }];
    expect(lowerBound(arr, byTimestamp, 20)).toBe(3);
  });

  it('returns the index of the exact match', () => {
    const arr = [{ timestamp: 5 }, { timestamp: 10 }, { timestamp: 15 }];
    expect(lowerBound(arr, byTimestamp, 10)).toBe(1);
  });

  it('returns the first index of a duplicate run', () => {
    const arr = [
      { timestamp: 5 },
      { timestamp: 10 },
      { timestamp: 10 },
      { timestamp: 10 },
      { timestamp: 15 },
    ];
    expect(lowerBound(arr, byTimestamp, 10)).toBe(1);
  });

  it('returns the index of the next element when target is between two values', () => {
    const arr = [{ timestamp: 5 }, { timestamp: 10 }, { timestamp: 15 }];
    expect(lowerBound(arr, byTimestamp, 7)).toBe(1);
    expect(lowerBound(arr, byTimestamp, 12)).toBe(2);
  });

  it('matches at the first-element boundary', () => {
    expect(lowerBound([{ timestamp: 5 }, { timestamp: 10 }], byTimestamp, 5)).toBe(0);
  });

  it('matches at the last-element boundary', () => {
    expect(lowerBound([{ timestamp: 5 }, { timestamp: 10 }], byTimestamp, 10)).toBe(1);
  });

  it('works with a single-element array', () => {
    const arr = [{ timestamp: 5 }];
    expect(lowerBound(arr, byTimestamp, 3)).toBe(0);
    expect(lowerBound(arr, byTimestamp, 5)).toBe(0);
    expect(lowerBound(arr, byTimestamp, 7)).toBe(1);
  });

  it('accepts an arbitrary key extractor', () => {
    const items = [
      { id: 'a', score: 1 },
      { id: 'b', score: 3 },
      { id: 'c', score: 5 },
    ];
    expect(lowerBound(items, (i) => i.score, 4)).toBe(2);
  });

  it('handles negative timestamps and zero correctly', () => {
    const arr = [{ timestamp: -10 }, { timestamp: -5 }, { timestamp: 0 }, { timestamp: 5 }];
    expect(lowerBound(arr, byTimestamp, -7)).toBe(1);
    expect(lowerBound(arr, byTimestamp, 0)).toBe(2);
    expect(lowerBound(arr, byTimestamp, -100)).toBe(0);
  });

  it('stays correct on a large sorted input', () => {
    const arr = Array.from({ length: 10000 }, (_, i) => ({ timestamp: i * 2 }));
    expect(lowerBound(arr, byTimestamp, 5000)).toBe(2500);
    expect(lowerBound(arr, byTimestamp, 5001)).toBe(2501);
    expect(lowerBound(arr, byTimestamp, 19999)).toBe(10000);
  });
});
