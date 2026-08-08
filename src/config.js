// --- Game Configuration ---
// Mutable live binding: game.js sets these at startup based on chosen map size.
// Importers read them at call time, so they pick up the chosen dimensions.
export let GRID_WIDTH = 40;
export let GRID_HEIGHT = 40;
export let GRID_SIZE = 40; // Legacy: equals width for compatibility
export const TILE_SIZE = 1;

// Map landmass tuning. Any landmass below MIN_LANDMASS_SIZE tiles after
// generation is flooded back into the ocean so stray 1-3 tile islets disappear,
// and faction capitals are only placed on landmasses at least MIN_START_LANDMASS
// tiles (falling back to the largest available if too few qualify).
export const MIN_LANDMASS_SIZE = 48;
export const MIN_START_LANDMASS = 72;

// Tile count-based map sizes with player count recommendations
export const MAP_SIZES = {
    tiny:   { tiles: 400,  players: 3, name: 'Tiny' },
    small:  { tiles: 800,  players: 5, name: 'Small' },
    medium: { tiles: 1600, players: 7, name: 'Medium' },
    large:  { tiles: 2500, players: 9, name: 'Large' },
    huge:   { tiles: 4000, players: 10, name: 'Huge' },
    epic:   { tiles: 6000, players: 10, name: 'Epic' },
    gigantic: { tiles: 8000, players: 12, name: 'Gigantic' }  // NEW
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
    PLAINS:   { key: 'PLAINS',   color: 0x7cfc00, name: 'Plains',   resource: 'food',  amount: 1,  defense: 0 },
    FOREST:   { key: 'FOREST',   color: 0x228b22, name: 'Forest',   resource: 'wood',  amount: 2,  defense: 1 },
    MOUNTAIN: { key: 'MOUNTAIN', color: 0x7d6b58, name: 'Mountain', resource: 'iron',  amount: 2,  defense: 3 },
    HILLS:    { key: 'HILLS',    color: 0x9aaa55, name: 'Hills',    resource: 'iron',  amount: 1,  defense: 1 },
    DESERT:   { key: 'DESERT',   color: 0xe6d08a, name: 'Desert',   resource: 'gold',  amount: 1,  defense: 0 },
    MARSH:    { key: 'MARSH',    color: 0x4f6b53, name: 'Marsh',    resource: 'food',  amount: 1,  defense: 0 },
    TUNDRA:   { key: 'TUNDRA',   color: 0xc6d4d0, name: 'Tundra',  resource: 'food',  amount: 1,  defense: 1 },
    WATER:    { key: 'WATER',    color: 0x2f6fb0, name: 'Water',    resource: null,    amount: 0,  defense: 0 },
    RIVER:    { key: 'RIVER',    color: 0x2f90d8, name: 'River',    resource: 'food',  amount: 1,  defense: 0 },
    PASS:     { key: 'PASS',     color: 0x8a7a6b, name: 'Pass',     resource: 'iron',  amount: 1,  defense: 2 },
    CITY:     { key: 'CITY',     color: 0xc9b06b, name: 'City',     resource: 'gold',  amount: 5,  defense: 3, wood: 1 }
};

export const UNIT_TYPE = {
    // --- MEDIEVAL (baseline) ---
    INFANTRY:    { name: 'Infantry',     hp: 10, attack: 3, defense: 4, moveRange: 2, upkeep: { food: 3, gold: 2 }, ranged: false, attackRange: 1 },
    ARCHER:      { name: 'Archer',       hp: 8,  attack: 4, defense: 1, moveRange: 2, upkeep: { food: 2, gold: 3 }, ranged: true, attackRange: 2 },
    ARTILLERY:   { name: 'Artillery',    hp: 6,  attack: 7, defense: 1, moveRange: 2, upkeep: { food: 4, gold: 5, iron: 2 }, siegeBonus: 12, besiege: true, besiegePower: 2, ranged: true, attackRange: 2, aoe: true, aoeRadius: 1 },
    CAVALRY:     { name: 'Cavalry',      hp: 12, attack: 5, defense: 3, moveRange: 3, upkeep: { food: 4, gold: 4 }, ranged: false, attackRange: 1 },
    PIKEMAN:     { name: 'Pikeman',      hp: 12, attack: 4, defense: 4, moveRange: 2, upkeep: { food: 3, gold: 3 }, ranged: false, attackRange: 1 },
    SCOUT:       { name: 'Scout',        hp: 6,  attack: 2, defense: 1, moveRange: 4, upkeep: { food: 1, gold: 1 }, vision: 5, ranged: false, attackRange: 1 },
    SIEGE:       { name: 'Siege',        hp: 14, attack: 3, defense: 2, moveRange: 2, upkeep: { food: 4, gold: 4, wood: 2, iron: 1 }, siegeBonus: 8, besiege: true, besiegePower: 2, ranged: true, attackRange: 2 },
    SETTLER:     { name: 'Settler',      hp: 6,  attack: 1, defense: 1, moveRange: 2, upkeep: { food: 3, gold: 2 }, canFoundCity: true, buildTurns: 2, ranged: false, attackRange: 1 },
    ENGINEER:    { name: 'Engineer',     hp: 8,  attack: 2, defense: 2, moveRange: 2, upkeep: { food: 2, gold: 2, wood: 1 }, canBuildBridge: true, canBuildSiegeTower: true, canBuildStructure: true, ranged: false, attackRange: 1 },
    WORKER:      { name: 'Worker',       hp: 6,  attack: 0, defense: 1, moveRange: 2, upkeep: { food: 2, gold: 1 }, canBuildImprovement: true, ranged: false, attackRange: 1 },
    LONGBOWMAN:  { name: 'Longbowman',   hp: 8,  attack: 5, defense: 1, moveRange: 1, upkeep: { food: 2, gold: 4, wood: 1 }, ranged: true, attackRange: 3, siegeBonus: 1, vision: 4 },
    CATAPHRACT:  { name: 'Cataphract',   hp: 16, attack: 6, defense: 5, moveRange: 2, upkeep: { food: 5, gold: 5, iron: 2 }, ranged: false, attackRange: 1 },
    CHARIOT:     { name: 'Chariot',      hp: 11, attack: 4, defense: 2, moveRange: 3, upkeep: { food: 3, gold: 4, wood: 1, iron: 1 }, ranged: false, attackRange: 1, canCharge: true },
    MEDIC:       { name: 'Medic',        hp: 7,  attack: 1, defense: 2, moveRange: 2, upkeep: { food: 2, gold: 3 }, heal: 2, ranged: false, attackRange: 1 },
    SIEGE_TOWER: { name: 'Siege Tower',  hp: 20, attack: 4, defense: 4, moveRange: 1, upkeep: { food: 3, gold: 4, wood: 2, iron: 2 }, besiege: true, besiegePower: 3, canAssault: true, ranged: false, attackRange: 1 },
    LEGIONNAIRE: { name: 'Legionnaire',  hp: 14, attack: 4, defense: 5, moveRange: 1, upkeep: { food: 4, gold: 3 }, ranged: false, attackRange: 1, canBuildStructure: true, canBuildSiegeTower: true },
    BERSERKER:   { name: 'Berserker',    hp: 12, attack: 9, defense: 1, moveRange: 2, upkeep: { food: 3, gold: 4 }, ranged: false, attackRange: 1, frenzy: true, noMedic: true },
    VARANGIAN_GUARD: { name: 'Varangian Guard', hp: 16, attack: 6, defense: 6, moveRange: 2, upkeep: { food: 4, gold: 5, iron: 1 }, ranged: false, attackRange: 1, lordGuard: true },
    CONQUISTADOR: { name: 'Conquistador', hp: 10, attack: 7, defense: 4, moveRange: 3, upkeep: { food: 3, gold: 6, iron: 1 }, ranged: true, attackRange: 2, cityBonus: 2 },
    WINGED_HUSSAR: { name: 'Winged Hussar', hp: 18, attack: 8, defense: 4, moveRange: 3, upkeep: { food: 5, gold: 6, iron: 2 }, ranged: false, attackRange: 1, chargeMultiplier: 2, openTerrainMoveBonus: 1 },
    CROSSBOWMAN: { name: 'Crossbowman',  hp: 10, attack: 8, defense: 2, moveRange: 1, upkeep: { food: 3, gold: 5, wood: 2 }, ranged: true, attackRange: 3 },
    // --- Phase H: Cultural factions (Ming, Stone, Arcane, Shadow Lotus, Sun) ---
    TIGER_CANNON:  { name: 'Tiger Cannon', hp: 14, attack: 6, defense: 3, moveRange: 2, upkeep: { food: 3, gold: 6, wood: 2, iron: 2 }, besiege: true, besiegePower: 2, ranged: true, attackRange: 3, aoe: true, aoeRadius: 2, canSetFire: true, buildTurns: 2 },
    STONE_GUARD:   { name: 'Stone Guard', hp: 18, attack: 4, defense: 6, moveRange: 1, upkeep: { food: 3, gold: 3, iron: 1 }, ranged: false, attackRange: 1, antiCavalry: true },
    BATTLE_MAGE:   { name: 'Battle Mage', hp: 10, attack: 6, defense: 2, moveRange: 2, upkeep: { food: 2, gold: 5 }, ranged: true, attackRange: 3, aoe: true, aoeRadius: 1 },
    SHINOBI:       { name: 'Shinobi', hp: 10, attack: 7, defense: 2, moveRange: 3, upkeep: { food: 2, gold: 4 }, ranged: false, attackRange: 1 },
    JAGUAR_WARRIOR:{ name: 'Jaguar Warrior', hp: 14, attack: 8, defense: 3, moveRange: 3, upkeep: { food: 3, gold: 4 }, ranged: false, attackRange: 1 },
    CATAPULT:    { name: 'Catapult',     hp: 12, attack: 5, defense: 2, moveRange: 1, upkeep: { food: 3, gold: 6, wood: 2, iron: 2 }, besiege: true, besiegePower: 2, ranged: true, attackRange: 3, aoe: true, canSetFire: true, buildTurns: 2 },
    TREBUCHET:   { name: 'Trebuchet',    hp: 10, attack: 7, defense: 1, moveRange: 1, upkeep: { food: 3, gold: 7, wood: 3, iron: 3 }, besiege: true, besiegePower: 3, ranged: true, attackRange: 3, aoe: true, canSetFire: true, buildTurns: 2 },

    // --- MEDIEVAL NAVAL (tiers: Galley=light, Frigate=medium, Galleon=heavy) ---
    GALLEY:      { name: 'Galley',       hp: 14, attack: 6, defense: 3, moveRange: 4, upkeep: { food: 3, gold: 5, wood: 2, iron: 1 }, naval: true, ranged: true, attackRange: 3, vision: 5 },
    TRANSPORT:   { name: 'Transport',    hp: 12, attack: 1, defense: 3, moveRange: 3, upkeep: { food: 2, gold: 4, wood: 1, iron: 1 }, naval: true, capacity: 2, ranged: false, attackRange: 1 },
    FRIGATE:     { name: 'Frigate',      hp: 20, attack: 8, defense: 4, moveRange: 4, upkeep: { food: 4, gold: 7, wood: 3, iron: 2 }, naval: true, ranged: true, attackRange: 3, vision: 5 },
    GALLEON:     { name: 'Galleon',      hp: 28, attack: 10, defense: 6, moveRange: 3, upkeep: { food: 5, gold: 8, wood: 4, iron: 3 }, naval: true, ranged: true, attackRange: 3, vision: 4, besiege: true, besiegePower: 1 },

    // --- RENAISSANCE ERA (1700-1800) ---
    MUSKETEER:   { name: 'Musketman',    hp: 20, attack: 14, defense: 7, moveRange: 2, upkeep: { food: 4, gold: 5, iron: 1 }, ranged: true, attackRange: 2, volley: true },
    ARQUEBUSIER: { name: 'Arquebusier',  hp: 16, attack: 12, defense: 6, moveRange: 2, upkeep: { food: 3, gold: 4, iron: 1 }, ranged: true, attackRange: 2, slowReload: true },

    // RENAISSANCE NAVAL (light > medieval medium; medium > medieval heavy; heavy top)
    PINNACE:     { name: 'Pinnace',      hp: 26, attack: 10, defense: 6, moveRange: 4, upkeep: { food: 3, gold: 5, wood: 2, iron: 1 }, naval: true, ranged: true, attackRange: 3, vision: 7 },        // > Frigate (20/8/4)
    GALLEASS:    { name: 'Galleass',     hp: 36, attack: 14, defense: 9, moveRange: 3, upkeep: { food: 5, gold: 8, wood: 3, iron: 2 }, naval: true, ranged: true, attackRange: 3, oared: true }, // > Galleon (28/10/6)
    MAN_OF_WAR:  { name: 'Man-of-War',   hp: 48, attack: 18, defense: 12, moveRange: 3, upkeep: { food: 6, gold: 10, wood: 4, iron: 3 }, naval: true, ranged: true, attackRange: 3, vision: 6, flagship: true },

    // --- ENLIGHTENMENT ERA (1800-1850) ---
    LINE_INFANTRY: { name: 'Line Infantry', hp: 28, attack: 18, defense: 10, moveRange: 2, upkeep: { food: 4, gold: 6, iron: 2 }, ranged: true, attackRange: 2, formation: true },
    DRAGOON:     { name: 'Dragoon',      hp: 22, attack: 18, defense: 8, moveRange: 3, upkeep: { food: 5, gold: 7, iron: 2 }, ranged: true, attackRange: 2, mounted: true },
    CANNON:      { name: 'Cannon',       hp: 16, attack: 18, defense: 6, moveRange: 1, upkeep: { food: 3, gold: 8, wood: 2, iron: 4 }, besiege: true, besiegePower: 4, ranged: true, attackRange: 2, siegeBonus: 4 },
    MORTAR:      { name: 'Mortar',       hp: 14, attack: 16, defense: 5, moveRange: 1, upkeep: { food: 3, gold: 7, wood: 2, iron: 3 }, besiege: true, besiegePower: 3, ranged: true, attackRange: 3, aoe: true, aoeRadius: 2 },

    // ENLIGHTENMENT NAVAL (light > Renaissance medium; heavy > Renaissance heavy; no medium – we make Corvette light, Frolic heavy)
    CORVETTE:    { name: 'Corvette',     hp: 42, attack: 16, defense: 10, moveRange: 4, upkeep: { food: 4, gold: 6, wood: 3, iron: 2 }, naval: true, ranged: true, attackRange: 3, raider: true }, // > Galleass (36/14/9)
    FROLIC:      { name: 'Frolic',       hp: 58, attack: 22, defense: 14, moveRange: 3, upkeep: { food: 5, gold: 9, wood: 4, iron: 3 }, naval: true, ranged: true, attackRange: 4, broadside: true }, // > Man-of-War (48/18/12)
    MERCHANTMAN: { name: 'Merchantman',  hp: 28, attack: 5, defense: 6, moveRange: 3, upkeep: { food: 4, gold: 6, wood: 3, iron: 1 }, naval: true, capacity: 3, tradeBonus: 10 },

    // --- MODERN ERA (1850-1880) ---
    RIFLEMAN:    { name: 'Rifleman',     hp: 34, attack: 22, defense: 10, moveRange: 2, upkeep: { food: 5, gold: 8, iron: 3 }, ranged: true, attackRange: 3, accurate: true },
    SHARPSHOOTER:{ name: 'Sharpshooter', hp: 22, attack: 24, defense: 8, moveRange: 2, upkeep: { food: 4, gold: 9, iron: 2 }, ranged: true, attackRange: 4, sniper: true },
    RAILGUN:     { name: 'Railgun',      hp: 20, attack: 26, defense: 8, moveRange: 2, upkeep: { food: 4, gold: 10, iron: 6 }, besiege: true, besiegePower: 5, ranged: true, attackRange: 3, devastating: true, aoe: true, aoeRadius: 2 },
    ARMORED_TRAIN: { name: 'Armored Train', hp: 36, attack: 22, defense: 12, moveRange: 3, upkeep: { food: 5, gold: 10, wood: 2, iron: 5 }, ranged: true, attackRange: 3, mobile: true },
    FIELD_GUN:   { name: 'Field Gun',    hp: 18, attack: 24, defense: 8, moveRange: 2, upkeep: { food: 4, gold: 9, wood: 2, iron: 4 }, besiege: true, besiegePower: 4, ranged: true, attackRange: 2, rapidFire: true, aoe: true, aoeRadius: 2 },
    HORSE_ARTILLERY: { name: 'Horse Artillery', hp: 18, attack: 22, defense: 8, moveRange: 3, upkeep: { food: 5, gold: 9, wood: 2, iron: 4 }, besiege: true, besiegePower: 3, ranged: true, attackRange: 3, fastDeploy: true, aoe: true, aoeRadius: 2 },
    DEMOLITION_SQUAD: { name: 'Demolition Squad', hp: 18, attack: 20, defense: 9, moveRange: 2, upkeep: { food: 3, gold: 6, wood: 2, iron: 2 }, ranged: false, attackRange: 1, demolish: true, canBuildStructure: true, canBuildBridge: true },
    COMBAT_ENGINEER: { name: 'Combat Engineer', hp: 24, attack: 18, defense: 12, moveRange: 3, upkeep: { food: 3, gold: 8, iron: 3 }, ranged: false, attackRange: 1, demolish: true, canBuildStructure: true, canBuildBridge: true, mobilized: true },
    SIEGE_CANNON: { name: 'Siege Cannon', hp: 16, attack: 26, defense: 10, moveRange: 2, upkeep: { food: 3, gold: 10, wood: 2, iron: 5 }, besiege: true, besiegePower: 6, ranged: true, attackRange: 3, fortBuster: true, aoe: true, aoeRadius: 2 },

    // MODERN NAVAL (light > Enlightenment heavy? Actually we need light > Frolic (58/22/14) – that’s steep. Instead we’ll make Gunboat the light, and it should be > Frolic? That would be too high. Since Enlightenment has only light and heavy, we can make Modern light > Enlightenment heavy, which is acceptable as a big jump. We'll set Gunboat accordingly.)
    GUNBOAT:     { name: 'Gunboat',      hp: 60, attack: 24, defense: 12, moveRange: 4, upkeep: { food: 3, gold: 7, wood: 2, iron: 3 }, naval: true, ranged: true, attackRange: 4, shallowDraft: true }, // > Frolic (58/22/14)
    FRIGATE_2:   { name: 'Frigate II',   hp: 70, attack: 28, defense: 16, moveRange: 4, upkeep: { food: 6, gold: 11, wood: 4, iron: 4 }, naval: true, ranged: true, attackRange: 4, fastSail: true },      // medium, could be > Gunboat but we want medium > previous heavy? Actually we want medium > previous heavy? We'll treat Frigate_2 as medium and it should be > Frolic as well, but we can just make it stronger than Gunboat.
    IRONCLAD:    { name: 'Ironclad',     hp: 85, attack: 32, defense: 20, moveRange: 3, upkeep: { food: 7, gold: 12, wood: 2, iron: 6 }, naval: true, ranged: true, attackRange: 4, armored: true },    // heavy, strongest of Modern
    // Additional modern ships (Monitor, Ironclad_Frigate, Submarine, Torpedo Boat) we can leave as sidegrades, but we'll keep their stats lower than Ironclad.
    STEAM_TRANSPORT: { name: 'Steam Transport', hp: 32, attack: 3, defense: 9, moveRange: 4, upkeep: { food: 4, gold: 8, wood: 2, iron: 3 }, naval: true, capacity: 4, steamPowered: true },
    IRONCLAD_FRIGATE: { name: 'Ironclad Frigate', hp: 78, attack: 30, defense: 18, moveRange: 3, upkeep: { food: 8, gold: 14, wood: 2, iron: 7 }, naval: true, ranged: true, attackRange: 4, heavyArmor: true }, // slightly less than Ironclad
    MONITOR:     { name: 'Monitor',      hp: 55, attack: 28, defense: 18, moveRange: 2, upkeep: { food: 7, gold: 13, wood: 1, iron: 7 }, naval: true, ranged: true, attackRange: 4, turret: true, aoe: true, aoeRadius: 1 },
    SUBMARINE:   { name: 'Submarine',    hp: 36, attack: 20, defense: 8, moveRange: 3, upkeep: { food: 4, gold: 10, wood: 1, iron: 5 }, naval: true, ranged: true, attackRange: 3, stealth: true, torpedo: true },
    TORPEDO_BOAT:{ name: 'Torpedo Boat', hp: 26, attack: 30, defense: 5, moveRange: 4, upkeep: { food: 3, gold: 8, wood: 1, iron: 4 }, naval: true, ranged: true, attackRange: 3, torpedo: true },

    // --- ANTI-CAVALRY UNITS ---
    HALBERDIER:  { name: 'Halberdier',   hp: 16, attack: 8, defense: 6, moveRange: 1, upkeep: { food: 3, gold: 4, iron: 2 }, ranged: false, attackRange: 1, antiCavalry: true },
    PIKE_MASTER: { name: 'Pike Master',  hp: 24, attack: 12, defense: 11, moveRange: 2, upkeep: { food: 4, gold: 6, iron: 3 }, ranged: false, attackRange: 1, antiCavalry: true },
    BAYONET_RIFLE: { name: 'Bayonet Rifle', hp: 30, attack: 18, defense: 11, moveRange: 2, upkeep: { food: 5, gold: 8, iron: 3 }, ranged: true, attackRange: 3, antiCavalry: true, accurate: true },
    ANTI_TANK_GUN: { name: 'Anti-Tank Gun', hp: 22, attack: 24, defense: 10, moveRange: 2, upkeep: { food: 4, gold: 10, iron: 5 }, ranged: true, attackRange: 3, antiCavalry: true, antiArmor: true },
    RPG_TEAM:     { name: 'RPG Team',    hp: 26, attack: 30, defense: 11, moveRange: 2, upkeep: { food: 4, gold: 12, iron: 6 }, ranged: true, attackRange: 3, antiCavalry: true, antiArmor: true, aoe: true, aoeRadius: 1 },

    // --- MOBILIZED UNITS (Atomic Era, 1880-1940) ---
    MOBILIZED_INFANTRY: { name: 'Mobilized Infantry', hp: 40, attack: 26, defense: 12, moveRange: 4, upkeep: { food: 5, gold: 10, iron: 3 }, ranged: true, attackRange: 2, mobilized: true, accurate: true },
    MOBILIZED_ARTILLERY: { name: 'Mobilized Artillery', hp: 24, attack: 30, defense: 14, moveRange: 4, upkeep: { food: 5, gold: 12, wood: 2, iron: 5 }, besiege: true, besiegePower: 5, ranged: true, attackRange: 3, aoe: true, aoeRadius: 2, mobilized: true, rapidFire: true },
    MOTOR_ARTILLERY: { name: 'Motor Artillery', hp: 30, attack: 32, defense: 15, moveRange: 3, upkeep: { food: 6, gold: 14, iron: 6 }, besiege: true, besiegePower: 6, ranged: true, attackRange: 3, aoe: true, aoeRadius: 2, mobilized: true, mobile: true },
    TANK:        { name: 'Tank',         hp: 45, attack: 30, defense: 18, moveRange: 3, upkeep: { food: 6, gold: 14, iron: 8 }, ranged: true, attackRange: 2, canCharge: true, armored: true, mobilized: true, fortBuster: true },
    HEAVY_TANK:  { name: 'Heavy Tank',   hp: 75, attack: 44, defense: 30, moveRange: 2, upkeep: { food: 7, gold: 18, iron: 12 }, ranged: true, attackRange: 2, canCharge: true, armored: true, fortBuster: true, heavyArmor: true },
    ARMORED_CAR: { name: 'Armored Car',  hp: 28, attack: 22, defense: 10, moveRange: 5, upkeep: { food: 4, gold: 9, iron: 4 }, ranged: true, attackRange: 2, mobilized: true, vision: 6 },

    // --- GENERIC REPLACEMENTS ---
    MERCENARY_KNIGHT: { name: 'Mercenary Knight', hp: 15, attack: 7, defense: 5, moveRange: 2, upkeep: { food: 5, gold: 6, iron: 2 }, ranged: false, attackRange: 1 },
    HOUSEHOLD_GUARD: { name: 'Household Guard', hp: 15, attack: 5, defense: 5, moveRange: 2, upkeep: { food: 4, gold: 5, iron: 1 }, ranged: false, attackRange: 1 },
    FRONTIERSMAN: { name: 'Frontiersman', hp: 11, attack: 6, defense: 3, moveRange: 3, upkeep: { food: 3, gold: 5, iron: 1 }, ranged: true, attackRange: 2 },
    RAIDER:      { name: 'Raider',       hp: 12, attack: 7, defense: 2, moveRange: 2, upkeep: { food: 3, gold: 4 }, ranged: false, attackRange: 1 },

    // --- ATOMIC-ERA NAVAL (tiers: Destroyer=light, Submarine_II=medium, Battleship=heavy; Carrier=special) ---
    DESTROYER:   { name: 'Destroyer',    hp: 88, attack: 34, defense: 18, moveRange: 5, upkeep: { food: 7, gold: 14, iron: 8 }, naval: true, ranged: true, attackRange: 5, vision: 7, fastSail: true, aoe: true, aoeRadius: 3, splashMult: 0.75 }, // > Ironclad (85/32/20) – light beats previous heavy? Actually light should beat previous medium, but we have modern medium as Frigate_2 (70/28/16). Destroyer > Frigate_2 yes. But also we want light > previous heavy? Not necessarily, but we can make it > Ironclad? That would make light of atomic > heavy of modern, which is a big jump, but acceptable if we want clear progression.
    SUBMARINE_II:{ name: 'Submarine II', hp: 60, attack: 30, defense: 15, moveRange: 4, upkeep: { food: 5, gold: 14, iron: 7 }, naval: true, ranged: true, attackRange: 4, stealth: true, torpedo: true, aoe: true, aoeRadius: 2, splashMult: 0.6 }, // medium, could be > Destroyer? We'll make it slightly less than Destroyer.
    BATTLESHIP:  { name: 'Battleship',   hp: 100, attack: 38, defense: 24, moveRange: 4, upkeep: { food: 10, gold: 22, iron: 14 }, naval: true, ranged: true, attackRange: 3, vision: 7, besiege: true, besiegePower: 4, heavyArmor: true, aoe: true, aoeRadius: 3, splashMult: 0.85 }, // heavy, strongest
    AIRCRAFT_CARRIER: { name: 'Aircraft Carrier', hp: 75, attack: 20, defense: 20, moveRange: 4, upkeep: { food: 12, gold: 26, iron: 12 }, naval: true, ranged: true, attackRange: 6, vision: 9, flagship: true, aoe: true, aoeRadius: 2, splashMult: 0.65 },
    TRANSPORT_SHIP: { name: 'Transport Ship', hp: 42, attack: 5, defense: 11, moveRange: 5, upkeep: { food: 6, gold: 12, iron: 4 }, naval: true, capacity: 6, steamPowered: true }
};

// Units available to every faction in addition to its themed roster. Ships
// are unlocked per-city by a Harbor. Faction-signature units (LEGIONNAIRE,
// BERSERKER, VARANGIAN_GUARD, CONQUISTADOR, WINGED_HUSSAR) appear here because
// they're also tech-unlocked — other factions can reach them via research, but
// the UI must tech-gate them (only show once the unlocking tech is researched)
// rather than showing them all from turn 1.
// ARTILLERY/CANNON/MORTAR are also shared (tech-gated by GUNPOWDER/METALLURGY)
// so every faction's siege line stays upgradeable; factions with them in their
// roster (e.g. Iron Empire) get them WITHOUT the tech as their signature perk.
export const EXTRA_UNITS = ['SETTLER', 'ENGINEER', 'WORKER', 'CAVALRY', 'CHARIOT', 'LONGBOWMAN', 'CATAPHRACT', 'MEDIC', 'SIEGE_TOWER', 'LEGIONNAIRE', 'BERSERKER', 'VARANGIAN_GUARD', 'CONQUISTADOR', 'WINGED_HUSSAR', 'TIGER_CANNON', 'STONE_GUARD', 'BATTLE_MAGE', 'SHINOBI', 'JAGUAR_WARRIOR', 'CROSSBOWMAN', 'MUSKETEER', 'ARQUEBUSIER', 'LINE_INFANTRY', 'DRAGOON', 'RIFLEMAN', 'SHARPSHOOTER', 'RAILGUN', 'ARMORED_TRAIN', 'ARTILLERY', 'CANNON', 'MORTAR', 'FIELD_GUN', 'HORSE_ARTILLERY', 'DEMOLITION_SQUAD', 'COMBAT_ENGINEER', 'SIEGE_CANNON', 'HALBERDIER', 'PIKE_MASTER', 'BAYONET_RIFLE', 'ANTI_TANK_GUN', 'RPG_TEAM', 'MOBILIZED_INFANTRY', 'MOBILIZED_ARTILLERY', 'MOTOR_ARTILLERY', 'TANK', 'HEAVY_TANK', 'ARMORED_CAR', 'MERCENARY_KNIGHT', 'HOUSEHOLD_GUARD', 'FRONTIERSMAN', 'RAIDER'];
export const NAVAL_UNITS = ['GALLEY', 'TRANSPORT', 'FRIGATE', 'GALLEON', 'MAN_OF_WAR', 'GALLEASS', 'PINNACE', 'CORVETTE', 'FROLIC', 'MERCHANTMAN', 'IRONCLAD', 'STEAM_TRANSPORT', 'GUNBOAT', 'IRONCLAD_FRIGATE', 'MONITOR', 'FRIGATE_2', 'SUBMARINE', 'TORPEDO_BOAT', 'DESTROYER', 'BATTLESHIP', 'AIRCRAFT_CARRIER', 'TRANSPORT_SHIP', 'SUBMARINE_II'];
// Long-range siege engines, unlocked per-city by a Siege Workshop (mirrors the
// Harbor→ships gating). Not part of any faction roster by default.
export const SIEGE_ENGINES = ['CATAPULT', 'TREBUCHET'];

// Faction-unique units: only the listed faction can train these. Other
// factions can research the tech that gates them (e.g. CHIVALRY), but the unit
// stays exclusive to its owner. This fixes the bug where every faction could
// train e.g. WINGED_HUSSAR after researching CHIVALRY. The owning faction's
// roster already lists the unit, so the check is `factionDef.roster.includes(u)
// || !FACTION_UNIQUE_UNITS[u]`.
export const FACTION_UNIQUE_UNITS = {
    LEGIONNAIRE:     'roman',
    BERSERKER:       'viking',
    VARANGIAN_GUARD: 'byzantine',
    CONQUISTADOR:    'spanish',
    WINGED_HUSSAR:   'polish',
    TIGER_CANNON:    'ming',
    STONE_GUARD:     'stone',
    BATTLE_MAGE:     'arcane',
    SHINOBI:         'lotus',
    JAGUAR_WARRIOR:  'sun'
};

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
    CITY:     { defense: 8,  attack: 1 }       // Fortifications + organized militia (buffed from 5)
};

export const UNIT_COST = {
    INFANTRY:    { gold: 30, food: 10, wood: 0,  iron: 0,  production: 10 },
    ARCHER:      { gold: 40, food: 0,  wood: 20, iron: 0,  production: 15 },
    ARTILLERY:   { gold: 45, food: 0,  wood: 15, iron: 12, production: 18 },
    CAVALRY:     { gold: 50, food: 30, wood: 0,  iron: 10, production: 20 },
    PIKEMAN:     { gold: 35, food: 8,  wood: 5,  iron: 8,  production: 12 },
    SCOUT:       { gold: 20, food: 5,  wood: 5,  iron: 0,  production: 6 },
    SIEGE:       { gold: 40, food: 5,  wood: 8,  iron: 8,  production: 15 },
    SETTLER:     { gold: 40, food: 20, wood: 0,  iron: 0,  production: 15 },
    ENGINEER:    { gold: 45, food: 8,  wood: 15, iron: 8,  production: 15 },
    WORKER:      { gold: 25, food: 8,  wood: 5,  iron: 0,  production: 8 },
    LONGBOWMAN:  { gold: 45, food: 0,  wood: 18, iron: 0,  production: 14 },
    CATAPHRACT:  { gold: 65, food: 15, wood: 0,  iron: 12, production: 18 },
    CHARIOT:     { gold: 50, food: 15, wood: 12, iron: 8,  production: 15 },
    MEDIC:       { gold: 40, food: 8,  wood: 8,  iron: 0,  production: 12 },
    SIEGE_TOWER: { gold: 30, food: 5,  wood: 12, iron: 0,  production: 12 },
    LEGIONNAIRE:    { gold: 30, food: 6,  wood: 5,  iron: 3,  production: 10 },
    BERSERKER:      { gold: 40, food: 8,  wood: 5,  iron: 5,  production: 13 },
    VARANGIAN_GUARD:{ gold: 60, food: 8,  wood: 0,  iron: 12, production: 18 },
    CONQUISTADOR:   { gold: 45, food: 10, wood: 5,  iron: 8,  production: 14 },
    WINGED_HUSSAR:  { gold: 70, food: 15, wood: 0,  iron: 12, production: 20 },
    TIGER_CANNON:   { gold: 60, food: 5,  wood: 12, iron: 5,  production: 18 },
    STONE_GUARD:    { gold: 35, food: 8,  wood: 0,  iron: 6,  production: 12 },
    BATTLE_MAGE:    { gold: 45, food: 5,  wood: 5,  iron: 0,  production: 12 },
    SHINOBI:        { gold: 35, food: 5,  wood: 5,  iron: 2,  production: 10 },
    JAGUAR_WARRIOR: { gold: 40, food: 8,  wood: 0,  iron: 4,  production: 12 },
    CROSSBOWMAN:    { gold: 50, food: 0,  wood: 18, iron: 0,  production: 14 },
    CATAPULT:    { gold: 55,  food: 0,  wood: 10, iron: 0,  production: 18 },
    TREBUCHET:   { gold: 65,  food: 0,  wood: 15, iron: 5,  production: 20 },
    GALLEY:      { gold: 30, food: 8,  wood: 15, iron: 0,  production: 12 },
    TRANSPORT:   { gold: 18, food: 5,  wood: 10, iron: 0,  production: 10 },
    FRIGATE:     { gold: 45, food: 12, wood: 22, iron: 8,  production: 18 },
    GALLEON:     { gold: 65, food: 15, wood: 30, iron: 15, production: 22 },
    // === RENAISSANCE ERA UNIT COSTS ===
    MUSKETEER:   { gold: 60, food: 12, wood: 8,  iron: 12, production: 17 },
    ARQUEBUSIER: { gold: 55, food: 8,  wood: 8,  iron: 10, production: 15 },
    MAN_OF_WAR:  { gold: 90, food: 15, wood: 35, iron: 18, production: 25 },
    GALLEASS:    { gold: 65, food: 12, wood: 30, iron: 12, production: 20 },
    PINNACE:     { gold: 40, food: 6,  wood: 18, iron: 5,  production: 14 },
    // === ENLIGHTENMENT ERA UNIT COSTS ===
    LINE_INFANTRY: { gold: 75, food: 15, wood: 8,  iron: 15, production: 22 },
    DRAGOON:     { gold: 80, food: 18, wood: 8,  iron: 14, production: 24 },
    CANNON:      { gold: 90, food: 8,  wood: 12, iron: 22, production: 28 },
    MORTAR:      { gold: 75, food: 8,  wood: 12, iron: 18, production: 24 },
    CORVETTE:    { gold: 55, food: 10, wood: 25, iron: 8,  production: 18 },
    FROLIC:      { gold: 75, food: 14, wood: 32, iron: 12, production: 24 },
    MERCHANTMAN: { gold: 45, food: 12, wood: 18, iron: 5,  production: 15 },
    // === MODERN ERA UNIT COSTS ===
    RIFLEMAN:    { gold: 100, food: 18, wood: 8,  iron: 22, production: 28 },
    SHARPSHOOTER: { gold: 110, food: 15, wood: 8,  iron: 18, production: 30 },
    RAILGUN:     { gold: 120, food: 12, wood: 8,  iron: 32, production: 32 },
    ARMORED_TRAIN: { gold: 110, food: 15, wood: 12, iron: 28, production: 30 },
    FIELD_GUN:   { gold: 100, food: 12, wood: 10, iron: 25, production: 30 },
    HORSE_ARTILLERY: { gold: 105, food: 15, wood: 10, iron: 25, production: 30 },
    DEMOLITION_SQUAD: { gold: 65, food: 8,  wood: 12, iron: 8,  production: 20 },
    COMBAT_ENGINEER: { gold: 90, food: 10, wood: 10, iron: 12, production: 26 },
    SIEGE_CANNON: { gold: 110, food: 8,  wood: 12, iron: 28, production: 30 },
    IRONCLAD:    { gold: 130, food: 18, wood: 15, iron: 35, production: 35 },
    STEAM_TRANSPORT: { gold: 65, food: 12, wood: 12, iron: 16, production: 20 },
    GUNBOAT:     { gold: 60, food: 8,  wood: 15, iron: 12, production: 18 },
    IRONCLAD_FRIGATE: { gold: 140, food: 22, wood: 15, iron: 42, production: 38 },
    MONITOR:     { gold: 135, food: 18, wood: 12, iron: 38, production: 36 },
    FRIGATE_2:   { gold: 95, food: 15, wood: 30, iron: 15, production: 25 },
    SUBMARINE:   { gold: 115, food: 10, wood: 8,  iron: 32, production: 30 },
    TORPEDO_BOAT: { gold: 75, food: 6,  wood: 8,  iron: 22, production: 22 },
    // === ANTI-CAVALRY UNIT COSTS ===
    HALBERDIER:  { gold: 55, food: 10, wood: 5,  iron: 10, production: 16 },
    PIKE_MASTER: { gold: 85, food: 14, wood: 8,  iron: 16, production: 22 },
    BAYONET_RIFLE: { gold: 115, food: 16, wood: 8,  iron: 20, production: 28 },
    ANTI_TANK_GUN: { gold: 130, food: 14, wood: 8,  iron: 24, production: 30 },
    RPG_TEAM:     { gold: 150, food: 14, wood: 8,  iron: 28, production: 34 },
    // === MOBILIZED / ATOMIC-ERA UNIT COSTS ===
    MOBILIZED_INFANTRY: { gold: 130, food: 18, wood: 8,  iron: 26, production: 32 },
    MOBILIZED_ARTILLERY: { gold: 135, food: 14, wood: 10, iron: 30, production: 34 },
    MOTOR_ARTILLERY: { gold: 160, food: 16, wood: 12, iron: 36, production: 38 },
    TANK:        { gold: 170, food: 18, wood: 8,  iron: 42, production: 40 },
    HEAVY_TANK:  { gold: 210, food: 22, wood: 10, iron: 52, production: 46 },
    ARMORED_CAR: { gold: 100, food: 12, wood: 6,  iron: 22, production: 24 },
    // Generic replacement unit costs (weaker than the faction-unique originals)
    MERCENARY_KNIGHT: { gold: 60, food: 15, wood: 0,  iron: 12, production: 18 },
    HOUSEHOLD_GUARD: { gold: 55, food: 8,  wood: 0,  iron: 10, production: 16 },
    FRONTIERSMAN: { gold: 55, food: 10, wood: 5,  iron: 10, production: 15 },
    RAIDER:      { gold: 40, food: 8,  wood: 5,  iron: 5,  production: 13 },
    DESTROYER:   { gold: 170, food: 20, wood: 12, iron: 42, production: 40 },
    BATTLESHIP:  { gold: 240, food: 26, wood: 14, iron: 60, production: 52 },
    AIRCRAFT_CARRIER: { gold: 280, food: 30, wood: 16, iron: 56, production: 56 },
    TRANSPORT_SHIP: { gold: 95, food: 16, wood: 16, iron: 20, production: 24 },
    SUBMARINE_II: { gold: 160, food: 14, wood: 8,  iron: 42, production: 36 }
};

// Cost to build a bridge across a river tile.
export const BRIDGE_COST = { gold: 40, wood: 3 };

// Cost for an Engineer to start constructing a Siege Tower (paid up front; the
// tower is built over SIEGE_TOWER_BUILD_TURNS turns, then spawns on completion).
export const SIEGE_TOWER_COST = { gold: 2, wood: 1, iron: 0, production: 0 };
export const SIEGE_TOWER_BUILD_TURNS = 2;
export const SIEGE_TOWER_BUILD_RADIUS = 3; // Engineer must be within this Chebyshev radius of an enemy city

// Engineers can only build Siege Towers (not CATAPULT/TREBUCHET).
// Long-range siege engines require a Siege Workshop building in a city.
export const SIEGE_ENGINE_BUILD_COST = { gold: 35, wood: 10, iron: 0, production: 15 };
export const SIEGE_ENGINE_BUILD_TURNS = 2;

// Cost for an Engineer to construct Ladders (cheaper alternative to siege tower,
// allows infantry to assault fortified cities). Requires wood, built in 1 turn.
export const LADDER_COST = { gold: 30, wood: 15 };
export const LADDER_BUILD_TURNS = 1;
export const LADDER_BUILD_RADIUS = 3; // Engineer must be within this Chebyshev radius of an enemy city

// Type advantage system (rock-paper-scissors web)
//
// Core land triangle:
//   Cavalry beats Infantry & Archers (fast charge)
//   Infantry beats Archers & Siege (closes distance, melee overwhelm)
//   Archers/Crossbows beat Artillery & Siege (out-range slow engines)
//   Artillery beats Cavalry & massed Infantry (area fire / cannons)
//   Pikemen/Halberdiers hard-counter Cavalry
//
// Era progression:
//   Gunpowder units (Musketeer -> Line -> Rifle) beat older melee/ranged.
//   Tanks/Armor beat infantry and old artillery, but are countered by
//   bayonet rifles, anti-tank guns, and RPG teams.
export const TYPE_ADVANTAGE = {
    // Infantry: strong against ranged (closing distance) and siege (melee overwhelm).
    INFANTRY:    { strongAgainst: ['ARCHER', 'LONGBOWMAN', 'CROSSBOWMAN', 'SIEGE', 'ARTILLERY'], multiplier: 1.5 },
    ARCHER:      { strongAgainst: ['ARTILLERY', 'SIEGE', 'CROSSBOWMAN'], multiplier: 1.4 },
    LONGBOWMAN:  { strongAgainst: ['ARTILLERY', 'SIEGE'], multiplier: 1.4 },
    ARTILLERY:   { strongAgainst: ['CAVALRY', 'CATAPHRACT', 'CHARIOT', 'WINGED_HUSSAR', 'SIEGE', 'INFANTRY'], multiplier: 1.5 },
    CAVALRY:     { strongAgainst: ['INFANTRY', 'ARCHER', 'LONGBOWMAN', 'CROSSBOWMAN'], multiplier: 1.5 },
    PIKEMAN:     { strongAgainst: ['CAVALRY', 'CATAPHRACT', 'CHARIOT', 'WINGED_HUSSAR', 'DRAGOON', 'TANK', 'HEAVY_TANK', 'ARMORED_CAR'], multiplier: 1.6 },
    CATAPHRACT:  { strongAgainst: ['INFANTRY', 'ARCHER', 'LONGBOWMAN', 'CROSSBOWMAN'], multiplier: 1.5 },
    CHARIOT:     { strongAgainst: ['ARCHER', 'LONGBOWMAN', 'CROSSBOWMAN', 'INFANTRY'], multiplier: 1.4 },
    CROSSBOWMAN: { strongAgainst: ['CAVALRY', 'CATAPHRACT', 'CHARIOT', 'WINGED_HUSSAR', 'INFANTRY'], multiplier: 1.4 },
    // Naval type advantages
    FRIGATE:     { strongAgainst: 'GALLEY',    multiplier: 1.5 },
    GALLEON:     { strongAgainst: 'FRIGATE',   multiplier: 1.4 },
    // Renaissance era type advantages
    ARQUEBUSIER: { strongAgainst: ['INFANTRY', 'ARCHER', 'PIKEMAN', 'CAVALRY', 'CATAPHRACT'], multiplier: 1.4 },
    MUSKETEER:   { strongAgainst: ['CROSSBOWMAN', 'INFANTRY', 'ARCHER', 'PIKEMAN', 'CAVALRY', 'CATAPHRACT'], multiplier: 1.4 },
    MAN_OF_WAR:  { strongAgainst: 'GALLEON',   multiplier: 1.5 },
    // Enlightenment era type advantages
    LINE_INFANTRY: { strongAgainst: ['MUSKETEER', 'INFANTRY', 'ARCHER', 'PIKEMAN', 'CAVALRY', 'CATAPHRACT'], multiplier: 1.4 },
    DRAGOON:     { strongAgainst: ['INFANTRY', 'ARCHER', 'ARTILLERY', 'CROSSBOWMAN'], multiplier: 1.4 },
    CANNON:      { strongAgainst: ['MUSKETEER', 'SIEGE', 'CAVALRY', 'GALLEY', 'TRANSPORT', 'FRIGATE'], multiplier: 1.5 },
    MORTAR:      { strongAgainst: ['LINE_INFANTRY', 'INFANTRY', 'SIEGE'], multiplier: 1.5 },
    CORVETTE:    { strongAgainst: 'TRANSPORT', multiplier: 1.6 },
    FROLIC:      { strongAgainst: 'CORVETTE',  multiplier: 1.4 },
    // Modern era type advantages
    RIFLEMAN:    { strongAgainst: ['LINE_INFANTRY', 'MUSKETEER', 'INFANTRY', 'ARCHER', 'PIKEMAN', 'CAVALRY', 'CATAPHRACT'], multiplier: 1.5 },
    SHARPSHOOTER:{ strongAgainst: ['RIFLEMAN', 'MUSKETEER', 'LINE_INFANTRY', 'INFANTRY', 'ARCHER', 'PIKEMAN', 'CAVALRY', 'CATAPHRACT'], multiplier: 1.4 },
    IRONCLAD:    { strongAgainst: 'FRIGATE',   multiplier: 1.6 },
    MONITOR:     { strongAgainst: 'IRONCLAD',  multiplier: 1.4 },
    RAILGUN:     { strongAgainst: ['CANNON', 'SIEGE_CANNON', 'INFANTRY'], multiplier: 1.5 },
    FIELD_GUN:   { strongAgainst: ['CAVALRY', 'INFANTRY', 'TANK', 'SIEGE'], multiplier: 1.4 },
    HORSE_ARTILLERY: { strongAgainst: ['CAVALRY', 'INFANTRY', 'SIEGE'], multiplier: 1.4 },
    SUBMARINE:   { strongAgainst: ['MAN_OF_WAR','IRONCLAD','MONITOR'], multiplier: 2.5 },
    TORPEDO_BOAT: { strongAgainst: ['IRONCLAD','SUBMARINE'], multiplier: 1.8 },
    // Anti-cavalry specialists: very strong vs all mounted units (cavalry,
    // cataphract, chariot, hussar, dragoon, tank, armored car). Their whole
    // role is to break cavalry charges.
    HALBERDIER:  { strongAgainst: ['CAVALRY', 'CATAPHRACT', 'CHARIOT', 'WINGED_HUSSAR', 'DRAGOON', 'TANK', 'HEAVY_TANK', 'ARMORED_CAR'], multiplier: 1.8 },
    PIKE_MASTER: { strongAgainst: ['CAVALRY', 'CATAPHRACT', 'CHARIOT', 'WINGED_HUSSAR', 'DRAGOON', 'TANK', 'HEAVY_TANK', 'ARMORED_CAR'], multiplier: 2.0 },
    BAYONET_RIFLE: { strongAgainst: ['TANK', 'ARMORED_CAR', 'HEAVY_TANK', 'CAVALRY', 'CATAPHRACT'], multiplier: 1.7 },
    // Anti-tank gun: transitional anti-armor — strong vs tanks, decent vs
    // armored cars, but less effective vs infantry (specialist).
    ANTI_TANK_GUN: { strongAgainst: ['TANK', 'HEAVY_TANK', 'ARMORED_CAR', 'MOTOR_ARTILLERY'], multiplier: 1.9 },
    // RPG team: the premier anti-armor unit. Devastating vs all armored
    // vehicles (tanks, heavy tanks, armored cars, motor artillery) and still
    // good vs old cavalry. The AOE splash means a hit can chip adjacent armor.
    RPG_TEAM:     { strongAgainst: ['TANK', 'HEAVY_TANK', 'ARMORED_CAR', 'MOTOR_ARTILLERY', 'MOBILIZED_ARTILLERY', 'CAVALRY', 'CATAPHRACT'], multiplier: 2.2 },
    // Atomic era: tanks crush old infantry and artillery (modern cavalry role).
    TANK:        { strongAgainst: ['RIFLEMAN', 'LINE_INFANTRY', 'MUSKETEER', 'INFANTRY', 'FIELD_GUN', 'MORTAR', 'ARTILLERY'], multiplier: 1.6 },
    HEAVY_TANK:  { strongAgainst: ['TANK', 'RIFLEMAN', 'LINE_INFANTRY', 'MUSKETEER', 'FIELD_GUN', 'MORTAR', 'CANNON', 'ARTILLERY', 'INFANTRY'], multiplier: 1.5 },
    ARMORED_CAR: { strongAgainst: ['INFANTRY', 'ARCHER', 'SCOUT', 'CROSSBOWMAN'], multiplier: 1.5 },
    // Mobilized units outmaneuver the foot-bound line but are themselves
    // vulnerable to entrenched defenders (a motorized column takes extra
    // damage from fortification/anti-tank weapons — represented here by
    // BAYONET_RIFLE's advantage over them).
    MOBILIZED_INFANTRY: { strongAgainst: ['RIFLEMAN', 'LINE_INFANTRY', 'INFANTRY'], multiplier: 1.4 },
    MOBILIZED_ARTILLERY: { strongAgainst: ['FIELD_GUN', 'CANNON', 'MORTAR', 'ARTILLERY'], multiplier: 1.5 },
    MOTOR_ARTILLERY: { strongAgainst: ['SIEGE_CANNON', 'RAILGUN', 'FIELD_GUN', 'CANNON', 'INFANTRY'], multiplier: 1.5 },
    // Naval: destroyers counter submarines, battleships dominate cruisers,
    // carriers boost adjacent fleets. Submarine II is deadlier vs capital ships.
    DESTROYER:   { strongAgainst: ['SUBMARINE', 'SUBMARINE_II', 'TORPEDO_BOAT'], multiplier: 1.7 },
    BATTLESHIP:  { strongAgainst: ['IRONCLAD_FRIGATE', 'MONITOR', 'DESTROYER'], multiplier: 1.5 },
    AIRCRAFT_CARRIER: { strongAgainst: ['BATTLESHIP', 'IRONCLAD'], multiplier: 1.4 },
    SUBMARINE_II: { strongAgainst: ['BATTLESHIP', 'AIRCRAFT_CARRIER', 'IRONCLAD_FRIGATE'], multiplier: 3.0 },
    // Artillery has a slight advantage vs ships (shore bombardment).
    ARTILLERY:   { strongAgainst: ['CAVALRY', 'GALLEY', 'TRANSPORT', 'FRIGATE', 'GALLEON'], multiplier: 1.2 },
    CANNON:      { strongAgainst: ['MUSKETEER', 'SIEGE', 'GALLEY', 'TRANSPORT', 'FRIGATE'], multiplier: 1.2 }
};

// --- Land vs Naval combat penalties ---
// Land units (infantry, cavalry) can attack adjacent ships (e.g. when a ship
// is adjacent to shore), but they fight at a severe disadvantage. Artillery
// has a slight bonus vs ships (shore bombardment). This prevents land units
// from trivially sinking warships while making coastal artillery useful.
export const LAND_VS_NAVAL_PENALTY = 0.35;
export const LAND_NAVAL_TYPES = new Set(['INFANTRY', 'CAVALRY', 'PIKEMAN', 'CATAPHRACT', 'CHARIOT',
    'LEGIONNAIRE', 'BERSERKER', 'VARANGIAN_GUARD', 'LINE_INFANTRY', 'HALBERDIER', 'PIKE_MASTER',
    'BAYONET_RIFLE', 'MOBILIZED_INFANTRY', 'HOUSEHOLD_GUARD', 'RAIDER']);

/** Era classification for blanket modern-vs-medieval combat advantage.
 *  Modern units deal bonus damage to all medieval units. */
export const MEDIEVAL_UNIT_TYPES = new Set([
    'INFANTRY', 'ARCHER', 'ARTILLERY', 'CAVALRY', 'PIKEMAN', 'SCOUT', 'SIEGE', 'LONGBOWMAN',
    'CATAPHRACT', 'CHARIOT', 'MEDIC', 'SIEGE_TOWER', 'LEGIONNAIRE', 'BERSERKER',
    'VARANGIAN_GUARD', 'CONQUISTADOR', 'WINGED_HUSSAR', 'TIGER_CANNON', 'STONE_GUARD',
    'BATTLE_MAGE', 'SHINOBI', 'JAGUAR_WARRIOR', 'CROSSBOWMAN', 'CATAPULT', 'TREBUCHET',
    'GALLEY', 'TRANSPORT', 'FRIGATE', 'GALLEON'
]);

export const MODERN_UNIT_TYPES = new Set([
    'MUSKETEER', 'ARQUEBUSIER', 'LINE_INFANTRY', 'DRAGOON', 'CANNON', 'MORTAR',
    'RIFLEMAN', 'SHARPSHOOTER', 'RAILGUN', 'ARMORED_TRAIN', 'FIELD_GUN', 'HORSE_ARTILLERY',
    'DEMOLITION_SQUAD', 'COMBAT_ENGINEER', 'SIEGE_CANNON',
    'GUNBOAT', 'FRIGATE_2', 'IRONCLAD', 'STEAM_TRANSPORT', 'IRONCLAD_FRIGATE', 'MONITOR',
    'SUBMARINE', 'TORPEDO_BOAT',
    'HALBERDIER', 'PIKE_MASTER', 'BAYONET_RIFLE', 'ANTI_TANK_GUN', 'RPG_TEAM',
    'MOBILIZED_INFANTRY', 'MOBILIZED_ARTILLERY', 'MOTOR_ARTILLERY', 'TANK', 'HEAVY_TANK', 'ARMORED_CAR'
]);

/** Siege/artillery unit types used for special combat and city-besiege rules. */
export const SIEGE_TYPES = new Set(['SIEGE', 'ARTILLERY', 'CATAPULT', 'TREBUCHET', 'TIGER_CANNON', 'CANNON', 'MORTAR',
    'FIELD_GUN', 'HORSE_ARTILLERY', 'SIEGE_CANNON', 'RAILGUN']);

export const CAPTURE_COST = 20; // Gold to capture an unowned tile

// Pillage: a military unit can destroy an enemy terrain improvement on an
// adjacent tile, pocketing a gold reward. One improvement per pillage action.
export const PILLAGE_GOLD_REWARD = 15;
export const PILLAGEABLE_BUILDINGS = ['FARM', 'LUMBERMILL', 'MINE', 'BARRACKS', 'SIEGE_WORKSHOP', 'HARBOR', 'MARKET', 'UNIVERSITY', 'BANK', 'COMMAND_POST', 'POWER_PLANT'];

// AOE/fire ailment tuning for siege engines (CATAPULT, TREBUCHET).
// Ranged attack damage multiplier by Chebyshev distance to target.
// 100% adjacent, 80% at 2 tiles, 25% from 3 tiles onwards (artillery
// stays lethal near the walls but can't snipe across the map).
export const RANGED_DISTANCE_FALLOFF = { 2: 0.8, 3: 0.25, 4: 0.15 };
export const RANGED_FALLOFF_MIN = 0.1;  // distance 5+

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
export const CHARGE_UNITS = ['CAVALRY', 'CATAPHRACT', 'TANK', 'HEAVY_TANK'];  // unit types that can charge
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
export const CHARIOT_CHARGE_VULN_TYPES = ['INFANTRY', 'ARTILLERY', 'ARCHER', 'LONGBOWMAN', 'CATAPULT', 'TREBUCHET', 'TIGER_CANNON', 'BATTLE_MAGE'];
export const CHARIOT_CHARGE_VULN_MULT = 2.0;      // extra damage multiplier vs vulnerable types

// --- Freeze (Frost Clan Winter's Grasp) ---
// Frozen units cannot move on their next turn. The freeze counter is set by the
// Winter's Grasp active ability and ticks down at the start of the frozen
// unit's owner's turn (like charge exhaustion).
export const FREEZE_TURNS = 1; // units frozen by Winter's Grasp skip 1 move

// --- Ranged arrow bombard vs cities ---
// Non-siege ranged units can fire at an enemy fortified city to chip its
// fortification from range. Damage is intentionally nerfed (1/turn) vs proper
// siege engines — bows and muskets harass, they don't breach.
export const RANGED_BOMBARD_FORT_DAMAGE = 1;
export const RANGED_BOMBARD_TYPES = ['ARCHER', 'LONGBOWMAN', 'CROSSBOWMAN', 'MUSKETEER', 'ARQUEBUSIER', 'RIFLEMAN', 'SHARPSHOOTER'];

// --- Ranged / siege effectiveness vs city defenders ---
// Ranged units get a slight attack bonus when shooting at a defender inside a
// city (shooting into a packed garrison/walls is easier than open-field skirmish).
// Siege engines deal multiplied damage to city defenders — they are purpose-built
// to smash fortifications and entrenched garrisons.
export const RANGED_CITY_ATTACK_BONUS = 2;
export const SIEGE_CITY_DAMAGE_MULTIPLIER = 2.5;

// --- Siege pressure (fortification wear-down) ---
// Each time a city takes fortification damage (besiege, arrow bombard, or a
// ranged combat chip) its `siegePressure` counter rises. While pressure > 0
// the city's fortification does NOT regenerate; pressure decays by 1 per
// unattacked turn, after which the normal +1/turn regen resumes. A freshly
// breached city therefore stays at 0 through the following turn (a real
// capture window), and sustained bombardment keeps a city pinned down even
// without an adjacent besieger.
export const SIEGE_PRESSURE_PER_HIT = 1;
export const SIEGE_PRESSURE_MAX = 4;

// --- Ranged combat chip vs unbreached cities ---
// When a ranged unit attacks a defender standing on an UNBREACHED enemy city,
// the city's fortification is chipped as well as damaging the defender: heavy
// siege artillery chips by its besiegePower, all other ranged units (archers
// and the like) chip by RANGED_BOMBARD_FORT_DAMAGE.
export const HEAVY_SIEGE_FORT_CHIP_TYPES = ['ARTILLERY', 'CANNON', 'MORTAR', 'FIELD_GUN', 'HORSE_ARTILLERY', 'SIEGE_CANNON', 'RAILGUN', 'CATAPULT', 'TREBUCHET', 'TIGER_CANNON', 'MOBILIZED_ARTILLERY', 'MOTOR_ARTILLERY', 'BATTLESHIP'];

// --- Siege Tower assault support ---
// A friendly SIEGE_TOWER adjacent to an unbreached city undermines its
// defenses: combat against that city's garrison reduces the city's defense
// bonus by this amount (half of TERRAIN_BONUS.CITY.defense).
export const SIEGE_TOWER_CITY_DEFENSE_REDUCTION = 4;

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
export const CITY_PRODUCTION_PER_LEVEL = 3;     // total spread across levels (diminishing)
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
// Raised to 40: it is now a sanity ceiling only. The AI trains up to the
// engine's per-city unit cap (getUnitCap: 5 + (level-1)*2 per city), capped here
// so a huge empire doesn't bankrupt itself on upkeep chasing an unbounded cap.
export const AI_MAX_UNITS = 40;

// --- Economy ---
export const MARKET_RATES = {
    wood: 0.5,   // 2 wood -> 1 gold
    iron: 1.0,   // 1 iron -> 1 gold
    food: 0.4    // 2.5 food -> 1 gold
};

export const TRADE_ROUTE_GOLD = 10; // per turn per route
export const STARVATION_ATTRITION = 2; // hp lost per starving unit per turn

// --- Buildings ---
// All buildings below may be built on any passable land tile inside a city's
// influence (not just the city tile) — set `influenceBuildable: true`. This
// keeps the scarce city tile free and lets the player fortify/equip the
// surrounding region. Military buildings (and economic ones with HP) can be
// attacked, damaged, and pillaged. FARM/LUMBERMILL/MINE remain terrain-matched.
export const BUILDING_TYPE = {
    FARM:       { name: 'Farm',       cost: { gold: 40, wood: 20 },              bonus: { food: 2 },   terrain: 'PLAINS', maxPerCity: 2, desc: '+2 food/turn.' },
    LUMBERMILL: { name: 'Lumbermill', cost: { gold: 50, wood: 10 },              bonus: { wood: 6 },   terrain: 'FOREST', maxPerCity: 2, desc: '+6 wood/turn.' },
    MINE:       { name: 'Mine',       cost: { gold: 60, wood: 20, iron: 10 },   bonus: { iron: 5 },   terrain: 'MOUNTAIN', terrains: ['MOUNTAIN', 'HILLS'], maxPerCity: 2, desc: '+5 iron/turn.' },
    MARKET:     { name: 'Market',     cost: { gold: 80, wood: 30 },              bonus: { gold: 10 },  terrain: 'CITY', influenceBuildable: true, military: true,
                  desc: '+10 gold/turn. Buildable in the city or its influence; pillageable by enemy units.', techRequired: 'MATHEMATICS' },
    BARRACKS:   { name: 'Barracks',   cost: { gold: 60, wood: 20, iron: 10 },   bonus: { production: 10 }, terrain: 'CITY', influenceBuildable: true, military: true,
                  desc: '+10 production/turn. Units trained in this city start as veterans and cost less gold. Buildable in the city or its influence.' },
    WALLS:      { name: 'Walls',      cost: { gold: 70, wood: 0, iron: 30 },    bonus: { defense: 5 }, terrain: 'CITY',
                  desc: '+5 defense to units defending this tile (strong fortification). Stays on the city tile.', techRequired: 'FORTIFICATION' },
    HARBOR:     { name: 'Harbor',     cost: { gold: 60, wood: 30, iron: 0 },    bonus: { production: 5 }, terrain: 'CITY', influenceBuildable: true, military: true,
                  desc: 'Unlocks naval units (GALLEY, TRANSPORT). +5 production/turn. Build in a coastal/river city or its influence.', techRequired: 'NAVAL_ENGINEERING' },
    SIEGE_WORKSHOP: { name: 'Siege Workshop', cost: { gold: 80, wood: 20, iron: 0 }, bonus: { production: 5 }, terrain: 'CITY', influenceBuildable: true, military: true,
                  desc: 'Unlocks long-range siege engines (CATAPULT, TREBUCHET). +5 production/turn. Build in any city or its influence.', techRequired: 'SIEGE_CRAFT' },
    // === CLASSICAL ERA BUILDINGS ===
    LIBRARY:     { name: 'Library',     cost: { gold: 60, wood: 30 },              bonus: { research: 2 }, terrain: 'CITY', influenceBuildable: true, military: true,
                  desc: '+2 research points per turn. Buildable in the city or its influence; pillageable by enemy units.', techRequired: 'MATHEMATICS' },
    // === RENAISSANCE ERA BUILDINGS ===
    CITADEL:     { name: 'Citadel',     cost: { gold: 120, wood: 40, iron: 30 }, bonus: { defense: 8 }, terrain: 'CITY', upgradesFrom: 'WALLS',
                  desc: '+8 defense to units defending this tile. Upgrades Walls. Stays on the city tile.', techRequired: 'BASTION_FORT' },
    // === ENLIGHTENMENT ERA BUILDINGS ===
    UNIVERSITY:  { name: 'University',  cost: { gold: 100, wood: 40 }, bonus: { research: 5 }, terrain: 'CITY', influenceBuildable: true, military: true,
                  desc: '+5 research points per turn. Buildable in the city or its influence; pillageable by enemy units.' },
    BANK:        { name: 'Bank',        cost: { gold: 200, wood: 40 }, bonus: { gold: 20 }, terrain: 'CITY', influenceBuildable: true, military: true,
                  desc: '+20 gold per turn. Buildable in the city or its influence; pillageable by enemy units.', techRequired: 'BANKING' },
    // === MODERN ERA BUILDINGS ===
    COMMAND_POST:{ name: 'Command Post', cost: { gold: 180, wood: 50, iron: 40 }, bonus: { production: 8 }, terrain: 'CITY', influenceBuildable: true, military: true,
                  desc: '+8 production per turn. Lords gain +2 command range. Buildable in the city or its influence; pillageable by enemy units.', techRequired: 'TELEGRAPH' },
    POWER_PLANT: { name: 'Power Plant', cost: { gold: 250, wood: 60, iron: 50 }, bonus: { production: 12 }, terrain: 'CITY', influenceBuildable: true, military: true,
                  desc: '+12 production per turn. Buildable in the city or its influence; pillageable by enemy units.', techRequired: 'ELECTRICITY' },
    RESEARCH_INSTITUTE: { name: 'Research Institute', cost: { gold: 200, wood: 80, iron: 40 }, bonus: { research: 8 }, terrain: 'CITY', influenceBuildable: true, military: true,
                  desc: '+8 research points per turn. Buildable in the city or its influence; pillageable by enemy units.', techRequired: 'SCIENTIFIC_METHOD' }
};

// Military structures outside cities can be attacked, damaged, and pillaged.
// All influence-buildable buildings have HP so they can be attacked/pillaged.
export const MILITARY_BUILDING_HP = { BARRACKS: 20, SIEGE_WORKSHOP: 25, HARBOR: 30, MARKET: 15, UNIVERSITY: 20, BANK: 20, COMMAND_POST: 25, POWER_PLANT: 30, LIBRARY: 15, RESEARCH_INSTITUTE: 30 };
export const MILITARY_BUILDING_DEFENSE = { BARRACKS: 2, SIEGE_WORKSHOP: 3, HARBOR: 3 };

// Per-level upgrade curves for military buildings (max level 3). Each level
// grants a higher veteran level + cheaper training (diminishing returns).
export const MILITARY_BUILDING_LEVELS = {
    BARRACKS: [
        { veteranLevel: 2, goldMult: 0.75, upgradeCost: null },
        { veteranLevel: 3, goldMult: 0.65, upgradeCost: { gold: 90, iron: 20 } }
    ],
    HARBOR: [
        { veteranLevel: 2, goldMult: 0.85, upgradeCost: null },
        { veteranLevel: 3, goldMult: 0.75, upgradeCost: { gold: 90, iron: 20 } }
    ],
    SIEGE_WORKSHOP: [
        { veteranLevel: 2, goldMult: 0.85, upgradeCost: null },
        { veteranLevel: 3, goldMult: 0.75, upgradeCost: { gold: 90, iron: 20 } }
    ]
};
export const BUILDING_MAX_LEVEL = 3;

// Pillage reward gold for destroying an enemy military structure.
export const MILITARY_PILLAGE_GOLD = 40;

// --- Engineer Structures (traps / defensive structures) ---
// Engineers (and their modern upgrades DEMOLITION_SQUAD / COMBAT_ENGINEER) can
// build one of several structure types on owned tiles within city influence.
// Structures are removed when an enemy captures the tile.
//
// The structure lineup is tech-gated: engineers always know the medieval
// SPIKES/FORTIFICATION/FALL_TRAP, but the modern MINEFIELD/BUNKER/AT_MINE
// require their unlocking techs (see getBuildableStructures in game.js /
// ui.js). Modern variants are strictly better and obsolete the old ones once
// their tech is researched, mirroring the unit obsolescence system.
export const STRUCTURE_TYPE = {
    // --- Medieval (always available) ---
    SPIKES:       { name: 'Spikes',       desc: 'Damages charging cavalry that moves onto/adjacent to this tile.', damageVsCavalry: 4, buildTurns: 2 },
    FORTIFICATION:{ name: 'Fortification',desc: '+3 defense to friendly units on this tile. Protects against infantry/artillery.', defenseBonus: 3, buildTurns: 2 },
    FALL_TRAP:    { name: 'Fall Trap',    desc: 'Damages and stuns (skip next turn) any enemy that walks onto this tile.', damage: 3, stun: true, buildTurns: 2 },
    // --- Modern (tech-gated) ---
    // MINEFIELD: the modern successor to SPIKES. Damages ALL moving units
    // (not just cavalry) — infantry, tanks, and vehicles alike — with a
    // bigger hit. One-shot like the fall trap (a mine is consumed when it
    // detonates), but cheaper to lay. Tech: EXPLOSIVES.
    MINEFIELD:    { name: 'Minefield',    desc: 'Damages any enemy unit (infantry, cavalry, or armor) that enters this tile. One-shot.', damage: 8, buildTurns: 2, techRequired: 'EXPLOSIVES' },
    // BUNKER: the modern successor to FORTIFICATION. Reinforced concrete,
    // grants a bigger defense bonus and a small HP bonus to the defender.
    // Tech: FORTIFICATION + INTERNAL_COMBUSTION (reinforced concrete needs
    // modern engineering).
    BUNKER:       { name: 'Bunker',       desc: '+6 defense and +2 max HP to friendly units on this tile. Reinforced concrete fortification.', defenseBonus: 6, hpBonus: 2, buildTurns: 2, techRequired: 'INTERNAL_COMBUSTION' },
    // AT_MINE: the anti-tank mine — the modern successor to FALL_TRAP. A
    // one-shot shaped-charge mine that deals heavy damage to ARMOR units
    // (tanks/heavy tanks/armored cars) and stuns the survivor. Infantry
    // triggers it too but takes less damage. Tech: ARMOR (you need armor
    // tech to build a shaped charge that defeats it).
    AT_MINE:      { name: 'AT Mine',      desc: 'One-shot anti-tank mine. Heavy damage + stun to armor that enters this tile; light damage to infantry.', damageVsArmor: 18, damage: 5, stun: true, buildTurns: 2, techRequired: 'ARMOR' }
};

export const STRUCTURE_COST = {
    SPIKES:        { gold: 20, wood: 10, iron: 0 },
    FORTIFICATION: { gold: 30, wood: 20, iron: 5 },
    FALL_TRAP:     { gold: 25, wood: 5,  iron: 0 },
    MINEFIELD:     { gold: 35, wood: 5,  iron: 10 },
    BUNKER:        { gold: 60, wood: 10, iron: 20 },
    AT_MINE:       { gold: 50, wood: 5,  iron: 15 }
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
// Dynamic faction slots - supports 2-20 players
// 'player' is human-controlled; all others are AI
export const MAX_FACTIONS = 20;
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
// Extended to support up to 20 factions
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
    ai9:    { tile: 0x1a4a6a, unit: 0x44aadd, name: 'Storm' },
    ai10:   { tile: 0x6a1b4a, unit: 0x993366, name: 'Roman Legion' },
    ai11:   { tile: 0x4a6a8a, unit: 0x88bbdd, name: 'Viking Raiders' },
    ai12:   { tile: 0x7b2d8b, unit: 0xaa55cc, name: 'Byzantine Empire' },
    ai13:   { tile: 0xd4581f, unit: 0xff7722, name: 'Spanish Conquistadors' },
    ai14:   { tile: 0x909098, unit: 0xc8c8d0, name: 'Polish Winged Hussars' },
    ai15:   { tile: 0x8a1c1c, unit: 0xd4af37, name: 'Ming Dynasty' },
    ai16:   { tile: 0x5a5a55, unit: 0x8a8a80, name: 'Stone Titans' },
    ai17:   { tile: 0x4a2080, unit: 0xa855f7, name: 'Arcane College' },
    ai18:   { tile: 0x1a1a20, unit: 0xd946ef, name: 'Shadow Lotus' },
    ai19:   { tile: 0xd4581f, unit: 0xffd700, name: 'Sun Empire' }
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
    storm: ['Thunderwall', 'Lightningkeep', 'Tempest', 'Galeforce', 'Stormwind', 'Hurricane', 'Cyclone', 'Maelstrom'],
    roman: ['Roma', 'Capua', 'Ravenna', 'Mediolanum', 'Aquileia', 'Tarentum', 'Brundisium', 'Londinium'],
    viking: ['Skagen', 'Fjordhold', 'Ravenstede', 'Berserkholm', 'Thornhavn', 'Saltvik', 'Valkyriaborg', 'Skaldheim'],
    byzantine: ['Constantinople', 'Nicaea', 'Trebizond', 'Thessalonica', 'Adrianople', 'Antioch', 'Chalcedon', 'Smyrna'],
    spanish: ['Madrid', 'Sevilla', 'Toledo', 'Granada', 'Cordoba', 'Valencia', 'Pamplona', 'Cadiz'],
    polish: ['Warszawa', 'Krakow', 'Gdansk', 'Poznan', 'Wroclaw', 'Lwow', 'Vilnius', 'Lublin']
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
    TACTICIAN:     { name: 'Tactician',     desc: '+1 defense to adjacent friendly units', unlockLevel: 4 },
    // Tech-unlocked abilities: awarded as a faction researches more technologies.
    SCHOLAR:       { name: 'Scholar',       desc: '+10% research speed when governing',   unlockTechs: 6 },
    GRAND_STRATEGIST: { name: 'Grand Strategist', desc: '+2 command and +1 combat',        unlockTechs: 10 },
    RENAISSANCE_PRINCE: { name: 'Renaissance Prince', desc: '+1 attack/defense/move to adjacent friendly units', unlockTechs: 14 },
    INDUSTRIAL_MAGNATE: { name: 'Industrial Magnate', desc: '+25% production and gold in governed city', unlockTechs: 18 }
};

// Lord classes (archetypes): each lord is born into one class, which gives a
// passive bonus to every unit in the lord's army + a unique 2.5D icon.
export const LORD_CLASSES = {
    WARLORD:        { name: 'Warlord',        icon: 'swords', bonus: { attack: 2 },                 desc: '+2 attack to all units in their army.' },
    GUARDIAN:       { name: 'Guardian',       icon: 'defense', bonus: { defense: 2 },                desc: '+2 defense to all units in their army.' },
    CONQUEROR:      { name: 'Conqueror',      icon: 'city', bonus: { siege: 3 },                  desc: '+3 damage vs cities for all units in their army.' },
    GRAND_COMMANDER:{ name: 'Grand Commander',icon: 'star', bonus: { attack: 1, defense: 1, extraCommand: 2 }, desc: '+1 atk & +1 def to army, and commands 2 extra units.' }
};

export const LORD_BASE_STATS = { command: 7, combat: 7, governance: 7 };
export const LORD_RECRUIT_COST = { gold: 140, food: 60 };
export const LORD_XP_PER_KILL = 10;
export const LORD_XP_PER_LEVEL = 50;

// --- Lord Skill Trees (Feature 4) ---
// Each class has two branches of five skills (tier 1 → 3). Tier-1 skills have
// no prerequisites; tier-2 skills require both tier-1 skills of their branch;
// tier-3 skills require both tier-2 skills. A lord gains one skill point per
// level. Effects are aggregated by getSkillEffects and consumed where relevant
// (combat, economy, command capacity).
export const LORD_SKILL_TREES = {
    WARLORD: {
        branches: {
            combat: {
                name: 'Blade Mastery',
                skills: [
                    { id: 'blade_master', name: 'Blade Master', tier: 1, prereqs: [], effect: { combat: 2 }, desc: '+2 combat (lord attack)' },
                    { id: 'toughness', name: 'Toughness', tier: 1, prereqs: [], effect: { hp: 3 }, desc: '+3 HP' },
                    { id: 'critical_strike', name: 'Critical Strike', tier: 2, prereqs: ['blade_master', 'toughness'], effect: { critChance: 0.15 }, desc: '15% chance for double damage' },
                    { id: 'lifesteal', name: 'Lifesteal', tier: 2, prereqs: ['blade_master', 'toughness'], effect: { lifesteal: 0.2 }, desc: 'Heal 20% of damage dealt' },
                    { id: 'berserker_fury', name: 'Berserker Fury', tier: 3, prereqs: ['critical_strike', 'lifesteal'], effect: { lowHpBonus: 3 }, desc: '+3 attack below 50% HP' }
                ]
            },
            command: {
                name: 'Command Presence',
                skills: [
                    { id: 'rally_cry', name: 'Rallying Cry', tier: 1, prereqs: [], effect: { adjacentAttackBonus: 1 }, desc: '+1 attack to adjacent units' },
                    { id: 'inspire', name: 'Inspire', tier: 1, prereqs: [], effect: { xpGain: 0.25 }, desc: '+25% XP gain' },
                    { id: 'inspiring_leader', name: 'Inspiring Leader', tier: 2, prereqs: ['rally_cry', 'inspire'], effect: { adjacentAttackBonus: 2 }, desc: '+2 attack to adjacent units' },
                    { id: 'army_commander', name: 'Army Commander', tier: 2, prereqs: ['rally_cry', 'inspire'], effect: { commandBonus: 2 }, desc: '+2 army capacity' },
                    { id: 'warlord_fury', name: "Warlord's Fury", tier: 3, prereqs: ['inspiring_leader', 'army_commander'], effect: { allUnitsAttackBonus: 1 }, desc: '+1 attack to ALL friendly units' }
                ]
            }
        }
    },
    GUARDIAN: {
        branches: {
            defense: {
                name: 'Iron Guard',
                skills: [
                    { id: 'iron_skin', name: 'Iron Skin', tier: 1, prereqs: [], effect: { command: 2 }, desc: '+2 command (lord defense & army size)' },
                    { id: 'fortify', name: 'Fortify', tier: 1, prereqs: [], effect: { fortBonus: 2 }, desc: '+2 defense in cities' },
                    { id: 'shield_wall', name: 'Shield Wall', tier: 2, prereqs: ['iron_skin', 'fortify'], effect: { adjacentDefenseBonus: 1 }, desc: '+1 defense to adjacent units' },
                    { id: 'unbreakable', name: 'Unbreakable', tier: 2, prereqs: ['iron_skin', 'fortify'], effect: { surviveLethal: true }, desc: 'Survive a fatal hit at 1 HP (once)' },
                    { id: 'guardian_aura', name: 'Guardian Aura', tier: 3, prereqs: ['shield_wall', 'unbreakable'], effect: { adjacentDefenseBonus: 3 }, desc: '+3 defense to adjacent units' }
                ]
            },
            healing: {
                name: 'Restoration',
                skills: [
                    { id: 'field_medic', name: 'Field Medic', tier: 1, prereqs: [], effect: { healAdjacent: 1 }, desc: 'Heal adjacent units 1 HP/turn' },
                    { id: 'rapid_recovery', name: 'Rapid Recovery', tier: 1, prereqs: [], effect: { healBonus: 1 }, desc: '+1 HP healed per turn' },
                    { id: 'combat_medic', name: 'Combat Medic', tier: 2, prereqs: ['field_medic', 'rapid_recovery'], effect: { healAdjacent: 2 }, desc: 'Heal adjacent units 2 HP/turn' },
                    { id: 'morale_boost', name: 'Morale Boost', tier: 2, prereqs: ['field_medic', 'rapid_recovery'], effect: { adjacentDefenseBonus: 1 }, desc: '+1 defense to adjacent units' },
                    { id: 'life_ward', name: 'Life Ward', tier: 3, prereqs: ['combat_medic', 'morale_boost'], effect: { autoHeal: 3 }, desc: 'All units heal 3 HP/turn' }
                ]
            }
        }
    },
    CONQUEROR: {
        branches: {
            siege: {
                name: 'Siege Warfare',
                skills: [
                    { id: 'siege_expert', name: 'Siege Expert', tier: 1, prereqs: [], effect: { siegeBonus: 2 }, desc: '+2 siege damage' },
                    { id: 'battering_ram', name: 'Battering Ram', tier: 1, prereqs: [], effect: { fortDamage: 1 }, desc: '+1 fortification damage' },
                    { id: 'siege_master', name: 'Siege Master', tier: 2, prereqs: ['siege_expert', 'battering_ram'], effect: { siegeBonus: 3 }, desc: '+3 siege damage' },
                    { id: 'city_breaker', name: 'City Breaker', tier: 2, prereqs: ['siege_expert', 'battering_ram'], effect: { cityAttackBonus: 2 }, desc: '+2 attack vs cities' },
                    { id: 'total_war', name: 'Total War', tier: 3, prereqs: ['siege_master', 'city_breaker'], effect: { siegeBonus: 5, cityAttackBonus: 3 }, desc: '+5 siege, +3 vs cities' }
                ]
            },
            expansion: {
                name: 'Imperial Expansion',
                skills: [
                    { id: 'rapid_conquest', name: 'Rapid Conquest', tier: 1, prereqs: [], effect: { captureCostReduction: 5 }, desc: '-5 gold capture cost' },
                    { id: 'annexation', name: 'Annexation', tier: 1, prereqs: [], effect: { loyaltyBonus: 1 }, desc: '+1 loyalty to captured cities' },
                    { id: 'imperial_admin', name: 'Imperial Admin', tier: 2, prereqs: ['rapid_conquest', 'annexation'], effect: { cityYieldBonus: 0.1 }, desc: '+10% yields from conquered cities' },
                    { id: 'governor_dispatch', name: 'Governor Dispatch', tier: 2, prereqs: ['rapid_conquest', 'annexation'], effect: { freeGovernor: true }, desc: 'Free governor when conquering' },
                    { id: 'empire_builder', name: 'Empire Builder', tier: 3, prereqs: ['imperial_admin', 'governor_dispatch'], effect: { allCitiesYieldBonus: 0.05 }, desc: '+5% yields all cities' }
                ]
            }
        }
    },
    GRAND_COMMANDER: {
        branches: {
            support: {
                name: 'Command & Control',
                skills: [
                    { id: 'extended_command', name: 'Extended Command', tier: 1, prereqs: [], effect: { commandBonus: 1 }, desc: '+1 army capacity' },
                    { id: 'tactical_mind', name: 'Tactical Mind', tier: 1, prereqs: [], effect: { adjacentAttackBonus: 1 }, desc: '+1 attack to adjacent units' },
                    { id: 'master_strategist', name: 'Master Strategist', tier: 2, prereqs: ['extended_command', 'tactical_mind'], effect: { commandBonus: 2 }, desc: '+2 army capacity' },
                    { id: 'field_marshal', name: 'Field Marshal', tier: 2, prereqs: ['extended_command', 'tactical_mind'], effect: { adjacentAttackBonus: 2, adjacentDefenseBonus: 1 }, desc: '+2 atk, +1 def to adjacent' },
                    { id: 'supreme_commander', name: 'Supreme Commander', tier: 3, prereqs: ['master_strategist', 'field_marshal'], effect: { allUnitsBonus: { attack: 1, defense: 1 } }, desc: '+1 atk, +1 def to ALL units' }
                ]
            },
            economy: {
                name: 'Civil Administration',
                skills: [
                    { id: 'tax_collector', name: 'Tax Collector', tier: 1, prereqs: [], effect: { goldBonus: 0.1, governance: 2 }, desc: '+10% gold income, +2 governance' },
                    { id: 'logistics', name: 'Logistics', tier: 1, prereqs: [], effect: { upkeepReduction: 0.1, governance: 2 }, desc: '-10% unit upkeep, +2 governance' },
                    { id: 'trade_master', name: 'Trade Master', tier: 2, prereqs: ['tax_collector', 'logistics'], effect: { tradeRouteBonus: 5, governance: 1 }, desc: '+5 gold per trade route, +1 governance' },
                    { id: 'resource_manager', name: 'Resource Manager', tier: 2, prereqs: ['tax_collector', 'logistics'], effect: { allResourceBonus: 0.1, governance: 1 }, desc: '+10% all resources, +1 governance' },
                    { id: 'chancellor', name: 'Chancellor', tier: 3, prereqs: ['trade_master', 'resource_manager'], effect: { cityYieldBonus: 0.15, governance: 1 }, desc: '+15% yields all cities, +1 governance' }
                ]
            }
        }
    }
};

// --- Diplomacy ---
export const DIPLOMACY_STATES = {
    NEUTRAL: 'neutral',          // default start; no attacks without formal war
    NAP: 'non_aggression',       // no attacks, no vision, expires after N turns
    CEASEFIRE: 'ceasefire',      // temporary peace with explicit expiry turn
    WAR: 'war',
    PEACE: 'peace',
    ALLIANCE: 'alliance',
    TRADE_PACT: 'trade_pact'
};

// --- Grievance / Tension System (Civ6-style) ---
// Radius: capturing a neutral city within this distance of another faction's
// city adds a grievance to that neighbor.
export const NEUTRAL_CITY_GRUDGE_RADIUS = 8;
// How much a single grievance decays per turn.
export const GRIEVANCE_DECAY_PER_TURN = 2;
// Tension above this threshold makes AI consider war.
export const GRIEVANCE_WAR_THRESHOLD = 40;
// Tension above this makes AI reject most treaties.
export const GRIEVANCE_HOSTILE = 15;

// --- New Grievance Sources ---
// Victory threat: per-turn grievance when a faction leads in victory progress.
// Scaled by how far ahead the leader is (capped per turn).
export const VICTORY_THREAT_GRIPERANCE_PER_TURN = 3;
// Military buildup: per-turn grievance for stacking units near a border.
export const BORDER_BUILDUP_GRIPERANCE_PER_TURN = 3;
// Razing a city: massive grievance to all living factions.
export const CITY_RAZE_GRIPERANCE = 40;
// Espionage detected: grievance when spy action is discovered.
export const ESPIONAGE_GRIPERANCE = 15;
// Resource monopoly: per-turn grievance if a faction blocks our only source of a critical resource.
export const RESOURCE_MONOPOLY_GRIPERANCE_PER_TURN = 2;

// --- AI Expansion (competitive settler behavior) ---
// Minimum number of cities the AI wants before slowing settler production.
export const AI_SETTLER_TARGET = 8; // base; scaled by map size
// Per-city cap: AI limits settlers to (cityCount * factor + base).
export const AI_SETTLER_CAP_FACTOR = 0.8;
export const AI_SETTLER_CAP_BASE = 2;
// Max settlers the AI will produce in a single turn during the early expansion
// boost (turns 1-50 with good land). Outside that window the base is 1/turn.
export const AI_SETTLERS_PER_TURN = 2;
// Hard cap on the total number of live + queued settlers the AI will ever keep
// (prevents a faction from spamming settlers and sprawling endlessly).
export const AI_SETTLER_HARD_CAP = 6;
// Frontier bonus values (distance from nearest owned city).
export const AI_FRONTIER_BONUS_CLOSE = 120;   // within 3 tiles
export const AI_FRONTIER_BONUS_MID = 60;      // within 6 tiles
export const AI_FRONTIER_BONUS_FAR = 20;      // beyond 6 tiles
// Penalty for founding near a strong enemy city.
export const AI_ENEMY_CITY_PROXIMITY_PENALTY = -60;
// Bonus for sniping a weakly-defended enemy city (settle nearby to claim).
export const AI_WEAK_CITY_SNIPE_BONUS = 80;
// Power ratio below which we consider a city "weak" (garrison count / max).
export const AI_WEAK_CITY_RATIO = 0.4;
// Garrison count at/below which an enemy city is considered weak enough to snipe.
export const WEAK_CITY_GARRISON_THRESHOLD = 2;
// Global multiplier on AI settler ambition (target/cap/per-turn). >1 = more
// aggressive expansion; data-driven so it can be tuned without touching ai.js.
export const SETTLER_AGGRESSION = 1.25;
// Bonus weight added when targeting a neutral (unowned) city, so the AI races
// to grab free cities early (first-expander advantage).
export const AI_NEUTRAL_RUSH_BONUS = 150;
// Founding a city within this Manhattan distance of another faction's city is
// treated as an aggressive land grab and awards the neighbor a grievance.
export const MIN_CITY_SPACING = 6;

// --- War Objectives ---
// Bonus score for targeting a faction's capital city.
export const WAR_OBJECTIVE_CAPITAL_BONUS = 40;
// Bonus score for targeting a city with valuable buildings (UNIVERSITY, BANK, etc.).
export const WAR_OBJECTIVE_KEY_BUILDING_BONUS = 25;
// Bonus score for targeting a faction leading in victory progress.
export const WAR_OBJECTIVE_VICTORY_LEADER_BONUS = 50;
// Bonus score for targeting a faction that controls a resource we critically need.
export const WAR_OBJECTIVE_RESOURCE_CONTENDER_BONUS = 30;
// Minimum city count before the AI considers "take key city" objectives.
export const WAR_OBJECTIVE_MIN_CITIES = 3;

// AI is now much more reluctant to accept peace/trade - wars are grinding and
// breaking a treaty should be costly. The player must fight or offer significant
// value to get anything but the most temporary truces.
export const AI_PERSONALITIES = {
    AGGRESSIVE:  { warChance: 0.8,  acceptAlliance: 0.15, acceptTrade: 0.25, acceptPeace: 0.3 },
    DEFENSIVE:   { warChance: 0.4,  acceptAlliance: 0.25, acceptTrade: 0.4, acceptPeace: 0.5 },
    ECONOMIC:    { warChance: 0.25, acceptAlliance: 0.35, acceptTrade: 0.55, acceptPeace: 0.6 },
    BALANCED:    { warChance: 0.6,  acceptAlliance: 0.2,  acceptTrade: 0.3,  acceptPeace: 0.4 }
};

// --- AI goal-sequence system (see src/ai_goals.js) ---
// Min turns the planner keeps a chosen goal sequence before it may replace it
// (prevents goal thrashing turn-to-turn).
export const AI_GOAL_MIN_STABILITY_TURNS = 3;
// Fraction of the unit cap reserved for long-range artillery (CATAPULT/TREBUCHET)
// so basic siege (SIEGE/ARTILLERY) saturating the siege cap doesn't crowd them out.
export const AI_ARTILLERY_RESERVE_DEFAULT = 0.25;
export const AI_ARTILLERY_RESERVE_SIEGE = 0.35;
// Artillery/siege techs get a research-selection score multiplier for the AI.
export const AI_ARTILLERY_TECH_PRIORITY = 1.3;
// Settler scarcity trigger: consecutive scarce turns before the AI aggressively
// expands to acquire missing resources, and the cap/floor relaxation it grants.
export const AI_SETTLER_SCARCITY_TURN_THRESHOLD = 2;
export const AI_SETTLER_SCARCE_CAP_RELAX = 2;
export const AI_SETTLER_SCARCE_FLOOR_RELAX = 1;
// Breached-city detachment: max Manhattan distance from which the AI peels one
// military unit off an army group to go claim a breached, unclaimed city.
export const AI_BREACH_DETACH_RADIUS = 8;
// King threat assessment: extra weight per tile of strike-reach surplus
// (moveRange + attackRange beyond the foe's distance to the king). Mobile
// threats that can strike this turn scare the king into retreating earlier.
export const AI_KING_MOBILITY_THREAT_FACTOR = 0.25;

// King AI caution tuning. The king retreats when its HP fraction falls below
// a threshold that rises with local danger. Higher thresholds = more cautious.
export const AI_KING_RETREAT_BASE = 0.60;            // base HP fraction to start retreating
export const AI_KING_RETREAT_LATE_GAME = 0.70;       // higher caution once armies grow or turns pass
export const AI_KING_RETREAT_LATE_GAME_UNITS = 8;    // unit count that triggers late-game caution
export const AI_KING_RETREAT_LATE_GAME_TURN = 40;    // turn that triggers late-game caution
export const AI_KING_RETREAT_MAX = 0.80;             // absolute cap on retreat threshold
export const AI_KING_RETREAT_PER_FOE = 0.02;         // +threshold per reachable enemy (cap 0.06)
export const AI_KING_RETREAT_FOE_CAP = 0.06;
export const AI_KING_RETREAT_ARTILLERY = 0.12;       // bonus when artillery/siege can strike
export const AI_KING_RETREAT_RANGED = 0.06;          // bonus when ranged units can strike
export const AI_KING_RETREAT_ENEMY_KING = 0.20;      // bonus when an enemy king is nearby
export const AI_KING_RETREAT_ENEMY_LORD = 0.06;      // bonus per nearby enemy lord
export const AI_KING_RETREAT_LORD_CAP = 0.12;
export const AI_KING_RETREAT_POWER_RATIO_SCALE = 0.20; // +threshold per 1.0x local foe advantage above 1.0x (cap 0.20)
export const AI_KING_RETREAT_POWER_RATIO_CAP = 0.20;
export const AI_KING_RETREAT_POWER_RATIO_TRIGGER = 1.0; // instant retreat if foe mobile power >= friend power * this
export const AI_KING_HUNT_ADVANTAGE_EARLY = 1.5;     // friendLocal must exceed foeLocal by this much to hunt early
export const AI_KING_HUNT_ADVANTAGE_LATE = 2.5;      // friendLocal must exceed foeLocal by this much to hunt late
export const AI_KING_HUNT_RANGE_EARLY = 5;           // max Manhattan distance to hunt enemy king early
export const AI_KING_HUNT_RANGE_LATE = 3;            // max Manhattan distance to hunt enemy king late

// Regular lord AI caution tuning. Lords are less precious than kings but still
// should not throw themselves at the enemy when wounded. They retreat at a
// higher HP fraction when local enemies outpower friendly units, and fall back
// unconditionally at very low HP.
export const AI_LORD_RETREAT_BASE = 0.40;            // retreat when below this HP fraction and enemies are near
export const AI_LORD_RETREAT_LOW = 0.25;             // unconditional retreat below this HP fraction
export const AI_LORD_RETREAT_ENEMY_RADIUS = 4;       // how close enemies count as "near"
export const AI_LORD_RETREAT_POWER_TRIGGER = 1.0;    // retreat if local foe power >= friend power * this

// Flow-aware scarcity: a resource counts as "strained" when its per-turn net
// flow is at or below these (negative) thresholds — i.e. the faction is
// bleeding that resource faster than it replenishes, a leading indicator
// even when the stock is still above the floor. This adds to the stock-based
// `scarce` count so a fast drain raises scarcity urgency before the stock
// actually bottoms out, and the worst-draining resource biases where settlers
// head (findFoundSpot weights that resource's terrain higher).
export const SCARCITY_FLOW_THRESHOLDS = { gold: -10, food: -8, wood: -6, iron: -5 };

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

// Victory condition thresholds
export const VICTORY_TYPES = {
    DOMINATION: 'domination',   // eliminate all enemy cities
    SCIENCE: 'science',         // research all techs + build space program
    ECONOMIC: 'economic',       // accumulate gold + control trade
    SCORE: 'score'              // highest score at turn limit
};

export const SCORE_VICTORY_TURN = 10000;        // turn at which score victory is checked
export const SCIENCE_VICTORY_COST = {         // resource cost for space program project
    gold: 500, food: 200, wood: 200, iron: 100, production: 300
};
export const SCIENCE_VICTORY_BUILD_TURNS = 10; // turns to complete space program
export const ECONOMIC_VICTORY_GOLD = 2000;     // gold threshold
export const ECONOMIC_VICTORY_TRADE_ROUTES = 6; // trade route count needed
export const ECONOMIC_VICTORY_BONUS_TRADE_GOLD = 50; // bonus gold per turn near victory

// --- City Unrest & Loyalty system ---
// Unrest is a 0-100 per-city value. It now rises ONLY from real danger:
// prolonged sieges, enemy forces nearby when the garrison is weak/absent,
// breached walls, and the lingering shock of recent conquest. Safe cities
// do not drift into rebellion. It falls with garrisons, governors, walls,
// city level, and a post-conquest "occupation stability" window. High
// unrest cuts a city's yields; at 100 it can rebel.
export const UNREST_THRESHOLDS = {
    NONE: 0,        // no effect
    LOW: 25,        // -25% yields
    MEDIUM: 50,     // -50% yields, -1 attack to produced units
    HIGH: 75,       // -75% yields, -2 attack to produced units
    REBELLION: 100  // city may rebel
};

export const UNREST_DECAY_RATES = {
    GARRISON: 8,           // per turn, a friendly unit sits on the city tile (scales ×1/1.5/2 with count)
    GOVERNOR: 8,           // per turn, a lord is assigned as the city's governor
    WALLS: 3,              // per turn, if WALLS building present on the city
    CITY_LEVEL: 1,          // per turn per city level
    POST_CONQUEST: 10,      // extra decay for recently captured cities
    POST_CONQUEST_GARRISON: 14  // extra decay on top of POST_CONQUEST if a garrison is present
};

export const UNREST_INCREASE_RATES = {
    DISTANCE: 0,           // removed: safe frontier cities no longer drift to rebellion
    NO_GARRISON: 0,        // removed standalone; folded into enemy_threat (only dangerous without threat)
    CULTURAL_PRESSURE: 0,  // removed standalone; folded into enemy_threat
    RECENT_CONQUEST: 4,   // immediate on capture, decays 1/turn over 10 turns
    RECENT_CONQUEST_DECAY_TURNS: 10,
    OCCUPATION: 1,         // per turn while enemy units are on adjacent tiles
    CAPTURE_INITIAL: 8,   // captured cities start at this unrest
    BREACH_PENALTY: 5,    // per turn while city fortification is 0 (breached)
    ENEMY_NEARBY_PRESENCE: 1, // per threatening enemy unit near the city when garrison is weak/absent
    SIEGE_DURATION_PENALTY: 1, // per turn after the siege threshold while enemy units are nearby
    SIEGE_DURATION_THRESHOLD: 3  // turns of enemy presence before the siege-duration penalty starts
};

// Rebellion: at 100 unrest a city has this chance per turn to flip to the
// most influential neighboring owner (or go independent). Reaching 100 now
// requires active danger, so the chance is lower than the old model.
export const UNREST_REBEL_CHANCE = 0.03;

// Number of turns after capture during which the city receives extra unrest
// decay (occupation stabilization). A garrison adds a further decay bonus.
export const POST_CONQUEST_STABILITY_TURNS = 15;

// Radius (Chebyshev) around a city in which enemy units count as a threat
// for unrest purposes. Covers "large enemy nearby".
export const UNREST_THREAT_RADIUS = 4;

// Stability factors: reduce (or increase) unrest based on the empire's
// overall condition — prosperity, military strength, fortifications,
// governance, and peace duration all stabilize a city. Prolonged sieges and
// breached walls are handled directly via UNREST_INCREASE_RATES now.
export const STABILITY_FACTORS = {
    PROSPERITY_BONUS: -2,        // per 100 gold in treasury (max -10)
    ARMY_STRENGTH_BONUS: -3,     // per full 1.0x army ratio above 1.5x neighbor avg (max -15)
    FRIENDLY_CITY_NEIGHBOR: -2, // per adjacent friendly city tile
    SIEGE_DURATION_PENALTY: 0,  // handled by UNREST_INCREASE_RATES.SIEGE_DURATION_PENALTY
    CONSECUTIVE_PEACE_BONUS: -1,// per turn at peace (max -10)
    FORTIFICATION_BONUS: -1,    // if WALLS present on the city
    GOVERNOR_PRESENCE: -2,      // if a lord is governing (stacks with GOVERNOR decay)
};

// --- Peace Negotiations with Demands ---
// War weariness accumulates while at war and decays at peace; a weary faction
// is more willing to accept harsh peace terms.
export const WAR_WEARINESS_RATES = {
    PER_TURN: 3,              // base war weariness per turn at war
    PER_UNIT_LOST: 12,        // per unit destroyed
    PER_CITY_LOST: 8,         // per city lost
    PER_BATTLE: 1,            // per battle participated in
    DECAY_AT_PEACE: -8        // per turn at peace (recovering)
};

export const PEACE_DEMAND_LIMITS = {
    MAX_GOLD_DEMAND: 500,
    MAX_TRIBUTE_PER_TURN: 15,
    MAX_TRIBUTE_DURATION: 20,  // turns
    MAX_TERRITORY_TILES: 3
};

export const PEACE_ACCEPTANCE_MODIFIERS = {
    POWER_RATIO_THRESHOLD: 0.7,  // below this, the target is more likely to accept
    WEARINESS_THRESHOLD: 30,     // above this, the target is more likely to accept
    RELATIONSHIP_BONUS: 0.002,   // per relationship point
    TREATY_HISTORY_PENALTY: -0.1 // per broken treaty
};

// After a peace treaty or ceasefire is signed, the parties cannot re-declare
// war on each other for this many turns. This stops AI factions from
// immediately re-entering the same war (especially visible in spectate mode).
export const PEACE_TRUCE_TURNS = 6;
export const CEASEFIRE_TRUCE_TURNS = 3;

// --- Trade Route Establishment ---
// A trade route connects two cities (≥ min level) and pays its owner income
// per turn based on distance + the levels of both endpoints. Enemy military
// units standing on the route's path can raid it, disrupting income for a few
// turns. Routes are capped per faction.
export const TRADE_ROUTE_BASE_INCOME = 10;
export const TRADE_ROUTE_DISTANCE_BONUS = 0.5;  // per tile of distance
export const TRADE_ROUTE_CITY_LEVEL_BONUS = 2;  // per city level
export const TRADE_ROUTE_MAX = 5;               // per faction
export const TRADE_ROUTE_MIN_CITY_LEVEL = 2;     // both cities must be this level
export const RAID_STEAL_PERCENT = 0.5;           // 50% of route income stolen
export const RAID_DISRUPT_TURNS = 3;
// ============================================================
// Features 6-15 (abbreviated enhancements)
// ============================================================

// --- Feature 6: Turn Summary / Event Log ---
// A rolling log of noteworthy events (combats, city captures, diplomacy,
// unrest, etc.). Capped; oldest entries drop off. Each entry carries a
// category so the UI can filter.
export const EVENT_LOG_MAX = 80;
export const EVENT_CATEGORIES = ['combat', 'city', 'diplomacy', 'economy', 'unrest', 'spy', 'turn', 'system'];

// --- Feature 7: City Tile Yield Overlay ---
// Per-tile worked yield, surfaced as an on-map overlay (toggle with 'Y').
// The numbers come from economy.grossYields' per-tile contribution; this just
// packages a single-tile preview for the renderer/UI.
export const YIELD_OVERLAY_KEY = 'y';

// --- Feature 8: Difficulty Settings ---
// Multipliers applied to economy/AI behavior per difficulty. `playerFaction`
// modifiers hit the human; `ai` modifiers hit every AI faction. Backwards
// compatible: a missing/unknown difficulty falls back to NORMAL.
export const DIFFICULTY_PRESETS = {
    EASY:   { key: 'EASY',   label: 'Easy',   aiResourceMult: 0.8,  aiUpkeepMult: 0.9,  aiAggression: 0.7, playerUpkeepMult: 0.8,  playerYieldMult: 1.1, aiXpMult: 0.9 },
    NORMAL: { key: 'NORMAL', label: 'Normal', aiResourceMult: 1.0,  aiUpkeepMult: 1.0,  aiAggression: 1.0, playerUpkeepMult: 1.0,  playerYieldMult: 1.0, aiXpMult: 1.0 },
    HARD:   { key: 'HARD',   label: 'Hard',   aiResourceMult: 1.25, aiUpkeepMult: 0.9,  aiAggression: 1.3, playerUpkeepMult: 1.15, playerYieldMult: 0.9, aiXpMult: 1.2 },
    BRUTAL: { key: 'BRUTAL', label: 'Brutal', aiResourceMult: 1.5,  aiUpkeepMult: 0.8,  aiAggression: 1.6, playerUpkeepMult: 1.3,  playerYieldMult: 0.8, aiXpMult: 1.4 }
};
export const DIFFICULTY_DEFAULT = 'NORMAL';

// --- Feature 9: Mountain Passes ---
// A PASS is a passable gap through otherwise-impassable MOUNTAIN terrain,
// letting land routes cross mountain ranges. Generated after biomes by
// carving a few mountain tiles that border two distinct land regions.
export const PASS_TERRAIN_KEY = 'PASS';
export const PASS_COUNT_PER_CONTINENT = { SMALL: 2, MEDIUM: 3, LARGE: 4 };
export const PASS_DEFENSE = 2;        // partial mountain cover
export const PASS_MOVE_COST = 2;      // extra move cost to traverse a pass

// --- Feature 10: River Crossing Penalty ---
// Crossing a river this turn (even via bridge) leaves a unit bogged down:
// reduced defense until its next move and a higher move cost for the
// crossing step itself.
export const RIVER_CROSSING_DEFENSE_PENALTY = 2;   // flat defense lost this turn
export const RIVER_CROSSING_MOVE_COST = 2;         // extra move points for the crossing step

// --- Feature 11: Spy System ---
// Spies are stealth units that can gather intel, sabotage production,
// assassinate lords, or incite city unrest. Each action has a detection
// chance; being detected damages the spy's owner's relationship with the
// target and risks the spy itself.
export const SPY_ACTION_COST = { gold: 25 };        // per spy action
export const SPY_ACTIONS = {
    GATHER_INTEL:  { key: 'GATHER_INTEL',  label: 'Gather Intel',  baseSuccess: 0.85, baseDetection: 0.15, relationPenalty: 5 },
    SABOTAGE:      { key: 'SABOTAGE',      label: 'Sabotage',      baseSuccess: 0.55, baseDetection: 0.40, relationPenalty: 15 },
    ASSASSINATE:   { key: 'ASSASSINATE',   label: 'Assassinate',   baseSuccess: 0.35, baseDetection: 0.60, relationPenalty: 25 },
    INCITE_UNREST: { key: 'INCITE_UNREST', label: 'Incite Unrest', baseSuccess: 0.50, baseDetection: 0.45, relationPenalty: 20, unrestAmount: 30 }
};
export const SPY_DETECTION_RELATION_PENALTY = 10;  // extra penalty when caught red-handed

// --- Feature 12: Coalition Wars ---
// A coalition is a temporary alliance-of-convenience for a joint war. The
// leader invites allies; all join the war against the target together and
// share the war-declaration relationship/reputation penalties.
export const COALITION_MAX_ALLIES = 3;
export const COALITION_JOIN_RELATIONSHIP_THRESHOLD = 30;  // ally must be at least this friendly with the leader
export const COALITION_SHARED_PENALTY = 0.5;  // each joiner takes this fraction of the leader's war penalty

// --- Feature 13: Minimap ---
// Compact per-tile summary for the minimap renderer: each tile's owner color
// plus a flag if a unit sits on it. 1px per tile. The renderer draws this; the
// pure builder here keeps it testable without a canvas.
export const MINIMAP_SCALE = 1;  // pixels per tile

// --- Feature 14: City Quick-Jump ---
// Ordered list of the player's cities for the quick-jump cycle (click a city
// name in the bar or press [ / ] to cycle the camera between them).

// --- Feature 15: Army Composition Panel ---
// Per-lord roster breakdown (unit-type -> count) for the army-composition
// panel. Clicking a lord selects it on the map.
