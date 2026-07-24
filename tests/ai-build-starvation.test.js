/**
 * Critical-build starvation disband (B5): a faction that can't afford a
 * critical build (HARBOR for naval expansion, SIEGE_WORKSHOP for conquest)
 * because a resource isn't accumulating (net flow <= 0) disbands a unit
 * whose upkeep eats that resource — the frost-clan scenario of a trebuchet
 * eating all the wood needed for the harbor off the island.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { computeAIActions } from '../src/ai.js';
import { createAIState } from '../src/ai_goals.js';
import { createTechState } from '../src/tech.js';
import { FACTION_DEFS } from '../src/faction.js';
import { setGridDimensions, DIPLOMACY_STATES } from '../src/config.js';
import { makeUnit, makeTileMap } from './helpers.js';

beforeEach(() => { setGridDimensions(40, 40); });

function peaceDiplo() { return { relations: {}, pendingOffers: [], diplomaticEvents: [] }; }

/** Island-ish faction with an expand-islands goal, a coastal city, and a
 *  wood-hungry army. Wood stock 10 (< 30 harbor cost), zero net wood flow. */
function starvationSetup(overrides = {}) {
    const tiles = makeTileMap([
        [5, 5, 'CITY', 'ai1', { cityName: 'Home', cityLevel: 2, fortification: 3, fortMax: 3, isCapital: true }],
        [6, 5, 'PLAINS', 'ai1'],
        [7, 5, 'PLAINS', 'ai1'],
        [5, 4, 'WATER', null],
        [4, 5, 'WATER', null],
        [6, 4, 'WATER', null],
    ]);
    const units = new Map();
    const army = overrides.army || ['INFANTRY', 'INFANTRY', 'TREBUCHET'];
    army.forEach((type, i) => units.set(i + 1, makeUnit(type, 'ai1', 6 + i, 5, { factionId: 'frost' })));
    const stock = overrides.resources || { gold: 500, food: 200, wood: 10, iron: 50, production: 100 };
    const aiState = createAIState();
    aiState.goals = [{ kind: 'expand-islands', priority: 1.0, horizon: 'mid', targetTileKey: null, meta: {} }];
    aiState.planLockUntil = 100;
    // Zero net flow for every resource: the wood stock can never accumulate.
    aiState.prevStock = { ...stock };
    const ts = createTechState();
    ts.researched.add('NAVAL_ENGINEERING');
    ts.researched.add('SIEGE_CRAFT');
    return {
        tiles, units,
        resources: { ...stock },
        owner: 'ai1',
        buildings: new Map([['5,5', ['BARRACKS']]]),
        influence: null, factionDef: FACTION_DEFS.frost,
        diploState: peaceDiplo(),
        lords: [], tempBonuses: {}, structures: new Map(), buildingState: new Map(),
        aiState, aiTechStates: { ai1: ts },
        victoryState: { projects: {}, tradeRoutes: {}, scoreSnapshots: {} },
        currentTurn: 35,
        ...overrides.spread,
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

describe('critical-build starvation disband', () => {
    it('disbands the wood-upkeep trebuchet when the harbor is unaffordable and wood is stagnant', () => {
        const input = starvationSetup();
        const actions = runAI(input);
        const disbands = actions.filter(a => a.type === 'disband');
        expect(disbands.length).toBe(1);
        const target = input.units.get(disbands[0].unitId);
        expect(target.type).toBe('TREBUCHET');
    });

    it('does NOT disband when wood flow is positive (stock is accumulating)', () => {
        const input = starvationSetup();
        input.aiState.prevStock = { gold: 500, food: 200, wood: 0, iron: 50, production: 100 }; // wood +10/t
        const actions = runAI(input);
        expect(actions.filter(a => a.type === 'disband').length).toBe(0);
    });

    it('does NOT disband when the build is already affordable', () => {
        const input = starvationSetup({ resources: { gold: 500, food: 200, wood: 100, iron: 50, production: 100 } });
        const actions = runAI(input);
        expect(actions.filter(a => a.type === 'disband').length).toBe(0);
    });

    it('does NOT disband below a 2-unit army', () => {
        const input = starvationSetup({ army: ['INFANTRY', 'TREBUCHET'] });
        const actions = runAI(input);
        expect(actions.filter(a => a.type === 'disband').length).toBe(0);
    });

    it('build menu data: getBuildableBuildings includes disabled options with reasons', async () => {
        // The UI previously hid non-buildable options entirely (empty menu).
        const { getBuildableBuildings } = await import('../src/building.js');
        const tiles = makeTileMap([
            [5, 5, 'CITY', 'player', { cityName: 'Home', cityLevel: 2, fortification: 3, fortMax: 3 }],
            [6, 5, 'PLAINS', 'player'],
            [5, 4, 'WATER', null],
        ]);
        const tile = tiles.get('6,5');
        const influence = new Set(['5,5', '6,5']);
        const ts = createTechState();
        ts.researched.add('NAVAL_ENGINEERING');
        const opts = getBuildableBuildings(tile, { gold: 10, wood: 0 }, new Map(), influence, tiles, ts);
        const harbor = opts.find(o => o.type === 'HARBOR');
        expect(harbor).toBeTruthy();           // present (tech unlocked, coastal)
        expect(harbor.canBuild).toBe(false);   // unaffordable → shown disabled
        expect(harbor.reason).toBeTruthy();    // with a reason, not invisible
    });
});
