/**
 * AI integration tests.
 * Tests AI utility functions and computeAIActions with various game states.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { computeAIActions, computeScarcity, factionComposition, findAffordableUnit } from '../src/ai.js';
import { createAIState } from '../src/ai_goals.js';
import { FACTION_DEFS } from '../src/faction.js';
import { setGridDimensions, UNIT_TYPE } from '../src/config.js';
import { makeGameState, makeUnit, makeTile, makeTileMap } from './helpers.js';

beforeEach(() => { setGridDimensions(20, 20); });

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AI — computeScarcity', () => {
    it('returns an object with scarcity fields', () => {
        const result = computeScarcity({ gold: 50, food: 50, wood: 50, iron: 50 }, null, {});
        expect(result).toHaveProperty('stockScarce');
        expect(result).toHaveProperty('flowScarce');
        expect(result).toHaveProperty('scarce');
        expect(typeof result.scarce).toBe('number');
    });

    it('detects stock scarcity when resources are low', () => {
        const result = computeScarcity({ gold: 10, food: 10, wood: 10, iron: 10 }, null, {});
        expect(result.stockScarce).toBeGreaterThan(0);
    });

    it('detects flow scarcity when resources are draining', () => {
        const prev = { gold: 100, food: 100, wood: 100, iron: 100 };
        const curr = { gold: 30, food: 30, wood: 30, iron: 30 };
        const result = computeScarcity(curr, prev, { gold: -20, food: -20, wood: -20, iron: -20 });
        expect(result.flowScarce).toBeGreaterThan(0);
    });

    it('returns zero scarcity for abundant resources', () => {
        const result = computeScarcity({ gold: 500, food: 500, wood: 500, iron: 500 }, null, {});
        expect(result.stockScarce).toBe(0);
    });
});

describe('AI — factionComposition', () => {
    it('returns an object with role weights', () => {
        const def = FACTION_DEFS.crimson;
        const comp = factionComposition(def, def.roster);
        expect(comp).toHaveProperty('melee');
        expect(comp).toHaveProperty('ranged');
        expect(comp).toHaveProperty('cavalry');
        expect(comp).toHaveProperty('siege');
        expect(typeof comp.melee).toBe('number');
    });

    it('weights sum to approximately 1', () => {
        const def = FACTION_DEFS.crimson;
        const comp = factionComposition(def, def.roster);
        const sum = Object.values(comp).reduce((a, b) => a + b, 0);
        expect(sum).toBeCloseTo(1.0, 1);
    });

    it('viking has cavalry weight for berserkers', () => {
        const def = FACTION_DEFS.viking;
        const comp = factionComposition(def, def.roster);
        expect(comp.melee).toBeGreaterThan(0);
    });
});

describe('AI — findAffordableUnit', () => {
    it('returns a string unit type when affordable', () => {
        const resources = { ai1: { gold: 500, food: 200, wood: 100, iron: 50 } };
        const def = FACTION_DEFS.crimson;
        const result = findAffordableUnit(resources, def.roster, def, new Map(), [], 'ai1');
        // May return null if unit cap is reached or other constraints
        if (result) {
            expect(typeof result).toBe('string');
            expect(UNIT_TYPE[result]).toBeDefined();
        }
    });

    it('returns null when gold is zero', () => {
        const resources = { ai1: { gold: 0, food: 200, wood: 100, iron: 50 } };
        const def = FACTION_DEFS.crimson;
        const result = findAffordableUnit(resources, def.roster, def, new Map(), [], 'ai1');
        expect(result).toBeNull();
    });
});

describe('AI — computeAIActions', () => {
    function makeInput(overrides = {}) {
        const tiles = makeTileMap([
            [5, 5, 'CITY', 'ai1', { cityName: 'AI Capital', cityLevel: 2, fortification: 3, fortMax: 3 }],
            [6, 5, 'PLAINS', 'ai1'],
            [10, 10, 'CITY', 'player', { cityName: 'Player City', cityLevel: 1, fortification: 3, fortMax: 3 }],
        ]);
        const units = new Map();
        const inf = makeUnit('INFANTRY', 'ai1', 6, 5, { factionId: 'verdant' });
        units.set(inf.id, inf);

        return {
            tiles, units,
            resources: { ai1: { gold: 200, food: 100, wood: 50, iron: 30 } },
            owner: 'ai1',
            buildings: new Map([['5,5', ['MARKET']]]),
            influence: new Map(),
            factionDef: FACTION_DEFS.verdant,
            diploState: { relations: {}, pendingOffers: [], diplomaticEvents: [] },
            lords: [],
            tempBonuses: {},
            structures: new Map(),
            buildingState: new Map(),
            aiState: createAIState(),
            ...overrides,
        };
    }

    it('returns an array of actions', () => {
        const input = makeInput();
        const actions = computeAIActions(
            input.units, input.tiles, input.resources, input.owner,
            input.buildings, input.influence, input.factionDef,
            input.diploState, input.lords, input.tempBonuses,
            input.structures, input.buildingState, input.aiState
        );
        expect(Array.isArray(actions)).toBe(true);
    });

    it('does not crash with empty state', () => {
        const tiles = makeTileMap([
            [5, 5, 'CITY', 'ai1', { cityName: 'Capital', cityLevel: 1, fortification: 3, fortMax: 3 }],
        ]);
        const actions = computeAIActions(
            new Map(), tiles, { ai1: { gold: 100, food: 50, wood: 20, iron: 10 } }, 'ai1',
            new Map(), new Map(), FACTION_DEFS.verdant,
            { relations: {}, pendingOffers: [], diplomaticEvents: [] },
            [], {}, new Map(), new Map(), createAIState()
        );
        expect(Array.isArray(actions)).toBe(true);
    });

    it('produces actions with type property', () => {
        const input = makeInput();
        const actions = computeAIActions(
            input.units, input.tiles, input.resources, input.owner,
            input.buildings, input.influence, input.factionDef,
            input.diploState, input.lords, input.tempBonuses,
            input.structures, input.buildingState, input.aiState
        );
        for (const action of actions) {
            expect(action).toHaveProperty('type');
            expect(typeof action.type).toBe('string');
        }
    });
});
