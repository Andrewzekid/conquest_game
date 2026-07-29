import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
    createTradeRoute, validateTradeRoute, processTradeRouteRaids, getTradeRouteIncome
} from '../src/economy.js';
import { createDiplomacyState, setRelation, getRelation } from '../src/diplomacy.js';
import { DIPLOMACY_STATES, TRADE_ROUTE_MIN_CITY_LEVEL, TRADE_ROUTE_MAX,
         RAID_STEAL_PERCENT, RAID_DISRUPT_TURNS } from '../src/config.js';
import { UNIT_TYPE } from '../src/config.js';
import { createUnit } from '../src/unit.js';

const here = dirname(fileURLToPath(import.meta.url));

function mkTiles(arr) {
  const m = new Map();
  for (const t of arr) m.set(`${t.x},${t.z}`, t);
  return m;
}

describe('Trade Routes — createTradeRoute', () => {
  it('computes income from base + distance + both city levels', () => {
    const route = createTradeRoute({
      id: 1,
      from: { owner: 'player', cityKey: '0,0', x: 0, z: 0 },
      to: { owner: 'ai1', cityKey: '5,3', x: 5, z: 3 },
      fromLevel: 2, toLevel: 3, turn: 7
    });
    // distance = 5+3 = 8 -> floor(8*0.5)=4 ; levels 2+3 -> (2+3)*2=10 ; base 10
    expect(route.income).toBe(10 + 4 + (2 * 2) + (3 * 2));
    expect(route.establishedTurn).toBe(7);
    expect(route.disrupted).toBe(false);
    expect(route.id).toBe(1);
  });

  it('builds a Manhattan path between the two endpoints', () => {
    const route = createTradeRoute({
      from: { owner: 'p', cityKey: '0,0', x: 0, z: 0 },
      to: { owner: 'q', cityKey: '2,1', x: 2, z: 1 }
    });
    expect(route.path[0]).toBe('0,0');
    expect(route.path[route.path.length - 1]).toBe('2,1');
    // path covers every x step then every z step
    expect(route.path).toContain('1,0');
    expect(route.path).toContain('2,0');
  });
});

describe('Trade Routes — validateTradeRoute', () => {
  function setup() {
    const tiles = mkTiles([
      { x: 0, z: 0, terrain: 'CITY', owner: 'player', cityLevel: 2 },
      { x: 5, z: 0, terrain: 'CITY', owner: 'ai1', cityLevel: 3 }
    ]);
    const diplo = createDiplomacyState(['player', 'ai1']);
    return { tiles, diplo };
  }

  it('accepts a valid same-peace route', () => {
    const { tiles, diplo } = setup();
    const r = validateTradeRoute(tiles, diplo, 'player', 'ai1', '0,0', '5,0', []);
    expect(r.valid).toBe(true);
  });

  it('rejects a city below the minimum level', () => {
    const tiles = mkTiles([
      { x: 0, z: 0, terrain: 'CITY', owner: 'player', cityLevel: 1 },
      { x: 5, z: 0, terrain: 'CITY', owner: 'ai1', cityLevel: 3 }
    ]);
    const diplo = createDiplomacyState(['player', 'ai1']);
    const r = validateTradeRoute(tiles, diplo, 'player', 'ai1', '0,0', '5,0', []);
    expect(r.valid).toBe(false);
    expect(r.reason).toContain('level');
  });

  it('rejects a route to an enemy (war)', () => {
    const { tiles, diplo } = setup();
    setRelation(diplo, 'player', 'ai1', DIPLOMACY_STATES.WAR, 1);
    const r = validateTradeRoute(tiles, diplo, 'player', 'ai1', '0,0', '5,0', []);
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/enemy/i);
  });

  it('rejects a duplicate route (either direction)', () => {
    const { tiles, diplo } = setup();
    const existing = [createTradeRoute({
      from: { owner: 'player', cityKey: '0,0', x: 0, z: 0 },
      to: { owner: 'ai1', cityKey: '5,0', x: 5, z: 0 }
    })];
    const r = validateTradeRoute(tiles, diplo, 'player', 'ai1', '0,0', '5,0', existing);
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/already exists/i);
    // Reverse direction is also a duplicate.
    const r2 = validateTradeRoute(tiles, diplo, 'ai1', 'player', '5,0', '0,0', existing);
    expect(r2.valid).toBe(false);
  });

  it('rejects when the per-faction route cap is reached', () => {
    const { tiles, diplo } = setup();
    const existing = [];
    for (let i = 0; i < TRADE_ROUTE_MAX; i++) {
      existing.push(createTradeRoute({
        from: { owner: 'player', cityKey: `0,0`, x: 0, z: 0 },
        to: { owner: 'ai1', cityKey: `${i + 10},${i}`, x: i + 10, z: i }
      }));
    }
    const r = validateTradeRoute(tiles, diplo, 'player', 'ai1', '0,0', '5,0', existing);
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/cap/i);
  });

  it('rejects a city routed to itself', () => {
    const { tiles, diplo } = setup();
    const r = validateTradeRoute(tiles, diplo, 'player', 'player', '0,0', '0,0', []);
    expect(r.valid).toBe(false);
  });
});

describe('Trade Routes — getTradeRouteIncome', () => {
  it('pays the establishing owner for undisrupted routes it still holds', () => {
    const tiles = mkTiles([
      { x: 0, z: 0, terrain: 'CITY', owner: 'player', cityLevel: 2 },
      { x: 5, z: 0, terrain: 'CITY', owner: 'ai1', cityLevel: 3 }
    ]);
    const route = createTradeRoute({
      from: { owner: 'player', cityKey: '0,0', x: 0, z: 0 },
      to: { owner: 'ai1', cityKey: '5,0', x: 5, z: 0 },
      fromLevel: 2, toLevel: 3
    });
    expect(getTradeRouteIncome(tiles, 'player', [route])).toBe(route.income);
    expect(getTradeRouteIncome(tiles, 'ai1', [route])).toBe(0); // ai1 is not the establishing owner
  });

  it('pays nothing while a route is disrupted', () => {
    const tiles = mkTiles([
      { x: 0, z: 0, terrain: 'CITY', owner: 'player', cityLevel: 2 },
      { x: 5, z: 0, terrain: 'CITY', owner: 'ai1', cityLevel: 3 }
    ]);
    const route = createTradeRoute({
      from: { owner: 'player', cityKey: '0,0', x: 0, z: 0 },
      to: { owner: 'ai1', cityKey: '5,0', x: 5, z: 0 }
    });
    route.disrupted = true;
    expect(getTradeRouteIncome(tiles, 'player', [route])).toBe(0);
  });

  it('stops paying if the establishing owner loses its endpoint city', () => {
    const tiles = mkTiles([
      { x: 0, z: 0, terrain: 'CITY', owner: 'ai2', cityLevel: 2 }, // lost the city
      { x: 5, z: 0, terrain: 'CITY', owner: 'ai1', cityLevel: 3 }
    ]);
    const route = createTradeRoute({
      from: { owner: 'player', cityKey: '0,0', x: 0, z: 0 },
      to: { owner: 'ai1', cityKey: '5,0', x: 5, z: 0 }
    });
    expect(getTradeRouteIncome(tiles, 'player', [route])).toBe(0);
  });
});

describe('Trade Routes — processTradeRouteRaids', () => {
  it('a military unit on the route path raids it', () => {
    const tiles = mkTiles([
      { x: 0, z: 0, terrain: 'CITY', owner: 'player', cityLevel: 2 },
      { x: 5, z: 0, terrain: 'CITY', owner: 'ai1', cityLevel: 3 }
    ]);
    const route = createTradeRoute({
      from: { owner: 'player', cityKey: '0,0', x: 0, z: 0 },
      to: { owner: 'ai1', cityKey: '5,0', x: 5, z: 0 }
    });
    const units = new Map();
    // An enemy INFANTRY sitting on path tile 3,0.
    const raider = createUnit('INFANTRY', 'ai2', 3, 0, {});
    units.set(raider.id, raider);
    const { raided, messages } = processTradeRouteRaids([route], units, 'ai2');
    expect(raided.length).toBe(1);
    expect(raided[0].stolen).toBe(Math.floor(route.income * RAID_STEAL_PERCENT));
    expect(route.disrupted).toBe(true);
    expect(route.disruptedTurnsLeft).toBe(RAID_DISRUPT_TURNS);
    expect(messages.length).toBeGreaterThan(0);
  });

  it('does not raid a route owned by the raider', () => {
    const route = createTradeRoute({
      from: { owner: 'ai2', cityKey: '0,0', x: 0, z: 0 },
      to: { owner: 'ai1', cityKey: '5,0', x: 5, z: 0 }
    });
    const units = new Map();
    const raider = createUnit('INFANTRY', 'ai2', 3, 0, {});
    units.set(raider.id, raider);
    const { raided } = processTradeRouteRaids([route], units, 'ai2');
    expect(raided.length).toBe(0);
  });

  it('workers and naval units do not raid', () => {
    const route = createTradeRoute({
      from: { owner: 'player', cityKey: '0,0', x: 0, z: 0 },
      to: { owner: 'ai1', cityKey: '5,0', x: 5, z: 0 }
    });
    for (const type of ['WORKER', 'GALLEY']) {
      const r2 = createTradeRoute({
        from: { owner: 'player', cityKey: '0,0', x: 0, z: 0 },
        to: { owner: 'ai1', cityKey: '5,0', x: 5, z: 0 }
      });
      const units = new Map();
      const u = createUnit(type, 'ai2', 3, 0, {});
      units.set(u.id, u);
      const { raided } = processTradeRouteRaids([r2], units, 'ai2');
      expect(raided.length, `${type} should not raid`).toBe(0);
    }
  });

  it('skips already-disrupted routes', () => {
    const route = createTradeRoute({
      from: { owner: 'player', cityKey: '0,0', x: 0, z: 0 },
      to: { owner: 'ai1', cityKey: '5,0', x: 5, z: 0 }
    });
    route.disrupted = true;
    route.disruptedTurnsLeft = 2;
    const units = new Map();
    const raider = createUnit('INFANTRY', 'ai2', 3, 0, {});
    units.set(raider.id, raider);
    const { raided } = processTradeRouteRaids([route], units, 'ai2');
    expect(raided.length).toBe(0);
  });
});

describe('Trade Routes — save serialization (source-invariant)', () => {
  it('save.js persists gameState.tradeRoutes + tradeRouteNextId', () => {
    const saveSrc = readFileSync(join(here, '..', 'src', 'save.js'), 'utf8');
    expect(saveSrc).toMatch(/tradeRoutes:\s*gameState\.tradeRoutes/);
    expect(saveSrc).toMatch(/tradeRouteNextId/);
    // Load path restores them (backfill for old saves).
    expect(saveSrc).toMatch(/Array\.isArray\(data\.tradeRoutes\)/);
  });

  it('game.js handleEstablishTrade increments the victory trade-route counter', () => {
    const gameSrc = readFileSync(join(here, '..', 'src', 'game.js'), 'utf8');
    expect(gameSrc).toMatch(/victoryState\.tradeRoutes/);
    expect(gameSrc).toMatch(/handleEstablishTrade/);
  });
});