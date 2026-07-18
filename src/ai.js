/** AI decision logic (pure, no engine dependencies) */
import { UNIT_TYPE, CAPTURE_COST, AI_MAX_UNITS, BUILDING_TYPE, TERRAIN, NAVAL_UNITS,
         SIEGE_ENGINES, DIPLOMACY_STATES, SIEGE_TOWER_COST, SIEGE_TOWER_BUILD_RADIUS } from './config.js';
import { canAfford, spendCost, getAttackTargets } from './unit.js';
import { getUnitCostFor } from './faction.js';
import { canAttack } from './diplomacy.js';

/**
 * Compute a list of AI actions for one faction this turn.
 * Action shapes:
 *   { type: 'train',         unitType, tileKey }
 *   { type: 'build',         buildingType, tileKey }
 *   { type: 'move',          unitId, tx, tz }
 *   { type: 'attack',        fromId, toId }
 *   { type: 'capture',       unitId, tileKey }
 *   { type: 'besiege',        unitId, tileKey }
 *   { type: 'foundCity',     unitId, tileKey }
 *   { type: 'buildSiegeTower', unitId, tileKey }   // engineer builds a tower vs the named enemy city
 *
 * @param factionDef - this faction's def (roster + unit cost flavor)
 * @param diploState - diplomacy state (used to respect peace/trade/alliance:
 *                     the AI only attacks factions it is at war with)
 */
export function computeAIActions(units, tiles, resources, owner, buildings, influence, factionDef, diploState) {
    const actions = [];
    const myUnits = [...units.values()].filter(u => u.owner === owner);
    let res = { ...resources };
    buildings = buildings || new Map();
    influence = influence || null;
    const roster = (factionDef && factionDef.roster) || ['INFANTRY', 'ARCHER', 'CAVALRY', 'ARTILLERY'];

    /** Only factions at war with `owner` are valid targets. */
    const isAtWar = (other) => !diploState || canAttack(diploState, owner, other);
    const enemies = atWarFactions(diploState, owner);
    const atWar = enemies.length > 0;

    const canBuildAt = (t) => !influence || influence.has(`${t.x},${t.z}`);
    const owned = [...tiles.values()].filter(t => t.owner === owner);
    const myCityCount = owned.filter(t => t.terrain === 'CITY').length;
    const hasBarracks = owned.some(t => (buildings.get(`${t.x},${t.z}`) || []).includes('BARRACKS'));
    const trainCount = () => actions.filter(a => a.type === 'train').length;
    const capRoom = () => myUnits.length + trainCount() < AI_MAX_UNITS;

    // 1. Build a Barracks first (unlocks production + veteran training).
    if (!hasBarracks) {
        const city = owned.find(t => t.terrain === 'CITY' && canBuildAt(t) &&
            !(buildings.get(`${t.x},${t.z}`) || []).includes('BARRACKS'));
        if (city && canAffordBuilding('BARRACKS', res)) {
            actions.push({ type: 'build', buildingType: 'BARRACKS', tileKey: `${city.x},${city.z}` });
            res = payBuilding('BARRACKS', res);
        }
    }

    // 1a. When at war, build a Siege Workshop in a city (unlocks CATAPULT/
    //     TREBUCHET — long-range AOE siege). One is enough; it costs a lot.
    const hasSiegeWorkshop = owned.some(t =>
        (buildings.get(`${t.x},${t.z}`) || []).includes('SIEGE_WORKSHOP'));
    if (atWar && !hasSiegeWorkshop) {
        const city = owned.find(t => t.terrain === 'CITY' && canBuildAt(t) &&
            !(buildings.get(`${t.x},${t.z}`) || []).includes('SIEGE_WORKSHOP'));
        if (city && canAffordBuilding('SIEGE_WORKSHOP', res)) {
            actions.push({ type: 'build', buildingType: 'SIEGE_WORKSHOP', tileKey: `${city.x},${city.z}` });
            res = payBuilding('SIEGE_WORKSHOP', res);
        }
    }

    // 1b. SIEGE PRIORITY. Without siege the AI can never breach a fortified city
    //     and therefore can never conquer anyone — so it must build siege units
    //     as soon as it's at war. Direct siege types (SIEGE/ARTILLERY) are
    //     trained if affordable; otherwise their cost is RESERVED so the AI
    //     saves up across turns instead of frittering gold on cheap units.
    //     Factions with no roster siege train an ENGINEER, which builds a
    //     Siege Tower near an enemy city (see the per-unit loop below).
    //     If a Siege Workshop exists, long-range AOE engines (CATAPULT/TREBUCHET)
    //     are added to the options — they're gated per-city by the workshop.
    const siegeCount = myUnits.filter(u => u.type === 'SIEGE' || u.type === 'ARTILLERY' ||
        u.type === 'CATAPULT' || u.type === 'TREBUCHET').length;
    const engineerCount = myUnits.filter(u => u.type === 'ENGINEER').length;
    const siegeOptions = roster.filter(t => t === 'SIEGE' || t === 'ARTILLERY');
    if (hasSiegeWorkshop) siegeOptions.push('CATAPULT', 'TREBUCHET');
    if (atWar) {
        if (siegeOptions.length && siegeCount < 2) {
            const pick = cheapestSiege(siegeOptions, factionDef);
            const sc = getUnitCostFor(pick, factionDef);
            if (capRoom() && canAfford(pick, res, sc)) {
                // Siege engines must spawn in a city that has the workshop.
                const spawnTile = findOwnedTile(myUnits, tiles, actions, owner) ||
                    (hasSiegeWorkshop && owned.find(t => t.terrain === 'CITY' &&
                        (buildings.get(`${t.x},${t.z}`) || []).includes('SIEGE_WORKSHOP')));
                if (spawnTile) {
                    actions.push({ type: 'train', unitType: pick, tileKey: `${spawnTile.x},${spawnTile.z}` });
                    res = spendCost(pick, res, sc);
                }
            } else if (capRoom()) {
                // Can't afford one yet — guard the rest of this turn's spending
                // so the siege fund accumulates toward next turn.
                res = subtractCost(res, sc);
            }
        } else if (!siegeOptions.length && engineerCount < 1) {
            // No direct siege in roster → train an engineer to build a tower.
            const ec = getUnitCostFor('ENGINEER', factionDef);
            if (capRoom() && canAfford('ENGINEER', res, ec)) {
                const spawnTile = findOwnedTile(myUnits, tiles, actions, owner);
                if (spawnTile) {
                    actions.push({ type: 'train', unitType: 'ENGINEER', tileKey: `${spawnTile.x},${spawnTile.z}` });
                    res = spendCost('ENGINEER', res, ec);
                }
            }
        }
    }

    // 2. Train units from this faction's roster if affordable and below cap.
    while (myUnits.length + trainCount() < AI_MAX_UNITS) {
        const trainable = findAffordableUnit(res, roster, factionDef);
        if (!trainable) break;
        const spawnTile = findOwnedTile(myUnits, tiles, actions, owner);
        if (!spawnTile) break;
        actions.push({ type: 'train', unitType: trainable, tileKey: `${spawnTile.x},${spawnTile.z}` });
        res = spendCost(trainable, res, getUnitCostFor(trainable, factionDef));
    }

    // 2b. Civ6 expansion: with no per-tile capture, the AI must FOUND cities to
    //     grow. If it can afford a Settler and is below its city-count target,
    //     train one (it will be walked to an unowned land tile and founded).
    const settlerTarget = 3; // simple city-count goal
    const hasSettler = myUnits.some(u => u.type === 'SETTLER');
    if (!hasSettler && myCityCount < settlerTarget && capRoom()) {
        const spawnTile = findOwnedTile(myUnits, tiles, actions, owner);
        if (spawnTile && canAfford('SETTLER', res, getUnitCostFor('SETTLER', factionDef))) {
            actions.push({ type: 'train', unitType: 'SETTLER', tileKey: `${spawnTile.x},${spawnTile.z}` });
            res = spendCost('SETTLER', res, getUnitCostFor('SETTLER', factionDef));
        }
    }

    // 2c. Workers: train a few if there are improvable owned tiles within a
    //     city's influence that don't yet have their terrain improvement. Cap
    //     at min(2, cityCount) so workers don't crowd out the army.
    const workerCount = myUnits.filter(u => u.type === 'WORKER').length;
    const workerCap = Math.max(1, Math.min(2, myCityCount));
    if (workerCount < workerCap && capRoom() && hasImprovableTile(tiles, owner, buildings, influence)) {
        const wc = getUnitCostFor('WORKER', factionDef);
        if (canAfford('WORKER', res, wc)) {
            const spawnTile = findOwnedTile(myUnits, tiles, actions, owner);
            if (spawnTile) {
                actions.push({ type: 'train', unitType: 'WORKER', tileKey: `${spawnTile.x},${spawnTile.z}` });
                res = spendCost('WORKER', res, wc);
            }
        }
    }

    // 3. One economy building per turn if affordable (farms/lumbermills/mines/markets).
    for (const t of owned) {
        if (actions.filter(a => a.type === 'build').length >= 2) break;
        if (!canBuildAt(t)) continue;
        const existing = buildings.get(`${t.x},${t.z}`) || [];
        const pick = pickEconomyBuilding(t, existing, res);
        if (pick) {
            actions.push({ type: 'build', buildingType: pick, tileKey: `${t.x},${t.z}` });
            res = payBuilding(pick, res);
        }
    }

    // 4. Per-unit actions: settler founding > engineer build-siege-tower >
    //    besiege enemy city > attack enemy (at attackRange) > capture adjacent
    //    CITY > advance toward the best target.
    const moved = new Set();
    for (const unit of myUnits) {
        // a) Settlers found a city where they stand (if valid) or head toward
        //    the nearest unowned land tile to do so.
        if (unit.type === 'SETTLER') {
            const here = tiles.get(`${unit.x},${unit.z}`);
            if (here && canFoundOn(here, owner)) {
                actions.push({ type: 'foundCity', unitId: unit.id, tileKey: `${here.x},${here.z}` });
                continue;
            }
            const spot = findFoundSpot(unit, tiles, owner);
            if (spot) {
                const step = stepToward(unit, spot, tiles, owner, units, moved, isAtWar);
                if (step) {
                    actions.push({ type: 'move', unitId: unit.id, tx: step.x, tz: step.z });
                    moved.add(`${step.x},${step.z}`);
                    continue;
                }
            }
            continue; // nowhere to settle — idle.
        }

        // a1b) Workers build terrain improvements. If standing on an owned,
        //      unimproved, in-influence resource tile, build the matching
        //      improvement; otherwise step toward the nearest such tile.
        if (unit.type === 'WORKER') {
            const here = tiles.get(`${unit.x},${unit.z}`);
            const hereBldg = here ? improvementForTerrain(here.terrain) : null;
            const hereHas = hereBldg && (buildings.get(`${here.x},${here.z}`) || []).includes(hereBldg);
            if (here && here.owner === owner && hereBldg && !hereHas &&
                (!influence || influence.has(`${here.x},${here.z}`)) &&
                canAffordBuilding(hereBldg, res) && !unit.hasAttackedThisTurn) {
                actions.push({ type: 'workerBuild', unitId: unit.id, buildingType: hereBldg });
                res = payBuilding(hereBldg, res);
                continue;
            }
            const spot = findImprovementSpot(unit, tiles, owner, buildings, influence);
            if (spot) {
                const step = stepToward(unit, spot, tiles, owner, units, moved, isAtWar);
                if (step) {
                    actions.push({ type: 'move', unitId: unit.id, tx: step.x, tz: step.z });
                    moved.add(`${step.x},${step.z}`);
                }
            }
            continue;
        }

        // a2) Engineers build a Siege Tower when within range of an at-war
        //     enemy city (and the AI can afford it). This is how factions with
        //     no direct siege in their roster breach fortifications.
        if (unit.type === 'ENGINEER' && atWar && !unit.hasAttackedThisTurn) {
            const target = findEnemyCityWithin(unit, tiles, owner, isAtWar, SIEGE_TOWER_BUILD_RADIUS);
            if (target && canAffordCost(res, SIEGE_TOWER_COST)) {
                actions.push({ type: 'buildSiegeTower', unitId: unit.id, tileKey: `${target.x},${target.z}` });
                res = subtractCost(res, SIEGE_TOWER_COST);
                continue;
            }
        }

        // b) Besiege an adjacent enemy (at-war) city that still has fortification.
        const enemyCity = findAdjacentEnemyCity(unit, tiles, owner, isAtWar);
        if (enemyCity && (enemyCity.fortification || 0) > 0 && (UNIT_TYPE[unit.type].besiege)) {
            actions.push({ type: 'besiege', unitId: unit.id, tileKey: `${enemyCity.x},${enemyCity.z}` });
            continue;
        }

        // c) Attack an at-war enemy unit within this unit's attackRange (not
        //    just adjacent — so Archers, Artillery, Longbowmen and Galleys
        //    actually fire at range). Prefer the lowest-HP target (most likely
        //    to kill, avoiding a counter-attack).
        const enemyAdj = findAttackTarget(unit, units, isAtWar);
        if (enemyAdj) {
            actions.push({ type: 'attack', fromId: unit.id, toId: enemyAdj.id });
            continue;
        }

        // d) Capture an adjacent capturable CITY (Civ6: only cities flip).
        const captureCityTile = findAdjacentCapturable(unit, tiles, owner, res, isAtWar);
        if (captureCityTile) {
            actions.push({ type: 'capture', unitId: unit.id, tileKey: `${captureCityTile.x},${captureCityTile.z}` });
            res.gold -= CAPTURE_COST;
            continue;
        }

        // e) Otherwise advance one step toward the best target.
        const target = pickTarget(unit, tiles, owner, isAtWar);
        if (target) {
            const step = stepToward(unit, target, tiles, owner, units, moved, isAtWar);
            if (step) {
                actions.push({ type: 'move', unitId: unit.id, tx: step.x, tz: step.z });
                moved.add(`${step.x},${step.z}`);
            }
        }
    }

    return actions;
}

/** Factions currently at war with `owner` (from the diplomacy state). */
function atWarFactions(diploState, owner) {
    if (!diploState || !diploState.relations) return [];
    const out = [];
    for (const [key, rel] of Object.entries(diploState.relations)) {
        if (rel.state !== DIPLOMACY_STATES.WAR) continue;
        const [a, b] = key.split(':');
        if (a === owner) out.push(b);
        else if (b === owner) out.push(a);
    }
    return out;
}

/** Cheapest (by total resource cost) siege type in the roster. */
function cheapestSiege(options, factionDef) {
    let best = null, bestCost = Infinity;
    for (const t of options) {
        const c = getUnitCostFor(t, factionDef);
        const total = (c.gold||0)+(c.food||0)+(c.wood||0)+(c.iron||0)+(c.production||0);
        if (total < bestCost) { bestCost = total; best = t; }
    }
    return best;
}

/** Subtract a cost object from a resource pool, clamped at 0 (for saving). */
function subtractCost(res, cost) {
    const out = { ...res };
    for (const k of ['gold', 'food', 'wood', 'iron', 'production']) {
        out[k] = Math.max(0, (out[k] || 0) - (cost[k] || 0));
    }
    return out;
}
function canAffordCost(res, cost) {
    for (const k of ['gold', 'food', 'wood', 'iron', 'production']) {
        if ((res[k] || 0) < (cost[k] || 0)) return false;
    }
    return true;
}

/** Find an at-war enemy CITY within Chebyshev `radius` of `unit`. */
function findEnemyCityWithin(unit, tiles, owner, isAtWar, radius) {
    let best = null, bestDist = Infinity;
    for (let dx = -radius; dx <= radius; dx++) {
        for (let dz = -radius; dz <= radius; dz++) {
            const t = tiles.get(`${unit.x + dx},${unit.z + dz}`);
            if (!t || t.terrain !== 'CITY' || !t.owner || t.owner === owner) continue;
            if (isAtWar && !isAtWar(t.owner)) continue;
            const d = Math.abs(dx) + Math.abs(dz);
            if (d < bestDist) { bestDist = d; best = t; }
        }
    }
    return best;
}

/** Pick the best at-war enemy target within the unit's attackRange (lowest HP
 *  first, to maximize kills and avoid counter-attacks). Uses the per-type
 *  attackRange, so ranged units fire at range. */
function findAttackTarget(unit, units, isAtWar) {
    const targets = getAttackTargets(unit, units).filter(o => !isAtWar || isAtWar(o.owner));
    if (!targets.length) return null;
    targets.sort((a, b) => (a.hp || 0) - (b.hp || 0));
    return targets[0];
}

/** A settler may found a city on a land tile it can legally settle: not already
 *  a city, not water/mountain/river, and not owned by anyone. */
function canFoundOn(tile, owner) {
    if (!tile) return false;
    if (tile.terrain === 'CITY') return false;
    if (tile.terrain === 'WATER' || tile.terrain === 'MOUNTAIN' || tile.terrain === 'RIVER') return false;
    if (tile.owner) return false; // unowned only (don't settle inside someone's borders)
    return true;
}

/** Nearest unowned land tile a settler can head toward to found a city. */
function findFoundSpot(unit, tiles, owner) {
    let best = null, bestDist = Infinity;
    for (const t of tiles.values()) {
        if (!canFoundOn(t, owner)) continue;
        const d = manhattan(unit.x, unit.z, t.x, t.z);
        if (d < bestDist) { bestDist = d; best = t; }
    }
    return best;
}

function canAffordBuilding(type, resources) {
    const cost = BUILDING_TYPE[type].cost;
    for (const [res, amt] of Object.entries(cost)) {
        if ((resources[res] || 0) < amt) return false;
    }
    return true;
}

function payBuilding(type, resources) {
    const cost = BUILDING_TYPE[type].cost;
    const next = { ...resources };
    for (const [res, amt] of Object.entries(cost)) {
        next[res] = (next[res] || 0) - amt;
    }
    return next;
}

function pickEconomyBuilding(tile, existing, resources) {
    const candidates = {
        PLAINS: 'FARM',
        FOREST: 'LUMBERMILL',
        MOUNTAIN: 'MINE',
        CITY: 'MARKET'
    };
    const type = candidates[tile.terrain];
    if (!type || existing.includes(type)) return null;
    if (!canAffordBuilding(type, resources)) return null;
    return type;
}

/** The terrain improvement (FARM/LUMBERMILL/MINE) that fits this terrain, or
 *  null for terrains with no improvement (DESERT/MARSH/TUNDRA/HILLS/WATER/etc). */
function improvementForTerrain(terrain) {
    return ({ PLAINS: 'FARM', FOREST: 'LUMBERMILL', MOUNTAIN: 'MINE' })[terrain] || null;
}

/** Does the faction own at least one tile within influence that could still
 *  receive its terrain improvement? Drives the AI's worker-training decision. */
function hasImprovableTile(tiles, owner, buildings, influence) {
    for (const t of tiles.values()) {
        if (t.owner !== owner) continue;
        const b = improvementForTerrain(t.terrain);
        if (!b) continue;
        if ((buildings.get(`${t.x},${t.z}`) || []).includes(b)) continue;
        if (influence && !influence.has(`${t.x},${t.z}`)) continue;
        return true;
    }
    return false;
}

/** Nearest owned, unimproved, in-influence tile whose terrain has an
 *  improvement the worker can head toward. Returns the tile or null. */
function findImprovementSpot(unit, tiles, owner, buildings, influence) {
    let best = null, bestDist = Infinity;
    for (const t of tiles.values()) {
        if (t.owner !== owner) continue;
        const b = improvementForTerrain(t.terrain);
        if (!b) continue;
        if ((buildings.get(`${t.x},${t.z}`) || []).includes(b)) continue;
        if (influence && !influence.has(`${t.x},${t.z}`)) continue;
        const d = Math.max(Math.abs(t.x - unit.x), Math.abs(t.z - unit.z));
        if (d < bestDist) { bestDist = d; best = t; }
    }
    return best;
}

function findAffordableUnit(resources, roster, factionDef) {
    // Pick the strongest affordable unit from this faction's roster.
    const order = ['SIEGE', 'ARTILLERY', 'CAVALRY', 'PIKEMAN', 'ARCHER', 'INFANTRY', 'SCOUT'];
    for (const t of order) {
        if (!roster.includes(t)) continue;
        if (canAfford(t, resources, getUnitCostFor(t, factionDef))) return t;
    }
    return null;
}

function findOwnedTile(myUnits, tiles, actions, owner) {
    const occupied = new Set();
    for (const u of myUnits) occupied.add(`${u.x},${u.z}`);
    for (const a of actions) if (a.tileKey) occupied.add(a.tileKey);
    for (const t of tiles.values()) {
        if (t.owner === owner && !occupied.has(`${t.x},${t.z}`)) return t;
    }
    // Fall back to any owned tile (stack units)
    for (const t of tiles.values()) {
        if (t.owner === owner) return t;
    }
    return null;
}

function getNeighbors(x, z, range, tiles) {
    const set = new Set();
    for (let dx = -range; dx <= range; dx++) {
        for (let dz = -range; dz <= range; dz++) {
            if (dx === 0 && dz === 0) continue;
            const k = `${x + dx},${z + dz}`;
            if (tiles.has(k)) set.add(k);
        }
    }
    return set;
}

/** Find an adjacent tile the AI can CAPTURE. Civ6: only cities flip — so this
 *  returns an adjacent breached enemy city (fortification 0) that we're at war
 *  with. Non-city tiles are never captured by moving onto them. */
function findAdjacentCapturable(unit, tiles, owner, res, isAtWar) {
    if (res.gold < CAPTURE_COST) return null;
    let city = null;
    for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
            if (dx === 0 && dz === 0) continue;
            const t = tiles.get(`${unit.x + dx},${unit.z + dz}`);
            if (!t) continue;
            if (t.owner === owner) continue;
            if (t.terrain === 'CITY' && t.owner && t.owner !== owner) {
                if (isAtWar && !isAtWar(t.owner)) continue; // respect peace/trade/alliance
                // Only capture a city that has been breached (fortification 0).
                if ((t.fortification || 0) <= 0 && !city) city = t;
            }
        }
    }
    return city;
}

/** Find an adjacent enemy (at-war) city (any fortification level) for besieging. */
function findAdjacentEnemyCity(unit, tiles, owner, isAtWar) {
    for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
            if (dx === 0 && dz === 0) continue;
            const t = tiles.get(`${unit.x + dx},${unit.z + dz}`);
            if (!t) continue;
            if (t.terrain === 'CITY' && t.owner && t.owner !== owner) {
                if (isAtWar && !isAtWar(t.owner)) continue; // don't besiege allies/trade partners
                return t;
            }
        }
    }
    return null;
}

/** Pick the best tile for a unit to advance toward: enemy (at-war) cities
 *  first, then any at-war enemy tile, then nearest unowned tile (expansion). */
function pickTarget(unit, tiles, owner, isAtWar) {
    let best = null;
    let bestScore = -Infinity;
    // First pass: at-war enemy cities.
    for (const t of tiles.values()) {
        if (t.owner && t.owner !== owner && t.terrain === 'CITY' && (!isAtWar || isAtWar(t.owner))) {
            const score = 1000 - manhattan(unit.x, unit.z, t.x, t.z);
            if (score > bestScore) { bestScore = score; best = t; }
        }
    }
    if (best) return best;
    // Second pass: any at-war enemy-owned tile.
    for (const t of tiles.values()) {
        if (t.owner && t.owner !== owner && (!isAtWar || isAtWar(t.owner))) {
            const score = 500 - manhattan(unit.x, unit.z, t.x, t.z);
            if (score > bestScore) { bestScore = score; best = t; }
        }
    }
    if (best) return best;
    // Third pass: nearest unowned tile (expansion toward unsettled land).
    for (const t of tiles.values()) {
        if (!t.owner) {
            const score = 100 - manhattan(unit.x, unit.z, t.x, t.z);
            if (score > bestScore) { bestScore = score; best = t; }
        }
    }
    return best;
}

/** True if `unitType` is a naval (ship) unit that moves on water. */
function isNaval(unit) {
    return !!(unit && UNIT_TYPE[unit.type] && UNIT_TYPE[unit.type].naval);
}

/** Choose a single-tile step toward the target, avoiding friendly stacks and
 *  tiles already claimed by another AI unit this turn. Naval units move on
 *  water/river; land units avoid water and unbridged rivers. Returns {x,z}. */
function stepToward(unit, target, tiles, owner, units, moved, isAtWar) {
    const range = UNIT_TYPE[unit.type].moveRange || 1;
    const naval = isNaval(unit);
    const candidates = [];
    for (let dx = -range; dx <= range; dx++) {
        for (let dz = -range; dz <= range; dz++) {
            if (dx === 0 && dz === 0) continue;
            if (Math.abs(dx) + Math.abs(dz) > range) continue;
            const nx = unit.x + dx, nz = unit.z + dz;
            const k = `${nx},${nz}`;
            const t = tiles.get(k);
            if (!t) continue;
            if (naval) {
                // Ships move on water and river tiles only.
                if (t.terrain !== 'WATER' && t.terrain !== 'RIVER') continue;
            } else {
                // Land units: rivers (without a bridge) and water are impassable.
                if (t.terrain === 'WATER' || (t.terrain === 'RIVER' && !t.bridge)) continue;
            }
            // Don't step onto a friendly-occupied tile or a tile another unit
            // is already moving to this turn.
            let blocked = moved.has(k);
            for (const u of units.values()) {
                if (u.owner === owner && u.id !== unit.id && u.x === nx && u.z === nz) { blocked = true; break; }
            }
            if (blocked) continue;
            // Don't step onto enemy-occupied tiles via move (attack instead).
            for (const u of units.values()) {
                if (u.owner !== owner && u.x === nx && u.z === nz) { blocked = true; break; }
            }
            if (blocked) continue;
            // Don't step onto a fortified enemy city (must besiege first), unless
            // a friendly Siege Tower is orthogonally adjacent to it (canAssault).
            if (!naval && t.terrain === 'CITY' && t.owner && t.owner !== owner && (t.fortification || 0) > 0) {
                if (isAtWar && !isAtWar(t.owner)) continue;
                if (!siegeTowerAdjacentTo(t, owner, units)) continue;
            }
            candidates.push({ x: nx, z: nz, d: manhattan(nx, nz, target.x, target.z) });
        }
    }
    if (candidates.length === 0) return null;
    candidates.sort((a, b) => a.d - b.d);
    return candidates[0];
}

/** True if a friendly Siege Tower unit is orthogonally adjacent to `cityTile`
 *  (enabling a direct assault on a fortified city). */
function siegeTowerAdjacentTo(cityTile, owner, units) {
    for (const u of units.values()) {
        if (u.owner !== owner) continue;
        if (u.type !== 'SIEGE_TOWER') continue;
        if (Math.abs(u.x - cityTile.x) + Math.abs(u.z - cityTile.z) === 1) return true;
    }
    return false;
}

function manhattan(x1, z1, x2, z2) {
    return Math.abs(x2 - x1) + Math.abs(z2 - z1);
}