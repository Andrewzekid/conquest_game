/**
 * City siege scenario/integration tests (Phase 2: breach/capture mechanics).
 *
 * Covers:
 *  1. Breach persistence: ranged trebuchets breach a city and it STAYS breached
 *     through the next turn (no instant 0->1 regen) so it can be captured —
 *     the infinite re-breach/regen loop is broken.
 *  2. Auto-capture on move-in: a unit moving into a breached, undefended city
 *     captures it (player move path AND AI executor path).
 *  3. AI capture guards: no capture while an enemy defender occupies the city
 *     tile, and no capture during the breach-delay turn.
 *  4. Ranged attacks vs unbreached cities chip the fortification AND damage
 *     the defender; melee never chips; after the breach defenses are down.
 *  5. Siege tower: adjacent tower lowers city defense; tower cost reduced.
 *  6. Kings/lords get no healing inside breached or besieged cities.
 *  7. Fort recovery wear-down via siege pressure (unit-level coverage is in
 *     tests/map.test.js).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// three.js is not installed in the test environment — stub the renderer module
// so game.js can be imported.
vi.mock('../src/renderer.js', () => ({ GameRenderer: class {} }));

// Wrap computeAIActions in a spy so executor tests can inject a crafted action
// list while every other test transparently gets the real implementation.
const aiMock = vi.hoisted(() => ({ real: null }));
vi.mock('../src/ai.js', async (importOriginal) => {
    const orig = await importOriginal();
    aiMock.real = orig.computeAIActions;
    return { ...orig, computeAIActions: vi.fn((...args) => aiMock.real(...args)) };
});

import { Game } from '../src/game.js';
import { createTurnManager } from '../src/turnmanager.js';
import { regenFortification } from '../src/map.js';
import { computeAIActions } from '../src/ai.js';
import {
    PLAYER_FACTION, setGridDimensions, UNIT_TYPE, CAPTURE_COST,
    SIEGE_TOWER_COST, SIEGE_TOWER_CITY_DEFENSE_REDUCTION, TERRAIN_BONUS,
    RANGED_BOMBARD_FORT_DAMAGE,
} from '../src/config.js';
import { makeGameState, makeUnit } from './helpers.js';

// sound.js looks up window.AudioContext when playing SFX; a bare global makes
// every SFX a no-op under node.
if (typeof globalThis.window === 'undefined') globalThis.window = {};

beforeEach(() => {
    setGridDimensions(40, 40);
    // Restore the real AI planner before each test (executor tests override it).
    computeAIActions.mockImplementation((...args) => aiMock.real(...args));
});

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
    g.updateFog = () => {};    // fog is exercised elsewhere
    return g;
}

/** A Game ready for runAITurn: diplomacy/king side-systems stubbed so the test
 *  focuses on the action executor. computeAIActions stays real unless the test
 *  overrides the mock. */
function makeAIGame(state) {
    const g = makeGame(state);
    g._aiMaybeDeclareWar = () => {};
    g._aiMaybeProposeTreaty = () => {};
    g._aiShouldActivateKing = () => false;
    g._aiMoveLords = () => {};
    g._aiLordAttack = () => {};
    return g;
}

/** Force the AI planner to emit a single capture action for `tileKey` by the
 *  first ai1 unit — drives the game.js action executor directly. */
function forceCaptureAction(tileKey, faction = 'ai1') {
    computeAIActions.mockImplementation((units) => {
        const u = [...units.values()].find(x => x.owner === faction);
        return [{ type: 'capture', unitId: u.id, tileKey }];
    });
}

// ---------------------------------------------------------------------------
// 1. Breach persistence: no more infinite re-breach/regen loop
// ---------------------------------------------------------------------------
describe('breach persistence', () => {
    it('two trebuchets breach a city from range; it stays breached next turn and is captured on move-in', () => {
        const state = makeGameState({ diplomacy: warDiplo('player', 'ai1') });
        const city = state.tiles.get('10,10'); // ai1 city
        city.fortification = 6; city.fortMax = 6; // needs both trebuchets (3 power each)
        state.units.clear();
        const t1 = makeUnit('TREBUCHET', 'player', 7, 10);  // range 3 — NOT adjacent
        const t2 = makeUnit('TREBUCHET', 'player', 10, 7);  // range 3 — NOT adjacent
        state.units.set(t1.id, t1);
        state.units.set(t2.id, t2);
        const g = makeGame(state);

        g.handleBesiege(t1, city);
        g.handleBesiege(t2, city);
        expect(city.fortification).toBe(0);
        expect(city.breachedTurn).toBe((state.turn || 0) + 1);

        // The next turn's regen must NOT pop the city back to 1 — that was the
        // infinite loop (ranged siege re-breaches every turn but regen 0->1
        // blocked capture before anyone could move in).
        regenFortification(state.tiles, state.units);
        expect(city.fortification).toBe(0);

        // Breach delay over: a unit moves in and captures automatically.
        state.turn = city.breachedTurn;
        const inf = makeUnit('INFANTRY', 'player', 10, 9);
        state.units.set(inf.id, inf);
        const goldBefore = state.resources.player.gold;
        g.moveUnit(inf, 10, 10);
        expect(city.owner).toBe('player');
        expect(state.resources.player.gold).toBe(goldBefore - CAPTURE_COST);
    });

    it('fort recovery wears down under repeated siege and resumes after rest', () => {
        const state = makeGameState({ diplomacy: warDiplo('player', 'ai1') });
        const city = state.tiles.get('10,10');
        city.fortification = 9; city.fortMax = 9;
        state.units.clear();
        const siege = makeUnit('SIEGE', 'player', 9, 10);
        const g = makeGame(state);

        // Besiege for three turns: pressure accumulates (capped), no regen.
        g.handleBesiege(siege, city);
        g.handleBesiege(siege, city);
        g.handleBesiege(siege, city);
        expect(city.fortification).toBe(3); // 9 - 3*2
        expect(city.siegePressure).toBe(3);

        // Rest: while pressure remains, regen is suppressed and pressure decays.
        regenFortification(state.tiles, state.units);
        expect(city.fortification).toBe(3);
        regenFortification(state.tiles, state.units);
        expect(city.fortification).toBe(3);
        regenFortification(state.tiles, state.units);
        expect(city.fortification).toBe(3);
        expect(city.siegePressure).toBe(0);
        // Pressure gone: normal +1 regen resumes.
        regenFortification(state.tiles, state.units);
        expect(city.fortification).toBe(4);
    });
});

// ---------------------------------------------------------------------------
// 2-3. Capture on move-in: player path and AI executor path + guards
// ---------------------------------------------------------------------------
describe('auto-capture on move-in', () => {
    it('player unit moving into a breached, undefended city captures it', () => {
        const state = makeGameState({ diplomacy: warDiplo('player', 'ai1') });
        const city = state.tiles.get('10,10');
        city.fortification = 0;
        city.breachedTurn = 1; // delay long past
        state.units.clear();
        const inf = makeUnit('INFANTRY', 'player', 10, 9);
        state.units.set(inf.id, inf);
        const g = makeGame(state);

        g.moveUnit(inf, 10, 10);

        expect(city.owner).toBe('player');
        expect(state.resources.player.gold).toBe(200 - CAPTURE_COST);
    });

    it('AI executor captures a breached, undefended city and garrisons the unit', () => {
        const state = makeGameState({ diplomacy: warDiplo('player', 'ai1') });
        const city = state.tiles.get('5,5'); // player city
        city.fortification = 0;
        city.breachedTurn = 1; // delay long past
        state.units.clear();
        const aiInf = makeUnit('INFANTRY', 'ai1', 6, 5);
        state.units.set(aiInf.id, aiInf);
        const g = makeAIGame(state);

        forceCaptureAction('5,5');
        g.runAITurn('ai1');

        expect(city.owner).toBe('ai1');
        expect([aiInf.x, aiInf.z]).toEqual([5, 5]); // garrisoned on the city tile
        expect(state.resources.ai1.gold).toBe(200 - CAPTURE_COST);
    });

    it('AI executor refuses to capture a breached city still occupied by an enemy defender', () => {
        const state = makeGameState({ diplomacy: warDiplo('player', 'ai1') });
        const city = state.tiles.get('5,5');
        city.fortification = 0;
        city.breachedTurn = 1;
        state.units.clear();
        const defender = makeUnit('INFANTRY', 'player', 5, 5); // still holding the city
        const aiInf = makeUnit('INFANTRY', 'ai1', 6, 5);
        state.units.set(defender.id, defender);
        state.units.set(aiInf.id, aiInf);
        const g = makeAIGame(state);

        forceCaptureAction('5,5');
        g.runAITurn('ai1');

        expect(city.owner).toBe('player');                    // NOT captured
        expect([aiInf.x, aiInf.z]).toEqual([6, 5]);           // no teleporting in
        expect(state.resources.ai1.gold).toBe(200);           // no gold spent
    });

    it('AI executor refuses to capture during the breach-delay turn', () => {
        const state = makeGameState({ diplomacy: warDiplo('player', 'ai1') });
        const city = state.tiles.get('5,5');
        city.fortification = 0;
        city.breachedTurn = state.turn + 1; // breach delay still running
        state.units.clear();
        const aiInf = makeUnit('INFANTRY', 'ai1', 6, 5);
        state.units.set(aiInf.id, aiInf);
        const g = makeAIGame(state);

        forceCaptureAction('5,5');
        g.runAITurn('ai1');

        expect(city.owner).toBe('player');
        expect([aiInf.x, aiInf.z]).toEqual([6, 5]);
        expect(state.resources.ai1.gold).toBe(200);
    });

    it('AI planning emits no capture action for an occupied or breach-delayed city', () => {
        const mkState = (overrides) => {
            const state = makeGameState({ diplomacy: warDiplo('player', 'ai1') });
            const city = state.tiles.get('5,5');
            city.fortification = 0;
            Object.assign(city, overrides);
            state.units.clear();
            return { state, city };
        };
        const plan = (state) => computeAIActions(
            state.units, state.tiles, state.resources.ai1, 'ai1',
            state.buildings, null, null, state.diplomacy,
            state.lords, state.tempBonuses, state.structures, state.buildingState,
            null, null, state.victoryState, state.turn);

        // Occupied: defender inside → no capture action.
        {
            const { state } = mkState({ breachedTurn: 1 });
            const defender = makeUnit('INFANTRY', 'player', 5, 5);
            state.units.set(defender.id, defender);
            const aiInf = makeUnit('INFANTRY', 'ai1', 6, 5);
            state.units.set(aiInf.id, aiInf);
            expect(plan(state).some(a => a.type === 'capture')).toBe(false);
        }
        // Breach delay running: empty city but breachedTurn in the future.
        {
            const { state } = mkState({});
            const city = state.tiles.get('5,5');
            city.breachedTurn = state.turn + 1;
            const aiInf = makeUnit('INFANTRY', 'ai1', 6, 5);
            state.units.set(aiInf.id, aiInf);
            expect(plan(state).some(a => a.type === 'capture')).toBe(false);
        }
        // Empty city, delay passed → capture action IS planned.
        {
            const { state } = mkState({ breachedTurn: 1 });
            const aiInf = makeUnit('INFANTRY', 'ai1', 6, 5);
            state.units.set(aiInf.id, aiInf);
            expect(plan(state).some(a => a.type === 'capture' && a.tileKey === '5,5')).toBe(true);
        }
    });
});

// ---------------------------------------------------------------------------
// 4. Ranged attacks vs unbreached cities chip fort + damage defender
// ---------------------------------------------------------------------------
describe('ranged combat vs unbreached cities', () => {
    function combatState() {
        const state = makeGameState({ diplomacy: warDiplo('player', 'ai1') });
        state.units.clear();
        state.buildings.clear(); // no WALLS — keep the numbers clean
        const city = state.tiles.get('10,10'); // fort 3/3
        return { state, city, g: makeGame(state) };
    }

    it('artillery attack chips the fort by its besiegePower AND damages the defender', () => {
        const { state, city, g } = combatState();
        const art = makeUnit('ARTILLERY', 'player', 9, 10, { attack: 7 });
        const def = makeUnit('INFANTRY', 'ai1', 10, 10, { hp: 50, maxHp: 50 });
        state.units.set(art.id, art);
        state.units.set(def.id, def);

        g.handleAttack(art, def);

        const chip = UNIT_TYPE.ARTILLERY.besiegePower;
        expect(city.fortification).toBe(3 - chip);
        expect(def.hp).toBeLessThan(50);        // defender was hit too
        expect(def.hp).toBeGreaterThan(0);      // ...but the walls soak most of it
        expect(city.siegePressure).toBeGreaterThan(0);
        expect(g.logs.some(m => m.includes('chips the walls'))).toBe(true);
    });

    it('archer attack chips the fort by RANGED_BOMBARD_FORT_DAMAGE with low defender damage', () => {
        const { state, city, g } = combatState();
        const archer = makeUnit('ARCHER', 'player', 9, 10);
        const def = makeUnit('INFANTRY', 'ai1', 10, 10, { hp: 50, maxHp: 50 });
        state.units.set(archer.id, archer);
        state.units.set(def.id, def);

        g.handleAttack(archer, def);

        expect(city.fortification).toBe(3 - RANGED_BOMBARD_FORT_DAMAGE);
        // Low damage through the city defense bonus (attack 4+1 vs defense 2+8).
        expect(def.hp).toBe(48);
    });

    it('melee attacks never chip the fortification', () => {
        const { state, city, g } = combatState();
        const inf = makeUnit('INFANTRY', 'player', 9, 10);
        const def = makeUnit('INFANTRY', 'ai1', 10, 10, { hp: 50, maxHp: 50 });
        state.units.set(inf.id, inf);
        state.units.set(def.id, def);

        g.handleAttack(inf, def);

        expect(city.fortification).toBe(3);
        expect(def.hp).toBeLessThan(50); // the defender still takes the hit
    });

    it('after the breach, attacks hit the defender with defenses down (and no chip)', () => {
        const { state, city, g } = combatState();
        city.fortification = 0; // breached
        const art = makeUnit('ARTILLERY', 'player', 9, 10, { attack: 7 });
        const def = makeUnit('INFANTRY', 'ai1', 10, 10, { hp: 50, maxHp: 50 });
        state.units.set(art.id, art);
        state.units.set(def.id, def);

        g.handleAttack(art, def);

        expect(city.fortification).toBe(0); // nothing left to chip
        // Defenses down: same attacker dealt 9 damage through walls, more now.
        expect(def.hp).toBeLessThan(41);
        expect(g.logs.some(m => m.includes('breached'))).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// 5. Siege tower support
// ---------------------------------------------------------------------------
describe('siege tower support', () => {
    it('siege tower cost is reduced and the defense reduction is a named constant', () => {
        expect(SIEGE_TOWER_COST).toEqual({ gold: 25, wood: 10, iron: 0, production: 10 });
        expect(SIEGE_TOWER_CITY_DEFENSE_REDUCTION).toBe(TERRAIN_BONUS.CITY.defense / 2);
    });

    it('a friendly siege tower adjacent to the city lowers its defense in a real attack', () => {
        const state = makeGameState({ diplomacy: warDiplo('player', 'ai1') });
        state.units.clear();
        state.buildings.clear();
        const inf = makeUnit('INFANTRY', 'player', 9, 10, { attack: 20 });
        const tower = makeUnit('SIEGE_TOWER', 'player', 10, 11);
        const def = makeUnit('INFANTRY', 'ai1', 10, 10, { hp: 100, maxHp: 100 });
        state.units.set(inf.id, inf);
        state.units.set(tower.id, tower);
        state.units.set(def.id, def);
        const g = makeGame(state);

        g.handleAttack(inf, def);

        expect(g.logs.some(m => m.includes('siege tower undermines'))).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// 6. No lord healing in breached or besieged cities
// ---------------------------------------------------------------------------
describe('king/lord healing in besieged cities', () => {
    it('a king inside a breached city gets no heal', () => {
        const state = makeGameState();
        state.units.clear();
        const city = state.tiles.get('10,10'); // ai1 city
        city.fortification = 0; // breached
        const king = makeKing('ai1', 10, 10, { hp: 10, maxHp: 20 });
        state.lords.push(king);
        const tm = createTurnManager(state, [PLAYER_FACTION, 'ai1'], null, null, null);

        tm.endPlayerTurn();

        expect(king.hp).toBe(10); // neither +5 nor +2
    });

    it('a king inside a besieged city (enemy unit adjacent) gets no heal', () => {
        const state = makeGameState();
        state.units.clear();
        const city = state.tiles.get('10,10'); // fort 3 — walls still up
        const king = makeKing('ai1', 10, 10, { hp: 10, maxHp: 20 });
        state.lords.push(king);
        const enemy = makeUnit('INFANTRY', 'player', 9, 10); // at the gates
        state.units.set(enemy.id, enemy);
        const tm = createTurnManager(state, [PLAYER_FACTION, 'ai1'], null, null, null);

        tm.endPlayerTurn();

        expect(king.hp).toBe(10);
    });

    it('a king in a safe own city still heals +5', () => {
        const state = makeGameState();
        state.units.clear();
        const king = makeKing('ai1', 10, 10, { hp: 10, maxHp: 20 });
        state.lords.push(king);
        const tm = createTurnManager(state, [PLAYER_FACTION, 'ai1'], null, null, null);

        tm.endPlayerTurn();

        expect(king.hp).toBe(15);
    });

    it('a non-king lord in a besieged city also gets no heal', () => {
        const state = makeGameState();
        state.units.clear();
        const city = state.tiles.get('10,10');
        city.fortification = 0;
        const lord = makeKing('ai1', 10, 10, { hp: 10, maxHp: 20, isKing: false });
        state.lords.push(lord);
        const tm = createTurnManager(state, [PLAYER_FACTION, 'ai1'], null, null, null);

        tm.endPlayerTurn();

        expect(lord.hp).toBe(10); // the usual +2 is suppressed too
    });
});
