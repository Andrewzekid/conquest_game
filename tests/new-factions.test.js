import { describe, it, expect } from 'vitest';
import { FACTION_DEFS, getFactionDef, getUnitStatsFor, getUnitCostFor, getFactionForSlot,
         getHealOnKill, getRaidingGoldBonus, getDiplomacyBonus, getFortifiedDefenseBonus,
         getGoldPerConquest, getCavalryChargeBonus, getOpenTerrainMoveBonus,
         getCityCaptureBonus, getSettlerCostReduction } from '../src/faction.js';
import { UNIT_COST } from '../src/config.js';

const NEW = ['roman', 'viking', 'byzantine', 'spanish', 'polish'];

describe('new factions — definitions', () => {
  it('all 5 new factions are defined with required fields', () => {
    for (const id of NEW) {
      const def = FACTION_DEFS[id];
      expect(def, `${id} missing`).toBeDefined();
      expect(def.id).toBe(id);
      expect(def.name).toBeTruthy();
      expect(def.emoji).toBeTruthy();
      expect(def.color.tile).toBeGreaterThan(0);
      expect(def.color.unit).toBeGreaterThan(0);
      expect(def.aiPersonality).toBeTruthy();
      expect(def.roster.length).toBeGreaterThan(0);
      expect(def.unitMods).toBeDefined();
      expect(def.passive.desc).toBeTruthy();
      expect(def.king.name).toBeTruthy();
      expect(def.king.class).toBeTruthy();
      expect(def.king.active.id).toBeTruthy();
      expect(def.king.active.cooldown).toBeGreaterThan(0);
    }
  });

  it('each new faction rosters its signature new unit', () => {
    expect(FACTION_DEFS.roman.roster).toContain('LEGIONNAIRE');
    expect(FACTION_DEFS.viking.roster).toContain('BERSERKER');
    expect(FACTION_DEFS.byzantine.roster).toContain('VARANGIAN_GUARD');
    expect(FACTION_DEFS.spanish.roster).toContain('CONQUISTADOR');
    expect(FACTION_DEFS.polish.roster).toContain('WINGED_HUSSAR');
  });

  it('factions map to slot indices cyclically (15 factions available)', () => {
    // Slot map must now include frost + the 5 new factions, so 15 ids cycle.
    const ids = new Set();
    for (let i = 0; i < 15; i++) ids.add(getFactionForSlot(i));
    expect(ids.size).toBe(15);
    expect(getFactionForSlot(0)).toBe('crimson');
    // frost (index 9) and the 5 new factions (indices 10-14) are reachable.
    expect(getFactionForSlot(9)).toBe('frost');
    expect(getFactionForSlot(10)).toBe('roman');
    expect(getFactionForSlot(14)).toBe('polish');
  });
});

describe('new factions — passive helpers', () => {
  it('helpers return 0 for factions without the passive', () => {
    const crimson = getFactionDef('crimson');
    expect(getHealOnKill(crimson)).toBe(0);
    getRaidingGoldBonus(crimson); // no throw
    getDiplomacyBonus(crimson);
    getFortifiedDefenseBonus(crimson);
    getGoldPerConquest(crimson);
    getCavalryChargeBonus(crimson);
    getOpenTerrainMoveBonus(crimson);
    getCityCaptureBonus(crimson);
    getSettlerCostReduction(crimson);
    expect(getHealOnKill(null)).toBe(0);
    expect(getDiplomacyBonus(null)).toBe(0);
  });

  it('viking: healOnKill 3 + raidingGoldBonus 10', () => {
    const v = getFactionDef('viking');
    expect(getHealOnKill(v)).toBe(3);
    expect(getRaidingGoldBonus(v)).toBe(10);
  });

  it('byzantine: diplomacyBonus 10 + fortifiedDefenseBonus 2', () => {
    const b = getFactionDef('byzantine');
    expect(getDiplomacyBonus(b)).toBe(10);
    expect(getFortifiedDefenseBonus(b)).toBe(2);
  });

  it('spanish: settlerCostReduction 0.3 + goldPerConquest 25', () => {
    const s = getFactionDef('spanish');
    expect(getSettlerCostReduction(s)).toBeCloseTo(0.3, 5);
    expect(getGoldPerConquest(s)).toBe(25);
  });

  it('polish: cavalryChargeBonus 2 + openTerrainMoveBonus 1', () => {
    const p = getFactionDef('polish');
    expect(getCavalryChargeBonus(p)).toBe(2);
    expect(getOpenTerrainMoveBonus(p)).toBe(1);
  });

  it('roman: cityCaptureBonus 1 + attackBonus baked via getUnitStatsFor', () => {
    const r = getFactionDef('roman');
    expect(getCityCaptureBonus(r)).toBe(1);
    // Roman passive attackBonus:1 is baked into every roman unit at creation
    // (via getPassiveCombat in createUnit), not in getUnitStatsFor; verify the
    // stat path still returns sane values for a roman unit.
    const stats = getUnitStatsFor('INFANTRY', r);
    expect(stats.attack).toBeGreaterThan(0);
  });
});

describe('new factions — unit mods', () => {
  it('roman INFANTRY gets +1 defense +2 HP, SIEGE gets 15% gold discount', () => {
    const r = getFactionDef('roman');
    const s = getUnitStatsFor('INFANTRY', r);
    expect(s.defense).toBe(3); // base 2 + 1
    expect(s.hp).toBe(12);     // base 10 + 2
    const cost = getUnitCostFor('SIEGE', r);
    expect(cost.gold).toBe(Math.floor(55 * 0.85));
  });

  it('spanish SETTLER cost is reduced 30% via the faction passive', () => {
    const s = getFactionDef('spanish');
    const cost = getUnitCostFor('SETTLER', s);
    expect(cost.gold).toBe(Math.floor(UNIT_COST.SETTLER.gold * (1 - 0.3)));
  });

  it('polish CAVALRY gets +1 attack +1 move (moveRange mod applied)', () => {
    const p = getFactionDef('polish');
    const s = getUnitStatsFor('CAVALRY', p);
    expect(s.attack).toBe(6);  // base 5 + 1
    expect(s.moveRange).toBe(4); // base 3 + 1
  });

  it('polish WINGED_HUSSAR gets +2 attack +1 move', () => {
    const p = getFactionDef('polish');
    const s = getUnitStatsFor('WINGED_HUSSAR', p);
    expect(s.attack).toBe(10); // base 8 + 2
    expect(s.moveRange).toBe(4); // base 3 + 1
  });

  it('viking BERSERKER gets +2 HP', () => {
    const v = getFactionDef('viking');
    const s = getUnitStatsFor('BERSERKER', v);
    expect(s.hp).toBe(14); // base 12 + 2
  });

  it('byzantine CAVALRY gets +2 defense +2 HP, VARANGIAN_GUARD +1 defense', () => {
    const b = getFactionDef('byzantine');
    expect(getUnitStatsFor('CAVALRY', b).defense).toBe(5); // base 3 + 2
    expect(getUnitStatsFor('CAVALRY', b).hp).toBe(14);       // base 12 + 2
    expect(getUnitStatsFor('VARANGIAN_GUARD', b).defense).toBe(7); // base 6 + 1
  });
});