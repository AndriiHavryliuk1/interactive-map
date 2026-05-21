import { describe, expect, it } from 'vitest';

import { VertexCountLabelPipe } from './vertex-count-label.pipe';

describe('VertexCountLabelPipe', () => {
  const pipe = new VertexCountLabelPipe();

  describe('singular form ("вершина")', () => {
    it.each([1, 21, 31, 101, 121])('uses "вершина" for %i', (n) => {
      expect(pipe.transform(n)).toBe(`${n} вершина`);
    });
  });

  describe('few form ("вершини")', () => {
    it.each([2, 3, 4, 22, 33, 104])('uses "вершини" for %i', (n) => {
      expect(pipe.transform(n)).toBe(`${n} вершини`);
    });
  });

  describe('many form ("вершин")', () => {
    it.each([0, 5, 6, 9, 10, 20, 25, 100])('uses "вершин" for %i', (n) => {
      expect(pipe.transform(n)).toBe(`${n} вершин`);
    });
  });

  describe('teens (11–14) — Slavic plural special case', () => {
    it.each([11, 12, 13, 14])('uses "вершин" for %i (not singular or few)', (n) => {
      expect(pipe.transform(n)).toBe(`${n} вершин`);
    });

    it.each([111, 112, 113, 114])('uses "вершин" for %i (hundred + teen)', (n) => {
      expect(pipe.transform(n)).toBe(`${n} вершин`);
    });
  });
});
