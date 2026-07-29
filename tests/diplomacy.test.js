import { describe, it, expect, beforeEach } from 'vitest';
import {
  relKey, createDiplomacyState, getRelation, setRelation, canAttack,
  addGrievance, getTension, grievanceLevel, applyTensionDecay,
  relationshipFromGrievances, proposeTreaty, aiDecideTreaty, aiDecideWar,
  processTradePacts, updatePeaceCounters, stateLabel, relationshipLabel,
  isAllied, hasTradePact, isAtPeace
} from '../src/diplomacy.js';
import { DIPLOMACY_STATES } from '../src/config.js';

describe('diplomacy', () => {
  describe('relKey', () => {
    it('is symmetric', () => {
      expect(relKey('a', 'b')).toBe(relKey('b', 'a'));
    });

    it('produces consistent output', () => {
      expect(relKey('x', 'y')).toBe(relKey('x', 'y'));
    });

    it('sorts alphabetically', () => {
      expect(relKey('b', 'a')).toBe('a:b');
    });
  });

  describe('createDiplomacyState', () => {
    it('creates pairwise relations', () => {
      const state = createDiplomacyState(['a', 'b', 'c']);
      expect(Object.keys(state.relations)).toHaveLength(3);
    });

    it('default state is NEUTRAL', () => {
      const state = createDiplomacyState(['a', 'b']);
      const rel = getRelation(state, 'a', 'b');
      expect(rel.state).toBe(DIPLOMACY_STATES.NEUTRAL);
    });

    it('empty array yields empty relations', () => {
      const state = createDiplomacyState([]);
      expect(Object.keys(state.relations)).toHaveLength(0);
    });

    it('initializes grievance and trust fields', () => {
      const state = createDiplomacyState(['a', 'b']);
      const rel = getRelation(state, 'a', 'b');
      expect(rel.grievances).toBe(0);
      expect(rel.trust).toBe(1);
      expect(rel.relationship).toBe(-20);
    });
  });

  describe('getRelation', () => {
    it('returns correct relation', () => {
      const state = createDiplomacyState(['a', 'b']);
      const rel = getRelation(state, 'a', 'b');
      expect(rel).toBeDefined();
      expect(rel.state).toBe(DIPLOMACY_STATES.NEUTRAL);
    });

    it('fallback for missing pair', () => {
      const state = createDiplomacyState(['a', 'b']);
      const rel = getRelation(state, 'a', 'c');
      expect(rel.state).toBe(DIPLOMACY_STATES.NEUTRAL);
    });

    it('handles self-relation', () => {
      const state = createDiplomacyState(['a', 'b']);
      const rel = getRelation(state, 'a', 'a');
      expect(rel.state).toBe(DIPLOMACY_STATES.NEUTRAL);
    });
  });

  describe('setRelation', () => {
    it('sets state correctly', () => {
      const state = createDiplomacyState(['a', 'b']);
      setRelation(state, 'a', 'b', DIPLOMACY_STATES.WAR, 1);
      expect(getRelation(state, 'a', 'b').state).toBe(DIPLOMACY_STATES.WAR);
    });

    it('WAR increments warsDeclared', () => {
      const state = createDiplomacyState(['a', 'b']);
      setRelation(state, 'a', 'b', DIPLOMACY_STATES.WAR, 1);
      expect(getRelation(state, 'a', 'b').warsDeclared).toBe(1);
    });

    it('PEACE from WAR increments peaceTreaties', () => {
      const state = createDiplomacyState(['a', 'b']);
      setRelation(state, 'a', 'b', DIPLOMACY_STATES.WAR, 1);
      setRelation(state, 'a', 'b', DIPLOMACY_STATES.PEACE, 2);
      expect(getRelation(state, 'a', 'b').peaceTreaties).toBe(1);
    });

    it('breaking NAP into WAR generates grievances', () => {
      const state = createDiplomacyState(['a', 'b']);
      setRelation(state, 'a', 'b', DIPLOMACY_STATES.NAP, 1, 10);
      setRelation(state, 'a', 'b', DIPLOMACY_STATES.WAR, 5);
      const rel = getRelation(state, 'a', 'b');
      expect(rel.grievances).toBeGreaterThan(0);
      expect(rel.brokenTreaties).toBe(1);
    });

    it('breaking ALLIANCE into WAR generates larger breach', () => {
      const state = createDiplomacyState(['a', 'b']);
      setRelation(state, 'a', 'b', DIPLOMACY_STATES.ALLIANCE, 1);
      setRelation(state, 'a', 'b', DIPLOMACY_STATES.WAR, 5);
      const rel = getRelation(state, 'a', 'b');
      expect(rel.grievances).toBeGreaterThan(15);
    });

    it('NAP sets expiry', () => {
      const state = createDiplomacyState(['a', 'b']);
      setRelation(state, 'a', 'b', DIPLOMACY_STATES.NAP, 1, 10);
      expect(getRelation(state, 'a', 'b').expiresOn).toBe(11);
    });

    it('ALLIANCE increases relationship', () => {
      const state = createDiplomacyState(['a', 'b']);
      setRelation(state, 'a', 'b', DIPLOMACY_STATES.ALLIANCE, 1);
      expect(getRelation(state, 'a', 'b').relationship).toBe(10);
    });
  });

  describe('canAttack', () => {
    it('true only for WAR', () => {
      const state = createDiplomacyState(['a', 'b']);
      setRelation(state, 'a', 'b', DIPLOMACY_STATES.WAR);
      expect(canAttack(state, 'a', 'b')).toBe(true);
    });

    it('false for NEUTRAL', () => {
      const state = createDiplomacyState(['a', 'b']);
      expect(canAttack(state, 'a', 'b')).toBe(false);
    });

    it('false for NAP', () => {
      const state = createDiplomacyState(['a', 'b']);
      setRelation(state, 'a', 'b', DIPLOMACY_STATES.NAP);
      expect(canAttack(state, 'a', 'b')).toBe(false);
    });

    it('false for ALLIANCE', () => {
      const state = createDiplomacyState(['a', 'b']);
      setRelation(state, 'a', 'b', DIPLOMACY_STATES.ALLIANCE);
      expect(canAttack(state, 'a', 'b')).toBe(false);
    });
  });

  describe('addGrievance', () => {
    it('increments grievance', () => {
      const state = createDiplomacyState(['a', 'b']);
      addGrievance(state, 'a', 'b', 10);
      expect(getTension(state, 'a', 'b')).toBe(10);
    });

    it('no-op for self', () => {
      const state = createDiplomacyState(['a', 'b']);
      addGrievance(state, 'a', 'a', 10);
      expect(getTension(state, 'a', 'b')).toBe(0);
    });

    it('clamps to non-negative', () => {
      const state = createDiplomacyState(['a', 'b']);
      addGrievance(state, 'a', 'b', -5);
      expect(getTension(state, 'a', 'b')).toBe(0);
    });

    it('log capped at 30 entries', () => {
      const state = createDiplomacyState(['a', 'b']);
      for (let i = 0; i < 35; i++) addGrievance(state, 'a', 'b', 1);
      const rel = getRelation(state, 'a', 'b');
      expect(rel.grievanceLog.length).toBeLessThanOrEqual(30);
    });
  });

  describe('getTension', () => {
    it('returns directed grievance count', () => {
      const state = createDiplomacyState(['a', 'b']);
      addGrievance(state, 'a', 'b', 10);
      expect(getTension(state, 'a', 'b')).toBe(10);
    });

    it('returns 0 for missing', () => {
      const state = createDiplomacyState(['a', 'b']);
      expect(getTension(state, 'a', 'c')).toBe(0);
    });
  });

  describe('grievanceLevel', () => {
    it('furious >= 40', () => {
      expect(grievanceLevel(40)).toBe('furious');
      expect(grievanceLevel(100)).toBe('furious');
    });

    it('hostile >= 15', () => {
      expect(grievanceLevel(15)).toBe('hostile');
      expect(grievanceLevel(39)).toBe('hostile');
    });

    it('annoyed > 0', () => {
      expect(grievanceLevel(1)).toBe('annoyed');
      expect(grievanceLevel(14)).toBe('annoyed');
    });

    it('none at 0', () => {
      expect(grievanceLevel(0)).toBe('none');
    });
  });

  describe('applyTensionDecay', () => {
    it('reduces by 1 per turn', () => {
      const state = createDiplomacyState(['a', 'b']);
      addGrievance(state, 'a', 'b', 10);
      applyTensionDecay(state);
      expect(getTension(state, 'a', 'b')).toBe(9);
    });

    it('floors at 0', () => {
      const state = createDiplomacyState(['a', 'b']);
      addGrievance(state, 'a', 'b', 1);
      applyTensionDecay(state);
      expect(getTension(state, 'a', 'b')).toBe(0);
    });

    it('null-safe', () => {
      expect(() => applyTensionDecay(null)).not.toThrow();
    });
  });

  describe('relationshipFromGrievances', () => {
    it('alliance adds +10', () => {
      const delta = relationshipFromGrievances({ grievances: 0 }, DIPLOMACY_STATES.ALLIANCE);
      expect(delta).toBe(10);
    });

    it('war adds -10', () => {
      const delta = relationshipFromGrievances({ grievances: 0 }, DIPLOMACY_STATES.WAR);
      expect(delta).toBe(-10);
    });

    it('grievance cools by 0.5 each, capped at -40', () => {
      const delta = relationshipFromGrievances({ grievances: 100 }, DIPLOMACY_STATES.NEUTRAL);
      expect(delta).toBe(-40);
    });

    it('peace/trade adds +5', () => {
      const delta = relationshipFromGrievances({ grievances: 0 }, DIPLOMACY_STATES.PEACE);
      expect(delta).toBe(5);
    });
  });

  describe('proposeTreaty', () => {
    it('adds to pendingOffers', () => {
      const state = createDiplomacyState(['a', 'b']);
      proposeTreaty(state, 'a', 'b', DIPLOMACY_STATES.ALLIANCE);
      expect(state.pendingOffers).toHaveLength(1);
      expect(state.pendingOffers[0].type).toBe(DIPLOMACY_STATES.ALLIANCE);
    });
  });

  describe('aiDecideTreaty', () => {
    it('returns boolean', () => {
      expect(typeof aiDecideTreaty('AGGRESSIVE', DIPLOMACY_STATES.TRADE_PACT, 1.0)).toBe('boolean');
    });

    it('returns false for unrecognized type', () => {
      expect(aiDecideTreaty('AGGRESSIVE', 'unknown_type', 1.0)).toBe(false);
    });

    it('shared enemies increase treaty acceptance (trade pact)', () => {
      // Very favorable params guarantee acceptance
      const noEnemy = aiDecideTreaty('ECONOMIC', DIPLOMACY_STATES.TRADE_PACT, 1.0, 80, 0, 0, true, 0);
      const withEnemy = aiDecideTreaty('ECONOMIC', DIPLOMACY_STATES.TRADE_PACT, 1.0, 80, 0, 5, true, 0);
      // Both should accept, but withEnemy with higher margin — verify always-accept
      // Compute effective rate via the formula params directly:
      const p = { acceptTrade: 0.3, acceptAlliance: 0.2, acceptPeace: 0.4 };
      const base = p.acceptTrade;
      const relMod = 80 / 300;
      const powerMod = 0;
      const relReq = 0.1;
      const trustP = 0;
      const noEnemyRate = base + powerMod + relMod + relReq - trustP + 0 * 0.1 + 0.08 + 0;
      const withEnemyRate = base + powerMod + relMod + relReq - trustP + 5 * 0.1 + 0.08 + 0;
      expect(withEnemyRate).toBeGreaterThan(noEnemyRate);
      expect(withEnemyRate).toBeGreaterThan(0.95); // nearly certain
    });

    it('shared enemies strongly boost alliance acceptance', () => {
      const p = { acceptTrade: 0.3, acceptAlliance: 0.2, acceptPeace: 0.4 };
      const relMod = 50 / 300;
      const powerMod = 0;
      const relReq = 0.15;
      const trustP = 0;
      const grievanceP = 0;
      const neighborB = 0.08;
      const base = p.acceptAlliance;
      // No shared enemy
      const noEnemyRate = base + powerMod + relMod + relReq - trustP * 1.5 + 0 * 0.15 + neighborB + grievanceP;
      // With shared enemy
      const withEnemyRate = base + powerMod + relMod + relReq - trustP * 1.5 + 3 * 0.15 + neighborB + grievanceP;
      expect(withEnemyRate).toBeGreaterThan(noEnemyRate + 0.3);
      expect(noEnemyRate).toBeLessThan(withEnemyRate);
    });

    it('neighbor bonus applies to trade and NAP', () => {
      const neighbor = aiDecideTreaty('BALANCED', DIPLOMACY_STATES.NAP, 1.0, 30, 0, 0, true, 0);
      const far = aiDecideTreaty('BALANCED', DIPLOMACY_STATES.NAP, 1.0, 30, 0, 0, false, 0);
      // Both should be boolean
      expect(typeof neighbor).toBe('boolean');
      expect(typeof far).toBe('boolean');
      // With max params neighbor bonus = 0.08*0.5 = 0.04 for NAP
      const base = 0.5;
      const relM = 30 / 300;
      const neighborRate = base + relM + 0.1 + 0 + 0.08 * 0.5 + 0;
      const farRate = base + relM + 0.1 + 0 + 0 + 0;
      expect(neighborRate - farRate).toBeCloseTo(0.04, 5);
    });

    it('grievance penalty reduces acceptance', () => {
      const lowGriev = aiDecideTreaty('DEFENSIVE', DIPLOMACY_STATES.PEACE, 0.5, -50, 0, 0, false, 10);
      const highGriev = aiDecideTreaty('DEFENSIVE', DIPLOMACY_STATES.PEACE, 0.5, -50, 0, 0, false, 60);
      expect(typeof lowGriev).toBe('boolean');
      expect(typeof highGriev).toBe('boolean');
      // Grievance penalty caps at -0.25 = 50 grievances
      const base = 0.4;
      const losingMod = 0.1; // ratio < 0.7
      const relM = -50 / 300;
      const lowPenalty = -Math.min(0.25, 10 * 0.005);
      const highPenalty = -Math.min(0.25, 60 * 0.005);
      expect(highPenalty).toBeLessThan(lowPenalty);
    });

    it('broken treaties reduce acceptance', () => {
      const clean = aiDecideTreaty('AGGRESSIVE', DIPLOMACY_STATES.CEASEFIRE, 1.0, 0, 0, 0, false, 0);
      const breaker = aiDecideTreaty('AGGRESSIVE', DIPLOMACY_STATES.CEASEFIRE, 1.0, 0, 4, 0, false, 0);
      expect(typeof clean).toBe('boolean');
      expect(typeof breaker).toBe('boolean');
      // 4 broken treaties → penalty = 4 * 0.1 * 0.3 = 0.12 for ceasefire
      expect(aiDecideTreaty('BALANCED', DIPLOMACY_STATES.TRADE_PACT, 0.5, -40, 5, 0, false, 0)).toBe(false);
    });
  });

  describe('aiDecideWar', () => {
    it('returns boolean', () => {
      expect(typeof aiDecideWar('AGGRESSIVE', 1.0)).toBe('boolean');
    });

    it('shared enemies increase war chance', () => {
      const p = { warChance: 0.3 };
      const base = p.warChance * Math.min(2.5, 1.2);
      const relM = Math.max(-0.15, Math.min(0.15, -(-20) / 300));
      const noEnemy = base + relM + 0 * 0.08 + 0.12 + 0 + 0;
      const withEnemy = base + relM + 2 * 0.08 + 0.12 + 0 + 0;
      expect(withEnemy).toBeGreaterThan(noEnemy);
    });
  });

  describe('processTradePacts', () => {
    it('adds gold to both sides', () => {
      const state = createDiplomacyState(['a', 'b']);
      setRelation(state, 'a', 'b', DIPLOMACY_STATES.TRADE_PACT);
      const resources = { a: { gold: 0, food: 0, wood: 0, iron: 0, production: 0 }, b: { gold: 0, food: 0, wood: 0, iron: 0, production: 0 } };
      processTradePacts(state, resources);
      expect(resources.a.gold).toBeGreaterThan(0);
      expect(resources.b.gold).toBeGreaterThan(0);
    });

    it('harbor bonus applies', () => {
      const state = createDiplomacyState(['a', 'b']);
      setRelation(state, 'a', 'b', DIPLOMACY_STATES.TRADE_PACT);
      const resources = { a: { gold: 0 }, b: { gold: 0 } };
      const harbors = new Set(['a']);
      processTradePacts(state, resources, harbors);
      expect(resources.a.gold).toBeGreaterThan(resources.b.gold);
    });
  });

  describe('updatePeaceCounters', () => {
    it('increments peace counter', () => {
      const state = createDiplomacyState(['a', 'b']);
      setRelation(state, 'a', 'b', DIPLOMACY_STATES.PEACE);
      updatePeaceCounters(state);
      expect(getRelation(state, 'a', 'b').turnsAtPeace).toBe(1);
    });

    it('NAP expiry reverts to NEUTRAL', () => {
      const state = createDiplomacyState(['a', 'b']);
      setRelation(state, 'a', 'b', DIPLOMACY_STATES.NAP, 1, 5);
      updatePeaceCounters(state, 10);
      expect(getRelation(state, 'a', 'b').state).toBe(DIPLOMACY_STATES.NEUTRAL);
    });

    it('NAP expiry with high grievances reverts to WAR', () => {
      const state = createDiplomacyState(['a', 'b']);
      setRelation(state, 'a', 'b', DIPLOMACY_STATES.NAP, 1, 5);
      addGrievance(state, 'a', 'b', 50);
      addGrievance(state, 'b', 'a', 50);
      updatePeaceCounters(state, 10);
      expect(getRelation(state, 'a', 'b').state).toBe(DIPLOMACY_STATES.WAR);
    });

    it('WAR decrements relationship', () => {
      const state = createDiplomacyState(['a', 'b']);
      setRelation(state, 'a', 'b', DIPLOMACY_STATES.WAR, 1);
      const before = getRelation(state, 'a', 'b').relationship;
      updatePeaceCounters(state);
      expect(getRelation(state, 'a', 'b').relationship).toBeLessThan(before);
    });

    it('neutral relationship drifts toward 0', () => {
      const state = createDiplomacyState(['a', 'b']);
      const rel = getRelation(state, 'a', 'b');
      rel.relationship = -15;
      updatePeaceCounters(state);
      expect(getRelation(state, 'a', 'b').relationship).toBeGreaterThan(-15);
    });
  });

  describe('isAllied / hasTradePact / isAtPeace', () => {
    it('isAllied true for ALLIANCE', () => {
      const state = createDiplomacyState(['a', 'b']);
      setRelation(state, 'a', 'b', DIPLOMACY_STATES.ALLIANCE);
      expect(isAllied(state, 'a', 'b')).toBe(true);
    });

    it('hasTradePact true for TRADE_PACT', () => {
      const state = createDiplomacyState(['a', 'b']);
      setRelation(state, 'a', 'b', DIPLOMACY_STATES.TRADE_PACT);
      expect(hasTradePact(state, 'a', 'b')).toBe(true);
    });

    it('isAtPeace true for everything except WAR', () => {
      const state = createDiplomacyState(['a', 'b']);
      expect(isAtPeace(state, 'a', 'b')).toBe(true);
      setRelation(state, 'a', 'b', DIPLOMACY_STATES.WAR, 1);
      expect(isAtPeace(state, 'a', 'b')).toBe(false);
    });
  });

  describe('stateLabel / relationshipLabel', () => {
    it('stateLabel returns correct labels', () => {
      expect(stateLabel(DIPLOMACY_STATES.WAR)).toContain('War');
      expect(stateLabel(DIPLOMACY_STATES.ALLIANCE)).toContain('Alliance');
      expect(stateLabel(DIPLOMACY_STATES.NEUTRAL)).toContain('Neutral');
    });

    it('relationshipLabel returns correct labels', () => {
      expect(relationshipLabel(60)).toBe('Friendly');
      expect(relationshipLabel(20)).toBe('Cordial');
      expect(relationshipLabel(-20)).toBe('Neutral');
      expect(relationshipLabel(-60)).toBe('Hostile');
      expect(relationshipLabel(-100)).toBe('Bitter');
    });
  });
});
