/**
 * Part 5 — AI engineer corps fixes:
 *
 *  1. Engineer cap: the old cap stacked bonuses with no ceiling (war 3 +
 *     conquest 2 + water 2 + bridges 1 = 7+ engineers, ~100% support). It is
 *     now hard-capped at 4, so at war with a conquest goal the AI fields at
 *     most 4 engineers no matter how rich it is.
 *  2. First-engineer reserve: a faction with zero engineers still reserves
 *     the cost so the training spree can't crowd out its first engineer.
 *  3. Field siege engines: the buildSiegeEngine branch was dead — it gated
 *     on fullRoster (which only contains CATAPULT/TREBUCHET when a Siege
 *     Workshop exists) instead of the unlocking tech, and it checked the
 *     wrong cost. Engineers at war with a conquest goal and no siege units
 *     now build a CATAPULT in the field, and the game.js executor ticks the
 *     construction to completion.
 *  4. findAffordableUnit's combat fallback no longer spam-trains ENGINEERs
 *     (it sits right after the siege types in the siege-objective order)
 *     once the support corps is at 2+.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// three.js is not installed in the test environment — stub the renderer module
// so game.js can be imported (same pattern as city-siege-scenarios.test.js).
vi.mock('../src/renderer.js', () => ({ GameRenderer: class {} }));

import { Game } from '../src/game.js';
import { computeAIActions, findAffordableUnit } from '../src/ai.js';
import { createAIState } from '../src/ai_goals.js';
import { createTechState } from '../src/tech.js';
import { FACTION_DEFS } from '../src/faction.js';
import { setGridDimensions, DIPLOMACY_STATES, SIEGE_ENGINE_BUILD_TURNS } from '../src/config.js';
import { makeTile, makeUnit, makeTileMap, makeGameState } from './helpers.js';

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

/** A tech state with extra researched techs (on top of the free ancient ones). */
function makeTs(researched = []) {
    const ts = createTechState();
    for (const r of researched) ts.researched.add(r);
    return ts;
}

/** An aiState locked onto a conquest goal against `enemy`'s city. */
function conquestAIState(targetTileKey, targetFaction, cityX, cityZ) {
    const aiState = createAIState();
    aiState.goals = [{
        kind: 'conquest', priority: 1.0, horizon: 'short',
        targetTileKey, targetFaction,
        meta: { cityX, cityZ, neutral: false },
    }];
    aiState.planLockUntil = 100;
    return aiState;
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

const RICH = { gold: 2000, food: 1000, wood: 500, iron: 200, production: 500 };

// ===========================================================================
// 1. Engineer cap — no more 7-engineer support armies
// ===========================================================================
describe('engineer cap', () => {
    // Crimson at war, conquest goal locked onto the enemy city at (12,5);
    // home city at (2,5). Plains only — no water/river bonuses — so the cap
    // is min(3 + 2 conquest, 4) = 4 (old formula: 5; with water on the path
    // it reached 7).
    function capSetup(engineerCount) {
        const tiles = plainsGrid(0, 14, 0, 8, [
            [2, 5, 'CITY', 'ai1', { cityName: 'Home', cityLevel: 2, fortification: 3, fortMax: 3 }],
            [3, 5, 'PLAINS', 'ai1'], [4, 5, 'PLAINS', 'ai1'], [5, 5, 'PLAINS', 'ai1'],
            [6, 5, 'PLAINS', 'ai1'], [7, 5, 'PLAINS', 'ai1'], [8, 5, 'PLAINS', 'ai1'],
            [12, 5, 'CITY', 'enemy', { cityName: 'Target', cityLevel: 2, fortification: 3, fortMax: 3 }],
        ]);
        const units = new Map();
        for (let i = 0; i < 3; i++) {
            const u = makeUnit('INFANTRY', 'ai1', 4 + i, 5, { factionId: 'crimson' });
            units.set(u.id, u);
        }
        for (let i = 0; i < engineerCount; i++) {
            const u = makeUnit('ENGINEER', 'ai1', 6 + i, 5, { factionId: 'crimson' });
            units.set(u.id, u);
        }
        return {
            tiles, units,
            resources: { ...RICH },
            owner: 'ai1', buildings: new Map(), influence: null,
            factionDef: FACTION_DEFS.crimson,
            diploState: warDiplo('ai1', 'enemy'), lords: [], tempBonuses: {},
            structures: new Map(), buildingState: new Map(),
            aiState: conquestAIState('12,5', 'enemy', 12, 5),
            aiTechStates: { ai1: makeTs() },
            victoryState: { projects: {}, tradeRoutes: {}, scoreSnapshots: {} },
            currentTurn: 20,
        };
    }

    it('trains no further engineers once 4 are on the field (hard cap), even with a huge treasury', () => {
        const input = capSetup(4);
        const actions = runAI(input);
        const engTrains = actions.filter(a => a.type === 'train' && a.unitType === 'ENGINEER');
        expect(engTrains.length).toBe(0);
    });

    it('trains no further engineers with 6 on the field (old cap trained up to 7)', () => {
        const input = capSetup(6);
        const actions = runAI(input);
        const engTrains = actions.filter(a => a.type === 'train' && a.unitType === 'ENGINEER');
        expect(engTrains.length).toBe(0);
    });

    it('never accumulates more than 4 engineers over consecutive turns', () => {
        const input = capSetup(0);
        for (let turn = 0; turn < 8; turn++) {
            const actions = runAI(input);
            // Simulate the trained engineers actually spawning.
            for (const a of actions) {
                if (a.type === 'train' && a.unitType === 'ENGINEER') {
                    const u = makeUnit('ENGINEER', 'ai1', 3, 5, { factionId: 'crimson' });
                    input.units.set(u.id, u);
                }
            }
            const engCount = [...input.units.values()].filter(u => u.type === 'ENGINEER').length;
            expect(engCount).toBeLessThanOrEqual(4);
        }
        // And it did field a corps at all (the cap isn't 0).
        const engCount = [...input.units.values()].filter(u => u.type === 'ENGINEER').length;
        expect(engCount).toBeGreaterThan(0);
    });
});

// ===========================================================================
// 2. First-engineer reserve regression
// ===========================================================================
describe('first-engineer reserve', () => {
    // Verdant (no roster siege — engineers are its only siege path) at war
    // with a conquest goal, zero engineers.
    function reserveSetup(resources) {
        const tiles = plainsGrid(0, 14, 0, 8, [
            [2, 5, 'CITY', 'ai1', { cityName: 'Home', cityLevel: 2, fortification: 3, fortMax: 3 }],
            [3, 5, 'PLAINS', 'ai1'], [4, 5, 'PLAINS', 'ai1'], [5, 5, 'PLAINS', 'ai1'],
            [12, 5, 'CITY', 'enemy', { cityName: 'Target', cityLevel: 2, fortification: 3, fortMax: 3 }],
        ]);
        const units = new Map();
        const u = makeUnit('INFANTRY', 'ai1', 4, 5, { factionId: 'verdant' });
        units.set(u.id, u);
        return {
            tiles, units,
            resources,
            owner: 'ai1', buildings: new Map(), influence: null,
            factionDef: FACTION_DEFS.verdant,
            diploState: warDiplo('ai1', 'enemy'), lords: [], tempBonuses: {},
            structures: new Map(), buildingState: new Map(),
            aiState: conquestAIState('12,5', 'enemy', 12, 5),
            aiTechStates: { ai1: makeTs() },
            victoryState: { projects: {}, tradeRoutes: {}, scoreSnapshots: {} },
            currentTurn: 20,
        };
    }

    it('AI with zero engineers trains its first engineer when affordable', () => {
        const input = reserveSetup({ gold: 500, food: 100, wood: 60, iron: 30, production: 60 });
        const actions = runAI(input);
        const engTrains = actions.filter(a => a.type === 'train' && a.unitType === 'ENGINEER');
        expect(engTrains.length).toBeGreaterThanOrEqual(1);
    });

    it('unaffordable first engineer is reserved: the spree cannot drain the gold set aside for it', () => {
        // Engineer costs iron 8 — with iron 0 the engineer is unaffordable, so
        // block 1c reserves its cost (gold 45) instead of letting block 2d
        // spend it on an INFANTRY (gold 30).
        const input = reserveSetup({ gold: 60, food: 100, wood: 50, iron: 0, production: 50 });
        const actions = runAI(input);
        expect(actions.filter(a => a.type === 'train' && a.unitType === 'ENGINEER').length).toBe(0);
        expect(actions.filter(a => a.type === 'train' && a.unitType === 'INFANTRY').length).toBe(0);
    });
});

// ===========================================================================
// 3. Engineers actually build field siege engines
// ===========================================================================
describe('engineer field siege construction', () => {
    // Verdant at war with a conquest goal; one engineer on owned plains, the
    // enemy city 8 tiles away (outside SIEGE_TOWER_BUILD_RADIUS 3), no siege
    // units in the army, MATHEMATICS researched (unlocks CATAPULT).
    function siegeBuildSetup(overrides = {}) {
        const tiles = plainsGrid(0, 14, 0, 8, [
            [2, 5, 'CITY', 'ai1', { cityName: 'Home', cityLevel: 2, fortification: 3, fortMax: 3 }],
            [3, 5, 'PLAINS', 'ai1'], [4, 5, 'PLAINS', 'ai1'], [5, 5, 'PLAINS', 'ai1'],
            [12, 5, 'CITY', 'enemy', { cityName: 'Target', cityLevel: 2, fortification: 3, fortMax: 3 }],
        ]);
        const units = new Map();
        const eng = makeUnit('ENGINEER', 'ai1', 4, 5, { factionId: 'verdant' });
        units.set(eng.id, eng);
        const inf = makeUnit('INFANTRY', 'ai1', 5, 5, { factionId: 'verdant' });
        units.set(inf.id, inf);
        return {
            tiles, units, engineer: eng,
            resources: { ...RICH },
            owner: 'ai1', buildings: new Map(), influence: null,
            factionDef: FACTION_DEFS.verdant,
            diploState: warDiplo('ai1', 'enemy'), lords: [], tempBonuses: {},
            structures: new Map(), buildingState: new Map(),
            aiState: conquestAIState('12,5', 'enemy', 12, 5),
            aiTechStates: { ai1: makeTs(['MATHEMATICS']) },
            victoryState: { projects: {}, tradeRoutes: {}, scoreSnapshots: {} },
            currentTurn: 20,
            ...overrides,
        };
    }

    it('engineer at war with a conquest goal and no siege units emits buildSiegeEngine', () => {
        const input = siegeBuildSetup();
        const actions = runAI(input);
        const builds = actions.filter(a => a.type === 'buildSiegeEngine');
        expect(builds.length).toBe(1);
        expect(builds[0].unitId).toBe(input.engineer.id);
        expect(builds[0].engineType).toBe('CATAPULT'); // MATHEMATICS, not yet SIEGE_CRAFT
    });

    it('does not field-build without the unlocking tech', () => {
        const input = siegeBuildSetup({ aiTechStates: { ai1: makeTs() } });
        const actions = runAI(input);
        expect(actions.filter(a => a.type === 'buildSiegeEngine').length).toBe(0);
    });

    it('does not field-build when the army already has siege units', () => {
        const input = siegeBuildSetup();
        const siege = makeUnit('SIEGE', 'ai1', 6, 5, { factionId: 'crimson' });
        input.units.set(siege.id, siege);
        const actions = runAI(input);
        expect(actions.filter(a => a.type === 'buildSiegeEngine').length).toBe(0);
    });
});

// ===========================================================================
// 3b. Executor: buildSiegeEngine ticks over turns and produces the unit
// ===========================================================================
describe('buildSiegeEngine executor (game.js)', () => {
    /** A Game instance without the DOM/renderer (same pattern as
     *  city-siege-scenarios.test.js). */
    function makeAIGame(state) {
        const g = Object.create(Game.prototype);
        g.gameState = state;
        g.tiles = state.tiles;
        g.factionColors = state.factionColors;
        g.factionDefs = state.factionDefs;
        g.spectateMode = false;
        g.hooks = {};
        const noop = () => {};
        g.renderer = new Proxy({}, { get: () => noop });
        g.ui = new Proxy({}, { get: () => noop });
        g.logs = [];
        g.log = (m) => g.logs.push(m);
        g.checkVictory = () => {};
        g.updateFog = () => {};
        g._aiMaybeDeclareWar = () => {};
        g._aiMaybeProposeTreaty = () => {};
        g._aiShouldActivateKing = () => false;
        g._aiMoveLords = () => {};
        g._aiLordAttack = () => {};
        return g;
    }

    it('runAITurn starts the field build and it completes into a CATAPULT after the build turns', () => {
        const state = makeGameState({ turn: 5 });
        // ai1 = Verdant at war with the player; its city is at (10,10), the
        // player's fortified city at (5,5) — 8 tiles from the engineer, well
        // outside SIEGE_TOWER_BUILD_RADIUS (3), so the tower branch can't win.
        // Fill the map with plains so the locked conquest goal's land-
        // reachability check (goalValid) holds on the sparse default map.
        for (let x = 3; x <= 13; x++) for (let z = 3; z <= 13; z++) {
            const k = `${x},${z}`;
            if (!state.tiles.has(k)) state.tiles.set(k, makeTile(x, z, 'PLAINS', null));
        }
        state.diplomacy = warDiplo('ai1', 'player');
        state.factionDefs = { player: FACTION_DEFS.crimson, ai1: FACTION_DEFS.verdant };
        state.units.clear();
        const eng = makeUnit('ENGINEER', 'ai1', 9, 10, { factionId: 'verdant' });
        state.units.set(eng.id, eng);
        const inf = makeUnit('INFANTRY', 'ai1', 11, 10, { factionId: 'verdant' });
        state.units.set(inf.id, inf);
        state.resources.ai1 = { gold: 2000, food: 1000, wood: 500, iron: 200, production: 500 };
        state.aiState = { ai1: conquestAIState('5,5', 'player', 5, 5) };
        state.aiTechStates = { ai1: makeTs(['MATHEMATICS']) };

        const g = makeAIGame(state);
        g.runAITurn('ai1');

        // The executor started a SIEGE_ENGINE construction for the engineer.
        const proj = state.construction.get(eng.id);
        expect(proj).toBeDefined();
        expect(proj.type).toBe('SIEGE_ENGINE');
        expect(proj.engineType).toBe('CATAPULT');
        expect(proj.turnsLeft).toBe(SIEGE_ENGINE_BUILD_TURNS);

        // Tick the project down: after SIEGE_ENGINE_BUILD_TURNS ticks a real
        // CATAPULT unit stands on the engineer's tile.
        for (let i = 0; i < SIEGE_ENGINE_BUILD_TURNS; i++) g._tickConstructionFor('ai1');
        expect(state.construction.has(eng.id)).toBe(false);
        const catapult = [...state.units.values()].find(u => u.type === 'CATAPULT' && u.owner === 'ai1');
        expect(catapult).toBeDefined();
        expect([catapult.x, catapult.z]).toEqual([9, 10]);
    });
});

// ===========================================================================
// 4. Combat fallback must not spam engineers
// ===========================================================================
describe('findAffordableUnit engineer guard', () => {
    // Siege objective, roster with no siege units: the role loop finds nothing
    // and the fallback order reaches ENGINEER (it sits right after the siege
    // types). With 2+ engineers already, the guard skips it.
    const siegeObjective = { siege: true, raid: false, defensive: false, decisive: false, kind: 'siege' };

    function twoEngineers() {
        const units = new Map();
        for (let i = 0; i < 2; i++) {
            const e = makeUnit('ENGINEER', 'ai1', 3 + i, 5, { factionId: 'verdant' });
            units.set(e.id, e);
        }
        for (let i = 0; i < 2; i++) {
            const m = makeUnit('INFANTRY', 'ai1', 6 + i, 5, { factionId: 'verdant' });
            units.set(m.id, m);
        }
        return units;
    }

    it('skips ENGINEER in the fallback once 2+ engineers exist', () => {
        // INFANTRY unaffordable (needs food 10) so the fallback is reached;
        // ENGINEER (food 8) would be picked without the guard.
        const res = { gold: 100, food: 9, wood: 50, iron: 30, production: 50 };
        const pick = findAffordableUnit(res, ['INFANTRY', 'ENGINEER'], FACTION_DEFS.verdant,
            twoEngineers(), [], 'ai1', siegeObjective, false, null);
        expect(pick).not.toBe('ENGINEER');
    });

    it('still allows an ENGINEER from the fallback below the guard threshold', () => {
        const units = new Map();
        const e = makeUnit('ENGINEER', 'ai1', 3, 5, { factionId: 'verdant' });
        units.set(e.id, e);
        for (let i = 0; i < 3; i++) {
            const m = makeUnit('INFANTRY', 'ai1', 6 + i, 5, { factionId: 'verdant' });
            units.set(m.id, m);
        }
        const res = { gold: 100, food: 9, wood: 50, iron: 30, production: 50 };
        const pick = findAffordableUnit(res, ['ENGINEER'], FACTION_DEFS.verdant,
            units, [], 'ai1', siegeObjective, false, null);
        expect(pick).toBe('ENGINEER');
    });
});
