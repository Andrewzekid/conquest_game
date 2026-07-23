/**
 * Part 6 — siege escort coordination:
 *
 *  Siege towers/engines used to rush enemy cities alone (the block-4 tower
 *  beeline fired unconditionally, and planGroup's advance had no cohesion
 *  rule for siege units — CATAPULT/TREBUCHET/SIEGE aren't in FRAGILE_TYPES,
 *  and SIEGE_TOWER even counted as a "screener"). The escort rule:
 *
 *    A siege unit (SIEGE_TYPES) only advances on the objective while a
 *    friendly combat escort (melee/ranged/cavalry) is within
 *    SIEGE_ESCORT_RADIUS (3, Chebyshev). Unescorted, it moves to rejoin the
 *    nearest escort instead, or holds when the faction has no escorts.
 *
 *  Applied in two places: the block-4 siege-tower beeline (src/ai.js ~a2b)
 *  and planGroup's advance() (block 7).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// three.js is not installed in the test environment — stub the renderer module
// so game.js can be imported (same pattern as city-siege-scenarios.test.js).
vi.mock('../src/renderer.js', () => ({ GameRenderer: class {} }));

import { computeAIActions } from '../src/ai.js';
import { createAIState } from '../src/ai_goals.js';
import { createTechState } from '../src/tech.js';
import { FACTION_DEFS } from '../src/faction.js';
import { setGridDimensions, DIPLOMACY_STATES } from '../src/config.js';
import { makeTile, makeUnit, makeTileMap } from './helpers.js';

// sound.js looks up window.AudioContext when playing SFX; a bare global makes
// every SFX a no-op under node.
if (typeof globalThis.window === 'undefined') globalThis.window = {};

beforeEach(() => { setGridDimensions(40, 40); });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
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

function runAI(input) {
    return computeAIActions(
        input.units, input.tiles, input.resources, input.owner,
        input.buildings, input.influence, input.factionDef,
        input.diploState, input.lords, input.tempBonuses,
        input.structures, input.buildingState, input.aiState,
        input.aiTechStates, input.victoryState, input.currentTurn,
    );
}

/** A rectangular plains grid (x-outer insertion order) with extra tiles
 *  overlaid on top. */
function plainsGrid(x0, x1, z0, z1, extra = []) {
    const arr = [];
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) arr.push([x, z, 'PLAINS', null]);
    const tiles = makeTileMap(arr);
    for (const [x, z, terrain, owner, ov] of extra) {
        tiles.set(`${x},${z}`, makeTile(x, z, terrain, owner, ov || {}));
    }
    return tiles;
}

const manhattan = (ax, az, bx, bz) => Math.abs(ax - bx) + Math.abs(az - bz);

const CITY = { cityName: 'Target', cityLevel: 2, fortification: 3, fortMax: 3 };

/** Base scenario: ai1 (crimson) at war with `enemy`; ai1 home city at (2,5),
 *  fortified enemy city at (12,5). Units are added by each test. */
function escortSetup(unitSpecs, enemyCityX = 12) {
    const tiles = plainsGrid(0, 16, 0, 8, [
        [2, 5, 'CITY', 'ai1', { cityName: 'Home', cityLevel: 2, fortification: 3, fortMax: 3 }],
        [3, 5, 'PLAINS', 'ai1'], [4, 5, 'PLAINS', 'ai1'], [5, 5, 'PLAINS', 'ai1'],
        [enemyCityX, 5, 'CITY', 'enemy', { ...CITY }],
    ]);
    const units = new Map();
    const made = [];
    for (const [type, x, z] of unitSpecs) {
        const u = makeUnit(type, 'ai1', x, z, { factionId: 'crimson' });
        units.set(u.id, u);
        made.push(u);
    }
    return {
        tiles, units, made,
        resources: { gold: 200, food: 100, wood: 50, iron: 30, production: 50 },
        owner: 'ai1', buildings: new Map(), influence: null,
        factionDef: FACTION_DEFS.crimson,
        diploState: warDiplo('ai1', 'enemy'), lords: [], tempBonuses: {},
        structures: new Map(), buildingState: new Map(),
        aiState: createAIState(),
        aiTechStates: { ai1: createTechState() },
        victoryState: { projects: {}, tradeRoutes: {}, scoreSnapshots: {} },
        currentTurn: 20,
        enemyCityX,
    };
}

const movesFor = (actions, unit) =>
    actions.filter(a => a.type === 'move' && a.unitId === unit.id);

// ===========================================================================
// 1. Unescorted siege tower does NOT rush the city
// ===========================================================================
describe('siege tower escort rule (block 4)', () => {
    it('a lone siege tower with no friendly combat units holds instead of rushing the city', () => {
        const input = escortSetup([['SIEGE_TOWER', 6, 5]]);
        const tower = input.made[0];
        const actions = runAI(input);
        expect(movesFor(actions, tower).length).toBe(0);
        expect(actions.filter(a => a.type === 'besiege' && a.unitId === tower.id).length).toBe(0);
    });

    it('a tower far beyond escort range moves to rejoin the escort, not toward the city', () => {
        // Tower at (6,5), infantry screen at (3,5) — escort dist 3 is exactly
        // at the radius, so push it one further to make it unambiguous.
        const input = escortSetup([['SIEGE_TOWER', 7, 5], ['INFANTRY', 3, 5], ['INFANTRY', 3, 6]]);
        const tower = input.made[0];
        const actions = runAI(input);
        const mv = movesFor(actions, tower);
        // Any tower move must close on the escort (x decreases), not the city.
        for (const m of mv) expect(m.tx).toBeLessThan(tower.x);
    });

    it('an escorted tower advances toward the city with its screen', () => {
        // Escorts adjacent but off the direct lane so (7,5) is free.
        const input = escortSetup([['SIEGE_TOWER', 6, 5], ['INFANTRY', 6, 6], ['INFANTRY', 6, 4]]);
        const tower = input.made[0];
        const before = manhattan(tower.x, tower.z, input.enemyCityX, 5);
        const actions = runAI(input);
        const mv = movesFor(actions, tower);
        expect(mv.length).toBe(1);
        expect(manhattan(mv[0].tx, mv[0].tz, input.enemyCityX, 5)).toBeLessThan(before);
    });

    it('a tower already adjacent to a fortified enemy city besieges regardless of escort', () => {
        const input = escortSetup([['SIEGE_TOWER', 11, 5]]);
        const tower = input.made[0];
        const actions = runAI(input);
        expect(actions.filter(a => a.type === 'besiege' && a.unitId === tower.id).length).toBe(1);
    });
});

// ===========================================================================
// 2. Group cohesion for siege units (planGroup advance)
// ===========================================================================
describe('group siege cohesion (planGroup)', () => {
    it('a catapult far ahead of the melee screen does not advance further on the objective', () => {
        // Catapult 5 tiles ahead of the infantry screen (escort dist 5 > 3).
        const input = escortSetup(
            [['INFANTRY', 6, 5], ['INFANTRY', 6, 6], ['CATAPULT', 11, 5]], 14);
        const catapult = input.made[2];
        const before = manhattan(catapult.x, catapult.z, input.enemyCityX, 5);
        const actions = runAI(input);
        const mv = movesFor(actions, catapult);
        for (const m of mv) {
            expect(manhattan(m.tx, m.tz, input.enemyCityX, 5)).toBeGreaterThanOrEqual(before);
        }
        // Sanity: the melee screen itself advances normally toward the city.
        const infMoves = movesFor(actions, input.made[0]).concat(movesFor(actions, input.made[1]));
        expect(infMoves.length).toBeGreaterThan(0);
        expect(infMoves.some(m => manhattan(m.tx, m.tz, input.enemyCityX, 5) <
            manhattan(6, 5, input.enemyCityX, 5))).toBe(true);
    });

    it('an escorted catapult advances with the group (siege still reaches the city)', () => {
        // Escorts adjacent but off the direct lane so (7,5) is free.
        const input = escortSetup(
            [['INFANTRY', 6, 6], ['INFANTRY', 6, 4], ['CATAPULT', 5, 5]], 14);
        const catapult = input.made[2];
        const before = manhattan(catapult.x, catapult.z, input.enemyCityX, 5);
        const actions = runAI(input);
        const mv = movesFor(actions, catapult);
        expect(mv.length).toBe(1);
        expect(manhattan(mv[0].tx, mv[0].tz, input.enemyCityX, 5)).toBeLessThan(before);
        // And it does not end the turn ahead of the screen: after the moves
        // the infantry are at least as close to the objective as the catapult.
        const infMoves = movesFor(actions, input.made[0]).concat(movesFor(actions, input.made[1]));
        const infBest = Math.min(...infMoves.map(m => manhattan(m.tx, m.tz, input.enemyCityX, 5)),
            manhattan(6, 6, input.enemyCityX, 5));
        expect(manhattan(mv[0].tx, mv[0].tz, input.enemyCityX, 5)).toBeGreaterThanOrEqual(infBest - 1);
    });

    it('a group with no siege units is unaffected (melee advances as before)', () => {
        const input = escortSetup([['INFANTRY', 6, 5], ['CAVALRY', 6, 6]], 14);
        const actions = runAI(input);
        const all = movesFor(actions, input.made[0]).concat(movesFor(actions, input.made[1]));
        expect(all.length).toBeGreaterThan(0);
        expect(all.every(m => manhattan(m.tx, m.tz, input.enemyCityX, 5) <
            manhattan(6, 5, input.enemyCityX, 5))).toBe(true);
    });
});
