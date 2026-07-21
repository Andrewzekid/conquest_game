import { describe, it, expect } from 'vitest';
import { UNIT_TYPE, UNIT_COST, EXTRA_UNITS, MAX_FACTIONS, FACTION_COLORS } from '../src/config.js';
import { createUnit } from '../src/unit.js';
import { resolveCombat } from '../src/battle.js';

const NEW_UNITS = ['LEGIONNAIRE', 'BERSERKER', 'VARANGIAN_GUARD', 'CONQUISTADOR', 'WINGED_HUSSAR', 'CROSSBOWMAN'];

describe('new units — definitions', () => {
  it('all 6 new unit types exist in UNIT_TYPE with required fields', () => {
    for (const id of NEW_UNITS) {
      const u = UNIT_TYPE[id];
      expect(u, `${id} missing`).toBeDefined();
      expect(u.name).toBeTruthy();
      expect(typeof u.hp).toBe('number');
      expect(typeof u.attack).toBe('number');
      expect(typeof u.defense).toBe('number');
      expect(typeof u.moveRange).toBe('number');
      expect(u.upkeep).toBeDefined();
    }
  });

  it('all 6 new units have a UNIT_COST entry', () => {
    for (const id of NEW_UNITS) {
      expect(UNIT_COST[id], `${id} cost missing`).toBeDefined();
      expect(UNIT_COST[id].production).toBeGreaterThan(0);
      expect(UNIT_COST[id].gold).toBeGreaterThan(0);
    }
  });

  it('all 6 new units are in EXTRA_UNITS (trainable by every faction)', () => {
    for (const id of NEW_UNITS) {
      expect(EXTRA_UNITS).toContain(id);
    }
  });

  it('LEGIONNAIRE is a durable tank (HP14, DEF5, move1) and can build structures', () => {
    const u = UNIT_TYPE.LEGIONNAIRE;
    expect(u.hp).toBe(14);
    expect(u.defense).toBe(5);
    expect(u.moveRange).toBe(1);
    expect(u.canBuildStructure).toBe(true);
  });

  it('BERSERKER is a glass cannon (ATK9, DEF1) with frenzy + noMedic', () => {
    const u = UNIT_TYPE.BERSERKER;
    expect(u.attack).toBe(9);
    expect(u.defense).toBe(1);
    expect(u.frenzy).toBe(true);
    expect(u.noMedic).toBe(true);
  });

  it('VARANGIAN_GUARD is an elite bodyguard with lordGuard flag', () => {
    expect(UNIT_TYPE.VARANGIAN_GUARD.hp).toBe(16);
    expect(UNIT_TYPE.VARANGIAN_GUARD.lordGuard).toBe(true);
  });

  it('CONQUISTADOR is a ranged mounted unit with a city bonus', () => {
    const u = UNIT_TYPE.CONQUISTADOR;
    expect(u.ranged).toBe(true);
    expect(u.attackRange).toBe(2);
    expect(u.cityBonus).toBe(2);
    expect(u.moveRange).toBe(3);
  });

  it('WINGED_HUSSAR has a 2x first-strike multiplier + open-terrain move bonus', () => {
    const u = UNIT_TYPE.WINGED_HUSSAR;
    expect(u.chargeMultiplier).toBe(2);
    expect(u.openTerrainMoveBonus).toBe(1);
    expect(u.hp).toBe(18);
  });

  it('CROSSBOWMAN is a long-range ranged unit (range 3)', () => {
    const u = UNIT_TYPE.CROSSBOWMAN;
    expect(u.ranged).toBe(true);
    expect(u.attackRange).toBe(3);
    expect(u.attack).toBe(7);
  });
});

describe('new units — faction colors + slot count', () => {
  it('MAX_FACTIONS is 15', () => { expect(MAX_FACTIONS).toBe(15); });

  it('FACTION_COLORS has ai10..ai14 for the 5 new factions', () => {
    for (const slot of ['ai10', 'ai11', 'ai12', 'ai13', 'ai14']) {
      expect(FACTION_COLORS[slot]).toBeDefined();
      expect(typeof FACTION_COLORS[slot].tile).toBe('number');
    }
  });
});

// Combat behavior tests. resolveCombat mutates hp on the combatants it's
// handed, so we build fresh combatants per test from createUnit.
function mkAttacker(type, overrides = {}) {
  const u = createUnit(type, 'atk', 0, 0, {});
  // createUnit applies faction mods only when a factionDef is given; we want
  // the raw new-unit behavior, so reset to base UNIT_TYPE stats.
  const base = UNIT_TYPE[type];
  u.attack = base.attack;
  u.defense = base.defense;
  u.maxHp = base.hp;
  u.hp = overrides.hp != null ? overrides.hp : base.hp;
  u.hasAttackedThisTurn = !!overrides.hasAttackedThisTurn;
  return u;
}
function mkDefender(type, overrides = {}) {
  const u = createUnit(type, 'def', 5, 5, {});
  const base = UNIT_TYPE[type];
  u.attack = base.attack;
  u.defense = base.defense;
  u.maxHp = base.hp;
  u.hp = overrides.hp != null ? overrides.hp : base.hp;
  u.hasMovedThisTurn = !!overrides.hasMovedThisTurn;
  return u;
}

describe('new units — combat behaviors', () => {
  it('BERSERKER frenzy adds +3 attack when below 50% HP', () => {
    // A near-death berserker (3/12 HP) vs a tank; frenzy should show in messages.
    const atk = mkAttacker('BERSERKER', { hp: 3 });
    const def = mkDefender('INFANTRY');
    const res = resolveCombat(atk, def, 'PLAINS');
    expect(res.messages.some(m => /frenzy/i.test(m))).toBe(true);
  });

  it('BERSERKER does NOT frenzy above 50% HP', () => {
    const atk = mkAttacker('BERSERKER', { hp: 12 });
    const def = mkDefender('INFANTRY');
    const res = resolveCombat(atk, def, 'PLAINS');
    expect(res.messages.some(m => /frenzy/i.test(m))).toBe(false);
  });

  it('WINGED_HUSSAR deals 2x damage on its first attack each turn', () => {
    // First swing: hussar vs a high-HP defender so the doubled damage is clear.
    const atk = mkAttacker('WINGED_HUSSAR');
    atk.hasAttackedThisTurn = false;
    const def = mkDefender('INFANTRY');
    const before = def.hp;
    const res = resolveCombat(atk, def, 'PLAINS');
    expect(res.messages.some(m => /winged charge.*×2/i.test(m))).toBe(true);
    expect(before - def.hp).toBeGreaterThan(0);
  });

  it('WINGED_HUSSAR does NOT double on a follow-up attack the same turn', () => {
    const atk = mkAttacker('WINGED_HUSSAR');
    atk.hasAttackedThisTurn = true;
    const def = mkDefender('INFANTRY');
    const res = resolveCombat(atk, def, 'PLAINS');
    expect(res.messages.some(m => /winged charge/i.test(m))).toBe(false);
  });

  it('CONQUISTADOR gets +2 attack vs a unit on a CITY tile', () => {
    const atk = mkAttacker('CONQUISTADOR');
    const def = mkDefender('INFANTRY');
    const res = resolveCombat(atk, def, 'CITY');
    expect(res.messages.some(m => /city assault/i.test(m))).toBe(true);
  });

  it('CONQUISTADOR does NOT get the city bonus on open terrain', () => {
    const atk = mkAttacker('CONQUISTADOR');
    const def = mkDefender('INFANTRY');
    const res = resolveCombat(atk, def, 'PLAINS');
    expect(res.messages.some(m => /city assault/i.test(m))).toBe(false);
  });

  it('VARANGIAN_GUARD gains +2 defense when a friendly lord is adjacent', () => {
    const def = mkDefender('VARANGIAN_GUARD');
    const atk = mkAttacker('INFANTRY');
    // A friendly lord 1 tile away (Chebyshev-1) with the fields getAdjacentLordBonuses reads.
    const lords = [{ owner: 'def', x: 5, z: 4, class: 'WARLORD', abilities: [] }];
    const res = resolveCombat(atk, def, 'PLAINS', null, null, null, lords);
    expect(res.messages.some(m => /guards its lord/i.test(m))).toBe(true);
  });

  it('VARANGIAN_GUARD gets no lord-guard bonus when the only lord is far away', () => {
    const def = mkDefender('VARANGIAN_GUARD');
    const atk = mkAttacker('INFANTRY');
    const lords = [{ owner: 'def', x: 20, z: 20, class: 'WARLORD', abilities: [] }];
    const res = resolveCombat(atk, def, 'PLAINS', null, null, null, lords);
    expect(res.messages.some(m => /guards its lord/i.test(m))).toBe(false);
  });

  it('VARANGIAN_GUARD gets no lord-guard bonus with no adjacent lord', () => {
    const def = mkDefender('VARANGIAN_GUARD');
    const atk = mkAttacker('INFANTRY');
    const res = resolveCombat(atk, def, 'PLAINS', null, null, null, []);
    expect(res.messages.some(m => /guards its lord/i.test(m))).toBe(false);
  });
});