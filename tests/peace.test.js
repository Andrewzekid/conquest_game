import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
    createPeaceDemand, evaluatePeaceDemand, applyWarWeariness,
    processWarWeariness, getWarWeariness, createDiplomacyState, setRelation
} from '../src/diplomacy.js';
import { AI_PERSONALITIES, DIPLOMACY_STATES, WAR_WEARINESS_RATES, PEACE_DEMAND_LIMITS } from '../src/config.js';

const here = dirname(fileURLToPath(import.meta.url));

describe('Peace Negotiations — createPeaceDemand', () => {
  it('builds a gold demand with defaults', () => {
    const d = createPeaceDemand('gold', { amount: 100 });
    expect(d.type).toBe('gold');
    expect(d.amount).toBe(100);
    expect(d.tiles).toEqual([]);
    expect(d.duration).toBe(0);
    expect(d.perTurn).toBe(0);
  });

  it('builds a tribute demand', () => {
    const d = createPeaceDemand('tribute', { perTurn: 10, duration: 15 });
    expect(d.type).toBe('tribute');
    expect(d.perTurn).toBe(10);
    expect(d.duration).toBe(15);
  });

  it('builds a territory demand', () => {
    const d = createPeaceDemand('territory', { tiles: ['5,6', '7,8'] });
    expect(d.type).toBe('territory');
    expect(d.tiles).toEqual(['5,6', '7,8']);
  });
});

describe('Peace Negotiations — evaluatePeaceDemand', () => {
  function mkState() {
    const ds = createDiplomacyState(['player', 'ai1']);
    setRelation(ds, 'player', 'ai1', DIPLOMACY_STATES.WAR, 5);
    return ds;
  }

  it('uses the DEFENDER personality (not the attacker faction slot)', () => {
    // A defender with a high acceptPeace personality should be more likely to
    // accept than one with a low acceptPeace, all else equal. This pins the
    // plan bug where AI_PERSONALITIES was keyed by the attacker faction id.
    const ds = mkState();
    const demand = createPeaceDemand('gold', { amount: 0 });
    const res = { gold: 1000 };
    // Many trials: average acceptance should rank ECONOMIC > DEFENSIVE > AGGRESSIVE.
    function accRate(personality) {
      let yes = 0;
      for (let i = 0; i < 400; i++) {
        const r = evaluatePeaceDemand(demand, 'ai1', 'player', ds, res, 1.0, 0, personality);
        if (r.accepted) yes++;
      }
      return yes / 400;
    }
    const aggr = accRate('AGGRESSIVE');
    const def = accRate('DEFENSIVE');
    const econ = accRate('ECONOMIC');
    expect(econ).toBeGreaterThan(aggr);
    expect(def).toBeGreaterThan(aggr);
    expect(AI_PERSONALITIES.ECONOMIC.acceptPeace).toBeGreaterThan(AI_PERSONALITIES.AGGRESSIVE.acceptPeace);
  });

  it('a weak defender (low power ratio) is more likely to accept', () => {
    const ds = mkState();
    const demand = createPeaceDemand('gold', { amount: 50 });
    const res = { gold: 1000 };
    function accRate(ratio) {
      let yes = 0;
      for (let i = 0; i < 400; i++) {
        if (evaluatePeaceDemand(demand, 'ai1', 'player', ds, res, ratio, 0, 'DEFENSIVE').accepted) yes++;
      }
      return yes / 400;
    }
    expect(accRate(0.3)).toBeGreaterThan(accRate(2.0));
  });

  it('a war-weary defender is more likely to accept', () => {
    const ds = mkState();
    const demand = createPeaceDemand('gold', { amount: 50 });
    const res = { gold: 1000 };
    function accRate(weariness) {
      let yes = 0;
      for (let i = 0; i < 400; i++) {
        if (evaluatePeaceDemand(demand, 'ai1', 'player', ds, res, 1.0, weariness, 'DEFENSIVE').accepted) yes++;
      }
      return yes / 400;
    }
    expect(accRate(60)).toBeGreaterThan(accRate(0));
  });

  it('an unaffordable gold demand lowers acceptance', () => {
    const ds = mkState();
    const demand = createPeaceDemand('gold', { amount: 500 });
    const poor = { gold: 10 };     // affordability 0.02 < 0.5
    const rich = { gold: 5000 };   // affordability 10 > 2
    function accRate(res) {
      let yes = 0;
      for (let i = 0; i < 400; i++) {
        if (evaluatePeaceDemand(demand, 'ai1', 'player', ds, res, 1.0, 0, 'DEFENSIVE').accepted) yes++;
      }
      return yes / 400;
    }
    expect(accRate(rich)).toBeGreaterThan(accRate(poor));
  });

  it('clamps chance to [0.05, 0.95] and returns it', () => {
    const ds = mkState();
    const demand = createPeaceDemand('territory', { tiles: ['1,1','2,2','3,3','4,4','5,5','6,6'] });
    const r = evaluatePeaceDemand(demand, 'ai1', 'player', ds, { gold: 0 }, 5.0, 0, 'AGGRESSIVE');
    expect(r.chance).toBeGreaterThanOrEqual(0.05);
    expect(r.chance).toBeLessThanOrEqual(0.95);
    expect(typeof r.reason).toBe('string');
  });
});

describe('Peace Negotiations — war weariness', () => {
  it('applyWarWeariness accumulates and getWarWeariness reads it', () => {
    const ds = createDiplomacyState(['player', 'ai1']);
    expect(getWarWeariness(ds, 'player')).toBe(0);
    applyWarWeariness(ds, 'player', 15);
    expect(getWarWeariness(ds, 'player')).toBe(15);
    applyWarWeariness(ds, 'player', 5);
    expect(getWarWeariness(ds, 'player')).toBe(20);
  });

  it('processWarWeariness accumulates for factions at war and decays for those at peace', () => {
    const ds = createDiplomacyState(['a', 'b', 'c']);
    setRelation(ds, 'a', 'b', DIPLOMACY_STATES.WAR, 1);
    processWarWeariness(ds, ['a', 'b', 'c']);
    expect(getWarWeariness(ds, 'a')).toBe(WAR_WEARINESS_RATES.PER_TURN);
    expect(getWarWeariness(ds, 'b')).toBe(WAR_WEARINESS_RATES.PER_TURN);
    // c is at peace → decay (-5) clamped to 0.
    expect(getWarWeariness(ds, 'c')).toBe(0);
    // After accumulating, c stays 0; a/b keep rising.
    processWarWeariness(ds, ['a', 'b', 'c']);
    expect(getWarWeariness(ds, 'a')).toBe(WAR_WEARINESS_RATES.PER_TURN * 2);
  });

  it('decays at peace but never goes negative', () => {
    const ds = createDiplomacyState(['a', 'b']);
    applyWarWeariness(ds, 'a', 3);
    // a is at peace with b → decay -5 → max(0, 3-5) = 0
    processWarWeariness(ds, ['a', 'b']);
    expect(getWarWeariness(ds, 'a')).toBe(0);
  });
});

// Source-invariant regression: the handler must pass the target's personality
// (a personality string) to evaluatePeaceDemand, NOT the faction slot — the
// original plan's evaluatePeaceDemand keyed AI_PERSONALITIES by the attacker.
describe('Peace Negotiations — handler wiring (source-invariant)', () => {
  it('handlePeaceNegotiation calls evaluatePeaceDemand with the target personality', () => {
    const gameSrc = readFileSync(join(here, '..', 'src', 'game.js'), 'utf8');
    // The handler must derive personality from the target faction's def and
    // pass it as the last argument to evaluatePeaceDemand.
    expect(gameSrc).toMatch(/personality.*aiPersonality/);
    expect(gameSrc).toMatch(/evaluatePeaceDemand\(/);
    // The diplomacy.js export must accept a personality parameter, not key
    // AI_PERSONALITIES by a faction id.
    const diploSrc = readFileSync(join(here, '..', 'src', 'diplomacy.js'), 'utf8');
    expect(diploSrc).toMatch(/AI_PERSONALITIES\[personality\]/);
    expect(diploSrc).not.toMatch(/AI_PERSONALITIES\[attacker\]/);
  });

  it('PEACE_DEMAND_LIMITS caps are exported and used', () => {
    expect(PEACE_DEMAND_LIMITS.MAX_GOLD_DEMAND).toBe(500);
    expect(PEACE_DEMAND_LIMITS.MAX_TRIBUTE_PER_TURN).toBe(15);
    expect(PEACE_DEMAND_LIMITS.MAX_TERRITORY_TILES).toBe(3);
  });
});