/** Save/load to localStorage. GameState uses Map/Set; JSON needs plain objects. */
const SAVE_KEY = 'conquest_save';

export function saveGame(gameState) {
    try {
        const data = {
            version: 1,
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
            kingCooldowns: { ...(gameState.kingCooldowns || {}) },
            tempBonuses: { ...(gameState.tempBonuses || {}) },
            graveyard: gameState.graveyard || [],
            eliminated: [...(gameState.eliminated || [])],
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
        const tiles = new Map();
        for (const t of data.tiles) tiles.set(`${t.x},${t.z}`, t);
        const units = new Map();
        for (const u of data.units) units.set(u.id, u);
        const buildings = new Map(data.buildings);
        return {
            turn: data.turn,
            factionAssignments: data.factionAssignments,
            tiles,
            units,
            buildings,
            lords: data.lords,
            resources: data.resources,
            diplomacy: data.diplomacy,
            explored: new Set(data.explored),
            visible: new Set(),            // recomputed on load
            scryRevealed: new Set(data.scryRevealed || []),
            trainedThisTurn: new Set(data.trainedThisTurn),
            production: new Map(data.production || []),
            construction: new Map(data.construction || []),
            bridges: new Set(data.bridges || []),
            kingCooldowns: data.kingCooldowns || {},
            tempBonuses: data.tempBonuses || {},
            graveyard: data.graveyard || [],
            eliminated: new Set(data.eliminated || []),
            gameOver: data.gameOver || false,
            winner: data.winner || null
        };
    } catch (e) {
        console.warn('load failed', e);
        return null;
    }
}

export function clearSave() {
    try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* ignore */ }
}