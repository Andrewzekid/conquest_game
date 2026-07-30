import { describe, it, expect, beforeEach, vi } from 'vitest';
vi.mock('../src/renderer.js', () => ({ GameRenderer: class {} }));

// Wrap computeAIActions so executor tests can inject a crafted train action
// while leaving the real planner in place for other tests.
const aiMock = vi.hoisted(() => ({ real: null }));
vi.mock('../src/ai.js', async (importOriginal) => {
    const orig = await importOriginal();
    aiMock.real = orig.computeAIActions;
    return { ...orig, computeAIActions: vi.fn((...args) => aiMock.real(...args)) };
});

import { isCoastalCity, computeAIActions } from '../src/ai.js';
import { Game } from '../src/game.js';
import { makeTile, makeTileMap, makeGameState } from './helpers.js';
import { setGridDimensions } from '../src/config.js';
import { FACTION_DEFS } from '../src/faction.js';

// sound.js looks up window.AudioContext when playing SFX; a bare global makes
// the Game constructor safe to instantiate in node/vitest.
if (typeof globalThis.window === 'undefined') globalThis.window = {};

beforeEach(() => {
    setGridDimensions(20, 20);
    computeAIActions.mockImplementation((...args) => aiMock.real(...args));
});

function makeGameWithTiles(tileArr) {
    const game = Object.create(Game.prototype);
    game.tiles = makeTileMap(tileArr);
    game.gameState = { units: new Map(), buildings: new Map(), techState: { researched: new Set(['NAVAL_ENGINEERING']) } };
    return game;
}

/** A Game instance wired for runAITurn with diplomacy/king side-systems stubbed. */
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

describe('naval spawn connectivity', () => {
    it('rejects a harbor next to a land-locked river pond', () => {
        const tiles = makeTileMap([
            [5, 5, 'CITY', 'ai1'],
            [5, 6, 'RIVER', null],
            [5, 7, 'PLAINS', null],
            [4, 6, 'PLAINS', null],
            [6, 6, 'PLAINS', null],
        ]);
        expect(isCoastalCity(tiles.get('5,5'), tiles)).toBe(false);
    });

    it('accepts a harbor next to a river that reaches the map edge', () => {
        const tiles = makeTileMap([
            [5, 5, 'CITY', 'ai1'],
            [5, 6, 'RIVER', null],
            [5, 7, 'RIVER', null],
            [5, 8, 'RIVER', null],
            [5, 9, 'RIVER', null],
            [5, 10, 'RIVER', null],
            [5, 11, 'RIVER', null],
            [5, 12, 'RIVER', null],
            [5, 13, 'RIVER', null],
            [5, 14, 'RIVER', null],
            [5, 15, 'RIVER', null],
            [5, 16, 'RIVER', null],
            [5, 17, 'RIVER', null],
            [5, 18, 'RIVER', null],
            [5, 19, 'RIVER', null],
        ]);
        expect(isCoastalCity(tiles.get('5,5'), tiles)).toBe(true);
    });

    it('does not spawn a ship on an enclosed river tile', () => {
        const game = makeGameWithTiles([
            [5, 5, 'CITY', 'ai1'],
            [5, 6, 'RIVER', null],
            [5, 7, 'PLAINS', null],
            [4, 6, 'PLAINS', null],
            [6, 6, 'PLAINS', null],
        ]);
        const spawn = game._findNavalSpawnTile(game.tiles.get('5,5'), 'ai1');
        expect(spawn).toBeNull();
    });

    it('runAITurn does not crash or spend resources when a naval train action targets a pond-harbor city', () => {
        const tiles = makeTileMap([
            [5, 5, 'CITY', 'ai1', { cityName: 'Pond Harbor', cityLevel: 2, fortification: 3, fortMax: 3 }],
            [5, 6, 'RIVER', null],
            [5, 7, 'PLAINS', null],
            [4, 6, 'PLAINS', null],
            [6, 6, 'PLAINS', null],
        ]);
        const state = makeGameState({
            tiles,
            units: new Map(),
            buildings: new Map([['5,5', ['HARBOR']]]),
            resources: { ai1: { gold: 500, food: 500, wood: 500, iron: 500, production: 500 } },
            factionDefs: { ai1: FACTION_DEFS.verdant },
        });
        state.aiTechStates = { ai1: { researched: new Set(['NAVAL_ENGINEERING']) } };
        const g = makeAIGame(state);
        const startGold = state.resources.ai1.gold;

        // Inject the exact naval train action the reviewer wants to harden.
        computeAIActions.mockImplementation(() => [{ type: 'train', unitType: 'GALLEY', tileKey: '5,5' }]);

        expect(() => g.runAITurn('ai1')).not.toThrow();
        expect([...state.units.values()]).toHaveLength(0);
        expect(state.resources.ai1.gold).toBe(startGold);
    });
});
