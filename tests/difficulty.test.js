import { describe, it, expect } from 'vitest';
import {
  getDifficulty, yieldMultiplier, upkeepMultiplier, aiAggression, aiXpMultiplier,
  applyDifficultyYield, applyDifficultyUpkeep, difficultyOptions, isPlayerSide
} from '../src/difficulty.js';
import { DIFFICULTY_PRESETS, DIFFICULTY_DEFAULT, PLAYER_FACTION } from '../src/config.js';

describe('Difficulty Settings (Feature 8)', () => {
  it('returns the requested preset and falls back to NORMAL for unknown keys', () => {
    expect(getDifficulty('HARD').key).toBe('HARD');
    expect(getDifficulty('nope').key).toBe(DIFFICULTY_DEFAULT);
    expect(getDifficulty(null).key).toBe(DIFFICULTY_DEFAULT);
  });

  it('applies the player yield multiplier to the player faction', () => {
    // EASY gives the player +10% yield (1.1).
    expect(yieldMultiplier('EASY', PLAYER_FACTION, PLAYER_FACTION)).toBeCloseTo(1.1);
    // HARD cuts the player's yield to 0.9.
    expect(yieldMultiplier('HARD', PLAYER_FACTION, PLAYER_FACTION)).toBeCloseTo(0.9);
  });

  it('applies the AI resource multiplier to AI factions', () => {
    expect(yieldMultiplier('HARD', 'ai1', PLAYER_FACTION)).toBeCloseTo(1.25);
    expect(yieldMultiplier('BRUTAL', 'ai1', PLAYER_FACTION)).toBeCloseTo(1.5);
  });

  it('upkeep multipliers differ for player vs AI', () => {
    expect(upkeepMultiplier('HARD', PLAYER_FACTION, PLAYER_FACTION)).toBeCloseTo(1.15);
    expect(upkeepMultiplier('HARD', 'ai1', PLAYER_FACTION)).toBeCloseTo(0.9);
  });

  it('aiAggression scales with difficulty', () => {
    expect(aiAggression('EASY')).toBeLessThan(aiAggression('NORMAL'));
    expect(aiAggression('BRUTAL')).toBeGreaterThan(aiAggression('HARD'));
  });

  it('applyDifficultyYield floors and scales the amount', () => {
    // AI on BRUTAL: 10 * 1.5 = 15
    expect(applyDifficultyYield(10, 'BRUTAL', 'ai1', PLAYER_FACTION)).toBe(15);
    // Player on HARD: 10 * 0.9 = 9
    expect(applyDifficultyYield(10, 'HARD', PLAYER_FACTION, PLAYER_FACTION)).toBe(9);
    expect(applyDifficultyYield(0, 'HARD', 'ai1', PLAYER_FACTION)).toBe(0);
  });

  it('applyDifficultyUpkeep floors and scales the cost', () => {
    // AI on BRUTAL: 10 * 0.8 = 8
    expect(applyDifficultyUpkeep(10, 'BRUTAL', 'ai1', PLAYER_FACTION)).toBe(8);
  });

  it('isPlayerSide distinguishes the human from AIs', () => {
    expect(isPlayerSide(PLAYER_FACTION, PLAYER_FACTION)).toBe(true);
    expect(isPlayerSide('ai1', PLAYER_FACTION)).toBe(false);
  });

  it('difficultyOptions lists all presets with labels', () => {
    const opts = difficultyOptions();
    expect(opts.length).toBe(Object.keys(DIFFICULTY_PRESETS).length);
    expect(opts.map(o => o.key)).toContain('EASY');
    expect(opts.map(o => o.key)).toContain('BRUTAL');
    expect(opts.every(o => typeof o.label === 'string')).toBe(true);
  });

  it('NORMAL is the identity (1.0 multipliers)', () => {
    const n = getDifficulty('NORMAL');
    expect(n.aiResourceMult).toBe(1);
    expect(n.playerYieldMult).toBe(1);
    expect(n.playerUpkeepMult).toBe(1);
  });

  it('aiXpMultiplier rises on harder difficulties', () => {
    expect(aiXpMultiplier('BRUTAL')).toBeGreaterThan(aiXpMultiplier('NORMAL'));
  });
});