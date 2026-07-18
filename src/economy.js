/** Economy system: resource production, upkeep, trade, market, taxation. */
import { TERRAIN, MARKET_RATES, TRADE_ROUTE_GOLD, STARVATION_ATTRITION, BUILDING_TYPE,
         CITY_GROWTH_BASE, CITY_GROWTH_PER_SURPLUS_FOOD, CITY_GROWTH_SURPLUS_CAP,
         CITY_MAX_LEVEL, cityGrowthThreshold } from './config.js';
import { getLordGovernanceMultiplier } from './lords.js';
import { cityRadius, expandCityTerritory } from './map.js';

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
 */
export function collectResources(tiles, owner, resources, buildings, lords, factionDef) {
    const messages = [];

    const cities = [];
    for (const t of tiles.values()) {
        if (t.owner === owner && t.terrain === 'CITY') cities.push(t);
    }

    // Determine which non-city owned tiles each city "works" (nearest first).
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

    // City tiles: gold + production (level-scaled), plus base gold yield.
    for (const tile of cities) {
        const tileKey = `${tile.x},${tile.z}`;
        const terrainData = TERRAIN[tile.terrain] || TERRAIN.CITY;
        const cl = tile.cityLevel || 1;
        let gold = (terrainData.amount || 0) + (cl - 1) * 2;
        const governor = lords.find(l => l.owner === owner && l.governingCity === tileKey);
        if (governor) gold = Math.floor(gold * getLordGovernanceMultiplier(governor));
        resources.gold = (resources.gold || 0) + gold;
        resources.production = (resources.production || 0) + 2 * cl;
        // Cities are population centers: they produce a little food (hinterland
        // foraging) and wood (timber yards) by default, scaling weakly with level.
        // Food is intentionally scarce — farms and fertile terrain matter.
        resources.food = (resources.food || 0) + 1 + Math.floor(cl / 2);
        resources.wood = (resources.wood || 0) + 1 + cl;
        // City buildings (MARKET/BARRACKS/WALLS/HARBOR) on the city tile.
        applyBuildingBonuses(tileKey, tile, buildings, resources);
    }

    // Worked non-city tiles: terrain base yield + building bonuses.
    for (const key of worked) {
        const tile = tiles.get(key);
        if (!tile) continue;
        const terrainData = TERRAIN[tile.terrain] || TERRAIN.PLAINS;
        const resType = terrainData.resource;
        let amount = terrainData.amount || 0;
        // Building bonuses that boost THIS tile's resource add to the yield;
        // other bonuses (e.g. MARKET gold) are applied as flat income below.
        const tileBuildings = buildings.get(key) || [];
        for (const bType of tileBuildings) {
            const bData = BUILDING_TYPE[bType];
            if (bData && bData.bonus) {
                for (const [res, bonus] of Object.entries(bData.bonus)) {
                    if (res === resType) amount += bonus;
                    else resources[res] = (resources[res] || 0) + bonus;
                }
            }
        }
        if (resType) resources[resType] = (resources[resType] || 0) + amount;
    }

    // Faction passive: flat food per turn (e.g. Verdant Realm).
    if (factionDef && factionDef.passive && factionDef.passive.foodPerTurn) {
        resources.food = (resources.food || 0) + factionDef.passive.foodPerTurn;
    }

    // Natural Wonders: each owned tile with a wonder grants its bonus to its
    // owner — so capturing a city whose territory contains a wonder pays off.
    for (const tile of tiles.values()) {
        if (tile.owner === owner && tile.wonder && tile.wonder.bonus) {
            for (const [res, amt] of Object.entries(tile.wonder.bonus)) {
                resources[res] = (resources[res] || 0) + amt;
            }
        }
    }

    return messages;
}

/** Apply non-yield building bonuses (gold/production/defense) for buildings on
 *  a city tile (MARKET, BARRACKS, WALLS, HARBOR). */
function applyBuildingBonuses(tileKey, tile, buildings, resources) {
    const tileBuildings = buildings.get(tileKey) || [];
    const terrainData = TERRAIN[tile.terrain] || TERRAIN.CITY;
    const resType = terrainData.resource;
    for (const bType of tileBuildings) {
        const bData = BUILDING_TYPE[bType];
        if (!bData || !bData.bonus) continue;
        for (const [res, bonus] of Object.entries(bData.bonus)) {
            // Defense bonuses aren't resources; skip (handled in combat).
            if (res === 'defense') continue;
            if (res === resType) {
                // Adds to base yield — fold into gold below as a flat add.
                resources[res] = (resources[res] || 0) + bonus;
            } else {
                resources[res] = (resources[res] || 0) + bonus;
            }
        }
    }
}

/**
 * Process unit upkeep: every unit costs gold + food per turn; some special
 * units also cost wood and/or iron. Starvation (negative food) attritions units.
 * Returns { starved: boolean, messages: [] }
 */
export function processUpkeep(units, owner, resources) {
    const messages = [];
    const totals = { food: 0, gold: 0, wood: 0, iron: 0 };

    for (const unit of units.values()) {
        if (unit.owner !== owner) continue;
        const upkeep = unit.upkeep || { food: 2, gold: 1 };
        for (const res of ['food', 'gold', 'wood', 'iron']) {
            totals[res] += upkeep[res] || 0;
        }
    }

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
 * Establish a trade route between two owned cities.
 * Each turn, generates TRADE_ROUTE_GOLD for the owner.
 */
export function getTradeRouteIncome(tiles, owner, tradeRoutes) {
    let total = 0;
    for (const route of tradeRoutes) {
        if (route.owner !== owner) continue;
        const t1 = tiles.get(route.from);
        const t2 = tiles.get(route.to);
        if (t1 && t2 && t1.owner === owner && t2.owner === owner) {
            total += TRADE_ROUTE_GOLD;
        }
    }
    return total;
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