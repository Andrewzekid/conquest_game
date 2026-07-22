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
export const OBSOLESCENCE = {
    // Ranged line: ARCHER → CROSSBOWMAN → MUSKETEER → RIFLEMAN/SHARPSHOOTER
    CROSSBOWMAN:  { obsoletes: ['ARCHER', 'LONGBOWMAN'],          tech: 'FORTIFICATION' },
    MUSKETEER:    { obsoletes: ['CROSSBOWMAN'],                    tech: 'MATCHLOCK' },
    RIFLEMAN:     { obsoletes: ['MUSKETEER', 'ARQUEBUSIER'],       tech: 'RIFLED_MUSKET' },
    SHARPSHOOTER: { obsoletes: [],                                  tech: 'RIFLED_MUSKET' }, // peer, no extra obsoletes

    // Melee line: INFANTRY/LEGIONNAIRE → LINE_INFANTRY
    LINE_INFANTRY:{ obsoletes: ['INFANTRY', 'LEGIONNAIRE'],        tech: 'FLINTLOCK' },

    // Cavalry line: CAVALRY → CATAPHRACT/CHARIOT (medieval) → DRAGOON (enlightenment)
    DRAGOON:      { obsoletes: ['CAVALRY', 'CHARIOT'],             tech: 'FLINTLOCK' },

    // Siege line: CATAPULT → TREBUCHET → ARTILLERY → CANNON → SIEGE_CANNON/FIELD_GUN
    TREBUCHET:    { obsoletes: ['CATAPULT'],                       tech: 'SIEGE_CRAFT' },
    ARTILLERY:    { obsoletes: ['TREBUCHET'],                      tech: 'GUNPOWDER' },
    CANNON:       { obsoletes: ['ARTILLERY'],                      tech: 'METALLURGY' },
    SIEGE_CANNON: { obsoletes: ['SIEGE', 'CANNON', 'MORTAR'],      tech: 'EXPLOSIVES' },
    FIELD_GUN:    { obsoletes: [],                                  tech: 'FIELD_ARTILLERY' }, // SIEGE_CANNON already covers CANNON/MORTAR

    // Naval line: GALLEY → FRIGATE → IRONCLAD; TRANSPORT → STEAM_TRANSPORT
    FRIGATE:      { obsoletes: ['GALLEY'],                          tech: 'CARTOGRAPHY' },
    IRONCLAD:     { obsoletes: ['FRIGATE', 'GALLEON', 'GALLEASS'], tech: 'STEAM_ENGINE' },
    STEAM_TRANSPORT: { obsoletes: ['TRANSPORT'],                   tech: 'STEAM_ENGINE' },
    IRONCLAD_FRIGATE: { obsoletes: ['IRONCLAD', 'MAN_OF_WAR'],     tech: 'IRONCLADS' },
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