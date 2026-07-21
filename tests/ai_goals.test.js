import { describe, it, expect } from 'vitest';
import {
  createAIState, initAIState, selectGoals, serializeAIState, deserializeAIState
} from '../src/ai_goals.js';

// A reusable base context for selectGoals. Most fields default in the
// function; tests override only what matters.
function baseInput(overrides = {}) {
  return {
    aiState: createAIState(),
    turn: 1,
    factionDef: { id: 'crimson', aiPersonality: 'AGGRESSIVE' },
    enemies: ['azure'],
    enemyCities: [{ x: 5, z: 5, owner: 'azure' }],
    ownCities: [{ x: 0, z: 0 }],
    homeAnchor: { x: 0, z: 0 },
    activeObjectives: { defensive: false },
    threatenedOwnCity: null,
    isIslandFaction: false,
    needsNavalExpansion: false,
    foreignMassWithoutCity: false,
    myCityCount: 1,
    settlerTarget: 8,
    scarcityTriggered: false,
    bestFoundSpotKey: '3,3',
    foreignShoreKey: null,
    bestEconTileKey: null,
    ...overrides,
  };
}

describe('ai_goals.selectGoals', () => {
  it('aggressive at-war faction picks conquest as the top goal', () => {
    const goals = selectGoals(baseInput());
    expect(goals.length).toBeGreaterThan(0);
    expect(goals[0].kind).toBe('conquest');
    expect(goals[0].targetTileKey).toBe('5,5');
    expect(goals[0].targetFaction).toBe('azure');
  });

  it('economic faction at peace with few cities prefers settle/develop-economy', () => {
    const goals = selectGoals(baseInput({
      factionDef: { id: 'verdant', aiPersonality: 'ECONOMIC' },
      enemies: [],
      enemyCities: [],
      myCityCount: 2,
      settlerTarget: 8,
    }));
    // No war -> no conquest. Settle should outrank develop-economy for ECONOMIC
    // (settle weight 1.3 vs economy 1.4 but settle base 70 vs economy 50).
    expect(goals[0].kind).toBe('settle');
  });

  it('defensive objective + threatened city yields a defense goal', () => {
    const goals = selectGoals(baseInput({
      factionDef: { id: 'frost', aiPersonality: 'DEFENSIVE' },
      activeObjectives: { defensive: true },
      threatenedOwnCity: { x: 0, z: 0 },
      enemies: ['crimson'],
      enemyCities: [{ x: 1, z: 1, owner: 'crimson' }],
    }));
    const defense = goals.find(g => g.kind === 'defense');
    expect(defense).toBeTruthy();
    expect(defense.targetTileKey).toBe('0,0');
  });

  it('island faction with foreign land produces an expand-islands goal', () => {
    const goals = selectGoals(baseInput({
      factionDef: { id: 'storm', aiPersonality: 'BALANCED' },
      isIslandFaction: true,
      foreignMassWithoutCity: true,
      enemies: [],
      enemyCities: [],
      bestFoundSpotKey: null, // home mass full -> settle may be absent
    }));
    const expand = goals.find(g => g.kind === 'expand-islands');
    expect(expand).toBeTruthy();
  });

  it('develop-economy is always present as a baseline', () => {
    const goals = selectGoals(baseInput());
    expect(goals.some(g => g.kind === 'develop-economy')).toBe(true);
  });

  it('is stable across consecutive calls within the lock window', () => {
    const aiState = createAIState();
    const input = baseInput({ aiState, turn: 1 });
    const g1 = selectGoals(input);
    input.turn = 2; // still within planLockUntil (1 + 3 = 4)
    const g2 = selectGoals(input);
    expect(g2).toBe(g1); // same array reference -> no replan
  });

  it('forces a replan when the dominant goal becomes invalid (peace)', () => {
    const aiState = createAIState();
    let input = baseInput({ aiState, turn: 1 });
    const g1 = selectGoals(input);
    expect(g1[0].kind).toBe('conquest');
    // War ends: enemies gone, within lock window.
    input = baseInput({ aiState, turn: 2, enemies: [], enemyCities: [] });
    const g2 = selectGoals(input);
    expect(g2[0].kind).not.toBe('conquest');
  });

  it('keeps a conquest goal while still at war within the lock window', () => {
    const aiState = createAIState();
    let input = baseInput({ aiState, turn: 1 });
    selectGoals(input);
    input = baseInput({ aiState, turn: 2 }); // same war state
    const g2 = selectGoals(input);
    expect(g2[0].kind).toBe('conquest');
  });

  it('priorities are normalized to <= 1 with the top goal at 1', () => {
    const goals = selectGoals(baseInput());
    expect(goals[0].priority).toBeCloseTo(1, 5);
    for (const g of goals) expect(g.priority).toBeLessThanOrEqual(1.0001);
  });

  it('writes goals + caches settle found-spot into aiState', () => {
    const aiState = createAIState();
    selectGoals(baseInput({ aiState, turn: 5 }));
    expect(aiState.goals.length).toBeGreaterThan(0);
    expect(aiState.lastPlanTurn).toBe(5);
    expect(aiState.planLockUntil).toBe(5 + 3);
    expect(aiState.progress.settle.lastTileKey).toBe('3,3');
  });
});

describe('ai_goals serialization', () => {
  it('initAIState initializes every faction', () => {
    const s = initAIState(['a', 'b']);
    expect(s.a.goals).toEqual([]);
    expect(s.b.goals).toEqual([]);
  });

  it('serialize/deserialize round-trips aiState', () => {
    const aiState = createAIState();
    selectGoals(baseInput({ aiState, turn: 3 }));
    const round = deserializeAIState(serializeAIState(aiState));
    expect(round.goals.length).toBe(aiState.goals.length);
    expect(round.goals[0].kind).toBe(aiState.goals[0].kind);
    expect(round.lastPlanTurn).toBe(3);
  });

  it('handles null gracefully', () => {
    expect(serializeAIState(null)).toBeNull();
    expect(deserializeAIState(null)).toBeNull();
  });
});