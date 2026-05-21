export function lowerBound<T>(
  arr: readonly T[],
  key: (item: T) => number,
  target: number,
): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (key(arr[mid]) < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}
