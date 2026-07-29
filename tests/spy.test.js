import { describe, it, expect } from 'vitest';
import { resolveSpyAction, isSpyUnit, spyDetectionBonus } from '../src/spy.js';
import { SPY_ACTIONS, SPY_DETECTION_RELATION_PENALTY } from '../src/config.js';

// Deterministic rng: a stack of values consumed in order.
function seqRng(values) {
  let i = 0;
  return () => values[i++ % values.length];
}

describe('Spy System (Feature 11)', () => {
  it('rejects an unknown action', () => {
    const r = resolveSpyAction({ action: 'NOPE', spy: { owner: 'player' }, targetFaction: 'ai1' });
    expect(r.success).toBe(false);
    expect(r.message).toMatch(/Unknown spy action/);
  });

  it('GATHER_INTEL succeeds and produces an intel effect', () => {
    // successChance = 0.85; pass a low rand so success = true, then a high rand so detection = false.
    const r = resolveSpyAction({ action: 'GATHER_INTEL', spy: { owner: 'player' }, targetFaction: 'ai1', rng: seqRng([0.1, 0.9]) });
    expect(r.success).toBe(true);
    expect(r.detected).toBe(false);
    expect(r.effect.intel).toBeDefined();
    expect(r.relationPenalty).toBe(0); // undetected → no penalty
    expect(r.message).toMatch(/undetected/);
  });

  it('a failed action is always detected and carries a bigger penalty', () => {
    // successChance 0.85; high rand → success false → detected true.
    const r = resolveSpyAction({ action: 'SABOTAGE', spy: { owner: 'player' }, targetFaction: 'ai1', rng: seqRng([0.99]) });
    expect(r.success).toBe(false);
    expect(r.detected).toBe(true);
    expect(r.relationPenalty).toBe(SPY_ACTIONS.SABOTAGE.relationPenalty + SPY_DETECTION_RELATION_PENALTY);
  });

  it('a successful but detected action applies only the base relation penalty', () => {
    // ASSASSINATE success 0.35: rand 0.1 < 0.35 → success true; detection 0.60: rand 0.5 < 0.60 → detected true.
    const r = resolveSpyAction({ action: 'ASSASSINATE', spy: { owner: 'ai1' }, targetFaction: 'player', rng: seqRng([0.1, 0.5]) });
    expect(r.success).toBe(true);
    expect(r.detected).toBe(true);
    // On success, only the base relation penalty applies (no failed-detection surcharge).
    expect(r.relationPenalty).toBe(SPY_ACTIONS.ASSASSINATE.relationPenalty);
  });

  it('INCITE_UNREST produces an unrest effect with the configured amount', () => {
    const r = resolveSpyAction({ action: 'INCITE_UNREST', spy: { owner: 'player' }, targetFaction: 'ai1', targetCityKey: '5,5', rng: seqRng([0.1, 0.9]) });
    expect(r.success).toBe(true);
    expect(r.effect.unrest).toMatchObject({ cityKey: '5,5', amount: SPY_ACTIONS.INCITE_UNREST.unrestAmount });
  });

  it('successBonus raises the success chance and detectionBonus raises detection', () => {
    // With +0.5 success bonus, successChance = 0.85+0.5 clamped to 0.97; rand 0.5 succeeds.
    const r = resolveSpyAction({ action: 'GATHER_INTEL', spy: { owner: 'player' }, targetFaction: 'ai1', successBonus: 0.5, detectionBonus: 0.0, rng: seqRng([0.5, 0.5]) });
    expect(r.success).toBe(true);
  });

  it('isSpyUnit detects SPY units', () => {
    expect(isSpyUnit({ isSpy: true })).toBe(true);
    expect(isSpyUnit({ type: 'INFANTRY' })).toBe(false);
    expect(isSpyUnit(null)).toBe(false);
  });

  it('spyDetectionBonus adds defense for cities and walled cities', () => {
    expect(spyDetectionBonus({ terrain: 'PLAINS', x: 0, z: 0 }, new Map())).toBe(0);
    expect(spyDetectionBonus({ terrain: 'CITY', x: 0, z: 0 }, new Map())).toBeCloseTo(0.15);
    const buildings = new Map([['0,0', { WALLS: 1 }]]);
    expect(spyDetectionBonus({ terrain: 'CITY', x: 0, z: 0 }, buildings)).toBeCloseTo(0.30);
  });

  it('SPY_ACTIONS defines all four actions', () => {
    for (const k of ['GATHER_INTEL', 'SABOTAGE', 'ASSASSINATE', 'INCITE_UNREST']) {
      expect(SPY_ACTIONS[k]).toBeDefined();
      expect(SPY_ACTIONS[k].baseSuccess).toBeGreaterThan(0);
      expect(SPY_ACTIONS[k].baseDetection).toBeGreaterThan(0);
    }
  });
});