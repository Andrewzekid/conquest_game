import { describe, it, expect } from 'vitest';
import {
  createUnit, awardUnitXP, getUnitStats, canAfford, spendCost,
  canCapture, getReachableTiles, getAttackTargets
} from '../src/unit.js';
import { setGridDimensions } from '../src/config.js';

describe('unit', () => {
  describe('createUnit', () => {
    it('creates unit with correct type and owner', () => {
      const u = createUnit('INFANTRY', 'player', 5, 5);
      expect(u.type).toBe('INFANTRY');
      expect(u.owner).toBe('player');
      expect(u.x).toBe(5);
      expect(u.z).toBe(5);
    });

    it('level 1 by default', () => {
      const u = createUnit('INFANTRY', 'player', 0, 0);
      expect(u.level).toBe(1);
    });

    it('veteran option sets level 2', () => {
      const u = createUnit('INFANTRY', 'player', 0, 0, { veteran: true });
      expect(u.level).toBe(2);
    });

    it('veteran number sets specific level', () => {
      const u = createUnit('INFANTRY', 'player', 0, 0, { veteran: 3 });
      expect(u.level).toBe(3);
    });

    it('throws for unknown type', () => {
      expect(() => createUnit('UNKNOWN', 'player', 0, 0)).toThrow();
    });

    it('HP scales with level', () => {
      const u1 = createUnit('INFANTRY', 'player', 0, 0);
      const u3 = createUnit('INFANTRY', 'player', 0, 0, { veteran: 3 });
      expect(u3.maxHp).toBeGreaterThan(u1.maxHp);
    });
  });

  describe('awardUnitXP', () => {
    it('awards XP', () => {
      const u = createUnit('INFANTRY', 'player', 0, 0);
      awardUnitXP(u, 10);
      expect(u.xp).toBe(10);
    });

    it('level up at threshold', () => {
      const u = createUnit('INFANTRY', 'player', 0, 0);
      const msgs = awardUnitXP(u, 30);
      expect(u.level).toBe(2);
      expect(msgs.some(m => m.includes('Lv.2'))).toBe(true);
    });

    it('stat increases on level up', () => {
      const u = createUnit('INFANTRY', 'player', 0, 0);
      const origAtk = u.attack;
      awardUnitXP(u, 30);
      expect(u.attack).toBeGreaterThan(origAtk);
    });

    it('multiple level-ups possible', () => {
      const u = createUnit('INFANTRY', 'player', 0, 0);
      awardUnitXP(u, 100);
      expect(u.level).toBeGreaterThan(2);
    });

    it('null-safe', () => {
      expect(awardUnitXP(null)).toEqual([]);
    });
  });

  describe('getUnitStats', () => {
    it('returns correct stats', () => {
      const u = createUnit('INFANTRY', 'player', 0, 0);
      const stats = getUnitStats(u);
      expect(stats.attack).toBe(u.attack);
      expect(stats.hp).toBe(u.hp);
      expect(stats.maxHp).toBe(u.maxHp);
    });
  });

  describe('canAfford', () => {
    it('true when resources sufficient', () => {
      expect(canAfford('INFANTRY', { gold: 100, food: 100, wood: 100, iron: 100, production: 100 })).toBe(true);
    });

    it('false when insufficient', () => {
      expect(canAfford('INFANTRY', { gold: 0, food: 0, wood: 0, iron: 0, production: 0 })).toBe(false);
    });

    it('false for unknown type', () => {
      expect(canAfford('UNKNOWN', { gold: 100, food: 100, wood: 100, iron: 100, production: 100 })).toBe(false);
    });
  });

  describe('spendCost', () => {
    it('returns new object without mutating input', () => {
      const res = { gold: 100, food: 100, wood: 100, iron: 100, production: 100 };
      const result = spendCost('INFANTRY', res);
      expect(result.gold).toBeLessThan(100);
      expect(res.gold).toBe(100);
    });
  });

  describe('canCapture', () => {
    it('true when gold >= 20', () => {
      expect(canCapture({ gold: 20 })).toBe(true);
    });

    it('false when gold < 20', () => {
      expect(canCapture({ gold: 19 })).toBe(false);
    });
  });

  describe('getReachableTiles', () => {
    it('returns tiles within move range', () => {
      setGridDimensions(20, 20);
      const tiles = new Map();
      for (let x = 0; x < 10; x++) {
        for (let z = 0; z < 10; z++) {
          tiles.set(`${x},${z}`, { x, z, terrain: 'PLAINS' });
        }
      }
      const u = createUnit('INFANTRY', 'player', 5, 5);
      const reachable = getReachableTiles(u, tiles);
      expect(reachable.has('5,5')).toBe(false); // excludes current tile
      expect(reachable.has('6,5')).toBe(true);
    });

    it('skips WATER for land units', () => {
      setGridDimensions(20, 20);
      const tiles = new Map();
      for (let x = 0; x < 10; x++) {
        for (let z = 0; z < 10; z++) {
          tiles.set(`${x},${z}`, { x, z, terrain: 'PLAINS' });
        }
      }
      tiles.set('6,5', { x: 6, z: 5, terrain: 'WATER' });
      const u = createUnit('INFANTRY', 'player', 5, 5);
      const reachable = getReachableTiles(u, tiles);
      expect(reachable.has('6,5')).toBe(false);
    });

    it('naval units only reach WATER/RIVER', () => {
      setGridDimensions(20, 20);
      const tiles = new Map();
      for (let x = 0; x < 10; x++) {
        for (let z = 0; z < 10; z++) {
          tiles.set(`${x},${z}`, { x, z, terrain: 'WATER' });
        }
      }
      tiles.set('5,5', { x: 5, z: 5, terrain: 'WATER' });
      const u = createUnit('GALLEY', 'player', 5, 5);
      const reachable = getReachableTiles(u, tiles);
      expect(reachable.size).toBeGreaterThan(0);
    });
  });

  describe('getAttackTargets', () => {
    it('returns enemies in range', () => {
      const u = createUnit('INFANTRY', 'player', 5, 5);
      const enemy = createUnit('INFANTRY', 'ai1', 6, 5);
      const units = new Map([['1', u], ['2', enemy]]);
      const targets = getAttackTargets(u, units);
      expect(targets).toContain(enemy);
    });

    it('excludes friendly units', () => {
      const u = createUnit('INFANTRY', 'player', 5, 5);
      const friendly = createUnit('INFANTRY', 'player', 6, 5);
      const units = new Map([['1', u], ['2', friendly]]);
      const targets = getAttackTargets(u, units);
      expect(targets).toHaveLength(0);
    });

    it('excludes boarded units', () => {
      const u = createUnit('INFANTRY', 'player', 5, 5);
      const boarded = createUnit('INFANTRY', 'ai1', 6, 5);
      boarded.boarded = true;
      const units = new Map([['1', u], ['2', boarded]]);
      const targets = getAttackTargets(u, units);
      expect(targets).toHaveLength(0);
    });

    it('null-safe', () => {
      expect(getAttackTargets(null, new Map())).toEqual([]);
    });
  });
});
