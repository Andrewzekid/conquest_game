/** Technology tree: era-gated research that unlocks units, buildings, and bonuses.
 *  All functions are pure — they operate on a techState object passed in. */

import { AI_ARTILLERY_TECH_PRIORITY } from './config.js';

// --- Tech definitions ---
// Each tech has: id, name, era, cost, prerequisites (array of tech ids),
// unlocks (array of { type: 'unit'|'building'|'ability', id: string }),
// and bonus (object with aggregate gameplay effects).
export const TECHS = {
    // === ANCIENT ERA (free starting techs) ===
    ARCHERY: {
        id: 'ARCHERY', name: 'Archery', era: 'ancient', cost: 25,
        prerequisites: [],
        unlocks: [{ type: 'unit', id: 'ARCHER' }, { type: 'unit', id: 'LONGBOWMAN' }],
        bonus: {},
        desc: 'Unlocks Archer and Longbowman units.'
    },
    BRONZE_WORKING: {
        id: 'BRONZE_WORKING', name: 'Bronze Working', era: 'ancient', cost: 25,
        prerequisites: [],
        // PIKEMAN is generic; LEGIONNAIRE is the roman faction-unique unit. The
        // owning faction (roman) gates it via FACTION_UNIQUE_UNITS at train
        // time, so the tech must still list it (otherwise the roman player
        // could never research-to-unlock their own unique unit).
        unlocks: [{ type: 'unit', id: 'PIKEMAN' }, { type: 'unit', id: 'LEGIONNAIRE' }, { type: 'unit', id: 'HOUSEHOLD_GUARD' }],
        bonus: {},
        desc: 'Unlocks Pikeman, Legionnaire (roman unique), and Household Guard.'
    },
    ANIMAL_HUSBANDRY: {
        id: 'ANIMAL_HUSBANDRY', name: 'Animal Husbandry', era: 'ancient', cost: 25,
        prerequisites: [],
        unlocks: [{ type: 'unit', id: 'CAVALRY' }],
        bonus: {},
        desc: 'Unlocks Cavalry unit and Farm improvement efficiency.'
    },

    // === CLASSICAL ERA ===
    MATHEMATICS: {
        id: 'MATHEMATICS', name: 'Mathematics', era: 'classical', cost: 50,
        prerequisites: ['ARCHERY'],
        unlocks: [{ type: 'unit', id: 'CATAPULT' }, { type: 'building', id: 'MARKET' }, { type: 'building', id: 'LIBRARY' }],
        bonus: {},
        desc: 'Unlocks Catapult, Market, and Library building.'
    },
    ENGINEERING: {
        id: 'ENGINEERING', name: 'Engineering', era: 'classical', cost: 50,
        prerequisites: ['BRONZE_WORKING'],
        unlocks: [],
        bonus: { engineerBuildSpeed: 1.5, canBuildBridge: true },
        desc: 'Engineers build 50% faster. Bridges can be constructed.'
    },
    NAVAL_ENGINEERING: {
        id: 'NAVAL_ENGINEERING', name: 'Naval Engineering', era: 'classical', cost: 50,
        prerequisites: ['ANIMAL_HUSBANDRY'],
        unlocks: [{ type: 'building', id: 'HARBOR' }, { type: 'unit', id: 'GALLEY' }, { type: 'unit', id: 'TRANSPORT' }],
        bonus: {},
        desc: 'Unlocks Harbor building, Galley, and Transport ships.'
    },
    SIEGE_CRAFT: {
        id: 'SIEGE_CRAFT', name: 'Siege Craft', era: 'classical', cost: 50,
        prerequisites: ['BRONZE_WORKING', 'MATHEMATICS'],
        unlocks: [{ type: 'building', id: 'SIEGE_WORKSHOP' }, { type: 'unit', id: 'TREBUCHET' }],
        bonus: {},
        desc: 'Unlocks Siege Workshop building and Trebuchet.'
    },

    // === MEDIEVAL ERA ===
    FORTIFICATION: {
        id: 'FORTIFICATION', name: 'Fortification', era: 'medieval', cost: 35,
        prerequisites: ['ENGINEERING'],
        // VARANGIAN_GUARD is the byzantine faction-unique; HOUSEHOLD_GUARD is
        // the generic replacement available to everyone else.
        unlocks: [{ type: 'building', id: 'WALLS' }, { type: 'unit', id: 'CROSSBOWMAN' }, { type: 'unit', id: 'VARANGIAN_GUARD' }, { type: 'unit', id: 'HOUSEHOLD_GUARD' }],
        bonus: { cityDefenseBonus: 2 },
        desc: 'Unlocks Walls, Crossbowman, Varangian Guard (byzantine unique), and Household Guard. Cities gain +2 defense.'
    },
    ROYAL_COURTS: {
        id: 'ROYAL_COURTS', name: 'Royal Courts', era: 'medieval', cost: 40,
        prerequisites: ['FORTIFICATION', 'CHIVALRY'],
        unlocks: [],
        bonus: { kingHpBonus: 4, kingAttackBonus: 1, kingDefenseBonus: 1 },
        desc: 'Kings gain +4 HP, +1 attack, and +1 defense.'
    },
    CHIVALRY: {
        id: 'CHIVALRY', name: 'Chivalry', era: 'medieval', cost: 35,
        prerequisites: ['MATHEMATICS', 'ANIMAL_HUSBANDRY'],
        // BERSERKER (viking unique), WINGED_HUSSAR (polish unique), and
        // CONQUISTADOR (spanish unique) are faction-locked at train time;
        // RAIDER and MERCENARY_KNIGHT are the generic replacements so other
        // factions still get a unit from this tech. CONQUISTADOR was moved
        // here from GUNPOWDER so the Spanish unlock their signature unit in
        // the medieval era instead of waiting for industrial.
        unlocks: [{ type: 'unit', id: 'CATAPHRACT' }, { type: 'unit', id: 'CHARIOT' }, { type: 'unit', id: 'BERSERKER' }, { type: 'unit', id: 'WINGED_HUSSAR' }, { type: 'unit', id: 'CONQUISTADOR' }, { type: 'unit', id: 'RAIDER' }, { type: 'unit', id: 'MERCENARY_KNIGHT' }],
        bonus: { lordXpBonus: 0.25 },
        desc: 'Unlocks Cataphract, Chariot, Berserker (viking unique), Winged Hussar (polish unique), Conquistador (spanish unique), Raider, and Mercenary Knight. Lords gain 25% more XP.'
    },
    CARTOGRAPHY: {
        id: 'CARTOGRAPHY', name: 'Cartography', era: 'medieval', cost: 35,
        prerequisites: ['NAVAL_ENGINEERING'],
        unlocks: [{ type: 'unit', id: 'FRIGATE' }, { type: 'unit', id: 'GALLEON' }],
        bonus: { navalVisionBonus: 2 },
        desc: 'Unlocks Frigate and Galleon. Naval units gain +2 vision.'
    },
    FEUDALISM: {
        id: 'FEUDALISM', name: 'Feudalism', era: 'medieval', cost: 35,
        prerequisites: ['SIEGE_CRAFT'],
        unlocks: [{ type: 'unit', id: 'SIEGE_TOWER' }],
        bonus: { cityLoyaltyBonus: 1 },
        desc: 'Unlocks Siege Tower. Cities gain +1 loyalty.'
    },

    // === INDUSTRIAL ERA ===
    GUNPOWDER: {
        id: 'GUNPOWDER', name: 'Gunpowder', era: 'industrial', cost: 150,
        prerequisites: ['SIEGE_CRAFT', 'CHIVALRY'],
        // CONQUISTADOR was moved to CHIVALRY (medieval) so the Spanish unlock
        // it earlier; FRONTIERSMAN is the generic replacement for every other
        // faction.
        unlocks: [{ type: 'unit', id: 'ARTILLERY' }, { type: 'unit', id: 'FRONTIERSMAN' }],
        bonus: { rangedDamageBonus: 1 },
        desc: 'Unlocks Artillery and Frontiersman. Ranged units deal +1 damage.'
    },
    MEDICINE: {
        id: 'MEDICINE', name: 'Medicine', era: 'industrial', cost: 150,
        prerequisites: ['FEUDALISM'],
        unlocks: [{ type: 'unit', id: 'MEDIC' }],
        bonus: { medicHealBonus: 2, starvationReduction: 1 },
        desc: 'Unlocks Medic. Healers heal +2 more. Starvation reduced.'
    },
    MACHINERY: {
        id: 'MACHINERY', name: 'Machinery', era: 'industrial', cost: 150,
        prerequisites: ['ENGINEERING', 'FORTIFICATION'],
        unlocks: [{ type: 'unit', id: 'WORKER' }],
        bonus: { workerBuildSpeed: 2 },
        desc: 'Unlocks Worker improvements. Workers build twice as fast.'
    },
    MASS_PRODUCTION: {
        id: 'MASS_PRODUCTION', name: 'Mass Production', era: 'industrial', cost: 150,
        prerequisites: ['CARTOGRAPHY', 'MEDICINE'],
        unlocks: [],
        bonus: { settlerCostReduction: 0.3, extraTradeRoute: 1 },
        desc: 'Settlers cost 30% less. Each city gets +1 trade route.'
    },

    // === RENAISSANCE ERA (400 pts) ===
    MATCHLOCK: {
        id: 'MATCHLOCK', name: 'Matchlock', era: 'renaissance', cost: 250,
        prerequisites: ['GUNPOWDER'],
        unlocks: [{ type: 'unit', id: 'MUSKETEER' }, { type: 'unit', id: 'ARQUEBUSIER' }, { type: 'unit', id: 'PINNACE' }],
        bonus: { rangedDamageBonus: 1 },
        desc: 'Unlocks Musketman, Arquebusier, and Pinnace. Ranged units deal +1 damage.'
    },
    BASTION_FORT: {
        id: 'BASTION_FORT', name: 'Bastion Fort', era: 'renaissance', cost: 250,
        prerequisites: ['FORTIFICATION', 'GUNPOWDER'],
        unlocks: [{ type: 'building', id: 'CITADEL' }],
        bonus: { cityDefenseBonus: 3 },
        desc: 'Unlocks Citadel building. Cities gain +3 defense.'
    },
    OCEAN_NAVIGATION: {
        id: 'OCEAN_NAVIGATION', name: 'Ocean Navigation', era: 'renaissance', cost: 250,
        prerequisites: ['CARTOGRAPHY', 'GUNPOWDER'],
        unlocks: [{ type: 'unit', id: 'MAN_OF_WAR' }, { type: 'unit', id: 'GALLEASS' }],
        bonus: { navalVisionBonus: 2 },
        desc: 'Unlocks Man-of-War and Galleass. Naval units gain +2 vision.'
    },

    // === ENLIGHTENMENT ERA (600 pts) ===
    FLINTLOCK: {
        id: 'FLINTLOCK', name: 'Flintlock', era: 'enlightenment', cost: 350,
        prerequisites: ['MATCHLOCK'],
        unlocks: [{ type: 'unit', id: 'LINE_INFANTRY' }, { type: 'unit', id: 'DRAGOON' }, { type: 'unit', id: 'CORVETTE' }],
        bonus: { infantryAttackBonus: 1 },
        desc: 'Unlocks Line Infantry, Dragoon, and Corvette. Infantry gain +1 attack.'
    },
    METALLURGY: {
        id: 'METALLURGY', name: 'Metallurgy', era: 'enlightenment', cost: 350,
        prerequisites: ['MATCHLOCK', 'MACHINERY'],
        unlocks: [{ type: 'unit', id: 'CANNON' }, { type: 'unit', id: 'MORTAR' }, { type: 'unit', id: 'FROLIC' }],
        bonus: { siegePowerBonus: 2 },
        desc: 'Unlocks Cannon, Mortar, and Frolic. Siege units gain +2 siege power.'
    },
    ACADEMY: {
        id: 'ACADEMY', name: 'Academy', era: 'enlightenment', cost: 350,
        prerequisites: ['MEDICINE', 'MATCHLOCK'],
        unlocks: [{ type: 'building', id: 'UNIVERSITY' }],
        bonus: { researchSpeedBonus: 0.25 },
        desc: 'Unlocks University building. Research speed +25%.'
    },
    BANKING: {
        id: 'BANKING', name: 'Banking', era: 'enlightenment', cost: 350,
        prerequisites: ['MASS_PRODUCTION'],
        unlocks: [{ type: 'building', id: 'BANK' }, { type: 'unit', id: 'MERCHANTMAN' }],
        bonus: { goldIncomeBonus: 0.15 },
        desc: 'Unlocks Bank building and Merchantman. Gold income +15%.'
    },

    // === MODERN ERA (800 pts) ===
    RIFLED_MUSKET: {
        id: 'RIFLED_MUSKET', name: 'Rifled Musket', era: 'modern', cost: 500,
        prerequisites: ['FLINTLOCK', 'METALLURGY'],
        unlocks: [{ type: 'unit', id: 'RIFLEMAN' }, { type: 'unit', id: 'SHARPSHOOTER' }],
        bonus: { rangedRangeBonus: 1 },
        desc: 'Unlocks Rifleman and Sharpshooter. Ranged units gain +1 range.'
    },
    STEAM_ENGINE: {
        id: 'STEAM_ENGINE', name: 'Steam Engine', era: 'modern', cost: 500,
        prerequisites: ['METALLURGY', 'BANKING'],
        unlocks: [{ type: 'unit', id: 'IRONCLAD' }, { type: 'unit', id: 'STEAM_TRANSPORT' }, { type: 'unit', id: 'GUNBOAT' }],
        bonus: { navalMoveBonus: 1 },
        desc: 'Unlocks Ironclad, Steam Transport, and Gunboat. Naval units gain +1 move.'
    },
    RAILROAD: {
        id: 'RAILROAD', name: 'Railroad', era: 'modern', cost: 500,
        prerequisites: ['STEAM_ENGINE', 'ACADEMY'],
        unlocks: [{ type: 'unit', id: 'RAILGUN' }, { type: 'unit', id: 'ARMORED_TRAIN' }],
        bonus: { roadMoveBonus: 1 },
        desc: 'Unlocks Railgun and Armored Train. Units gain +1 move on roads.'
    },
    TELEGRAPH: {
        id: 'TELEGRAPH', name: 'Telegraph', era: 'modern', cost: 500,
        prerequisites: ['ACADEMY', 'BANKING'],
        unlocks: [{ type: 'building', id: 'COMMAND_POST' }],
        bonus: { lordCommandBonus: 2 },
        desc: 'Unlocks Command Post building. Lords gain +2 command range.'
    },
    EXPLOSIVES: {
        id: 'EXPLOSIVES', name: 'Explosives', era: 'modern', cost: 500,
        prerequisites: ['METALLURGY', 'FLINTLOCK'],
        // DEMOLITION_SQUAD is the engineer-line upgrade (it keeps the
        // engineer's structure/bridge utility and gains a demolish bonus).
        // SIEGE_CANNON is the heavy gun. The MINEFIELD structure is also
        // gated on this tech (engineers lay it once explosives are understood).
        unlocks: [{ type: 'unit', id: 'DEMOLITION_SQUAD' }, { type: 'unit', id: 'SIEGE_CANNON' }, { type: 'structure', id: 'MINEFIELD' }],
        bonus: { cityDamageBonus: 3 },
        desc: 'Unlocks Demolition Squad, Siege Cannon, and Minefield structures. +3 damage vs cities.'
    },
    FIELD_ARTILLERY: {
        id: 'FIELD_ARTILLERY', name: 'Field Artillery', era: 'modern', cost: 500,
        prerequisites: ['METALLURGY', 'RAILROAD'],
        unlocks: [{ type: 'unit', id: 'FIELD_GUN' }, { type: 'unit', id: 'HORSE_ARTILLERY' }],
        bonus: { artilleryMoveBonus: 1 },
        desc: 'Unlocks Field Gun and Horse Artillery. Artillery gain +1 move.'
    },
    IRONCLADS: {
        id: 'IRONCLADS', name: 'Ironclads', era: 'modern', cost: 500,
        prerequisites: ['STEAM_ENGINE', 'OCEAN_NAVIGATION'],
        unlocks: [{ type: 'unit', id: 'IRONCLAD_FRIGATE' }, { type: 'unit', id: 'MONITOR' }, { type: 'unit', id: 'FRIGATE_2' }],
        bonus: { navalHpBonus: 2 },
        desc: 'Unlocks Ironclad Frigate, Monitor, and Frigate II. Naval units gain +2 HP.'
    },
    ELECTRICITY: {
        id: 'ELECTRICITY', name: 'Electricity', era: 'modern', cost: 500,
        prerequisites: ['TELEGRAPH', 'ACADEMY'],
        unlocks: [{ type: 'building', id: 'POWER_PLANT' }],
        bonus: { productionBonus: 0.20 },
        desc: 'Unlocks Power Plant building. Production +20%.'
    },
    SUBMARINE: {
        id: 'SUBMARINE', name: 'Submarine', era: 'modern', cost: 500,
        prerequisites: ['IRONCLADS', 'EXPLOSIVES'],
        unlocks: [{ type: 'unit', id: 'SUBMARINE' }, { type: 'unit', id: 'TORPEDO_BOAT' }],
        bonus: { navalStealth: true },
        desc: 'Unlocks Submarine and Torpedo Boat. Naval units can stealth.'
    },
    SCIENTIFIC_METHOD: {
        id: 'SCIENTIFIC_METHOD', name: 'Scientific Method', era: 'modern', cost: 500,
        prerequisites: ['ACADEMY', 'BANKING'],
        unlocks: [{ type: 'building', id: 'RESEARCH_INSTITUTE' }],
        bonus: { researchSpeedBonus: 0.25 },
        desc: 'Unlocks Research Institute building. Research speed +25%.'
    },

    // === ATOMIC ERA (1880-1940, cost 800 pts) ===
    // The internal combustion engine unlocks mobilized units and tanks — the
    // motorized successors to foot infantry and horse cavalry. Old units are
    // obsoleted as these come online (see unit_obsolescence.js).
    INTERNAL_COMBUSTION: {
        id: 'INTERNAL_COMBUSTION', name: 'Internal Combustion', era: 'atomic', cost: 800,
        prerequisites: ['STEAM_ENGINE', 'ELECTRICITY'],
        // COMBAT_ENGINEER is the modern engineer upgrade (motorized, builds
        // BUNKER structures). The BUNKER structure is gated on this tech too.
        unlocks: [{ type: 'unit', id: 'MOBILIZED_INFANTRY' }, { type: 'unit', id: 'MOBILIZED_ARTILLERY' }, { type: 'unit', id: 'ARMORED_CAR' }, { type: 'unit', id: 'COMBAT_ENGINEER' }, { type: 'structure', id: 'BUNKER' }],
        bonus: { artilleryMoveBonus: 1 },
        desc: 'Unlocks Mobilized Infantry, Mobilized Artillery, Armored Car, Combat Engineer, and Bunker structures. Artillery gain +1 move.'
    },
    ARMOR: {
        id: 'ARMOR', name: 'Armor', era: 'atomic', cost: 800,
        prerequisites: ['INTERNAL_COMBUSTION', 'RIFLED_MUSKET'],
        // ARMOR unlocks tanks AND the AT_MINE structure (a shaped-charge mine
        // that defeats the armor it gates — you need armor tech to build one).
        unlocks: [{ type: 'unit', id: 'TANK' }, { type: 'unit', id: 'HEAVY_TANK' }, { type: 'structure', id: 'AT_MINE' }],
        bonus: { cityDamageBonus: 3 },
        desc: 'Unlocks Tank, Heavy Tank, and AT Mine structures. Tanks are the modern cavalry — they obsolete horse cavalry. +3 damage vs cities.'
    },
    DREADNOUGHT: {
        id: 'DREADNOUGHT', name: 'Dreadnought', era: 'atomic', cost: 800,
        prerequisites: ['IRONCLADS', 'INTERNAL_COMBUSTION'],
        unlocks: [{ type: 'unit', id: 'DESTROYER' }, { type: 'unit', id: 'BATTLESHIP' }, { type: 'unit', id: 'TRANSPORT_SHIP' }],
        bonus: { navalHpBonus: 4 },
        desc: 'Unlocks Destroyer, Battleship, and Transport Ship. Naval units gain +4 HP.'
    },
    NAVAL_AVIATION: {
        id: 'NAVAL_AVIATION', name: 'Naval Aviation', era: 'atomic', cost: 800,
        prerequisites: ['DREADNOUGHT', 'TELEGRAPH'],
        unlocks: [{ type: 'unit', id: 'AIRCRAFT_CARRIER' }, { type: 'unit', id: 'SUBMARINE_II' }],
        bonus: { navalVisionBonus: 3 },
        desc: 'Unlocks Aircraft Carrier and Submarine II. Naval units gain +3 vision.'
    },
    ADVANCED_ARTILLERY: {
        id: 'ADVANCED_ARTILLERY', name: 'Advanced Artillery', era: 'atomic', cost: 800,
        prerequisites: ['FIELD_ARTILLERY', 'INTERNAL_COMBUSTION'],
        unlocks: [{ type: 'unit', id: 'MOTOR_ARTILLERY' }],
        bonus: { siegePowerBonus: 3 },
        desc: 'Unlocks Motor Artillery (self-propelled guns). Siege units gain +3 siege power.'
    },
    ANTI_ARMOR: {
        id: 'ANTI_ARMOR', name: 'Anti-Armor', era: 'atomic', cost: 800,
        prerequisites: ['RIFLED_MUSKET', 'INTERNAL_COMBUSTION'],
        // BAYONET_RIFLE is the entry modern anti-armor; ANTI_TANK_GUN is the
        // transitional towed gun. RPG_TEAM comes later via ROCKETRY.
        unlocks: [{ type: 'unit', id: 'BAYONET_RIFLE' }, { type: 'unit', id: 'ANTI_TANK_GUN' }],
        bonus: { rangedDamageBonus: 1 },
        desc: 'Unlocks Bayonet Rifle and Anti-Tank Gun (modern anti-cavalry/anti-tank). Ranged units deal +1 damage.'
    },
    // ROCKETRY: the capstone of the anti-armor line. Rocket-propelled grenades
    // give infantry a man-portable weapon that can kill any tank — the RPG_TEAM
    // is the definitive atomic-era counter to massed armor.
    ROCKETRY: {
        id: 'ROCKETRY', name: 'Rocketry', era: 'atomic', cost: 800,
        prerequisites: ['ANTI_ARMOR', 'EXPLOSIVES'],
        unlocks: [{ type: 'unit', id: 'RPG_TEAM' }],
        bonus: { rangedDamageBonus: 2, cityDamageBonus: 2 },
        desc: 'Unlocks RPG Team (man-portable anti-tank rocket). Ranged units deal +2 damage, +2 vs cities.'
    },

    // === ANTI-CAVALRY UNITS, distributed across earlier eras ===
    // HALBERDIER: a medieval Pikeman upgrade, gated behind FORTIFICATION (same
    // era as the CROSSBOWMAN). Unlocked via a dedicated tech so it doesn't
    // crowd the existing medieval unlocks.
    POLEARM: {
        id: 'POLEARM', name: 'Polearm', era: 'medieval', cost: 60,
        prerequisites: ['BRONZE_WORKING', 'FORTIFICATION'],
        unlocks: [{ type: 'unit', id: 'HALBERDIER' }],
        bonus: { cityDefenseBonus: 1 },
        desc: 'Unlocks Halberdier, an anti-cavalry specialist. Cities gain +1 defense.'
    },
    // PIKE_MASTER: enlightenment-era long-pike, gated behind FLINTLOCK (so it
    // appears alongside the musket line it must protect).
    PIKE_WARFARE: {
        id: 'PIKE_WARFARE', name: 'Pike Warfare', era: 'enlightenment', cost: 350,
        prerequisites: ['FLINTLOCK', 'FORTIFICATION'],
        unlocks: [{ type: 'unit', id: 'PIKE_MASTER' }],
        bonus: { cityDefenseBonus: 2 },
        desc: 'Unlocks Pike Master, the premier anti-cavalry infantry of the gunpowder era. Cities gain +2 defense.'
    }
};

// Era progression order
export const ERA_ORDER = ['ancient', 'classical', 'medieval', 'industrial', 'renaissance', 'enlightenment', 'modern', 'atomic'];

// Era display names
export const ERA_NAMES = {
    ancient: 'Ancient Era',
    classical: 'Classical Era',
    medieval: 'Medieval Era',
    industrial: 'Industrial Era',
    renaissance: 'Renaissance Era',
    enlightenment: 'Enlightenment Era',
    modern: 'Modern Era',
    atomic: 'Atomic Era'
};

// --- State management ---

/** Create a fresh tech state for a new game. All Ancient techs are pre-researched. */
export function createTechState() {
    const researched = new Set();
    // Ancient era techs are free starting techs
    for (const [id, tech] of Object.entries(TECHS)) {
        if (tech.era === 'ancient') researched.add(id);
    }
    return {
        researched,            // Set of researched tech ids
        current: null,         // id of tech currently being researched, or null
        progress: 0            // research points accumulated toward current tech
    };
}

/** Serialize tech state for saving (Set → Array). */
export function serializeTechState(state) {
    return {
        researched: [...state.researched],
        current: state.current,
        progress: state.progress
    };
}

/** Deserialize tech state from save (Array → Set). */
export function deserializeTechState(data) {
    if (!data) return createTechState();
    return {
        researched: new Set(data.researched || []),
        current: data.current || null,
        progress: data.progress || 0
    };
}

// --- Query functions ---

/** Get the research cost for a tech, scaled by how many techs are already researched. */
export function getResearchCost(techId) {
    const tech = TECHS[techId];
    if (!tech) return Infinity;
    return tech.cost;
}

/** Check if a tech's prerequisites are met. */
export function canResearch(state, techId) {
    const tech = TECHS[techId];
    if (!tech) return false;
    if (state.researched.has(techId)) return false; // already researched
    for (const prereq of tech.prerequisites) {
        if (!state.researched.has(prereq)) return false;
    }
    return true;
}

/** Get all techs available to research (prerequisites met, not yet researched). */
export function getAvailableTechs(state) {
    return Object.keys(TECHS).filter(id => canResearch(state, id));
}

/** Get the current era based on researched techs. */
export function getCurrentEra(state) {
    let maxEra = 'ancient';
    for (const id of state.researched) {
        const tech = TECHS[id];
        if (tech && ERA_ORDER.indexOf(tech.era) > ERA_ORDER.indexOf(maxEra)) {
            maxEra = tech.era;
        }
    }
    return maxEra;
}

/** Get all unit types unlocked by researched techs. */
export function getUnlockedUnits(state) {
    const units = new Set();
    for (const id of state.researched) {
        const tech = TECHS[id];
        if (!tech) continue;
        for (const u of tech.unlocks) {
            if (u.type === 'unit') units.add(u.id);
        }
    }
    return units;
}

/** Get all building types unlocked by researched techs. */
export function getUnlockedBuildings(state) {
    const buildings = new Set();
    for (const id of state.researched) {
        const tech = TECHS[id];
        if (!tech) continue;
        for (const u of tech.unlocks) {
            if (u.type === 'building') buildings.add(u.id);
        }
    }
    return buildings;
}

/** Get all engineer-structure types (MINEFIELD, BUNKER, AT_MINE, ...) unlocked
 *  by researched techs. Medieval structures (SPIKES/FORTIFICATION/FALL_TRAP)
 *  are always available and never appear in tech unlocks, so they're not in
 *  this set — callers add them unconditionally. */
export function getUnlockedStructures(state) {
    const structures = new Set();
    for (const id of state.researched) {
        const tech = TECHS[id];
        if (!tech) continue;
        for (const u of tech.unlocks) {
            if (u.type === 'structure') structures.add(u.id);
        }
    }
    return structures;
}

/** Get aggregate bonuses from all researched techs. */
export function getTechBonuses(state) {
    const bonuses = {
        cityDefenseBonus: 0,
        cityLoyaltyBonus: 0,
        lordXpBonus: 0,
        navalVisionBonus: 0,
        rangedDamageBonus: 0,
        medicHealBonus: 0,
        starvationReduction: 0,
        engineerBuildSpeed: 1,
        workerBuildSpeed: 1,
        settlerCostReduction: 0,
        extraTradeRoute: 0,
        canBuildBridge: false,
        // New bonus types for Renaissance/Enlightenment/Modern eras
        infantryAttackBonus: 0,
        siegePowerBonus: 0,
        researchSpeedBonus: 0,
        goldIncomeBonus: 0,
        rangedRangeBonus: 0,
        navalMoveBonus: 0,
        roadMoveBonus: 0,
        lordCommandBonus: 0,
        lordCombatBonus: 0,
        lordGovernanceBonus: 0,
        lordHpBonus: 0,
        cityDamageBonus: 0,
        artilleryMoveBonus: 0,
        navalHpBonus: 0,
        productionBonus: 0,
        navalStealth: false,
        kingTechScaling: 0,
        kingHpBonus: 0,
        kingAttackBonus: 0,
        kingDefenseBonus: 0
    };
    for (const id of state.researched) {
        const tech = TECHS[id];
        if (!tech || !tech.bonus) continue;
        for (const [key, val] of Object.entries(tech.bonus)) {
            if (typeof val === 'boolean') {
                bonuses[key] = bonuses[key] || val;
            } else if (typeof val === 'number') {
                if (key.endsWith('Reduction') || key.endsWith('CostReduction')) {
                    bonuses[key] = Math.min(bonuses[key] + val, 0.9); // cap at 90%
                } else if (key.endsWith('Speed') || key.endsWith('Multiplier')) {
                    bonuses[key] *= val; // multiplicative
                } else {
                    bonuses[key] += val; // additive
                }
            }
        }
    }
    return bonuses;
}

export function getKingTechBonuses(state) {
    const techState = state || { researched: new Set() };
    const bonuses = getTechBonuses(techState);
    const researchedCount = techState.researched ? techState.researched.size : 0;
    // Nerfed scaling: previously +1 HP / +0.25 atk / +0.25 def PER tech beyond
    // 3 (linear), which gave +39 HP / +9.75 atk / +9.75 def at 42 techs — making
    // late-game kings nearly unkillable and one-shotting most units. Now uses
    // a square-root curve so tech progression still rewards the king but stays
    // bounded: at 42 techs → +6 HP / +4.37 atk / +4.37 def (roughly half the
    // linear atk/def, and HP capped at +6).
    const extraTechs = Math.max(0, researchedCount - 3);
    const sqrtTechs = Math.sqrt(extraTechs);
    return {
        hp: (bonuses.kingHpBonus || 0) + Math.min(6, Math.floor(sqrtTechs * 1.0)),
        attack: (bonuses.kingAttackBonus || 0) + Math.min(5, sqrtTechs * 0.7),
        defense: (bonuses.kingDefenseBonus || 0) + Math.min(5, sqrtTechs * 0.7)
    };
}

/** Aggregate tech bonuses that apply to all lords (not just the king). Includes
 *  per-tech flat bonuses plus a small scaling bonus for every researched tech
 *  beyond the starting Ancient era so lords grow stronger as the game progresses. */
export function getLordTechBonuses(state) {
    const techState = state || { researched: new Set() };
    const bonuses = getTechBonuses(techState);
    const researchedCount = techState.researched ? techState.researched.size : 0;
    const extraTechs = Math.max(0, researchedCount - 3);
    return {
        command: (bonuses.lordCommandBonus || 0) + extraTechs * 0.15,
        combat: (bonuses.lordCombatBonus || 0) + extraTechs * 0.15,
        governance: (bonuses.lordGovernanceBonus || 0) + extraTechs * 0.25,
        hp: (bonuses.lordHpBonus || 0) + extraTechs * 0.75
    };
}

/** Check if a specific unit type is unlocked. */
export function isUnitUnlocked(unitType, state) {
    return getUnlockedUnits(state).has(unitType);
}

/** Check if a specific building type is unlocked. */
export function isBuildingUnlocked(buildingType, state) {
    return getUnlockedBuildings(state).has(buildingType);
}

// --- Research progression ---

/** Add research points to the current tech. Returns array of completed tech ids. */
export function addResearch(state, amount) {
    const completed = [];
    if (!state.current) return completed;

    const tech = TECHS[state.current];
    if (!tech) { state.current = null; state.progress = 0; return completed; }

    state.progress += amount;
    while (state.progress >= tech.cost && state.current) {
        state.progress -= tech.cost;
        state.researched.add(state.current);
        completed.push(state.current);

        // Auto-advance: if a single tech was completed and there are more
        // available, stop (let the player/AI choose). Otherwise stay on current.
        state.current = null;
        state.progress = 0;
    }
    return completed;
}

/** Select a new tech to research. Returns true if successful. */
export function selectResearch(state, techId) {
    if (!canResearch(state, techId)) return false;
    state.current = techId;
    state.progress = 0;
    return true;
}

/** Get research progress as a fraction (0-1). */
export function getResearchProgress(state) {
    if (!state.current) return 0;
    const tech = TECHS[state.current];
    if (!tech) return 0;
    return Math.min(1, state.progress / tech.cost);
}

/** Calculate total research output from all cities. */
export function calculateResearchOutput(tiles, owner, buildings) {
    let total = 0;
    for (const tile of tiles.values()) {
        if (tile.owner !== owner) continue;
        if (tile.terrain === 'CITY') {
            total += tile.cityLevel || 1;
        }
    }
    // Library, University, and Research Institute buildings contribute research.
    // Research Institute also gets adjacency bonuses from mountains and other
    // Research Institutes.
    if (buildings) {
        for (const tile of tiles.values()) {
            if (tile.owner !== owner) continue;
            const list = buildings.get(`${tile.x},${tile.z}`) || [];
            for (const bType of list) {
                if (bType === 'LIBRARY') total += 2;
                else if (bType === 'UNIVERSITY') total += 3;
                else if (bType === 'RESEARCH_INSTITUTE') {
                    total += 8;
                    // Adjacency bonus: +2 per adjacent mountain, +3 per adjacent Research Institute
                    for (let dx = -1; dx <= 1; dx++) {
                        for (let dz = -1; dz <= 1; dz++) {
                            if (dx === 0 && dz === 0) continue;
                            const adj = tiles.get(`${tile.x + dx},${tile.z + dz}`);
                            if (!adj || adj.owner !== owner) continue;
                            if (adj.terrain === 'MOUNTAIN') total += 2;
                            else {
                                const adjList = buildings.get(`${adj.x},${adj.z}`) || [];
                                if (adjList.includes('RESEARCH_INSTITUTE')) total += 3;
                            }
                        }
                    }
                }
            }
        }
    }
    return total;
}

/** Auto-select a research target for an AI faction based on personality.
 *  Returns the selected tech id, or null if nothing to research. */
export function autoSelectResearch(state, personality) {
    if (state.current) return state.current;
    const available = getAvailableTechs(state);
    if (available.length === 0) return null;

    const priorities = {
        AGGRESSIVE: ['SIEGE_CRAFT', 'GUNPOWDER', 'CHIVALRY', 'FORTIFICATION',
                     'MATHEMATICS', 'ENGINEERING', 'NAVAL_ENGINEERING', 'ANIMAL_HUSBANDRY',
                     'ARCHERY', 'BRONZE_WORKING', 'CARTOGRAPHY', 'FEUDALISM',
                     'MEDICINE', 'MACHINERY', 'MASS_PRODUCTION',
                     // Renaissance
                     'MATCHLOCK', 'BASTION_FORT', 'METALLURGY', 'OCEAN_NAVIGATION',
                     // Enlightenment
                     'EXPLOSIVES', 'FIELD_ARTILLERY', 'FLINTLOCK', 'ACADEMY', 'BANKING',
                     // Modern
                     'RIFLED_MUSKET', 'STEAM_ENGINE', 'RAILROAD', 'TELEGRAPH',
                     'IRONCLADS', 'ELECTRICITY', 'SUBMARINE',
                     // Atomic
                     'INTERNAL_COMBUSTION', 'ADVANCED_ARTILLERY', 'ARMOR', 'DREADNOUGHT', 'ANTI_ARMOR', 'ROCKETRY', 'NAVAL_AVIATION',
                     // Anti-cavalry
                     'POLEARM', 'PIKE_WARFARE'],
        DEFENSIVE:  ['FORTIFICATION', 'SIEGE_CRAFT', 'GUNPOWDER', 'ENGINEERING', 'MEDICINE', 'FEUDALISM',
                     'BRONZE_WORKING', 'MATHEMATICS', 'ARCHERY',
                     'ANIMAL_HUSBANDRY', 'NAVAL_ENGINEERING', 'CHIVALRY',
                     'CARTOGRAPHY', 'MACHINERY', 'MASS_PRODUCTION',
                     // Renaissance
                     'BASTION_FORT', 'MATCHLOCK', 'METALLURGY', 'OCEAN_NAVIGATION',
                     // Enlightenment
                     'EXPLOSIVES', 'FIELD_ARTILLERY', 'FLINTLOCK', 'ACADEMY', 'BANKING',
                     // Modern
                     'RIFLED_MUSKET', 'IRONCLADS', 'TELEGRAPH',
                     'STEAM_ENGINE', 'RAILROAD', 'ELECTRICITY', 'SUBMARINE',
                     // Atomic (defensive factions prioritize anti-armor to repel tanks)
                     'ANTI_ARMOR', 'ADVANCED_ARTILLERY', 'ROCKETRY', 'INTERNAL_COMBUSTION', 'DREADNOUGHT', 'NAVAL_AVIATION', 'ARMOR',
                     // Anti-cavalry (defensive factions love these)
                     'POLEARM', 'PIKE_WARFARE'],
        ECONOMIC:   ['MATHEMATICS', 'SIEGE_CRAFT', 'GUNPOWDER', 'ENGINEERING', 'NAVAL_ENGINEERING', 'MASS_PRODUCTION',
                     'CARTOGRAPHY', 'ARCHERY', 'ANIMAL_HUSBANDRY', 'BRONZE_WORKING',
                     'FORTIFICATION', 'CHIVALRY',
                     'MEDICINE', 'FEUDALISM', 'MACHINERY',
                     // Renaissance
                     'MATCHLOCK', 'METALLURGY', 'OCEAN_NAVIGATION', 'BASTION_FORT',
                     // Enlightenment
                     'BANKING', 'ACADEMY', 'EXPLOSIVES', 'FIELD_ARTILLERY', 'FLINTLOCK',
                     // Modern
                     'ELECTRICITY', 'TELEGRAPH', 'STEAM_ENGINE', 'RAILROAD',
                     'RIFLED_MUSKET', 'IRONCLADS', 'SUBMARINE',
                     // Atomic
                     'DREADNOUGHT', 'ADVANCED_ARTILLERY', 'INTERNAL_COMBUSTION', 'NAVAL_AVIATION', 'ARMOR', 'ANTI_ARMOR', 'ROCKETRY',
                     // Anti-cavalry
                     'POLEARM', 'PIKE_WARFARE'],
        BALANCED:   ['SIEGE_CRAFT', 'GUNPOWDER', 'ARCHERY', 'BRONZE_WORKING', 'ANIMAL_HUSBANDRY', 'MATHEMATICS',
                     'ENGINEERING', 'NAVAL_ENGINEERING',
                     'FORTIFICATION', 'CHIVALRY', 'CARTOGRAPHY', 'FEUDALISM',
                     'MEDICINE', 'MACHINERY', 'MASS_PRODUCTION',
                     // Renaissance
                     'MATCHLOCK', 'BASTION_FORT', 'METALLURGY', 'OCEAN_NAVIGATION',
                     // Enlightenment
                     'EXPLOSIVES', 'FIELD_ARTILLERY', 'FLINTLOCK', 'ACADEMY', 'BANKING',
                     // Modern
                     'RIFLED_MUSKET', 'STEAM_ENGINE', 'RAILROAD', 'TELEGRAPH',
                     'IRONCLADS', 'ELECTRICITY', 'SUBMARINE',
                     // Atomic
                     'INTERNAL_COMBUSTION', 'ADVANCED_ARTILLERY', 'ARMOR', 'DREADNOUGHT', 'ANTI_ARMOR', 'ROCKETRY', 'NAVAL_AVIATION',
                     // Anti-cavalry
                     'POLEARM', 'PIKE_WARFARE']
    };
    const list = priorities[personality] || priorities.BALANCED;
    const rank = new Map(list.map((id, i) => [id, i]));
    const artilleryTechs = new Set(['SIEGE_CRAFT', 'GUNPOWDER', 'METALLURGY', 'FIELD_ARTILLERY', 'EXPLOSIVES', 'BASTION_FORT']);
    let best = null;
    let bestScore = -Infinity;
    for (const id of available) {
        const tech = TECHS[id];
        const r = rank.get(id);
        // Prefer high-priority, low-cost techs. Techs not in the personality list
        // still get a small cost-only score so nothing is permanently ignored.
        let score = (r !== undefined) ? (list.length - r) / tech.cost : 1 / tech.cost;
        if (artilleryTechs.has(id)) score *= AI_ARTILLERY_TECH_PRIORITY;
        if (score > bestScore) {
            bestScore = score;
            best = id;
        }
    }
    if (best) {
        selectResearch(state, best);
        return best;
    }
    selectResearch(state, available[0]);
    return available[0];
}
