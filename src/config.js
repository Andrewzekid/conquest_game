// --- Game Configuration ---
// Mutable live binding: game.js sets this to the chosen map size at startup.
// Importers read it at call time, so they pick up the chosen size.
export let GRID_SIZE = 40;
export const TILE_SIZE = 1;
export const MAP_SIZES = { small: 28, medium: 40, large: 52 };
export function setGridSize(n) { GRID_SIZE = n; }

// Terrain types. `key` is the string identifier used in tile.terrain (fixes map/renderer mismatch).
export const TERRAIN = {
    PLAINS:   { key: 'PLAINS',   color: 0x7cfc00, name: 'Plains',   resource: 'food',  amount: 3,  defense: 0 },
    FOREST:   { key: 'FOREST',   color: 0x228b22, name: 'Forest',   resource: 'wood',  amount: 3,  defense: 1 },
    MOUNTAIN: { key: 'MOUNTAIN', color: 0x7d6b58, name: 'Mountain', resource: 'iron',  amount: 3,  defense: 3 },
    HILLS:    { key: 'HILLS',    color: 0x9aaa55, name: 'Hills',    resource: 'iron',  amount: 2,  defense: 1 },
    DESERT:   { key: 'DESERT',   color: 0xe6d08a, name: 'Desert',   resource: 'gold',  amount: 2,  defense: 0 },
    MARSH:    { key: 'MARSH',    color: 0x4f6b53, name: 'Marsh',    resource: 'food',  amount: 2,  defense: 0 },
    TUNDRA:   { key: 'TUNDRA',   color: 0xc6d4d0, name: 'Tundra',  resource: 'food',  amount: 2,  defense: 1 },
    WATER:    { key: 'WATER',    color: 0x2f6fb0, name: 'Water',    resource: null,    amount: 0,  defense: 0 },
    RIVER:    { key: 'RIVER',    color: 0x2f90d8, name: 'River',    resource: 'food',  amount: 2,  defense: 0 },
    CITY:     { key: 'CITY',     color: 0xc9b06b, name: 'City',     resource: 'gold',  amount: 8,  defense: 3 }
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
    ENGINEER:    { name: 'Engineer',     hp: 8,  attack: 2, defense: 2, moveRange: 2, upkeep: { food: 2, gold: 2, wood: 1 }, canBuildBridge: true, canBuildSiegeTower: true, ranged: false, attackRange: 1 },
    // Worker: a Civ-style improvement builder. It travels the map and constructs
    // terrain improvements (FARM/LUMBERMILL/MINE) on owned tiles within a city's
    // influence radius, spending its action to do so.
    WORKER:      { name: 'Worker',      hp: 6,  attack: 0, defense: 1, moveRange: 2, upkeep: { food: 2, gold: 1 }, canBuildImprovement: true, ranged: false, attackRange: 1 },
    // New land units.
    LONGBOWMAN:  { name: 'Longbowman',   hp: 8,  attack: 5, defense: 1, moveRange: 1, upkeep: { food: 2, gold: 4, wood: 1 }, ranged: true, attackRange: 3, siegeBonus: 1, vision: 4 },
    CATAPHRACT:  { name: 'Cataphract',   hp: 16, attack: 6, defense: 5, moveRange: 2, upkeep: { food: 5, gold: 5, iron: 2 }, ranged: false, attackRange: 1 },
    MEDIC:       { name: 'Medic',        hp: 7,  attack: 1, defense: 2, moveRange: 2, upkeep: { food: 2, gold: 3 }, heal: 2, ranged: false, attackRange: 1 },
    SIEGE_TOWER: { name: 'Siege Tower', hp: 20, attack: 4, defense: 4, moveRange: 1, upkeep: { food: 3, gold: 4, wood: 2, iron: 2 }, besiege: true, besiegePower: 3, canAssault: true, ranged: false, attackRange: 1 },
    // Long-range siege engines (unlocked by a Siege Workshop building in a city).
    // Both deal AOE splash to enemy units adjacent to the target and can set the
    // area ablaze (a burn DoT on primary + splash victims).
    CATAPULT:    { name: 'Catapult',   hp: 12, attack: 7, defense: 2, moveRange: 1, upkeep: { food: 3, gold: 6, wood: 2, iron: 2 }, besiege: true, besiegePower: 2, ranged: true, attackRange: 4, aoe: true, canSetFire: true, buildTurns: 2 },
    TREBUCHET:   { name: 'Trebuchet',  hp: 10, attack: 9, defense: 1, moveRange: 1, upkeep: { food: 3, gold: 7, wood: 3, iron: 3 }, besiege: true, besiegePower: 3, ranged: true, attackRange: 5, aoe: true, canSetFire: true, buildTurns: 2 },
    // Naval units (unlocked by a Harbor building in a coastal/river city).
    GALLEY:      { name: 'Galley',       hp: 14, attack: 6, defense: 3, moveRange: 4, upkeep: { food: 3, gold: 5, wood: 2 }, naval: true, ranged: true, attackRange: 3, vision: 5 },
    TRANSPORT:   { name: 'Transport',    hp: 12, attack: 1, defense: 3, moveRange: 3, upkeep: { food: 2, gold: 4, wood: 1 }, naval: true, capacity: 2, ranged: false, attackRange: 1 }
};

// Units available to every faction in addition to its themed roster. Ships
// (GALLEY/TRANSPORT) are NOT here — they're unlocked per-city by a Harbor.
export const EXTRA_UNITS = ['SETTLER', 'ENGINEER', 'WORKER', 'LONGBOWMAN', 'CATAPHRACT', 'MEDIC', 'SIEGE_TOWER'];
export const NAVAL_UNITS = ['GALLEY', 'TRANSPORT'];
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
    SETTLER:     { gold: 50, food: 25, wood: 10, iron: 0,  production: 20 },
    ENGINEER:    { gold: 60, food: 10, wood: 20, iron: 10, production: 20 },
    WORKER:      { gold: 30, food: 10, wood: 5,  iron: 0,  production: 10 },
    LONGBOWMAN:  { gold: 60, food: 0,  wood: 25, iron: 0,  production: 18 },
    CATAPHRACT:  { gold: 90, food: 20, wood: 0,  iron: 15, production: 25 },
    MEDIC:       { gold: 55, food: 10, wood: 10, iron: 0,  production: 15 },
    SIEGE_TOWER: { gold: 95, food: 10, wood: 20, iron: 20, production: 30 },
    CATAPULT:    { gold: 120, food: 0,  wood: 15, iron: 30, production: 35 },
    TREBUCHET:   { gold: 150, food: 0,  wood: 20, iron: 40, production: 45 },
    GALLEY:      { gold: 70, food: 10, wood: 40, iron: 0,  production: 20 },
    TRANSPORT:   { gold: 60, food: 5,  wood: 30, iron: 0,  production: 25 }
};

// Cost to build a bridge across a river tile.
export const BRIDGE_COST = { gold: 40, wood: 20 };

// Cost for an Engineer to start constructing a Siege Tower (paid up front; the
// tower is built over SIEGE_TOWER_BUILD_TURNS turns, then spawns on completion).
export const SIEGE_TOWER_COST = { gold: 110, wood: 25, iron: 25, production: 40 };
export const SIEGE_TOWER_BUILD_TURNS = 3;
export const SIEGE_TOWER_BUILD_RADIUS = 2; // Engineer must be within this Chebyshev radius of an enemy city

// Type advantage system (rock-paper-scissors bonus)
export const TYPE_ADVANTAGE = {
    INFANTRY:    { strongAgainst: 'ARCHER',    multiplier: 1.4 },
    ARCHER:      { strongAgainst: 'ARTILLERY', multiplier: 1.4 },
    ARTILLERY:   { strongAgainst: 'CAVALRY',   multiplier: 1.4 },
    CAVALRY:     { strongAgainst: 'INFANTRY',  multiplier: 1.4 },
    PIKEMAN:     { strongAgainst: 'CAVALRY',   multiplier: 1.5 },
    CATAPHRACT:  { strongAgainst: 'INFANTRY',  multiplier: 1.5 }
};

export const CAPTURE_COST = 20; // Gold to capture an unowned tile

// AOE/fire ailment tuning for siege engines (CATAPULT, TREBUCHET).
export const AOE_RADIUS = 1;            // Chebyshev radius around the target tile for splash
export const AOE_SPLASH_FRACTION = 0.5; // splash dmg = floor(primaryDmg * this), min 1
export const BURN_TURNS = 2;            // how many turns a fire ailment lasts
export const BURN_DAMAGE_PER_TURN = 2;  // hp lost per turn while burning

// City area of influence (Civ 6 style): buildings may only be constructed on
// tiles within this Chebyshev radius of an owned city. Cities level up to grow it.
export const CITY_INFLUENCE_RADIUS = 3;       // base radius at city level 1
export const CITY_INFLUENCE_PER_LEVEL = 1;     // radius gained per city level
export const CITY_LEVEL_UP_COST = { gold: 80, food: 40, production: 20 }; // base; scales × level
// Natural city growth (Civ6-style): each city accumulates growth each turn and
// levels up on its own when it crosses the threshold. You can also pay to
// level up instantly via the Level Up City button.
export const CITY_GROWTH_BASE = 1;            // flat growth per turn
export const CITY_GROWTH_PER_SURPLUS_FOOD = 0.1; // +growth per surplus food the faction holds
export const CITY_MAX_LEVEL = 5;
export function cityGrowthThreshold(level) { return 8 + level * 4; } // growth needed to reach level+1

export const INITIAL_RESOURCES = { gold: 100, food: 100, wood: 0, iron: 0, production: 10 };

// Units gain XP from kills and level up (better HP/ATK/DEF).
export const UNIT_XP_PER_KILL = 12;
export const UNIT_XP_PER_LEVEL = 30;

// AI settings
export const AI_MAX_UNITS = 9;

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
    FARM:       { name: 'Farm',       cost: { gold: 40, wood: 20 },              bonus: { food: 5 },   terrain: 'PLAINS', desc: '+5 food/turn.' },
    LUMBERMILL: { name: 'Lumbermill', cost: { gold: 50, wood: 10 },              bonus: { wood: 5 },   terrain: 'FOREST', desc: '+5 wood/turn.' },
    MINE:       { name: 'Mine',       cost: { gold: 60, wood: 20, iron: 10 },   bonus: { iron: 5 },   terrain: 'MOUNTAIN', desc: '+5 iron/turn.' },
    MARKET:     { name: 'Market',     cost: { gold: 80, wood: 30 },              bonus: { gold: 10 },  terrain: 'CITY', desc: '+10 gold/turn.' },
    BARRACKS:   { name: 'Barracks',   cost: { gold: 60, wood: 20, iron: 10 },   bonus: { production: 10 }, terrain: 'CITY',
                  desc: '+10 production/turn. Units trained in this city start as veterans (Lv.2) and cost 25% less gold.' },
    WALLS:      { name: 'Walls',      cost: { gold: 70, wood: 0, iron: 30 },    bonus: { defense: 3 }, terrain: 'CITY', desc: '+3 defense to units defending this tile.' },
    HARBOR:     { name: 'Harbor',     cost: { gold: 120, wood: 60, iron: 0 },   bonus: { production: 5 }, terrain: 'CITY',
                  desc: 'Unlocks naval units (GALLEY, TRANSPORT). +5 production/turn. Must be built in a coastal/river city (adjacent to water).' },
    SIEGE_WORKSHOP: { name: 'Siege Workshop', cost: { gold: 120, wood: 20, iron: 30 }, bonus: { production: 5 }, terrain: 'CITY',
                  desc: 'Unlocks long-range siege engines (CATAPULT, TREBUCHET). +5 production/turn. Build in any city.' }
};

// --- Natural Wonders ---
// Large, rare map features placed during generation. A wonder grants its
// bonus to whoever owns the tile — so capturing a city whose territory
// contains a wonder (or founding one on it) yields the bonus. Bonuses stack
// with normal terrain yields and buildings.
export const NATURAL_WONDERS = [
    { id: 'goldspire',  name: "Goldspire Mountain",  emoji: '⛏️', color: 0xd4a017, bonus: { gold: 8, iron: 2 },
      desc: 'A gold-laced peak. +8 gold, +2 iron/turn to its owner.' },
    { id: 'ancient_grove', name: "Ancient Grove",   emoji: '🌲', color: 0x2a8a3a, bonus: { food: 6, wood: 5 },
      desc: 'A primordial forest. +6 food, +5 wood/turn to its owner.' },
    { id: 'crystal_lake', name: "Crystal Lake",     emoji: '💎', color: 0x33b5e5, bonus: { production: 6, gold: 3 },
      desc: 'A radiant lake. +6 production, +3 gold/turn to its owner.' },
    { id: 'fertile_vale', name: "Fertile Vale",      emoji: '🌾', color: 0xb6d73a, bonus: { food: 10 },
      desc: 'Verdant lowlands. +10 food/turn to its owner.' },
    { id: 'iron_vein',   name: "Iron Vein",          emoji: '🪨', color: 0x8899aa, bonus: { iron: 6, production: 2 },
      desc: 'A rich iron deposit. +6 iron, +2 production/turn to its owner.' },
    { id: 'sun_pyre',    name: "Sun Pyre",           emoji: '🔥', color: 0xff7722, bonus: { gold: 6, production: 4 },
      desc: 'A volcanic vent. +6 gold, +4 production/turn to its owner.' }
];

// --- Factions ---
// 'player' is human-controlled; all others are AI. Add/remove ids here to scale the map.
export const FACTIONS = ['player', 'ai1', 'ai2', 'ai3'];
export const PLAYER_FACTION = 'player';

// Per-faction colors. `tile` is the emissive tint shown on owned tiles;
// `unit` is the marker color for that faction's units.
export const FACTION_COLORS = {
    player: { tile: 0x2e5dc4, unit: 0x4488ff, name: 'You' },
    ai1:    { tile: 0xb33333, unit: 0xff5544, name: 'Crimson' },
    ai2:    { tile: 0x3fa847, unit: 0x88dd44, name: 'Verdant' },
    ai3:    { tile: 0x8a3fbf, unit: 0xcc66ff, name: 'Violet' }
};

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

export const LORD_BASE_STATS = { command: 1, combat: 1, governance: 1 };
export const LORD_RECRUIT_COST = { gold: 150, food: 50 };
export const LORD_XP_PER_KILL = 10;
export const LORD_XP_PER_LEVEL = 50;

// --- Diplomacy ---
export const DIPLOMACY_STATES = {
    WAR: 'war',
    PEACE: 'peace',
    ALLIANCE: 'alliance',
    TRADE_PACT: 'trade_pact'
};

export const AI_PERSONALITIES = {
    AGGRESSIVE:  { warChance: 0.7,  acceptAlliance: 0.3, acceptTrade: 0.5 },
    DEFENSIVE:   { warChance: 0.2,  acceptAlliance: 0.5, acceptTrade: 0.8 },
    ECONOMIC:    { warChance: 0.1,  acceptAlliance: 0.6, acceptTrade: 0.95 }
};

// --- Victory ---
export const VICTORY_TILE_PERCENTAGE = 0.6; // control 60% of map