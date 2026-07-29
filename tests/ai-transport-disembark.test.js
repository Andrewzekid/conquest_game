/**
 * Transport disembark regression tests — the AI loaded units onto transports
 * but they never got off. Covers:
 *  1. War: military cargo unloads next to an enemy coastal city (planner emits
 *     disembark, executor puts the unit ashore) — including diagonal adjacency.
 *  2. Peace / no assault target: a loaded transport sails to the nearest
 *     foreign shore and unloads instead of drifting forever with cargo.
 *  3. STEAM_TRANSPORT is a first-class transport: the ferry logic steers it,
 *     the board/disembark executors accept it, and its own capacity (4) applies.
 *  4. No board→disembark→reboard loop: after unloading onto a foreign
 *     landmass, the next AI turn does not board the unit back on, while
 *     home-shore pickup (a landmass with a friendly city) still works.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// three.js is not installed in the test environment — stub the renderer module
// so game.js can be imported (same pattern as city-siege-scenarios.test.js).
vi.mock('../src/renderer.js', () => ({ GameRenderer: class {} }));

// Wrap computeAIActions in a spy so executor tests can inject a crafted action
// list while every other test transparently gets the real implementation.
const aiMock = vi.hoisted(() => ({ real: null }));
vi.mock('../src/ai.js', async (importOriginal) => {
    const orig = await importOriginal();
    aiMock.real = orig.computeAIActions;
    return { ...orig, computeAIActions: vi.fn((...args) => aiMock.real(...args)) };
});

import { Game } from '../src/game.js';
import { computeAIActions } from '../src/ai.js';
import { createAIState } from '../src/ai_goals.js';
import { createTechState } from '../src/tech.js';
import { FACTION_DEFS } from '../src/faction.js';
import { setGridDimensions } from '../src/config.js';
import { makeTile, makeUnit, makeTileMap, makeGameState } from './helpers.js';

// sound.js looks up window.AudioContext when playing SFX; a bare global makes
// every SFX a no-op under node.
if (typeof globalThis.window === 'undefined') globalThis.window = {};

beforeEach(() => {
    setGridDimensions(40, 40);
    // Restore the real AI planner before each test (executor tests override it).
    computeAIActions.mockImplementation((...args) => aiMock.real(...args));
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function warDiplo(a, b) {
    const rel = {
        state: 'war', turnsAllied: 0, turnsAtWar: 3, relationship: -50,
        warsDeclared: 1, peaceTreaties: 0, tradesMade: 0, brokenTreaties: 0,
        grievances: 0, grievanceLog: [], expiresOn: null, formalWar: true,
        lastWarDeclaredTurn: 1, grudges: {}, trust: 0.1,
    };
    return { relations: { [[a, b].sort().join(':')]: rel }, pendingOffers: [], diplomaticEvents: [] };
}

const peaceDiplo = () => ({ relations: {}, pendingOffers: [], diplomaticEvents: [] });

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

/** Two landmasses split by a 2-wide water channel (x = 5, 6): home (x 0..4,
 *  ai1 city at 2,3) and foreign (x 7..12, enemy coastal city at 7,3). */
function warIslandTiles() {
    const extra = [];
    for (let z = 0; z <= 6; z++) { extra.push([5, z, 'WATER', null]); extra.push([6, z, 'WATER', null]); }
    extra.push([2, 3, 'CITY', 'ai1', { cityName: 'Home', cityLevel: 2, fortification: 3, fortMax: 3 }]);
    extra.push([7, 3, 'CITY', 'enemy', { cityName: 'Target', cityLevel: 2, fortification: 3, fortMax: 3 }]);
    return plainsGrid(0, 12, 0, 6, extra);
}

function baseAIInput(tiles, units, overrides = {}) {
    return {
        tiles, units,
        resources: overrides.resources || { gold: 200, food: 100, wood: 50, iron: 30, production: 50 },
        owner: 'ai1',
        buildings: new Map(),
        influence: null,
        factionDef: FACTION_DEFS.crimson,
        diploState: overrides.diploState || warDiplo('ai1', 'enemy'),
        lords: [],
        tempBonuses: {}, structures: new Map(), buildingState: new Map(),
        aiState: overrides.aiState || createAIState(),
        aiTechStates: { ai1: createTechState() },
        victoryState: { projects: {}, tradeRoutes: {}, scoreSnapshots: {} },
        currentTurn: 5,
    };
}

/** A transport carrying one infantry: cargo link + boarded flag + co-location. */
function loadedTransport(type, owner, x, z, cargoType = 'INFANTRY') {
    const tr = makeUnit(type, owner, x, z, { cargo: [] });
    const cargo = makeUnit(cargoType, owner, x, z, { boarded: tr.id, factionId: 'crimson' });
    tr.cargo.push(cargo.id);
    return { tr, cargo };
}

/** A Game instance without the DOM/renderer (same pattern as
 *  city-siege-scenarios.test.js): prototype methods run against a plain
 *  gameState, diplomacy/king side-systems stubbed, real AI planner. */
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

const manhattan = (ax, az, bx, bz) => Math.abs(ax - bx) + Math.abs(az - bz);

// ===========================================================================
// 1. War: unload at the enemy coastal city
// ===========================================================================
describe('military cargo unloads for an amphibious assault', () => {
    it('planner emits disembark when orthogonally adjacent to the enemy coastal city', () => {
        const tiles = warIslandTiles();
        const { tr, cargo } = loadedTransport('TRANSPORT', 'ai1', 6, 3);
        const units = new Map([[tr.id, tr], [cargo.id, cargo]]);
        const actions = runAI(baseAIInput(tiles, units));
        expect(actions.some(a => a.type === 'disembark' && a.unitId === tr.id)).toBe(true);
    });

    it('planner emits disembark when diagonally adjacent (Manhattan 2) to the target city', () => {
        // (6,4) is kitty-corner to the enemy city at (7,3); previously the
        // Manhattan === 1 check never fired here and the cargo rode forever.
        const tiles = warIslandTiles();
        const { tr, cargo } = loadedTransport('TRANSPORT', 'ai1', 6, 4);
        const units = new Map([[tr.id, tr], [cargo.id, cargo]]);
        const actions = runAI(baseAIInput(tiles, units));
        expect(actions.some(a => a.type === 'disembark' && a.unitId === tr.id)).toBe(true);
    });

    it('executor puts the unit ashore on adjacent land and clears boarded', () => {
        const tiles = warIslandTiles();
        const { tr, cargo } = loadedTransport('TRANSPORT', 'ai1', 6, 4);
        const state = makeGameState({
            tiles,
            units: new Map([[tr.id, tr], [cargo.id, cargo]]),
            diplomacy: warDiplo('ai1', 'enemy'),
        });
        const g = makeAIGame(state);
        computeAIActions.mockImplementation(() => [{ type: 'disembark', unitId: tr.id }]);
        g.runAITurn('ai1');
        expect(cargo.boarded).toBeFalsy();
        expect(tr.cargo).toHaveLength(0);
        const ashore = state.tiles.get(`${cargo.x},${cargo.z}`);
        expect(ashore).toBeTruthy();
        expect(ashore.terrain).not.toBe('WATER');
        expect(manhattan(cargo.x, cargo.z, tr.x, tr.z)).toBe(1);
    });
});

// ===========================================================================
// 2. Peace / no assault target: unload at a foreign shore, never drift forever
// ===========================================================================
describe('loaded transport with no assault target unloads instead of drifting', () => {
    it('at peace, sails to the foreign shore and disembarks within a few turns', () => {
        // 4-wide channel (x 4..7): home x 0..3 (ai1 city), foreign x 8..12.
        const extra = [];
        for (let z = 0; z <= 6; z++) for (const x of [4, 5, 6, 7]) extra.push([x, z, 'WATER', null]);
        extra.push([1, 3, 'CITY', 'ai1', { cityName: 'Home', cityLevel: 2, fortification: 3, fortMax: 3 }]);
        const tiles = plainsGrid(0, 12, 0, 6, extra);
        const { tr, cargo } = loadedTransport('TRANSPORT', 'ai1', 5, 3);
        const units = new Map([[tr.id, tr], [cargo.id, cargo]]);
        const input = baseAIInput(tiles, units, { diploState: peaceDiplo() });

        let disembarked = false;
        for (let t = 0; t < 6 && !disembarked; t++) {
            const actions = runAI(input);
            for (const a of actions) {
                if (a.unitId !== tr.id) continue;
                if (a.type === 'disembark') disembarked = true;
                if (a.type === 'move') { tr.x = a.tx; tr.z = a.tz; cargo.x = a.tx; cargo.z = a.tz; }
            }
            tr.hasMovedThisTurn = false;
        }
        expect(disembarked).toBe(true);
        // It crossed the channel: the unload point is off the foreign island.
        expect(manhattan(tr.x, tr.z, 8, 3)).toBeLessThanOrEqual(2);
    });

    it('at war with no coastal enemy city, still unloads at a foreign shore', () => {
        // Same map, war diplo, but the enemy city is inland (not coastal), so
        // nearestEnemyCoastalCity finds nothing.
        const extra = [];
        for (let z = 0; z <= 6; z++) for (const x of [4, 5, 6, 7]) extra.push([x, z, 'WATER', null]);
        extra.push([1, 3, 'CITY', 'ai1', { cityName: 'Home', cityLevel: 2, fortification: 3, fortMax: 3 }]);
        extra.push([10, 3, 'CITY', 'enemy', { cityName: 'Inland', cityLevel: 2, fortification: 3, fortMax: 3 }]);
        const tiles = plainsGrid(0, 12, 0, 6, extra);
        const { tr, cargo } = loadedTransport('TRANSPORT', 'ai1', 5, 3);
        const units = new Map([[tr.id, tr], [cargo.id, cargo]]);
        const input = baseAIInput(tiles, units);

        let disembarked = false;
        for (let t = 0; t < 6 && !disembarked; t++) {
            const actions = runAI(input);
            for (const a of actions) {
                if (a.unitId !== tr.id) continue;
                if (a.type === 'disembark') disembarked = true;
                if (a.type === 'move') { tr.x = a.tx; tr.z = a.tz; cargo.x = a.tx; cargo.z = a.tz; }
            }
            tr.hasMovedThisTurn = false;
        }
        expect(disembarked).toBe(true);
    });
});

// ===========================================================================
// 3. STEAM_TRANSPORT is a first-class transport
// ===========================================================================
describe('STEAM_TRANSPORT ferries and unloads like a TRANSPORT', () => {
    it('planner ferries a loaded STEAM_TRANSPORT and disembarks at the target city', () => {
        const tiles = warIslandTiles();
        const { tr, cargo } = loadedTransport('STEAM_TRANSPORT', 'ai1', 6, 4);
        const units = new Map([[tr.id, tr], [cargo.id, cargo]]);
        const actions = runAI(baseAIInput(tiles, units));
        expect(actions.some(a => a.type === 'disembark' && a.unitId === tr.id)).toBe(true);
    });

    it('board executor accepts STEAM_TRANSPORT and uses its capacity of 4', () => {
        // Small pond map: steam transport at (5,5) with 3 units already aboard,
        // a 4th infantry waiting ashore at (5,6).
        const tiles = makeTileMap([
            [5, 5, 'WATER', null],
            [5, 6, 'PLAINS', 'ai1'], [6, 5, 'PLAINS', 'ai1'],
            [4, 5, 'PLAINS', 'ai1'], [5, 4, 'PLAINS', 'ai1'],
        ]);
        const st = makeUnit('STEAM_TRANSPORT', 'ai1', 5, 5, { cargo: [] });
        const units = new Map([[st.id, st]]);
        for (let i = 0; i < 3; i++) {
            const c = makeUnit('INFANTRY', 'ai1', 5, 5, { boarded: st.id });
            st.cargo.push(c.id);
            units.set(c.id, c);
        }
        const fourth = makeUnit('INFANTRY', 'ai1', 5, 6, { factionId: 'crimson' });
        units.set(fourth.id, fourth);
        const state = makeGameState({ tiles, units, diplomacy: warDiplo('ai1', 'enemy') });
        const g = makeAIGame(state);
        computeAIActions.mockImplementation(() => [{ type: 'board', unitId: fourth.id, transportId: st.id }]);
        g.runAITurn('ai1');
        expect(fourth.boarded).toBe(st.id);
        expect(st.cargo).toHaveLength(4);
    });

    it('disembark executor unloads a STEAM_TRANSPORT', () => {
        const tiles = makeTileMap([
            [5, 5, 'WATER', null],
            [5, 6, 'PLAINS', 'ai1'], [6, 5, 'PLAINS', 'ai1'],
            [4, 5, 'PLAINS', 'ai1'], [5, 4, 'PLAINS', 'ai1'],
        ]);
        const st = makeUnit('STEAM_TRANSPORT', 'ai1', 5, 5, { cargo: [] });
        const cargo = makeUnit('INFANTRY', 'ai1', 5, 5, { boarded: st.id });
        st.cargo.push(cargo.id);
        const state = makeGameState({
            tiles,
            units: new Map([[st.id, st], [cargo.id, cargo]]),
            diplomacy: warDiplo('ai1', 'enemy'),
        });
        const g = makeAIGame(state);
        computeAIActions.mockImplementation(() => [{ type: 'disembark', unitId: st.id }]);
        g.runAITurn('ai1');
        expect(cargo.boarded).toBeFalsy();
        expect(st.cargo).toHaveLength(0);
        const ashore = state.tiles.get(`${cargo.x},${cargo.z}`);
        expect(ashore).toBeTruthy();
        expect(ashore.terrain).not.toBe('WATER');
    });
});

// ===========================================================================
// 4. No board→disembark→reboard loop
// ===========================================================================
describe('no re-board loop after unloading', () => {
    it('after disembarking onto the foreign landmass, the next turn does not re-board the unit', () => {
        const tiles = warIslandTiles();
        const { tr, cargo } = loadedTransport('TRANSPORT', 'ai1', 6, 4);
        const state = makeGameState({
            tiles,
            units: new Map([[tr.id, tr], [cargo.id, cargo]]),
            diplomacy: warDiplo('ai1', 'enemy'),
        });
        const g = makeAIGame(state); // real planner, real executor

        // Turn 1: the transport unloads the infantry onto the foreign shore.
        g.runAITurn('ai1');
        expect(cargo.boarded).toBeFalsy();
        const landedTile = state.tiles.get(`${cargo.x},${cargo.z}`);
        expect(landedTile.terrain).not.toBe('WATER');

        // Turn 2 (fresh turn flags): the now-empty transport must not board
        // the unit straight back onto the ship.
        for (const u of state.units.values()) {
            u.hasMovedThisTurn = false;
            u.hasAttackedThisTurn = false;
        }
        g.runAITurn('ai1');
        expect(cargo.boarded).toBeFalsy();
        expect(tr.cargo || []).toHaveLength(0);
    });

    it('empty transport still picks up idle military on a FRIENDLY landmass shore', () => {
        const tiles = warIslandTiles();
        // Transport inserted first so it acts before the infantry this turn.
        const tr = makeUnit('TRANSPORT', 'ai1', 5, 3, { cargo: [] });
        const inf = makeUnit('INFANTRY', 'ai1', 4, 3, { factionId: 'crimson' });
        const units = new Map([[tr.id, tr], [inf.id, inf]]);
        const actions = runAI(baseAIInput(tiles, units));
        expect(actions.some(a => a.type === 'board' && a.unitId === inf.id && a.transportId === tr.id)).toBe(true);
    });
});
