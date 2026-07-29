import { describe, it, expect } from 'vitest';
import { setGridDimensions, SIEGE_PRESSURE_MAX } from '../src/config.js';

// We need to import map functions after setting grid dimensions
import {
  cityRadius, cityFortMax, isPassable, buildTileMap,
  getOwnedTiles, getOwnedCities, getInfluencedTiles,
  getAdjacentTiles, foundCity, besiegeCity,
  expandCityTerritory, captureCityTerritory, regenFortification
} from '../src/map.js';

function makeTile(x, z, terrain, owner = null) {
  return { x, z, terrain, owner, cityLevel: 1, fortification: 3, fortMax: 3, loyalty: 0 };
}

describe('map', () => {
  describe('cityRadius', () => {
    it('level 1-3 returns 1', () => {
      expect(cityRadius({ cityLevel: 1 })).toBe(1);
      expect(cityRadius({ cityLevel: 3 })).toBe(1);
    });

    it('level 4-6 returns 2', () => {
      expect(cityRadius({ cityLevel: 4 })).toBe(2);
      expect(cityRadius({ cityLevel: 6 })).toBe(2);
    });

    it('level 7+ returns 3', () => {
      expect(cityRadius({ cityLevel: 7 })).toBe(3);
      expect(cityRadius({ cityLevel: 10 })).toBe(3);
    });

    it('null defaults to 1', () => {
      expect(cityRadius(null)).toBe(1);
    });
  });

  describe('cityFortMax', () => {
    it('formula 3 + round(level * 1.5)', () => {
      expect(cityFortMax({ cityLevel: 1 })).toBe(5);
      expect(cityFortMax({ cityLevel: 5 })).toBe(11);
    });

    it('null defaults to level 1', () => {
      expect(cityFortMax(null)).toBe(5);
    });
  });

  describe('isPassable', () => {
    it('WATER is impassable', () => {
      expect(isPassable({ terrain: 'WATER' })).toBe(false);
    });

    it('RIVER without bridge is impassable', () => {
      expect(isPassable({ terrain: 'RIVER' })).toBe(false);
    });

    it('RIVER with bridge is passable', () => {
      expect(isPassable({ terrain: 'RIVER', bridge: true })).toBe(true);
    });

    it('PLAINS is passable', () => {
      expect(isPassable({ terrain: 'PLAINS' })).toBe(true);
    });

    it('null returns false', () => {
      expect(isPassable(null)).toBe(false);
    });
  });

  describe('buildTileMap', () => {
    it('converts array to Map', () => {
      const arr = [{ x: 0, z: 0, terrain: 'PLAINS' }, { x: 1, z: 0, terrain: 'WATER' }];
      const map = buildTileMap(arr);
      expect(map.size).toBe(2);
      expect(map.get('0,0').terrain).toBe('PLAINS');
    });
  });

  describe('getOwnedTiles', () => {
    it('returns correct tiles', () => {
      const tiles = new Map([
        ['0,0', makeTile(0, 0, 'PLAINS', 'player')],
        ['1,1', makeTile(1, 1, 'PLAINS', 'ai1')],
      ]);
      const owned = getOwnedTiles(tiles, 'player');
      expect(owned).toHaveLength(1);
      expect(owned[0].x).toBe(0);
    });
  });

  describe('getOwnedCities', () => {
    it('returns only CITY tiles', () => {
      const tiles = new Map([
        ['0,0', makeTile(0, 0, 'CITY', 'player')],
        ['1,1', makeTile(1, 1, 'PLAINS', 'player')],
      ]);
      expect(getOwnedCities(tiles, 'player')).toHaveLength(1);
    });
  });

  describe('getAdjacentTiles', () => {
    it('returns orthogonal neighbors', () => {
      setGridDimensions(20, 20);
      const tiles = new Map([
        ['5,5', makeTile(5, 5, 'PLAINS')],
        ['6,5', makeTile(6, 5, 'PLAINS')],
        ['4,5', makeTile(4, 5, 'PLAINS')],
        ['5,6', makeTile(5, 6, 'PLAINS')],
        ['5,4', makeTile(5, 4, 'PLAINS')],
      ]);
      const adj = getAdjacentTiles(tiles, 5, 5);
      expect(adj).toHaveLength(4);
    });

    it('fewer at edges', () => {
      setGridDimensions(20, 20);
      const tiles = new Map([
        ['0,0', makeTile(0, 0, 'PLAINS')],
        ['1,0', makeTile(1, 0, 'PLAINS')],
        ['0,1', makeTile(0, 1, 'PLAINS')],
      ]);
      const adj = getAdjacentTiles(tiles, 0, 0);
      expect(adj).toHaveLength(2);
    });
  });

  describe('getInfluencedTiles', () => {
    it('includes tiles in city radius', () => {
      setGridDimensions(20, 20);
      const tiles = new Map();
      tiles.set('5,5', { ...makeTile(5, 5, 'CITY', 'player'), cityLevel: 1 });
      // Surround with owned plains
      for (let dx = -2; dx <= 2; dx++) {
        for (let dz = -2; dz <= 2; dz++) {
          if (dx === 0 && dz === 0) continue;
          tiles.set(`${5 + dx},${5 + dz}`, makeTile(5 + dx, 5 + dz, 'PLAINS', 'player'));
        }
      }
      const influenced = getInfluencedTiles(tiles, 'player');
      expect(influenced.has('5,5')).toBe(true);
      expect(influenced.has('6,5')).toBe(true);
    });
  });

  describe('foundCity', () => {
    it('converts tile to CITY', () => {
      setGridDimensions(20, 20);
      const tiles = new Map();
      tiles.set('10,10', makeTile(10, 10, 'PLAINS', 'player'));
      foundCity(tiles, tiles.get('10,10'), 'player');
      expect(tiles.get('10,10').terrain).toBe('CITY');
      expect(tiles.get('10,10').cityLevel).toBe(1);
    });

    it('rejects WATER tile', () => {
      setGridDimensions(20, 20);
      const tiles = new Map();
      tiles.set('10,10', makeTile(10, 10, 'WATER', 'player'));
      const msgs = foundCity(tiles, tiles.get('10,10'), 'player');
      expect(msgs.some(m => m.includes('cannot') || m.includes('Cannot'))).toBe(true);
    });

    it('rejects existing CITY', () => {
      setGridDimensions(20, 20);
      const tiles = new Map();
      tiles.set('10,10', { ...makeTile(10, 10, 'CITY', 'player'), cityLevel: 1 });
      const msgs = foundCity(tiles, tiles.get('10,10'), 'player');
      expect(msgs.some(m => m.includes('already') || m.includes('Already'))).toBe(true);
    });
  });

  describe('besiegeCity', () => {
    it('reduces fortification', () => {
      const city = { x: 5, z: 5, terrain: 'CITY', owner: 'ai1', fortification: 3 };
      const unit = { type: 'INFANTRY', owner: 'player' };
      const msgs = besiegeCity(unit, city);
      expect(city.fortification).toBeLessThan(3);
    });

    it('no-op at 0 fortification', () => {
      const city = { x: 5, z: 5, terrain: 'CITY', owner: 'ai1', fortification: 0 };
      const unit = { type: 'INFANTRY', owner: 'player' };
      besiegeCity(unit, city);
      expect(city.fortification).toBe(0);
    });
  });

  describe('expandCityTerritory', () => {
    it('claims unowned tiles', () => {
      setGridDimensions(20, 20);
      const tiles = new Map();
      tiles.set('10,10', { ...makeTile(10, 10, 'CITY', 'player'), cityLevel: 1 });
      tiles.set('11,10', makeTile(11, 10, 'PLAINS'));
      const claimed = expandCityTerritory(tiles, tiles.get('10,10'), 'player');
      expect(claimed).toBeGreaterThan(0);
      expect(tiles.get('11,10').owner).toBe('player');
    });

    it('does not take from other factions', () => {
      setGridDimensions(20, 20);
      const tiles = new Map();
      tiles.set('10,10', { ...makeTile(10, 10, 'CITY', 'player'), cityLevel: 1 });
      tiles.set('11,10', makeTile(11, 10, 'PLAINS', 'ai1'));
      expandCityTerritory(tiles, tiles.get('10,10'), 'player');
      expect(tiles.get('11,10').owner).toBe('ai1');
    });
  });

  describe('regenFortification', () => {
    it('regenerates +1 below max', () => {
      setGridDimensions(20, 20);
      const tiles = new Map();
      tiles.set('10,10', { ...makeTile(10, 10, 'CITY', 'player'), fortification: 2, fortMax: 5 });
      regenFortification(tiles);
      expect(tiles.get('10,10').fortification).toBe(3);
    });

    it('skips at max', () => {
      setGridDimensions(20, 20);
      const tiles = new Map();
      tiles.set('10,10', { ...makeTile(10, 10, 'CITY', 'player'), fortification: 5, fortMax: 5 });
      regenFortification(tiles);
      expect(tiles.get('10,10').fortification).toBe(5);
    });

    it('a city with siege pressure does not regen — pressure decays instead, then regen resumes', () => {
      setGridDimensions(20, 20);
      const tiles = new Map();
      tiles.set('10,10', { ...makeTile(10, 10, 'CITY', 'player'), fortification: 2, fortMax: 5, siegePressure: 2 });
      regenFortification(tiles);
      expect(tiles.get('10,10').fortification).toBe(2); // no regen while pressured
      expect(tiles.get('10,10').siegePressure).toBe(1); // decays by 1 per rest turn
      regenFortification(tiles);
      expect(tiles.get('10,10').fortification).toBe(2);
      expect(tiles.get('10,10').siegePressure).toBe(0);
      regenFortification(tiles);
      expect(tiles.get('10,10').fortification).toBe(3); // normal +1 regen resumes
    });

    it('a freshly breached city stays at 0 through the next regen tick (capture window)', () => {
      setGridDimensions(20, 20);
      const tiles = new Map();
      const city = { ...makeTile(10, 10, 'CITY', 'ai1'), fortification: 1, fortMax: 5 };
      tiles.set('10,10', city);
      besiegeCity({ type: 'SIEGE', owner: 'player' }, city); // fort 1 -> 0
      expect(city.fortification).toBe(0);
      expect(city.siegePressure).toBeGreaterThan(0);
      regenFortification(tiles); // next turn: must NOT pop back to 1
      expect(city.fortification).toBe(0);
    });

    it('besiegeCity builds siege pressure, capped at SIEGE_PRESSURE_MAX', () => {
      setGridDimensions(20, 20);
      const city = { ...makeTile(10, 10, 'CITY', 'ai1'), fortification: 20, fortMax: 20 };
      const siege = { type: 'SIEGE', owner: 'player' };
      besiegeCity(siege, city);
      expect(city.siegePressure).toBe(1);
      for (let i = 0; i < 6; i++) besiegeCity(siege, city);
      expect(city.siegePressure).toBe(SIEGE_PRESSURE_MAX);
    });
  });
});

describe('generateMap land fraction', () => {
  // Regression: continent radii used to cap at ~0.65 of the half-map and the
  // retry floors were 30%, leaving 50%+ of most maps as ocean. Land must now
  // cover at least half the map on every size.
  it('land covers at least 50% of the map across sizes and seeds', async () => {
    const { calculateMapDimensions } = await import('../src/config.js');
    const { generateMap } = await import('../src/map.js');
    for (const size of ['tiny', 'small', 'medium', 'large', 'huge']) {
      for (let i = 0; i < 8; i++) {
        const { width, height } = calculateMapDimensions(size);
        setGridDimensions(width, height);
        const { tiles } = generateMap();
        const arr = Array.isArray(tiles) ? tiles : [...tiles.values()];
        const land = arr.filter(t => t.terrain !== 'WATER').length;
        expect(land / arr.length).toBeGreaterThanOrEqual(0.5);
      }
    }
  });
});

describe('generateMap landmass diversity', () => {
  // Regression: single-terrain landmasses starved their owner (a plains-only
  // island has no wood or iron income). Every landmass of 6+ tiles must have
  // at least 3 terrain types plus wood (FOREST) and iron (HILLS/MOUNTAIN/PASS).
  it('every landmass has >=3 terrain types and wood+iron coverage', async () => {
    const { calculateMapDimensions } = await import('../src/config.js');
    const { generateMap } = await import('../src/map.js');
    for (const size of ['small', 'medium', 'large']) {
      for (let i = 0; i < 5; i++) {
        const { width, height } = calculateMapDimensions(size);
        setGridDimensions(width, height);
        const { tiles } = generateMap();
        const arr = Array.isArray(tiles) ? tiles : [...tiles.values()];
        const byKey = new Map(arr.map(t => [`${t.x},${t.z}`, t]));
        const seen = new Set();
        for (const start of arr) {
          if (start.terrain === 'WATER' || seen.has(`${start.x},${start.z}`)) continue;
          const comp = [];
          const queue = [start];
          seen.add(`${start.x},${start.z}`);
          while (queue.length) {
            const cur = queue.shift();
            comp.push(cur);
            for (const [dx, dz] of [[0,1],[0,-1],[1,0],[-1,0]]) {
              const k = `${cur.x + dx},${cur.z + dz}`;
              if (seen.has(k)) continue;
              const n = byKey.get(k);
              if (!n || n.terrain === 'WATER') continue;
              seen.add(k); queue.push(n);
            }
          }
          if (comp.length < 6) continue;
          const types = new Set(comp.map(t => t.terrain));
          expect(types.size).toBeGreaterThanOrEqual(3);
          expect(types.has('FOREST')).toBe(true);
          expect(types.has('HILLS') || types.has('MOUNTAIN') || types.has('PASS')).toBe(true);
        }
      }
    }
  });
});
