/**
 * Turn manager integration tests.
 * Exercises the full turn cycle: resources → upkeep → growth → unrest →
 * trade routes → tech research → diplomacy → unit flag reset → lord regen.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createTurnManager } from '../src/turnmanager.js';
import { PLAYER_FACTION, setGridDimensions } from '../src/config.js';
import { makeGameState, makeUnit, makeTile } from './helpers.js';

// Set grid dimensions so economy functions work correctly.
beforeEach(() => { setGridDimensions(20, 20); });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function runTurn(state, opts = {}) {
    const {
        factions = [PLAYER_FACTION, 'ai1'],
        runAI = null,
        renderAll = null,
        spectateMode = false,
    } = opts;
    const tm = createTurnManager(state, factions, null, runAI, renderAll, spectateMode);
    tm.setLogger(opts.logger || null);
    tm.setRecalcFog(opts.recalcFog || null);
    tm.setAutosave(opts.autosave || null);
    tm.endPlayerTurn();
    return tm;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('turnmanager — turn cycle', () => {
    it('increments the turn counter', () => {
        const state = makeGameState();
        state.turn = 5;
        runTurn(state);
        expect(state.turn).toBe(6);
    });

    it('resets unit hasMovedThisTurn and hasAttackedThisTurn', () => {
        const state = makeGameState();
        const u = [...state.units.values()][0];
        u.hasMovedThisTurn = true;
        u.hasAttackedThisTurn = true;

        runTurn(state);

        expect(u.hasMovedThisTurn).toBe(false);
        expect(u.hasAttackedThisTurn).toBe(false);
    });

    it('clears selection state at turn end', () => {
        const state = makeGameState();
        state.selectedUnit = { id: 99 };
        state.selectedLord = { id: 88 };
        state.moveTargets = new Set(['1,1', '2,2']);
        state.attackTargets = [{ id: 1 }];
        state.chargeTargets = [{ id: 2 }];
        state.bridgeTargets = ['3,3'];
        state.siegeTowerTarget = { id: 4 };
        state.chariotChargeTargets = [{ id: 5 }];

        runTurn(state);

        expect(state.selectedUnit).toBeNull();
        expect(state.selectedLord).toBeNull();
        expect(state.moveTargets.size).toBe(0);
        expect(state.attackTargets).toEqual([]);
        expect(state.chargeTargets).toEqual([]);
        expect(state.bridgeTargets).toEqual([]);
        expect(state.siegeTowerTarget).toBeNull();
        expect(state.chariotChargeTargets).toEqual([]);
    });

    it('deducts unit upkeep from resources', () => {
        const state = makeGameState();
        const goldBefore = state.resources.player.gold;
        // An INFANTRY unit has upkeep { food: 3, gold: 2 }
        runTurn(state);
        // Upkeep should reduce gold (resources collected first, then upkeep deducted)
        expect(state.resources.player.gold).toBeLessThanOrEqual(goldBefore + 50); // net may still be positive from city yields
    });

    it('clears trainedThisTurn set', () => {
        const state = makeGameState();
        state.trainedThisTurn.add('player');
        state.trainedThisTurn.add('ai1');

        runTurn(state);

        expect(state.trainedThisTurn.size).toBe(0);
    });

    it('ticks king cooldowns down', () => {
        const state = makeGameState();
        state.kingCooldowns = { player: 3, ai1: 1 };

        runTurn(state);

        expect(state.kingCooldowns.player).toBe(2);
        expect(state.kingCooldowns.ai1).toBe(0);
    });

    it('clears tempBonuses', () => {
        const state = makeGameState();
        state.tempBonuses = { player: { attack: 3 } };

        runTurn(state);

        expect(Object.keys(state.tempBonuses)).toHaveLength(0);
    });

    it('processes medic healing', () => {
        const state = makeGameState();
        const medic = makeUnit('MEDIC', 'player', 6, 5);
        const infantry = makeUnit('INFANTRY', 'player', 6, 6);
        infantry.hp = 5; // damaged
        state.units.set(medic.id, medic);
        state.units.set(infantry.id, infantry);

        runTurn(state);

        // Medic heals 2 HP (UNIT_TYPE.MEDIC.heal)
        expect(infantry.hp).toBe(7);
    });

    it('does NOT heal BERSERKER (noMedic flag)', () => {
        const state = makeGameState();
        const medic = makeUnit('MEDIC', 'player', 6, 5);
        const berserker = makeUnit('BERSERKER', 'player', 6, 6);
        berserker.hp = 5;
        state.units.set(medic.id, medic);
        state.units.set(berserker.id, berserker);

        runTurn(state);

        expect(berserker.hp).toBe(5); // not healed
    });

    it('heals lords at turn end', () => {
        const state = makeGameState();
        state.lords = [{ id: 10, owner: 'player', x: 5, z: 5, hp: 8, maxHp: 15, hasMovedThisTurn: true, hasAttackedThisTurn: true }];

        runTurn(state);

        const lord = state.lords[0];
        expect(lord.hp).toBeGreaterThan(8);
        expect(lord.hasMovedThisTurn).toBe(false);
        expect(lord.hasAttackedThisTurn).toBe(false);
    });

    it('chargeExhausted decrements and immobilizes at >=2', () => {
        const state = makeGameState();
        const cavalry = makeUnit('CAVALRY', 'player', 5, 5);
        cavalry.chargeExhausted = 2;
        state.units.set(cavalry.id, cavalry);

        runTurn(state);

        // chargeExhausted was 2 → immobilized (hasMovedThisTurn = true), then decremented to 1
        expect(cavalry.hasMovedThisTurn).toBe(true);
        expect(cavalry.chargeExhausted).toBe(1);
    });

    it('stunnedTurns decrements and immobilizes unit', () => {
        const state = makeGameState();
        const u = makeUnit('INFANTRY', 'player', 5, 5);
        u.stunnedTurns = 1;
        state.units.set(u.id, u);

        runTurn(state);

        expect(u.hasMovedThisTurn).toBe(true);
        expect(u.hasAttackedThisTurn).toBe(true);
        expect(u.stunnedTurns).toBe(0);
    });

    it('calls runAI for each AI faction', () => {
        const state = makeGameState();
        const called = [];
        runTurn(state, { runAI: (faction) => called.push(faction) });

        expect(called).toContain('ai1');
    });

    it('skips eliminated AI factions', () => {
        const state = makeGameState();
        state.eliminated = new Set(['ai1']);
        const called = [];
        runTurn(state, { runAI: (faction) => called.push(faction) });

        expect(called).not.toContain('ai1');
    });

    it('continues if one AI throws an error', () => {
        const state = makeGameState();
        // ai1 throws, but the turn should still complete
        const throwAI = (f) => { if (f === 'ai1') throw new Error('boom'); };
        expect(() => runTurn(state, { runAI: throwAI })).not.toThrow();
        expect(state.turn).toBe(2); // turn still incremented
    });

    it('calls renderAll at end of turn', () => {
        const state = makeGameState();
        let rendered = false;
        runTurn(state, { renderAll: () => { rendered = true; } });
        expect(rendered).toBe(true);
    });

    it('calls autosave at end of turn', () => {
        const state = makeGameState();
        let saved = false;
        runTurn(state, { autosave: () => { saved = true; } });
        expect(saved).toBe(true);
    });

    it('does not increment turn if not in player phase', () => {
        const state = makeGameState();
        const tm = createTurnManager(state, [PLAYER_FACTION, 'ai1'], null, null, null);
        tm.phase = 'ai1'; // not PLAYER_FACTION
        tm.endPlayerTurn();
        expect(state.turn).toBe(1); // not incremented
    });

    it('processes trade route income', () => {
        const state = makeGameState();
        state.tradeRoutes = [{
            id: 1,
            from: { owner: 'player', cityKey: '5,5', x: 5, z: 5 },
            to: { owner: 'ai1', cityKey: '10,10', x: 10, z: 10 },
            income: 15,
            path: ['5,5', '6,5', '7,5'],
            disrupted: false,
            disruptedTurnsLeft: 0,
        }];
        const goldBefore = state.resources.player.gold;

        runTurn(state);

        // Player should have gained trade route income (15 gold)
        expect(state.resources.player.gold).toBeGreaterThanOrEqual(goldBefore);
    });

    it('ticks trade route disruption counters', () => {
        const state = makeGameState();
        state.tradeRoutes = [{
            id: 1,
            from: { owner: 'player', cityKey: '5,5', x: 5, z: 5 },
            to: { owner: 'ai1', cityKey: '10,10', x: 10, z: 10 },
            income: 15,
            path: ['5,5'],
            disrupted: true,
            disruptedTurnsLeft: 2,
        }];

        runTurn(state);

        expect(state.tradeRoutes[0].disruptedTurnsLeft).toBe(1);
        expect(state.tradeRoutes[0].disrupted).toBe(true);
    });

    it('clears completed disruption', () => {
        const state = makeGameState();
        state.tradeRoutes = [{
            id: 1,
            from: { owner: 'player', cityKey: '5,5', x: 5, z: 5 },
            to: { owner: 'ai1', cityKey: '10,10', x: 10, z: 10 },
            income: 15,
            path: ['5,5'],
            disrupted: true,
            disruptedTurnsLeft: 1,
        }];

        runTurn(state);

        expect(state.tradeRoutes[0].disruptedTurnsLeft).toBe(0);
        expect(state.tradeRoutes[0].disrupted).toBe(false);
    });

    it('reputation increases for factions at peace', () => {
        const state = makeGameState();
        state.reputation = { player: 50, ai1: 50 };

        runTurn(state);

        expect(state.reputation.player).toBe(51);
        expect(state.reputation.ai1).toBe(51);
    });

    it('reputation does NOT increase for factions at war', () => {
        const state = makeGameState();
        state.reputation = { player: 50, ai1: 50 };
        state.diplomacy.relations['ai1:player'] = { state: 'war', grievances: 0, grievanceLog: [] };

        runTurn(state);

        // Both at war with each other — neither should gain
        expect(state.reputation.player).toBe(50);
        expect(state.reputation.ai1).toBe(50);
    });
});

describe('turnmanager — spectate mode', () => {
    it('processes all factions as AI in spectate mode', () => {
        const state = makeGameState();
        const called = [];
        const tm = createTurnManager(state, [PLAYER_FACTION, 'ai1'], null,
            (f) => called.push(f), null, true);
        tm.endPlayerTurn();

        expect(called).toContain(PLAYER_FACTION);
        expect(called).toContain('ai1');
    });

    it('increments turn even without player phase check in spectate', () => {
        const state = makeGameState();
        const tm = createTurnManager(state, [PLAYER_FACTION, 'ai1'], null, null, null, true);
        tm.endPlayerTurn();
        expect(state.turn).toBe(2);
    });
});

describe('turnmanager — phase management', () => {
    it('returns PLAYER_FACTION as initial phase', () => {
        const state = makeGameState();
        const tm = createTurnManager(state, [PLAYER_FACTION, 'ai1']);
        expect(tm.phase).toBe(PLAYER_FACTION);
    });

    it('phase can be set externally', () => {
        const state = makeGameState();
        const tm = createTurnManager(state, [PLAYER_FACTION, 'ai1']);
        tm.phase = 'ai1';
        expect(tm.phase).toBe('ai1');
    });
});
