import { describe, it, expect } from 'vitest';
import {
  adjustDiplomacyByGoal, shouldDeclareWar, shouldAcceptPeace
} from '../src/ai_diplomacy.js';
import { AI_PERSONALITIES } from '../src/config.js';

describe('adjustDiplomacyByGoal', () => {
  it('returns base chances when no goals', () => {
    const result = adjustDiplomacyByGoal([], null, 'golden', 'BALANCED', 10);
    const base = AI_PERSONALITIES.BALANCED;
    expect(result.warChance).toBe(base.warChance);
    expect(result.acceptTrade).toBe(base.acceptTrade);
  });

  it('conquest goal increases war chance and reduces peace/trade', () => {
    const goals = [{ kind: 'conquest', targetFaction: 'azure' }];
    const result = adjustDiplomacyByGoal(goals, null, 'golden', 'BALANCED', 10);
    const base = AI_PERSONALITIES.BALANCED;
    expect(result.warChance).toBeGreaterThan(base.warChance);
    expect(result.acceptTrade).toBeLessThan(base.acceptTrade);
    expect(result.acceptPeace).toBeLessThan(base.acceptPeace);
  });

  it('defense goal reduces war chance and increases peace', () => {
    const goals = [{ kind: 'defense' }];
    const result = adjustDiplomacyByGoal(goals, null, 'golden', 'BALANCED', 10);
    const base = AI_PERSONALITIES.BALANCED;
    expect(result.warChance).toBeLessThan(base.warChance);
    expect(result.acceptPeace).toBeGreaterThan(base.acceptPeace);
  });

  it('develop-economy goal increases trade acceptance', () => {
    const goals = [{ kind: 'develop-economy' }];
    const result = adjustDiplomacyByGoal(goals, null, 'golden', 'BALANCED', 10);
    const base = AI_PERSONALITIES.BALANCED;
    expect(result.acceptTrade).toBeGreaterThan(base.acceptTrade);
    expect(result.warChance).toBeLessThan(base.warChance);
  });

  it('diplomacy goal maximizes trade and alliance', () => {
    const goals = [{ kind: 'diplomacy' }];
    const result = adjustDiplomacyByGoal(goals, null, 'golden', 'BALANCED', 10);
    const base = AI_PERSONALITIES.BALANCED;
    expect(result.acceptTrade).toBeGreaterThan(base.acceptTrade);
    expect(result.acceptAlliance).toBeGreaterThan(base.acceptAlliance);
  });

  it('respects caps and floors', () => {
    const goals = [{ kind: 'conquest' }];
    const result = adjustDiplomacyByGoal(goals, null, 'golden', 'AGGRESSIVE', 10);
    expect(result.warChance).toBeLessThanOrEqual(1.0);
    expect(result.acceptPeace).toBeGreaterThanOrEqual(0.05);
    expect(result.acceptTrade).toBeGreaterThanOrEqual(0.05);
  });
});

describe('shouldDeclareWar', () => {
  it('does not declare if already at war', () => {
    const diploState = {
      relations: { 'azure:golden': { state: 'war' } }
    };
    const result = shouldDeclareWar({}, diploState, 'golden', 'azure', 2.0);
    expect(result.declare).toBe(false);
    expect(result.reason).toBe('already_at_war');
  });

  it('declares war when conquest goal targets the faction and we are stronger', () => {
    const aiState = {
      goals: [{ kind: 'conquest', targetFaction: 'azure' }]
    };
    const result = shouldDeclareWar(aiState, {}, 'golden', 'azure', 1.5);
    expect(result.declare).toBe(true);
    expect(result.reason).toBe('conquest_goal_stronger');
  });

  it('does not declare when conquest goal targets faction but we are weaker', () => {
    const aiState = {
      goals: [{ kind: 'conquest', targetFaction: 'azure' }]
    };
    const result = shouldDeclareWar(aiState, {}, 'golden', 'azure', 0.8);
    expect(result.declare).toBe(false);
    expect(result.reason).toBe('conquest_goal_but_weaker');
  });

  it('aggressive personality declares with large power advantage', () => {
    const aiState = {
      goals: [{ kind: 'develop-economy' }],
      personality: 'AGGRESSIVE'
    };
    const result = shouldDeclareWar(aiState, {}, 'golden', 'azure', 2.0);
    expect(result.declare).toBe(true);
    expect(result.reason).toBe('aggressive_power_advantage');
  });

  it('non-aggressive does not declare without conquest goal', () => {
    const aiState = {
      goals: [{ kind: 'develop-economy' }],
      personality: 'DEFENSIVE'
    };
    const result = shouldDeclareWar(aiState, {}, 'golden', 'azure', 2.0);
    expect(result.declare).toBe(false);
  });
});

describe('shouldAcceptPeace', () => {
  it('rejects peace during active conquest', () => {
    const aiState = {
      goals: [{ kind: 'conquest', targetFaction: 'azure' }]
    };
    const result = shouldAcceptPeace(aiState, {}, 'golden', 'azure', 5);
    expect(result.accept).toBe(false);
    expect(result.reason).toBe('conquest_in_progress');
  });

  it('accepts peace after heavy army losses', () => {
    const aiState = { goals: [{ kind: 'conquest', targetFaction: 'crimson' }] };
    const result = shouldAcceptPeace(aiState, {}, 'golden', 'azure', 10, 0.5);
    expect(result.accept).toBe(true);
    expect(result.reason).toBe('heavy_army_losses');
  });

  it('accepts peace after long war with no objective', () => {
    const aiState = { goals: [{ kind: 'develop-economy' }] };
    const result = shouldAcceptPeace(aiState, {}, 'golden', 'azure', 20);
    expect(result.accept).toBe(true);
    expect(result.reason).toBe('long_war_no_objective');
  });

  it('defense goal accepts peace after 5+ turns', () => {
    const aiState = { goals: [{ kind: 'defense' }] };
    const result = shouldAcceptPeace(aiState, {}, 'golden', 'azure', 6);
    expect(result.accept).toBe(true);
    expect(result.reason).toBe('defense_goal_war_weary');
  });

  it('spy goal rejects peace early to gather intel', () => {
    const aiState = {
      goals: [{ kind: 'spy', targetFaction: 'azure' }]
    };
    const result = shouldAcceptPeace(aiState, {}, 'golden', 'azure', 4);
    expect(result.accept).toBe(false);
    expect(result.reason).toBe('spy_intel_in_progress');
  });

  it('spy goal accepts peace after enough time', () => {
    const aiState = {
      goals: [{ kind: 'spy', targetFaction: 'azure' }]
    };
    const result = shouldAcceptPeace(aiState, {}, 'golden', 'azure', 10);
    expect(result.accept).toBe(true);
  });
});
