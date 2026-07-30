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

// ---------------------------------------------------------------------------
// B8 — ranged besiege from attackRange + no hold-forever without foes
// ---------------------------------------------------------------------------
describe('ranged besiege and hold-forever fix', () => {
    it('trebuchet besieges an EMPTY enemy city from range 3 (no defender needed)', () => {
        // Escorted trebuchet 3 tiles from the enemy city: block 4b must emit a
        // besiege action even though the city has no garrison to attack.
        const input = escortSetup([['TREBUCHET', 9, 5], ['INFANTRY', 9, 4]]);
        const actions = runAI(input);
        const treb = input.made[0];
        const besieges = actions.filter(a => a.type === 'besiege' && a.unitId === treb.id);
        expect(besieges.length).toBe(1);
        expect(besieges[0].tileKey).toBe('12,5');
    });

    it('lone artillery with no foes near ADVANCES toward the city (no hold-forever)', () => {
        // No escorts anywhere and no enemy units: the engine must advance on
        // the city (a static city can't retaliate) instead of holding forever.
        const input = escortSetup([['ARTILLERY', 6, 5]]);
        const actions = runAI(input);
        const art = input.made[0];
        const moves = movesFor(actions, art);
        expect(moves.length).toBe(1);
        expect(moves[0].tx).toBeGreaterThan(art.x - 1); // moved toward x=12
    });

    it('siege under threat with NO escort left still advances (no permanent stall)', () => {
        // An enemy cavalry unit 4 tiles out (beyond the trebuchet's range 3,
        // but within its moveRange+attack threat reach) and no friendly
        // escorts: rather than holding forever, the engine keeps advancing.
        const input = escortSetup([['TREBUCHET', 7, 5]]);
        const foe = makeUnit('CAVALRY', 'enemy', 11, 5, { factionId: 'azure' });
        input.units.set(foe.id, foe);
        const actions = runAI(input);
        const treb = input.made[0];
        // Either advances toward the city or besieges — but never freezes
        // (previously: no escort → unconditional hold).
        const relevant = actions.filter(a => (a.type === 'move' || a.type === 'besiege') && a.unitId === treb.id);
        expect(relevant.length).toBe(1);
    });
});

describe('siege stall fix', () => {
    it('a catapult naturally stalls twice then keeps advancing (no stutter cycle)', () => {
        // Escort is outside the 3-tile radius and a mobile foe is close enough
        // to threaten the catapult. Run the AI for several consecutive turns and
        // let the stall counter accumulate naturally: turns 1-2 must move back
        // toward the escort, turn 3 must advance on the city, and turn 4 must
        // keep advancing (the old code reset the counter after the fallback,
        // causing a stall-advance-stall stutter cycle).
        const input = escortSetup([['CATAPULT', 7, 5], ['INFANTRY', 3, 5]], 14);
        const foe = makeUnit('CAVALRY', 'enemy', 11, 5, { factionId: 'azure' });
        input.units.set(foe.id, foe);
        const cat = input.made[0];

        // Turn 1: stall situation, counter accumulates to 1.
        const actions1 = runAI(input);
        const mv1 = movesFor(actions1, cat);
        expect(mv1.length).toBe(1);
        expect(mv1[0].tx).toBeLessThan(cat.x); // toward escort
        expect(cat._siegeStallTurns).toBe(1);

        // Turn 2: still stalled, counter accumulates to 2.
        const actions2 = runAI(input);
        const mv2 = movesFor(actions2, cat);
        expect(mv2.length).toBe(1);
        expect(mv2[0].tx).toBeLessThan(cat.x); // toward escort
        expect(cat._siegeStallTurns).toBe(2);

        // Turn 3: threshold reached, advance on the objective.
        const actions3 = runAI(input);
        const mv3 = movesFor(actions3, cat);
        expect(mv3.length).toBe(1);
        expect(mv3[0].tx).toBeGreaterThan(cat.x); // toward city
        expect(cat._siegeStallTurns).toBeGreaterThanOrEqual(2);

        // Turn 4: must keep advancing (counter is not reset while stall persists).
        const actions4 = runAI(input);
        const mv4 = movesFor(actions4, cat);
        expect(mv4.length).toBe(1);
        expect(mv4[0].tx).toBeGreaterThan(cat.x); // toward city
    });

    it('a siege unit does not consider an enemy 5 tiles away as an immediate threat', () => {
        // Escort is outside the 3-tile radius and the enemy is 5 tiles away.
        // Under the old reach+2 rule this triggered the escort check; under the
        // tighter eMove+eRange rule it does not, so the catapult keeps advancing.
        const input = escortSetup([['CATAPULT', 7, 5], ['INFANTRY', 3, 5]], 14);
        const foe = makeUnit('INFANTRY', 'enemy', 12, 5, { factionId: 'azure' });
        input.units.set(foe.id, foe);
        const cat = input.made[0];
        const actions = runAI(input);
        const mv = movesFor(actions, cat);
        expect(mv.length).toBe(1);
        expect(mv[0].tx).toBeGreaterThan(cat.x);
    });
});
