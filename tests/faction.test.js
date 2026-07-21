import { describe, it, expect } from 'vitest';
import {
  getFactionDef, getUnitCostFor, getUnitStatsFor, getPassiveCombat,
  getFactionVision, getTerrainDefenseBonus, getSiegePowerBonus,
  getNavalAttackBonus, getFreeConcealTurns, FACTION_DEFS, FACTION_IDS
} from '../src/faction.js';

describe('faction', () => {
  describe('getFactionDef', () => {
    it('returns correct def', () => {
      const def = getFactionDef('crimson');
      expect(def).toBeDefined();
      expect(def.name).toBe('Crimson Legion');
    });

    it('null for unknown', () => {
      expect(getFactionDef('nonexistent')).toBeNull();
    });
  });

  describe('getUnitCostFor', () => {
    it('applies costGoldMult', () => {
      const def = getFactionDef('crimson');
      const cost = getUnitCostFor('CAVALRY', def);
      expect(cost.gold).toBeLessThan(50); // base is 50, crimson has 0.75x
    });

    it('returns copy, not mutated', () => {
      const def = getFactionDef('crimson');
      const cost1 = getUnitCostFor('CAVALRY', def);
      const cost2 = getUnitCostFor('CAVALRY', def);
      expect(cost1.gold).toBe(cost2.gold);
    });
  });

  describe('getUnitStatsFor', () => {
    it('applies unitMods', () => {
      const def = getFactionDef('crimson');
      const stats = getUnitStatsFor('CAVALRY', def);
      expect(stats.attack).toBeGreaterThan(5); // base 5 + crimson mod 1
    });

    it('golden cavalry move bonus', () => {
      const def = getFactionDef('golden');
      const stats = getUnitStatsFor('CAVALRY', def);
      expect(stats.moveRange).toBeGreaterThan(3); // base 3 + 1 bonus
    });

    it('storm naval move bonus', () => {
      const def = getFactionDef('storm');
      const stats = getUnitStatsFor('GALLEY', def);
      expect(stats.moveRange).toBeGreaterThan(4); // base 4 + 1 bonus
    });
  });

  describe('getPassiveCombat', () => {
    it('crimson gives +1 attack', () => {
      const def = getFactionDef('crimson');
      expect(getPassiveCombat(def).attack).toBe(1);
    });

    it('azure gives +1 defense', () => {
      const def = getFactionDef('azure');
      expect(getPassiveCombat(def).defense).toBe(1);
    });

    it('null returns zeros', () => {
      expect(getPassiveCombat(null)).toEqual({ attack: 0, defense: 0 });
    });
  });

  describe('getFactionVision', () => {
    it('base 3 for most factions', () => {
      expect(getFactionVision(getFactionDef('crimson'))).toBe(3);
    });

    it('violet gets +2', () => {
      expect(getFactionVision(getFactionDef('violet'))).toBe(5);
    });

    it('null returns 3', () => {
      expect(getFactionVision(null)).toBe(3);
    });
  });

  describe('getTerrainDefenseBonus', () => {
    it('frost gets bonus in FOREST', () => {
      const def = getFactionDef('frost');
      expect(getTerrainDefenseBonus(def, 'FOREST')).toBe(2);
    });

    it('frost gets bonus in TUNDRA', () => {
      const def = getFactionDef('frost');
      expect(getTerrainDefenseBonus(def, 'TUNDRA')).toBe(2);
    });

    it('non-frost returns 0', () => {
      expect(getTerrainDefenseBonus(getFactionDef('crimson'), 'FOREST')).toBe(0);
    });

    it('null returns 0', () => {
      expect(getTerrainDefenseBonus(null, 'FOREST')).toBe(0);
    });
  });

  describe('getSiegePowerBonus', () => {
    it('iron gets +2', () => {
      expect(getSiegePowerBonus(getFactionDef('iron'))).toBe(2);
    });

    it('non-iron returns 0', () => {
      expect(getSiegePowerBonus(getFactionDef('crimson'))).toBe(0);
    });
  });

  describe('getNavalAttackBonus', () => {
    it('storm gets +2', () => {
      expect(getNavalAttackBonus(getFactionDef('storm'))).toBe(2);
    });

    it('non-storm returns 0', () => {
      expect(getNavalAttackBonus(getFactionDef('crimson'))).toBe(0);
    });
  });

  describe('getFreeConcealTurns', () => {
    it('shadow gets 1', () => {
      expect(getFreeConcealTurns(getFactionDef('shadow'))).toBe(1);
    });

    it('non-shadow returns 0', () => {
      expect(getFreeConcealTurns(getFactionDef('crimson'))).toBe(0);
    });
  });

  describe('FACTION_IDS', () => {
    it('has 15 factions', () => {
      expect(FACTION_IDS.length).toBe(15);
    });

    it('all have definitions', () => {
      for (const id of FACTION_IDS) {
        expect(FACTION_DEFS[id]).toBeDefined();
      }
    });

    it('includes the 5 new European factions', () => {
      for (const id of ['roman', 'viking', 'byzantine', 'spanish', 'polish']) {
        expect(FACTION_IDS).toContain(id);
        const def = FACTION_DEFS[id];
        expect(def.roster.length).toBeGreaterThan(0);
        expect(def.king.active.id).toBeTruthy();
        expect(def.passive.desc).toBeTruthy();
      }
    });
  });
});
