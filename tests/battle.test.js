import { describe, it, expect, vi } from 'vitest';
import { resolveCombat, isEncircled, canCaptureTile, captureTile, processLoyalty, simulateCombat } from '../src/battle.js';
import { lordCombatant } from '../src/lords.js';

function makeUnit(type, owner, x, z, overrides = {}) {
  const defaults = {
    INFANTRY: { hp: 10, maxHp: 10, attack: 3, defense: 2, moveRange: 2, type: 'INFANTRY' },
    ARCHER: { hp: 8, maxHp: 8, attack: 4, defense: 1, moveRange: 2, type: 'ARCHER', ranged: true },
    CAVALRY: { hp: 12, maxHp: 12, attack: 5, defense: 3, moveRange: 3, type: 'CAVALRY' },
  };
  return { id: Math.random(), owner, x, z, level: 1, xp: 0, ...defaults[type], ...overrides };
}

describe('battle', () => {
  describe('resolveCombat', () => {
    it('returns early if either unit is null', () => {
      const result = resolveCombat(null, makeUnit('INFANTRY', 'a', 0, 0), 'PLAINS');
      expect(result.defenderDied).toBe(false);
      expect(result.damageToDefender).toBe(0);
    });

    it('deals damage to defender', () => {
      const atk = makeUnit('INFANTRY', 'a', 0, 0);
      const def = makeUnit('INFANTRY', 'b', 1, 0);
      const result = resolveCombat(atk, def, 'PLAINS');
      expect(result.damageToDefender).toBeGreaterThan(0);
      expect(def.hp).toBeLessThan(def.maxHp);
    });

    it('kills low-HP defender', () => {
      const atk = makeUnit('INFANTRY', 'a', 0, 0, { attack: 100 });
      const def = makeUnit('INFANTRY', 'b', 1, 0, { hp: 1, maxHp: 10 });
      const result = resolveCombat(atk, def, 'PLAINS');
      expect(result.defenderDied).toBe(true);
    });

    it('encircled defender gets -2 defense and no counter', () => {
      const atk = makeUnit('INFANTRY', 'a', 0, 0, { attack: 10 });
      const def = makeUnit('INFANTRY', 'b', 1, 0, { hp: 50, maxHp: 50 });
      const result = resolveCombat(atk, def, 'PLAINS', null, null, null, null, null, true);
      expect(result.messages.some(m => m.includes('encircled'))).toBe(true);
    });

    it('ranged attacker does not trigger counter', () => {
      const atk = makeUnit('ARCHER', 'a', 0, 0);
      const def = makeUnit('INFANTRY', 'b', 1, 0, { hp: 50, maxHp: 50 });
      const result = resolveCombat(atk, def, 'PLAINS');
      expect(result.messages.some(m => m.includes('counter-attack'))).toBe(false);
    });

    it('breached city loses terrain defense', () => {
      const atk = makeUnit('INFANTRY', 'a', 0, 0, { attack: 100 });
      const def = makeUnit('INFANTRY', 'b', 1, 0, { hp: 100, maxHp: 100 });
      const result = resolveCombat(atk, def, 'CITY', null, null, null, null, null, false, null, true);
      expect(result.messages.some(m => m.includes('breached'))).toBe(true);
    });

    it('adjacent friendly siege tower lowers city defense', () => {
      const atk = makeUnit('INFANTRY', 'a', 0, 0, { attack: 20 });
      const defNoTower = makeUnit('INFANTRY', 'b', 1, 0, { hp: 100, maxHp: 100 });
      const r1 = resolveCombat(atk, defNoTower, 'CITY');

      const tower = { id: 'tower1', type: 'SIEGE_TOWER', owner: 'a', x: 1, z: 1 }; // orthogonally adjacent to defender
      const units = new Map([[atk.id, atk], [tower.id, tower]]);
      const defTower = makeUnit('INFANTRY', 'b', 1, 0, { hp: 100, maxHp: 100 });
      const r2 = resolveCombat(atk, defTower, 'CITY', null, null, null, null, null, false, null, false, false, units);

      expect(r2.messages.some(m => m.includes('siege tower undermines'))).toBe(true);
      expect(r2.damageToDefender).toBeGreaterThan(r1.damageToDefender);
    });

    it('siege tower gives no reduction once the city is breached', () => {
      const atk = makeUnit('INFANTRY', 'a', 0, 0, { attack: 20 });
      const tower = { id: 'tower1', type: 'SIEGE_TOWER', owner: 'a', x: 1, z: 1 };
      const units = new Map([[atk.id, atk], [tower.id, tower]]);
      const def = makeUnit('INFANTRY', 'b', 1, 0, { hp: 100, maxHp: 100 });
      const r = resolveCombat(atk, def, 'CITY', null, null, null, null, null, false, null, true, false, units);
      expect(r.messages.some(m => m.includes('siege tower undermines'))).toBe(false);
    });

    it('an enemy-owned siege tower does not help the attacker', () => {
      const atk = makeUnit('INFANTRY', 'a', 0, 0, { attack: 20 });
      const tower = { id: 'tower1', type: 'SIEGE_TOWER', owner: 'b', x: 1, z: 1 }; // defender's tower
      const units = new Map([[atk.id, atk], [tower.id, tower]]);
      const def = makeUnit('INFANTRY', 'b', 1, 0, { hp: 100, maxHp: 100 });
      const r = resolveCombat(atk, def, 'CITY', null, null, null, null, null, false, null, false, false, units);
      expect(r.messages.some(m => m.includes('siege tower undermines'))).toBe(false);
    });

    it('type advantage message appears', () => {
      const atk = makeUnit('INFANTRY', 'a', 0, 0);
      const def = makeUnit('ARCHER', 'b', 1, 0, { hp: 50, maxHp: 50 });
      const result = resolveCombat(atk, def, 'PLAINS');
      expect(result.messages.some(m => m.includes('type advantage'))).toBe(true);
    });
  });

  describe('isEncircled', () => {
    it('returns false for null inputs', () => {
      expect(isEncircled(null, new Map(), new Map())).toBe(false);
    });

    it('naval units are never encircled', () => {
      const def = makeUnit('GALLEY', 'b', 5, 5, { type: 'GALLEY' });
      const units = new Map([['1', def]]);
      const tiles = new Map();
      expect(isEncircled(def, units, tiles)).toBe(false);
    });

    it('friendly neighbor means not encircled', () => {
      const def = makeUnit('INFANTRY', 'b', 5, 5);
      const friendly = makeUnit('INFANTRY', 'b', 5, 6);
      const units = new Map([['1', def], ['2', friendly]]);
      const tiles = new Map();
      for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
          if (dx === 0 && dz === 0) continue;
          tiles.set(`${5 + dx},${5 + dz}`, { terrain: 'PLAINS' });
        }
      }
      expect(isEncircled(def, units, tiles)).toBe(false);
    });
  });

  describe('canCaptureTile', () => {
    it('requires >= 20 gold', () => {
      const tile = { owner: null, terrain: 'PLAINS' };
      expect(canCaptureTile('a', tile, { gold: 19 })).toBe(false);
      expect(canCaptureTile('a', tile, { gold: 20 })).toBe(true);
    });

    it('cannot capture own tile', () => {
      const tile = { owner: 'a', terrain: 'PLAINS' };
      expect(canCaptureTile('a', tile, { gold: 100 })).toBe(false);
    });

    it('cannot capture fortified city', () => {
      const tile = { owner: 'b', terrain: 'CITY', fortification: 3 };
      expect(canCaptureTile('a', tile, { gold: 100 })).toBe(false);
    });

    it('can capture unfortified city', () => {
      const tile = { owner: 'b', terrain: 'CITY', fortification: 0 };
      expect(canCaptureTile('a', tile, { gold: 100 })).toBe(true);
    });
  });

  describe('captureTile', () => {
    it('deducts 20 gold and sets owner', () => {
      const tile = { x: 1, z: 2, owner: null };
      const resources = { gold: 100 };
      captureTile(tile, 'a', resources);
      expect(resources.gold).toBe(80);
      expect(tile.owner).toBe('a');
      expect(tile.loyalty).toBe(3);
    });
  });

  describe('processLoyalty', () => {
    it('decrements loyalty', () => {
      const tile = { x: 0, z: 0, owner: 'a', loyalty: 2 };
      const tiles = new Map([['0,0', tile]]);
      processLoyalty(tiles, 'a');
      expect(tile.loyalty).toBe(1);
    });
  });

  describe('simulateCombat', () => {
    it('does not mutate original units', () => {
      const atk = makeUnit('INFANTRY', 'a', 0, 0);
      const def = makeUnit('INFANTRY', 'b', 1, 0);
      const origAtkHp = atk.hp;
      const origDefHp = def.hp;
      simulateCombat(atk, def, 'PLAINS');
      expect(atk.hp).toBe(origAtkHp);
      expect(def.hp).toBe(origDefHp);
    });

    it('returns damage estimates', () => {
      const atk = makeUnit('INFANTRY', 'a', 0, 0);
      const def = makeUnit('INFANTRY', 'b', 1, 0);
      const result = simulateCombat(atk, def, 'PLAINS');
      expect(result.damageToDefender).toBeGreaterThanOrEqual(0);
    });

    it('returns zeros for null inputs', () => {
      const result = simulateCombat(null, null, 'PLAINS');
      expect(result.damageToDefender).toBe(0);
      expect(result.damageToAttacker).toBe(0);
    });

    it('predicting a kill on a lord combatant does NOT damage the real lord', () => {
      // Regression: simulateCombat shallow-cloned the combatant, so the clone's
      // `_lord` still pointed at the real lord — resolveCombat's syncLordHp then
      // wrote the simulated (often lethal) hp onto the real lord with no death
      // routing. This is how kings ended up at 0 HP while still alive.
      const king = {
        id: 'k1', owner: 'b', x: 1, z: 0, hp: 20, maxHp: 20, isKing: true,
        name: 'Spymaster Nyx', xp: 0, level: 1,
        stats: { command: 2, combat: 2, governance: 1 }, abilities: [], army: [],
      };
      const atk = makeUnit('INFANTRY', 'a', 0, 0, { attack: 200 }); // guaranteed predicted kill
      const result = simulateCombat(atk, lordCombatant(king), 'PLAINS');
      expect(result.defenderDied).toBe(true);  // the prediction says the king dies
      expect(king.hp).toBe(20);                // but the real king is untouched
      expect(king.xp).toBe(0);
    });
  });

  describe('resolveCombat — era-unit crash regressions', () => {
    it('RIFLEMAN attacking a city defender does not crash and halves defense', () => {
      // Regression: `effectiveDefense *= 0.5` ran before the `let effectiveDefense`
      // declaration (TDZ ReferenceError on every Rifleman attack).
      const atk = makeUnit('INFANTRY', 'a', 0, 0, { type: 'RIFLEMAN', attack: 11 });
      const def = makeUnit('INFANTRY', 'b', 0, 1, { hp: 40, maxHp: 40 });
      let result;
      expect(() => { result = resolveCombat(atk, def, 'CITY'); }).not.toThrow();
      expect(result.messages.some(m => m.includes('rifled accuracy'))).toBe(true);
    });

    it('MUSKETEER attacking does not crash (units was not in scope)', () => {
      const atk = makeUnit('INFANTRY', 'a', 0, 0, { type: 'MUSKETEER', attack: 8 });
      const def = makeUnit('INFANTRY', 'b', 0, 1, { hp: 40, maxHp: 40 });
      expect(() => resolveCombat(atk, def, 'CITY')).not.toThrow();
    });

    it('MUSKETEER volley fire: +1 attack per adjacent friendly musketeer', () => {
      const atk = makeUnit('INFANTRY', 'a', 0, 0, { id: 1, type: 'MUSKETEER', attack: 8 });
      const friend = makeUnit('INFANTRY', 'a', 1, 0, { id: 2, type: 'MUSKETEER' });
      const def = makeUnit('INFANTRY', 'b', 0, 1, { id: 3, hp: 40, maxHp: 40 });
      const units = new Map([[1, atk], [2, friend], [3, def]]);
      const result = resolveCombat(atk, def, 'CITY', null, null, null, null, null, false, null, false, false, units);
      expect(result.messages.some(m => m.includes('volley fire: +1'))).toBe(true);
    });

    it('MUSKETEER volley fire: no adjacent musketeers, no bonus', () => {
      const atk = makeUnit('INFANTRY', 'a', 0, 0, { id: 1, type: 'MUSKETEER', attack: 8 });
      const def = makeUnit('INFANTRY', 'b', 0, 1, { id: 3, hp: 40, maxHp: 40 });
      const units = new Map([[1, atk], [3, def]]);
      const result = resolveCombat(atk, def, 'CITY', null, null, null, null, null, false, null, false, false, units);
      expect(result.messages.some(m => m.includes('volley fire'))).toBe(false);
    });

    it('LINE_INFANTRY defender does not crash (units was not in scope)', () => {
      const atk = makeUnit('INFANTRY', 'a', 0, 0);
      const def = makeUnit('INFANTRY', 'b', 1, 0, { type: 'LINE_INFANTRY', hp: 60, maxHp: 60 });
      expect(() => resolveCombat(atk, def, 'PLAINS')).not.toThrow();
    });

    it('LINE_INFANTRY formation: +2 def with 2 adjacent friendly infantry', () => {
      const atk = makeUnit('INFANTRY', 'a', 0, 0);
      const def = makeUnit('INFANTRY', 'b', 2, 0, { id: 10, type: 'LINE_INFANTRY', hp: 60, maxHp: 60 });
      const f1 = makeUnit('INFANTRY', 'b', 2, 1, { id: 11 });
      const f2 = makeUnit('INFANTRY', 'b', 3, 0, { id: 12 });
      const units = new Map([[10, def], [11, f1], [12, f2]]);
      const result = resolveCombat(atk, def, 'PLAINS', null, null, null, null, null, false, null, false, false, units);
      expect(result.messages.some(m => m.includes('formation discipline'))).toBe(true);
    });

    it('DEMOLITION_SQUAD attacking a city does not crash and gets +5', () => {
      const atk = makeUnit('INFANTRY', 'a', 0, 0, { type: 'DEMOLITION_SQUAD', attack: 8 });
      const def = makeUnit('INFANTRY', 'b', 0, 1, { hp: 40, maxHp: 40 });
      let result;
      expect(() => { result = resolveCombat(atk, def, 'CITY'); }).not.toThrow();
      expect(result.messages.some(m => m.includes('demolition charge'))).toBe(true);
    });

    it('DEMOLITION_SQUAD attacking outside a city does not crash (tileKey TDZ)', () => {
      // Regression: the block read `tileKey` before its `const` declaration.
      // The `isCity ||` short-circuit hides this vs cities, but on open ground
      // (with a buildings map passed, as the game always does) it threw a TDZ
      // ReferenceError on every Demolition Squad attack.
      const atk = makeUnit('INFANTRY', 'a', 0, 0, { type: 'DEMOLITION_SQUAD', attack: 8 });
      const def = makeUnit('INFANTRY', 'b', 0, 1, { hp: 40, maxHp: 40 });
      const buildings = new Map([['5,5', ['WALLS']]]);
      expect(() => resolveCombat(atk, def, 'PLAINS', null, null, buildings)).not.toThrow();
    });
  });

  describe('resolveCombat — 0-HP defenders are dead', () => {
    it('a melee attack on a 0-hp unit kills it', () => {
      const atk = makeUnit('INFANTRY', 'a', 0, 0);
      const def = makeUnit('INFANTRY', 'b', 1, 0, { hp: 0, maxHp: 10 });
      const result = resolveCombat(atk, def, 'PLAINS');
      expect(result.defenderDied).toBe(true);
      expect(result.messages.some(m => m.includes('destroyed'))).toBe(true);
    });

    it('a ranged attack on a 0-hp unit kills it', () => {
      const atk = makeUnit('ARCHER', 'a', 0, 0);
      const def = makeUnit('INFANTRY', 'b', 2, 0, { hp: 0, maxHp: 10 });
      const spy = vi.spyOn(Math, 'random').mockReturnValue(0.99); // never dodge
      try {
        const result = resolveCombat(atk, def, 'PLAINS');
        expect(result.defenderDied).toBe(true);
      } finally { spy.mockRestore(); }
    });

    it('even a DODGED ranged attack on a 0-hp unit still kills it', () => {
      // A 0-hp combatant is already dead — dodging the shot must not save it.
      const atk = makeUnit('ARCHER', 'a', 0, 0);
      const def = makeUnit('INFANTRY', 'b', 2, 0, { hp: 0, maxHp: 10 });
      const spy = vi.spyOn(Math, 'random').mockReturnValue(0); // force the dodge
      try {
        const result = resolveCombat(atk, def, 'PLAINS');
        expect(result.damageToDefender).toBe(0);
        expect(result.messages.some(m => m.includes('dodges'))).toBe(true);
        expect(result.defenderDied).toBe(true);
      } finally { spy.mockRestore(); }
    });

    it('a 0-hp lord combatant attacked in a city dies (king scenario)', () => {
      const king = {
        id: 'k1', owner: 'b', x: 0, z: 1, hp: 0, maxHp: 20, isKing: true,
        name: 'Spymaster Nyx', xp: 0, level: 1,
        stats: { command: 2, combat: 2, governance: 1 }, abilities: [], army: [],
      };
      const atk = makeUnit('INFANTRY', 'a', 0, 0);
      const combatant = lordCombatant(king);
      const result = resolveCombat(atk, combatant, 'CITY');
      expect(result.defenderDied).toBe(true);
      expect(king.hp).toBeLessThanOrEqual(0); // synced back: still dead
    });
  });
});
