import { describe, it, expect } from 'vitest';
import {
  collectResources, grossYields, upkeepTotals, processUpkeep, sellAtMarket,
  getTradeRouteIncome, processCityGrowth, countCities, countTiles,
  getUnitCap, unitCapForCity
} from '../src/economy.js';
import { setGridDimensions } from '../src/config.js';

function makeTile(x, z, terrain, owner) {
  return { x, z, terrain, owner, cityLevel: 1, fortification: 3, fortMax: 3 };
}

describe('economy', () => {
  describe('unitCapForCity', () => {
    it('level 1 returns 5', () => {
      expect(unitCapForCity(1)).toBe(5);
    });

    it('level 2 returns 7', () => {
      expect(unitCapForCity(2)).toBe(7);
    });

    it('defaults level to 1', () => {
      expect(unitCapForCity(null)).toBe(5);
      expect(unitCapForCity(undefined)).toBe(5);
    });
  });

  describe('countCities', () => {
    it('counts CITY tiles for owner', () => {
      const tiles = new Map([
        ['0,0', makeTile(0, 0, 'CITY', 'player')],
        ['1,1', makeTile(1, 1, 'PLAINS', 'player')],
        ['2,2', makeTile(2, 2, 'CITY', 'ai1')],
      ]);
      expect(countCities(tiles, 'player')).toBe(1);
    });
  });

  describe('countTiles', () => {
    it('counts all owned tiles', () => {
      const tiles = new Map([
        ['0,0', makeTile(0, 0, 'CITY', 'player')],
        ['1,1', makeTile(1, 1, 'PLAINS', 'player')],
        ['2,2', makeTile(2, 2, 'CITY', 'ai1')],
      ]);
      expect(countTiles(tiles, 'player')).toBe(2);
    });
  });

  describe('getUnitCap', () => {
    it('sums per-city caps', () => {
      const tiles = new Map([
        ['0,0', { ...makeTile(0, 0, 'CITY', 'player'), cityLevel: 1 }],
        ['5,5', { ...makeTile(5, 5, 'CITY', 'player'), cityLevel: 2 }],
      ]);
      expect(getUnitCap(tiles, 'player')).toBe(12); // 5 + 7
    });
  });

  describe('upkeepTotals', () => {
    it('sums correct upkeep', () => {
      const units = new Map([
        ['1', { owner: 'player', upkeep: { food: 3, gold: 2 } }],
        ['2', { owner: 'player', upkeep: { food: 2, gold: 3 } }],
        ['3', { owner: 'ai1', upkeep: { food: 5, gold: 5 } }],
      ]);
      const totals = upkeepTotals(units, 'player');
      expect(totals.food).toBe(5);
      expect(totals.gold).toBe(5);
    });
  });

  describe('processUpkeep', () => {
    it('deducts resources', () => {
      const units = new Map([
        ['1', { owner: 'player', upkeep: { food: 3, gold: 2 }, hp: 10, type: 'INFANTRY' }],
      ]);
      const resources = { food: 100, gold: 100, wood: 0, iron: 0 };
      processUpkeep(units, 'player', resources);
      expect(resources.food).toBe(97);
      expect(resources.gold).toBe(98);
    });

    it('starvation when food < 0', () => {
      const unit = { owner: 'player', upkeep: { food: 10, gold: 0 }, hp: 10, type: 'INFANTRY' };
      const units = new Map([['1', unit]]);
      const resources = { food: 5, gold: 100, wood: 0, iron: 0 };
      const result = processUpkeep(units, 'player', resources);
      expect(result.starved).toBe(true);
      expect(unit.hp).toBeLessThan(10);
    });

    it('non-food resources floor at 0', () => {
      const units = new Map([
        ['1', { owner: 'player', upkeep: { food: 0, gold: 50 }, hp: 10, type: 'INFANTRY' }],
      ]);
      const resources = { food: 100, gold: 10, wood: 0, iron: 0 };
      processUpkeep(units, 'player', resources);
      expect(resources.gold).toBe(0);
    });
  });

  describe('sellAtMarket', () => {
    it('converts resources to gold', () => {
      const resources = { gold: 0, wood: 10, iron: 5, food: 10 };
      sellAtMarket(resources, { wood: 4, iron: 2 });
      expect(resources.gold).toBe(4); // 4*0.5 + 2*1.0 = 4
      expect(resources.wood).toBe(6);
    });

    it('error for insufficient resource', () => {
      const resources = { gold: 0, wood: 1 };
      const msgs = sellAtMarket(resources, { wood: 10 });
      expect(msgs.some(m => m.includes('Not enough'))).toBe(true);
    });
  });

  describe('getTradeRouteIncome', () => {
    it('sums valid routes', () => {
      const tiles = new Map([
        ['0,0', makeTile(0, 0, 'CITY', 'player')],
        ['5,5', makeTile(5, 5, 'CITY', 'player')],
      ]);
      const routes = [{ owner: 'player', from: '0,0', to: '5,5' }];
      expect(getTradeRouteIncome(tiles, 'player', routes)).toBe(10);
    });

    it('skips invalid routes', () => {
      const tiles = new Map([
        ['0,0', makeTile(0, 0, 'CITY', 'player')],
      ]);
      const routes = [{ owner: 'player', from: '0,0', to: '99,99' }];
      expect(getTradeRouteIncome(tiles, 'player', routes)).toBe(0);
    });
  });

  describe('grossYields', () => {
    it('returns breakdown object', () => {
      setGridDimensions(20, 20);
      const tiles = new Map();
      tiles.set('5,5', { ...makeTile(5, 5, 'CITY', 'player'), cityLevel: 1 });
      // Add some surrounding owned plains
      for (let dx = -2; dx <= 2; dx++) {
        for (let dz = -2; dz <= 2; dz++) {
          if (dx === 0 && dz === 0) continue;
          tiles.set(`${5 + dx},${5 + dz}`, makeTile(5 + dx, 5 + dz, 'PLAINS', 'player'));
        }
      }
      const y = grossYields(tiles, 'player', new Map());
      expect(y.gold).toBeDefined();
      expect(y.food).toBeDefined();
      expect(y.wood).toBeDefined();
      expect(y.production).toBeDefined();
    });
  });

  describe('processCityGrowth', () => {
    it('accumulates growth', () => {
      setGridDimensions(20, 20);
      const tiles = new Map();
      tiles.set('5,5', { ...makeTile(5, 5, 'CITY', 'player'), growth: 0, cityLevel: 1 });
      processCityGrowth(tiles, 'player', { food: 50 });
      const city = tiles.get('5,5');
      expect(city.growth).toBeGreaterThan(0);
    });
  });
});
