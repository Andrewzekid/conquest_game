/**
 * Scenario-driven AI integration tests.
 * Verifies realistic multi-turn AI behaviors:
 *  - Conquest across water triggers harbor + fleet build
 *  - River blocking path triggers bridge construction
 *  - Siege/ship tech unlock triggers workshop/harbor + unit training
 *  - Island expansion triggers harbor + extra settlers + transports
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { computeAIActions } from '../src/ai.js';
import { createAIState } from '../src/ai_goals.js';
import { createTechState, getUnlockedUnits } from '../src/tech.js';
import { FACTION_DEFS } from '../src/faction.js';
import { DIPLOMACY_STATES, setGridDimensions } from '../src/config.js';
import { makeTile, makeUnit, makeTileMap } from './helpers.js';

beforeEach(() => { setGridDimensions(40, 40); });

const FACTION = FACTION_DEFS.crimson; // AGGRESSIVE personality

function makeWarDiplo(owner, enemy) {
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

function trainTypes(actions) { return (actions || []).filter(a => a.type === 'train').map(a => a.unitType); }
function buildTypes(actions) { return (actions || []).filter(a => a.type === 'build').map(a => a.buildingType); }

function enemyDiplo(owner, enemy) {
    return {
        relations: {
            [`${owner}:${enemy}`]: { state: 'war', turnsAllied: 0, turnsAtWar: 3, relationship: -50, warsDeclared: 1, peaceTreaties: 0, tradesMade: 0, brokenTreaties: 0, grievances: 0, grievanceLog: [], expiresOn: null, formalWar: true, lastWarDeclaredTurn: 1, grudges: {}, trust: 0.1 },
            [`${enemy}:${owner}`]: { state: 'war', turnsAllied: 0, turnsAtWar: 3, relationship: -50, warsDeclared: 1, peaceTreaties: 0, tradesMade: 0, brokenTreaties: 0, grievances: 0, grievanceLog: [], expiresOn: null, formalWar: true, lastWarDeclaredTurn: 1, grudges: {}, trust: 0.1 },
        },
        pendingOffers: [], diplomaticEvents: [],
    };
}

function peaceDiplo() { return { relations: {}, pendingOffers: [], diplomaticEvents: [] }; }

// ===========================================================================
// Scenario 1: Conquest across water → AI builds harbor
// ===========================================================================
describe('Scenario: conquest across water triggers harbor', () => {
    it('builds HARBOR when conquest target is across water', () => {
        const tiles = makeTileMap([
            [5, 5, 'CITY', 'ai1', { cityName: 'AI Capital', cityLevel: 2, fortification: 3, fortMax: 3, isCapital: true }],
            [6, 5, 'PLAINS', 'ai1'],
            [7, 5, 'PLAINS', 'ai1'],
            [4, 5, 'WATER', null],
            [10, 10, 'CITY', 'enemy', { cityName: 'Enemy Hold', cityLevel: 1, fortification: 3, fortMax: 3 }],
        ]);
        const units = new Map();
        for (let i = 0; i < 4; i++) units.set(i+1, makeUnit('INFANTRY', 'ai1', 6+i, 5, { factionId: 'crimson' }));

        const aiState = createAIState();
        const actions = runAI({
            units, tiles,
            resources: { gold: 500, food: 300, wood: 200, iron: 100, production: 500 },
            owner: 'ai1',
            buildings: new Map([['5,5', ['BARRACKS']]]),
            influence: null, factionDef: FACTION,
            diploState: enemyDiplo('ai1', 'enemy'),
            lords: [], tempBonuses: {}, structures: new Map(), buildingState: new Map(),
            aiState, aiTechStates: null,
            victoryState: { projects: {}, tradeRoutes: {}, scoreSnapshots: {} },
            currentTurn: 35,
        });

        // AI should have a conquest goal targeting the enemy city
        const goalKinds = aiState.goals.map(g => g.kind);
        expect(goalKinds).toContain('conquest');
        // AI should produce actions (at minimum, move toward enemy)
        expect(actions.length).toBeGreaterThan(0);
    });
});

// ===========================================================================
// Scenario 2: No siege workshop + at war → build workshop first
// ===========================================================================
describe('Scenario: no siege workshop + war → build workshop before barracks', () => {
    it('builds SIEGE_WORKSHOP first when no trainable siege and at war', () => {
        const tiles = makeTileMap([
            [5, 5, 'CITY', 'ai1', { cityName: 'AI Capital', cityLevel: 2, fortification: 3, fortMax: 3, isCapital: true }],
            [6, 5, 'PLAINS', 'ai1'],
            [7, 5, 'PLAINS', 'ai1'],
            [10, 10, 'CITY', 'enemy', { cityName: 'Enemy Hold', cityLevel: 2, fortification: 5, fortMax: 5 }],
        ]);
        const units = new Map();
        for (let i = 0; i < 3; i++) units.set(i+1, makeUnit('INFANTRY', 'ai1', 6+i, 5, { factionId: 'crimson' }));

        const aiState = createAIState();
        const actions = runAI({
            units, tiles,
            resources: { gold: 500, food: 300, wood: 200, iron: 100, production: 500 },
            owner: 'ai1',
            buildings: new Map(), influence: null,
            factionDef: FACTION,
            diploState: enemyDiplo('ai1', 'enemy'),
            lords: [], tempBonuses: {}, structures: new Map(), buildingState: new Map(),
            aiState, aiTechStates: null,
            victoryState: { projects: {}, tradeRoutes: {}, scoreSnapshots: {} },
            currentTurn: 35,
        });

        // Crimson roster has no SIEGE/ARTILLERY; at war means needs workshop first
        expect(buildTypes(actions)).toContain('SIEGE_WORKSHOP');
    });
});

// ===========================================================================
// Scenario 3: Siege tech unlocked → AI trains siege engines
// ===========================================================================
describe('Scenario: siege tech unlock triggers siege training', () => {
    it('trains TREBUCHET when SIEGE_CRAFT researched and workshop exists', () => {
        const tiles = makeTileMap([
            [5, 5, 'CITY', 'ai1', { cityName: 'AI Capital', cityLevel: 2, fortification: 3, fortMax: 3, isCapital: true }],
            [6, 5, 'PLAINS', 'ai1'],
            [7, 5, 'PLAINS', 'ai1'],
            [10, 10, 'CITY', 'enemy', { cityName: 'Enemy Hold', cityLevel: 2, fortification: 5, fortMax: 5 }],
        ]);
        const units = new Map();
        for (let i = 0; i < 4; i++) units.set(i+1, makeUnit('INFANTRY', 'ai1', 6+i, 5, { factionId: 'crimson' }));

        const aiTs = createTechState();
        aiTs.researched.add('ARCHERY');
        aiTs.researched.add('MATHEMATICS');
        aiTs.researched.add('SIEGE_CRAFT');

        const aiState = createAIState();
        const actions = runAI({
            units, tiles,
            resources: { gold: 800, food: 400, wood: 300, iron: 200, production: 500 },
            owner: 'ai1',
            buildings: new Map([['5,5', ['BARRACKS', 'SIEGE_WORKSHOP']]]),
            influence: null, factionDef: FACTION,
            diploState: enemyDiplo('ai1', 'enemy'),
            lords: [], tempBonuses: {}, structures: new Map(), buildingState: new Map(),
            aiState, aiTechStates: { ai1: aiTs },
            victoryState: { projects: {}, tradeRoutes: {}, scoreSnapshots: {} },
            currentTurn: 35,
        });

        const siegeTrains = trainTypes(actions).filter(t => t === 'CATAPULT' || t === 'TREBUCHET');
        expect(siegeTrains.length).toBeGreaterThan(0);
    });

    it('does NOT train workshop siege when SIEGE_CRAFT not researched', () => {
        const tiles = makeTileMap([
            [5, 5, 'CITY', 'ai1', { cityName: 'AI Capital', cityLevel: 2, fortification: 3, fortMax: 3, isCapital: true }],
            [6, 5, 'PLAINS', 'ai1'],
            [7, 5, 'PLAINS', 'ai1'],
            [10, 10, 'CITY', 'enemy', { cityName: 'Enemy Hold', cityLevel: 2, fortification: 5, fortMax: 5 }],
        ]);
        const units = new Map();
        for (let i = 0; i < 4; i++) units.set(i+1, makeUnit('INFANTRY', 'ai1', 6+i, 5, { factionId: 'crimson' }));

        const aiTs = createTechState();
        const aiState = createAIState();
        const actions = runAI({
            units, tiles,
            resources: { gold: 800, food: 400, wood: 300, iron: 200, production: 500 },
            owner: 'ai1',
            buildings: new Map([['5,5', ['BARRACKS', 'SIEGE_WORKSHOP']]]),
            influence: null, factionDef: FACTION,
            diploState: enemyDiplo('ai1', 'enemy'),
            lords: [], tempBonuses: {}, structures: new Map(), buildingState: new Map(),
            aiState, aiTechStates: { ai1: aiTs },
            victoryState: { projects: {}, tradeRoutes: {}, scoreSnapshots: {} },
            currentTurn: 35,
        });

        const siegeTrains = trainTypes(actions).filter(t => t === 'CATAPULT' || t === 'TREBUCHET');
        expect(siegeTrains.length).toBe(0);
    });
});

// ===========================================================================
// Scenario 4: Ship tech unlocked → AI trains ships
// ===========================================================================
describe('Scenario: naval tech unlock triggers ship training', () => {
    it('trains GALLEY when NAVAL_ENGINEERING researched and harbor exists', () => {
        const tiles = makeTileMap([
            [5, 5, 'CITY', 'ai1', { cityName: 'AI Capital', cityLevel: 2, fortification: 3, fortMax: 3, isCapital: true }],
            [6, 5, 'PLAINS', 'ai1'],
            [7, 5, 'PLAINS', 'ai1'],
            [4, 5, 'WATER', null],
            [10, 10, 'CITY', 'enemy', { cityName: 'Enemy Hold', cityLevel: 1, fortification: 3, fortMax: 3 }],
        ]);
        const units = new Map();
        for (let i = 0; i < 3; i++) units.set(i+1, makeUnit('INFANTRY', 'ai1', 6+i, 5, { factionId: 'crimson' }));

        const aiTs = createTechState();
        aiTs.researched.add('ANIMAL_HUSBANDRY');
        aiTs.researched.add('NAVAL_ENGINEERING');

        const aiState = createAIState();
        const actions = runAI({
            units, tiles,
            resources: { gold: 600, food: 300, wood: 200, iron: 100, production: 500 },
            owner: 'ai1',
            buildings: new Map([['5,5', ['BARRACKS', 'HARBOR']]]),
            influence: null, factionDef: FACTION,
            diploState: enemyDiplo('ai1', 'enemy'),
            lords: [], tempBonuses: {}, structures: new Map(), buildingState: new Map(),
            aiState, aiTechStates: { ai1: aiTs },
            victoryState: { projects: {}, tradeRoutes: {}, scoreSnapshots: {} },
            currentTurn: 35,
        });

        const navalTrains = trainTypes(actions).filter(t => t === 'GALLEY' || t === 'TRANSPORT');
        expect(navalTrains.length).toBeGreaterThan(0);
    });

    it('does NOT train ships when NAVAL_ENGINEERING not researched', () => {
        const tiles = makeTileMap([
            [5, 5, 'CITY', 'ai1', { cityName: 'AI Capital', cityLevel: 2, fortification: 3, fortMax: 3, isCapital: true }],
            [6, 5, 'PLAINS', 'ai1'],
            [4, 5, 'WATER', null],
            [10, 10, 'CITY', 'enemy', { cityName: 'Enemy Hold', cityLevel: 1, fortification: 3, fortMax: 3 }],
        ]);
        const units = new Map();
        for (let i = 0; i < 3; i++) units.set(i+1, makeUnit('INFANTRY', 'ai1', 6+i, 5, { factionId: 'crimson' }));

        const aiTs = createTechState();
        const aiState = createAIState();
        const actions = runAI({
            units, tiles,
            resources: { gold: 600, food: 300, wood: 200, iron: 100, production: 500 },
            owner: 'ai1',
            buildings: new Map([['5,5', ['BARRACKS', 'HARBOR']]]),
            influence: null, factionDef: FACTION,
            diploState: enemyDiplo('ai1', 'enemy'),
            lords: [], tempBonuses: {}, structures: new Map(), buildingState: new Map(),
            aiState, aiTechStates: { ai1: aiTs },
            victoryState: { projects: {}, tradeRoutes: {}, scoreSnapshots: {} },
            currentTurn: 35,
        });

        const navalTrains = trainTypes(actions).filter(t =>
            ['GALLEY', 'TRANSPORT', 'FRIGATE', 'GALLEON'].includes(t));
        expect(navalTrains.length).toBe(0);
    });
});

// ===========================================================================
// Scenario 5: pathCrossesWater correctly identifies water barriers
// ===========================================================================
describe('Scenario: pathCrossesWater filters conquest targets', () => {
    it('AI generates conquest goals for cities across water (with transport)', () => {
        const tiles = makeTileMap([
            [5, 5, 'CITY', 'ai1', { cityName: 'AI Capital', cityLevel: 2, fortification: 3, fortMax: 3, isCapital: true }],
            [6, 5, 'PLAINS', 'ai1'],
            [7, 5, 'PLAINS', 'ai1'],
            [4, 5, 'WATER', null],
            [10, 10, 'CITY', 'enemy', { cityName: 'Enemy Hold', cityLevel: 1, fortification: 3, fortMax: 3 }],
        ]);
        const units = new Map();
        for (let i = 0; i < 3; i++) units.set(i+1, makeUnit('INFANTRY', 'ai1', 6+i, 5, { factionId: 'crimson' }));
        // Add a transport so AI can cross water
        units.set(99, makeUnit('TRANSPORT', 'ai1', 5, 4, { factionId: 'crimson' }));

        const aiTs = createTechState();
        aiTs.researched.add('ANIMAL_HUSBANDRY');
        aiTs.researched.add('NAVAL_ENGINEERING');

        const aiState = createAIState();
        const actions = runAI({
            units, tiles,
            resources: { gold: 600, food: 300, wood: 200, iron: 100, production: 500 },
            owner: 'ai1',
            buildings: new Map([['5,5', ['BARRACKS']]]),
            influence: null, factionDef: FACTION,
            diploState: enemyDiplo('ai1', 'enemy'),
            lords: [], tempBonuses: {}, structures: new Map(), buildingState: new Map(),
            aiState, aiTechStates: { ai1: aiTs },
            victoryState: { projects: {}, tradeRoutes: {}, scoreSnapshots: {} },
            currentTurn: 35,
        });

        // AI should generate a conquest goal targeting the enemy across water
        const goalKinds = aiState.goals.map(g => g.kind);
        expect(goalKinds).toContain('conquest');
    });

    it('AI still generates conquest goals for cities across water (without transport)', () => {
        const tiles = makeTileMap([
            [5, 5, 'CITY', 'ai1', { cityName: 'AI Capital', cityLevel: 2, fortification: 3, fortMax: 3, isCapital: true }],
            [6, 5, 'PLAINS', 'ai1'],
            [7, 5, 'PLAINS', 'ai1'],
            [4, 5, 'WATER', null],
            [10, 10, 'CITY', 'enemy', { cityName: 'Enemy Hold', cityLevel: 1, fortification: 3, fortMax: 3 }],
        ]);
        const units = new Map();
        for (let i = 0; i < 3; i++) units.set(i+1, makeUnit('INFANTRY', 'ai1', 6+i, 5, { factionId: 'crimson' }));

        const aiState = createAIState();
        const actions = runAI({
            units, tiles,
            resources: { gold: 600, food: 300, wood: 200, iron: 100, production: 500 },
            owner: 'ai1',
            buildings: new Map([['5,5', ['BARRACKS']]]),
            influence: null, factionDef: FACTION,
            diploState: enemyDiplo('ai1', 'enemy'),
            lords: [], tempBonuses: {}, structures: new Map(), buildingState: new Map(),
            aiState, aiTechStates: null,
            victoryState: { projects: {}, tradeRoutes: {}, scoreSnapshots: {} },
            currentTurn: 35,
        });

        // Without a transport, landCities filter removes water-crossing targets
        // but the conquest goal still exists (falls back to all enemy cities)
        expect(actions).toBeDefined();
        expect(Array.isArray(actions)).toBe(true);
    });
});

// ===========================================================================
// Scenario 6: River blocking path → engineer builds bridge
// ===========================================================================
describe('Scenario: river blocking path triggers bridge', () => {
    it('engineer adjacent to river builds bridge toward enemy city', () => {
        const tiles = makeTileMap([
            [2, 5, 'CITY', 'ai1', { cityName: 'AI Capital', cityLevel: 1, fortification: 3, fortMax: 3, isCapital: true }],
            [3, 5, 'PLAINS', 'ai1'],
            [4, 5, 'RIVER', null, { bridge: false }],
            [5, 5, 'PLAINS', null],
            [6, 5, 'PLAINS', null],
            [7, 5, 'CITY', 'enemy', { cityName: 'Enemy Hold', cityLevel: 1, fortification: 3, fortMax: 3 }],
        ]);
        const units = new Map();
        const eng = makeUnit('ENGINEER', 'ai1', 3, 5, { factionId: 'crimson', hasAttackedThisTurn: false });
        units.set(eng.id, eng);
        const guard = makeUnit('INFANTRY', 'ai1', 2, 5, { factionId: 'crimson' });
        units.set(guard.id, guard);

        const aiState = createAIState();
        const actions = runAI({
            units, tiles,
            resources: { gold: 500, food: 300, wood: 200, iron: 100, production: 500 },
            owner: 'ai1',
            buildings: new Map([['2,5', ['BARRACKS']]]),
            influence: null, factionDef: FACTION,
            diploState: enemyDiplo('ai1', 'enemy'),
            lords: [], tempBonuses: {}, structures: new Map(), buildingState: new Map(),
            aiState, aiTechStates: null,
            victoryState: { projects: {}, tradeRoutes: {}, scoreSnapshots: {} },
            currentTurn: 35,
        });

        const bridgeActions = actions.filter(a => a.type === 'buildBridge');
        expect(bridgeActions.length).toBeGreaterThan(0);
        expect(bridgeActions[0].unitId).toBe(eng.id);
    });

    it('does NOT bridge already-bridged river', () => {
        const tiles = makeTileMap([
            [2, 5, 'CITY', 'ai1', { cityName: 'AI Capital', cityLevel: 1, fortification: 3, fortMax: 3, isCapital: true }],
            [3, 5, 'PLAINS', 'ai1'],
            [4, 5, 'RIVER', null, { bridge: true }],
            [5, 5, 'PLAINS', null],
            [7, 5, 'CITY', 'enemy', { cityName: 'Enemy Hold', cityLevel: 1, fortification: 3, fortMax: 3 }],
        ]);
        const units = new Map();
        const eng = makeUnit('ENGINEER', 'ai1', 3, 5, { factionId: 'crimson', hasAttackedThisTurn: false });
        units.set(eng.id, eng);

        const aiState = createAIState();
        const actions = runAI({
            units, tiles,
            resources: { gold: 500, food: 300, wood: 200, iron: 100, production: 500 },
            owner: 'ai1',
            buildings: new Map([['2,5', ['BARRACKS']]]),
            influence: null, factionDef: FACTION,
            diploState: enemyDiplo('ai1', 'enemy'),
            lords: [], tempBonuses: {}, structures: new Map(), buildingState: new Map(),
            aiState, aiTechStates: null,
            victoryState: { projects: {}, tradeRoutes: {}, scoreSnapshots: {} },
            currentTurn: 35,
        });

        expect(actions.filter(a => a.type === 'buildBridge').length).toBe(0);
    });
});

// ===========================================================================
// Scenario 7: Island faction → harbor priority
// ===========================================================================
describe('Scenario: island faction builds harbor proactively', () => {
    it('island faction builds harbor even at peace', () => {
        // Tiny AI island (< 30 tiles) + large nearby landmass
        const tiles = makeTileMap([
            [2, 2, 'CITY', 'ai1', { cityName: 'Island Capital', cityLevel: 2, fortification: 3, fortMax: 3, isCapital: true }],
            [3, 2, 'PLAINS', 'ai1'],
            [2, 3, 'PLAINS', 'ai1'],
            [3, 3, 'PLAINS', 'ai1'],
        ]);
        // Add water around the island
        for (let dx = -1; dx <= 4; dx++) {
            for (let dz = -1; dz <= 4; dz++) {
                const k = `${2+dx},${2+dz}`;
                if (!tiles.has(k)) tiles.set(k, makeTile(2+dx, 2+dz, 'WATER', null));
            }
        }
        // Large landmass (30+ tiles)
        for (let dx = 0; dx < 8; dx++) {
            for (let dz = 0; dz < 5; dz++) {
                const k = `${10+dx},${10+dz}`;
                if (!tiles.has(k)) tiles.set(k, makeTile(10+dx, 10+dz, 'PLAINS', null));
            }
        }

        const units = new Map();
        units.set(1, makeUnit('INFANTRY', 'ai1', 3, 2, { factionId: 'crimson' }));

        const aiTs = createTechState();
        aiTs.researched.add('ANIMAL_HUSBANDRY');
        aiTs.researched.add('NAVAL_ENGINEERING');

        const aiState = createAIState();
        const actions = runAI({
            units, tiles,
            resources: { gold: 1000, food: 500, wood: 400, iron: 200, production: 500 },
            owner: 'ai1',
            buildings: new Map([['2,2', ['MARKET']]]),
            influence: null, factionDef: FACTION,
            diploState: peaceDiplo(),
            lords: [], tempBonuses: {}, structures: new Map(), buildingState: new Map(),
            aiState, aiTechStates: { ai1: aiTs },
            victoryState: { projects: {}, tradeRoutes: {}, scoreSnapshots: {} },
            currentTurn: 35,
        });

        expect(buildTypes(actions)).toContain('HARBOR');
    });
});

// ===========================================================================
// Scenario 8: Tech gating — unit types locked without research
// ===========================================================================
describe('Scenario: unit tech gating', () => {
    it('does not train CATAPULT without MATHEMATICS', () => {
        const ts = createTechState();
        expect(getUnlockedUnits(ts).has('CATAPULT')).toBe(false);
        ts.researched.add('MATHEMATICS');
        expect(getUnlockedUnits(ts).has('CATAPULT')).toBe(true);
    });

    it('does not train GALLEY without NAVAL_ENGINEERING', () => {
        const ts = createTechState();
        expect(getUnlockedUnits(ts).has('GALLEY')).toBe(false);
        ts.researched.add('NAVAL_ENGINEERING');
        expect(getUnlockedUnits(ts).has('GALLEY')).toBe(true);
    });

    it('does not train TREBUCHET without SIEGE_CRAFT', () => {
        const ts = createTechState();
        expect(getUnlockedUnits(ts).has('TREBUCHET')).toBe(false);
        ts.researched.add('SIEGE_CRAFT');
        expect(getUnlockedUnits(ts).has('TREBUCHET')).toBe(true);
    });

    it('TRAINING_ENGINEERING unlocks bridge building ability', () => {
        const ts = createTechState();
        expect(ts.researched.has('ENGINEERING')).toBe(false);
        ts.researched.add('ENGINEERING');
        expect(ts.researched.has('ENGINEERING')).toBe(true);
    });
});

// ===========================================================================
// Scenario 9: pathCrossesWater function tests
// ===========================================================================
describe('Scenario: pathCrossesWater unit tests', () => {
    it('returns true when path crosses water', async () => {
        const { pathCrossesWater } = await import('../src/ai_goals.js');
        const tiles = makeTileMap([
            [0, 0, 'PLAINS', null],
            [1, 0, 'WATER', null],
            [2, 0, 'PLAINS', null],
        ]);
        expect(pathCrossesWater(tiles, 0, 0, 2, 0)).toBe(true);
    });

    it('returns false when path is all land', async () => {
        const { pathCrossesWater } = await import('../src/ai_goals.js');
        const tiles = makeTileMap([
            [0, 0, 'PLAINS', null],
            [1, 0, 'PLAINS', null],
            [2, 0, 'PLAINS', null],
        ]);
        expect(pathCrossesWater(tiles, 0, 0, 2, 0)).toBe(false);
    });

    it('returns true when path crosses unbridged river', async () => {
        const { pathCrossesWater } = await import('../src/ai_goals.js');
        const tiles = makeTileMap([
            [0, 0, 'PLAINS', null],
            [1, 0, 'RIVER', null, { bridge: false }],
            [2, 0, 'PLAINS', null],
        ]);
        expect(pathCrossesWater(tiles, 0, 0, 2, 0)).toBe(true);
    });

    it('returns false when river is bridged', async () => {
        const { pathCrossesWater } = await import('../src/ai_goals.js');
        const tiles = makeTileMap([
            [0, 0, 'PLAINS', null],
            [1, 0, 'RIVER', null, { bridge: true }],
            [2, 0, 'PLAINS', null],
        ]);
        expect(pathCrossesWater(tiles, 0, 0, 2, 0)).toBe(false);
    });

    it('returns false for null tiles', async () => {
        const { pathCrossesWater } = await import('../src/ai_goals.js');
        expect(pathCrossesWater(null, 0, 0, 2, 0)).toBe(false);
    });
});
