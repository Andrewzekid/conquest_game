/** Economy system: resource production, upkeep, trade, market, taxation. */
import { TERRAIN, MARKET_RATES, TRADE_ROUTE_GOLD, STARVATION_ATTRITION, BUILDING_TYPE,
         CITY_GROWTH_BASE, CITY_GROWTH_PER_SURPLUS_FOOD, CITY_GROWTH_SURPLUS_CAP,
         CITY_MAX_LEVEL, cityGrowthThreshold, cityProduction,
         UNREST_THRESHOLDS, UNREST_DECAY_RATES, UNREST_INCREASE_RATES,
         UNREST_REBEL_CHANCE, STABILITY_FACTORS,
         TRADE_ROUTE_BASE_INCOME, TRADE_ROUTE_DISTANCE_BONUS, TRADE_ROUTE_CITY_LEVEL_BONUS,
         TRADE_ROUTE_MAX, TRADE_ROUTE_MIN_CITY_LEVEL, RAID_STEAL_PERCENT, RAID_DISRUPT_TURNS,
         UNIT_TYPE } from './config.js';
import { getLordGovernanceMultiplier } from './lords.js';
import { cityRadius, expandCityTerritory } from './map.js';
import { getRelation } from './diplomacy.js';
import { DIPLOMACY_STATES } from './config.js';

/** Per-city worked-tile cap (Civ6-style "citizens"): a level-L city works
 *  WORKED_TILES_BASE + L * WORKED_TILES_PER_LEVEL nearby tiles for terrain
 *  yields. Owned but unworked tiles grant territory/victory only, not resources. */
const WORKED_TILES_BASE = 2;
const WORKED_TILES_PER_LEVEL = 2;

/**
 * Collect resources for a faction. Civ6 model: each owned city works a small,
 * level-scaled set of nearby tiles for terrain yields; the city tile itself
 * always produces gold + production. Buildings (player-built improvements)
 * still apply their bonus on the tiles they're built on. This bounds the
 * economy so owning a large territory doesn't flood the player with resources.
 *
 * The per-source arithmetic lives in `grossYields` (below) so the UI can display
 * the exact same income breakdown the economy actually applies — no phantom
 * "+13/t food" that never reaches the stockpile.
 */
export function collectResources(tiles, owner, resources, buildings, lords, factionDef) {
    const messages = [];
    const b = grossYields(tiles, owner, buildings, lords, factionDef);
    for (const res of Object.keys(b)) {
        let sum = 0;
        for (const cat of Object.values(b[res])) sum += cat;
        resources[res] = (resources[res] || 0) + sum;
    }
    return messages;
}

/** Per-source gross yield breakdown for a faction, using the exact Civ6
 *  worked-tile model that `collectResources` applies. The UI displays this so
 *  the income shown always matches what actually lands in the resource pool.
 *  Structure (each category is a flat per-turn amount):
 *    gold: { city, market, terrain, wonder }
 *    food: { city, farm, terrain, wonder, passive }
 *    wood: { city, lumbermill, terrain, wonder }
 *    iron: { city, mine, terrain, wonder }
 *    production: { city, barracks, workshop, harbor, wonder }
 *  `collectResources` sums each resource's categories into the pool. */
export function grossYields(tiles, owner, buildings, lords, factionDef) {
    const breakdown = {
        gold: { city: 0, market: 0, terrain: 0, wonder: 0, bank: 0 },
        food: { city: 0, farm: 0, terrain: 0, wonder: 0, passive: 0 },
        wood: { city: 0, lumbermill: 0, terrain: 0, wonder: 0 },
        iron: { city: 0, mine: 0, terrain: 0, wonder: 0 },
        production: { city: 0, barracks: 0, workshop: 0, harbor: 0, wonder: 0, commandPost: 0, powerPlant: 0 },
        research: { city: 0, university: 0, wonder: 0 },
    };
    const add = (res, cat, amt) => { breakdown[res][cat] = (breakdown[res][cat] || 0) + amt; };
    const lordsArr = lords || [];

    const cities = [];
    for (const t of tiles.values()) {
        if (t.owner === owner && t.terrain === 'CITY') cities.push(t);
    }

    // Worked-tile selection (Civ6 "citizens"): each city works its nearest
    // WORKED_TILES_BASE + level*WORKED_TILES_PER_LEVEL non-city owned tiles.
    const worked = new Set();
    for (const c of cities) {
        const r = cityRadius(c);
        const cl = c.cityLevel || 1;
        const cap = WORKED_TILES_BASE + cl * WORKED_TILES_PER_LEVEL;
        const nearby = [];
        for (let dx = -r; dx <= r; dx++) {
            for (let dz = -r; dz <= r; dz++) {
                if (dx === 0 && dz === 0) continue;
                const t = tiles.get(`${c.x + dx},${c.z + dz}`);
                if (!t || t.owner !== owner || t.terrain === 'CITY') continue;
                nearby.push({ t, d: Math.abs(dx) + Math.abs(dz) });
            }
        }
        nearby.sort((a, b) => a.d - b.d);
        for (let i = 0; i < cap && i < nearby.length; i++) {
            worked.add(`${nearby[i].t.x},${nearby[i].t.z}`);
        }
    }

    // City tiles: gold + production (level-scaled) plus a hinterland trickle of
    // food/wood/iron. Food scales with level so a young city still feeds itself
    // (2 + level: a Lv1 city yields 3 food — enough early game to avoid
    // starvation before farms are up). Wood/iron scale weakly with influence.
    for (const tile of cities) {
        const tileKey = `${tile.x},${tile.z}`;
        const terrainData = TERRAIN[tile.terrain] || TERRAIN.CITY;
        const cl = tile.cityLevel || 1;
        let gold = (terrainData.amount || 0) + (cl - 1) * 1;
        const governor = lordsArr.find(l => l.owner === owner && l.governingCity === tileKey);
        if (governor) gold = Math.floor(gold * getLordGovernanceMultiplier(governor));
        add('gold', 'city', gold);
        add('production', 'city', cityProduction(cl));
        const influence = cityRadius(tile);
        add('food', 'city', 2 + cl);
        add('wood', 'city', 1 + Math.ceil(influence / 3));
        add('iron', 'city', Math.ceil(influence / 3));
        // City buildings (MARKET/BARRACKS/SIEGE_WORKSHOP/HARBOR/WALLS).
        const tileBuildings = buildings.get(tileKey) || [];
        for (const bType of tileBuildings) {
            const bData = BUILDING_TYPE[bType];
            if (!bData || !bData.bonus) continue;
            for (const [res, bonus] of Object.entries(bData.bonus)) {
                if (res === 'defense') continue;
                if (res === 'gold') {
                    if (bType === 'MARKET') add('gold', 'market', bonus);
                    else if (bType === 'BANK') add('gold', 'bank', bonus);
                    else add('gold', 'city', bonus);
                } else if (res === 'production') {
                    if (bType === 'BARRACKS') add('production', 'barracks', bonus);
                    else if (bType === 'SIEGE_WORKSHOP') add('production', 'workshop', bonus);
                    else if (bType === 'HARBOR') add('production', 'harbor', bonus);
                    else if (bType === 'COMMAND_POST') add('production', 'commandPost', bonus);
                    else if (bType === 'POWER_PLANT') add('production', 'powerPlant', bonus);
                    else add('production', 'city', bonus);
                } else if (res === 'research') {
                    if (bType === 'UNIVERSITY') add('research', 'university', bonus);
                    else add('research', 'city', bonus);
                } else {
                    add(res, 'city', bonus);
                }
            }
        }
    }

    // Worked non-city tiles: terrain base yield + building bonuses.
    for (const key of worked) {
        const tile = tiles.get(key);
        if (!tile) continue;
        const terrainData = TERRAIN[tile.terrain] || TERRAIN.PLAINS;
        const resType = terrainData.resource;
        let amount = terrainData.amount || 0;
        const tileBuildings = buildings.get(key) || [];
        // Terrain-matched improvements (FARM/LUMBERMILL/MINE) boost the
        // terrain's own resource yield.
        for (const bType of tileBuildings) {
            const bData = BUILDING_TYPE[bType];
            if (bData && bData.bonus) {
                for (const [res, bonus] of Object.entries(bData.bonus)) {
                    if (res === resType) amount += bonus;
                }
            }
        }
        if (resType) {
            // Categorize the terrain (+ matched improvement) yield.
            if (resType === 'food') add('food', tileBuildings.includes('FARM') ? 'farm' : 'terrain', amount);
            else if (resType === 'wood') add('wood', tileBuildings.includes('LUMBERMILL') ? 'lumbermill' : 'terrain', amount);
            else if (resType === 'iron') add('iron', tileBuildings.includes('MINE') ? 'mine' : 'terrain', amount);
            else add(resType, 'terrain', amount);
        }
    }

    // Non-terrain buildings (MARKET/BARRACKS/SIEGE_WORKSHOP/HARBOR/UNIVERSITY/
    // BANK/COMMAND_POST/POWER_PLANT) now sit on influence tiles outside the
    // city, so their bonuses must be collected from ALL owned tiles — not just
    // the city tile or the worked-tile set. WALLS/CITADEL stay on the city
    // tile and only grant defense (no economic bonus to collect here).
    for (const t of tiles.values()) {
        if (t.owner !== owner) continue;
        const key = `${t.x},${t.z}`;
        if (key === `${t.x},${t.z}` && t.terrain === 'CITY') {
            // City-tile buildings were already collected in the city loop above.
            continue;
        }
        const tileBuildings = buildings.get(key) || [];
        for (const bType of tileBuildings) {
            const bData = BUILDING_TYPE[bType];
            if (!bData || !bData.bonus) continue;
            for (const [res, bonus] of Object.entries(bData.bonus)) {
                if (res === 'defense') continue;
                if (res === 'gold') {
                    if (bType === 'MARKET') add('gold', 'market', bonus);
                    else if (bType === 'BANK') add('gold', 'bank', bonus);
                    else add('gold', 'city', bonus);
                } else if (res === 'production') {
                    if (bType === 'BARRACKS') add('production', 'barracks', bonus);
                    else if (bType === 'SIEGE_WORKSHOP') add('production', 'workshop', bonus);
                    else if (bType === 'HARBOR') add('production', 'harbor', bonus);
                    else if (bType === 'COMMAND_POST') add('production', 'commandPost', bonus);
                    else if (bType === 'POWER_PLANT') add('production', 'powerPlant', bonus);
                    else add('production', 'city', bonus);
                } else if (res === 'research') {
                    if (bType === 'UNIVERSITY') add('research', 'university', bonus);
                    else add('research', 'city', bonus);
                } else {
                    add(res, 'city', bonus);
                }
            }
        }
    }

    // Faction passive: flat food per turn (e.g. Verdant Realm).
    if (factionDef && factionDef.passive && factionDef.passive.foodPerTurn) {
        add('food', 'passive', factionDef.passive.foodPerTurn);
    }

    // Natural Wonders: each owned tile with a wonder grants its bonus to its
    // owner — so capturing a city whose territory contains a wonder pays off.
    for (const tile of tiles.values()) {
        if (tile.owner === owner && tile.wonder && tile.wonder.bonus) {
            for (const [res, amt] of Object.entries(tile.wonder.bonus)) {
                if (breakdown[res]) add(res, 'wonder', amt);
            }
        }
    }
    return breakdown;
}

/** Per-resource unit upkeep totals for a faction (matches `processUpkeep`). */
export function upkeepTotals(units, owner) {
    const totals = { food: 0, gold: 0, wood: 0, iron: 0 };
    for (const unit of units.values()) {
        if (unit.owner !== owner) continue;
        const upkeep = unit.upkeep || { food: 2, gold: 1 };
        for (const res of ['food', 'gold', 'wood', 'iron']) {
            totals[res] += upkeep[res] || 0;
        }
    }
    return totals;
}

/**
 * Process unit upkeep: every unit costs gold + food per turn; some special
 * units also cost wood and/or iron. Starvation (negative food) attritions units.
 * Returns { starved: boolean, messages: [] }
 */
export function processUpkeep(units, owner, resources) {
    const messages = [];
    const totals = upkeepTotals(units, owner);

    for (const res of ['food', 'gold', 'wood', 'iron']) {
        resources[res] = (resources[res] || 0) - totals[res];
        if (resources[res] < 0 && res !== 'food') resources[res] = 0; // don't go negative except food
    }

    // Starvation check (food only).
    let starved = false;
    if (resources.food < 0) {
        starved = true;
        const deficit = Math.abs(resources.food);
        resources.food = 0;
        let attritionApplied = 0;
        for (const unit of units.values()) {
            if (unit.owner !== owner) continue;
            if (attritionApplied >= deficit) break;
            unit.hp -= STARVATION_ATTRITION;
            attritionApplied += STARVATION_ATTRITION;
            messages.push(`${unit.type} unit suffered ${STARVATION_ATTRITION} attrition from starvation!`);
        }
    }

    return { starved, messages };
}

/**
 * Sell resources at the market: convert wood/iron/food to gold.
 * @param resources - faction resource pool (mutated)
 * @param sales - { wood: 10, iron: 5 } amounts to sell
 */
export function sellAtMarket(resources, sales) {
    const messages = [];
    let goldGained = 0;

    for (const [res, amount] of Object.entries(sales)) {
        if (!MARKET_RATES[res]) continue;
        if ((resources[res] || 0) < amount) {
            messages.push(`Not enough ${res} to sell ${amount}.`);
            continue;
        }
        resources[res] -= amount;
        const gold = Math.floor(amount * MARKET_RATES[res]);
        goldGained += gold;
        messages.push(`Sold ${amount} ${res} for ${gold} gold.`);
    }

    resources.gold = (resources.gold || 0) + goldGained;
    return messages;
}

/**
 * Establish a trade route between two cities.
 * Each turn, generates TRADE_ROUTE_GOLD for the owner.
 */
export function getTradeRouteIncome(tiles, owner, tradeRoutes) {
    let total = 0;
    for (const route of tradeRoutes) {
        // New rich route shape: { from:{owner,cityKey}, to:{owner,cityKey}, income, disrupted }.
        if (route.from && route.to && route.from.owner && route.to.owner) {
            // A route pays its establishing owner (from.owner) when not disrupted
            // and both endpoints are still owned by participants.
            if (route.disrupted) continue;
            const fromTile = tiles.get(route.from.cityKey);
            const toTile = tiles.get(route.to.cityKey);
            if (!fromTile || !toTile) continue;
            // Income accrues to the establishing faction if it still holds its end.
            if (route.from.owner === owner && fromTile.owner === owner) {
                total += route.income || TRADE_ROUTE_GOLD;
            }
        } else if (route.owner === owner) {
            // Legacy flat shape (old saves): { owner, from, to } tile keys.
            const t1 = tiles.get(route.from);
            const t2 = tiles.get(route.to);
            if (t1 && t2 && t1.owner === owner && t2.owner === owner) {
                total += TRADE_ROUTE_GOLD;
            }
        }
    }
    return total;
}

/** Compute a simple Manhattan path of tile keys between two endpoints. */
function computeRoutePath(from, to) {
    const path = [];
    let x = from.x, z = from.z;
    while (x !== to.x) {
        path.push(`${x},${z}`);
        x += x < to.x ? 1 : -1;
    }
    while (z !== to.z) {
        path.push(`${x},${z}`);
        z += z < to.z ? 1 : -1;
    }
    path.push(`${to.x},${to.z}`);
    return path;
}

/** Create a trade route object between two city endpoints. `id` should be a
 *  unique route id (the host game supplies a monotonic counter — Date.now() is
 *  avoided so the model stays deterministic for tests/saves). */
export function createTradeRoute(params) {
    const distance = Math.abs(params.from.x - params.to.x) + Math.abs(params.from.z - params.to.z);
    const income = TRADE_ROUTE_BASE_INCOME
        + Math.floor(distance * TRADE_ROUTE_DISTANCE_BONUS)
        + (params.fromLevel || 1) * TRADE_ROUTE_CITY_LEVEL_BONUS
        + (params.toLevel || 1) * TRADE_ROUTE_CITY_LEVEL_BONUS;
    return {
        id: params.id || 0,
        from: { owner: params.from.owner, cityKey: params.from.cityKey, x: params.from.x, z: params.from.z },
        to: { owner: params.to.owner, cityKey: params.to.cityKey, x: params.to.x, z: params.to.z },
        income,
        path: computeRoutePath(params.from, params.to),
        disrupted: false,
        disruptedTurnsLeft: 0,
        establishedTurn: params.turn || 0
    };
}

/** Validate that a trade route can be established between two cities.
 *  @returns {{ valid: boolean, reason: string }} */
export function validateTradeRoute(tiles, diploState, fromOwner, toOwner, fromCityKey, toCityKey, existingRoutes) {
    const fromTile = tiles.get(fromCityKey);
    const toTile = tiles.get(toCityKey);
    if (!fromTile || !toTile) return { valid: false, reason: 'City not found' };
    if ((fromTile.cityLevel || 1) < TRADE_ROUTE_MIN_CITY_LEVEL) {
        return { valid: false, reason: `Origin city must be level ${TRADE_ROUTE_MIN_CITY_LEVEL}+` };
    }
    if ((toTile.cityLevel || 1) < TRADE_ROUTE_MIN_CITY_LEVEL) {
        return { valid: false, reason: `Destination city must be level ${TRADE_ROUTE_MIN_CITY_LEVEL}+` };
    }
    if (fromCityKey === toCityKey) return { valid: false, reason: 'Cannot route a city to itself' };

    // Diplomacy: same owner always allowed; otherwise need peace/trade/alliance.
    if (fromOwner !== toOwner) {
        const state = getRelation(diploState, fromOwner, toOwner).state;
        if (state === DIPLOMACY_STATES.WAR) return { valid: false, reason: 'Cannot trade with an enemy' };
    }

    // Per-faction route cap (count routes where this owner is an endpoint).
    const ownerRoutes = existingRoutes.filter(r =>
        (r.from && r.from.owner === fromOwner) || (r.to && r.to.owner === fromOwner) ||
        r.owner === fromOwner);
    if (ownerRoutes.length >= TRADE_ROUTE_MAX) {
        return { valid: false, reason: `Route cap reached (${TRADE_ROUTE_MAX})` };
    }

    // No duplicate route (either direction).
    const dup = existingRoutes.find(r => {
        const a = r.from && r.from.cityKey, b = r.to && r.to.cityKey;
        if (!a || !b) return false;
        return (a === fromCityKey && b === toCityKey) || (a === toCityKey && b === fromCityKey);
    });
    if (dup) return { valid: false, reason: 'Route already exists' };

    return { valid: true, reason: 'OK' };
}

/** Process trade-route raids: a military unit (non-naval, non-worker) standing
 *  on a route's path steals a fraction of the route's income and disrupts it
 *  for RAID_DISRUPT_TURNS. Called per raider faction each round.
 *  @returns {{ raided: Array, messages: string[] }} */
export function processTradeRouteRaids(routes, units, raiderFaction) {
    const raided = [];
    const messages = [];

    for (const route of routes) {
        if (route.disrupted) continue;
        if (!route.from || !route.to) continue;
        if (route.from.owner === raiderFaction || route.to.owner === raiderFaction) continue;

        for (const tileKey of route.path) {
            const [x, z] = tileKey.split(',').map(Number);
            let hit = false;
            for (const unit of units.values()) {
                if (unit.owner !== raiderFaction || unit.x !== x || unit.z !== z) continue;
                const ud = UNIT_TYPE[unit.type];
                if (!ud || ud.naval || unit.type === 'WORKER') continue;
                const stolen = Math.floor((route.income || 0) * RAID_STEAL_PERCENT);
                route.disrupted = true;
                route.disruptedTurnsLeft = RAID_DISRUPT_TURNS;
                raided.push({ route, stolen, raider: raiderFaction });
                messages.push(`${ud.name || unit.type} raided a trade route! Stole ${stolen} gold.`);
                hit = true;
                break;
            }
            if (hit) break;
        }
    }

    return { raided, messages };
}

/**
 * Natural city growth (Civ6-style). Each owned city accumulates growth each
 * turn (a flat base plus a bonus from the faction's food surplus); when it
 * crosses the level threshold it auto-levels up, growing its influence radius
 * and claiming the newly-reached unowned tiles. Returns log messages.
 * Call once per round for every faction (after collectResources, when the food
 * surplus for this turn is known).
 */
export function processCityGrowth(tiles, owner, resources, log) {
    const messages = [];
    const surplus = (resources && resources.food) || 0;
    // Clamp the surplus so a large food stockpile can't instant-level a city;
    // only a modest well-fed bonus accelerates growth.
    const gain = CITY_GROWTH_BASE +
        Math.max(0, Math.min(surplus, CITY_GROWTH_SURPLUS_CAP)) * CITY_GROWTH_PER_SURPLUS_FOOD;
    for (const tile of tiles.values()) {
        if (tile.owner !== owner || tile.terrain !== 'CITY') continue;
        if ((tile.cityLevel || 1) >= CITY_MAX_LEVEL) continue;
        tile.growth = (tile.growth || 0) + gain;
        const need = cityGrowthThreshold(tile.cityLevel || 1);
        if (tile.growth >= need) {
            tile.growth -= need;
            tile.cityLevel = (tile.cityLevel || 1) + 1;
            tile.fortMax = 2 + tile.cityLevel;
            tile.fortification = tile.fortMax;
            const claimed = expandCityTerritory(tiles, tile, owner);
            const msg = `City at [${tile.x}, ${tile.z}] grew to Lv.${tile.cityLevel} (influence ${cityRadius(tile)})!${claimed ? ` Claimed ${claimed} new tile(s).` : ''}`;
            messages.push(msg);
            if (log) log(msg);
        }
    }
    return messages;
}

/**
 * Natural growth for NEUTRAL (unowned) cities. They have no economy/surplus, so
 * they grow at a flat base rate and slowly expand their influence over
 * surrounding unowned tiles — making the wilderness harder to settle into over
 * time and letting independent city-states contest the map. Called once per
 * round (not per faction). Returns log messages.
 */
export function processNeutralCityGrowth(tiles, log) {
    const messages = [];
    const gain = CITY_GROWTH_BASE;
    for (const tile of tiles.values()) {
        if (tile.terrain !== 'CITY') continue;
        if (tile.owner) continue; // owned cities grow via processCityGrowth
        if ((tile.cityLevel || 1) >= CITY_MAX_LEVEL) continue;
        tile.growth = (tile.growth || 0) + gain;
        const need = cityGrowthThreshold(tile.cityLevel || 1);
        if (tile.growth >= need) {
            tile.growth -= need;
            tile.cityLevel = (tile.cityLevel || 1) + 1;
            tile.fortMax = 2 + tile.cityLevel;
            tile.fortification = tile.fortMax;
            const claimed = expandCityTerritory(tiles, tile, null);
            const msg = `Neutral city at [${tile.x}, ${tile.z}] grew to Lv.${tile.cityLevel} (influence ${cityRadius(tile)}).${claimed ? ` Claimed ${claimed} tile(s).` : ''}`;
            messages.push(msg);
            if (log) log(msg);
        }
    }
    return messages;
}

/**
 * Count owned cities for a faction.
 */
export function countCities(tiles, owner) {
    let count = 0;
    for (const tile of tiles.values()) {
        if (tile.owner === owner && tile.terrain === 'CITY') count++;
    }
    return count;
}

/**
 * Count owned tiles for a faction.
 */
export function countTiles(tiles, owner) {
    let count = 0;
    for (const tile of tiles.values()) {
        if (tile.owner === owner) count++;
    }
    return count;
}

/** Unit cap contributed by a single city at a given level (Lv1=5, +2 per level). */
export function unitCapForCity(level) {
    return 5 + (((level || 1) - 1) * 2);
}

/**
 * Calculate the unit cap for a faction. Civ6-style: each owned city
 * contributes 5 + (cityLevel-1)*2 — so leveling a city also raises the cap.
 */
export function getUnitCap(tiles, owner) {
    let cap = 0;
    for (const tile of tiles.values()) {
        if (tile.owner === owner && tile.terrain === 'CITY') {
            cap += unitCapForCity(tile.cityLevel);
        }
    }
    return cap;
}

// --- City Unrest & Loyalty ---
// Pure-logic unrest model. `buildings` is the gameState.buildings Map
// (tileKey -> building-type array) so the module never reaches back into a
// Game instance — the original plan referenced `this.gameState.buildings`
// inside a module function, which is undefined in a standalone export.

const ADJACENT_DIRS = [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];

function hasUnitAt(units, owner, x, z) {
    for (const u of units.values()) {
        if (u.owner === owner && u.x === x && u.z === z) return true;
    }
    return false;
}

function getNearestCity(tiles, owner, fromTile) {
    let nearest = null;
    let minDist = Infinity;
    for (const t of tiles.values()) {
        if (t.owner === owner && t.terrain === 'CITY' && t !== fromTile) {
            const d = Math.abs(t.x - fromTile.x) + Math.abs(t.z - fromTile.z);
            if (d < minDist) { minDist = d; nearest = t; }
        }
    }
    return nearest;
}

function getAdjacentEnemyCities(tiles, owner, tile) {
    const enemies = [];
    for (const [dx, dz] of ADJACENT_DIRS) {
        const neighbor = tiles.get(`${tile.x + dx},${tile.z + dz}`);
        if (neighbor && neighbor.terrain === 'CITY' && neighbor.owner && neighbor.owner !== owner) {
            enemies.push(neighbor);
        }
    }
    return enemies;
}

function findGovernor(lords, cityKey) {
    return (lords || []).find(l => l.governingCity === cityKey);
}

/** Find the non-current-owner with the most tiles adjacent to a city (the
 *  natural rebel successor). Returns null if no rival claims it (city goes
 *  independent). */
function findHighestInfluenceOwner(tiles, currentOwner, tile) {
    const counts = {};
    for (const [dx, dz] of ADJACENT_DIRS) {
        const neighbor = tiles.get(`${tile.x + dx},${tile.z + dz}`);
        if (neighbor && neighbor.owner && neighbor.owner !== currentOwner) {
            counts[neighbor.owner] = (counts[neighbor.owner] || 0) + 1;
        }
    }
    let maxCount = 0;
    let result = null;
    for (const [owner, count] of Object.entries(counts)) {
        if (count > maxCount) { maxCount = count; result = owner; }
    }
    return result;
}

/** Calculate unrest for a single city tile.
 *  @returns {{ amount: number, reasons: Array<{reason: string, amount: number}> }} */
export function calculateUnrest(tiles, cityKey, owner, units, lords, currentTurn, buildings, resources = null) {
    const tile = tiles.get(cityKey);
    if (!tile || tile.terrain !== 'CITY') return { amount: 0, reasons: [] };

    let unrest = tile.unrest || 0;
    const reasons = [];

    // Conquest-history dampening: each prior capture of this city reduces
    // unrest GAINS by 25% (min 15% of base), so a hotly-contested border
    // city stops cycling to 100 unrest forever. Only applies to increases;
    // decay bonuses (garrison/governor/walls/level) keep full strength.
    const conquestCount = tile.conquestCount || 0;
    const dampening = Math.max(0.15, 1 - conquestCount * 0.25);

    // --- INCREASES ---
    // Distance from the nearest other same-owner city (frontier cities are rowdier).
    const capital = getNearestCity(tiles, owner, tile);
    if (capital) {
        const dist = Math.abs(tile.x - capital.x) + Math.abs(tile.z - capital.z);
        const distUnrest = Math.floor(dist * UNREST_INCREASE_RATES.DISTANCE * dampening);
        if (distUnrest > 0) {
            unrest += distUnrest;
            reasons.push({ reason: 'distance', amount: distUnrest });
        }
    }

    // No garrison on the city tile.
    const hasGarrison = hasUnitAt(units, owner, tile.x, tile.z);
    if (!hasGarrison) {
        const amt = Math.floor(UNREST_INCREASE_RATES.NO_GARRISON * dampening);
        unrest += amt;
        reasons.push({ reason: 'no_garrison', amount: amt });
    }

    // Cultural pressure from adjacent enemy-owned cities.
    const adjacentCities = getAdjacentEnemyCities(tiles, owner, tile);
    const pressure = Math.floor(adjacentCities.length * UNREST_INCREASE_RATES.CULTURAL_PRESSURE * dampening);
    if (pressure > 0) {
        unrest += pressure;
        reasons.push({ reason: 'cultural_pressure', amount: pressure });
    }

    // Recent conquest: decays linearly over RECENT_CONQUEST_DECAY_TURNS.
    if (tile.lastConqueredTurn && tile.lastConqueredTurn > 0) {
        const turnsSinceConquest = currentTurn - tile.lastConqueredTurn;
        if (turnsSinceConquest < UNREST_INCREASE_RATES.RECENT_CONQUEST_DECAY_TURNS) {
            const conquestUnrest = Math.max(0, Math.floor(
                (UNREST_INCREASE_RATES.RECENT_CONQUEST - turnsSinceConquest) * dampening));
            if (conquestUnrest > 0) {
                unrest += conquestUnrest;
                reasons.push({ reason: 'recent_conquest', amount: conquestUnrest });
            }
        }
    }

    // --- DECREASES ---
    // Governor assigned to this city.
    const governor = findGovernor(lords, cityKey);
    if (governor) {
        const decay = UNREST_DECAY_RATES.GOVERNOR;
        unrest = Math.max(0, unrest - decay);
        reasons.push({ reason: 'governor', amount: -decay });
    }

    // Garrison present (counteracts the no_garrison penalty above).
    // Decay scales with the number of friendly military units on the city tile:
    // 1 unit = base rate, 2 units = 1.5x, 3+ units = 2x. A lord governing
    // the city also counts (its governor bonus stacks separately).
    const garrisonCount = units ? [...units.values()].filter(u =>
        u.owner === owner && u.x === tile.x && u.z === tile.z &&
        u.type !== 'SETTLER' && u.type !== 'WORKER' && u.type !== 'SCOUT').length : 0;
    if (garrisonCount > 0) {
        const garrisonMult = garrisonCount >= 3 ? 2.0 : garrisonCount === 2 ? 1.5 : 1.0;
        const decay = Math.round(UNREST_DECAY_RATES.GARRISON * garrisonMult);
        unrest = Math.max(0, unrest - decay);
        reasons.push({ reason: 'garrison', amount: -decay });
    }

    // Walls building on the city tile.
    const tileBuildings = (buildings && buildings.get(cityKey)) || [];
    if (tileBuildings.includes('WALLS')) {
        const decay = UNREST_DECAY_RATES.WALLS;
        unrest = Math.max(0, unrest - decay);
        reasons.push({ reason: 'walls', amount: -decay });
    }

    // City level: larger, older cities are more stable.
    const levelDecay = (tile.cityLevel || 1) * UNREST_DECAY_RATES.CITY_LEVEL;
    unrest = Math.max(0, unrest - levelDecay);
    reasons.push({ reason: 'city_level', amount: -levelDecay });

    // --- STABILITY INCREMENTERS ---
    // Empire-wide conditions nudge unrest down (or up under siege). These
    // run after the base decay so they're additive on top. All are capped so
    // no single factor can drive a city to 0 unrest on its own.
    const stabReasons = [];

    // 1) Prosperity: a wealthy treasury stabilizes cities (max -10).
    if (resources) {
        const treasury = resources.gold || 0;
        const prosperityBonus = Math.min(10, Math.floor(treasury / 100)) * STABILITY_FACTORS.PROSPERITY_BONUS;
        if (prosperityBonus < 0) {
            unrest += prosperityBonus;
            stabReasons.push({ reason: 'prosperity', amount: prosperityBonus });
        }
    }

    // 2) Army strength vs. neighbors: a strong army deters rebellion (max -15).
    if (units) {
        const ownersSeen = new Set();
        let myArmyPower = 0, foeArmyPower = 0, foeOwnerCount = 0;
        for (const u of units.values()) {
            ownersSeen.add(u.owner);
            if (['SCOUT', 'SETTLER', 'WORKER'].includes(u.type)) continue;
            if (u.owner === owner) myArmyPower += (u.hp || 0);
            else foeArmyPower += (u.hp || 0);
        }
        foeOwnerCount = Math.max(1, ownersSeen.size - 1);
        const avgFoePower = foeArmyPower / foeOwnerCount;
        const ratio = avgFoePower > 0 ? myArmyPower / avgFoePower : 0;
        if (ratio > 1.5) {
            const bonus = Math.max(-15, Math.floor((ratio - 1) * STABILITY_FACTORS.ARMY_STRENGTH_BONUS));
            if (bonus < 0) {
                unrest += bonus;
                stabReasons.push({ reason: 'army_strength', amount: bonus });
            }
        }
    }

    // 3) Adjacent friendly cities: connected empires are stable.
    let adjacentFriendlyCities = 0;
    for (const [dx, dz] of ADJACENT_DIRS) {
        const neighbor = tiles.get(`${tile.x + dx},${tile.z + dz}`);
        if (neighbor && neighbor.terrain === 'CITY' && neighbor.owner === owner) {
            adjacentFriendlyCities++;
        }
    }
    if (adjacentFriendlyCities > 0) {
        const bonus = adjacentFriendlyCities * STABILITY_FACTORS.FRIENDLY_CITY_NEIGHBOR;
        unrest += bonus;
        stabReasons.push({ reason: 'friendly_cities', amount: bonus });
    }

    // 4) Siege duration: prolonged enemy presence destabilizes.
    const siegeTurns = tile.siegeTurns || 0;
    if (siegeTurns > 0) {
        const penalty = siegeTurns * STABILITY_FACTORS.SIEGE_DURATION_PENALTY;
        unrest += penalty;
        stabReasons.push({ reason: 'siege_duration', amount: penalty });
    }

    // 5) Consecutive peace: long peace stabilizes (max -10).
    const peaceTurns = tile.peaceTurns || 0;
    if (peaceTurns > 0) {
        const bonus = Math.max(-10, peaceTurns * STABILITY_FACTORS.CONSECUTIVE_PEACE_BONUS);
        unrest += bonus;
        stabReasons.push({ reason: 'peace', amount: bonus });
    }

    // 6) Walls stability bonus (separate from the decay above — this represents
    //    the ongoing deterrent effect of fortifications).
    if (tileBuildings.includes('WALLS')) {
        unrest += STABILITY_FACTORS.FORTIFICATION_BONUS;
        stabReasons.push({ reason: 'walls_stability', amount: STABILITY_FACTORS.FORTIFICATION_BONUS });
    }

    // 7) Governor presence: a lord governing adds stability (stacks with the
    //    GOVERNOR decay above).
    if (governor) {
        unrest += STABILITY_FACTORS.GOVERNOR_PRESENCE;
        stabReasons.push({ reason: 'governor_stability', amount: STABILITY_FACTORS.GOVERNOR_PRESENCE });
    }

    for (const r of stabReasons) reasons.push(r);

    // Clamp 0-100.
    unrest = Math.max(0, Math.min(100, unrest));
    return { amount: unrest, reasons };
}

/** Apply a city's unrest penalty to a faction's resource pool (mutates
 *  `resources`). Returns log messages. Only the city's contribution should be
 *  in `resources` when called per-city; when called with the faction pool the
 *  penalty is an aggregate approximation (the turn manager calls it per-city
 *  with that city's freshly-collected yields). */
export function applyUnrestEffects(tile, resources) {
    const messages = [];
    const unrest = tile.unrest || 0;
    let penalty = 0;
    if (unrest >= UNREST_THRESHOLDS.HIGH) penalty = 0.75;
    else if (unrest >= UNREST_THRESHOLDS.MEDIUM) penalty = 0.50;
    else if (unrest >= UNREST_THRESHOLDS.LOW) penalty = 0.25;
    if (penalty <= 0) return messages;

    for (const res of ['gold', 'food', 'wood', 'iron', 'production']) {
        const loss = Math.floor((resources[res] || 0) * penalty);
        if (loss > 0) {
            resources[res] = (resources[res] || 0) - loss;
            messages.push(`${tile.cityName || 'City'}: unrest caused -${loss} ${res}.`);
        }
    }
    return messages;
}

/** Process unrest for all cities of a faction. Updates `tile.unrest` and
 *  `tile.unrestReasons` on each city and returns rebellion events.
 *  @returns {{ messages: string[], rebellions: Array<{cityKey: string, newOwner: string|null}> }} */
export function processUnrest(tiles, owner, units, lords, currentTurn, buildings, resources = null) {
    const messages = [];
    const rebellions = [];

    for (const [key, tile] of tiles) {
        if (tile.owner !== owner || tile.terrain !== 'CITY') continue;

        // Track peace/siege duration for stability bonuses/penalties. A city
        // is "under siege" if any enemy unit is within Chebyshev 2; otherwise
        // it accumulates peace turns.
        let underSiege = false;
        for (const u of units.values()) {
            if (u.owner === owner) continue;
            if (Math.max(Math.abs(u.x - tile.x), Math.abs(u.z - tile.z)) <= 2) { underSiege = true; break; }
        }
        if (underSiege) {
            tile.siegeTurns = (tile.siegeTurns || 0) + 1;
            tile.peaceTurns = 0;
        } else {
            tile.peaceTurns = (tile.peaceTurns || 0) + 1;
            tile.siegeTurns = 0;
        }

        const { amount, reasons } = calculateUnrest(tiles, key, owner, units, lords, currentTurn, buildings, resources);
        tile.unrest = amount;
        tile.unrestReasons = reasons;

        if (amount >= UNREST_THRESHOLDS.REBELLION) {
            // At maximum unrest a city has a chance per turn to flip.
            if (Math.random() < UNREST_REBEL_CHANCE) {
                const oldOwner = tile.owner;
                const newOwner = findHighestInfluenceOwner(tiles, owner, tile);
                tile.owner = newOwner;
                tile.unrest = Math.floor(UNREST_INCREASE_RATES.CAPTURE_INITIAL / 2);
                tile.lastConqueredTurn = currentTurn;
                // When a city goes independent, its surrounding territory must
                // go independent too — otherwise the map shows orphaned tiles
                // still owned by the deposed faction (visual corruption and
                // incorrect ownership state). If a rival claimant wins the
                // city, only tiles still held by the old owner flip to them
                // (matching captureCityTerritory's behavior).
                if (newOwner !== oldOwner) {
                    const r = cityRadius(tile);
                    for (let dx = -r; dx <= r; dx++) {
                        for (let dz = -r; dz <= r; dz++) {
                            const t = tiles.get(`${tile.x + dx},${tile.z + dz}`);
                            if (!t || t === tile) continue;
                            if (t.owner !== oldOwner) continue;
                            if (newOwner) {
                                t.owner = newOwner;
                            } else {
                                t.owner = null;
                            }
                            t.loyalty = newOwner ? 3 : 0;
                        }
                    }
                }
                rebellions.push({ cityKey: key, newOwner });
                const name = tile.cityName || `City at [${tile.x}, ${tile.z}]`;
                messages.push(`${name} has rebelled! ${newOwner ? `Now controlled by ${newOwner}.` : 'Independent!'}`);
            }
        }
    }

    return { messages, rebellions };
}

/** Apply a faction-wide unrest yield penalty to the resource pool (mutates
 *  `resources`). Uses the MEAN penalty fraction across the faction's cities so
 *  multi-city empires aren't double-penalized (calling `applyUnrestEffects`
 *  once per city would compound, taking 75% of the remaining pool each time).
 *  Returns log messages. */
export function applyFactionUnrest(tiles, owner, resources) {
    const messages = [];
    let totalPenalty = 0;
    let cityCount = 0;
    for (const tile of tiles.values()) {
        if (tile.owner !== owner || tile.terrain !== 'CITY') continue;
        const u = tile.unrest || 0;
        let penalty = 0;
        if (u >= UNREST_THRESHOLDS.HIGH) penalty = 0.75;
        else if (u >= UNREST_THRESHOLDS.MEDIUM) penalty = 0.50;
        else if (u >= UNREST_THRESHOLDS.LOW) penalty = 0.25;
        totalPenalty += penalty;
        cityCount++;
    }
    if (cityCount === 0 || totalPenalty === 0) return messages;
    const avg = totalPenalty / cityCount;
    for (const res of ['gold', 'food', 'wood', 'iron', 'production']) {
        const loss = Math.floor((resources[res] || 0) * avg);
        if (loss > 0) {
            resources[res] = (resources[res] || 0) - loss;
        }
    }
    if (avg > 0) {
        messages.push(`Unrest across ${cityCount} cit${cityCount === 1 ? 'y' : 'ies'} cost ~${Math.round(avg * 100)}% of yields.`);
    }
    return messages;
}