import { describe, it, expect } from 'vitest';
import { factionComposition, findAffordableUnit } from '../src/ai.js';
import { FACTION_DEFS } from '../src/faction.js';
import { UNIT_COST } from '../src/config.js';

// The factions whose rosters contain NO direct siege (SIEGE/ARTILLERY). These
// were the ones that never fielded siege even after building a Siege Workshop,
// because `has('siege')` in factionComposition zeroed the siege role.
const NO_SIEGE_ROSTER_FACTIONS = ['golden', 'verdant', 'shadow', 'storm', 'frost'];

describe('factionComposition has(siege) fix', () => {
  it('zeroes siege for no-roster-siege factions WITHOUT a workshop (unchanged)', () => {
    for (const id of NO_SIEGE_ROSTER_FACTIONS) {
      const def = FACTION_DEFS[id];
      const t = factionComposition(def, def.roster, false);
      expect(t.siege).toBe(0);
    }
  });

  it('keeps a non-zero siege ratio for no-roster-siege factions WITH a workshop', () => {
    for (const id of NO_SIEGE_ROSTER_FACTIONS) {
      const def = FACTION_DEFS[id];
      const t = factionComposition(def, def.roster, true);
      expect(t.siege).toBeGreaterThan(0);
    }
  });

  it('composition sums to ~1 after normalization', () => {
    const def = FACTION_DEFS.golden;
    const t = factionComposition(def, def.roster, true);
    const sum = Object.values(t).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 5);
  });
});

describe('findAffordableUnit artillery reservation', () => {
  // A faction with a workshop and ample resources, an army large enough to be
  // past the melee floor, and fullRoster including CATAPULT/TREBUCHET.
  function makeUnits(types) {
    let id = 1;
    return types.map(ty => ({ id: id++, type: ty, owner: 'golden', x: 0, z: 0 }));
  }
  // fullRoster as computeAIActions builds it for Golden once a Siege Workshop
  // is up (roster + EXTRA_UNITS + workshop CATAPULT/TREBUCHET).
  const GOLDEN_FULL_ROSTER = [...FACTION_DEFS.golden.roster, 'SETTLER', 'ENGINEER',
    'WORKER', 'CAVALRY', 'CHARIOT', 'LONGBOWMAN', 'CATAPHRACT', 'MEDIC', 'SIEGE_TOWER',
    'CATAPULT', 'TREBUCHET'];
  const AMPLE_RES = { gold: 5000, food: 5000, wood: 5000, iron: 5000, production: 5000 };

  it('picks a CATAPULT/TREBUCHET for a workshop-bearing no-siege-roster faction', () => {
    const def = FACTION_DEFS.golden;
    // Army already has its melee/cavalry/ranged filled, so siege is the largest
    // role deficit and the workshop-unlocked artillery is the affordable pick.
    const units = makeUnits(['INFANTRY', 'INFANTRY', 'INFANTRY', 'INFANTRY', 'INFANTRY',
      'CAVALRY', 'CAVALRY', 'CAVALRY', 'CAVALRY', 'CAVALRY', 'ARCHER', 'ARCHER']);
    const pick = findAffordableUnit(AMPLE_RES, GOLDEN_FULL_ROSTER, def, units, [], 'golden', null, true);
    expect(['CATAPULT', 'TREBUCHET']).toContain(pick);
  });

  it('does NOT pick siege when there is no workshop (no-roster-siege faction)', () => {
    const def = FACTION_DEFS.golden;
    const noWorkshopRoster = [...def.roster, 'SETTLER', 'ENGINEER', 'WORKER', 'CAVALRY',
      'CHARIOT', 'LONGBOWMAN', 'CATAPHRACT', 'MEDIC', 'SIEGE_TOWER'];
    const units = makeUnits(Array(10).fill('INFANTRY'));
    const pick = findAffordableUnit(AMPLE_RES, noWorkshopRoster, def, units, [], 'golden', null, false);
    expect(pick).not.toBe('CATAPULT');
    expect(pick).not.toBe('TREBUCHET');
    expect(pick).not.toBe('SIEGE');
  });
});

describe('artillery cost reduction', () => {
  it('CATAPULT gold cost lowered from 80 to 70', () => {
    expect(UNIT_COST.CATAPULT.gold).toBe(70);
  });
  it('TREBUCHET gold cost lowered from 100 to 85', () => {
    expect(UNIT_COST.TREBUCHET.gold).toBe(85);
  });
  it('CATAPULT no longer requires iron (lowered barrier)', () => {
    expect(UNIT_COST.CATAPULT.iron).toBe(0);
  });
});