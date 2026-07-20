/** Faction definitions: each playable faction has a unique roster, unit
 *  flavor, a passive playstyle bonus, and a king with an active ability.
 *  Internal slots (player/ai1/...) are bound to one of these defs at game start.
 *  Phase F: Added 5 new factions (golden, iron, shadow, storm, frost) with
 *  unique mechanics for up to 10-player games. */
import { UNIT_TYPE, UNIT_COST } from './config.js';

export const FACTION_DEFS = {
    crimson: {
        id: 'crimson', name: 'Crimson Legion', emoji: '🔥',
        color: { tile: 0x9c2a2a, unit: 0xff5544, name: 'Crimson Legion' },
        aiPersonality: 'AGGRESSIVE',
        roster: ['INFANTRY', 'CAVALRY', 'PIKEMAN', 'SIEGE'],
        unitMods: {
            CAVALRY: { attack: 1, costGoldMult: 0.75 },
            INFANTRY: { attack: 1 }
        },
        passive: { attackBonus: 1, desc: '+1 attack to all your units.' },
        king: { name: 'Warlord Kael', class: 'WARLORD',
                active: { id: 'bloodlust', name: 'Bloodlust', cooldown: 4,
                          desc: '+3 attack to all your units for the rest of this turn.' } }
    },
    verdant: {
        id: 'verdant', name: 'Verdant Realm', emoji: '🌿',
        color: { tile: 0x2f7a3a, unit: 0x88dd44, name: 'Verdant Realm' },
        aiPersonality: 'ECONOMIC',
        roster: ['INFANTRY', 'ARCHER', 'SCOUT'],
        unitMods: {
            ARCHER: { attack: 1, hp: 2 }
        },
        passive: { foodPerTurn: 15, desc: '+15 food every turn.' },
        king: { name: 'Druid Lyra', class: 'GUARDIAN',
                active: { id: 'harvest', name: 'Harvest', cooldown: 3,
                          desc: 'Instantly gain +80 food and +40 gold.' } }
    },
    violet: {
        id: 'violet', name: 'Violet Order', emoji: '🔮',
        color: { tile: 0x6a2fa0, unit: 0xcc66ff, name: 'Violet Order' },
        aiPersonality: 'ECONOMIC',
        roster: ['INFANTRY', 'ARCHER', 'ARTILLERY', 'SIEGE'],
        unitMods: {
            ARTILLERY: { attack: 2 }
        },
        passive: { visionBonus: 2, desc: '+2 vision radius for your units and lords.' },
        king: { name: 'Archmage Magnus', class: 'CONQUEROR',
                active: { id: 'scry', name: 'Scry', cooldown: 5,
                          desc: 'Reveal every enemy city on the map for 1 turn.' } }
    },
    azure: {
        id: 'azure', name: 'Azure Dominion', emoji: '🛡️',
        color: { tile: 0x234c9c, unit: 0x4488ff, name: 'Azure Dominion' },
        aiPersonality: 'DEFENSIVE',
        roster: ['INFANTRY', 'PIKEMAN', 'ARCHER', 'ARTILLERY'],
        unitMods: {
            INFANTRY: { defense: 2, hp: 4 }
        },
        passive: { defenseBonus: 1, desc: '+1 defense to all your units.' },
        king: { name: 'Marshal Edmund', class: 'GUARDIAN',
                active: { id: 'bulwark', name: 'Bulwark', cooldown: 4,
                          desc: '+3 defense to all your units for the rest of this turn.' } }
    },
    obsidian: {
        id: 'obsidian', name: 'Obsidian Pact', emoji: '💀',
        color: { tile: 0x101012, unit: 0x5a5a66, name: 'Obsidian Pact' },
        aiPersonality: 'AGGRESSIVE',
        roster: ['INFANTRY', 'CAVALRY', 'SIEGE', 'SCOUT'],
        unitMods: {
            INFANTRY: { attack: 1 },
            SCOUT: { attack: 0 }
        },
        passive: { respawnOnKill: true, respawnChance: 0.15,
                   desc: '15% chance to revive a fallen unit whenever one of your units destroys an enemy.' },
        king: { name: 'Necromancer Vex', class: 'WARLORD',
                active: { id: 'raise', name: 'Raise Dead', cooldown: 4,
                          desc: 'Revive your most recently fallen unit at the capital.' } }
    },
    // --- New Factions (Phase F) ---
    golden: {
        id: 'golden', name: 'Golden Horde', emoji: '🐎',
        color: { tile: 0xc9a028, unit: 0xffd700, name: 'Golden Horde' },
        aiPersonality: 'AGGRESSIVE',
        roster: ['INFANTRY', 'CAVALRY', 'SCOUT', 'ARCHER'],
        unitMods: {
            CAVALRY: { attack: 2, hp: 2, costGoldMult: 0.7 },
            SCOUT: { attack: 1 }
        },
        passive: { cavalryMoveBonus: 1, desc: 'Cavalry units cost 30% less and have +1 move range.' },
        king: { name: 'Khan Temujin', class: 'WARLORD',
                active: { id: 'stampede', name: 'Stampede', cooldown: 4,
                          desc: 'All cavalry units charge this turn (free charge attacks on adjacent enemies).' } }
    },
    iron: {
        id: 'iron', name: 'Iron Empire', emoji: '⚙️',
        color: { tile: 0x4a4a5a, unit: 0x8888aa, name: 'Iron Empire' },
        aiPersonality: 'DEFENSIVE',
        roster: ['INFANTRY', 'PIKEMAN', 'ARTILLERY', 'SIEGE'],
        unitMods: {
            SIEGE: { attack: 2, costGoldMult: 0.75 },
            ARTILLERY: { attack: 1, hp: 2 }
        },
        passive: { siegePowerBonus: 2, desc: '+2 siege power for all siege units. Siege units cost 25% less.' },
        king: { name: 'Engineer-General Torvald', class: 'CONQUEROR',
                active: { id: 'ironwill', name: 'Iron Will', cooldown: 5,
                          desc: 'All your cities instantly gain +5 fortification.' } }
    },
    shadow: {
        id: 'shadow', name: 'Shadow Court', emoji: '🌑',
        color: { tile: 0x2a1a3a, unit: 0x6a4a8a, name: 'Shadow Court' },
        aiPersonality: 'ECONOMIC',
        roster: ['INFANTRY', 'ARCHER', 'SCOUT', 'LONGBOWMAN'],
        unitMods: {
            SCOUT: { attack: 1, hp: 2 },
            LONGBOWMAN: { attack: 1 }
        },
        passive: { freeConcealTurns: 1, desc: 'Units start with 1 concealment turn already done (faster ambushes).' },
        king: { name: 'Spymaster Nyx', class: 'GUARDIAN',
                active: { id: 'vanish', name: 'Vanish', cooldown: 4,
                          desc: 'All your units on forest/mountain tiles become immediately concealed.' } }
    },
    storm: {
        id: 'storm', name: 'Storm Kingdom', emoji: '⚡',
        color: { tile: 0x1a4a6a, unit: 0x44aadd, name: 'Storm Kingdom' },
        aiPersonality: 'AGGRESSIVE',
        roster: ['INFANTRY', 'ARCHER', 'CAVALRY', 'GALLEY'],
        unitMods: {
            GALLEY: { attack: 2, hp: 2 },
            CAVALRY: { attack: 1 }
        },
        passive: { navalAttackBonus: 2, navalMoveBonus: 1, desc: 'Naval units +2 attack, +1 move range.' },
        king: { name: 'Admiral Thora', class: 'WARLORD',
                active: { id: 'tempest', name: 'Tempest', cooldown: 4,
                          desc: 'Deal 3 damage to all enemy units within 2 tiles of any of your units.' } }
    },
    frost: {
        id: 'frost', name: 'Frost Clan', emoji: '❄️',
        color: { tile: 0x5a8aaa, unit: 0xaaddff, name: 'Frost Clan' },
        aiPersonality: 'DEFENSIVE',
        roster: ['INFANTRY', 'PIKEMAN', 'ARCHER', 'SCOUT'],
        unitMods: {
            PIKEMAN: { defense: 2, hp: 2 },
            ARCHER: { hp: 2 }
        },
        passive: { terrainDefenseBonus: { FOREST: 2, TUNDRA: 2, MOUNTAIN: 2 },
                   desc: '+2 defense in forest, tundra, and mountain terrain.' },
        king: { name: 'Jarl Sigrid', class: 'GUARDIAN',
                active: { id: 'wintersgrasp', name: "Winter's Grasp", cooldown: 5,
                          desc: 'Freeze all enemy units within 3 tiles of your king (they cannot move next turn).' } }
    }
};

export const FACTION_IDS = Object.keys(FACTION_DEFS);

// Map faction slot (ai1, ai2, etc.) to faction def id
// Cycles through available factions based on slot index
const FACTION_SLOT_MAP = ['crimson', 'verdant', 'violet', 'azure', 'obsidian', 'golden', 'iron', 'shadow', 'storm'];

export function getFactionForSlot(slotIndex) {
    return FACTION_SLOT_MAP[slotIndex % FACTION_SLOT_MAP.length];
}

export function getFactionDef(id) {
    return FACTION_DEFS[id] || null;
}

/** Cost for a unit type for a given faction (applies costGoldMult). */
export function getUnitCostFor(unitType, def) {
    const base = { ...UNIT_COST[unitType] };
    if (!base) return base;
    const mod = def && def.unitMods && def.unitMods[unitType];
    if (mod && mod.costGoldMult && base.gold) {
        base.gold = Math.floor(base.gold * mod.costGoldMult);
    }
    return base;
}

/** Base stats for a unit type for a given faction (applies stat mods). Returns
 *  { hp, attack, defense, moveRange } with faction flavor baked in. */
export function getUnitStatsFor(unitType, def) {
    const base = UNIT_TYPE[unitType];
    const out = { hp: base.hp, attack: base.attack, defense: base.defense, moveRange: base.moveRange };
    const mod = def && def.unitMods && def.unitMods[unitType];
    if (mod) {
        if (mod.attack) out.attack += mod.attack;
        if (mod.defense) out.defense += mod.defense;
        if (mod.hp) out.hp += mod.hp;
    }
    // Golden Horde: cavalry move bonus
    if (def && def.id === 'golden' && def.passive.cavalryMoveBonus &&
        (unitType === 'CAVALRY' || unitType === 'CATAPHRACT')) {
        out.moveRange += def.passive.cavalryMoveBonus;
    }
    // Storm Kingdom: naval move bonus
    if (def && def.id === 'storm' && def.passive.navalMoveBonus && base.naval) {
        out.moveRange += def.passive.navalMoveBonus;
    }
    return out;
}

/** Faction combat passive baked into every unit: { attack, defense }. */
export function getPassiveCombat(def) {
    if (!def || !def.passive) return { attack: 0, defense: 0 };
    return {
        attack: def.passive.attackBonus || 0,
        defense: def.passive.defenseBonus || 0
    };
}

/** Vision radius for a faction's units/lords (base 3 + visionBonus). */
export function getFactionVision(def) {
    return 3 + ((def && def.passive && def.passive.visionBonus) || 0);
}

/** Get terrain-specific defense bonus for a faction (Frost Clan). */
export function getTerrainDefenseBonus(def, terrain) {
    if (!def || !def.passive || !def.passive.terrainDefenseBonus) return 0;
    return def.passive.terrainDefenseBonus[terrain] || 0;
}

/** Get siege power bonus for a faction (Iron Empire). */
export function getSiegePowerBonus(def) {
    if (!def || !def.passive) return 0;
    return def.passive.siegePowerBonus || 0;
}

/** Get naval attack bonus for a faction (Storm Kingdom). */
export function getNavalAttackBonus(def) {
    if (!def || !def.passive) return 0;
    return def.passive.navalAttackBonus || 0;
}

/** Check if a faction has free concealment turns (Shadow Court). */
export function getFreeConcealTurns(def) {
    if (!def || !def.passive) return 0;
    return def.passive.freeConcealTurns || 0;
}