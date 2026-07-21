import { describe, it, expect } from 'vitest';
import { resolveCombat, isEncircled, canCaptureTile, captureTile, processLoyalty, simulateCombat } from '../src/battle.js';

function makeUnit(type, owner, x, z, overrides = {}) {
  const defaults = {
    INFANTRY: { hp: 10, maxHp: 10, attack: 3, defense: 2, moveRange: 2, type: 'INFANTRY' },
    ARCHER: { hp: 8, maxHp: 8, attack: 4, defense: 1, moveRange: 2, type: 'ARCHER', ranged: true },
    CAVALRY: { hp: 12, maxHp: 12, attack: 5, defense: 3, moveRange: 3, type: 'CAVALRY' },
  };
  return { id: Math.random(), owner, x, z, level: 1, xp: 0, ...defaults[type], ...overrides };
}

describe('battle', () => {
  describe('resolveCombat', () => {
    it('returns early if either unit is null', () => {
      const result = resolveCombat(null, makeUnit('INFANTRY', 'a', 0, 0), 'PLAINS');
      expect(result.defenderDied).toBe(false);
      expect(result.damageToDefender).toBe(0);
    });

    it('deals damage to defender', () => {
      const atk = makeUnit('INFANTRY', 'a', 0, 0);
      const def = makeUnit('INFANTRY', 'b', 1, 0);
      const result = resolveCombat(atk, def, 'PLAINS');
      expect(result.damageToDefender).toBeGreaterThan(0);
      expect(def.hp).toBeLessThan(def.maxHp);
    });

    it('kills low-HP defender', () => {
      const atk = makeUnit('INFANTRY', 'a', 0, 0, { attack: 100 });
      const def = makeUnit('INFANTRY', 'b', 1, 0, { hp: 1, maxHp: 10 });
      const result = resolveCombat(atk, def, 'PLAINS');
      expect(result.defenderDied).toBe(true);
    });

    it('encircled defender gets -2 defense and no counter', () => {
      const atk = makeUnit('INFANTRY', 'a', 0, 0, { attack: 10 });
      const def = makeUnit('INFANTRY', 'b', 1, 0, { hp: 50, maxHp: 50 });
      const result = resolveCombat(atk, def, 'PLAINS', null, null, null, null, null, true);
      expect(result.messages.some(m => m.includes('encircled'))).toBe(true);
    });

    it('ranged attacker does not trigger counter', () => {
      const atk = makeUnit('ARCHER', 'a', 0, 0);
      const def = makeUnit('INFANTRY', 'b', 1, 0, { hp: 50, maxHp: 50 });
      const result = resolveCombat(atk, def, 'PLAINS');
      expect(result.messages.some(m => m.includes('counter-attack'))).toBe(false);
    });

    it('breached city loses terrain defense', () => {
      const atk = makeUnit('INFANTRY', 'a', 0, 0, { attack: 100 });
      const def = makeUnit('INFANTRY', 'b', 1, 0, { hp: 100, maxHp: 100 });
      const result = resolveCombat(atk, def, 'CITY', null, null, null, null, null, false, null, true);
      expect(result.messages.some(m => m.includes('breached'))).toBe(true);
    });

    it('type advantage message appears', () => {
      const atk = makeUnit('INFANTRY', 'a', 0, 0);
      const def = makeUnit('ARCHER', 'b', 1, 0, { hp: 50, maxHp: 50 });
      const result = resolveCombat(atk, def, 'PLAINS');
      expect(result.messages.some(m => m.includes('type advantage'))).toBe(true);
    });
  });

  describe('isEncircled', () => {
    it('returns false for null inputs', () => {
      expect(isEncircled(null, new Map(), new Map())).toBe(false);
    });

    it('naval units are never encircled', () => {
      const def = makeUnit('GALLEY', 'b', 5, 5, { type: 'GALLEY' });
      const units = new Map([['1', def]]);
      const tiles = new Map();
      expect(isEncircled(def, units, tiles)).toBe(false);
    });

    it('friendly neighbor means not encircled', () => {
      const def = makeUnit('INFANTRY', 'b', 5, 5);
      const friendly = makeUnit('INFANTRY', 'b', 5, 6);
      const units = new Map([['1', def], ['2', friendly]]);
      const tiles = new Map();
      for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
          if (dx === 0 && dz === 0) continue;
          tiles.set(`${5 + dx},${5 + dz}`, { terrain: 'PLAINS' });
        }
      }
      expect(isEncircled(def, units, tiles)).toBe(false);
    });
  });

  describe('canCaptureTile', () => {
    it('requires >= 20 gold', () => {
      const tile = { owner: null, terrain: 'PLAINS' };
      expect(canCaptureTile('a', tile, { gold: 19 })).toBe(false);
      expect(canCaptureTile('a', tile, { gold: 20 })).toBe(true);
    });

    it('cannot capture own tile', () => {
      const tile = { owner: 'a', terrain: 'PLAINS' };
      expect(canCaptureTile('a', tile, { gold: 100 })).toBe(false);
    });

    it('cannot capture fortified city', () => {
      const tile = { owner: 'b', terrain: 'CITY', fortification: 3 };
      expect(canCaptureTile('a', tile, { gold: 100 })).toBe(false);
    });

    it('can capture unfortified city', () => {
      const tile = { owner: 'b', terrain: 'CITY', fortification: 0 };
      expect(canCaptureTile('a', tile, { gold: 100 })).toBe(true);
    });
  });

  describe('captureTile', () => {
    it('deducts 20 gold and sets owner', () => {
      const tile = { x: 1, z: 2, owner: null };
      const resources = { gold: 100 };
      captureTile(tile, 'a', resources);
      expect(resources.gold).toBe(80);
      expect(tile.owner).toBe('a');
      expect(tile.loyalty).toBe(3);
    });
  });

  describe('processLoyalty', () => {
    it('decrements loyalty', () => {
      const tile = { x: 0, z: 0, owner: 'a', loyalty: 2 };
      const tiles = new Map([['0,0', tile]]);
      processLoyalty(tiles, 'a');
      expect(tile.loyalty).toBe(1);
    });
  });

  describe('simulateCombat', () => {
    it('does not mutate original units', () => {
      const atk = makeUnit('INFANTRY', 'a', 0, 0);
      const def = makeUnit('INFANTRY', 'b', 1, 0);
      const origAtkHp = atk.hp;
      const origDefHp = def.hp;
      simulateCombat(atk, def, 'PLAINS');
      expect(atk.hp).toBe(origAtkHp);
      expect(def.hp).toBe(origDefHp);
    });

    it('returns damage estimates', () => {
      const atk = makeUnit('INFANTRY', 'a', 0, 0);
      const def = makeUnit('INFANTRY', 'b', 1, 0);
      const result = simulateCombat(atk, def, 'PLAINS');
      expect(result.damageToDefender).toBeGreaterThanOrEqual(0);
    });

    it('returns zeros for null inputs', () => {
      const result = simulateCombat(null, null, 'PLAINS');
      expect(result.damageToDefender).toBe(0);
      expect(result.damageToAttacker).toBe(0);
    });
  });
});
