import { describe, it, expect } from 'vitest';
import {
    createTechState, serializeTechState, deserializeTechState,
    addResearch, selectResearch, getResearchProgress, calculateResearchOutput,
    getUnlockedUnits, getUnlockedBuildings, getTechBonuses, getCurrentEra,
    TECHS, ERA_NAMES, canResearch, getAvailableTechs, getResearchCost,
    isUnitUnlocked, isBuildingUnlocked
} from '../src/tech.js';

describe('Tech Tree Module', () => {
    describe('createTechState', () => {
        it('creates tech state with ancient techs pre-researched', () => {
            const ts = createTechState();
            expect(ts.researched).toBeInstanceOf(Set);
            expect(ts.current).toBeNull();
            expect(ts.progress).toBe(0);
            // Ancient techs should be pre-researched
            expect(ts.researched.has('ARCHERY')).toBe(true);
            expect(ts.researched.has('BRONZE_WORKING')).toBe(true);
            expect(ts.researched.has('ANIMAL_HUSBANDRY')).toBe(true);
        });
    });

    describe('TECHS data', () => {
        it('has required fields for all techs', () => {
            for (const [id, tech] of Object.entries(TECHS)) {
                expect(tech.name).toBeTruthy();
                expect(tech.era).toBeTruthy();
                expect(typeof tech.cost).toBe('number');
                expect(tech.cost).toBeGreaterThan(0);
                expect(Array.isArray(tech.prerequisites)).toBe(true);
                expect(Array.isArray(tech.unlocks)).toBe(true);
            }
        });

        it('has 4 eras', () => {
            const eras = new Set(Object.values(TECHS).map(t => t.era));
            expect(eras.size).toBe(4);
            expect(eras.has('ancient')).toBe(true);
            expect(eras.has('classical')).toBe(true);
            expect(eras.has('medieval')).toBe(true);
            expect(eras.has('industrial')).toBe(true);
        });

        it('has no circular prerequisites', () => {
            const visited = new Set();
            function checkCircular(id) {
                if (visited.has(id)) return true;
                visited.add(id);
                const tech = TECHS[id];
                if (!tech || !tech.prerequisites) return false;
                for (const pre of tech.prerequisites) {
                    if (checkCircular(pre)) return true;
                }
                visited.delete(id);
                return false;
            }
            for (const id of Object.keys(TECHS)) {
                expect(checkCircular(id)).toBe(false);
            }
        });
    });

    describe('selectResearch', () => {
        it('selects a tech that can be researched', () => {
            const ts = createTechState();
            const result = selectResearch(ts, 'MATHEMATICS');
            expect(result).toBe(true);
            expect(ts.current).toBe('MATHEMATICS');
        });

        it('fails to select already researched tech', () => {
            const ts = createTechState();
            const result = selectResearch(ts, 'ARCHERY');
            expect(result).toBe(false);
        });

        it('fails to select tech with unmet prerequisites', () => {
            const ts = createTechState();
            const result = selectResearch(ts, 'GUNPOWDER');
            expect(result).toBe(false);
        });
    });

    describe('addResearch', () => {
        it('accumulates research points', () => {
            const ts = createTechState();
            selectResearch(ts, 'MATHEMATICS');
            const result = addResearch(ts, 10);
            expect(result).toEqual([]);
            expect(ts.progress).toBe(10);
        });

        it('completes tech when cost is met', () => {
            const ts = createTechState();
            selectResearch(ts, 'MATHEMATICS');
            const cost = TECHS.MATHEMATICS.cost;
            const result = addResearch(ts, cost);
            expect(result).toEqual(['MATHEMATICS']);
            expect(ts.researched.has('MATHEMATICS')).toBe(true);
            expect(ts.current).toBeNull();
            expect(ts.progress).toBe(0);
        });

        it('handles overflow research points', () => {
            const ts = createTechState();
            selectResearch(ts, 'MATHEMATICS');
            const cost = TECHS.MATHEMATICS.cost;
            const result = addResearch(ts, cost + 50);
            expect(result).toEqual(['MATHEMATICS']);
            // Overflow is discarded (progress resets to 0 after completion)
            expect(ts.progress).toBe(0);
        });

        it('returns empty if no current research', () => {
            const ts = createTechState();
            const result = addResearch(ts, 100);
            expect(result).toEqual([]);
        });
    });

    describe('getAvailableTechs', () => {
        it('returns techs with prerequisites met', () => {
            const ts = createTechState();
            const avail = getAvailableTechs(ts);
            expect(avail.length).toBeGreaterThan(0);
            expect(avail).toContain('MATHEMATICS');
            expect(avail).toContain('ENGINEERING');
            expect(avail).toContain('NAVAL_ENGINEERING');
        });

        it('excludes already researched techs', () => {
            const ts = createTechState();
            ts.researched.add('MATHEMATICS');
            const avail = getAvailableTechs(ts);
            expect(avail).not.toContain('MATHEMATICS');
        });

        it('includes techs after prerequisites are met', () => {
            const ts = createTechState();
            ts.researched.add('MATHEMATICS');
            const avail = getAvailableTechs(ts);
            expect(avail).toContain('SIEGE_CRAFT');
        });
    });

    describe('getCurrentEra', () => {
        it('starts in ancient era', () => {
            const ts = createTechState();
            expect(getCurrentEra(ts)).toBe('ancient');
        });

        it('advances era when techs are completed', () => {
            const ts = createTechState();
            ts.researched.add('MATHEMATICS');
            expect(getCurrentEra(ts)).toBe('classical');
        });
    });

    describe('getUnlockedUnits', () => {
        it('returns units from pre-researched techs', () => {
            const ts = createTechState();
            const units = getUnlockedUnits(ts);
            // Ancient techs unlock ARCHER, LONGBOWMAN, PIKEMAN, CAVALRY
            expect(units.has('ARCHER')).toBe(true);
            expect(units.has('PIKEMAN')).toBe(true);
            expect(units.has('CAVALRY')).toBe(true);
        });

        it('includes units from newly researched techs', () => {
            const ts = createTechState();
            ts.researched.add('MATHEMATICS');
            const units = getUnlockedUnits(ts);
            expect(units.has('CATAPULT')).toBe(true);
        });

        // Phase G: existing techs gained new unit unlocks.
        it('BRONZE_WORKING unlocks LEGIONNAIRE', () => {
            const ts = createTechState();
            expect(getUnlockedUnits(ts).has('LEGIONNAIRE')).toBe(true);
        });

        it('CHIVALRY unlocks BERSERKER + WINGED_HUSSAR', () => {
            const ts = createTechState();
            ts.researched.add('MATHEMATICS'); // prereq
            ts.researched.add('ANIMAL_HUSBANDRY'); // prereq (ancient, already there)
            ts.researched.add('CHIVALRY');
            const units = getUnlockedUnits(ts);
            expect(units.has('BERSERKER')).toBe(true);
            expect(units.has('WINGED_HUSSAR')).toBe(true);
        });

        it('FORTIFICATION unlocks CROSSBOWMAN + VARANGIAN_GUARD', () => {
            const ts = createTechState();
            ts.researched.add('ENGINEERING'); // prereq
            ts.researched.add('FORTIFICATION');
            const units = getUnlockedUnits(ts);
            expect(units.has('CROSSBOWMAN')).toBe(true);
            expect(units.has('VARANGIAN_GUARD')).toBe(true);
        });

        it('GUNPOWDER unlocks CONQUISTADOR', () => {
            const ts = createTechState();
            ts.researched.add('SIEGE_CRAFT');
            ts.researched.add('CHIVALRY');
            ts.researched.add('GUNPOWDER');
            const units = getUnlockedUnits(ts);
            expect(units.has('CONQUISTADOR')).toBe(true);
        });
    });

    describe('getUnlockedBuildings', () => {
        it('returns buildings from pre-researched techs', () => {
            const ts = createTechState();
            const buildings = getUnlockedBuildings(ts);
            // Ancient techs don't unlock buildings
            expect(buildings.size).toBe(0);
        });

        it('includes buildings from newly researched techs', () => {
            const ts = createTechState();
            ts.researched.add('MATHEMATICS');
            const buildings = getUnlockedBuildings(ts);
            expect(buildings.has('MARKET')).toBe(true);
        });
    });

    describe('getTechBonuses', () => {
        it('returns default bonuses with no extra techs', () => {
            const ts = createTechState();
            const bonuses = getTechBonuses(ts);
            expect(bonuses).toBeTruthy();
            expect(typeof bonuses.engineerBuildSpeed).toBe('number');
        });

        it('accumulates bonuses from completed techs', () => {
            const ts = createTechState();
            ts.researched.add('ENGINEERING');
            const bonuses = getTechBonuses(ts);
            expect(bonuses.canBuildBridge).toBe(true);
            expect(bonuses.engineerBuildSpeed).toBe(1.5);
        });
    });

    describe('calculateResearchOutput', () => {
        it('returns 0 with no cities', () => {
            const tiles = new Map();
            const output = calculateResearchOutput(tiles, 'player');
            expect(output).toBe(0);
        });

        it('returns positive output with a city', () => {
            const tiles = new Map();
            tiles.set('5,5', { x: 5, z: 5, terrain: 'CITY', owner: 'player', cityLevel: 1 });
            const output = calculateResearchOutput(tiles, 'player');
            expect(output).toBeGreaterThan(0);
        });
    });

    describe('getResearchCost', () => {
        it('returns cost for valid tech', () => {
            expect(getResearchCost('MATHEMATICS')).toBe(80);
        });

        it('returns Infinity for invalid tech', () => {
            expect(getResearchCost('INVALID')).toBe(Infinity);
        });
    });

    describe('isUnitUnlocked / isBuildingUnlocked', () => {
        it('checks unit unlock status', () => {
            const ts = createTechState();
            expect(isUnitUnlocked('ARCHER', ts)).toBe(true);
            expect(isUnitUnlocked('CATAPULT', ts)).toBe(false);
        });

        it('checks building unlock status', () => {
            const ts = createTechState();
            expect(isBuildingUnlocked('MARKET', ts)).toBe(false);
            ts.researched.add('MATHEMATICS');
            expect(isBuildingUnlocked('MARKET', ts)).toBe(true);
        });
    });

    describe('serialization', () => {
        it('serializes and deserializes correctly', () => {
            const ts = createTechState();
            selectResearch(ts, 'MATHEMATICS');
            addResearch(ts, 15);

            const serialized = serializeTechState(ts);
            expect(serialized.researched).toBeInstanceOf(Array);
            expect(serialized.current).toBe('MATHEMATICS');
            expect(serialized.progress).toBe(15);

            const deserialized = deserializeTechState(serialized);
            expect(deserialized.researched.has('ARCHERY')).toBe(true);
            expect(deserialized.current).toBe('MATHEMATICS');
            expect(deserialized.progress).toBe(15);
        });

        it('handles null input gracefully', () => {
            const ts = deserializeTechState(null);
            expect(ts.researched).toBeInstanceOf(Set);
            expect(ts.current).toBeNull();
        });
    });
});
