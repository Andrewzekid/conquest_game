/** Technology tree: era-gated research that unlocks units, buildings, and bonuses.
 *  All functions are pure — they operate on a techState object passed in. */

// --- Tech definitions ---
// Each tech has: id, name, era, cost, prerequisites (array of tech ids),
// unlocks (array of { type: 'unit'|'building'|'ability', id: string }),
// and bonus (object with aggregate gameplay effects).
export const TECHS = {
    // === ANCIENT ERA (free starting techs) ===
    ARCHERY: {
        id: 'ARCHERY', name: 'Archery', era: 'ancient', cost: 40,
        prerequisites: [],
        unlocks: [{ type: 'unit', id: 'ARCHER' }, { type: 'unit', id: 'LONGBOWMAN' }],
        bonus: {},
        desc: 'Unlocks Archer and Longbowman units.'
    },
    BRONZE_WORKING: {
        id: 'BRONZE_WORKING', name: 'Bronze Working', era: 'ancient', cost: 40,
        prerequisites: [],
        unlocks: [{ type: 'unit', id: 'PIKEMAN' }, { type: 'unit', id: 'LEGIONNAIRE' }],
        bonus: {},
        desc: 'Unlocks Pikeman and Legionnaire units and Mine improvement efficiency.'
    },
    ANIMAL_HUSBANDRY: {
        id: 'ANIMAL_HUSBANDRY', name: 'Animal Husbandry', era: 'ancient', cost: 40,
        prerequisites: [],
        unlocks: [{ type: 'unit', id: 'CAVALRY' }],
        bonus: {},
        desc: 'Unlocks Cavalry unit and Farm improvement efficiency.'
    },

    // === CLASSICAL ERA ===
    MATHEMATICS: {
        id: 'MATHEMATICS', name: 'Mathematics', era: 'classical', cost: 80,
        prerequisites: ['ARCHERY'],
        unlocks: [{ type: 'unit', id: 'CATAPULT' }, { type: 'building', id: 'MARKET' }],
        bonus: {},
        desc: 'Unlocks Catapult and Market building.'
    },
    ENGINEERING: {
        id: 'ENGINEERING', name: 'Engineering', era: 'classical', cost: 80,
        prerequisites: ['BRONZE_WORKING'],
        unlocks: [],
        bonus: { engineerBuildSpeed: 1.5, canBuildBridge: true },
        desc: 'Engineers build 50% faster. Bridges can be constructed.'
    },
    NAVAL_ENGINEERING: {
        id: 'NAVAL_ENGINEERING', name: 'Naval Engineering', era: 'classical', cost: 80,
        prerequisites: ['ANIMAL_HUSBANDRY'],
        unlocks: [{ type: 'building', id: 'HARBOR' }, { type: 'unit', id: 'GALLEY' }, { type: 'unit', id: 'TRANSPORT' }],
        bonus: {},
        desc: 'Unlocks Harbor building, Galley, and Transport ships.'
    },
    SIEGE_CRAFT: {
        id: 'SIEGE_CRAFT', name: 'Siege Craft', era: 'classical', cost: 80,
        prerequisites: ['BRONZE_WORKING', 'MATHEMATICS'],
        unlocks: [{ type: 'building', id: 'SIEGE_WORKSHOP' }, { type: 'unit', id: 'TREBUCHET' }],
        bonus: {},
        desc: 'Unlocks Siege Workshop building and Trebuchet.'
    },

    // === MEDIEVAL ERA ===
    FORTIFICATION: {
        id: 'FORTIFICATION', name: 'Fortification', era: 'medieval', cost: 150,
        prerequisites: ['ENGINEERING'],
        unlocks: [{ type: 'building', id: 'WALLS' }, { type: 'unit', id: 'CROSSBOWMAN' }, { type: 'unit', id: 'VARANGIAN_GUARD' }],
        bonus: { cityDefenseBonus: 2 },
        desc: 'Unlocks Walls, Crossbowman, and Varangian Guard. Cities gain +2 defense.'
    },
    CHIVALRY: {
        id: 'CHIVALRY', name: 'Chivalry', era: 'medieval', cost: 150,
        prerequisites: ['MATHEMATICS', 'ANIMAL_HUSBANDRY'],
        unlocks: [{ type: 'unit', id: 'CATAPHRACT' }, { type: 'unit', id: 'CHARIOT' }, { type: 'unit', id: 'BERSERKER' }, { type: 'unit', id: 'WINGED_HUSSAR' }],
        bonus: { lordXpBonus: 0.25 },
        desc: 'Unlocks Cataphract, Chariot, Berserker, and Winged Hussar. Lords gain 25% more XP.'
    },
    CARTOGRAPHY: {
        id: 'CARTOGRAPHY', name: 'Cartography', era: 'medieval', cost: 150,
        prerequisites: ['NAVAL_ENGINEERING'],
        unlocks: [{ type: 'unit', id: 'FRIGATE' }, { type: 'unit', id: 'GALLEON' }],
        bonus: { navalVisionBonus: 2 },
        desc: 'Unlocks Frigate and Galleon. Naval units gain +2 vision.'
    },
    FEUDALISM: {
        id: 'FEUDALISM', name: 'Feudalism', era: 'medieval', cost: 150,
        prerequisites: ['SIEGE_CRAFT'],
        unlocks: [{ type: 'unit', id: 'SIEGE_TOWER' }],
        bonus: { cityLoyaltyBonus: 1 },
        desc: 'Unlocks Siege Tower. Cities gain +1 loyalty.'
    },

    // === INDUSTRIAL ERA ===
    GUNPOWDER: {
        id: 'GUNPOWDER', name: 'Gunpowder', era: 'industrial', cost: 250,
        prerequisites: ['SIEGE_CRAFT', 'CHIVALRY'],
        unlocks: [{ type: 'unit', id: 'ARTILLERY' }, { type: 'unit', id: 'CONQUISTADOR' }],
        bonus: { rangedDamageBonus: 1 },
        desc: 'Unlocks Artillery and Conquistador. Ranged units deal +1 damage.'
    },
    MEDICINE: {
        id: 'MEDICINE', name: 'Medicine', era: 'industrial', cost: 250,
        prerequisites: ['FEUDALISM'],
        unlocks: [{ type: 'unit', id: 'MEDIC' }],
        bonus: { medicHealBonus: 2, starvationReduction: 1 },
        desc: 'Unlocks Medic. Healers heal +2 more. Starvation reduced.'
    },
    MACHINERY: {
        id: 'MACHINERY', name: 'Machinery', era: 'industrial', cost: 250,
        prerequisites: ['ENGINEERING', 'FORTIFICATION'],
        unlocks: [{ type: 'unit', id: 'WORKER' }],
        bonus: { workerBuildSpeed: 2 },
        desc: 'Unlocks Worker improvements. Workers build twice as fast.'
    },
    MASS_PRODUCTION: {
        id: 'MASS_PRODUCTION', name: 'Mass Production', era: 'industrial', cost: 250,
        prerequisites: ['CARTOGRAPHY', 'MEDICINE'],
        unlocks: [],
        bonus: { settlerCostReduction: 0.3, extraTradeRoute: 1 },
        desc: 'Settlers cost 30% less. Each city gets +1 trade route.'
    }
};

// Era progression order
export const ERA_ORDER = ['ancient', 'classical', 'medieval', 'industrial'];

// Era display names
export const ERA_NAMES = {
    ancient: 'Ancient Era',
    classical: 'Classical Era',
    medieval: 'Medieval Era',
    industrial: 'Industrial Era'
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
        canBuildBridge: false
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
export function calculateResearchOutput(tiles, owner) {
    let total = 0;
    for (const tile of tiles.values()) {
        if (tile.owner === owner && tile.terrain === 'CITY') {
            total += tile.cityLevel || 1;
        }
    }
    return total;
}
