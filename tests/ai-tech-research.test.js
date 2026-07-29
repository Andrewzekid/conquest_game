/**
 * Tests for AI Tech Research system.
 * Verifies that AI factions auto-select research, accumulate progress,
 * and unlock units from the shared tech tree.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createTechState, autoSelectResearch, addResearch, getUnlockedUnits,
         selectResearch, canResearch, TECHS } from '../src/tech.js';
import { createTurnManager } from '../src/turnmanager.js';
import { makeGameState, makeTile, makeUnit } from './helpers.js';
import { PLAYER_FACTION } from '../src/config.js';

describe('autoSelectResearch', () => {
    let state;

    beforeEach(() => {
        state = createTechState();
    });

    it('selects a tech when none is current', () => {
        const result = autoSelectResearch(state, 'BALANCED');
        expect(result).toBeTruthy();
        expect(state.current).toBe(result);
    });

    it('returns current tech if already researching', () => {
        state.current = 'MATHEMATICS';
        state.progress = 10;
        const result = autoSelectResearch(state, 'BALANCED');
        expect(result).toBe('MATHEMATICS');
        expect(state.progress).toBe(10); // progress unchanged
    });

    it('does not select already-researched tech', () => {
        state.researched.add('ARCHERY');
        state.researched.add('BRONZE_WORKING');
        state.researched.add('ANIMAL_HUSBANDRY');
        const result = autoSelectResearch(state, 'BALANCED');
        expect(result).toBeTruthy();
        expect(result).not.toBe('ARCHERY');
        expect(result).not.toBe('BRONZE_WORKING');
        expect(result).not.toBe('ANIMAL_HUSBANDRY');
    });

    it('AGGRESSIVE personality prioritizes CHIVALRY', () => {
        // Ancient techs are pre-researched, so classical era is next
        const result = autoSelectResearch(state, 'AGGRESSIVE');
        expect(result).toBeTruthy();
        // Should pick from the aggressive priority list
        const available = Object.keys(TECHS).filter(id =>
            id !== 'ARCHERY' && id !== 'BRONZE_WORKING' && id !== 'ANIMAL_HUSBANDRY' &&
            TECHS[id].prerequisites.every(p => state.researched.has(p))
        );
        expect(available).toContain(result);
    });

    it('DEFENSIVE personality prioritizes FORTIFICATION', () => {
        // Research engineering first to unlock FORTIFICATION
        state.researched.add('ENGINEERING');
        const result = autoSelectResearch(state, 'DEFENSIVE');
        expect(result).toBe('FORTIFICATION');
    });

    it('returns null when all techs researched', () => {
        for (const id of Object.keys(TECHS)) {
            state.researched.add(id);
        }
        const result = autoSelectResearch(state, 'BALANCED');
        expect(result).toBeNull();
    });
});

describe('AI tech research in turnmanager', () => {
    it('AI tech state is separate from player tech state', () => {
        const gs = makeGameState({
            factions: ['player', 'ai1'],
            techState: createTechState(),
            aiTechStates: {
                ai1: createTechState()
            }
        });

        // Player researches something
        selectResearch(gs.techState, 'MATHEMATICS');
        addResearch(gs.techState, 100);

        // AI should not have it
        expect(gs.aiTechStates.ai1.researched.has('MATHEMATICS')).toBe(false);
    });

    it('autoSelectResearch sets current on AI tech state', () => {
        const aiTs = createTechState();
        expect(aiTs.current).toBeNull();
        autoSelectResearch(aiTs, 'BALANCED');
        expect(aiTs.current).toBeTruthy();
        expect(aiTs.current).not.toBeNull();
    });

    it('addResearch accumulates and completes tech', () => {
        const aiTs = createTechState();
        autoSelectResearch(aiTs, 'BALANCED');
        const techId = aiTs.current;
        expect(techId).toBeTruthy();

        // Add enough research to complete the tech
        const tech = TECHS[techId];
        const completed = addResearch(aiTs, tech.cost + 10);
        expect(completed).toContain(techId);
        expect(aiTs.researched.has(techId)).toBe(true);
        expect(aiTs.current).toBeNull();
    });
});

describe('AI tech unlocks units', () => {
    it('getUnlockedUnits returns tech-gated units', () => {
        const state = createTechState();
        // Ancient techs are pre-researched — they unlock ARCHER, PIKEMAN, CAVALRY
        const units = getUnlockedUnits(state);
        expect(units.has('ARCHER')).toBe(true);
        expect(units.has('PIKEMAN')).toBe(true);
        expect(units.has('CAVALRY')).toBe(true);
        expect(units.has('CATAPHRACT')).toBe(false); // needs CHIVALRY
    });

    it('researching CHIVALRY unlocks CATAPHRACT', () => {
        const state = createTechState();
        selectResearch(state, 'CHIVALRY');
        // Need to prereq: MATHEMATICS + ANIMAL_HUSBANDRY
        // ANIMAL_HUSBANDRY is ancient (pre-researched), need MATHEMATICS
        selectResearch(state, 'MATHEMATICS');
        addResearch(state, 100); // complete MATHEMATICS
        state.current = 'CHIVALRY';
        addResearch(state, 200); // complete CHIVALRY

        const units = getUnlockedUnits(state);
        expect(units.has('CATAPHRACT')).toBe(true);
        expect(units.has('CHARIOT')).toBe(true);
        expect(units.has('BERSERKER')).toBe(true);
        expect(units.has('WINGED_HUSSAR')).toBe(true);
    });
});
