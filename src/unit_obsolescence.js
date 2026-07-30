/** Unit obsolescence system.
 *
 *  When a modern unit's unlocking tech is researched, its older role-equivalent
 *  becomes *obsolete*: removed from the AI's trainable roster, hidden from the
 *  player's build menu, and rejected by the engine's training validator. This
 *  mirrors Civ-style obsolescence — once Rifled Musket is researched, ARCHER and
 *  MUSKETEER disappear and RIFLEMAN/SHARPSHOOTER take their place. Already-
 *  fielded obsolete units remain on the board (no mass-disband); only *training*
 *  is blocked.
 *
 *  The module is pure: it exports a data table and filter functions that operate
 *  on a researched-tech set. Integration points are src/ai.js (AI roster build),
 *  src/ui.js (player build menu), and src/game.js (engine validation), so all
 *  three agree on what's trainable.
 */

// Each entry: modernUnit -> { obsoletes: [oldUnit...], tech: 'TECH_ID' }
// An old unit is removed only when the tech that unlocks its modern replacement
// is researched. A unit is only listed as obsolete when the modern replacement
// fills the SAME combat role (melee/ranged/cavalry/siege/naval) — so unlocking
// RIFLEMAN (ranged) obsoletes ARCHER/MUSKETEER (ranged) but not INFANTRY (melee).
// Chains are CUMULATIVE: each modern unit retires everything earlier in its
// line, because tech prerequisites don't force the whole chain (a faction can
// reach MATCHLOCK without FORTIFICATION and would otherwise keep training
// ARCHERs next to its musketeers).
export const OBSOLESCENCE = {
    // Ranged line: ARCHER/LONGBOWMAN → CROSSBOWMAN → MUSKETEER → RIFLEMAN/SHARPSHOOTER
    CROSSBOWMAN:  { obsoletes: ['ARCHER', 'LONGBOWMAN'],          tech: 'FORTIFICATION' },
    MUSKETEER:    { obsoletes: ['ARCHER', 'LONGBOWMAN', 'CROSSBOWMAN'], tech: 'MATCHLOCK' },
    RIFLEMAN:     { obsoletes: ['ARCHER', 'LONGBOWMAN', 'CROSSBOWMAN', 'MUSKETEER', 'ARQUEBUSIER'], tech: 'RIFLED_MUSKET' },
    SHARPSHOOTER: { obsoletes: [],                                  tech: 'RIFLED_MUSKET' }, // peer, no extra obsoletes

    // Melee line: INFANTRY/PIKEMAN/LEGIONNAIRE → LINE_INFANTRY
    LINE_INFANTRY:{ obsoletes: ['INFANTRY', 'PIKEMAN', 'LEGIONNAIRE'], tech: 'FLINTLOCK' },

    // Cavalry line: CAVALRY/CHARIOT/CATAPHRACT → DRAGOON (enlightenment)
    DRAGOON:      { obsoletes: ['CAVALRY', 'CHARIOT', 'CATAPHRACT'], tech: 'FLINTLOCK' },

    // Siege line: CATAPULT → TREBUCHET → ARTILLERY → CANNON → SIEGE_CANNON/FIELD_GUN
    TREBUCHET:    { obsoletes: ['CATAPULT'],                       tech: 'SIEGE_CRAFT' },
    MORTAR:       { obsoletes: ['CATAPULT', 'TREBUCHET'],          tech: 'EXPLOSIVES' },
    // ARTILLERY (GUNPOWDER) also retires SIEGE (a roster unit some factions
    // hold, e.g. Iron) and CATAPULT directly — otherwise a faction that
    // reaches GUNPOWDER without SIEGE_CRAFT keeps spamming CATAPULT/SIEGE
    // despite having gunpowder artillery unlocked.
    // SIEGE_TOWER joins the retirement list from GUNPOWDER on: gunpowder
    // artillery replaces engineer-built towers (the AI's engineer tower-build
    // gate uses the same techs), and SIEGE_TOWER is trainable via EXTRA_UNITS
    // so without this the spending spree keeps queuing towers next to cannons.
    ARTILLERY:    { obsoletes: ['TREBUCHET', 'CATAPULT', 'SIEGE', 'SIEGE_TOWER'], tech: 'GUNPOWDER' },
    CANNON:       { obsoletes: ['ARTILLERY', 'TREBUCHET', 'CATAPULT', 'SIEGE', 'SIEGE_TOWER'], tech: 'METALLURGY' },
    // Modern siege (EXPLOSIVES / FIELD_ARTILLERY) also retires the levies and
    // the engineer siege corps: a faction with shell guns fields rifles +
    // artillery, not INFANTRY mobs and SIEGE_TOWER engineers. (ENGINEER here
    // covers roster/spree training; the AI's explicit engineer block gates
    // separately so bridge/defense utility isn't lost mid-turn.)
    SIEGE_CANNON: { obsoletes: ['SIEGE', 'CANNON', 'MORTAR', 'ARTILLERY', 'TREBUCHET', 'CATAPULT', 'SIEGE_TOWER', 'INFANTRY', 'ENGINEER'], tech: 'EXPLOSIVES' },
    FIELD_GUN:    { obsoletes: ['ARTILLERY', 'CANNON', 'MORTAR', 'CATAPULT', 'TREBUCHET', 'SIEGE', 'SIEGE_TOWER', 'INFANTRY', 'ENGINEER'], tech: 'FIELD_ARTILLERY' },

    // Naval line: GALLEY → FRIGATE → IRONCLAD; TRANSPORT → STEAM_TRANSPORT
    FRIGATE:      { obsoletes: ['GALLEY'],                          tech: 'CARTOGRAPHY' },
    IRONCLAD:     { obsoletes: ['FRIGATE', 'GALLEON', 'GALLEASS', 'GALLEY'], tech: 'STEAM_ENGINE' },
    STEAM_TRANSPORT: { obsoletes: ['TRANSPORT'],                   tech: 'STEAM_ENGINE' },
    IRONCLAD_FRIGATE: { obsoletes: ['IRONCLAD', 'MAN_OF_WAR', 'FRIGATE', 'GALLEON', 'GALLEASS', 'GALLEY'], tech: 'IRONCLADS' },
    // Atomic-era naval: the dreadnought line obsoletes all the sail/ironclad
    // warships; TRANSPORT_SHIP obsoletes STEAM_TRANSPORT; the improved sub
    // retires the original. Carriers and battleships coexist (different roles).
    DESTROYER:    { obsoletes: ['IRONCLAD_FRIGATE', 'MONITOR', 'IRONCLAD', 'FRIGATE_2', 'FROLIC', 'CORVETTE', 'FRIGATE', 'MAN_OF_WAR', 'GALLEON', 'GALLEASS', 'GALLEY', 'GUNBOAT', 'PINNACE'], tech: 'DREADNOUGHT' },
    BATTLESHIP:   { obsoletes: ['IRONCLAD_FRIGATE', 'MONITOR', 'FROLIC', 'MAN_OF_WAR', 'GALLEON'], tech: 'DREADNOUGHT' },
    TRANSPORT_SHIP: { obsoletes: ['STEAM_TRANSPORT', 'TRANSPORT', 'MERCHANTMAN'], tech: 'DREADNOUGHT' },
    SUBMARINE_II: { obsoletes: ['SUBMARINE', 'TORPEDO_BOAT'],                      tech: 'NAVAL_AVIATION' },

    // Atomic-era land: mobilized units obsolete their foot-bound predecessors.
    // MOBILIZED_INFANTRY retires RIFLEMAN/SHARPSHOOTER/LINE_INFANTRY (the
    // motorized column replaces the marching line); MOBILIZED_ARTILLERY
    // retires FIELD_GUN/HORSE_ARTILLERY/CANNON/MORTAR (towed guns replace the
    // horse-drawn battery). MOTOR_ARTILLERY (self-propelled) further retires
    // SIEGE_CANNON/RAILGUN — its shoot-and-scoot supersedes the fixed emplacement.
    MOBILIZED_INFANTRY: { obsoletes: ['RIFLEMAN', 'SHARPSHOOTER', 'LINE_INFANTRY', 'MUSKETEER', 'ARQUEBUSIER', 'DRAGOON', 'INFANTRY', 'BERSERKER', 'LEGIONNAIRE', 'VARANGIAN_GUARD', 'WINGED_HUSSAR', 'CONQUISTADOR', 'MERCENARY_KNIGHT', 'HOUSEHOLD_GUARD', 'FRONTIERSMAN', 'RAIDER'], tech: 'INTERNAL_COMBUSTION' },
    // NOTE: MOBILIZED_ARTILLERY no longer obsoletes ENGINEER — the engineer
    // line has its own modern upgrade (COMBAT_ENGINEER) that retires the
    // classical ENGINEER while keeping the bridge/structure utility the AI
    // relies on. Removing ENGINEER here would leave a faction with no
    // structure-builder until COMBAT_ENGINEER is researched.
    MOBILIZED_ARTILLERY: { obsoletes: ['FIELD_GUN', 'HORSE_ARTILLERY', 'CANNON', 'MORTAR', 'ARTILLERY', 'CATAPULT', 'TREBUCHET', 'SIEGE', 'SIEGE_TOWER'], tech: 'INTERNAL_COMBUSTION' },
    MOTOR_ARTILLERY: { obsoletes: ['SIEGE_CANNON', 'RAILGUN', 'MOBILIZED_ARTILLERY', 'FIELD_GUN', 'HORSE_ARTILLERY', 'CANNON', 'MORTAR'], tech: 'ADVANCED_ARTILLERY' },
    // Combat engineer: the modern engineer upgrade. Obsoletes the classical
    // ENGINEER and the DEMOLITION_SQUAD (it absorbs both roles — structure/
    // bridge utility + demolish bonus — with better stats and mobility).
    COMBAT_ENGINEER: { obsoletes: ['ENGINEER', 'DEMOLITION_SQUAD'], tech: 'INTERNAL_COMBUSTION' },
    // Tanks (ARMOR) obsolete all horse cavalry — they are the modern cavalry.
    // CATAPHRACT/CHARIOT/CAVALRY/WINGED_HUSSAR/DRAGOON/CONQUISTADOR/
    // MERCENARY_KNIGHT/FRONTIERSMAN all retire once TANK is unlocked.
    // HEAVY_TANK is a slower, tankier alternative — it coexists with TANK
    // (both stay trainable) so a player can mix the two.
    TANK:         { obsoletes: ['CATAPHRACT', 'CHARIOT', 'CAVALRY', 'WINGED_HUSSAR', 'DRAGOON', 'CONQUISTADOR', 'MERCENARY_KNIGHT', 'FRONTIERSMAN', 'ARMORED_CAR', 'ARMORED_TRAIN'], tech: 'ARMOR' },
    // Anti-armor chain: BAYONET_RIFLE obsoletes the medieval/enlightenment
    // anti-cavalry line (the bayonet replaces the pike). ANTI_TANK_GUN and
    // RPG_TEAM are successive upgrades — RPG_TEAM (ROCKETRY) is the capstone,
    // retiring ANTI_TANK_GUN and BAYONET_RIFLE so the line converges on one
    // modern anti-tank unit.
    BAYONET_RIFLE: { obsoletes: ['HALBERDIER', 'PIKE_MASTER', 'PIKEMAN'], tech: 'ANTI_ARMOR' },
    ANTI_TANK_GUN: { obsoletes: ['BAYONET_RIFLE', 'HALBERDIER', 'PIKE_MASTER', 'PIKEMAN'], tech: 'ANTI_ARMOR' },
    RPG_TEAM:     { obsoletes: ['ANTI_TANK_GUN', 'BAYONET_RIFLE', 'HALBERDIER', 'PIKE_MASTER', 'PIKEMAN'], tech: 'ROCKETRY' },

    // Anti-cavalry line: PIKE_MASTER obsoletes HALBERDIER (the enlightenment
    // long-pike replaces the medieval halberd in the same anti-cavalry role).
    PIKE_MASTER:  { obsoletes: ['HALBERDIER'],                      tech: 'PIKE_WARFARE' },
};

/** Given a set of researched tech ids, return the set of unit types now obsolete.
 *  Pure: iterates the OBSOLESCENCE table once. */
export function getObsoleteUnits(researchedSet) {
    const obsolete = new Set();
    if (!researchedSet) return obsolete;
    for (const [modern, def] of Object.entries(OBSOLESCENCE)) {
        if (researchedSet.has(def.tech)) {
            for (const old of def.obsoletes) obsolete.add(old);
        }
    }
    return obsolete;
}

/** Filter a roster array, removing any unit type that is now obsolete.
 *  Pure: returns a new array. */
export function applyObsolescence(roster, researchedSet) {
    if (!roster || !roster.length) return roster || [];
    const obsolete = getObsoleteUnits(researchedSet);
    if (obsolete.size === 0) return roster.slice();
    return roster.filter(u => !obsolete.has(u));
}

/** True if `unitType` is obsolete given the researched tech set. */
export function isObsolete(unitType, researchedSet) {
    return getObsoleteUnits(researchedSet).has(unitType);
}