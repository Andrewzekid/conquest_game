/** Faction definitions: each playable faction has a unique roster, unit
 *  flavor, a passive playstyle bonus, and a king with an active ability.
 *  Internal slots (player/ai1/...) are bound to one of these defs at game start.
 *  Phase F: Added 5 new factions (golden, iron, shadow, storm, frost) with
 *  unique mechanics for up to 10-player games. */
import { UNIT_TYPE, UNIT_COST } from './config.js';

export const FACTION_DEFS = {
    crimson: {
        id: 'crimson', name: 'Crimson Legion', emoji: '\u{1F525}',
        color: { tile: 0x9c2a2a, unit: 0xff5544, name: 'Crimson Legion' },
        aiPersonality: 'AGGRESSIVE',
        roster: ['INFANTRY', 'CAVALRY', 'PIKEMAN', 'SIEGE'],
        unitMods: {
            CAVALRY: { attack: 1, hp: 2, costGoldMult: 0.75 },
            INFANTRY: { attack: 1 }
        },
        passive: { attackBonus: 1, desc: '+1 attack to all your units. Cavalry +2 HP.' },
        king: { name: 'Warlord Kael', class: 'WARLORD',
                active: { id: 'bloodlust', name: 'Bloodlust', cooldown: 4,
                          desc: '+5 attack to all your units for the rest of this turn.' } }
    },
    verdant: {
        id: 'verdant', name: 'Verdant Realm', emoji: '\u{1F33F}',
        color: { tile: 0x2f7a3a, unit: 0x88dd44, name: 'Verdant Realm' },
        aiPersonality: 'ECONOMIC',
        roster: ['INFANTRY', 'ARCHER', 'SCOUT'],
        unitMods: {
            ARCHER: { attack: 1, hp: 2 }
        },
        passive: { foodPerTurn: 8, healInForest: 2, desc: '+8 food every turn. Units heal +2 HP/turn in forest.' },
        king: { name: 'Druid Lyra', class: 'GUARDIAN',
                active: { id: 'harvest', name: 'Harvest', cooldown: 4,
                          desc: 'Instantly gain +40 food and +20 gold.' } }
    },
    violet: {
        id: 'violet', name: 'Violet Order', emoji: '\u{1F52E}',
        color: { tile: 0x6a2fa0, unit: 0xcc66ff, name: 'Violet Order' },
        aiPersonality: 'ECONOMIC',
        roster: ['INFANTRY', 'ARCHER', 'ARTILLERY', 'SIEGE'],
        unitMods: {
            ARTILLERY: { attack: 2, hp: 2 },
            ARCHER: { attack: 1 }
        },
        passive: { visionBonus: 2, scoutMoveBonus: 1, rangedAttackBonus: 1, desc: '+2 vision radius. Scouts +1 move. Ranged units deal +1 damage.' },
        king: { name: 'Archmage Magnus', class: 'CONQUEROR',
                active: { id: 'scry', name: 'Arcane Surge', cooldown: 5,
                          desc: 'Reveal every enemy city on the map for 1 turn. All your ranged and siege units gain +2 attack this turn.' } }
    },
    azure: {
        id: 'azure', name: 'Azure Dominion', emoji: '\u{1F6E1}\uFE0F',
        color: { tile: 0x234c9c, unit: 0x4488ff, name: 'Azure Dominion' },
        aiPersonality: 'DEFENSIVE',
        roster: ['INFANTRY', 'PIKEMAN', 'ARCHER', 'ARTILLERY'],
        unitMods: {
            INFANTRY: { defense: 2, hp: 4 }
        },
        passive: { defenseBonus: 1, kingRegen: 3, desc: '+1 defense to all your units. King regenerates +3 HP/turn in any own city (instead of +5 only in capital).' },
        king: { name: 'Marshal Edmund', class: 'GUARDIAN',
                active: { id: 'bulwark', name: 'Bulwark', cooldown: 4,
                          desc: '+2 defense to all your units for the rest of this turn.' } }
    },
    obsidian: {
        id: 'obsidian', name: 'Obsidian Pact', emoji: '\u{1F480}',
        color: { tile: 0x101012, unit: 0x5a5a66, name: 'Obsidian Pact' },
        aiPersonality: 'AGGRESSIVE',
        roster: ['INFANTRY', 'CAVALRY', 'SIEGE', 'SCOUT'],
        unitMods: {
            INFANTRY: { attack: 1 },
            SCOUT: { attack: 0 }
        },
        passive: { respawnOnKill: true, respawnChance: 0.12, unitCostReduction: 0.1,
                   desc: '12% chance to revive a fallen unit when one of your units destroys an enemy. All units cost 10% less gold.' },
        king: { name: 'Necromancer Vex', class: 'WARLORD',
                active: { id: 'raise', name: 'Raise Dead', cooldown: 4,
                          desc: 'Revive your most recently fallen unit at the capital.' } }
    },
    // --- New Factions (Phase F) ---
    golden: {
        id: 'golden', name: 'Golden Horde', emoji: '\u{1F40E}',
        color: { tile: 0xc9a028, unit: 0xffd700, name: 'Golden Horde' },
        aiPersonality: 'AGGRESSIVE',
        roster: ['INFANTRY', 'CAVALRY', 'SCOUT', 'ARCHER'],
        unitMods: {
            CAVALRY: { attack: 2, hp: 2, costGoldMult: 0.7 },
            SCOUT: { attack: 1, hp: 1 }
        },
        passive: { cavalryMoveBonus: 1, raidingGoldBonus: 15, desc: 'Cavalry units cost 30% less, +1 move, +2 HP. Raiding/pillaging gives +15 gold.' },
        king: { name: 'Khan Temujin', class: 'WARLORD',
                active: { id: 'stampede', name: 'Stampede', cooldown: 4,
                          desc: 'All cavalry units charge this turn (free charge attacks on adjacent enemies, +2 bonus damage).' } }
    },
    iron: {
        id: 'iron', name: 'Iron Empire', emoji: '\u2699\uFE0F',
        color: { tile: 0x4a4a5a, unit: 0x8888aa, name: 'Iron Empire' },
        aiPersonality: 'DEFENSIVE',
        roster: ['INFANTRY', 'PIKEMAN', 'ARTILLERY', 'SIEGE'],
        unitMods: {
            SIEGE: { attack: 2, hp: 2, costGoldMult: 0.75 },
            ARTILLERY: { attack: 1, hp: 2 },
            INFANTRY: { defense: 1 }
        },
        passive: { siegePowerBonus: 2, fortificationBonus: 1, desc: '+2 siege power for all siege units. Siege units cost 25% less. Cities start with +1 fortification.' },
        king: { name: 'Engineer-General Torvald', class: 'CONQUEROR', mobilized: true,
                active: { id: 'ironwill', name: 'Iron Will', cooldown: 5,
                          desc: 'All your cities gain +3 fortification; siege units gain +3 attack this turn.' } }
    },
    shadow: {
        id: 'shadow', name: 'Shadow Court', emoji: '\u{1F31D}',
        color: { tile: 0x2a1a3a, unit: 0x6a4a8a, name: 'Shadow Court' },
        aiPersonality: 'ECONOMIC',
        roster: ['INFANTRY', 'ARCHER', 'SCOUT', 'LONGBOWMAN'],
        unitMods: {
            SCOUT: { attack: 1, hp: 2 },
            LONGBOWMAN: { attack: 1, hp: 1 },
            ARCHER: { attack: 1 }
        },
        passive: { freeConcealTurns: 1, forestMoveBonus: 1, ambushBonus: 2, desc: 'Units start with 1 concealment turn done (faster ambushes). Units +1 move in forest. Concealed units deal +2 attack when revealing.' },
        king: { name: 'Spymaster Nyx', class: 'GUARDIAN',
                active: { id: 'vanish', name: 'Vanish', cooldown: 4,
                          desc: 'All your units on forest/mountain tiles become concealed and gain +2 attack on their next attack.' } }
    },
    storm: {
        id: 'storm', name: 'Storm Kingdom', emoji: '\u26A1',
        color: { tile: 0x1a4a6a, unit: 0x44aadd, name: 'Storm Kingdom' },
        aiPersonality: 'AGGRESSIVE',
        roster: ['INFANTRY', 'ARCHER', 'CAVALRY', 'GALLEY'],
        unitMods: {
            GALLEY: { attack: 2, hp: 2 },
            CAVALRY: { attack: 1 },
            INFANTRY: { hp: 2 }
        },
        passive: { navalAttackBonus: 2, navalMoveBonus: 1, coastalAttackBonus: 1, desc: 'Naval units +2 attack, +1 move range. Units gain +1 attack when adjacent to water.' },
        king: { name: 'Admiral Thora', class: 'WARLORD',
                active: { id: 'tempest', name: 'Tempest', cooldown: 4,
                          desc: 'Deal 2 damage to all enemy units within 2 tiles of any of your units. Your units gain +1 attack this turn.' } }
    },
    frost: {
        id: 'frost', name: 'Frost Clan', emoji: '\u2744\uFE0F',
        color: { tile: 0x5a8aaa, unit: 0xaaddff, name: 'Frost Clan' },
        aiPersonality: 'DEFENSIVE',
        roster: ['INFANTRY', 'PIKEMAN', 'ARCHER', 'SCOUT'],
        unitMods: {
            PIKEMAN: { defense: 2, hp: 2 },
            ARCHER: { hp: 2 }
        },
        passive: { terrainDefenseBonus: { FOREST: 2, TUNDRA: 2, MOUNTAIN: 2 }, kingRegen: 4,
                   desc: '+2 defense in forest, tundra, and mountain terrain. King regenerates +4 HP/turn in any own city.' },
        king: { name: 'Jarl Sigrid', class: 'GUARDIAN',
                active: { id: 'wintersgrasp', name: "Winter's Grasp", cooldown: 4,
                          desc: 'Freeze all enemy units within 3 tiles of your king (they cannot move next turn).' } }
    },
    // --- New European Factions (Phase G) ---
    roman: {
        id: 'roman', name: 'Roman Legion', emoji: '\u{1F3DB}\uFE0F',
        color: { tile: 0x6a1b4a, unit: 0x993366, name: 'Roman Legion' },
        aiPersonality: 'AGGRESSIVE',
        roster: ['INFANTRY', 'PIKEMAN', 'SIEGE', 'LEGIONNAIRE'],
        unitMods: {
            INFANTRY: { defense: 1, hp: 2, moveRange: 1 },
            LEGIONNAIRE: { defense: 1, costGoldMult: 0.75 },
            SIEGE: { costGoldMult: 0.85 }
        },
        passive: { attackBonus: 1, cityCaptureBonus: 1, desc: '+1 attack to all units. +1 damage when capturing cities. Infantry +1 move range.' },
        king: { name: 'Consul Marcus', class: 'WARLORD',
                active: { id: 'discipline', name: 'Discipline', cooldown: 5,
                          desc: '+2 attack and +1 defense to all units for the rest of this turn.' } }
    },
    viking: {
        id: 'viking', name: 'Viking Raiders', emoji: '\u2694\uFE0F',
        color: { tile: 0x4a6a8a, unit: 0x88bbdd, name: 'Viking Raiders' },
        aiPersonality: 'AGGRESSIVE',
        roster: ['INFANTRY', 'CAVALRY', 'SCOUT', 'BERSERKER'],
        unitMods: {
            INFANTRY: { attack: 1, hp: 2 },
            BERSERKER: { attack: 1, hp: 2, costGoldMult: 0.75 },
            SCOUT: { attack: 1 }
        },
        passive: { healOnKill: 3, raidingGoldBonus: 15, navalMoveBonus: 1, desc: 'Units heal 3 HP on kill. Raiding/pillaging gives +15 gold. Naval units +1 move.' },
        king: { name: 'Jarl Ragnar', class: 'WARLORD',
                active: { id: 'berserker_rage', name: 'Berserker Rage', cooldown: 4,
                          desc: 'All BERSERKER and INFANTRY units gain +3 attack and lifesteal (heal 50% of damage dealt) this turn.' } }
    },
    byzantine: {
        id: 'byzantine', name: 'Byzantine Empire', emoji: '\u{1F985}',
        color: { tile: 0x7b2d8b, unit: 0xaa55cc, name: 'Byzantine Empire' },
        aiPersonality: 'DEFENSIVE',
        roster: ['INFANTRY', 'ARCHER', 'CAVALRY', 'VARANGIAN_GUARD'],
        unitMods: {
            CAVALRY: { defense: 2, hp: 2 },
            VARANGIAN_GUARD: { defense: 1, hp: 2, costGoldMult: 0.75 },
            ARCHER: { attack: 1 }
        },
        passive: { diplomacyBonus: 10, fortifiedDefenseBonus: 2, kingRegen: 2, desc: '+10 starting reputation. Fortified units +2 defense. King regenerates +2 HP/turn in own cities.' },
        king: { name: 'Emperor Constantine', class: 'GUARDIAN',
                active: { id: 'golden_gate', name: 'Golden Gate', cooldown: 6,
                          desc: 'All cities gain +3 fortification. All units heal 50% of missing HP.' } }
    },
    spanish: {
        id: 'spanish', name: 'Spanish Conquistadors', emoji: '\u{1F5E1}\uFE0F',
        color: { tile: 0xd4581f, unit: 0xff7722, name: 'Spanish Conquistadors' },
        aiPersonality: 'AGGRESSIVE',
        roster: ['INFANTRY', 'CAVALRY', 'ARCHER', 'CONQUISTADOR'],
        unitMods: {
            CONQUISTADOR: { attack: 1, hp: 2, costGoldMult: 0.75 },
            CAVALRY: { attack: 1 },
            INFANTRY: { defense: 1 }
        },
        passive: { settlerCostReduction: 0.3, goldPerConquest: 25, desc: 'Settlers cost 30% less. Gain 25 gold when conquering a city.' },
        king: { name: 'King Ferdinand', class: 'CONQUEROR',
                active: { id: 'manifest_destiny', name: 'Manifest Destiny', cooldown: 4,
                          desc: 'All CONQUISTADOR units gain +2 move and double attack range this turn. Each city spawns a free Conquistador if you have fewer than 3 cities.' } }
    },
    polish: {
        id: 'polish', name: 'Polish Winged Hussars', emoji: '\u{1F40E}',
        color: { tile: 0x909098, unit: 0xc8c8d0, name: 'Polish Winged Hussars' },
        aiPersonality: 'AGGRESSIVE',
        roster: ['INFANTRY', 'PIKEMAN', 'CAVALRY', 'WINGED_HUSSAR'],
        unitMods: {
            WINGED_HUSSAR: { attack: 2, hp: 2, moveRange: 1, costGoldMult: 0.75 },
            CAVALRY: { attack: 1, moveRange: 1, hp: 1 },
            PIKEMAN: { defense: 1 }
        },
        passive: { cavalryChargeBonus: 2, openTerrainMoveBonus: 1, desc: 'Cavalry charge deals +2 bonus damage. All units gain +1 move on open terrain.' },
        king: { name: 'King Jan Sobieski', class: 'WARLORD',
                active: { id: 'winged_charge', name: 'Winged Charge', cooldown: 3,
                          desc: 'All cavalry and WINGED_HUSSAR units charge this turn (free charge attacks on adjacent enemies, +3 bonus damage).' } }
    },
    // --- Phase H: Cultural factions ---
    ming: {
        id: 'ming', name: 'Ming Dynasty', emoji: '\u{1F409}',
        color: { tile: 0x8a1c1c, unit: 0xd4af37, name: 'Ming Dynasty' },
        aiPersonality: 'DEFENSIVE',
        roster: ['INFANTRY', 'ARCHER', 'PIKEMAN', 'TIGER_CANNON'],
        unitMods: {
            TIGER_CANNON: { attack: 1, hp: 2, costGoldMult: 0.8 },
            INFANTRY: { defense: 1 }
        },
        passive: { siegePowerBonus: 2, defenseBonus: 1,
                   desc: '+2 siege power for all siege units. +1 defense to all units.' },
        king: { name: 'Emperor Yongle', class: 'CONQUEROR',
                active: { id: 'heavenly_mandate', name: 'Heavenly Mandate', cooldown: 5,
                          desc: 'All ranged and siege units gain +3 attack and +1 range this turn.' } }
    },
    stone: {
        id: 'stone', name: 'Stone Titans', emoji: '\u{1F5FF}',
        color: { tile: 0x5a5a55, unit: 0x8a8a80, name: 'Stone Titans' },
        aiPersonality: 'DEFENSIVE',
        roster: ['INFANTRY', 'PIKEMAN', 'SIEGE', 'STONE_GUARD'],
        unitMods: {
            STONE_GUARD: { defense: 1, hp: 2, costGoldMult: 0.8 },
            INFANTRY: { defense: 1 }
        },
        passive: { terrainDefenseBonus: { HILLS: 2, MOUNTAIN: 2 }, fortifiedDefenseBonus: 2,
                   desc: '+2 defense on hills and mountains. Fortified units +2 defense.' },
        king: { name: 'Titan-King Granite', class: 'GUARDIAN',
                active: { id: 'earthquake', name: 'Earthquake', cooldown: 5,
                          desc: 'The ground shatters around the king, dealing 6 damage to all enemy units within 3 tiles.' } }
    },
    arcane: {
        id: 'arcane', name: 'Arcane College', emoji: '\u{1F52E}',
        color: { tile: 0x4a2080, unit: 0xa855f7, name: 'Arcane College' },
        aiPersonality: 'ECONOMIC',
        roster: ['INFANTRY', 'ARCHER', 'SCOUT', 'BATTLE_MAGE'],
        unitMods: {
            BATTLE_MAGE: { attack: 1, hp: 1, costGoldMult: 0.8 },
            ARCHER: { attack: 1 }
        },
        passive: { visionBonus: 1, attackBonus: 1,
                   desc: '+1 vision radius. +1 attack to all units.' },
        king: { name: 'Arch-Sorcerer Elara', class: 'CONQUEROR',
                active: { id: 'arcane_barrage', name: 'Arcane Barrage', cooldown: 5,
                          desc: 'Unleash a magical storm: deal 5 damage to all enemies within 2 tiles of the king and heal all friendly units within 2 tiles for 4 HP.' } }
    },
    lotus: {
        id: 'lotus', name: 'Shadow Lotus', emoji: '\u{1F338}',
        color: { tile: 0x1a1a20, unit: 0xd946ef, name: 'Shadow Lotus' },
        aiPersonality: 'AGGRESSIVE',
        roster: ['INFANTRY', 'ARCHER', 'SCOUT', 'SHINOBI'],
        unitMods: {
            SHINOBI: { attack: 1, moveRange: 1, costGoldMult: 0.8 },
            SCOUT: { attack: 1 }
        },
        passive: { freeConcealTurns: 1, forestMoveBonus: 1,
                   desc: 'Units start with 1 concealment turn done. +1 move in forest.' },
        king: { name: 'Lotus Master Kage', class: 'WARLORD',
                active: { id: 'shadow_strike', name: 'Shadow Strike', cooldown: 4,
                          desc: 'All concealed units gain +4 attack and may immediately make a free ambush attack on an adjacent enemy.' } }
    },
    sun: {
        id: 'sun', name: 'Sun Empire', emoji: '\u{2600}\uFE0F',
        color: { tile: 0xd4581f, unit: 0xffd700, name: 'Sun Empire' },
        aiPersonality: 'AGGRESSIVE',
        roster: ['INFANTRY', 'ARCHER', 'CAVALRY', 'JAGUAR_WARRIOR'],
        unitMods: {
            JAGUAR_WARRIOR: { attack: 1, hp: 2, costGoldMult: 0.8 },
            CAVALRY: { attack: 1 }
        },
        passive: { healOnKill: 2, forestMoveBonus: 1,
                   desc: 'Units heal 2 HP on kill. +1 move in forest.' },
        king: { name: 'Sun King Itzcoatl', class: 'WARLORD',
                active: { id: 'sacrifice', name: 'Sacrifice to the Sun', cooldown: 5,
                          desc: 'Deal 4 damage to all enemy units within 3 tiles of the king and heal all friendly units within 3 tiles for 5 HP.' } }
    }
};

export const FACTION_IDS = Object.keys(FACTION_DEFS);

// Map faction slot (ai1, ai2, etc.) to faction def id
// Cycles through available factions based on slot index. Includes frost
// (previously omitted) and the 5 new European factions.
const FACTION_SLOT_MAP = ['crimson', 'verdant', 'violet', 'azure', 'obsidian', 'golden', 'iron', 'shadow', 'storm', 'frost', 'roman', 'viking', 'byzantine', 'spanish', 'polish', 'ming', 'stone', 'arcane', 'lotus', 'sun'];

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
    // Spanish Conquistadors passive: settlers cost a fraction less. Applied
    // here (centralized) so both the player build menu and the AI training
    // path see the reduced cost.
    if (unitType === 'SETTLER' && def && def.passive && def.passive.settlerCostReduction && base.gold) {
        base.gold = Math.max(0, Math.floor(base.gold * (1 - def.passive.settlerCostReduction)));
    }
    // Obsidian Pact: all units cost 10% less gold (unitCostReduction passive).
    if (def && def.passive && def.passive.unitCostReduction && base.gold) {
        base.gold = Math.max(0, Math.floor(base.gold * (1 - def.passive.unitCostReduction)));
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
        if (mod.moveRange) out.moveRange += mod.moveRange;
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
    // Violet Order: scout move bonus (scouts and exploration units)
    if (def && def.passive && def.passive.scoutMoveBonus &&
        (unitType === 'SCOUT' || unitType === 'FRONTIERSMAN')) {
        out.moveRange += def.passive.scoutMoveBonus;
    }
    // Shadow Court: forest move bonus (applied as a base stat bump; the
    // terrain-specific bonus is also checked at move time in game.js)
    if (def && def.passive && def.passive.forestMoveBonus &&
        (unitType === 'SCOUT' || unitType === 'ARCHER' || unitType === 'LONGBOWMAN' || unitType === 'INFANTRY')) {
        out.moveRange += def.passive.forestMoveBonus;
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

// --- New European-faction passive helpers (Phase G) ---

/** Viking: HP healed whenever one of this faction's units destroys an enemy. */
export function getHealOnKill(def) {
    if (!def || !def.passive) return 0;
    return def.passive.healOnKill || 0;
}

/** Viking: bonus gold from raiding/pillaging. */
export function getRaidingGoldBonus(def) {
    if (!def || !def.passive) return 0;
    return def.passive.raidingGoldBonus || 0;
}

/** Byzantine: starting reputation bonus with all factions. */
export function getDiplomacyBonus(def) {
    if (!def || !def.passive) return 0;
    return def.passive.diplomacyBonus || 0;
}

/** Byzantine: defense bonus while fortified. */
export function getFortifiedDefenseBonus(def) {
    if (!def || !def.passive) return 0;
    return def.passive.fortifiedDefenseBonus || 0;
}

/** Spanish: gold granted when conquering a city. */
export function getGoldPerConquest(def) {
    if (!def || !def.passive) return 0;
    return def.passive.goldPerConquest || 0;
}

/** Spanish: settler cost reduction (0..0.9 fraction). */
export function getSettlerCostReduction(def) {
    if (!def || !def.passive) return 0;
    return def.passive.settlerCostReduction || 0;
}

/** Polish: extra charge damage for cavalry charges. */
export function getCavalryChargeBonus(def) {
    if (!def || !def.passive) return 0;
    return def.passive.cavalryChargeBonus || 0;
}

/** Polish: extra move range on open terrain (PLAINS/DESERT/TUNDRA). */
export function getOpenTerrainMoveBonus(def) {
    if (!def || !def.passive) return 0;
    return def.passive.openTerrainMoveBonus || 0;
}

/** Roman: bonus damage when attacking/capturing cities. */
export function getCityCaptureBonus(def) {
    if (!def || !def.passive) return 0;
    return def.passive.cityCaptureBonus || 0;
}