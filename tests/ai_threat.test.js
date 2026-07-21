import { describe, it, expect } from 'vitest';
import { assessThreats, shouldGoDefensive, computeDefensePlan } from '../src/ai_threat.js';

function makeUnit(owner, type, x, z) {
    return { id: `${owner}-${type}-${x}-${z}`, owner, type, x, z, hp: 10, maxHp: 10 };
}
function makeTile(x, z, terrain = 'PLAINS', owner = null) {
    return { x, z, terrain, owner, elevation: 1 };
}

describe('assessThreats', () => {
    it('returns empty threats when no enemies', () => {
        const result = assessThreats({
            owner: 'golden', units: new Map(), tiles: new Map(),
            diploState: { relations: {} }, ownCities: [], enemyUnits: [], turn: 10
        });
        expect(result.threats).toHaveLength(0);
        expect(result.overallThreat).toBe(0);
    });

    it('scores an at-war enemy higher than neutral', () => {
        const u1 = makeUnit('crimson', 'SWORDSMAN', 5, 5);
        const city = makeTile(10, 10, 'CITY', 'golden');
        const diplo = {
            relations: {
                'crimson:golden': { state: 'war' },
            }
        };
        const result = assessThreats({
            owner: 'golden', units: new Map([['u1', u1]]), tiles: new Map([['10,10', city]]),
            diploState: diplo, ownCities: [city], enemyUnits: [u1], turn: 10
        });
        expect(result.threats).toHaveLength(1);
        expect(result.threats[0].score).toBeGreaterThan(0);
        expect(result.threats[0].urgency).toMatch(/critical|high|medium/);
    });

    it('ignores allies', () => {
        const u1 = makeUnit('azure', 'SWORDSMAN', 5, 5);
        const diplo = {
            relations: {
                'azure:golden': { state: 'alliance' },
            }
        };
        const result = assessThreats({
            owner: 'golden', units: new Map([['u1', u1]]), tiles: new Map(),
            diploState: diplo, ownCities: [], enemyUnits: [u1], turn: 10
        });
        expect(result.threats).toHaveLength(0);
    });

    it('sorts threats by score descending', () => {
        const u1 = makeUnit('crimson', 'SWORDSMAN', 5, 5);
        const u2 = makeUnit('azure', 'ARCHER', 12, 12);
        const city = makeTile(10, 10, 'CITY', 'golden');
        const diplo = {
            relations: {
                'crimson:golden': { state: 'war' },
                'azure:golden': { state: 'neutral' },
            }
        };
        const result = assessThreats({
            owner: 'golden', units: new Map([['u1', u1], ['u2', u2]]),
            tiles: new Map([['10,10', city]]),
            diploState: diplo, ownCities: [city], enemyUnits: [u1, u2], turn: 10
        });
        expect(result.threats[0].score).toBeGreaterThanOrEqual(result.threats[1].score);
    });
});

describe('shouldGoDefensive', () => {
    it('goes defensive on critical threats', () => {
        const assessment = {
            overallThreat: 50,
            threats: [{ faction: 'crimson', score: 100, urgency: 'critical', tiles: [] }]
        };
        const result = shouldGoDefensive(assessment, 10, 1.0, 'BALANCED');
        expect(result.defensive).toBe(true);
        expect(result.reason).toBe('critical_threat_near_cities');
    });

    it('stays offensive when safe', () => {
        const assessment = { overallThreat: 10, threats: [] };
        const result = shouldGoDefensive(assessment, 10, 1.0, 'BALANCED');
        expect(result.defensive).toBe(false);
    });

    it('aggressive personality has higher threshold', () => {
        const assessment = { overallThreat: 180, threats: [{ urgency: 'medium', score: 50, tiles: [] }] };
        const result = shouldGoDefensive(assessment, 10, 1.0, 'AGGRESSIVE');
        expect(result.defensive).toBe(false);
    });

    it('weak army under threat triggers defensive', () => {
        const assessment = {
            overallThreat: 50,
            threats: [{ faction: 'crimson', score: 50, urgency: 'high', tiles: [] }]
        };
        const result = shouldGoDefensive(assessment, 10, 0.3, 'BALANCED');
        expect(result.defensive).toBe(true);
        expect(result.reason).toBe('weak_army_under_threat');
    });
});

describe('computeDefensePlan', () => {
    it('identifies threatened cities', () => {
        const threat = { faction: 'crimson', score: 80, urgency: 'critical', tiles: [makeUnit('crimson', 'SWORDSMAN', 8, 8)] };
        const city = makeTile(10, 10, 'CITY', 'golden');
        const result = computeDefensePlan({ threats: [threat] }, [city], [], new Map());
        expect(result.garrisonNeeds).toHaveLength(1);
        expect(result.garrisonNeeds[0].cityKey).toBe('10,10');
    });

    it('returns empty needs when no threats', () => {
        const city = makeTile(10, 10, 'CITY', 'golden');
        const result = computeDefensePlan({ threats: [] }, [city], [], new Map());
        expect(result.garrisonNeeds).toHaveLength(0);
    });
});
