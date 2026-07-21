/** Building system: construction, defensiveness, buildable list (pure logic). */
import { BUILDING_TYPE, PILLAGEABLE_BUILDINGS, MILITARY_BUILDING_HP, MILITARY_BUILDING_DEFENSE, BUILDING_MAX_LEVEL, MILITARY_BUILDING_LEVELS } from './config.js';

/** A tile is buildable for an influence-buildable military building if it is
 *  passable land inside influence (not water/mountain/river). City-tile
 *  buildings keep their terrain requirement. */
export function isInfluenceBuildableTile(buildingType, tile) {
    const bData = BUILDING_TYPE[buildingType];
    if (!bData || !bData.influenceBuildable) return false;
    if (!tile) return false;
    if (tile.terrain === 'WATER' || tile.terrain === 'MOUNTAIN' || tile.terrain === 'RIVER') return false;
    return true;
}

/** Default building state for a freshly built structure (level 1, full hp). */
export function defaultBuildingState(buildingType) {
    const maxHp = MILITARY_BUILDING_HP[buildingType] || 0;
    return { level: 1, hp: maxHp, maxHp };
}

/** Look up (or lazily create) the state for a tile+building pair. */
export function getBuildingState(buildingState, tileKey, buildingType) {
    if (!buildingState) return defaultBuildingState(buildingType);
    const key = `${tileKey}:${buildingType}`;
    let st = buildingState.get(key);
    if (!st) { st = defaultBuildingState(buildingType); buildingState.set(key, st); }
    return st;
}

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
export function constructBuilding(buildingType, tile, resources, buildings, influence, tiles, buildingState) {
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

    // Terrain restriction. Military buildings flagged influenceBuildable relax
    // the strict city-tile requirement to any passable land tile in influence.
    const useInfluenceTile = bData.influenceBuildable && isInfluenceBuildableTile(buildingType, tile);
    if (!useInfluenceTile && tile.terrain !== bData.terrain) {
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

    // CITADEL requires WALLS to be present (it upgrades Walls)
    if (buildingType === 'CITADEL' && !existing.includes('WALLS')) {
        messages.push(`Cannot build ${bData.name}: requires Walls to be built first.`);
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
    if (buildingState && MILITARY_BUILDING_HP[buildingType] != null) {
        buildingState.set(`${tileKey}:${buildingType}`, defaultBuildingState(buildingType));
    }
    messages.push(`Built ${bData.name} at [${tile.x}, ${tile.z}].`);

    return messages;
}

/** List the pillageable terrain improvements present on a tile (FARM/LUMBERMILL/MINE). */
export function pillageableOn(tile, buildings) {
    if (!tile) return [];
    const list = buildings.get(`${tile.x},${tile.z}`) || [];
    return list.filter(b => PILLAGEABLE_BUILDINGS.includes(b));
}

/** Remove one pillageable improvement from a tile (the first match). Returns
 *  the building type removed, or null if there was nothing to pillage. Also
 *  clears any stored structure state for that tile+building. */
export function removeBuilding(tile, buildings, buildingState) {
    if (!tile) return null;
    const key = `${tile.x},${tile.z}`;
    const list = buildings.get(key) || [];
    const idx = list.findIndex(b => PILLAGEABLE_BUILDINGS.includes(b));
    if (idx < 0) return null;
    const [removed] = list.splice(idx, 1);
    if (list.length) buildings.set(key, list); else buildings.delete(key);
    if (buildingState) buildingState.delete(`${key}:${removed}`);
    return removed;
}

/** Clear ALL building entries on a tile (used when a tile flips ownership / is
 *  captured). Military structures are dismantled; returns the removed types. */
export function clearBuildingsOnTile(tile, buildings, buildingState) {
    if (!tile) return [];
    const key = `${tile.x},${tile.z}`;
    const list = buildings.get(key) || [];
    if (buildingState) {
        for (const b of list) buildingState.delete(`${key}:${b}`);
    }
    const removed = [...list];
    buildings.delete(key);
    return removed;
}

/** Defense bonus a friendly military structure gives to units standing on its
 *  tile (only the owning faction benefits). */
export function getMilitaryBuildingDefenseBonus(tileKey, buildings) {
    const list = buildings.get(tileKey) || [];
    let total = 0;
    for (const b of list) {
        if (MILITARY_BUILDING_DEFENSE[b] != null) total += MILITARY_BUILDING_DEFENSE[b];
    }
    return total;
}

/** Deal damage to a military structure's hp. Returns true if destroyed. */
export function damageBuilding(tileKey, buildingType, amount, buildingState) {
    if (!buildingState) return false;
    const key = `${tileKey}:${buildingType}`;
    const st = buildingState.get(key);
    if (!st) return false;
    st.hp -= amount;
    if (st.hp <= 0) {
        buildingState.delete(key);
        return true;
    }
    return false;
}

/** Attempt to upgrade a military building on a tile. Validates level < max and
 *  affordability, deducts the upgrade cost, bumps the level and restores hp.
 *  Returns a message string. */
export function upgradeBuilding(buildingType, tile, resources, buildings, buildingState) {
    const bData = BUILDING_TYPE[buildingType];
    if (!bData || !bData.military) return `Cannot upgrade ${buildingType}.`;
    const tileKey = `${tile.x},${tile.z}`;
    const existing = buildings.get(tileKey) || [];
    if (!existing.includes(buildingType)) return `${bData.name} is not built here.`;
    const levels = MILITARY_BUILDING_LEVELS[buildingType];
    if (!levels) return `${bData.name} cannot be upgraded.`;
    const st = getBuildingState(buildingState, tileKey, buildingType);
    if (st.level >= BUILDING_MAX_LEVEL) return `${bData.name} is already at max level.`;
    const next = levels[st.level]; // next.index == current level (0-based)
    if (!next || !next.upgradeCost) return `${bData.name} cannot be upgraded further.`;
    for (const [res, amt] of Object.entries(next.upgradeCost)) {
        if ((resources[res] || 0) < amt) return `Cannot afford ${bData.name} upgrade (need ${amt} ${res}).`;
    }
    for (const [res, amt] of Object.entries(next.upgradeCost)) {
        resources[res] = (resources[res] || 0) - amt;
    }
    st.level += 1;
    st.maxHp = MILITARY_BUILDING_HP[buildingType];
    st.hp = st.maxHp;
    return `Upgraded ${bData.name} to level ${st.level} at [${tile.x}, ${tile.z}].`;
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
        } else if (bData.influenceBuildable) {
            if (!isInfluenceBuildableTile(type, tile)) {
                canBuild = false;
                reason = 'Needs passable land in influence';
            } else if (type === 'HARBOR' && !isCoastal(tile, tiles)) {
                canBuild = false;
                reason = 'Must be coastal';
            }
        } else if (tile.terrain !== bData.terrain) {
            canBuild = false;
            reason = `Needs ${bData.terrain} terrain`;
        } else if (type === 'HARBOR' && !isCoastal(tile, tiles)) {
            canBuild = false;
            reason = 'City not coastal';
        }
        if (canBuild && existing.includes(type)) {
            canBuild = false;
            reason = 'Already built';
        }
        if (canBuild) {
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