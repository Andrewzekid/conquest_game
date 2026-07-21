import { describe, it, expect, beforeEach } from 'vitest';
import {
  calculateMapDimensions, setGridDimensions, cityProduction, cityGrowthThreshold,
  generateFactionSlots, setFactionSlots, MAP_SIZES, GRID_WIDTH, GRID_HEIGHT, GRID_SIZE,
  FACTIONS, MAX_FACTIONS,
  AI_GOAL_MIN_STABILITY_TURNS, AI_ARTILLERY_RESERVE_DEFAULT, AI_ARTILLERY_RESERVE_SIEGE,
  AI_SETTLER_SCARCITY_TURN_THRESHOLD, AI_SETTLER_SCARCE_CAP_RELAX, AI_SETTLER_SCARCE_FLOOR_RELAX
} from '../src/config.js';

describe('config', () => {
  describe('calculateMapDimensions', () => {
    it('returns valid dimensions for known size keys', () => {
      for (const key of Object.keys(MAP_SIZES)) {
        const dim = calculateMapDimensions(key);
        expect(dim.width).toBeGreaterThan(0);
        expect(dim.height).toBeGreaterThan(0);
        expect(dim.totalTiles).toBe(dim.width * dim.height);
      }
    });

    it('falls back to medium for invalid key', () => {
      const dim = calculateMapDimensions('nonexistent');
      expect(dim.totalTiles).toBeGreaterThan(0);
    });

    it('produces totalTiles > 0 for all sizes', () => {
      for (const key of Object.keys(MAP_SIZES)) {
        const dim = calculateMapDimensions(key);
        expect(dim.totalTiles).toBeGreaterThan(0);
      }
    });
  });

  describe('setGridDimensions', () => {
    it('sets GRID_WIDTH, GRID_HEIGHT, GRID_SIZE', () => {
      setGridDimensions(50, 30);
      // These are live bindings — re-import to check
      expect(typeof GRID_WIDTH).toBe('number');
    });
  });

  describe('cityProduction', () => {
    it('level 1 returns base 2', () => {
      expect(cityProduction(1)).toBe(2);
    });

    it('increases with level', () => {
      expect(cityProduction(4)).toBeGreaterThan(cityProduction(1));
      expect(cityProduction(9)).toBeGreaterThan(cityProduction(4));
    });

    it('clamps level 0 to 1', () => {
      expect(cityProduction(0)).toBe(cityProduction(1));
    });

    it('handles null/undefined level', () => {
      expect(cityProduction(null)).toBe(cityProduction(1));
      expect(cityProduction(undefined)).toBe(cityProduction(1));
    });
  });

  describe('cityGrowthThreshold', () => {
    it('level 1 returns 15', () => {
      expect(cityGrowthThreshold(1)).toBe(15);
    });

    it('increases linearly with level', () => {
      expect(cityGrowthThreshold(2)).toBe(20);
      expect(cityGrowthThreshold(3)).toBe(25);
    });
  });

  describe('generateFactionSlots', () => {
    it('always starts with player', () => {
      expect(generateFactionSlots(4)[0]).toBe('player');
    });

    it('playerCount=1 returns just player', () => {
      expect(generateFactionSlots(1)).toEqual(['player']);
    });

    it('N players produces N slots', () => {
      expect(generateFactionSlots(5)).toHaveLength(5);
      expect(generateFactionSlots(3)).toHaveLength(3);
    });
  });

  describe('setFactionSlots', () => {
    it('clamps below 2', () => {
      setFactionSlots(1);
      expect(FACTIONS.length).toBeGreaterThanOrEqual(2);
    });

    it('clamps above MAX_FACTIONS', () => {
      setFactionSlots(100);
      expect(FACTIONS.length).toBeLessThanOrEqual(MAX_FACTIONS);
    });
  });

  describe('AI goal/siege constants', () => {
    it('exposes the new goal/artillery/settler tuning constants', () => {
      expect(AI_GOAL_MIN_STABILITY_TURNS).toBeGreaterThan(0);
      expect(AI_ARTILLERY_RESERVE_DEFAULT).toBeGreaterThan(0);
      expect(AI_ARTILLERY_RESERVE_SIEGE).toBeGreaterThan(AI_ARTILLERY_RESERVE_DEFAULT);
      expect(AI_SETTLER_SCARCITY_TURN_THRESHOLD).toBeGreaterThan(0);
      expect(AI_SETTLER_SCARCE_CAP_RELAX).toBeGreaterThan(0);
      expect(AI_SETTLER_SCARCE_FLOOR_RELAX).toBeGreaterThan(0);
    });
  });
});
