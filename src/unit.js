/** Unit factory & validation helpers (pure logic) */
import { UNIT_TYPE, UNIT_COST, CAPTURE_COST, UNIT_XP_PER_KILL, UNIT_XP_PER_LEVEL } from './config.js';
import { getUnitStatsFor, getPassiveCombat, getFactionDef, getOpenTerrainMoveBonus } from './faction.js';

// "Open" terrain: no forest/mountain/hills cover — flat ground where cavalry
// and mobile formations ride farther. Used by the Polish open-terrain move bonus.
const OPEN_TERRAINS = new Set(['PLAINS', 'DESERT', 'TUNDRA']);

let _uid = 0;
function nextId() { return ++_uid; }

/** Create a new unit object.
 *  opts.veteran: starting level — boolean true → Lv.2 (legacy Barracks), or a
 *    number 1-4 for upgraded Barracks/Harbor veteran levels.
 *  opts.factionDef: apply faction unit mods + passive combat bonus. */
export function createUnit(type, owner, x, z, opts = {}) {
    const stats = UNIT_TYPE[type];
    if (!stats) throw new Error(`Unknown unit type: ${type}`);
    const def = opts.factionDef || null;
    const fstats = getUnitStatsFor(type, def);
    const passive = getPassiveCombat(def);
    let level = 1;
    if (typeof opts.veteran === 'number') level = Math.max(1, Math.min(4, opts.veteran));
    else if (opts.veteran) level = 2;
    const maxHp = fstats.hp + (level - 1) * 3;
    return {
        id: nextId(),
        type,
        level,
        xp: 0,
        hp: maxHp,
        maxHp,
        attack: fstats.attack + (level - 1) + passive.attack,
        defense: fstats.defense + (level - 1) + passive.defense,
        moveRange: fstats.moveRange,
        vision: stats.vision || null,
        owner,
        x, z,
        upkeep: { ...stats.upkeep },
        hasMovedThisTurn: false,
        hasAttackedThisTurn: false,
        lordId: null,  // lord leading this unit, if any
        goal: null,    // auto-navigation destination {x,z}, or null
        // Faction def id (serializable string) so pure combat code (battle.js)
        // can read faction passives without a factionDefs map being threaded
        // through every resolveCombat call site. Backfilled on save load.
        factionId: def ? def.id : null
    };
}

/** Award XP to a unit; level up raises HP/ATK/DEF. Returns log messages. */
export function awardUnitXP(unit, amount = UNIT_XP_PER_KILL) {
    if (!unit) return [];
    unit.xp += amount;
    const messages = [];
    while (unit.xp >= UNIT_XP_PER_LEVEL * unit.level) {
        unit.xp -= UNIT_XP_PER_LEVEL * unit.level;
        unit.level++;
        unit.maxHp += 3;
        unit.hp = Math.min(unit.hp + 3, unit.maxHp); // heal a bit on level-up
        unit.attack += 1;
        unit.defense += 1;
        messages.push(`Unit #${unit.id} (${unit.type}) reached Lv.${unit.level}!`);
    }
    return messages;
}

/** Effective attack/defense for a unit (level-scaled, replaces raw stats). */
export function getUnitStats(unit) {
    const base = UNIT_TYPE[unit.type];
    return {
        attack: unit.attack ?? base.attack,
        defense: unit.defense ?? base.defense,
        hp: unit.hp,
        maxHp: unit.maxHp
    };
}

/** Check if player can afford to train this unit (resources + production). */
export function canAfford(type, resources, costOverride = null) {
    const cost = costOverride || UNIT_COST[type];
    if (!cost) return false;
    return (resources.gold >= (cost.gold || 0)) &&
           (resources.food >= (cost.food || 0)) &&
           (resources.wood >= (cost.wood || 0)) &&
           (resources.iron >= (cost.iron || 0)) &&
           (resources.production >= (cost.production || 0));
}

/** Deduct cost and return remaining resources. */
export function spendCost(type, resources, costOverride = null) {
    const cost = costOverride || UNIT_COST[type];
    return {
        gold:       resources.gold - (cost.gold || 0),
        food:       resources.food - (cost.food || 0),
        wood:       resources.wood - (cost.wood || 0),
        iron:       resources.iron - (cost.iron || 0),
        production: resources.production - (cost.production || 0)
    };
}

/** Check if unit can capture an unowned tile */
export function canCapture(resources) {
    return resources.gold >= CAPTURE_COST;
}

/**
 * Get all units at a specific position.
 */
export function getUnitsAt(units, x, z) {
    const result = [];
    for (const unit of units.values()) {
        if (unit.x === x && unit.z === z) result.push(unit);
    }
    return result;
}

/**
 * Check if a tile is occupied by an enemy unit (for blocking movement).
 */
export function isEnemyAt(units, x, z, owner) {
    for (const unit of units.values()) {
        if (unit.x === x && unit.z === z && unit.owner !== owner) return true;
    }
    return false;
}

/**
 * Get the move range for a unit. Prefers the faction-modded `unit.moveRange`
 * (baked in at creation — includes faction move bonuses like Golden cavalry +1,
 * Storm naval +1, Polish cavalry +1) so those bonuses actually take effect;
 * falls back to the base UNIT_TYPE move range.
 */
export function getMoveRange(unit) {
    if (unit && unit.moveRange != null) return unit.moveRange;
    return UNIT_TYPE[unit.type]?.moveRange || 1;
}

/**
 * Calculate reachable tiles for a unit (Manhattan distance, no pathfinding).
 * Returns Set of tile keys.
 */
export function getReachableTiles(unit, tiles) {
    let range = getMoveRange(unit);
    // Polish Winged Hussars passive: all units gain +1 move on open terrain.
    const here = tiles && tiles.get(`${unit.x},${unit.z}`);
    if (here && OPEN_TERRAINS.has(here.terrain)) {
        range += getOpenTerrainMoveBonus(getFactionDef(unit.factionId));
    }
    const def = UNIT_TYPE[unit.type];
    const naval = !!(def && def.naval);
    const result = new Set();
    for (let dx = -range; dx <= range; dx++) {
        for (let dz = -range; dz <= range; dz++) {
            if (dx === 0 && dz === 0) continue;
            if (Math.abs(dx) + Math.abs(dz) > range) continue;
            const k = `${unit.x + dx},${unit.z + dz}`;
            const t = tiles.get(k);
            if (!t) continue;
            if (naval) {
                // Ships sail on water and rivers (bridges are irrelevant to them).
                if (t.terrain !== 'WATER' && t.terrain !== 'RIVER') continue;
            } else {
                // Rivers (without a bridge) and water are impassable for land units.
                if (t.terrain === 'WATER') continue;
                if (t.terrain === 'RIVER' && !t.bridge) continue;
            }
            result.add(k);
        }
    }
    return result;
}

/**
 * Get enemy units within attack range of `unit`. Range is per-type:
 * `attackRange` if defined (Longbowman/Galley = 3, Archer/Siege/Artillery = 2),
 * else 2 for ranged units and 1 for melee. Cargo/embarked units don't attack.
 */
export function getAttackTargets(unit, units) {
    const targets = [];
    if (!unit || unit.boarded) return targets;
    const def = UNIT_TYPE[unit.type];
    const range = (def && def.attackRange) || (def && def.ranged ? 2 : 1);
    for (const other of units.values()) {
        if (other.owner === unit.owner) continue;
        if (other.boarded) continue; // can't attack units stowed aboard a transport
        const dist = Math.abs(other.x - unit.x) + Math.abs(other.z - unit.z);
        if (dist <= range) targets.push(other);
    }
    return targets;
}

// === SPECIAL UNIT ABILITY HELPERS ===

/**
 * Count adjacent friendly MUSKETEER units for volley fire bonus.
 * MUSKETEER gets +1 attack per adjacent friendly MUSKETEER.
 */
export function countAdjacentMusketters(unit, units) {
    if (!unit || unit.type !== 'MUSKETEER') return 0;
    let count = 0;
    for (const other of units.values()) {
        if (other.owner !== unit.owner) continue;
        if (other.type !== 'MUSKETEER') continue;
        if (other.id === unit.id) continue;
        const dist = Math.abs(other.x - unit.x) + Math.abs(other.z - unit.z);
        if (dist === 1) count++;
    }
    return count;
}

/**
 * Check if a MUSKETEER has fired this turn (for slow reload on ARQUEBUSIER).
 */
export function hasFiredThisTurn(unit) {
    return unit && unit.hasAttackedThisTurn;
}

/**
 * Count adjacent friendly infantry units for LINE_INFANTRY formation bonus.
 * LINE_INFANTRY gets +2 defense when 2+ friendly infantry are adjacent.
 */
export function countAdjacentInfantry(unit, units) {
    if (!unit || unit.type !== 'LINE_INFANTRY') return 0;
    const infantryTypes = new Set(['INFANTRY', 'LINE_INFANTRY', 'RIFLEMAN', 'MUSKETEER']);
    let count = 0;
    for (const other of units.values()) {
        if (other.owner !== unit.owner) continue;
        if (!infantryTypes.has(other.type)) continue;
        if (other.id === unit.id) continue;
        const dist = Math.abs(other.x - unit.x) + Math.abs(other.z - unit.z);
        if (dist === 1) count++;
    }
    return count;
}

/**
 * Check if a unit can attack twice this turn (FIELD_GUN rapid fire).
 */
export function canRapidFire(unit) {
    return unit && unit.type === 'FIELD_GUN' && !unit.hasAttackedThisTurn;
}

/**
 * Check if a unit must reload after firing (RAILGUN devastating).
 */
export function mustReload(unit) {
    if (!unit || unit.type !== 'RAILGUN') return false;
    return unit.reloadTurns > 0;
}

/**
 * Check if a unit can move and fire same turn (ARMORED_TRAIN mobile).
 */
export function canMoveAndFire(unit) {
    return unit && unit.type === 'ARMORED_TRAIN';
}

/**
 * Check if a unit ignores defense (RIFLEMAN accurate).
 */
export function ignoresDefense(unit) {
    return unit && unit.type === 'RIFLEMAN';
}

/**
 * Get bonus damage vs lords (SHARPSHOOTER sniper).
 */
export function getSniperBonus(unit, target) {
    if (!unit || unit.type !== 'SHARPSHOOTER') return 0;
    if (!target) return 0;
    // Bonus vs lords or high-value targets
    if (target.lordId || target.type === 'SETTLER' || target.type === 'ENGINEER') {
        return 3;
    }
    return 0;
}

/**
 * Get demolition bonus vs cities/buildings (DEMOLITION_SQUAD).
 */
export function getDemolishBonus(unit) {
    if (!unit || unit.type !== 'DEMOLITION_SQUAD') return 0;
    return 5;
}

/**
 * Check if unit destroys fortifications in 2 hits (SIEGE_CANNON fortBuster).
 */
export function isFortBuster(unit) {
    return unit && unit.type === 'SIEGE_CANNON';
}

/**
 * Get flagship bonus for adjacent naval units (MAN_OF_WAR).
 */
export function getFlagshipBonus(unit) {
    if (!unit || unit.type !== 'MAN_OF_WAR') return 0;
    return 1;
}

/**
 * Check if unit is immune to wind penalties (GALLEASS oared, STEAM_TRANSPORT steamPowered).
 */
export function isWindImmune(unit) {
    if (!unit) return false;
    return unit.type === 'GALLEASS' || unit.type === 'STEAM_TRANSPORT';
}

/**
 * Check if unit can enter shallow waters/rivers (GUNBOAT shallowDraft).
 */
export function canEnterShallowWaters(unit) {
    return unit && unit.type === 'GUNBOAT';
}

/**
 * Check if unit is stealthy when submerged (SUBMARINE).
 */
export function isStealthy(unit) {
    return unit && unit.type === 'SUBMARINE' && unit.submerged;
}

/**
 * Get torpedo bonus vs ships (TORPEDO_BOAT).
 */
export function getTorpedoBonus(unit, target) {
    if (!unit || unit.type !== 'TORPEDO_BOAT') return 0;
    if (!target || !UNIT_TYPE[target.type]?.naval) return 0;
    return 8;
}

/**
 * Check if unit takes reduced ranged damage (IRONCLAD armored).
 */
export function hasArmored(unit) {
    return unit && unit.type === 'IRONCLAD';
}

/**
 * Check if unit takes 1 less damage from all sources (IRONCLAD_FRIGATE heavyArmor).
 */
export function hasHeavyArmor(unit) {
    return unit && unit.type === 'IRONCLAD_FRIGATE';
}

/**
 * Check if unit has no firing direction penalty (MONITOR turret).
 */
export function hasTurret(unit) {
    return unit && unit.type === 'MONITOR';
}

/**
 * Get trade bonus for MERCHANTMAN.
 */
export function getTradeBonus(unit) {
    if (!unit || unit.type !== 'MERCHANTMAN') return 0;
    return 10;
}