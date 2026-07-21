import { describe, it, expect } from 'vitest';
import { evaluateCityEconomy, computeTradeRouteValue, evaluateMarketSales, suggestCitySpecialization } from '../src/ai_economy.js';

describe('evaluateCityEconomy', () => {
    it('suggests market when missing', () => {
        const city = { x: 5, z: 5, cityLevel: 2 };
        const buildings = new Map([['5,5', []]]);
        const resources = { gold: 10, food: 30, wood: 30, iron: 10 };
        const result = evaluateCityEconomy(city, buildings, resources, []);
        expect(result.suggestions.some(s => s.buildingType === 'MARKET')).toBe(true);
        expect(result.score).toBeLessThan(50);
    });

    it('does not suggest market when present', () => {
        const city = { x: 5, z: 5, cityLevel: 2 };
        const buildings = new Map([['5,5', ['MARKET']]]);
        const resources = { gold: 10, food: 30, wood: 30, iron: 10 };
        const result = evaluateCityEconomy(city, buildings, resources, []);
        expect(result.suggestions.some(s => s.buildingType === 'MARKET')).toBe(false);
    });

    it('suggests granary for level 2+ cities', () => {
        const city = { x: 5, z: 5, cityLevel: 3 };
        const buildings = new Map([['5,5', ['MARKET']]]);
        const result = evaluateCityEconomy(city, buildings, {}, []);
        expect(result.suggestions.some(s => s.buildingType === 'GRANARY')).toBe(true);
    });

    it('returns score between 0 and 100', () => {
        const city = { x: 5, z: 5, cityLevel: 1 };
        const buildings = new Map([['5,5', []]]);
        const result = evaluateCityEconomy(city, buildings, {}, []);
        expect(result.score).toBeGreaterThanOrEqual(0);
        expect(result.score).toBeLessThanOrEqual(100);
    });
});

describe('computeTradeRouteValue', () => {
    it('returns viable route for short distance', () => {
        const result = computeTradeRouteValue({ x: 0, z: 0 }, { x: 3, z: 0 }, 'iron', 3);
        expect(result.viable).toBe(true);
        expect(result.profit).toBeGreaterThan(0);
    });

    it('returns non-viable for long distance', () => {
        const result = computeTradeRouteValue({ x: 0, z: 0 }, { x: 20, z: 0 }, 'food', 20);
        expect(result.viable).toBe(false);
    });

    it('iron is more valuable than food', () => {
        const iron = computeTradeRouteValue({ x: 0, z: 0 }, { x: 5, z: 0 }, 'iron', 5);
        const food = computeTradeRouteValue({ x: 0, z: 0 }, { x: 5, z: 0 }, 'food', 5);
        expect(iron.profit).toBeGreaterThanOrEqual(food.profit);
    });
});

describe('evaluateMarketSales', () => {
    it('suggests sales when gold is low and resources high', () => {
        const result = evaluateMarketSales({ gold: 10, wood: 80, iron: 60, food: 40 });
        expect(result.shouldSell).toBe(true);
        expect(result.sales.length).toBeGreaterThan(0);
    });

    it('no sales when gold is sufficient', () => {
        const result = evaluateMarketSales({ gold: 50, wood: 80, iron: 60, food: 40 });
        expect(result.shouldSell).toBe(false);
    });

    it('no sales when resources are low', () => {
        const result = evaluateMarketSales({ gold: 10, wood: 30, iron: 20, food: 10 });
        expect(result.shouldSell).toBe(false);
    });
});

describe('suggestCitySpecialization', () => {
    it('suggests production for forest-heavy terrain', () => {
        const city = { x: 5, z: 5 };
        const tiles = [
            { x: 4, z: 5, terrain: 'FOREST' },
            { x: 5, z: 4, terrain: 'FOREST' },
            { x: 6, z: 5, terrain: 'FOREST' },
            { x: 5, z: 6, terrain: 'PLAINS' },
        ];
        const result = suggestCitySpecialization(city, tiles, new Map());
        expect(result.specialization).toBe('production');
    });

    it('suggests trade for coastal cities', () => {
        const city = { x: 5, z: 5 };
        const tiles = [
            { x: 4, z: 5, terrain: 'PLAINS' },
            { x: 5, z: 4, terrain: 'PLAINS' },
            { x: 6, z: 5, terrain: 'WATER' },
            { x: 5, z: 6, terrain: 'PLAINS' },
        ];
        const result = suggestCitySpecialization(city, tiles, new Map());
        expect(result.specialization).toBe('trade');
    });

    it('returns balanced for mixed terrain', () => {
        const city = { x: 5, z: 5 };
        const tiles = [
            { x: 4, z: 5, terrain: 'PLAINS' },
            { x: 5, z: 4, terrain: 'HILLS' },
            { x: 6, z: 5, terrain: 'FOREST' },
            { x: 5, z: 6, terrain: 'PLAINS' },
        ];
        const result = suggestCitySpecialization(city, tiles, new Map());
        expect(result.specialization).toBe('balanced');
    });
});
