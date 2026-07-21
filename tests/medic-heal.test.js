/**
 * Medic heal integration tests.
 * Tests that medics heal adjacent friendly units, BERSERKERS are excluded,
 * and healing respects max HP cap.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createTurnManager } from '../src/turnmanager.js';
import { PLAYER_FACTION, setGridDimensions } from '../src/config.js';
import { makeGameState, makeUnit } from './helpers.js';

beforeEach(() => { setGridDimensions(20, 20); });

function runTurn(state) {
    const tm = createTurnManager(state, [PLAYER_FACTION, 'ai1'], null, null, null);
    tm.endPlayerTurn();
}

describe('medic healing — turn cycle integration', () => {
    it('medic heals adjacent damaged friendly units', () => {
        const state = makeGameState();
        const medic = makeUnit('MEDIC', 'player', 6, 5);
        const wounded = makeUnit('INFANTRY', 'player', 6, 6, { hp: 5, maxHp: 10 });
        state.units.set(medic.id, medic);
        state.units.set(wounded.id, wounded);

        runTurn(state);

        expect(wounded.hp).toBe(7); // +2 heal
    });

    it('medic does NOT heal across 2+ tile distance', () => {
        const state = makeGameState();
        const medic = makeUnit('MEDIC', 'player', 6, 5);
        const distant = makeUnit('INFANTRY', 'player', 8, 5, { hp: 5, maxHp: 10 });
        state.units.set(medic.id, medic);
        state.units.set(distant.id, distant);

        runTurn(state);

        expect(distant.hp).toBe(5); // too far
    });

    it('medic does NOT heal full-HP units', () => {
        const state = makeGameState();
        const medic = makeUnit('MEDIC', 'player', 6, 5);
        const full = makeUnit('INFANTRY', 'player', 6, 6, { hp: 10, maxHp: 10 });
        state.units.set(medic.id, medic);
        state.units.set(full.id, full);

        runTurn(state);

        expect(full.hp).toBe(10); // no change
    });

    it('medic does NOT heal other medics', () => {
        const state = makeGameState();
        const medic1 = makeUnit('MEDIC', 'player', 6, 5, { hp: 5, maxHp: 7 });
        const medic2 = makeUnit('MEDIC', 'player', 6, 6, { hp: 5, maxHp: 7 });
        state.units.set(medic1.id, medic1);
        state.units.set(medic2.id, medic2);

        runTurn(state);

        expect(medic1.hp).toBe(5); // medics don't heal each other
        expect(medic2.hp).toBe(5);
    });

    it('medic does NOT heal BERSERKER (noMedic flag)', () => {
        const state = makeGameState();
        const medic = makeUnit('MEDIC', 'player', 6, 5);
        const berserker = makeUnit('BERSERKER', 'player', 6, 6, { hp: 4, maxHp: 12 });
        state.units.set(medic.id, medic);
        state.units.set(berserker.id, berserker);

        runTurn(state);

        expect(berserker.hp).toBe(4); // not healed
    });

    it('medic does NOT heal enemy units', () => {
        const state = makeGameState();
        const medic = makeUnit('MEDIC', 'player', 6, 5);
        const enemy = makeUnit('INFANTRY', 'ai1', 6, 6, { hp: 3, maxHp: 10 });
        state.units.set(medic.id, medic);
        state.units.set(enemy.id, enemy);

        runTurn(state);

        expect(enemy.hp).toBe(3); // enemy not healed
    });

    it('medic healing caps at maxHp', () => {
        const state = makeGameState();
        const medic = makeUnit('MEDIC', 'player', 6, 5);
        const almostFull = makeUnit('INFANTRY', 'player', 6, 6, { hp: 9, maxHp: 10 });
        state.units.set(medic.id, medic);
        state.units.set(almostFull.id, almostFull);

        runTurn(state);

        expect(almostFull.hp).toBe(10); // capped at max, not 11
    });

    it('multiple medics heal the same unit (stacking)', () => {
        const state = makeGameState();
        const medic1 = makeUnit('MEDIC', 'player', 6, 5);
        const medic2 = makeUnit('MEDIC', 'player', 7, 6);
        const wounded = makeUnit('INFANTRY', 'player', 6, 6, { hp: 3, maxHp: 10 });
        state.units.set(medic1.id, medic1);
        state.units.set(medic2.id, medic2);
        state.units.set(wounded.id, wounded);

        runTurn(state);

        // Each medic heals 2 HP → total +4
        expect(wounded.hp).toBe(7);
    });
});
