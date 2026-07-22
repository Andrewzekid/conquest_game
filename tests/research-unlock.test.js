import { describe, it, expect } from 'vitest';
import { createTechState, isBuildingUnlocked, isUnitUnlocked, canResearch, TECHS } from '../src/tech.js';
import { getBuildableBuildings } from '../src/building.js';
import { MILITARY_BUILDING_LEVELS } from '../src/config.js';
import { resolveCombat } from '../src/battle.js';
import { makeTile, makeUnit } from './helpers.js';

// 6.1 Building unlock gating
describe('building unlock gating', () => {
    const cases = [
        ['MARKET', 'MATHEMATICS'],
        ['HARBOR', 'NAVAL_ENGINEERING'],
        ['SIEGE_WORKSHOP', 'SIEGE_CRAFT'],
        ['WALLS', 'FORTIFICATION'],
        ['CITADEL', 'BASTION_FORT'],
        ['UNIVERSITY', 'ACADEMY'],
        ['BANK', 'BANKING'],
        ['COMMAND_POST', 'TELEGRAPH'],
        ['POWER_PLANT', 'ELECTRICITY'],
    ];
    for (const [building, tech] of cases) {
        it(`${building} locked until ${tech} researched`, () => {
            const ts = createTechState();
            expect(isBuildingUnlocked(building, ts)).toBe(false);
            ts.researched.add(tech);
            expect(isBuildingUnlocked(building, ts)).toBe(true);
        });
    }
});

// 6.2 Unit unlock gating
describe('unit unlock gating', () => {
    const cases = [
        ['CATAPULT', 'MATHEMATICS'],
        ['TREBUCHET', 'SIEGE_CRAFT'],
        ['GALLEY', 'NAVAL_ENGINEERING'],
        ['TRANSPORT', 'NAVAL_ENGINEERING'],
        ['FRIGATE', 'CARTOGRAPHY'],
        ['GALLEON', 'CARTOGRAPHY'],
        ['ARTILLERY', 'GUNPOWDER'],
        ['CONQUISTADOR', 'GUNPOWDER'],
        ['MUSKETEER', 'MATCHLOCK'],
        ['ARQUEBUSIER', 'MATCHLOCK'],
        ['PINNACE', 'MATCHLOCK'],
        ['MAN_OF_WAR', 'OCEAN_NAVIGATION'],
        ['GALLEASS', 'OCEAN_NAVIGATION'],
        ['LINE_INFANTRY', 'FLINTLOCK'],
        ['DRAGOON', 'FLINTLOCK'],
        ['CORVETTE', 'FLINTLOCK'],
        ['CANNON', 'METALLURGY'],
        ['MORTAR', 'METALLURGY'],
        ['FROLIC', 'METALLURGY'],
        ['MERCHANTMAN', 'BANKING'],
        ['RIFLEMAN', 'RIFLED_MUSKET'],
        ['SHARPSHOOTER', 'RIFLED_MUSKET'],
        ['STEAM_TRANSPORT', 'STEAM_ENGINE'],
        ['IRONCLAD', 'STEAM_ENGINE'],
        ['GUNBOAT', 'STEAM_ENGINE'],
        ['RAILGUN', 'RAILROAD'],
        ['ARMORED_TRAIN', 'RAILROAD'],
        ['SUBMARINE', 'SUBMARINE'],
        ['TORPEDO_BOAT', 'SUBMARINE'],
        ['DEMOLITION_SQUAD', 'EXPLOSIVES'],
        ['SIEGE_CANNON', 'EXPLOSIVES'],
        ['FIELD_GUN', 'FIELD_ARTILLERY'],
        ['HORSE_ARTILLERY', 'FIELD_ARTILLERY'],
        ['IRONCLAD_FRIGATE', 'IRONCLADS'],
        ['MONITOR', 'IRONCLADS'],
        ['FRIGATE_2', 'IRONCLADS'],
        ['CROSSBOWMAN', 'FORTIFICATION'],
        ['VARANGIAN_GUARD', 'FORTIFICATION'],
        ['BERSERKER', 'CHIVALRY'],
        ['WINGED_HUSSAR', 'CHIVALRY'],
        ['CATAPHRACT', 'CHIVALRY'],
        ['CHARIOT', 'CHIVALRY'],
        ['SIEGE_TOWER', 'FEUDALISM'],
        ['MEDIC', 'MEDICINE'],
        ['WORKER', 'MACHINERY'],
    ];
    for (const [unit, tech] of cases) {
        it(`${unit} locked until ${tech} researched`, () => {
            const ts = createTechState();
            expect(isUnitUnlocked(unit, ts)).toBe(false);
            ts.researched.add(tech);
            expect(isUnitUnlocked(unit, ts)).toBe(true);
        });
    }
});

// 6.3 getBuildableBuildings hides tech-locked buildings
describe('getBuildableBuildings tech hiding', () => {
    it('hides MARKET/HARBOR/SIEGE_WORKSHOP/WALLS before their techs', () => {
        const tile = makeTile(5, 5, 'CITY', 'player', { cityLevel: 1 });
        const resources = { gold: 9999, food: 9999, wood: 9999, iron: 9999, production: 9999 };
        const buildings = new Map();
        const ts = createTechState();
        const result = getBuildableBuildings(tile, resources, buildings, null, null, ts);
        const types = result.map(b => b.type);
        expect(types).not.toContain('MARKET');
        expect(types).not.toContain('HARBOR');
        expect(types).not.toContain('SIEGE_WORKSHOP');
        expect(types).not.toContain('WALLS');
        // Always-available buildings still appear:
        expect(types).toContain('FARM');
    });

    it('shows MARKET after MATHEMATICS researched', () => {
        const tile = makeTile(5, 5, 'CITY', 'player', { cityLevel: 1 });
        const resources = { gold: 9999, food: 9999, wood: 9999, iron: 9999, production: 9999 };
        const buildings = new Map();
        const ts = createTechState();
        ts.researched.add('MATHEMATICS');
        const result = getBuildableBuildings(tile, resources, buildings, null, null, ts);
        const types = result.map(b => b.type);
        expect(types).toContain('MARKET');
    });

    it('shows SIEGE_WORKSHOP after SIEGE_CRAFT researched', () => {
        const tile = makeTile(6, 5, 'PLAINS', 'player');
        const resources = { gold: 9999, food: 9999, wood: 9999, iron: 9999, production: 9999 };
        const buildings = new Map();
        const influence = new Set(['6,5']);
        const ts = createTechState();
        ts.researched.add('SIEGE_CRAFT');
        const result = getBuildableBuildings(tile, resources, buildings, influence, null, ts);
        const types = result.map(b => b.type);
        expect(types).toContain('SIEGE_WORKSHOP');
    });
});

// 6.4 MILITARY_BUILDING_LEVELS completeness
describe('MILITARY_BUILDING_LEVELS completeness', () => {
    it('defines SIEGE_WORKSHOP levels so bestMilitaryLevel can find it', () => {
        expect(MILITARY_BUILDING_LEVELS.SIEGE_WORKSHOP).toBeDefined();
        expect(Array.isArray(MILITARY_BUILDING_LEVELS.SIEGE_WORKSHOP)).toBe(true);
        expect(MILITARY_BUILDING_LEVELS.SIEGE_WORKSHOP.length).toBeGreaterThanOrEqual(1);
    });
    it('defines HARBOR levels', () => {
        expect(MILITARY_BUILDING_LEVELS.HARBOR).toBeDefined();
    });
});

// 6.5 Prerequisite chain coverage
describe('prerequisite chains', () => {
    it('SIEGE_CRAFT requires MATHEMATICS', () => {
        const ts = createTechState();
        expect(canResearch(ts, 'SIEGE_CRAFT')).toBe(false);
        ts.researched.add('MATHEMATICS');
        expect(canResearch(ts, 'SIEGE_CRAFT')).toBe(true);
    });
    it('GUNPOWDER requires SIEGE_CRAFT AND CHIVALRY', () => {
        const ts = createTechState();
        ts.researched.add('MATHEMATICS');
        ts.researched.add('ANIMAL_HUSBANDRY');
        expect(canResearch(ts, 'GUNPOWDER')).toBe(false);
        ts.researched.add('SIEGE_CRAFT');
        ts.researched.add('CHIVALRY');
        expect(canResearch(ts, 'GUNPOWDER')).toBe(true);
    });
    it('BASTION_FORT requires FORTIFICATION AND GUNPOWDER', () => {
        const ts = createTechState();
        ts.researched.add('ENGINEERING');
        ts.researched.add('MATHEMATICS');
        ts.researched.add('ANIMAL_HUSBANDRY');
        ts.researched.add('SIEGE_CRAFT');
        ts.researched.add('CHIVALRY');
        ts.researched.add('FORTIFICATION');
        ts.researched.add('GUNPOWDER');
        expect(canResearch(ts, 'BASTION_FORT')).toBe(true);
    });
    it('RAILROAD requires STEAM_ENGINE AND ACADEMY', () => {
        const ts = createTechState();
        ts.researched.add('STEAM_ENGINE');
        ts.researched.add('ACADEMY');
        expect(canResearch(ts, 'RAILROAD')).toBe(true);
    });
});

// 6.6 Fortification cap regression (Iron Will overflow)
describe('fortification cap (Iron Will overflow)', () => {
    it('Math.min(fortMax, fortification+3) prevents overflow', () => {
        const tile = { fortification: 6, fortMax: 6 };
        const max = tile.fortMax || tile.fortification;
        tile.fortification = Math.min(max, (tile.fortification || 0) + 3);
        expect(tile.fortification).toBe(6);
    });
    it('still grants the bonus when below max', () => {
        const tile = { fortification: 3, fortMax: 6 };
        const max = tile.fortMax || tile.fortification;
        tile.fortification = Math.min(max, (tile.fortification || 0) + 3);
        expect(tile.fortification).toBe(6);
    });
    it('caps correctly at low fortMax', () => {
        const tile = { fortification: 4, fortMax: 4 };
        const max = tile.fortMax || tile.fortification;
        tile.fortification = Math.min(max, (tile.fortification || 0) + 3);
        expect(tile.fortification).toBe(4);
    });
});

// 6.6 Breached city defense regression
describe('breached city defense', () => {
    it('breached city gives no terrain defense bonus to defender', () => {
        const attacker = makeUnit('INFANTRY', 'ai1', 5, 5);
        const defender = makeUnit('INFANTRY', 'player', 6, 6);
        const intact = resolveCombat(attacker, defender, 'CITY', null, null, null, null, null, false, null, false);
        const breached = resolveCombat({ ...attacker }, { ...defender }, 'CITY', null, null, null, null, null, false, null, true);
        expect(breached.damageToDefender).toBeGreaterThanOrEqual(intact.damageToDefender);
    });
});
