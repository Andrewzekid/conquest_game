/** AI decision logic (pure, no engine dependencies) */
import { UNIT_TYPE, CAPTURE_COST, AI_MAX_UNITS, BUILDING_TYPE, TERRAIN, NAVAL_UNITS,
         SIEGE_ENGINES, PILLAGEABLE_BUILDINGS, DIPLOMACY_STATES, SIEGE_TOWER_COST, SIEGE_TOWER_BUILD_RADIUS,
         GRID_SIZE, TYPE_ADVANTAGE, CONCEAL_TERRAINS, CONCEAL_MAX_PER_TILE, CHARGE_UNITS,
         CHARIOT_CHARGE_UNITS, CHARIOT_CHARGE_RANGE, CHARIOT_CHARGE_VULN_TYPES,
         EXTRA_UNITS, STRUCTURE_COST, LORD_RECRUIT_COST, LORD_CLASSES, BRIDGE_COST,
         AI_SETTLER_TARGET, AI_SETTLER_CAP_FACTOR, AI_SETTLER_CAP_BASE, AI_SETTLERS_PER_TURN,
         AI_FRONTIER_BONUS_CLOSE, AI_FRONTIER_BONUS_MID, AI_FRONTIER_BONUS_FAR,
          AI_ENEMY_CITY_PROXIMITY_PENALTY, AI_WEAK_CITY_SNIPE_BONUS, AI_WEAK_CITY_RATIO,
          WEAK_CITY_GARRISON_THRESHOLD, AI_NEUTRAL_RUSH_BONUS, SETTLER_AGGRESSION,
          MARKET_RATES, CITY_LEVEL_UP_COST, CITY_MAX_LEVEL } from './config.js';
import { canAfford, spendCost, getAttackTargets } from './unit.js';
import { getUnitCostFor } from './faction.js';
import { sellAtMarket } from './economy.js';
import { canAttack } from './diplomacy.js';
import { simulateCombat, isEncircled } from './battle.js';
import { nextStepToward } from './path.js';
import { findCommandingLord, assignGovernance, canCommand, assignArmy } from './lords.js';

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
 *   { type: 'recruitLord',    }                      // faction recruits a new lord in its capital
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
export function computeAIActions(units, tiles, resources, owner, buildings, influence, factionDef, diploState, lords = null, tempBonuses = null, structures = null) {
    const actions = [];
    const myUnits = [...units.values()].filter(u => u.owner === owner && !u.boarded);
    let res = { ...resources };
    buildings = buildings || new Map();
    influence = influence || null;
    structures = structures || new Map();
    const roster = (factionDef && factionDef.roster) || ['INFANTRY', 'ARCHER', 'CAVALRY', 'ARTILLERY'];
    // Whether any owned city already has a Siege Workshop (unlocks
    // CATAPULT/TREBUCHET). Computed early so fullRoster can include them and
    // the composition logic can treat siege as trainable.
    let hasSiegeWorkshop = false;
    for (const bs of buildings.values()) {
        if (bs && bs.includes('SIEGE_WORKSHOP')) { hasSiegeWorkshop = true; break; }
    }
    // Every faction can also train the shared EXTRA_UNITS (cavalry, longbowmen,
    // medics, …) — without them most factions never field any cavalry.
    const fullRoster = [...roster, ...EXTRA_UNITS.filter(u => !roster.includes(u)),
        ...(hasSiegeWorkshop ? ['CATAPULT', 'TREBUCHET'].filter(u => !roster.includes(u)) : [])];
    // Whether the faction can train a direct siege unit (roster SIEGE/ARTILLERY
    // or a workshop's CATAPULT/TREBUCHET). Factions with neither — Verdant,
    // Storm — have no trainable siege and must rely on ENGINEER-built Siege
    // Towers; their composition must not chase an unfillable siege role.
    const hasTrainableSiege = roster.some(t => t === 'SIEGE' || t === 'ARTILLERY') || hasSiegeWorkshop;

    /** Only factions at war with `owner` are valid targets. */
    const isAtWar = (other) => !diploState || canAttack(diploState, owner, other);
    const enemies = atWarFactions(diploState, owner);
    const atWar = enemies.length > 0;
    const activeObjectives = detectActiveObjectives(units, tiles, owner, isAtWar);

    const canBuildAt = (t) => !influence || influence.has(`${t.x},${t.z}`);
    const owned = [...tiles.values()].filter(t => t.owner === owner);
    const myCityCount = owned.filter(t => t.terrain === 'CITY').length;
    const hasBarracks = owned.some(t => (buildings.get(`${t.x},${t.z}`) || []).includes('BARRACKS'));
    const trainCount = () => actions.filter(a => a.type === 'train').length;
    const capRoom = () => myUnits.length + trainCount() < AI_MAX_UNITS;

    // `moved` tracks tiles claimed this turn (avoids two units stacking on the
    // same destination); `acted` tracks unit ids that already have an action.
    const moved = new Set();
    const acted = new Set();

    // Landmass labeling (continents/islands separated by WATER). Drives island
    // logic: harbor priority, transport ferrying, settler found-spot filtering.
    const land = computeLandmasses(tiles);
    const firstCity = owned.find(t => t.terrain === 'CITY');
    const homeMass = firstCity ? land.idOf.get(`${firstCity.x},${firstCity.z}`) : null;
    const homeMassSize = homeMass != null ? (land.sizes.get(homeMass) || 0) : 9999;
    const totalLandTiles = [...land.sizes.values()].reduce((a, b) => a + b, 0);
    const isIslandFaction = homeMassSize < 30 || (totalLandTiles > 0 && homeMassSize / totalLandTiles < 0.10);
    // Build a harbor + fleet when the faction needs to cross water to keep
    // expanding. The old `homeMassFull` gate required ZERO settleable tiles, so a
    // conquered-but-not-fully-settled continent (or a small island with a couple
    // of open tiles) never triggered naval expansion and the AI stalled. The
    // relaxed `needsNavalExpansion` fires when there's foreign land to reach AND
    // any of: small island, home landmass nearly full (<3 settleable tiles), or
    // no enemy cities left on the home mass (continent conquered — only water
    // stands between the faction and new land).
    const homeMassFull = homeMass != null && !homeMassHasFoundSpot(tiles, owner, land, homeMass);
    let homeMassSettleable = 0;
    let noEnemyCitiesOnHomeMass = true;
    if (homeMass != null) {
        for (const t of tiles.values()) {
            if (land.idOf.get(`${t.x},${t.z}`) !== homeMass) continue;
            if (canFoundOn(t, owner)) homeMassSettleable++;
            if (noEnemyCitiesOnHomeMass && t.terrain === 'CITY' && t.owner && t.owner !== owner && isAtWar(t.owner)) {
                noEnemyCitiesOnHomeMass = false;
            }
        }
    }
    const foreignMassWithoutCity = homeMassFull && hasForeignLandmassWithoutCity(tiles, owner, land, homeMass);
    const needsNavalExpansion = hasForeignLandmassWithoutCity(tiles, owner, land, homeMass) &&
        (isIslandFaction || homeMassSettleable < 3 || noEnemyCitiesOnHomeMass);

    // 0. CAPTURE FIRST. Any unit already adjacent to a breached (fortification 0)
    //    capturable city takes it NOW — before gold is spent on training or
    //    buildings. Without this, the training spree below drains the treasury
    //    under CAPTURE_COST every turn and the AI breaches cities it can never
    //    afford to take (the "breach but never capture" bug). Capture actions
    //    are emitted first so they execute before any spending.
    const claimedCityKeys = new Set();
    for (const unit of myUnits) {
        if (unit.hasMovedThisTurn) continue;
        const cap = findAdjacentCapturable(unit, tiles, owner, res, isAtWar);
        if (cap && !claimedCityKeys.has(`${cap.x},${cap.z}`)) {
            claimedCityKeys.add(`${cap.x},${cap.z}`);
            actions.push({ type: 'capture', unitId: unit.id, tileKey: `${cap.x},${cap.z}` });
            res = subtractCost(res, { gold: CAPTURE_COST });
            acted.add(unit.id);
        }
    }
    // Keep a gold buffer when a capturable city is within 2 of any unit, so the
    // training loop can't drain the treasury before a unit walks in next turn.
    let captureClose = claimedCityKeys.size > 0;
    if (!captureClose) {
        outer:
        for (const unit of myUnits) {
            for (let dx = -2; dx <= 2; dx++) {
                for (let dz = -2; dz <= 2; dz++) {
                    const t = tiles.get(`${unit.x + dx},${unit.z + dz}`);
                    if (t && t.terrain === 'CITY' && t.owner !== owner && (t.fortification || 0) <= 0 &&
                        (!t.owner || !isAtWar || isAtWar(t.owner))) { captureClose = true; break outer; }
                }
            }
        }
    }

    // 0a. Sell excess resources at market when gold is low. The AI tends to
    //     accumulate wood/iron/food while gold-starving; selling surpluses
    //     funds unit training and city capture.
    if ((res.gold || 0) < 30 && !captureClose) {
        const sales = {};
        for (const r of ['iron', 'wood', 'food']) {
            if (MARKET_RATES[r] && (res[r] || 0) > 50) {
                sales[r] = Math.min(res[r] - 20, 30); // keep 20, sell up to 30
            }
        }
        if (Object.keys(sales).length > 0) sellAtMarket(res, sales);
    }

    // AI lord recruitment: lords multiply army effectiveness. Recruit up to
    // max(3, cityCount) non-king lords so each major army group can have a
    // commander. The gate is just the recruit cost (no extra war-chest buffer)
    // — under the lean economy the old +150 buffer made lords unreachable.
    const nonKingLords = (lords || []).filter(l => l.owner === owner && !l.isKing);
    const lordCap = Math.max(3, myCityCount);
    if (nonKingLords.length < lordCap && res.gold >= LORD_RECRUIT_COST.gold &&
        res.food >= LORD_RECRUIT_COST.food && myCityCount > 0) {
        actions.push({ type: 'recruitLord' });
        res = subtractCost(res, LORD_RECRUIT_COST);
    }

    // Lord assignment: idle non-king lords first try to pick up nearby idle
    // military units so they lead an army; only Administrator-style lords with
    // no available units govern the capital.
    const lordsList = (lords || []).filter(l => l.owner === owner);
    const capital = owned.find(t => t.terrain === 'CITY' && t.isCapital);
    const bestCity = capital || owned.find(t => t.terrain === 'CITY' && t.cityLevel > 1) || owned.find(t => t.terrain === 'CITY');
    for (const lord of lordsList) {
        if (lord.isKing || lord.governingCity) continue; // already governing or is king
        if (!lord.army || lord.army.length === 0) {
            // Try to build an army from nearby idle military units.
            let nearby = myUnits.filter(u =>
                u.type !== 'SETTLER' && u.type !== 'WORKER' && u.type !== 'SCOUT' && !isNaval(u) &&
                !u.lordId && manhattan(u.x, u.z, lord.x, lord.z) <= 6);
            // If nothing is nearby, claim the nearest unassigned military
            // cluster anywhere on the map so front-line groups (which form far
            // from the capital where lords spawn) also get a commander.
            // assignArmy has no position requirement, and the "keep lords with
            // their army" logic later walks the lord out to its new army.
            if (nearby.length === 0) {
                const unassigned = myUnits.filter(u =>
                    u.type !== 'SETTLER' && u.type !== 'WORKER' && u.type !== 'SCOUT' &&
                    !isNaval(u) && !u.lordId);
                if (unassigned.length > 0) {
                    unassigned.sort((a, b) =>
                        manhattan(a.x, a.z, lord.x, lord.z) - manhattan(b.x, b.z, lord.x, lord.z));
                    const seed = unassigned[0];
                    nearby = unassigned
                        .filter(u => manhattan(u.x, u.z, seed.x, seed.z) <= 4)
                        .sort((a, b) => manhattan(a.x, a.z, seed.x, seed.z) -
                                       manhattan(b.x, b.z, seed.x, seed.z));
                }
            } else {
                nearby.sort((a, b) => manhattan(a.x, a.z, lord.x, lord.z) -
                                      manhattan(b.x, b.z, lord.x, lord.z));
            }
            for (const u of nearby) {
                if (!canCommand(lord)) break;
                assignArmy(lord, u.id);
                u.lordId = lord.id;
            }
            // Only govern if this lord has no combat aptitude and no army.
            if ((!lord.army || lord.army.length === 0) && bestCity) {
                const cls = LORD_CLASSES[lord.class] || {};
                const bonus = cls.bonus || {};
                if ((bonus.attack || 0) === 0 && (bonus.defense || 0) === 0 && (bonus.siege || 0) === 0) {
                    assignGovernance(lord, `${bestCity.x},${bestCity.z}`);
                }
            }
        }
    }

    // 0ab. Engineer bridges. Rivers are impassable without a bridge, so an
    //      engineer adjacent to an unbridged river that blocks the path to its
    //      objective (nearest at-war enemy city) builds a bridge now — BEFORE
    //      the unit-training spree drains the treasury. The cost is reserved
    //      (subtracted from `res`) so later spending can't starve it. This is
    //      the AI's only way across rivers; without it engineers stop at the
    //      bank and armies never reach enemy cities across water.
    for (const unit of myUnits) {
        if (unit.type !== 'ENGINEER' || unit.hasAttackedThisTurn) continue;
        if (!canAffordCost(res, BRIDGE_COST)) break; // out of funds — stop trying
        const river = findBridgeTarget(unit, tiles, owner, isAtWar, atWar);
        if (river) {
            actions.push({ type: 'buildBridge', unitId: unit.id, tileKey: `${river.x},${river.z}` });
            res = subtractCost(res, BRIDGE_COST);
            acted.add(unit.id);
        }
    }

    // 0h. Harbor first for factions that need to cross water (small island, or
    //     home landmass full/conquered with foreign land awaiting). Ships are the
    //     only way to new land, so this takes priority over Barracks. Runs before
    //     any spending spree; if it can't afford the harbor yet, reserve the cost
    //     so later spending this turn doesn't push it further out of reach.
    //     `queuedHarbors` tracks harbor builds queued this turn so the ship
    //     training block (2d) can launch units the same turn the harbor goes up.
    const queuedHarbors = new Set();
    {
        const hasHarbor = owned.some(t => (buildings.get(`${t.x},${t.z}`) || []).includes('HARBOR'));
        if (!hasHarbor && (isIslandFaction || needsNavalExpansion)) {
            const coastal = owned.find(t => t.terrain === 'CITY' && canBuildAt(t) &&
                !(buildings.get(`${t.x},${t.z}`) || []).includes('HARBOR') && isCoastalCity(t, tiles));
            if (coastal) {
                if (canAffordBuilding('HARBOR', res)) {
                    actions.push({ type: 'build', buildingType: 'HARBOR', tileKey: `${coastal.x},${coastal.z}` });
                    res = payBuilding('HARBOR', res);
                    queuedHarbors.add(`${coastal.x},${coastal.z}`);
                } else {
                    // Reserve funds so the spending spree below can't starve the harbor.
                    res = subtractCost(res, BUILDING_TYPE.HARBOR.cost);
                }
            }
        }
    }

    // 1. Build a Barracks first (unlocks production + veteran training).
    //     EXCEPTION: a faction with no trainable siege (no roster SIEGE/ARTILLERY
    //     and no Siege Workshop) that is at war MUST get a Siege Workshop first —
    //     without it (or engineers) it can never breach a fortified city and will
    //     fall back to cavalry spam. Build the workshop before Barracks in that
    //     case, and reserve its cost so the spending spree can't starve it.
    const needsSiegeWorkshopFirst = atWar && !hasTrainableSiege && !hasSiegeWorkshop && myCityCount >= 1;
    if (needsSiegeWorkshopFirst) {
        const city = owned.find(t => t.terrain === 'CITY' && canBuildAt(t) &&
            !(buildings.get(`${t.x},${t.z}`) || []).includes('SIEGE_WORKSHOP'));
        if (city) {
            const swCost = BUILDING_TYPE.SIEGE_WORKSHOP.cost;
            if (canAffordBuilding('SIEGE_WORKSHOP', res)) {
                actions.push({ type: 'build', buildingType: 'SIEGE_WORKSHOP', tileKey: `${city.x},${city.z}` });
                res = payBuilding('SIEGE_WORKSHOP', res);
            } else {
                // Can't afford yet — reserve the funds so later spending this
                // turn doesn't push the workshop further out of reach.
                res = subtractCost(res, swCost);
            }
        }
    }

    if (!hasBarracks && !needsSiegeWorkshopFirst) {
        const city = owned.find(t => t.terrain === 'CITY' && canBuildAt(t) &&
            !(buildings.get(`${t.x},${t.z}`) || []).includes('BARRACKS'));
        if (city && canAffordBuilding('BARRACKS', res)) {
            actions.push({ type: 'build', buildingType: 'BARRACKS', tileKey: `${city.x},${city.z}` });
            res = payBuilding('BARRACKS', res);
        }
    }

    // 1a. Build a Siege Workshop in a city (unlocks CATAPULT/TREBUCHET —
    //     long-range AOE siege). One is enough. AI builds this proactively (not
    //     just when at war) to prepare for future conflicts. (When at war and
    //     lacking siege it was already built above, before Barracks.)
    if (!hasSiegeWorkshop && myCityCount >= 1 && !needsSiegeWorkshopFirst) {
        const city = owned.find(t => t.terrain === 'CITY' && canBuildAt(t) &&
            !(buildings.get(`${t.x},${t.z}`) || []).includes('SIEGE_WORKSHOP'));
        if (city && canAffordBuilding('SIEGE_WORKSHOP', res)) {
            actions.push({ type: 'build', buildingType: 'SIEGE_WORKSHOP', tileKey: `${city.x},${city.z}` });
            res = payBuilding('SIEGE_WORKSHOP', res);
        }
    }

    // 1ab. WALLS in border cities. AI cities are defenseless without them.
    //      Build walls in any city within 6 tiles of an enemy city.
    if (myCityCount > 0) {
        for (const t of owned) {
            if (t.terrain !== 'CITY' || !canBuildAt(t)) continue;
            if ((buildings.get(`${t.x},${t.z}`) || []).includes('WALLS')) continue;
            // Check if within 6 tiles of an enemy city
            let nearEnemy = false;
            for (const o of tiles.values()) {
                if (o.terrain === 'CITY' && o.owner && o.owner !== owner &&
                    Math.abs(o.x - t.x) + Math.abs(o.z - t.z) <= 6) { nearEnemy = true; break; }
            }
            if (nearEnemy && canAffordBuilding('WALLS', res)) {
                actions.push({ type: 'build', buildingType: 'WALLS', tileKey: `${t.x},${t.z}` });
                res = payBuilding('WALLS', res);
                break; // one wall per turn
            }
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
    // Count siege capability: direct siege engines AND engineer-built Siege
    // Towers AND the ENGINEERs that build them. Factions with no roster siege
    // (Verdant, Storm) rely on engineers/towers, so counting them here keeps
    // the siege cap aware of that path and stops it over-demanding siege (which
    // otherwise falls through to cavalry spam).
    const siegeCount = myUnits.filter(u => u.type === 'SIEGE' || u.type === 'ARTILLERY' ||
        u.type === 'CATAPULT' || u.type === 'TREBUCHET' ||
        u.type === 'SIEGE_TOWER' || u.type === 'ENGINEER').length;
    const engineerCount = myUnits.filter(u => u.type === 'ENGINEER').length;
    const siegeOptions = roster.filter(t => t === 'SIEGE' || t === 'ARTILLERY');
    if (hasSiegeWorkshop) siegeOptions.push('CATAPULT', 'TREBUCHET');
    // Composition-aware siege cap: the siege ratio depends on the army's
    // current objective. A faction actively besieging an enemy city fields far
    // more siege (~40%); a decisive field battle or home defense wants fewer
    // siege engines (~10-12%); otherwise a baseline ~15%.
    const siegeRatio = activeObjectives.siege ? 0.40
        : activeObjectives.decisive ? 0.10
        : activeObjectives.defensive ? 0.12
        : 0.15;
    const siegeCap = Math.max(activeObjectives.siege ? 4 : 2,
        Math.round(AI_MAX_UNITS * siegeRatio));
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
    } else if (!siegeOptions.length && engineerCount < 1) {
        // No direct siege in roster -> engineers are the siege path (towers).
        const ec = getUnitCostFor('ENGINEER', factionDef);
        if (capRoom() && canAfford('ENGINEER', res, ec)) {
            const spawnTile = findOwnedTile(myUnits, tiles, actions, owner);
            if (spawnTile) {
                actions.push({ type: 'train', unitType: 'ENGINEER', tileKey: `${spawnTile.x},${spawnTile.z}` });
                res = spendCost('ENGINEER', res, ec);
            }
        }
    }

    // 1c. ENGINEERS. Every faction keeps engineers on hand: they build Siege
    //     Towers against enemy cities and defensive structures (traps,
    //     fortifications) at home. The cap scales with city count so expanded
    //     territory gets fortified quickly, and rises further while at war so
    //     tower production keeps pace with conquest. Factions with no trainable
    //     siege (Verdant, Storm) rely on engineers/towers as their ONLY siege
    //     path, so they keep a larger engineer corps at war.
    {
        const engCap = Math.max(atWar ? (hasTrainableSiege ? 3 : 5) : 1, Math.ceil(myCityCount / 3));
        const engNow = myUnits.filter(u => u.type === 'ENGINEER').length +
            actions.filter(a => a.type === 'train' && a.unitType === 'ENGINEER').length;
        if (engNow < engCap && capRoom()) {
            const ec = getUnitCostFor('ENGINEER', factionDef);
            if (canAfford('ENGINEER', res, ec)) {
                const spawnTile = findOwnedTile(myUnits, tiles, actions, owner);
                if (spawnTile) {
                    actions.push({ type: 'train', unitType: 'ENGINEER', tileKey: `${spawnTile.x},${spawnTile.z}` });
                    res = spendCost('ENGINEER', res, ec);
                }
            }
        }
    }

    // 1d. HARBOR fallback. The early build (0h) already handles island/expand-
    //     needed factions before the spending spree. This catches the general
    //     case: a faction with a couple of cities or a Barracks that can afford a
    //     harbor for coastal defense / future naval use. Also covers
    //     needsNavalExpansion if 0h couldn't find a coastal city at the time.
    {
        const hasHarbor = owned.some(t => (buildings.get(`${t.x},${t.z}`) || []).includes('HARBOR'));
        if (!hasHarbor) {
            const coastal = owned.find(t => t.terrain === 'CITY' && canBuildAt(t) &&
                !(buildings.get(`${t.x},${t.z}`) || []).includes('HARBOR') && isCoastalCity(t, tiles));
            if (coastal && canAffordBuilding('HARBOR', res) &&
                (isIslandFaction || needsNavalExpansion || myCityCount >= 2 || hasBarracks)) {
                actions.push({ type: 'build', buildingType: 'HARBOR', tileKey: `${coastal.x},${coastal.z}` });
                res = payBuilding('HARBOR', res);
                queuedHarbors.add(`${coastal.x},${coastal.z}`);
            }
        }
    }

    // 2. Civ6-style aggressive expansion: train settlers aggressively to
    //     claim territory. Caps are scaled by map size and existing cities, and
    //     by the global SETTLER_AGGRESSION multiplier (data-driven tuning).
    //     When the faction is short on key resources (gold/wood/iron/food),
    //     expansion is the only durable fix, so settler priority is boosted:
    //     higher target/cap/per-turn and a relaxed defensive floor.
    const stock = res || {};
    const scarce = ((stock.gold || 0) < 50 ? 1 : 0) + ((stock.wood || 0) < 40 ? 1 : 0) +
        ((stock.iron || 0) < 30 ? 1 : 0) + ((stock.food || 0) < 40 ? 1 : 0);
    const settlerUrgency = scarce >= 2 ? 2.0 : scarce >= 1 ? 1.5 : 1.0;
    const settlerTarget = Math.round(Math.max(AI_SETTLER_TARGET, Math.round(GRID_SIZE / 3)) * SETTLER_AGGRESSION * settlerUrgency);
    const settlerCap = Math.max(1, Math.round((Math.ceil(myCityCount * AI_SETTLER_CAP_FACTOR) + AI_SETTLER_CAP_BASE) * SETTLER_AGGRESSION * settlerUrgency));
    const settlersPerTurn = Math.max(1, Math.round(AI_SETTLERS_PER_TURN * SETTLER_AGGRESSION * settlerUrgency));
    let queuedSettlers = 0;
    while (queuedSettlers < settlersPerTurn && myCityCount < settlerTarget && capRoom() && roster.includes('SETTLER')) {
        const liveSettlers = myUnits.filter(u => u.type === 'SETTLER').length;
        if (liveSettlers + queuedSettlers >= settlerCap) break;
        // A second queued settler requires a defensive floor so the army isn't
        // stripped. The floor is relaxed when resources are scarce (urgency >
        // 1) — claiming resource terrain is worth a slightly thinner garrison.
        if (queuedSettlers > 0) {
            const meleeCount = myUnits.filter(u => u.type === 'INFANTRY' || u.type === 'PIKEMAN').length;
            const militaryCount = myUnits.filter(u => u.type !== 'SETTLER' && u.type !== 'WORKER' && u.type !== 'SCOUT').length;
            const floor = settlerUrgency > 1 ? 2 : 3;
            if (militaryCount < floor || meleeCount < 1) break;
        }
        const spawnTile = findOwnedTile(myUnits, tiles, actions, owner);
        if (!spawnTile || !canAfford('SETTLER', res, getUnitCostFor('SETTLER', factionDef))) break;
        actions.push({ type: 'train', unitType: 'SETTLER', tileKey: `${spawnTile.x},${spawnTile.z}` });
        res = spendCost('SETTLER', res, getUnitCostFor('SETTLER', factionDef));
        queuedSettlers++;
    }

    // 2b. SCOUT TRAINING. Train a small number of scouts (1-2 max) for exploration.
    //     Only train scouts if we already have a solid military presence (4+ units).
    //     This prevents overproduction of scouts at the expense of army.
    const scoutCount = myUnits.filter(u => u.type === 'SCOUT').length;
    const militaryCount = myUnits.filter(u => u.type !== 'SCOUT' && u.type !== 'SETTLER' && u.type !== 'WORKER').length;
    const scoutCap = 2; // Hard cap at 2 scouts
    if (scoutCount < scoutCap && militaryCount >= 4 && capRoom() && roster.includes('SCOUT')) {
        const scoutCost = getUnitCostFor('SCOUT', factionDef);
        if (canAfford('SCOUT', res, scoutCost)) {
            const spawnTile = findOwnedTile(myUnits, tiles, actions, owner);
            if (spawnTile) {
                actions.push({ type: 'train', unitType: 'SCOUT', tileKey: `${spawnTile.x},${spawnTile.z}` });
                res = spendCost('SCOUT', res, scoutCost);
            }
        }
    }

    // 2c. SHIPS. With a Harbor, field a small fleet: island factions need a
    //     Transport first (their only way to settle new landmasses), then
    //     warships. Continental factions keep at most a couple of warships unless
    //     they need to expand overseas, in which case they also need transports.
    //     Runs BEFORE the land-unit training loop so the army doesn't fill
    //     AI_MAX_UNITS first and starve the cap room ships need (the previous
    //     "ships never train" bug). A harbor queued this turn (0h/1d) counts as
    //     present so ships can launch the same turn the harbor goes up.
    {
        const harborCity = owned.find(t => t.terrain === 'CITY' &&
            ((buildings.get(`${t.x},${t.z}`) || []).includes('HARBOR') || queuedHarbors.has(`${t.x},${t.z}`)));
        if (harborCity && capRoom()) {
            const navalNow = myUnits.filter(u => isNaval(u)).length +
                actions.filter(a => a.type === 'train' && NAVAL_UNITS.includes(a.unitType)).length;
            const needsExpansionFleet = isIslandFaction || needsNavalExpansion;
            const navalCap = needsExpansionFleet ? 6 : 2;
            if (navalNow < navalCap && !(captureClose && (res.gold || 0) < CAPTURE_COST + 20)) {
                const transportCount = myUnits.filter(u => u.type === 'TRANSPORT').length +
                    actions.filter(a => a.type === 'train' && a.unitType === 'TRANSPORT').length;
                const waitingSettlers = myUnits.filter(u => u.type === 'SETTLER' &&
                    !findFoundSpot(u, tiles, owner, land, land.idOf.get(`${u.x},${u.z}`), units)).length;
                const needsMoreTransports = needsExpansionFleet && transportCount < 2 + waitingSettlers;
                let pick = 'GALLEY';
                if (needsExpansionFleet && transportCount === 0) pick = 'TRANSPORT';
                else if (needsMoreTransports && Math.random() < 0.7) pick = 'TRANSPORT';
                const pc = getUnitCostFor(pick, factionDef);
                if (canAfford(pick, res, pc)) {
                    actions.push({ type: 'train', unitType: pick, tileKey: `${harborCity.x},${harborCity.z}` });
                    res = spendCost(pick, res, pc);
                }
            }
        }
    }

    // 2d. Train land units from this faction's roster if affordable and below
    //     cap. Keeps a gold buffer when a capture is imminent so the walk-in
    //     capture isn't starved (see step 0). Runs after ships so a small fleet
    //     is guaranteed room before the army fills the cap.
    while (myUnits.length + trainCount() < AI_MAX_UNITS) {
        if (captureClose && (res.gold || 0) < CAPTURE_COST + 20) break;
        const trainable = findAffordableUnit(res, fullRoster, factionDef, myUnits, actions, owner, activeObjectives);
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

    // 3b. City level-up investment: when food surplus is healthy, spend resources
    //     to grow a city a level (bigger influence radius, higher fort cap, more
    //     worked tiles). One per turn so the treasury isn't emptied. Prioritize
    //     the highest-level city first (cheapest relative returns are already
    //     mature cities that benefit most from the radius bump).
    if ((res.food || 0) > 5) {
        const cities = owned.filter(t => t.terrain === 'CITY')
            .filter(t => (t.cityLevel || 1) < CITY_MAX_LEVEL)
            .sort((a, b) => (b.cityLevel || 1) - (a.cityLevel || 1));
        for (const t of cities) {
            if (actions.some(a => a.type === 'levelUpCity')) break;
            const lvl = t.cityLevel || 1;
            const cost = {
                gold: CITY_LEVEL_UP_COST.gold * lvl,
                food: CITY_LEVEL_UP_COST.food * lvl,
                production: CITY_LEVEL_UP_COST.production * lvl
            };
            if ((res.gold || 0) >= cost.gold && (res.food || 0) >= cost.food &&
                (res.production || 0) >= cost.production) {
                actions.push({ type: 'levelUpCity', tileKey: `${t.x},${t.z}` });
                res = { ...res, gold: res.gold - cost.gold, food: res.food - cost.food,
                        production: (res.production || 0) - cost.production };
            }
        }
    }

    // 4. Per-unit support actions: settlers found/move, workers build/move,
    //    engineers build siege towers & structures, siege towers beeline to
    //    their target city, scouts explore, ships sail. Military units are NOT
    //    handled here — they go through army-group coordination (step 5) so
    //    they fight as a coordinated group rather than each picking targets
    //    independently. (`moved`/`acted` were declared at the top, before the
    //    capture-first pre-pass.)

    for (const unit of myUnits) {
        // a) Settlers found a city where they stand (if valid) or head toward
        //    a found spot ON THEIR OWN LANDMASS. If the home landmass is full,
        //    they wait at the shore for a Transport to ferry them elsewhere.
        if (unit.type === 'SETTLER') {
            const here = tiles.get(`${unit.x},${unit.z}`);
            if (here && canFoundOn(here, owner)) {
                actions.push({ type: 'foundCity', unitId: unit.id, tileKey: `${here.x},${here.z}` });
                acted.add(unit.id);
                continue;
            }
            const myMass = land.idOf.get(`${unit.x},${unit.z}`);
            const spot = findFoundSpot(unit, tiles, owner, land, myMass, units, factionDef, res);
            if (spot) {
                // Settler escort: if a non-settler military unit is within 5
                // tiles and idle, make it follow the settler toward the spot.
                const escort = myUnits.find(u2 =>
                    u2.type !== 'SETTLER' && u2.type !== 'WORKER' && u2.type !== 'SCOUT' &&
                    !acted.has(u2.id) && !u2.hasMovedThisTurn &&
                    Math.abs(u2.x - unit.x) + Math.abs(u2.z - unit.z) <= 5);
                if (escort) {
                    const escStep = stepToward(escort, spot, tiles, owner, units, moved, isAtWar);
                    if (escStep && !moved.has(`${escStep.x},${escStep.z}`) &&
                        (escStep.x !== escort.x || escStep.z !== escort.z)) {
                        actions.push({ type: 'move', unitId: escort.id, tx: escStep.x, tz: escStep.z });
                        moved.add(`${escStep.x},${escStep.z}`);
                        acted.add(escort.id);
                    }
                }
                const step = stepToward(unit, spot, tiles, owner, units, moved, isAtWar);
                if (step) {
                    actions.push({ type: 'move', unitId: unit.id, tx: step.x, tz: step.z });
                    moved.add(`${step.x},${step.z}`);
                    acted.add(unit.id);
                    continue;
                }
            }
            // No land-reachable found spot: try to leave the landmass by sea.
            // Board an adjacent friendly Transport with free capacity…
            const tr = adjacentTransport(unit, units, owner);
            if (tr) {
                actions.push({ type: 'board', unitId: unit.id, transportId: tr.id });
                acted.add(unit.id);
                continue;
            }
            // …otherwise wait at the nearest shore tile for pickup.
            const shore = nearestShoreTile(unit, tiles, land, myMass);
            if (shore && (shore.x !== unit.x || shore.z !== unit.z) && !unit.hasMovedThisTurn) {
                const step = stepToward(unit, shore, tiles, owner, units, moved, isAtWar);
                if (step) {
                    actions.push({ type: 'move', unitId: unit.id, tx: step.x, tz: step.z });
                    moved.add(`${step.x},${step.z}`);
                }
            }
            acted.add(unit.id); // nowhere to settle on this landmass — wait for a ship.
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
            const spot = findImprovementSpot(unit, tiles, owner, buildings, influence, res);
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

        // a2) Engineers. Offense: build a Siege Tower when within range of an
        //     at-war enemy city (and step toward one when out of range).
        //     Defense: when an own city is threatened (enemy units closing
        //     in), build traps/fortifications on owned tiles around it.
        if (unit.type === 'ENGINEER' && !unit.hasAttackedThisTurn) {
            if (atWar) {
                const target = findEnemyCityWithin(unit, tiles, owner, isAtWar, SIEGE_TOWER_BUILD_RADIUS);
                if (target && canAffordCost(res, SIEGE_TOWER_COST)) {
                    actions.push({ type: 'buildSiegeTower', unitId: unit.id, tileKey: `${target.x},${target.z}` });
                    res = subtractCost(res, SIEGE_TOWER_COST);
                    acted.add(unit.id);
                    continue;
                }
            }
            // Defensive structures: fortify the approach to a threatened city.
            const homeCity = nearestFriendlyCity(unit, tiles, owner);
            const threat = homeCity ? cityThreatLevel(homeCity, units, tiles, owner, isAtWar) : null;
            if (homeCity && threat && threat.enemies > 0) {
                const distCity = manhattan(unit.x, unit.z, homeCity.x, homeCity.z);
                const here = tiles.get(`${unit.x},${unit.z}`);
                const canSite = here && here.owner === owner &&
                    here.terrain !== 'CITY' && here.terrain !== 'WATER' && here.terrain !== 'RIVER' &&
                    !structures.has(`${unit.x},${unit.z}`) &&
                    (!influence || influence.has(`${unit.x},${unit.z}`));
                if (canSite && distCity >= 1 && distCity <= 3) {
                    // Inner ring (adjacent to the city): fortify the defenders.
                    // Outer ring: traps — spikes if the enemy brings cavalry,
                    // fall traps otherwise.
                    let sType;
                    if (distCity === 1) sType = 'FORTIFICATION';
                    else sType = threat.cavalry >= 2 ? 'SPIKES' : 'FALL_TRAP';
                    const sCost = STRUCTURE_COST[sType] || {};
                    if (canAffordCost(res, sCost)) {
                        actions.push({ type: 'buildStructure', unitId: unit.id, structureType: sType });
                        res = subtractCost(res, sCost);
                        acted.add(unit.id);
                        continue;
                    }
                }
                // Not in position yet — hurry toward the threatened city.
                if (distCity > 3 && !unit.hasMovedThisTurn) {
                    const step = stepToward(unit, homeCity, tiles, owner, units, moved, isAtWar);
                    if (step) {
                        actions.push({ type: 'move', unitId: unit.id, tx: step.x, tz: step.z });
                        moved.add(`${step.x},${step.z}`);
                        acted.add(unit.id);
                        continue;
                    }
                }
            }
            // a2c) Bridge-building is handled in the early pre-pass (step 0ab)
            //     so the cost is reserved before the unit-training spree drains
            //     the treasury. An engineer already bridged this turn is in
            //     `acted` and skips the offense move below.

            // Offense move: no threatened home — step toward the nearest enemy
            // city so the engineer can build towers on subsequent turns.
            if (atWar) {
                const nearest = findNearestEnemyCity(unit, tiles, owner, isAtWar);
                if (nearest && !unit.hasMovedThisTurn) {
                    const step = stepToward(unit, nearest, tiles, owner, units, moved, isAtWar);
                    if (step) {
                        actions.push({ type: 'move', unitId: unit.id, tx: step.x, tz: step.z });
                        moved.add(`${step.x},${step.z}`);
                        acted.add(unit.id);
                        continue;
                    }
                }
            }
        }

        // a2b) Siege Towers beeline to the nearest fortified non-friendly city
        //      and besiege it. Without this they drift with their army group's
        //      objective and mill around near (but never adjacent to) the city
        //      they were built to crack. Neutral cities count — a tower is how
        //      the AI cracks unclaimed fortified cities at peace.
        if (unit.type === 'SIEGE_TOWER') {
            const ec = findAdjacentEnemyCity(unit, tiles, owner, isAtWar);
            if (ec && (ec.fortification || 0) > 0) {
                actions.push({ type: 'besiege', unitId: unit.id, tileKey: `${ec.x},${ec.z}` });
                acted.add(unit.id);
                continue;
            }
            const target = findNearestBesiegeableCity(unit, tiles, owner, isAtWar);
            if (target) {
                if (!unit.hasMovedThisTurn) {
                    const step = stepToward(unit, target, tiles, owner, units, moved, isAtWar);
                    if (step) {
                        actions.push({ type: 'move', unitId: unit.id, tx: step.x, tz: step.z });
                        moved.add(`${step.x},${step.z}`);
                    }
                }
                acted.add(unit.id);
                continue;
            }
            // No besiegeable city anywhere — fall through to the army groups.
        }

        // a3) Scouts explore: move toward unexplored tiles or enemy territory.
        //     Scouts are the AI's eyes — they reveal the map and find enemy
        //     cities for the army to target. Prioritize unexplored areas, then
        //     enemy-owned tiles to gather intelligence.
        if (unit.type === 'SCOUT' && !unit.hasAttackedThisTurn) {
            // Priority 1: Find nearest unexplored tile (tiles not owned by anyone
            // and not adjacent to any owned tile — likely unexplored frontier).
            // Scouts spread out: tiles already near another scout are skipped.
            const unexploredTarget = findNearestUnexploredTile(unit, tiles, owner, units);
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

        // a4) Ships. Transports ferry waiting settlers to settleable land on
        //     other landmasses; warships hunt enemy ships, besiege coastal
        //     cities, and scout foreign shores. Naval units never join the
        //     land army groups.
        if (isNaval(unit)) {
            if (unit.type === 'TRANSPORT') {
                if ((unit.cargo || []).length > 0) {
                    const cargoIds = unit.cargo || [];
                    const hasSettler = cargoIds.some(id => {
                        const cu = units.get(id);
                        return cu && cu.type === 'SETTLER';
                    });
                    const hasMilitary = !hasSettler && cargoIds.some(id => {
                        const cu = units.get(id);
                        return cu && cu.type !== 'SETTLER' && cu.type !== 'WORKER' && !isNaval(cu);
                    });
                    if (hasSettler) {
                        // Settler cargo: sail to a foundable spot on a fresh landmass.
                        const dest = nearestFoundableBySea(unit, tiles, owner, land);
                        if (dest && Math.abs(unit.x - dest.x) + Math.abs(unit.z - dest.z) === 1) {
                            actions.push({ type: 'disembark', unitId: unit.id });
                        } else if (dest && !unit.hasMovedThisTurn) {
                            const step = stepToward(unit, dest, tiles, owner, units, moved, isAtWar);
                            if (step) {
                                actions.push({ type: 'move', unitId: unit.id, tx: step.x, tz: step.z });
                                moved.add(`${step.x},${step.z}`);
                            }
                        }
                    } else if (hasMilitary && atWar) {
                        // Military cargo: sail to the nearest enemy coastal city for amphibious assault.
                        const dest = nearestEnemyCoastalCity(unit, tiles, owner, isAtWar);
                        if (dest && Math.abs(unit.x - dest.x) + Math.abs(unit.z - dest.z) === 1) {
                            actions.push({ type: 'disembark', unitId: unit.id });
                        } else if (dest && !unit.hasMovedThisTurn) {
                            const step = stepToward(unit, dest, tiles, owner, units, moved, isAtWar);
                            if (step) {
                                actions.push({ type: 'move', unitId: unit.id, tx: step.x, tz: step.z });
                                moved.add(`${step.x},${step.z}`);
                            }
                        }
                    } else {
                        // Fallback: scout a foreign landmass.
                        const dest = nearestForeignLandmass(unit, tiles, owner, land);
                        if (dest && !unit.hasMovedThisTurn) {
                            const step = stepToward(unit, dest, tiles, owner, units, moved, isAtWar);
                            if (step) {
                                actions.push({ type: 'move', unitId: unit.id, tx: step.x, tz: step.z });
                                moved.add(`${step.x},${step.z}`);
                            }
                        }
                    }
                    // 6a — Naval escort: if no friendly warship is within 3 tiles,
                    // assign the nearest idle warship (within 8 tiles) to follow.
                    {
                        const closeWarship = [...units.values()].some(u =>
                            u.owner === owner && u.type !== 'TRANSPORT' && isNaval(u) &&
                            Math.abs(u.x - unit.x) + Math.abs(u.z - unit.z) <= 3);
                        if (!closeWarship) {
                            const escort = [...units.values()].find(u =>
                                u.owner === owner && u.type !== 'TRANSPORT' && isNaval(u) &&
                                !acted.has(u.id) && !u.hasMovedThisTurn &&
                                Math.abs(u.x - unit.x) + Math.abs(u.z - unit.z) <= 8);
                            if (escort) {
                                const escStep = stepToward(escort, unit, tiles, owner, units, moved, isAtWar);
                                if (escStep && !moved.has(`${escStep.x},${escStep.z}`) &&
                                    (escStep.x !== escort.x || escStep.z !== escort.z)) {
                                    actions.push({ type: 'move', unitId: escort.id, tx: escStep.x, tz: escStep.z });
                                    moved.add(`${escStep.x},${escStep.z}`);
                                    acted.add(escort.id);
                                }
                            }
                        }
                    }
                    acted.add(unit.id);
                    continue;
                }
                // Empty transport.
                if (atWar) {
                    // 6b — Amphibious assault: pick up idle land military units at shore.
                    const mil = nearestIdleMilitaryAtShore(unit, units, tiles, owner, acted);
                    if (mil) {
                        if (Math.abs(unit.x - mil.x) + Math.abs(unit.z - mil.z) === 1) {
                            const cap = (UNIT_TYPE.TRANSPORT && UNIT_TYPE.TRANSPORT.capacity) || 2;
                            if (((unit.cargo || []).length) < cap) {
                                actions.push({ type: 'board', unitId: mil.id, transportId: unit.id });
                                acted.add(mil.id);
                            }
                        } else if (!unit.hasMovedThisTurn) {
                            const step = stepToward(unit, mil, tiles, owner, units, moved, isAtWar);
                            if (step) {
                                actions.push({ type: 'move', unitId: unit.id, tx: step.x, tz: step.z });
                                moved.add(`${step.x},${step.z}`);
                            }
                        }
                        acted.add(unit.id);
                        continue;
                    }
                }
                // Fallback: pick up the nearest settler waiting at a shore.
                const waiting = nearestWaitingSettler(unit, units, tiles, owner, land);
                if (waiting && !unit.hasMovedThisTurn) {
                    const step = stepToward(unit, waiting, tiles, owner, units, moved, isAtWar);
                    if (step) {
                        actions.push({ type: 'move', unitId: unit.id, tx: step.x, tz: step.z });
                        moved.add(`${step.x},${step.z}`);
                    }
                }
                acted.add(unit.id);
                continue;
            }
            // Warships (GALLEY/FRIGATE/GALLEON): attack a target in range…
            if (atWar && !unit.hasAttackedThisTurn) {
                const tgt = findAttackTarget(unit, units, isAtWar);
                if (tgt) {
                    actions.push({ type: 'attack', fromId: unit.id, toId: tgt.id });
                    acted.add(unit.id);
                    continue;
                }
            }
            // …besiege an adjacent fortified enemy city (GALLEON can)…
            if (UNIT_TYPE[unit.type].besiege && !unit.hasAttackedThisTurn) {
                const ec = findAdjacentEnemyCity(unit, tiles, owner, isAtWar);
                if (ec && (ec.fortification || 0) > 0) {
                    actions.push({ type: 'besiege', unitId: unit.id, tileKey: `${ec.x},${ec.z}` });
                    acted.add(unit.id);
                    continue;
                }
            }
            // 6c — Harbor blockade: if an enemy Harbor city is within range, move
            // to sit on an adjacent water tile and block its ship production.
            if (atWar && !unit.hasMovedThisTurn) {
                let blockading = false;
                for (const [dx, dz] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
                    const nt = tiles.get(`${unit.x + dx},${unit.z + dz}`);
                    if (nt && nt.terrain === 'CITY' && nt.owner && nt.owner !== owner && isAtWar(nt.owner)) {
                        const bld = buildings.get(`${nt.x},${nt.z}`);
                        if (bld && bld.includes('HARBOR')) { blockading = true; break; }
                    }
                }
                if (blockading) {
                    // Already adjacent — stay put to maintain the blockade.
                    acted.add(unit.id);
                    continue;
                }
                let bestHarbor = null, bestHarborDist = Infinity;
                for (const t of tiles.values()) {
                    if (t.terrain !== 'CITY' || !t.owner || t.owner === owner) continue;
                    if (!isAtWar(t.owner)) continue;
                    const bld = buildings.get(`${t.x},${t.z}`);
                    if (!bld || !bld.includes('HARBOR')) continue;
                    const d = manhattan(unit.x, unit.z, t.x, t.z);
                    if (d <= 6 && d < bestHarborDist) { bestHarborDist = d; bestHarbor = t; }
                }
                if (bestHarbor) {
                    let bestAdj = null, bestAdjDist = Infinity;
                    for (const [dx, dz] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
                        const at = tiles.get(`${bestHarbor.x + dx},${bestHarbor.z + dz}`);
                        if (at && (at.terrain === 'WATER' || at.terrain === 'RIVER')) {
                            const d2 = manhattan(unit.x, unit.z, at.x, at.z);
                            if (d2 < bestAdjDist) { bestAdjDist = d2; bestAdj = at; }
                        }
                    }
                    if (bestAdj) {
                        const step = stepToward(unit, bestAdj, tiles, owner, units, moved, isAtWar);
                        if (step) {
                            actions.push({ type: 'move', unitId: unit.id, tx: step.x, tz: step.z });
                            moved.add(`${step.x},${step.z}`);
                        }
                        acted.add(unit.id);
                        continue;
                    }
                }
            }
            // …or sail toward an enemy city / an unsettled foreign landmass.
            if (!unit.hasMovedThisTurn) {
                let dest = null;
                if (atWar) dest = findNearestEnemyCity(unit, tiles, owner, isAtWar);
                if (!dest) dest = nearestForeignLandmass(unit, tiles, owner, land);
                if (dest) {
                    const step = stepToward(unit, dest, tiles, owner, units, moved, isAtWar);
                    if (step) {
                        actions.push({ type: 'move', unitId: unit.id, tx: step.x, tz: step.z });
                        moved.add(`${step.x},${step.z}`);
                    }
                }
            }
            acted.add(unit.id);
            continue;
        }
    }

    // 5. Army-group coordination: military units (everything that wasn't a
    //    settler/worker/ship and didn't already act — including engineers that
    //    didn't build anything) are grouped, then split into two roles:
    //      - CONQUEST: the strongest 1-3 groups campaign outward (enemy cities,
    //        neutral cities, expansion). Kings/lords attached to these groups
    //        ride along with the main army.
    //      - PATROL: the rest hold a defensive ring near their nearest friendly
    //        city, guarding territory instead of wandering the map.
    const militaryPool = myUnits.filter(u =>
        !acted.has(u.id) && u.type !== 'SETTLER' && u.type !== 'WORKER' && !isNaval(u));
    const groups = buildArmyGroups(militaryPool, lords, owner);
    const hasConquestTargets = atWar ||
        [...tiles.values()].some(t => t.terrain === 'CITY' && !t.owner);
    const ranked = groups.map(g => ({
        g, power: g.units.reduce((s, u) => s + unitValue(u), 0)
    })).sort((a, b) => b.power - a.power);
    const conquestCount = hasConquestTargets
        ? Math.min(3, Math.max(1, Math.ceil(ranked.length / 2)))
        : 0;
    // Multi-front conquest assignment: cluster enemy cities into fronts and
    // assign each conquest group to a different front.
    const enemyCities = [...tiles.values()]
        .filter(t => t.terrain === 'CITY' && t.owner && t.owner !== owner &&
            (!isAtWar || isAtWar(t.owner)))
        .map(t => ({ x: t.x, z: t.z, owner: t.owner }));
    // Simple grouping: sort by proximity (Manhattan ≤ 8 = same front)
    const fronts = [];
    for (const ec of enemyCities) {
        let added = false;
        for (const f of fronts) {
            const rep = f.cities[0];
            if (Math.abs(rep.x - ec.x) + Math.abs(rep.z - ec.z) <= 8) {
                f.cities.push(ec); added = true; break;
            }
        }
        if (!added) fronts.push({ cities: [ec] });
    }
    // Conquest groups: the strongest 1-3 groups assigned to offensive missions.
    const conquest = new Set();
    // King protection: if the king has <3 military units within radius 2, mark
    // the nearest idle army group as a guard detail (it will stay close to the king
    // instead of patrolling elsewhere).
    const king = (lords || []).find(l => l.owner === owner && l.isKing);
    let kingGuardGroup = null;
    if (king) {
        const guardsNear = militaryPool.filter(u => u.type !== 'SETTLER' && u.type !== 'WORKER' &&
            Math.abs(u.x - king.x) + Math.abs(u.z - king.z) <= 2).length;
        if (guardsNear < 3) {
            // Find the nearest patrol group to assign as king's guard
            let bestDist = Infinity;
            for (const g of groups) {
                if (conquest.has(g)) continue; // conquest groups are on the offensive
                const c = groupCentroid(g);
                const d = Math.abs(c.x - king.x) + Math.abs(c.z - king.z);
                if (d < bestDist) { bestDist = d; kingGuardGroup = g; }
            }
        }
    }

    const assignedFronts = new Set();
    for (let i = 0; i < ranked.length && conquest.size < conquestCount && (fronts.length === 0 || assignedFronts.size < fronts.length); i++) {
        if (fronts.length === 0) {
            conquest.add(ranked[i].g);
        } else {
            // Assign group to a different front than already-assigned groups
            for (let fi = 0; fi < fronts.length; fi++) {
                if (!assignedFronts.has(fi)) {
                    conquest.add(ranked[i].g);
                    assignedFronts.add(fi);
                    break;
                }
            }
            // If all fronts assigned but we still have strong groups, add them too
            if (!conquest.has(ranked[i].g) && conquest.size < conquestCount && ranked[i].power > ranked[Math.min(ranked.length - 1, conquestCount)].power * 1.5) {
                conquest.add(ranked[i].g);
            }
        }
    }
    for (const g of groups) {
        if (conquest.has(g)) {
            const stance = computeStance(g, units, owner, atWar, isAtWar);
            const objective = pickGroupObjective(g, tiles, owner, isAtWar, stance, units);
            actions.push(...planGroup(g, objective, stance, units, tiles, owner,
                lords, buildings, tempBonuses, diploState, moved, acted, atWar, isAtWar, res, structures));
        } else {
            // Patrol: hold near the nearest friendly city; fight what's close.
            // King guard groups stay near the king instead.
            const c = groupCentroid(g);
            const home = g === kingGuardGroup && king
                ? { x: king.x, z: king.z }
                : nearestFriendlyCity(c, tiles, owner);
            actions.push(...planGroup(g, home, 'hold', units, tiles, owner,
                lords, buildings, tempBonuses, diploState, moved, acted, atWar, isAtWar, res, structures));
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

/** River tile an engineer should bridge, or null. Returns an orthogonally-
 *  adjacent unbridged RIVER tile whose far side is passable land closer (by
 *  Manhattan distance) to the engineer's nearest at-war enemy city — i.e. the
 *  river is actually blocking the path forward, not a side branch. */
function findBridgeTarget(unit, tiles, owner, isAtWar, atWar) {
    if (!atWar) return null; // bridging is an offensive maneuver toward enemy cities
    const objective = findNearestEnemyCity(unit, tiles, owner, isAtWar);
    if (!objective) return null;
    const curDist = manhattan(unit.x, unit.z, objective.x, objective.z);
    const dirs = [[0, 1], [0, -1], [1, 0], [-1, 0]];
    for (const [dx, dz] of dirs) {
        const river = tiles.get(`${unit.x + dx},${unit.z + dz}`);
        if (!river || river.terrain !== 'RIVER' || river.bridge) continue;
        const far = tiles.get(`${unit.x + 2 * dx},${unit.z + 2 * dz}`);
        if (!far) continue;
        // Far side must be passable land the engineer can step onto once the
        // bridge is built (not water/mountain, not another unbridged river).
        if (far.terrain === 'WATER' || far.terrain === 'MOUNTAIN') continue;
        if (far.terrain === 'RIVER' && !far.bridge) continue;
        if (manhattan(far.x, far.z, objective.x, objective.z) < curDist) return river;
    }
    return null;
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

/** Compute per-terrain settlement weights based on what the faction actually
 *  needs: cavalry/artillery/siege rosters crave iron, archer rosters want wood,
 *  everyone wants food/gold. Low stockpiles amplify the matching terrain. */
function resourceNeedWeights(factionDef, resources) {
    const w = { PLAINS: 1, FOREST: 1, HILLS: 1, MOUNTAIN: 1, RIVER: 1, DESERT: 1, MARSH: 1, TUNDRA: 1, CITY: 1 };
    if (!factionDef) return w;
    const roster = factionDef.roster || [];
    const needsIron = roster.some(t => ['CAVALRY', 'CATAPHRACT', 'ARTILLERY', 'SIEGE', 'CATAPULT', 'TREBUCHET', 'PIKEMAN', 'CHARIOT'].includes(t));
    const needsWood = roster.some(t => ['ARCHER', 'LONGBOWMAN', 'SIEGE_TOWER', 'CATAPULT', 'TREBUCHET', 'CHARIOT'].includes(t));
    const res = resources || {};
    if (needsIron || (res.iron || 0) < 30) { w.MOUNTAIN += 1.5; w.HILLS += 1.0; }
    if (needsWood || (res.wood || 0) < 40) { w.FOREST += 1.5; }
    if ((res.food || 0) < 50) { w.PLAINS += 1.0; w.RIVER += 1.0; }
    if ((res.gold || 0) < 60) { w.DESERT += 0.8; w.MOUNTAIN += 0.5; }
    // Factions with lots of cavalry want open land + iron; archer factions want forests.
    if (factionDef.id === 'golden' || factionDef.id === 'crimson') { w.PLAINS += 0.5; w.MOUNTAIN += 0.5; }
    if (factionDef.id === 'shadow' || factionDef.id === 'verdant') { w.FOREST += 0.5; }
    return w;
}

/** Nearest unowned land tile a settler can head toward to found a city.
 *  Scores candidate tiles by:
 *  - Resource density (food, wood, iron, gold) in surrounding area, weighted
 *    by what the faction's roster and economy actually need
 *  - Natural wonders (huge bonus)
 *  - Frontier bonus: strongly prefers tiles FAR from existing friendly cities
 *    to encourage expansion into different regions
 *  - Distance from settler (closer is slightly better)
 *  - Safety (fewer nearby enemies is better)
 *  This makes the AI prioritize settling in resource-rich frontier areas,
 *  spreading into different map regions instead of clustering near home. */
function findFoundSpot(unit, tiles, owner, land = null, massId = null, units = null, factionDef = null, resources = null) {
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
        // Only spots on the settler's own landmass are reachable on foot —
        // cross-sea settling is the Transport's job (see the settler block).
        if (land && massId != null && land.idOf.get(`${t.x},${t.z}`) !== massId) continue;
        const dist = manhattan(unit.x, unit.z, t.x, t.z);
        
        // Calculate resource density in surrounding area (radius 2)
        let resourceScore = 0;
        let hasWonder = false;
        let enemyNear = 0, friendlyNear = 0;
        // Distance from nearest friendly city (for frontier bonus)
        let nearestCityDist = Infinity;
        // Track nearest enemy city and its garrison for weak-city sniping
        let nearestEnemyCityDist = Infinity;
        let nearestEnemyCityGarrison = 0;
        let nearestEnemyCityMaxHP = 0;
        const needWeights = resourceNeedWeights(factionDef, resources);
        
        for (let dx = -5; dx <= 5; dx++) {
            for (let dz = -5; dz <= 5; dz++) {
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
                
                // Track nearest enemy city for weak-city sniping
                if (nt.terrain === 'CITY' && nt.owner && nt.owner !== owner) {
                    const cd = Math.abs(dx) + Math.abs(dz);
                    if (cd < nearestEnemyCityDist) {
                        nearestEnemyCityDist = cd;
                        // Estimate garrison: count friendly units on or adjacent to this city
                        let garrisonCount = 0, maxHP = 0;
                        if (units) {
                            for (const u of units.values()) {
                                if (u.owner !== nt.owner) continue;
                                if (u.type === 'SETTLER' || u.type === 'WORKER') continue;
                                const ud = Math.abs(u.x - nt.x) + Math.abs(u.z - nt.z);
                                if (ud <= 1) { garrisonCount++; maxHP += u.maxHp || 10; }
                            }
                        }
                        nearestEnemyCityGarrison = garrisonCount;
                        nearestEnemyCityMaxHP = Math.max(maxHP, 1);
                    }
                }
                
                // Resource scoring (only for tiles in influence range)
                if (Math.abs(dx) <= 2 && Math.abs(dz) <= 2) {
                    const terrain = nt.terrain;
                    const weight = needWeights[terrain] || 1;
                    if (terrain === 'PLAINS') resourceScore += 3 * weight;
                    else if (terrain === 'FOREST') resourceScore += 4 * weight;
                    else if (terrain === 'MOUNTAIN') resourceScore += 5 * weight;
                    else if (terrain === 'HILLS') resourceScore += 3 * weight;
                    else if (terrain === 'DESERT') resourceScore += 2 * weight;
                    else if (terrain === 'MARSH') resourceScore += 2 * weight;
                    else if (terrain === 'TUNDRA') resourceScore += 2 * weight;
                    else if (terrain === 'RIVER') resourceScore += 3 * weight;
                    else if (terrain === 'CITY') resourceScore += 8 * weight;

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
        if (nearestCityDist > 8) score += AI_FRONTIER_BONUS_CLOSE;   // Very far from any city — great frontier
        else if (nearestCityDist > 5) score += AI_FRONTIER_BONUS_MID; // Moderately far — good expansion
        else if (nearestCityDist > 3) score += AI_FRONTIER_BONUS_FAR; // Somewhat far — acceptable
        else score -= 20;                       // Too close to existing city — penalize
        
        // Enemy proximity penalty: founding near a strong enemy city is dangerous
        if (nearestEnemyCityDist <= 5 && nearestEnemyCityGarrison >= 2) {
            score += AI_ENEMY_CITY_PROXIMITY_PENALTY;
        }
        
        // Weak-city sniping bonus: founding near a weakly-defended enemy city
        // sets up a forward base for capture.
        if (nearestEnemyCityDist <= 4 && nearestEnemyCityGarrison < WEAK_CITY_GARRISON_THRESHOLD) {
            score += AI_WEAK_CITY_SNIPE_BONUS;
        }
        
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

/** Highest-value owned, unimproved, in-influence tile. Uses a scoring system
 *  that prioritises scarce resources so the AI doesn't spam lumbermills alone.
 *  Returns the tile or null. */
function findImprovementSpot(unit, tiles, owner, buildings, influence, resources) {
    let best = null, bestScore = -Infinity;
    const wood = (resources && resources.wood) || 0;
    const food = (resources && resources.food) || 0;
    const iron = (resources && resources.iron) || 0;
    for (const t of tiles.values()) {
        if (t.owner !== owner) continue;
        const b = improvementForTerrain(t.terrain);
        if (!b) continue;
        if ((buildings.get(`${t.x},${t.z}`) || []).includes(b)) continue;
        if (influence && !influence.has(`${t.x},${t.z}`)) continue;
        let score = 0;
        if (b === 'MINE') {
            score = 100 - iron * 1.5;         // high priority when iron is low
            if (iron < 10) score += 80;
        } else if (b === 'FARM') {
            score = 70 - food * 0.8;           // priority when food is low
            if (food < 15) score += 60;
        } else { // LUMBERMILL
            score = 30 - wood * 0.3;           // low priority unless wood is scarce
            if (wood < 15) score += 50;
            if (wood > 40) score = 0;          // don't build more lumbermills when wood is plentiful
        }
        score -= Math.max(Math.abs(t.x - unit.x), Math.abs(t.z - unit.z)) * 3;
        if (score > bestScore) { bestScore = score; best = t; }
    }
    return best;
}

/** Composition role buckets for the AI army. */
const MELEE_TYPES = new Set(['INFANTRY', 'PIKEMAN']);
const RANGED_TYPES = new Set(['ARCHER', 'LONGBOWMAN']);
const CAVALRY_TYPES = new Set(['CAVALRY', 'CATAPHRACT', 'CHARIOT']);
const SIEGE_TYPES = new Set(['SIEGE', 'ARTILLERY', 'CATAPULT', 'TREBUCHET', 'SIEGE_TOWER']);
const SUPPORT_TYPES = new Set(['MEDIC', 'ENGINEER']);
const NAVAL_TYPES = new Set(['GALLEY', 'TRANSPORT', 'FRIGATE', 'GALLEON']);

function unitRole(type) {
    if (MELEE_TYPES.has(type)) return 'melee';
    if (RANGED_TYPES.has(type)) return 'ranged';
    if (CAVALRY_TYPES.has(type)) return 'cavalry';
    if (SIEGE_TYPES.has(type)) return 'siege';
    if (SUPPORT_TYPES.has(type)) return 'support';
    if (NAVAL_TYPES.has(type)) return 'naval';
    return 'other';
}

/** Detect what the faction is currently trying to do so training can match the
 *  immediate need. Returns { siege, raid, defensive }. */
function detectActiveObjectives(units, tiles, owner, isAtWar) {
    // Objective kinds drive army composition (notably the siege ratio):
    //   siege     -> an army is besieging an enemy city (wants LOTS of siege)
    //   decisive  -> a pitched field battle vs a massed enemy army (little siege)
    //   defensive -> enemy units threatening an own city (melee/ranged focus)
    //   raid      -> exposed enemy units in the open (cavalry focus)
    // Explore/patrol are per-unit (scouts, king's guard) and don't shape
    // faction-wide training composition; "conquest" reduces to siege here.
    const out = { siege: false, raid: false, defensive: false, decisive: false, kind: null };
    if (!isAtWar) return out;
    const ownCities = [...tiles.values()].filter(t => t.terrain === 'CITY' && t.owner === owner);
    const ownMil = [...units.values()].filter(u => u.owner === owner &&
        !['SETTLER', 'WORKER', 'SCOUT', 'ENGINEER'].includes(u.type));
    const enemyMil = [...units.values()].filter(u => u.owner !== owner && isAtWar(u.owner) &&
        !['SETTLER', 'WORKER', 'SCOUT'].includes(u.type));
    // Siege: an at-war enemy city is close to our territory OR our own forces
    // (the besieging army). Counting our own units is what makes "the army is
    // already surrounding the city" register as a siege even when that city is
    // far from home territory. A city whose walls are already down still counts
    // while our army is committed on top of it -- it still needs siege to
    // finish the capture and to push on to the next city.
    for (const t of tiles.values()) {
        if (t.terrain !== 'CITY' || !t.owner || t.owner === owner) continue;
        if (!isAtWar(t.owner)) continue;
        const fort = t.fortification || 0;
        const cityDist = ownCities.length
            ? Math.min(...ownCities.map(c => manhattan(c.x, c.z, t.x, t.z))) : Infinity;
        let ownUnitDist = Infinity;
        for (const u of ownMil) {
            const d = manhattan(u.x, u.z, t.x, t.z);
            if (d < ownUnitDist) ownUnitDist = d;
        }
        const wallsUp = fort > 0;
        const armyOnIt = ownUnitDist <= 4;        // our army is on/around the city
        const nearHome = cityDist <= 12;
        if ((wallsUp && (nearHome || ownUnitDist <= 10)) || armyOnIt) {
            out.siege = true; break;
        }
    }
    // Decisive battle: a large enemy field army is massed near our forces (a
    // pitched battle), where siege engines are a liability -- favor
    // melee/cavalry instead.
    {
        let nearby = 0;
        for (const e of enemyMil) {
            for (const u of ownMil) {
                if (manhattan(e.x, e.z, u.x, u.z) <= 6) { nearby++; break; }
            }
        }
        if (nearby >= 5) out.decisive = true;
    }
    // Defensive: enemy military units are near an own city.
    for (const c of ownCities) {
        for (const u of enemyMil) {
            if (manhattan(c.x, c.z, u.x, u.z) <= 6) { out.defensive = true; break; }
        }
        if (out.defensive) break;
    }
    // Raid: exposed enemy units in the open (not adjacent to an enemy city).
    if (!out.defensive && !out.siege) {
        for (const u of enemyMil) {
            let nearCity = false;
            for (const t of tiles.values()) {
                if (t.terrain === 'CITY' && t.owner === u.owner && manhattan(t.x, t.z, u.x, u.z) <= 2) {
                    nearCity = true; break;
                }
            }
            if (!nearCity) { out.raid = true; break; }
        }
    }
    // Resolve a single dominant objective kind for composition tuning.
    if (out.siege) out.kind = 'siege';
    else if (out.decisive) out.kind = 'decisive';
    else if (out.defensive) out.kind = 'defensive';
    else if (out.raid) out.kind = 'raid';
    return out;
}

function countByRole(units, actions, owner) {
    const counts = { melee: 0, ranged: 0, cavalry: 0, siege: 0, support: 0, naval: 0 };
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

/** Per-faction army composition targets (fractions of the army). Each faction
 *  leans into its specialty: Golden Horde & Crimson favor cavalry, Iron Empire
 *  leans siege, Storm Kingdom builds a naval fleet, etc. SCOUTS are never a
 *  composition target — they're exploration units capped separately at 2.
 *  Roles whose units aren't in the faction's roster are zeroed out so the AI
 *  doesn't chase a role it can't fill. */
function factionComposition(def, roster) {
    // `has('siege')` requires a TRAINABLE siege unit. SIEGE_TOWER is engineer-
    // built (never trained), so it must not count — otherwise no-siege-roster
    // factions (Verdant, Storm) keep a siege composition target they can never
    // fill, and the training fallback resolves to cavalry.
    const has = (role) => roster.some(t => unitRole(t) === role &&
        !(role === 'siege' && t === 'SIEGE_TOWER'));
    const id = def && def.id;
    let t;
    switch (id) {
        case 'crimson':  t = { melee: 0.35, ranged: 0.10, cavalry: 0.35, siege: 0.15, support: 0.05, naval: 0.00 }; break;
        case 'golden':   t = { melee: 0.20, ranged: 0.15, cavalry: 0.45, siege: 0.10, support: 0.10, naval: 0.00 }; break;
        case 'obsidian': t = { melee: 0.30, ranged: 0.15, cavalry: 0.25, siege: 0.20, support: 0.10, naval: 0.00 }; break;
        case 'verdant':  t = { melee: 0.45, ranged: 0.30, cavalry: 0.00, siege: 0.10, support: 0.15, naval: 0.00 }; break;
        case 'violet':   t = { melee: 0.30, ranged: 0.25, cavalry: 0.00, siege: 0.35, support: 0.10, naval: 0.00 }; break;
        case 'azure':    t = { melee: 0.40, ranged: 0.25, cavalry: 0.00, siege: 0.25, support: 0.10, naval: 0.00 }; break;
        case 'iron':     t = { melee: 0.30, ranged: 0.00, cavalry: 0.00, siege: 0.55, support: 0.15, naval: 0.00 }; break;
        case 'shadow':   t = { melee: 0.35, ranged: 0.45, cavalry: 0.00, siege: 0.10, support: 0.10, naval: 0.00 }; break;
        case 'frost':    t = { melee: 0.45, ranged: 0.30, cavalry: 0.00, siege: 0.10, support: 0.15, naval: 0.00 }; break;
        case 'storm':    t = { melee: 0.20, ranged: 0.15, cavalry: 0.10, siege: 0.10, support: 0.05, naval: 0.40 }; break;
        default:         t = { melee: 0.40, ranged: 0.25, cavalry: 0.15, siege: 0.15, support: 0.05, naval: 0.00 };
    }
    // Zero out (and renormalize) roles the roster can't fill.
    let sum = 0;
    for (const r of Object.keys(t)) {
        if ((r === 'support') || r === 'naval' || r === 'cavalry' || r === 'ranged' || r === 'siege' || r === 'melee') {
            if (!has(r)) t[r] = 0;
        }
        sum += t[r];
    }
    if (sum > 0) for (const r of Object.keys(t)) t[r] = t[r] / sum;
    return t;
}

function roleDeficit(roster, counts, total, target) {
    const available = new Set();
    for (const t of roster) available.add(unitRole(t));
    // Don't chase support units until the army has some mass.
    if (total < 8) available.delete('support');
    let worstRole = 'melee', worstDeficit = -Infinity;
    for (const r of Object.keys(target)) {
        if (!available.has(r)) continue;
        const current = counts[r] || 0;
        const desired = total * (target[r] || 0);
        const deficit = desired - current;
        if (deficit > worstDeficit) { worstDeficit = deficit; worstRole = r; }
    }
    return worstRole;
}
/** Pick an affordable unit from this faction's roster, biased toward a
 *  faction-specialized army composition. Early on it secures melee screens,
 *  then fills the biggest role deficit. Falls back to the strongest affordable
 *  *combat* unit (never SCOUT — scouts are exploration units capped at 2 by the
 *  dedicated scout block, so they don't crowd out the army). */
function findAffordableUnit(resources, roster, factionDef, units, actions, owner, objective = null) {
    const counts = countByRole(units, actions, owner);
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    let target = factionComposition(factionDef, roster);
    // Objective-driven composition tweaks. The siege ratio swings hardest:
    // a siege objective leans hard into siege engines, while a decisive field
    // battle or defense pulls siege back in favor of melee/cavalry.
    if (objective) {
        target = { ...target };
        if (objective.siege) {
            target.siege = Math.min(0.60, target.siege + 0.30);
            target.cavalry = Math.max(0, target.cavalry - 0.10);
            target.ranged = Math.max(0, target.ranged - 0.10);
            target.melee = Math.max(0.20, target.melee - 0.05);
        } else if (objective.decisive) {
            target.siege = Math.max(0, target.siege - 0.15);
            target.cavalry = Math.min(0.50, target.cavalry + 0.15);
            target.melee = Math.min(0.55, target.melee + 0.05);
        } else if (objective.raid) {
            target.cavalry = Math.min(0.50, target.cavalry + 0.20);
            target.siege = Math.max(0, target.siege - 0.10);
        } else if (objective.defensive) {
            target.melee = Math.min(0.55, target.melee + 0.15);
            target.ranged = Math.min(0.35, target.ranged + 0.10);
            target.cavalry = Math.max(0, target.cavalry - 0.15);
            target.siege = Math.max(0, target.siege - 0.10);
        }
        // Renormalize.
        const sum = Object.values(target).reduce((a, b) => a + b, 0);
        if (sum > 0) for (const r of Object.keys(target)) target[r] = target[r] / sum;
    }
    // Defense floor: first few units must be melee so expansion/siege don't
    // strip the army bare.
    if (total < 4 && roster.some(t => MELEE_TYPES.has(t))) {
        for (const t of ['INFANTRY', 'PIKEMAN']) {
            if (roster.includes(t) && canAfford(t, resources, getUnitCostFor(t, factionDef))) return t;
        }
    }
    if (total >= 4) {
        const role = roleDeficit(roster, counts, total, target);
        const order = [];
        if (role === 'melee') order.push('INFANTRY', 'PIKEMAN');
        else if (role === 'ranged') order.push('ARCHER', 'LONGBOWMAN');
        else if (role === 'cavalry') order.push('CATAPHRACT', 'CAVALRY');
        else if (role === 'siege') order.push('SIEGE', 'ARTILLERY', 'CATAPULT', 'TREBUCHET');
        else if (role === 'support') order.push('ENGINEER', 'MEDIC');
        else if (role === 'naval') order.push('GALLEON', 'FRIGATE', 'GALLEY', 'TRANSPORT');
        for (const t of order) {
            if (roster.includes(t) && canAfford(t, resources, getUnitCostFor(t, factionDef))) return t;
        }
    }
    // Fallback: strongest affordable combat unit (no SCOUT — prevents the
    // Shadow Court "20 spies" spam where a poor faction trains nothing but the
    // cheapest unit). Order depends on current objective.
    let order;
    if (objective && objective.siege) {
        order = ['SIEGE', 'ARTILLERY', 'CATAPULT', 'TREBUCHET', 'ENGINEER', 'CATAPHRACT', 'CAVALRY', 'PIKEMAN', 'LONGBOWMAN', 'ARCHER', 'INFANTRY'];
    } else if (objective && objective.decisive) {
        order = ['CATAPHRACT', 'CAVALRY', 'CHARIOT', 'PIKEMAN', 'INFANTRY', 'LONGBOWMAN', 'ARCHER', 'SIEGE', 'ARTILLERY'];
    } else if (objective && objective.raid) {
        order = ['CATAPHRACT', 'CAVALRY', 'CHARIOT', 'SIEGE', 'ARTILLERY', 'PIKEMAN', 'LONGBOWMAN', 'ARCHER', 'INFANTRY'];
    } else if (objective && objective.defensive) {
        order = ['PIKEMAN', 'INFANTRY', 'ARCHER', 'LONGBOWMAN', 'SIEGE', 'ARTILLERY', 'CATAPHRACT', 'CAVALRY'];
    } else {
        order = ['SIEGE', 'ARTILLERY', 'CATAPULT', 'TREBUCHET', 'ENGINEER', 'CATAPHRACT', 'CAVALRY', 'PIKEMAN', 'LONGBOWMAN', 'ARCHER', 'INFANTRY'];
    }
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
function isFavorableAttack(attacker, defender, units, tiles, lords, buildings, tempBonuses, structures = null) {
    if (!attacker || !defender) return false;
    const defTile = tiles.get(`${defender.x},${defender.z}`);
    const terrain = defTile ? defTile.terrain : 'PLAINS';
    const breached = !!(defTile && defTile.terrain === 'CITY' && (defTile.fortification || 0) <= 0);
    const atkLord = findCommandingLord(lords, attacker);
    const defLord = defender._isLord ? null : findCommandingLord(lords, defender);
    const enc = isEncircled(defender, units, tiles);
    const sim = simulateCombat(attacker, defender, terrain, atkLord, defLord, buildings, lords, tempBonuses, enc, structures, breached);
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

/** True if an at-war enemy is close enough that it may walk through this tile on
 *  its way to an own city/unit. This stops the AI from concealing units forever in
 *  forests where no enemy will ever pass (a common stalemate where both sides hide). */
function enemyWillPassThroughConcealTile(u, units, tiles, owner, isAtWar) {
    const radius = 6;
    const ownCities = [...tiles.values()].filter(t => t.terrain === 'CITY' && t.owner === owner);
    for (const e of units.values()) {
        if (e.owner === owner) continue;
        if (isAtWar && !isAtWar(e.owner)) continue;
        if (Math.max(Math.abs(e.x - u.x), Math.abs(e.z - u.z)) > radius) continue;
        let target = null, bestD = Infinity;
        for (const c of ownCities) {
            const d = Math.max(Math.abs(e.x - c.x), Math.abs(e.z - c.z));
            if (d < bestD) { bestD = d; target = c; }
        }
        if (!target) {
            for (const f of units.values()) {
                if (f.owner !== owner) continue;
                const d = Math.max(Math.abs(e.x - f.x), Math.abs(e.z - f.z));                if (d < bestD) { bestD = d; target = f; }
            }
        }
        if (!target) continue;
        const deu = Math.max(Math.abs(e.x - u.x), Math.abs(e.z - u.z));
        const dut = Math.max(Math.abs(u.x - target.x), Math.abs(u.z - target.z));
        const det = Math.max(Math.abs(e.x - target.x), Math.abs(e.z - target.z));
        if (deu + dut <= det + 2) return true;
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
function pickGroupObjective(group, tiles, owner, isAtWar, stance, units) {
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

    // Hold or Engage: seek out targets aggressively.
    // Priority 1+2 merged: rank at-war enemy cities AND neutral cities together
    // so a close neutral city (first-expander advantage) can outrank a distant
    // enemy stronghold. Enemy cities get a weakness/snipe bonus when their
    // fortification, garrison, and level are all low — the AI then pushes a
    // conquest group there to breach and capture.
    {
        let best = null, bestScore = -Infinity;
        for (const t of tiles.values()) {
            if (t.terrain !== 'CITY') continue;
            if (t.owner === owner) continue;
            const d = manhattan(c.x, c.z, t.x, t.z);
            const fort = t.fortification || 0;
            const garrison = cityGarrison(t, units);
            if (!t.owner) {
                // Neutral/unclaimed city — rush to grab it early.
                const score = 800 + AI_NEUTRAL_RUSH_BONUS - d - fort * 10 + (fort <= 0 ? 200 : 0);
                if (score > bestScore) { bestScore = score; best = t; }
            } else if (isAtWar && isAtWar(t.owner)) {
                // At-war enemy city — prefer breached or weakly-defended ones.
                const weak = fort <= 1 && garrison <= WEAK_CITY_GARRISON_THRESHOLD && (t.cityLevel || 1) <= 2;
                const score = 1000 - d - fort * 15 + (fort <= 0 ? 300 : 0)
                    + (weak ? AI_WEAK_CITY_SNIPE_BONUS : 0);
                if (score > bestScore) { bestScore = score; best = t; }
            }
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
    const bal = localPowerBalance(units, c.x, c.z, owner, atWar, isAtWar, 4);
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
function planGroup(group, objective, stance, units, tiles, owner, lords, buildings, tempBonuses, diploState, moved, acted, atWar, isAtWar, res, structures = null) {
    const out = [];
    const members = group.units.filter(u => !acted.has(u.id));
    if (!members.length) return out;
    const groupTarget = chooseGroupTarget(group, units, owner, atWar, isAtWar);

    // 1) Retreat fragile / wounded units that are locally outmatched.
    //    ANY unit below 20% HP unconditionally retreats (no sense fighting to
    //    the death).
    if (atWar) {
        for (const u of members) {
            if (acted.has(u.id)) continue;
            const nearDeath = (u.hp || 0) < (u.maxHp || 1) * 0.2;
            const wounded = (u.hp || 0) < (u.maxHp || 1) * 0.5;
            if (nearDeath) {
                // Universal retreat: any unit below 20% HP flees.
                if (u.hasMovedThisTurn) continue;
                const goal = nearestFriendlyCity(u, tiles, owner);
                if (!goal) continue;
                const step = nextStepToward(tiles, units, u, goal, 200, owner);
                if (step && !moved.has(`${step.x},${step.z}`)) {
                    out.push({ type: 'move', unitId: u.id, tx: step.x, tz: step.z });
                    acted.add(u.id);
                    moved.add(`${step.x},${step.z}`);
                }
                continue;
            }
            if (!isFragile(u) && !wounded) continue;
            const bal = localPowerBalance(units, u.x, u.z, owner, atWar, isAtWar, 4);
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
                if (!isFavorableAttack(u, e, units, tiles, lords, buildings, tempBonuses, structures)) continue;
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

    // 2b) Chariot charge: directional straight-line strike (up to 3 tiles) into
    //     an enemy, before any other action. The chariot cannot also move this
    //     turn, so only fire when a favorable target sits in a clear lane.
    if (atWar) {
        for (const u of members) {
            if (acted.has(u.id) || u.hasAttackedThisTurn || u.hasMovedThisTurn) continue;
            if (!CHARIOT_CHARGE_UNITS.includes(u.type)) continue;
            if (u.stunnedTurns && u.stunnedTurns > 0) continue;
            let best = null, bestScore = -Infinity, bestDir = null;
            for (const dir of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                for (let step = 1; step <= CHARIOT_CHARGE_RANGE; step++) {
                    const tx = u.x + dir[0] * step, tz = u.z + dir[1] * step;
                    const key = `${tx},${tz}`;
                    const t = tiles.get(key);
                    if (!t || t.terrain === 'WATER' || t.terrain === 'MOUNTAIN') break;
                    const e = units.get(key);
                    if (e && e.owner !== owner && (!isAtWar || isAtWar(e.owner))) {
                        if (!isFavorableAttack(u, e, units, tiles, lords, buildings, tempBonuses, structures)) break;
                        let score = unitValue(e) + (CHARIOT_CHARGE_VULN_TYPES.includes(e.type) ? 25 : 0);
                        if (groupTarget && e.id === groupTarget.id) score += 20;
                        if (score > bestScore) { bestScore = score; best = e; bestDir = dir; }
                        break; // charge hits the first enemy in the lane
                    }
                }
            }
            if (best && bestDir) {
                out.push({ type: 'chariotCharge', fromId: u.id, dx: bestDir[0], dz: bestDir[1] });
                acted.add(u.id);
            }
        }
    }

    // 3) Conceal (ambush setup) for any military unit on conceal terrain near
    //    the front, out of enemy vision, with no adjacent enemy to fight.
    //    A unit that is ALREADY concealing/concealed is skipped (don't reset its
    //    progress every turn — that left units stuck in 'concealing' forever and
    //    marked `acted` so they never advanced). A unit on a post-reveal cooldown
    //    is also skipped so it advances instead of re-hiding immediately.
    if (atWar && (stance === 'hold' || stance === 'engage')) {
        for (const u of members) {
            if (acted.has(u.id) || u.hasMovedThisTurn || u.hasAttackedThisTurn) continue;
            if (u.concealState === 'concealing' || u.concealState === 'concealed') continue;
            if (u.concealCooldown && u.concealCooldown > 0) continue;
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
            if (!enemyWillPassThroughConcealTile(u, units, tiles, owner, isAtWar)) continue;
            out.push({ type: 'conceal', unitId: u.id });
            acted.add(u.id);
        }
    }

    // 4) Besiege / capture / pillage (strategic city + improvement actions).
    //    Runs even at peace: NEUTRAL (unclaimed) cities are always valid
    //    targets — the diplomacy filters inside the finders skip enemy-owned
    //    cities we're not at war with.
    {
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
    //    Siege engines with AOE get a bonus against clustered enemies.
    if (atWar) {
        for (const u of members) {
            if (acted.has(u.id) || u.hasAttackedThisTurn) continue;
            if (!isRanged(u)) continue;
            const targets = getAttackTargets(u, units)
                .filter(e => (!isAtWar || isAtWar(e.owner)) && e.concealState !== 'concealed');
            if (!targets.length) continue;
            let best = null, bestScore = -Infinity;
            for (const e of targets) {
                if (!isFavorableAttack(u, e, units, tiles, lords, buildings, tempBonuses, structures)) continue;
                let score = unitValue(e);
                if (groupTarget && e.id === groupTarget.id) score += 20;
                if (typeMatch(u.type, e.type)) score += 10;
                // AOE splash bonus: siege engines prefer clustered enemies
                if (UNIT_TYPE[u.type] && UNIT_TYPE[u.type].aoe) {
                    let splashCount = 0;
                    for (const other of units.values()) {
                        if (other.owner !== owner && other.id !== e.id &&
                            Math.abs(other.x - e.x) + Math.abs(other.z - e.z) <= 1) splashCount++;
                    }
                    if (splashCount >= 2) score += 30;
                }
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
                if (isFavorableAttack(u, groupTarget, units, tiles, lords, buildings, tempBonuses, structures)) {
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
    //    Units that are concealing/concealed hold position (they're setting an
    //    ambush); the conceal timeout in _tickConcealment eventually releases
    //    them (sets concealState=null + a cooldown) so a stalemate where both
    //    sides hide forever can't persist.
    const advance = (u) => {
        if (acted.has(u.id) || u.hasMovedThisTurn) return;
        if (u.concealState === 'concealing' || u.concealState === 'concealed') return;
        if (!objective) return;
        // Patrols hold the ring: already close enough to the home city.
        if (stance === 'hold' && objective.owner === owner &&
            manhattan(u.x, u.z, objective.x, objective.z) <= 2) return;
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
function findNearestUnexploredTile(unit, tiles, owner, units = null) {
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
        // Spread scouts out: skip frontier tiles another friendly scout is
        // already covering, so multiple scouts map different regions.
        if (units) {
            let covered = false;
            for (const o of units.values()) {
                if (o.owner !== owner || o.type !== 'SCOUT' || o.id === unit.id) continue;
                if (Math.max(Math.abs(o.x - t.x), Math.abs(o.z - t.z)) <= 5) { covered = true; break; }
            }
            if (covered) continue;
        }
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
// Landmass / naval / siege-target helpers
// ============================================================

/** True if the given landmass still has at least one tile where the faction
 *  can found a new city. */
function homeMassHasFoundSpot(tiles, owner, land, massId) {
    if (massId == null) return false;
    for (const t of tiles.values()) {
        if (land.idOf.get(`${t.x},${t.z}`) !== massId) continue;
        if (canFoundOn(t, owner)) return true;
    }
    return false;
}

/** True if there exists a non-home landmass with no friendly city on it. */
function hasForeignLandmassWithoutCity(tiles, owner, land, homeMass) {
    const friendlyMasses = new Set();
    for (const t of tiles.values()) {
        if (t.terrain === 'CITY' && t.owner === owner) {
            const m = land.idOf.get(`${t.x},${t.z}`);
            if (m != null) friendlyMasses.add(m);
        }
    }
    for (const m of land.sizes.keys()) {
        if (m === homeMass) continue;
        if (!friendlyMasses.has(m)) return true;
    }
    return false;
}

/** Label every non-WATER tile with a landmass id (flood fill over land,
 *  treating RIVER as land — rivers are bridgeable, they don't isolate an
 *  island). Returns { idOf: Map(tileKey->id), sizes: Map(id->tileCount) }. */
function computeLandmasses(tiles) {
    const idOf = new Map();
    const sizes = new Map();
    let nextId = 0;
    for (const t of tiles.values()) {
        if (t.terrain === 'WATER') continue;
        const startKey = `${t.x},${t.z}`;
        if (idOf.has(startKey)) continue;
        const id = nextId++;
        let count = 0;
        const queue = [t];
        idOf.set(startKey, id);
        while (queue.length) {
            const cur = queue.pop();
            count++;
            for (const [dx, dz] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
                const nk = `${cur.x + dx},${cur.z + dz}`;
                if (idOf.has(nk)) continue;
                const nt = tiles.get(nk);
                if (!nt || nt.terrain === 'WATER') continue;
                idOf.set(nk, id);
                queue.push(nt);
            }
        }
        sizes.set(id, count);
    }
    return { idOf, sizes };
}

/** True if a city tile touches water or river (can host a Harbor / launch ships). */
function isCoastalCity(tile, tiles) {
    for (const [dx, dz] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
        const nt = tiles.get(`${tile.x + dx},${tile.z + dz}`);
        if (nt && (nt.terrain === 'WATER' || nt.terrain === 'RIVER')) return true;
    }
    return false;
}

/** An orthogonally-adjacent friendly Transport with free cargo space, or null. */
function adjacentTransport(unit, units, owner) {
    for (const u of units.values()) {
        if (u.owner !== owner || u.type !== 'TRANSPORT' || u.boarded) continue;
        const cap = (UNIT_TYPE.TRANSPORT && UNIT_TYPE.TRANSPORT.capacity) || 2;
        if (((u.cargo || []).length) >= cap) continue;
        if (Math.abs(u.x - unit.x) + Math.abs(u.z - unit.z) === 1) return u;
    }
    return null;
}

/** Nearest land tile on `massId` that is orthogonally adjacent to water — the
 *  pickup point where a settler waits for a Transport. */
function nearestShoreTile(unit, tiles, land, massId) {
    let best = null, bestDist = Infinity;
    for (const t of tiles.values()) {
        if (t.terrain === 'WATER' || t.terrain === 'MOUNTAIN' || t.terrain === 'RIVER') continue;
        if (massId != null && land.idOf.get(`${t.x},${t.z}`) !== massId) continue;
        let shore = false;
        for (const [dx, dz] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
            const nt = tiles.get(`${t.x + dx},${t.z + dz}`);
            if (nt && nt.terrain === 'WATER') { shore = true; break; }
        }
        if (!shore) continue;
        const d = manhattan(unit.x, unit.z, t.x, t.z);
        if (d < bestDist) { bestDist = d; best = t; }
    }
    return best;
}

/** Nearest settleable land tile that a Transport can unload onto: foundable,
 *  touches water, and on a landmass with no friendly city (fresh territory). */
function nearestFoundableBySea(transport, tiles, owner, land) {
    let best = null, bestDist = Infinity;
    for (const t of tiles.values()) {
        if (!canFoundOn(t, owner)) continue;
        const mass = land.idOf.get(`${t.x},${t.z}`);
        if (mass == null) continue;
        let hasFriendlyCity = false;
        let touchesWater = false;
        for (const ct of tiles.values()) {
            if (ct.terrain === 'CITY' && ct.owner === owner &&
                land.idOf.get(`${ct.x},${ct.z}`) === mass) { hasFriendlyCity = true; break; }
        }
        if (hasFriendlyCity) continue;
        for (const [dx, dz] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
            const nt = tiles.get(`${t.x + dx},${t.z + dz}`);
            if (nt && nt.terrain === 'WATER') { touchesWater = true; break; }
        }
        if (!touchesWater) continue;
        const d = manhattan(transport.x, transport.z, t.x, t.z);
        if (d < bestDist) { bestDist = d; best = t; }
    }
    return best;
}

/** Nearest friendly settler with no settleable spot left on its own landmass
 *  (it's waiting at a shore for a ferry). */
function nearestWaitingSettler(transport, units, tiles, owner, land) {
    let best = null, bestDist = Infinity;
    for (const u of units.values()) {
        if (u.owner !== owner || u.type !== 'SETTLER' || u.boarded) continue;
        const mass = land.idOf.get(`${u.x},${u.z}`);
        if (findFoundSpot(u, tiles, owner, land, mass, units)) continue; // still has land options
        const d = manhattan(transport.x, transport.z, u.x, u.z);
        if (d < bestDist) { bestDist = d; best = u; }
    }
    return best;
}

/** Nearest land tile on a landmass with no friendly city — a scouting target
 *  for warships with nothing to shoot at. */
function nearestForeignLandmass(unit, tiles, owner, land) {
    let best = null, bestDist = Infinity;
    for (const t of tiles.values()) {
        if (t.terrain === 'WATER' || t.terrain === 'RIVER') continue;
        const mass = land.idOf.get(`${t.x},${t.z}`);
        if (mass == null) continue;
        let hasFriendlyCity = false;
        for (const ct of tiles.values()) {
            if (ct.terrain === 'CITY' && ct.owner === owner &&
                land.idOf.get(`${ct.x},${ct.z}`) === mass) { hasFriendlyCity = true; break; }
        }
        if (hasFriendlyCity) continue;
        const d = manhattan(unit.x, unit.z, t.x, t.z);
        if (d < bestDist) { bestDist = d; best = t; }
    }
    return best;
}

/** Nearest enemy city with a HARBOR building that is coastal — the AI
 *  amphibious assault target for loaded military transports. */
function nearestEnemyCoastalCity(unit, tiles, owner, isAtWar) {
    let best = null, bestDist = Infinity;
    for (const t of tiles.values()) {
        if (t.terrain !== 'CITY' || !t.owner || t.owner === owner) continue;
        if (isAtWar && !isAtWar(t.owner)) continue;
        let coastal = false;
        for (const [dx, dz] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
            const nt = tiles.get(`${t.x + dx},${t.z + dz}`);
            if (nt && (nt.terrain === 'WATER' || nt.terrain === 'RIVER')) { coastal = true; break; }
        }
        if (!coastal) continue;
        const d = manhattan(unit.x, unit.z, t.x, t.z);
        if (d < bestDist) { bestDist = d; best = t; }
    }
    return best;
}

/** Nearest friendly idle land military unit standing on a shore tile (adjacent
 *  to water) — the target for an empty transport to pick up for amphibious
 *  assault. Excludes settlers, workers, and naval units. */
function nearestIdleMilitaryAtShore(transport, units, tiles, owner, acted) {
    let best = null, bestDist = Infinity;
    for (const u of units.values()) {
        if (u.owner !== owner || u.boarded) continue;
        if (u.type === 'SETTLER' || u.type === 'WORKER' || isNaval(u)) continue;
        if (acted.has(u.id)) continue;
        const t = tiles.get(`${u.x},${u.z}`);
        if (!t || t.terrain === 'WATER' || t.terrain === 'MOUNTAIN') continue;
        let onShore = false;
        for (const [dx, dz] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
            const nt = tiles.get(`${u.x + dx},${u.z + dz}`);
            if (nt && nt.terrain === 'WATER') { onShore = true; break; }
        }
        if (!onShore) continue;
        const d = manhattan(transport.x, transport.z, u.x, u.z);
        if (d < bestDist) { bestDist = d; best = u; }
    }
    return best;
}

/** Nearest city a Siege Tower can still crack: fortification > 0, and either
 *  neutral (unclaimed — always besiegeable) or owned by an at-war faction. */
function findNearestBesiegeableCity(unit, tiles, owner, isAtWar) {
    let best = null, bestDist = Infinity;
    for (const t of tiles.values()) {
        if (t.terrain !== 'CITY' || t.owner === owner) continue;
        if ((t.fortification || 0) <= 0) continue;
        if (t.owner && isAtWar && !isAtWar(t.owner)) continue;
        const d = manhattan(unit.x, unit.z, t.x, t.z);
        if (d < bestDist) { bestDist = d; best = t; }
    }
    return best;
}

/** How threatened is an own city? Counts at-war enemy units within 5 (and how
 *  many are cavalry — drives the spikes-vs-fall-trap choice). */
function cityThreatLevel(city, units, tiles, owner, isAtWar) {
    let enemies = 0, cavalry = 0;
    for (const u of units.values()) {
        if (u.owner === owner) continue;
        if (isAtWar && !isAtWar(u.owner)) continue;
        const d = manhattan(u.x, u.z, city.x, city.z);
        if (d > 5) continue;
        enemies++;
        if (u.type === 'CAVALRY' || u.type === 'CATAPHRACT') cavalry++;
    }
    return { enemies, cavalry };
}

/** Count friendly units defending a city (on or adjacent). Used to judge
 *  whether an enemy/neutral city is weak enough to snipe. Neutral cities
 *  (owner == null) have no garrison. */
function cityGarrison(city, units) {
    if (!city.owner) return 0;
    let g = 0;
    for (const u of units.values()) {
        if (u.owner !== city.owner) continue;
        if (manhattan(u.x, u.z, city.x, city.z) <= 1) g++;
    }
    return g;
}
