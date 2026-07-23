/**
 * Phase 4 scenario tests — AI goals/army behavior fixes:
 *
 *  1. Breached-city detachment: a breached, empty enemy city a few tiles from
 *     an army group gets ONE unit detached to claim it (captured within a few
 *     turns); no detachment when the AI can't afford the capture cost.
 *  2. Attack-king gating: a guarded or full-health enemy king with no local
 *     power disadvantage no longer creates/persists the attack-king goal, so
 *     conquest keeps priority; a genuinely vulnerable king still does.
 *  3. King retreat mobility weighting: the king retreats earlier from mobile
 *     threats (cavalry) than from slow melee at the same distance.
 *  4. Naval conquest vs expand-islands: when an empty foreign landmass exists
 *     and conquest targets are naval-only, expand-islands outscores conquest;
 *     without an empty landmass, naval conquest remains.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// three.js is not installed in the test environment — stub the renderer module
// so game.js can be imported (same pattern as city-siege-scenarios.test.js).
vi.mock('../src/renderer.js', () => ({ GameRenderer: class {} }));

import { Game } from '../src/game.js';
import { computeAIActions } from '../src/ai.js';
import { createAIState, selectGoals } from '../src/ai_goals.js';
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

function baseAIInput(tiles, units, overrides = {}) {
    return {
        tiles, units,
        resources: overrides.resources || { gold: 200, food: 100, wood: 50, iron: 30, production: 50 },
        owner: 'ai1',
        buildings: new Map(),
        influence: null,
        factionDef: FACTION_DEFS.crimson,
        diploState: warDiplo('ai1', 'enemy'),
        lords: overrides.lords || [],
        tempBonuses: {}, structures: new Map(), buildingState: new Map(),
        aiState: overrides.aiState || createAIState(),
        aiTechStates: { ai1: createTechState() },
        victoryState: { projects: {}, tradeRoutes: {}, scoreSnapshots: {} },
        currentTurn: overrides.currentTurn || 5,
    };
}

const manhattan = (ax, az, bx, bz) => Math.abs(ax - bx) + Math.abs(az - bz);

// ===========================================================================
// 1. Breached-city detachment
// ===========================================================================
describe('breached-city detachment', () => {
    // AI army group at (5..6, 5..6); the shared strategic target is the
    // fortified enemy city at (2,7); a breached, empty enemy city sits at
    // (9,5), 3-4 tiles from the group.
    function breachSetup(overrides = {}) {
        const tiles = plainsGrid(0, 14, 0, 10, [
            [2, 2, 'CITY', 'ai1', { cityName: 'Home', cityLevel: 2, fortification: 3, fortMax: 3 }],
            [2, 7, 'CITY', 'enemy', { cityName: 'Target', cityLevel: 2, fortification: 3, fortMax: 3 }],
            [9, 5, 'CITY', 'enemy', { cityName: 'Breached', cityLevel: 1, fortification: 0, fortMax: 3, breachedTurn: 1 }],
        ]);
        const units = new Map();
        for (const [i, [x, z]] of [[5, 5], [6, 5], [6, 6]].entries()) {
            const u = makeUnit('INFANTRY', 'ai1', x, z, { factionId: 'crimson' });
            units.set(u.id, u);
        }
        return baseAIInput(tiles, units, overrides);
    }

    it('detaches a unit that reaches and captures the breached city within a few turns', () => {
        const input = breachSetup();
        const allActions = [];
        let movedCloserTurn1 = false;
        for (let t = 0; t < 6; t++) {
            const actions = runAI(input);
            allActions.push(actions);
            for (const a of actions) {
                if (a.type !== 'move') continue;
                const u = [...input.units.values()].find(x => x.id === a.unitId);
                // Turn 1: some unit moves closer to the breached city (the
                // detachment), even though the group's strategic target is
                // (2,7) in the opposite direction.
                if (t === 0 && manhattan(a.tx, a.tz, 9, 5) < manhattan(u.x, u.z, 9, 5)) {
                    movedCloserTurn1 = true;
                }
                u.x = a.tx; u.z = a.tz;
            }
            for (const u of input.units.values()) {
                u.hasMovedThisTurn = false;
                u.hasAttackedThisTurn = false;
            }
            input.currentTurn++;
        }
        expect(movedCloserTurn1).toBe(true);

        // Within 6 turns the breached city is captured (capture action emitted).
        const captured = allActions.some(actions =>
            actions.some(a => a.type === 'capture' && a.tileKey === '9,5'));
        expect(captured).toBe(true);
    });

    it('does NOT detach when the AI lacks the capture cost (gold < 20)', () => {
        const input = breachSetup({
            // Low everything: gold below CAPTURE_COST and no surplus stock the
            // market block could sell to raise it.
            resources: { gold: 10, food: 10, wood: 10, iron: 0, production: 20 },
        });
        const allActions = [];
        for (let t = 0; t < 6; t++) {
            const actions = runAI(input);
            allActions.push(actions);
            for (const a of actions) {
                if (a.type !== 'move') continue;
                const u = [...input.units.values()].find(x => x.id === a.unitId);
                u.x = a.tx; u.z = a.tz;
            }
            for (const u of input.units.values()) {
                u.hasMovedThisTurn = false;
                u.hasAttackedThisTurn = false;
            }
            // No unit was sent to the breached city: nobody ends the turn
            // within capture range of it.
            for (const u of input.units.values()) {
                const cheb = Math.max(Math.abs(u.x - 9), Math.abs(u.z - 5));
                expect(cheb).toBeGreaterThan(2);
            }
            input.currentTurn++;
        }
        const captured = allActions.some(actions =>
            actions.some(a => a.type === 'capture' && a.tileKey === '9,5'));
        expect(captured).toBe(false);
    });
});

// ===========================================================================
// 2. Attack-king vulnerability gating
// ===========================================================================
function goalsBaseInput(overrides = {}) {
    return {
        aiState: createAIState(),
        turn: 1,
        factionDef: { id: 'crimson', aiPersonality: 'AGGRESSIVE' },
        enemies: ['azure'],
        enemyCities: [],
        ownCities: [{ x: 0, z: 0 }],
        homeAnchor: { x: 0, z: 0 },
        activeObjectives: { defensive: false },
        threatenedOwnCity: null,
        myCityCount: 3,
        settlerTarget: 8,
        bestFoundSpotKey: null, // suppress settle so attack-king can be top
        enemyKings: [],
        ...overrides,
    };
}

describe('attack-king vulnerability gating', () => {
    it('is NOT created for a full-health unguarded king with no local power disadvantage', () => {
        const goals = selectGoals(goalsBaseInput({
            enemyKings: [{ id: 'k1', owner: 'azure', isKing: true, x: 2, z: 0, hp: 20, maxHp: 20, guarded: false, vulnerable: false }],
        }));
        expect(goals.some(g => g.kind === 'attack-king')).toBe(false);
    });

    it('is dropped inside the stability lock when the king turtles up (goalValid re-check)', () => {
        const aiState = createAIState();
        let input = goalsBaseInput({
            aiState, turn: 1,
            enemyKings: [{ id: 'k1', owner: 'azure', isKing: true, x: 2, z: 0, hp: 20, maxHp: 20, guarded: false, vulnerable: true }],
        });
        const g1 = selectGoals(input);
        expect(g1[0].kind).toBe('attack-king'); // top goal while vulnerable
        // King gets bodyguards / heals up within the lock window.
        input = goalsBaseInput({
            aiState, turn: 2,
            enemyKings: [{ id: 'k1', owner: 'azure', isKing: true, x: 2, z: 0, hp: 20, maxHp: 20, guarded: true, vulnerable: false }],
        });
        const g2 = selectGoals(input);
        expect(g2.some(g => g.kind === 'attack-king')).toBe(false);
    });

    it('still works for a genuinely vulnerable king (unguarded + low HP) — regression', () => {
        const aiState = createAIState();
        const king = { id: 'k1', owner: 'azure', isKing: true, x: 2, z: 0, hp: 5, maxHp: 20, guarded: false, vulnerable: true };
        let input = goalsBaseInput({ aiState, turn: 1, enemyKings: [king] });
        const g1 = selectGoals(input);
        expect(g1[0].kind).toBe('attack-king');
        // Persists inside the lock window while the king stays vulnerable.
        input = goalsBaseInput({ aiState, turn: 2, enemyKings: [king] });
        const g2 = selectGoals(input);
        expect(g2[0].kind).toBe('attack-king');
    });

    // Full-pipeline: conquest group with a seeded attack-king top goal.
    function kingHuntSetup(kingHp, kingMaxHp) {
        const tiles = plainsGrid(0, 16, 0, 10, [
            [2, 2, 'CITY', 'ai1', { cityName: 'Home', cityLevel: 2, fortification: 3, fortMax: 3 }],
        ]);
        const units = new Map();
        for (const [x, z] of [[6, 5], [6, 6], [7, 5]]) {
            const u = makeUnit('INFANTRY', 'ai1', x, z, { factionId: 'crimson' });
            units.set(u.id, u);
        }
        const enemyKing = {
            id: 'ek1', owner: 'enemy', isKing: true, x: 12, z: 5,
            name: 'Enemy King', xp: 0, level: 1,
            stats: { command: 2, combat: 2, governance: 1 },
            abilities: [], army: [], hp: kingHp, maxHp: kingMaxHp,
            hasMovedThisTurn: false, hasAttackedThisTurn: false,
        };
        const aiState = createAIState();
        aiState.goals = [{
            kind: 'attack-king', priority: 1, horizon: 'immediate',
            targetTileKey: '12,5', targetFaction: 'enemy',
            meta: { kingId: 'ek1' }, plan: null, stabilityTurns: 3, born: 1,
        }];
        aiState.planLockUntil = 999;
        aiState.lastPlanTurn = 1;
        return baseAIInput(tiles, units, { aiState, lords: [enemyKing] });
    }

    it('conquest group beelines to a vulnerable enemy king (attack-king top goal)', () => {
        const input = kingHuntSetup(5, 20); // wounded + unguarded => vulnerable
        const actions = runAI(input);
        expect(input.aiState.goals[0].kind).toBe('attack-king'); // goal kept
        const startPos = new Map([...input.units.values()].map(u => [u.id, [u.x, u.z]]));
        const moves = actions.filter(a => a.type === 'move');
        expect(moves.length).toBeGreaterThan(0);
        // At least one unit steps toward the king at (12,5).
        const toward = moves.some(a => {
            const [sx, sz] = startPos.get(a.unitId);
            return manhattan(a.tx, a.tz, 12, 5) < manhattan(sx, sz, 12, 5);
        });
        expect(toward).toBe(true);
    });

    it('non-vulnerable enemy king: attack-king is replanned away, no beeline', () => {
        const input = kingHuntSetup(20, 20); // full HP, unguarded, no one nearby
        const actions = runAI(input);
        // The stale seeded goal fails the vulnerability re-check and is dropped.
        expect(input.aiState.goals.some(g => g.kind === 'attack-king')).toBe(false);
        const startPos = new Map([...input.units.values()].map(u => [u.id, [u.x, u.z]]));
        const moves = actions.filter(a => a.type === 'move');
        // No unit moves toward the king's position.
        const toward = moves.some(a => {
            const [sx, sz] = startPos.get(a.unitId);
            return manhattan(a.tx, a.tz, 12, 5) < manhattan(sx, sz, 12, 5);
        });
        expect(toward).toBe(false);
    });
});

// ===========================================================================
// 3. King retreat mobility weighting (_aiMoveKing harness)
// ===========================================================================
function makeGame(state) {
    const g = Object.create(Game.prototype);
    g.gameState = state;
    g.tiles = state.tiles;
    g.factionColors = state.factionColors;
    g.factionDefs = state.factionDefs || {};
    g.spectateMode = false;
    g.hooks = {};
    const noop = () => {};
    g.renderer = new Proxy({}, { get: () => noop });
    g.ui = new Proxy({}, { get: () => noop });
    g.logs = [];
    g.log = (m) => g.logs.push(m);
    g.checkVictory = () => {};
    g.updateFog = () => {};
    return g;
}

function kingRetreatSetup(foeType) {
    const tiles = plainsGrid(0, 20, 0, 20, [
        [10, 7, 'CITY', 'ai1', { cityName: 'Home', cityLevel: 2, fortification: 5, fortMax: 5 }],
    ]);
    const units = new Map();
    // A friendly guard so the king's side isn't empty (keeps the raw
    // power-ratio check from firing in both cases).
    const guard = makeUnit('INFANTRY', 'ai1', 10, 9, { factionId: 'crimson' });
    units.set(guard.id, guard);
    // The threat: distance 3 (Chebyshev) from the king at (10,10).
    const foe = makeUnit(foeType, 'enemy', 13, 10, { factionId: 'azure' });
    units.set(foe.id, foe);
    const king = {
        id: 'king-ai1', owner: 'ai1', isKing: true, x: 10, z: 10,
        name: 'King', xp: 0, level: 1,
        stats: { command: 2, combat: 2, governance: 1 },
        abilities: [], army: [],
        hp: 31, maxHp: 50, // 62% — between the two mobility-weighted thresholds
        hasMovedThisTurn: false, hasAttackedThisTurn: false,
    };
    const state = {
        turn: 5,
        tiles, units,
        lords: [king],
        buildings: new Map(), buildingState: new Map(), structures: new Map(),
        aiState: null,
        factionColors: { ai1: { tile: 0xb33333, unit: 0xff5544, name: 'Crimson' } },
        factionDefs: {},
    };
    return { state, king };
}

describe('king retreat mobility weighting', () => {
    const atWarFn = (o) => o === 'enemy';

    it('slow melee (moveRange 2) at distance 3 does NOT trigger a retreat', () => {
        const { state, king } = kingRetreatSetup('INFANTRY'); // reach 2+1 = 3
        const g = makeGame(state);
        g._aiMoveKing(king, 'ai1', atWarFn, { gold: 100 });
        expect(king.x).toBe(10);
        expect(king.z).toBe(10); // held position
    });

    it('cavalry (moveRange 3) at the same distance DOES trigger a retreat', () => {
        const { state, king } = kingRetreatSetup('CAVALRY'); // reach 3+1 = 4
        const g = makeGame(state);
        const chebBefore = Math.max(Math.abs(king.x - 10), Math.abs(king.z - 7));
        g._aiMoveKing(king, 'ai1', atWarFn, { gold: 100 });
        const chebAfter = Math.max(Math.abs(king.x - 10), Math.abs(king.z - 7));
        expect(king.x !== 10 || king.z !== 10).toBe(true); // moved
        expect(chebAfter).toBeLessThan(chebBefore); // toward home city
    });
});

// ===========================================================================
// 4. Naval conquest vs expand-islands
// ===========================================================================
describe('expand-islands vs naval-only conquest', () => {
    // Own city on the left landmass; target city on the right landmass across
    // a full water band => every conquest target is naval-only.
    function twoLandmassTiles(targetOwner, targetOv = {}) {
        const arr = [];
        for (let z = 0; z <= 12; z++) arr.push([5, z, 'WATER', null]); // water band
        const tiles = makeTileMap(arr);
        tiles.set('2,2', makeTile(2, 2, 'CITY', 'ai1', { cityName: 'Home', cityLevel: 2, fortification: 3, fortMax: 3 }));
        tiles.set('2,3', makeTile(2, 3, 'PLAINS', 'ai1'));
        tiles.set('3,2', makeTile(3, 2, 'PLAINS', 'ai1'));
        tiles.set('10,2', makeTile(10, 2, 'CITY', targetOwner, { cityName: 'Overseas', cityLevel: 1, fortification: 0, fortMax: 3, ...targetOv }));
        tiles.set('10,3', makeTile(10, 3, 'PLAINS', null));
        tiles.set('8,8', makeTile(8, 8, 'PLAINS', null));
        return tiles;
    }

    function navalInput(tiles, enemyCities, overrides = {}) {
        return goalsBaseInput({
            turn: 40, // mid game
            enemies: [],
            enemyCities,
            ownCities: [{ x: 2, z: 2 }],
            homeAnchor: { x: 2, z: 2 },
            tiles, myUnits: [],
            foreignShoreKey: '8,8',
            ...overrides,
        });
    }

    it('empty foreign landmass + naval-only targets => expand-islands outscores conquest', () => {
        const tiles = twoLandmassTiles(null); // neutral city across the water
        const goals = selectGoals(navalInput(tiles, [{ x: 10, z: 2, owner: null, neutral: true }], {
            needsNavalExpansion: true, foreignMassWithoutCity: true,
        }));
        expect(goals.some(g => g.kind === 'conquest')).toBe(true);
        expect(goals[0].kind).toBe('expand-islands');
    });

    it('no empty foreign landmass => naval conquest remains the top goal', () => {
        const tiles = twoLandmassTiles(null);
        const goals = selectGoals(navalInput(tiles, [{ x: 10, z: 2, owner: null, neutral: true }], {
            needsNavalExpansion: false, foreignMassWithoutCity: false,
        }));
        expect(goals[0].kind).toBe('conquest');
        expect(goals[0].meta.requiresNaval).toBe(true);
    });
});
