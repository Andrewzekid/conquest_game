/** Map generation: terrain, ownership, starting positions.
 *  Phase F: Updated to support non-square maps (GRID_WIDTH x GRID_HEIGHT)
 *  and per-faction city names. */
import { GRID_WIDTH, GRID_HEIGHT, GRID_SIZE, TERRAIN, FACTIONS, UNIT_TYPE, NATURAL_WONDERS, CITY_NAMES, FACTION_CITY_NAMES } from './config.js';
import { getFactionDef } from './faction.js';

// Per-faction city name counters
const _factionCityNameIndex = {};
function nextCityNameForFaction(factionId) {
    // Try faction-specific names first
    if (factionId && FACTION_CITY_NAMES[factionId]) {
        if (!_factionCityNameIndex[factionId]) _factionCityNameIndex[factionId] = 0;
        const names = FACTION_CITY_NAMES[factionId];
        const name = names[_factionCityNameIndex[factionId] % names.length];
        _factionCityNameIndex[factionId]++;
        return name;
    }
    // Fallback to generic names
    if (!_factionCityNameIndex['_generic']) _factionCityNameIndex['_generic'] = 0;
    const name = CITY_NAMES[_factionCityNameIndex['_generic'] % CITY_NAMES.length];
    _factionCityNameIndex['_generic']++;
    return name;
}

/** Influence/vision radius of a city, based on its level (1-based).
 *  Stepped (not linear) so influence grows in tiers:
 *    Lv 1-2 → 1,  Lv 3-4 → 2,  Lv 5-9 → 3,  Lv 10+ → 4. */
export function cityRadius(tile) {
    const level = (tile && tile.cityLevel) || 1;
    if (level >= 10) return 4;
    if (level >= 5) return 3;
    if (level >= 3) return 2;
    return 1;
}

/** A city's fortification max scales with its level. Besiege to reduce it to 0
 *  before the city can be captured. */
export function cityFortMax(tile) {
    return 2 + ((tile && tile.cityLevel) || 1);
}

/** Carve an irregular, non-square continent out of the grid: tiles far from
 *  the map center (plus layered wavy noise so the coast isn't a circle or a
 *  square) are turned into WATER, giving an organic island/continent silhouette.
 *  The interior is kept, so there's still plenty of land for cities and
 *  expansion. Two noise octaves — a slow one for large bays/peninsulas and a
 *  fast one for fine coastline wiggle — break up any boxy symmetry.
 *  Accepts an optional cutoffOverride so the caller can retry with a more
 *  generous land threshold if the first pass produced too little land. */
function applyContinentMask(tiles, cutoffOverride = null) {
    const cx = (GRID_WIDTH - 1) / 2;
    const cz = (GRID_HEIGHT - 1) / 2;
    const maxR = Math.min(GRID_WIDTH, GRID_HEIGHT) / 2;
    // Random per-generation phases + frequencies so every map's coastline differs.
    const phx = Math.random() * Math.PI * 2;
    const phz = Math.random() * Math.PI * 2;
    const phx2 = Math.random() * Math.PI * 2;
    const phz2 = Math.random() * Math.PI * 2;
    const freqSlow = 0.18 + Math.random() * 0.08;  // large bays/lobes
    const freqFast = 0.55 + Math.random() * 0.25;  // fine coastline wiggle
    // Land cutoff: keep ~75% of the radius as solid interior, so the shape is
    // clearly rounder than the grid without starving room for cities.
    const CUTOFF = cutoffOverride != null ? cutoffOverride : 0.22;
    for (const t of tiles) {
        // 0 at the center, ~1 at edge midpoints, ~1.41 at the corners.
        const d = Math.hypot(t.x - cx, t.z - cz) / maxR;
        // Slow octave (range ~[-0.22, 0.22]) shapes big bays/peninsulas; fast
        // octave (range ~[-0.10, 0.10]) adds fine wiggle to the coast.
        const slow = 0.22 * (Math.sin(t.x * freqSlow + phx) + Math.cos(t.z * freqSlow + phz)) / 2;
        const fast = 0.10 * (Math.sin(t.z * freqFast + phx2) + Math.cos(t.x * freqFast + phz2)) / 2;
        const landScore = (1.0 - d) + slow + fast;
        if (landScore < CUTOFF) {
            t.terrain = 'WATER';
        }
    }
}

/** A tile is passable to ground units unless it's water, or an unbridged river. */
export function isPassable(tile) {
    if (!tile) return false;
    if (tile.terrain === 'WATER') return false;
    if (tile.terrain === 'RIVER') return !!tile.bridge;
    return true;
}

/** Assign terrain in contiguous biome regions instead of per-tile noise, so the
 *  map reads as "groups of different terrain" rather than confetti. Land tiles
 *  (the continent mask already cut WATER) are assigned to the nearest biome
 *  seed within a reach radius; tiles beyond reach stay PLAINS. A little jitter
 *  roughens the Voronoi borders, and a few MOUNTAIN clusters are scattered as
 *  impassable barriers. */
function assignBiomes(tiles) {
    const byKey = new Map(tiles.map(t => [`${t.x},${t.z}`, t]));
    const land = tiles.filter(t => t.terrain !== 'WATER');

    // Biome seeds (FOREST / HILLS / DESERT / MARSH / TUNDRA). Seed count scales
    // with map size; cycling types keeps a roughly even mix.
    const biomeTypes = ['FOREST', 'HILLS', 'DESERT', 'MARSH', 'TUNDRA'];
    const seedCount = Math.max(6, Math.floor(Math.max(GRID_WIDTH, GRID_HEIGHT) / 3));
    const seeds = [];
    for (let i = 0; i < seedCount; i++) {
        const base = land[Math.floor(Math.random() * land.length)];
        seeds.push({ x: base.x, z: base.z, type: biomeTypes[i % biomeTypes.length] });
    }

    const reach = Math.floor(Math.max(GRID_WIDTH, GRID_HEIGHT) / 2.2) + 2; // plains gaps between regions
    for (const t of land) {
        let best = null, bestD = Infinity;
        for (const s of seeds) {
            // Slight per-tile jitter so biome borders aren't straight lines.
            const d = Math.abs(t.x - s.x) + Math.abs(t.z - s.z) + (Math.random() - 0.5) * 3;
            if (d < bestD) { bestD = d; best = s; }
        }
        if (best && bestD <= reach) t.terrain = best.type;
        else t.terrain = 'PLAINS';
    }

    // A handful of small MOUNTAIN clusters (impassable barriers + mine sites).
    const mapScale = Math.max(GRID_WIDTH, GRID_HEIGHT);
    const clusterCount = mapScale >= 48 ? 6 : mapScale >= 36 ? 4 : 3;
    for (let i = 0; i < clusterCount; i++) {
        const base = land[Math.floor(Math.random() * land.length)];
        const size = 1 + Math.floor(Math.random() * 3); // 1..3 tiles
        const grown = new Set([`${base.x},${base.z}`]);
        const queue = [base];
        while (queue.length && grown.size < size + 1) {
            const cur = queue.shift();
            for (const [dx, dz] of [[0,1],[0,-1],[1,0],[-1,0]]) {
                const k = `${cur.x + dx},${cur.z + dz}`;
                const n = byKey.get(k);
                if (!n || n.terrain === 'WATER' || n.terrain === 'MOUNTAIN') continue;
                if (grown.has(k)) continue;
                if (Math.random() < 0.6) { n.terrain = 'MOUNTAIN'; grown.add(k); queue.push(n); }
            }
        }
    }
}

/** Carve large, meandering rivers across the map as random walks. Rivers are
 *  impassable until bridged; cities are never placed on river tiles. Each river
 *  is long and sinuous, ~2 tiles wide, with occasional widenings (small lakes)
 *  so waterways read as real, dominant features on the map. */
function generateRivers(tiles) {
    const byKey = new Map(tiles.map(t => [`${t.x},${t.z}`, t]));
    const at = (x, z) => byKey.get(`${x},${z}`);
    const mapScale = Math.max(GRID_WIDTH, GRID_HEIGHT);
    const riverCount = mapScale >= 48 ? 4 : mapScale >= 36 ? 3 : 2;
    const carved = new Set(); // tiles already turned to river (avoid re-carve flicker)

    const carve = (t) => {
        if (!t) return;
        if (t.terrain !== 'CITY' && t.terrain !== 'MOUNTAIN' && t.terrain !== 'WATER') {
            t.terrain = 'RIVER';
            t.bridge = false;
            carved.add(`${t.x},${t.z}`);
        }
    };
    // Widen a 3x3 patch into a small river "lake".
    const widen = (cx, cz) => {
        for (let dx = -1; dx <= 1; dx++) {
            for (let dz = -1; dz <= 1; dz++) {
                if (Math.random() < 0.2 && !(dx === 0 && dz === 0)) continue;
                carve(at(cx + dx, cz + dz));
            }
        }
    };

    for (let i = 0; i < riverCount; i++) {
        // Start on a random edge tile and walk inward.
        let x, z, dx, dz;
        const edge = Math.floor(Math.random() * 4);
        if (edge === 0)      { x = Math.floor(Math.random() * GRID_WIDTH); z = 0; dx = 0; dz = 1; }
        else if (edge === 1) { x = Math.floor(Math.random() * GRID_WIDTH); z = GRID_HEIGHT - 1; dx = 0; dz = -1; }
        else if (edge === 2) { x = 0; z = Math.floor(Math.random() * GRID_HEIGHT); dx = 1; dz = 0; }
        else                 { x = GRID_WIDTH - 1; z = Math.floor(Math.random() * GRID_HEIGHT); dx = -1; dz = 0; }

        const length = Math.floor(Math.max(GRID_WIDTH, GRID_HEIGHT) * (0.95 + Math.random() * 0.4)); // long, dominant rivers
        let sinceWiden = 0;
        for (let s = 0; s < length; s++) {
            const t = at(x, z);
            if (!t) break;
            carve(t);
            // Widen the river: carve the two perpendicular neighbors (2-tile channel).
            const px1 = at(x + dz, z - dx);
            const px2 = at(x - dz, z + dx);
            if (px1 && !carved.has(`${px1.x},${px1.z}`)) carve(px1);
            if (px2 && !carved.has(`${px2.x},${px2.z}`)) carve(px2);
            // Occasionally swell into a small lake (3x3 widening).
            sinceWiden++;
            if (sinceWiden > 8 && Math.random() < 0.12) { widen(x, z); sinceWiden = 0; }
            // Meander: turn fairly often so the river is sinuous, not ruler-straight.
            const turn = Math.random();
            if (turn < 0.28) { // rotate dir 90° left
                const ndx = -dz, ndz = dx; dx = ndx; dz = ndz;
            } else if (turn < 0.56) { // rotate 90° right
                const ndx = dz, ndz = -dx; dx = ndx; dz = ndz;
            }
            x += dx; z += dz;
            if (x < 0 || x >= GRID_WIDTH || z < 0 || z >= GRID_HEIGHT) break;
        }
    }
}

/** Scatter a few Natural Wonders on suitable land tiles (not city/water/
 *  mountain/river). Each placed wonder gets { name, emoji, color, bonus } so the
 *  renderer and economy can present + apply it. Returns the list of placed
 *  wonders (for logging). */
function placeWonders(tiles) {
    const byKey = new Map(tiles.map(t => [`${t.x},${t.z}`, t]));
    const eligible = tiles.filter(t =>
        t.terrain !== 'CITY' && t.terrain !== 'WATER' && t.terrain !== 'MOUNTAIN' && t.terrain !== 'RIVER' && !t.wonder);
    if (!eligible.length) return [];
    const mapScale = Math.max(GRID_WIDTH, GRID_HEIGHT);
    const count = mapScale >= 48 ? 5 : mapScale >= 36 ? 4 : 3;
    // Shuffle a copy of the wonder defs so each map gets a varied subset.
    const pool = [...NATURAL_WONDERS].sort(() => Math.random() - 0.5);
    const placed = [];
    for (let i = 0; i < count && i < pool.length; i++) {
        // Pick a wonder site far from already-placed wonders so they spread out.
        let best = null, bestDist = -1;
        for (const t of eligible) {
            if (t.wonder) continue;
            let nearest = Infinity;
            for (const w of placed) {
                const d = Math.abs(t.x - w.x) + Math.abs(t.z - w.z);
                if (d < nearest) nearest = d;
            }
            // Bias toward distance from other wonders; nearest==Infinity (first) is fine.
            const score = (nearest === Infinity ? Math.max(GRID_WIDTH, GRID_HEIGHT) : nearest) + Math.random() * 4;
            if (score > bestDist) { bestDist = score; best = t; }
        }
        if (!best) break;
        const def = pool[i];
        best.wonder = { id: def.id, name: def.name, emoji: def.emoji, color: def.color, bonus: { ...def.bonus } };
        placed.push(best);
    }
    return placed;
}

/**
 * Generate tile data for the full grid. Cities are placed explicitly: one start
 * city per faction plus a few neutral contested cities (fewer cities overall).
 * Each tile: { x, z, terrain, owner, loyalty, cityLevel, fortification, fortMax }
 * Returns { tiles, startKeys }
 */
export function generateMap() {
    const tiles = [];
    for (let x = 0; x < GRID_WIDTH; x++) {
        for (let z = 0; z < GRID_HEIGHT; z++) {
            tiles.push({
                x, z,
                terrain: 'PLAINS', // base fill; biomes/mountains/rivers overwrite
                owner: null,
                loyalty: 0,
                cityLevel: 0,
                fortification: 0,
                fortMax: 0,
                wonder: null       // set by placeWonders for Natural Wonder tiles
            });
        }
    }

    // Shape the landmass into an irregular continent (cuts off the square
    // corners and carves a wavy coastline) BEFORE biomes/rivers/cities.
    // Retry with a more generous cutoff if the first pass produced too little
    // land (prevents cities from spawning in the ocean on unlucky seeds).
    applyContinentMask(tiles);
    let landCount = tiles.filter(t => t.terrain !== 'WATER').length;
    let maskAttempts = 0;
    while (landCount < tiles.length * 0.30 && maskAttempts < 5) {
        // Reset all tiles to PLAINS before re-applying the mask.
        for (const t of tiles) {
            if (t.terrain === 'WATER') t.terrain = 'PLAINS';
        }
        applyContinentMask(tiles, 0.30 + maskAttempts * 0.08);
        landCount = tiles.filter(t => t.terrain !== 'WATER').length;
        maskAttempts++;
    }

    // Group land into contiguous biome regions (FOREST/HILLS/DESERT/MARSH/TUNDRA)
    // with plains gaps, plus a few impassable MOUNTAIN clusters.
    assignBiomes(tiles);

    // Carve large meandering rivers across the map (before city placement so
    // cities avoid rivers).
    generateRivers(tiles);

    // Total city count: one per faction + a few neutral (scales with map size).
    const mapScale = Math.max(GRID_WIDTH, GRID_HEIGHT);
    const neutral = mapScale >= 48 ? 4 : mapScale >= 36 ? 3 : 2;
    const totalCities = FACTIONS.length + neutral;

    // Pick city sites spread across the map via farthest-point sampling, avoiding
    // water, mountains, and rivers (cities shouldn't sit on those tiles).
    const candidates = tiles.filter(t => t.terrain !== 'WATER' && t.terrain !== 'MOUNTAIN' && t.terrain !== 'RIVER');
    const cityTiles = [];
    let seed = candidates[Math.floor(Math.random() * candidates.length)];
    if (!seed) seed = tiles[0];
    cityTiles.push(seed);

    while (cityTiles.length < totalCities) {
        let best = null, bestDist = -1;
        for (const c of candidates) {
            if (cityTiles.includes(c)) continue;
            let nearest = Infinity;
            for (const p of cityTiles) {
                const d = Math.abs(c.x - p.x) + Math.abs(c.z - p.z);
                if (d < nearest) nearest = d;
            }
            if (nearest > bestDist) { bestDist = nearest; best = c; }
        }
        if (!best) break;
        cityTiles.push(best);
    }

    for (const c of cityTiles) {
        c.terrain = 'CITY';
        c.cityLevel = 1;
        c.fortMax = cityFortMax(c);
        c.fortification = c.fortMax;
    }

    // Place Natural Wonders after cities so they don't sit under a starting
    // city (capturing/founding on a wonder tile still keeps the bonus).
    const wonders = placeWonders(tiles);

    // Assign start cities: player nearest the (0,0) corner, the rest via farthest
    // sampling so factions spread out.
    const startKeys = {};
    const placed = [];
    let playerCity = cityTiles[0];
    let bestCorner = Infinity;
    for (const c of cityTiles) {
        const d = c.x + c.z;
        if (d < bestCorner) { bestCorner = d; playerCity = c; }
    }
    playerCity.owner = 'player';
    placed.push(playerCity);
    startKeys['player'] = `${playerCity.x},${playerCity.z}`;
    const remaining = cityTiles.filter(c => c !== playerCity);

    for (const faction of FACTIONS) {
        if (faction === 'player') continue;
        let pick = null, bestScore = -1;
        for (const c of remaining) {
            let nearest = Infinity;
            for (const p of placed) {
                const d = Math.abs(c.x - p.x) + Math.abs(c.z - p.z);
                if (d < nearest) nearest = d;
            }
            if (nearest > bestScore) { bestScore = nearest; pick = c; }
        }
        if (pick) {
            pick.owner = faction;
            placed.push(pick);
            remaining.splice(remaining.indexOf(pick), 1);
            startKeys[faction] = `${pick.x},${pick.z}`;
        }
    }

    return { tiles, startKeys, wonders };
}

/** Build a lookup Map from tiles array */
export function buildTileMap(tiles) {
    const map = new Map();
    for (const t of tiles) map.set(`${t.x},${t.z}`, t);
    return map;
}

/** Get tile key */
export function key(x, z) {
    return `${x},${z}`;
}

/** Get a tile from the map by coordinates */
export function getTile(tiles, x, z) {
    return tiles.get(`${x},${z}`) || null;
}

/**
 * Get all tiles owned by a faction.
 */
export function getOwnedTiles(tiles, owner) {
    const result = [];
    for (const tile of tiles.values()) {
        if (tile.owner === owner) result.push(tile);
    }
    return result;
}

/**
 * Get all cities owned by a faction.
 */
export function getOwnedCities(tiles, owner) {
    const result = [];
    for (const tile of tiles.values()) {
        if (tile.owner === owner && tile.terrain === 'CITY') result.push(tile);
    }
    return result;
}

/**
 * Set of tile keys within each owned city's influence radius (Chebyshev, scales
 * with city level). Buildings may only be placed on these tiles.
 */
export function getInfluencedTiles(tiles, owner) {
    const cities = getOwnedCities(tiles, owner);
    const influenced = new Set();
    for (const c of cities) {
        const r = cityRadius(c);
        for (let dx = -r; dx <= r; dx++) {
            for (let dz = -r; dz <= r; dz++) {
                const k = `${c.x + dx},${c.z + dz}`;
                if (tiles.has(k)) influenced.add(k);
            }
        }
    }
    return influenced;
}

/**
 * Get adjacent tiles (4-directional).
 */
export function getAdjacentTiles(tiles, x, z) {
    const result = [];
    const dirs = [[0, 1], [0, -1], [1, 0], [-1, 0]];
    for (const [dx, dz] of dirs) {
        const t = tiles.get(`${x + dx},${z + dz}`);
        if (t) result.push(t);
    }
    return result;
}

/**
 * Capture a city and transfer all tiles within its influence radius to the
 * capturer. Unowned tiles and tiles of the city's previous owner are flipped;
 * tiles of other factions are left untouched. Returns messages array.
 * Only logs major news (city conquest) to global chat.
 * `structures` (optional Map<tileKey, {type, owner}>): engineer-built
 * structures on flipped tiles are destroyed — the enemy dismantles the old
 * owner's traps/fortifications when taking the tile.
 */
export function captureCityTerritory(tiles, cityTile, newOwner, structures = null) {
    const messages = [];
    const oldOwner = cityTile.owner;
    cityTile.owner = newOwner;
    cityTile.loyalty = 3;
    // A freshly captured city is fortified for its new owner.
    cityTile.fortMax = cityFortMax(cityTile);
    cityTile.fortification = cityTile.fortMax;
    // Assign a name if the city doesn't have one (use new owner's faction names)
    if (!cityTile.cityName) {
        const factionDef = getFactionDef(newOwner);
        const factionId = factionDef ? factionDef.id : null;
        cityTile.cityName = nextCityNameForFaction(factionId);
    }
    // Major news: only log city conquest (not every tile capture)
    const cityName = cityTile.cityName || `[${cityTile.x}, ${cityTile.z}]`;
    messages.push(`🏰 ${cityName} (Lv.${cityTile.cityLevel || 1}) captured by ${newOwner}!`);

    const r = cityRadius(cityTile);
    let claimed = 0;
    for (let dx = -r; dx <= r; dx++) {
        for (let dz = -r; dz <= r; dz++) {
            const t = tiles.get(`${cityTile.x + dx},${cityTile.z + dz}`);
            if (!t || t === cityTile) continue;
            if (!t.owner || t.owner === oldOwner) {
                t.owner = newOwner;
                t.loyalty = 3;
                claimed++;
            }
        }
    }
    // The conqueror dismantles any defensive structures left by the old owner.
    if (structures && structures.size) {
        for (const [skey, s] of [...structures]) {
            const st = tiles.get(skey);
            if (st && st.owner === newOwner && s.owner !== newOwner) {
                structures.delete(skey);
                messages.push(`The enemy ${s.type === 'FALL_TRAP' ? 'fall trap' : s.type === 'SPIKES' ? 'spikes' : 'fortification'} at [${st.x}, ${st.z}] was dismantled.`);
            }
        }
    }
    // Don't log individual tile claims - only the city capture is major news
    return messages;
}

/**
 * Expand a city's territory to cover its current influence radius. Used when a
 * city levels up (its radius grows) and on capture/founding. Claims only
 * UNOWNED tiles within the radius — tiles held by other factions are not taken
 * (that requires capturing their city). Returns the number of newly-claimed tiles.
 */
export function expandCityTerritory(tiles, cityTile, owner) {
    let claimed = 0;
    const r = cityRadius(cityTile);
    for (let dx = -r; dx <= r; dx++) {
        for (let dz = -r; dz <= r; dz++) {
            const t = tiles.get(`${cityTile.x + dx},${cityTile.z + dz}`);
            if (!t || t === cityTile) continue;
            if (!t.owner) {
                t.owner = owner;
                t.loyalty = 3;
                claimed++;
            }
        }
    }
    return claimed;
}

/**
 * Found a brand-new city on a valid land tile (settler action). The tile becomes
 * a level-1 city owned by the founder, fortified, and claims its surrounding
 * tiles. Returns messages; empty (with a reason in [0]) if the tile is invalid.
 * Each city gets a unique name from the city names pool.
 */
export function foundCity(tiles, tile, owner) {
    const messages = [];
    if (!tile) return ['Cannot found a city on an empty tile.'];
    if (tile.terrain === 'CITY') return ['A city already exists here.'];
    if (tile.terrain === 'WATER' || tile.terrain === 'MOUNTAIN' || tile.terrain === 'RIVER') {
        return [`Cannot found a city on ${tile.terrain.toLowerCase()} terrain.`];
    }
    tile.terrain = 'CITY';
    tile.cityLevel = 1;
    tile.fortMax = cityFortMax(tile);
    tile.fortification = tile.fortMax;
    // Assign a unique name from the founder's faction naming pool
    const factionDef = getFactionDef(owner);
    const factionId = factionDef ? factionDef.id : null;
    tile.cityName = nextCityNameForFaction(factionId);
    return captureCityTerritory(tiles, tile, owner);
}

/** Besiege a fortified enemy city with a SIEGE/ARTILLERY unit: reduces its
 *  fortification. Returns messages (may be empty if nothing to besiege).
 */
export function besiegeCity(unit, cityTile) {
    const msgs = [];
    if (!cityTile || cityTile.terrain !== 'CITY') return msgs;
    if (cityTile.fortification <= 0) return msgs;
    if (cityTile.owner === unit.owner) return msgs; // don't besiege own/ally city
    const power = (UNIT_TYPE[unit.type] && UNIT_TYPE[unit.type].besiegePower) || (unit.type === 'SIEGE' ? 2 : 1);
    cityTile.fortification = Math.max(0, cityTile.fortification - power);
    msgs.push(`City at [${cityTile.x}, ${cityTile.z}] besieged (fortification ${cityTile.fortification}/${cityTile.fortMax})`);
    if (cityTile.fortification === 0) msgs.push(`City at [${cityTile.x}, ${cityTile.z}] is BREACHED — it can now be captured!`);
    return msgs;
}

/** Regenerate fortification on every city whose fortification is below max and
 *  that is not currently pinned at 0 by an adjacent enemy siege unit. Called
 *  once per turn so a city you stop besieging recovers. */
export function regenFortification(tiles, units) {
    const siegeAdjacent = new Set(); // city keys pinned at 0 by an enemy besieger
    if (units) {
        for (const u of units.values()) {
            // Any unit with a besiege role (SIEGE, ARTILLERY, SIEGE_TOWER,
            // CATAPULT, TREBUCHET, …) holds a city at 0 while adjacent. Using
            // the besiege flag instead of a hardcoded list means new siege
            // units are covered automatically.
            const udef = UNIT_TYPE[u.type];
            if (!udef || !udef.besiege) continue;
            for (const [dx, dz] of [[0,1],[0,-1],[1,0],[-1,0]]) {
                const k = `${u.x+dx},${u.z+dz}`;
                siegeAdjacent.add(k);
            }
        }
    }
    for (const t of tiles.values()) {
        if (t.terrain !== 'CITY' || !t.fortMax) continue;
        if (t.fortification >= t.fortMax) continue;
        // A city being actively pushed to 0 stays down while besieged; otherwise regrow.
        if (t.fortification === 0 && siegeAdjacent.has(`${t.x},${t.z}`)) continue;
        t.fortification = Math.min(t.fortMax, t.fortification + 1);
    }
}