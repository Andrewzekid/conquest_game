import { describe, it, expect } from 'vitest';
import { calculateUnrest, applyUnrestEffects, processUnrest, applyFactionUnrest }
  from '../src/economy.js';
import { UNREST_THRESHOLDS } from '../src/config.js';

function mkTiles(arr) {
  const m = new Map();
  for (const t of arr) m.set(`${t.x},${t.z}`, t);
  return m;
}

describe('City Unrest System — calculateUnrest', () => {
  it('returns 0 for a founded city with a garrison and no pressure', () => {
    const tiles = mkTiles([
      { x: 5, z: 5, terrain: 'CITY', owner: 'player', cityLevel: 2, unrest: 0 }
    ]);
    const units = new Map();
    units.set(1, { id: 1, owner: 'player', x: 5, z: 5 });
    const buildings = new Map();
    const result = calculateUnrest(tiles, '5,5', 'player', units, [], 10, buildings);
    expect(result.amount).toBe(0);
  });

  it('adds unrest when no garrison is present', () => {
    const tiles = mkTiles([
      { x: 5, z: 5, terrain: 'CITY', owner: 'player', cityLevel: 1, unrest: 0 }
    ]);
    const result = calculateUnrest(tiles, '5,5', 'player', new Map(), [], 10, new Map());
    expect(result.amount).toBeGreaterThan(0);
    expect(result.reasons.some(r => r.reason === 'no_garrison')).toBe(true);
  });

  it('adds unrest from adjacent enemy-city cultural pressure', () => {
    const tiles = mkTiles([
      { x: 5, z: 5, terrain: 'CITY', owner: 'player', cityLevel: 1, unrest: 0 },
      { x: 6, z: 5, terrain: 'CITY', owner: 'ai1', cityLevel: 2 }
    ]);
    const units = new Map();
    units.set(1, { id: 1, owner: 'player', x: 5, z: 5 });
    const result = calculateUnrest(tiles, '5,5', 'player', units, [], 10, new Map());
    expect(result.reasons.some(r => r.reason === 'cultural_pressure' && r.amount > 0)).toBe(true);
  });

  it('reduces unrest when a governor is assigned', () => {
    const tiles = mkTiles([
      { x: 5, z: 5, terrain: 'CITY', owner: 'player', cityLevel: 1, unrest: 30 }
    ]);
    const units = new Map();
    units.set(1, { id: 1, owner: 'player', x: 5, z: 5 });
    const lords = [{ id: 10, owner: 'player', governingCity: '5,5' }];
    const result = calculateUnrest(tiles, '5,5', 'player', units, lords, 10, new Map());
    expect(result.reasons.some(r => r.reason === 'governor')).toBe(true);
  });

  it('reduces unrest when WALLS are built on the city', () => {
    const tiles = mkTiles([
      { x: 5, z: 5, terrain: 'CITY', owner: 'player', cityLevel: 1, unrest: 30 }
    ]);
    const units = new Map();
    units.set(1, { id: 1, owner: 'player', x: 5, z: 5 });
    const buildings = new Map([['5,5', ['WALLS']]]);
    const result = calculateUnrest(tiles, '5,5', 'player', units, [], 10, buildings);
    expect(result.reasons.some(r => r.reason === 'walls')).toBe(true);
  });

  it('applies a decaying recent-conquest spike', () => {
    const tiles = mkTiles([
      { x: 5, z: 5, terrain: 'CITY', owner: 'player', cityLevel: 3, unrest: 0, lastConqueredTurn: 8 }
    ]);
    const units = new Map();
    units.set(1, { id: 1, owner: 'player', x: 5, z: 5 });
    // turn 9: 1 turn since conquest → conquestUnrest = 10 - 1 = 9
    const r1 = calculateUnrest(tiles, '5,5', 'player', units, [], 9, new Map());
    expect(r1.reasons.some(rs => rs.reason === 'recent_conquest')).toBe(true);
    // turn 30: well past the decay window → no recent-conquest reason
    const r2 = calculateUnrest(tiles, '5,5', 'player', units, [], 30, new Map());
    expect(r2.reasons.some(rs => rs.reason === 'recent_conquest')).toBe(false);
  });

  it('clamps unrest to [0, 100]', () => {
    const tiles = mkTiles([
      { x: 5, z: 5, terrain: 'CITY', owner: 'player', cityLevel: 1, unrest: 500 }
    ]);
    const result = calculateUnrest(tiles, '5,5', 'player', new Map(), [], 10, new Map());
    expect(result.amount).toBeLessThanOrEqual(100);
  });

  it('returns 0 for a non-city tile', () => {
    const tiles = mkTiles([{ x: 5, z: 5, terrain: 'PLAINS', owner: 'player' }]);
    const result = calculateUnrest(tiles, '5,5', 'player', new Map(), [], 10, new Map());
    expect(result.amount).toBe(0);
  });
});

describe('City Unrest System — applyUnrestEffects', () => {
  it('applies no penalty below 25% unrest', () => {
    const tile = { unrest: 20, cityName: 'Test' };
    const resources = { gold: 100, food: 50, wood: 30, iron: 20, production: 10 };
    const msgs = applyUnrestEffects(tile, resources);
    expect(resources.gold).toBe(100);
    expect(msgs.length).toBe(0);
  });

  it('applies a 75% penalty at high unrest (>=75)', () => {
    const tile = { unrest: 80, cityName: 'Test' };
    const resources = { gold: 100, food: 50, wood: 30, iron: 20, production: 10 };
    applyUnrestEffects(tile, resources);
    expect(resources.gold).toBe(25); // floor(100 * 0.75) lost
    expect(resources.food).toBe(13); // floor(50*0.75)=37 lost -> 13
  });

  it('applies a 50% penalty at medium unrest', () => {
    const tile = { unrest: 60, cityName: 'Test' };
    const resources = { gold: 100, food: 0, wood: 0, iron: 0, production: 0 };
    applyUnrestEffects(tile, resources);
    expect(resources.gold).toBe(50);
  });
});

describe('City Unrest System — applyFactionUnrest (aggregate)', () => {
  it('does nothing when the faction has no cities', () => {
    const tiles = mkTiles([{ x: 1, z: 1, terrain: 'PLAINS', owner: 'player' }]);
    const res = { gold: 100, food: 50 };
    const msgs = applyFactionUnrest(tiles, 'player', res);
    expect(msgs.length).toBe(0);
    expect(res.gold).toBe(100);
  });

  it('does nothing when all cities are calm', () => {
    const tiles = mkTiles([
      { x: 5, z: 5, terrain: 'CITY', owner: 'player', unrest: 10 },
      { x: 7, z: 7, terrain: 'CITY', owner: 'player', unrest: 0 }
    ]);
    const res = { gold: 100, food: 50 };
    applyFactionUnrest(tiles, 'player', res);
    expect(res.gold).toBe(100);
  });

  it('applies the MEAN penalty across cities (no compounding)', () => {
    const tiles = mkTiles([
      { x: 5, z: 5, terrain: 'CITY', owner: 'player', unrest: 80 },  // 0.75
      { x: 7, z: 7, terrain: 'CITY', owner: 'player', unrest: 0 }   // 0.00
    ]);
    const res = { gold: 100, food: 0, wood: 0, iron: 0, production: 0 };
    applyFactionUnrest(tiles, 'player', res);
    // mean penalty = 0.375 -> floor(100 * 0.375) = 37 lost -> 63 remain
    expect(res.gold).toBe(63);
  });
});

describe('City Unrest System — processUnrest', () => {
  it('updates tile.unrest and unrestReasons each call', () => {
    const tiles = mkTiles([
      { x: 5, z: 5, terrain: 'CITY', owner: 'player', cityLevel: 1, unrest: 0 }
    ]);
    processUnrest(tiles, 'player', new Map(), [], 10, new Map());
    const tile = tiles.get('5,5');
    expect(typeof tile.unrest).toBe('number');
    expect(Array.isArray(tile.unrestReasons)).toBe(true);
  });

  it('skips eliminated/foreign cities', () => {
    const tiles = mkTiles([
      { x: 5, z: 5, terrain: 'CITY', owner: 'ai1', cityLevel: 1, unrest: 0 }
    ]);
    const result = processUnrest(tiles, 'player', new Map(), [], 10, new Map());
    expect(result.rebellions.length).toBe(0);
    // foreign city is untouched by the player's processing
    expect(tiles.get('5,5').unrest).toBe(0);
  });

  it('triggers a rebellion at 100% unrest at least once over many tries', () => {
    let rebellionCount = 0;
    for (let i = 0; i < 200; i++) {
      const tiles = mkTiles([
        { x: 5, z: 5, terrain: 'CITY', owner: 'player', cityLevel: 1,
          cityName: 'Rebelville', unrest: 100, lastConqueredTurn: 0 }
      ]);
      const result = processUnrest(tiles, 'player', new Map(), [], 10, new Map());
      if (result.rebellions.length > 0) rebellionCount++;
    }
    // 30% chance per try × 200 tries should virtually always hit at least once.
    expect(rebellionCount).toBeGreaterThan(0);
  });

  it('a rebellion flips the city owner and resets unrest', () => {
    // Force a rebellion by making every adjacent tile owned by a rival so
    // findHighestInfluenceOwner returns that rival.
    const tiles = mkTiles([
      { x: 5, z: 5, terrain: 'CITY', owner: 'player', cityLevel: 1, unrest: 100, lastConqueredTurn: 0 },
      { x: 6, z: 5, terrain: 'PLAINS', owner: 'ai2' }
    ]);
    let rebelled = false;
    for (let i = 0; i < 200 && !rebelled; i++) {
      // reset between tries
      tiles.get('5,5').owner = 'player';
      tiles.get('5,5').unrest = 100;
      tiles.get('5,5').peaceTurns = 0;
      tiles.get('5,5').siegeTurns = 0;
      const result = processUnrest(tiles, 'player', new Map(), [], 10, new Map());
      if (result.rebellions.length > 0) {
        rebelled = true;
        expect(tiles.get('5,5').owner).toBe('ai2');
        expect(tiles.get('5,5').unrest).toBeLessThan(100);
      }
    }
    expect(rebelled).toBe(true);
  });

  it('a rebellion to independent clears surrounding territory (Fix 12)', () => {
    // City at (5,5) with surrounding tiles owned by 'player'. No rival
    // influence adjacent -> findHighestInfluenceOwner returns null -> the
    // city goes independent. Surrounding tiles must also flip to null.
    // cityRadius(level 1) = 1, so we test tiles within radius 1.
    const tilesArr = [
      { x: 5, z: 5, terrain: 'CITY', owner: 'player', cityLevel: 1, unrest: 100, lastConqueredTurn: 0 }
    ];
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        if (dx === 0 && dz === 0) continue;
        tilesArr.push({ x: 5 + dx, z: 5 + dz, terrain: 'PLAINS', owner: 'player' });
      }
    }
    let rebelled = false;
    for (let i = 0; i < 200 && !rebelled; i++) {
      tilesArr.forEach(t => { t.owner = 'player'; });
      const tiles = mkTiles(tilesArr);
      tiles.get('5,5').unrest = 100;
      tiles.get('5,5').peaceTurns = 0;
      tiles.get('5,5').siegeTurns = 0;
      const result = processUnrest(tiles, 'player', new Map(), [], 10, new Map());
      if (result.rebellions.length > 0) {
        rebelled = true;
        expect(tiles.get('5,5').owner).toBeNull();
        for (let dx = -1; dx <= 1; dx++) {
          for (let dz = -1; dz <= 1; dz++) {
            if (dx === 0 && dz === 0) continue;
            expect(tiles.get(`${5 + dx},${5 + dz}`).owner).toBeNull();
          }
        }
      }
    }
    expect(rebelled).toBe(true);
  });

  it('conquest-count dampening reduces unrest gains for recaptured cities (Fix 13)', () => {
    // Same setup as the no-garrison test, but with conquestCount = 3 (so
    // dampening = 1 - 3*0.2 = 0.4). The no-garrison penalty should be reduced
    // from 3 to floor(3 * 0.4) = 1.
    const tiles = mkTiles([
      { x: 5, z: 5, terrain: 'CITY', owner: 'player', cityLevel: 1, unrest: 0, conquestCount: 3 }
    ]);
    const result = calculateUnrest(tiles, '5,5', 'player', new Map(), [], 10, new Map());
    const noGarrison = result.reasons.find(r => r.reason === 'no_garrison');
    expect(noGarrison).toBeTruthy();
    expect(noGarrison.amount).toBe(1); // floor(3 * 0.4)
  });
});