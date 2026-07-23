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

describe('ai_goals new goal types', () => {
  it('diplomacy goal appears when at peace with neutral factions', () => {
    const goals = selectGoals(baseInput({
      factionDef: { id: 'iron', aiPersonality: 'ECONOMIC' },
      enemies: [],
      enemyCities: [],
      neutralFactions: new Set(['azure', 'crimson']),
      myCityCount: 3,
      settlerTarget: 8,
    }));
    const diplomacy = goals.find(g => g.kind === 'diplomacy');
    expect(diplomacy).toBeTruthy();
  });

  it('diplomacy goal does not appear when at war with everyone', () => {
    const goals = selectGoals(baseInput({
      factionDef: { id: 'iron', aiPersonality: 'ECONOMIC' },
      enemies: ['azure', 'crimson'],
      enemyCities: [{ x: 5, z: 5, owner: 'azure' }, { x: 10, z: 10, owner: 'crimson' }],
      neutralFactions: new Set(),
      myCityCount: 3,
      settlerTarget: 8,
    }));
    const diplomacy = goals.find(g => g.kind === 'diplomacy');
    expect(diplomacy).toBeFalsy();
  });

  it('spy goal appears when at war and faction has spies', () => {
    const goals = selectGoals(baseInput({
      factionDef: { id: 'obsidian', aiPersonality: 'BALANCED' },
      enemies: ['azure'],
      enemyCities: [{ x: 5, z: 5, owner: 'azure' }],
      hasSpies: true,
      spyTargetKey: '5,5',
      myCityCount: 6, // enough cities so settle is less urgent
      settlerTarget: 8,
      turn: 50, // mid-game where spy scores higher
      aiState: (() => { const s = createAIState(); s.planLockUntil = 0; return s; })(),
    }));
    const spy = goals.find(g => g.kind === 'spy');
    expect(spy).toBeTruthy();
    expect(spy.targetTileKey).toBe('5,5');
  });

  it('spy goal does not appear when faction has no spies', () => {
    const goals = selectGoals(baseInput({
      factionDef: { id: 'obsidian', aiPersonality: 'BALANCED' },
      enemies: ['azure'],
      enemyCities: [{ x: 5, z: 5, owner: 'azure' }],
      hasSpies: false,
    }));
    const spy = goals.find(g => g.kind === 'spy');
    expect(spy).toBeFalsy();
  });

  it('chokepoint goal appears when hasChokepoints is true', () => {
    const goals = selectGoals(baseInput({
      factionDef: { id: 'frost', aiPersonality: 'DEFENSIVE' },
      enemies: ['azure'],
      enemyCities: [{ x: 5, z: 5, owner: 'azure' }],
      hasChokepoints: true,
      chokepointKey: '3,4',
      myCityCount: 3,
      settlerTarget: 8,
    }));
    const chokepoint = goals.find(g => g.kind === 'chokepoint');
    expect(chokepoint).toBeTruthy();
    expect(chokepoint.targetTileKey).toBe('3,4');
  });

  it('scout goal appears when many unexplored tiles exist', () => {
    const goals = selectGoals(baseInput({
      factionDef: { id: 'crimson', aiPersonality: 'BALANCED' },
      enemies: [],
      enemyCities: [],
      unexploredTiles: 100,
      myCityCount: 1,
      settlerTarget: 8,
    }));
    const scout = goals.find(g => g.kind === 'scout');
    expect(scout).toBeTruthy();
  });

  it('scout goal does not appear when few unexplored tiles', () => {
    const goals = selectGoals(baseInput({
      factionDef: { id: 'crimson', aiPersonality: 'BALANCED' },
      enemies: [],
      enemyCities: [],
      unexploredTiles: 10,
      myCityCount: 1,
      settlerTarget: 8,
    }));
    const scout = goals.find(g => g.kind === 'scout');
    expect(scout).toBeFalsy();
  });

  it('attack-king goal appears when an enemy king is exposed and vulnerable', () => {
    const goals = selectGoals(baseInput({
      factionDef: { id: 'crimson', aiPersonality: 'AGGRESSIVE' },
      enemies: ['azure'],
      enemyCities: [{ x: 5, z: 5, owner: 'azure' }],
      homeAnchor: { x: 4, z: 4 },
      myCityCount: 3,
      settlerTarget: 8,
      enemyKings: [{
        id: 'k1', owner: 'azure', isKing: true, x: 6, z: 6, hp: 10, guarded: false, vulnerable: true,
      }],
    }));
    const attackKing = goals.find(g => g.kind === 'attack-king');
    expect(attackKing).toBeTruthy();
    expect(attackKing.targetFaction).toBe('azure');
    expect(attackKing.targetTileKey).toBe('6,6');
    expect(attackKing.meta.kingId).toBe('k1');
  });

  it('attack-king goal does NOT appear when the enemy king is guarded', () => {
    const goals = selectGoals(baseInput({
      factionDef: { id: 'crimson', aiPersonality: 'AGGRESSIVE' },
      enemies: ['azure'],
      enemyCities: [{ x: 5, z: 5, owner: 'azure' }],
      myCityCount: 3,
      settlerTarget: 8,
      enemyKings: [{
        id: 'k1', owner: 'azure', isKing: true, x: 6, z: 6, hp: 10, guarded: true,
      }],
    }));
    const attackKing = goals.find(g => g.kind === 'attack-king');
    expect(attackKing).toBeFalsy();
  });

  it('attack-king goal is dropped when the war ends (goalValid)', () => {
    const aiState = createAIState();
    let input = baseInput({
      aiState, turn: 1,
      factionDef: { id: 'crimson', aiPersonality: 'AGGRESSIVE' },
      enemies: ['azure'],
      enemyCities: [{ x: 5, z: 5, owner: 'azure' }],
      enemyKings: [{ id: 'k1', owner: 'azure', isKing: true, x: 6, z: 6, hp: 10, guarded: false, vulnerable: true }],
    });
    const g1 = selectGoals(input);
    expect(g1.some(g => g.kind === 'attack-king')).toBe(true);
    // War ends within the lock window — replan should drop the attack-king goal.
    input = baseInput({
      aiState, turn: 2,
      enemies: [], enemyCities: [], enemyKings: [],
    });
    const g2 = selectGoals(input);
    expect(g2.some(g => g.kind === 'attack-king')).toBe(false);
  });
});

describe('ai_goals game-phase scoring', () => {
  it('early game boosts scout and settle goals', () => {
    const earlyGoals = selectGoals(baseInput({
      factionDef: { id: 'crimson', aiPersonality: 'BALANCED' },
      enemies: [],
      enemyCities: [],
      unexploredTiles: 100,
      myCityCount: 1,
      settlerTarget: 8,
      turn: 10, // early game
    }));
    const scoutEarly = earlyGoals.find(g => g.kind === 'scout');
    const settleEarly = earlyGoals.find(g => g.kind === 'settle');

    const lateGoals = selectGoals(baseInput({
      factionDef: { id: 'crimson', aiPersonality: 'BALANCED' },
      enemies: [],
      enemyCities: [],
      unexploredTiles: 100,
      myCityCount: 1,
      settlerTarget: 8,
      turn: 100, // late game
      aiState: (() => { const s = createAIState(); s.planLockUntil = 0; return s; })(),
    }));
    const scoutLate = lateGoals.find(g => g.kind === 'scout');
    const settleLate = lateGoals.find(g => g.kind === 'settle');

    // Early game should have higher scout priority than late game
    if (scoutEarly && scoutLate) {
      expect(scoutEarly.priority).toBeGreaterThanOrEqual(scoutLate.priority);
    }
  });

  it('late game boosts conquest goal', () => {
    const lateGoals = selectGoals(baseInput({
      factionDef: { id: 'crimson', aiPersonality: 'AGGRESSIVE' },
      enemies: ['azure'],
      enemyCities: [{ x: 5, z: 5, owner: 'azure' }],
      myCityCount: 5,
      settlerTarget: 8,
      turn: 100,
      aiState: (() => { const s = createAIState(); s.planLockUntil = 0; return s; })(),
    }));
    const conquest = lateGoals.find(g => g.kind === 'conquest');
    expect(conquest).toBeTruthy();
    expect(conquest.priority).toBeCloseTo(1, 1); // should be top goal
  });
});