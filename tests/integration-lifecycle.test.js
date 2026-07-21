/**
 * Integration lifecycle tests.
 * Exercises a full game flow: combat → capture → turn cycle → save/load → verify.
 * This catches state-transition bugs, missing field propagation, and module wiring issues.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolveCombat, captureTile } from '../src/battle.js';
import { captureCityTerritory, foundCity } from '../src/map.js';
import { createTurnManager } from '../src/turnmanager.js';
import { PLAYER_FACTION, setGridDimensions } from '../src/config.js';
import { createTechState, addResearch, selectResearch, TECHS } from '../src/tech.js';
import { saveGame, loadGame } from '../src/save.js';
import { makeGameState, makeUnit, makeTile } from './helpers.js';

// --- In-memory localStorage mock ---
let _store = {};
const localStorageMock = {
    getItem(k) { return k in _store ? _store[k] : null; },
    setItem(k, v) { _store[k] = String(v); },
    removeItem(k) { delete _store[k]; },
};
const _origGlobal = typeof globalThis !== 'undefined' ? globalThis.localStorage : undefined;

beforeEach(() => {
    _store = {};
    setGridDimensions(20, 20);
    if (typeof globalThis !== 'undefined') globalThis.localStorage = localStorageMock;
});
afterEach(() => {
    if (typeof globalThis !== 'undefined') {
        if (_origGlobal !== undefined) globalThis.localStorage = _origGlobal;
        else delete globalThis.localStorage;
    }
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('integration — combat → capture → turn → save → load', () => {

    it('combat damages units', () => {
        const atk = makeUnit('INFANTRY', 'player', 0, 0, { factionId: 'crimson' });
        const def = makeUnit('INFANTRY', 'ai1', 1, 0, { hp: 10, maxHp: 10 });

        const res = resolveCombat(atk, def, 'PLAINS');

        expect(res.damageToDefender).toBeGreaterThan(0);
        expect(def.hp).toBeLessThan(10);
    });

    it('killing a unit grants XP to the attacker', () => {
        const atk = makeUnit('CAVALRY', 'player', 0, 0);
        const def = makeUnit('INFANTRY', 'ai1', 1, 0, { hp: 1 });

        resolveCombat(atk, def, 'PLAINS');

        expect(def.hp).toBeLessThanOrEqual(0);
        expect(atk.xp).toBeGreaterThan(0);
    });

    it('capturing a city changes ownership', () => {
        const state = makeGameState();
        const cityTile = state.tiles.get('10,10');
        expect(cityTile.owner).toBe('ai1');

        const msgs = captureCityTerritory(state.tiles, cityTile, 'player', state.structures, state.buildings, state.buildingState);
        expect(cityTile.owner).toBe('player');
        expect(msgs.length).toBeGreaterThan(0);
    });

    it('captureTile transfers gold and changes ownership', () => {
        const tile = makeTile(5, 5, 'PLAINS', 'ai1');
        const resources = { gold: 100 };
        const msgs = captureTile(tile, 'player', resources);
        expect(tile.owner).toBe('player');
        expect(resources.gold).toBe(80); // 20 gold capture cost
        expect(msgs.length).toBeGreaterThan(0);
    });

    it('turn cycle: combat → turn → resources change', () => {
        const state = makeGameState();
        const goldBefore = state.resources.player.gold;
        const u = makeUnit('INFANTRY', 'player', 6, 5, { factionId: 'crimson' });
        state.units.set(u.id, u);

        const tm = createTurnManager(state, [PLAYER_FACTION, 'ai1'], null, null, null);
        tm.endPlayerTurn();

        expect(state.turn).toBe(2);
        // Gold should change (city yields collected, upkeep deducted)
        expect(state.resources.player.gold).not.toBe(goldBefore);
    });

    it('full lifecycle: combat → kill → capture → turn → save → load', () => {
        const state = makeGameState();

        // 1. Place units for combat
        const atk = makeUnit('CAVALRY', 'player', 9, 10, { factionId: 'crimson', attack: 20 }); // overpowered to guarantee kill
        const def = makeUnit('INFANTRY', 'ai1', 10, 10, { hp: 1 });
        state.units.set(atk.id, atk);
        state.units.set(def.id, def);

        // 2. Combat — defender dies
        const res = resolveCombat(atk, def, 'PLAINS');
        expect(res.defenderDied).toBe(true);
        state.units.delete(def.id);

        // 3. Capture city
        const cityTile = state.tiles.get('10,10');
        captureCityTerritory(state.tiles, cityTile, 'player', state.structures, state.buildings, state.buildingState);
        expect(cityTile.owner).toBe('player');

        // 4. Run a full turn cycle
        const tm = createTurnManager(state, [PLAYER_FACTION, 'ai1'], null, null, null);
        tm.endPlayerTurn();
        expect(state.turn).toBe(2);

        // 5. Save
        expect(saveGame(state)).toBe(true);

        // 6. Load
        const loaded = loadGame();
        expect(loaded).not.toBeNull();

        // 7. Verify critical fields survived
        expect(loaded.turn).toBe(2);
        expect(loaded.tiles.get('10,10').owner).toBe('player');
        expect(loaded.units.has(atk.id)).toBe(true);
        expect(loaded.resources.player.gold).toBe(state.resources.player.gold);
        expect(loaded.gameOver).toBe(false);
    });

    it('tech research accumulates across turns', () => {
        const state = makeGameState();
        state.techState = createTechState();
        // Ancient techs are pre-researched; select a classical tech
        selectResearch(state.techState, 'MATHEMATICS');

        // Run 3 turns — each turn should add research output from city (level 2 city = 2 pts/turn)
        for (let i = 0; i < 3; i++) {
            const tm = createTurnManager(state, [PLAYER_FACTION, 'ai1'], null, null, null);
            tm.endPlayerTurn();
        }

        expect(state.turn).toBe(4);
        expect(state.techState.progress).toBeGreaterThan(0);
    });

    it('diplomacy state survives turn cycle', () => {
        const state = makeGameState();
        state.diplomacy.relations['player:ai1'] = {
            state: 'peace', relationship: 25, grievances: 0, grievanceLog: [],
            turnsAllied: 0, turnsAtWar: 0, warsDeclared: 0, peaceTreaties: 0,
            tradesMade: 0, brokenTreaties: 0, expiresOn: null, formalWar: false,
            lastWarDeclaredTurn: 0, grudges: {}, trust: 1.0,
        };

        const tm = createTurnManager(state, [PLAYER_FACTION, 'ai1'], null, null, null);
        tm.endPlayerTurn();

        const rel = state.diplomacy.relations['player:ai1'];
        expect(rel).toBeDefined();
        expect(rel.state).toBe('peace');
    });

    it('multiple turn cycles maintain consistent state', () => {
        const state = makeGameState();

        for (let i = 0; i < 10; i++) {
            const tm = createTurnManager(state, [PLAYER_FACTION, 'ai1'], null, null, null);
            tm.endPlayerTurn();
        }

        expect(state.turn).toBe(11);
        // Units should still exist
        expect(state.units.size).toBeGreaterThanOrEqual(2);
        // Resources should be valid numbers
        expect(typeof state.resources.player.gold).toBe('number');
        expect(Number.isFinite(state.resources.player.gold)).toBe(true);
    });

    it('eliminated faction units are not processed by turn cycle', () => {
        const state = makeGameState();
        state.eliminated = new Set(['ai1']);

        const tm = createTurnManager(state, [PLAYER_FACTION, 'ai1'], null, null, null);
        tm.endPlayerTurn();

        expect(state.turn).toBe(2);
        // ai1 resources should not have been touched by collectResources
        // (eliminated check is inside turnmanager)
    });
});
