import { describe, it, expect } from 'vitest';
import {
  constructBuilding, getBuildableBuildings, getBuildingDefenseBonus,
  upgradeBuilding, damageBuilding, removeBuilding, isCoastal,
  isInfluenceBuildableTile, defaultBuildingState, pillageableOn
} from '../src/building.js';

function makeTile(x, z, terrain, owner = 'player') {
  return { x, z, terrain, owner };
}

describe('building', () => {
  describe('isInfluenceBuildableTile', () => {
    it('returns true for BARRACKS on passable land', () => {
      expect(isInfluenceBuildableTile('BARRACKS', makeTile(0, 0, 'PLAINS'))).toBe(true);
    });

    it('returns false for WATER tile', () => {
      expect(isInfluenceBuildableTile('BARRACKS', makeTile(0, 0, 'WATER'))).toBe(false);
    });

    it('returns false for non-influenceBuildable building', () => {
      expect(isInfluenceBuildableTile('FARM', makeTile(0, 0, 'PLAINS'))).toBe(false);
    });

    it('returns false for null tile', () => {
      expect(isInfluenceBuildableTile('BARRACKS', null)).toBe(false);
    });
  });

  describe('defaultBuildingState', () => {
    it('returns level 1, full HP', () => {
      const state = defaultBuildingState('BARRACKS');
      expect(state.level).toBe(1);
      expect(state.hp).toBe(20);
      expect(state.maxHp).toBe(20);
    });
  });

  describe('isCoastal', () => {
    it('returns true when neighbor is WATER', () => {
      const tiles = new Map([
        ['1,1', makeTile(1, 1, 'PLAINS')],
        ['2,1', makeTile(2, 1, 'WATER')],
      ]);
      expect(isCoastal(makeTile(1, 1, 'PLAINS'), tiles)).toBe(true);
    });

    it('returns true when neighbor is RIVER', () => {
      const tiles = new Map([
        ['1,1', makeTile(1, 1, 'PLAINS')],
        ['1,2', makeTile(1, 2, 'RIVER')],
      ]);
      expect(isCoastal(makeTile(1, 1, 'PLAINS'), tiles)).toBe(true);
    });

    it('returns false with no water neighbors', () => {
      const tiles = new Map([
        ['1,1', makeTile(1, 1, 'PLAINS')],
        ['2,1', makeTile(2, 1, 'PLAINS')],
        ['0,1', makeTile(0, 1, 'PLAINS')],
        ['1,0', makeTile(1, 0, 'PLAINS')],
        ['1,2', makeTile(1, 2, 'PLAINS')],
      ]);
      expect(isCoastal(makeTile(1, 1, 'PLAINS'), tiles)).toBe(false);
    });

    it('null-safe', () => {
      expect(isCoastal(null, new Map())).toBe(false);
    });
  });

  describe('constructBuilding', () => {
    it('deducts resources and registers building', () => {
      const tile = makeTile(5, 5, 'CITY');
      const resources = { gold: 200, wood: 200, iron: 200, food: 100, production: 100 };
      const buildings = new Map();
      const msgs = constructBuilding('MARKET', tile, resources, buildings);
      expect(msgs.some(m => m.includes('Built'))).toBe(true);
      expect(resources.gold).toBeLessThan(200);
      expect(buildings.get('5,5')).toContain('MARKET');
    });

    it('rejects unknown building', () => {
      const msgs = constructBuilding('UNKNOWN', makeTile(0, 0, 'CITY'), {}, new Map());
      expect(msgs.some(m => m.includes('Unknown'))).toBe(true);
    });

    it('rejects terrain mismatch', () => {
      const msgs = constructBuilding('FARM', makeTile(0, 0, 'WATER'), { gold: 200, wood: 200 }, new Map());
      expect(msgs.some(m => m.includes('terrain'))).toBe(true);
    });

    it('rejects duplicate', () => {
      const buildings = new Map([['0,0', ['MARKET']]]);
      const msgs = constructBuilding('MARKET', makeTile(0, 0, 'CITY'), { gold: 200, wood: 200 }, buildings);
      expect(msgs.some(m => m.includes('already built'))).toBe(true);
    });

    it('rejects if cannot afford', () => {
      const msgs = constructBuilding('MARKET', makeTile(0, 0, 'CITY'), { gold: 0, wood: 0 }, new Map());
      expect(msgs.some(m => m.includes('afford'))).toBe(true);
    });

    it('harbor requires coastal', () => {
      const tiles = new Map([['0,0', makeTile(0, 0, 'CITY')]]);
      const msgs = constructBuilding('HARBOR', makeTile(0, 0, 'CITY'), { gold: 200, wood: 200 }, new Map(), null, tiles);
      expect(msgs.some(m => m.includes('water') || m.includes('river'))).toBe(true);
    });
  });

  describe('getBuildableBuildings', () => {
    it('lists all building types', () => {
      const result = getBuildableBuildings(makeTile(0, 0, 'CITY'), { gold: 200, wood: 200, iron: 200, food: 100, production: 100 }, new Map());
      expect(result.length).toBeGreaterThan(0);
      expect(result.some(b => b.type === 'MARKET')).toBe(true);
    });

    it('marks unaffordable as cannotBuild', () => {
      const result = getBuildableBuildings(makeTile(0, 0, 'CITY'), { gold: 0, wood: 0, iron: 0, food: 0, production: 0 }, new Map());
      const market = result.find(b => b.type === 'MARKET');
      expect(market.canBuild).toBe(false);
    });
  });

  describe('getBuildingDefenseBonus', () => {
    it('WALLS gives +5', () => {
      const buildings = new Map([['0,0', ['WALLS']]]);
      expect(getBuildingDefenseBonus('0,0', buildings)).toBe(5);
    });

    it('no buildings returns 0', () => {
      expect(getBuildingDefenseBonus('0,0', new Map())).toBe(0);
    });
  });

  describe('upgradeBuilding', () => {
    it('rejects non-military building', () => {
      // WALLS is city-only and not military-upgradeable (no level table).
      const result = upgradeBuilding('WALLS', makeTile(0, 0, 'CITY'), {}, new Map(), new Map());
      expect(result).toContain('Cannot upgrade');
    });

    it('rejects if not built', () => {
      const result = upgradeBuilding('BARRACKS', makeTile(0, 0, 'CITY'), {}, new Map(), new Map());
      expect(result).toContain('not built');
    });
  });

  describe('damageBuilding', () => {
    it('reduces HP', () => {
      const state = new Map([['0,0:BARRACKS', { level: 1, hp: 20, maxHp: 20 }]]);
      const destroyed = damageBuilding('0,0', 'BARRACKS', 5, state);
      expect(destroyed).toBe(false);
      expect(state.get('0,0:BARRACKS').hp).toBe(15);
    });

    it('returns true when destroyed', () => {
      const state = new Map([['0,0:BARRACKS', { level: 1, hp: 5, maxHp: 20 }]]);
      const destroyed = damageBuilding('0,0', 'BARRACKS', 10, state);
      expect(destroyed).toBe(true);
      expect(state.has('0,0:BARRACKS')).toBe(false);
    });

    it('null-safe', () => {
      expect(damageBuilding('0,0', 'BARRACKS', 5, null)).toBe(false);
    });
  });

  describe('removeBuilding', () => {
    it('removes pillageable building', () => {
      // MARKET is now pillageable (it's an influence-buildable economic
      // building that can be raided by enemy units).
      const buildings = new Map([['0,0', ['FARM', 'MARKET']]]);
      const removed = removeBuilding(makeTile(0, 0, 'CITY'), buildings);
      expect(removed).toBe('FARM');
    });

    it('returns null for no pillageable buildings', () => {
      // WALLS is not in PILLAGEABLE_BUILDINGS (stays on the city tile, not
      // an economic/military structure that raiders can destroy).
      const buildings = new Map([['0,0', ['WALLS']]]);
      const removed = removeBuilding(makeTile(0, 0, 'CITY'), buildings);
      expect(removed).toBeNull();
    });
  });

  describe('pillageableOn', () => {
    it('returns pillageable buildings', () => {
      // Both FARM and MARKET are pillageable now.
      const buildings = new Map([['0,0', ['FARM', 'MARKET']]]);
      expect(pillageableOn(makeTile(0, 0), buildings)).toEqual(['FARM', 'MARKET']);
    });

    it('empty for no pillageable', () => {
      // WALLS is not pillageable.
      const buildings = new Map([['0,0', ['WALLS']]]);
      expect(pillageableOn(makeTile(0, 0), buildings)).toEqual([]);
    });
  });
});
