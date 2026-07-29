/** Save/load game state.
 *
 *  Saves persist to the FILESYSTEM (via a small server-side API exposed by
 *  server.py at /api/save) rather than the browser's localStorage. This makes
 *  saves survive browser data clearing and lets players back up the save file
 *  directly. If the server API is unreachable (e.g. the game is opened from
 *  file:// or a static host without the Python server), we fall back to
 *  localStorage so the game is still playable.
 *
 *  GameState uses Map/Set; JSON needs plain objects. */
import { serializeAIState, deserializeAIState } from './ai_goals.js';
import { serializeTechState, deserializeTechState } from './tech.js';

const SAVE_KEY = 'conquest_save';
// Bumped 6 -> 7 for the atomic-era tech tree + faction-unique unit fix +
// new units. Older saves are rejected (their tech/unit state predates the
// expanded tree and the faction-unique gate).
const SAVE_VERSION = 7;

const API_BASE = '/api/save';

/** True if the filesystem save API is available (i.e. the Python server is
 *  serving the game). Probed once on first use; cached so we don't re-probe
 *  every save. localStorage is the fallback when this is false. */
let _fsMode = null;
async function detectFsMode() {
    if (_fsMode !== null) return _fsMode;
    try {
        const r = await fetch(API_BASE, { method: 'GET' });
        _fsMode = r.ok ? true : false;
    } catch (e) {
        _fsMode = false;
    }
    return _fsMode;
}

// Allow tests to force the storage mode (so they don't hit the network).
export function _setStorageMode(mode) { _fsMode = mode; }

function serializeState(gameState) {
    return {
        version: SAVE_VERSION,
        turn: gameState.turn,
        factionAssignments: { ...gameState.factionAssignments },
        tiles: [...gameState.tiles.values()],
        units: [...gameState.units.values()],
        buildings: [...(gameState.buildings || new Map()).entries()],
        buildingState: [...(gameState.buildingState || new Map()).entries()],
        lords: gameState.lords,
        resources: gameState.resources,
        diplomacy: gameState.diplomacy,
        explored: [...(gameState.explored || [])],
        scryRevealed: [...(gameState.scryRevealed || [])],
        trainedThisTurn: [...(gameState.trainedThisTurn || [])],
        production: [...(gameState.production || []).entries()],
        construction: [...(gameState.construction || []).entries()],
        structures: [...(gameState.structures || []).entries()],
        bridges: [...(gameState.bridges || [])],
        concealedUnits: [...(gameState.concealedUnits || []).entries()],
        kingCooldowns: { ...(gameState.kingCooldowns || {}) },
        tempBonuses: { ...(gameState.tempBonuses || {}) },
        graveyard: gameState.graveyard || [],
        eliminated: [...(gameState.eliminated || [])],
        reputation: { ...(gameState.reputation || {}) },
        gameOver: gameState.gameOver,
        winner: gameState.winner,
        techState: gameState.techState ? {
            researched: gameState.techState.researched ? [...gameState.techState.researched] : [],
            current: gameState.techState.current || null,
            progress: gameState.techState.progress || 0
        } : null,
        victoryState: gameState.victoryState ? {
            projects: { ...(gameState.victoryState.projects || {}) },
            tradeRoutes: { ...(gameState.victoryState.tradeRoutes || {}) },
            scoreSnapshots: { ...(gameState.victoryState.scoreSnapshots || {}) }
        } : null,
        aiState: serializeAIState(gameState.aiState),
        aiTechStates: gameState.aiTechStates ? Object.fromEntries(
            Object.entries(gameState.aiTechStates).map(([f, ts]) => [f, serializeTechState(ts)])
        ) : null,
        tradeRoutes: gameState.tradeRoutes || [],
        tradeRouteNextId: gameState.tradeRouteNextId || 1
    };
}

export async function saveGame(gameState) {
    const data = serializeState(gameState);
    const json = JSON.stringify(data);
    try {
        if (await detectFsMode()) {
            const r = await fetch(API_BASE, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: json
            });
            if (r.ok) return true;
            // Server returned an error — fall back to localStorage.
        }
        // Fallback (no server or server error): localStorage.
        localStorage.setItem(SAVE_KEY, json);
        return true;
    } catch (e) {
        // Last-resort fallback: localStorage even if we intended FS mode.
        try { localStorage.setItem(SAVE_KEY, json); return true; }
        catch (e2) { console.warn('save failed', e, e2); return false; }
    }
}

export async function loadSavedExists() {
    try {
        if (await detectFsMode()) {
            const r = await fetch(API_BASE, { method: 'GET' });
            if (r.ok) {
                const obj = await r.json();
                return !!obj.exists;
            }
        }
        return !!localStorage.getItem(SAVE_KEY);
    } catch (e) {
        try { return !!localStorage.getItem(SAVE_KEY); } catch (e2) { return false; }
    }
}

function parseSaveData(data) {
    if (!data || data.version !== SAVE_VERSION) {
        console.warn(`Save version mismatch (have ${data && data.version}, need ${SAVE_VERSION}) — ignoring old save.`);
        return null;
    }
    const tiles = new Map();
    for (const t of data.tiles) tiles.set(`${t.x},${t.z}`, t);
    const units = new Map();
    for (const u of data.units) units.set(u.id, u);
    const buildings = new Map(data.buildings);
    const buildingState = new Map(data.buildingState || []);
    const diplomacy = data.diplomacy || { relations: {}, pendingOffers: [] };
    if (!diplomacy.diplomaticEvents) diplomacy.diplomaticEvents = [];
    for (const rel of Object.values(diplomacy.relations)) {
        if (rel.turnsAllied === undefined) rel.turnsAllied = 0;
        if (rel.turnsAtWar === undefined) rel.turnsAtWar = 0;
        if (rel.relationship === undefined) rel.relationship = 0;
        if (rel.warsDeclared === undefined) rel.warsDeclared = 0;
        if (rel.peaceTreaties === undefined) rel.peaceTreaties = 0;
        if (rel.tradesMade === undefined) rel.tradesMade = 0;
        if (rel.grievances === undefined) rel.grievances = 0;
        if (rel.grievanceLog === undefined) rel.grievanceLog = [];
        if (rel.expiresOn === undefined) rel.expiresOn = null;
        if (rel.formalWar === undefined) rel.formalWar = rel.state === 'war';
        if (rel.lastWarDeclaredTurn === undefined) rel.lastWarDeclaredTurn = 0;
        if (rel.grudges === undefined) rel.grudges = {};
        if (rel.trust === undefined) rel.trust = Math.max(0, 1 - (rel.brokenTreaties || 0) * 0.25);
    }
    return {
        turn: data.turn,
        factionAssignments: data.factionAssignments,
        tiles,
        units,
        buildings,
        buildingState,
        lords: data.lords,
        resources: data.resources,
        diplomacy,
        explored: new Set(data.explored || []),
        visible: new Set(),
        scryRevealed: new Set(data.scryRevealed || []),
        trainedThisTurn: new Set(data.trainedThisTurn || []),
        production: new Map(data.production || []),
        construction: new Map(data.construction || []),
        structures: new Map(data.structures || []),
        bridges: new Set(data.bridges || []),
        concealedUnits: new Map(data.concealedUnits || []),
        kingCooldowns: data.kingCooldowns || {},
        tempBonuses: data.tempBonuses || {},
        graveyard: data.graveyard || [],
        eliminated: new Set(data.eliminated || []),
        reputation: data.reputation || null,
        gameOver: data.gameOver || false,
        winner: data.winner || null,
        techState: data.techState ? {
            researched: new Set(data.techState.researched || []),
            current: data.techState.current || null,
            progress: data.techState.progress || 0
        } : null,
        victoryState: data.victoryState || { projects: {}, tradeRoutes: {}, scoreSnapshots: {} },
        aiState: deserializeAIState(data.aiState),
        aiTechStates: data.aiTechStates ? Object.fromEntries(
            Object.entries(data.aiTechStates).map(([f, ts]) => [f, deserializeTechState(ts)])
        ) : null,
        tradeRoutes: Array.isArray(data.tradeRoutes) ? data.tradeRoutes : [],
        tradeRouteNextId: data.tradeRouteNextId || 1
    };
}

export async function loadGame() {
    let raw = null;
    try {
        if (await detectFsMode()) {
            const r = await fetch(API_BASE, { method: 'GET' });
            if (r.ok) {
                const obj = await r.json();
                if (obj.exists && obj.data) raw = obj.data;
            }
        }
        if (raw === null) {
            raw = localStorage.getItem(SAVE_KEY);
        }
        if (!raw) return null;
        const data = JSON.parse(raw);
        const state = parseSaveData(data);
        if (!state) return null;
        const issues = verifySave(state);
        if (issues && issues.length) {
            console.warn('Save verification issues:', issues);
            if (issues.some(i => i.startsWith('No '))) return null;
        }
        return state;
    } catch (e) {
        console.warn('load failed', e);
        return null;
    }
}

export async function clearSave() {
    try {
        if (await detectFsMode()) {
            await fetch(API_BASE, { method: 'DELETE' });
        }
    } catch (e) { /* ignore — fall through to localStorage */ }
    try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* ignore */ }
}

/** Verify a loaded save has all required fields. Returns an array of issues. */
export function verifySave(state) {
    const issues = [];
    if (!state) return ['No state to verify'];
    if (!state.tiles || state.tiles.size === 0) issues.push('No tiles');
    if (!state.units) issues.push('No units map');
    if (!state.buildings) issues.push('No buildings map');
    if (!state.lords || !Array.isArray(state.lords)) issues.push('No lords array');
    if (!state.resources) issues.push('No resources');
    if (!state.diplomacy || !state.diplomacy.relations) issues.push('No diplomacy');
    for (const [key, t] of state.tiles) {
        if (t.terrain === 'CITY') {
            if (t.cityLevel === undefined) issues.push(`City ${key} missing cityLevel`);
            if (t.fortification === undefined) issues.push(`City ${key} missing fortification`);
        }
        if (t.wonder && typeof t.wonder !== 'object') issues.push(`Tile ${key} has invalid wonder`);
    }
    for (const [id, u] of state.units) {
        if (u.burn !== undefined && typeof u.burn !== 'number') {
            issues.push(`Unit ${id} has invalid burn value`);
        }
    }
    for (const [key, list] of state.buildings) {
        if (!Array.isArray(list)) issues.push(`Buildings at ${key} is not an array`);
    }
    return issues;
}