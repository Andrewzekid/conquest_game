/**
 * NaN-hp regression stress test: 40 rounds of real AI turns across 4 factions
 * at war with diverse unit types and lords, scanning for NaN/undefined hp
 * after every turn. Guards the "attacks ... (NaN / 60)" combat-log bug:
 * corrupted hp must never appear (and elsewhere counts as dead, not
 * immortal). Also covers selectGoals surviving a city-less faction
 * (homeAnchor null) after its capital falls mid-war.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../src/renderer.js', () => ({ GameRenderer: class {} }));

import { Game } from '../src/game.js';
import { createAIState } from '../src/ai_goals.js';
import { createTechState, TECHS } from '../src/tech.js';
import { FACTION_DEFS } from '../src/faction.js';
import { createLord } from '../src/lords.js';
import { setGridDimensions, DIPLOMACY_STATES } from '../src/config.js';
import { makeTile, makeGameState } from './helpers.js';
import { createUnit } from '../src/unit.js';

if (typeof globalThis.window === 'undefined') globalThis.window = {};

beforeEach(() => { setGridDimensions(40, 40); });

function warAll(factions) {
    const relations = {};
    for (const a of factions) for (const b of factions) {
        if (a === b) continue;
        relations[`${a}:${b}`] = {
            state: DIPLOMACY_STATES.WAR, turnsAllied: 0, turnsAtWar: 5,
            relationship: -80, warsDeclared: 1, peaceTreaties: 0,
            tradesMade: 0, brokenTreaties: 0, grievances: 0,
            grievanceLog: [], expiresOn: null, formalWar: true,
            lastWarDeclaredTurn: 1, grudges: {}, trust: 0,
        };
    }
    return { relations, pendingOffers: [], diplomaticEvents: [] };
}

function makeAIGame(state) {
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
    g.checkVictory = () => {};
    g.updateFog = () => {};
    g._aiMaybeDeclareWar = () => {};
    g._aiMaybeProposeTreaty = () => {};
    return g;
}

const ARMY = ['INFANTRY', 'ARCHER', 'CAVALRY', 'MORTAR', 'WINGED_HUSSAR', 'MUSKETEER',
    'LINE_INFANTRY', 'DEMOLITION_SQUAD', 'RIFLEMAN', 'BERSERKER', 'CATAPULT',
    'TREBUCHET', 'CANNON', 'PIKEMAN', 'LEGIONNAIRE', 'CHARIOT'];

function scanNaN(state, when) {
    for (const u of state.units.values()) {
        if (typeof u.hp !== 'number' || Number.isNaN(u.hp) || typeof u.maxHp !== 'number' || Number.isNaN(u.maxHp)) {
            return `NaN/invalid hp on unit ${u.type}#${u.id} owner=${u.owner} hp=${u.hp} maxHp=${u.maxHp} at ${when}`;
        }
    }
    for (const l of (state.lords || [])) {
        if (typeof l.hp !== 'number' || Number.isNaN(l.hp) || typeof l.maxHp !== 'number' || Number.isNaN(l.maxHp)) {
            return `NaN/invalid hp on lord ${l.name} owner=${l.owner} hp=${l.hp} maxHp=${l.maxHp} at ${when}`;
        }
    }
    return null;
}

describe('NaN-hp stress regression', () => {
    it('40 rounds of 4-way AI war never produce NaN hp', () => {
        const factions = ['player', 'ai1', 'ai2', 'ai3'];
        const factionIds = { player: 'crimson', ai1: 'viking', ai2: 'golden', ai3: 'iron' };
        const state = makeGameState({ turn: 10 });
        // Dense plains battlefield.
        for (let x = 0; x <= 19; x++) for (let z = 0; z <= 19; z++) {
            if (!state.tiles.has(`${x},${z}`)) state.tiles.set(`${x},${z}`, makeTile(x, z, 'PLAINS', null));
        }
        const cityPos = { player: [3, 3], ai1: [16, 3], ai2: [3, 16], ai3: [16, 16] };
        state.units.clear();
        state.factionDefs = {}; state.factionColors = {};
        state.aiState = {}; state.aiTechStates = {};
        const allTechs = createTechState();
        for (const id of Object.keys(TECHS)) allTechs.researched.add(id);
        let uid = 1000;
        for (const f of factions) {
            const [cx, cz] = cityPos[f];
            state.tiles.set(`${cx},${cz}`, makeTile(cx, cz, 'CITY', f, { cityName: `${f} City`, cityLevel: 3, fortification: 5, fortMax: 5 }));
            state.factionDefs[f] = FACTION_DEFS[factionIds[f]];
            state.factionColors[f] = { tile: 0xff0000, unit: 0xff0000, name: factionIds[f] };
            state.resources[f] = { gold: 5000, food: 3000, wood: 2000, iron: 1000, production: 2000 };
            state.aiState[f] = createAIState();
            state.aiTechStates[f] = allTechs;
            // Army clustered mid-map so factions clash immediately.
            ARMY.forEach((type, i) => {
                const ux = 8 + (i % 4), uz = 8 + Math.floor(i / 4) + (f === 'ai1' ? 1 : 0);
                const u = createUnit(type, f, Math.min(18, ux + (f === 'ai2' ? -2 : 0)), Math.min(18, uz), { factionDef: FACTION_DEFS[factionIds[f]] });
                state.units.set(u.id, u);
            });
            // King + a lord per faction near the front.
            const king = createLord(f, cx, cz, `King ${f}`, 'CONQUEROR');
            king.isKing = true; king.maxHp = 60; king.hp = 60; king.x = 9; king.z = 9;
            const lord = createLord(f, cx, cz, `Lord ${f}`);
            lord.x = 10; lord.z = 10;
            state.lords.push(king, lord);
        }
        state.diplomacy = warAll(factions);

        const g = makeAIGame(state);
        for (let round = 0; round < 40; round++) {
            for (const f of factions) {
                g.runAITurn(f);
                const bad = scanNaN(state, `round ${round} after ${f}`);
                if (bad) {
                    console.log(bad);
                    console.log('--- recent logs ---');
                    console.log(g.logs.slice(-25).join('\n'));
                    throw new Error(bad);
                }
            }
            for (const u of state.units.values()) { u.hasMovedThisTurn = false; u.hasAttackedThisTurn = false; }
            for (const l of state.lords) { l.hasMovedThisTurn = false; l.hasAttackedThisTurn = false; }
            state.turn++;
        }
        expect(scanNaN(state, 'end')).toBeNull();
    });
});
