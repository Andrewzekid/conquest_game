/** AI decision logic (pure, no engine dependencies) */
import { UNIT_TYPE, CAPTURE_COST, AI_MAX_UNITS, BUILDING_TYPE, TERRAIN, NAVAL_UNITS,
         SIEGE_ENGINES, SIEGE_ENGINE_BUILD_COST, PILLAGEABLE_BUILDINGS, DIPLOMACY_STATES, SIEGE_TOWER_COST, SIEGE_TOWER_BUILD_RADIUS,
         GRID_SIZE, GRID_WIDTH, GRID_HEIGHT, TYPE_ADVANTAGE, CONCEAL_TERRAINS, CONCEAL_MAX_PER_TILE, CHARGE_UNITS,
         CHARIOT_CHARGE_UNITS, CHARIOT_CHARGE_RANGE, CHARIOT_CHARGE_VULN_TYPES,
          EXTRA_UNITS, STRUCTURE_COST, LORD_RECRUIT_COST, LORD_CLASSES, BRIDGE_COST, FACTION_UNIQUE_UNITS,
          AI_SETTLER_TARGET, AI_SETTLER_CAP_FACTOR, AI_SETTLER_CAP_BASE, AI_SETTLERS_PER_TURN, AI_SETTLER_HARD_CAP,
         AI_FRONTIER_BONUS_CLOSE, AI_FRONTIER_BONUS_MID, AI_FRONTIER_BONUS_FAR,
          AI_ENEMY_CITY_PROXIMITY_PENALTY, AI_WEAK_CITY_SNIPE_BONUS, AI_WEAK_CITY_RATIO,
          WEAK_CITY_GARRISON_THRESHOLD, AI_NEUTRAL_RUSH_BONUS, SETTLER_AGGRESSION,
          AI_BREACH_DETACH_RADIUS,
          MARKET_RATES, CITY_LEVEL_UP_COST, CITY_MAX_LEVEL,
          MILITARY_BUILDING_LEVELS, BUILDING_MAX_LEVEL,
          AI_GOAL_MIN_STABILITY_TURNS, AI_ARTILLERY_RESERVE_DEFAULT, AI_ARTILLERY_RESERVE_SIEGE,
          AI_SETTLER_SCARCITY_TURN_THRESHOLD, AI_SETTLER_SCARCE_CAP_RELAX, AI_SETTLER_SCARCE_FLOOR_RELAX,
          SCARCITY_FLOW_THRESHOLDS, SCIENCE_VICTORY_COST, SCIENCE_VICTORY_BUILD_TURNS,
          AI_KING_RETREAT_BASE, AI_KING_RETREAT_LATE_GAME, AI_KING_RETREAT_LATE_GAME_UNITS,
          AI_KING_RETREAT_LATE_GAME_TURN, AI_KING_RETREAT_MAX, AI_KING_RETREAT_ENEMY_KING,
          AI_LORD_RETREAT_BASE, AI_LORD_RETREAT_LOW, AI_LORD_RETREAT_ENEMY_RADIUS } from './config.js';
import { canAfford, spendCost, getAttackTargets } from './unit.js';
import { getUnitCostFor } from './faction.js';
import { sellAtMarket, getUnitCap, grossYields } from './economy.js';
import { cityRadius, findParentCity } from './map.js';
import { isWaterConnectedToOpenWater } from './map_util.js';
import { getBuildingState, upgradeBuilding } from './building.js';
import { canAttack, isAllied } from './diplomacy.js';
import { simulateCombat, isEncircled } from './battle.js';
import { nextStepToward } from './path.js';
import { findCommandingLord, assignGovernance, canCommand, assignArmy, lordCombatant } from './lords.js';
import { selectGoals, pathCrossesWater, isReachableByLand, isKingVulnerable } from './ai_goals.js';
import { getUnlockedUnits, getUnlockedStructures, TECHS } from './tech.js';
import { applyObsolescence, isObsolete } from './unit_obsolescence.js';
import { computeStrategicTarget, detectFlankingOpportunity, computeFlankObjective, findSafeBeachheadLandingTile, findStagingTile, findPerimeterTile } from './ai_army_plan.js';
import { createTheaters, assignGroupsToTheaters, computeTheaterUrgency, allocateTheaterBudgets, findTheaterCity, garrisonNeeds, findTheaterTarget, planFerries, calculateAdjustedPower } from './ai_theater.js';

/** Flow-aware scarcity (Feature: scarcity should consider net resource flow).
 *  Pure: given this turn's stock, last turn's stock snapshot, and per-resource
 *  drain thresholds, returns how many resources are scarce (stock below floor
 *  OR draining faster than threshold), the worst-draining resource, and the
 *  per-resource net flow. `prev` null/absent means no flow data yet (first
 *  turn) — only the stock check applies.
 *  @returns {{ stockScarce, flowScarce, scarce, drainingResource, flow }} */
export function computeScarcity(stock, prev, thresholds) {
    const s = stock || {};
    const stockScarce = ((s.gold || 0) < 50 ? 1 : 0) + ((s.wood || 0) < 40 ? 1 : 0) +
        ((s.iron || 0) < 30 ? 1 : 0) + ((s.food || 0) < 40 ? 1 : 0);
    const th = thresholds || {};
    const flow = { gold: 0, food: 0, wood: 0, iron: 0 };
    let flowScarce = 0;
    let drainingResource = null;
    let worstFlow = 0;
    for (const r of ['gold', 'food', 'wood', 'iron']) {
        const delta = prev ? (s[r] || 0) - (prev[r] || 0) : 0;
        flow[r] = delta;
        const thresh = th[r];
        if (thresh != null && delta <= thresh) {
            flowScarce += 1;
            // Pick the most-negative flow as the "worst" drain (ties go to the
            // first resource in iteration order).
            if (delta < worstFlow) { worstFlow = delta; drainingResource = r; }
        }
    }
    const scarce = Math.min(4, stockScarce + flowScarce);
    return { stockScarce, flowScarce, scarce, drainingResource, flow };
}

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
export function computeAIActions(units, tiles, resources, owner, buildings, influence, factionDef, diploState, lords = null, tempBonuses = null, structures = null, buildingState = null, aiState = null, aiTechStates = null, victoryState = null, currentTurn = 0) {
    const actions = [];
    const myUnits = [...units.values()].filter(u => u.owner === owner && !u.boarded);
    // Ferry flags are recomputed every turn (see theater ferry planning in
    // step 5a2). Boarded units keep theirs so a mid-sea transport doesn't
    // lose its destination; everyone else's is re-set below if still needed.
    // Preserve tags for units already in the ferry wait queue so the transport
    // loop can age them out after five idle turns.
    for (const u of myUnits) {
        if (u._ferryTo && u._ferryTurns !== undefined) continue;
        delete u._ferryTo;
    }
    let res = { ...resources };
    buildings = buildings || new Map();
    influence = influence || null;
    structures = structures || new Map();
    buildingState = buildingState || new Map();
    const roster = (factionDef && factionDef.roster) || ['INFANTRY', 'ARCHER', 'CAVALRY', 'ARTILLERY'];
    // Whether any owned city already has a Siege Workshop (unlocks
    // CATAPULT/TREBUCHET). Computed early so fullRoster can include them and
    // the composition logic can treat siege as trainable.
    let hasSiegeWorkshop = false;
    for (const [k, bs] of buildings) {
        if (bs && bs.includes('SIEGE_WORKSHOP')) {
            const [bx, bz] = k.split(',').map(Number);
            const tile = tiles.get(k);
            if (tile && tile.owner === owner) { hasSiegeWorkshop = true; break; }
        }
    }
    // Siege engines require both a Siege Workshop AND the unlocking tech.
    const aiTsForRoster = aiTechStates && aiTechStates[owner];
    const aiUnlocked = (aiTsForRoster && aiTsForRoster.researched) ? getUnlockedUnits(aiTsForRoster) : new Set();
    // Modern-siege tech gate: once gunpowder/shell artillery exists, the AI
    // retires the medieval siege corps — engineers stop building Siege Towers
    // (unit loop below), SIEGE_TOWER/ENGINEER leave the trainable roster
    // (OBSOLESCENCE), and the engineer-training cap collapses (step 1c).
    const hasModernSiegeTech = !!(aiTsForRoster && aiTsForRoster.researched && (
        aiTsForRoster.researched.has('GUNPOWDER') ||
        aiTsForRoster.researched.has('METALLURGY') ||
        aiTsForRoster.researched.has('EXPLOSIVES') ||
        aiTsForRoster.researched.has('FIELD_ARTILLERY')));
    const siegeAvailable = hasSiegeWorkshop
        ? ['CATAPULT', 'TREBUCHET'].filter(u => !roster.includes(u) && aiUnlocked.has(u))
        : [];
    // Every faction can also train the shared EXTRA_UNITS (cavalry, longbowmen,
    // medics, …) — without them most factions never field any cavalry.
    const fullRoster = [...roster, ...EXTRA_UNITS.filter(u => !roster.includes(u)),
        ...siegeAvailable];
    // Faction-unique units: only the owning faction (per
    // FACTION_UNIQUE_UNITS) can field them. Strip everyone else's uniques out
    // of the roster so the AI never trains another faction's signature unit
    // even after researching the gating tech.
    if (factionDef && factionDef.id) {
        for (let i = fullRoster.length - 1; i >= 0; i--) {
            const u = fullRoster[i];
            const uniqueOwner = FACTION_UNIQUE_UNITS[u];
            if (uniqueOwner && uniqueOwner !== factionDef.id) {
                fullRoster.splice(i, 1);
            }
        }
    }
    // Filter roster by the faction's tech state: only train units unlocked by
    // researched techs. Faction-roster units are always available (they don't
    // need tech gating). Naval/harbor units are gated by the HARBOR building,
    // not tech, so they pass through.
    const aiTs = aiTechStates && aiTechStates[owner];
    if (aiTs && aiTs.researched) {
        const unlocked = getUnlockedUnits(aiTs);
        const filtered = fullRoster.filter(u => {
            if (roster.includes(u)) return true; // faction-roster always available
            if (EXTRA_UNITS.includes(u) && !unlocked.has(u)) {
                // Extra units that require tech: only block if they have a tech unlock
                const hasTechUnlock = Object.values(TECHS).some(t =>
                    t.unlocks.some(ul => ul.type === 'unit' && ul.id === u));
                if (hasTechUnlock) return unlocked.has(u);
            }
            return true;
        });
        // Only use filtered roster if it's not empty (fallback to full if somehow empty)
        if (filtered.length > 0) {
            fullRoster.length = 0;
            for (const u of filtered) fullRoster.push(u);
        }
        // Obsolescence: remove units whose modern replacement's tech is
        // researched (e.g. ARCHER disappears once RIFLED_MUSKET is done). This
        // stops the AI from training obsolete units even when they're cheaper.
        const obsoleted = applyObsolescence(fullRoster, aiTs.researched);
        if (obsoleted.length > 0) {
            fullRoster.length = 0;
            for (const u of obsoleted) fullRoster.push(u);
        }
    }
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
    if (aiState) aiState.activeObjectives = activeObjectives;

    const canBuildAt = (t) => !influence || influence.has(`${t.x},${t.z}`);
    // Find a tile to build a military building (BARRACKS/SIEGE_WORKSHOP/
    // HARBOR). These are `influenceBuildable` — they can go on ANY passable
    // land tile in a city's influence, not just the city tile itself. The city
    // tile is scarce (only one per city) and should be reserved for city-only
    // buildings (MARKET, WALLS, UNIVERSITY, etc.), so we prefer a NON-city
    // influence tile. Falls back to the city tile only if no other influence
    // tile is available (small empires with a 1-tile radius).
    const findBuildSite = (buildingType, ownedTiles, buildingsMap, tilesMap) => {
        const bData = BUILDING_TYPE[buildingType];
        if (!bData) return null;
        // Tech gate: skip buildings whose required tech hasn't been researched
        if (bData.techRequired && aiTs && aiTs.researched && !aiTs.researched.has(bData.techRequired)) return null;
        const existing = (t) => (buildingsMap.get(`${t.x},${t.z}`) || []).includes(buildingType);
        // Count how many of this building type exist within the parent city's
        // influence radius. Used to enforce maxPerCity limits (e.g. max 2 farms
        // per city) so the AI doesn't spam identical improvements.
        const countInCity = (t) => {
            if (!tilesMap) return existing(t) ? 1 : 0;
            const pc = findParentCity(tilesMap, t);
            if (!pc) return existing(t) ? 1 : 0;
            const cr = cityRadius(pc);
            let count = 0;
            for (let dx = -cr; dx <= cr; dx++) {
                for (let dz = -cr; dz <= cr; dz++) {
                    const k = `${pc.x + dx},${pc.z + dz}`;
                    const list = buildingsMap.get(k) || [];
                    if (list.includes(buildingType)) count++;
                }
            }
            return count;
        };
        // Check if the building type already exists anywhere in the parent city's influence.
        const existsInCity = (t) => countInCity(t) > 0;
        // Enforce maxPerCity: skip tiles where the parent city already has the max.
        const overPerCityLimit = (t) => {
            if (!bData.maxPerCity) return false;
            return countInCity(t) >= bData.maxPerCity;
        };
        // First pass: passable non-city land in influence, not already built.
        for (const t of ownedTiles) {
            if (t.terrain === 'CITY') continue;
            if (!canBuildAt(t)) continue;
            if (t.terrain === 'WATER' || t.terrain === 'MOUNTAIN' || t.terrain === 'RIVER') continue;
            if (overPerCityLimit(t)) continue;
            if (existsInCity(t)) continue;
            // Harbor must be coastal.
            if (buildingType === 'HARBOR' && !isCoastalCity(t, tilesMap)) continue;
            return t;
        }
        // Fallback: the city tile itself (only if no influence tile was found).
        for (const t of ownedTiles) {
            if (t.terrain !== 'CITY') continue;
            if (!canBuildAt(t)) continue;
            if (overPerCityLimit(t)) continue;
            if (existsInCity(t)) continue;
            if (buildingType === 'HARBOR' && !isCoastalCity(t, tilesMap)) continue;
            return t;
        }
        return null;
    };
    const owned = [...tiles.values()].filter(t => t.owner === owner);
    const myCityCount = owned.filter(t => t.terrain === 'CITY').length;
    const hasBarracks = owned.some(t => (buildings.get(`${t.x},${t.z}`) || []).includes('BARRACKS'));
    const trainCount = () => actions.filter(a => a.type === 'train').length;
    // Unit cap: match the engine's per-city cap (5 + (level-1)*2 per city) so a
    // large empire can field a bigger army and a small one doesn't waste planning
    // on trains the engine will drop. AI_MAX_UNITS is a raised sanity ceiling so
    // a huge empire doesn't bankrupt itself on upkeep chasing an unbounded cap.
    const aiUnitCap = Math.min(getUnitCap(tiles, owner), AI_MAX_UNITS);
    const capRoom = () => myUnits.length + trainCount() < aiUnitCap;

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
            if (canFoundOn(t, owner, tiles)) homeMassSettleable++;
            if (noEnemyCitiesOnHomeMass && t.terrain === 'CITY' && t.owner && t.owner !== owner && isAtWar(t.owner)) {
                noEnemyCitiesOnHomeMass = false;
            }
        }
    }
    // Storm Kingdom ignores tiny foreign islets for settlement; if no viable
    // large landmass exists overseas, it should pivot to amphibious conquest.
    const stormMinForeignMass = (factionDef && factionDef.id === 'storm') ? 10 : 0;
    const foreignMassWithoutCity = homeMassFull && hasForeignLandmassWithoutCity(tiles, owner, land, homeMass, stormMinForeignMass);
    const needsNavalExpansion = hasForeignLandmassWithoutCity(tiles, owner, land, homeMass, stormMinForeignMass) &&
        (isIslandFaction || homeMassSettleable < 3 || noEnemyCitiesOnHomeMass);

    // Resource scarcity is computed once up here (before any spending block)
    // because the goal selector needs it AND the settler block consumes the
    // same values. A one-turn dip shouldn't trigger overseas expansion, but
    // AI_SETTLER_SCARCITY_TURN_THRESHOLD consecutive scarce turns should — the
    // streak is persisted in aiState so it accumulates across turns.
    //
    // Scarcity is flow-aware: as well as the stock-level check (a resource
    // already below its floor), we compute the per-turn net flow against the
    // previous turn's stock snapshot. A resource bleeding faster than
    // SCARCITY_FLOW_THRESHOLDS counts as "strained" even while its stock is
    // still fine — a leading indicator that the economy is heading for a
    // shortfall. The worst-draining resource is recorded so the settler block
    // biases found-spot selection toward that resource's terrain.
    const stock = res || {};
    const prev = (aiState && aiState.prevStock) ? aiState.prevStock : null;
    const scarcity = computeScarcity(stock, prev, SCARCITY_FLOW_THRESHOLDS);
    const { scarce, drainingResource, flow } = scarcity;
    if (aiState) {
        aiState.prevStock = { gold: stock.gold || 0, food: stock.food || 0, wood: stock.wood || 0, iron: stock.iron || 0 };
        aiState.lastFlow = flow;
        aiState.drainingResource = drainingResource;
    }
    const prevScarce = (aiState && aiState.settlerScarcityTurns) || 0;
    const scarcityStreak = scarce >= 2 ? prevScarce + 1 : Math.max(0, prevScarce - 1);
    if (aiState) aiState.settlerScarcityTurns = scarcityStreak;
    const scarcityTriggered = scarcityStreak >= AI_SETTLER_SCARCITY_TURN_THRESHOLD;
    const settlerUrgency = scarcityTriggered ? 3.0
        : scarce >= 2 ? 2.0
        : scarce >= 1 ? 1.5
        : 1.0;
    const settlerTarget = Math.round(Math.max(AI_SETTLER_TARGET, Math.round(GRID_SIZE / 3)) * SETTLER_AGGRESSION * settlerUrgency);

    // Long-term expansion drive: evaluate how desirable the surrounding land is
    // for founding new cities (available open spots, scarce resources, allied
    // proximity, weak enemy presence). Drives a turns-1-50 settler boost that
    // is stronger when there is good land to grab and fades as the map fills.
    const settleDesirability = evaluateSettleDesirability(tiles, owner, land, homeMass, resources, diploState, units, factionDef, drainingResource);
    // Turn-window boost strength: strongest early (also 50), decays linearly to
    // zero by turn 51, scaled by how good the surrounding spots actually are.
    const boostActive = currentTurn > 0 && currentTurn <= 50 && settleDesirability.score > 0.25;
    const boostStrength = boostActive ? Math.max(0, (50 - currentTurn) / 50) * settleDesirability.score : 0;
    // Settler urgency multiplier from the long-term land-grab boost.
    const settlerBoostMult = 1 + boostStrength * 2.5;

    // Goal-sequence selection (see src/ai_goals.js). Runs before the spending
    // blocks so they can weight themselves on the chosen goals. Goals persist
    // in aiState across turns (stability) so plans don't thrash; the dominant
    // goal being invalidated (e.g. a war ending) forces a replan regardless.
    const ownCitiesArr = owned.filter(t => t.terrain === 'CITY').map(t => ({ x: t.x, z: t.z }));
    const enemyCitiesArr = [];
    for (const t of tiles.values()) {
        if (t.terrain === 'CITY' && t.owner !== owner) {
            // Include at-war enemy cities AND neutral (unclaimed) cities.
            // Neutral cities are always valid conquest targets — no diplomacy
            // needed, just walk up and capture.
            if (!t.owner || isAtWar(t.owner)) {
                enemyCitiesArr.push({ x: t.x, z: t.z, owner: t.owner, neutral: !t.owner });
            }
        }
    }
    const homeAnchor = firstCity ? { x: firstCity.x, z: firstCity.z } :
        (owned.length ? { x: owned[0].x, z: owned[0].z } : null);
    // Threatened own city for the defense goal: any own city with at-war enemy
    // military within 6 tiles (mirrors detectActiveObjectives' defensive check).
    let threatenedOwnCity = null;
    if (activeObjectives.defensive) {
        const enemyMilPos = [];
        for (const u of units.values()) {
            if (u.owner !== owner && isAtWar(u.owner) &&
                !['SETTLER', 'WORKER', 'SCOUT'].includes(u.type)) enemyMilPos.push(u);
        }
        let best = null, bestD = Infinity;
        for (const c of ownCitiesArr) {
            let near = Infinity;
            for (const e of enemyMilPos) {
                const d = Math.abs(e.x - c.x) + Math.abs(e.z - c.z);
                if (d < near) near = d;
            }
            if (near <= 6 && near < bestD) { bestD = near; best = c; }
        }
        threatenedOwnCity = best;
    }
    // Compute a fresh settle target for the goal system each turn. The old
    // cached lastTileKey from the previous turn could point to a captured/claimed
    // tile, causing the AI to chase a stale spot forever (the "settler stubbornness"
    // bug). Instead, use the first idle settler (or first city) to find the best
    // fresh found spot on the home landmass.
    let freshFoundSpotKey = null;
    if (homeMass != null) {
        const idleSettler = myUnits.find(u => u.type === 'SETTLER' && !acted.has(u.id));
        const probe = idleSettler || firstCity;
        if (probe) {
            const spot = findFoundSpot(probe, tiles, owner, land, homeMass, myUnits, factionDef, res);
            if (spot) freshFoundSpotKey = `${spot.x},${spot.z}`;
        }
    }

    // Compute an overseas settlement candidate for the expand-islands goal. If
    // no valid foreign found spot exists, the goal becomes invalid and the AI
    // pivots to naval conquest (transport + siege invasion) instead of spamming
    // settlers that have nowhere to go.
    let foreignShoreKey = null;
    if (homeMass != null) {
        const idleSettler = myUnits.find(u => u.type === 'SETTLER' && !acted.has(u.id));
        const probe = idleSettler || firstCity;
        if (probe) {
            const friendlyMasses = new Set();
            for (const t of tiles.values()) {
                if (t.terrain === 'CITY' && t.owner === owner) {
                    const m = land.idOf.get(`${t.x},${t.z}`);
                    if (m != null) friendlyMasses.add(m);
                }
            }
            // Evaluate foreign masses by size (descending) so the AI targets the
            // largest viable overseas landmass rather than a barren rock. Storm
            // Kingdom ignores islets below the threshold so it invades instead.
            const foreignMasses = [...land.sizes.entries()]
                .filter(([m, size]) => m !== homeMass && !friendlyMasses.has(m) && size >= stormMinForeignMass)
                .sort((a, b) => b[1] - a[1]);
            for (const [m] of foreignMasses) {
                const spot = findFoundSpot(probe, tiles, owner, land, m, myUnits, factionDef, res,
                    true, drainingResource, enemies.length > 0);
                if (spot) { foreignShoreKey = `${spot.x},${spot.z}`; break; }
            }
        }
    }

    // Compute new context fields for the expanded goal system.
    // Neutral factions: factions we're not at war with (for diplomacy goal).
    const neutralFactions = new Set();
    for (const [key, rel] of Object.entries(diploState?.relations || {})) {
        if (rel.state === DIPLOMACY_STATES.NEUTRAL || rel.state === DIPLOMACY_STATES.TRADE_PACT) {
            const [a, b] = key.split(':');
            if (a === owner) neutralFactions.add(b);
            else if (b === owner) neutralFactions.add(a);
        }
    }
    // Spy presence: does the faction have any SPY units.
    const hasSpies = myUnits.some(u => u.type === 'SPY');
    // Chokepoints: check for PASS terrain or river bridges near owned territory.
    let hasChokepoints = false;
    let chokepointKey = null;
    for (const t of tiles.values()) {
        if (t.terrain === 'PASS' || (t.terrain === 'RIVER' && t.bridge)) {
            // Near owned territory (within 6 tiles of an owned tile).
            for (const o of owned) {
                if (manhattan(t.x, t.z, o.x, o.z) <= 6) {
                    hasChokepoints = true;
                    chokepointKey = `${t.x},${t.z}`;
                    break;
                }
            }
            if (hasChokepoints) break;
        }
    }
    // Unexplored tiles: unowned land tiles NOT adjacent to any owned or
    // visible-enemy tile (a proxy for the fog-of-war frontier). Counting every
    // unowned tile inflated this counter and kept the scout goal running
    // pointlessly in the late game; excluding tiles next to known territory
    // restricts scouting to genuinely unexplored regions.
    let unexploredTiles = 0;
    for (const t of tiles.values()) {
        if (t.owner) continue;
        if (t.terrain === 'WATER' || t.terrain === 'MOUNTAIN') continue;
        let known = false;
        for (let dx = -1; dx <= 1 && !known; dx++) {
            for (let dz = -1; dz <= 1 && !known; dz++) {
                if (dx === 0 && dz === 0) continue;
                const nt = tiles.get(`${t.x + dx},${t.z + dz}`);
                if (nt && nt.owner) known = true;
            }
        }
        if (!known) unexploredTiles++;
    }
    // Spy target: nearest enemy city tile key (for spy goal).
    let spyTargetKey = null;
    if (enemyCitiesArr.length > 0 && homeAnchor) {
        let best = null, bestD = Infinity;
        for (const c of enemyCitiesArr) {
            const d = manhattan(homeAnchor.x, homeAnchor.z, c.x, c.z);
            if (d < bestD) { bestD = d; best = c; }
        }
        if (best) spyTargetKey = `${best.x},${best.z}`;
    }

    // Build the exposed-enemy-king list for the attack-king goal. A king is
    // "exposed" when no friendly unit shares its tile (no bodyguard) and
    // "vulnerable" when exposed AND wounded or locally outpowered (see
    // isKingVulnerable). Vulnerability is recomputed every turn so the goal
    // system drops attack-king as soon as the king turtles up.
    const enemyKings = (lords || [])
        .filter(l => l.owner !== owner && l.isKing && enemies.includes(l.owner))
        .map(l => {
            const guarded = [...units.values()].some(u => u.owner === l.owner && u.x === l.x && u.z === l.z);
            // Local power near the king (units only) + the king's own HP as
            // extra defender power.
            const bal = localPowerBalance(units, l.x, l.z, owner, atWar, isAtWar, 3);
            const king = {
                id: l.id, owner: l.owner, isKing: true,
                x: l.x, z: l.z, hp: l.hp || 1, maxHp: l.maxHp || l.hp || 1,
                guarded,
            };
            king.vulnerable = isKingVulnerable(king, bal.friend, bal.foe + (l.hp || 1));
            return king;
        });

    const goals = selectGoals({
        aiState, turn: currentTurn || (aiState ? aiState.lastPlanTurn : 0), factionDef,
        enemies, enemyCities: enemyCitiesArr, ownCities: ownCitiesArr, homeAnchor,
        activeObjectives, threatenedOwnCity,
        isIslandFaction, needsNavalExpansion, foreignMassWithoutCity,
        myCityCount, settlerTarget, scarcityTriggered,
        bestFoundSpotKey: freshFoundSpotKey,
        foreignShoreKey, bestEconTileKey: null,
        neutralFactions, hasSpies, hasChokepoints,
        unexploredTiles, spyTargetKey, chokepointKey,
        enemyKings,
        tiles, myUnits,
        gold: (resources && resources.gold) || 0,
        enemyUnits: [...units.values()].filter(u => u.owner !== owner && enemies.includes(u.owner)),
    });
    if (aiState) aiState.goals = goals;
    const topGoal = goals[0] || null;
    const hasGoal = (kind) => goals.some(g => g.kind === kind);
    const goalKind = topGoal ? topGoal.kind : null;

    // 0. CAPTURE FIRST. Any unit already adjacent to a breached (fortification 0)
    //    capturable city takes it NOW — before gold is spent on training or
    //    buildings. Without this, the training spree below drains the treasury
    //    under CAPTURE_COST every turn and the AI breaches cities it can never
    //    afford to take (the "breach but never capture" bug). Capture actions
    //    are emitted first so they execute before any spending.
    const claimedCityKeys = new Set();
    for (const unit of myUnits) {
        if (unit.hasMovedThisTurn) continue;
        const cap = findAdjacentCapturable(unit, tiles, owner, res, isAtWar, units, currentTurn);
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
    // Gold available for capture decisions this turn, snapshotted BEFORE the
    // spending blocks below drain the treasury. The breached-city detachment
    // (block 5d) gates on this: detaching costs nothing now — the capture is
    // paid later by the block-0 pre-pass, which always runs before spending.
    const goldBeforeSpending = res.gold || 0;

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

    // AI lord recruitment: lords multiply army effectiveness. Cap scales with
    // cities and owned land tiles but stays much lower than the old max(cities,3)
    // to prevent lord spam. Recruiting also requires a small war-chest buffer so
    // the faction doesn't bankrupt itself hiring lords.
    const nonKingLords = (lords || []).filter(l => l.owner === owner && !l.isKing);
    const ownedLandTiles = owned.filter(t => t.terrain !== 'WATER' && t.terrain !== 'RIVER').length;
    const lordCap = Math.min(6, Math.max(2, Math.floor(myCityCount * 0.5) + Math.floor(ownedLandTiles / 30)));
    if (nonKingLords.length < lordCap && res.gold >= LORD_RECRUIT_COST.gold + 50 &&
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
    //      objective builds a bridge now — BEFORE the unit-training spree drains
    //      the treasury. The cost is reserved (subtracted from `res`) so later
    //      spending can't starve it. This is the AI's only way across rivers;
    //      without it engineers stop at the bank and armies never reach enemy
    //      cities across water. At war the objective is an enemy city; at peace
    //      a settler in the field makes bridging serve expansion too.
    const hasSettler = myUnits.some(u => u.type === 'SETTLER');
    for (const unit of myUnits) {
        if (unit.type !== 'ENGINEER' || unit.hasAttackedThisTurn) continue;
        if (!canAffordCost(res, BRIDGE_COST)) break; // out of funds — stop trying
        const river = findBridgeTarget(unit, tiles, owner, isAtWar, atWar, hasSettler);
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
            const coastal = findBuildSite('HARBOR', owned, buildings, tiles);
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
    //     and no Siege Workshop) that is at war — or actively pursuing a conquest
    //     goal — MUST get a Siege Workshop first. Without it (or engineers) it can
    //     never breach a fortified city and falls back to cavalry spam (the Golden
    //     Horde symptom). Build the workshop before Barracks in that case, and
    //     reserve its cost so the spending spree can't starve it.
    //     A develop-army goal counts like conquest here: military infrastructure
    //     comes ahead of economy buildings while the faction builds up.
    const wantsConquest = atWar || goalKind === 'conquest' || goalKind === 'develop-army';
    const needsSiegeWorkshopFirst = wantsConquest && !hasTrainableSiege && !hasSiegeWorkshop && myCityCount >= 1;
    let workshopSiteFound = false;
    if (needsSiegeWorkshopFirst) {
        const site = findBuildSite('SIEGE_WORKSHOP', owned, buildings, tiles);
        if (site) {
            workshopSiteFound = true;
            const swCost = BUILDING_TYPE.SIEGE_WORKSHOP.cost;
            if (canAffordBuilding('SIEGE_WORKSHOP', res)) {
                actions.push({ type: 'build', buildingType: 'SIEGE_WORKSHOP', tileKey: `${site.x},${site.z}` });
                res = payBuilding('SIEGE_WORKSHOP', res);
            } else {
                // Can't afford yet — reserve the funds so later spending this
                // turn doesn't push the workshop further out of reach.
                res = subtractCost(res, swCost);
            }
        }
        // If the workshop site wasn't found (tech not yet researched), fall
        // through to build Barracks anyway — the workshop will be built later
        // when SIEGE_CRAFT is researched. Without this fallback, the AI
        // builds NOTHING military and the spending spree drains resources.
    }

    if (!hasBarracks && (!needsSiegeWorkshopFirst || !workshopSiteFound)) {
        const site = findBuildSite('BARRACKS', owned, buildings, tiles);
        if (site && canAffordBuilding('BARRACKS', res)) {
            actions.push({ type: 'build', buildingType: 'BARRACKS', tileKey: `${site.x},${site.z}` });
            res = payBuilding('BARRACKS', res);
        }
    }

    // 1a. Build a Siege Workshop in a city (unlocks CATAPULT/TREBUCHET —
    //     long-range AOE siege). One is enough. AI builds this proactively (not
    //     just when at war) to prepare for future conflicts, and prioritizes it
    //     harder under a conquest goal so no-siege-roster factions (Golden, etc.)
    //     unlock artillery even before the first war declaration. (When at war
    //     and lacking siege it was already built above, before Barracks.)
    //     Also runs when needsSiegeWorkshopFirst was true but the tech gate
    //     prevented finding a site earlier (SIEGE_CRAFT not yet researched).
    if (!hasSiegeWorkshop && myCityCount >= 1 && (!needsSiegeWorkshopFirst || !workshopSiteFound)) {
        const site = findBuildSite('SIEGE_WORKSHOP', owned, buildings, tiles);
        if (site) {
            if (canAffordBuilding('SIEGE_WORKSHOP', res)) {
                actions.push({ type: 'build', buildingType: 'SIEGE_WORKSHOP', tileKey: `${site.x},${site.z}` });
                res = payBuilding('SIEGE_WORKSHOP', res);
            } else if (!hasTrainableSiege) {
                // No-siege-roster faction (Verdant, Golden, Storm): the Siege
                // Workshop is the ONLY path to CATAPULT/TREBUCHET, so it's a
                // key military structure. At peace the spending spree would
                // otherwise drain gold and delay it indefinitely. Reserve its
                // cost so it gets built before too long.
                res = subtractCost(res, BUILDING_TYPE.SIEGE_WORKSHOP.cost);
            }
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

    // 1af. MARKET — always useful for gold income, but especially
    //      important for economic victory. Built on an influence tile (not the
    //      city tile, which is reserved for WALLS). Build one per turn if affordable.
    const vt = aiState && aiState.victoryTarget;
    const hasMarket = owned.some(t => (buildings.get(`${t.x},${t.z}`) || []).includes('MARKET'));
    if (!hasMarket && myCityCount >= 1) {
        const site = findBuildSite('MARKET', owned, buildings, tiles);
        if (site && canAffordBuilding('MARKET', res)) {
            actions.push({ type: 'build', buildingType: 'MARKET', tileKey: `${site.x},${site.z}` });
            res = payBuilding('MARKET', res);
        }
    }
    // Economic victory: build MARKET on more influence tiles
    if (vt === 'economic' && myCityCount >= 2) {
        const site = findBuildSite('MARKET', owned, buildings, tiles);
        if (site && canAffordBuilding('MARKET', res)) {
            actions.push({ type: 'build', buildingType: 'MARKET', tileKey: `${site.x},${site.z}` });
            res = payBuilding('MARKET', res);
        }
    }

    // 1af. UNIVERSITY — critical for science victory and always useful for
    //      tech advancement. Build a university in EVERY city (one per turn),
    //      not just for science victory. A non-science faction with 4 cities
    //      and 1 university has ~1/4 the research throughput, which is why the
    //      AI never reaches Enlightenment/Modern techs and keeps fielding
    //      medieval rosters. Building universities everywhere lets every faction
    //      actually climb the tech tree.
    {
        for (const t of owned) {
            if (t.terrain !== 'CITY') continue;
            const list = buildings.get(`${t.x},${t.z}`) || [];
            if (list.includes('UNIVERSITY')) continue;
            const site = findBuildSite('UNIVERSITY', owned, buildings, tiles);
            if (site && canAffordBuilding('UNIVERSITY', res)) {
                actions.push({ type: 'build', buildingType: 'UNIVERSITY', tileKey: `${site.x},${site.z}` });
                res = payBuilding('UNIVERSITY', res);
                break; // one per turn
            }
        }
    }

    // 1ae. UPGRADE MILITARY BUILDINGS (Area 6b). When affordable, upgrade the
    //      highest-value frontier military building (Harbor > Siege Workshop >
    //      Barracks) that is below max level. Prioritize buildings on cities that
    //      are near an enemy/neutral city (the front line) so the veteran/cheaper
    //      training actually matters where fighting happens. Only one upgrade per
    //      turn keeps the treasury free for units.
    {
        const militaryTypes = ['HARBOR', 'SIEGE_WORKSHOP', 'BARRACKS'];
        let bestUpg = null, bestUpgScore = -Infinity;
        for (const t of owned) {
            const list = buildings.get(`${t.x},${t.z}`) || [];
            for (const mType of militaryTypes) {
                if (!list.includes(mType)) continue;
                const st = getBuildingState(buildingState, `${t.x},${t.z}`, mType);
                if (st.level >= BUILDING_MAX_LEVEL) continue;
                // SIEGE_WORKSHOP has no level table (only BARRACKS/HARBOR are
                // upgradeable) — skip it rather than crashing on the lookup.
                if (!MILITARY_BUILDING_LEVELS[mType]) continue;
                const next = MILITARY_BUILDING_LEVELS[mType][st.level];
                if (!next || !next.upgradeCost) continue;
                if (!canAffordBuilding(mType, res)) continue;
                // Only upgrade if we can actually pay the upgrade cost now.
                let affordUp = true;
                for (const [r, a] of Object.entries(next.upgradeCost)) {
                    if ((res[r] || 0) < a) { affordUp = false; break; }
                }
                if (!affordUp) continue;
                // Front-line bonus: closer to an enemy/neutral city = higher priority.
                let frontBonus = 0;
                for (const o of tiles.values()) {
                    if (o.terrain !== 'CITY' || !o.owner || o.owner === owner) continue;
                    if (isAtWar && !isAtWar(o.owner)) continue;
                    const d = Math.abs(o.x - t.x) + Math.abs(o.z - t.z);
                    if (d <= 10) frontBonus += (10 - d) * 2;
                }
                const typeBonus = mType === 'HARBOR' ? 30 : mType === 'SIEGE_WORKSHOP' ? 20 : 10;
                const score = typeBonus + frontBonus;
                if (score > bestUpgScore) { bestUpgScore = score; bestUpg = { mType, tile: t }; }
            }
        }
        if (bestUpg) {
            // Reserve the upgrade cost in the planning copy so later spending
            // this turn can't starve the upgrade; the engine re-validates and
            // applies it via the 'upgradeBuilding' action below.
            const st = getBuildingState(buildingState, `${bestUpg.tile.x},${bestUpg.tile.z}`, bestUpg.mType);
            const next = MILITARY_BUILDING_LEVELS[bestUpg.mType][st.level];
            if (next && next.upgradeCost) res = subtractCost(res, next.upgradeCost);
            actions.push({ type: 'upgradeBuilding', buildingType: bestUpg.mType, tileKey: `${bestUpg.tile.x},${bestUpg.tile.z}` });
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
    // Count real siege engines only. ENGINEERs and SIEGE_TOWERs are a means
    // to build/breach — not siege units themselves — so counting them here
    // used to crowd out CATAPULT/TREBUCHET for no-siege-roster factions (their
    // engineer count alone could satisfy the siege cap and skip block 1b).
    // The factionComposition `has('siege')` guard already prevents the
    // cavalry fallthrough that engineer-counting was originally added to
    // solve, so it is safe to count only actual siege engines here.
    const siegeCount = myUnits.filter(u => u.type === 'SIEGE' || u.type === 'ARTILLERY' ||
        u.type === 'CATAPULT' || u.type === 'TREBUCHET' ||
        u.type === 'CANNON' || u.type === 'MORTAR' || u.type === 'FIELD_GUN' ||
        u.type === 'HORSE_ARTILLERY' || u.type === 'SIEGE_CANNON' || u.type === 'RAILGUN').length;
    const engineerCount = myUnits.filter(u => u.type === 'ENGINEER').length;
    // Siege-only units (SIEGE) require a Siege Workshop — they're city-breachers,
    // not field combat units. CATAPULT/TREBUCHET are also workshop-gated but
    // provide AOE splash, making them far more useful in the field.
    const siegeOptions = roster.filter(t => (t === 'SIEGE' && hasSiegeWorkshop) || t === 'ARTILLERY' ||
        t === 'CANNON' || t === 'MORTAR' || t === 'FIELD_GUN' ||
        t === 'HORSE_ARTILLERY' || t === 'SIEGE_CANNON' || t === 'RAILGUN');
    if (hasSiegeWorkshop) {
        if (aiUnlocked.has('CATAPULT')) siegeOptions.push('CATAPULT');
        if (aiUnlocked.has('TREBUCHET')) siegeOptions.push('TREBUCHET');
    }
    // Obsolescence: this block reads the raw faction roster and aiUnlocked —
    // not the obsolescence-filtered fullRoster — so drop siege types whose
    // modern replacement is researched (CATAPULT/TREBUCHET/SIEGE once
    // GUNPOWDER is done, ARTILLERY once METALLURGY is done).
    const siegeOptionsFiltered = applyObsolescence(siegeOptions, aiTs && aiTs.researched);
    siegeOptions.length = 0;
    for (const u of siegeOptionsFiltered) siegeOptions.push(u);
    // Composition-aware siege cap: the siege ratio depends on the army's
    // current objective. A faction actively besieging an enemy city fields
    // more siege; a decisive field battle or home defense wants fewer siege
    // engines; otherwise a baseline. Siege is boosted further when the
    // enemy army is weak to siege (cavalry-heavy → artillery bonus).
    const conquestActive = goalKind === 'conquest' || activeObjectives.siege;
    // Detect enemy army weakness to siege: ARTILLERY is strongAgainst CAVALRY
    // (1.4x multiplier), so a cavalry-heavy enemy is vulnerable to siege.
    let enemyWeakToSiege = false;
    if (enemies && enemies.length > 0) {
        let enemyCav = 0, enemyTotal = 0;
        for (const u of units.values()) {
            if (u.owner === owner || !enemies.includes(u.owner)) continue;
            const r = unitRole(u.type);
            if (r === 'cavalry' || r === 'melee') enemyCav++;
            if (r !== 'support') enemyTotal++;
        }
        if (enemyTotal > 0 && enemyCav / enemyTotal >= 0.40) enemyWeakToSiege = true;
    }
    const siegeRatio = activeObjectives.siege ? 0.50
        : goalKind === 'conquest' ? 0.50
        : enemyWeakToSiege ? 0.35
        : activeObjectives.decisive ? 0.15
        : activeObjectives.defensive ? 0.18
        : 0.30;
    const siegeCap = Math.max(conquestActive ? 4 : 3,
        Math.round(aiUnitCap * siegeRatio));
    if (siegeOptions.length && siegeCount < siegeCap) {
        // Prefer modern siege engines over obsolete ones. bestSiegePick
        // ranks by tech era (SIEGE_CANNON > CANNON > TREBUCHET etc) then
        // by cost, so the AI upgrades to modern siege automatically.
        let pick = bestSiegePick(siegeOptions, factionDef);
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

    // 1b2. Artillery reservation. Even when basic siege (SIEGE/ARTILLERY) has
    //      saturated the siege cap above, the AI must still field long-range
    //      siege engines — using the best available (modern or medieval). A
    //      dedicated slice of the unit cap is reserved for them
    //      (AI_ARTILLERY_RESERVE_*), raised when an active siege/conquest is
    //      in progress. This runs after the main siege block so it tops up
    //      artillery independently of it.
    if (hasSiegeWorkshop) {
        const artilleryOptions = ['CATAPULT', 'TREBUCHET'].filter(t => fullRoster.includes(t));
        // Also include modern siege types if they are in the roster
        for (const mt of ['SIEGE_CANNON', 'RAILGUN', 'FIELD_GUN', 'CANNON', 'MORTAR', 'HORSE_ARTILLERY']) {
            if (fullRoster.includes(mt) && !artilleryOptions.includes(mt)) artilleryOptions.push(mt);
        }
        if (artilleryOptions.length) {
            const artilleryReserve = (activeObjectives.siege || goalKind === 'conquest')
                ? AI_ARTILLERY_RESERVE_SIEGE
                : AI_ARTILLERY_RESERVE_DEFAULT;
            const artilleryCap = Math.max(1, Math.round(aiUnitCap * artilleryReserve));
            const artilleryCount = myUnits.filter(u => SIEGE_ERA_RANK[u.type] != null).length +
                actions.filter(a => a.type === 'train' && SIEGE_ERA_RANK[a.unitType] != null).length;
            if (artilleryCount < artilleryCap && capRoom()) {
                const pick = bestSiegePick(artilleryOptions, factionDef);
                if (pick) {
                    const sc = getUnitCostFor(pick, factionDef);
                    if (canAfford(pick, res, sc)) {
                        const workshopCity = owned.find(t => t.terrain === 'CITY' &&
                            (buildings.get(`${t.x},${t.z}`) || []).includes('SIEGE_WORKSHOP'));
                        const spawnTile = workshopCity || findOwnedTile(myUnits, tiles, actions, owner);
                        if (spawnTile) {
                            actions.push({ type: 'train', unitType: pick, tileKey: `${spawnTile.x},${spawnTile.z}` });
                            res = spendCost(pick, res, sc);
                        }
                    }
                }
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
        // Engineer cap: a meaningful corps that scales with empire size and
        // rises at war. Factions with no trainable siege rely on
        // engineers/towers as their ONLY siege path, so they keep a larger
        // corps. Hard-capped at 4: the bonuses below (war 3 + conquest 2 +
        // water 2 + bridges 1) used to stack with no ceiling, producing
        // 7+ engineers — a whole support army that crowds out combat units
        // (support's composition target is only ~5-15%).
        const noRosterSiege = !roster.some(t => t === 'SIEGE' || t === 'ARTILLERY');
        let engCap = Math.max(
            atWar ? (hasTrainableSiege ? Math.max(3, Math.ceil(myCityCount / 2))
                                       : Math.max(5, Math.ceil(myCityCount / 2)))
                  : (noRosterSiege ? Math.max(3, Math.ceil(myCityCount / 2))
                                   : Math.max(2, Math.ceil(myCityCount / 2))),
            2);
        if (goalKind === 'conquest') engCap += 2;
        // Raise the engineer cap when unbridged rivers or water block our
        // conquest path — a faction that needs to bridge rivers or cross water
        // needs more engineers (bridges) and the ability to build siege
        // structures on the far shore.
        if (goalKind === 'conquest' && topGoal && topGoal.targetTileKey && homeAnchor) {
            const [tx, tz] = topGoal.targetTileKey.split(',').map(Number);
            if (pathCrossesWater(tiles, homeAnchor.x, homeAnchor.z, tx, tz)) {
                engCap += 2;
            }
        }
        const hasEngineer = myUnits.some(u => u.type === 'ENGINEER');
        if (hasEngineer) {
            const needsBridges = [...tiles.values()].some(t =>
                t.terrain === 'RIVER' && !t.bridge &&
                manhattan(myUnits.find(u => u.type === 'ENGINEER').x,
                          myUnits.find(u => u.type === 'ENGINEER').z, t.x, t.z) < 10);
            if (needsBridges) engCap += 1;
        }
        engCap = Math.min(engCap, 4);
        // Modern siege retires the engineer siege corps: towers are gated off
        // and SIEGE_TOWER/ENGINEER leave the roster (OBSOLESCENCE). Keep at
        // most one engineer for bridge duty when an unbridged river sits near
        // our cities; otherwise train none — artillery does the sieging now.
        if (hasModernSiegeTech) {
            const riverNearCity = [...tiles.values()].some(t => {
                if (t.terrain !== 'RIVER' || t.bridge) return false;
                return [...tiles.values()].some(c =>
                    c.terrain === 'CITY' && c.owner === owner &&
                    manhattan(c.x, c.z, t.x, t.z) <= 12);
            });
            engCap = Math.min(engCap, riverNearCity ? 1 : 0);
        }
        // Engineer-type training: prefer the modern upgrade (COMBAT_ENGINEER
        // once INTERNAL_COMBUSTION is researched, else DEMOLITION_SQUAD once
        // EXPLOSIVES is researched) over the basic ENGINEER. The modern
        // variants keep the bridge/structure utility the AI relies on, with
        // better combat stats. Obsolescence already hides the old ones from
        // the roster, but this block trains engineers directly (not via the
        // roster) so it needs its own modern-first pick.
        const engineerUnitType = aiUnlocked.has('COMBAT_ENGINEER') ? 'COMBAT_ENGINEER'
            : aiUnlocked.has('DEMOLITION_SQUAD') ? 'DEMOLITION_SQUAD'
            : 'ENGINEER';
        const engNow = myUnits.filter(u => UNIT_TYPE[u.type] && UNIT_TYPE[u.type].canBuildBridge && UNIT_TYPE[u.type].canBuildStructure).length +
            actions.filter(a => a.type === 'train' && a.unitType === engineerUnitType).length;
        if (engNow < engCap && capRoom()) {
            const ec = getUnitCostFor(engineerUnitType, factionDef);
            if (canAfford(engineerUnitType, res, ec)) {
                const spawnTile = findOwnedTile(myUnits, tiles, actions, owner);
                if (spawnTile) {
                    actions.push({ type: 'train', unitType: engineerUnitType, tileKey: `${spawnTile.x},${spawnTile.z}` });
                    res = spendCost(engineerUnitType, res, ec);
                }
            } else if (engNow < 1) {
                // No engineers at all yet: reserve the cost so the spending
                // spree can't keep pushing the first engineer out of reach
                // (engineers cost iron, which iron-poor factions never stock).
                res = subtractCost(res, ec);
            }
        }
    }

    // 1d. HARBOR fallback. The early build (0h) already handles island/expand-
    //     needed factions before the spending spree. This catches the general
    //     case: a faction with a couple of cities or a Barracks that can afford a
    //     harbor for coastal defense / future naval use. Also covers
    //     needsNavalExpansion if 0h couldn't find a coastal city at the time.
    //     When a conquest target is across water, build a harbor proactively so
    //     transports can ferry the army.
    {
        const hasHarbor = owned.some(t => (buildings.get(`${t.x},${t.z}`) || []).includes('HARBOR'));
        if (!hasHarbor) {
            // Check if conquest target is across water — need a harbor for
            // transports. Prefer the goal's reachability metadata (set by the
            // new BFS-based classifier) over the naive line-trace.
            const conquestAcrossWater = goalKind === 'conquest' && topGoal &&
                topGoal.targetFaction && topGoal.targetTileKey && homeAnchor &&
                ((topGoal.meta && topGoal.meta.requiresNaval) ||
                 pathCrossesWater(tiles, homeAnchor.x, homeAnchor.z,
                    ...topGoal.targetTileKey.split(',').map(Number)));
            const coastal = findBuildSite('HARBOR', owned, buildings, tiles);
            if (coastal && canAffordBuilding('HARBOR', res) &&
                (isIslandFaction || needsNavalExpansion || goalKind === 'expand-islands' ||
                 conquestAcrossWater ||
                 myCityCount >= 2 || hasBarracks)) {
                actions.push({ type: 'build', buildingType: 'HARBOR', tileKey: `${coastal.x},${coastal.z}` });
                res = payBuilding('HARBOR', res);
                queuedHarbors.add(`${coastal.x},${coastal.z}`);
            }
        }
    }

    // 1e. Critical-build starvation: a high-priority build order (HARBOR for
    //     naval expansion / cross-water conquest, SIEGE_WORKSHOP for conquest)
    //     that can't be afforded because a resource isn't accumulating (net
    //     flow <= 0 — a trebuchet eating all the wood on a woodless island)
    //     would sit in the build order forever. Disband one unit whose upkeep
    //     consumes the missing resource so the stock can accumulate. Never
    //     disbands specialists or drops the army below 2 units.
    {
        const flow = (aiState && aiState.lastFlow) || {};
        const harborOwned = owned.some(t => (buildings.get(`${t.x},${t.z}`) || []).includes('HARBOR'));
        const conqAcrossWater = goalKind === 'conquest' && topGoal && topGoal.meta && topGoal.meta.requiresNaval;
        const needsHarborNow = !harborOwned && (isIslandFaction || needsNavalExpansion ||
            goalKind === 'expand-islands' || conqAcrossWater);
        const needsWorkshopNow = !hasSiegeWorkshop && wantsConquest && myCityCount >= 1;
        const criticals = [];
        if (needsHarborNow && findBuildSite('HARBOR', owned, buildings, tiles)) criticals.push('HARBOR');
        if (needsWorkshopNow && findBuildSite('SIEGE_WORKSHOP', owned, buildings, tiles)) criticals.push('SIEGE_WORKSHOP');
        for (const bType of criticals) {
            // Check affordability against the turn's ORIGINAL stock, not the
            // spending-dwindled `res` — the question is "can this build ever
            // be afforded", not "is anything left after this turn's spree".
            if (canAffordBuilding(bType, resources)) break; // affordable — no starvation
            const cost = BUILDING_TYPE[bType].cost;
            const missing = Object.entries(cost)
                .filter(([r, amt]) => (resources[r] || 0) < amt && (flow[r] || 0) <= 0)
                .map(([r]) => r);
            if (!missing.length) continue;
            // The missing resource can't accumulate on its own — free up its
            // upkeep by disbanding the cheapest unit that consumes it (the
            // frost-clan trebuchet eating the harbor's wood).
            const candidate = myUnits
                .filter(u => !['SETTLER', 'WORKER', 'ENGINEER', 'SCOUT'].includes(u.type) && !isNaval(u))
                .filter(u => {
                    const up = UNIT_TYPE[u.type] && UNIT_TYPE[u.type].upkeep;
                    return up && missing.some(r => (up[r] || 0) > 0);
                })
                .sort((a, b) => unitValue(a) - unitValue(b))[0];
            if (candidate && myUnits.length > 2) {
                actions.push({ type: 'disband', unitId: candidate.id });
                break; // one disband per turn is enough
            }
        }
    }

    // 2. Civ6-style aggressive expansion: train settlers aggressively to
    //     claim territory. Caps are scaled by map size and existing cities, and
    //     by the global SETTLER_AGGRESSION multiplier (data-driven tuning).
    //     When the faction has been short on key resources (gold/wood/iron/food)
    //     for AI_SETTLER_SCARCITY_TURN_THRESHOLD turns running, expansion is the
    //     only durable fix: higher target/cap/per-turn and a relaxed defensive
    //     floor. `settlerUrgency`/`settlerTarget`/`scarcityTriggered` are computed
    //     once before the spending blocks (the goal selector also uses them).
    //     A `settle` goal in the sequence additionally nudges target/cap up.
    //     Under an active conquest goal, settler production is halved so the
    //     treasury and unit cap go to the army instead of sprawl. Resource
    //     scarcity overrides this (expansion is still the durable fix for a
    //     bleeding economy), and a naval conquest goal doesn't suppress settler
    //     production as hard (the faction still needs cities to grow its economy
    //     while the invasion fleet is being built).
    const conquestCampaigning = goalKind === 'conquest' || goalKind === 'take-key-city' || goalKind === 'attack-king';
    const navalConquest = goalKind === 'conquest' && topGoal && topGoal.meta && topGoal.meta.requiresNaval;
    // Spanish are expansion-driven conquerors: their settler production is not
    // suppressed by land conquest goals so Manifest Destiny can fuel new cities.
    const conquestSettlerScale = conquestCampaigning && !navalConquest && !(factionDef && factionDef.id === 'spanish') ? 0.5 : 1.0;
    const settleGoalBoost = hasGoal('settle') ? 1 : 0;
    const hardCapBonus = scarcityTriggered ? AI_SETTLER_SCARCE_CAP_RELAX : 0;
    // Early-game army gating: the AI used to prioritize settlers so heavily
    // that it fielded almost no military for the first ~15 turns, then got
    // rolled by neighbors. A lighter floor still protects a young faction
    // while letting it expand faster when the map is wide open. The boost is
    // preserved for the very first settler (a 1-city faction MUST expand), but
    // additional settlers wait until the army floor is met. Scarcity overrides
    // this — expansion is the durable fix for a bleeding economy.
    const militaryForGating = myUnits.filter(u => u.type !== 'SETTLER' && u.type !== 'WORKER' && u.type !== 'SCOUT' && !isNaval(u)).length;
    const armyFloor = Math.max(2, Math.ceil(myCityCount * 1.5));
    const armyMet = militaryForGating >= armyFloor;
    const earlyGameArmyGate = (!scarcityTriggered && !armyMet && myCityCount >= 1);
    // The turns-1-50 long-term boost scales settler target/cap/per-turn with the
    // quality of the land available (see evaluateSettleDesirability above).
    let settlerTargetEff = Math.round(settlerTarget * (scarcityTriggered ? 1 : conquestSettlerScale) * (boostActive ? settlerBoostMult : 1));
    let settlerCapEff = Math.max(1, Math.round((Math.ceil(myCityCount * AI_SETTLER_CAP_FACTOR) + AI_SETTLER_CAP_BASE) * SETTLER_AGGRESSION * settlerUrgency * (scarcityTriggered ? 1 : conquestSettlerScale) * (boostActive ? settlerBoostMult : 1))) + hardCapBonus + settleGoalBoost;
    // When the army is below floor, collapse the cap to 1 (the first settler
    // only) so production flows to military instead of sprawl.
    if (earlyGameArmyGate) settlerCapEff = 1;
    const settlerCap = settlerCapEff;
    // Stop training settlers entirely when no valid found spot exists on our
    // home landmass — the AI cannot found a city, so training more settlers
    // just wastes resources. Also disband idle settlers that can't found.
    const hasFoundSpot = homeMassHasFoundSpot(tiles, owner, land, homeMass);
    // expand-islands mode: allow extra settlers even when home landmass is full,
    // as long as we have transports to carry them overseas.
    const expandIslandsMode = goalKind === 'expand-islands' && hasFoundSpot === false;
    const liveTransports = expandIslandsMode
        ? myUnits.filter(u => u.type === 'TRANSPORT' || u.type === 'STEAM_TRANSPORT').length
        : 0;
    const expandIslandsExtras = expandIslandsMode && liveTransports > 0 ? Math.min(3, liveTransports + 1) : 0;
    // Long-term boost extras: an early-game land grab (many open spots, good
    // desirability) lifts the hard cap above the default 4 settlers, scaled to
    // how much land is actually there to claim.
    const settleBoostExtras = boostActive ? Math.min(4, Math.round(settleDesirability.openSpots / 5)) : 0;
    const hardCapBonusExtra = hardCapBonus + expandIslandsExtras + settleBoostExtras;
    // Settlers-per-turn is halved under a (non-naval) conquest goal so the AI
    // doesn't sprawl while campaigning. Scarcity overrides this. During the
    // early expansion boost (turns 1-50 with good land) the AI can train up to
    // AI_SETTLERS_PER_TURN settlers per turn; outside the boost it falls back
    // to a baseline of 1/turn so late-game sprawl is controlled.
    const settlersPerTurn = Math.max(1, Math.round((boostActive ? AI_SETTLERS_PER_TURN : 1) * SETTLER_AGGRESSION *
        (scarcityTriggered ? 2 : (settlerUrgency > 1 ? 1.5 : 1)) *
        (boostActive ? Math.max(1, 1 + boostStrength * 3) : 1) *
        (conquestCampaigning && !navalConquest && !scarcityTriggered ? 0.5 : 1)));
    let queuedSettlers = 0;
    const liveSettlersTotal = myUnits.filter(u => u.type === 'SETTLER').length;
    // Stuck-settler check: count live settlers that have no reachable found
    // spot on their own landmass AND no adjacent transport to board. If any are
    // already stuck, training more just wastes resources — they'll mill about
    // indefinitely (the mid-game settler-spam bug: 70-100 turns in, the AI
    // keeps pumping settlers even though every accessible spot is taken).
    // Settlers waiting at shore for a ferry are NOT counted as stuck (the
    // transport just hasn't arrived yet); only truly stranded ones block
    // further production. Scarcity overrides — expansion is still the fix.
    let stuckSettlers = 0;
    if (!scarcityTriggered) {
        for (const u of myUnits) {
            if (u.type !== 'SETTLER' || u.boarded) continue;
            const uMass = land.idOf.get(`${u.x},${u.z}`);
            if (homeMassHasFoundSpot(tiles, owner, land, uMass)) continue;
            const hasTransport = adjacentTransport(u, units, owner) ||
                myUnits.some(t => (t.type === 'TRANSPORT' || t.type === 'STEAM_TRANSPORT') &&
                    t.owner === owner && !t.boarded &&
                    Math.abs(t.x - u.x) + Math.abs(t.z - u.z) <= 6);
            if (!hasTransport) stuckSettlers++;
        }
    }
    while (queuedSettlers < settlersPerTurn && myCityCount < (settlerTargetEff + settleGoalBoost * 2) && capRoom() && fullRoster.includes('SETTLER')) {
        // If there's no valid found spot on our landmass and we have no
        // transport-based expansion opportunity, stop immediately.
        if (!hasFoundSpot && !expandIslandsExtras) break;
        // If settlers are already stranded (no spot, no transport), stop
        // spamming — train military/economy instead.
        if (stuckSettlers > 0 && !scarcityTriggered) break;
        const liveSettlers = myUnits.filter(u => u.type === 'SETTLER').length;
        // Cap settlers: allow extra slots when transports are available for
        // expand-islands — those settlers will board transports and found overseas.
        if (liveSettlers + queuedSettlers >= settlerCap + expandIslandsExtras) break;
        // Hard cap: never keep more than AI_SETTLER_HARD_CAP (+scarcity bonus + expand-islands extras)
        // live+queued settlers so a faction doesn't sprawl uncontrollably.
        if (liveSettlersTotal + queuedSettlers >= AI_SETTLER_HARD_CAP + hardCapBonusExtra) break;
        // A second queued settler requires a defensive floor so the army isn't
        // stripped. The floor is relaxed when resources are scarce (urgency > 1)
        // — claiming resource terrain is worth a slightly thinner garrison —
        // and collapses to a single melee escort when the scarcity trigger fires.
        if (queuedSettlers > 0) {
            const meleeCount = myUnits.filter(u => u.type === 'INFANTRY' || u.type === 'PIKEMAN').length;
            const militaryCount = myUnits.filter(u => u.type !== 'SETTLER' && u.type !== 'WORKER' && u.type !== 'SCOUT').length;
            if (scarcityTriggered) {
                if (meleeCount < AI_SETTLER_SCARCE_FLOOR_RELAX) break;
            } else {
                const floor = (settlerUrgency > 1 || boostActive) ? 2 : 3;
                if (militaryCount < floor || meleeCount < 1) break;
            }
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
    const scoutCap = goalKind === 'expand-islands' ? 3 : 2; // extra scout to spot foreign land
    if (scoutCount < scoutCap && militaryCount >= 4 && capRoom() && fullRoster.includes('SCOUT')) {
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
        // A harbor serves a city from ANY tile in its influence — findBuildSite
        // deliberately places HARBOR on non-city tiles (the city tile is
        // reserved for WALLS/MARKET), and the engine (bestMilitaryLevel) scans
        // the city's whole influence when validating ship training. Mirror that
        // influence scan here; requiring the harbor ON the city tile meant no
        // ships were ever trained once the harbor went up on an influence tile.
        const hasHarborInInfluence = (city) => {
            const cr = cityRadius(city);
            for (let dx = -cr; dx <= cr; dx++) {
                for (let dz = -cr; dz <= cr; dz++) {
                    const k = `${city.x + dx},${city.z + dz}`;
                    if ((buildings.get(k) || []).includes('HARBOR') || queuedHarbors.has(k)) return true;
                }
            }
            return false;
        };
        const needsExpansionFleet = isIslandFaction || needsNavalExpansion || goalKind === 'expand-islands';
        // Also build a fleet when conquest target is across water.
        const conquestAcrossWater = goalKind === 'conquest' && topGoal &&
            topGoal.targetFaction && topGoal.targetTileKey && homeAnchor &&
            ((topGoal.meta && topGoal.meta.requiresNaval) ||
             pathCrossesWater(tiles, homeAnchor.x, homeAnchor.z,
                ...topGoal.targetTileKey.split(',').map(Number)));
        const waitingSettlers = myUnits.filter(u => u.type === 'SETTLER' &&
            !findFoundSpot(u, tiles, owner, land, land.idOf.get(`${u.x},${u.z}`), units)).length;
        // Transport demand, sized by cargo capacity — NOT a flat count
        // of 2 (the old rule stranded 20-unit armies with ~4 cargo
        // slots). Sources: settlers waiting for a found spot, army
        // units tagged for cross-theater ferry (_ferryTo — set in step
        // 5a3, visible here from previous turns), and a slice of the
        // conquest army when its target is across water.
        const waitingFerryArmy = myUnits.filter(u => u._ferryTo).length;

        // Choose the best harbor for launching ships: open-water connectivity
        // dominates, then proximity to the naval target or waiting ferry cargo,
        // then closeness to the faction capital/home anchor.
        function waterBodyInfo(tiles, startKey) {
            const start = tiles.get(startKey);
            if (!start || (start.terrain !== 'WATER' && start.terrain !== 'RIVER')) return { size: 0, open: false };
            const visited = new Set([startKey]);
            const queue = [start];
            let size = 0;
            let open = false;
            const dirs = [[0, 1], [0, -1], [1, 0], [-1, 0]];
            while (queue.length) {
                const cur = queue.pop();
                size++;
                if (cur.x === 0 || cur.z === 0 || cur.x === GRID_WIDTH - 1 || cur.z === GRID_HEIGHT - 1) open = true;
                for (const [dx, dz] of dirs) {
                    const nk = `${cur.x + dx},${cur.z + dz}`;
                    if (visited.has(nk)) continue;
                    const nt = tiles.get(nk);
                    if (!nt || (nt.terrain !== 'WATER' && nt.terrain !== 'RIVER')) continue;
                    visited.add(nk);
                    queue.push(nt);
                }
            }
            return { size, open };
        }
        const harborCandidates = owned.filter(t => t.terrain === 'CITY' && hasHarborInInfluence(t) && isCoastalCity(t, tiles));
        let harborCity = null;
        if (harborCandidates.length > 0) {
            const target = conquestAcrossWater && topGoal && topGoal.targetTileKey
                ? topGoal.targetTileKey.split(',').map(Number) : null;
            const ferryUnits = [];
            if (waitingSettlers > 0 || waitingFerryArmy > 0) {
                for (const u of myUnits) {
                    if (u.type === 'SETTLER' || u._ferryTo) ferryUnits.push(u);
                }
            }
            const scoreHarbor = (city) => {
                let bestConn = 0;
                for (const [dx, dz] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
                    const nt = tiles.get(`${city.x + dx},${city.z + dz}`);
                    if (nt && (nt.terrain === 'WATER' || nt.terrain === 'RIVER')) {
                        const info = waterBodyInfo(tiles, `${nt.x},${nt.z}`);
                        if (info.open) bestConn = Math.max(bestConn, 10000);
                        else bestConn = Math.max(bestConn, Math.min(500, info.size));
                    }
                }
                let score = bestConn * 10;
                if (target) score -= manhattan(city.x, city.z, target[0], target[1]) * 20;
                if (ferryUnits.length > 0) {
                    let minFerryDist = Infinity;
                    for (const u of ferryUnits) minFerryDist = Math.min(minFerryDist, manhattan(city.x, city.z, u.x, u.z));
                    score -= minFerryDist * 5;
                }
                if (homeAnchor) score -= manhattan(city.x, city.z, homeAnchor.x, homeAnchor.z);
                return score;
            };
            harborCity = harborCandidates.sort((a, b) => scoreHarbor(b) - scoreHarbor(a))[0];
        }
        if (harborCity && capRoom()) {
            const navalNow = myUnits.filter(u => isNaval(u)).length +
                actions.filter(a => a.type === 'train' && NAVAL_UNITS.includes(a.unitType)).length;
                // Prefer the modern STEAM_TRANSPORT when STEAM_ENGINE is
                // researched (TRANSPORT is obsolete once STEAM_TRANSPORT is
                // available). Fall back to TRANSPORT for pre-steam factions.
                const modernTransport = aiUnlocked.has('STEAM_TRANSPORT') ? 'STEAM_TRANSPORT' : 'TRANSPORT';
                // Count transports including the modern STEAM_TRANSPORT.
                const transportCount = myUnits.filter(u => u.type === 'TRANSPORT' || u.type === 'STEAM_TRANSPORT').length +
                    actions.filter(a => a.type === 'train' && (a.unitType === 'TRANSPORT' || a.unitType === 'STEAM_TRANSPORT')).length;
                const transportCapacity = (UNIT_TYPE[modernTransport] && UNIT_TYPE[modernTransport].capacity) || 2;
                const ferryDemand = waitingSettlers + waitingFerryArmy +
                    (conquestAcrossWater ? 6 : 0);
                const transportNeed = Math.min(8, Math.ceil(ferryDemand / transportCapacity) +
                    (needsExpansionFleet ? 1 : 0));
                const navalCap = (needsExpansionFleet || conquestAcrossWater)
                    ? Math.max(10, transportNeed + 4)
                    : Math.max(2, transportNeed);
            if (navalNow < navalCap && !(captureClose && (res.gold || 0) < CAPTURE_COST + 20)) {
                // Warship pick: the best unlocked, non-obsolete warship.
                // Previously this defaulted to GALLEY forever — which the
                // executor's obsolescence check then REJECTED once FRIGATE
                // was researched, so no warships were ever built past
                // CARTOGRAPHY. Now it takes the strongest modern warship the
                // faction can afford, falling back down the era ladder.
                const WARSHIP_ORDER = ['AIRCRAFT_CARRIER', 'BATTLESHIP', 'SUBMARINE_II',
                    'DESTROYER', 'MONITOR', 'IRONCLAD_FRIGATE', 'IRONCLAD', 'SUBMARINE',
                    'TORPEDO_BOAT', 'MAN_OF_WAR', 'GALLEON', 'FRIGATE_2', 'FRIGATE',
                    'CORVETTE', 'FROLIC', 'PINNACE', 'GUNBOAT', 'GALLEY'];
                const warshipOptions = applyObsolescence(
                    WARSHIP_ORDER.filter(t => aiUnlocked.has(t)), aiTs && aiTs.researched);
                // Transports first, deterministically, while the quota is
                // unmet — the old 0.7 coin flip diverted a third of hulls to
                // warships even with an army waiting at the shore.
                const transportDeficit = transportNeed - transportCount;
                let pick = null;
                if (transportDeficit > 0) pick = modernTransport;
                else pick = warshipOptions.find(t => canAfford(t, res, getUnitCostFor(t, factionDef))) || null;
                // Tech gate: don't train a ship whose tech hasn't been researched.
                if (pick && !aiUnlocked.has(pick)) {
                    // Fall back to GALLEY (always available via NAVAL_ENGINEERING) if possible.
                    pick = aiUnlocked.has('GALLEY') && !isObsolete('GALLEY', aiTs && aiTs.researched) ? 'GALLEY' : null;
                }
                if (pick) {
                    const pc = getUnitCostFor(pick, factionDef);
                    if (canAfford(pick, res, pc)) {
                        actions.push({ type: 'train', unitType: pick, tileKey: `${harborCity.x},${harborCity.z}` });
                        res = spendCost(pick, res, pc);
                    }
                }
                // Behind on the ferry quota? A second hull may sail out this
                // turn — one transport per turn can't catch up with an army
                // already waiting at the shore.
                if (transportDeficit >= 2 && navalNow + 1 < navalCap && capRoom() &&
                    aiUnlocked.has(modernTransport)) {
                    const pc2 = getUnitCostFor(modernTransport, factionDef);
                    if (canAfford(modernTransport, res, pc2)) {
                        actions.push({ type: 'train', unitType: modernTransport, tileKey: `${harborCity.x},${harborCity.z}` });
                        res = spendCost(modernTransport, res, pc2);
                    }
                }
            }
        }
    }

    // 2d. Train land units from this faction's roster if affordable and below
    //     cap. Keeps a gold buffer when a capture is imminent so the walk-in
    //     capture isn't starved (see step 0). Runs after ships so a small fleet
    //     is guaranteed room before the army fills the cap.
    // Goal-driven composition override: a conquest goal always trains for a
    // siege. The detectActiveObjectives siege flag only fires once the army is
    // already near an enemy city — far too late to shape the buildup — so a
    // faction whose top goal is conquest force-enables the siege tweak. A
    // develop-army goal trains the same way: the whole point is building a
    // siege + high-damage force instead of spamming cheap infantry. A
    // decisive-battle goal force-enables the decisive tweak (melee/cavalry
    // over siege) — the target is the enemy's field army, not its walls.
    const trainObjective = (goalKind === 'conquest' || goalKind === 'develop-army' ||
        (goalKind === 'expand-islands' && factionDef && factionDef.id === 'storm'))
        ? { ...activeObjectives, siege: true }
        : goalKind === 'decisive-battle' ? { ...activeObjectives, decisive: true }
        : activeObjectives;
    // Persist the effective (objective-tweaked) composition target so the AI
    // debug panel can show the target the AI is actually training toward,
    // rather than the untweaked base faction composition.
    if (aiState) aiState.targetComposition = effectiveComposition(factionDef, fullRoster, hasSiegeWorkshop, trainObjective);
    while (myUnits.length + trainCount() < aiUnitCap) {
        if (captureClose && (res.gold || 0) < CAPTURE_COST + 20) break;
        const trainable = findAffordableUnit(res, fullRoster, factionDef, myUnits, actions, owner, trainObjective, hasSiegeWorkshop, aiState, isAtWar);
        if (!trainable) break;
        const spawnTile = findOwnedTile(myUnits, tiles, actions, owner);
        if (!spawnTile) break;
        actions.push({ type: 'train', unitType: trainable, tileKey: `${spawnTile.x},${spawnTile.z}` });
        res = spendCost(trainable, res, getUnitCostFor(trainable, factionDef));
    }

    // 2b2. Theater-defense training: if a theater (e.g. the home landmass) is
    //      under attack, train a few extra combat units in that theater's cities
    //      so the AI doesn't keep building troops on a safe faraway island while
    //      its capital is threatened. Uses an elevated per-theater cap so these
    //      defensive units don't starve the main army.
    const theaterLand = computeLandmasses(tiles);
    const theaters = createTheaters(tiles, owner, theaterLand);
    if (theaters.size > 0) {
        const homeTheater = [...theaters.values()].find(t => t.homeTheater);
        if (homeTheater) {
            // computeTheaterUrgency hasn't run yet, so check directly.
            let enemyOnHome = 0;
            for (const u of units.values()) {
                if (u.owner === owner || !isAtWar(u.owner, owner)) continue;
                if (u.boarded) continue;
                const m = theaterLand.idOf.get(`${u.x},${u.z}`);
                if (m === homeTheater.landmassId) enemyOnHome++;
            }
            if (enemyOnHome > 0) {
                const defCap = Math.min(3, Math.ceil(homeTheater.cityCount * 1.5));
                let defTrained = 0;
                const homeUnits = myUnits.filter(u => {
                    const m = theaterLand.idOf.get(`${u.x},${u.z}`);
                    return m === homeTheater.landmassId;
                }).length;
                while (homeUnits + defTrained < defCap && capRoom() && defTrained < 2) {
                    const defType = findDefensiveUnit(res, fullRoster, factionDef, myUnits, actions, owner, aiState);
                    if (!defType) break;
                    const homeCity = findTheaterCity(tiles, owner, homeTheater.landmassId, theaterLand, actions);
                    if (!homeCity) break;
                    actions.push({ type: 'train', unitType: defType, tileKey: `${homeCity.x},${homeCity.z}` });
                    res = spendCost(defType, res, getUnitCostFor(defType, factionDef));
                    defTrained++;
                }
            }
        }
    }

    // 2c. Workers: train a few if there are improvable owned tiles within a
    //     city's influence that don't yet have their terrain improvement. Cap
    //     at min(2, cityCount) so workers don't crowd out the army (raised to
    //     min(3, cityCount) under a develop-economy goal).
    const workerCount = myUnits.filter(u => u.type === 'WORKER').length;
    const workerCap = Math.max(1, Math.min(hasGoal('develop-economy') ? 3 : 2, myCityCount));
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

    // 3. Economy buildings per turn if affordable (farms/lumbermills/mines/markets).
    //    The build budget is shared with the military-structure builds above
    //    (Barracks/Siege Workshop/Harbor/Walls), so a faction that just raised two
    //    military structures would otherwise get zero economy improvements this
    //    turn. Allow up to 3 builds/turn so economy keeps moving alongside military
    //    construction. The engine enforces affordability per-build, so this only
    //    spends what the treasury can cover.
    for (const t of owned) {
        if (actions.filter(a => a.type === 'build').length >= 3) break;
        if (!canBuildAt(t)) continue;
        const existing = buildings.get(`${t.x},${t.z}`) || [];
        const pick = pickEconomyBuilding(t, existing, res);
        if (pick) {
            // Enforce maxPerCity: count how many of this building type already
            // exist within the parent city's influence radius.
            const maxPer = BUILDING_TYPE[pick] && BUILDING_TYPE[pick].maxPerCity;
            if (maxPer) {
                const pc = findParentCity(tiles, t);
                if (pc) {
                    const cr = cityRadius(pc);
                    let count = 0;
                    for (let dx = -cr; dx <= cr; dx++) {
                        for (let dz = -cr; dz <= cr; dz++) {
                            const list = buildings.get(`${pc.x + dx},${pc.z + dz}`) || [];
                            if (list.includes(pick)) count++;
                        }
                    }
                    if (count >= maxPer) continue;
                }
            }
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

    // 3c. Science Victory Project: when all techs are researched, start building
    //     the space program. Requires resources from SCIENCE_VICTORY_COST.
    if (vt === 'science') {
        const aiTs = aiTechStates && aiTechStates[owner];
        const allTechsResearched = aiTs && aiTs.researched &&
            aiTs.researched.size >= Object.keys(TECHS).length;
        if (allTechsResearched) {
            if (!victoryState) victoryState = { projects: {}, tradeRoutes: {}, scoreSnapshots: {} };
            if (!victoryState.projects) victoryState.projects = {};
            const progress = victoryState.projects[owner] || 0;
            if (progress < SCIENCE_VICTORY_BUILD_TURNS) {
                // Find a city to build the project
                const city = owned.find(t => t.terrain === 'CITY');
                if (city) {
                    const cost = SCIENCE_VICTORY_COST;
                    if ((res.gold || 0) >= cost.gold && (res.food || 0) >= cost.food &&
                        (res.wood || 0) >= cost.wood && (res.iron || 0) >= cost.iron) {
                        res = { ...res, gold: res.gold - cost.gold, food: res.food - cost.food,
                                wood: res.wood - cost.wood, iron: res.iron - cost.iron };
                        actions.push({ type: 'buildSpaceProgram', tileKey: `${city.x},${city.z}` });
                    }
                }
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

    // Naval fleet groups: cluster ships into tactical fleets BEFORE the
    // per-unit ship loop so each ship can consult its group role.
    const navalGroups = buildNavalGroups(myUnits, owner, tiles, isAtWar);
    const shipGroup = new Map();
    for (const ng of navalGroups) {
        for (const u of ng.units) shipGroup.set(u.id, ng);
    }
    const navalGroupObjectives = new Map(); // naval group -> objective tile

    for (const unit of myUnits) {
        // a) Settlers found a city where they stand (if valid) or head toward
        //    a found spot ON THEIR OWN LANDMASS. If the home landmass is full,
        //    they wait at the shore for a Transport to ferry them elsewhere.
        if (unit.type === 'SETTLER') {
            const here = tiles.get(`${unit.x},${unit.z}`);
            if (here && canFoundOn(here, owner, tiles)) {
                actions.push({ type: 'foundCity', unitId: unit.id, tileKey: `${here.x},${here.z}` });
                acted.add(unit.id);
                continue;
            }
            const myMass = land.idOf.get(`${unit.x},${unit.z}`);
            const hasHarbor = owned.some(t => (buildings.get(`${t.x},${t.z}`) || []).includes('HARBOR'));
            // When the faction needs to expand by sea but owns NO coastal city
            // (so can't build a Harbor), founding a coastal city is the only way
            // to unlock naval expansion — boost the coastal preference strongly.
            const hasCoastalCity = owned.some(t => t.terrain === 'CITY' && isCoastalCity(t, tiles));
            const preferCoastal = (isIslandFaction || needsNavalExpansion) && !hasHarbor;
            const coastalDesperate = (needsNavalExpansion || isIslandFaction) && !hasCoastalCity;
            // If the faction needs to expand by sea and a friendly Transport is
            // right here, board it immediately rather than founding on the last
            // marginal home tile — ferrying should begin before the home island
            // is fully saturated so overseas expansion actually happens.
            const needsExpansionFleet = isIslandFaction || needsNavalExpansion;
            if (needsExpansionFleet) {
                const tr = adjacentTransport(unit, units, owner);
                if (tr) {
                    actions.push({ type: 'board', unitId: unit.id, transportId: tr.id });
                    acted.add(unit.id);
                    continue;
                }
            }
            // preferCoastal may be a boolean or a numeric bonus; when the
            // faction has no coastal city at all, pass a large bonus so founding
            // a coastal city wins over inland resource tiles (without this a
            // harborless island faction can never unlock naval expansion).
            const coastalBonus = coastalDesperate ? 400 : (preferCoastal ? 150 : 0);
            const spot = findFoundSpot(unit, tiles, owner, land, myMass, units, factionDef, res, coastalBonus, drainingResource, atWar);
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
            // If the settler is truly stuck — no found spot, no transport,
            // and we already have cities — disband it to free unit cap and
            // recover resources. Keep at least one idle settler in reserve
            // in case a transport arrives next turn.
            const idleSettlers = myUnits.filter(u2 => u2.type === 'SETTLER' && !acted.has(u2.id)).length;
            if (idleSettlers > 1 && myCityCount >= 2 && !needsExpansionFleet) {
                actions.push({ type: 'disband', unitId: unit.id });
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

        // a1b) Workers capture breached cities first, then build terrain
        //      improvements. Any unit walking into a breached city should
        //      capture it — workers included. Check adjacent first (explicit
        //      capture action), then route toward nearby breached cities so
        //      the worker walks in next turn (the game engine's move handler
        //      auto-captures on arrival). Only fall through to improvements
        //      if no capture opportunity exists.
        if (unit.type === 'WORKER') {
            // 1) Adjacent breached city: capture immediately.
            if (!unit.hasMovedThisTurn && !acted.has(unit.id)) {
                const cap = findAdjacentCapturable(unit, tiles, owner, res, isAtWar, units, currentTurn);
                if (cap) {
                    actions.push({ type: 'capture', unitId: unit.id, tileKey: `${cap.x},${cap.z}` });
                    res = subtractCost(res, { gold: CAPTURE_COST });
                    acted.add(unit.id);
                    continue;
                }
            }
            // 2) Nearby breached city (within 4 tiles): move toward it so we
            //    can capture next turn. Only when idle (no improvement to build
            //    on current tile) and the city is reachable.
            if (!unit.hasMovedThisTurn && !acted.has(unit.id)) {
                const here = tiles.get(`${unit.x},${unit.z}`);
                const hereBldg = here ? improvementForTerrain(here.terrain) : null;
                const hereHas = hereBldg && (buildings.get(`${here.x},${here.z}`) || []).includes(hereBldg);
                const needsImprovement = here && here.owner === owner && hereBldg && !hereHas &&
                    (!influence || influence.has(`${here.x},${here.z}`)) &&
                    canAffordBuilding(hereBldg, res);
                if (!needsImprovement) {
                    let bestCity = null, bestDist = Infinity;
                    for (let dx = -4; dx <= 4; dx++) {
                        for (let dz = -4; dz <= 4; dz++) {
                            if (Math.abs(dx) + Math.abs(dz) > 4) continue;
                            const t = tiles.get(`${unit.x + dx},${unit.z + dz}`);
                            if (!t || t.terrain !== 'CITY') continue;
                            if (t.owner === owner) continue;
                            if ((t.fortification || 0) > 0) continue;
                            if (t.owner && isAtWar && !isAtWar(t.owner)) continue;
                            const d = Math.abs(dx) + Math.abs(dz);
                            if (d < bestDist) { bestDist = d; bestCity = t; }
                        }
                    }
                    if (bestCity) {
                        const step = stepToward(unit, bestCity, tiles, owner, units, moved, isAtWar);
                        if (step && (step.x !== bestCity.x || step.z !== bestCity.z)) {
                            actions.push({ type: 'move', unitId: unit.id, tx: step.x, tz: step.z });
                            moved.add(`${step.x},${step.z}`);
                            acted.add(unit.id);
                        } else if (step) {
                            //一步到位: move directly onto the city (game engine captures on arrival).
                            actions.push({ type: 'move', unitId: unit.id, tx: step.x, tz: step.z });
                            moved.add(`${step.x},${step.z}`);
                            acted.add(unit.id);
                        }
                    }
                }
            }
            // 3) No capture opportunity: build improvements as normal.
            if (!acted.has(unit.id)) {
                const here = tiles.get(`${unit.x},${unit.z}`);
                const hereBldg = here ? improvementForTerrain(here.terrain) : null;
                const hereHas = hereBldg && (buildings.get(`${here.x},${here.z}`) || []).includes(hereBldg);
                if (here && here.owner === owner && hereBldg && !hereHas &&
                    (!influence || influence.has(`${here.x},${here.z}`)) &&
                    canAffordBuilding(hereBldg, res) && !unit.hasAttackedThisTurn) {
                    actions.push({ type: 'workerBuild', unitId: unit.id, buildingType: hereBldg });
                    res = payBuilding(hereBldg, res);
                    acted.add(unit.id);
                }
            }
            if (!acted.has(unit.id)) {
                const spot = findImprovementSpot(unit, tiles, owner, buildings, influence, res);
                if (spot) {
                    const step = stepToward(unit, spot, tiles, owner, units, moved, isAtWar);
                    if (step) {
                        actions.push({ type: 'move', unitId: unit.id, tx: step.x, tz: step.z });
                        moved.add(`${step.x},${step.z}`);
                        acted.add(unit.id);
                    }
                }
            }
            acted.add(unit.id);
            continue;
        }

        // a2) Engineers / siege-tower builders. Offense: build a Siege Tower
        //     when within range of a valid target city — at-war enemies AND
        //     unclaimed (neutral) cities alike. Siege towers are obsolete once
        //     gunpowder (ARTILLERY) is unlocked. Defense: when an own city is
        //     threatened, build traps/fortifications on owned tiles around it.
        //     Engineer-types carry canBuildStructure + canBuildBridge; Roman
        //     Legionnaires also carry canBuildSiegeTower and can man the tower
        //     branch, but not bridges/field-siege.
        const udef = UNIT_TYPE[unit.type];
        const isEngineerType = !!(udef && udef.canBuildBridge && udef.canBuildStructure);
        const isSiegeTowerBuilder = !!(udef && udef.canBuildSiegeTower);
        if ((isEngineerType || isSiegeTowerBuilder) && !unit.hasAttackedThisTurn) {
            const towerTarget = (!hasModernSiegeTech) ? findTargetCityWithin(unit, tiles, owner, isAtWar, SIEGE_TOWER_BUILD_RADIUS) : null;
            if (towerTarget && canAffordCost(res, SIEGE_TOWER_COST)) {
                actions.push({ type: 'buildSiegeTower', unitId: unit.id, tileKey: `${towerTarget.city.x},${towerTarget.city.z}` });
                res = subtractCost(res, SIEGE_TOWER_COST);
                acted.add(unit.id);
                continue;
            }
            // Siege engine field construction: when we have a conquest goal and
            // no siege units in our army, engineers build CATAPULT/TREBUCHET
            // in the field. This is the only way non-roster-siege factions can
            // get long-range siege (they can't train it). Gated on the unlocking
            // TECH (MATHEMATICS/SIEGE_CRAFT) like the player's
            // handleBuildSiegeEngine — NOT on fullRoster, which only contains
            // CATAPULT/TREBUCHET when a Siege Workshop exists; that made this
            // branch dead for exactly the workshop-less factions it serves.
            // Cost must match the executor in game.js (SIEGE_ENGINE_BUILD_COST).
            const hasSiegeEngine = myUnits.some(u => SIEGE_TYPES.has(u.type) && u.type !== 'SIEGE_TOWER');
            const warGoal = goalKind === 'conquest' || goalKind === 'take-key-city';
            const fieldSiegeTypes = ['CATAPULT', 'TREBUCHET'].filter(t =>
                !aiTs || !aiTs.researched || aiUnlocked.has(t));
            if (!hasSiegeEngine && warGoal && fieldSiegeTypes.length && !unit.hasAttackedThisTurn) {
                const here = tiles.get(`${unit.x},${unit.z}`);
                if (here && here.owner === owner && here.terrain !== 'WATER' && here.terrain !== 'RIVER' && here.terrain !== 'MOUNTAIN') {
                    for (const stype of fieldSiegeTypes) {
                        if (canAffordCost(res, SIEGE_ENGINE_BUILD_COST)) {
                            actions.push({ type: 'buildSiegeEngine', unitId: unit.id, engineType: stype, tx: unit.x, tz: unit.z });
                            res = subtractCost(res, SIEGE_ENGINE_BUILD_COST);
                            acted.add(unit.id);
                            break;
                        }
                    }
                    if (acted.has(unit.id)) continue;
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
                    // Outer ring: traps — anti-cavalry if the enemy brings
                    // cavalry, anti-tank if they bring armor, else a general
                    // trap. Modern variants (BUNKER/MINEFIELD/AT_MINE) are
                    // preferred when their tech is researched.
                    let sType;
                    if (distCity === 1) sType = pickStructure('fort', aiTs);
                    else if (threat.armor >= 2) sType = pickStructure('antitank', aiTs);
                    else if (threat.cavalry >= 2) sType = pickStructure('anticav', aiTs);
                    else sType = pickStructure('trap', aiTs);
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
            // a2b) Forward screening: even with no threatened home city, an
            //      engineer standing on friendly soil near at-war enemies lays
            //      a trap to screen the army's approach. This makes engineers
            //      useful on the offensive too — not only when a home city is
            //      under direct threat — so traps actually get built.
            if (atWar) {
                const here = tiles.get(`${unit.x},${unit.z}`);
                const canSite = here && here.owner === owner &&
                    here.terrain !== 'CITY' && here.terrain !== 'WATER' && here.terrain !== 'RIVER' &&
                    !structures.has(`${unit.x},${unit.z}`) &&
                    (!influence || influence.has(`${unit.x},${unit.z}`));
                if (canSite) {
                    let nearEnemy = 0, nearCavalry = 0, nearArmor = 0;
                    for (const o of units.values()) {
                        if (o.owner === owner || !isAtWar(o.owner)) continue;
                        const d = Math.abs(o.x - unit.x) + Math.abs(o.z - unit.z);
                        if (d <= 3) {
                            nearEnemy++;
                            if (CAVALRY_TYPES.has(o.type)) nearCavalry++;
                            const odef = UNIT_TYPE[o.type];
                            if (odef && (odef.armored || o.type === 'TANK' || o.type === 'HEAVY_TANK' || o.type === 'ARMORED_CAR')) nearArmor++;
                        }
                    }
                    if (nearEnemy > 0) {
                        let sType;
                        if (nearArmor >= 2) sType = pickStructure('antitank', aiTs);
                        else if (nearCavalry >= 2) sType = pickStructure('anticav', aiTs);
                        else sType = pickStructure('trap', aiTs);
                        const sCost = STRUCTURE_COST[sType] || {};
                        if (canAffordCost(res, sCost)) {
                            actions.push({ type: 'buildStructure', unitId: unit.id, structureType: sType });
                            res = subtractCost(res, sCost);
                            acted.add(unit.id);
                            continue;
                        }
                    }
                }
            }
            // a2c) Bridge-building is handled in the early pre-pass (step 0ab)
            //     so the cost is reserved before the unit-training spree drains
            //     the treasury. An engineer already bridged this turn is in
            //     `acted` and skips the offense move below.

            // a2d) Bridge-seeking: if the engineer is NOT already adjacent to a
            //     bridgeable river (step 0ab didn't fire), find the nearest
            //     unbridged river between us and our objective and step toward
            //     it. Without this, `stepToward` may leave the engineer diagonally
            //     offset from the river tile it needs to bridge — `findBridgeTarget`
            //     only checks orthogonal adjacency, so the bridge is never built.
            if (!unit.hasMovedThisTurn && !acted.has(unit.id)) {
                const bridgeTarget = findBridgeTarget(unit, tiles, owner, isAtWar, atWar, hasSettler);
                if (!bridgeTarget) {
                    const riverTarget = findNearestBridgeableRiver(unit, tiles, owner, isAtWar, atWar, hasSettler);
                    if (riverTarget) {
                        const step = stepToward(unit, riverTarget, tiles, owner, units, moved, isAtWar);
                        if (step) {
                            actions.push({ type: 'move', unitId: unit.id, tx: step.x, tz: step.z });
                            moved.add(`${step.x},${step.z}`);
                            acted.add(unit.id);
                            continue;
                        }
                    }
                }
            }

            // Offense move: no threatened home — step toward the nearest target
            // city (at-war enemy OR neutral) so the engineer can build towers on
            // subsequent turns, even at peace when neutral cities are the goal.
            {
                const nearest = findNearestTargetCity(unit, tiles, owner, isAtWar);
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
        //      Escort rule: the tower only advances on the city while a
        //      friendly combat escort (melee/ranged/cavalry) is within
        //      SIEGE_ESCORT_RADIUS — a lone tower rushing a city is a free
        //      kill. Unescorted, it moves to rejoin the nearest escort, or
        //      holds and waits when the faction has no escorts at all.
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
                    const esc = nearestEscort(unit, units, owner, lords);
                    if (esc) {
                        const goal = esc.dist <= SIEGE_ESCORT_RADIUS ? target : esc.unit;
                        const step = stepToward(unit, goal, tiles, owner, units, moved, isAtWar);
                        if (step) {
                            actions.push({ type: 'move', unitId: unit.id, tx: step.x, tz: step.z });
                            moved.add(`${step.x},${step.z}`);
                        }
                    }
                    // No escort anywhere: hold and wait for one.
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

        // a3b) Spies. When a spy goal is active, move toward the target enemy
        //      city and execute the designated spy action when adjacent.
        if (unit.type === 'SPY' && !acted.has(unit.id) && goalKind === 'spy' && topGoal) {
            const spyAction = (topGoal.meta && topGoal.meta.spyAction) || 'GATHER_INTEL';
            const targetFaction = topGoal.targetFaction;
            // Parse targetTileKey to get target coordinates.
            let tx, tz;
            if (topGoal.targetTileKey) {
                const parts = String(topGoal.targetTileKey).split(',');
                tx = parseInt(parts[0], 10);
                tz = parseInt(parts[1], 10);
            }
            if (tx !== undefined && !isNaN(tx) && targetFaction) {
                const dist = Math.abs(unit.x - tx) + Math.abs(unit.z - tz);
                // If adjacent (dist <= 1), execute the spy action.
                if (dist <= 1 && (res.gold || 0) >= 25) {
                    actions.push({
                        type: 'spyAction', unitId: unit.id,
                        action: spyAction, targetFaction,
                        targetTileKey: topGoal.targetTileKey
                    });
                    acted.add(unit.id);
                    continue;
                }
                // Otherwise move toward the target city.
                if (!unit.hasMovedThisTurn) {
                    const target = { x: tx, z: tz };
                    const step = stepToward(unit, target, tiles, owner, units, moved, isAtWar);
                    if (step && (step.x !== unit.x || step.z !== unit.z)) {
                        actions.push({ type: 'move', unitId: unit.id, tx: step.x, tz: step.z });
                        moved.add(`${step.x},${step.z}`);
                        acted.add(unit.id);
                        continue;
                    }
                }
            }
            // Spy has no path or can't afford action — mark as acted to skip army grouping.
            acted.add(unit.id);
            continue;
        }

        // a4) Ships. Transports ferry waiting settlers to settleable land on
        //     other landmasses; warships hunt enemy ships, besiege coastal
        //     cities, and scout foreign shores. Naval units never join the
        //     land army groups.
        if (isNaval(unit)) {
            if (isTransport(unit)) {
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
                    } else if (hasMilitary) {
                        // 6a gate — Escorted flotilla with timeout: if the sea corridor is
                        // dangerous (enemy warships within 8 tiles) and no friendly escort
                        // is within 3 tiles, the transport waits up to 5 turns before
                        // sailing unescorted.
                        const dangerousCorridor = [...units.values()].some(u =>
                            u.owner !== owner && isAtWar(u.owner, owner) && isNaval(u) &&
                            !isTransport(u) && Math.abs(u.x - unit.x) + Math.abs(u.z - unit.z) <= 8);
                        const hasCloseEscort = [...units.values()].some(u =>
                            u.owner === owner && !isTransport(u) && isNaval(u) &&
                            Math.abs(u.x - unit.x) + Math.abs(u.z - unit.z) <= 3);
                        if (dangerousCorridor && !hasCloseEscort) {
                            unit._escortWaitTurns = (unit._escortWaitTurns || 0) + 1;
                            if (unit._escortWaitTurns < 5) {
                                // Waiting for escort — skip movement this turn.
                                acted.add(unit.id);
                                continue;
                            }
                        } else {
                            unit._escortWaitTurns = 0; // reset when safe or escorted
                        }
                        // Cross-theater ferry: cargo tagged with _ferryTo (by the
                        // donor-theater release in step 5a3) sails to the needy
                        // theater's port — not to an assault target of the
                        // transport's own choosing.
                        const ferryDest = cargoIds.map(id => units.get(id))
                            .find(cu => cu && cu._ferryTo)?._ferryTo || null;
                        if (ferryDest) {
                            if (canUnloadAt(unit, ferryDest, tiles)) {
                                actions.push({ type: 'disembark', unitId: unit.id });
                            } else if (!unit.hasMovedThisTurn) {
                                const step = stepToward(unit, ferryDest, tiles, owner, units, moved, isAtWar);
                                if (step) {
                                    actions.push({ type: 'move', unitId: unit.id, tx: step.x, tz: step.z });
                                    moved.add(`${step.x},${step.z}`);
                                }
                            }
                            acted.add(unit.id);
                            continue;
                        }
                        // Theater-aware ferry: if the home theater is under attack,
                        // return troops home instead of sailing toward the enemy.
                        // Check whether this transport's cargo came from a safe
                        // theater (overseas) and home needs reinforcements.
                        const homeTheater = theaters.size > 0 ? [...theaters.values()].find(t => t.homeTheater) : null;
                        const needHomeDefense = homeTheater && homeTheater.urgency >= 0.4;
                        let homePort = null;
                        if (needHomeDefense && homeTheater.portCity) {
                            homePort = homeTheater.portCity;
                        }
                        if (homePort) {
                            // Sail toward home port to return troops for defense.
                            const unloadThere = canUnloadAt(unit, homePort, tiles);
                            if (unloadThere) {
                                actions.push({ type: 'disembark', unitId: unit.id });
                            } else if (!unit.hasMovedThisTurn) {
                                const step = stepToward(unit, homePort, tiles, owner, units, moved, isAtWar);
                                if (step) {
                                    actions.push({ type: 'move', unitId: unit.id, tx: step.x, tz: step.z });
                                    moved.add(`${step.x},${step.z}`);
                                }
                            }
                        } else {
                        // Military cargo: at war, sail to the nearest enemy coastal
                        // city for an amphibious assault. Without an assault target
                        // (peace, or no coastal enemy city), sail to the nearest
                        // foreign shore and unload there — never drift with cargo.
                        const dest = atWar ? nearestEnemyCoastalCity(unit, tiles, owner, isAtWar) : null;
                        const target = dest || nearestForeignLandmass(unit, tiles, owner, land);
                        if (target && canUnloadAt(unit, target, tiles)) {
                            actions.push({ type: 'disembark', unitId: unit.id });
                        } else if (target && !unit.hasMovedThisTurn) {
                            const step = stepToward(unit, target, tiles, owner, units, moved, isAtWar);
                            if (step) {
                                actions.push({ type: 'move', unitId: unit.id, tx: step.x, tz: step.z });
                                moved.add(`${step.x},${step.z}`);
                            }
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
                            u.owner === owner && !isTransport(u) && isNaval(u) &&
                            Math.abs(u.x - unit.x) + Math.abs(u.z - unit.z) <= 3);
                        if (!closeWarship) {
                            const escort = [...units.values()].find(u =>
                                u.owner === owner && !isTransport(u) && isNaval(u) &&
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
                // Ferry pickup first: units tagged _ferryTo are waiting near a
                // donor port for cross-theater reinforcement — they get
                // priority over generic shore pickups. (Tagged units may stand
                // a tile inland from the water, so this checks everywhere, not
                // just shore tiles.)
                {
                    let bestU = null, bestD = Infinity;
                    for (const u of units.values()) {
                        if (u.owner !== owner || !u._ferryTo || u.boarded) continue;
                        if (acted.has(u.id)) continue;
                        if (u.type === 'SETTLER' || u.type === 'WORKER' || isNaval(u)) continue;
                        // Ferry timeout: stuck units abandon the ferry plan after
                        // more than five idle turns and rejoin normal army logic.
                        u._ferryTurns = (u._ferryTurns || 0) + 1;
                        if (u._ferryTurns > 5) {
                            delete u._ferryTo;
                            delete u._ferryTurns;
                            continue;
                        }
                        const d = manhattan(unit.x, unit.z, u.x, u.z);
                        if (d < bestD) { bestD = d; bestU = u; }
                    }
                    if (bestU) {
                        if (Math.abs(unit.x - bestU.x) + Math.abs(unit.z - bestU.z) === 1) {
                            const cap = (UNIT_TYPE[unit.type] && UNIT_TYPE[unit.type].capacity) || 2;
                            if (((unit.cargo || []).length) < cap) {
                                actions.push({ type: 'board', unitId: bestU.id, transportId: unit.id });
                                acted.add(bestU.id);
                            }
                        } else if (!unit.hasMovedThisTurn) {
                            const step = stepToward(unit, bestU, tiles, owner, units, moved, isAtWar);
                            if (step) {
                                actions.push({ type: 'move', unitId: unit.id, tx: step.x, tz: step.z });
                                moved.add(`${step.x},${step.z}`);
                            }
                        }
                        acted.add(unit.id);
                        continue;
                    }
                }
                if (atWar) {
                    // 6b — Amphibious assault: pick up idle land military units at
                    //     shore on a friendly landmass (units already ashore abroad
                    //     are left alone — re-boarding them would loop forever).
                    const mil = nearestIdleMilitaryAtShore(unit, units, tiles, owner, acted, land);
                    if (mil) {
                        if (Math.abs(unit.x - mil.x) + Math.abs(unit.z - mil.z) === 1) {
                            const cap = (UNIT_TYPE[unit.type] && UNIT_TYPE[unit.type].capacity) || 2;
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
            // Warships (GALLEY/FRIGATE/GALLEON): consult naval group role to
            // narrow the action tree. Ungrouped ships default to 'strike'.
            const ng = shipGroup.get(unit.id);
            const navalRole = ng ? ng.role : 'strike';
            // Defend fleet: only attack ships in range, then hold position.
            if (navalRole === 'defend') {
                if (atWar && !unit.hasAttackedThisTurn) {
                    const tgt = findAttackTarget(unit, units, isAtWar);
                    if (tgt) {
                        actions.push({ type: 'attack', fromId: unit.id, toId: tgt.id });
                        acted.add(unit.id);
                        continue;
                    }
                }
                acted.add(unit.id);
                continue;
            }
            // Besiege-role fleets support nearby armies that lack siege: shell
            // fortified coastal cities with the ship's free attack action before
            // spending it on lesser targets.
            if (navalRole === 'besiege' && atWar && !unit.hasAttackedThisTurn) {
                const ec = findNavalSiegeTarget(unit, tiles, owner, isAtWar);
                if (ec) {
                    actions.push({ type: 'besiege', unitId: unit.id, tileKey: `${ec.x},${ec.z}` });
                    acted.add(unit.id);
                    continue;
                }
            }
            // All other roles (strike, amphibious, besiege fallback): attack enemy units in range.
            if (atWar && !unit.hasAttackedThisTurn) {
                const tgt = findAttackTarget(unit, units, isAtWar);
                if (tgt) {
                    actions.push({ type: 'attack', fromId: unit.id, toId: tgt.id });
                    acted.add(unit.id);
                    continue;
                }
            }
            // Fallback naval siege for fortified enemy coastal cities (GALLEON/BATTLESHIP can).
            // Naval siege units stay at their attack range from the city, not adjacent,
            // to avoid being reached by enemy melee on the shore.
            if (UNIT_TYPE[unit.type].besiege && !unit.hasAttackedThisTurn) {
                const ec = findNavalSiegeTarget(unit, tiles, owner, isAtWar);
                if (ec) {
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
            // Naval siege units (besiege: true) that are already within attack
            // range of a fortified enemy city hold position — they shell from
            // range and don't sail closer to enemy melee on the shore.
            if (UNIT_TYPE[unit.type].besiege) {
                const range = UNIT_TYPE[unit.type].attackRange || 1;
                let inRange = false;
                for (const t of tiles.values()) {
                    if (t.terrain !== 'CITY' || !t.owner || t.owner === owner) continue;
                    if (isAtWar && !isAtWar(t.owner)) continue;
                    if ((t.fortification || 0) <= 0) continue;
                    const d = Math.max(Math.abs(t.x - unit.x), Math.abs(t.z - unit.z));
                    if (d <= range) { inRange = true; break; }
                }
                if (inRange) {
                    acted.add(unit.id);
                    continue; // hold position and shell from range
                }
            }
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

    // 4b. Naval fleet group objectives. After the per-unit ship loop, assign
    //     fleet-level objectives so the naval debug panel shows where each
    //     fleet is heading. Objectives use the same target-finding helpers
    //     as the per-unit code but at the fleet level.
    for (const ng of navalGroups) {
        const centroid = groupCentroid(ng);
        let obj = null;
        if (ng.role === 'amphibious' || ng.role === 'transport') {
            // Sail toward the nearest enemy coastal city (beachhead approach).
            const transport = ng.units.find(u => isTransport(u));
            if (transport) {
                if (atWar) {
                    const target = nearestEnemyCoastalCity(transport, tiles, owner, isAtWar);
                    if (target) obj = target;
                }
                if (!obj) obj = nearestForeignLandmass(transport, tiles, owner, land);
            }
        } else if (ng.role === 'besiege') {
            // Find nearest enemy coastal city with fortification > 0.
            let best = null, bestDist = Infinity;
            for (const t of tiles.values()) {
                if (t.terrain !== 'CITY' || !t.owner || t.owner === owner) continue;
                if (isAtWar && !isAtWar(t.owner)) continue;
                if ((t.fortification || 0) <= 0) continue;
                let coastal = false;
                for (const [dx, dz] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
                    const nt = tiles.get(`${t.x + dx},${t.z + dz}`);
                    if (nt && (nt.terrain === 'WATER' || nt.terrain === 'RIVER')) { coastal = true; break; }
                }
                if (!coastal) continue;
                const d = Math.abs(centroid.x - t.x) + Math.abs(centroid.z - t.z);
                if (d < bestDist) { bestDist = d; best = t; }
            }
            if (best) obj = best;
        } else if (ng.role === 'defend') {
            // Nearest friendly coastal city.
            let best = null, bestDist = Infinity;
            for (const t of tiles.values()) {
                if (t.terrain !== 'CITY' || t.owner !== owner) continue;
                let coastal = false;
                for (const [dx, dz] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
                    const nt = tiles.get(`${t.x + dx},${t.z + dz}`);
                    if (nt && (nt.terrain === 'WATER' || nt.terrain === 'RIVER')) { coastal = true; break; }
                }
                if (!coastal) continue;
                const d = Math.abs(centroid.x - t.x) + Math.abs(centroid.z - t.z);
                if (d < bestDist) { bestDist = d; best = t; }
            }
            if (best) obj = best;
        } else {
            // strike: nearest enemy ship cluster centroid.
            let best = null, bestDist = Infinity, sumX = 0, sumZ = 0, count = 0;
            for (const u of units.values()) {
                if (u.owner === owner || !isAtWar(u.owner, owner)) continue;
                const def = UNIT_TYPE[u.type];
                if (!def || !def.naval) continue;
                sumX += u.x; sumZ += u.z; count++;
            }
            if (count > 0) {
                const cluster = { x: Math.round(sumX / count), z: Math.round(sumZ / count) };
                obj = cluster;
            }
            if (!obj && atWar) {
                let nearestEnemyCity = null, nearestDist = Infinity;
                for (const t of tiles.values()) {
                    if (t.terrain !== 'CITY' || !t.owner || t.owner === owner) continue;
                    if (!isAtWar(t.owner)) continue;
                    const d = Math.abs(centroid.x - t.x) + Math.abs(centroid.z - t.z);
                    if (d < nearestDist) { nearestDist = d; nearestEnemyCity = t; }
                }
                if (nearestEnemyCity) obj = nearestEnemyCity;
            }
        }
        if (obj) navalGroupObjectives.set(ng, { x: obj.x, z: obj.z });
    }

    // 5. Army-group coordination: ALL military units (everything that isn't a
    //    settler/worker/ship) are grouped — including units that already acted
    //    this turn (escorts, capturers, engineers). Acted members receive no
    //    new orders (planGroup filters them) but still count for group
    //    membership, power ranking, and the debug panel. Groups are then split
    //    into two roles:
    //      - CONQUEST: the strongest 1-3 groups campaign outward (enemy cities,
    //        neutral cities, expansion). Kings/lords attached to these groups
    //        ride along with the main army.
    //      - PATROL: the rest hold a defensive ring near their nearest friendly
    //        city, guarding territory instead of wandering the map.
    const militaryPool = myUnits.filter(u =>
        u.type !== 'SETTLER' && u.type !== 'WORKER' && !isNaval(u));
    const groups = buildArmyGroups(militaryPool, lords, owner);
    // Theater assignment + urgency run BEFORE conquest/patrol role selection:
    // how many groups must stay home depends on which theaters are threatened.
    const groupTheater = new Map(); // group -> Theater
    if (theaters.size > 0) {
        assignGroupsToTheaters(groups, theaters, tiles, theaterLand, owner);
        computeTheaterUrgency(theaters, tiles, units, owner, isAtWar, theaterLand);
        for (const t of theaters.values()) for (const g of t.groups) groupTheater.set(g, t);
    }
    const hasConquestTargets = atWar ||
        [...tiles.values()].some(t => t.terrain === 'CITY' && !t.owner);
    const ranked = groups.map(g => ({
        g, power: g.units.reduce((s, u) => s + unitValue(u), 0)
    })).sort((a, b) => b.power - a.power);
    // Patrol quota: one group per threatened theater holds territory (plus one
    // at war even without theater data); EVERY other group campaigns. The old
    // hard cap of 3 conquest groups left most of a large army idle at home.
    const threatenedTheaters = theaters.size > 0
        ? [...theaters.values()].filter(t => t.urgency >= 0.2).length
        : 0;
    const patrolQuota = Math.min(ranked.length, Math.max(atWar ? 1 : 0, threatenedTheaters));
    const conquestCount = hasConquestTargets
        ? Math.max(1, ranked.length - patrolQuota)
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
    // King protection: if the king has too few military units nearby, mark the
    // nearest idle army group as a guard detail. When no enemy threatens any
    // owned city within 10 tiles the core guard shrinks to 2-3 units and the
    // rest of the army is freed for offense.
    const king = (lords || []).find(l => l.owner === owner && l.isKing);
    let kingGuardGroup = null;
    // The king's own group (if it leads one) — eligible to join conquest when
    // the king is healthy, well-guarded, and the faction is at war. Previously
    // the king was ALWAYS kept at home, so the strongest combatant on the map
    // (high HP, big attack/defense, army bonuses) sat idle while the army
    // campaigned without its bonuses. Now the king rides out when it's safe.
    let kingGroup = null;
    if (king) {
        for (const g of groups) {
            if (g.lords && g.lords.some(l => l.isKing && l.owner === owner)) { kingGroup = g; break; }
        }
    }
    // King campaign eligibility: at war, king healthy, enough bodyguards in the
    // king's group, and the home front isn't under immediate threat (the king
    // defends home first). Mid-to-late game (turn > 25 or 3+ cities) — early
    // game the king stays put since one bad engagement loses the game.
    const kingHpRatio = king ? (king.hp || 0) / (king.maxHp || 1) : 0;
    const kingArmySize = kingGroup ? kingGroup.units.length : 0;
    const homeUnderThreat = king ? hasNearbyThreats(owner, tiles, units, isAtWar, 8) : false;
    const kingCampaignEligible = !!(king && kingGroup && atWar && !homeUnderThreat &&
        kingHpRatio >= 0.7 && kingArmySize >= 3 &&
        (currentTurn > 25 || myCityCount >= 3));
    if (king) {
        const nearbyThreat = hasNearbyThreats(owner, tiles, units, isAtWar, 10);
        const guardsNear = militaryPool.filter(u => u.type !== 'SETTLER' && u.type !== 'WORKER' &&
            Math.abs(u.x - king.x) + Math.abs(u.z - king.z) <= 2).length;
        const guardNeed = nearbyThreat ? 3 : 2;
        if (guardsNear < guardNeed && !kingCampaignEligible) {
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
    // King campaigns: when the king is healthy, well-guarded, and at war with
    // no immediate home threat, the king's own group joins the conquest force.
    // The king's combat bonuses (army attack/defense aura, high HP, strong
    // personal attack) make it the most effective army leader, and keeping it
    // idle wastes that power. Added BEFORE the front round-robin so the king's
    // group takes a front slot like any other conquest group.
    if (kingCampaignEligible && kingGroup && !conquest.has(kingGroup) && hasConquestTargets) {
        conquest.add(kingGroup);
        // Assign the king's group to the nearest front so it has a target.
        if (fronts.length > 0) {
            const kc = groupCentroid(kingGroup);
            let bestFi = -1, bestFd = Infinity;
            for (let fi = 0; fi < fronts.length; fi++) {
                if (assignedFronts.has(fi)) continue;
                const rep = fronts[fi].cities[0];
                const d = Math.abs(rep.x - kc.x) + Math.abs(rep.z - kc.z);
                if (d < bestFd) { bestFd = d; bestFi = fi; }
            }
            if (bestFi >= 0) assignedFronts.add(bestFi);
        }
    }
    // Pass 1: assign one group to each front (round-robin by power) so every
    // front is covered before any front gets a second group. The old power-
    // based fallback could stack 2 groups on front A while front B stayed empty.
    for (let i = 0; i < ranked.length && conquest.size < conquestCount; i++) {
        if (fronts.length === 0) {
            conquest.add(ranked[i].g);
            continue;
        }
        if (assignedFronts.size >= fronts.length) break; // all fronts have a group
        for (let fi = 0; fi < fronts.length; fi++) {
            if (!assignedFronts.has(fi)) {
                conquest.add(ranked[i].g);
                assignedFronts.add(fi);
                break;
            }
        }
    }
    // Pass 2: if we still have conquest slots free and all fronts are covered,
    // assign remaining strong groups to reinforce (no front left uncovered).
    for (let i = 0; i < ranked.length && conquest.size < conquestCount; i++) {
        if (conquest.has(ranked[i].g)) continue;
        if (fronts.length > 0 && assignedFronts.size < fronts.length) break;
        conquest.add(ranked[i].g);
    }

    // 5a2. Theater system: group army groups by landmass for geographic command.
    //      (Assignment + urgency already ran right after buildArmyGroups — the
    //      conquest/patrol split above depends on them.) The home theater gets
    //      priority: an overseas theater under attack gets an urgency boost so
    //      the AI defends it instead of idling on another continent.
    if (theaters.size > 0) {
        allocateTheaterBudgets(theaters, resources, owner);
        // Ensure home theater gets a large urgency boost when under attack.
        const homeTheater = [...theaters.values()].find(t => t.homeTheater);
        if (homeTheater && homeTheater.urgency >= 0.3) {
            // The home theater needs prompt attention — some conquest groups may
            // need to stay home and defend. Convert a conquest group to patrol
            // if we have more than one and home is threatened.
            if (conquest.size >= 2) {
                const weakest = [...conquest].sort((a, b) =>
                    groupPower(a) - groupPower(b))[0];
                conquest.delete(weakest);
            }
        }
    }

    // 5a3. Cross-theater ferry + garrison release. Quiet theaters only keep
    //      their garrison quota at home (garrisonNeeds); every group beyond
    //      the quota is RELEASED — it attacks an in-theater target, or (when
    //      its theater is a ferry donor) marches to the port to embark for a
    //      needy theater. This is what puts large idle armies to work.
    const ferryPlans = theaters.size > 0
        ? planFerries(theaters, units, tiles, owner, theaterLand,
            t => t.groups.some(g => !conquest.has(g)))
        : [];
    const donorTheater = new Map(); // theater.id -> plan
    for (const p of ferryPlans) donorTheater.set(p.donor.id, p);
    const releasedGroups = new Set();
    if (theaters.size > 0) {
        for (const t of theaters.values()) {
            if (t.urgency >= 0.3) continue; // threatened: everyone defends
            const quota = garrisonNeeds(t, tiles, owner, theaterLand);
            // Weakest groups stay on garrison; the strong ones are released.
            const patrols = t.groups.filter(g => !conquest.has(g))
                .sort((a, b) => groupPower(a) - groupPower(b));
            let kept = 0;
            for (const g of patrols) {
                if (kept < quota) { kept++; continue; }
                releasedGroups.add(g);
            }
        }
    }

    // 5b. Inter-group reinforcement. A group whose king is wounded or that is
    //     locally outnumbered gets help from the nearest friendly group that is
    //     NOT itself in trouble and is within reinforcing range. The reinforcing
    //     group redirects its objective onto the troubled group's position so the
    //     two merge on the battlefield. If the threat is overwhelming (the
    //     troubled group plus every available helper still can't match the foe),
    //     the troubled group is told to RETREAT instead — reinforcing into a lost
    //     cause just feeds the enemy.
    //
    // Strategic concentration of force (from ai_army_plan.js): when 2+ conquest
    // groups exist, compute a shared strategic target so they converge on the
    // same city instead of each picking a different one. Also detect flanking
    // opportunities so a second group approaches from the opposite side.
    const conquestGroups = [...conquest];
    let strategicTarget = null;
    let flankAssignments = [];
    // A decisive-battle top goal targets enemy ARMY CLUSTERS, not cities —
    // skip the shared city target so each group picks a cluster instead
    // (see the claimedClusters threading below).
    if (conquestGroups.length > 0 && goalKind !== 'decisive-battle') {
        const goalTargetKey = topGoal && topGoal.targetTileKey ? topGoal.targetTileKey : null;
        strategicTarget = computeStrategicTarget(conquestGroups, tiles, units, owner, isAtWar, aiState, goalTargetKey);
        if (strategicTarget && conquestGroups.length >= 2) {
            flankAssignments = detectFlankingOpportunity(conquestGroups, { x: strategicTarget.x, z: strategicTarget.z }, units, owner);
        }
    }
    const flankMap = new Map(); // group -> flank role
    for (const fa of flankAssignments) flankMap.set(fa.group, fa);

    // Multi-target conquest: when the conquest goal carries several candidate
    // cities (meta.targets) and there are 2+ conquest groups, each group gets
    // a DIFFERENT target city — the strongest group always takes the primary
    // target (fixes "no army group assigned to the main conquest objective"),
    // the rest take their nearest unclaimed target. The shared strategic
    // target (concentration on ONE city) is skipped in that case.
    const multiTargets = (goalKind === 'conquest' && topGoal && topGoal.meta &&
        Array.isArray(topGoal.meta.targets) && topGoal.meta.targets.length > 1)
        ? topGoal.meta.targets : null;
    const mtAssignments = new Map(); // group -> {x,z}
    if (multiTargets && conquestGroups.length > 1) {
        strategicTarget = null; // distribute instead of concentrating
        flankAssignments = [];
        const ordered = [...conquestGroups].sort((a, b) => groupPower(b) - groupPower(a));
        const claimedTargets = new Set();
        ordered.forEach((g, i) => {
            if (i === 0) {
                // Strongest group always takes the primary conquest target.
                const primary = multiTargets[0];
                claimedTargets.add(`${primary.x},${primary.z}`);
                mtAssignments.set(g, primary);
                return;
            }
            const c = groupCentroid(g);
            let best = null, bestD = Infinity;
            for (const t of multiTargets) {
                if (claimedTargets.has(`${t.x},${t.z}`)) continue;
                const d = manhattan(c.x, c.z, t.x, t.z);
                if (d < bestD) { bestD = d; best = t; }
            }
            if (!best) best = multiTargets[0]; // more groups than targets — pile onto the primary
            claimedTargets.add(`${best.x},${best.z}`);
            mtAssignments.set(g, best);
        });
    }

    const REINFORCE_RANGE = 18; // was 12 — too short for large-map armies to support each other
    const groupObjectives = new Map();   // group -> objective tile
    const groupStances = new Map();      // group -> stance
    // Decisive-battle: cluster keys ("x,z") already assigned to a conquest
    // group this turn, so groups distribute across enemy armies.
    const claimedClusters = new Set();
    for (const g of groups) {
        let objective, stance;
        if (conquest.has(g)) {
            stance = computeStance(g, units, owner, atWar, isAtWar, currentTurn, lords);
            // Multi-target conquest: this group's assigned city (strongest
            // group took the primary). Otherwise use the shared strategic
            // target when available (concentration of force), falling back to
            // per-group pickGroupObjective if no strategic target was computed
            // (e.g. no enemy cities in range).
            const mt = mtAssignments.get(g);
            if (mt) {
                objective = { x: mt.x, z: mt.z };
            } else if (strategicTarget) {
                objective = { x: strategicTarget.x, z: strategicTarget.z };
                // Flank group approaches from the opposite side.
                const fa = flankMap.get(g);
                if (fa && fa.role === 'flank') {
                    const flankObj = computeFlankObjective({ x: strategicTarget.x, z: strategicTarget.z }, fa.approachAngle, tiles, owner);
                    if (flankObj) objective = flankObj;
                }
            } else {
                objective = pickGroupObjective(g, tiles, owner, isAtWar, stance, units, topGoal, lords, claimedClusters);
            }
        } else {
            const c = groupCentroid(g);
            if (g === kingGuardGroup && king) {
                objective = { x: king.x, z: king.z };
                stance = 'hold';
            } else if (releasedGroups.has(g)) {
                // Released from garrison duty: put this group to work.
                const th = groupTheater.get(g);
                const plan = th ? donorTheater.get(th.id) : null;
                if (plan) {
                    // Ferry donor: march to the port and wait for a transport.
                    // The port city tile carries `owner`, so planGroup's
                    // hold-ring rule gathers the group around the harbor.
                    const portTile = tiles.get(`${plan.fromPort.x},${plan.fromPort.z}`);
                    objective = portTile || { x: plan.fromPort.x, z: plan.fromPort.z };
                    stance = 'hold';
                    for (const u of g.units) {
                        u._ferryTo = plan.toPort;
                        u._ferryTurns = 0;
                    }
                } else {
                    // Attack the nearest enemy/neutral city IN THIS THEATER —
                    // no cross-map wandering, no idling on a quiet landmass.
                    const tTarget = th ? findTheaterTarget(tiles, owner, th.landmassId,
                        theaterLand, isAtWar, c.x, c.z) : null;
                    if (tTarget) {
                        objective = tTarget;
                        stance = computeStance(g, units, owner, atWar, isAtWar, currentTurn, lords);
                    } else {
                        objective = nearestFriendlyCity(c, tiles, owner);
                        stance = 'hold';
                    }
                }
            } else {
                // Defense objective: patrol groups go to the threatened city
                // instead of idling at their nearest friendly city. This makes
                // the AI actually respond to sieges.
                if (topGoal && topGoal.kind === 'defense' && topGoal.targetTileKey) {
                    const [dx, dz] = topGoal.targetTileKey.split(',').map(Number);
                    if (!Number.isNaN(dx) && !Number.isNaN(dz)) {
                        objective = { x: dx, z: dz };
                        stance = computeStance(g, units, owner, atWar, isAtWar, currentTurn, lords);
                    } else {
                        objective = nearestFriendlyCity(c, tiles, owner);
                        stance = 'hold';
                    }
                } else {
                    // Opportunistic expansion / harassment for idle patrol/home
                    // groups: unclaimed cities, weak enemy cities (garrison <= 2),
                    // or isolated enemy units within 10 tiles become targets so
                    // idle armies (including siege engines) stay useful.
                    const local = localPowerBalance(units, c.x, c.z, owner, atWar, isAtWar, 5);
                    const harassTarget = findHarassTarget(g, tiles, units, owner, isAtWar);
                    if (harassTarget && local.foe < local.friend * 0.8) {
                        objective = harassTarget;
                        stance = 'engage';
                    } else {
                        objective = nearestFriendlyCity(c, tiles, owner);
                        stance = 'hold';
                    }
                }
            }
        }
        groupObjectives.set(g, objective);
        groupStances.set(g, stance);
    }
    if (atWar) {
        for (const g of groups) {
            if (!groupIsInTrouble(g, units, owner, atWar, isAtWar)) continue;
            const gc = groupCentroid(g);
            const local = groupLocalBalance(g, units, owner, atWar, isAtWar);
            // Find the best nearby healthy helper group.
            let best = null, bestScore = -Infinity;
            for (const h of groups) {
                if (h === g) continue;
                if (groupIsInTrouble(h, units, owner, atWar, isAtWar)) continue;
                if (groupPower(h) <= 0) continue;
                const hc = groupCentroid(h);
                const d = Math.abs(hc.x - gc.x) + Math.abs(hc.z - gc.z);
                if (d > REINFORCE_RANGE) continue;
                // Prefer strong, close helpers; weight power over distance.
                const score = groupPower(h) * 2 - d;
                if (score > bestScore) { bestScore = score; best = h; }
            }
            if (best) {
                const hc = groupCentroid(best);
                const helpLocal = groupLocalBalance(best, units, owner, atWar, isAtWar);
                const combinedFriend = local.friend + helpLocal.friend + groupPower(best);
                // Overwhelming threat (helpers still can't match the foe): retreat
                // the troubled group toward the nearest friendly city instead.
                if (combinedFriend < local.foe * 1.2) {
                    const safe = nearestFriendlyCity(gc, tiles, owner);
                    if (safe) { groupObjectives.set(g, safe); groupStances.set(g, 'retreat'); }
                } else {
                    // Reinforce: the healthy group marches to the troubled one.
                    groupObjectives.set(best, gc);
                }
            } else {
                // No helper available — if clearly losing, fall back.
                if (local.foe > local.friend * 1.2) {
                    const safe = nearestFriendlyCity(gc, tiles, owner);
                    if (safe) { groupObjectives.set(g, safe); groupStances.set(g, 'retreat'); }
                }
            }
        }
    }

    // 5ab. Staging area + siege/screen role split. Conquest groups targeting
    //      the same coastal city are organized: the stronger group gets the
    //      coastal city objective (siege), the others guard the perimeter
    //      (screen) against enemy reinforcements approaching the siege group.
    //      Groups targeting a coastal enemy city that are not yet in position
    //      get routed through a beachhead staging tile first.
    if (conquest.size >= 2 && strategicTarget) {
        const siegeTarget = strategicTarget;
        let siegeGroup = null, maxPower = -1;
        const siegeCandidates = conquestGroups.filter(g => {
            const obj = groupObjectives.get(g);
            return obj && obj.x === siegeTarget.x && obj.z === siegeTarget.z;
        });
        for (const g of siegeCandidates) {
            const p = groupPower(g);
            if (p > maxPower) { maxPower = p; siegeGroup = g; }
        }
        if (siegeGroup) {
            groupObjectives.set(siegeGroup, { x: siegeTarget.x, z: siegeTarget.z });
            groupStances.set(siegeGroup, 'siege');
            for (const g of siegeCandidates) {
                if (g === siegeGroup) continue;
                const gc = groupCentroid(g);
                // Compute beachhead landing tile if the screen group approaches from sea.
                const beachhead = findSafeBeachheadLandingTile(tiles, siegeTarget.x, siegeTarget.z, units, owner, isAtWar);
                if (beachhead) {
                    const staging = findStagingTile(beachhead.x, beachhead.z, siegeTarget.x, siegeTarget.z, tiles);
                    groupObjectives.set(g, staging);
                } else {
                    // Screen from the landward side — between siege target and most-likely enemy reinforcements.
                    const enemyDirection = { dx: Math.sign(siegeTarget.x - gc.x) || 0, dz: Math.sign(siegeTarget.z - gc.z) || 0 };
                    const screenPos = findPerimeterTile(gc.x, gc.z, [enemyDirection], tiles);
                    groupObjectives.set(g, screenPos);
                }
                groupStances.set(g, 'screen');
            }
        }
    }

    // Phase 4a continued: staging for any conquest group approaching a coastal
    // target by sea (even single-group operations).
    if (conquest.size > 0) {
        for (const g of conquestGroups) {
            const obj = groupObjectives.get(g);
            if (!obj) continue;
            // Is the target a coastal enemy city?
            let isCoastalTarget = false;
            for (const [dx, dz] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
                const nt = tiles.get(`${obj.x + dx},${obj.z + dz}`);
                if (nt && (nt.terrain === 'WATER' || nt.terrain === 'RIVER')) { isCoastalTarget = true; break; }
            }
            if (!isCoastalTarget) continue;
            const stance = groupStances.get(g);
            if (stance === 'siege' || stance === 'screen') continue; // already handled above
            const gc = groupCentroid(g);
            const dist = Math.abs(gc.x - obj.x) + Math.abs(gc.z - obj.z);
            if (dist <= 2) continue; // already adjacent — no staging needed
            const beachhead = findSafeBeachheadLandingTile(tiles, obj.x, obj.z, units, owner, isAtWar);
            if (beachhead) {
                const staging = findStagingTile(beachhead.x, beachhead.z, obj.x, obj.z, tiles);
                groupObjectives.set(g, staging);
                groupStances.set(g, 'stage');
            }
        }
    }

    // 5c. Naval embarkation: when the conquest goal requires naval transport
    //     (meta.requiresNaval) and the plan has a 'boardArmy' step, order the
    //     conquest group's land units to move toward and board friendly
    //     transports. Without this the army walks to the shore and mills forever
    //     — the transports never get loaded because the default transport logic
    //     only ferries settlers. This coordinator explicitly boards the army.
    if (topGoal && topGoal.kind === 'conquest' && topGoal.meta && topGoal.meta.requiresNaval &&
        topGoal.plan && topGoal.plan.some(s => s.kind === 'boardArmy')) {
        const transports = myUnits.filter(u => (u.type === 'TRANSPORT' || u.type === 'STEAM_TRANSPORT') && !u.boarded);
        if (transports.length > 0) {
            for (const g of conquestGroups) {
                for (const u of g.units) {
                    if (acted.has(u.id) || u.hasMovedThisTurn) continue;
                    if (u.type === 'SETTLER' || u.type === 'WORKER' || isNaval(u)) continue;
                    // Already adjacent to a transport — board now.
                    const adjTr = transports.find(tr =>
                        Math.abs(tr.x - u.x) + Math.abs(tr.z - u.z) === 1);
                    if (adjTr) {
                        const cap = (UNIT_TYPE[adjTr.type] && UNIT_TYPE[adjTr.type].capacity) || 2;
                        if (((adjTr.cargo || []).length) < cap) {
                            actions.push({ type: 'board', unitId: u.id, transportId: adjTr.id });
                            acted.add(u.id);
                            continue;
                        }
                    }
                    // Otherwise move toward the nearest transport.
                    let nearest = null, nearestDist = Infinity;
                    for (const tr of transports) {
                        const cap = (UNIT_TYPE[tr.type] && UNIT_TYPE[tr.type].capacity) || 2;
                        if (((tr.cargo || []).length) >= cap) continue;
                        const d = manhattan(u.x, u.z, tr.x, tr.z);
                        if (d < nearestDist) { nearestDist = d; nearest = tr; }
                    }
                    if (nearest) {
                        const step = stepToward(u, nearest, tiles, owner, units, moved, isAtWar);
                        if (step && !moved.has(`${step.x},${step.z}`)) {
                            actions.push({ type: 'move', unitId: u.id, tx: step.x, tz: step.z });
                            moved.add(`${step.x},${step.z}`);
                            acted.add(u.id);
                        }
                    }
                }
            }
        }
    }

    // 5d. Breached-city detachment: a breached, empty, capturable city beyond
    //     the adjacent-capture radius otherwise sits unclaimed forever while
    //     every army marches on the shared strategic target. Detach ONE
    //     military unit per such city: retarget a whole singleton group, or
    //     peel the closest member off a larger group (never the king's guard,
    //     never a retreating group, never emptying a group). Gated on the
    //     pre-spending gold snapshot — `res` is already drained by training
    //     and building at this point.
    if (goldBeforeSpending >= CAPTURE_COST) {
        for (const t of tiles.values()) {
            if (t.terrain !== 'CITY' || t.owner === owner) continue;
            if ((t.fortification || 0) > 0) continue;
            if (t.owner && isAtWar && !isAtWar(t.owner)) continue;
            // Same capture rules as findAdjacentCapturable: no unit may still
            // occupy the city tile.
            const cityKey = `${t.x},${t.z}`;
            if (claimedCityKeys.has(cityKey)) continue; // already claimed this turn
            // A conquest group is already marching here — no detachment needed.
            if (strategicTarget && strategicTarget.x === t.x && strategicTarget.z === t.z) continue;
            let occupied = false;
            for (const u of units.values()) {
                if (u.x === t.x && u.z === t.z) { occupied = true; break; }
            }
            if (occupied) continue;

            const detachable = (u) => !acted.has(u.id) && !u.hasMovedThisTurn &&
                u.type !== 'SETTLER' && u.type !== 'WORKER' && u.type !== 'SCOUT' && !isNaval(u);
            let donorGroup = null, donorUnit = null, donorD = Infinity;
            // Pass A: nearest singleton group (retarget it wholesale — a weak
            // idle group wins over peeling a member off a real army).
            for (const g of groups) {
                if (g === kingGuardGroup || g.id.startsWith('detach:')) continue;
                if (groupStances.get(g) === 'retreat') continue;
                if (g.units.length !== 1 || !detachable(g.units[0])) continue;
                const d = manhattan(g.units[0].x, g.units[0].z, t.x, t.z);
                if (d <= AI_BREACH_DETACH_RADIUS && d < donorD) {
                    donorGroup = g; donorUnit = g.units[0]; donorD = d;
                }
            }
            // Pass B: peel the closest member off a group with 2+ units.
            if (!donorUnit) {
    // 5e. Per-group siege need: detect conquest groups targeting a fortified
    //     city that have no siege units, and boost siege production to fill
    //     the gap. This replaces the fixed global siege cap with a dynamic
    //     per-group need — if 2 groups each need siege, train 2 siege units
    //     even if the global cap was already met.
    if (conquest.size > 0 && hasSiegeWorkshop || siegeOptions.length) {
        let groupsNeedingSiege = 0;
        for (const g of conquest) {
            const obj = groupObjectives.get(g);
            if (!obj) continue;
            // Is the objective a fortified enemy city?
            const objTile = tiles.get(`${obj.x},${obj.z}`);
            if (!objTile || objTile.terrain !== 'CITY') continue;
            if ((objTile.fortification || 0) <= 0) continue; // already breached
            // Does the group have any siege units?
            const hasSiegeInGroup = g.units.some(u => {
                const ut = UNIT_TYPE[u.type];
                return ut && ut.besiege;
            });
            if (!hasSiegeInGroup) groupsNeedingSiege++;
        }
        // For each group needing siege, try to train one more siege unit
        // beyond the normal cap. Resources permitting.
        for (let i = 0; i < groupsNeedingSiege; i++) {
            if (!siegeOptions.length && engineerCount >= groupsNeedingSiege) break;
            if (siegeOptions.length) {
                let pick = bestSiegePick(siegeOptions, factionDef);
                const sc = getUnitCostFor(pick, factionDef);
                if (canAfford(pick, res, sc)) {
                    const workshopCity = hasSiegeWorkshop && owned.find(t => t.terrain === 'CITY' &&
                        (buildings.get(`${t.x},${t.z}`) || []).includes('SIEGE_WORKSHOP'));
                    const spawnTile = workshopCity || findOwnedTile(myUnits, tiles, actions, owner);
                    if (spawnTile) {
                        actions.push({ type: 'train', unitType: pick, tileKey: `${spawnTile.x},${spawnTile.z}` });
                        res = spendCost(pick, res, sc);
                    }
                }
            } else if (!hasModernSiegeTech && engineerCount < groupsNeedingSiege + 1) {
                // No trainable siege — train an engineer to build a siege tower.
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
    }

    for (const g of groups) {
                    if (g === kingGuardGroup || g.id.startsWith('detach:')) continue;
                    if (groupStances.get(g) === 'retreat') continue;
                    if (g.units.length < 2) continue;
                    for (const u of g.units) {
                        if (!detachable(u)) continue;
                        const d = manhattan(u.x, u.z, t.x, t.z);
                        if (d <= AI_BREACH_DETACH_RADIUS && d < donorD) {
                            donorGroup = g; donorUnit = u; donorD = d;
                        }
                    }
                }
            }
            if (!donorUnit) continue;
            // Land-locked detachments only — a foot unit can't cross water.
            if (!isReachableByLand(tiles, donorUnit.x, donorUnit.z, t.x, t.z)) continue;
            if (donorGroup.units.length > 1) {
                donorGroup.units = donorGroup.units.filter(u => u !== donorUnit);
                donorGroup = { id: 'detach:' + donorUnit.id, lords: [], units: [donorUnit] };
                groups.push(donorGroup);
            }
            groupObjectives.set(donorGroup, t);
            groupStances.set(donorGroup, 'engage');
            claimedCityKeys.add(cityKey); // one unit per breached city per turn
        }
    }

    // Persist a lightweight army-group summary for the army-groups debug panel
    // (size, stance, objective, leader, power, unit-type composition per
    // group) — rebuilt every turn. Runs AFTER the 5c/5d passes so naval
    // embarkation retargets and breach-detachment groups are included.
    if (aiState) {
        aiState.armyGroups = groups.map(g => {
            const obj = groupObjectives.get(g);
            const composition = {};
            for (const u of g.units) composition[u.type] = (composition[u.type] || 0) + 1;
            return {
                id: g.id,
                size: g.units.length,
                stance: groupStances.get(g) || 'hold',
                objective: obj ? `${obj.x},${obj.z}` : null,
                lord: (g.lords && g.lords[0]) ? (g.lords[0].name || null) : null,
                lords: (g.lords || []).map(l => l.name || null).filter(Boolean),
                power: g.units.reduce((s, u) => s + unitValue(u), 0),
                composition,
            };
        });
        // Persist naval fleet groups for the debug panel.
        aiState.navalGroups = navalGroups.map(ng => {
            const obj = navalGroupObjectives.get(ng);
            const composition = {};
            for (const u of ng.units) composition[u.type] = (composition[u.type] || 0) + 1;
            const power = ng.units.reduce((s, u) => s + calculateAdjustedPower(u), 0);
            return {
                id: ng.id,
                size: ng.units.length,
                stance: ng.role,
                objective: obj ? `${obj.x},${obj.z}` : null,
                lord: null,
                power,
                role: ng.role,
                composition,
            };
        });
    }

    for (const g of groups) {
        const objective = groupObjectives.get(g);
        const stance = groupStances.get(g);
        actions.push(...planGroup(g, objective, stance, units, tiles, owner,
            lords, buildings, tempBonuses, diploState, moved, acted, atWar, isAtWar, res, structures, activeObjectives, currentTurn));
    }

    // Idleness metric: military units that received no order this turn. A
    // large standing number here means armies are sitting at home — the
    // theater release/ferry systems above exist to drive this toward zero.
    if (aiState) {
        aiState.idleMilitaryCount = militaryPool.filter(u =>
            !acted.has(u.id) && !u.hasMovedThisTurn && !u.boarded).length;
    }

    // Store the last turn's actions in aiState for the debug panel to display.
    if (aiState) {
        if (!aiState.recentActions) aiState.recentActions = [];
        // Keep last 12 actions (build/train/upgrade — skip noise like moves).
        const significant = actions.filter(a =>
            a.type === 'train' || a.type === 'build' || a.type === 'upgradeBuilding' ||
            a.type === 'buildSiegeEngine' || a.type === 'capture');
        aiState.recentActions = significant.slice(-12);
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

/** Best siege pick from available options, preferring modern units over
 *  obsolete ones. Ranks by tech era (modern first) then by total cost.
 *  Siege-only units (SIEGE) rank low — CATAPULT/TREBUCHET are preferred
 *  because their AOE splash makes them useful in field battles, while SIEGE
 *  can only attack cities. */
const SIEGE_ERA_RANK = {
    'SIEGE_CANNON': 6, 'RAILGUN': 6, 'FIELD_GUN': 5,
    'CANNON': 4, 'MORTAR': 4, 'HORSE_ARTILLERY': 4,
    'ARTILLERY': 3,
    'TREBUCHET': 2, 'CATAPULT': 1,
    'SIEGE': 0,
};
function bestSiegePick(options, factionDef) {
    let best = null, bestEra = -1, bestCost = Infinity;
    for (const t of options) {
        const era = SIEGE_ERA_RANK[t] || 0;
        const c = getUnitCostFor(t, factionDef);
        const total = (c.gold||0)+(c.food||0)+(c.wood||0)+(c.iron||0)+(c.production||0);
        if (era > bestEra || (era === bestEra && total < bestCost)) {
            bestEra = era; bestCost = total; best = t;
        }
    }
    return best;
}

/** Pick the best defensive structure the AI can build, given its tech state.
 *  Categories: 'fort' (fortification line: FORTIFICATION -> BUNKER), 'trap'
 *  (FALL_TRAP -> MINEFIELD/AT_MINE), 'anticav' (SPIKES -> MINEFIELD).
 *  Modern variants are preferred when their tech is researched. Returns a
 *  structure type string the caller can pass to STRUCTURE_COST. */
function pickStructure(category, aiTs) {
    const unlocked = (aiTs && aiTs.researched) ? getUnlockedStructures(aiTs) : new Set();
    const has = (id) => unlocked.has(id);
    if (category === 'fort') {
        // BUNKER (modern) > FORTIFICATION (medieval).
        return has('BUNKER') ? 'BUNKER' : 'FORTIFICATION';
    }
    if (category === 'anticav') {
        // MINEFIELD damages all unit types (better than SPIKES which only hits
        // cavalry). AT_MINE is anti-armor specifically — prefer MINEFIELD as a
        // general-purpose upgrade, AT_MINE only when the enemy is armor-heavy
        // (the caller passes 'antitank' for that).
        return has('MINEFIELD') ? 'MINEFIELD' : 'SPIKES';
    }
    if (category === 'antitank') {
        // AT_MINE (anti-armor shaped charge) > MINEFIELD > FALL_TRAP.
        return has('AT_MINE') ? 'AT_MINE' : (has('MINEFIELD') ? 'MINEFIELD' : 'FALL_TRAP');
    }
    // Default trap: MINEFIELD > FALL_TRAP.
    return has('MINEFIELD') ? 'MINEFIELD' : 'FALL_TRAP';
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

/** Find an adjacent enemy military structure tile (Area 6c). Priority order
 *  HARBOR > SIEGE_WORKSHOP > BARRACKS so the AI knocks out the most valuable
 *  enemy production first. */
function findAdjacentMilitaryStructure(unit, tiles, owner, isAtWar, buildings) {
    const priority = { HARBOR: 3, SIEGE_WORKSHOP: 2, BARRACKS: 1 };
    let best = null, bestScore = -Infinity;
    for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
            const t = tiles.get(`${unit.x + dx},${unit.z + dz}`);
            if (!t) continue;
            if (!t.owner || t.owner === owner) continue;
            if (isAtWar && !isAtWar(t.owner)) continue;
            const list = (buildings && buildings.get(`${t.x},${t.z}`)) || [];
            for (const b of list) {
                if (BUILDING_TYPE[b] && BUILDING_TYPE[b].military) {
                    const score = priority[b] || 0;
                    if (score > bestScore) { bestScore = score; best = t; }
                }
            }
        }
    }
    return best;
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

/** Like findEnemyCityWithin but also accepts UNOWNED (neutral) cities — those
 *  are always valid conquest/siege targets, even at peace. Used by engineers so
 *  they build Siege Towers against neutral cities the army is about to crack. */
function findTargetCityWithin(unit, tiles, owner, isAtWar, radius) {
    let best = null, bestDist = Infinity, bestIsNeutral = false;
    for (let dx = -radius; dx <= radius; dx++) {
        for (let dz = -radius; dz <= radius; dz++) {
            const t = tiles.get(`${unit.x + dx},${unit.z + dz}`);
            if (!t || t.terrain !== 'CITY' || t.owner === owner) continue;
            const neutral = !t.owner; // unclaimed city
            if (!neutral && isAtWar && !isAtWar(t.owner)) continue;
            const d = Math.abs(dx) + Math.abs(dz);
            if (d < bestDist) { bestDist = d; best = t; bestIsNeutral = neutral; }
        }
    }
    return best ? { city: best, neutral: bestIsNeutral } : null;
}

/** Nearest valid target city (at-war enemy OR neutral) for an engineer to
 *  advance toward when out of tower-build range. */
function findNearestTargetCity(unit, tiles, owner, isAtWar) {
    let best = null, bestDist = Infinity;
    for (const t of tiles.values()) {
        if (t.terrain !== 'CITY' || t.owner === owner) continue;
        const neutral = !t.owner;
        if (!neutral && isAtWar && !isAtWar(t.owner)) continue;
        const d = manhattan(unit.x, unit.z, t.x, t.z);
        if (d < bestDist) { bestDist = d; best = t; }
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
 *  Manhattan distance) to the engineer's objective — i.e. the river is actually
 *  blocking the path forward, not a side branch.
 *  At war the objective is the nearest at-war enemy city (offense). At peace
 *  the objective is the nearest unowned passable tile (settler-led expansion /
 *  exploration), gated on `allowPeaceBridge` so a faction with no settler
 *  doesn't waste wood bridging rivers it has no reason to cross. */
function findBridgeTarget(unit, tiles, owner, isAtWar, atWar, allowPeaceBridge) {
    let objective = null;
    if (atWar) objective = findNearestEnemyCity(unit, tiles, owner, isAtWar);
    if (!objective && allowPeaceBridge) {
        let best = null, bestDist = Infinity;
        for (const t of tiles.values()) {
            if (t.owner === owner) continue;
            if (t.terrain === 'WATER' || t.terrain === 'MOUNTAIN' || t.terrain === 'RIVER') continue;
            const d = manhattan(unit.x, unit.z, t.x, t.z);
            if (d < bestDist) { bestDist = d; best = t; }
        }
        objective = best;
    }
    if (!objective) return null;
    const curDist = manhattan(unit.x, unit.z, objective.x, objective.z);
    const dirs = [[0, 1], [0, -1], [1, 0], [-1, 0]];
    for (const [dx, dz] of dirs) {
        const river = tiles.get(`${unit.x + dx},${unit.z + dz}`);
        if (!river || river.terrain !== 'RIVER' || river.bridge) continue;
        const far = tiles.get(`${unit.x + 2 * dx},${unit.z + 2 * dz}`);
        if (!far) continue;
        // Far side must not be water/mountain. It MAY be another unbridged
        // river: rivers can be several tiles wide, and the only way across is
        // a continuous bridge line — build this tile now, step onto it next
        // turn, and bridge the next one (previously the far-side river check
        // blocked anything but 1-tile bridges forever).
        if (far.terrain === 'WATER' || far.terrain === 'MOUNTAIN') continue;
        if (manhattan(far.x, far.z, objective.x, objective.z) < curDist) return river;
    }
    return null;
}

/** Find the nearest unbridged RIVER tile that lies between the engineer and
 *  its objective (enemy city at war, or nearest unowned passable tile at
 *  peace when a settler is in the field). Returns null if no such river is
 *  on the path. Used to drive engineers toward rivers they need to bridge
 *  — `findBridgeTarget` only fires once the engineer is ORTHOGONALLY
 *  adjacent to a river, so without this the engineer stops at the bank but
 *  may be diagonally offset from the river tile that needs bridging.
 *  @param {boolean} allowPeaceBridge - true when a settler is in the field
 *    (same gate as `findBridgeTarget`). */
function findNearestBridgeableRiver(unit, tiles, owner, isAtWar, atWar, allowPeaceBridge) {
    let objective = null;
    if (atWar) objective = findNearestEnemyCity(unit, tiles, owner, isAtWar);
    if (!objective && allowPeaceBridge) {
        let best = null, bestDist = Infinity;
        for (const t of tiles.values()) {
            if (t.owner === owner) continue;
            if (t.terrain === 'WATER' || t.terrain === 'MOUNTAIN' || t.terrain === 'RIVER') continue;
            const d = manhattan(unit.x, unit.z, t.x, t.z);
            if (d < bestDist) { bestDist = d; best = t; }
        }
        objective = best;
    }
    if (!objective) return null;
    const dToObj = manhattan(unit.x, unit.z, objective.x, objective.z);
    let bestRiver = null, bestDist = Infinity;
    for (const t of tiles.values()) {
        if (t.terrain !== 'RIVER' || t.bridge) continue;
        const dToRiver = manhattan(unit.x, unit.z, t.x, t.z);
        const dRiverToObj = manhattan(t.x, t.z, objective.x, objective.z);
        // River must be closer to objective than we are (i.e. blocking the
        // path) AND closer to us than to the objective (else bridging it is
        // premature). This avoids sending engineers to bridge rivers on the
        // far side of the objective.
        if (dRiverToObj < dToObj && dToRiver < bestDist) {
            bestDist = dToRiver;
            bestRiver = t;
        }
    }
    return bestRiver;
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
 *  a city, not water/mountain/river, not owned by anyone — AND not within the
 *  spacing rule enforced in foundCity() (Chebyshev distance < 4 from any city).
 *  Enemy cities get a larger no-settle zone (distance < 6) so settlers avoid
 *  settling inside enemy influence where the new city would be immediately
 *  threatened. */
function canFoundOn(tile, owner, tiles) {
    if (!tile) return false;
    if (tile.terrain === 'CITY') return false;
    if (tile.terrain === 'WATER' || tile.terrain === 'MOUNTAIN' || tile.terrain === 'RIVER') return false;
    if (tile.owner) return false; // unowned only (don't settle inside someone's borders)
    if (tiles) {
        for (const t of tiles.values()) {
            if (t.terrain !== 'CITY') continue;
            const cheb = Math.max(Math.abs(t.x - tile.x), Math.abs(t.z - tile.z));
            // Engine rule: can't found within 6 Chebyshev of any friendly city
            // (MIN_CITY_SPACING). Prevents tightly clustered settlements.
            if (t.owner === owner && cheb < 6) return false;
            // Can't found within 4 Chebyshev of any city (general spacing).
            if (cheb < 4) return false;
            // Extra safety: don't settle within 6 of enemy cities (inside influence).
            if (t.owner && t.owner !== owner && cheb < 6) return false;
        }
    }
    return true;
}

/** Evaluate how desirable it is to train settlers right now, on a 0..1 scale.
 *  Used to drive the long-term (turns 1-50) settler production boost. The score
 *  combines:
 *  - Open land: fraction of home-landmass tiles that are valid found spots
 *    (more open space = more to grab, worth a stronger push).
 *  - Scarcity: current stock/flow shortages of iron/wood/food/gold push the
 *    score up — founding cities is the durable fix for a bleeding economy.
 *  - Allied proximity: found spots near allied cities are safe to settle and
 *    form a connected front, so they add to desirability.
 *  - Weak enemy presence: spots near undefended enemy cities are valuable
 *    forward outposts, so they add to desirability.
 *  Returns { score (0..1), openSpots, openRatio, scarcityFactor, alliedFactor,
 *  weakEnemyFactor }. Exported for tests. */
export function evaluateSettleDesirability(tiles, owner, land, homeMass, resources = null, diploState = null, units = null, factionDef = null, drainingResource = null) {
    let homeLandTiles = 0;
    let openSpots = 0;
    const spotTiles = [];
    for (const t of tiles.values()) {
        if (t.terrain === 'WATER') continue;
        if (homeMass != null && land) {
            if (land.idOf.get(`${t.x},${t.z}`) !== homeMass) continue;
        }
        homeLandTiles++;
        if (canFoundOn(t, owner, tiles)) { openSpots++; spotTiles.push(t); }
    }
    const openRatio = homeLandTiles > 0 ? openSpots / homeLandTiles : 0;

    // Scarcity: stock lows and a draining resource both count. Base 0.5 so a
    // balanced economy still yields a neutral scarcity factor.
    const res = resources || {};
    let scarcityScore = 0;
    if ((res.iron || 0) < 30 || drainingResource === 'iron') scarcityScore += 0.15;
    if ((res.wood || 0) < 40 || drainingResource === 'wood') scarcityScore += 0.15;
    if ((res.food || 0) < 50 || drainingResource === 'food') scarcityScore += 0.15;
    if ((res.gold || 0) < 60 || drainingResource === 'gold') scarcityScore += 0.15;
    const scarcityFactor = Math.min(1, 0.5 + scarcityScore);

    // Allied proximity: fraction of found spots with an allied city within 10
    // tiles. Allied neighbours mean a safe, connected frontier.
    let alliedSpots = 0;
    if (diploState && openSpots > 0) {
        for (const spot of spotTiles) {
            let near = false;
            for (const t of tiles.values()) {
                if (t.terrain !== 'CITY' || t.owner === owner) continue;
                if (isAllied(diploState, owner, t.owner) && manhattan(t.x, t.z, spot.x, spot.z) <= 10) { near = true; break; }
            }
            if (near) alliedSpots++;
        }
    }
    const alliedFactor = openSpots > 0 ? alliedSpots / openSpots : 0;

    // Weak enemy presence: fraction of found spots whose nearest enemy city
    // has a garrison below WEAK_CITY_GARRISON_THRESHOLD. Weak neighbours mean
    // the new city is a low-risk forward outpost.
    let weakSpots = 0;
    if (units && openSpots > 0) {
        for (const spot of spotTiles) {
            let nearestGarrison = Infinity;
            for (const t of tiles.values()) {
                if (t.terrain !== 'CITY' || !t.owner || t.owner === owner) continue;
                if (diploState && isAllied(diploState, owner, t.owner)) continue;
                const d = manhattan(t.x, t.z, spot.x, spot.z);
                if (d <= 8 && d < nearestGarrison) {
                    let garrison = 0;
                    for (const u of units.values()) {
                        if (u.owner === t.owner && !u.boarded && Math.max(Math.abs(u.x - t.x), Math.abs(u.z - t.z)) <= 3) garrison++;
                    }
                    nearestGarrison = garrison;
                }
            }
            if (nearestGarrison < WEAK_CITY_GARRISON_THRESHOLD) weakSpots++;
        }
    }
    const weakEnemyFactor = openSpots > 0 ? weakSpots / openSpots : 0;

    // Combine: open land dominates, scarcity amplifies, allied safety and weak
    // enemies add modest bonuses. Clamped to 0..1.
    const score = Math.max(0, Math.min(1,
        openRatio * 1.2 * scarcityFactor + alliedFactor * 0.25 + weakEnemyFactor * 0.2));

    return { score, openSpots, openRatio, scarcityFactor, alliedFactor, weakEnemyFactor };
}

/** Compute per-terrain settlement weights based on what the faction actually
 *  needs: cavalry/artillery/siege rosters crave iron, archer rosters want wood,
 *  everyone wants food/gold. Low stockpiles amplify the matching terrain. */
export function resourceNeedWeights(factionDef, resources, drainingResource = null) {
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
    // Flow-aware bias: if a resource is draining fast this turn, push the
    // settler toward terrain that yields that resource so the new city can
    // shore up the shortfall. Doubles the existing stock-based bonus.
    if (drainingResource === 'food') { w.PLAINS += 1.0; w.RIVER += 1.0; }
    else if (drainingResource === 'wood') { w.FOREST += 1.5; }
    else if (drainingResource === 'iron') { w.MOUNTAIN += 1.5; w.HILLS += 1.0; }
    else if (drainingResource === 'gold') { w.DESERT += 0.8; w.MOUNTAIN += 0.5; }
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
function findFoundSpot(unit, tiles, owner, land = null, massId = null, units = null, factionDef = null, resources = null, preferCoastal = false, drainingResource = null, atWar = false) {
    // `preferCoastal` may be a boolean (true → default +150) or a numeric bonus.
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
        if (!canFoundOn(t, owner, tiles)) continue;
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
        const needWeights = resourceNeedWeights(factionDef, resources, drainingResource);
        
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
        // This is the key change — rewards expansion into new regions. Capped at
        // 12 tiles so settlers don't chase infinite-distance frontier into enemy
        // territory, and halved while at war (a settler deep in enemy lands dies).
        const frontierScale = atWar ? 0.5 : 1.0;
        if (nearestCityDist > 8) score += Math.round(AI_FRONTIER_BONUS_CLOSE * frontierScale);   // Very far — great frontier
        else if (nearestCityDist > 5) score += Math.round(AI_FRONTIER_BONUS_MID * frontierScale); // Moderately far
        else if (nearestCityDist > 3) score += Math.round(AI_FRONTIER_BONUS_FAR * frontierScale); // Somewhat far
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

        // Coastal preference: an island / naval-expanding faction should found
        // on a coast so it can build a Harbor and keep expanding by sea instead
        // of stranding itself inland on a tiny islet. Strong bonus when the
        // faction needs a harbor and doesn't have one yet. `preferCoastal` may
        // be a boolean or a numeric bonus amount (coastal-desperate case).
        const coastalBonusAmt = preferCoastal === true ? 150
            : (typeof preferCoastal === 'number' ? preferCoastal : 0);
        if (coastalBonusAmt > 0) {
            let coastal = false;
            for (const [dx, dz] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
                const nt = tiles.get(`${t.x + dx},${t.z + dz}`);
                if (nt && (nt.terrain === 'WATER' || nt.terrain === 'RIVER')) { coastal = true; break; }
            }
            if (coastal) score += coastalBonusAmt;
        }
        
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
        HILLS: 'MINE',
        CITY: 'MARKET'
    };
    const type = candidates[tile.terrain];
    if (!type || existing.includes(type)) return null;
    if (!canAffordBuilding(type, resources)) return null;
    return type;
}

/** The terrain improvement (FARM/LUMBERMILL/MINE) that fits this terrain, or
 *  null for terrains with no improvement (DESERT/MARSH/TUNDRA/WATER/etc).
 *  MINE works on both MOUNTAIN and HILLS (mirrors BUILDING_TYPE.terrains).
 *  Exported for tests. */
export function improvementForTerrain(terrain) {
    return ({ PLAINS: 'FARM', FOREST: 'LUMBERMILL', MOUNTAIN: 'MINE', HILLS: 'MINE' })[terrain] || null;
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
 *  Priority order is MINE > FARM > LUMBERMILL at any stock level (iron is the
 *  military-critical resource — the user-facing "strong iron" preference),
 *  with low stockpiles amplifying the matching terrain further. HILLS counts
 *  as a mine site (mirrors BUILDING_TYPE.terrains). Returns the tile or null.
 *  Exported for tests. */
export function findImprovementSpot(unit, tiles, owner, buildings, influence, resources) {
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
            // Strong iron preference: always above FARM/LUMBERMILL, huge boost
            // when iron is low, mild decay when iron is plentiful.
            score = 100 - iron * 0.6;
            if (iron < 20) score += 80;
            if (iron < 40) score += 40;
        } else if (b === 'FARM') {
            score = 60 - food * 0.6;           // priority when food is low
            if (food < 15) score += 60;
        } else { // LUMBERMILL
            // Only worth building when wood is scarce; otherwise the AI keeps
            // mines/farms ahead of lumbermills.
            if (wood >= 50) score = 0;
            else { score = 25 - wood * 0.4; if (wood < 15) score += 50; }
        }
        score -= Math.max(Math.abs(t.x - unit.x), Math.abs(t.z - unit.z)) * 3;
        if (score > bestScore) { bestScore = score; best = t; }
    }
    return best;
}

/** Composition role buckets for the AI army. */
const MELEE_TYPES = new Set(['INFANTRY', 'PIKEMAN', 'LEGIONNAIRE', 'BERSERKER', 'VARANGIAN_GUARD', 'STONE_GUARD', 'SHINOBI', 'JAGUAR_WARRIOR', 'LINE_INFANTRY', 'HALBERDIER', 'PIKE_MASTER', 'BAYONET_RIFLE', 'ANTI_TANK_GUN', 'RPG_TEAM', 'MOBILIZED_INFANTRY', 'HOUSEHOLD_GUARD', 'RAIDER']);
const RANGED_TYPES = new Set(['ARCHER', 'LONGBOWMAN', 'CROSSBOWMAN', 'MUSKETEER', 'ARQUEBUSIER', 'DRAGOON', 'RIFLEMAN', 'SHARPSHOOTER', 'BATTLE_MAGE', 'ARMORED_CAR', 'FRONTIERSMAN', 'TANK', 'HEAVY_TANK']);
const CAVALRY_TYPES = new Set(['CAVALRY', 'CATAPHRACT', 'CHARIOT', 'WINGED_HUSSAR', 'CONQUISTADOR', 'DRAGOON', 'HORSE_ARTILLERY', 'TANK', 'HEAVY_TANK', 'ARMORED_CAR', 'MERCENARY_KNIGHT', 'FRONTIERSMAN']);
const SIEGE_TYPES = new Set(['SIEGE', 'ARTILLERY', 'CATAPULT', 'TREBUCHET', 'TIGER_CANNON', 'SIEGE_TOWER', 'CANNON', 'MORTAR', 'FIELD_GUN', 'HORSE_ARTILLERY', 'SIEGE_CANNON', 'RAILGUN', 'ARMORED_TRAIN', 'MOBILIZED_ARTILLERY', 'MOTOR_ARTILLERY']);
// Support = engineers + medics. DEMOLITION_SQUAD and COMBAT_ENGINEER are
// engineer upgrades (canBuildBridge/canBuildStructure), so they're support,
// not melee — keeps the AI from throwing them into the front line as melee.
const SUPPORT_TYPES = new Set(['MEDIC', 'ENGINEER', 'DEMOLITION_SQUAD', 'COMBAT_ENGINEER']);
const NAVAL_TYPES = new Set(['GALLEY', 'TRANSPORT', 'FRIGATE', 'GALLEON', 'MAN_OF_WAR', 'GALLEASS', 'PINNACE', 'CORVETTE', 'FROLIC', 'MERCHANTMAN', 'IRONCLAD', 'STEAM_TRANSPORT', 'GUNBOAT', 'IRONCLAD_FRIGATE', 'MONITOR', 'FRIGATE_2', 'SUBMARINE', 'TORPEDO_BOAT', 'DESTROYER', 'BATTLESHIP', 'AIRCRAFT_CARRIER', 'TRANSPORT_SHIP', 'SUBMARINE_II']);
const FRAGILE_TYPES = new Set(['ARCHER', 'LONGBOWMAN', 'CROSSBOWMAN', 'MUSKETEER', 'ARQUEBUSIER', 'ARTILLERY', 'CANNON', 'MORTAR', 'FIELD_GUN', 'HORSE_ARTILLERY', 'RAILGUN', 'SIEGE_CANNON', 'RIFLEMAN', 'SHARPSHOOTER', 'BATTLE_MAGE', 'TIGER_CANNON', 'WORKER', 'SETTLER', 'SCOUT', 'ARMORED_CAR', 'FRONTIERSMAN', 'MOBILIZED_ARTILLERY', 'SUBMARINE_II', 'ANTI_TANK_GUN', 'RPG_TEAM']);

function unitRole(type) {
    // Anti-cavalry specialists get their own composition role so the AI trains
    // them reactively against cavalry/tank-heavy enemies, while still treating
    // them as melee for escort/combat logic via MELEE_TYPES.
    if (UNIT_TYPE[type] && UNIT_TYPE[type].antiCavalry) return 'antiCavalry';
    if (MELEE_TYPES.has(type)) return 'melee';
    // Cavalry before ranged/siege: DRAGOON, TANK, HEAVY_TANK, ARMORED_CAR and
    // HORSE_ARTILLERY are all mounted/mobile units and should fill the cavalry
    // composition role. Without this, the only cavalry-counting units are
    // medieval horse units that obsolete quickly, so the AI stops producing
    // "cavalry" entirely after FLINTLOCK/ARMOR.
    if (CAVALRY_TYPES.has(type)) return 'cavalry';
    if (RANGED_TYPES.has(type)) return 'ranged';
    if (SIEGE_TYPES.has(type)) return 'siege';
    if (SUPPORT_TYPES.has(type)) return 'support';
    if (NAVAL_TYPES.has(type)) return 'naval';
    return 'other';
}

/** How close a friendly combat escort must be for a siege engine/tower to
 *  advance on the objective (Chebyshev tiles). */
const SIEGE_ESCORT_RADIUS = 3;

/** The nearest friendly escort — a melee/ranged/cavalry combat unit OR a
 *  friendly lord/king that can actually protect a siege engine or tower on the
 *  march (workers, engineers, medics, scouts and other siege units don't count).
 *  Returns { unit, dist } with dist in Chebyshev tiles, or null when the faction
 *  has no escorts at all. */
function nearestEscort(unit, units, owner, lords = null) {
    let best = null, bestDist = Infinity;
    for (const u of units.values()) {
        if (u.owner !== owner || u.id === unit.id) continue;
        const r = unitRole(u.type);
        if (r !== 'melee' && r !== 'ranged' && r !== 'cavalry') continue;
        const d = Math.max(Math.abs(u.x - unit.x), Math.abs(u.z - unit.z));
        if (d < bestDist) { bestDist = d; best = u; }
    }
    // Lords/kings are powerful combatants and valid escorts for siege engines.
    for (const l of (lords || [])) {
        if (l.owner !== owner) continue;
        const d = Math.max(Math.abs(l.x - unit.x), Math.abs(l.z - unit.z));
        if (d < bestDist) { bestDist = d; best = l; }
    }
    return best ? { unit: best, dist: bestDist } : null;
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
    const counts = { melee: 0, ranged: 0, cavalry: 0, antiCavalry: 0, siege: 0, support: 0, naval: 0 };
    // `units` may be a Map (keyed by id) or an array of unit objects. Handle
    // both so unit tests passing a Map work the same as the real pipeline
    // (which passes an array from [...units.values()]).
    const iter = (units && units.values) ? units.values() : (units || []);
    for (const u of iter) {
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
export function factionComposition(def, roster, hasSiegeWorkshop = false) {
    // `has('siege')` requires a TRAINABLE siege unit. SIEGE_TOWER is engineer-
    // built (never trained), so it must not count. A SIEGE_WORKSHOP unlocks
    // CATAPULT/TREBUCHET for EVERY faction (they're added to fullRoster in
    // computeAIActions), so a faction with a workshop can fill the siege role
    // even if its roster has no SIEGE/ARTILLERY — without this, no-siege-roster
    // factions (Golden, Verdant, Shadow, Storm, Frost) keep a siege target they
    // can never fill even after building a workshop, and the siege role is
    // zeroed out so they never train the artillery they just unlocked.
    const has = (role) => {
        if (role === 'siege') {
            if (roster.some(t => unitRole(t) === 'siege')) return true;
            return hasSiegeWorkshop;
        }
        return roster.some(t => unitRole(t) === role);
    };
    const id = def && def.id;
    let t;
    switch (id) {
        case 'crimson':  t = { melee: 0.30, ranged: 0.10, cavalry: 0.40, antiCavalry: 0.00, siege: 0.15, support: 0.05, naval: 0.00 }; break;
        case 'golden':   t = { melee: 0.20, ranged: 0.15, cavalry: 0.45, antiCavalry: 0.00, siege: 0.10, support: 0.10, naval: 0.00 }; break;
        case 'obsidian': t = { melee: 0.30, ranged: 0.15, cavalry: 0.30, antiCavalry: 0.00, siege: 0.20, support: 0.05, naval: 0.00 }; break;
        case 'verdant':  t = { melee: 0.45, ranged: 0.30, cavalry: 0.00, antiCavalry: 0.00, siege: 0.10, support: 0.15, naval: 0.00 }; break;
        case 'violet':   t = { melee: 0.30, ranged: 0.25, cavalry: 0.00, antiCavalry: 0.00, siege: 0.35, support: 0.10, naval: 0.00 }; break;
        case 'azure':    t = { melee: 0.40, ranged: 0.25, cavalry: 0.00, antiCavalry: 0.05, siege: 0.20, support: 0.10, naval: 0.00 }; break;
        case 'iron':     t = { melee: 0.30, ranged: 0.00, cavalry: 0.00, antiCavalry: 0.00, siege: 0.35, support: 0.15, naval: 0.00 }; break;
        case 'shadow':   t = { melee: 0.35, ranged: 0.45, cavalry: 0.00, antiCavalry: 0.00, siege: 0.10, support: 0.10, naval: 0.00 }; break;
        case 'frost':    t = { melee: 0.45, ranged: 0.30, cavalry: 0.00, antiCavalry: 0.05, siege: 0.05, support: 0.15, naval: 0.00 }; break;
        case 'storm':    t = { melee: 0.20, ranged: 0.15, cavalry: 0.15, antiCavalry: 0.00, siege: 0.10, support: 0.05, naval: 0.35 }; break;
        // --- New European factions (Phase G) ---
        case 'roman':    t = { melee: 0.50, ranged: 0.00, cavalry: 0.00, antiCavalry: 0.00, siege: 0.20, support: 0.10, naval: 0.00 }; break;
        case 'viking':   t = { melee: 0.40, ranged: 0.00, cavalry: 0.40, antiCavalry: 0.00, siege: 0.10, support: 0.10, naval: 0.00 }; break;
        case 'byzantine':t = { melee: 0.35, ranged: 0.25, cavalry: 0.25, antiCavalry: 0.00, siege: 0.10, support: 0.05, naval: 0.00 }; break;
        case 'spanish':  t = { melee: 0.30, ranged: 0.20, cavalry: 0.40, antiCavalry: 0.00, siege: 0.05, support: 0.05, naval: 0.00 }; break;
        case 'polish':   t = { melee: 0.30, ranged: 0.00, cavalry: 0.50, antiCavalry: 0.00, siege: 0.10, support: 0.10, naval: 0.00 }; break;
        default:         t = { melee: 0.35, ranged: 0.25, cavalry: 0.20, antiCavalry: 0.00, siege: 0.15, support: 0.05, naval: 0.00 };
    }
    // Zero out (and renormalize) roles the roster can't fill.
    let sum = 0;
    for (const r of Object.keys(t)) {
        if ((r === 'support') || r === 'naval' || r === 'cavalry' || r === 'antiCavalry' || r === 'ranged' || r === 'siege' || r === 'melee') {
            if (!has(r)) t[r] = 0;
        }
        sum += t[r];
    }
    if (sum > 0) for (const r of Object.keys(t)) t[r] = t[r] / sum;
    return t;
}

/** Effective army composition target after objective-driven tweaks. The siege
 *  ratio swings hardest: a siege objective (an active siege, or a conquest
 *  goal — wired in via `trainObjective` in computeAIActions) leans hard into
 *  siege engines at the expense of cavalry, while a decisive field battle or
 *  defense pulls siege back in favor of melee/cavalry. The result is
 *  renormalized to sum 1. Shared by findAffordableUnit (training) and the AI
 *  debug panel (via the aiState.targetComposition snapshot persisted each
 *  turn) so both show the SAME effective target. */
export function effectiveComposition(def, roster, hasSiegeWorkshop = false, objective = null) {
    const target = factionComposition(def, roster, hasSiegeWorkshop);
    if (!objective) return target;
    if (objective.siege && (target.siege > 0 || hasSiegeWorkshop)) {
        // Only lean into siege when the faction can actually field siege units
        // (roster siege or a workshop) — otherwise the boost would land on an
        // unfillable role and just dilute the trainable ones. Cavalry takes
        // the biggest cut; ranged keeps a small share so gunpowder-era ranged
        // lines don't vanish entirely during a conquest.
        target.siege = Math.min(0.65, target.siege + 0.45);
        target.cavalry = Math.max(0, target.cavalry - 0.15);
        target.ranged = Math.max(0, target.ranged - 0.05);
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
    } else {
        return target;
    }
    // Renormalize.
    const sum = Object.values(target).reduce((a, b) => a + b, 0);
    if (sum > 0) for (const r of Object.keys(target)) target[r] = target[r] / sum;
    return target;
}

function roleDeficit(roster, counts, total, target) {
    const available = new Set();
    for (const t of roster) available.add(unitRole(t));
    // Don't chase support units until the army has a little mass, but don't
    // gate them behind total >= 8 either -- that starved the engineer corps
    // (support) for most of the early game and left the army all-infantry.
    if (total < 4) available.delete('support');
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
/** Modern-first preference order per combat role. Position in the list is the
 *  era proxy: index 0 is the most modern unit of the role, later entries are
 *  progressively older/weaker. Signature units are listed first within their
 *  role so a faction that has them trains them (the roster filter skips units
 *  a faction lacks); the canAfford gate means early/cheap armies still fall
 *  back to cheaper units when the signature is too expensive. */
const ROLE_ORDER = {
    melee:   ['HEAVY_TANK', 'TANK', 'MOTOR_ARTILLERY', 'MOBILIZED_INFANTRY', 'LEGIONNAIRE', 'BERSERKER', 'VARANGIAN_GUARD', 'LINE_INFANTRY', 'PIKEMAN', 'INFANTRY', 'HOUSEHOLD_GUARD', 'RAIDER'],
    ranged:  ['RIFLEMAN', 'SHARPSHOOTER', 'MUSKETEER', 'CROSSBOWMAN', 'ARQUEBUSIER', 'LONGBOWMAN', 'DRAGOON', 'ARCHER', 'ARMORED_CAR', 'FRONTIERSMAN'],
    cavalry: ['HEAVY_TANK', 'TANK', 'ARMORED_CAR', 'WINGED_HUSSAR', 'CONQUISTADOR', 'CATAPHRACT', 'HORSE_ARTILLERY', 'MERCENARY_KNIGHT', 'CAVALRY', 'CHARIOT'],
    antiCavalry: ['RPG_TEAM', 'ANTI_TANK_GUN', 'BAYONET_RIFLE', 'PIKE_MASTER', 'HALBERDIER'],
    siege:   ['MOTOR_ARTILLERY', 'MOBILIZED_ARTILLERY', 'SIEGE_CANNON', 'RAILGUN', 'FIELD_GUN', 'CANNON', 'MORTAR', 'SIEGE', 'ARTILLERY', 'CATAPULT', 'TREBUCHET', 'HORSE_ARTILLERY'],
    support: ['COMBAT_ENGINEER', 'DEMOLITION_SQUAD', 'ENGINEER', 'MEDIC'],
    naval:   ['AIRCRAFT_CARRIER', 'BATTLESHIP', 'SUBMARINE_II', 'DESTROYER', 'MONITOR', 'IRONCLAD_FRIGATE', 'IRONCLAD', 'SUBMARINE', 'TORPEDO_BOAT', 'MAN_OF_WAR', 'GALLEON', 'FRIGATE', 'FRIGATE_2', 'GALLEY', 'TRANSPORT_SHIP', 'TRANSPORT', 'CORVETTE', 'FROLIC', 'PINNACE', 'GUNBOAT', 'STEAM_TRANSPORT', 'MERCHANTMAN'],
};

const ANTI_CAVALRY_TYPES = new Set(['HALBERDIER', 'PIKE_MASTER', 'BAYONET_RIFLE', 'ANTI_TANK_GUN', 'RPG_TEAM']);

/** Faction specialty units — each faction's signature/unique unit that the AI
 *  should prioritize when it's in the roster and affordable. These get boosted
 *  to the front of the role-order pick so the AI actually fields its unique
 *  units (LEGIONNAIRE, BERSERKER, CONQUISTADOR, etc.) instead of always
 *  falling back to generic INFANTRY/CAVALRY. Only faction-unique units are
 *  listed here — generic units like CAVALRY are already in ROLE_ORDER and
 *  shouldn't override era-appropriate picks. */
const FACTION_SPECIALTY_UNITS = {
    roman:    ['LEGIONNAIRE'],
    viking:   ['BERSERKER'],
    byzantine:['VARANGIAN_GUARD'],
    spanish:  ['CONQUISTADOR'],
    polish:   ['WINGED_HUSSAR'],
    ming:     ['TIGER_CANNON'],
    stone:    ['STONE_GUARD'],
    arcane:   ['BATTLE_MAGE'],
    lotus:    ['SHINOBI'],
    sun:      ['JAGUAR_WARRIOR'],
};

/** Get the specialty unit(s) for a faction that are in the roster and
 *  currently affordable. Returns an array (possibly empty) in priority order. */
function affordableSpecialty(factionDef, roster, resources) {
    if (!factionDef || !factionDef.id) return [];
    const specs = FACTION_SPECIALTY_UNITS[factionDef.id];
    if (!specs) return [];
    const out = [];
    for (const t of specs) {
        if (!roster.includes(t)) continue;
        if (canAfford(t, resources, getUnitCostFor(t, factionDef))) out.push(t);
    }
    return out;
}

/** Adjust composition targets based on what the enemy is fielding.
 *  Cavalry hard-counters infantry and artillery, so increase the cavalry share
 *  when the enemy has many of those and few anti-cavalry specialists. Pull back
 *  when the enemy is bristling with pikes/anti-tank teams. If the enemy's
 *  infantry/artillery outnumber ours, raise the cavalry target more aggressively
 *  (+0.25); otherwise a moderate +0.20 bump.
 *  Also boost anti-cavalry when the enemy fields tanks, heavy tanks, armored
 *  cars, or a lot of mounted units. */
function adjustTargetForEnemyComposition(target, units, owner, isAtWar, counts = null) {
    if (!isAtWar || !units) return target;
    let enemyInfantry = 0;
    let enemyArtillery = 0;
    let enemyAntiCav = 0;
    let enemyArmor = 0;
    let enemyMounted = 0;
    for (const u of (units.values ? units.values() : units)) {
        if (u.owner === owner) continue;
        if (!isAtWar(u.owner)) continue;
        const role = unitRole(u.type);
        if (role === 'melee') enemyInfantry++;
        else if (role === 'siege') enemyArtillery++;
        if (ANTI_CAVALRY_TYPES.has(u.type)) enemyAntiCav++;
        if (['TANK', 'HEAVY_TANK', 'ARMORED_CAR'].includes(u.type)) enemyArmor++;
        if (CAVALRY_TYPES.has(u.type)) enemyMounted++;
    }
    const softTargets = enemyInfantry + enemyArtillery;
    const mySoft = (counts ? (counts.melee || 0) + (counts.siege || 0) : 0);
    const enemyOutnumbers = mySoft > 0 ? softTargets > mySoft : softTargets > 0;
    if (softTargets > 0 && enemyAntiCav * 2 < softTargets) {
        // Stronger reactive cavalry: cavalry hard-counters infantry/artillery,
        // so ramp the target share when the enemy is soft and lacks counters.
        const bump = enemyOutnumbers ? 0.25 : 0.20;
        target.cavalry = Math.min(0.60, target.cavalry + bump);
    } else if (enemyAntiCav >= 3 && enemyAntiCav >= softTargets * 0.25) {
        target.cavalry = Math.max(0, target.cavalry - 0.10);
    }
    // Reactive anti-cavalry: armor/mounted threats trigger anti-cav production.
    const canTrainAntiCav = target.antiCavalry > 0;
    if (canTrainAntiCav && (enemyArmor > 0 || enemyMounted >= 3)) {
        const threat = enemyArmor + Math.floor(enemyMounted / 2);
        target.antiCavalry = Math.min(0.25, target.antiCavalry + Math.min(0.15, threat * 0.03));
        target.cavalry = Math.max(0, target.cavalry - 0.05);
    }
    const sum = Object.values(target).reduce((a, b) => a + b, 0);
    if (sum > 0) for (const r of Object.keys(target)) target[r] = target[r] / sum;
    return target;
}

/** Pick an affordable unit from this faction's roster, biased toward a
 *  faction-specialized army composition. Early on it secures melee screens,
 *  then fills the biggest role deficit. Falls back to the strongest affordable
 *  *combat* unit (never SCOUT — scouts are exploration units capped at 2 by the
 *  dedicated scout block, so they don't crowd out the army). */
/** Pick the cheapest affordable combat unit for theater defense.
 *  Prioritizes melee infantry (cheapest, fastest to produce), then
 *  ranged, then cavalry. Returns a unit type string or null. */
export function findDefensiveUnit(resources, roster, factionDef, units, actions, owner, aiState = null) {
    const combatTypes = roster.filter(t => {
        const d = UNIT_TYPE[t];
        return d && !d.siegeOnly && !d.canBuildBridge &&
            t !== 'SETTLER' && t !== 'WORKER' && t !== 'SCOUT' &&
            t !== 'TRANSPORT' && t !== 'STEAM_TRANSPORT' &&
            !NAVAL_UNITS.includes(t) && t !== 'SPY' && t !== 'DIPLOMAT';
    });
    // Prefer melee, then ranged, then cavalry (cheapest first in each tier).
    const tiers = [];
    for (const t of combatTypes) {
        const d = UNIT_TYPE[t];
        const cost = getUnitCostFor(t, factionDef);
        const afford = canAfford(t, resources, cost);
        const melee = d && !d.ranged && (!d.attackRange || d.attackRange <= 1);
        const ranged = d && (d.ranged || (d.attackRange || 0) > 1);
        const isCav = t === 'CAVALRY' || t === 'CHARIOT' || t === 'CATAPHRACT' || t === 'DRAGOON' || t === 'WINGED_HUSSAR';
        if (afford) tiers.push({ t, cost: cost.gold + cost.production, melee, ranged, isCav });
    }
    // Sort: melee first, then ranged, then cavalry; within each tier by cost.
    tiers.sort((a, b) => {
        const at = a.melee ? 0 : a.ranged ? 1 : 2;
        const bt = b.melee ? 0 : b.ranged ? 1 : 2;
        return at !== bt ? at - bt : a.cost - b.cost;
    });
    return tiers.length > 0 ? tiers[0].t : null;
}

export function findAffordableUnit(resources, roster, factionDef, units, actions, owner, objective = null, hasSiegeWorkshop = false, aiState = null, isAtWar = null) {
    const counts = countByRole(units, actions, owner);
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    // Base faction composition + objective-driven tweaks (see
    // effectiveComposition): a siege objective leans hard into siege engines,
    // while a decisive field battle or defense pulls siege back in favor of
    // melee/cavalry.
    let target = effectiveComposition(factionDef, roster, hasSiegeWorkshop, objective);
    // Reactive cavalry scaling: if the enemy fields lots of infantry/artillery
    // (units that cavalry hard-counters) and few anti-cavalry specialists, bump
    // the cavalry share. Conversely, pull back when the enemy is heavy on pikes,
    // bayonet rifles, or anti-tank teams.
    target = adjustTargetForEnemyComposition(target, units, owner, isAtWar, counts);
    // Reserve a baseline siege/artillery slice (~25%) even when no siege
    // objective is active, as long as the faction can actually train siege.
    // This stops the AI from neglecting artillery and leaving siege engines idle.
    const canTrainSiege = roster.some(t => unitRole(t) === 'siege') || hasSiegeWorkshop;
    if (canTrainSiege && target.siege < AI_ARTILLERY_RESERVE_DEFAULT) {
        target.siege = AI_ARTILLERY_RESERVE_DEFAULT;
        const sum = Object.values(target).reduce((a, b) => a + b, 0);
        if (sum > 0) for (const r of Object.keys(target)) target[r] = target[r] / sum;
    }

    // Siege savings: when the army is past the defense floor and needs more
    // siege but can't afford any siege unit, check if we're close to affording
    // the cheapest one. If so, skip training this turn so the gold carries
    // forward — otherwise the AI spends every turn's surplus on cheap infantry
    // and never accumulates enough for a CATAPULT/TREBUCHET/SIEGE_CANNON.
    if (aiState && total >= 4 && target.siege > 0) {
        const siegeDeficit = Math.max(0, target.siege * total - (counts.siege || 0));
        if (siegeDeficit >= 0.5) {
            const affordableSiege = ['SIEGE_CANNON', 'RAILGUN', 'FIELD_GUN', 'CANNON', 'MORTAR',
                'SIEGE', 'ARTILLERY', 'CATAPULT', 'TREBUCHET', 'HORSE_ARTILLERY']
                .filter(t => roster.includes(t) && canAfford(t, resources, getUnitCostFor(t, factionDef)));
            if (affordableSiege.length === 0) {
                // Find the cheapest siege unit in our roster and check how far
                // we are from affording it.
                const cheapest = ['SIEGE', 'CATAPULT', 'ARTILLERY', 'TREBUCHET', 'MORTAR',
                    'CANNON', 'FIELD_GUN', 'SIEGE_CANNON', 'RAILGUN', 'HORSE_ARTILLERY']
                    .find(t => roster.includes(t));
                if (cheapest) {
                    const cost = getUnitCostFor(cheapest, factionDef);
                    const deficit = (cost.gold || 0) - (resources.gold || 0);
                    // Within 25 gold of affording — save up rather than spend
                    // the surplus on another infantry that delays the siege
                    // unit by another turn.
                    if (deficit > 0 && deficit <= 25) {
                        return null;
                    }
                }
            }
        }
    }

    // Modern-unit savings: when a high-era unit (RIFLEMAN, SIEGE_CANNON, etc.)
    // is in the roster but not yet affordable, and we're close to affording it,
    // skip training this turn so the gold/iron carries forward. Without this the
    // AI spends every turn's surplus on cheap medieval units and never
    // accumulates enough for a modern unit, even after its tech is researched.
    // Only fires past the defense floor (total >= 4) so the early army isn't
    // starved. The check is per-role: only save when the modern unit's role is
    // actually in deficit (don't save for a ranged unit if we already have
    // enough ranged).
    if (aiState && total >= 4) {
        const modernUnits = ['RIFLEMAN', 'SHARPSHOOTER', 'LINE_INFANTRY', 'DRAGOON',
            'SIEGE_CANNON', 'FIELD_GUN', 'RAILGUN', 'HORSE_ARTILLERY', 'DEMOLITION_SQUAD',
            'IRONCLAD', 'STEAM_TRANSPORT', 'IRONCLAD_FRIGATE', 'MONITOR', 'SUBMARINE',
            'RPG_TEAM', 'ANTI_TANK_GUN', 'BAYONET_RIFLE', 'MOBILIZED_INFANTRY', 'MOBILIZED_ARTILLERY',
            'MOTOR_ARTILLERY', 'TANK', 'HEAVY_TANK', 'ARMORED_CAR'];
        for (const mType of modernUnits) {
            if (!roster.includes(mType)) continue;
            const mRole = unitRole(mType);
            const mCost = getUnitCostFor(mType, factionDef);
            if (canAfford(mType, resources, mCost)) continue; // already affordable — no need to save
            const desired = total * (target[mRole] || 0);
            const roleDeficit = desired - (counts[mRole] || 0);
            if (roleDeficit < 0.5) continue; // role already filled
            // Within ~40% of affording the modern unit — save up rather than
            // buy another cheap unit that delays the modern one. The wider
            // threshold (from 30%) ensures expensive modern units aren't delayed
            // by spending on cheap medieval filler.
            const goldDeficit = (mCost.gold || 0) - (resources.gold || 0);
            const ironDeficit = (mCost.iron || 0) - (resources.iron || 0);
            if (goldDeficit > 0 && goldDeficit <= Math.ceil((mCost.gold || 0) * 0.40) &&
                ironDeficit <= Math.ceil((mCost.iron || 0) * 0.40)) {
                return null;
            }
        }
    }

    // Era-gap savings: when the best unlocked unit for the role in deficit is
    // NOT affordable, and either no same-role unit is affordable at all (the
    // obsolescence filter removed the cheap chaff) or the strongest affordable
    // same-role unit sits ≥2 steps below it in ROLE_ORDER (a much older/weaker
    // unit), skip training this turn and let the treasury accumulate toward
    // the modern unit. The fixed-threshold savings above only fire when
    // already close to affording, so without this rule a poor AI spends every
    // turn's surplus on cheap era-0 filler and never reaches the modern unit's
    // cost. Skipped below the defense floor (total < 4) and while under
    // immediate threat (defensive objective — buying anything that fights
    // beats saving for later).
    if (aiState && total >= 4 && !(objective && objective.defensive)) {
        const role = roleDeficit(roster, counts, total, target);
        const order = ROLE_ORDER[role] || [];
        const best = order.find(t => roster.includes(t));
        const affordable = order.find(t => roster.includes(t) &&
            canAfford(t, resources, getUnitCostFor(t, factionDef)));
        if (best && !canAfford(best, resources, getUnitCostFor(best, factionDef))) {
            const gap = affordable ? order.indexOf(affordable) - order.indexOf(best) : Infinity;
            if (gap >= 2) return null;
        }
    }

    // Defense floor: first few units must be melee so expansion/siege don't
    // strip the army bare. Prefer modern melee (LINE_INFANTRY, DRAGOON) when
    // their tech is researched so the early army isn't stuck on medieval units.
    if (total < 4 && roster.some(t => MELEE_TYPES.has(t))) {
        const techState = aiState && aiState.techStates && aiState.techStates[owner];
        const hasFlintlock = techState && techState.researched && techState.researched.has('FLINTLOCK');
        if (hasFlintlock && roster.includes('LINE_INFANTRY') &&
            canAfford('LINE_INFANTRY', resources, getUnitCostFor('LINE_INFANTRY', factionDef))) {
            return 'LINE_INFANTRY';
        }
        for (const t of ['INFANTRY', 'PIKEMAN']) {
            if (roster.includes(t) && canAfford(t, resources, getUnitCostFor(t, factionDef))) return t;
        }
    }
    if (total >= 4) {
        // Anti-cavalry reactive training: when the enemy is fielding a lot of
        // cavalry and this faction has anti-cavalry specialists (HALBERDIER,
        // PIKE_MASTER, BAYONET_RIFLE, ANTI_TANK_GUN, RPG_TEAM) unlocked and
        // affordable, train one. The AI previously NEVER trained these units
        // because they're classified as 'melee' and buried deep in the
        // ROLE_ORDER — the deficit-based pick always chose INFANTRY or
        // LINE_INFANTRY instead. This check fires when enemy cavalry >= 3 and
        // the faction's anti-cav count is below ~20% of enemy cavalry.
        if (isAtWar) {
            let enemyCav = 0;
            let myAntiCav = 0;
            for (const u of (units.values ? units.values() : units)) {
                if (u.owner === owner) {
                    if (ANTI_CAVALRY_TYPES.has(u.type)) myAntiCav++;
                    continue;
                }
                if (!isAtWar(u.owner)) continue;
                const r = unitRole(u.type);
                if (r === 'cavalry') enemyCav++;
            }
            if (enemyCav >= 3 && myAntiCav < Math.ceil(enemyCav * 0.3)) {
                const antiCavOrder = ['RPG_TEAM', 'ANTI_TANK_GUN', 'BAYONET_RIFLE', 'PIKE_MASTER', 'HALBERDIER'];
                for (const t of antiCavOrder) {
                    if (roster.includes(t) && canAfford(t, resources, getUnitCostFor(t, factionDef))) {
                        return t;
                    }
                }
            }
        }
        // Cavalry floor: factions that can field cavalry should train at least
        // one mounted unit once the initial melee screen is secured, so the army
        // doesn't stay pure infantry. Skip when playing defensively or when the
        // faction is naval-focused (Storm), because naval should fill its own
        // deficit first. The unit must be a cavalry-class type (CAVALRY_TYPES).
        const isNavalFocused = factionDef && factionDef.id === 'storm' && (target.naval || 0) > (target.cavalry || 0);
        if (!isNavalFocused && target.cavalry > 0 && (counts.cavalry || 0) === 0 &&
            target.cavalry >= (target.naval || 0) && !(objective && objective.defensive)) {
            for (const t of ROLE_ORDER.cavalry) {
                if (roster.includes(t) && CAVALRY_TYPES.has(t) &&
                    canAfford(t, resources, getUnitCostFor(t, factionDef))) return t;
            }
        }
        const role = roleDeficit(roster, counts, total, target);
        // Boost faction specialty units to the front of the role order so they
        // are picked before generic units of the same role (a Roman with a
        // melee deficit picks LEGIONNAIRE before INFANTRY, a Spanish with a
        // cavalry deficit picks CONQUISTADOR before CAVALRY, etc.).
        const roleSpecs = affordableSpecialty(factionDef, roster, resources)
            .filter(t => unitRole(t) === role);
        const order = [...roleSpecs, ...(ROLE_ORDER[role] || []).filter(t => !roleSpecs.includes(t))];
        for (const t of order) {
            if (roster.includes(t) && canAfford(t, resources, getUnitCostFor(t, factionDef))) return t;
        }
    }
    // Fallback: strongest affordable combat unit (no SCOUT — prevents the
    // Shadow Court "20 spies" spam where a poor faction trains nothing but the
    // cheapest unit). Order depends on current objective. New European units
    // are interleaved with their role peers so a faction whose roster contains
    // them can still reach them via the fallback.
    let order;
    if (objective && objective.siege) {
        order = ['SIEGE_CANNON', 'RAILGUN', 'FIELD_GUN', 'CANNON', 'MORTAR', 'SIEGE', 'ARTILLERY', 'CATAPULT', 'TREBUCHET', 'TIGER_CANNON', 'ENGINEER', 'WINGED_HUSSAR', 'CONQUISTADOR', 'CATAPHRACT', 'HORSE_ARTILLERY', 'VARANGIAN_GUARD', 'STONE_GUARD', 'LEGIONNAIRE', 'LINE_INFANTRY', 'BERSERKER', 'JAGUAR_WARRIOR', 'CAVALRY', 'PIKEMAN', 'CROSSBOWMAN', 'BATTLE_MAGE', 'RIFLEMAN', 'SHARPSHOOTER', 'MUSKETEER', 'LONGBOWMAN', 'ARCHER', 'SHINOBI', 'INFANTRY'];
    } else if (objective && objective.decisive) {
        order = ['WINGED_HUSSAR', 'CONQUISTADOR', 'CATAPHRACT', 'CAVALRY', 'CHARIOT', 'DRAGOON', 'BERSERKER', 'JAGUAR_WARRIOR', 'VARANGIAN_GUARD', 'STONE_GUARD', 'LEGIONNAIRE', 'LINE_INFANTRY', 'PIKEMAN', 'INFANTRY', 'SHINOBI', 'RIFLEMAN', 'SHARPSHOOTER', 'MUSKETEER', 'CROSSBOWMAN', 'BATTLE_MAGE', 'LONGBOWMAN', 'ARCHER', 'SIEGE_CANNON', 'RAILGUN', 'FIELD_GUN', 'CANNON', 'MORTAR', 'SIEGE', 'ARTILLERY', 'TIGER_CANNON'];
    } else if (objective && objective.raid) {
        order = ['WINGED_HUSSAR', 'CONQUISTADOR', 'CATAPHRACT', 'CAVALRY', 'CHARIOT', 'DRAGOON', 'HORSE_ARTILLERY', 'BERSERKER', 'JAGUAR_WARRIOR', 'SHINOBI', 'SIEGE_CANNON', 'RAILGUN', 'FIELD_GUN', 'CANNON', 'MORTAR', 'SIEGE', 'ARTILLERY', 'CATAPULT', 'TREBUCHET', 'TIGER_CANNON', 'PIKEMAN', 'LEGIONNAIRE', 'STONE_GUARD', 'LINE_INFANTRY', 'CROSSBOWMAN', 'BATTLE_MAGE', 'RIFLEMAN', 'SHARPSHOOTER', 'MUSKETEER', 'LONGBOWMAN', 'ARCHER', 'INFANTRY'];
    } else if (objective && objective.defensive) {
        order = ['VARANGIAN_GUARD', 'STONE_GUARD', 'LEGIONNAIRE', 'LINE_INFANTRY', 'PIKEMAN', 'INFANTRY', 'DEMOLITION_SQUAD', 'CROSSBOWMAN', 'BATTLE_MAGE', 'RIFLEMAN', 'MUSKETEER', 'SHARPSHOOTER', 'ARCHER', 'LONGBOWMAN', 'SIEGE_CANNON', 'RAILGUN', 'FIELD_GUN', 'CANNON', 'MORTAR', 'SIEGE', 'ARTILLERY', 'CATAPULT', 'TREBUCHET', 'TIGER_CANNON', 'WINGED_HUSSAR', 'CATAPHRACT', 'CAVALRY'];
    } else {
        order = ['SIEGE_CANNON', 'RAILGUN', 'FIELD_GUN', 'CANNON', 'MORTAR', 'SIEGE', 'ARTILLERY', 'CATAPULT', 'TREBUCHET', 'TIGER_CANNON', 'ENGINEER', 'WINGED_HUSSAR', 'CONQUISTADOR', 'CATAPHRACT', 'HORSE_ARTILLERY', 'VARANGIAN_GUARD', 'STONE_GUARD', 'LEGIONNAIRE', 'LINE_INFANTRY', 'BERSERKER', 'JAGUAR_WARRIOR', 'CAVALRY', 'PIKEMAN', 'CROSSBOWMAN', 'BATTLE_MAGE', 'RIFLEMAN', 'SHARPSHOOTER', 'MUSKETEER', 'LONGBOWMAN', 'ARCHER', 'SHINOBI', 'INFANTRY'];
    }
    for (const t of order) {
        if (!roster.includes(t)) continue;
        // Engineers are support units with their own corps cap in
        // computeAIActions (block 1c). Don't let the combat fallback spam
        // them whenever siege is unaffordable — that bypassed the cap and
        // was part of the "7 engineers" overproduction.
        if (t === 'ENGINEER' && (counts.support || 0) >= 2) continue;
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
 *  Non-city tiles are never captured by moving onto them.
 *  A city is NOT capturable while the breach delay is still running
 *  or while any unit still occupies the city
 *  tile — the defender must be killed first. */
function findAdjacentCapturable(unit, tiles, owner, res, isAtWar, units = null, currentTurn = null) {
    if (res.gold < CAPTURE_COST) return null;
    // Check adjacent tiles first (standard capture).
    const checkTile = (t) => {
        if (!t || t.owner === owner) return null;
        if (t.terrain !== 'CITY') return null;
        // Occupied city: the defender must be cleared first.
        if (units) {
            for (const u of units.values()) {
                if (u.x === t.x && u.z === t.z) return null;
            }
        }
        // Neutral city (no owner) - always capturable.
        if (!t.owner) {
            if ((t.fortification || 0) <= 0) return t;
            return null;
        }
        // Enemy city - respect peace/trade/alliance.
        if (t.owner && t.owner !== owner) {
            if (isAtWar && !isAtWar(t.owner)) return null;
            // Only capture a city that has been breached (fortification 0).
            if ((t.fortification || 0) <= 0) return t;
        }
        return null;
    };
    // Adjacent tiles (Chebyshev 1).
    for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
            if (dx === 0 && dz === 0) continue;
            const t = tiles.get(`${unit.x + dx},${unit.z + dz}`);
            const found = checkTile(t);
            if (found) return found;
        }
    }
    // Extended search: for units that can move, also check tiles within
    // move range. This lets ranged siege units (SIEGE with attackRange 2)
    // that breached a city from 2 tiles away capture it on the next turn
    // by moving onto it. The capture action teleports the unit onto the
    // city tile, so we just need to find the capturable city within range.
    const unitDef = UNIT_TYPE[unit.type] || {};
    const moveRange = unitDef.moveRange || 1;
    // Ranged siege engines (ARTILLERY moveRange 1 / attackRange 2, CANNON 1/2,
    // SIEGE_CANNON 1/3, MORTAR 1/3, ...) shell a city from farther than they
    // can walk in one move. Search up to their attack range so a siege engine
    // that breached a city from range can claim it — otherwise the artillery
    // stands at range beside an empty, breached city it can no longer besiege,
    // and the city sits uncaptured forever (the "breach but never capture"
    // bug).
    const searchRange = unitDef.besiege ? Math.max(moveRange, unitDef.attackRange || 1) : moveRange;
    if (searchRange > 1) {
        for (let dx = -searchRange; dx <= searchRange; dx++) {
            for (let dz = -searchRange; dz <= searchRange; dz++) {
                if (dx === 0 && dz === 0) continue;
                if (Math.abs(dx) + Math.abs(dz) > searchRange) continue;
                // Skip tiles already checked in the adjacent pass.
                if (Math.abs(dx) <= 1 && Math.abs(dz) <= 1) continue;
                const t = tiles.get(`${unit.x + dx},${unit.z + dz}`);
                const found = checkTile(t);
                if (found) return found;
            }
        }
    }
    return null;
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

/** True if `unit` is a transport ship (TRANSPORT or STEAM_TRANSPORT) that can
 *  carry land units as cargo. */
function isTransport(unit) {
    return !!unit && (unit.type === 'TRANSPORT' || unit.type === 'STEAM_TRANSPORT');
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
    // Gather foe types present so friend power is weighted by type advantage
    // (relative strengths vs opponent). Only foes within the radius count.
    const foeTypes = new Set();
    for (const u of units.values()) {
        if (Math.max(Math.abs(u.x - x), Math.abs(u.z - z)) > radius) continue;
        if (u.owner === owner) continue;
        if (atWar && (!isAtWar || isAtWar(u.owner))) foeTypes.add(u.type);
    }
    for (const u of units.values()) {
        if (Math.max(Math.abs(u.x - x), Math.abs(u.z - z)) > radius) continue;
        const base = (u.hp || 1) + ((UNIT_TYPE[u.type] && UNIT_TYPE[u.type].attack) || (u.attack || 0));
        if (u.owner === owner) {
            // Multiply friendly power by the best advantage we hold over the
            // nearby foe roster — a pike group truly outvalues a cavalry stack.
            friend += base * bestAdvantageMultiplier(u.type, foeTypes);
        } else if (atWar && (!isAtWar || isAtWar(u.owner))) {
            foe += base;
        }
    }
    return { friend, foe };
}

/** True if any at-war enemy military unit is within `radius` tiles (Manhattan)
 *  of one of the owner's cities. Used to decide whether the king needs a full
 *  guard detail or whether the core defense can be thinned to free units for
 *  offense. */
function hasNearbyThreats(owner, tiles, units, isAtWar, radius = 10) {
    const ownCities = [...tiles.values()].filter(t => t.terrain === 'CITY' && t.owner === owner);
    if (ownCities.length === 0) return false;
    for (const u of units.values()) {
        if (u.owner === owner) continue;
        if (u.type === 'SETTLER' || u.type === 'WORKER') continue;
        if (isAtWar && !isAtWar(u.owner)) continue;
        for (const c of ownCities) {
            if (manhattan(u.x, u.z, c.x, c.z) <= radius) return true;
        }
    }
    return false;
}

/** Find an easy target for an otherwise idle patrol group: unclaimed cities,
 *  weak enemy cities (garrison <= 2), or isolated enemy units within 10 tiles.
 *  Returns a tile-like object {x,z} or null. */
function findHarassTarget(group, tiles, units, owner, isAtWar) {
    const c = groupCentroid(group);
    let best = null, bestScore = -Infinity;
    for (const t of tiles.values()) {
        if (t.terrain !== 'CITY') continue;
        const d = manhattan(c.x, c.z, t.x, t.z);
        if (d > 10) continue;
        if (!t.owner) {
            const score = 100 - d;
            if (score > bestScore) { bestScore = score; best = t; }
            continue;
        }
        if (t.owner === owner) continue;
        if (isAtWar && !isAtWar(t.owner)) continue;
        let garrison = 0;
        for (const u of units.values()) {
            if (u.x === t.x && u.z === t.z && u.owner === t.owner) garrison++;
        }
        if (garrison > 2) continue;
        const score = 80 - d * 2;
        if (score > bestScore) { bestScore = score; best = t; }
    }
    for (const u of units.values()) {
        if (u.owner === owner) continue;
        if (isAtWar && !isAtWar(u.owner)) continue;
        const d = manhattan(c.x, c.z, u.x, u.z);
        if (d > 10) continue;
        const local = localPowerBalance(units, u.x, u.z, owner, true, isAtWar, 3);
        if (local.friend <= 0) continue;
        if (local.foe >= local.friend) continue;
        const score = 60 - d + (isFragile(u) ? 20 : 0);
        if (score > bestScore) { bestScore = score; best = { x: u.x, z: u.z }; }
    }
    return best;
}

/** Nearest own CITY tile by Manhattan distance (retreat destination).
 *  Scores cities by distance + enemy proximity penalty so the king avoids
 *  retreating toward hostile units. Falls back to pure distance if no enemy
 *  information is available. */
function nearestFriendlyCity(unit, tiles, owner, enemyUnits) {
    let best = null, bestScore = Infinity;
    for (const t of tiles.values()) {
        if (t.terrain !== 'CITY' || t.owner !== owner) continue;
        const d = manhattan(unit.x, unit.z, t.x, t.z);
        let score = d;
        // Penalize cities that are close to enemy units — retreat shouldn't
        // lead the king into an even worse position.
        if (enemyUnits && enemyUnits.length) {
            for (const eu of enemyUnits) {
                const ed = Math.max(Math.abs(eu.x - t.x), Math.abs(eu.z - t.z));
                if (ed <= 4) score += (5 - ed) * 1.5;  // +1.5 per tile of enemy proximity
            }
        }
        if (score < bestScore) { bestScore = score; best = t; }
    }
    return best;
}

/** Does `attackerType` have a type advantage vs `defenderType`? */
function typeMatch(attackerType, defenderType) {
    return !!(TYPE_ADVANTAGE[attackerType] && (Array.isArray(TYPE_ADVANTAGE[attackerType].strongAgainst) ? TYPE_ADVANTAGE[attackerType].strongAgainst.includes(defenderType) : TYPE_ADVANTAGE[attackerType].strongAgainst === defenderType));
}

/** Best TYPE_ADVANTAGE multiplier a unit type enjoys against ANY of the enemy
 *  types. Returns 1.0 when it has no advantage. Used to weight power by
 *  relative strengths so a counter-comp group is rated stronger vs its prey. */
function bestAdvantageMultiplier(unitType, enemyTypes) {
    if (!enemyTypes || enemyTypes.size === 0) return 1.0;
    const adv = TYPE_ADVANTAGE[unitType];
    if (!adv) return 1.0;
    const strong = Array.isArray(adv.strongAgainst) ? adv.strongAgainst : [adv.strongAgainst];
    let best = 1.0;
    for (const t of strong) if (enemyTypes.has(t) && adv.multiplier > best) best = adv.multiplier;
    return best;
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
                const d = Math.max(Math.abs(e.x - f.x), Math.abs(e.z - f.z));
                if (d < bestD) { bestD = d; target = f; }
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
 *  else a new single-unit group). Returns [{ id, lords: [...], units: [...] }].
 *  A group may contain multiple lords when small lord-led groups merge into a
 *  larger formation. */
function buildArmyGroups(myUnits, lords, owner, land = null) {
    const groups = [];
    const assigned = new Set();
    if (lords && owner) {
        for (const lord of lords) {
            if (lord.owner !== owner) continue;
            const members = myUnits.filter(u => lord.army && lord.army.includes(u.id));
            if (members.length) {
                groups.push({ id: 'lord:' + lord.id, lords: [lord], units: members });
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
            if (d <= 3 && d < bestDist) { bestDist = d; best = g; }
        }
        if (best) best.units.push(u);
        else groups.push({ id: 'cluster:' + u.id, lords: [], units: [u] });
    }
    // Merge pass: fold small (1-2 unit) groups into a nearby larger group so
    // the AI fields real armies instead of scattered squads — most groups
    // were singletons. Rules: never merge INTO a king-led group (the king's
    // guard stays nimble), never merge a king-led group away, never merge
    // across water (same landmass only, checked via the optional landmass map),
    // and keep merged groups at most ~8 units so they stay maneuverable.
    // Small lord-led groups MAY merge into another group — that's how a tough
    // conquest group ends up carrying multiple lords' retinues.
    const hasKing = (grp) => grp.lords && grp.lords.some(l => l.isKing);
    for (const g of [...groups]) {
        if (g.units.length > 2) continue;
        if (hasKing(g)) continue; // king guard stays independent
        const c = groupCentroid(g);
        let best = null, bestD = Infinity;
        for (const h of groups) {
            if (h === g) continue;
            if (hasKing(h)) continue;
            if (h.units.length < g.units.length) continue; // merge upward/sideways, not into another squad
            if (h.units.length + g.units.length > 8) continue;
            const hc = groupCentroid(h);
            const d = Math.max(Math.abs(hc.x - c.x), Math.abs(hc.z - c.z));
            if (d > 4 || d >= bestD) continue;
            if (land && land.idOf &&
                land.idOf.get(`${c.x},${c.z}`) !== land.idOf.get(`${hc.x},${hc.z}`)) continue;
            best = h; bestD = d;
        }
        if (best) {
            best.units.push(...g.units);
            // Transfer any lords from the absorbed group so they stay attached.
            for (const l of (g.lords || [])) {
                if (!best.lords.some(existing => existing.id === l.id)) best.lords.push(l);
            }
            groups.splice(groups.indexOf(g), 1);
        }
    }

    // Lord-merge pass: if a second lord is within 3 tiles of a group and the
    // combined unit count is still reasonable (<= 2/3 of a typical army cap),
    // merge the lord groups under the higher-level lord. Multiple lords in one
    // stack stack command bonuses and keep retinues from wandering separately.
    const ARMY_CAP_PROXY = 12;
    const LORD_MERGE_CAP = Math.floor(ARMY_CAP_PROXY * 2 / 3);
    for (const g of [...groups]) {
        if (!g.lords || g.lords.length === 0 || hasKing(g)) continue;
        const gc = groupCentroid(g);
        for (const h of groups) {
            if (h === g || !h.lords || h.lords.length === 0 || hasKing(h)) continue;
            const hc = groupCentroid(h);
            const d = Math.max(Math.abs(hc.x - gc.x), Math.abs(hc.z - gc.z));
            if (d > 3) continue;
            if (g.units.length + h.units.length > LORD_MERGE_CAP) continue;
            if (land && land.idOf &&
                land.idOf.get(`${gc.x},${gc.z}`) !== land.idOf.get(`${hc.x},${hc.z}`)) continue;
            const gLevel = Math.max(...g.lords.map(l => l.level || 1));
            const hLevel = Math.max(...h.lords.map(l => l.level || 1));
            const [src, dst] = gLevel >= hLevel ? [h, g] : [g, h];
            dst.units.push(...src.units);
            for (const l of (src.lords || [])) {
                if (!dst.lords.some(existing => existing.id === l.id)) dst.lords.push(l);
            }
            groups.splice(groups.indexOf(src), 1);
            break;
        }
    }
    return groups;
}

/** Pick a fortified enemy coastal city a naval siege unit can shell this turn.
 *  Returns the city tile or null. */
function findNavalSiegeTarget(unit, tiles, owner, isAtWar) {
    if (!UNIT_TYPE[unit.type].besiege) return null;
    const range = UNIT_TYPE[unit.type].attackRange || 1;
    const found = range > 1
        ? findTargetCityWithin(unit, tiles, owner, isAtWar, range)
        : null;
    const ec = found ? found.city : findAdjacentEnemyCity(unit, tiles, owner, isAtWar);
    return (ec && (ec.fortification || 0) > 0) ? ec : null;
}

/** Group naval units into fleet groups: transport + escort pairs form
 *  'amphibious' groups; remaining warships cluster spatially (Chebyshev ≤ 3)
 *  into strike/besiege/defend groups. Rebuilt every turn — no persistent
 *  group identities (dynamic re-grouping is handled by per-turn rebuild).
 *  Returns [{ id, units, role }]. */
function buildNavalGroups(myUnits, owner, tilesMap, isAtWarFn) {
    const navalUnits = myUnits.filter(u => isNaval(u));
    const groups = [];
    const assigned = new Set();
    const transports = navalUnits.filter(u => isTransport(u));
    const warships = navalUnits.filter(u => !isTransport(u));

    // Pass 1: Transport + escort pairs.
    for (const tr of transports) {
        const group = { id: 'fleet:' + tr.id, units: [tr], role: 'transport' };
        const escort = warships.find(ws =>
            !assigned.has(ws.id) && Math.abs(ws.x - tr.x) + Math.abs(ws.z - tr.z) <= 3);
        if (escort) {
            group.units.push(escort);
            assigned.add(escort.id);
            group.role = 'amphibious';
        }
        groups.push(group);
        assigned.add(tr.id);
    }

    // Pass 2: Unassigned warships cluster spatially.
    const remaining = warships.filter(u => !assigned.has(u.id));
    for (const ws of remaining) {
        let best = null, bestDist = Infinity;
        for (const g of groups) {
            if (g.role === 'transport') continue;
            const c = groupCentroid(g);
            const d = Math.max(Math.abs(c.x - ws.x), Math.abs(c.z - ws.z));
            if (d <= 3 && d < bestDist) { bestDist = d; best = g; }
        }
        if (best) {
            best.units.push(ws);
        } else {
            groups.push({ id: 'fleet:' + ws.id, units: [ws], role: 'strike' });
        }
        assigned.add(ws.id);
    }

    // Pass 3: Assign roles based on composition, position, nearby enemy/friendly
    // cities, and whether a nearby friendly land army lacks siege support.
    for (const g of groups) {
        g.role = classifyNavalGroup(g, owner, tilesMap, isAtWarFn, myUnits);
    }

    return groups;
}

/** Classify a naval fleet group's tactical role based on composition,
 *  proximity to enemy/friendly cities, power, and nearby army siege support. */
export function classifyNavalGroup(group, owner, tilesMap, isAtWarFn, units = null) {
    const hasTransport = group.units.some(u => isTransport(u));
    const hasWarship = group.units.some(u => !isTransport(u));
    if (hasTransport && hasWarship) return 'amphibious';
    if (hasTransport) return 'transport';

    // Warship-only groups.
    const nearEnemyCoast = group.units.some(u => {
        for (const [dx, dz] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
            const nt = tilesMap.get(`${u.x + dx},${u.z + dz}`);
            if (nt && nt.terrain === 'CITY' && nt.owner && nt.owner !== owner) return true;
        }
        return false;
    });
    const nearFriendlyCoast = group.units.some(u => {
        for (const [dx, dz] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
            const nt = tilesMap.get(`${u.x + dx},${u.z + dz}`);
            if (nt && nt.terrain === 'CITY' && nt.owner === owner) return true;
        }
        return false;
    });
    const power = group.units.reduce((s, u) => s + calculateAdjustedPower(u), 0);

    // If a friendly land army is nearby and lacks siege support, prioritize
    // besiege so the fleet supplies the artillery the army is missing.
    let nearFriendlyArmyWithoutSiege = false;
    if (units) {
        const c = groupCentroid(group);
        const radius = 8;
        let hasArmy = false;
        let hasSiege = false;
        for (const u of units) {
            if (u.owner !== owner) continue;
            if (isNaval(u)) continue;
            if (u.type === 'SETTLER' || u.type === 'WORKER' || u.type === 'SCOUT') continue;
            if (Math.abs(u.x - c.x) + Math.abs(u.z - c.z) > radius) continue;
            hasArmy = true;
            const ut = UNIT_TYPE[u.type];
            if (ut && ut.besiege) { hasSiege = true; break; }
        }
        nearFriendlyArmyWithoutSiege = hasArmy && !hasSiege;
    }

    if (nearEnemyCoast && (nearFriendlyArmyWithoutSiege || power >= 20)) return 'besiege';
    if (nearFriendlyCoast && !nearEnemyCoast) return 'defend';
    return 'strike';
}

/** Average position of a group's members (rounded to a tile). */
function groupCentroid(group) {
    let sx = 0, sz = 0;
    for (const u of group.units) { sx += u.x; sz += u.z; }
    const n = group.units.length || 1;
    return { x: Math.round(sx / n), z: Math.round(sz / n) };
}

/** Total combat power of a group (sum of unitValue over its members). */
function groupPower(group) {
    return group.units.reduce((s, u) => s + unitValue(u), 0);
}

/** Local power balance around a group's centroid (friend vs at-war foe within
 *  radius 4). Used to detect a group that is under pressure and may need help
 *  or should retreat. */
function groupLocalBalance(group, units, owner, atWar, isAtWar, radius = 4) {
    const c = groupCentroid(group);
    return localPowerBalance(units, c.x, c.z, owner, atWar, isAtWar, radius);
}

/** Is this group "in trouble" and a candidate for reinforcement? True when its
 *  king is wounded, OR local enemy power exceeds friendly power near it. */
function groupIsInTrouble(group, units, owner, atWar, isAtWar) {
    const kings = (group.lords || []).filter(l => l.isKing);
    for (const k of kings) {
        const hpRatio = (k.hp || 0) / (k.maxHp || 1);
        if (hpRatio < 0.5) return true;
    }
    const bal = groupLocalBalance(group, units, owner, atWar, isAtWar);
    if (bal.foe > 0 && bal.friend < bal.foe) return true;
    // Heavily damaged group (lost most of its strength).
    const hurt = group.units.some(u => (u.hp || 0) < (u.maxHp || 1) * 0.35);
    return hurt && bal.foe > 0;
}

/** Pick a shared objective tile for the group.
 *  - When retreating: aim at the nearest friendly city.
 *  - When holding with no enemies nearby: seek out the nearest enemy or neutral
 *    city to attack (aggressive posture), or nearest unowned tile for expansion.
 *  - When engaging: use pickTarget's tiering (enemy city > neutral city > enemy tile).
 *  This ensures armies mobilize toward enemy borders instead of staying home. */
function pickGroupObjective(group, tiles, owner, isAtWar, stance, units, topGoal = null, lords = null, claimedClusters = null) {
    const c = groupCentroid(group);

    // Attack-king goal: when the top goal is an attack-king goal with a known
    // target tile, the group beelines toward the enemy king's position. This
    // is checked FIRST so it overrides the default "nearest enemy city" logic
    // — killing the exposed king is a higher-value objective than taking any
    // single city. The beeline only fires while the king is actually
    // vulnerable (unguarded + wounded or locally outpowered): chasing a
    // turtled-up full-health king endlessly distracts the conquest group from
    // objectives that need it (goalValid drops such stale goals, but this
    // live re-check covers the same turn the king's situation changes).
    if (topGoal && topGoal.kind === 'attack-king' && topGoal.targetTileKey) {
        const [kx, kz] = topGoal.targetTileKey.split(',').map(Number);
        if (!Number.isNaN(kx) && !Number.isNaN(kz)) {
            const kingLord = (lords || []).find(l => l.isKing && l.owner !== owner &&
                (!topGoal.targetFaction || l.owner === topGoal.targetFaction));
            if (kingLord) {
                const guarded = [...units.values()].some(u =>
                    u.owner === kingLord.owner && u.x === kingLord.x && u.z === kingLord.z);
                const bal = localPowerBalance(units, kingLord.x, kingLord.z, owner, true, isAtWar, 3);
                if (isKingVulnerable({ ...kingLord, guarded }, bal.friend, bal.foe + (kingLord.hp || 1))) {
                    return { x: kx, z: kz, terrain: 'CITY', owner: topGoal.targetFaction };
                }
            }
        }
    }

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

    // Decisive-battle goal: hunt the enemy's field army. Each conquest group
    // is sent at the nearest UNCLAIMED enemy army cluster (claimedClusters
    // tracks this turn's assignments, so multiple groups spread across
    // multiple enemy armies instead of stacking on one). King-led groups
    // never beeline at an army — assassinating kings is attack-king's job.
    // Falls through to normal city targeting when no (unclaimed) clusters
    // remain.
    if (topGoal && topGoal.kind === 'decisive-battle' &&
        !(group.lords || []).some(l => l.isKing) &&
        topGoal.meta && Array.isArray(topGoal.meta.clusters)) {
        const available = topGoal.meta.clusters.filter(cl =>
            !(claimedClusters && claimedClusters.has(`${cl.x},${cl.z}`)));
        let best = null, bestD = Infinity;
        for (const cl of available) {
            const d = manhattan(c.x, c.z, cl.x, cl.z);
            if (d < bestD) { bestD = d; best = cl; }
        }
        if (best) {
            if (claimedClusters) claimedClusters.add(`${best.x},${best.z}`);
            return { x: best.x, z: best.z };
        }
    }

    // Hold or Engage: seek out targets aggressively.
    // Priority 1+2 merged: rank at-war enemy cities AND neutral cities together
    // so a close neutral city (first-expander advantage) can outrank a distant
    // enemy stronghold. Enemy cities get a weakness/snipe bonus when their
    // fortification, garrison, and level are all low — the AI then pushes a
    // conquest group there to breach and capture.

    // Naval conquest: when the top goal targets a water-separated city, the
    // conquest group must march to a friendly coastal tile (embarkation point)
    // so the boarding code (block 5c) can load them onto transports. Without
    // this the group picks a reachable land city instead and never boards.
    if (topGoal && topGoal.kind === 'conquest' && topGoal.meta &&
        topGoal.meta.requiresNaval && topGoal.targetTileKey) {
        let bestCoast = null, bestDist = Infinity;
        for (const t of tiles.values()) {
            if (t.owner !== owner) continue;
            if (t.terrain === 'WATER' || t.terrain === 'MOUNTAIN' || t.terrain === 'RIVER') continue;
            // Must be adjacent to water so transports can pick up.
            let adjWater = false;
            for (const [dx, dz] of [[0,1],[0,-1],[1,0],[-1,0]]) {
                const nb = tiles.get(`${t.x + dx},${t.z + dz}`);
                if (nb && nb.terrain === 'WATER') { adjWater = true; break; }
            }
            if (!adjWater) continue;
            const d = manhattan(c.x, c.z, t.x, t.z);
            if (d < bestDist) { bestDist = d; bestCoast = t; }
        }
        if (bestCoast) return bestCoast;
    }

    {
        let best = null, bestScore = -Infinity;
        for (const t of tiles.values()) {
            if (t.terrain !== 'CITY') continue;
            if (t.owner === owner) continue;
            // Reachability filter: a land army group (no transports) can't walk
            // to a water-separated city. Skip unreachable cities so the group
            // doesn't pick a target it can only stare at across the shore.
            // (The goal-level planner handles naval objectives via transports.)
            if (!isReachableByLand(tiles, c.x, c.z, t.x, t.z)) continue;
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

    // Fallback D: no reachable city or cluster — at least move toward the nearest
    // enemy unit, then unowned/neutral tile, then enemy-owned land tile.
    {
        let best = null, bestD = Infinity;
        for (const u of units.values()) {
            if (u.owner === owner || u.boarded || isNaval(u)) continue;
            if (isAtWar && !isAtWar(u.owner)) continue;
            const d = manhattan(c.x, c.z, u.x, u.z);
            if (d < bestD) { bestD = d; best = { x: u.x, z: u.z }; }
        }
        if (!best) {
            for (const t of tiles.values()) {
                if (t.owner) continue;
                if (t.terrain === 'WATER' || t.terrain === 'RIVER' || t.terrain === 'MOUNTAIN') continue;
                const d = manhattan(c.x, c.z, t.x, t.z);
                if (d < bestD) { bestD = d; best = t; }
            }
        }
        if (!best) {
            for (const t of tiles.values()) {
                if (!t.owner || t.owner === owner) continue;
                if (t.terrain === 'WATER' || t.terrain === 'RIVER' || t.terrain === 'MOUNTAIN') continue;
                const d = manhattan(c.x, c.z, t.x, t.z);
                if (d < bestD) { bestD = d; best = t; }
            }
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

/** Compute the HP fraction below which a king should retreat. Scales strongly
 *  with local enemy power: if foes outnumber friends the threshold rises toward
 *  0.75, and if foes are 1.5x+ stronger it hits the max (0.80). An enemy king
 *  within attack range adds a large bonus so the king retreats rather than
 *  duelling. */
function computeKingRetreatThreshold(king, units, owner, atWar, isAtWar, currentTurn, lords) {
    const military = [...units.values()].filter(u =>
        u.owner === owner && !['SCOUT', 'SETTLER', 'WORKER'].includes(u.type));
    const lateGame = military.length >= AI_KING_RETREAT_LATE_GAME_UNITS ||
        (currentTurn || 0) >= AI_KING_RETREAT_LATE_GAME_TURN;
    let threshold = lateGame ? AI_KING_RETREAT_LATE_GAME : AI_KING_RETREAT_BASE;

    // Enemy king within attack range: avoid 1v1 duel.
    for (const el of (lords || [])) {
        if (el.owner === owner || !el.isKing) continue;
        if (isAtWar && !isAtWar(el.owner)) continue;
        const dist = Math.max(Math.abs(el.x - king.x), Math.abs(el.z - king.z));
        if (dist <= 1) { threshold += AI_KING_RETREAT_ENEMY_KING; break; }
    }

    const local = localPowerBalance(units, king.x, king.z, owner, atWar, isAtWar, 3);
    if (local.foe > local.friend) {
        const ratio = local.foe / Math.max(1, local.friend);
        // Scale toward 0.75 as the foe advantage grows.
        threshold += Math.min(0.75 - threshold, (ratio - 1) * 0.15);
    }
    if (local.foe >= local.friend * 1.5) {
        threshold = AI_KING_RETREAT_MAX;
    }
    return Math.min(AI_KING_RETREAT_MAX, threshold);
}

/** True when a non-king lord should fall back to a friendly city. */
function lordShouldRetreat(lord, units, owner, atWar, isAtWar) {
    const hpFrac = (lord.hp || 0) / (lord.maxHp || 1);
    if (hpFrac < AI_LORD_RETREAT_LOW) return true;
    if (hpFrac < AI_LORD_RETREAT_BASE) {
        for (const u of units.values()) {
            if (u.owner === owner) continue;
            if (isAtWar && !isAtWar(u.owner)) continue;
            if (Math.max(Math.abs(u.x - lord.x), Math.abs(u.z - lord.z)) <= AI_LORD_RETREAT_ENEMY_RADIUS) {
                return true;
            }
        }
    }
    return false;
}

/** Stance from the local power balance at the group centroid:
 *  `engage` (we match them), `retreat` (outmatched and we have fragile units to
 *  save), else `hold`. When not at war, the group holds/defends. Kings/lords in
 *  the group force retreat earlier when wounded so high-value leaders don't
 *  throw themselves away. */
function computeStance(group, units, owner, atWar, isAtWar, currentTurn = 0, lords = null) {
    if (!atWar) return 'hold';
    const c = groupCentroid(group);
    const bal = localPowerBalance(units, c.x, c.z, owner, atWar, isAtWar, 4);
    if (bal.foe <= 0) return 'hold';

    // King-led groups: retreat if the king is below its dynamic HP threshold or
    // if local enemies are stronger (avoid 1v1 / locally superior foes).
    for (const k of (group.lords || []).filter(l => l.isKing)) {
        const threshold = computeKingRetreatThreshold(k, units, owner, atWar, isAtWar, currentTurn, lords);
        const hpFrac = (k.hp || 0) / (k.maxHp || 1);
        if (hpFrac < threshold) return 'retreat';
        const local = localPowerBalance(units, k.x, k.z, owner, atWar, isAtWar, 3);
        if (local.foe > local.friend) return 'retreat';
    }

    // Non-king lords: retreat when low HP or moderately wounded with enemies near.
    for (const l of (group.lords || [])) {
        if (l.isKing) continue;
        if (lordShouldRetreat(l, units, owner, atWar, isAtWar)) return 'retreat';
    }

    const hasFragile = group.units.some(u => isFragile(u));
    if (bal.friend < bal.foe * 0.6 && hasFragile) return 'retreat';
    if (bal.friend >= bal.foe * 0.8) return 'engage';
    return 'hold';
}

/** Choose one at-war enemy unit for the whole group to focus on / encircle:
 *  must be within Chebyshev 4 of some member; value = low HP + fragile bonus +
 *  bonus if we have a type advantage against it; penalty if it counters a member.
 *  Also considers at-war enemy lords/kings — exposed kings get a huge bonus
 *  so the group prioritizes assassination (a dead king eliminates a faction). */
function chooseGroupTarget(group, units, owner, atWar, isAtWar, lords = []) {
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
        if (group.units.some(m => {
            if (!TYPE_ADVANTAGE[e.type]) return false;
            const targets = Array.isArray(TYPE_ADVANTAGE[e.type].strongAgainst) ? TYPE_ADVANTAGE[e.type].strongAgainst : [TYPE_ADVANTAGE[e.type].strongAgainst];
            return targets.includes(m.type);
        })) score -= 4;
        // Artillery/siege priority: these are the highest-threat enemy units
        // (high attack, long range, 0-1 defense). The group should focus-fire
        // them to eliminate the biggest damage source first.
        if (SIEGE_TYPES.has(e.type)) score += 50;
        // Cavalry priority: fast, hard-hitting mounted units are the next-highest
        // threat after enemy siege engines.
        if (CAVALRY_TYPES.has(e.type)) score += 30;
        if (score > bestScore) { bestScore = score; best = e; }
    }
    // Also consider at-war enemy lords/kings as focus targets. Kings are the
    // single highest-value target in the game — killing one eliminates a
    // faction — so an exposed king in range jumps to the top of the list.
    for (const lord of (lords || [])) {
        if (lord.owner === owner) continue;
        if (isAtWar && !isAtWar(lord.owner)) continue;
        // Skip guarded lords — a bodyguard unit on the same tile makes melee
        // attack impossible; only exposed lords are valid focus targets.
        const guarded = [...units.values()].some(u => u.owner === lord.owner && u.x === lord.x && u.z === lord.z);
        if (guarded) continue;
        let near = false;
        for (const m of group.units) {
            if (Math.max(Math.abs(m.x - lord.x), Math.abs(m.z - lord.z)) <= 4) { near = true; break; }
        }
        if (!near) continue;
        let score = 200 - (lord.hp || 0);
        if (lord.isKing) score += 300;
        if (score > bestScore) { bestScore = score; best = lordCombatant(lord); }
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
function planGroup(group, objective, stance, units, tiles, owner, lords, buildings, tempBonuses, diploState, moved, acted, atWar, isAtWar, res, structures = null, activeObjectives = null, currentTurn = null) {
    const out = [];
    const members = group.units.filter(u => !acted.has(u.id));
    if (!members.length) return out;
    const groupTarget = chooseGroupTarget(group, units, owner, atWar, isAtWar, lords);

    // 1) Retreat fragile / wounded units that are locally outmatched.
    //    ANY unit below 20% HP unconditionally retreats (no sense fighting to
    //    the death).
    if (atWar) {
        for (const u of members) {
            if (acted.has(u.id)) continue;
            const nearDeath = (u.hp || 0) < (u.maxHp || 1) * 0.35;
            const wounded = (u.hp || 0) < (u.maxHp || 1) * 0.5;
            if (nearDeath) {
                // Universal retreat: any unit below 35% HP flees.
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

    // 1b) Retreat coordination: after the main retreat pass, check if any
    //     non-retreating units are now isolated (locally outnumbered with no
    //     nearby allies). These units should also fall back to avoid being
    //     picked off individually after their support retreated.
    if (atWar && stance !== 'retreat') {
        for (const u of members) {
            if (acted.has(u.id) || u.hasMovedThisTurn) continue;
            if (isFragile(u) || (u.hp || 0) < (u.maxHp || 1) * 0.5) continue;
            const bal = localPowerBalance(units, u.x, u.z, owner, atWar, isAtWar, 3);
            // Isolated: we have no nearby friends and enemies are close.
            if (bal.friend <= 0 && bal.foe >= 2) {
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

    // 2c) MUSKETEER volley formation: group MUSKETEERs adjacent for +1 atk each.
    //     Idle MUSKETEERs move adjacent to other friendly MUSKETEERs before firing.
    if (atWar) {
        for (const u of members) {
            if (acted.has(u.id) || u.hasMovedThisTurn) continue;
            if (u.type !== 'MUSKETEER') continue;
            // Count adjacent friendly MUSKETEERs
            let adjacentMusketters = 0;
            let nearestAlly = null, nearestDist = Infinity;
            for (const other of units.values()) {
                if (other.owner !== owner || other.type !== 'MUSKETEER' || other.id === u.id) continue;
                const dist = Math.abs(other.x - u.x) + Math.abs(other.z - u.z);
                if (dist === 1) adjacentMusketters++;
                else if (dist <= 3 && dist < nearestDist) { nearestDist = dist; nearestAlly = other; }
            }
            // Already in formation (2+ adjacent) - don't move
            if (adjacentMusketters >= 2) continue;
            // Try to move adjacent to another MUSKETEER for volley
            if (nearestAlly && !u.hasMovedThisTurn) {
                const step = nextStepToward(tiles, units, u, nearestAlly, 200, owner);
                if (step && !moved.has(`${step.x},${step.z}`)) {
                    out.push({ type: 'move', unitId: u.id, tx: step.x, tz: step.z });
                    acted.add(u.id);
                    moved.add(`${step.x},${step.z}`);
                }
            }
        }
    }

    // 2d) LINE_INFANTRY formation: +2 def when 2+ friendly infantry adjacent.
    //     LINE_INFANTRY moves toward other infantry to form defensive lines.
    if (atWar && stance !== 'retreat') {
        for (const u of members) {
            if (acted.has(u.id) || u.hasMovedThisTurn) continue;
            if (u.type !== 'LINE_INFANTRY') continue;
            const infantryTypes = new Set(['INFANTRY', 'LINE_INFANTRY', 'RIFLEMAN', 'MUSKETEER']);
            let adjacentInfantry = 0;
            let nearestAlly = null, nearestDist = Infinity;
            for (const other of units.values()) {
                if (other.owner !== owner || other.id === u.id || !infantryTypes.has(other.type)) continue;
                const dist = Math.abs(other.x - u.x) + Math.abs(other.z - u.z);
                if (dist === 1) adjacentInfantry++;
                else if (dist <= 3 && dist < nearestDist) { nearestDist = dist; nearestAlly = other; }
            }
            // Already in formation (2+ adjacent) - hold position
            if (adjacentInfantry >= 2) continue;
            // Try to move adjacent to another infantry unit
            if (nearestAlly && !u.hasMovedThisTurn) {
                const step = nextStepToward(tiles, units, u, nearestAlly, 200, owner);
                if (step && !moved.has(`${step.x},${step.z}`)) {
                    out.push({ type: 'move', unitId: u.id, tx: step.x, tz: step.z });
                    acted.add(u.id);
                    moved.add(`${step.x},${step.z}`);
                }
            }
        }
    }

    // 2e) RAILGUN reload: after firing, RAILGUN must reload for 2 turns.
    //     Track reload state and skip action during reload period.
    if (atWar) {
        for (const u of members) {
            if (u.type !== 'RAILGUN') continue;
            // Decrement reload counter if > 0
            if (u.reloadTurns && u.reloadTurns > 0) {
                u.reloadTurns--;
                // During reload, don't attempt to attack (can still move defensively)
                if (u.reloadTurns > 0) {
                    acted.add(u.id); // Skip all actions during reload
                }
            }
            // After firing (hasAttackedThisTurn), set reload counter
            if (u.hasAttackedThisTurn && !u.reloadTurns) {
                u.reloadTurns = 2; // Must reload for 2 turns
            }
        }
    }

    // 2f) ARMORED_TRAIN mobile: can move and fire same turn.
    //     No special action needed - just don't restrict movement after attack.
    //     The unit's `mobile: true` flag is checked in getAttackTargets().

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
            // Besiege an enemy city (siege units only). Ranged siege engines
            // shell from their attack range — no need to stand adjacent (an
            // empty city otherwise takes zero damage from a trebuchet line).
            if (UNIT_TYPE[u.type] && UNIT_TYPE[u.type].besiege) {
                const range = UNIT_TYPE[u.type].attackRange || 1;
                const found = range > 1
                    ? findTargetCityWithin(u, tiles, owner, isAtWar, range)
                    : null;
                const ec = found ? found.city : findAdjacentEnemyCity(u, tiles, owner, isAtWar);
                if (ec && (ec.fortification || 0) > 0) {
                    out.push({ type: 'besiege', unitId: u.id, tileKey: `${ec.x},${ec.z}` });
                    acted.add(u.id);
                    continue;
                }
            }
            // Capture an adjacent breached enemy city.
            const cap = findAdjacentCapturable(u, tiles, owner, res, isAtWar, units, currentTurn);
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
            // Attack an adjacent enemy military structure (Area 6c). Damaging and
            // ultimately destroying the enemy's Barracks/Harbor/Workshop degrades
            // their veteran training and naval/siege production. Priority:
            // HARBOR > SIEGE_WORKSHOP > BARRACKS.
            if (u.type !== 'MEDIC' && u.type !== 'SETTLER' && u.type !== 'WORKER') {
                const stile = findAdjacentMilitaryStructure(u, tiles, owner, isAtWar, buildings);
                if (stile) {
                    out.push({ type: 'attackBuilding', unitId: u.id, tileKey: `${stile.x},${stile.z}` });
                    acted.add(u.id);
                    continue;
                }
            }
        }
    }

    // 5) Ranged fire: ranged units attack only on favorable terms. Prefer the
    //    group's focused target, then type-matched targets, then highest value.
    //    Siege engines with AOE get a bonus against clustered enemies.
    //    Ability-aware scoring: SHARPSHOOTER targets lords, TORPEDO_BOAT targets
    //    ships, RIFLEMAN targets high-defense, CANNON/DEMOLITION_SQUAD target cities.
    if (atWar) {
        for (const u of members) {
            if (acted.has(u.id) || u.hasAttackedThisTurn) continue;
            if (!isRanged(u)) continue;
            // Siege-only units can't attack enemy units — skip them here.
            // They attack cities via the besiege action (block 4b).
            const uType = UNIT_TYPE[u.type];
            if (uType && uType.siegeOnly) continue;
            const targets = getAttackTargets(u, units)
                .filter(e => (!isAtWar || isAtWar(e.owner)) && e.concealState !== 'concealed');
            if (!targets.length) continue;
            let best = null, bestScore = -Infinity;
            for (const e of targets) {
                if (!isFavorableAttack(u, e, units, tiles, lords, buildings, tempBonuses, structures)) continue;
                let score = unitValue(e);
                if (groupTarget && e.id === groupTarget.id) score += 20;
                if (typeMatch(u.type, e.type)) score += 10;
                // Siege hunter bonus: ranged units prioritize killing enemy
                // artillery/siege to eliminate the highest damage source.
                if (SIEGE_TYPES.has(e.type)) score += 50;
                // Cavalry threat bonus: fast, hard-hitting mounted units are the
                // next-highest priority after enemy siege engines.
                if (CAVALRY_TYPES.has(e.type)) score += 30;
                // AOE splash bonus: siege engines prefer clustered enemies
                if (UNIT_TYPE[u.type] && UNIT_TYPE[u.type].aoe) {
                    let splashCount = 0;
                    for (const other of units.values()) {
                        if (other.owner !== owner && other.id !== e.id &&
                            Math.abs(other.x - e.x) + Math.abs(other.z - e.z) <= 1) splashCount++;
                    }
                    if (splashCount >= 2) score += 30;
                }
                // === ABILITY-AWARE SCORING ===
                // SHARPSHOOTER: +8 vs lords, +6 vs settlers/engineers (sniper bonus)
                if (u.type === 'SHARPSHOOTER') {
                    if (e._isLord || e.lordId) score += 8;
                    else if (e.type === 'SETTLER' || e.type === 'ENGINEER') score += 6;
                    else if (e.type === 'MEDIC') score += 4;
                }
                // TORPEDO_BOAT: +10 vs naval units (torpedo bonus)
                if (u.type === 'TORPEDO_BOAT') {
                    const eDef = UNIT_TYPE[e.type];
                    if (eDef && eDef.naval) score += 10;
                }
                // RIFLEMAN: prefer high-defense targets (accurate - ignores 50% defense)
                if (u.type === 'RIFLEMAN') {
                    const eDef = UNIT_TYPE[e.type];
                    if (eDef && eDef.defense >= 6) score += 4;
                    else if (eDef && eDef.defense >= 4) score += 2;
                }
                // CANNON: +5 vs cities (cannonball barrage)
                if (u.type === 'CANNON') {
                    const eTile = tiles.get(`${e.x},${e.z}`);
                    if (eTile && eTile.terrain === 'CITY') score += 5;
                }
                // MORTAR: prefer clustered enemies (AOE splash)
                if (u.type === 'MORTAR') {
                    let clusterCount = 0;
                    for (const other of units.values()) {
                        if (other.owner !== owner && other.id !== e.id &&
                            Math.abs(other.x - e.x) + Math.abs(other.z - e.z) <= 2) clusterCount++;
                    }
                    if (clusterCount >= 2) score += 4;
                }
                // DEMOLITION_SQUAD: +5 vs cities/buildings (demolish bonus)
                if (u.type === 'DEMOLITION_SQUAD') {
                    const eTile = tiles.get(`${e.x},${e.z}`);
                    if (eTile && eTile.terrain === 'CITY') score += 5;
                    else if (buildings && buildings.get(`${e.x},${e.z}`)?.length > 0) score += 3;
                }
                // SIEGE_CANNON: +6 vs cities (fort buster)
                if (u.type === 'SIEGE_CANNON') {
                    const eTile = tiles.get(`${e.x},${e.z}`);
                    if (eTile && eTile.terrain === 'CITY') score += 6;
                }
                // === ROLE-BASED TARGET PRIORITY ===
                // When raiding (no active siege/defense), prioritize killing
                // economy units to cripple the enemy's production.
                if (!activeObjectives?.siege && !activeObjectives?.defensive) {
                    if (e.type === 'SETTLER') score += 50;
                    else if (e.type === 'WORKER') score += 30;
                    else if (e.type === 'ENGINEER') score += 15;
                }
                // When defending, prioritize killing siege engines that threaten
                // our cities.
                if (activeObjectives?.defensive) {
                    if (SIEGE_TYPES.has(e.type)) score += 25;
                    else if (e.type === 'SIEGE_TOWER') score += 20;
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
            // Siege-only units can't melee attack enemy units.
            const uType = UNIT_TYPE[u.type];
            if (uType && uType.siegeOnly) continue;
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

    // 6b) Naval intelligence: ability-aware positioning for special naval units.
    //     - IRONCLAD: lead formations (tank ranged fire, absorb punishment)
    //     - SUBMARINE: stay submerged, ambush high-value targets
    //     - MONITOR: hold chokepoints (no firing direction penalty)
    //     - GUNBOAT: patrol rivers (shallow water access)
    //     - MAN_OF_WAR: stay near other ships (flagship +1 atk aura)
    if (atWar) {
        for (const u of members) {
            if (acted.has(u.id) || u.hasMovedThisTurn) continue;
            const uDef = UNIT_TYPE[u.type];
            if (!uDef || !uDef.naval) continue;
            // IRONCLAD: move to front of formation (tank position)
            if (u.type === 'IRONCLAD' || u.type === 'IRONCLAD_FRIGATE') {
                // Find friendly warships behind us
                let hasAllyBehind = false;
                for (const other of units.values()) {
                    if (other.owner !== owner || other.id === u.id) continue;
                    const oDef = UNIT_TYPE[other.type];
                    if (!oDef || !oDef.naval) continue;
                    // Check if other is behind us relative to the nearest enemy
                    let nearestEnemy = null, nearestDist = Infinity;
                    for (const e of units.values()) {
                        if (e.owner === owner) continue;
                        if (isAtWar && !isAtWar(e.owner)) continue;
                        const dist = Math.abs(e.x - u.x) + Math.abs(e.z - u.z);
                        if (dist < nearestDist) { nearestDist = dist; nearestEnemy = e; }
                    }
                    if (nearestEnemy) {
                        const ourDist = Math.abs(nearestEnemy.x - u.x) + Math.abs(nearestEnemy.z - u.z);
                        const otherDist = Math.abs(nearestEnemy.x - other.x) + Math.abs(nearestEnemy.z - other.z);
                        if (otherDist > ourDist) hasAllyBehind = true;
                    }
                }
                // If we're the tank and have allies behind, advance toward enemy
                if (hasAllyBehind) {
                    let nearestEnemy = null, nearestDist = Infinity;
                    for (const e of units.values()) {
                        if (e.owner === owner) continue;
                        if (isAtWar && !isAtWar(e.owner)) continue;
                        const dist = Math.abs(e.x - u.x) + Math.abs(e.z - u.z);
                        if (dist < nearestDist) { nearestDist = dist; nearestEnemy = e; }
                    }
                    if (nearestEnemy && nearestDist > 1) {
                        const step = nextStepToward(tiles, units, u, nearestEnemy, 200, owner);
                        if (step && !moved.has(`${step.x},${step.z}`)) {
                            out.push({ type: 'move', unitId: u.id, tx: step.x, tz: step.z });
                            acted.add(u.id);
                            moved.add(`${step.x},${step.z}`);
                        }
                    }
                }
            }
            // MAN_OF_WAR: stay near other friendly ships (flagship aura)
            if (u.type === 'MAN_OF_WAR') {
                let nearbyAllies = 0;
                for (const other of units.values()) {
                    if (other.owner !== owner || other.id === u.id) continue;
                    const oDef = UNIT_TYPE[other.type];
                    if (!oDef || !oDef.naval) continue;
                    if (Math.abs(other.x - u.x) + Math.abs(other.z - u.z) <= 2) nearbyAllies++;
                }
                // If no allies nearby, move toward the nearest friendly warship
                if (nearbyAllies === 0) {
                    let nearestAlly = null, nearestDist = Infinity;
                    for (const other of units.values()) {
                        if (other.owner !== owner || other.id === u.id) continue;
                        const oDef = UNIT_TYPE[other.type];
                        if (!oDef || !oDef.naval) continue;
                        const dist = Math.abs(other.x - u.x) + Math.abs(other.z - u.z);
                        if (dist < nearestDist) { nearestDist = dist; nearestAlly = other; }
                    }
                    if (nearestAlly && nearestDist > 2) {
                        const step = nextStepToward(tiles, units, u, nearestAlly, 200, owner);
                        if (step && !moved.has(`${step.x},${step.z}`)) {
                            out.push({ type: 'move', unitId: u.id, tx: step.x, tz: step.z });
                            acted.add(u.id);
                            moved.add(`${step.x},${step.z}`);
                        }
                    }
                }
            }
            // GUNBOAT: prefer river tiles (shallow water access)
            if (u.type === 'GUNBOAT') {
                const here = tiles.get(`${u.x},${u.z}`);
                if (here && here.terrain !== 'RIVER') {
                    // Find nearest river tile
                    let nearestRiver = null, nearestDist = Infinity;
                    for (const t of tiles.values()) {
                        if (t.terrain !== 'RIVER') continue;
                        const dist = Math.abs(t.x - u.x) + Math.abs(t.z - u.z);
                        if (dist < nearestDist) { nearestDist = dist; nearestRiver = t; }
                    }
                    if (nearestRiver && nearestDist > 1 && nearestDist <= 4) {
                        const step = nextStepToward(tiles, units, u, nearestRiver, 200, owner);
                        if (step && !moved.has(`${step.x},${step.z}`)) {
                            out.push({ type: 'move', unitId: u.id, tx: step.x, tz: step.z });
                            acted.add(u.id);
                            moved.add(`${step.x},${step.z}`);
                        }
                    }
                }
            }
        }
    }

    // 7) Advance toward the objective in formation. Melee screeners go first;
    //    fragile units only advance if a friendly screen stays in front of them.
    //    Units that are concealing/concealed hold position (they're setting an
    //    ambush); the conceal timeout in _tickConcealment eventually releases
    //    them (sets concealState=null + a cooldown) so a stalemate where both
    //    sides hide forever can't persist.
    //    Terrain exploitation: units bias toward defensive terrain (hills/forest)
    //    when advancing, provided it doesn't add >1 extra move to the objective.
    const advance = (u) => {
        if (acted.has(u.id) || u.hasMovedThisTurn) return;
        if (u.concealState === 'concealing' || u.concealState === 'concealed') return;
        if (!objective) return;
        // Patrols hold the ring: already close enough to the home city.
        if (stance === 'hold' && objective.owner === owner &&
            manhattan(u.x, u.z, objective.x, objective.z) <= 2) return;
        if (isFragile(u) && !hasScreen(u, units, owner)) return; // hold behind the screen
        // Siege escort rule: siege engines/towers advance on the objective only
        // while a friendly combat escort (melee/ranged/cavalry) is within
        // SIEGE_ESCORT_RADIUS. The rule only bites when a mobile enemy could
        // actually reach the engine (a foe within threat range) — a static
        // city can't retaliate, so with no foes near, siege advances freely.
        // Unescorted under threat, it moves to rejoin the nearest escort; with
        // no escort left at all it keeps advancing regardless — holding
        // forever never takes the city (the "siege shuffles in place" bug).
        let target = objective;
        if (SIEGE_TYPES.has(u.type)) {
            let foeNear = false;
            for (const e of units.values()) {
                if (e.owner === owner || e.boarded) continue;
                if (isAtWar && !isAtWar(e.owner)) continue;
                if (isNaval(e)) continue;
                const ed = Math.max(Math.abs(e.x - u.x), Math.abs(e.z - u.z));
                const eMove = (UNIT_TYPE[e.type] && UNIT_TYPE[e.type].moveRange) || 2;
                const eRange = (UNIT_TYPE[e.type] && UNIT_TYPE[e.type].attackRange) || 1;
                // Threat: enemy can move adjacent and attack THIS turn or be adjacent now.
                if (ed <= eMove + eRange) { foeNear = true; break; }
            }
            // Track consecutive turns a siege unit wanted to move but was blocked by escort rule.
            // Only reset the counter once the unit is no longer in a stall situation
            // (escort within radius or no foe). After the threshold is reached, the
            // unit keeps advancing until conditions improve — otherwise it would stall
            // for 2 turns, advance once, then stall for 2 turns again (stutter cycle).
            if (foeNear) {
                const esc = nearestEscort(u, units, owner, lords);
                const inStall = esc && esc.dist > SIEGE_ESCORT_RADIUS;
                if (inStall) {
                    if ((u._siegeStallTurns || 0) < 2) {
                        target = esc.unit;
                    }
                    u._siegeStallTurns = (u._siegeStallTurns || 0) + 1;
                } else {
                    u._siegeStallTurns = 0;
                }
            } else {
                u._siegeStallTurns = 0;
            }
        }
        const step = stepToward(u, target, tiles, owner, units, moved, isAtWar);
        if (step && !moved.has(`${step.x},${step.z}`)) {
            // Terrain bias: prefer defensive terrain if it doesn't slow us down.
            const directDist = manhattan(step.x, step.z, target.x, target.z);
            const currentDist = manhattan(u.x, u.z, target.x, target.z);
            const tile = tiles.get(`${step.x},${step.z}`);
            const terrainDef = tile ? (tile.defense || 0) : 0;
            // If the step has terrain bonus and is still closer or same distance,
            // it's a free defensive position. If it's 1 tile farther but has
            // defense >= 2, the defensive value is worth the detour.
            if (terrainDef >= 2 && directDist > currentDist && directDist > currentDist + 1) {
                return; // too far a detour, skip this step
            }
            out.push({ type: 'move', unitId: u.id, tx: step.x, tz: step.z });
            acted.add(u.id);
            moved.add(`${step.x},${step.z}`);
        }
    };
    members.filter(u => isScreener(u)).forEach(advance);
    members.filter(u => !isScreener(u)).forEach(advance);

    // 7b) Roman legion cohesion: idle Legionnaires with no adjacent friendly
    //     Legionnaire shuffle toward the nearest friendly Legionnaire so they
    //     benefit from the legion adjacency combat bonus.
    const isRoman = members.some(u => u.factionId === 'roman');
    if (isRoman) {
        for (const u of members) {
            if (acted.has(u.id) || u.hasMovedThisTurn || u.type !== 'LEGIONNAIRE') continue;
            const hasAdjacent = members.some(other =>
                other !== u && other.type === 'LEGIONNAIRE' &&
                Math.abs(other.x - u.x) + Math.abs(other.z - u.z) <= 1);
            if (hasAdjacent) continue;
            let nearest = null, nearestDist = Infinity;
            for (const other of units.values()) {
                if (other.owner !== owner || other.type !== 'LEGIONNAIRE' || other.id === u.id) continue;
                const d = Math.abs(other.x - u.x) + Math.abs(other.z - u.z);
                if (d < nearestDist) { nearestDist = d; nearest = other; }
            }
            if (nearest && nearestDist <= 6) {
                const step = nextStepToward(tiles, units, u, nearest, 200, owner);
                if (step && !moved.has(`${step.x},${step.z}`)) {
                    out.push({ type: 'move', unitId: u.id, tx: step.x, tz: step.z });
                    acted.add(u.id);
                    moved.add(`${step.x},${step.z}`);
                }
            }
        }
    }

    // 8) Unrest garrison: idle military units move to garrison the nearest
    //    high-unrest (>50) owned city. This ensures the AI actively manages
    //    unrest in newly conquered or frontier cities.
    for (const u of members) {
        if (acted.has(u.id) || u.hasMovedThisTurn) continue;
        if (u.type === 'SETTLER' || u.type === 'WORKER' || u.type === 'SCOUT') continue;
        // Find the nearest owned city with unrest > 50
        let bestCity = null, bestDist = Infinity;
        for (const t of tiles.values()) {
            if (t.terrain !== 'CITY' || t.owner !== owner) continue;
            if ((t.unrest || 0) <= 50) continue;
            const d = manhattan(u.x, u.z, t.x, t.z);
            if (d < bestDist) { bestDist = d; bestCity = t; }
        }
        if (bestCity && bestDist <= 10) {
            const step = nextStepToward(tiles, units, u, bestCity, 200, owner);
            if (step && !moved.has(`${step.x},${step.z}`)) {
                out.push({ type: 'move', unitId: u.id, tx: step.x, tz: step.z });
                acted.add(u.id);
                moved.add(`${step.x},${step.z}`);
            }
        }
    }

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
    // Collect anchor origins: owned cities plus any live settlers already in
    // the field. A found spot reachable from ANY of these is "accessible"; a
    // spot on a reachable sub-continent but cut off by water/mountains is NOT
    // (settlers would train and then mill about with nowhere to go — the
    // mid-game settler-spam bug).
    const origins = [];
    for (const t of tiles.values()) {
        if (t.owner === owner && t.terrain === 'CITY') {
            if (land.idOf.get(`${t.x},${t.z}`) === massId) origins.push([t.x, t.z]);
        }
    }
    if (origins.length === 0) return false;
    for (const t of tiles.values()) {
        if (land.idOf.get(`${t.x},${t.z}`) !== massId) continue;
        if (!canFoundOn(t, owner, tiles)) continue;
        // Reachability check: at least one owned city can path to this tile by
        // land (rivers are passable — engineers bridge them). This filters out
        // valid-but-unreachable spots that previously caused the AI to keep
        // training settlers it could never use.
        for (const [ox, oz] of origins) {
            if (isReachableByLand(tiles, ox, oz, t.x, t.z)) return true;
        }
    }
    return false;
}

/** True if there exists a non-home landmass with no friendly city on it AND
 *  which contains at least one tile a settler could found on (rejects barren
 *  rocks, so the AI doesn't build a harbor for useless water). `minSize`
 *  optionally rejects landmasses below a tile count (e.g. tiny islets). */
function hasForeignLandmassWithoutCity(tiles, owner, land, homeMass, minSize = 0) {
    const friendlyMasses = new Set();
    for (const t of tiles.values()) {
        if (t.terrain === 'CITY' && t.owner === owner) {
            const m = land.idOf.get(`${t.x},${t.z}`);
            if (m != null) friendlyMasses.add(m);
        }
    }
    for (const m of land.sizes.keys()) {
        if (m === homeMass) continue;
        if (friendlyMasses.has(m)) continue;
        if ((land.sizes.get(m) || 0) < minSize) continue;
        // Require at least one settleable tile on this foreign mass.
        for (const t of tiles.values()) {
            if (land.idOf.get(`${t.x},${t.z}`) !== m) continue;
            if (canFoundOn(t, owner)) return true;
        }
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

/** True if a city tile touches water or river that is connected to open
 *  water or a large enough body (can host a Harbor / launch ships).
 *  Enclosed water bodies must contain at least 15 tiles to count, blocking
 *  harbors on small ponds/lakes. */
export function isCoastalCity(tile, tiles) {
    for (const [dx, dz] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
        const nt = tiles.get(`${tile.x + dx},${tile.z + dz}`);
        if (nt && (nt.terrain === 'WATER' || nt.terrain === 'RIVER') &&
            isWaterConnectedToOpenWater(tiles, `${nt.x},${nt.z}`, 4, 15)) {
            return true;
        }
    }
    return false;
}

/** An orthogonally-adjacent friendly Transport with free cargo space, or null. */
function adjacentTransport(unit, units, owner) {
    for (const u of units.values()) {
        if (u.owner !== owner || !isTransport(u) || u.boarded) continue;
        const cap = (UNIT_TYPE[u.type] && UNIT_TYPE[u.type].capacity) || 2;
        if (((u.cargo || []).length) >= cap) continue;
        if (Math.abs(u.x - unit.x) + Math.abs(u.z - unit.z) === 1) return u;
    }
    return null;
}

/** True if a loaded transport is close enough to its destination shore tile to
 *  unload: within Manhattan 2 (so diagonal adjacency to the destination counts)
 *  with at least one orthogonally adjacent land tile to disembark onto. Without
 *  the diagonal case a transport sitting kitty-corner to the target would step
 *  back and forth and never unload. */
function canUnloadAt(transport, dest, tiles) {
    if (manhattan(transport.x, transport.z, dest.x, dest.z) > 2) return false;
    for (const [dx, dz] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
        const t = tiles.get(`${transport.x + dx},${transport.z + dz}`);
        if (t && t.terrain !== 'WATER' && t.terrain !== 'RIVER' && t.terrain !== 'MOUNTAIN') return true;
    }
    return false;
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
        if (!canFoundOn(t, owner, tiles)) continue;
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
 *  assault. Excludes settlers, workers, and naval units. Only units on a
 *  landmass with a friendly city are picked up: units already ashore on a
 *  foreign landmass were just unloaded there, and re-boarding them would
 *  create a board→disembark→reboard loop. */
function nearestIdleMilitaryAtShore(transport, units, tiles, owner, acted, land) {
    // Landmasses containing a friendly city — the only places to embark from.
    const friendlyMasses = new Set();
    for (const t of tiles.values()) {
        if (t.terrain === 'CITY' && t.owner === owner) {
            const mass = land && land.idOf.get(`${t.x},${t.z}`);
            if (mass != null) friendlyMasses.add(mass);
        }
    }
    let best = null, bestDist = Infinity;
    for (const u of units.values()) {
        if (u.owner !== owner || u.boarded) continue;
        if (u.type === 'SETTLER' || u.type === 'WORKER' || isNaval(u)) continue;
        if (acted.has(u.id)) continue;
        const t = tiles.get(`${u.x},${u.z}`);
        if (!t || t.terrain === 'WATER' || t.terrain === 'MOUNTAIN') continue;
        if (!land || !friendlyMasses.has(land.idOf.get(`${u.x},${u.z}`))) continue;
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
    let enemies = 0, cavalry = 0, armor = 0;
    for (const u of units.values()) {
        if (u.owner === owner) continue;
        if (isAtWar && !isAtWar(u.owner)) continue;
        const d = manhattan(u.x, u.z, city.x, city.z);
        if (d > 5) continue;
        enemies++;
        const udef = UNIT_TYPE[u.type];
        if (u.type === 'CAVALRY' || u.type === 'CATAPHRACT') cavalry++;
        // Armor: tanks, heavy tanks, armored cars, motor artillery — the
        // modern "cavalry" that AT mines are built to stop.
        if (udef && (udef.armored || u.type === 'TANK' || u.type === 'HEAVY_TANK' || u.type === 'ARMORED_CAR')) armor++;
    }
    return { enemies, cavalry, armor };
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

/** Decide a king's response to being under ranged fire, or null if no ranged
 *  threat. A ranged enemy (attackRange >= 2) hitting the king from outside the
 *  king's melee reach (Chebyshev > 1) is untouchable by the king's adjacent-only
 *  attack, so the king must either close to melee or retreat out of range.
 *  Pure: takes the king, at-war enemy units, and the local friendly/foe power
 *  (Chebyshev-3 sums the caller already computed). Returns:
 *    { close: true,  target: {x,z} }   -> step (up to 2x) toward the shooter
 *    { close: false, shooter, srange } -> retreat toward a safe tile (caller
 *                                        picks home), stepping until distance
 *                                        to the shooter exceeds srange
 *    null                              -> no ranged threat; caller does nothing
 *  Used by _aiMoveKing in game.js. */
export function kingRangedResponse(lord, enemyUnits, friendLocal, foeLocal) {
    let shooter = null, bestD = Infinity;
    for (const u of enemyUnits) {
        const udef = UNIT_TYPE[u.type];
        const range = (udef && udef.attackRange) || (udef && udef.ranged ? 2 : 1);
        if (range < 2) continue;
        const d = Math.max(Math.abs(u.x - lord.x), Math.abs(u.z - lord.z));
        if (d <= range && d > 1) { // in their kill-zone, king can't counter
            if (d < bestD) { bestD = d; shooter = u; }
        }
    }
    if (!shooter) return null;
    const sdef = UNIT_TYPE[shooter.type];
    const srange = (sdef && sdef.attackRange) || (sdef && sdef.ranged ? 2 : 1);
    const d = Math.max(Math.abs(shooter.x - lord.x), Math.abs(shooter.z - lord.z));
    // Only close on a ranged shooter when the king has a clear local advantage.
    // If enemies are equal or stronger, retreat instead of walking into a duel.
    const outmatched = foeLocal >= friendLocal;
    if (!outmatched && d <= 3 && friendLocal > foeLocal * 1.2) {
        // 2 steps from distance 3 reaches adjacent, so d<=3 is closeable.
        return { close: true, target: { x: shooter.x, z: shooter.z } };
    }
    return { close: false, shooter, srange };
}

/** Build the AI Debug panel HTML (pure string — testable without a DOM).
 *  Shows per-faction unit composition (actual vs target), resource stockpiles
 *  and per-turn income, army groups (size/stance/objective), active goals, and
 *  recent actions. Used by the spectate-mode debug panel.
 *  `tiles`/`resources`/`buildings`/`lords` are optional: without them the
 *  income line is skipped (keeps the old call signature usable). */
export function buildAIDebugHTML(units, aiState, factions, factionDefs, factionColors, tiles, resources, buildings, lords) {
    let html = '<h3>AI Debug</h3>';
    for (const slot of factions) {
        const st = aiState && aiState[slot];
        const def = factionDefs && factionDefs[slot];
        const color = factionColors && factionColors[slot];
        const colorHex = (color && typeof color.tile === 'number')
            ? '#' + color.tile.toString(16).padStart(6, '0')
            : '#888';
        const name = (def && (def.name || (color && color.name))) || slot;
        const emoji = (def && def.emoji) || '';

        // Count units by role.
        const myUnits = [];
        for (const u of units.values()) {
            if (u.owner === slot) myUnits.push(u);
        }
        const counts = { melee: 0, ranged: 0, cavalry: 0, siege: 0, support: 0, naval: 0 };
        for (const u of myUnits) {
            const r = unitRole(u.type);
            if (counts[r] !== undefined) counts[r]++;
        }
        const total = myUnits.length;

        // Get faction composition targets — prefer the effective (objective-
        // tweaked) target persisted by computeAIActions each turn; fall back
        // to the base faction composition when no snapshot exists.
        const roster = (def && def.roster) || [];
        const target = (st && st.targetComposition) || factionComposition(def, roster);
        const targetStr = Object.entries(target)
            .filter(([, v]) => v > 0)
            .map(([k, v]) => `${k}: ${Math.round(v * 100)}%`)
            .join(', ');

        // Unit composition bar.
        const compHtml = Object.entries(counts)
            .filter(([, v]) => v > 0)
            .map(([role, count]) => {
                const pct = total > 0 ? (count / total * 100).toFixed(0) : 0;
                return `<span style="margin-right:6px;"><strong>${role}</strong>: ${count} (${pct}%)</span>`;
            }).join('');

        // Active goals.
        let goalHtml = '';
        if (st && Array.isArray(st.goals) && st.goals.length) {
            goalHtml = st.goals.map((g, i) => {
                const mark = i === 0 ? '★' : '·';
                const tgt = g.targetTileKey ? ` → ${g.targetTileKey}` : '';
                return `<div style="font-size:11px;line-height:1.35;">${mark} <strong>${g.kind}</strong> <span class="muted">(p=${Math.round((g.priority || 0) * 100)}%, ${g.horizon})${tgt}</span></div>`;
            }).join('');
        } else {
            goalHtml = '<div style="font-size:11px;" class="muted">No goals</div>';
        }

        // Recent build/train orders.
        let ordersHtml = '';
        if (st && st.recentActions && st.recentActions.length) {
            ordersHtml = '<div style="font-size:10px;margin:2px 0;"><strong>Orders:</strong> ' +
                st.recentActions.map(a => {
                    if (a.type === 'train') return `<span style="color:#5bf;">+${a.unitType}</span>`;
                    if (a.type === 'build') return `<span style="color:#b85;">${a.buildingType}</span>`;
                    if (a.type === 'upgradeBuilding') return `<span style="color:#d93;">↑${a.buildingType}</span>`;
                    if (a.type === 'capture') return '<span style="color:#5d5;">Capture</span>';
                    if (a.type === 'buildSiegeEngine') return `<span style="color:#d93;">Build ${a.engineType}</span>`;
                    return a.type;
                }).join(' → ') + '</div>';
        }

        // Resource stockpile + per-turn income (gross yields before upkeep).
        let incomeHtml = '';
        if (tiles && resources) {
            const stock = resources[slot] || {};
            const inc = grossYields(tiles, slot, buildings, lords, def);
            const sum = (brk) => Object.values(brk || {}).reduce((s, v) => s + v, 0);
            const parts = ['gold', 'food', 'wood', 'iron', 'production'].map(res =>
                `${res}: ${Math.floor(stock[res] || 0)} (+${sum(inc[res])}/t)`);
            incomeHtml = `<div style="font-size:10px;margin:2px 0;" class="muted">${parts.join(' · ')}</div>`;
        }

        html += `<div style="margin:4px 0;padding:4px 6px;border-left:3px solid ${colorHex};background:rgba(255,255,255,0.03);">
  <div style="font-weight:600;">${emoji} ${name} <span class="muted" style="font-size:10px;">(${total} units)</span></div>
  <div style="font-size:11px;margin:2px 0;">${compHtml || '<span class="muted">No units</span>'}</div>
  <div style="font-size:10px;margin:2px 0;" class="muted">Target: ${targetStr || 'N/A'}</div>
  ${incomeHtml}
  <div style="margin:3px 0;">${goalHtml}</div>
  ${ordersHtml}
</div>`;
    }
    if (!html.includes('<div style=')) html += '<p class="muted">No AI factions</p>';
    return html;
}

/** Army Groups panel (spectate/debug): per faction, one row per army group
 *  showing leader, stance, objective, total power, and the unit-type
 *  composition (e.g. "Siege Cannon ×1 · Infantry ×4"). Pure HTML builder —
 *  kept separate from buildAIDebugHTML so the two panels stay independent.
 *  Data source: aiState[slot].armyGroups, persisted each turn by
 *  computeAIActions (block 5, after the 5c/5d passes). */
export function buildArmyGroupsHTML(aiState, factions, factionDefs, factionColors) {
    let html = '<h3>Army Groups</h3>';
    let any = false;
    for (const slot of factions) {
        const st = aiState && aiState[slot];
        const groups = (st && Array.isArray(st.armyGroups)) ? st.armyGroups : [];
        const navals = (st && Array.isArray(st.navalGroups)) ? st.navalGroups : [];
        if (!groups.length && !navals.length) continue;
        any = true;
        const def = factionDefs && factionDefs[slot];
        const color = factionColors && factionColors[slot];
        const colorHex = (color && typeof color.tile === 'number')
            ? '#' + color.tile.toString(16).padStart(6, '0')
            : '#888';
        const name = (def && (def.name || (color && color.name))) || slot;
        const emoji = (def && def.emoji) || '';
        const rows = groups.map(g => {
            const comp = Object.entries(g.composition || {})
                .map(([type, n]) => `${(UNIT_TYPE[type] && UNIT_TYPE[type].name) || type} ×${n}`)
                .join(' · ');
            const leader = (g.lords && g.lords.length)
                ? g.lords.join(', ')
                : (g.lord ? `${g.lord}` : '—');
            const obj = g.objective ? ` → ${g.objective}` : '';
            return `<div style="font-size:11px;line-height:1.4;margin:2px 0;padding:2px 4px;background:rgba(255,255,255,0.04);border-radius:3px;">
  <strong>${leader}</strong> <span class="muted">${g.stance || 'hold'}${obj} · pow ${g.power || 0}</span><br>
  <span style="font-size:10px;">${comp || '—'}</span>
</div>`;
        }).join('');
        const navRows = navals.map(ng => {
            const comp = Object.entries(ng.composition || {})
                .map(([type, n]) => `${(UNIT_TYPE[type] && UNIT_TYPE[type].name) || type} ×${n}`)
                .join(' · ');
            const roleLabel = ng.role || 'strike';
            const obj = ng.objective ? ` → ${ng.objective}` : '';
            return `<div style="font-size:11px;line-height:1.4;margin:2px 0;padding:2px 4px;background:rgba(255,255,255,0.04);border-radius:3px;">
  <strong>${roleLabel}</strong> <span class="muted">${obj} · pow ${ng.power || 0}</span><br>
  <span style="font-size:10px;">${comp || '—'}</span>
</div>`;
        }).join('');
        const idleNote = (st && st.idleMilitaryCount != null)
            ? ` · <span style="color:${st.idleMilitaryCount > 0 ? '#e07b3a' : '#6fbf73'};">idle ${st.idleMilitaryCount}</span>`
            : '';
        html += `<div style="margin:4px 0;padding:4px 6px;border-left:3px solid ${colorHex};background:rgba(255,255,255,0.03);">
  <div style="font-weight:600;">${emoji} ${name} <span class="muted" style="font-size:10px;">(${groups.length} groups${idleNote})</span></div>
  ${rows}
  ${navals.length ? `<div style="margin-top:4px;font-size:11px;color:#7ab;">Naval Fleet (${navals.length} groups)</div>${navRows}` : ''}
</div>`;
    }
    if (!any) html += '<p class="muted">No army groups</p>';
    return html;
}
