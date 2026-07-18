/** Building system: construction, defensiveness, buildable list (pure logic). */
import { BUILDING_TYPE } from './config.js';

/** A city tile is coastal if any orthogonal neighbor is WATER or RIVER
 *  (Harbors must touch navigable water). */
export function isCoastal(tile, tiles) {
    if (!tile || !tiles) return false;
    for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
            if (Math.abs(dx) + Math.abs(dz) !== 1) continue; // orthogonal only
            const t = tiles.get(`${tile.x + dx},${tile.z + dz}`);
            if (t && (t.terrain === 'WATER' || t.terrain === 'RIVER')) return true;
        }
    }
    return false;
}

/**
 * Construct a building on a tile.
 * Validates influence + terrain + cost, deducts resources, and registers the
 * building in the buildings Map (Map<tileKey, buildingType[]>).
 *
 * @param buildingType - key into BUILDING_TYPE
 * @param tile - { x, z, terrain (key string), owner }
 * @param resources - faction resource pool (mutated)
 * @param buildings - Map<tileKey, buildingType[]> (mutated)
 * @param influence - optional Set of tile keys where building is allowed (city influence)
 * @param tiles - optional full tile Map (for the Harbor coastal check)
 * @returns messages array
 */
export function constructBuilding(buildingType, tile, resources, buildings, influence, tiles) {
    const messages = [];
    const bData = BUILDING_TYPE[buildingType];
    if (!bData) {
        messages.push(`Unknown building: ${buildingType}`);
        return messages;
    }

    const tileKey = `${tile.x},${tile.z}`;

    // City influence restriction (Civ 6 style)
    if (influence && !influence.has(tileKey)) {
        messages.push(`Cannot build ${bData.name} here: outside a city's area of influence.`);
        return messages;
    }

    // Terrain restriction
    if (tile.terrain !== bData.terrain) {
        messages.push(`Cannot build ${bData.name} here (needs ${bData.terrain} terrain).`);
        return messages;
    }

    // Harbor must be coastal (adjacent to water/river).
    if (buildingType === 'HARBOR' && !isCoastal(tile, tiles)) {
        messages.push(`Cannot build ${bData.name} here: city must touch water or a river.`);
        return messages;
    }

    // One of each type per tile
    const existing = buildings.get(tileKey) || [];
    if (existing.includes(buildingType)) {
        messages.push(`${bData.name} already built at [${tile.x}, ${tile.z}].`);
        return messages;
    }

    // Affordability
    for (const [res, amt] of Object.entries(bData.cost)) {
        if ((resources[res] || 0) < amt) {
            messages.push(`Cannot afford ${bData.name} (need ${amt} ${res}).`);
            return messages;
        }
    }

    // Deduct + register
    for (const [res, amt] of Object.entries(bData.cost)) {
        resources[res] = (resources[res] || 0) - amt;
    }
    existing.push(buildingType);
    buildings.set(tileKey, existing);
    messages.push(`Built ${bData.name} at [${tile.x}, ${tile.z}].`);

    return messages;
}

/**
 * Total defense bonus provided by buildings on a tile.
 * Currently only WALLS grants defense.
 */
export function getBuildingDefenseBonus(tileKey, buildings) {
    const list = buildings.get(tileKey) || [];
    let total = 0;
    for (const bType of list) {
        const bData = BUILDING_TYPE[bType];
        if (bData && bData.bonus && bData.bonus.defense) {
            total += bData.bonus.defense;
        }
    }
    return total;
}

/**
 * List buildings that can be considered for a tile, with influence + terrain + affordability gating.
 * Returns [{ type, name, cost, canBuild, reason }] for UI buttons.
 *
 * @param influence - optional Set of tile keys within a city's area of influence.
 * @param tiles - optional full tile Map (for the Harbor coastal check)
 */
export function getBuildableBuildings(tile, resources, buildings, influence, tiles) {
    const tileKey = `${tile.x},${tile.z}`;
    const existing = buildings.get(tileKey) || [];
    const inInfluence = !influence || influence.has(tileKey);
    const result = [];

    for (const [type, bData] of Object.entries(BUILDING_TYPE)) {
        let canBuild = true;
        let reason = '';

        if (!inInfluence) {
            canBuild = false;
            reason = 'Outside city influence';
        } else if (tile.terrain !== bData.terrain) {
            canBuild = false;
            reason = `Needs ${bData.terrain} terrain`;
        } else if (type === 'HARBOR' && !isCoastal(tile, tiles)) {
            canBuild = false;
            reason = 'City not coastal';
        } else if (existing.includes(type)) {
            canBuild = false;
            reason = 'Already built';
        } else {
            for (const [res, amt] of Object.entries(bData.cost)) {
                if ((resources[res] || 0) < amt) {
                    canBuild = false;
                    reason = `Need ${amt} ${res}`;
                    break;
                }
            }
        }

        result.push({ type, name: bData.name, cost: bData.cost, canBuild, reason });
    }

    return result;
}