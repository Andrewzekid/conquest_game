import { describe, it, expect, beforeEach, vi } from 'vitest';
vi.mock('../src/renderer.js', () => ({ GameRenderer: class {} }));
import { isCoastalCity } from '../src/ai.js';
import { Game } from '../src/game.js';
import { makeTile, makeTileMap } from './helpers.js';
import { setGridDimensions } from '../src/config.js';

// sound.js looks up window.AudioContext when playing SFX; a bare global makes
// the Game constructor safe to instantiate in node/vitest.
if (typeof globalThis.window === 'undefined') globalThis.window = {};

beforeEach(() => { setGridDimensions(20, 20); });

function makeGameWithTiles(tileArr) {
    const game = Object.create(Game.prototype);
    game.tiles = makeTileMap(tileArr);
    game.gameState = { units: new Map(), buildings: new Map(), techState: { researched: new Set(['NAVAL_ENGINEERING']) } };
    return game;
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
});
