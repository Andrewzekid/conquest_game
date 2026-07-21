import { describe, it, expect } from 'vitest';
import { factionComposition, findAffordableUnit } from '../src/ai.js';
import { FACTION_DEFS } from '../src/faction.js';
import { UNIT_COST } from '../src/config.js';

// The factions whose rosters contain NO direct siege (SIEGE/ARTILLERY). These
// were the ones that never fielded siege even after building a Siege Workshop,
// because `has('siege')` in factionComposition zeroed the siege role.
const NO_SIEGE_ROSTER_FACTIONS = ['golden', 'verdant', 'shadow', 'storm', 'frost'];

// Shared test helpers
function makeUnits(types, owner = 'golden') {
  let id = 1;
  return types.map(ty => ({ id: id++, type: ty, owner, x: 0, z: 0 }));
}
const AMPLE_RES = { gold: 5000, food: 5000, wood: 5000, iron: 5000, production: 5000 };

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
  // fullRoster as computeAIActions builds it for Golden once a Siege Workshop
  // is up (roster + EXTRA_UNITS + workshop CATAPULT/TREBUCHET).
  const GOLDEN_FULL_ROSTER = [...FACTION_DEFS.golden.roster, 'SETTLER', 'ENGINEER',
    'WORKER', 'CAVALRY', 'CHARIOT', 'LONGBOWMAN', 'CATAPHRACT', 'MEDIC', 'SIEGE_TOWER',
    'CATAPULT', 'TREBUCHET'];

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
    expect(UNIT_COST.CATAPULT.gold).toBe(55);
  });
  it('TREBUCHET gold cost lowered from 100 to 85', () => {
    expect(UNIT_COST.TREBUCHET.gold).toBe(65);
  });
  it('CATAPULT no longer requires iron (lowered barrier)', () => {
    expect(UNIT_COST.CATAPULT.iron).toBe(0);
  });
});

describe('new unit type recognition', () => {
  // Golden composition (after normalization): cavalry ~56%, melee ~25%, ranged ~19%.
  // To test a specific role, we fill the dominant roles first so the deficit
  // shifts to the target role.
  it('RIFLEMAN is recognized as ranged', () => {
    const def = FACTION_DEFS.golden;
    const roster = [...def.roster, 'RIFLEMAN'];
    const units = makeUnits(['INFANTRY', 'INFANTRY', 'INFANTRY', 'INFANTRY',
      'CAVALRY', 'CAVALRY', 'CAVALRY', 'CAVALRY'], 'golden');
    const pick = findAffordableUnit(AMPLE_RES, roster, def, units, [], 'golden', null, false);
    expect(pick).toBe('RIFLEMAN');
  });

  it('MUSKETEER is recognized as ranged', () => {
    const def = FACTION_DEFS.golden;
    const roster = [...def.roster, 'MUSKETEER'];
    const units = makeUnits(['INFANTRY', 'INFANTRY', 'INFANTRY', 'INFANTRY',
      'CAVALRY', 'CAVALRY', 'CAVALRY', 'CAVALRY'], 'golden');
    const pick = findAffordableUnit(AMPLE_RES, roster, def, units, [], 'golden', null, false);
    expect(pick).toBe('MUSKETEER');
  });

  it('LINE_INFANTRY is recognized as melee', () => {
    const def = FACTION_DEFS.golden;
    const roster = [...def.roster, 'LINE_INFANTRY'];
    // Fill ranged and cavalry so melee deficit is largest
    const units = makeUnits(['ARCHER', 'ARCHER', 'ARCHER', 'ARCHER',
      'CAVALRY', 'CAVALRY', 'CAVALRY', 'CAVALRY'], 'golden');
    const pick = findAffordableUnit(AMPLE_RES, roster, def, units, [], 'golden', null, false);
    expect(pick).toBe('LINE_INFANTRY');
  });

  it('SHARPSHOOTER is recognized as ranged', () => {
    const def = FACTION_DEFS.golden;
    const roster = [...def.roster, 'SHARPSHOOTER'];
    const units = makeUnits(['INFANTRY', 'INFANTRY', 'INFANTRY', 'INFANTRY',
      'CAVALRY', 'CAVALRY', 'CAVALRY', 'CAVALRY'], 'golden');
    const pick = findAffordableUnit(AMPLE_RES, roster, def, units, [], 'golden', null, false);
    expect(pick).toBe('SHARPSHOOTER');
  });

  it('HORSE_ARTILLERY is recognized as cavalry', () => {
    const def = FACTION_DEFS.golden;
    const roster = [...def.roster, 'HORSE_ARTILLERY'];
    // Fill melee and ranged so cavalry deficit is largest
    const units = makeUnits(['INFANTRY', 'INFANTRY', 'INFANTRY', 'INFANTRY',
      'ARCHER', 'ARCHER', 'ARCHER', 'ARCHER'], 'golden');
    const pick = findAffordableUnit(AMPLE_RES, roster, def, units, [], 'golden', null, false);
    expect(pick).toBe('HORSE_ARTILLERY');
  });

  it('RAILGUN is recognized as siege', () => {
    const def = FACTION_DEFS.golden;
    const roster = [...def.roster, 'RAILGUN'];
    // Fill melee, ranged, and heavily fill cavalry so siege deficit is largest
    const units = makeUnits(['INFANTRY', 'INFANTRY', 'INFANTRY', 'INFANTRY',
      'ARCHER', 'ARCHER', 'ARCHER', 'ARCHER',
      'CAVALRY', 'CAVALRY', 'CAVALRY', 'CAVALRY',
      'CAVALRY', 'CAVALRY', 'CAVALRY', 'CAVALRY'], 'golden');
    const pick = findAffordableUnit(AMPLE_RES, roster, def, units, [], 'golden', null, false);
    expect(pick).toBe('RAILGUN');
  });

  it('DEMOLITION_SQUAD is recognized as melee', () => {
    const def = FACTION_DEFS.golden;
    const roster = [...def.roster, 'DEMOLITION_SQUAD'];
    const units = makeUnits(['ARCHER', 'ARCHER', 'ARCHER', 'ARCHER',
      'CAVALRY', 'CAVALRY', 'CAVALRY', 'CAVALRY'], 'golden');
    const pick = findAffordableUnit(AMPLE_RES, roster, def, units, [], 'golden', null, false);
    expect(pick).toBe('DEMOLITION_SQUAD');
  });

  it('SIEGE_CANNON is recognized as siege', () => {
    const def = FACTION_DEFS.golden;
    const roster = [...def.roster, 'SIEGE_CANNON'];
    const units = makeUnits(['INFANTRY', 'INFANTRY', 'INFANTRY', 'INFANTRY',
      'ARCHER', 'ARCHER', 'ARCHER', 'ARCHER',
      'CAVALRY', 'CAVALRY', 'CAVALRY', 'CAVALRY',
      'CAVALRY', 'CAVALRY', 'CAVALRY', 'CAVALRY'], 'golden');
    const pick = findAffordableUnit(AMPLE_RES, roster, def, units, [], 'golden', null, false);
    expect(pick).toBe('SIEGE_CANNON');
  });

  it('MORTAR is recognized as siege', () => {
    const def = FACTION_DEFS.golden;
    const roster = [...def.roster, 'MORTAR'];
    const units = makeUnits(['INFANTRY', 'INFANTRY', 'INFANTRY', 'INFANTRY',
      'ARCHER', 'ARCHER', 'ARCHER', 'ARCHER',
      'CAVALRY', 'CAVALRY', 'CAVALRY', 'CAVALRY',
      'CAVALRY', 'CAVALRY', 'CAVALRY', 'CAVALRY'], 'golden');
    const pick = findAffordableUnit(AMPLE_RES, roster, def, units, [], 'golden', null, false);
    expect(pick).toBe('MORTAR');
  });

  it('FIELD_GUN is recognized as siege', () => {
    const def = FACTION_DEFS.golden;
    const roster = [...def.roster, 'FIELD_GUN'];
    const units = makeUnits(['INFANTRY', 'INFANTRY', 'INFANTRY', 'INFANTRY',
      'ARCHER', 'ARCHER', 'ARCHER', 'ARCHER',
      'CAVALRY', 'CAVALRY', 'CAVALRY', 'CAVALRY',
      'CAVALRY', 'CAVALRY', 'CAVALRY', 'CAVALRY'], 'golden');
    const pick = findAffordableUnit(AMPLE_RES, roster, def, units, [], 'golden', null, false);
    expect(pick).toBe('FIELD_GUN');
  });
});

describe('naval unit recognition', () => {
  it('IRONCLAD is recognized as naval', () => {
    const def = FACTION_DEFS.storm;
    const roster = [...def.roster, 'IRONCLAD'];
    const units = makeUnits(['INFANTRY', 'INFANTRY', 'INFANTRY', 'INFANTRY'], 'storm');
    const pick = findAffordableUnit(AMPLE_RES, roster, def, units, [], 'storm', null, false);
    expect(pick).toBe('IRONCLAD');
  });

  it('SUBMARINE is recognized as naval', () => {
    const def = FACTION_DEFS.storm;
    const roster = [...def.roster, 'SUBMARINE'];
    const units = makeUnits(['INFANTRY', 'INFANTRY', 'INFANTRY', 'INFANTRY'], 'storm');
    const pick = findAffordableUnit(AMPLE_RES, roster, def, units, [], 'storm', null, false);
    expect(pick).toBe('SUBMARINE');
  });

  it('MONITOR is recognized as naval', () => {
    const def = FACTION_DEFS.storm;
    const roster = [...def.roster, 'MONITOR'];
    const units = makeUnits(['INFANTRY', 'INFANTRY', 'INFANTRY', 'INFANTRY'], 'storm');
    const pick = findAffordableUnit(AMPLE_RES, roster, def, units, [], 'storm', null, false);
    expect(pick).toBe('MONITOR');
  });

  it('TORPEDO_BOAT is recognized as naval', () => {
    const def = FACTION_DEFS.storm;
    const roster = [...def.roster, 'TORPEDO_BOAT'];
    const units = makeUnits(['INFANTRY', 'INFANTRY', 'INFANTRY', 'INFANTRY'], 'storm');
    const pick = findAffordableUnit(AMPLE_RES, roster, def, units, [], 'storm', null, false);
    expect(pick).toBe('TORPEDO_BOAT');
  });

  it('MAN_OF_WAR is recognized as naval', () => {
    const def = FACTION_DEFS.storm;
    const roster = [...def.roster, 'MAN_OF_WAR'];
    const units = makeUnits(['INFANTRY', 'INFANTRY', 'INFANTRY', 'INFANTRY'], 'storm');
    const pick = findAffordableUnit(AMPLE_RES, roster, def, units, [], 'storm', null, false);
    expect(pick).toBe('MAN_OF_WAR');
  });
});