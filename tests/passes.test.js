import { describe, it, expect } from 'vitest';
import { generatePasses, isPassable, buildTileMap } from '../src/map.js';
import { TERRAIN, PASS_TERRAIN_KEY, PASS_DEFENSE, RIVER_CROSSING_DEFENSE_PENALTY, RIVER_CROSSING_MOVE_COST } from '../src/config.js';
import { resolveCombat, riverCrossingDefensePenalty } from '../src/battle.js';

function makeTiles(grid) {
  // grid is a 2D array of terrain strings; builds a tile list + map.
  const tiles = [];
  for (let z = 0; z < grid.length; z++) {
    for (let x = 0; x < grid[z].length; x++) {
      tiles.push({ x, z, terrain: grid[z][x] || 'PLAINS', owner: null, loyalty: 0, cityLevel: 0, fortification: 0, fortMax: 0, wonder: null });
    }
  }
  return buildTileMap(tiles);
}

describe('Mountain Passes (Feature 9)', () => {
  it('defines a PASS terrain type with partial defense', () => {
    expect(TERRAIN.PASS).toBeDefined();
    expect(TERRAIN.PASS.key).toBe('PASS');
    expect(TERRAIN.PASS.defense).toBe(PASS_DEFENSE);
  });

  it('isPassable treats PASS as passable like other land', () => {
    const tiles = makeTiles([['WATER', 'PASS', 'PLAINS', 'MOUNTAIN']]);
    expect(isPassable(tiles.get('0,0'))).toBe(false); // WATER impassable
    expect(isPassable(tiles.get('1,0'))).toBe(true);  // PASS passable
    expect(isPassable(tiles.get('2,0'))).toBe(true);  // PLAINS passable
    // MOUNTAIN is passable in this engine (it blocks via defense, not passability);
    // the PASS feature's value is its lower defense (a weaker chokepoint).
    expect(TERRAIN.PASS.defense).toBeLessThan(TERRAIN.MOUNTAIN.defense);
  });

  it('generatePasses converts ridge MOUNTAIN tiles (≥2 land neighbors) to PASS', () => {
    // A 3x3 with a mountain ridge down the middle column; the center tile has
    // land on both sides → qualifies as a pass.
    const grid = [
      ['PLAINS', 'MOUNTAIN', 'PLAINS'],
      ['PLAINS', 'MOUNTAIN', 'PLAINS'],
      ['PLAINS', 'MOUNTAIN', 'PLAINS'],
    ];
    const tiles = makeTiles(grid);
    const carved = generatePasses(tiles, 5);
    expect(carved.length).toBeGreaterThan(0);
    for (const p of carved) {
      expect(p.terrain).toBe(PASS_TERRAIN_KEY);
    }
  });

  it('generatePasses leaves isolated mountains (no land neighbors) alone', () => {
    const grid = [
      ['WATER', 'MOUNTAIN', 'WATER'],
      ['WATER', 'PLAINS', 'WATER'],
    ];
    const tiles = makeTiles(grid);
    const carved = generatePasses(tiles, 5);
    expect(carved.length).toBe(0);
    expect(tiles.get('1,0').terrain).toBe('MOUNTAIN');
  });

  it('generatePasses spreads passes at least 3 tiles apart', () => {
    const grid = [
      ['PLAINS', 'MOUNTAIN', 'PLAINS'],
      ['PLAINS', 'MOUNTAIN', 'PLAINS'],
      ['PLAINS', 'MOUNTAIN', 'PLAINS'],
      ['PLAINS', 'MOUNTAIN', 'PLAINS'],
    ];
    const tiles = makeTiles(grid);
    const carved = generatePasses(tiles, 10);
    for (let i = 1; i < carved.length; i++) {
      const d = Math.abs(carved[i].x - carved[i - 1].x) + Math.abs(carved[i].z - carved[i - 1].z);
      expect(d).toBeGreaterThanOrEqual(3);
    }
  });

  it('generatePasses returns at most the requested count', () => {
    const grid = [
      ['PLAINS', 'MOUNTAIN', 'PLAINS'],
      ['PLAINS', 'MOUNTAIN', 'PLAINS'],
    ];
    const tiles = makeTiles(grid);
    const carved = generatePasses(tiles, 1);
    expect(carved.length).toBeLessThanOrEqual(1);
  });
});

describe('River Crossing Penalty (Feature 10)', () => {
  it('config defines a defense penalty and move cost', () => {
    expect(RIVER_CROSSING_DEFENSE_PENALTY).toBeGreaterThan(0);
    expect(RIVER_CROSSING_MOVE_COST).toBeGreaterThan(0);
  });

  it('riverCrossingDefensePenalty returns 0 for a unit that did not cross', () => {
    expect(riverCrossingDefensePenalty({})).toBe(0);
    expect(riverCrossingDefensePenalty({ crossedRiverThisTurn: false })).toBe(0);
    expect(riverCrossingDefensePenalty(null)).toBe(0);
  });

  it('riverCrossingDefensePenalty returns the configured penalty for a unit that crossed', () => {
    expect(riverCrossingDefensePenalty({ crossedRiverThisTurn: true })).toBe(RIVER_CROSSING_DEFENSE_PENALTY);
  });

  it('resolveCombat reduces a river-crossing defender\'s effective defense', () => {
    const attacker = { id: 1, type: 'INFANTRY', owner: 'player', x: 0, z: 0, hp: 10, maxHp: 10, attack: 10, defense: 2, hasAttackedThisTurn: false };
    const defender = { id: 2, type: 'INFANTRY', owner: 'ai1', x: 1, z: 0, hp: 20, maxHp: 20, attack: 3, defense: 8, crossedRiverThisTurn: true };
    const r1 = resolveCombat(attacker, defender, 'PLAINS');
    const defender2 = { ...defender, crossedRiverThisTurn: false, hp: 20 };
    const r2 = resolveCombat(attacker, defender2, 'PLAINS');
    // The crossed defender takes more damage (lower effective defense → higher dmg).
    expect(r1.damageToDefender).toBeGreaterThan(r2.damageToDefender);
    expect(r1.messages.some(m => /crossed a river/.test(m))).toBe(true);
  });
});