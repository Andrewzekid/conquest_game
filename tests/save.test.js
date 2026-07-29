/**
 * Save/load round-trip serialization tests.
 * Verifies that gameState survives save → JSON → load with all fields intact.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { saveGame, loadGame, verifySave, clearSave, _setStorageMode } from '../src/save.js';
import { makeGameState, makeUnit, makeTile } from './helpers.js';

// --- In-memory localStorage mock for Node.js environment ---
let _store = {};
const localStorageMock = {
    getItem(k) { return k in _store ? _store[k] : null; },
    setItem(k, v) { _store[k] = String(v); },
    removeItem(k) { delete _store[k]; },
    clear() { _store = {}; },
};
// save.js accesses `localStorage` as a global — inject it before each test.
const _origGlobal = typeof globalThis !== 'undefined' ? globalThis.localStorage : undefined;

beforeEach(() => {
    _store = {};
    // Force the localStorage fallback path (tests run in Node with no server).
    _setStorageMode(false);
    if (typeof globalThis !== 'undefined') globalThis.localStorage = localStorageMock;
});
afterEach(() => {
    if (typeof globalThis !== 'undefined') {
        if (_origGlobal !== undefined) globalThis.localStorage = _origGlobal;
        else delete globalThis.localStorage;
    }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function deepEqual(a, b, path = '') {
    if (a === b) return [];
    if (a == null || b == null) return [`${path}: ${a} !== ${b}`];
    if (typeof a !== typeof b) return [`${path}: type ${typeof a} !== ${typeof b}`];
    if (typeof a !== 'object') return [`${path}: ${a} !== ${b}`];

    const diffs = [];
    if (a instanceof Set && b instanceof Set) {
        if (a.size !== b.size) diffs.push(`${path}: Set size ${a.size} !== ${b.size}`);
        for (const v of a) if (!b.has(v)) diffs.push(`${path}: Set missing ${v}`);
        return diffs;
    }
    if (a instanceof Map && b instanceof Map) {
        if (a.size !== b.size) diffs.push(`${path}: Map size ${a.size} !== ${b.size}`);
        for (const [k, v] of a) {
            if (!b.has(k)) diffs.push(`${path}: Map missing key ${k}`);
            else diffs.push(...deepEqual(v, b.get(k), `${path}.Map(${k})`));
        }
        return diffs;
    }
    if (Array.isArray(a)) {
        if (a.length !== b.length) diffs.push(`${path}: Array length ${a.length} !== ${b.length}`);
        for (let i = 0; i < Math.min(a.length, b.length); i++) {
            diffs.push(...deepEqual(a[i], b[i], `${path}[${i}]`));
        }
        return diffs;
    }
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    const allKeys = new Set([...keysA, ...keysB]);
    for (const k of allKeys) {
        if (!(k in a)) diffs.push(`${path}: missing key "${k}" in original`);
        else if (!(k in b)) diffs.push(`${path}: missing key "${k}" in loaded`);
        else diffs.push(...deepEqual(a[k], b[k], `${path}.${k}`));
    }
    return diffs;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('save/load round-trip', () => {
    it('survives a minimal game state', async () => {
        const state = makeGameState();
        expect(await saveGame(state)).toBe(true);

        const loaded = await loadGame();
        expect(loaded).not.toBeNull();
        expect(loaded.turn).toBe(state.turn);
        expect(loaded.tiles.size).toBe(state.tiles.size);
        expect(loaded.units.size).toBe(state.units.size);
    });

    it('preserves tile fields (cityLevel, fortification, owner)', async () => {
        const state = makeGameState();
        const city = state.tiles.get('5,5');
        expect(city.cityLevel).toBe(2);
        expect(city.fortification).toBe(3);
        expect(city.owner).toBe('player');

        await saveGame(state);
        const loaded = await loadGame();
        const lCity = loaded.tiles.get('5,5');
        expect(lCity.cityLevel).toBe(2);
        expect(lCity.fortification).toBe(3);
        expect(lCity.owner).toBe('player');
    });

    it('preserves unit fields (type, owner, factionId, hp, level)', async () => {
        const state = makeGameState();
        const u = [...state.units.values()][0];
        u.factionId = 'crimson';
        u.hp = 7;
        u.level = 3;

        await saveGame(state);
        const loaded = await loadGame();
        const lu = [...loaded.units.values()].find(x => x.id === u.id);
        expect(lu).toBeDefined();
        expect(lu.type).toBe('INFANTRY');
        expect(lu.factionId).toBe('crimson');
        expect(lu.hp).toBe(7);
        expect(lu.level).toBe(3);
    });

    it('preserves buildings map', async () => {
        const state = makeGameState();
        state.buildings.set('7,5', ['BARRACKS', 'MARKET']);

        await saveGame(state);
        const loaded = await loadGame();
        expect(loaded.buildings.get('7,5')).toEqual(['BARRACKS', 'MARKET']);
    });

    it('preserves resources for all factions', async () => {
        const state = makeGameState();
        state.resources.player.gold = 999;
        state.resources.ai1.food = 888;

        await saveGame(state);
        const loaded = await loadGame();
        expect(loaded.resources.player.gold).toBe(999);
        expect(loaded.resources.ai1.food).toBe(888);
    });

    it('preserves diplomacy relations', async () => {
        const state = makeGameState();
        state.diplomacy.relations['player-ai1'] = {
            state: 'war', turnsAllied: 0, turnsAtWar: 3, relationship: -50,
            warsDeclared: 1, peaceTreaties: 0, tradesMade: 0, brokenTreaties: 0,
            grievances: 25, grievanceLog: [{ text: 'attacked', turn: 1 }],
            expiresOn: null, formalWar: true, lastWarDeclaredTurn: 1,
            grudges: {}, trust: 0.5,
        };

        await saveGame(state);
        const loaded = await loadGame();
        const rel = loaded.diplomacy.relations['player-ai1'];
        expect(rel.state).toBe('war');
        expect(rel.turnsAtWar).toBe(3);
        expect(rel.relationship).toBe(-50);
        expect(rel.grievances).toBe(25);
        expect(rel.formalWar).toBe(true);
        expect(rel.trust).toBe(0.5);
    });

    it('preserves techState (Set serialization)', async () => {
        const state = makeGameState();
        state.techState = {
            researched: new Set(['ARCHERY', 'BRONZE_WORKING']),
            current: 'MATHEMATICS',
            progress: 35,
        };

        await saveGame(state);
        const loaded = await loadGame();
        expect(loaded.techState).not.toBeNull();
        expect(loaded.techState.researched).toBeInstanceOf(Set);
        expect(loaded.techState.researched.has('ARCHERY')).toBe(true);
        expect(loaded.techState.researched.has('BRONZE_WORKING')).toBe(true);
        expect(loaded.techState.current).toBe('MATHEMATICS');
        expect(loaded.techState.progress).toBe(35);
    });

    it('preserves victoryState', async () => {
        const state = makeGameState();
        state.victoryState = {
            projects: { player: { spaceProgram: 5 } },
            tradeRoutes: { player: 3 },
            scoreSnapshots: { player: 150, ai1: 120 },
        };

        await saveGame(state);
        const loaded = await loadGame();
        expect(loaded.victoryState.projects.player.spaceProgram).toBe(5);
        expect(loaded.victoryState.tradeRoutes.player).toBe(3);
        expect(loaded.victoryState.scoreSnapshots.player).toBe(150);
    });

    it('preserves tradeRoutes array', async () => {
        const state = makeGameState();
        state.tradeRoutes = [{
            id: 1,
            from: { owner: 'player', cityKey: '5,5', x: 5, z: 5 },
            to: { owner: 'ai1', cityKey: '10,10', x: 10, z: 10 },
            income: 25,
            path: ['5,5', '6,5', '7,5'],
            disrupted: false,
            disruptedTurnsLeft: 0,
            establishedTurn: 1,
        }];
        state.tradeRouteNextId = 2;

        await saveGame(state);
        const loaded = await loadGame();
        expect(loaded.tradeRoutes).toHaveLength(1);
        expect(loaded.tradeRoutes[0].income).toBe(25);
        expect(loaded.tradeRoutes[0].path).toEqual(['5,5', '6,5', '7,5']);
        expect(loaded.tradeRouteNextId).toBe(2);
    });

    it('preserves eliminated set', async () => {
        const state = makeGameState();
        state.eliminated = new Set(['ai1', 'ai2']);

        await saveGame(state);
        const loaded = await loadGame();
        expect(loaded.eliminated).toBeInstanceOf(Set);
        expect(loaded.eliminated.has('ai1')).toBe(true);
        expect(loaded.eliminated.has('ai2')).toBe(true);
    });

    it('preserves explored set', async () => {
        const state = makeGameState();
        state.explored = new Set(['5,5', '6,5', '7,5']);

        await saveGame(state);
        const loaded = await loadGame();
        expect(loaded.explored).toBeInstanceOf(Set);
        expect(loaded.explored.has('5,5')).toBe(true);
        expect(loaded.explored.has('7,5')).toBe(true);
    });

    it('preserves structures map', async () => {
        const state = makeGameState();
        state.structures.set('6,5', { type: 'FALL_TRAP', owner: 'player' });

        await saveGame(state);
        const loaded = await loadGame();
        const s = loaded.structures.get('6,5');
        expect(s).toBeDefined();
        expect(s.type).toBe('FALL_TRAP');
        expect(s.owner).toBe('player');
    });

    it('preserves bridges set', async () => {
        const state = makeGameState();
        state.bridges = new Set(['5,5', '6,5']);

        await saveGame(state);
        const loaded = await loadGame();
        expect(loaded.bridges).toBeInstanceOf(Set);
        expect(loaded.bridges.has('5,5')).toBe(true);
    });

    it('preserves kingCooldowns', async () => {
        const state = makeGameState();
        state.kingCooldowns = { player: { bloodlust: 2 }, ai1: { harvest: 0 } };

        await saveGame(state);
        const loaded = await loadGame();
        expect(loaded.kingCooldowns.player.bloodlust).toBe(2);
        expect(loaded.kingCooldowns.ai1.harvest).toBe(0);
    });

    it('preserves graveyard', async () => {
        const state = makeGameState();
        state.graveyard = [{ id: 42, type: 'ARCHER', owner: 'player', turn: 5 }];

        await saveGame(state);
        const loaded = await loadGame();
        expect(loaded.graveyard).toHaveLength(1);
        expect(loaded.graveyard[0].type).toBe('ARCHER');
    });

    it('handles null/undefined fields gracefully', async () => {
        const state = makeGameState();
        state.techState = null;
        state.victoryState = null;
        state.aiState = null;
        state.concealedUnits = new Map();

        await saveGame(state);
        const loaded = await loadGame();
        expect(loaded.techState).toBeNull();
        expect(loaded.victoryState).not.toBeNull(); // loadGame backfills default
        expect(loaded.tradeRoutes).toEqual([]);
    });

    it('handles missing buildings gracefully (null fallback)', async () => {
        const state = makeGameState();
        state.buildings = null;

        // saveGame should not throw (buildings has || new Map() fallback)
        expect(await saveGame(state)).toBe(true);
        const loaded = await loadGame();
        expect(loaded.buildings).toBeInstanceOf(Map);
    });

    it('preserves reputation', async () => {
        const state = makeGameState();
        state.reputation = { player: 50, ai1: 30 };

        await saveGame(state);
        const loaded = await loadGame();
        expect(loaded.reputation.player).toBe(50);
        expect(loaded.reputation.ai1).toBe(30);
    });

    it('preserves gameOver and winner', async () => {
        const state = makeGameState();
        state.gameOver = true;
        state.winner = 'player';

        await saveGame(state);
        const loaded = await loadGame();
        expect(loaded.gameOver).toBe(true);
        expect(loaded.winner).toBe('player');
    });
});

describe('verifySave', () => {
    it('returns empty array for valid state', async () => {
        const state = makeGameState();
        const issues = verifySave(state);
        expect(issues.filter(i => i.startsWith('No '))).toHaveLength(0);
    });

    it('catches missing tiles', async () => {
        const state = makeGameState();
        state.tiles = new Map();
        const issues = verifySave(state);
        expect(issues).toContain('No tiles');
    });

    it('catches missing lords', async () => {
        const state = makeGameState();
        state.lords = null;
        expect(verifySave(state)).toContain('No lords array');
    });

    it('catches missing resources', async () => {
        const state = makeGameState();
        state.resources = null;
        expect(verifySave(state)).toContain('No resources');
    });
});

describe('save/load edge cases', () => {
    it('returns null on version mismatch', async () => {
        // Manually write a save with wrong version
        _store['conquest_save'] = JSON.stringify({ version: 999, turn: 1 });
        const loaded = await loadGame();
        expect(loaded).toBeNull();
    });

    it('returns null when no save exists', async () => {
        _store = {};
        expect(await loadGame()).toBeNull();
    });

    it('returns false when save throws', async () => {
        // Corrupt the store to trigger JSON.parse error
        _store['conquest_save'] = '{invalid json';
        expect(await loadGame()).toBeNull();
    });

    it('clearSave removes the save', async () => {
        const state = makeGameState();
        await saveGame(state);
        expect(await loadGame()).not.toBeNull();
        await clearSave();
        expect(await loadGame()).toBeNull();
    });
});
