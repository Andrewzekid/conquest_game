/** AI decision logic (pure, no engine dependencies) */
import { UNIT_TYPE, CAPTURE_COST, AI_MAX_UNITS, BUILDING_TYPE, TERRAIN, NAVAL_UNITS,
         SIEGE_ENGINES, PILLAGEABLE_BUILDINGS, DIPLOMACY_STATES, SIEGE_TOWER_COST, SIEGE_TOWER_BUILD_RADIUS,
         GRID_SIZE, TYPE_ADVANTAGE, CONCEAL_TERRAINS, CONCEAL_MAX_PER_TILE, CHARGE_UNITS } from './config.js';
import { canAfford, spendCost, getAttackTargets } from './unit.js';
import { getUnitCostFor } from './faction.js';
import { canAttack } from './diplomacy.js';
import { simulateCombat, isEncircled } from './battle.js';
import { nextStepToward } from './path.js';
import { findCommandingLord } from './lords.js';

/**
 * Compute a list of AI actions for one faction this turn.
 * Action shapes:
 *   { type: 'train',         unitType, tileKey }
 *   { type: 'build',         buildingType, tileKey }
 *   { type: 'move',          unitId, tx, tz }
 *   { type: 'attack',        fromId, toId }
 *   { type: 'charge',        fromId, toId }
 *   { type: 'capture',       unitId, tileKey }
 *   { type: 'besiege',        unitId, tileKey }
 *   { type: 'foundCity',     unitId, tileKey }
 *   { type: 'buildSiegeTower', unitId, tileKey }   // engineer builds a tower vs the named enemy city
 *   { type: 'workerBuild',    unitId, buildingType } // worker builds an improvement on its tile
 *   { type: 'pillage',        unitId, tileKey }      // military unit destroys an enemy improvement
 *   { type: 'conceal',        unitId }              // unit begins concealing in forest/mountain (ambush)
 *
 * Military units no longer act one at a time: they are grouped into army
 * groups (by commanding lord, with spatial clustering for the unaffiliated),
 * each group is given a shared objective + stance, and planGroup emits a
 * coordinated action list (screen fragile units, focus fire, encircle, retreat
 * when outmatched, conceal for ambush, advance in formation).
 *
 * @param lords - full lords array (for army grouping + combat predictions)
 * @param tempBonuses - faction->{attack,defense} from king actives (for predictions)
 * @param factionDef - this faction's def (roster + unit cost flavor)
 * @param diploState - diplomacy state (used to respect peace/trade/alliance:
 *                     the AI only attacks factions it is at war with)
 */
export function computeAIActions(units, tiles, resources, owner, buildings, influence, factionDef, diploState, lords = null, tempBonuses = null) {
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

    // 1a. Build a Siege Workshop in a city (unlocks CATAPULT/TREBUCHET —
    //     long-range AOE siege). One is enough; it costs a lot.
    //     AI builds this proactively (not just when at war) to prepare for
    //     future conflicts and enable siege engine production.
    //     Lowered requirement from 2 cities to 1 city for earlier siege capability.
    const hasSiegeWorkshop = owned.some(t =>
        (buildings.get(`${t.x},${t.z}`) || []).includes('SIEGE_WORKSHOP'));
    if (!hasSiegeWorkshop && myCityCount >= 1) {
        const city = owned.find(t => t.terrain === 'CITY' && canBuildAt(t) &&
            !(buildings.get(`${t.x},${t.z}`) || []).includes('SIEGE_WORKSHOP'));
        if (city && canAffordBuilding('SIEGE_WORKSHOP', res)) {
            actions.push({ type: 'build', buildingType: 'SIEGE_WORKSHOP', tileKey: `${city.x},${city.z}` });
            res = payBuilding('SIEGE_WORKSHOP', res);
        }
    }

    // 1b. SIEGE PRIORITY. Without siege the AI can never breach a fortified city
    //     and therefore can never conquer anyone -- so it must build siege units
    //     as soon as it's at war. Direct siege types (SIEGE/ARTILLERY) are
    //     trained if affordable; otherwise their cost is RESERVED so the AI
    //     saves up across turns instead of frittering gold on cheap units.
    //     Factions with no roster siege train an ENGINEER, which builds a
    //     Siege Tower near an enemy city (see the per-unit loop below).
    //     If a Siege Workshop exists, long-range AOE engines (CATAPULT/TREBUCHET)
    //     are added to the options -- they're gated per-city by the workshop.
    //     Siege cap scales with the unit cap to maintain ~15% siege composition.
    const siegeCount = myUnits.filter(u => u.type === 'SIEGE' || u.type === 'ARTILLERY' ||
        u.type === 'CATAPULT' || u.type === 'TREBUCHET').length;
    const engineerCount = myUnits.filter(u => u.type === 'ENGINEER').length;
    const siegeOptions = roster.filter(t => t === 'SIEGE' || t === 'ARTILLERY');
    if (hasSiegeWorkshop) siegeOptions.push('CATAPULT', 'TREBUCHET');
    // Composition-aware siege cap: aim for ~15% siege in the total army.
    const siegeCap = Math.max(2, Math.round(AI_MAX_UNITS * 0.15));
    if (siegeOptions.length && siegeCount < siegeCap) {
        // When siege workshop exists, prioritize artillery (CATAPULT/TREBUCHET)
        // over basic siege units for their AOE capabilities.
        let pick;
        if (hasSiegeWorkshop && (siegeOptions.includes('CATAPULT') || siegeOptions.includes('TREBUCHET'))) {
            // Prefer TREBUCHET (stronger) if affordable, else CATAPULT
            const trebCost = getUnitCostFor('TREBUCHET', factionDef);
            const catCost = getUnitCostFor('CATAPULT', factionDef);
            if (siegeOptions.includes('TREBUCHET') && canAfford('TREBUCHET', res, trebCost)) {
                pick = 'TREBUCHET';
            } else if (siegeOptions.includes('CATAPULT') && canAfford('CATAPULT', res, catCost)) {
                pick = 'CATAPULT';
            } else {
                pick = cheapestSiege(siegeOptions, factionDef);
            }
        } else {
            pick = cheapestSiege(siegeOptions, factionDef);
        }
        const sc = getUnitCostFor(pick, factionDef);
        if (capRoom() && canAfford(pick, res, sc)) {
            // Siege engines must spawn in a city that has the workshop.
            const workshopCity = hasSiegeWorkshop && owned.find(t => t.terrain === 'CITY' &&
                (buildings.get(`${t.x},${t.z}`) || []).includes('SIEGE_WORKSHOP'));
            const spawnTile = workshopCity || findOwnedTile(myUnits, tiles, actions, owner);
            if (spawnTile) {
                actions.push({ type: 'train', unitType: pick, tileKey: `${spawnTile.x},${spawnTile.z}` });
                res = spendCost(pick, res, sc);
            }
        } else if (capRoom()) {
            // Can't afford one yet -- guard the rest of this turn's spending
            // so the siege fund accumulates toward next turn.
            res = subtractCost(res, sc);
        }
    } else if (!siegeOptions.length && engineerCount < 2) {
        // No direct siege in roster -> train engineers to build towers.
        // Increased cap from 1 to 2 for faster siege tower production.
        const ec = getUnitCostFor('ENGINEER', factionDef);
        if (capRoom() && canAfford('ENGINEER', res, ec)) {
            const spawnTile = findOwnedTile(myUnits, tiles, actions, owner);
            if (spawnTile) {
                actions.push({ type: 'train', unitType: 'ENGINEER', tileKey: `${spawnTile.x},${spawnTile.z}` });
                res = spendCost('ENGINEER', res, ec);
            }
        }
    }

    // 2. Civ6 expansion: with no per-tile capture, the AI must FOUND cities to
    //     grow. Train settlers aggressively -- they are the primary expansion
    //     mechanism. Keep 1-2 settlers queued while under the unit cap, but
    //     never strip defenses to do so.
    const settlerTarget = Math.max(4, Math.round(GRID_SIZE / 5));
    const settlerCap = Math.max(1, Math.ceil(myCityCount / 2) + 1);
    let queuedSettlers = 0;
    const maxSettlersThisTurn = 2;
    while (queuedSettlers < maxSettlersThisTurn && myCityCount < settlerTarget && capRoom() && roster.includes('SETTLER')) {
        const liveSettlers = myUnits.filter(u => u.type === 'SETTLER').length;
        if (liveSettlers + queuedSettlers >= settlerCap) break;
        // A second queued settler requires a defensive floor so the army isn't stripped.
        if (queuedSettlers > 0) {
            const meleeCount = myUnits.filter(u => u.type === 'INFANTRY' || u.type === 'PIKEMAN').length;
            const militaryCount = myUnits.filter(u => u.type !== 'SETTLER' && u.type !== 'WORKER' && u.type !== 'SCOUT').length;
            if (militaryCount < 5 || meleeCount < 2) break;
        }
        const spawnTile = findOwnedTile(myUnits, tiles, actions, owner);
        if (!spawnTile || !canAfford('SETTLER', res, getUnitCostFor('SETTLER', factionDef))) break;
        actions.push({ type: 'train', unitType: 'SETTLER', tileKey: `${spawnTile.x},${spawnTile.z}` });
        res = spendCost('SETTLER', res, getUnitCostFor('SETTLER', factionDef));
        queuedSettlers++;
    }

    // 2b. SCOUT TRAINING. Train a small number of scouts (1-2 max) for exploration.
    //     Only train scouts if we already have some military presence (3+ units).
    //     This prevents overproduction of scouts at the expense of army.
    const scoutCount = myUnits.filter(u => u.type === 'SCOUT').length;
    const militaryCount = myUnits.filter(u => u.type !== 'SCOUT' && u.type !== 'SETTLER' && u.type !== 'WORKER').length;
    const scoutCap = 2; // Hard cap at 2 scouts
    if (scoutCount < scoutCap && militaryCount >= 3 && capRoom() && roster.includes('SCOUT')) {
        const scoutCost = getUnitCostFor('SCOUT', factionDef);
        if (canAfford('SCOUT', res, scoutCost)) {
            const spawnTile = findOwnedTile(myUnits, tiles, actions, owner);
            if (spawnTile) {
                actions.push({ type: 'train', unitType: 'SCOUT', tileKey: `${spawnTile.x},${spawnTile.z}` });
                res = spendCost('SCOUT', res, scoutCost);
            }
        }
    }

    // 2c. Train units from this faction's roster if affordable and below cap.
    while (myUnits.length + trainCount() < AI_MAX_UNITS) {
        const trainable = findAffordableUnit(res, roster, factionDef, myUnits, actions, owner);
        if (!trainable) break;
        const spawnTile = findOwnedTile(myUnits, tiles, actions, owner);
        if (!spawnTile) break;
        actions.push({ type: 'train', unitType: trainable, tileKey: `${spawnTile.x},${spawnTile.z}` });
        res = spendCost(trainable, res, getUnitCostFor(trainable, factionDef));
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

    // 4. Per-unit support actions: settlers found/move, workers build/move,
    //    engineers build siege towers, scouts explore. Military units are NOT
    //    handled here — they go through army-group coordination (step 5) so
    //    they fight as a coordinated group rather than each picking targets
    //    independently. `moved` tracks tiles claimed this turn (avoids two
    //    units stacking on the same destination); `acted` tracks unit ids
    //    that already have an action so a unit can't be double-acted by
    //    group planning.
    const moved = new Set();
    const acted = new Set();

    // Find the king for this faction (for king safety logic)
    const myKing = lords ? lords.find(l => l.owner === owner && l.isKing) : null;

    for (const unit of myUnits) {
        // a) Settlers found a city where they stand (if valid) or head toward
        //    the nearest unowned land tile to do so.
        if (unit.type === 'SETTLER') {
            const here = tiles.get(`${unit.x},${unit.z}`);
            if (here && canFoundOn(here, owner)) {
                actions.push({ type: 'foundCity', unitId: unit.id, tileKey: `${here.x},${here.z}` });
                acted.add(unit.id);
                continue;
            }
            const spot = findFoundSpot(unit, tiles, owner);
            if (spot) {
                const step = stepToward(unit, spot, tiles, owner, units, moved, isAtWar);
                if (step) {
                    actions.push({ type: 'move', unitId: unit.id, tx: step.x, tz: step.z });
                    moved.add(`${step.x},${step.z}`);
                    acted.add(unit.id);
                    continue;
                }
            }
            acted.add(unit.id); // nowhere to settle — idle.
            continue;
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
                acted.add(unit.id);
                continue;
            }
            const spot = findImprovementSpot(unit, tiles, owner, buildings, influence);
            if (spot) {
                const step = stepToward(unit, spot, tiles, owner, units, moved, isAtWar);
                if (step) {
                    actions.push({ type: 'move', unitId: unit.id, tx: step.x, tz: step.z });
                    moved.add(`${step.x},${step.z}`);
                    acted.add(unit.id);
                }
            }
            acted.add(unit.id);
            continue;
        }

        // a2) Engineers build a Siege Tower when within range of an at-war
        //     enemy city (and the AI can afford it). This is how factions with
        //     no direct siege in their roster breach fortifications. Engineers
        //     that can't build yet (too far from an enemy city) step toward the
        //     nearest enemy city so they can build on subsequent turns.
        if (unit.type === 'ENGINEER' && atWar && !unit.hasAttackedThisTurn) {
            const target = findEnemyCityWithin(unit, tiles, owner, isAtWar, SIEGE_TOWER_BUILD_RADIUS);
            if (target && canAffordCost(res, SIEGE_TOWER_COST)) {
                actions.push({ type: 'buildSiegeTower', unitId: unit.id, tileKey: `${target.x},${target.z}` });
                res = subtractCost(res, SIEGE_TOWER_COST);
                acted.add(unit.id);
                continue;
            }
            // Not in range yet — step toward the nearest enemy city.
            const nearest = findNearestEnemyCity(unit, tiles, owner, isAtWar);
            if (nearest) {
                const step = stepToward(unit, nearest, tiles, owner, units, moved, isAtWar);
                if (step) {
                    actions.push({ type: 'move', unitId: unit.id, tx: step.x, tz: step.z });
                    moved.add(`${step.x},${step.z}`);
                    acted.add(unit.id);
                    continue;
                }
            }
        }

        // a3) Scouts explore: move toward unexplored tiles or enemy territory.
        //     Scouts are the AI's eyes — they reveal the map and find enemy
        //     cities for the army to target. Prioritize unexplored areas, then
        //     enemy-owned tiles to gather intelligence.
        if (unit.type === 'SCOUT' && !unit.hasAttackedThisTurn) {
            // Priority 1: Find nearest unexplored tile (tiles not owned by anyone
            // and not adjacent to any owned tile — likely unexplored frontier)
            const unexploredTarget = findNearestUnexploredTile(unit, tiles, owner);
            if (unexploredTarget) {
                const step = stepToward(unit, unexploredTarget, tiles, owner, units, moved, isAtWar);
                if (step) {
                    actions.push({ type: 'move', unitId: unit.id, tx: step.x, tz: step.z });
                    moved.add(`${step.x},${step.z}`);
                    acted.add(unit.id);
                    continue;
                }
            }
            // Priority 2: Move toward enemy territory to gather intelligence
            const enemyTarget = findNearestEnemyTileForScout(unit, tiles, owner, isAtWar);
            if (enemyTarget) {
                const step = stepToward(unit, enemyTarget, tiles, owner, units, moved, isAtWar);
                if (step) {
                    actions.push({ type: 'move', unitId: unit.id, tx: step.x, tz: step.z });
                    moved.add(`${step.x},${step.z}`);
                    acted.add(unit.id);
                    continue;
                }
            }
            // Priority 3: If no exploration targets, fall through to army group
        }
    }

    // 4b. King safety check: if the king is threatened, adjust army group behavior.
    //     A king is "threatened" if enemy units are within Chebyshev 3 and the
    //     king has fewer than 2 friendly units nearby. When threatened, all army
    //     groups shift to defensive stance and move toward the king.
    let kingThreatened = false;
    let kingSafeTile = null;
    if (myKing) {
        const kingSafety = evaluateKingSafety(myKing, units, owner, isAtWar);
        if (!kingSafety.isSafe) {
            kingThreatened = true;
            // Find a safe tile for the king (nearest friendly city with escort)
            kingSafeTile = findSafeTileForKing(myKing, tiles, units, owner);
        }
    }

    // 5. Army-group coordination: military units (everything that wasn't a
    //    settler/worker and didn't already act — including engineers that
    //    didn't build a tower) are grouped, given a shared objective + stance,
    //    and planned together. See planGroup for the per-group action order.
    const militaryPool = myUnits.filter(u =>
        !acted.has(u.id) && u.type !== 'SETTLER' && u.type !== 'WORKER');
    const groups = buildArmyGroups(militaryPool, lords, owner);
    for (const g of groups) {
        const stance = computeStance(g, units, owner, atWar, isAtWar);
        const objective = pickGroupObjective(g, tiles, owner, isAtWar, stance);
        actions.push(...planGroup(g, objective, stance, units, tiles, owner,
            lords, buildings, tempBonuses, diploState, moved, acted, atWar, isAtWar, res));
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

/** An adjacent (Chebyshev-1) at-war enemy-owned tile bearing a pillageable
 *  terrain improvement, or null. */
function findAdjacentPillageable(unit, tiles, owner, isAtWar, buildings) {
    for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
            const t = tiles.get(`${unit.x + dx},${unit.z + dz}`);
            if (!t) continue;
            if (!t.owner || t.owner === owner) continue;
            if (isAtWar && !isAtWar(t.owner)) continue;
            const list = (buildings && buildings.get(`${t.x},${t.z}`)) || [];
            if (list.some(b => PILLAGEABLE_BUILDINGS.includes(b))) return t;
        }
    }
    return null;
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

/** Find the nearest at-war enemy CITY anywhere on the map (used by engineers
 *  to head toward a target city when outside build range). */
function findNearestEnemyCity(unit, tiles, owner, isAtWar) {
    let best = null, bestDist = Infinity;
    for (const t of tiles.values()) {
        if (t.terrain !== 'CITY' || !t.owner || t.owner === owner) continue;
        if (isAtWar && !isAtWar(t.owner)) continue;
        const d = manhattan(unit.x, unit.z, t.x, t.z);
        if (d < bestDist) { bestDist = d; best = t; }
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

/** Nearest unowned land tile a settler can head toward to found a city.
 *  Scores candidate tiles by:
 *  - Resource density (food, wood, iron, gold) in surrounding area
 *  - Natural wonders (huge bonus)
 *  - Frontier bonus: strongly prefers tiles FAR from existing friendly cities
 *    to encourage expansion into different regions
 *  - Distance from settler (closer is slightly better)
 *  - Safety (fewer nearby enemies is better)
 *  This makes the AI prioritize settling in resource-rich frontier areas,
 *  spreading into different map regions instead of clustering near home. */
function findFoundSpot(unit, tiles, owner) {
    // Find the nearest friendly city distance for frontier scoring
    let nearestFriendlyCityDist = Infinity;
    for (const t of tiles.values()) {
        if (t.terrain === 'CITY' && t.owner === owner) {
            const d = manhattan(unit.x, unit.z, t.x, t.z);
            if (d < nearestFriendlyCityDist) nearestFriendlyCityDist = d;
        }
    }
    
    let best = null, bestScore = -Infinity;
    for (const t of tiles.values()) {
        if (!canFoundOn(t, owner)) continue;
        const dist = manhattan(unit.x, unit.z, t.x, t.z);
        
        // Calculate resource density in surrounding area (radius 2)
        let resourceScore = 0;
        let hasWonder = false;
        let enemyNear = 0, friendlyNear = 0;
        // Distance from nearest friendly city (for frontier bonus)
        let nearestCityDist = Infinity;
        
        for (let dx = -3; dx <= 3; dx++) {
            for (let dz = -3; dz <= 3; dz++) {
                const nt = tiles.get(`${t.x + dx},${t.z + dz}`);
                if (!nt) continue;
                
                // Track nearest friendly city
                if (nt.terrain === 'CITY' && nt.owner === owner) {
                    const cd = Math.abs(dx) + Math.abs(dz);
                    if (cd < nearestCityDist) nearestCityDist = cd;
                }
                
                // Count enemies and friends
                if (nt.owner === owner) friendlyNear++;
                else if (nt.owner) enemyNear++;
                
                // Resource scoring (only for tiles in influence range)
                if (Math.abs(dx) <= 2 && Math.abs(dz) <= 2) {
                    const terrain = nt.terrain;
                    if (terrain === 'PLAINS') resourceScore += 3;
                    else if (terrain === 'FOREST') resourceScore += 4;
                    else if (terrain === 'MOUNTAIN') resourceScore += 5;
                    else if (terrain === 'HILLS') resourceScore += 3;
                    else if (terrain === 'DESERT') resourceScore += 2;
                    else if (terrain === 'MARSH') resourceScore += 2;
                    else if (terrain === 'TUNDRA') resourceScore += 2;
                    else if (terrain === 'RIVER') resourceScore += 3;
                    else if (terrain === 'CITY') resourceScore += 8;
                    
                    if (nt.wonder) {
                        hasWonder = true;
                        resourceScore += 50;
                    }
                }
            }
        }
        
        // Score calculation:
        let score = resourceScore * 8;          // Resource density (slightly reduced)
        if (hasWonder) score += 200;            // Natural wonder bonus
        score -= dist * 1;                      // Prefer closer tiles (mild)
        score -= enemyNear * 5;                 // Avoid enemy clusters
        
        // FRONTIER BONUS: strongly prefer tiles far from existing friendly cities
        // This is the key change — rewards expansion into new regions
        if (nearestCityDist > 8) score += 60;   // Very far from any city — great frontier
        else if (nearestCityDist > 5) score += 30; // Moderately far — good expansion
        else if (nearestCityDist > 3) score += 10; // Somewhat far — acceptable
        else score -= 20;                       // Too close to existing city — penalize
        
        // Mild penalty for being too close to friendly territory (reduces clustering)
        score -= friendlyNear * 1;
        
        if (score > bestScore) { bestScore = score; best = t; }
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

/** Composition role buckets for the AI army. */
const MELEE_TYPES = new Set(['INFANTRY', 'PIKEMAN']);
const RANGED_TYPES = new Set(['ARCHER', 'LONGBOWMAN']);
const CAVALRY_TYPES = new Set(['CAVALRY', 'CATAPHRACT']);
const SIEGE_TYPES = new Set(['SIEGE', 'ARTILLERY', 'CATAPULT', 'TREBUCHET', 'SIEGE_TOWER']);
const SUPPORT_TYPES = new Set(['MEDIC', 'ENGINEER']);

function unitRole(type) {
    if (MELEE_TYPES.has(type)) return 'melee';
    if (RANGED_TYPES.has(type)) return 'ranged';
    if (CAVALRY_TYPES.has(type)) return 'cavalry';
    if (SIEGE_TYPES.has(type)) return 'siege';
    if (SUPPORT_TYPES.has(type)) return 'support';
    return 'other';
}

function countByRole(units, actions, owner) {
    const counts = { melee: 0, ranged: 0, cavalry: 0, siege: 0, support: 0 };
    for (const u of units) {
        if (u.owner !== owner) continue;
        const r = unitRole(u.type);
        if (counts[r] !== undefined) counts[r]++;
    }
    if (actions) {
        for (const a of actions) {
            if (a.type === 'train') {
                const r = unitRole(a.unitType);
                if (counts[r] !== undefined) counts[r]++;
            }
        }
    }
    return counts;
}

function roleDeficit(roster, counts, total) {
    const target = { melee: 0.40, ranged: 0.25, cavalry: 0.15, siege: 0.15, support: 0.05 };
    const available = new Set();
    for (const t of roster) available.add(unitRole(t));
    // Don't chase support units until the army has some mass.
    if (total < 8) available.delete('support');
    let worstRole = 'melee', worstDeficit = -Infinity;
    for (const r of Object.keys(target)) {
        if (!available.has(r)) continue;
        const current = counts[r] || 0;
        const desired = total * target[r];
        const deficit = desired - current;
        if (deficit > worstDeficit) { worstDeficit = deficit; worstRole = r; }
    }
    return worstRole;
}
/** Pick an affordable unit from this faction's roster, biased toward a balanced
 *  army composition. Early on it secures melee screens, then fills the biggest
 *  role deficit (melee/ranged/cavalry/siege/support). Falls back to the
 *  strongest affordable unit if no composition pick is available. */
function findAffordableUnit(resources, roster, factionDef, units, actions, owner) {
    const counts = countByRole(units, actions, owner);
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    // Defense floor: first few units must be melee so expansion/siege don't
    // strip the army bare.
    if (total < 4 && roster.some(t => MELEE_TYPES.has(t))) {
        for (const t of ['INFANTRY', 'PIKEMAN']) {
            if (roster.includes(t) && canAfford(t, resources, getUnitCostFor(t, factionDef))) return t;
        }
    }
    if (total >= 4) {
        const role = roleDeficit(roster, counts, total);
        const order = [];
        if (role === 'melee') order.push('INFANTRY', 'PIKEMAN');
        else if (role === 'ranged') order.push('ARCHER', 'LONGBOWMAN');
        else if (role === 'cavalry') order.push('CAVALRY', 'CATAPHRACT');
        else if (role === 'siege') order.push('SIEGE', 'ARTILLERY');
        else if (role === 'support') order.push('MEDIC', 'ENGINEER');
        for (const t of order) {
            if (roster.includes(t) && canAfford(t, resources, getUnitCostFor(t, factionDef))) return t;
        }
    }
    // Fallback: strongest affordable.
    const order = ['SIEGE', 'ARTILLERY', 'CAVALRY', 'PIKEMAN', 'ARCHER', 'INFANTRY', 'SCOUT'];
    for (const t of order) {
        if (!roster.includes(t)) continue;
        if (canAfford(t, resources, getUnitCostFor(t, factionDef))) return t;
    }
    return null;
}

/** Find a suitable spawn tile for a new unit. Must be a CITY (units can only
 *  spawn in cities), owned by the faction, and preferably not already occupied.
 *  Never returns water/mountain/river tiles. */
function findOwnedTile(myUnits, tiles, actions, owner) {
    const occupied = new Set();
    for (const u of myUnits) occupied.add(`${u.x},${u.z}`);
    for (const a of actions) if (a.tileKey) occupied.add(a.tileKey);
    // First pass: unoccupied owned cities
    for (const t of tiles.values()) {
        if (t.owner === owner && t.terrain === 'CITY' && !occupied.has(`${t.x},${t.z}`)) return t;
    }
    // Second pass: any owned city (stack units if needed)
    for (const t of tiles.values()) {
        if (t.owner === owner && t.terrain === 'CITY') return t;
    }
    // Fallback: any owned land tile (should rarely happen)
    for (const t of tiles.values()) {
        if (t.owner === owner && t.terrain !== 'WATER' && t.terrain !== 'MOUNTAIN' && t.terrain !== 'RIVER') return t;
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
 *  returns an adjacent breached city (fortification 0). This includes:
 *  - Enemy cities we're at war with (respecting peace/trade/alliance)
 *  - Neutral cities (owner=null, from eliminated factions) — these are always
 *    capturable since no one owns them, giving the AI a path to expand into
 *    the ruins of fallen empires.
 *  Non-city tiles are never captured by moving onto them. */
function findAdjacentCapturable(unit, tiles, owner, res, isAtWar) {
    if (res.gold < CAPTURE_COST) return null;
    let city = null;
    for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
            if (dx === 0 && dz === 0) continue;
            const t = tiles.get(`${unit.x + dx},${unit.z + dz}`);
            if (!t) continue;
            if (t.owner === owner) continue;
            if (t.terrain === 'CITY') {
                // Neutral city (no owner) — always capturable.
                if (!t.owner) {
                    if ((t.fortification || 0) <= 0 && !city) city = t;
                    continue;
                }
                // Enemy city — respect peace/trade/alliance.
                if (t.owner && t.owner !== owner) {
                    if (isAtWar && !isAtWar(t.owner)) continue;
                    // Only capture a city that has been breached (fortification 0).
                    if ((t.fortification || 0) <= 0 && !city) city = t;
                }
            }
        }
    }
    return city;
}

/** Find an adjacent enemy (at-war) or neutral city (any fortification level)
 *  for besieging. Neutral cities (owner=null, from eliminated factions) are
 *  valid siege targets so the AI can breach and capture them. */
function findAdjacentEnemyCity(unit, tiles, owner, isAtWar) {
    for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
            if (dx === 0 && dz === 0) continue;
            const t = tiles.get(`${unit.x + dx},${unit.z + dz}`);
            if (!t) continue;
            if (t.terrain === 'CITY' && t.owner !== owner) {
                // Neutral city (no owner) — always a valid target.
                if (!t.owner) return t;
                // Enemy city — respect peace/trade/alliance.
                if (t.owner && t.owner !== owner) {
                    if (isAtWar && !isAtWar(t.owner)) continue;
                    return t;
                }
            }
        }
    }
    return null;
}

/** Pick the best tile for a unit to advance toward: enemy (at-war) cities
 *  first, then neutral cities (from eliminated factions — easy conquest),
 *  then any at-war enemy tile, then nearest unowned tile (expansion). */
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
    // Second pass: neutral cities (owner=null) — easy conquest targets.
    for (const t of tiles.values()) {
        if (!t.owner && t.terrain === 'CITY') {
            const score = 800 - manhattan(unit.x, unit.z, t.x, t.z);
            if (score > bestScore) { bestScore = score; best = t; }
        }
    }
    if (best) return best;
    // Third pass: any at-war enemy-owned tile.
    for (const t of tiles.values()) {
        if (t.owner && t.owner !== owner && (!isAtWar || isAtWar(t.owner))) {
            const score = 500 - manhattan(unit.x, unit.z, t.x, t.z);
            if (score > bestScore) { bestScore = score; best = t; }
        }
    }
    if (best) return best;
    // Fourth pass: nearest unowned tile (expansion toward unsettled land).
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

// ============================================================
// Army-group coordination helpers
// ============================================================

/** Unit roles for group planning. */
const FRAGILE_TYPES = new Set([
    'ARCHER', 'LONGBOWMAN', 'ARTILLERY', 'CATAPULT', 'TREBUCHET',
    'SIEGE', 'MEDIC', 'SETTLER', 'ENGINEER', 'WORKER'
]);
function isFragile(u) { return !!u && FRAGILE_TYPES.has(u.type); }
/** Ranged units fire from a distance (attackRange > 1 or `ranged`). */
function isRanged(u) {
    const d = u && UNIT_TYPE[u.type];
    return !!(d && (d.ranged || (d.attackRange || 0) > 1));
}
/** A "screener": a non-ranged, non-fragile combat unit that leads the advance
 *  and shields fragile units (INFANTRY/PIKEMAN/CAVALRY/CATAPHRACT/SIEGE_TOWER). */
function isScreener(u) {
    const d = u && UNIT_TYPE[u.type];
    return !!d && !d.ranged && !FRAGILE_TYPES.has(u.type);
}

/** Rough combat value of a unit (higher = more worth killing/protecting). */
function unitValue(u) {
    if (!u) return 0;
    const atk = (UNIT_TYPE[u.type] && UNIT_TYPE[u.type].attack) || (u.attack || 0);
    return (u.hp || 1) + atk * 2 + (isFragile(u) ? 6 : 0);
}

/** Predict a combat and decide if attacking is favorable (no real mutation).
 *  Favorable = clean kill; profitable trade (both die but defender worth more);
 *  a free hit (we take 0 damage); or a winning chip (we deal >= 1.5x what we
 *  take). Type advantage is already folded in by resolveCombat's multiplier. */
function isFavorableAttack(attacker, defender, units, tiles, lords, buildings, tempBonuses) {
    if (!attacker || !defender) return false;
    const defTile = tiles.get(`${defender.x},${defender.z}`);
    const terrain = defTile ? defTile.terrain : 'PLAINS';
    const atkLord = findCommandingLord(lords, attacker);
    const defLord = defender._isLord ? null : findCommandingLord(lords, defender);
    const enc = isEncircled(defender, units, tiles);
    const sim = simulateCombat(attacker, defender, terrain, atkLord, defLord, buildings, lords, tempBonuses, enc);
    if (sim.defenderDied && !sim.attackerDied) return true;                 // clean kill
    if (sim.defenderDied && sim.attackerDied) {                              // mutual death
        return unitValue(defender) > unitValue(attacker) + 2;               // profitable trade
    }
    if (!sim.defenderDied && sim.damageToAttacker === 0 && sim.damageToDefender > 0) return true; // free hit
    if (!sim.defenderDied && sim.damageToDefender >= sim.damageToAttacker * 1.5 && sim.damageToDefender > 0) return true; // winning chip
    return false;
}

/** Sum (hp + attack) for friendly vs at-war-enemy units within Chebyshev
 *  `radius` of (x,z). Used to gauge local strength for stance + retreat. */
function localPowerBalance(units, x, z, owner, atWar, isAtWar, radius = 2) {
    let friend = 0, foe = 0;
    for (const u of units.values()) {
        if (Math.max(Math.abs(u.x - x), Math.abs(u.z - z)) > radius) continue;
        const power = (u.hp || 1) + ((UNIT_TYPE[u.type] && UNIT_TYPE[u.type].attack) || (u.attack || 0));
        if (u.owner === owner) friend += power;
        else if (atWar && (!isAtWar || isAtWar(u.owner))) foe += power;
    }
    return { friend, foe };
}

/** Nearest own CITY tile by Manhattan distance (retreat destination). */
function nearestFriendlyCity(unit, tiles, owner) {
    let best = null, bestDist = Infinity;
    for (const t of tiles.values()) {
        if (t.terrain !== 'CITY' || t.owner !== owner) continue;
        const d = manhattan(unit.x, unit.z, t.x, t.z);
        if (d < bestDist) { bestDist = d; best = t; }
    }
    return best;
}

/** Does `attackerType` have a type advantage vs `defenderType`? */
function typeMatch(attackerType, defenderType) {
    return !!(TYPE_ADVANTAGE[attackerType] && TYPE_ADVANTAGE[attackerType].strongAgainst === defenderType);
}

/** Rough proxy for _isInEnemyVision (ai.js can't call the engine method):
 *  true if no at-war enemy unit's vision reaches this tile. Used to gate ambush
 *  concealment so the AI doesn't waste turns trying to conceal in plain sight. */
function isProbablyHidden(u, units, owner, isAtWar) {
    for (const e of units.values()) {
        if (e.owner === owner) continue;
        if (isAtWar && !isAtWar(e.owner)) continue;
        const v = (UNIT_TYPE[e.type] && UNIT_TYPE[e.type].vision) || 3;
        if (Math.max(Math.abs(e.x - u.x), Math.abs(e.z - u.z)) <= v) return false;
    }
    return true;
}

/** True if a tile is near the front: within 6 tiles of an at-war enemy unit or
 *  enemy city. Used to avoid concealing units that are far behind the lines. */
function isNearFront(u, units, tiles, owner, isAtWar) {
    const frontRadius = 6;
    for (const e of units.values()) {
        if (e.owner === owner) continue;
        if (isAtWar && !isAtWar(e.owner)) continue;
        if (Math.max(Math.abs(e.x - u.x), Math.abs(e.z - u.z)) <= frontRadius) return true;
    }
    for (const t of tiles.values()) {
        if (!t.owner || t.owner === owner) continue;
        if (isAtWar && !isAtWar(t.owner)) continue;
        if (t.terrain === 'CITY' && manhattan(u.x, u.z, t.x, t.z) <= frontRadius + 1) return true;
    }
    return false;
}

/** Group military units into army groups: by commanding lord's army first,
 *  then spatially cluster the rest (nearest existing group within Chebyshev 2,
 *  else a new single-unit group). Returns [{ id, lord, units: [...] }]. */
function buildArmyGroups(myUnits, lords, owner) {
    const groups = [];
    const assigned = new Set();
    if (lords && owner) {
        for (const lord of lords) {
            if (lord.owner !== owner) continue;
            const members = myUnits.filter(u => lord.army && lord.army.includes(u.id));
            if (members.length) {
                groups.push({ id: 'lord:' + lord.id, lord, units: members });
                members.forEach(u => assigned.add(u.id));
            }
        }
    }
    const remaining = myUnits.filter(u => !assigned.has(u.id));
    for (const u of remaining) {
        let best = null, bestDist = Infinity;
        for (const g of groups) {
            const c = groupCentroid(g);
            const d = Math.max(Math.abs(c.x - u.x), Math.abs(c.z - u.z));
            if (d <= 2 && d < bestDist) { bestDist = d; best = g; }
        }
        if (best) best.units.push(u);
        else groups.push({ id: 'cluster:' + u.id, lord: null, units: [u] });
    }
    return groups;
}

/** Average position of a group's members (rounded to a tile). */
function groupCentroid(group) {
    let sx = 0, sz = 0;
    for (const u of group.units) { sx += u.x; sz += u.z; }
    const n = group.units.length || 1;
    return { x: Math.round(sx / n), z: Math.round(sz / n) };
}

/** Pick a shared objective tile for the group.
 *  - When retreating: aim at the nearest friendly city.
 *  - When holding with no enemies nearby: seek out the nearest enemy or neutral
 *    city to attack (aggressive posture), or nearest unowned tile for expansion.
 *  - When engaging: use pickTarget's tiering (enemy city > neutral city > enemy tile).
 *  This ensures armies mobilize toward enemy borders instead of staying home. */
function pickGroupObjective(group, tiles, owner, isAtWar, stance) {
    const c = groupCentroid(group);
    
    // Retreat: fall back to nearest friendly city
    if (stance === 'retreat') {
        let best = null, bestDist = Infinity;
        for (const t of tiles.values()) {
            if (t.terrain !== 'CITY' || t.owner !== owner) continue;
            const d = manhattan(c.x, c.z, t.x, t.z);
            if (d < bestDist) { bestDist = d; best = t; }
        }
        if (best) return best;
    }
    
    // Hold or Engage: seek out targets aggressively
    // Priority 1: Nearest enemy city (at-war)
    if (isAtWar) {
        let best = null, bestDist = Infinity;
        for (const t of tiles.values()) {
            if (t.terrain !== 'CITY' || !t.owner || t.owner === owner) continue;
            if (!isAtWar(t.owner)) continue;
            const d = manhattan(c.x, c.z, t.x, t.z);
            if (d < bestDist) { bestDist = d; best = t; }
        }
        if (best) return best;
    }
    
    // Priority 2: Nearest neutral city (unowned, from eliminated factions)
    {
        let best = null, bestDist = Infinity;
        for (const t of tiles.values()) {
            if (t.terrain !== 'CITY' || t.owner) continue; // unowned only
            const d = manhattan(c.x, c.z, t.x, t.z);
            if (d < bestDist) { bestDist = d; best = t; }
        }
        if (best) return best;
    }
    
    // Priority 3: Nearest enemy-owned tile (any)
    if (isAtWar) {
        let best = null, bestDist = Infinity;
        for (const t of tiles.values()) {
            if (!t.owner || t.owner === owner) continue;
            if (!isAtWar(t.owner)) continue;
            const d = manhattan(c.x, c.z, t.x, t.z);
            if (d < bestDist) { bestDist = d; best = t; }
        }
        if (best) return best;
    }
    
    // Priority 4: Nearest unowned tile (expansion)
    {
        let best = null, bestDist = Infinity;
        for (const t of tiles.values()) {
            if (t.owner) continue;
            if (t.terrain === 'WATER' || t.terrain === 'MOUNTAIN') continue;
            const d = manhattan(c.x, c.z, t.x, t.z);
            if (d < bestDist) { bestDist = d; best = t; }
        }
        if (best) return best;
    }
    
    // Fallback: nearest friendly city
    {
        let best = null, bestDist = Infinity;
        for (const t of tiles.values()) {
            if (t.terrain !== 'CITY' || t.owner !== owner) continue;
            const d = manhattan(c.x, c.z, t.x, t.z);
            if (d < bestDist) { bestDist = d; best = t; }
        }
        return best;
    }
}

/** Stance from the local power balance at the group centroid:
 *  `engage` (we match them), `retreat` (outmatched and we have fragile units to
 *  save), else `hold`. When not at war, the group holds/defends. */
function computeStance(group, units, owner, atWar, isAtWar) {
    if (!atWar) return 'hold';
    const c = groupCentroid(group);
    const bal = localPowerBalance(units, c.x, c.z, owner, atWar, isAtWar, 2);
    if (bal.foe <= 0) return 'hold';
    const hasFragile = group.units.some(u => isFragile(u));
    if (bal.friend < bal.foe * 0.6 && hasFragile) return 'retreat';
    if (bal.friend >= bal.foe * 0.8) return 'engage';
    return 'hold';
}

/** Choose one at-war enemy unit for the whole group to focus on / encircle:
 *  must be within Chebyshev 4 of some member; value = low HP + fragile bonus +
 *  bonus if we have a type advantage against it; penalty if it counters a member. */
function chooseGroupTarget(group, units, owner, atWar, isAtWar) {
    if (!atWar) return null;
    let best = null, bestScore = -Infinity;
    for (const e of units.values()) {
        if (e.owner === owner) continue;
        if (e.concealState === 'concealed') continue; // can't see concealed enemies
        if (isAtWar && !isAtWar(e.owner)) continue;
        let near = false;
        for (const m of group.units) {
            if (Math.max(Math.abs(m.x - e.x), Math.abs(m.z - e.z)) <= 4) { near = true; break; }
        }
        if (!near) continue;
        let score = 100 - (e.hp || 0);
        if (isFragile(e)) score += 8;
        if (group.units.some(m => typeMatch(m.type, e.type))) score += 6;  // we can counter it
        // Penalize targets that counter one of our members (dangerous to engage).
        if (group.units.some(m => TYPE_ADVANTAGE[e.type] && TYPE_ADVANTAGE[e.type].strongAgainst === m.type)) score -= 4;
        if (score > bestScore) { bestScore = score; best = e; }
    }
    return best;
}

/** Is a friendly melee (screener) unit strictly closer to the nearest enemy
 *  than `u` is? If so, the screen is in front of `u` and `u` may safely advance. */
function hasScreen(u, units, owner) {
    let nd = Infinity;
    for (const e of units.values()) {
        if (e.owner === owner) continue;
        nd = Math.min(nd, Math.max(Math.abs(e.x - u.x), Math.abs(e.z - u.z)));
    }
    if (nd === Infinity) return true; // no enemies → free to advance
    for (const f of units.values()) {
        if (f.owner !== owner || f.id === u.id) continue;
        if (!isScreener(f)) continue;
        let fd = Infinity;
        for (const e of units.values()) {
            if (e.owner === owner) continue;
            fd = Math.min(fd, Math.max(Math.abs(e.x - f.x), Math.abs(e.z - f.z)));
        }
        if (fd < nd) return true;
    }
    return false;
}

/** Choose a step toward `target` that closes distance AND biases toward a
 *  flank side of the target not yet held by a friendly (to encircle it).
 *  Mirrors stepToward's passability/occupancy rules but re-ranks candidates by
 *  (distance to target, then encirclement flank bonus). */
function flankingStep(unit, target, units, tiles, owner, moved, isAtWar) {
    const range = UNIT_TYPE[unit.type].moveRange || 1;
    const naval = isNaval(unit);
    const candidates = [];
    for (let dx = -range; dx <= range; dx++) {
        for (let dz = -range; dz <= range; dz++) {
            if (dx === 0 && dz === 0) continue;
            if (Math.abs(dx) + Math.abs(dz) > range) continue;
            const nx = unit.x + dx, nz = unit.z + dz, k = `${nx},${nz}`;
            const t = tiles.get(k);
            if (!t) continue;
            if (naval) {
                if (t.terrain !== 'WATER' && t.terrain !== 'RIVER') continue;
            } else {
                if (t.terrain === 'WATER' || (t.terrain === 'RIVER' && !t.bridge)) continue;
            }
            if (moved.has(k)) continue;
            let blocked = false;
            for (const o of units.values()) {
                if (o.id === unit.id) continue;
                if (o.x === nx && o.z === nz) { blocked = true; break; }
            }
            if (blocked) continue;
            if (!naval && t.terrain === 'CITY' && t.owner && t.owner !== owner && (t.fortification || 0) > 0) {
                if (isAtWar && !isAtWar(t.owner)) continue;
                if (!siegeTowerAdjacentTo(t, owner, units)) continue;
            }
            const d = manhattan(nx, nz, target.x, target.z);
            // Flank bonus: tiles orthogonally adjacent to the target on a side
            // with fewer friendly units help encircle it.
            let flank = 0;
            if (Math.abs(nx - target.x) + Math.abs(nz - target.z) === 1) {
                let friendlyAdj = 0;
                for (const o of units.values()) {
                    if (o.owner !== owner) continue;
                    if (Math.abs(o.x - target.x) + Math.abs(o.z - target.z) === 1) friendlyAdj++;
                }
                flank = 10 - friendlyAdj;
            }
            candidates.push({ x: nx, z: nz, d, flank });
        }
    }
    if (!candidates.length) return null;
    candidates.sort((a, b) => (a.d - b.d) || (b.flank - a.flank));
    return candidates[0];
}

/**
 * Plan a coordinated action list for one army group. Steps run in priority
 * order; each unit acts at most once (tracked via `acted`). `moved` tracks
 * tiles claimed this turn to avoid stacking.
 *
 *   1. Retreat: fragile/wounded units that are locally outmatched fall back.
 *   2. Conceal: fragile/ranged units on forest/mountain set up an ambush.
 *   3. Besiege / capture / pillage: strategic city actions (siege units breach,
 *      any unit grabs a breached city, military pillages improvements).
 *   4. Ranged fire: ranged units attack only on favorable terms.
 *   5. Melee engage + encircle: melee units attack the group target when
 *      adjacent and favorable, else flank-step toward it to surround it.
 *   6. Advance: remaining units move toward the objective in formation (melee
 *      screens first; fragile units only advance behind a screen).
 */
function planGroup(group, objective, stance, units, tiles, owner, lords, buildings, tempBonuses, diploState, moved, acted, atWar, isAtWar, res) {
    const out = [];
    const members = group.units.filter(u => !acted.has(u.id));
    if (!members.length) return out;
    const groupTarget = chooseGroupTarget(group, units, owner, atWar, isAtWar);

    // 1) Retreat fragile / wounded units that are locally outmatched.
    if (atWar) {
        for (const u of members) {
            if (acted.has(u.id)) continue;
            const wounded = (u.hp || 0) < (u.maxHp || 1) * 0.5;
            if (!isFragile(u) && !wounded) continue;
            const bal = localPowerBalance(units, u.x, u.z, owner, atWar, isAtWar, 2);
            const threatened = bal.foe > 0 && bal.friend < bal.foe * 0.7;
            if (stance !== 'retreat' && !(threatened && (isFragile(u) || wounded))) continue;
            if (u.hasMovedThisTurn) continue;
            const goal = nearestFriendlyCity(u, tiles, owner);
            if (!goal) continue;
            const step = nextStepToward(tiles, units, u, goal, 200, owner);
            if (step && !moved.has(`${step.x},${step.z}`)) {
                out.push({ type: 'move', unitId: u.id, tx: step.x, tz: step.z });
                acted.add(u.id);
                moved.add(`${step.x},${step.z}`);
            }
        }
    }

    // 2) Cavalry charge: opening strike for adjacent cavalry before any other action.
    if (atWar) {
        for (const u of members) {
            if (acted.has(u.id) || u.hasAttackedThisTurn || u.hasMovedThisTurn) continue;
            if (!CHARGE_UNITS.includes(u.type)) continue;
            if (u.chargeExhausted && u.chargeExhausted > 0) continue;
            let best = null, bestScore = -Infinity;
            for (const e of units.values()) {
                if (e.owner === owner) continue;
                if (isAtWar && !isAtWar(e.owner)) continue;
                if (Math.max(Math.abs(e.x - u.x), Math.abs(e.z - u.z)) > 1) continue;
                if (!isFavorableAttack(u, e, units, tiles, lords, buildings, tempBonuses)) continue;
                let score = unitValue(e);
                if (groupTarget && e.id === groupTarget.id) score += 20;
                if (typeMatch(u.type, e.type)) score += 10;
                if (score > bestScore) { bestScore = score; best = e; }
            }
            if (best) {
                out.push({ type: 'charge', fromId: u.id, toId: best.id });
                acted.add(u.id);
            }
        }
    }

    // 3) Conceal (ambush setup) for any military unit on conceal terrain near
    //    the front, out of enemy vision, with no adjacent enemy to fight.
    if (atWar && (stance === 'hold' || stance === 'engage')) {
        for (const u of members) {
            if (acted.has(u.id) || u.hasMovedThisTurn || u.hasAttackedThisTurn) continue;
            const tile = tiles.get(`${u.x},${u.z}`);
            if (!tile || !CONCEAL_TERRAINS.includes(tile.terrain)) continue;
            const ut = UNIT_TYPE[u.type];
            // Non-combat and dedicated siege units have better things to do.
            if (u.type === 'SETTLER' || u.type === 'WORKER' || (ut && ut.besiege)) continue;
            let adjEnemy = false;
            for (const e of units.values()) {
                if (e.owner === owner) continue;
                if (isAtWar && !isAtWar(e.owner)) continue;
                if (Math.max(Math.abs(e.x - u.x), Math.abs(e.z - u.z)) <= 1) { adjEnemy = true; break; }
            }
            if (adjEnemy) continue;
            if (!isProbablyHidden(u, units, owner, isAtWar)) continue;
            if (!isNearFront(u, units, tiles, owner, isAtWar)) continue;
            out.push({ type: 'conceal', unitId: u.id });
            acted.add(u.id);
        }
    }

    // 4) Besiege / capture / pillage (strategic city + improvement actions).
    if (atWar) {
        for (const u of members) {
            if (acted.has(u.id) || u.hasAttackedThisTurn) continue;
            // Besiege an adjacent fortified enemy city (siege units only).
            if (UNIT_TYPE[u.type] && UNIT_TYPE[u.type].besiege) {
                const ec = findAdjacentEnemyCity(u, tiles, owner, isAtWar);
                if (ec && (ec.fortification || 0) > 0) {
                    out.push({ type: 'besiege', unitId: u.id, tileKey: `${ec.x},${ec.z}` });
                    acted.add(u.id);
                    continue;
                }
            }
            // Capture an adjacent breached enemy city.
            const cap = findAdjacentCapturable(u, tiles, owner, res, isAtWar);
            if (cap) {
                out.push({ type: 'capture', unitId: u.id, tileKey: `${cap.x},${cap.z}` });
                res.gold -= CAPTURE_COST;
                acted.add(u.id);
                continue;
            }
            // Pillage an adjacent enemy improvement (everyone but medics).
            if (u.type !== 'MEDIC') {
                const ptile = findAdjacentPillageable(u, tiles, owner, isAtWar, buildings);
                if (ptile) {
                    out.push({ type: 'pillage', unitId: u.id, tileKey: `${ptile.x},${ptile.z}` });
                    acted.add(u.id);
                }
            }
        }
    }

    // 5) Ranged fire: ranged units attack only on favorable terms. Prefer the
    //    group's focused target, then type-matched targets, then highest value.
    if (atWar) {
        for (const u of members) {
            if (acted.has(u.id) || u.hasAttackedThisTurn) continue;
            if (!isRanged(u)) continue;
            const targets = getAttackTargets(u, units)
                .filter(e => (!isAtWar || isAtWar(e.owner)) && e.concealState !== 'concealed');
            if (!targets.length) continue;
            let best = null, bestScore = -Infinity;
            for (const e of targets) {
                if (!isFavorableAttack(u, e, units, tiles, lords, buildings, tempBonuses)) continue;
                let score = unitValue(e);
                if (groupTarget && e.id === groupTarget.id) score += 20;
                if (typeMatch(u.type, e.type)) score += 10;
                if (score > bestScore) { bestScore = score; best = e; }
            }
            if (best) {
                out.push({ type: 'attack', fromId: u.id, toId: best.id });
                acted.add(u.id);
            }
        }
    }

    // 6) Melee engage + encircle: attack the group target when adjacent and
    //    favorable (in any stance -- a clean kill is always worth taking); only
    //    flank-step toward it to surround it when the group is actually engaging
    //    (holding/retreating units don't close into a stronger enemy).
    if (atWar && groupTarget) {
        for (const u of members) {
            if (acted.has(u.id)) continue;
            const adjacent = Math.max(Math.abs(u.x - groupTarget.x), Math.abs(u.z - groupTarget.z)) <= 1;
            if (adjacent && !u.hasAttackedThisTurn) {
                if (isFavorableAttack(u, groupTarget, units, tiles, lords, buildings, tempBonuses)) {
                    out.push({ type: 'attack', fromId: u.id, toId: groupTarget.id });
                    acted.add(u.id);
                    continue;
                }
            }
            if (stance !== 'engage') continue;       // hold/retreat: don't advance into the enemy
            if (u.hasMovedThisTurn) continue;
            const step = flankingStep(u, groupTarget, units, tiles, owner, moved, isAtWar);
            if (step) {
                out.push({ type: 'move', unitId: u.id, tx: step.x, tz: step.z });
                acted.add(u.id);
                moved.add(`${step.x},${step.z}`);
            }
        }
    }

    // 7) Advance toward the objective in formation. Melee screeners go first;
    //    fragile units only advance if a friendly screen stays in front of them.
    const advance = (u) => {
        if (acted.has(u.id) || u.hasMovedThisTurn) return;
        if (!objective) return;
        if (isFragile(u) && !hasScreen(u, units, owner)) return; // hold behind the screen
        const step = stepToward(u, objective, tiles, owner, units, moved, isAtWar);
        if (step && !moved.has(`${step.x},${step.z}`)) {
            out.push({ type: 'move', unitId: u.id, tx: step.x, tz: step.z });
            acted.add(u.id);
            moved.add(`${step.x},${step.z}`);
        }
    };
    members.filter(u => isScreener(u)).forEach(advance);
    members.filter(u => !isScreener(u)).forEach(advance);

    return out;
}

// ============================================================
// Scout exploration helpers
// ============================================================

/** Find the nearest tile that appears unexplored (not owned by anyone and not
 *  adjacent to any owned tile). This is a heuristic — the AI doesn't have a
 *  true "explored" set, so it uses ownership as a proxy. Tiles far from any
 *  owner are likely unexplored frontier. */
function findNearestUnexploredTile(unit, tiles, owner) {
    let best = null, bestDist = Infinity;
    for (const t of tiles.values()) {
        // Skip owned tiles (we've seen these)
        if (t.owner) continue;
        // Skip water/mountain (can't explore these meaningfully)
        if (t.terrain === 'WATER' || t.terrain === 'MOUNTAIN') continue;
        // Check if this tile is adjacent to any owned tile (if so, it's "known")
        let isKnown = false;
        for (let dx = -1; dx <= 1 && !isKnown; dx++) {
            for (let dz = -1; dz <= 1 && !isKnown; dz++) {
                if (dx === 0 && dz === 0) continue;
                const nt = tiles.get(`${t.x + dx},${t.z + dz}`);
                if (nt && nt.owner) isKnown = true;
            }
        }
        if (isKnown) continue;
        // This tile is unowned and not adjacent to owned — likely unexplored
        const dist = manhattan(unit.x, unit.z, t.x, t.z);
        if (dist < bestDist) { bestDist = dist; best = t; }
    }
    return best;
}

/** Find the nearest enemy-owned tile for a scout to explore. This helps scouts
 *  find enemy cities and gather intelligence on enemy positions. */
function findNearestEnemyTileForScout(unit, tiles, owner, isAtWar) {
    let best = null, bestDist = Infinity;
    for (const t of tiles.values()) {
        if (!t.owner || t.owner === owner) continue;
        if (isAtWar && !isAtWar(t.owner)) continue;
        const dist = manhattan(unit.x, unit.z, t.x, t.z);
        if (dist < bestDist) { bestDist = dist; best = t; }
    }
    return best;
}

// ============================================================
// King safety helpers
// ============================================================

/** Evaluate the safety of the king. Returns { isSafe, nearbyEnemies, nearbyFriends }.
 *  A king is safe if:
 *  - No enemies within Chebyshev 2
 *  - OR has at least 2 friendly units nearby and HP > 50%
 */
function evaluateKingSafety(king, units, owner, isAtWar) {
    let nearbyEnemies = 0;
    let nearbyFriends = 0;
    
    for (const u of units.values()) {
        const dist = Math.max(Math.abs(u.x - king.x), Math.abs(u.z - king.z));
        if (dist > 3) continue;
        
        if (u.owner === owner) {
            if (dist <= 2) nearbyFriends++;
        } else {
            if (isAtWar && isAtWar(u.owner) && dist <= 3) nearbyEnemies++;
        }
    }
    
    // King is safe if no nearby enemies, or if well-protected
    const isSafe = nearbyEnemies === 0 || 
                   (nearbyFriends >= 2 && king.hp > king.maxHp * 0.5);
    
    return { isSafe, nearbyEnemies, nearbyFriends };
}

/** Find a safe tile for the king to retreat to. Prefers:
 *  1. Nearest friendly city with escort
 *  2. Tile with most friendly units nearby
 */
function findSafeTileForKing(king, tiles, units, owner) {
    let best = null, bestScore = -Infinity;
    
    for (const t of tiles.values()) {
        if (t.owner !== owner) continue;
        if (t.terrain === 'WATER' || t.terrain === 'MOUNTAIN' || t.terrain === 'RIVER') continue;
        
        // Count friendly units near this tile
        let friends = 0;
        let enemies = 0;
        for (const u of units.values()) {
            const dist = Math.max(Math.abs(u.x - t.x), Math.abs(u.z - t.z));
            if (dist > 3) continue;
            if (u.owner === owner) friends++;
            else enemies++;
        }
        
        // Score: prefer cities, prefer more friends, prefer fewer enemies
        let score = 0;
        if (t.terrain === 'CITY') score += 50;
        score += friends * 10;
        score -= enemies * 15;
        score -= manhattan(king.x, king.z, t.x, t.z);
        
        if (score > bestScore) { bestScore = score; best = t; }
    }
    
    return best;
}
