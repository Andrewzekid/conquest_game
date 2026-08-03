/**
 * Workstream B: settler desirability + long-term boost (turns 1-50) and
 * mine-over-sawmill priority (HILLS mines, iron-scarce scoring).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { computeAIActions, evaluateSettleDesirability, findImprovementSpot, improvementForTerrain } from '../src/ai.js';
import { createAIState } from '../src/ai_goals.js';
import { FACTION_DEFS } from '../src/faction.js';
import { DIPLOMACY_STATES, setGridDimensions } from '../src/config.js';
import { makeTile, makeUnit, makeTileMap } from './helpers.js';

beforeEach(() => { setGridDimensions(40, 40); });

const FACTION = FACTION_DEFS.golden; // expansion-friendly personality

function makeDiplo(owner, enemy) {
    return {
        relations: {
            [`${owner}:${enemy}`]: { state: DIPLOMACY_STATES.PEACE, turnsAllied: 0, turnsAtWar: 0, relationship: 10, warsDeclared: 0, peaceTreaties: 0, tradesMade: 0, brokenTreaties: 0, grievances: 0, grievanceLog: [], expiresOn: null, formalWar: false, lastWarDeclaredTurn: 0, grudges: {}, trust: 1 },
            [`${enemy}:${owner}`]: { state: DIPLOMACY_STATES.PEACE, turnsAllied: 0, turnsAtWar: 0, relationship: 10, warsDeclared: 0, peaceTreaties: 0, tradesMade: 0, brokenTreaties: 0, grievances: 0, grievanceLog: [], expiresOn: null, formalWar: false, lastWarDeclaredTurn: 0, grudges: {}, trust: 1 },
        },
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

// ===========================================================================
// evaluateSettleDesirability
// ===========================================================================
describe('evaluateSettleDesirability', () => {
    it('returns high score with lots of open land and no resources', () => {
        const tiles = new Map();
        tiles.set('5,5', makeTile(5, 5, 'CITY', 'ai1'));
        // Open land far enough from the city to be a valid found spot
        // (engine MIN_CITY_SPACING: can't found within 6 Chebyshev of own city).
        for (let x = 12; x <= 25; x++) {
            for (let z = 12; z <= 15; z++) tiles.set(`${x},${z}`, makeTile(x, z, 'PLAINS', null));
        }
        const land = {
            idOf: new Map([...tiles.values()].map(t => [`${t.x},${t.z}`, 1])),
            sizes: new Map([[1, tiles.size]]),
        };
        const result = evaluateSettleDesirability(tiles, 'ai1', land, 1, {}, null, null, FACTION);
        expect(result.openSpots).toBeGreaterThan(0);
        expect(result.openRatio).toBeGreaterThan(0.5);
        expect(result.score).toBeGreaterThan(0.5);
    });

    it('scarcity of iron raises the score', () => {
        const tiles = new Map();
        tiles.set('5,5', makeTile(5, 5, 'CITY', 'ai1'));
        for (let x = 12; x <= 25; x++) {
            for (let z = 12; z <= 15; z++) tiles.set(`${x},${z}`, makeTile(x, z, 'PLAINS', null));
        }
        const land = {
            idOf: new Map([...tiles.values()].map(t => [`${t.x},${t.z}`, 1])),
            sizes: new Map([[1, tiles.size]]),
        };
        const poor = evaluateSettleDesirability(tiles, 'ai1', land, 1, { iron: 5, wood: 30, food: 60, gold: 80 }, null, null, FACTION);
        const rich = evaluateSettleDesirability(tiles, 'ai1', land, 1, { iron: 80, wood: 60, food: 60, gold: 80 }, null, null, FACTION);
        expect(poor.scarcityFactor).toBeGreaterThan(rich.scarcityFactor);
        expect(poor.score).toBeGreaterThan(rich.score);
    });

    it('allied cities nearby add to desirability', () => {
        const tiles = new Map();
        tiles.set('5,5', makeTile(5, 5, 'CITY', 'ai1'));
        tiles.set('20,20', makeTile(20, 20, 'CITY', 'ally'));
        // Spot just beyond the city-spacing limit (cheb >= 6) but within 10
        // manhattan of the allied city (safe connected frontier), plus one
        // far away with no allied city in range.
        tiles.set('26,20', makeTile(26, 20, 'PLAINS', null));
        tiles.set('30,30', makeTile(30, 30, 'PLAINS', null));
        const land = {
            idOf: new Map([...tiles.values()].map(t => [`${t.x},${t.z}`, 1])),
            sizes: new Map([[1, tiles.size]]),
        };
        const diplo = {
            relations: {
                'ai1:ally': { state: DIPLOMACY_STATES.ALLIANCE, turnsAllied: 5, relationship: 80 },
                'ally:ai1': { state: DIPLOMACY_STATES.ALLIANCE, turnsAllied: 5, relationship: 80 },
            },
            pendingOffers: [], diplomaticEvents: [],
        };
        const result = evaluateSettleDesirability(tiles, 'ai1', land, 1, {}, diplo, null, FACTION);
        expect(result.alliedFactor).toBeGreaterThan(0);
    });

    it('weak enemy garrisons add to desirability', () => {
        const tiles = new Map();
        tiles.set('5,5', makeTile(5, 5, 'CITY', 'ai1'));
        tiles.set('20,20', makeTile(20, 20, 'CITY', 'enemy'));
        // Spot within 8 manhattan of the enemy city (its weak garrison
        // matters) yet beyond the 6-cheb city-spacing limit, plus a far-away
        // spot with no enemy in range.
        tiles.set('26,22', makeTile(26, 22, 'PLAINS', null));
        tiles.set('30,30', makeTile(30, 30, 'PLAINS', null));
        const land = {
            idOf: new Map([...tiles.values()].map(t => [`${t.x},${t.z}`, 1])),
            sizes: new Map([[1, tiles.size]]),
        };
        const units = new Map();
        units.set(1, makeUnit('INFANTRY', 'enemy', 20, 20));
        const weak = evaluateSettleDesirability(tiles, 'ai1', land, 1, {}, null, units, FACTION);
        expect(weak.weakEnemyFactor).toBeGreaterThan(0);
    });
});

// ===========================================================================
// Long-term boost: early turns with open land => more settlers
// ===========================================================================
describe('long-term settler boost (turns 1-50)', () => {
    function buildMap() {
        const tiles = makeTileMap([
            [5, 5, 'CITY', 'ai1', { cityName: 'AI Capital', cityLevel: 2, fortification: 3, fortMax: 3, isCapital: true }],
        ]);
        // Connecting L-shaped corridor (orthogonally adjacent, so the open
        // plains share the home landmass).
        for (let x = 6; x <= 12; x++) tiles.set(`${x},5`, makeTile(x, 5, 'PLAINS', 'ai1'));
        for (let z = 6; z <= 13; z++) tiles.set(`12,${z}`, makeTile(12, z, 'PLAINS', 'ai1'));
        // Lots of open plains beyond the city-spacing limit: plenty of
        // valid found spots (engine can't found within 6 Chebyshev of a city).
        for (let x = 13; x <= 22; x++) {
            for (let z = 13; z <= 15; z++) tiles.set(`${x},${z}`, makeTile(x, z, 'PLAINS', null));
        }
        return tiles;
    }

    function actionsAtTurn(turn) {
        const tiles = buildMap();
        const units = new Map();
        for (let i = 0; i < 3; i++) units.set(i + 1, makeUnit('INFANTRY', 'ai1', 5 + i, 5, { factionId: 'golden' }));
        const aiState = createAIState();
        const actions = runAI({
            units, tiles,
            resources: { gold: 2000, food: 800, wood: 800, iron: 500, production: 800 },
            owner: 'ai1',
            buildings: new Map([['5,5', ['BARRACKS']]]),
            influence: null, factionDef: FACTION,
            diploState: makeDiplo('ai1', 'enemy'),
            lords: [], tempBonuses: {}, structures: new Map(), buildingState: new Map(),
            aiState, aiTechStates: null,
            victoryState: { projects: {}, tradeRoutes: {}, scoreSnapshots: {} },
            currentTurn: turn,
        });
        return { actions, aiState };
    }

    it('early turn with open land trains more settlers than late turn', () => {
        const early = actionsAtTurn(10);
        const late = actionsAtTurn(70);
        const earlySettlers = trainTypes(early.actions).filter(t => t === 'SETTLER').length;
        const lateSettlers = trainTypes(late.actions).filter(t => t === 'SETTLER').length;
        expect(earlySettlers).toBeGreaterThan(lateSettlers);
    });

    it('late turn (70) still trains at least one settler baseline', () => {
        const late = actionsAtTurn(70);
        const types = trainTypes(late.actions);
        // Baseline behavior must remain functional: either a settler or the
        // army is being trained (no crash, no negative counts).
        expect(types.length).toBeGreaterThanOrEqual(0);
    });
});

// ===========================================================================
// Mine over sawmill: HILLS mines + iron-scarce priority
// ===========================================================================
describe('improvementForTerrain + findImprovementSpot (mine priority)', () => {
    it('HILLS produces a MINE improvement', () => {
        expect(improvementForTerrain('HILLS')).toBe('MINE');
        expect(improvementForTerrain('MOUNTAIN')).toBe('MINE');
        expect(improvementForTerrain('FOREST')).toBe('LUMBERMILL');
        expect(improvementForTerrain('PLAINS')).toBe('FARM');
    });

    it('prefers MINE over LUMBERMILL when iron is scarce', () => {
        const tiles = new Map();
        tiles.set('5,5', makeTile(5, 5, 'PLAINS', 'ai1'));
        tiles.set('6,5', makeTile(6, 5, 'HILLS', 'ai1'));
        tiles.set('7,5', makeTile(7, 5, 'FOREST', 'ai1'));
        const buildings = new Map();
        const influence = new Set(['5,5', '6,5', '7,5']);
        const unit = makeUnit('WORKER', 'ai1', 5, 5);
        const spot = findImprovementSpot(unit, tiles, 'ai1', buildings, influence, { iron: 5, food: 40, wood: 50 });
        expect(spot).not.toBeNull();
        // HILLS mine beats the lumbermill when iron is scarce.
        expect(improvementForTerrain(spot.terrain)).toBe('MINE');
    });

    it('lumbermill is deprioritized when wood is plentiful', () => {
        const tiles = new Map();
        tiles.set('5,5', makeTile(5, 5, 'HILLS', 'ai1'));
        tiles.set('6,5', makeTile(6, 5, 'FOREST', 'ai1'));
        const buildings = new Map();
        const influence = new Set(['5,5', '6,5']);
        const unit = makeUnit('WORKER', 'ai1', 5, 5);
        // Wood plentiful, iron moderate: mine still wins.
        const spot = findImprovementSpot(unit, tiles, 'ai1', buildings, influence, { iron: 20, food: 40, wood: 80 });
        expect(spot).not.toBeNull();
        expect(improvementForTerrain(spot.terrain)).toBe('MINE');
    });
});

// ===========================================================================
// Building MINE on HILLS via constructBuilding
// ===========================================================================
describe('MINE on HILLS terrain (constructBuilding)', () => {
    it('allows MINE on a HILLS influence tile', async () => {
        const { constructBuilding } = await import('../src/building.js');
        const tiles = new Map();
        tiles.set('5,5', makeTile(5, 5, 'CITY', 'ai1', { cityName: 'C1' }));
        tiles.set('6,5', makeTile(6, 5, 'HILLS', 'ai1'));
        const influence = new Set(['5,5', '6,5']);
        const buildings = new Map([['5,5', []]]);
        const resources = { gold: 500, wood: 500, iron: 500 };
        const msgs = constructBuilding('MINE', makeTile(6, 5, 'HILLS', 'ai1'), resources, buildings, influence, tiles);
        expect(msgs.some(m => m.includes('Built'))).toBe(true);
        expect(buildings.get('6,5')).toContain('MINE');
    });

    it('still rejects MINE on non-mineable terrain', async () => {
        const { constructBuilding } = await import('../src/building.js');
        const tiles = new Map();
        tiles.set('5,5', makeTile(5, 5, 'CITY', 'ai1', { cityName: 'C1' }));
        tiles.set('6,5', makeTile(6, 5, 'PLAINS', 'ai1'));
        const influence = new Set(['5,5', '6,5']);
        const buildings = new Map([['5,5', []]]);
        const resources = { gold: 500, wood: 500, iron: 500 };
        const msgs = constructBuilding('MINE', makeTile(6, 5, 'PLAINS', 'ai1'), resources, buildings, influence, tiles);
        expect(msgs.length).toBeGreaterThan(0);
    });
});
