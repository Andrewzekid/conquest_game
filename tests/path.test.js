import { describe, it, expect, beforeEach } from 'vitest';
import { setGridDimensions } from '../src/config.js';
import { nextStepToward, goalValid } from '../src/path.js';

describe('path', () => {
  beforeEach(() => {
    setGridDimensions(20, 20);
  });

  function makeTiles(size = 10) {
    const tiles = new Map();
    for (let x = 0; x < size; x++) {
      for (let z = 0; z < size; z++) {
        tiles.set(`${x},${z}`, { x, z, terrain: 'PLAINS' });
      }
    }
    return tiles;
  }

  describe('nextStepToward', () => {
    it('returns next step toward goal', () => {
      const tiles = makeTiles();
      const units = new Map();
      const unit = { id: 1, type: 'INFANTRY', owner: 'player', x: 5, z: 5 };
      const step = nextStepToward(tiles, units, unit, { x: 8, z: 5 });
      expect(step).not.toBeNull();
      expect(step.x).toBe(6);
      expect(step.z).toBe(5);
    });

    it('returns null if at goal', () => {
      const tiles = makeTiles();
      const units = new Map();
      const unit = { id: 1, type: 'INFANTRY', owner: 'player', x: 5, z: 5 };
      expect(nextStepToward(tiles, units, unit, { x: 5, z: 5 })).toBeNull();
    });

    it('returns null for null goal', () => {
      const tiles = makeTiles();
      const units = new Map();
      const unit = { id: 1, type: 'INFANTRY', owner: 'player', x: 5, z: 5 };
      expect(nextStepToward(tiles, units, unit, null)).toBeNull();
    });

    it('avoids enemy-occupied tiles', () => {
      const tiles = makeTiles();
      const enemy = { id: 2, type: 'INFANTRY', owner: 'ai1', x: 6, z: 5 };
      const units = new Map([['2', enemy]]);
      const unit = { id: 1, type: 'INFANTRY', owner: 'player', x: 5, z: 5 };
      const step = nextStepToward(tiles, units, unit, { x: 8, z: 5 });
      if (step) {
        expect(step.x).not.toBe(6); // should not step onto enemy
      }
    });

    it('lord pathing ignores own units', () => {
      const tiles = makeTiles();
      const friendly = { id: 2, type: 'INFANTRY', owner: 'player', x: 6, z: 5 };
      const units = new Map([['2', friendly]]);
      const lord = { id: 1, type: 'LORD', owner: 'player', x: 5, z: 5 };
      const step = nextStepToward(tiles, units, lord, { x: 8, z: 5 }, 200, 'player');
      expect(step).not.toBeNull();
    });

    it('naval units traverse water', () => {
      const tiles = new Map();
      for (let x = 0; x < 10; x++) {
        for (let z = 0; z < 10; z++) {
          tiles.set(`${x},${z}`, { x, z, terrain: 'WATER' });
        }
      }
      const units = new Map();
      const ship = { id: 1, type: 'GALLEY', owner: 'player', x: 5, z: 5 };
      const step = nextStepToward(tiles, units, ship, { x: 8, z: 5 });
      expect(step).not.toBeNull();
    });
  });

  describe('goalValid', () => {
    it('true for existing tile', () => {
      const tiles = makeTiles();
      const unit = { type: 'INFANTRY' };
      expect(goalValid(tiles, unit, { x: 5, z: 5 })).toBe(true);
    });

    it('false for null goal', () => {
      const tiles = makeTiles();
      const unit = { type: 'INFANTRY' };
      expect(goalValid(tiles, unit, null)).toBe(false);
    });

    it('false for missing tile', () => {
      const tiles = makeTiles();
      const unit = { type: 'INFANTRY' };
      expect(goalValid(tiles, unit, { x: 100, z: 100 })).toBe(false);
    });
  });
});
