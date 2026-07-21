/** UI data builders for Features 13–15: compact, pure summaries the renderer/UI
 *  consumes. Kept out of the WebGL/DOM code so they can be unit-tested in node.
 *  - buildMinimapData: per-tile owner color + unit flag for the minimap canvas.
 *  - getCityJumpList: ordered player cities for the quick-jump cycle.
 *  - getArmyComposition: per-lord unit-type counts for the army panel.
 */
import { FACTION_COLORS, PLAYER_FACTION } from './config.js';

/** Minimap summary (Feature 13). Returns { width, height, cells } where cells
 *  is a Map<tileKey, { owner, color, hasUnit }> covering every tile. The
 *  renderer draws 1px per tile; owner colors come from FACTION_COLORS. */
export function buildMinimapData(tiles, units, factions, factionColors) {
    const colors = factionColors || FACTION_COLORS;
    const cells = new Map();
    let width = 0, height = 0;
    if (tiles) {
        for (const t of tiles.values ? tiles.values() : Object.values(tiles)) {
            const k = `${t.x},${t.z}`;
            width = Math.max(width, t.x + 1);
            height = Math.max(height, t.z + 1);
            const fc = colors && colors[t.owner];
            cells.set(k, {
                owner: t.owner,
                color: fc ? (fc.tile != null ? fc.tile : fc.color) : null,
                terrain: t.terrain,
                hasUnit: false
            });
        }
    }
    if (units) {
        for (const u of units.values ? units.values() : Object.values(units)) {
            const k = `${u.x},${u.z}`;
            const c = cells.get(k);
            if (c) c.hasUnit = true;
            else {
                const fc = colors && colors[u.owner];
                cells.set(k, { owner: u.owner, color: fc ? (fc.tile != null ? fc.tile : fc.color) : null, terrain: null, hasUnit: true });
            }
        }
    }
    return { width, height, cells };
}

/** City quick-jump list (Feature 14): the player's cities in a stable order
 *  (by founded/turn order if available, else by coordinate) with names +
 *  coordinates for the camera-jump cycle. Returns [] if the player owns none. */
export function getCityJumpList(tiles, owner = PLAYER_FACTION, factionColors) {
    const out = [];
    if (!tiles) return out;
    const colors = factionColors || FACTION_COLORS;
    for (const t of tiles.values ? tiles.values() : Object.values(tiles)) {
        if (t.owner !== owner || t.terrain !== 'CITY') continue;
        const name = t.cityName || `City ${t.x},${t.z}`;
        out.push({
            key: `${t.x},${t.z}`,
            x: t.x,
            z: t.z,
            name,
            cityLevel: t.cityLevel || 1,
            color: (colors && colors[owner] && (colors[owner].tile != null ? colors[owner].tile : colors[owner].color)) || null
        });
    }
    out.sort((a, b) => (a.cityLevel !== b.cityLevel ? b.cityLevel - a.cityLevel : a.key.localeCompare(b.key)));
    return out;
}

/** Army composition (Feature 15): for each lord of `owner`, the count of each
 *  unit type in its army and a total. Lords with no army are still listed with
 *  an empty composition. Returns an array of { lordId, name, class, total,
 *  types: { INFANTRY: n, ... } }. Pure (reads lords + units maps). */
export function getArmyComposition(lords, units, owner = PLAYER_FACTION) {
    const out = [];
    if (!lords) return out;
    const unitList = units ? (units.values ? Array.from(units.values()) : Object.values(units)) : [];
    for (const l of lords) {
        if (owner && l.owner !== owner) continue;
        const armyIds = l.army || [];
        const types = {};
        let total = 0;
        for (const id of armyIds) {
            const u = unitList.find(x => x.id === id);
            if (!u) continue;
            types[u.type] = (types[u.type] || 0) + 1;
            total++;
        }
        out.push({
            lordId: l.id,
            name: l.name,
            class: l.class,
            governingCity: l.governingCity || null,
            isKing: !!l.isKing,
            total,
            types
        });
    }
    return out;
}