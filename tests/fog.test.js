import { describe, it, expect, beforeEach } from 'vitest';
import { setGridDimensions } from '../src/config.js';
import { computeVisibility, updateExplored, VISION_RADIUS } from '../src/fog.js';

describe('fog', () => {
  beforeEach(() => {
    setGridDimensions(20, 20);
  });

  describe('computeVisibility', () => {
    it('single source reveals radius', () => {
      const visible = computeVisibility([{ x: 10, z: 10 }]);
      expect(visible.has('10,10')).toBe(true);
      expect(visible.has('11,10')).toBe(true);
      expect(visible.has('10,11')).toBe(true);
    });

    it('multiple sources merge', () => {
      const visible = computeVisibility([{ x: 5, z: 5 }, { x: 15, z: 15 }]);
      expect(visible.has('5,5')).toBe(true);
      expect(visible.has('15,15')).toBe(true);
    });

    it('out-of-bounds excluded', () => {
      const visible = computeVisibility([{ x: 0, z: 0, radius: 5 }]);
      // Tiles at negative coords should not be included
      for (const k of visible) {
        const [x, z] = k.split(',').map(Number);
        expect(x).toBeGreaterThanOrEqual(0);
        expect(z).toBeGreaterThanOrEqual(0);
      }
    });

    it('default radius is 3', () => {
      const visible = computeVisibility([{ x: 10, z: 10 }]);
      expect(visible.has('10,10')).toBe(true);
      expect(visible.has('14,10')).toBe(false); // distance 4, outside radius 3
    });

    it('custom radius works', () => {
      const visible = computeVisibility([{ x: 10, z: 10, radius: 1 }]);
      expect(visible.has('10,10')).toBe(true);
      expect(visible.has('11,10')).toBe(true);
      expect(visible.has('12,10')).toBe(false);
    });
  });

  describe('updateExplored', () => {
    it('adds visible to explored', () => {
      const explored = new Set(['0,0']);
      const visible = new Set(['1,1', '2,2']);
      updateExplored(explored, visible);
      expect(explored.has('1,1')).toBe(true);
      expect(explored.has('2,2')).toBe(true);
    });

    it('idempotent', () => {
      const explored = new Set(['1,1']);
      const visible = new Set(['1,1']);
      updateExplored(explored, visible);
      expect(explored.size).toBe(1);
    });

    it('mutates input', () => {
      const explored = new Set();
      const visible = new Set(['5,5']);
      const result = updateExplored(explored, visible);
      expect(result).toBe(explored);
    });
  });
});
