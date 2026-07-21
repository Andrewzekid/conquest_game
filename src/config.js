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
export const MIN_LANDMASS_SIZE = 24;
export const MIN_START_LANDMASS = 36;

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
    // --- New European-faction units (Phase G) ---
    // LEGIONNAIRE: heavy infantry tank. Slow but very durable; can build
    // fortifications on owned tiles like an Engineer, but stays combat-capable.
    LEGIONNAIRE: { name: 'Legionnaire', hp: 14, attack: 4, defense: 5, moveRange: 1, upkeep: { food: 4, gold: 3 }, ranged: false, attackRange: 1, canBuildStructure: true },
    // BERSERKER: glass-cannon melee. +3 attack when below 50% HP (frenzy);
    // cannot be healed by Medics.
    BERSERKER:   { name: 'Berserker',   hp: 12, attack: 9, defense: 1, moveRange: 2, upkeep: { food: 3, gold: 4 }, ranged: false, attackRange: 1, frenzy: true, noMedic: true },
    // VARANGIAN_GUARD: elite bodyguard. +2 defense when adjacent to a friendly lord.
    VARANGIAN_GUARD: { name: 'Varangian Guard', hp: 16, attack: 6, defense: 6, moveRange: 2, upkeep: { food: 4, gold: 5, iron: 1 }, ranged: false, attackRange: 1, lordGuard: true },
    // CONQUISTADOR: mounted gunpowder unit. Mobile ranged assault; +2 attack vs
    // units in cities.
    CONQUISTADOR: { name: 'Conquistador', hp: 10, attack: 7, defense: 3, moveRange: 3, upkeep: { food: 3, gold: 6, iron: 1 }, ranged: true, attackRange: 2, cityBonus: 2 },
    // WINGED_HUSSAR: shock cavalry. Charge deals 2x damage on the first attack
    // each turn; +1 move on open terrain.
    WINGED_HUSSAR: { name: 'Winged Hussar', hp: 18, attack: 8, defense: 4, moveRange: 3, upkeep: { food: 5, gold: 6, iron: 2 }, ranged: false, attackRange: 1, chargeMultiplier: 2, openTerrainMoveBonus: 1 },
    // CROSSBOWMAN: long-range infantry, a straightforward Archer upgrade.
    CROSSBOWMAN: { name: 'Crossbowman', hp: 10, attack: 7, defense: 2, moveRange: 1, upkeep: { food: 3, gold: 5, wood: 2 }, ranged: true, attackRange: 3 },
    // Long-range siege engines (unlocked by a Siege Workshop building in a city).
    // Both deal AOE splash to enemy units adjacent to the target and can set the
    // area ablaze (a burn DoT on primary + splash victims).
    CATAPULT:    { name: 'Catapult',   hp: 12, attack: 7, defense: 2, moveRange: 2, upkeep: { food: 3, gold: 6, wood: 2, iron: 2 }, besiege: true, besiegePower: 2, ranged: true, attackRange: 4, aoe: true, canSetFire: true, buildTurns: 2 },
    TREBUCHET:   { name: 'Trebuchet',  hp: 10, attack: 9, defense: 1, moveRange: 1, upkeep: { food: 3, gold: 7, wood: 3, iron: 3 }, besiege: true, besiegePower: 3, ranged: true, attackRange: 4, aoe: true, canSetFire: true, buildTurns: 2 },
    // Naval units (unlocked by a Harbor building in a coastal/river city).
    GALLEY:      { name: 'Galley',       hp: 14, attack: 6, defense: 3, moveRange: 4, upkeep: { food: 3, gold: 5, wood: 2, iron: 1 }, naval: true, ranged: true, attackRange: 3, vision: 5 },
    TRANSPORT:   { name: 'Transport',    hp: 12, attack: 1, defense: 3, moveRange: 3, upkeep: { food: 2, gold: 4, wood: 1, iron: 1 }, naval: true, capacity: 2, ranged: false, attackRange: 1 },
    FRIGATE:     { name: 'Frigate',      hp: 20, attack: 8, defense: 4, moveRange: 4, upkeep: { food: 4, gold: 7, wood: 3, iron: 2 }, naval: true, ranged: true, attackRange: 3, vision: 5 },
    GALLEON:     { name: 'Galleon',      hp: 28, attack: 10, defense: 6, moveRange: 3, upkeep: { food: 5, gold: 8, wood: 4, iron: 3 }, naval: true, ranged: true, attackRange: 3, vision: 4, besiege: true, besiegePower: 1 },
    // SPY: a stealth agent (Feature 11). Cannot fight directly; performs covert
    // actions (gather intel / sabotage / assassinate / incite unrest) from an
    // enemy or neutral tile. High vision, low HP.
    SPY:         { name: 'Spy',          hp: 6,  attack: 1, defense: 1, moveRange: 3, upkeep: { food: 1, gold: 3 }, ranged: false, attackRange: 1, vision: 5, isSpy: true, buildTurns: 2 },
    // === RENAISSANCE ERA UNITS (1700-1800) ===
    // MUSKETEER: early firearm infantry with volley fire mechanic.
    MUSKETEER:   { name: 'Musketman', hp: 14, attack: 8, defense: 4, moveRange: 2, upkeep: { food: 4, gold: 5, iron: 1 }, ranged: true, attackRange: 2, volley: true },
    // ARQUEBUSIER: early rifle with slow reload - cannot attack turn after firing.
    ARQUEBUSIER: { name: 'Arquebusier', hp: 12, attack: 7, defense: 3, moveRange: 2, upkeep: { food: 3, gold: 4, iron: 1 }, ranged: true, attackRange: 2, slowReload: true },
    // RENAISSANCE NAVAL: wooden warships dominate the seas.
    MAN_OF_WAR:  { name: 'Man-of-War', hp: 35, attack: 12, defense: 8, moveRange: 3, upkeep: { food: 6, gold: 10, wood: 4, iron: 3 }, naval: true, ranged: true, attackRange: 3, vision: 6, flagship: true },
    GALLEASS:    { name: 'Galleass', hp: 25, attack: 10, defense: 6, moveRange: 3, upkeep: { food: 5, gold: 8, wood: 3, iron: 2 }, naval: true, ranged: true, attackRange: 3, oared: true },
    PINNACE:     { name: 'Pinnace', hp: 18, attack: 7, defense: 4, moveRange: 4, upkeep: { food: 3, gold: 5, wood: 2, iron: 1 }, naval: true, ranged: true, attackRange: 2, vision: 7 },
    // === ENLIGHTENMENT ERA UNITS (1800-1850) ===
    // LINE_INFANTRY: disciplined formation fighters with formation bonus.
    LINE_INFANTRY: { name: 'Line Infantry', hp: 16, attack: 9, defense: 5, moveRange: 2, upkeep: { food: 4, gold: 6, iron: 2 }, ranged: true, attackRange: 2, formation: true },
    // DRAGOON: mounted ranged - hybrid cavalry that can charge or fire.
    DRAGOON:     { name: 'Dragoon', hp: 14, attack: 8, defense: 4, moveRange: 3, upkeep: { food: 5, gold: 7, iron: 2 }, ranged: true, attackRange: 2, mounted: true },
    // CANNON: heavy artillery with devastating siege power.
    CANNON:      { name: 'Cannon', hp: 10, attack: 12, defense: 2, moveRange: 1, upkeep: { food: 3, gold: 8, wood: 2, iron: 4 }, besiege: true, besiegePower: 4, ranged: true, attackRange: 3, siegeBonus: 4 },
    // MORTAR: indirect fire with AOE splash damage.
    MORTAR:      { name: 'Mortar', hp: 8, attack: 10, defense: 1, moveRange: 1, upkeep: { food: 3, gold: 7, wood: 2, iron: 3 }, besiege: true, besiegePower: 3, ranged: true, attackRange: 4, aoe: true, aoeRadius: 2 },
    // ENLIGHTENMENT NAVAL: faster sailing warships.
    CORVETTE:    { name: 'Corvette', hp: 22, attack: 9, defense: 5, moveRange: 4, upkeep: { food: 4, gold: 6, wood: 3, iron: 2 }, naval: true, ranged: true, attackRange: 2, raider: true },
    FROLIC:      { name: 'Frolic', hp: 30, attack: 11, defense: 7, moveRange: 3, upkeep: { food: 5, gold: 9, wood: 4, iron: 3 }, naval: true, ranged: true, attackRange: 3, broadside: true },
    MERCHANTMAN: { name: 'Merchantman', hp: 20, attack: 4, defense: 4, moveRange: 3, upkeep: { food: 4, gold: 6, wood: 3, iron: 1 }, naval: true, capacity: 3, tradeBonus: 10 },
    // === MODERN ERA UNITS (1850-1880) ===
    // RIFLEMAN: accurate firearm infantry that ignores defense.
    RIFLEMAN:    { name: 'Rifleman', hp: 18, attack: 11, defense: 6, moveRange: 2, upkeep: { food: 5, gold: 8, iron: 3 }, ranged: true, attackRange: 3, accurate: true },
    // SHARPSHOOTER: elite sniper with bonus vs high-value targets.
    SHARPSHOOTER: { name: 'Sharpshooter', hp: 12, attack: 10, defense: 3, moveRange: 2, upkeep: { food: 4, gold: 9, iron: 2 }, ranged: true, attackRange: 4, sniper: true },
    // RAILGUN: devastating railway artillery with long reload.
    RAILGUN:     { name: 'Railgun', hp: 12, attack: 15, defense: 3, moveRange: 2, upkeep: { food: 4, gold: 10, iron: 6 }, besiege: true, besiegePower: 5, ranged: true, attackRange: 4, devastating: true },
    // ARMORED_TRAIN: mobile railway fortress that can move and fire.
    ARMORED_TRAIN: { name: 'Armored Train', hp: 25, attack: 10, defense: 8, moveRange: 3, upkeep: { food: 5, gold: 10, wood: 2, iron: 5 }, ranged: true, attackRange: 3, mobile: true },
    // FIELD_GUN: rapid-fire artillery.
    FIELD_GUN:   { name: 'Field Gun', hp: 10, attack: 13, defense: 2, moveRange: 2, upkeep: { food: 4, gold: 9, wood: 2, iron: 4 }, besiege: true, besiegePower: 4, ranged: true, attackRange: 3, rapidFire: true },
    // HORSE_ARTILLERY: fast-deploy mobile cannon.
    HORSE_ARTILLERY: { name: 'Horse Artillery', hp: 10, attack: 12, defense: 2, moveRange: 3, upkeep: { food: 5, gold: 9, wood: 2, iron: 4 }, besiege: true, besiegePower: 3, ranged: true, attackRange: 3, fastDeploy: true },
    // DEMOLITION_SQUAD: combat engineers with bonus vs cities.
    DEMOLITION_SQUAD: { name: 'Demolition Squad', hp: 10, attack: 8, defense: 2, moveRange: 2, upkeep: { food: 3, gold: 6, wood: 2, iron: 2 }, ranged: false, attackRange: 1, demolish: true },
    // SIEGE_CANNON: heavy siege gun that destroys fortifications.
    SIEGE_CANNON: { name: 'Siege Cannon', hp: 8, attack: 14, defense: 1, moveRange: 1, upkeep: { food: 3, gold: 10, wood: 2, iron: 5 }, besiege: true, besiegePower: 6, ranged: true, attackRange: 4, fortBuster: true },
    // MODERN NAVAL: steam-powered iron warships.
    IRONCLAD:    { name: 'Ironclad', hp: 40, attack: 14, defense: 10, moveRange: 3, upkeep: { food: 7, gold: 12, wood: 2, iron: 6 }, naval: true, ranged: true, attackRange: 3, armored: true },
    STEAM_TRANSPORT: { name: 'Steam Transport', hp: 20, attack: 2, defense: 6, moveRange: 4, upkeep: { food: 4, gold: 8, wood: 2, iron: 3 }, naval: true, capacity: 4, steamPowered: true },
    GUNBOAT:     { name: 'Gunboat', hp: 18, attack: 10, defense: 5, moveRange: 4, upkeep: { food: 3, gold: 7, wood: 2, iron: 3 }, naval: true, ranged: true, attackRange: 2, shallowDraft: true },
    IRONCLAD_FRIGATE: { name: 'Ironclad Frigate', hp: 45, attack: 15, defense: 12, moveRange: 3, upkeep: { food: 8, gold: 14, wood: 2, iron: 7 }, naval: true, ranged: true, attackRange: 3, heavyArmor: true },
    MONITOR:     { name: 'Monitor', hp: 35, attack: 16, defense: 14, moveRange: 2, upkeep: { food: 7, gold: 13, wood: 1, iron: 7 }, naval: true, ranged: true, attackRange: 4, turret: true },
    FRIGATE_2:   { name: 'Frigate II', hp: 38, attack: 13, defense: 9, moveRange: 4, upkeep: { food: 6, gold: 11, wood: 4, iron: 4 }, naval: true, ranged: true, attackRange: 3, fastSail: true },
    SUBMARINE:   { name: 'Submarine', hp: 25, attack: 12, defense: 6, moveRange: 3, upkeep: { food: 4, gold: 10, wood: 1, iron: 5 }, naval: true, ranged: true, attackRange: 3, stealth: true },
    TORPEDO_BOAT: { name: 'Torpedo Boat', hp: 15, attack: 18, defense: 3, moveRange: 4, upkeep: { food: 3, gold: 8, wood: 1, iron: 4 }, naval: true, ranged: true, attackRange: 2, torpedo: true }
};

// Units available to every faction in addition to its themed roster. Ships
// are unlocked per-city by a Harbor. Faction-signature units (LEGIONNAIRE,
// BERSERKER, VARANGIAN_GUARD, CONQUISTADOR, WINGED_HUSSAR) appear here because
// they're also tech-unlocked — other factions can reach them via research, but
// the UI must tech-gate them (only show once the unlocking tech is researched)
// rather than showing them all from turn 1.
export const EXTRA_UNITS = ['SETTLER', 'ENGINEER', 'WORKER', 'CAVALRY', 'CHARIOT', 'LONGBOWMAN', 'CATAPHRACT', 'MEDIC', 'SIEGE_TOWER', 'LEGIONNAIRE', 'BERSERKER', 'VARANGIAN_GUARD', 'CONQUISTADOR', 'WINGED_HUSSAR', 'CROSSBOWMAN', 'MUSKETEER', 'ARQUEBUSIER', 'LINE_INFANTRY', 'DRAGOON', 'RIFLEMAN', 'SHARPSHOOTER', 'RAILGUN', 'ARMORED_TRAIN', 'FIELD_GUN', 'HORSE_ARTILLERY', 'DEMOLITION_SQUAD', 'SIEGE_CANNON'];
export const NAVAL_UNITS = ['GALLEY', 'TRANSPORT', 'FRIGATE', 'GALLEON', 'MAN_OF_WAR', 'GALLEASS', 'PINNACE', 'CORVETTE', 'FROLIC', 'MERCHANTMAN', 'IRONCLAD', 'STEAM_TRANSPORT', 'GUNBOAT', 'IRONCLAD_FRIGATE', 'MONITOR', 'FRIGATE_2', 'SUBMARINE', 'TORPEDO_BOAT'];
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
    LEGIONNAIRE:    { gold: 35, food: 8,  wood: 5,  iron: 5,  production: 12 },
    BERSERKER:      { gold: 40, food: 8,  wood: 5,  iron: 5,  production: 13 },
    VARANGIAN_GUARD:{ gold: 60, food: 8,  wood: 0,  iron: 12, production: 18 },
    CONQUISTADOR:   { gold: 60, food: 12, wood: 5,  iron: 12, production: 17 },
    WINGED_HUSSAR:  { gold: 70, food: 15, wood: 0,  iron: 12, production: 20 },
    CROSSBOWMAN:    { gold: 50, food: 0,  wood: 18, iron: 0,  production: 14 },
    CATAPULT:    { gold: 55,  food: 0,  wood: 10, iron: 0,  production: 18 },
    TREBUCHET:   { gold: 65,  food: 0,  wood: 15, iron: 5,  production: 20 },
    GALLEY:      { gold: 30, food: 8,  wood: 15, iron: 0,  production: 12 },
    TRANSPORT:   { gold: 25, food: 5,  wood: 15, iron: 0,  production: 15 },
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
    MERCHANTMAN: { gold: 60, food: 12, wood: 25, iron: 5,  production: 20 },
    // === MODERN ERA UNIT COSTS ===
    RIFLEMAN:    { gold: 100, food: 18, wood: 8,  iron: 22, production: 28 },
    SHARPSHOOTER: { gold: 110, food: 15, wood: 8,  iron: 18, production: 30 },
    RAILGUN:     { gold: 120, food: 12, wood: 8,  iron: 32, production: 32 },
    ARMORED_TRAIN: { gold: 110, food: 15, wood: 12, iron: 28, production: 30 },
    FIELD_GUN:   { gold: 100, food: 12, wood: 10, iron: 25, production: 30 },
    HORSE_ARTILLERY: { gold: 105, food: 15, wood: 10, iron: 25, production: 30 },
    DEMOLITION_SQUAD: { gold: 65, food: 8,  wood: 12, iron: 8,  production: 20 },
    SIEGE_CANNON: { gold: 110, food: 8,  wood: 12, iron: 28, production: 30 },
    IRONCLAD:    { gold: 130, food: 18, wood: 15, iron: 35, production: 35 },
    STEAM_TRANSPORT: { gold: 90, food: 12, wood: 18, iron: 22, production: 28 },
    GUNBOAT:     { gold: 60, food: 8,  wood: 15, iron: 12, production: 18 },
    IRONCLAD_FRIGATE: { gold: 140, food: 22, wood: 15, iron: 42, production: 38 },
    MONITOR:     { gold: 135, food: 18, wood: 12, iron: 38, production: 36 },
    FRIGATE_2:   { gold: 95, food: 15, wood: 30, iron: 15, production: 25 },
    SUBMARINE:   { gold: 115, food: 10, wood: 8,  iron: 32, production: 30 },
    TORPEDO_BOAT: { gold: 75, food: 6,  wood: 8,  iron: 22, production: 22 }
};

// Cost to build a bridge across a river tile.
export const BRIDGE_COST = { gold: 40, wood: 20 };

// Cost for an Engineer to start constructing a Siege Tower (paid up front; the
// tower is built over SIEGE_TOWER_BUILD_TURNS turns, then spawns on completion).
export const SIEGE_TOWER_COST = { gold: 40, wood: 15, iron: 0, production: 15 };
export const SIEGE_TOWER_BUILD_TURNS = 3;
export const SIEGE_TOWER_BUILD_RADIUS = 3; // Engineer must be within this Chebyshev radius of an enemy city

// Engineers can only build Siege Towers (not CATAPULT/TREBUCHET).
// Long-range siege engines require a Siege Workshop building in a city.
// Removed SIEGE_ENGINE_BUILD_COST to restrict engineers to Siege Towers only.

// Cost for an Engineer to construct Ladders (cheaper alternative to siege tower,
// allows infantry to assault fortified cities). Requires wood, built in 1 turn.
export const LADDER_COST = { gold: 30, wood: 15 };
export const LADDER_BUILD_TURNS = 1;
export const LADDER_BUILD_RADIUS = 3; // Engineer must be within this Chebyshev radius of an enemy city

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
    GALLEON:     { strongAgainst: 'FRIGATE',   multiplier: 1.4 },
    // Renaissance era type advantages
    MUSKETEER:   { strongAgainst: 'CROSSBOWMAN', multiplier: 1.4 },
    MAN_OF_WAR:  { strongAgainst: 'GALLEON',   multiplier: 1.5 },
    // Enlightenment era type advantages
    LINE_INFANTRY: { strongAgainst: 'MUSKETEER', multiplier: 1.3 },
    CANNON:      { strongAgainst: 'MUSKETEER', multiplier: 1.5 },
    MORTAR:      { strongAgainst: 'LINE_INFANTRY', multiplier: 1.5 },
    CORVETTE:    { strongAgainst: 'TRANSPORT', multiplier: 1.6 },
    FROLIC:      { strongAgainst: 'CORVETTE',  multiplier: 1.4 },
    // Modern era type advantages
    RIFLEMAN:    { strongAgainst: 'LINE_INFANTRY', multiplier: 1.4 },
    IRONCLAD:    { strongAgainst: 'FRIGATE',   multiplier: 1.6 },
    MONITOR:     { strongAgainst: 'IRONCLAD',  multiplier: 1.4 },
    RAILGUN:     { strongAgainst: 'CANNON',    multiplier: 1.5 },
    SUBMARINE:   { strongAgainst: 'MAN_OF_WAR', multiplier: 1.5 },
    TORPEDO_BOAT: { strongAgainst: 'IRONCLAD', multiplier: 1.8 }
};

export const CAPTURE_COST = 20; // Gold to capture an unowned tile

// Pillage: a military unit can destroy an enemy terrain improvement on an
// adjacent tile, pocketing a gold reward. One improvement per pillage action.
export const PILLAGE_GOLD_REWARD = 15;
export const PILLAGEABLE_BUILDINGS = ['FARM', 'LUMBERMILL', 'MINE', 'BARRACKS', 'SIEGE_WORKSHOP', 'HARBOR', 'MARKET', 'UNIVERSITY', 'BANK', 'COMMAND_POST', 'POWER_PLANT'];

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
    FARM:       { name: 'Farm',       cost: { gold: 40, wood: 20 },              bonus: { food: 3 },   terrain: 'PLAINS', desc: '+3 food/turn.' },
    LUMBERMILL: { name: 'Lumbermill', cost: { gold: 50, wood: 10 },              bonus: { wood: 5 },   terrain: 'FOREST', desc: '+5 wood/turn.' },
    MINE:       { name: 'Mine',       cost: { gold: 60, wood: 20, iron: 10 },   bonus: { iron: 5 },   terrain: 'MOUNTAIN', desc: '+5 iron/turn.' },
    MARKET:     { name: 'Market',     cost: { gold: 80, wood: 30 },              bonus: { gold: 10 },  terrain: 'CITY', influenceBuildable: true, military: true,
                  desc: '+10 gold/turn. Buildable in the city or its influence; pillageable by enemy units.' },
    BARRACKS:   { name: 'Barracks',   cost: { gold: 60, wood: 20, iron: 10 },   bonus: { production: 10 }, terrain: 'CITY', influenceBuildable: true, military: true,
                  desc: '+10 production/turn. Units trained in this city start as veterans and cost less gold. Buildable in the city or its influence.' },
    WALLS:      { name: 'Walls',      cost: { gold: 70, wood: 0, iron: 30 },    bonus: { defense: 5 }, terrain: 'CITY',
                  desc: '+5 defense to units defending this tile (strong fortification). Stays on the city tile.' },
    HARBOR:     { name: 'Harbor',     cost: { gold: 60, wood: 30, iron: 0 },    bonus: { production: 5 }, terrain: 'CITY', influenceBuildable: true, military: true,
                  desc: 'Unlocks naval units (GALLEY, TRANSPORT). +5 production/turn. Build in a coastal/river city or its influence.' },
    SIEGE_WORKSHOP: { name: 'Siege Workshop', cost: { gold: 80, wood: 20, iron: 0 }, bonus: { production: 5 }, terrain: 'CITY', influenceBuildable: true, military: true,
                  desc: 'Unlocks long-range siege engines (CATAPULT, TREBUCHET). +5 production/turn. Build in any city or its influence.' },
    // === RENAISSANCE ERA BUILDINGS ===
    CITADEL:     { name: 'Citadel',     cost: { gold: 120, wood: 40, iron: 30 }, bonus: { defense: 8 }, terrain: 'CITY', upgradesFrom: 'WALLS',
                  desc: '+8 defense to units defending this tile. Upgrades Walls. Stays on the city tile.' },
    // === ENLIGHTENMENT ERA BUILDINGS ===
    UNIVERSITY:  { name: 'University',  cost: { gold: 150, wood: 60 }, bonus: { research: 3 }, terrain: 'CITY', influenceBuildable: true, military: true,
                  desc: '+3 research points per turn. Buildable in the city or its influence; pillageable by enemy units.' },
    BANK:        { name: 'Bank',        cost: { gold: 200, wood: 40 }, bonus: { gold: 20 }, terrain: 'CITY', influenceBuildable: true, military: true,
                  desc: '+20 gold per turn. Buildable in the city or its influence; pillageable by enemy units.' },
    // === MODERN ERA BUILDINGS ===
    COMMAND_POST:{ name: 'Command Post', cost: { gold: 180, wood: 50, iron: 40 }, bonus: { production: 8 }, terrain: 'CITY', influenceBuildable: true, military: true,
                  desc: '+8 production per turn. Lords gain +2 command range. Buildable in the city or its influence; pillageable by enemy units.' },
    POWER_PLANT: { name: 'Power Plant', cost: { gold: 250, wood: 60, iron: 50 }, bonus: { production: 12 }, terrain: 'CITY', influenceBuildable: true, military: true,
                  desc: '+12 production per turn. Buildable in the city or its influence; pillageable by enemy units.' }
};

// Military structures outside cities can be attacked, damaged, and pillaged.
// All influence-buildable buildings have HP so they can be attacked/pillaged.
export const MILITARY_BUILDING_HP = { BARRACKS: 20, SIEGE_WORKSHOP: 25, HARBOR: 30, MARKET: 15, UNIVERSITY: 20, BANK: 20, COMMAND_POST: 25, POWER_PLANT: 30 };
export const MILITARY_BUILDING_DEFENSE = { BARRACKS: 2, SIEGE_WORKSHOP: 3, HARBOR: 3 };

// Per-level upgrade curves for military buildings (max level 3). Each level
// grants a higher veteran level + cheaper training (diminishing returns).
export const MILITARY_BUILDING_LEVELS = {
    BARRACKS: [
        { veteranLevel: 2, goldMult: 0.75, upgradeCost: null },
        { veteranLevel: 3, goldMult: 0.65, upgradeCost: { gold: 90, iron: 20 } },
        { veteranLevel: 4, goldMult: 0.60, upgradeCost: { gold: 150, iron: 30 } }
    ],
    HARBOR: [
        { veteranLevel: 2, goldMult: 0.85, upgradeCost: null },
        { veteranLevel: 3, goldMult: 0.75, upgradeCost: { gold: 90, iron: 20 } },
        { veteranLevel: 4, goldMult: 0.70, upgradeCost: { gold: 150, iron: 30 } }
    ]
};
export const BUILDING_MAX_LEVEL = 3;

// Pillage reward gold for destroying an enemy military structure.
export const MILITARY_PILLAGE_GOLD = 40;

// --- Engineer Structures (traps / defensive structures) ---
// Engineers can build one of three structure types on owned tiles within city
// influence. Structures are removed when an enemy captures the tile.
export const STRUCTURE_TYPE = {
    SPIKES:       { name: 'Spikes',       desc: 'Damages charging cavalry that moves onto/adjacent to this tile.', damageVsCavalry: 4, buildTurns: 2 },
    FORTIFICATION:{ name: 'Fortification',desc: '+3 defense to friendly units on this tile. Protects against infantry/artillery.', defenseBonus: 3, buildTurns: 2 },
    FALL_TRAP:    { name: 'Fall Trap',    desc: 'Damages and stuns (skip next turn) any enemy that walks onto this tile.', damage: 3, stun: true, buildTurns: 2 }
};

export const STRUCTURE_COST = {
    SPIKES:        { gold: 20, wood: 10, iron: 0 },
    FORTIFICATION: { gold: 30, wood: 20, iron: 5 },
    FALL_TRAP:     { gold: 25, wood: 5,  iron: 0 }
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
// Dynamic faction slots - supports 2-15 players
// 'player' is human-controlled; all others are AI
export const MAX_FACTIONS = 15;
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
// Extended to support up to 15 factions
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
    ai10:   { tile: 0xb87333, unit: 0xdd9944, name: 'Roman Legion' },
    ai11:   { tile: 0x4a6a8a, unit: 0x88bbdd, name: 'Viking Raiders' },
    ai12:   { tile: 0x7b2d8b, unit: 0xaa55cc, name: 'Byzantine Empire' },
    ai13:   { tile: 0xc9302c, unit: 0xff5544, name: 'Spanish Conquistadors' },
    ai14:   { tile: 0xdc143c, unit: 0xff6b6b, name: 'Polish Winged Hussars' }
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
    TACTICIAN:     { name: 'Tactician',     desc: '+1 defense to adjacent friendly units', unlockLevel: 4 }
};

// Lord classes (archetypes): each lord is born into one class, which gives a
// passive bonus to every unit in the lord's army + a unique 2.5D icon.
export const LORD_CLASSES = {
    WARLORD:        { name: 'Warlord',        icon: 'swords', bonus: { attack: 2 },                 desc: '+2 attack to all units in their army.' },
    GUARDIAN:       { name: 'Guardian',       icon: 'defense', bonus: { defense: 2 },                desc: '+2 defense to all units in their army.' },
    CONQUEROR:      { name: 'Conqueror',      icon: 'city', bonus: { siege: 3 },                  desc: '+3 damage vs cities for all units in their army.' },
    GRAND_COMMANDER:{ name: 'Grand Commander',icon: 'star', bonus: { attack: 1, defense: 1, extraCommand: 2 }, desc: '+1 atk & +1 def to army, and commands 2 extra units.' }
};

export const LORD_BASE_STATS = { command: 2, combat: 2, governance: 2 };
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
                    { id: 'blade_master', name: 'Blade Master', tier: 1, prereqs: [], effect: { attack: 1 }, desc: '+1 attack' },
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
                    { id: 'iron_skin', name: 'Iron Skin', tier: 1, prereqs: [], effect: { defense: 1 }, desc: '+1 defense' },
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
                    { id: 'tax_collector', name: 'Tax Collector', tier: 1, prereqs: [], effect: { goldBonus: 0.1 }, desc: '+10% gold income' },
                    { id: 'logistics', name: 'Logistics', tier: 1, prereqs: [], effect: { upkeepReduction: 0.1 }, desc: '-10% unit upkeep' },
                    { id: 'trade_master', name: 'Trade Master', tier: 2, prereqs: ['tax_collector', 'logistics'], effect: { tradeRouteBonus: 5 }, desc: '+5 gold per trade route' },
                    { id: 'resource_manager', name: 'Resource Manager', tier: 2, prereqs: ['tax_collector', 'logistics'], effect: { allResourceBonus: 0.1 }, desc: '+10% all resources' },
                    { id: 'chancellor', name: 'Chancellor', tier: 3, prereqs: ['trade_master', 'resource_manager'], effect: { cityYieldBonus: 0.15 }, desc: '+15% yields all cities' }
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
export const GRIEVANCE_DECAY_PER_TURN = 1;
// Tension above this threshold makes AI consider war.
export const GRIEVANCE_WAR_THRESHOLD = 40;
// Tension above this makes AI reject most treaties.
export const GRIEVANCE_HOSTILE = 15;

// --- AI Expansion (competitive settler behavior) ---
// Minimum number of cities the AI wants before slowing settler production.
export const AI_SETTLER_TARGET = 8; // base; scaled by map size
// Per-city cap: AI limits settlers to (cityCount * factor + base).
export const AI_SETTLER_CAP_FACTOR = 0.8;
export const AI_SETTLER_CAP_BASE = 2;
// Max settlers the AI will produce in a single turn.
export const AI_SETTLERS_PER_TURN = 1;
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
export const SETTLER_AGGRESSION = 1.0;
// Bonus weight added when targeting a neutral (unowned) city, so the AI races
// to grab free cities early (first-expander advantage).
export const AI_NEUTRAL_RUSH_BONUS = 150;
// Founding a city within this Manhattan distance of another faction's city is
// treated as an aggressive land grab and awards the neighbor a grievance.
export const MIN_CITY_SPACING = 6;

// AI is now much more reluctant to accept peace/trade - wars are grinding and
// breaking a treaty should be costly. The player must fight or offer significant
// value to get anything but the most temporary truces.
export const AI_PERSONALITIES = {
    AGGRESSIVE:  { warChance: 0.8,  acceptAlliance: 0.15, acceptTrade: 0.25, acceptPeace: 0.3 },
    DEFENSIVE:   { warChance: 0.3,  acceptAlliance: 0.25, acceptTrade: 0.4, acceptPeace: 0.5 },
    ECONOMIC:    { warChance: 0.15, acceptAlliance: 0.35, acceptTrade: 0.55, acceptPeace: 0.6 },
    BALANCED:    { warChance: 0.5,  acceptAlliance: 0.2,  acceptTrade: 0.3,  acceptPeace: 0.4 }
};

// --- AI goal-sequence system (see src/ai_goals.js) ---
// Min turns the planner keeps a chosen goal sequence before it may replace it
// (prevents goal thrashing turn-to-turn).
export const AI_GOAL_MIN_STABILITY_TURNS = 3;
// Fraction of the unit cap reserved for long-range artillery (CATAPULT/TREBUCHET)
// so basic siege (SIEGE/ARTILLERY) saturating the siege cap doesn't crowd them out.
export const AI_ARTILLERY_RESERVE_DEFAULT = 0.18;
export const AI_ARTILLERY_RESERVE_SIEGE = 0.40;
// Settler scarcity trigger: consecutive scarce turns before the AI aggressively
// expands to acquire missing resources, and the cap/floor relaxation it grants.
export const AI_SETTLER_SCARCITY_TURN_THRESHOLD = 2;
export const AI_SETTLER_SCARCE_CAP_RELAX = 2;
export const AI_SETTLER_SCARCE_FLOOR_RELAX = 1;

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

export const SCORE_VICTORY_TURN = 200;        // turn at which score victory is checked
export const SCIENCE_VICTORY_COST = {         // resource cost for space program project
    gold: 500, food: 200, wood: 200, iron: 100, production: 300
};
export const SCIENCE_VICTORY_BUILD_TURNS = 10; // turns to complete space program
export const ECONOMIC_VICTORY_GOLD = 2000;     // gold threshold
export const ECONOMIC_VICTORY_TRADE_ROUTES = 6; // trade route count needed
export const ECONOMIC_VICTORY_BONUS_TRADE_GOLD = 50; // bonus gold per turn near victory

// --- City Unrest & Loyalty system ---
// Unrest is a 0-100 per-city value. It rises with distance, foreign cultural
// pressure, and recent conquest; it falls with garrisons, governors, walls,
// and city level. High unrest cuts a city's yields; at 100 it can rebel.
export const UNREST_THRESHOLDS = {
    NONE: 0,        // no effect
    LOW: 25,        // -25% yields
    MEDIUM: 50,     // -50% yields, -1 attack to produced units
    HIGH: 75,       // -75% yields, -2 attack to produced units
    REBELLION: 100  // city may rebel
};

export const UNREST_DECAY_RATES = {
    GARRISON: 4,           // per turn, a friendly unit sits on the city tile
    GOVERNOR: 6,           // per turn, a lord is assigned as the city's governor
    WALLS: 3,              // per turn, if WALLS building present on the city
    CITY_LEVEL: 1          // per turn per city level
};

export const UNREST_INCREASE_RATES = {
    DISTANCE: 1,           // per tile distance from the nearest same-owner city
    NO_GARRISON: 2,        // per turn, no friendly unit on the city tile
    CULTURAL_PRESSURE: 1,  // per adjacent enemy-owned city tile
    RECENT_CONQUEST: 6,   // immediate on capture, decays 1/turn over 14 turns
    RECENT_CONQUEST_DECAY_TURNS: 14,
    OCCUPATION: 1,         // per turn while enemy units are on adjacent tiles
    CAPTURE_INITIAL: 25   // captured cities start at this unrest
};

// Rebellion: at 100 unrest a city has this chance per turn to flip to the
// most influential neighboring owner (or go independent).
export const UNREST_REBEL_CHANCE = 0.1;

// Stability factors: reduce (or increase) unrest based on the empire's
// overall condition — prosperity, military strength, fortifications,
// governance, and peace duration all stabilize a city; prolonged sieges
// destabilize it. Applied after the base increase/decrease calc.
export const STABILITY_FACTORS = {
    PROSPERITY_BONUS: -2,        // per 100 gold in treasury (max -10)
    ARMY_STRENGTH_BONUS: -3,     // per full 1.0x army ratio above 1.5x neighbor avg (max -15)
    FRIENDLY_CITY_NEIGHBOR: -2, // per adjacent friendly city tile
    SIEGE_DURATION_PENALTY: 1,  // per turn city is under siege (enemy units within 2)
    CONSECUTIVE_PEACE_BONUS: -1,// per turn at peace (max -10)
    FORTIFICATION_BONUS: -1,    // if WALLS present on the city
    GOVERNOR_PRESENCE: -2,      // if a lord is governing (stacks with GOVERNOR decay)
};

// --- Peace Negotiations with Demands ---
// War weariness accumulates while at war and decays at peace; a weary faction
// is more willing to accept harsh peace terms.
export const WAR_WEARINESS_RATES = {
    PER_TURN: 2,              // base war weariness per turn at war
    PER_UNIT_LOST: 10,        // per unit destroyed
    PER_CITY_LOST: 5,         // per city lost
    PER_BATTLE: 1,            // per battle participated in
    DECAY_AT_PEACE: -5        // per turn at peace (recovering)
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
