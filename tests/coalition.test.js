import { describe, it, expect } from 'vitest';
import {
  createDiplomacyState, formCoalition, eligibleCoalitionAllies,
  declareCoalitionWar, getCoalition, getRelation, relKey
} from '../src/diplomacy.js';
import { DIPLOMACY_STATES, COALITION_MAX_ALLIES, COALITION_JOIN_RELATIONSHIP_THRESHOLD } from '../src/config.js';

const FACS = ['player', 'ai1', 'ai2', 'ai3'];

function freshState() {
  const s = createDiplomacyState(FACS);
  return s;
}

describe('Coalition Wars (Feature 12)', () => {
  it('formCoalition records allies under the leader, capped at COALITION_MAX_ALLIES', () => {
    const s = freshState();
    const allies = formCoalition(s, 'player', ['ai1', 'ai2', 'ai3', 'ai4']);
    expect(allies.length).toBe(Math.min(3, COALITION_MAX_ALLIES));
    expect(getCoalition(s, 'player')).toEqual(allies);
  });

  it('formCoalition drops the leader if accidentally included', () => {
    const s = freshState();
    const allies = formCoalition(s, 'player', ['player', 'ai1']);
    expect(allies).toEqual(['ai1']);
  });

  it('eligibleCoalitionAllies only includes factions friendly enough with the leader', () => {
    const s = freshState();
    // Raise ai1's relationship with player above threshold; leave ai2 low.
    getRelation(s, 'player', 'ai1').relationship = COALITION_JOIN_RELATIONSHIP_THRESHOLD + 10;
    getRelation(s, 'player', 'ai2').relationship = 0;
    const eligible = eligibleCoalitionAllies(s, 'player', 'ai3', ['ai1', 'ai2']);
    expect(eligible).toContain('ai1');
    expect(eligible).not.toContain('ai2');
  });

  it('eligibleCoalitionAllies excludes allies of the target', () => {
    const s = freshState();
    getRelation(s, 'player', 'ai1').relationship = COALITION_JOIN_RELATIONSHIP_THRESHOLD + 10;
    // ai1 is allied with the target ai3 → excluded.
    getRelation(s, 'ai1', 'ai3').state = DIPLOMACY_STATES.ALLIANCE;
    const eligible = eligibleCoalitionAllies(s, 'player', 'ai3', ['ai1']);
    expect(eligible).not.toContain('ai1');
  });

  it('eligibleCoalitionAllies caps at COALITION_MAX_ALLIES', () => {
    const s = freshState();
    for (const a of ['ai1', 'ai2', 'ai3']) {
      getRelation(s, 'player', a).relationship = COALITION_JOIN_RELATIONSHIP_THRESHOLD + 20;
    }
    const eligible = eligibleCoalitionAllies(s, 'player', 'player_x', ['ai1', 'ai2', 'ai3']);
    expect(eligible.length).toBeLessThanOrEqual(COALITION_MAX_ALLIES);
  });

  it('declareCoalitionWar puts the leader and all joiners at war with the target', () => {
    const s = freshState();
    getRelation(s, 'player', 'ai1').relationship = COALITION_JOIN_RELATIONSHIP_THRESHOLD + 20;
    getRelation(s, 'player', 'ai2').relationship = COALITION_JOIN_RELATIONSHIP_THRESHOLD + 20;
    const joiners = declareCoalitionWar(s, 'player', 'ai3', ['ai1', 'ai2'], 5);
    expect(joiners).toContain('player');
    expect(joiners).toContain('ai1');
    expect(joiners).toContain('ai2');
    expect(getRelation(s, 'player', 'ai3').state).toBe(DIPLOMACY_STATES.WAR);
    expect(getRelation(s, 'ai1', 'ai3').state).toBe(DIPLOMACY_STATES.WAR);
    expect(getRelation(s, 'ai2', 'ai3').state).toBe(DIPLOMACY_STATES.WAR);
  });

  it('declareCoalitionWar shares a fraction of the leader penalty with joiners', () => {
    const s = freshState();
    getRelation(s, 'player', 'ai1').relationship = COALITION_JOIN_RELATIONSHIP_THRESHOLD + 20;
    const before = getRelation(s, 'ai1', 'ai3').relationship;
    declareCoalitionWar(s, 'player', 'ai3', ['ai1'], 5);
    const after = getRelation(s, 'ai1', 'ai3').relationship;
    expect(after).toBeLessThan(before);
  });

  it('getCoalition returns [] when no coalition exists', () => {
    const s = freshState();
    expect(getCoalition(s, 'player')).toEqual([]);
  });

  it('declareCoalitionWar records the coalition on the diplomacy state', () => {
    const s = freshState();
    getRelation(s, 'player', 'ai1').relationship = COALITION_JOIN_RELATIONSHIP_THRESHOLD + 20;
    declareCoalitionWar(s, 'player', 'ai3', ['ai1'], 5);
    expect(getCoalition(s, 'player')).toContain('ai1');
  });
});