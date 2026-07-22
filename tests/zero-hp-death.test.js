/**
 * Regression tests for the "0 HP unit/lord never dies" bug (Part B).
 *
 * Root cause chain that kept "Spymaster Nyx" (a KING lord) alive at 0 HP:
 *  1. AI combat predictions (simulateCombat) shallow-cloned lord combatants, so
 *     resolveCombat's syncLordHp wrote simulated (often lethal) damage onto the
 *     REAL lord — no death routing. (Covered in tests/battle.test.js.)
 *  2. 0-hp lords were filtered OUT of attack targeting, so nothing could ever
 *     finish them off.
 *  3. Turn-start regeneration healed any lord with hp < maxHp — including dead
 *     ones — lifting them back to positive HP every round ("healing rate equals
 *     damage rate").
 *
 * Fixes under test: 0-hp combatants are valid attack targets, any attack on a
 * 0-hp defender kills it, a death sweep removes hp<=0 units/lords (king death
 * still eliminates the faction), and healing never resurrects the dead.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// three.js is not installed in the test environment — stub the renderer module
// so game.js can be imported.
vi.mock('../src/renderer.js', () => ({ GameRenderer: class {} }));

import { Game } from '../src/game.js';
import { createTurnManager } from '../src/turnmanager.js';
import { lordCombatant } from '../src/lords.js';
import { PLAYER_FACTION, setGridDimensions } from '../src/config.js';
import { makeGameState, makeUnit } from './helpers.js';

// sound.js looks up window.AudioContext when playing SFX; a bare global makes
// every SFX a no-op under node.
if (typeof globalThis.window === 'undefined') globalThis.window = {};

beforeEach(() => { setGridDimensions(40, 40); });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function warDiplo(a, b) {
    const rel = {
        state: 'war', turnsAllied: 0, turnsAtWar: 3, relationship: -50,
        warsDeclared: 1, peaceTreaties: 0, tradesMade: 0, brokenTreaties: 0,
        grievances: 0, grievanceLog: [], expiresOn: null, formalWar: true,
        lastWarDeclaredTurn: 1, grudges: {}, trust: 0.1,
    };
    return { relations: { [[a, b].sort().join(':')]: rel }, pendingOffers: [], diplomaticEvents: [] };
}

let _lordId = 1;
function makeKing(owner, x, z, overrides = {}) {
    return {
        id: `king-${owner}-${_lordId++}`, owner, x, z, isKing: true,
        name: `King of ${owner}`, xp: 0, level: 1,
        stats: { command: 2, combat: 2, governance: 1 },
        abilities: [], army: [],
        hp: 20, maxHp: 20,
        hasMovedThisTurn: false, hasAttackedThisTurn: false,
        ...overrides,
    };
}

/** A Game instance without the DOM/renderer: prototype methods run against a
 *  plain gameState, with every renderer/ui call no-oped. */
function makeGame(state) {
    const g = Object.create(Game.prototype);
    g.gameState = state;
    g.tiles = state.tiles;
    g.factionColors = state.factionColors;
    g.factionDefs = state.factionDefs;
    g.spectateMode = false;
    g.hooks = {};
    const noop = () => {};
    g.renderer = new Proxy({}, { get: () => noop });
    g.ui = new Proxy({}, { get: () => noop });
    g.logs = [];
    g.log = (m) => g.logs.push(m);
    g.checkVictory = () => {}; // victory logic is exercised elsewhere
    return g;
}

// ---------------------------------------------------------------------------
// Attacking 0-hp combatants through Game handlers
// ---------------------------------------------------------------------------
describe('0-hp combatants die when attacked (Game handlers)', () => {
    it('a melee attack on a 0-hp unit removes it from the map', () => {
        const state = makeGameState({ diplomacy: warDiplo('player', 'ai1') });
        state.units.clear();
        const atk = makeUnit('INFANTRY', 'player', 9, 10);
        const def = makeUnit('INFANTRY', 'ai1', 10, 10, { hp: 0, maxHp: 10 });
        state.units.set(atk.id, atk);
        state.units.set(def.id, def);
        const g = makeGame(state);

        g.handleAttack(atk, def);

        expect(state.units.has(def.id)).toBe(false);
        expect(state.graveyard.some(x => x.owner === 'ai1')).toBe(true);
    });

    it('a ranged attack on a 0-hp unit kills it even when the shot is dodged', () => {
        const state = makeGameState({ diplomacy: warDiplo('player', 'ai1') });
        state.units.clear();
        const atk = makeUnit('ARCHER', 'player', 8, 10); // distance 2 → dodge possible
        const def = makeUnit('INFANTRY', 'ai1', 10, 10, { hp: 0, maxHp: 10 });
        state.units.set(atk.id, atk);
        state.units.set(def.id, def);
        const g = makeGame(state);

        const spy = vi.spyOn(Math, 'random').mockReturnValue(0); // force the dodge
        try {
            g.handleAttack(atk, def);
        } finally { spy.mockRestore(); }

        expect(g.logs.some(m => m.includes('dodges'))).toBe(true); // the shot really was dodged
        expect(state.units.has(def.id)).toBe(false);               // ...but a corpse can't dodge death
    });

    it('a 0-hp king inside a city being attacked dies and his faction is eliminated', () => {
        const state = makeGameState({ diplomacy: warDiplo('player', 'ai1') });
        state.units.clear();
        const atk = makeUnit('INFANTRY', 'player', 9, 10);
        state.units.set(atk.id, atk);
        // King "Nyx" stands on his city at 0 HP — the reported scenario.
        const king = makeKing('ai1', 10, 10, { hp: 0, name: 'Spymaster Nyx' });
        state.lords.push(king);
        const remnant = makeUnit('INFANTRY', 'ai1', 11, 10); // faction remnant to wipe
        state.units.set(remnant.id, remnant);
        const g = makeGame(state);

        g.handleAttack(atk, lordCombatant(king));

        expect(state.lords.includes(king)).toBe(false);        // the king is dead
        expect(state.eliminated.has('ai1')).toBe(true);        // king death eliminates the faction
        expect(state.units.has(remnant.id)).toBe(false);       // its units are removed
        expect(state.tiles.get('10,10').owner).toBe(null);     // its cities go neutral
    });

    it('a 0-hp enemy lord shows up as a valid attack target (can be finished off)', () => {
        // Regression: selectUnit used to skip hp<=0 lords, making 0-hp kings
        // permanently untargetable.
        const state = makeGameState({ diplomacy: warDiplo('player', 'ai1') });
        state.units.clear();
        const atk = makeUnit('INFANTRY', 'player', 9, 10);
        state.units.set(atk.id, atk);
        const king = makeKing('ai1', 10, 10, { hp: 0 });
        state.lords.push(king);
        const g = makeGame(state);

        g.selectUnit(atk);

        expect(state.attackTargets.map(t => t.id)).toContain(king.id);
    });

    it('a living (wounded) enemy lord also remains a valid attack target', () => {
        const state = makeGameState({ diplomacy: warDiplo('player', 'ai1') });
        state.units.clear();
        const atk = makeUnit('INFANTRY', 'player', 9, 10);
        state.units.set(atk.id, atk);
        const king = makeKing('ai1', 10, 10, { hp: 7 });
        state.lords.push(king);
        const g = makeGame(state);

        g.selectUnit(atk);

        expect(state.attackTargets.map(t => t.id)).toContain(king.id);
    });
});

// ---------------------------------------------------------------------------
// Death sweep
// ---------------------------------------------------------------------------
describe('_sweepDeadCombatants', () => {
    it('removes 0-hp units left behind by non-combat damage sources', () => {
        const state = makeGameState();
        const dead = makeUnit('INFANTRY', 'ai1', 10, 10, { hp: 0, maxHp: 10 });
        state.units.set(dead.id, dead);
        const g = makeGame(state);

        g._sweepDeadCombatants();

        expect(state.units.has(dead.id)).toBe(false);
        expect(state.graveyard.some(x => x.owner === 'ai1')).toBe(true);
    });

    it('removes a 0-hp king and eliminates his faction', () => {
        const state = makeGameState();
        const king = makeKing('ai1', 10, 10, { hp: 0 });
        state.lords.push(king);
        const g = makeGame(state);

        g._sweepDeadCombatants();

        expect(state.lords.includes(king)).toBe(false);
        expect(state.eliminated.has('ai1')).toBe(true);
    });

    it('leaves living units and lords untouched', () => {
        const state = makeGameState();
        const alive = makeUnit('INFANTRY', 'ai1', 10, 10, { hp: 1, maxHp: 10 });
        state.units.set(alive.id, alive);
        const king = makeKing('ai1', 10, 10, { hp: 1 });
        state.lords.push(king);
        const g = makeGame(state);

        g._sweepDeadCombatants();

        expect(state.units.has(alive.id)).toBe(true);
        expect(state.lords.includes(king)).toBe(true);
        expect(state.eliminated.has('ai1')).toBe(false);
    });

    it('endPlayerTurn buries a 0-hp king BEFORE turn-start regen can run', () => {
        const state = makeGameState();
        state.units.clear();
        const king = makeKing('ai1', 9, 10, { hp: 0 });
        state.lords.push(king);
        const g = makeGame(state);
        state.turnManager = createTurnManager(state, [PLAYER_FACTION, 'ai1'], null, null, null);

        g.endPlayerTurn();

        expect(state.lords.includes(king)).toBe(false);     // swept, not healed
        expect(state.eliminated.has('ai1')).toBe(true);     // and the faction falls
        expect(state.turn).toBe(2);                         // the turn still advanced
    });
});

// ---------------------------------------------------------------------------
// Healing never resurrects the dead
// ---------------------------------------------------------------------------
describe('healing does not resurrect 0-hp combatants', () => {
    it('lord regen heals a wounded living king but not a 0-hp one', () => {
        const state = makeGameState();
        const wounded = makeKing('ai1', 9, 10, { hp: 10, maxHp: 20 }); // not in his city → +2
        const dead = makeKing('player', 8, 8, { hp: 0, maxHp: 20 });
        state.lords.push(wounded, dead);
        const tm = createTurnManager(state, [PLAYER_FACTION, 'ai1'], null, null, null);

        tm.endPlayerTurn();

        expect(wounded.hp).toBe(12); // living lord regen still works
        expect(dead.hp).toBe(0);     // the dead do not regenerate
    });

    it('medics heal wounded units but do not resurrect 0-hp units', () => {
        const state = makeGameState();
        state.units.clear();
        const medic = makeUnit('MEDIC', 'player', 6, 5);
        const wounded = makeUnit('INFANTRY', 'player', 5, 5, { hp: 5, maxHp: 10 });
        const dead = makeUnit('INFANTRY', 'player', 7, 5, { hp: 0, maxHp: 10 });
        for (const u of [medic, wounded, dead]) state.units.set(u.id, u);
        const tm = createTurnManager(state, [PLAYER_FACTION, 'ai1'], null, null, null);

        tm.endPlayerTurn();

        expect(wounded.hp).toBeGreaterThan(5); // medic heal still works on the living
        expect(dead.hp).toBe(0);               // ...but no resurrection
    });

    it('king Golden Gate heal does not resurrect a 0-hp unit', () => {
        const state = makeGameState();
        state.units.clear();
        const wounded = makeUnit('INFANTRY', 'player', 6, 5, { hp: 3, maxHp: 10 });
        const dead = makeUnit('INFANTRY', 'player', 5, 5, { hp: 0, maxHp: 10 });
        state.units.set(wounded.id, wounded);
        state.units.set(dead.id, dead);
        const king = makeKing('player', 5, 5, { active: { id: 'golden_gate', cooldown: 4 } });
        state.lords.push(king);
        const g = makeGame(state);
        g.factionDefs = { player: { id: 'crimson' } }; // activateKing requires a faction def

        g.activateKing('player');

        expect(wounded.hp).toBe(10); // the living are healed to full
        expect(dead.hp).toBe(0);     // the dead stay dead
    });
});
