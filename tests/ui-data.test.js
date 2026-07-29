import { describe, it, expect } from 'vitest';
import { buildMinimapData, getCityJumpList, getArmyComposition } from '../src/ui_data.js';
import { FACTION_COLORS, PLAYER_FACTION } from '../src/config.js';
import { createLord } from '../src/lords.js';
import { createUnit } from '../src/unit.js';

function tile(x, z, extra = {}) {
  return { x, z, terrain: 'PLAINS', owner: null, cityLevel: 0, ...extra };
}
function tileMap(list) {
  const m = new Map();
  for (const t of list) m.set(`${t.x},${t.z}`, t);
  return m;
}

describe('Minimap data (Feature 13)', () => {
  it('builds a cell per tile with owner color + hasUnit flag', () => {
    const tiles = tileMap([
      tile(0, 0, { owner: 'player' }),
      tile(1, 0, { owner: 'ai1' }),
    ]);
    const units = new Map([[1, { id: 1, owner: 'player', x: 0, z: 0 }]]);
    const data = buildMinimapData(tiles, units, FACTION_COLORS);
    expect(data.width).toBe(2);
    expect(data.cells.get('0,0').hasUnit).toBe(true);
    expect(data.cells.get('1,0').hasUnit).toBe(false);
    expect(data.cells.get('0,0').color).toBe(FACTION_COLORS.player.tile);
    expect(data.cells.get('1,0').color).toBe(FACTION_COLORS.ai1.tile);
  });

  it('marks a cell hasUnit when a unit sits on an unowned tile', () => {
    const tiles = tileMap([tile(0, 0)]);
    const units = new Map([[1, { id: 1, owner: 'ai2', x: 0, z: 0 }]]);
    const data = buildMinimapData(tiles, units, FACTION_COLORS);
    expect(data.cells.get('0,0').hasUnit).toBe(true);
  });

  it('handles empty inputs without throwing', () => {
    const data = buildMinimapData(null, null, FACTION_COLORS);
    expect(data.width).toBe(0);
    expect(data.cells.size).toBe(0);
  });
});

describe('City quick-jump list (Feature 14)', () => {
  it('returns only the player\'s cities, sorted by level desc then key', () => {
    const tiles = tileMap([
      tile(0, 0, { terrain: 'CITY', owner: 'player', cityLevel: 1, cityName: 'Alpha' }),
      tile(2, 0, { terrain: 'CITY', owner: 'ai1', cityLevel: 3 }),
      tile(4, 0, { terrain: 'CITY', owner: 'player', cityLevel: 3, cityName: 'Beta' }),
      tile(6, 0, { terrain: 'CITY', owner: 'player', cityLevel: 2, cityName: 'Gamma' }),
    ]);
    const list = getCityJumpList(tiles, PLAYER_FACTION, FACTION_COLORS);
    expect(list.length).toBe(3);
    expect(list[0].cityLevel).toBe(3); // highest level first
    expect(list.map(c => c.name)).toContain('Alpha');
    expect(list.every(c => c.key && c.x != null && c.z != null)).toBe(true);
  });

  it('returns [] when the player owns no cities', () => {
    const tiles = tileMap([tile(0, 0, { terrain: 'CITY', owner: 'ai1' })]);
    expect(getCityJumpList(tiles, PLAYER_FACTION, FACTION_COLORS)).toEqual([]);
  });
});

describe('Army composition (Feature 15)', () => {
  it('counts unit types per lord and totals them', () => {
    const lord = createLord('player', 0, 0, 'Aldric', 'WARLORD');
    const u1 = createUnit('INFANTRY', 'player', 0, 0);
    const u2 = createUnit('INFANTRY', 'player', 0, 0);
    const u3 = createUnit('ARCHER', 'player', 0, 0);
    lord.army = [u1.id, u2.id, u3.id];
    const units = new Map([[u1.id, u1], [u2.id, u2], [u3.id, u3]]);
    const comp = getArmyComposition([lord], units, PLAYER_FACTION);
    expect(comp.length).toBe(1);
    expect(comp[0].total).toBe(3);
    expect(comp[0].types.INFANTRY).toBe(2);
    expect(comp[0].types.ARCHER).toBe(1);
    expect(comp[0].name).toBe('Aldric');
  });

  it('lists a lord with an empty army as total 0', () => {
    const lord = createLord('player', 0, 0, 'Brenna', 'GUARDIAN');
    const comp = getArmyComposition([lord], new Map(), PLAYER_FACTION);
    expect(comp[0].total).toBe(0);
    expect(comp[0].types).toEqual({});
  });

  it('filters by owner', () => {
    const l1 = createLord('player', 0, 0, 'A', 'WARLORD');
    const l2 = createLord('ai1', 1, 1, 'B', 'WARLORD');
    const comp = getArmyComposition([l1, l2], new Map(), PLAYER_FACTION);
    expect(comp.length).toBe(1);
    expect(comp[0].owner === undefined).toBe(true); // owner not echoed but only player lord present
  });

  it('returns [] for no lords', () => {
    expect(getArmyComposition([], new Map(), PLAYER_FACTION)).toEqual([]);
  });
});