import { describe, it, expect } from 'vitest';
import { VICTORY_TYPES, SCORE_VICTORY_TURN, SCIENCE_VICTORY_COST, SCIENCE_VICTORY_BUILD_TURNS,
         ECONOMIC_VICTORY_GOLD, ECONOMIC_VICTORY_TRADE_ROUTES } from '../src/config.js';

describe('Victory Conditions', () => {
    describe('VICTORY_TYPES constants', () => {
        it('has all 4 victory types defined', () => {
            expect(VICTORY_TYPES.DOMINATION).toBe('domination');
            expect(VICTORY_TYPES.SCIENCE).toBe('science');
            expect(VICTORY_TYPES.ECONOMIC).toBe('economic');
            expect(VICTORY_TYPES.SCORE).toBe('score');
        });
    });

    describe('victory thresholds', () => {
        it('has reasonable score victory turn', () => {
            expect(SCORE_VICTORY_TURN).toBeGreaterThan(0);
        });

        it('has science victory requirements', () => {
            expect(SCIENCE_VICTORY_COST).toBeTruthy();
            expect(typeof SCIENCE_VICTORY_COST).toBe('object');
            expect(SCIENCE_VICTORY_BUILD_TURNS).toBeGreaterThan(0);
        });

        it('has economic victory requirements', () => {
            expect(ECONOMIC_VICTORY_GOLD).toBeGreaterThan(0);
            expect(ECONOMIC_VICTORY_TRADE_ROUTES).toBeGreaterThan(0);
        });
    });
});
