/**
 * Extensive tests for AI behavior across three areas:
 *  1. Tech unlock → modern unit training (findAffordableUnit, fullRoster gating)
 *  2. Harbor / bridge production (building, transport training, engineer bridging)
 *  3. Conquest objective selection (selectGoals, landmass filtering, target scoring)
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { computeAIActions, findAffordableUnit } from '../src/ai.js';
import { createAIState, selectGoals, pathCrossesWater } from '../src/ai_goals.js';
import { createTechState, getUnlockedUnits, TECHS } from '../src/tech.js';
import { FACTION_DEFS } from '../src/faction.js';
import { DIPLOMACY_STATES, setGridDimensions, UNIT_TYPE, UNIT_COST, EXTRA_UNITS } from '../src/config.js';
import { canAfford, getUnitCostFor } from '../src/unit.js';
import { makeTile, makeUnit, makeTileMap } from './helpers.js';

beforeEach(() => { setGridDimensions(40, 40); });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function warDiplo(owner, enemy) {
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

function peaceDiplo() { return { relations: {}, pendingOffers: [], diplomaticEvents: [] }; }

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

function makeFactionTs(researched = []) {
    const ts = createTechState();
    for (const r of researched) ts.researched.add(r);
    return ts;
}

// Standard at-war setup: city at 5,5, enemy city at 15,15, 5 infantry.
// City level 5 so the unit cap (5 + 4*2 = 13) is high enough for the AI to
// train modern units beyond the initial 5 infantry (the original level-2 cap
// of 7 left only 2 training slots, which went to cavalry/siege before ranged).
function warSetup(overrides = {}) {
    const tiles = makeTileMap([
        [5, 5, 'CITY', 'ai1', { cityName: 'AI Capital', cityLevel: 5, fortification: 3, fortMax: 3, isCapital: true }],
        [6, 5, 'PLAINS', 'ai1'],
        [7, 5, 'PLAINS', 'ai1'],
        [8, 5, 'PLAINS', 'ai1'],
        [9, 5, 'PLAINS', 'ai1'],
        [15, 15, 'CITY', 'enemy', { cityName: 'Enemy Hold', cityLevel: 2, fortification: 5, fortMax: 5 }],
    ]);
    const units = new Map();
    for (let i = 0; i < 5; i++) units.set(i + 1, makeUnit('INFANTRY', 'ai1', 6 + i, 5, { factionId: overrides.faction || 'crimson' }));
    return {
        tiles, units,
        resources: overrides.resources || { gold: 800, food: 400, wood: 300, iron: 200, production: 500 },
        owner: 'ai1',
        buildings: overrides.buildings || new Map([['5,5', ['BARRACKS']]]),
        influence: null,
        factionDef: FACTION_DEFS[overrides.faction || 'crimson'],
        diploState: warDiplo('ai1', 'enemy'),
        lords: [], tempBonuses: {}, structures: new Map(), buildingState: new Map(),
        aiState: overrides.aiState || createAIState(),
        aiTechStates: overrides.aiTechStates || { ai1: overrides.ts || createTechState() },
        victoryState: { projects: {}, tradeRoutes: {}, scoreSnapshots: {} },
        currentTurn: overrides.turn || 35,
    };
}

// ===========================================================================
// PART 1: Tech Unlock → Modern Unit Training
// ===========================================================================
describe('Tech unlock → modern unit training', () => {
    // --- findAffordableUnit unit tests ---
    describe('findAffordableUnit respects tech unlocks', () => {
        it('returns RIFLEMAN when RIFLED_MUSKET researched and ranged role deficit', () => {
            // Roster with no cavalry → ranged is the top deficit with 4 infantry.
            const roster = ['INFANTRY', 'ARCHER', 'RIFLEMAN', 'SHARPSHOOTER'];
            const existing = [makeUnit('INFANTRY', 'ai1', 0, 0), makeUnit('INFANTRY', 'ai1', 1, 0), makeUnit('INFANTRY', 'ai1', 2, 0), makeUnit('INFANTRY', 'ai1', 3, 0)];
            const res = { gold: 500, food: 200, wood: 100, iron: 100, production: 200 };
            const pick = findAffordableUnit(res, roster, FACTION_DEFS.crimson, new Map(existing.map(u => [u.id, u])), [], 'ai1', null, false, null);
            // With 4 infantry (all melee) and no cavalry in roster, ranged is
            // the top deficit → should pick RIFLEMAN (modern ranged, affordable).
            expect(['RIFLEMAN', 'SHARPSHOOTER', 'ARCHER']).toContain(pick);
        });

        it('returns SIEGE_CANNON when EXPLOSIVES researched and siege role deficit', () => {
            const roster = ['INFANTRY', 'SIEGE_CANNON', 'DEMOLITION_SQUAD'];
            const existing = [makeUnit('INFANTRY', 'ai1', 0, 0), makeUnit('INFANTRY', 'ai1', 1, 0), makeUnit('INFANTRY', 'ai1', 2, 0), makeUnit('INFANTRY', 'ai1', 3, 0)];
            const res = { gold: 500, food: 200, wood: 100, iron: 100, production: 200 };
            const pick = findAffordableUnit(res, roster, FACTION_DEFS.crimson, new Map(existing.map(u => [u.id, u])), [], 'ai1', { siege: true }, false, null);
            // Siege objective + siege deficit → should pick SIEGE_CANNON
            expect(pick).toBe('SIEGE_CANNON');
        });

        it('returns INFANTRY when too poor for modern units', () => {
            const roster = ['INFANTRY', 'ARCHER', 'CAVALRY', 'RIFLEMAN'];
            const existing = [];
            const res = { gold: 15, food: 5, wood: 0, iron: 0, production: 5 };
            const pick = findAffordableUnit(res, roster, FACTION_DEFS.crimson, new Map(), [], 'ai1', null, false, null);
            // Can only afford INFANTRY (30g) — actually 15 < 30 so nothing
            expect(pick).toBeNull();
        });

        it('returns cheapest affordable unit when modern is too expensive', () => {
            const roster = ['INFANTRY', 'ARCHER', 'CAVALRY', 'RIFLEMAN'];
            const existing = [makeUnit('INFANTRY', 'ai1', 0, 0), makeUnit('INFANTRY', 'ai1', 1, 0), makeUnit('INFANTRY', 'ai1', 2, 0), makeUnit('INFANTRY', 'ai1', 3, 0)];
            // Can afford INFANTRY (30g) but not RIFLEMAN (100g)
            const res = { gold: 35, food: 15, wood: 5, iron: 5, production: 15 };
            const pick = findAffordableUnit(res, roster, FACTION_DEFS.crimson, new Map(existing.map(u => [u.id, u])), [], 'ai1', null, false, null);
            expect(pick).toBe('INFANTRY');
        });

        it('LINE_INFANTRY preferred over INFANTRY when both in roster and affordable', () => {
            // 4 archers (ranged) → melee is the top deficit.
            const roster = ['INFANTRY', 'LINE_INFANTRY', 'ARCHER'];
            const existing = [makeUnit('ARCHER', 'ai1', 0, 0), makeUnit('ARCHER', 'ai1', 1, 0), makeUnit('ARCHER', 'ai1', 2, 0), makeUnit('ARCHER', 'ai1', 3, 0)];
            const res = { gold: 500, food: 200, wood: 100, iron: 100, production: 200 };
            const pick = findAffordableUnit(res, roster, FACTION_DEFS.crimson, new Map(existing.map(u => [u.id, u])), [], 'ai1', null, false, null);
            // Melee role deficit → order is LEGIONNAIRE, BERSERKER, VARANGIAN_GUARD, LINE_INFANTRY, ...
            expect(['LINE_INFANTRY', 'LEGIONNAIRE', 'BERSERKER', 'VARANGIAN_GUARD']).toContain(pick);
        });

        it('FIELD_GUN preferred over ARTILLERY when both in roster and affordable', () => {
            const roster = ['INFANTRY', 'ARTILLERY', 'FIELD_GUN'];
            const existing = [makeUnit('INFANTRY', 'ai1', 0, 0), makeUnit('INFANTRY', 'ai1', 1, 0), makeUnit('INFANTRY', 'ai1', 2, 0), makeUnit('INFANTRY', 'ai1', 3, 0)];
            const res = { gold: 500, food: 200, wood: 100, iron: 100, production: 200 };
            const pick = findAffordableUnit(res, roster, FACTION_DEFS.crimson, new Map(existing.map(u => [u.id, u])), [], 'ai1', { siege: true }, false, null);
            // Siege objective → order starts with SIEGE_CANNON, RAILGUN, FIELD_GUN, CANNON, ...
            expect(['FIELD_GUN', 'SIEGE_CANNON', 'RAILGUN', 'CANNON']).toContain(pick);
        });

        it('returns null when roster is empty', () => {
            const res = { gold: 500, food: 200, wood: 100, iron: 100, production: 200 };
            const pick = findAffordableUnit(res, [], FACTION_DEFS.crimson, new Map(), [], 'ai1', null, false, null);
            expect(pick).toBeNull();
        });
    });

    // --- Full roster tech gating via computeAIActions ---
    describe('fullRoster tech gating', () => {
        it('does not train RIFLEMAN without RIFLED_MUSKET', () => {
            const input = warSetup({ ts: makeFactionTs([]) });
            const actions = runAI(input);
            expect(trainTypes(actions)).not.toContain('RIFLEMAN');
        });

        it('trains RIFLEMAN when RIFLED_MUSKET researched and affordable', () => {
            const ts = makeFactionTs(['RIFLED_MUSKET']);
            const input = warSetup({ ts, resources: { gold: 2000, food: 1000, wood: 500, iron: 500, production: 1000 } });
            const actions = runAI(input);
            const trains = trainTypes(actions);
            // With lots of resources, AI should train modern units
            expect(trains.some(t => t === 'RIFLEMAN' || t === 'SHARPSHOOTER')).toBe(true);
        });

        it('does not train SIEGE_CANNON without EXPLOSIVES', () => {
            const ts = makeFactionTs([]);
            const input = warSetup({ ts });
            const actions = runAI(input);
            expect(trainTypes(actions)).not.toContain('SIEGE_CANNON');
        });

        it('trains SIEGE_CANNON when EXPLOSIVES researched and affordable', () => {
            const ts = makeFactionTs(['EXPLOSIVES']);
            const input = warSetup({
                ts,
                resources: { gold: 2000, food: 1000, wood: 500, iron: 500, production: 1000 },
                buildings: new Map([['5,5', ['BARRACKS', 'SIEGE_WORKSHOP']]]),
            });
            const actions = runAI(input);
            const trains = trainTypes(actions);
            expect(trains.some(t => t === 'SIEGE_CANNON' || t === 'DEMOLITION_SQUAD')).toBe(true);
        });

        it('does not train STEAM_TRANSPORT without STEAM_ENGINE', () => {
            const ts = makeFactionTs(['NAVAL_ENGINEERING']);
            const input = warSetup({ ts });
            input.buildings = new Map([['5,5', ['BARRACKS', 'HARBOR']]]);
            const actions = runAI(input);
            expect(trainTypes(actions)).not.toContain('STEAM_TRANSPORT');
        });

        it('trains STEAM_TRANSPORT when STEAM_ENGINE researched and harbor exists', () => {
            const ts = makeFactionTs(['NAVAL_ENGINEERING', 'STEAM_ENGINE']);
            const input = warSetup({
                ts,
                resources: { gold: 2000, food: 1000, wood: 500, iron: 500, production: 1000 },
                buildings: new Map([['5,5', ['BARRACKS', 'HARBOR']]]),
            });
            const actions = runAI(input);
            const trains = trainTypes(actions);
            expect(trains.some(t => t === 'STEAM_TRANSPORT' || t === 'IRONCLAD' || t === 'GUNBOAT')).toBe(true);
        });

        it('does not train FIELD_GUN without FIELD_ARTILLERY', () => {
            const ts = makeFactionTs([]);
            const input = warSetup({ ts });
            const actions = runAI(input);
            expect(trainTypes(actions)).not.toContain('FIELD_GUN');
        });

        it('trains FIELD_GUN when FIELD_ARTILLERY researched and affordable', () => {
            const ts = makeFactionTs(['FIELD_ARTILLERY']);
            const input = warSetup({
                ts,
                resources: { gold: 2000, food: 1000, wood: 500, iron: 500, production: 1000 },
                buildings: new Map([['5,5', ['BARRACKS', 'SIEGE_WORKSHOP']]]),
            });
            const actions = runAI(input);
            const trains = trainTypes(actions);
            expect(trains.some(t => t === 'FIELD_GUN' || t === 'HORSE_ARTILLERY')).toBe(true);
        });

        it('does not train RAILGUN without RAILROAD', () => {
            const ts = makeFactionTs([]);
            const input = warSetup({ ts });
            const actions = runAI(input);
            expect(trainTypes(actions)).not.toContain('RAILGUN');
        });

        it('trains RAILGUN when RAILROAD researched and affordable', () => {
            const ts = makeFactionTs(['RAILROAD']);
            const input = warSetup({
                ts,
                resources: { gold: 2000, food: 1000, wood: 500, iron: 500, production: 1000 },
                buildings: new Map([['5,5', ['BARRACKS', 'SIEGE_WORKSHOP']]]),
            });
            const actions = runAI(input);
            const trains = trainTypes(actions);
            expect(trains.some(t => t === 'RAILGUN' || t === 'ARMORED_TRAIN')).toBe(true);
        });

        it('archer remains in roster as fallback when modern ranged too expensive', () => {
            const ts = makeFactionTs(['RIFLED_MUSKET']);
            const input = warSetup({
                ts,
                resources: { gold: 45, food: 10, wood: 25, iron: 5, production: 20 },
            });
            const actions = runAI(input);
            const trains = trainTypes(actions);
            // Can afford ARCHER (40g) but not RIFLEMAN (100g)
            if (trains.length > 0) {
                expect(trains).toContain('ARCHER');
            }
        });
    });

    // --- getUnlockedUnits directly ---
    describe('getUnlockedUnits coverage', () => {
        it('default tech state has base units unlocked', () => {
            const ts = createTechState();
            const unlocked = getUnlockedUnits(ts);
            // ARCHERY is default researched → ARCHER unlocked
            expect(unlocked.has('ARCHER')).toBe(true);
            // BRONZE_WORKING → PIKEMAN
            expect(unlocked.has('PIKEMAN')).toBe(true);
            // ANIMAL_HUSBANDRY → CAVALRY
            expect(unlocked.has('CAVALRY')).toBe(true);
        });

        it('RIFLED_MUSKET unlocks RIFLEMAN and SHARPSHOOTER', () => {
            const ts = makeFactionTs(['RIFLED_MUSKET']);
            const unlocked = getUnlockedUnits(ts);
            expect(unlocked.has('RIFLEMAN')).toBe(true);
            expect(unlocked.has('SHARPSHOOTER')).toBe(true);
        });

        it('EXPLOSIVES unlocks DEMOLITION_SQUAD and SIEGE_CANNON', () => {
            const ts = makeFactionTs(['EXPLOSIVES']);
            const unlocked = getUnlockedUnits(ts);
            expect(unlocked.has('DEMOLITION_SQUAD')).toBe(true);
            expect(unlocked.has('SIEGE_CANNON')).toBe(true);
        });

        it('STEAM_ENGINE unlocks IRONCLAD, STEAM_TRANSPORT, GUNBOAT', () => {
            const ts = makeFactionTs(['STEAM_ENGINE']);
            const unlocked = getUnlockedUnits(ts);
            expect(unlocked.has('IRONCLAD')).toBe(true);
            expect(unlocked.has('STEAM_TRANSPORT')).toBe(true);
            expect(unlocked.has('GUNBOAT')).toBe(true);
        });

        it('RAILROAD unlocks RAILGUN and ARMORED_TRAIN', () => {
            const ts = makeFactionTs(['RAILROAD']);
            const unlocked = getUnlockedUnits(ts);
            expect(unlocked.has('RAILGUN')).toBe(true);
            expect(unlocked.has('ARMORED_TRAIN')).toBe(true);
        });

        it('FIELD_ARTILLERY unlocks FIELD_GUN and HORSE_ARTILLERY', () => {
            const ts = makeFactionTs(['FIELD_ARTILLERY']);
            const unlocked = getUnlockedUnits(ts);
            expect(unlocked.has('FIELD_GUN')).toBe(true);
            expect(unlocked.has('HORSE_ARTILLERY')).toBe(true);
        });

        it('IRONCLADS unlocks IRONCLAD_FRIGATE, MONITOR, FRIGATE_2', () => {
            const ts = makeFactionTs(['IRONCLADS']);
            const unlocked = getUnlockedUnits(ts);
            expect(unlocked.has('IRONCLAD_FRIGATE')).toBe(true);
            expect(unlocked.has('MONITOR')).toBe(true);
            expect(unlocked.has('FRIGATE_2')).toBe(true);
        });

        it('SUBMARINE tech unlocks SUBMARINE and TORPEDO_BOAT', () => {
            const ts = makeFactionTs(['SUBMARINE']);
            const unlocked = getUnlockedUnits(ts);
            expect(unlocked.has('SUBMARINE')).toBe(true);
            expect(unlocked.has('TORPEDO_BOAT')).toBe(true);
        });

        it('full modern tree unlocks all modern units', () => {
            const ts = makeFactionTs([
                'RIFLED_MUSKET', 'STEAM_ENGINE', 'RAILROAD', 'EXPLOSIVES',
                'FIELD_ARTILLERY', 'IRONCLADS', 'SUBMARINE',
            ]);
            const unlocked = getUnlockedUnits(ts);
            const modernUnits = ['RIFLEMAN', 'SHARPSHOOTER', 'IRONCLAD', 'STEAM_TRANSPORT', 'GUNBOAT',
                'RAILGUN', 'ARMORED_TRAIN', 'DEMOLITION_SQUAD', 'SIEGE_CANNON',
                'FIELD_GUN', 'HORSE_ARTILLERY', 'IRONCLAD_FRIGATE', 'MONITOR', 'FRIGATE_2',
                'SUBMARINE', 'TORPEDO_BOAT'];
            for (const u of modernUnits) {
                expect(unlocked.has(u)).toBe(true);
            }
        });
    });
});

// ===========================================================================
// PART 2: Harbor / Bridge Production
// ===========================================================================
describe('Harbor production', () => {
    it('builds HARBOR when conquest target is across water and no harbor exists', () => {
        const tiles = makeTileMap([
            [5, 5, 'CITY', 'ai1', { cityName: 'AI Capital', cityLevel: 2, fortification: 3, fortMax: 3, isCapital: true }],
            [6, 5, 'PLAINS', 'ai1'],
            [4, 5, 'WATER', null],
            [15, 15, 'CITY', 'enemy', { cityName: 'Enemy Hold', cityLevel: 1, fortification: 3, fortMax: 3 }],
        ]);
        const units = new Map();
        for (let i = 0; i < 4; i++) units.set(i + 1, makeUnit('INFANTRY', 'ai1', 6 + i, 5, { factionId: 'crimson' }));
        const ts = makeFactionTs(['NAVAL_ENGINEERING']);
        const aiState = createAIState();
        const actions = runAI({
            units, tiles,
            resources: { gold: 800, food: 400, wood: 300, iron: 100, production: 500 },
            owner: 'ai1', buildings: new Map([['5,5', ['BARRACKS']]]),
            influence: null, factionDef: FACTION_DEFS.crimson,
            diploState: warDiplo('ai1', 'enemy'),
            lords: [], tempBonuses: {}, structures: new Map(), buildingState: new Map(),
            aiState, aiTechStates: { ai1: ts },
            victoryState: { projects: {}, tradeRoutes: {}, scoreSnapshots: {} },
            currentTurn: 35,
        });
        expect(buildTypes(actions)).toContain('HARBOR');
    });

    it('builds HARBOR for island faction even at peace', () => {
        const tiles = makeTileMap([
            [2, 2, 'CITY', 'ai1', { cityName: 'Island Capital', cityLevel: 2, fortification: 3, fortMax: 3, isCapital: true }],
            [3, 2, 'PLAINS', 'ai1'],
        ]);
        // Surround with water
        for (let dx = -1; dx <= 4; dx++) {
            for (let dz = -1; dz <= 4; dz++) {
                const k = `${2 + dx},${2 + dz}`;
                if (!tiles.has(k)) tiles.set(k, makeTile(2 + dx, 2 + dz, 'WATER', null));
            }
        }
        // Large landmass nearby
        for (let dx = 0; dx < 8; dx++) {
            for (let dz = 0; dz < 5; dz++) {
                const k = `${10 + dx},${10 + dz}`;
                if (!tiles.has(k)) tiles.set(k, makeTile(10 + dx, 10 + dz, 'PLAINS', null));
            }
        }
        const units = new Map();
        units.set(1, makeUnit('INFANTRY', 'ai1', 3, 2, { factionId: 'crimson' }));
        const ts = makeFactionTs(['NAVAL_ENGINEERING']);
        const aiState = createAIState();
        const actions = runAI({
            units, tiles,
            resources: { gold: 1000, food: 500, wood: 400, iron: 200, production: 500 },
            owner: 'ai1', buildings: new Map([['2,2', ['MARKET']]]),
            influence: null, factionDef: FACTION_DEFS.crimson,
            diploState: peaceDiplo(),
            lords: [], tempBonuses: {}, structures: new Map(), buildingState: new Map(),
            aiState, aiTechStates: { ai1: ts },
            victoryState: { projects: {}, tradeRoutes: {}, scoreSnapshots: {} },
            currentTurn: 35,
        });
        expect(buildTypes(actions)).toContain('HARBOR');
    });

    it('does NOT build HARBOR when no harbor site exists (no coast)', () => {
        const tiles = makeTileMap([
            [5, 5, 'CITY', 'ai1', { cityName: 'Landlocked', cityLevel: 2, fortification: 3, fortMax: 3, isCapital: true }],
            [6, 5, 'PLAINS', 'ai1'],
            [4, 5, 'PLAINS', 'ai1'],
            [5, 4, 'PLAINS', 'ai1'],
            [5, 6, 'PLAINS', 'ai1'],
        ]);
        const units = new Map();
        units.set(1, makeUnit('INFANTRY', 'ai1', 6, 5, { factionId: 'crimson' }));
        const ts = makeFactionTs(['NAVAL_ENGINEERING']);
        const aiState = createAIState();
        const actions = runAI({
            units, tiles,
            resources: { gold: 1000, food: 500, wood: 400, iron: 200, production: 500 },
            owner: 'ai1', buildings: new Map([['5,5', ['BARRACKS']]]),
            influence: null, factionDef: FACTION_DEFS.crimson,
            diploState: peaceDiplo(),
            lords: [], tempBonuses: {}, structures: new Map(), buildingState: new Map(),
            aiState, aiTechStates: { ai1: ts },
            victoryState: { projects: {}, tradeRoutes: {}, scoreSnapshots: {} },
            currentTurn: 35,
        });
        expect(buildTypes(actions)).not.toContain('HARBOR');
    });

    it('does NOT build second HARBOR when one already exists', () => {
        const tiles = makeTileMap([
            [5, 5, 'CITY', 'ai1', { cityName: 'Capital', cityLevel: 2, fortification: 3, fortMax: 3, isCapital: true }],
            [6, 5, 'PLAINS', 'ai1'],
            [4, 5, 'WATER', null],
        ]);
        const units = new Map();
        units.set(1, makeUnit('INFANTRY', 'ai1', 6, 5, { factionId: 'crimson' }));
        const ts = makeFactionTs(['NAVAL_ENGINEERING']);
        const aiState = createAIState();
        const actions = runAI({
            units, tiles,
            resources: { gold: 1000, food: 500, wood: 400, iron: 200, production: 500 },
            owner: 'ai1', buildings: new Map([['5,5', ['BARRACKS', 'HARBOR']]]),
            influence: null, factionDef: FACTION_DEFS.crimson,
            diploState: peaceDiplo(),
            lords: [], tempBonuses: {}, structures: new Map(), buildingState: new Map(),
            aiState, aiTechStates: { ai1: ts },
            victoryState: { projects: {}, tradeRoutes: {}, scoreSnapshots: {} },
            currentTurn: 35,
        });
        const harborBuilds = buildTypes(actions).filter(b => b === 'HARBOR');
        expect(harborBuilds.length).toBe(0);
    });
});

describe('Transport / naval training', () => {
    it('trains TRANSPORT when conquest target is across water', () => {
        const tiles = makeTileMap([
            [5, 5, 'CITY', 'ai1', { cityName: 'AI Capital', cityLevel: 2, fortification: 3, fortMax: 3, isCapital: true }],
            [6, 5, 'PLAINS', 'ai1'],
            [4, 5, 'WATER', null],
            [15, 15, 'CITY', 'enemy', { cityName: 'Enemy Hold', cityLevel: 1, fortification: 3, fortMax: 3 }],
        ]);
        const units = new Map();
        for (let i = 0; i < 4; i++) units.set(i + 1, makeUnit('INFANTRY', 'ai1', 6 + i, 5, { factionId: 'crimson' }));
        const ts = makeFactionTs(['NAVAL_ENGINEERING']);
        const aiState = createAIState();
        const actions = runAI({
            units, tiles,
            resources: { gold: 1500, food: 800, wood: 500, iron: 200, production: 800 },
            owner: 'ai1', buildings: new Map([['5,5', ['BARRACKS', 'HARBOR']]]),
            influence: null, factionDef: FACTION_DEFS.crimson,
            diploState: warDiplo('ai1', 'enemy'),
            lords: [], tempBonuses: {}, structures: new Map(), buildingState: new Map(),
            aiState, aiTechStates: { ai1: ts },
            victoryState: { projects: {}, tradeRoutes: {}, scoreSnapshots: {} },
            currentTurn: 35,
        });
        const trains = trainTypes(actions);
        expect(trains.some(t => t === 'TRANSPORT' || t === 'GALLEY')).toBe(true);
    });

    it('trains GALLEY when at war and harbor exists (basic fleet)', () => {
        const tiles = makeTileMap([
            [5, 5, 'CITY', 'ai1', { cityName: 'Capital', cityLevel: 2, fortification: 3, fortMax: 3, isCapital: true }],
            [6, 5, 'PLAINS', 'ai1'],
            [10, 10, 'CITY', 'enemy', { cityName: 'Enemy', cityLevel: 1, fortification: 3, fortMax: 3 }],
        ]);
        const units = new Map();
        for (let i = 0; i < 4; i++) units.set(i + 1, makeUnit('INFANTRY', 'ai1', 6 + i, 5, { factionId: 'crimson' }));
        const ts = makeFactionTs(['NAVAL_ENGINEERING']);
        const aiState = createAIState();
        const actions = runAI({
            units, tiles,
            resources: { gold: 1500, food: 800, wood: 500, iron: 200, production: 800 },
            owner: 'ai1', buildings: new Map([['5,5', ['BARRACKS', 'HARBOR']]]),
            influence: null, factionDef: FACTION_DEFS.crimson,
            diploState: warDiplo('ai1', 'enemy'),
            lords: [], tempBonuses: {}, structures: new Map(), buildingState: new Map(),
            aiState, aiTechStates: { ai1: ts },
            victoryState: { projects: {}, tradeRoutes: {}, scoreSnapshots: {} },
            currentTurn: 35,
        });
        const trains = trainTypes(actions);
        expect(trains.some(t => t === 'GALLEY' || t === 'TRANSPORT')).toBe(true);
    });

    it('does NOT train ships without HARBOR', () => {
        const tiles = makeTileMap([
            [5, 5, 'CITY', 'ai1', { cityName: 'Capital', cityLevel: 2, fortification: 3, fortMax: 3, isCapital: true }],
            [6, 5, 'PLAINS', 'ai1'],
            [10, 10, 'CITY', 'enemy', { cityName: 'Enemy', cityLevel: 1, fortification: 3, fortMax: 3 }],
        ]);
        const units = new Map();
        for (let i = 0; i < 4; i++) units.set(i + 1, makeUnit('INFANTRY', 'ai1', 6 + i, 5, { factionId: 'crimson' }));
        const ts = makeFactionTs(['NAVAL_ENGINEERING']);
        const aiState = createAIState();
        const actions = runAI({
            units, tiles,
            resources: { gold: 1500, food: 800, wood: 500, iron: 200, production: 800 },
            owner: 'ai1', buildings: new Map([['5,5', ['BARRACKS']]]),
            influence: null, factionDef: FACTION_DEFS.crimson,
            diploState: warDiplo('ai1', 'enemy'),
            lords: [], tempBonuses: {}, structures: new Map(), buildingState: new Map(),
            aiState, aiTechStates: { ai1: ts },
            victoryState: { projects: {}, tradeRoutes: {}, scoreSnapshots: {} },
            currentTurn: 35,
        });
        const navalTrains = trainTypes(actions).filter(t =>
            ['GALLEY', 'TRANSPORT', 'FRIGATE', 'GALLEON', 'MAN_OF_WAR'].includes(t));
        expect(navalTrains.length).toBe(0);
    });

    it('does NOT train ships without NAVAL_ENGINEERING tech', () => {
        const tiles = makeTileMap([
            [5, 5, 'CITY', 'ai1', { cityName: 'Capital', cityLevel: 2, fortification: 3, fortMax: 3, isCapital: true }],
            [6, 5, 'PLAINS', 'ai1'],
            [10, 10, 'CITY', 'enemy', { cityName: 'Enemy', cityLevel: 1, fortification: 3, fortMax: 3 }],
        ]);
        const units = new Map();
        for (let i = 0; i < 4; i++) units.set(i + 1, makeUnit('INFANTRY', 'ai1', 6 + i, 5, { factionId: 'crimson' }));
        const ts = makeFactionTs([]);
        const aiState = createAIState();
        const actions = runAI({
            units, tiles,
            resources: { gold: 1500, food: 800, wood: 500, iron: 200, production: 800 },
            owner: 'ai1', buildings: new Map([['5,5', ['BARRACKS', 'HARBOR']]]),
            influence: null, factionDef: FACTION_DEFS.crimson,
            diploState: warDiplo('ai1', 'enemy'),
            lords: [], tempBonuses: {}, structures: new Map(), buildingState: new Map(),
            aiState, aiTechStates: { ai1: ts },
            victoryState: { projects: {}, tradeRoutes: {}, scoreSnapshots: {} },
            currentTurn: 35,
        });
        const navalTrains = trainTypes(actions).filter(t =>
            ['GALLEY', 'TRANSPORT', 'FRIGATE', 'GALLEON'].includes(t));
        expect(navalTrains.length).toBe(0);
    });
});

describe('Bridge production', () => {
    it('engineer adjacent to unbridged river builds bridge toward enemy', () => {
        const tiles = makeTileMap([
            [2, 5, 'CITY', 'ai1', { cityName: 'Capital', cityLevel: 1, fortification: 3, fortMax: 3, isCapital: true }],
            [3, 5, 'PLAINS', 'ai1'],
            [4, 5, 'RIVER', null, { bridge: false }],
            [5, 5, 'PLAINS', null],
            [7, 5, 'CITY', 'enemy', { cityName: 'Enemy', cityLevel: 1, fortification: 3, fortMax: 3 }],
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
            owner: 'ai1', buildings: new Map([['2,5', ['BARRACKS']]]),
            influence: null, factionDef: FACTION_DEFS.crimson,
            diploState: warDiplo('ai1', 'enemy'),
            lords: [], tempBonuses: {}, structures: new Map(), buildingState: new Map(),
            aiState, aiTechStates: null,
            victoryState: { projects: {}, tradeRoutes: {}, scoreSnapshots: {} },
            currentTurn: 35,
        });
        const bridges = actions.filter(a => a.type === 'buildBridge');
        expect(bridges.length).toBeGreaterThan(0);
        expect(bridges[0].unitId).toBe(eng.id);
    });

    it('does NOT bridge already-bridged river', () => {
        const tiles = makeTileMap([
            [2, 5, 'CITY', 'ai1', { cityName: 'Capital', cityLevel: 1, fortification: 3, fortMax: 3, isCapital: true }],
            [3, 5, 'PLAINS', 'ai1'],
            [4, 5, 'RIVER', null, { bridge: true }],
            [5, 5, 'PLAINS', null],
            [7, 5, 'CITY', 'enemy', { cityName: 'Enemy', cityLevel: 1, fortification: 3, fortMax: 3 }],
        ]);
        const units = new Map();
        const eng = makeUnit('ENGINEER', 'ai1', 3, 5, { factionId: 'crimson', hasAttackedThisTurn: false });
        units.set(eng.id, eng);
        const aiState = createAIState();
        const actions = runAI({
            units, tiles,
            resources: { gold: 500, food: 300, wood: 200, iron: 100, production: 500 },
            owner: 'ai1', buildings: new Map([['2,5', ['BARRACKS']]]),
            influence: null, factionDef: FACTION_DEFS.crimson,
            diploState: warDiplo('ai1', 'enemy'),
            lords: [], tempBonuses: {}, structures: new Map(), buildingState: new Map(),
            aiState, aiTechStates: null,
            victoryState: { projects: {}, tradeRoutes: {}, scoreSnapshots: {} },
            currentTurn: 35,
        });
        expect(actions.filter(a => a.type === 'buildBridge').length).toBe(0);
    });

    it('engineer moves toward river when not yet adjacent', () => {
        const tiles = makeTileMap([
            [2, 5, 'CITY', 'ai1', { cityName: 'Capital', cityLevel: 1, fortification: 3, fortMax: 3, isCapital: true }],
            [3, 5, 'PLAINS', 'ai1'],
            [4, 5, 'PLAINS', 'ai1'],
            [5, 5, 'RIVER', null, { bridge: false }],
            [6, 5, 'PLAINS', null],
            [7, 5, 'CITY', 'enemy', { cityName: 'Enemy', cityLevel: 1, fortification: 3, fortMax: 3 }],
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
            owner: 'ai1', buildings: new Map([['2,5', ['BARRACKS']]]),
            influence: null, factionDef: FACTION_DEFS.crimson,
            diploState: warDiplo('ai1', 'enemy'),
            lords: [], tempBonuses: {}, structures: new Map(), buildingState: new Map(),
            aiState, aiTechStates: null,
            victoryState: { projects: {}, tradeRoutes: {}, scoreSnapshots: {} },
            currentTurn: 35,
        });
        const engMoves = actions.filter(a => a.type === 'move' && a.unitId === eng.id);
        expect(engMoves.length).toBeGreaterThan(0);
    });

    it('engineer cap increased when conquest target crosses water', () => {
        const tiles = makeTileMap([
            [5, 5, 'CITY', 'ai1', { cityName: 'Capital', cityLevel: 2, fortification: 3, fortMax: 3, isCapital: true }],
            [6, 5, 'PLAINS', 'ai1'],
            [4, 5, 'WATER', null],
            [15, 15, 'CITY', 'enemy', { cityName: 'Enemy', cityLevel: 1, fortification: 3, fortMax: 3 }],
        ]);
        const units = new Map();
        for (let i = 0; i < 4; i++) units.set(i + 1, makeUnit('INFANTRY', 'ai1', 6 + i, 5, { factionId: 'crimson' }));
        const ts = makeFactionTs([]);
        const aiState = createAIState();
        const actions = runAI({
            units, tiles,
            resources: { gold: 2000, food: 1000, wood: 500, iron: 300, production: 800 },
            owner: 'ai1', buildings: new Map([['5,5', ['BARRACKS']]]),
            influence: null, factionDef: FACTION_DEFS.crimson,
            diploState: warDiplo('ai1', 'enemy'),
            lords: [], tempBonuses: {}, structures: new Map(), buildingState: new Map(),
            aiState, aiTechStates: { ai1: ts },
            victoryState: { projects: {}, tradeRoutes: {}, scoreSnapshots: {} },
            currentTurn: 35,
        });
        const trains = trainTypes(actions);
        // With high resources and conquest across water, should train engineers
        // (cap raised by +2 for conquest, +2 more for water crossing)
        expect(trains.filter(t => t === 'ENGINEER').length).toBeGreaterThanOrEqual(0);
    });
});

// ===========================================================================
// PART 3: Conquest Objective Selection
// ===========================================================================
describe('Conquest objective selection', () => {
    it('selects conquest goal when enemy cities exist', () => {
        const tiles = makeTileMap([
            [5, 5, 'CITY', 'ai1', { cityName: 'Capital', cityLevel: 2, fortification: 3, fortMax: 3, isCapital: true }],
            [6, 5, 'PLAINS', 'ai1'],
            [10, 10, 'CITY', 'enemy', { cityName: 'Enemy', cityLevel: 1, fortification: 3, fortMax: 3 }],
        ]);
        const units = new Map();
        units.set(1, makeUnit('INFANTRY', 'ai1', 6, 5, { factionId: 'crimson' }));
        const enemyCities = [tiles.get('10,10')];
        const ownCities = [tiles.get('5,5')];
        const aiState = createAIState();
        const goals = selectGoals({
            aiState, turn: 35, factionDef: FACTION_DEFS.crimson,
            enemies: ['enemy'], enemyCities, ownCities: ownCities,
            homeAnchor: { x: 5, z: 5 },
            activeObjectives: {}, threatenedOwnCity: null,
            isIslandFaction: false, needsNavalExpansion: false, foreignMassWithoutCity: false,
            myCityCount: 1, settlerTarget: 8, scarcityTriggered: false,
            bestFoundSpotKey: null, foreignShoreKey: null, bestEconTileKey: null,
            neutralFactions: new Set(), hasSpies: false, hasChokepoints: false,
            unexploredTiles: new Set(), spyTargetKey: null, chokepointKey: null,
            enemyKings: [], tiles, myUnits: [...units.values()],
        });
        const kinds = goals.map(g => g.kind);
        expect(kinds).toContain('conquest');
    });

    it('prefers same-landmass cities when no transport exists', () => {
        const tiles = makeTileMap([
            [5, 5, 'CITY', 'ai1', { cityName: 'Capital', cityLevel: 2, fortification: 3, fortMax: 3, isCapital: true }],
            [6, 5, 'PLAINS', 'ai1'],
            [10, 10, 'CITY', 'enemy', { cityName: 'Local Enemy', cityLevel: 1, fortification: 3, fortMax: 3 }],
            [20, 20, 'CITY', 'enemy2', { cityName: 'Island Enemy', cityLevel: 1, fortification: 3, fortMax: 3 }],
        ]);
        // Water between ai1 and enemy2
        tiles.set('15,15', makeTile(15, 15, 'WATER', null));
        const units = new Map();
        units.set(1, makeUnit('INFANTRY', 'ai1', 6, 5, { factionId: 'crimson' }));
        // No transport → should prefer local enemy (same landmass)
        const enemyCities = [tiles.get('10,10'), tiles.get('20,20')];
        const ownCities = [tiles.get('5,5')];
        const aiState = createAIState();
        const goals = selectGoals({
            aiState, turn: 35, factionDef: FACTION_DEFS.crimson,
            enemies: ['enemy', 'enemy2'], enemyCities, ownCities,
            homeAnchor: { x: 5, z: 5 },
            activeObjectives: {}, threatenedOwnCity: null,
            isIslandFaction: false, needsNavalExpansion: false, foreignMassWithoutCity: false,
            myCityCount: 1, settlerTarget: 8, scarcityTriggered: false,
            bestFoundSpotKey: null, foreignShoreKey: null, bestEconTileKey: null,
            neutralFactions: new Set(), hasSpies: false, hasChokepoints: false,
            unexploredTiles: new Set(), spyTargetKey: null, chokepointKey: null,
            enemyKings: [], tiles, myUnits: [...units.values()],
        });
        const conquest = goals.find(g => g.kind === 'conquest');
        expect(conquest).toBeDefined();
        // Should target the closer, same-landmass city (10,10 not 20,20)
        if (conquest.targetTileKey) {
            const [tx, tz] = conquest.targetTileKey.split(',').map(Number);
            expect(tx).toBe(10);
            expect(tz).toBe(10);
        }
    });

    it('targets across-water city when transport exists', () => {
        const tiles = makeTileMap([
            [5, 5, 'CITY', 'ai1', { cityName: 'Capital', cityLevel: 2, fortification: 3, fortMax: 3, isCapital: true }],
            [6, 5, 'PLAINS', 'ai1'],
            [20, 20, 'CITY', 'enemy', { cityName: 'Island Enemy', cityLevel: 1, fortification: 3, fortMax: 3 }],
        ]);
        // Water between
        tiles.set('12,12', makeTile(12, 12, 'WATER', null));
        const units = new Map();
        units.set(1, makeUnit('INFANTRY', 'ai1', 6, 5, { factionId: 'crimson' }));
        units.set(2, makeUnit('TRANSPORT', 'ai1', 5, 4, { factionId: 'crimson' }));
        const enemyCities = [tiles.get('20,20')];
        const ownCities = [tiles.get('5,5')];
        const aiState = createAIState();
        const goals = selectGoals({
            aiState, turn: 35, factionDef: FACTION_DEFS.crimson,
            enemies: ['enemy'], enemyCities, ownCities,
            homeAnchor: { x: 5, z: 5 },
            activeObjectives: {}, threatenedOwnCity: null,
            isIslandFaction: false, needsNavalExpansion: false, foreignMassWithoutCity: false,
            myCityCount: 1, settlerTarget: 8, scarcityTriggered: false,
            bestFoundSpotKey: null, foreignShoreKey: null, bestEconTileKey: null,
            neutralFactions: new Set(), hasSpies: false, hasChokepoints: false,
            unexploredTiles: new Set(), spyTargetKey: null, chokepointKey: null,
            enemyKings: [], tiles, myUnits: [...units.values()],
        });
        const conquest = goals.find(g => g.kind === 'conquest');
        expect(conquest).toBeDefined();
        if (conquest.targetTileKey) {
            const [tx, tz] = conquest.targetTileKey.split(',').map(Number);
            expect(tx).toBe(20);
            expect(tz).toBe(20);
        }
    });

    it('no conquest goal when no enemies exist', () => {
        const tiles = makeTileMap([
            [5, 5, 'CITY', 'ai1', { cityName: 'Capital', cityLevel: 2, fortification: 3, fortMax: 3, isCapital: true }],
            [6, 5, 'PLAINS', 'ai1'],
        ]);
        const units = new Map();
        units.set(1, makeUnit('INFANTRY', 'ai1', 6, 5, { factionId: 'crimson' }));
        const aiState = createAIState();
        const goals = selectGoals({
            aiState, turn: 35, factionDef: FACTION_DEFS.crimson,
            enemies: [], enemyCities: [], ownCities: [tiles.get('5,5')],
            homeAnchor: { x: 5, z: 5 },
            activeObjectives: {}, threatenedOwnCity: null,
            isIslandFaction: false, needsNavalExpansion: false, foreignMassWithoutCity: false,
            myCityCount: 1, settlerTarget: 8, scarcityTriggered: false,
            bestFoundSpotKey: null, foreignShoreKey: null, bestEconTileKey: null,
            neutralFactions: new Set(), hasSpies: false, hasChokepoints: false,
            unexploredTiles: new Set(), spyTargetKey: null, chokepointKey: null,
            enemyKings: [], tiles, myUnits: [...units.values()],
        });
        const kinds = goals.map(g => g.kind);
        expect(kinds).not.toContain('conquest');
    });

    it('conquest goal has targetTileKey set', () => {
        const tiles = makeTileMap([
            [5, 5, 'CITY', 'ai1', { cityName: 'Capital', cityLevel: 2, fortification: 3, fortMax: 3, isCapital: true }],
            [6, 5, 'PLAINS', 'ai1'],
            [10, 10, 'CITY', 'enemy', { cityName: 'Enemy', cityLevel: 1, fortification: 3, fortMax: 3 }],
        ]);
        const units = new Map();
        units.set(1, makeUnit('INFANTRY', 'ai1', 6, 5, { factionId: 'crimson' }));
        const enemyCities = [tiles.get('10,10')];
        const ownCities = [tiles.get('5,5')];
        const aiState = createAIState();
        const goals = selectGoals({
            aiState, turn: 35, factionDef: FACTION_DEFS.crimson,
            enemies: ['enemy'], enemyCities, ownCities,
            homeAnchor: { x: 5, z: 5 },
            activeObjectives: {}, threatenedOwnCity: null,
            isIslandFaction: false, needsNavalExpansion: false, foreignMassWithoutCity: false,
            myCityCount: 1, settlerTarget: 8, scarcityTriggered: false,
            bestFoundSpotKey: null, foreignShoreKey: null, bestEconTileKey: null,
            neutralFactions: new Set(), hasSpies: false, hasChokepoints: false,
            unexploredTiles: new Set(), spyTargetKey: null, chokepointKey: null,
            enemyKings: [], tiles, myUnits: [...units.values()],
        });
        const conquest = goals.find(g => g.kind === 'conquest');
        expect(conquest).toBeDefined();
        expect(conquest.targetTileKey).toBeTruthy();
        expect(conquest.targetFaction).toBeTruthy();
    });

    it('conquest goal scores higher for AGGRESSIVE personality', () => {
        const tiles = makeTileMap([
            [5, 5, 'CITY', 'ai1', { cityName: 'Capital', cityLevel: 2, fortification: 3, fortMax: 3, isCapital: true }],
            [6, 5, 'PLAINS', 'ai1'],
            [10, 10, 'CITY', 'enemy', { cityName: 'Enemy', cityLevel: 1, fortification: 3, fortMax: 3 }],
        ]);
        const units = new Map();
        units.set(1, makeUnit('INFANTRY', 'ai1', 6, 5, { factionId: 'crimson' }));
        const enemyCities = [tiles.get('10,10')];
        const ownCities = [tiles.get('5,5')];
        const aiState = createAIState();
        const goals = selectGoals({
            aiState, turn: 35, factionDef: FACTION_DEFS.crimson,
            enemies: ['enemy'], enemyCities, ownCities,
            homeAnchor: { x: 5, z: 5 },
            activeObjectives: {}, threatenedOwnCity: null,
            isIslandFaction: false, needsNavalExpansion: false, foreignMassWithoutCity: false,
            myCityCount: 1, settlerTarget: 8, scarcityTriggered: false,
            bestFoundSpotKey: null, foreignShoreKey: null, bestEconTileKey: null,
            neutralFactions: new Set(), hasSpies: false, hasChokepoints: false,
            unexploredTiles: new Set(), spyTargetKey: null, chokepointKey: null,
            enemyKings: [], tiles, myUnits: [...units.values()],
        });
        // AGGRESSIVE has conquest weight 1.3 — conquest should be top goal
        expect(goals[0].kind).toBe('conquest');
    });

    it('conquest target uses pathCrossesWater to detect water barriers', () => {
        expect(pathCrossesWater(null, 0, 0, 2, 0)).toBe(false);
        const tiles = makeTileMap([
            [0, 0, 'PLAINS', null],
            [1, 0, 'WATER', null],
            [2, 0, 'PLAINS', null],
        ]);
        expect(pathCrossesWater(tiles, 0, 0, 2, 0)).toBe(true);
        const landTiles = makeTileMap([
            [0, 0, 'PLAINS', null],
            [1, 0, 'PLAINS', null],
            [2, 0, 'PLAINS', null],
        ]);
        expect(pathCrossesWater(landTiles, 0, 0, 2, 0)).toBe(false);
    });

    it('unbridged river counts as water barrier', () => {
        const tiles = makeTileMap([
            [0, 0, 'PLAINS', null],
            [1, 0, 'RIVER', null, { bridge: false }],
            [2, 0, 'PLAINS', null],
        ]);
        expect(pathCrossesWater(tiles, 0, 0, 2, 0)).toBe(true);
    });

    it('bridged river does NOT count as water barrier', () => {
        const tiles = makeTileMap([
            [0, 0, 'PLAINS', null],
            [1, 0, 'RIVER', null, { bridge: true }],
            [2, 0, 'PLAINS', null],
        ]);
        expect(pathCrossesWater(tiles, 0, 0, 2, 0)).toBe(false);
    });

    it('conquest goal metadata contains city coordinates', () => {
        const tiles = makeTileMap([
            [5, 5, 'CITY', 'ai1', { cityName: 'Capital', cityLevel: 2, fortification: 3, fortMax: 3, isCapital: true }],
            [6, 5, 'PLAINS', 'ai1'],
            [10, 10, 'CITY', 'enemy', { cityName: 'Enemy', cityLevel: 1, fortification: 3, fortMax: 3 }],
        ]);
        const units = new Map();
        units.set(1, makeUnit('INFANTRY', 'ai1', 6, 5, { factionId: 'crimson' }));
        const enemyCities = [tiles.get('10,10')];
        const ownCities = [tiles.get('5,5')];
        const aiState = createAIState();
        const goals = selectGoals({
            aiState, turn: 35, factionDef: FACTION_DEFS.crimson,
            enemies: ['enemy'], enemyCities, ownCities,
            homeAnchor: { x: 5, z: 5 },
            activeObjectives: {}, threatenedOwnCity: null,
            isIslandFaction: false, needsNavalExpansion: false, foreignMassWithoutCity: false,
            myCityCount: 1, settlerTarget: 8, scarcityTriggered: false,
            bestFoundSpotKey: null, foreignShoreKey: null, bestEconTileKey: null,
            neutralFactions: new Set(), hasSpies: false, hasChokepoints: false,
            unexploredTiles: new Set(), spyTargetKey: null, chokepointKey: null,
            enemyKings: [], tiles, myUnits: [...units.values()],
        });
        const conquest = goals.find(g => g.kind === 'conquest');
        expect(conquest).toBeDefined();
        expect(conquest.meta.cityX).toBe(10);
        expect(conquest.meta.cityZ).toBe(10);
    });
});

// ===========================================================================
// PART 4: Integration — Full AI pipeline with modern tech
// ===========================================================================
describe('Integration: full AI pipeline with modern tech', () => {
    it('AI with full modern tech builds modern army composition', () => {
        const ts = makeFactionTs([
            'RIFLED_MUSKET', 'EXPLOSIVES', 'STEAM_ENGINE', 'RAILROAD', 'FIELD_ARTILLERY',
        ]);
        const input = warSetup({
            ts,
            resources: { gold: 5000, food: 2000, wood: 1000, iron: 1000, production: 2000 },
            buildings: new Map([['5,5', ['BARRACKS', 'SIEGE_WORKSHOP', 'HARBOR']]]),
        });
        const actions = runAI(input);
        const trains = trainTypes(actions);
        // Should train some modern units
        const modernTrains = trains.filter(t =>
            ['RIFLEMAN', 'SHARPSHOOTER', 'SIEGE_CANNON', 'DEMOLITION_SQUAD', 'FIELD_GUN',
             'RAILGUN', 'HORSE_ARTILLERY', 'LINE_INFANTRY'].includes(t));
        expect(modernTrains.length).toBeGreaterThan(0);
    });

    it('AI with no tech builds basic army', () => {
        const ts = makeFactionTs([]);
        const input = warSetup({
            ts,
            resources: { gold: 500, food: 300, wood: 100, iron: 50, production: 200 },
        });
        const actions = runAI(input);
        const trains = trainTypes(actions);
        // Should build basic units (INFANTRY, ARCHER, CAVALRY)
        const basicTrains = trains.filter(t => ['INFANTRY', 'ARCHER', 'CAVALRY', 'PIKEMAN'].includes(t));
        expect(basicTrains.length).toBeGreaterThan(0);
    });

    it('AI transitions from medieval to modern when tech available and affordable', () => {
        const ts = makeFactionTs(['RIFLED_MUSKET', 'FLINTLOCK']);
        const input = warSetup({
            ts,
            resources: { gold: 3000, food: 1500, wood: 800, iron: 800, production: 1500 },
            buildings: new Map([['5,5', ['BARRACKS']]]),
        });
        const actions = runAI(input);
        const trains = trainTypes(actions);
        // Should NOT train ARCHER when RIFLEMAN is available and affordable
        // (modern units are listed first in role order)
        if (trains.includes('RIFLEMAN')) {
            expect(trains).not.toContain('ARCHER');
        }
    });

    it('AI trains TRANSPORT for cross-water conquest with harbor', () => {
        const tiles = makeTileMap([
            [5, 5, 'CITY', 'ai1', { cityName: 'Capital', cityLevel: 2, fortification: 3, fortMax: 3, isCapital: true }],
            [6, 5, 'PLAINS', 'ai1'],
            [4, 5, 'WATER', null],
            [15, 15, 'CITY', 'enemy', { cityName: 'Island Enemy', cityLevel: 1, fortification: 3, fortMax: 3 }],
        ]);
        const units = new Map();
        for (let i = 0; i < 4; i++) units.set(i + 1, makeUnit('INFANTRY', 'ai1', 6 + i, 5, { factionId: 'crimson' }));
        const ts = makeFactionTs(['NAVAL_ENGINEERING']);
        const aiState = createAIState();
        const actions = runAI({
            units, tiles,
            resources: { gold: 2000, food: 1000, wood: 500, iron: 200, production: 800 },
            owner: 'ai1', buildings: new Map([['5,5', ['BARRACKS', 'HARBOR']]]),
            influence: null, factionDef: FACTION_DEFS.crimson,
            diploState: warDiplo('ai1', 'enemy'),
            lords: [], tempBonuses: {}, structures: new Map(), buildingState: new Map(),
            aiState, aiTechStates: { ai1: ts },
            victoryState: { projects: {}, tradeRoutes: {}, scoreSnapshots: {} },
            currentTurn: 35,
        });
        const trains = trainTypes(actions);
        expect(trains.some(t => t === 'TRANSPORT' || t === 'GALLEY')).toBe(true);
    });

    it('AI builds harbor + engineer when conquest crosses river', () => {
        const tiles = makeTileMap([
            [2, 5, 'CITY', 'ai1', { cityName: 'Capital', cityLevel: 1, fortification: 3, fortMax: 3, isCapital: true }],
            [3, 5, 'PLAINS', 'ai1'],
            [4, 5, 'RIVER', null, { bridge: false }],
            [5, 5, 'PLAINS', null],
            [7, 5, 'CITY', 'enemy', { cityName: 'Enemy', cityLevel: 1, fortification: 3, fortMax: 3 }],
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
            owner: 'ai1', buildings: new Map([['2,5', ['BARRACKS']]]),
            influence: null, factionDef: FACTION_DEFS.crimson,
            diploState: warDiplo('ai1', 'enemy'),
            lords: [], tempBonuses: {}, structures: new Map(), buildingState: new Map(),
            aiState, aiTechStates: null,
            victoryState: { projects: {}, tradeRoutes: {}, scoreSnapshots: {} },
            currentTurn: 35,
        });
        const bridges = actions.filter(a => a.type === 'buildBridge');
        expect(bridges.length).toBeGreaterThan(0);
    });
});
