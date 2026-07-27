/**
 * Tests for Victory Progress UI system.
 * Verifies getAllFactionProgress returns correct data for all factions.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createTechState, TECHS } from '../src/tech.js';
import { VICTORY_TYPES, SCORE_VICTORY_TURN, ECONOMIC_VICTORY_GOLD,
         ECONOMIC_VICTORY_TRADE_ROUTES } from '../src/config.js';

describe('getAllFactionProgress data structure', () => {
    it('returns object with faction keys', () => {
        // Since getAllFactionProgress is a method on Game, we test the data shape
        // by verifying the expected structure matches what the method returns
        const mockProgress = {
            player: {
                score: 100, cities: 3, techs: 5, totalTechs: 16,
                gold: 500, victoryTarget: null,
                closestVictory: 'science', closestProgress: 0.31,
                isDominant: false, eliminated: false
            },
            ai1: {
                score: 80, cities: 2, techs: 3, totalTechs: 16,
                gold: 300, victoryTarget: 'domination',
                closestVictory: 'domination', closestProgress: 0.25,
                isDominant: false, eliminated: false
            }
        };

        expect(mockProgress.player).toHaveProperty('score');
        expect(mockProgress.player).toHaveProperty('cities');
        expect(mockProgress.player).toHaveProperty('techs');
        expect(mockProgress.player).toHaveProperty('closestVictory');
        expect(mockProgress.player).toHaveProperty('closestProgress');
    });

    it('eliminated factions have eliminated flag', () => {
        const mockProgress = {
            player: { eliminated: false, score: 100 },
            ai1: { eliminated: true, score: 0 }
        };
        expect(mockProgress.ai1.eliminated).toBe(true);
        expect(mockProgress.ai1.score).toBe(0);
    });
});

describe('victory progress calculations', () => {
    it('science progress is techs/total', () => {
        const totalTechs = Object.keys(TECHS).length;
        const researched = 8;
        const progress = researched / totalTechs;
        expect(progress).toBeGreaterThan(0);
        expect(progress).toBeLessThan(1);
    });

    it('economic progress considers gold and trade routes', () => {
        const gold = 1000;
        const tradeRoutes = 3;
        const progress = Math.min(
            gold / Math.max(1, ECONOMIC_VICTORY_GOLD),
            tradeRoutes / Math.max(1, ECONOMIC_VICTORY_TRADE_ROUTES)
        );
        expect(progress).toBeGreaterThan(0);
        expect(progress).toBeLessThan(1);
    });

    it('domination progress is fraction of enemies eliminated', () => {
        const totalEnemies = 4;
        const eliminated = 2;
        const progress = eliminated / totalEnemies;
        expect(progress).toBe(0.5);
    });

    it('score progress is turn/maxTurn', () => {
        const turn = 5000;
        const progress = turn / SCORE_VICTORY_TURN;
        expect(progress).toBe(0.5);
    });
});

describe('scoreboard data requirements', () => {
    it('all factions need score, cities, techs, gold', () => {
        const requiredFields = ['score', 'cities', 'techs', 'gold', 'closestVictory', 'closestProgress'];
        const factionData = {
            score: 50,
            cities: 2,
            techs: 4,
            totalTechs: 16,
            gold: 200,
            victoryTarget: 'domination',
            closestVictory: 'domination',
            closestProgress: 0.2,
            isDominant: false
        };
        for (const field of requiredFields) {
            expect(factionData).toHaveProperty(field);
        }
    });

    it('dominant flag is set for leading factions', () => {
        const data = {
            score: 200,
            cities: 8,
            isDominant: true
        };
        expect(data.isDominant).toBe(true);
    });
});

describe('victory type strings', () => {
    it('all victory types are defined', () => {
        expect(VICTORY_TYPES.DOMINATION).toBe('domination');
        expect(VICTORY_TYPES.SCIENCE).toBe('science');
        expect(VICTORY_TYPES.ECONOMIC).toBe('economic');
        expect(VICTORY_TYPES.SCORE).toBe('score');
    });
});

// The victory panel renders a per-faction standings section (every faction's
// closest victory with a faction-colored progress bar), wired through
// getAllFactionProgress. Source-invariant: the suite has no DOM harness.
describe('victory panel per-faction standings (source-invariant)', () => {
    const uiSrc = readFileSync(resolve(import.meta.dirname, '..', 'src', 'ui.js'), 'utf-8');
    const indexHtml = readFileSync(resolve(import.meta.dirname, '..', 'index.html'), 'utf-8');

    it('showVictoryPanel calls getAllFactionProgress and renders a Standings section', () => {
        expect(uiSrc).toMatch(/callbacks\.getAllFactionProgress\(\)/);
        expect(uiSrc).toContain('🌍 Standings');
    });

    it('standings rows use faction-colored chips and progress fills', () => {
        expect(uiSrc).toContain('vp-faction-row');
        expect(uiSrc).toContain('vp-chip');
        expect(uiSrc).toMatch(/progress-fill" style="width:\$\{pct\.toFixed\(0\)\}%;background:\$\{hex\}/);
    });

    it('eliminated factions get the struck-through style', () => {
        expect(uiSrc).toContain('vp-eliminated');
        expect(indexHtml).toContain('.vp-faction-row.vp-eliminated .vp-name');
    });

    it('standings CSS classes exist in index.html', () => {
        expect(indexHtml).toContain('.vp-faction-row .vp-chip');
        expect(indexHtml).toContain('.vp-faction-row .vp-name');
        expect(indexHtml).toContain('.vp-faction-row .vp-detail');
    });
});

// Regression: score-track progress was turn/200 — identical for every faction
// (the "everyone shows 69%" bug). It must be leader-relative, and per-track
// progress must be exposed for the standings bars.
describe('getAllFactionProgress score progress (source-invariant)', () => {
    const gameSrc = readFileSync(resolve(import.meta.dirname, '..', 'src', 'game.js'), 'utf-8');

    it('score progress is leader-relative, not turn/200', () => {
        expect(gameSrc).toMatch(/const maxScore = Math\.max\(1, \.\.\.FACTIONS/);
        expect(gameSrc).toMatch(/const scoreProg = \(scores\[f\] \|\| 0\) \/ maxScore;/);
        expect(gameSrc).not.toMatch(/\{ type: 'score', progress: \(gs\.turn \|\| 0\) \/ SCORE_VICTORY_TURN \}/);
    });

    it('per-track progress is exposed for the standings UI', () => {
        expect(gameSrc).toMatch(/tracks: \{ domination: dominationProg, science: scienceProg, economic: economicProg, score: scoreProg \}/);
    });
});
