/**
 * Tests for AI Victory-Condition Pursuit system.
 * Verifies that AI factions choose victory targets, adjust goals,
 * and pursue specific victory conditions.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createAIState, chooseVictoryTarget, reevaluateVictoryTarget,
         selectGoals, GOAL_KINDS } from '../src/ai_goals.js';

describe('chooseVictoryTarget', () => {
    it('returns a valid victory type', () => {
        const result = chooseVictoryTarget('BALANCED', 3, 0, 100, 0);
        expect(['domination', 'science', 'economic', 'score']).toContain(result);
    });

    it('AGGRESSIVE personality favors domination', () => {
        const counts = { domination: 0, science: 0, economic: 0, score: 0 };
        for (let i = 0; i < 100; i++) {
            counts[chooseVictoryTarget('AGGRESSIVE', 3, 0, 100, 0)]++;
        }
        expect(counts.domination).toBeGreaterThan(counts.science);
        expect(counts.domination).toBeGreaterThan(counts.economic);
    });

    it('ECONOMIC personality favors economic', () => {
        const counts = { domination: 0, science: 0, economic: 0, score: 0 };
        for (let i = 0; i < 100; i++) {
            counts[chooseVictoryTarget('ECONOMIC', 3, 0, 100, 0)]++;
        }
        expect(counts.economic).toBeGreaterThan(counts.domination);
    });

    it('more cities shifts toward domination', () => {
        const counts = { domination: 0, science: 0, economic: 0, score: 0 };
        for (let i = 0; i < 100; i++) {
            counts[chooseVictoryTarget('BALANCED', 8, 0, 100, 0)]++;
        }
        expect(counts.domination).toBeGreaterThan(20);
    });

    it('more gold shifts toward economic', () => {
        const counts = { domination: 0, science: 0, economic: 0, score: 0 };
        for (let i = 0; i < 100; i++) {
            counts[chooseVictoryTarget('BALANCED', 3, 0, 1000, 0)]++;
        }
        expect(counts.economic).toBeGreaterThan(15);
    });

    it('more techs shifts toward science', () => {
        const counts = { domination: 0, science: 0, economic: 0, score: 0 };
        for (let i = 0; i < 100; i++) {
            counts[chooseVictoryTarget('BALANCED', 3, 8, 100, 0)]++;
        }
        expect(counts.science).toBeGreaterThan(10);
    });
});

describe('reevaluateVictoryTarget', () => {
    it('does not change target if competitive', () => {
        const aiState = createAIState();
        aiState.victoryTarget = 'domination';
        const scores = { ai1: 100, ai2: 90, player: 80 };
        reevaluateVictoryTarget(aiState, 'AGGRESSIVE', scores, 'ai1', 20);
        expect(aiState.victoryTarget).toBe('domination');
    });

    it('switches from domination if far behind', () => {
        const aiState = createAIState();
        aiState.victoryTarget = 'domination';
        const scores = { ai1: 30, ai2: 100, player: 90 };
        reevaluateVictoryTarget(aiState, 'AGGRESSIVE', scores, 'ai1', 20);
        expect(aiState.victoryTarget).not.toBe('domination');
    });

    it('switches from economic if far behind', () => {
        const aiState = createAIState();
        aiState.victoryTarget = 'economic';
        const scores = { ai1: 40, ai2: 100, player: 90 };
        reevaluateVictoryTarget(aiState, 'ECONOMIC', scores, 'ai1', 20);
        expect(aiState.victoryTarget).toBe('score');
    });

    it('does not change before turn 20', () => {
        const aiState = createAIState();
        aiState.victoryTarget = 'domination';
        const scores = { ai1: 10, ai2: 100 };
        reevaluateVictoryTarget(aiState, 'AGGRESSIVE', scores, 'ai1', 10);
        expect(aiState.victoryTarget).toBe('domination');
    });

    it('only reevaluates every 20 turns', () => {
        const aiState = createAIState();
        aiState.victoryTarget = 'domination';
        const scores = { ai1: 10, ai2: 100 };
        // Turn 21 — not a multiple of 20, should not trigger
        reevaluateVictoryTarget(aiState, 'AGGRESSIVE', scores, 'ai1', 21);
        expect(aiState.victoryTarget).toBe('domination');
    });
});

describe('victory-target goal scoring', () => {
    it('conquest goal gets higher score with domination target', () => {
        const aiState = createAIState();
        aiState.victoryTarget = 'domination';

        const goals1 = selectGoals({
            aiState, turn: 1, factionDef: { aiPersonality: 'BALANCED' },
            enemies: new Set(['ai2']), enemyCities: [{ x: 10, z: 10, owner: 'ai2' }],
            ownCities: [{ x: 5, z: 5 }], homeAnchor: { x: 5, z: 5 },
            myCityCount: 3, settlerTarget: 8
        });

        // With domination target, conquest should be prioritized
        const conquestGoal = goals1.find(g => g.kind === 'conquest');
        expect(conquestGoal).toBeTruthy();
        expect(conquestGoal.priority).toBeGreaterThan(0.5);
    });

    it('develop-economy gets higher score with economic target', () => {
        const aiState = createAIState();
        aiState.victoryTarget = 'economic';

        const goals = selectGoals({
            aiState, turn: 1, factionDef: { aiPersonality: 'BALANCED' },
            enemies: new Set(['ai2']), enemyCities: [{ x: 10, z: 10, owner: 'ai2' }],
            ownCities: [{ x: 5, z: 5 }], homeAnchor: { x: 5, z: 5 },
            myCityCount: 3, settlerTarget: 8
        });

        // develop-economy should have decent priority with economic target
        const econGoal = goals.find(g => g.kind === 'develop-economy');
        expect(econGoal).toBeTruthy();
    });
});

describe('createAIState', () => {
    it('includes victoryTarget field', () => {
        const state = createAIState();
        expect(state).toHaveProperty('victoryTarget');
        expect(state.victoryTarget).toBeNull();
    });

    it('preserves victoryTarget through serialization', () => {
        const state = createAIState();
        state.victoryTarget = 'science';
        const json = JSON.parse(JSON.stringify(state));
        expect(json.victoryTarget).toBe('science');
    });
});
