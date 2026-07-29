/** Economy intelligence module for the AI. Analyses city output, resource
 *  scarcity, and trade opportunities to guide building and spending decisions.
 *  Pure functions — no game-state side effects.
 */

import { BUILDING_TYPE } from './config.js';

/** Evaluate the economic health of a city and suggest improvements.
 *
 *  @param {object} city - city tile { x, z, owner, cityLevel, terrain }
 *  @param {Map} buildings - buildings map (keyed by "x,z")
 *  @param {object} resources - faction resources { gold, food, wood, iron }
 *  @param {Array} ownedTiles - all tiles owned by this faction
 *  @returns {{ score, suggestions: Array<{ buildingType, reason, priority }> }}
 */
export function evaluateCityEconomy(city, buildings, resources, ownedTiles) {
    const key = `${city.x},${city.z}`;
    const cityBuildings = buildings.get(key) || [];
    const suggestions = [];
    let score = 50; // baseline

    // Check for market: gold income is critical.
    if (!cityBuildings.includes('MARKET')) {
        suggestions.push({
            buildingType: 'MARKET',
            reason: 'No market — gold income bottleneck',
            priority: 'high',
        });
        score -= 20;
    }

    // Check for granary: food production for growth.
    if (!cityBuildings.includes('GRANARY') && (city.cityLevel || 1) >= 2) {
        suggestions.push({
            buildingType: 'GRANARY',
            reason: 'No granary at level 2+ city',
            priority: 'medium',
        });
        score -= 10;
    }

    // Check for warehouse: resource cap for stockpiling.
    const hasWarehouse = cityBuildings.includes('WAREHOUSE');
    if (!hasWarehouse && (resources.wood || 0) > 60) {
        suggestions.push({
            buildingType: 'WAREHOUSE',
            reason: 'Resource stockpile near cap',
            priority: 'low',
        });
        score -= 5;
    }

    // Trade route bonus: cities near water benefit from harbor.
    const nearWater = ownedTiles.some(t =>
        Math.abs(t.x - city.x) <= 2 && Math.abs(t.z - city.z) <= 2 && t.terrain === 'WATER');
    if (nearWater && !cityBuildings.includes('HARBOR')) {
        suggestions.push({
            buildingType: 'HARBOR',
            reason: 'Near water — harbor for trade income',
            priority: 'medium',
        });
        score -= 8;
    }

    // Military buildings when at war or threatened.
    if (!cityBuildings.includes('BARRACKS') && !cityBuildings.includes('ARCHERY_RANGE')) {
        suggestions.push({
            buildingType: 'BARRACKS',
            reason: 'No military training facility',
            priority: 'medium',
        });
        score -= 5;
    }

    return { score: Math.max(0, Math.min(100, score)), suggestions };
}

/** Compute trade route value between two cities.
 *
 *  @param {object} cityA - first city tile
 *  @param {object} cityB - second city tile
 *  @param {string} resType - resource type being traded
 *  @param {number} distance - Manhattan distance between cities
 *  @returns {{ value, profit, viable }}
 */
export function computeTradeRouteValue(cityA, cityB, resType, distance) {
    // Trade value decreases with distance (transport costs) and depends on
    // resource type. Food is cheap, iron is expensive.
    const baseValues = { food: 2, wood: 3, iron: 5, gold: 1 };
    const base = baseValues[resType] || 1;
    // Profit margin: base value minus distance penalty (1 gold per 3 tiles).
    const transportCost = Math.ceil(distance / 3);
    const profit = Math.max(0, base - transportCost);
    const viable = profit > 0 && distance <= 15;
    return { value: base, profit, viable };
}

/** Evaluate whether the faction should sell resources at market.
 *
 *  @param {object} resources - { gold, food, wood, iron }
 *  @param {number} goldThreshold - sell when gold is below this
 *  @param {number} surplusThreshold - only sell when resource is above this
 *  @returns {{ shouldSell: boolean, sales: Array<{ resource, amount, reason }> }}
 */
export function evaluateMarketSales(resources, goldThreshold = 30, surplusThreshold = 50) {
    const sales = [];
    if ((resources.gold || 0) >= goldThreshold) {
        return { shouldSell: false, sales: [] };
    }
    for (const res of ['iron', 'wood', 'food']) {
        if ((resources[res] || 0) > surplusThreshold) {
            const amount = Math.min(resources[res] - surplusThreshold, 30);
            sales.push({
                resource: res,
                amount,
                reason: `Gold low (${resources.gold || 0}), selling surplus ${res}`,
            });
        }
    }
    return { shouldSell: sales.length > 0, sales };
}

/** Suggest city specialization based on terrain and position.
 *
 *  @param {object} city - city tile
 *  @param {Array} surroundingTiles - tiles within influence radius
 *  @param {Map} buildings - current buildings
 *  @returns {{ specialization, reason, focusTiles }}
 */
export function suggestCitySpecialization(city, surroundingTiles, buildings) {
    const key = `${city.x},${city.z}`;
    const existing = buildings.get(key) || [];
    // Count terrain types in influence.
    const terrainCounts = {};
    for (const t of surroundingTiles) {
        terrainCounts[t.terrain] = (terrainCounts[t.terrain] || 0) + 1;
    }
    const hasForest = (terrainCounts.FOREST || 0) >= 3;
    const hasHills = (terrainCounts.HILLS || 0) >= 2;
    const nearWater = (terrainCounts.WATER || 0) >= 1;
    const hasPlains = (terrainCounts.PLAINS || 0) >= 3;

    if (hasForest && !existing.includes('LUMBER_MILL')) {
        return {
            specialization: 'production',
            reason: 'Forest-heavy terrain — lumber mill focus',
            focusTiles: surroundingTiles.filter(t => t.terrain === 'FOREST'),
        };
    }
    if (hasHills && !existing.includes('MINE')) {
        return {
            specialization: 'mining',
            reason: 'Hilly terrain — mine for iron',
            focusTiles: surroundingTiles.filter(t => t.terrain === 'HILLS'),
        };
    }
    if (nearWater && !existing.includes('HARBOR')) {
        return {
            specialization: 'trade',
            reason: 'Coastal position — harbor for trade',
            focusTiles: surroundingTiles.filter(t => t.terrain === 'WATER'),
        };
    }
    if (hasPlains) {
        return {
            specialization: 'agriculture',
            reason: 'Flat fertile land — farm focus',
            focusTiles: surroundingTiles.filter(t => t.terrain === 'PLAINS'),
        };
    }
    return {
        specialization: 'balanced',
        reason: 'Mixed terrain — balanced approach',
        focusTiles: [],
    };
}
