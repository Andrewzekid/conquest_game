// --- Game Configuration ---
// Mutable live binding: game.js sets these at startup based on chosen map size.
// Importers read them at call time, so they pick up the chosen dimensions.
export let GRID_WIDTH = 40;
export let GRID_HEIGHT = 40;
export let GRID_SIZE = 40; // Legacy: equals width for compatibility
export const TILE_SIZE = 1;

// Tile count-based map sizes with player count recommendations
export const MAP_SIZES = {
    tiny:   { tiles: 400,  players: 3, name: 'Tiny' },
    small:  { tiles: 800,  players: 5, name: 'Small' },
    medium: { tiles: 1600, players: 7, name: 'Medium' },
    large:  { tiles: 2500, players: 9, name: 'Large' },
    huge:   { tiles: 4000, players: 10, name: 'Huge' },
    epic:   { tiles: 6000, players: 10, name: 'Epic' }
};

// Calculate actual dimensions from tile count with random aspect ratio
export function calculateMapDimensions(sizeKey) {
    const size = MAP_SIZES[sizeKey] || MAP_SIZES.medium;
    const targetTiles = size.tiles;
    // Aspect ratio between 0.65 (tall) and 1.5 (wide)
    const aspect = 0.65 + Math.random() * 0.85;
    const width = Math.round(Math.sqrt(targetTiles * aspect));
    const height = Math.round(targetTiles / width);
    return { width, height, totalTiles: width * height };
}

export function setGridDimensions(width, height) {
    GRID_WIDTH = width;
    GRID_HEIGHT = height;
    GRID_SIZE = Math.max(width, height); // Legacy compatibility
}

// Terrain types. `key` is the string identifier used in tile.terrain (fixes map/renderer mismatch).
export const TERRAIN = {
    PLAINS:   { key: 'PLAINS',   color: 0x7cfc00, name: 'Plains',   resource: 'food',  amount: 2,  defense: 0 },
    FOREST:   { key: 'FOREST',   color: 0x228b22, name: 'Forest',   resource: 'wood',  amount: 3,  defense: 1 },
    MOUNTAIN: { key: 'MOUNTAIN', color: 0x7d6b58, name: 'Mountain', resource: 'iron',  amount: 3,  defense: 3 },
    HILLS:    { key: 'HILLS',    color: 0x9aaa55, name: 'Hills',    resource: 'iron',  amount: 2,  defense: 1 },
    DESERT:   { key: 'DESERT',   color: 0xe6d08a, name: 'Desert',   resource: 'gold',  amount: 2,  defense: 0 },
    MARSH:    { key: 'MARSH',    color: 0x4f6b53, name: 'Marsh',    resource: 'food',  amount: 2,  defense: 0 },
    TUNDRA:   { key: 'TUNDRA',   color: 0xc6d4d0, name: 'Tundra',  resource: 'food',  amount: 2,  defense: 1 },
    WATER:    { key: 'WATER',    color: 0x2f6fb0, name: 'Water',    resource: null,    amount: 0,  defense: 0 },
    RIVER:    { key: 'RIVER',    color: 0x2f90d8, name: 'River',    resource: 'food',  amount: 2,  defense: 0 },
    CITY:     { key: 'CITY',     color: 0xc9b06b, name: 'City',     resource: 'gold',  amount: 8,  defense: 3, wood: 1 }
};

export const UNIT_TYPE = {
    INFANTRY:    { name: 'Infantry',     hp: 10, attack: 3, defense: 2, moveRange: 2, upkeep: { food: 3, gold: 2 }, ranged: false, attackRange: 1 },
    ARCHER:      { name: 'Archer',       hp: 8,  attack: 4, defense: 1, moveRange: 2, upkeep: { food: 2, gold: 3 }, ranged: true, attackRange: 2 },
    ARTILLERY:   { name: 'Artillery',    hp: 6,  attack: 7, defense: 0, moveRange: 1, upkeep: { food: 4, gold: 5, iron: 2 }, siegeBonus: 3, besiege: true, besiegePower: 1, ranged: true, attackRange: 2 },
    CAVALRY:     { name: 'Cavalry',      hp: 12, attack: 5, defense: 3, moveRange: 3, upkeep: { food: 4, gold: 4 }, ranged: false, attackRange: 1 },
    PIKEMAN:     { name: 'Pikeman',      hp: 12, attack: 4, defense: 4, moveRange: 2, upkeep: { food: 3, gold: 3 }, ranged: false, attackRange: 1 },
    SCOUT:       { name: 'Scout',        hp: 6,  attack: 2, defense: 1, moveRange: 4, upkeep: { food: 1, gold: 1 }, vision: 5, ranged: false, attackRange: 1 },
    SIEGE:       { name: 'Siege',        hp: 14, attack: 3, defense: 2, moveRange: 2, upkeep: { food: 4, gold: 4, wood: 2, iron: 1 }, besiege: true, besiegePower: 2, ranged: true, attackRange: 2 },
    SETTLER:     { name: 'Settler',      hp: 6,  attack: 1, defense: 1, moveRange: 2, upkeep: { food: 3, gold: 2 }, canFoundCity: true, buildTurns: 2, ranged: false, attackRange: 1 },
    ENGINEER:    { name: 'Engineer',     hp: 8,  attack: 2, defense: 2, moveRange: 2, upkeep: { food: 2, gold: 2, wood: 1 }, canBuildBridge: true, canBuildSiegeTower: true, canBuildStructure: true, ranged: false, attackRange: 1 },
    // Worker: a Civ-style improvement builder. It travels the map and constructs
    // terrain improvements (FARM/LUMBERMILL/MINE) on owned tiles within a city's
    // influence radius, spending its action to do so.
    WORKER:      { name: 'Worker',      hp: 6,  attack: 0, defense: 1, moveRange: 2, upkeep: { food: 2, gold: 1 }, canBuildImprovement: true, ranged: false, attackRange: 1 },
    // New land units.
    LONGBOWMAN:  { name: 'Longbowman',   hp: 8,  attack: 5, defense: 1, moveRange: 1, upkeep: { food: 2, gold: 4, wood: 1 }, ranged: true, attackRange: 3, siegeBonus: 1, vision: 4 },
    CATAPHRACT:  { name: 'Cataphract',   hp: 16, attack: 6, defense: 5, moveRange: 2, upkeep: { food: 5, gold: 5, iron: 2 }, ranged: false, attackRange: 1 },
    // Chariot: a fast striker that can perform a straight-line CHARGE up to 3
    // tiles (orthogonal only) dealing massive damage — but the charge stuns the
    // chariot itself for 2 turns afterward. It cannot move and charge on the
    // same turn. On a normal turn it moves/attacks like a light melee unit.
    CHARIOT:     { name: 'Chariot',      hp: 11, attack: 4, defense: 2, moveRange: 3, upkeep: { food: 3, gold: 4, wood: 1, iron: 1 }, ranged: false, attackRange: 1, canCharge: true },
    MEDIC:       { name: 'Medic',        hp: 7,  attack: 1, defense: 2, moveRange: 2, upkeep: { food: 2, gold: 3 }, heal: 2, ranged: false, attackRange: 1 },
    SIEGE_TOWER: { name: 'Siege Tower', hp: 20, attack: 4, defense: 4, moveRange: 1, upkeep: { food: 3, gold: 4, wood: 2, iron: 2 }, besiege: true, besiegePower: 3, canAssault: true, ranged: false, attackRange: 1 },
    // Long-range siege engines (unlocked by a Siege Workshop building in a city).
    // Both deal AOE splash to enemy units adjacent to the target and can set the
    // area ablaze (a burn DoT on primary + splash victims).
    CATAPULT:    { name: 'Catapult',   hp: 12, attack: 7, defense: 2, moveRange: 2, upkeep: { food: 3, gold: 6, wood: 2, iron: 2 }, besiege: true, besiegePower: 2, ranged: true, attackRange: 4, aoe: true, canSetFire: true, buildTurns: 2 },
    TREBUCHET:   { name: 'Trebuchet',  hp: 10, attack: 9, defense: 1, moveRange: 1, upkeep: { food: 3, gold: 7, wood: 3, iron: 3 }, besiege: true, besiegePower: 3, ranged: true, attackRange: 4, aoe: true, canSetFire: true, buildTurns: 2 },
    // Naval units (unlocked by a Harbor building in a coastal/river city).
    GALLEY:      { name: 'Galley',       hp: 14, attack: 6, defense: 3, moveRange: 4, upkeep: { food: 3, gold: 5, wood: 2, iron: 1 }, naval: true, ranged: true, attackRange: 3, vision: 5 },
    TRANSPORT:   { name: 'Transport',    hp: 12, attack: 1, defense: 3, moveRange: 3, upkeep: { food: 2, gold: 4, wood: 1, iron: 1 }, naval: true, capacity: 2, ranged: false, attackRange: 1 },
    FRIGATE:     { name: 'Frigate',      hp: 20, attack: 8, defense: 4, moveRange: 4, upkeep: { food: 4, gold: 7, wood: 3, iron: 2 }, naval: true, ranged: true, attackRange: 3, vision: 5 },
    GALLEON:     { name: 'Galleon',      hp: 28, attack: 10, defense: 6, moveRange: 3, upkeep: { food: 5, gold: 8, wood: 4, iron: 3 }, naval: true, ranged: true, attackRange: 3, vision: 4, besiege: true, besiegePower: 1 }
};

// Units available to every faction in addition to its themed roster. Ships
// (GALLEY/TRANSPORT) are NOT here — they're unlocked per-city by a Harbor.
export const EXTRA_UNITS = ['SETTLER', 'ENGINEER', 'WORKER', 'CAVALRY', 'CHARIOT', 'LONGBOWMAN', 'CATAPHRACT', 'MEDIC', 'SIEGE_TOWER'];
export const NAVAL_UNITS = ['GALLEY', 'TRANSPORT', 'FRIGATE', 'GALLEON'];
// Long-range siege engines, unlocked per-city by a Siege Workshop (mirrors the
// Harbor→ships gating). Not part of any faction roster by default.
export const SIEGE_ENGINES = ['CATAPULT', 'TREBUCHET'];

// Terrain bonuses: bonus_defense or bonus_attack added in combat
export const TERRAIN_BONUS = {
    PLAINS:   { defense: 0,  attack: 0 },
    FOREST:   { defense: 2,  attack: 0 },      // Forest provides cover
    MOUNTAIN: { defense: 3,  attack: 0 },      // High ground advantage
    HILLS:    { defense: 1,  attack: 1 },      // High ground, mild
    DESERT:   { defense: -1, attack: 0 },      // Exposed
    MARSH:    { defense: -1, attack: -1 },     // Boggy, hard to fight
    TUNDRA:   { defense: 1,  attack: 0 },      // Cold, sparse cover
    WATER:    { defense: -2, attack: 0 },      // No cover, exposed crossing
    RIVER:    { defense: -2, attack: 0 },      // Crossing a river — exposed
    CITY:     { defense: 2,  attack: 1 }       // Fortifications + organized militia
};

export const UNIT_COST = {
    INFANTRY:    { gold: 30, food: 10, wood: 0,  iron: 0,  production: 10 },
    ARCHER:      { gold: 40, food: 0,  wood: 20, iron: 0,  production: 15 },
    ARTILLERY:   { gold: 80, food: 0,  wood: 30, iron: 30, production: 30 },
    CAVALRY:     { gold: 50, food: 30, wood: 0,  iron: 10, production: 20 },
    PIKEMAN:     { gold: 45, food: 10, wood: 10, iron: 10, production: 15 },
    SCOUT:       { gold: 25, food: 5,  wood: 5,  iron: 0,  production: 8 },
    SIEGE:       { gold: 75, food: 10, wood: 15, iron: 15, production: 25 },
    SETTLER:     { gold: 50, food: 25, wood: 0,  iron: 0,  production: 20 },
    ENGINEER:    { gold: 60, food: 10, wood: 20, iron: 10, production: 20 },
    WORKER:      { gold: 30, food: 10, wood: 5,  iron: 0,  production: 10 },
    LONGBOWMAN:  { gold: 60, food: 0,  wood: 25, iron: 0,  production: 18 },
    CATAPHRACT:  { gold: 90, food: 20, wood: 0,  iron: 15, production: 25 },
    CHARIOT:     { gold: 65, food: 20, wood: 15, iron: 10, production: 20 },
    MEDIC:       { gold: 55, food: 10, wood: 10, iron: 0,  production: 15 },
    SIEGE_TOWER: { gold: 70, food: 10, wood: 15, iron: 15, production: 25 },
    CATAPULT:    { gold: 120, food: 0,  wood: 15, iron: 30, production: 35 },
    TREBUCHET:   { gold: 150, food: 0,  wood: 20, iron: 40, production: 45 },
    GALLEY:      { gold: 70, food: 10, wood: 40, iron: 0,  production: 20 },
    TRANSPORT:   { gold: 60, food: 5,  wood: 30, iron: 0,  production: 25 },
    FRIGATE:     { gold: 100, food: 15, wood: 50, iron: 10, production: 28 },
    GALLEON:     { gold: 150, food: 20, wood: 60, iron: 20, production: 35 }
};

// Cost to build a bridge across a river tile.
export const BRIDGE_COST = { gold: 40, wood: 20 };

// Cost for an Engineer to start constructing a Siege Tower (paid up front; the
// tower is built over SIEGE_TOWER_BUILD_TURNS turns, then spawns on completion).
export const SIEGE_TOWER_COST = { gold: 80, wood: 20, iron: 20, production: 30 };
export const SIEGE_TOWER_BUILD_TURNS = 3;
export const SIEGE_TOWER_BUILD_RADIUS = 2; // Engineer must be within this Chebyshev radius of an enemy city

// Engineers can only build Siege Towers (not CATAPULT/TREBUCHET).
// Long-range siege engines require a Siege Workshop building in a city.
// Removed SIEGE_ENGINE_BUILD_COST to restrict engineers to Siege Towers only.

// Cost for an Engineer to construct Ladders (cheaper alternative to siege tower,
// allows infantry to assault fortified cities). Requires wood, built in 1 turn.
export const LADDER_COST = { gold: 30, wood: 15 };
export const LADDER_BUILD_TURNS = 1;
export const LADDER_BUILD_RADIUS = 2; // Engineer must be within this Chebyshev radius of an enemy city

// Type advantage system (rock-paper-scissors bonus)
export const TYPE_ADVANTAGE = {
    INFANTRY:    { strongAgainst: 'ARCHER',    multiplier: 1.4 },
    ARCHER:      { strongAgainst: 'ARTILLERY', multiplier: 1.4 },
    ARTILLERY:   { strongAgainst: 'CAVALRY',   multiplier: 1.4 },
    CAVALRY:     { strongAgainst: 'INFANTRY',  multiplier: 1.4 },
    PIKEMAN:     { strongAgainst: 'CAVALRY',   multiplier: 1.5 },
    CATAPHRACT:  { strongAgainst: 'INFANTRY',  multiplier: 1.5 },
    CHARIOT:     { strongAgainst: 'ARCHER',    multiplier: 1.4 },
    // Naval type advantages
    FRIGATE:     { strongAgainst: 'GALLEY',    multiplier: 1.5 },
    GALLEON:     { strongAgainst: 'FRIGATE',   multiplier: 1.4 }
};

export const CAPTURE_COST = 20; // Gold to capture an unowned tile

// Pillage: a military unit can destroy an enemy terrain improvement on an
// adjacent tile, pocketing a gold reward. One improvement per pillage action.
export const PILLAGE_GOLD_REWARD = 15;
export const PILLAGEABLE_BUILDINGS = ['FARM', 'LUMBERMILL', 'MINE'];

// AOE/fire ailment tuning for siege engines (CATAPULT, TREBUCHET).
export const AOE_RADIUS = 1;            // Chebyshev radius around the target tile for splash
export const AOE_SPLASH_FRACTION = 0.5; // splash dmg = floor(primaryDmg * this), min 1
export const BURN_TURNS = 2;            // how many turns a fire ailment lasts
export const BURN_DAMAGE_PER_TURN = 2;  // hp lost per turn while burning

// --- Concealment / Ambush system ---
// Units can hide in MOUNTAIN or FOREST terrain when outside enemy vision.
// Setting up concealment takes 1-2 turns (depending on terrain). Once concealed,
// units are invisible to enemies. When an enemy enters the same or adjacent tile,
// concealed units may reveal for a surprise attack with combat bonuses.
export const CONCEAL_TERRAINS = ['MOUNTAIN', 'FOREST'];  // terrain types that allow concealment
export const CONCEAL_TURNS_MOUNTAIN = 2;  // turns to conceal in mountains (harder terrain)
export const CONCEAL_TURNS_FOREST = 1;    // turns to conceal in forests (easier)
export const CONCEAL_MAX_PER_TILE = 2;    // max units that can conceal on one tile
// Concealment timeout: a hidden unit that no enemy ever approaches gives up
// its ambush after this many turns and advances. Without it, two AIs that
// conceal their front lines stare at each other forever.
export const CONCEAL_MAX_TURNS = 3;          // turns concealed before auto-reveal
export const CONCEAL_REVEAL_COOLDOWN = 3;    // can't re-conceal for this many turns after a timeout reveal
export const AMBUSH_ATTACK_BONUS = 3;     // bonus attack when revealing for surprise attack
export const AMBUSH_DEFENSE_BONUS = 2;    // bonus defense when ambushed unit counter-attacks

// --- Encirclement ---
// A defender with no orthogonal escape tile AND >=2 adjacent enemy units is
// "encircled": it takes a defense penalty and cannot counter-attack. This is a
// positional mechanic (surround the enemy), symmetric for player and AI.
export const ENCIRCLEMENT_DEFENSE_PENALTY = 2;

// --- Counter-attacks ---
// Only melee defenders counter-attack, and only against melee attackers — a
// unit being shot from range cannot strike back. Counter-attacks are also
// weaker than full attacks (the defender is reacting, not pressing).
export const COUNTER_ATTACK_MULTIPLIER = 0.6;

// --- Cavalry Charge ---
// Cavalry (and Cataphract) units can charge an adjacent enemy, moving onto the
// enemy's tile and attacking with a bonus. After charging, the unit cannot move
// for the rest of the turn (hasMovedThisTurn is set). Charge range is 1 tile
// (orthogonal or diagonal adjacent).
export const CHARGE_UNITS = ['CAVALRY', 'CATAPHRACT'];  // unit types that can charge
export const CHARGE_ATTACK_BONUS = 2;     // bonus attack when charging
export const CHARGE_RANGE = 1;            // Chebyshev distance for charge target
// After charging, cavalry is exhausted: it cannot move on its next turn and
// takes extra damage from ranged attackers (archers/artillery) while exhausted.
// The counter is consumed over two round-resets: at the first reset it imposes
// immobility (and leaves the unit vulnerable for that turn); at the second it
// clears. Set to 2 so the effect spans exactly one full turn.
export const CHARGE_EXHAUST_TURNS = 2;          // post-charge exhaustion counter start value
export const CHARGE_EXHAUST_RANGED_VULN = 1.5;  // ranged damage multiplier vs exhausted cavalry

// --- Chariot Charge ---
// The Chariot performs a devastating straight-line charge of up to
// CHARIOT_CHARGE_RANGE tiles in one of the four ORTHOGONAL directions (left,
// right, up, down). Every enemy in the charge lane is struck; infantry and
// artillery are especially vulnerable (CHARIOT_CHARGE_VULN_MULT). The chariot
// cannot move and charge on the same turn, and after charging it is STUNNED for
// CHARIOT_CHARGE_STUN_TURNS turns (cannot move or attack). It ends its charge on
// the tile just before the first surviving blocker (or at max range).
export const CHARIOT_CHARGE_UNITS = ['CHARIOT'];
export const CHARIOT_CHARGE_RANGE = 3;            // max tiles a charge travels (orthogonal)
export const CHARIOT_CHARGE_STUN_TURNS = 2;       // chariot is stunned this many turns after charging
export const CHARIOT_CHARGE_ATTACK_BONUS = 4;     // flat attack bonus applied to every hit in the lane
export const CHARIOT_CHARGE_VULN_TYPES = ['INFANTRY', 'ARTILLERY', 'ARCHER', 'LONGBOWMAN', 'CATAPULT', 'TREBUCHET'];
export const CHARIOT_CHARGE_VULN_MULT = 2.0;      // extra damage multiplier vs vulnerable types

// --- Freeze (Frost Clan Winter's Grasp) ---
// Frozen units cannot move on their next turn. The freeze counter is set by the
// Winter's Grasp active ability and ticks down at the start of the frozen
// unit's owner's turn (like charge exhaustion).
export const FREEZE_TURNS = 1; // units frozen by Winter's Grasp skip 1 move

// --- Ranged arrow bombard vs cities ---
// Non-siege ranged units (ARCHER, LONGBOWMAN) can fire arrows at an enemy
// fortified city to chip its fortification from range. Damage is intentionally
// nerfed (1/turn) vs proper siege engines — bows harass, they don't breach.
export const RANGED_BOMBARD_FORT_DAMAGE = 1;
export const RANGED_BOMBARD_TYPES = ['ARCHER', 'LONGBOWMAN'];

// City area of influence (Civ 6 style): buildings may only be constructed on
// tiles within this Chebyshev radius of an owned city. Cities level up to grow it.
export const CITY_INFLUENCE_RADIUS = 3;       // base radius at city level 1
export const CITY_INFLUENCE_PER_LEVEL = 1;     // radius gained per city level
export const CITY_LEVEL_UP_COST = { gold: 80, food: 40, production: 20 }; // base; scales × level
// City production growth curve: per-city production = CITY_PRODUCTION_BASE +
// CITY_PRODUCTION_PER_LEVEL * (diminishing share of each extra level). The
// curve is concave (square-root) so early levels grant more than later ones,
// matching a "production grows but with diminishing returns" economic model.
export const CITY_PRODUCTION_BASE = 2;          // production at city level 1
export const CITY_PRODUCTION_PER_LEVEL = 6;     // total spread across levels
export function cityProduction(cl) {
    const level = Math.max(1, cl || 1);
    return CITY_PRODUCTION_BASE + Math.round(CITY_PRODUCTION_PER_LEVEL * (Math.sqrt(level) - 1));
}
// Natural city growth (Civ6-style): each city accumulates growth each turn and
// levels up on its own when it crosses the threshold. You can also pay to
// level up instantly via the Level Up City button.
// Growth per turn = CITY_GROWTH_BASE + clamp(foodSurplus, 0, CITY_GROWTH_SURPLUS_CAP)
//                   * CITY_GROWTH_PER_SURPLUS_FOOD
// The surplus is clamped so a huge food stockpile can't instant-level a city;
// only a modest, well-fed bonus accelerates growth.
export const CITY_GROWTH_BASE = 1;            // flat growth per turn
export const CITY_GROWTH_PER_SURPLUS_FOOD = 0.05; // +growth per surplus food (clamped)
export const CITY_GROWTH_SURPLUS_CAP = 30;    // max surplus food counted toward growth
export const CITY_MAX_LEVEL = 10;
export function cityGrowthThreshold(level) { return 10 + level * 5; } // growth needed to reach level+1

export const INITIAL_RESOURCES = { gold: 100, food: 100, wood: 0, iron: 0, production: 10 };

// Units gain XP from kills and level up (better HP/ATK/DEF).
export const UNIT_XP_PER_KILL = 12;
export const UNIT_XP_PER_LEVEL = 30;

// AI settings
export const AI_MAX_UNITS = 18;

// --- Economy ---
export const MARKET_RATES = {
    wood: 0.5,   // 2 wood -> 1 gold
    iron: 1.0,   // 1 iron -> 1 gold
    food: 0.4    // 2.5 food -> 1 gold
};

export const TRADE_ROUTE_GOLD = 10; // per turn per route
export const STARVATION_ATTRITION = 2; // hp lost per starving unit per turn

// --- Buildings ---
export const BUILDING_TYPE = {
    FARM:       { name: 'Farm',       cost: { gold: 40, wood: 20 },              bonus: { food: 3 },   terrain: 'PLAINS', desc: '+3 food/turn.' },
    LUMBERMILL: { name: 'Lumbermill', cost: { gold: 50, wood: 10 },              bonus: { wood: 5 },   terrain: 'FOREST', desc: '+5 wood/turn.' },
    MINE:       { name: 'Mine',       cost: { gold: 60, wood: 20, iron: 10 },   bonus: { iron: 5 },   terrain: 'MOUNTAIN', desc: '+5 iron/turn.' },
    MARKET:     { name: 'Market',     cost: { gold: 80, wood: 30 },              bonus: { gold: 10 },  terrain: 'CITY', desc: '+10 gold/turn.' },
    BARRACKS:   { name: 'Barracks',   cost: { gold: 60, wood: 20, iron: 10 },   bonus: { production: 10 }, terrain: 'CITY',
                  desc: '+10 production/turn. Units trained in this city start as veterans (Lv.2) and cost 25% less gold.' },
    WALLS:      { name: 'Walls',      cost: { gold: 70, wood: 0, iron: 30 },    bonus: { defense: 5 }, terrain: 'CITY', desc: '+5 defense to units defending this tile (strong fortification).' },
    HARBOR:     { name: 'Harbor',     cost: { gold: 120, wood: 60, iron: 0 },   bonus: { production: 5 }, terrain: 'CITY',
                  desc: 'Unlocks naval units (GALLEY, TRANSPORT). +5 production/turn. Must be built in a coastal/river city (adjacent to water).' },
    SIEGE_WORKSHOP: { name: 'Siege Workshop', cost: { gold: 120, wood: 20, iron: 30 }, bonus: { production: 5 }, terrain: 'CITY',
                  desc: 'Unlocks long-range siege engines (CATAPULT, TREBUCHET). +5 production/turn. Build in any city.' }
};

// --- Engineer Structures (traps / defensive structures) ---
// Engineers can build one of three structure types on owned tiles within city
// influence. Structures are removed when an enemy captures the tile.
export const STRUCTURE_TYPE = {
    SPIKES:       { name: 'Spikes',       desc: 'Damages charging cavalry that moves onto/adjacent to this tile.', damageVsCavalry: 4, buildTurns: 2 },
    FORTIFICATION:{ name: 'Fortification',desc: '+3 defense to friendly units on this tile. Protects against infantry/artillery.', defenseBonus: 3, buildTurns: 2 },
    FALL_TRAP:    { name: 'Fall Trap',    desc: 'Damages and stuns (skip next turn) any enemy that walks onto this tile.', damage: 3, stun: true, buildTurns: 2 }
};

export const STRUCTURE_COST = {
    SPIKES:        { gold: 30, wood: 20, iron: 0 },
    FORTIFICATION: { gold: 50, wood: 30, iron: 10 },
    FALL_TRAP:     { gold: 40, wood: 10, iron: 5 }
};

// --- Natural Wonders ---
// Large, rare map features placed during generation. A wonder grants its
// bonus to whoever owns the tile — so capturing a city whose territory
// contains a wonder (or founding one on it) yields the bonus. Bonuses stack
// with normal terrain yields and buildings.
export const NATURAL_WONDERS = [
    { id: 'goldspire',  name: "Goldspire Mountain",  emoji: '⛏️', color: 0xd4a017, bonus: { gold: 8, iron: 2 },
      desc: 'A gold-laced peak. +8 gold, +2 iron/turn to its owner.' },
    { id: 'ancient_grove', name: "Ancient Grove",   emoji: '🌲', color: 0x2a8a3a, bonus: { food: 4, wood: 5 },
      desc: 'A primordial forest. +4 food, +5 wood/turn to its owner.' },
    { id: 'crystal_lake', name: "Crystal Lake",     emoji: '💎', color: 0x33b5e5, bonus: { production: 6, gold: 3 },
      desc: 'A radiant lake. +6 production, +3 gold/turn to its owner.' },
    { id: 'fertile_vale', name: "Fertile Vale",      emoji: '🌾', color: 0xb6d73a, bonus: { food: 6 },
      desc: 'Verdant lowlands. +6 food/turn to its owner.' },
    { id: 'iron_vein',   name: "Iron Vein",          emoji: '🪨', color: 0x8899aa, bonus: { iron: 6, production: 2 },
      desc: 'A rich iron deposit. +6 iron, +2 production/turn to its owner.' },
    { id: 'sun_pyre',    name: "Sun Pyre",           emoji: '🔥', color: 0xff7722, bonus: { gold: 6, production: 4 },
      desc: 'A volcanic vent. +6 gold, +4 production/turn to its owner.' }
];

// --- Factions ---
// Dynamic faction slots - supports 2-10 players
// 'player' is human-controlled; all others are AI
export const MAX_FACTIONS = 10;
export const PLAYER_FACTION = 'player';

// Generate faction slots dynamically based on player count
export function generateFactionSlots(playerCount) {
    const slots = ['player'];
    for (let i = 1; i < playerCount; i++) {
        slots.push(`ai${i}`);
    }
    return slots;
}

// Default faction slots (4 players)
export let FACTIONS = ['player', 'ai1', 'ai2', 'ai3'];

// Dynamically set FACTIONS based on player count. Call before Game init.
export function setFactionSlots(playerCount) {
    FACTIONS = generateFactionSlots(Math.max(2, Math.min(MAX_FACTIONS, playerCount)));
}

// Per-faction colors. `tile` is the emissive tint shown on owned tiles;
// `unit` is the marker color for that faction's units.
// Extended to support up to 10 factions
export const FACTION_COLORS = {
    player: { tile: 0x2e5dc4, unit: 0x4488ff, name: 'You' },
    ai1:    { tile: 0xb33333, unit: 0xff5544, name: 'Crimson' },
    ai2:    { tile: 0x3fa847, unit: 0x88dd44, name: 'Verdant' },
    ai3:    { tile: 0x8a3fbf, unit: 0xcc66ff, name: 'Violet' },
    ai4:    { tile: 0x234c9c, unit: 0x4488ff, name: 'Azure' },
    ai5:    { tile: 0x101012, unit: 0x5a5a66, name: 'Obsidian' },
    ai6:    { tile: 0xc9a028, unit: 0xffd700, name: 'Golden' },
    ai7:    { tile: 0x4a4a5a, unit: 0x8888aa, name: 'Iron' },
    ai8:    { tile: 0x2a1a3a, unit: 0x6a4a8a, name: 'Shadow' },
    ai9:    { tile: 0x1a4a6a, unit: 0x44aadd, name: 'Storm' }
};

// Per-faction city names - each faction has thematic naming
export const FACTION_CITY_NAMES = {
    crimson: ['Warhold', 'Bloodkeep', 'Ironforge', 'Flamecrest', 'Conquest', 'Ragefall', 'Siegebreak', 'Warmonger'],
    verdant: ['Greenhollow', 'Oakshire', 'Willowmere', 'Thornvale', 'Mossgate', 'Leafwind', 'Rootdeep', 'Bloomhaven'],
    violet: ['Spellspire', 'Arcanum', 'Mystara', 'Runekeep', 'Shadowmere', 'Crystalpeak', 'Starfall', 'Moonridge'],
    azure: ['Kings Landing', 'Lords Keep', 'Crownhaven', 'Shieldwall', 'Bastion', 'Fortis', 'Guardia', 'Sentinel'],
    obsidian: ['Shadowfell', 'Doomspire', 'Nightkeep', 'Voidreach', 'Darkhollow', 'Gloomhaven', 'Eclipse', 'Abyssia'],
    golden: ['Goldshire', 'Sunforge', 'Midaskeep', 'Treasurehold', 'Gildedgate', 'Prosperity', 'Fortune', 'Richmond'],
    iron: ['Steelhold', 'Anvilkeep', 'Forgegate', 'Hammerfall', 'Ironclad', 'Metalburg', 'Smelter', 'Crucible'],
    shadow: ['Nightshade', 'Duskfall', 'Twilight', 'Veilkeep', 'Whisper', 'Silentium', 'Umbra', 'Phantom'],
    storm: ['Thunderwall', 'Lightningkeep', 'Tempest', 'Galeforce', 'Stormwind', 'Hurricane', 'Cyclone', 'Maelstrom']
};

// Default city names pool (fallback)
export const CITY_NAMES = [
    'Ironhold', 'Stormkeep', 'Goldshire', 'Ravencrest', 'Dragonspire',
    'Frostgate', 'Sunforge', 'Shadowmere', 'Crystalpeak', 'Thunderwall',
    'Silverton', 'Oakshield', 'Flamecrest', 'Windhaven', 'Stonehelm',
    'Brightwater', 'Darkhollow', 'Ironforge', 'Starfall', 'Moonridge',
    'Emberkeep', 'Frostholm', 'Goldenvale', 'Ravenscar', 'Dragonmaw',
    'Stormwind', 'Sunblade', 'Shadowfen', 'Crystalis', 'Thunderpeak'
];

// --- Lords ---
export const LORD_ABILITIES = {
    RALLY:         { name: 'Rally',         desc: '+2 attack to adjacent friendly units', unlockLevel: 2 },
    SIEGE_MASTER:  { name: 'Siege Master',  desc: '+3 damage vs cities',                  unlockLevel: 3 },
    ADMINISTRATOR: { name: 'Administrator', desc: '+50% city yields when governing',      unlockLevel: 2 },
    TACTICIAN:     { name: 'Tactician',     desc: '+1 defense to adjacent friendly units', unlockLevel: 4 }
};

// Lord classes (archetypes): each lord is born into one class, which gives a
// passive bonus to every unit in the lord's army + a unique 2.5D icon.
export const LORD_CLASSES = {
    WARLORD:        { name: 'Warlord',        icon: '⚔️', bonus: { attack: 2 },                 desc: '+2 attack to all units in their army.' },
    GUARDIAN:       { name: 'Guardian',       icon: '🛡️', bonus: { defense: 2 },                desc: '+2 defense to all units in their army.' },
    CONQUEROR:      { name: 'Conqueror',      icon: '🏰', bonus: { siege: 3 },                  desc: '+3 damage vs cities for all units in their army.' },
    GRAND_COMMANDER:{ name: 'Grand Commander',icon: '🎖️', bonus: { attack: 1, defense: 1, extraCommand: 2 }, desc: '+1 atk & +1 def to army, and commands 2 extra units.' }
};

export const LORD_BASE_STATS = { command: 2, combat: 2, governance: 2 };
export const LORD_RECRUIT_COST = { gold: 300, food: 100 };
export const LORD_XP_PER_KILL = 10;
export const LORD_XP_PER_LEVEL = 50;

// --- Diplomacy ---
export const DIPLOMACY_STATES = {
    WAR: 'war',
    PEACE: 'peace',
    ALLIANCE: 'alliance',
    TRADE_PACT: 'trade_pact'
};

// AI is now much more reluctant to accept peace/trade - wars are grinding and
// breaking a treaty should be costly. The player must fight or offer significant
// value to get anything but the most temporary truces.
export const AI_PERSONALITIES = {
    AGGRESSIVE:  { warChance: 0.8,  acceptAlliance: 0.15, acceptTrade: 0.25, acceptPeace: 0.3 },
    DEFENSIVE:   { warChance: 0.3,  acceptAlliance: 0.25, acceptTrade: 0.4, acceptPeace: 0.5 },
    ECONOMIC:    { warChance: 0.15, acceptAlliance: 0.35, acceptTrade: 0.55, acceptPeace: 0.6 }
};

// Trade materials: specific resources that can be exchanged in trade pacts.
// Each trade pact specifies which material is traded and how much per turn.
export const TRADE_MATERIALS = {
    GOLD:    { key: 'gold',    name: 'Gold',    emoji: '💰' },
    FOOD:    { key: 'food',    name: 'Food',    emoji: '🌾' },
    WOOD:    { key: 'wood',    name: 'Wood',    emoji: '🪵' },
    IRON:    { key: 'iron',    name: 'Iron',    emoji: '⛏️' }
};

// --- Victory ---
export const VICTORY_TILE_PERCENTAGE = 0.6; // control 60% of map