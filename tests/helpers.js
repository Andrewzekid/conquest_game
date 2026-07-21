/**
 * Shared test helpers for the conquest game test suite.
 * Import via: import { makeTile, makeUnit, makeGameState, ... } from './helpers.js';
 */
import { UNIT_TYPE, PLAYER_FACTION } from '../src/config.js';

// ---------------------------------------------------------------------------
// Tile factory
// ---------------------------------------------------------------------------

/**
 * Create a minimal tile object for testing.
 * @param {number} x
 * @param {number} z
 * @param {string} terrain - key from TERRAIN (PLAINS, CITY, WATER, etc.)
 * @param {string|null} owner - faction slot ('player', 'ai1', etc.) or null
 * @param {object} overrides - any extra tile fields
 */
export function makeTile(x, z, terrain = 'PLAINS', owner = null, overrides = {}) {
    return {
        x, z, terrain, owner,
        loyalty: 0,
        cityLevel: terrain === 'CITY' ? 1 : undefined,
        fortification: terrain === 'CITY' ? 3 : undefined,
        fortMax: terrain === 'CITY' ? 3 : undefined,
        ...overrides,
    };
}

/**
 * Create a Map of tiles from a compact descriptor array.
 * Each entry is [x, z, terrain, owner] or [x, z, terrain, owner, overrides].
 * @param {Array} arr
 * @returns {Map<string, object>}
 */
export function makeTileMap(arr) {
    const tiles = new Map();
    for (const entry of arr) {
        const [x, z, terrain, owner, overrides] = entry;
        const t = makeTile(x, z, terrain, owner, overrides || {});
        tiles.set(`${x},${z}`, t);
    }
    return tiles;
}

// ---------------------------------------------------------------------------
// Unit factory
// ---------------------------------------------------------------------------

const UNIT_DEFAULTS = {
    INFANTRY:     { hp: 10, maxHp: 10, attack: 3,  defense: 2, moveRange: 2, ranged: false, attackRange: 1 },
    ARCHER:       { hp: 8,  maxHp: 8,  attack: 4,  defense: 1, moveRange: 2, ranged: true,  attackRange: 2 },
    CAVALRY:      { hp: 12, maxHp: 12, attack: 5,  defense: 3, moveRange: 3, ranged: false, attackRange: 1 },
    PIKEMAN:      { hp: 12, maxHp: 12, attack: 4,  defense: 4, moveRange: 2, ranged: false, attackRange: 1 },
    SIEGE:        { hp: 14, maxHp: 14, attack: 3,  defense: 2, moveRange: 2, ranged: true,  attackRange: 2, besiege: true, besiegePower: 2 },
    SCOUT:        { hp: 6,  maxHp: 6,  attack: 2,  defense: 1, moveRange: 4, ranged: false, attackRange: 1 },
    SETTLER:      { hp: 6,  maxHp: 6,  attack: 1,  defense: 1, moveRange: 2, ranged: false, attackRange: 1 },
    ENGINEER:     { hp: 8,  maxHp: 8,  attack: 2,  defense: 2, moveRange: 2, ranged: false, attackRange: 1 },
    MEDIC:        { hp: 7,  maxHp: 7,  attack: 1,  defense: 2, moveRange: 2, ranged: false, attackRange: 1, heal: 2 },
    ARTILLERY:    { hp: 6,  maxHp: 6,  attack: 7,  defense: 0, moveRange: 1, ranged: true,  attackRange: 2, siegeBonus: 3, besiege: true },
    CATAPHRACT:   { hp: 16, maxHp: 16, attack: 6,  defense: 5, moveRange: 2, ranged: false, attackRange: 1 },
    CHARIOT:      { hp: 11, maxHp: 11, attack: 4,  defense: 2, moveRange: 3, ranged: false, attackRange: 1, canCharge: true },
    LEGIONNAIRE:  { hp: 14, maxHp: 14, attack: 4,  defense: 5, moveRange: 1, ranged: false, attackRange: 1, canBuildStructure: true },
    BERSERKER:    { hp: 12, maxHp: 12, attack: 9,  defense: 1, moveRange: 2, ranged: false, attackRange: 1, frenzy: true, noMedic: true },
    VARANGIAN_GUARD: { hp: 16, maxHp: 16, attack: 6, defense: 6, moveRange: 2, ranged: false, attackRange: 1, lordGuard: true },
    CONQUISTADOR: { hp: 10, maxHp: 10, attack: 7,  defense: 3, moveRange: 3, ranged: true,  attackRange: 2, cityBonus: 2 },
    WINGED_HUSSAR:{ hp: 18, maxHp: 18, attack: 8,  defense: 4, moveRange: 3, ranged: false, attackRange: 1, chargeMultiplier: 2, openTerrainMoveBonus: 1 },
    CROSSBOWMAN:  { hp: 10, maxHp: 10, attack: 7,  defense: 2, moveRange: 1, ranged: true,  attackRange: 3 },
};

let _unitId = 1;

/**
 * Create a minimal unit object for testing.
 * @param {string} type - unit type key (INFANTRY, ARCHER, etc.)
 * @param {string} owner - faction slot
 * @param {number} x
 * @param {number} z
 * @param {object} overrides - any extra unit fields
 */
export function makeUnit(type, owner, x = 0, z = 0, overrides = {}) {
    const base = UNIT_DEFAULTS[type] || UNIT_TYPE[type] || {};
    return {
        id: _unitId++,
        type,
        owner,
        x, z,
        level: 1,
        xp: 0,
        hasMovedThisTurn: false,
        hasAttackedThisTurn: false,
        factionId: null,
        ...base,
        ...overrides,
    };
}

/**
 * Reset the internal unit ID counter (call in beforeEach if id uniqueness matters).
 */
export function resetUnitIds() { _unitId = 1; }

// ---------------------------------------------------------------------------
// Game state factory
// ---------------------------------------------------------------------------

/**
 * Create a minimal but complete gameState suitable for integration tests.
 * Returns an object with all fields that turnmanager/battle/economy expect.
 * @param {object} overrides - top-level overrides (e.g. { turn: 5 })
 */
export function makeGameState(overrides = {}) {
    const tiles = new Map();
    // Default: two cities and some open terrain
    tiles.set('5,5',  makeTile(5, 5, 'CITY', 'player', { cityName: 'Capital', cityLevel: 2, fortification: 3, fortMax: 3 }));
    tiles.set('10,10', makeTile(10, 10, 'CITY', 'ai1', { cityName: 'Enemy Hold', cityLevel: 1, fortification: 3, fortMax: 3 }));
    tiles.set('6,5',  makeTile(6, 5, 'PLAINS', 'player'));
    tiles.set('7,5',  makeTile(7, 5, 'FOREST', 'player'));
    tiles.set('9,10', makeTile(9, 10, 'PLAINS', 'ai1'));
    tiles.set('11,10', makeTile(11, 10, 'HILLS', 'ai1'));
    tiles.set('8,8',  makeTile(8, 8, 'PLAINS', null));

    const units = new Map();
    const u1 = makeUnit('INFANTRY', 'player', 5, 5, { factionId: 'crimson' });
    const u2 = makeUnit('INFANTRY', 'ai1', 10, 10, { factionId: 'verdant' });
    units.set(u1.id, u1);
    units.set(u2.id, u2);

    const buildings = new Map();
    buildings.set('5,5', ['MARKET']);
    buildings.set('10,10', ['WALLS']);

    const state = {
        turn: 1,
        factionAssignments: { player: 'crimson', ai1: 'verdant' },
        tiles,
        units,
        buildings,
        buildingState: new Map(),
        lords: [],
        resources: {
            player: { gold: 200, food: 100, wood: 50, iron: 30, production: 20 },
            ai1:    { gold: 200, food: 100, wood: 50, iron: 30, production: 20 },
        },
        diplomacy: {
            relations: {},
            pendingOffers: [],
            diplomaticEvents: [],
        },
        explored: new Set(),
        visible: new Set(),
        scryRevealed: new Set(),
        trainedThisTurn: new Set(),
        production: new Map(),
        construction: new Map(),
        structures: new Map(),
        bridges: new Set(),
        concealedUnits: new Map(),
        kingCooldowns: {},
        tempBonuses: {},
        graveyard: [],
        eliminated: new Set(),
        reputation: {},
        gameOver: false,
        winner: null,
        techState: null,
        victoryState: { projects: {}, tradeRoutes: {}, scoreSnapshots: {} },
        aiState: null,
        tradeRoutes: [],
        tradeRouteNextId: 1,
        factionDefs: {},
        factionColors: {
            player: { tile: 0x2e5dc4, unit: 0x4488ff, name: 'You' },
            ai1:    { tile: 0xb33333, unit: 0xff5544, name: 'Crimson' },
        },
        // Transient UI state
        selectedUnit: null,
        selectedLord: null,
        moveTargets: new Set(),
        attackTargets: [],
        chargeTargets: [],
        bridgeTargets: [],
        siegeTowerTarget: null,
        chariotChargeTargets: [],
        ...overrides,
    };
    return state;
}

// ---------------------------------------------------------------------------
// Diplomacy helpers
// ---------------------------------------------------------------------------

/**
 * Set up a basic diplomacy state with two factions at peace.
 */
export function makeDiplomacyState(factionA = 'player', factionB = 'ai1') {
    const key = `${factionA}-${factionB}`;
    return {
        relations: {
            [key]: {
                state: 'peace',
                turnsAllied: 0,
                turnsAtWar: 0,
                relationship: 0,
                warsDeclared: 0,
                peaceTreaties: 0,
                tradesMade: 0,
                brokenTreaties: 0,
                grievances: 0,
                grievanceLog: [],
                expiresOn: null,
                formalWar: false,
                lastWarDeclaredTurn: 0,
                grudges: {},
                trust: 1.0,
            },
        },
        pendingOffers: [],
        diplomaticEvents: [],
    };
}
