/** Lords system: hero units with stats, abilities, leveling, governance, army command. */
import { LORD_BASE_STATS, LORD_ABILITIES, LORD_XP_PER_KILL, LORD_XP_PER_LEVEL, LORD_RECRUIT_COST, LORD_CLASSES } from './config.js';

let _lordId = 0;
function nextLordId() { return ++_lordId; }

const LORD_NAMES = [
    'Aldric', 'Brenna', 'Cedric', 'Dara', 'Edmund', 'Fiona', 'Gareth',
    'Helena', 'Ivan', 'Jora', 'Kael', 'Lyra', 'Magnus', 'Nora', 'Orin',
    'Petra', 'Quinn', 'Ragnar', 'Sable', 'Thorin', 'Ursa', 'Vex', 'Wren', 'Yara'
];
const CLASS_KEYS = Object.keys(LORD_CLASSES);

/** Create a new lord. A class (archetype) is assigned at birth — it gives a
 *  passive army bonus and a unique icon. Lords are also combatants: they have
 *  HP and can fight directly (attack adjacent enemies and defend when struck). */
export function createLord(owner, x, z, name, classKey) {
    const cls = classKey && LORD_CLASSES[classKey] ? classKey : CLASS_KEYS[Math.floor(Math.random() * CLASS_KEYS.length)];
    const lord = {
        id: nextLordId(),
        name: name || LORD_NAMES[Math.floor(Math.random() * LORD_NAMES.length)],
        owner,
        x, z,
        level: 1,
        xp: 0,
        stats: { ...LORD_BASE_STATS },
        abilities: [],
        class: cls,
        governingCity: null,   // tileKey of city being governed, or null
        army: [],              // array of unit ids this lord commands
        hasMovedThisTurn: false,
        hasAttackedThisTurn: false, // lords can attack once per turn (like units)
        isKing: false
    };
    lord.maxHp = lordMaxHp(lord);
    lord.hp = lord.maxHp;
    return lord;
}

/** A lord's max HP: base 12 + 2/level, kings are much sturdier (they are the
 *  faction leader and their death is catastrophic). Kings get a large HP bonus
 *  (+38) so they can survive longer in battle and lead from the front (50 HP at level 1).
 *  Kings are guaranteed at least 50 max HP regardless of level. */
export function lordMaxHp(lord) {
    if (!lord) return 1;
    const base = 18 + (lord.level - 1) * 3 + (lord.isKing ? 42 : 0);
    return lord.isKing ? Math.max(55, base) : base;
}

/** A lord's own melee attack: combat stat + class bonus + king bonus. */
export function lordAttack(lord) {
    if (!lord) return 0;
    const cb = (LORD_CLASSES[lord.class] || {}).bonus || {};
    return (lord.stats.combat || 0) + (cb.attack || 0) + (lord.isKing ? 3 : 1);
}

/** A lord's own defense: command stat + class bonus + king bonus. */
export function lordDefense(lord) {
    if (!lord) return 0;
    const cb = (LORD_CLASSES[lord.class] || {}).bonus || {};
    return (lord.stats.command || 0) + (cb.defense || 0) + (lord.isKing ? 3 : 1);
}

/** Build a unit-like combatant for a lord so resolveCombat can fight it. The
 *  combatant shares the lord's hp (resolveCombat mutates hp/maxHp directly),
 *  so damage applied here is real. `type` is 'KING' or 'LORD' for messages. */
export function lordCombatant(lord) {
    if (!lord) return null;
    return {
        id: lord.id,
        _isLord: true,
        _lord: lord,
        type: lord.isKing ? 'KING' : 'LORD',
        name: lord.name,
        owner: lord.owner,
        x: lord.x,
        z: lord.z,
        hp: lord.hp,
        maxHp: lord.maxHp,
        attack: lordAttack(lord),
        // King's Guard: a king with bodyguard units in its army gets bonus defense.
        defense: lordDefense(lord) + kingGuardBonus(lord)
    };
}

/** Sync a lord combatant's hp back onto the lord object after combat. */
export function syncLordHp(combatant) {
    if (!combatant || !combatant._lord) return;
    combatant._lord.hp = combatant.hp;
    combatant._lord.maxHp = combatant.maxHp;
}

/** Award XP to a lord; level up if threshold reached. Returns log messages. */
export function awardXP(lord, amount) {
    lord.xp += amount;
    const messages = [];
    while (lord.xp >= LORD_XP_PER_LEVEL * lord.level) {
        lord.xp -= LORD_XP_PER_LEVEL * lord.level;
        lord.level++;
        // Stat increase: +1 to a random stat each level
        const stats = ['command', 'combat', 'governance'];
        const pick = stats[Math.floor(Math.random() * stats.length)];
        lord.stats[pick]++;
        // Lords grow sturdier with level (and heal a little on level-up).
        const newMax = lordMaxHp(lord);
        lord.hp = Math.min(newMax, (lord.hp || 0) + 4);
        lord.maxHp = newMax;
        messages.push(`${lord.name} reached level ${lord.level}! ${pick} +1`);
        // Unlock abilities
        for (const [key, ab] of Object.entries(LORD_ABILITIES)) {
            if (lord.level >= ab.unlockLevel && !lord.abilities.includes(key)) {
                lord.abilities.push(key);
                messages.push(`${lord.name} unlocked ability: ${ab.name}!`);
            }
        }
    }
    return messages;
}

/** Check if lord can be recruited (resources). */
export function canRecruitLord(resources) {
    return resources.gold >= LORD_RECRUIT_COST.gold && resources.food >= LORD_RECRUIT_COST.food;
}

/** Max units a lord can command: base 2 + command stat + class bonus. Kings
 *  command a larger royal guard (+3 base) so they can lead bigger armies and
 *  be protected by more bodyguard units. */
export function maxArmySize(lord) {
    if (!lord) return 0;
    const cls = LORD_CLASSES[lord.class] || {};
    let size = 2 + (lord.stats.command || 0);
    if (cls.bonus && cls.bonus.extraCommand) size += cls.bonus.extraCommand;
    if (lord.isKing) size += 3; // King's Guard: kings command 3 extra units
    return size;
}

/** King's Guard defense bonus: a king gets +1 defense for each unit in its
 *  army (its bodyguard), up to a cap. This makes a well-guarded king much
 *  harder to kill, encouraging players to keep units stacked with their king.
 *  Returns the bonus defense to add to the king's combatant defense. */
export function kingGuardBonus(lord) {
    if (!lord || !lord.isKing) return 0;
    const armySize = (lord.army || []).length;
    return Math.min(armySize, 5); // +1 def per army unit, max +5
}

/** Can this lord take another unit into its army? */
export function canCommand(lord) {
    return lord && lord.army.length < maxArmySize(lord);
}

/** Assign a unit to a lord's army (replaces the old single armyId). */
export function assignArmy(lord, unitId) {
    if (!lord) return;
    lord.armyId = unitId; // legacy field kept for UI compatibility
    if (!lord.army.includes(unitId)) lord.army.push(unitId);
    lord.governingCity = null;
}

/** Remove a unit from any lord's army (call on unit death/reassign). */
export function removeUnitFromArmies(lords, unitId) {
    if (!lords) return;
    for (const l of lords) {
        const i = l.army ? l.army.indexOf(unitId) : -1;
        if (i !== -1) l.army.splice(i, 1);
        if (l.armyId === unitId) l.armyId = null;
    }
}

/** Find the lord commanding a unit (army membership), else a lord on its tile. */
export function findCommandingLord(lords, unit) {
    if (!unit || !lords) return null;
    for (const l of lords) {
        if (l.owner === unit.owner && l.army && l.army.includes(unit.id)) return l;
    }
    for (const l of lords) {
        if (l.owner === unit.owner && l.x === unit.x && l.z === unit.z) return l;
    }
    return null;
}

/** Class bonus a lord grants to every unit in its army: { attack, defense, siege }. */
export function getLordClassBonus(lord) {
    if (!lord || !lord.class) return { attack: 0, defense: 0, siege: 0 };
    const b = (LORD_CLASSES[lord.class] || {}).bonus || {};
    return {
        attack: b.attack || 0,
        defense: b.defense || 0,
        siege: b.siege || 0
    };
}

/** Combat bonus a lord gives to its own unit (its command/combat stats). */
export function getLordCombatBonus(lord) {
    if (!lord) return { attack: 0, defense: 0 };
    return { attack: lord.stats.combat, defense: lord.stats.command };
}

/** Adjacency auras (Chebyshev radius 1): a lord's CLASS bonus (Warlord +atk,
 *  Guardian +def, Grand Commander +atk/+def) is an area-of-effect that boosts
 *  every friendly unit within 1 tile — plus RALLY (+atk) / TACTICIAN (+def)
 *  abilities for lords that have unlocked them. */
export function getAdjacentLordBonuses(lords, unit) {
    const out = { attack: 0, defense: 0 };
    if (!lords || !unit) return out;
    for (const l of lords) {
        if (l.owner !== unit.owner) continue;
        if (Math.max(Math.abs(l.x - unit.x), Math.abs(l.z - unit.z)) > 1) continue;
        // Class aura (radius-1 AoE).
        const cb = (LORD_CLASSES[l.class] || {}).bonus || {};
        if (cb.attack) out.attack += cb.attack;
        if (cb.defense) out.defense += cb.defense;
        // Ability auras.
        if (l.abilities.includes('RALLY')) out.attack += 2;
        if (l.abilities.includes('TACTICIAN')) out.defense += 1;
    }
    return out;
}

/** Does this lord project a visible AoE aura (class grants atk or def)? Used by
 *  the renderer to draw the radius-1 ring. */
export function hasLordAura(lord) {
    if (!lord || !lord.class) return false;
    const cb = (LORD_CLASSES[lord.class] || {}).bonus || {};
    return !!(cb.attack || cb.defense);
}

/** Get siege bonus for a lord attacking a city (SIEGE_MASTER ability). */
export function getLordSiegeBonus(lord) {
    if (!lord) return 0;
    return lord.abilities.includes('SIEGE_MASTER') ? 3 : 0;
}

/** Get governance yield multiplier for a city governed by this lord. */
export function getLordGovernanceMultiplier(lord) {
    if (!lord || !lord.governingCity) return 1.0;
    let mult = 1.0 + lord.stats.governance * 0.1;
    if (lord.abilities.includes('ADMINISTRATOR')) mult += 0.5;
    return mult;
}

/** Assign a lord to govern a city (it steps down from leading an army). */
export function assignGovernance(lord, tileKey) {
    lord.governingCity = tileKey;
}