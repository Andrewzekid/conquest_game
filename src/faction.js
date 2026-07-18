/** Faction definitions: each playable faction has a unique roster, unit
 *  flavor, a passive playstyle bonus, and a king with an active ability.
 *  Internal slots (player/ai1/...) are bound to one of these defs at game start. */
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
    }
};

export const FACTION_IDS = Object.keys(FACTION_DEFS);

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