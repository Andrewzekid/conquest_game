import { describe, it, expect } from 'vitest';
import {
  computeStrategicTarget, assignReserve, detectFlankingOpportunity,
  computeFlankObjective
} from '../src/ai_army_plan.js';

function makeTile(x, z, overrides = {}) {
  return { x, z, terrain: 'PLAINS', owner: null, ...overrides };
}

function makeCity(x, z, owner, overrides = {}) {
  return { x, z, terrain: 'CITY', owner, fortification: 0, ...overrides };
}

function makeUnit(id, type, owner, x, z, overrides = {}) {
  return { id, type, owner, x, z, hp: 10, maxHp: 10, attack: 3, ...overrides };
}

function makeGroup(id, units, lord = null) {
  return { id, lord, units };
}

function makeTiles(entries) {
  const map = new Map();
  for (const [key, tile] of entries) map.set(key, tile);
  return map;
}

function makeUnits(entries) {
  const map = new Map();
  for (const u of entries) map.set(`${u.x},${u.z}`, u);
  return map;
}

describe('computeStrategicTarget', () => {
  it('returns null with no groups', () => {
    const result = computeStrategicTarget([], new Map(), 'golden', () => false, {});
    expect(result).toBeNull();
  });

  it('returns null with no enemy cities', () => {
    const tiles = makeTiles([
      ['0,0', makeCity(0, 0, 'golden', { isCapital: true })],
    ]);
    const units = makeUnits([makeUnit(1, 'INFANTRY', 'golden', 1, 1)]);
    const groups = [makeGroup('g1', [units.get('1,1')])];
    const result = computeStrategicTarget(groups, tiles, units, 'golden', () => false, {});
    expect(result).toBeNull();
  });

  it('picks the nearest enemy city when groups are close', () => {
    const tiles = makeTiles([
      ['0,0', makeCity(0, 0, 'golden', { isCapital: true })],
      ['5,5', makeCity(5, 5, 'azure', { fortification: 2 })],
      ['20,20', makeCity(20, 20, 'azure', { fortification: 0 })],
    ]);
    const unit = makeUnit(1, 'INFANTRY', 'golden', 3, 3);
    const units = makeUnits([unit]);
    const groups = [makeGroup('g1', [unit])];
    const isAtWar = (o) => o === 'azure';
    const result = computeStrategicTarget(groups, tiles, units, 'golden', isAtWar, {});
    expect(result).toBeTruthy();
    expect(result.x).toBe(5);
    expect(result.z).toBe(5);
  });

  it('prefers weaker cities (lower fortification)', () => {
    const tiles = makeTiles([
      ['0,0', makeCity(0, 0, 'golden')],
      ['5,5', makeCity(5, 5, 'azure', { fortification: 5 })],
      ['8,8', makeCity(8, 8, 'azure', { fortification: 0 })],
    ]);
    const unit = makeUnit(1, 'INFANTRY', 'golden', 3, 3);
    const units = makeUnits([unit]);
    const groups = [makeGroup('g1', [unit])];
    const isAtWar = (o) => o === 'azure';
    const result = computeStrategicTarget(groups, tiles, units, 'golden', isAtWar, {});
    expect(result).toBeTruthy();
    expect(result.x).toBe(8);
    expect(result.z).toBe(8);
  });

  it('boosts score when goal target matches', () => {
    const tiles = makeTiles([
      ['0,0', makeCity(0, 0, 'golden')],
      ['5,5', makeCity(5, 5, 'azure', { fortification: 3 })],
      ['8,8', makeCity(8, 8, 'azure', { fortification: 0 })],
    ]);
    const unit = makeUnit(1, 'INFANTRY', 'golden', 3, 3);
    const units = makeUnits([unit]);
    const groups = [makeGroup('g1', [unit])];
    const isAtWar = (o) => o === 'azure';
    // Without goal target
    const r1 = computeStrategicTarget(groups, tiles, units, 'golden', isAtWar, {}, null);
    // With goal target pointing to the fortified city
    const r2 = computeStrategicTarget(groups, tiles, units, 'golden', isAtWar, {}, '5,5');
    expect(r1.x).toBe(8); // picks weaker city
    expect(r2.x).toBe(5); // goal alignment overrides weakness
  });
});

describe('assignReserve', () => {
  it('returns null with no groups', () => {
    const tiles = makeTiles([['0,0', makeCity(0, 0, 'golden')]]);
    expect(assignReserve([], tiles, 'golden')).toBeNull();
  });

  it('assigns closest group to capital as reserve', () => {
    const tiles = makeTiles([
      ['0,0', makeCity(0, 0, 'golden', { isCapital: true })],
      ['10,10', makeCity(10, 10, 'azure')],
    ]);
    const g1 = makeGroup('g1', [makeUnit(1, 'INFANTRY', 'golden', 1, 1)]);
    const g2 = makeGroup('g2', [makeUnit(2, 'INFANTRY', 'golden', 8, 8)]);
    const result = assignReserve([g1, g2], tiles, 'golden');
    expect(result).toBe(g1); // g1 is closer to capital at (0,0)
    expect(g1._reserve).toBe(true);
  });

  it('does not assign reserve if closest group is too far (>8 tiles)', () => {
    const tiles = makeTiles([
      ['0,0', makeCity(0, 0, 'golden', { isCapital: true })],
    ]);
    const g1 = makeGroup('g1', [makeUnit(1, 'INFANTRY', 'golden', 15, 15)]);
    const result = assignReserve([g1], tiles, 'golden');
    expect(result).toBeNull();
  });
});

describe('detectFlankingOpportunity', () => {
  it('returns empty with fewer than 2 close groups', () => {
    const target = { x: 10, z: 10 };
    const g1 = makeGroup('g1', [makeUnit(1, 'INFANTRY', 'golden', 8, 10)]);
    const result = detectFlankingOpportunity([g1], target, new Map(), 'golden');
    expect(result).toEqual([]);
  });

  it('detects flanking when groups approach from different angles', () => {
    const target = { x: 10, z: 10 };
    // Group 1 approaches from the west (angle ~0)
    const g1 = makeGroup('g1', [makeUnit(1, 'INFANTRY', 'golden', 5, 10)]);
    // Group 2 approaches from the south (angle ~PI/2)
    const g2 = makeGroup('g2', [makeUnit(2, 'INFANTRY', 'golden', 10, 15)]);
    const result = detectFlankingOpportunity([g1, g2], target, new Map(), 'golden');
    expect(result.length).toBe(2);
    expect(result.some(a => a.role === 'assault')).toBe(true);
    expect(result.some(a => a.role === 'flank')).toBe(true);
  });

  it('returns empty when groups approach from the same direction', () => {
    const target = { x: 10, z: 10 };
    // Both groups approach from the west
    const g1 = makeGroup('g1', [makeUnit(1, 'INFANTRY', 'golden', 5, 10)]);
    const g2 = makeGroup('g2', [makeUnit(2, 'INFANTRY', 'golden', 6, 10)]);
    const result = detectFlankingOpportunity([g1, g2], target, new Map(), 'golden');
    expect(result).toEqual([]);
  });

  it('only considers groups within 12 tiles', () => {
    const target = { x: 10, z: 10 };
    // Group 1 is close (6 tiles)
    const g1 = makeGroup('g1', [makeUnit(1, 'INFANTRY', 'golden', 5, 10)]);
    // Group 2 is far (20 tiles)
    const g2 = makeGroup('g2', [makeUnit(2, 'INFANTRY', 'golden', 30, 10)]);
    const result = detectFlankingOpportunity([g1, g2], target, new Map(), 'golden');
    expect(result).toEqual([]);
  });
});

describe('computeFlankObjective', () => {
  it('returns a tile opposite to the assault angle', () => {
    const target = { x: 10, z: 10 };
    const assaultAngle = 0; // approaching from west (right)
    const tiles = makeTiles([
      ['12,10', makeTile(12, 10)],
      ['13,10', makeTile(13, 10)],
    ]);
    const result = computeFlankObjective(target, assaultAngle, tiles, 'golden');
    expect(result).toBeTruthy();
    expect(result.x).toBeGreaterThan(target.x); // opposite side
  });

  it('returns null when flank direction is blocked by water', () => {
    const target = { x: 10, z: 10 };
    const assaultAngle = 0;
    const tiles = makeTiles([
      ['12,10', { x: 12, z: 10, terrain: 'WATER', owner: null }],
      ['13,10', { x: 13, z: 10, terrain: 'WATER', owner: null }],
    ]);
    const result = computeFlankObjective(target, assaultAngle, tiles, 'golden');
    expect(result).toBeNull();
  });
});

describe('relative-strength power (type advantage)', () => {
  it('exported groupPowerVs applies advantage vs matching enemy types', async () => {
    const { groupPowerVs } = await import('../src/ai_army_plan.js');
    // One pike unit (hp 12, atk 4 vs a cavalry-heavy enemy set).
    const group = makeGroup('g', [makeUnit(1, 'PIKEMAN', 'golden', 0, 0, { hp: 12, atk: 4, attack: 4 })]);
    const noAdv = groupPowerVs(group, new Set(['ARCHER']));
    const withAdv = groupPowerVs(group, new Set(['CAVALRY']));
    // PIKEMAN has 1.6x vs CAVALRY, so withAdv > noAdv.
    expect(noAdv).toBe(12 + 4 * 2);
    expect(withAdv).toBeGreaterThan(noAdv);
    // 1.6 multiplier applied.
    expect(withAdv).toBeCloseTo((12 + 4 * 2) * 1.6);
  });

  it('groupPowerVs with no enemy types equals raw power (multiplier 1)', async () => {
    const { groupPowerVs } = await import('../src/ai_army_plan.js');
    const group = makeGroup('g', [makeUnit(1, 'INFANTRY', 'golden', 0, 0, { hp: 10, attack: 3 })]);
    expect(groupPowerVs(group, null)).toBe(10 + 3 * 2);
    expect(groupPowerVs(group, new Set())).toBe(10 + 3 * 2);
  });

  it('enemyTypesNear collects only at-war enemy types within radius', async () => {
    const { enemyTypesNear } = await import('../src/ai_army_plan.js');
    const units = new Map();
    units.set(1, makeUnit(1, 'CAVALRY', 'azure', 2, 2)); // within radius 5 of (0,0)
    units.set(2, makeUnit(2, 'ARCHER', 'azure', 10, 10)); // out of range
    units.set(3, makeUnit(3, 'PIKEMAN', 'golden', 1, 1)); // friend, ignored
    const isAtWar = (o) => o === 'azure';
    const types = enemyTypesNear(new Map(), units, 'golden', isAtWar, 0, 0, 5);
    expect(types.has('CAVALRY')).toBe(true);
    expect(types.has('ARCHER')).toBe(false); // outside radius
    expect(types.has('PIKEMAN')).toBe(false); // friendly
  });
});

describe('weak-spot targeting (attack where the enemy is NOT)', () => {
  it('prefers a lightly-defended city over one under a massed stack', () => {
    // Two enemy cities equidistant from our group. One sits under a large
    // enemy stack; the other is lightly guarded.
    const tiles = makeTiles([
      ['0,0', makeCity(0, 0, 'golden')],
      ['10,10', makeCity(10, 10, 'azure', { fortification: 1 })],
      ['10,8', makeCity(10, 8, 'azure', { fortification: 1 })],
    ]);
    // Our group is close to both (near (9,9)).
    const unit = makeUnit(1, 'INFANTRY', 'golden', 9, 9);
    const units = new Map();
    units.set(1, unit);
    // Mass a stack under city (10,8).
    for (let i = 0; i < 6; i++) units.set(100 + i, makeUnit(2 + i, 'INFANTRY', 'azure', 10 + i % 2, 8));
    const isAtWar = (o) => o === 'azure';
    const groupsArr = [makeGroup('g1', [unit])];
    const result = computeStrategicTarget(groupsArr, tiles, units, 'golden', isAtWar, {});
    // The weak-spot penalty should steer the AI to the unstacked city (10,10).
    expect(result).toBeTruthy();
    expect(`${result.x},${result.z}`).toBe('10,10');
  });
});
