import { describe, it, expect } from 'vitest';
import {
  createLord, lordMaxHp, lordAttack, lordDefense, lordCombatant,
  awardXP, maxArmySize, canCommand, assignArmy, findCommandingLord,
  getLordClassBonus, getLordCombatBonus, kingGuardBonus, syncLordHp
} from '../src/lords.js';

describe('lords', () => {
  describe('createLord', () => {
    it('creates lord with correct owner and position', () => {
      const lord = createLord('player', 5, 5, 'TestLord', 'WARLORD');
      expect(lord.owner).toBe('player');
      expect(lord.x).toBe(5);
      expect(lord.z).toBe(5);
      expect(lord.name).toBe('TestLord');
      expect(lord.class).toBe('WARLORD');
    });

    it('random class if not specified', () => {
      const lord = createLord('player', 0, 0);
      expect(lord.class).toBeDefined();
    });

    it('maxHp is set', () => {
      const lord = createLord('player', 0, 0);
      expect(lord.maxHp).toBeGreaterThan(0);
      expect(lord.hp).toBe(lord.maxHp);
    });
  });

  describe('lordMaxHp', () => {
    it('regular lord formula', () => {
      const lord = createLord('player', 0, 0, 'T', 'WARLORD');
      lord.isKing = false;
      lord.level = 1;
      expect(lordMaxHp(lord)).toBe(18);
    });

    it('king gets bonus', () => {
      const lord = createLord('player', 0, 0, 'T', 'WARLORD');
      lord.isKing = true;
      lord.level = 1;
      expect(lordMaxHp(lord)).toBeGreaterThanOrEqual(55);
    });

    it('null returns 1', () => {
      expect(lordMaxHp(null)).toBe(1);
    });
  });

  describe('lordAttack', () => {
    it('includes combat stat + class bonus + non-king bonus', () => {
      const lord = createLord('player', 0, 0, 'T', 'WARLORD');
      lord.isKing = false;
      const atk = lordAttack(lord);
      expect(atk).toBeGreaterThan(0);
    });

    it('king gets extra bonus', () => {
      const lord = createLord('player', 0, 0, 'T', 'WARLORD');
      lord.isKing = true;
      const normalLord = createLord('player', 0, 0, 'T', 'WARLORD');
      normalLord.isKing = false;
      expect(lordAttack(lord)).toBeGreaterThan(lordAttack(normalLord));
    });

    it('null returns 0', () => {
      expect(lordAttack(null)).toBe(0);
    });
  });

  describe('lordDefense', () => {
    it('includes command stat + class bonus', () => {
      const lord = createLord('player', 0, 0, 'T', 'GUARDIAN');
      const def = lordDefense(lord);
      expect(def).toBeGreaterThan(0);
    });

    it('null returns 0', () => {
      expect(lordDefense(null)).toBe(0);
    });
  });

  describe('lordCombatant', () => {
    it('returns unit-like object', () => {
      const lord = createLord('player', 0, 0, 'T', 'WARLORD');
      const c = lordCombatant(lord);
      expect(c._isLord).toBe(true);
      expect(c.type).toBe('LORD');
      expect(c.hp).toBe(lord.hp);
    });

    it('null returns null', () => {
      expect(lordCombatant(null)).toBeNull();
    });
  });

  describe('syncLordHp', () => {
    it('syncs hp back to lord', () => {
      const lord = createLord('player', 0, 0, 'T', 'WARLORD');
      const c = lordCombatant(lord);
      c.hp = 5;
      syncLordHp(c);
      expect(lord.hp).toBe(5);
    });
  });

  describe('awardXP', () => {
    it('awards XP', () => {
      const lord = createLord('player', 0, 0, 'T', 'WARLORD');
      lord.xp = 0;
      awardXP(lord, 10);
      expect(lord.xp).toBe(10);
    });

    it('level up at threshold', () => {
      const lord = createLord('player', 0, 0, 'T', 'WARLORD');
      const msgs = awardXP(lord, 50);
      expect(lord.level).toBe(2);
      expect(msgs.some(m => m.includes('reached level'))).toBe(true);
    });

    it('ability unlocks at correct level', () => {
      const lord = createLord('player', 0, 0, 'T', 'WARLORD');
      awardXP(lord, 50); // level 2 - should unlock RALLY (unlockLevel: 2)
      expect(lord.abilities).toContain('RALLY');
    });
  });

  describe('maxArmySize', () => {
    it('base 2 + command stat', () => {
      const lord = createLord('player', 0, 0, 'T', 'WARLORD');
      expect(maxArmySize(lord)).toBeGreaterThanOrEqual(4);
    });

    it('king gets +3', () => {
      const lord = createLord('player', 0, 0, 'T', 'WARLORD');
      lord.isKing = true;
      expect(maxArmySize(lord)).toBeGreaterThanOrEqual(7);
    });

    it('null returns 0', () => {
      expect(maxArmySize(null)).toBe(0);
    });
  });

  describe('canCommand', () => {
    it('true when army has room', () => {
      const lord = createLord('player', 0, 0, 'T', 'WARLORD');
      expect(canCommand(lord)).toBe(true);
    });

    it('false for null', () => {
      expect(canCommand(null)).toBeFalsy();
    });
  });

  describe('assignArmy', () => {
    it('adds unit to army', () => {
      const lord = createLord('player', 0, 0, 'T', 'WARLORD');
      assignArmy(lord, 42);
      expect(lord.army).toContain(42);
    });

    it('clears governing city', () => {
      const lord = createLord('player', 0, 0, 'T', 'WARLORD');
      lord.governingCity = '5,5';
      assignArmy(lord, 42);
      expect(lord.governingCity).toBeNull();
    });
  });

  describe('findCommandingLord', () => {
    it('finds by army membership', () => {
      const lord = createLord('player', 0, 0, 'T', 'WARLORD');
      assignArmy(lord, 42);
      const unit = { id: 42, owner: 'player', x: 10, z: 10 };
      expect(findCommandingLord([lord], unit)).toBe(lord);
    });

    it('finds by proximity', () => {
      const lord = createLord('player', 5, 5, 'T', 'WARLORD');
      const unit = { id: 99, owner: 'player', x: 5, z: 5 };
      expect(findCommandingLord([lord], unit)).toBe(lord);
    });

    it('null for no match', () => {
      const lord = createLord('player', 0, 0, 'T', 'WARLORD');
      const unit = { id: 99, owner: 'other', x: 100, z: 100 };
      expect(findCommandingLord([lord], unit)).toBeNull();
    });
  });

  describe('getLordClassBonus', () => {
    it('returns class bonuses', () => {
      const lord = createLord('player', 0, 0, 'T', 'WARLORD');
      const bonus = getLordClassBonus(lord);
      expect(bonus.attack).toBe(2);
    });

    it('null returns zeros', () => {
      expect(getLordClassBonus(null)).toEqual({ attack: 0, defense: 0, siege: 0 });
    });
  });

  describe('getLordCombatBonus', () => {
    it('returns stats as attack/defense', () => {
      const lord = createLord('player', 0, 0, 'T', 'WARLORD');
      const bonus = getLordCombatBonus(lord);
      expect(bonus.attack).toBe(lord.stats.combat);
      expect(bonus.defense).toBe(lord.stats.command);
    });

    it('null returns zeros', () => {
      expect(getLordCombatBonus(null)).toEqual({ attack: 0, defense: 0 });
    });
  });

  describe('kingGuardBonus', () => {
    it('returns 0 for non-king', () => {
      const lord = createLord('player', 0, 0, 'T', 'WARLORD');
      expect(kingGuardBonus(lord)).toBe(0);
    });

    it('scales with army size', () => {
      const lord = createLord('player', 0, 0, 'T', 'WARLORD');
      lord.isKing = true;
      lord.army = [1, 2, 3];
      expect(kingGuardBonus(lord)).toBe(3);
    });

    it('caps at 5', () => {
      const lord = createLord('player', 0, 0, 'T', 'WARLORD');
      lord.isKing = true;
      lord.army = [1, 2, 3, 4, 5, 6, 7];
      expect(kingGuardBonus(lord)).toBe(5);
    });
  });
});
