import { describe, it, expect, beforeEach, vi } from 'vitest';
vi.mock('../src/renderer.js', () => ({ GameRenderer: class {} }));
import { computeAIActions } from '../src/ai.js';
import { createAIState } from '../src/ai_goals.js';
import { createTechState } from '../src/tech.js';
import { FACTION_DEFS } from '../src/faction.js';
import { setGridDimensions, DIPLOMACY_STATES } from '../src/config.js';
import { makeTile, makeUnit, makeTileMap } from './helpers.js';

beforeEach(() => { setGridDimensions(20, 20); });

function warDiplo(owner, enemy) {
  const rel = {
    state: DIPLOMACY_STATES.WAR, turnsAllied: 0, turnsAtWar: 3,
    relationship: -50, warsDeclared: 1, peaceTreaties: 0,
    tradesMade: 0, brokenTreaties: 0, grievances: 0,
    grievanceLog: [], expiresOn: null, formalWar: true,
    lastWarDeclaredTurn: 1, grudges: {}, trust: 0.1,
  };
  return {
    relations: { [`${owner}:${enemy}`]: { ...rel }, [`${enemy}:${owner}`]: { ...rel } },
    pendingOffers: [], diplomaticEvents: [],
  };
}

describe('idle army group objective fallback', () => {
  it('prefers the nearest enemy army over an enemy-owned tile', () => {
    // Enemy-owned tile is west; the enemy army is far east. The richer fallback
    // should target the enemy army first, so the catapult advances east.
    const tiles = makeTileMap([
      [-1, 0, 'PLAINS', 'enemy'],
      [0, 0, 'CITY', 'ai1'],
      [1, 0, 'PLAINS', 'ai1'],
      [2, 0, 'PLAINS', null],
      [3, 0, 'PLAINS', null],
      [4, 0, 'PLAINS', null],
      [5, 0, 'PLAINS', null],
      [6, 0, 'PLAINS', null],
      [7, 0, 'PLAINS', null],
      [8, 0, 'PLAINS', null],
      [9, 0, 'PLAINS', null],
      [10, 0, 'PLAINS', null],
    ]);
    const units = new Map();
    const cat = makeUnit('CATAPULT', 'ai1', 1, 0, { factionId: 'crimson' });
    const foe = makeUnit('INFANTRY', 'enemy', 10, 0, { factionId: 'azure' });
    units.set(cat.id, cat);
    units.set(foe.id, foe);
    const actions = computeAIActions(
      units, tiles, { gold: 200, food: 100, wood: 50, iron: 30, production: 50 },
      'ai1', new Map(), null, FACTION_DEFS.crimson,
      warDiplo('ai1', 'enemy'), [], {}, new Map(), new Map(),
      createAIState(), { ai1: createTechState() }, {}, 10,
    );
    const moves = actions.filter(a => a.type === 'move' && a.unitId === cat.id);
    expect(moves.length).toBeGreaterThan(0);
    expect(moves[0].tx).toBeGreaterThan(cat.x);
  });

  it('moves toward the nearest unowned tile when no enemy army or city exists', () => {
    const tiles = makeTileMap([
      [0, 0, 'CITY', 'ai1'],
      [1, 0, 'PLAINS', 'ai1'],
      [2, 0, 'PLAINS', null],
      [3, 0, 'PLAINS', null],
      [4, 0, 'PLAINS', null],
    ]);
    const units = new Map();
    const cat = makeUnit('CATAPULT', 'ai1', 1, 0, { factionId: 'crimson' });
    units.set(cat.id, cat);
    const actions = computeAIActions(
      units, tiles, { gold: 200, food: 100, wood: 50, iron: 30, production: 50 },
      'ai1', new Map(), null, FACTION_DEFS.crimson,
      warDiplo('ai1', 'enemy'), [], {}, new Map(), new Map(),
      createAIState(), { ai1: createTechState() }, {}, 10,
    );
    const moves = actions.filter(a => a.type === 'move' && a.unitId === cat.id);
    expect(moves.length).toBeGreaterThan(0);
    expect(moves[0].tx).toBeGreaterThan(cat.x);
  });

  it('moves toward the nearest enemy-owned tile when no other objective exists', () => {
    const tiles = makeTileMap([
      [0, 0, 'CITY', 'ai1'],
      [1, 0, 'PLAINS', 'ai1'],
      [2, 0, 'PLAINS', 'enemy'],
    ]);
    const units = new Map();
    const cat = makeUnit('CATAPULT', 'ai1', 1, 0, { factionId: 'crimson' });
    units.set(cat.id, cat);
    const actions = computeAIActions(
      units, tiles, { gold: 200, food: 100, wood: 50, iron: 30, production: 50 },
      'ai1', new Map(), null, FACTION_DEFS.crimson,
      warDiplo('ai1', 'enemy'), [], {}, new Map(), new Map(),
      createAIState(), { ai1: createTechState() }, {}, 10,
    );
    const moves = actions.filter(a => a.type === 'move' && a.unitId === cat.id);
    expect(moves.length).toBeGreaterThan(0);
    expect(moves[0].tx).toBeGreaterThan(cat.x);
  });
});

describe('ferry timeout', () => {
  it('clears a stuck ferry tag after five idle turns', () => {
    const tiles = makeTileMap([
      [0, 0, 'CITY', 'ai1'],
      [1, 0, 'PLAINS', 'ai1'],
      [2, 0, 'WATER', null],
      [3, 0, 'WATER', null],
    ]);
    const units = new Map();
    const inf = makeUnit('INFANTRY', 'ai1', 1, 0, {
      factionId: 'crimson',
      _ferryTo: { x: 10, z: 0 },
      _ferryTurns: 5,
    });
    const transport = makeUnit('TRANSPORT', 'ai1', 3, 0, { factionId: 'crimson', cargo: [] });
    units.set(inf.id, inf);
    units.set(transport.id, transport);
    computeAIActions(
      units, tiles, { gold: 200, food: 100, wood: 50, iron: 30, production: 50 },
      'ai1', new Map(), null, FACTION_DEFS.crimson,
      warDiplo('ai1', 'enemy'), [], {}, new Map(), new Map(),
      createAIState(), { ai1: createTechState() }, {}, 10,
    );
    expect(inf._ferryTo).toBeUndefined();
    expect(inf._ferryTurns).toBeUndefined();
  });
});
