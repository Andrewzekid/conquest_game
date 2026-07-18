/** Save/load to localStorage. GameState uses Map/Set; JSON needs plain objects.
 *  Phase F: enhanced persistence with verification for growth, burn, workshop,
 *  wonders, diplomacy relationship scores, and all new state fields. */
const SAVE_KEY = 'conquest_save';
const SAVE_VERSION = 2;

export function saveGame(gameState) {
    try {
        const data = {
            version: SAVE_VERSION,
            turn: gameState.turn,
            // Faction slot -> faction def id (rebuilt from FACTION_DEFS on load).
            factionAssignments: { ...gameState.factionAssignments },
            tiles: [...gameState.tiles.values()],
            units: [...gameState.units.values()],
            buildings: [...gameState.buildings.entries()],
            lords: gameState.lords,
            resources: gameState.resources,
            diplomacy: gameState.diplomacy,
            explored: [...(gameState.explored || [])],
            scryRevealed: [...(gameState.scryRevealed || [])],
            trainedThisTurn: [...(gameState.trainedThisTurn || [])],
            production: [...(gameState.production || []).entries()],
            construction: [...(gameState.construction || []).entries()],
            bridges: [...(gameState.bridges || [])],
            concealedUnits: [...(gameState.concealedUnits || []).entries()],
            kingCooldowns: { ...(gameState.kingCooldowns || {}) },
            tempBonuses: { ...(gameState.tempBonuses || {}) },
            graveyard: gameState.graveyard || [],
            eliminated: [...(gameState.eliminated || [])],
            reputation: { ...(gameState.reputation || {}) },
            gameOver: gameState.gameOver,
            winner: gameState.winner
        };
        localStorage.setItem(SAVE_KEY, JSON.stringify(data));
        return true;
    } catch (e) {
        console.warn('save failed', e);
        return false;
    }
}

export function loadSavedExists() {
    try { return !!localStorage.getItem(SAVE_KEY); } catch (e) { return false; }
}

export function loadGame() {
    try {
        const raw = localStorage.getItem(SAVE_KEY);
        if (!raw) return null;
        const data = JSON.parse(raw);
        // Refuse incompatible save formats rather than loading a half-corrupt
        // state. Bumping SAVE_VERSION (e.g. for a breaking state-shape change)
        // automatically invalidates older saves.
        if (!data || data.version !== SAVE_VERSION) {
            console.warn(`Save version mismatch (have ${data && data.version}, need ${SAVE_VERSION}) — ignoring old save.`);
            return null;
        }
        const tiles = new Map();
        for (const t of data.tiles) {
            // Verify tile fields: cityLevel, growth, wonder, fortification, bridge
            // These are stored on the tile object itself and persist through JSON.
            tiles.set(`${t.x},${t.z}`, t);
        }
        const units = new Map();
        for (const u of data.units) {
            // Verify unit fields: burn (fire ailment), level, xp, goal, boarded
            // These are stored on the unit object itself and persist through JSON.
            units.set(u.id, u);
        }
        const buildings = new Map(data.buildings);
        // Verify buildings include SIEGE_WORKSHOP entries (stored as string arrays).

        // Restore diplomacy with new Phase E fields (backward compatible).
        const diplomacy = data.diplomacy || { relations: {}, pendingOffers: [] };
        if (!diplomacy.diplomaticEvents) diplomacy.diplomaticEvents = [];
        // Ensure all relations have the new fields (backward compat for v1 saves).
        for (const rel of Object.values(diplomacy.relations)) {
            if (rel.turnsAllied === undefined) rel.turnsAllied = 0;
            if (rel.turnsAtWar === undefined) rel.turnsAtWar = 0;
            if (rel.relationship === undefined) rel.relationship = 0;
            if (rel.warsDeclared === undefined) rel.warsDeclared = 0;
            if (rel.peaceTreaties === undefined) rel.peaceTreaties = 0;
            if (rel.tradesMade === undefined) rel.tradesMade = 0;
        }

        const state = {
            turn: data.turn,
            factionAssignments: data.factionAssignments,
            tiles,
            units,
            buildings,
            lords: data.lords,
            resources: data.resources,
            diplomacy,
            explored: new Set(data.explored),
            visible: new Set(),            // recomputed on load
            scryRevealed: new Set(data.scryRevealed || []),
            trainedThisTurn: new Set(data.trainedThisTurn),
            production: new Map(data.production || []),
            construction: new Map(data.construction || []),
            bridges: new Set(data.bridges || []),
            concealedUnits: new Map(data.concealedUnits || []),
            kingCooldowns: data.kingCooldowns || {},
            tempBonuses: data.tempBonuses || {},
            graveyard: data.graveyard || [],
            eliminated: new Set(data.eliminated || []),
            reputation: data.reputation || null,
            gameOver: data.gameOver || false,
            winner: data.winner || null
        };

        // Sanity-check the restored state. If critical fields are missing,
        // refuse to load rather than booting into a broken game.
        const issues = verifySave(state);
        if (issues && issues.length) {
            console.warn('Save verification issues:', issues);
            // "No tiles" / "No units map" / "No buildings map" / "No lords array" /
            // "No resources" / "No diplomacy" are critical — abort.
            if (issues.some(i => i.startsWith('No '))) return null;
        }
        return state;
    } catch (e) {
        console.warn('load failed', e);
        return null;
    }
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

    // Check tiles for city growth fields
    for (const [key, t] of state.tiles) {
        if (t.terrain === 'CITY') {
            if (t.cityLevel === undefined) issues.push(`City ${key} missing cityLevel`);
            if (t.fortification === undefined) issues.push(`City ${key} missing fortification`);
        }
        // Wonders are optional but if present should be an object
        if (t.wonder && typeof t.wonder !== 'object') issues.push(`Tile ${key} has invalid wonder`);
    }

    // Check units for burn field
    for (const [id, u] of state.units) {
        if (u.burn !== undefined && typeof u.burn !== 'number') {
            issues.push(`Unit ${id} has invalid burn value`);
        }
    }

    // Check buildings for SIEGE_WORKSHOP
    for (const [key, list] of state.buildings) {
        if (!Array.isArray(list)) issues.push(`Buildings at ${key} is not an array`);
    }

    return issues;
}

export function clearSave() {
    try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* ignore */ }
}