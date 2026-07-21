# Complete Implementation Plan: Game Enhancement Features

## Document Metadata
- **Scope:** 15 features across 4 tiers
- **Codebase:** `/home/wangyiming/conquest_game6/`
- **Architecture:** ES modules, Three.js renderer, vanilla JS UI
- **Testing:** Vitest (15 test files, 306 tests currently passing)
- **Save Version:** Currently 4 (will bump per feature as needed)

---

## Table of Contents
1. [Codebase Architecture Summary](#part-1-codebase-architecture-summary)
2. [Feature 1: City Unrest & Loyalty](#part-2-feature-1--city-unrest--loyalty-system)
3. [Feature 2: Peace Negotiations](#part-3-feature-2--peace-negotiations-with-demands)
4. [Feature 3: Trade Routes](#part-4-feature-3--trade-route-establishment)
5. [Feature 4: Lord Skill Trees](#part-5-feature-4--lord-skill-trees)
6. [Feature 5: Victory Progress Tracker](#part-6-feature-5--victory-progress-tracker)
7. [Features 6-15: Abbreviated](#part-7-features-6-15-abbreviated)
8. [Implementation Order](#part-8-implementation-order)

---

## Part 1: Codebase Architecture Summary

### Key Patterns Every Feature Must Follow

**Handler Pattern (game.js):**
```
1. VALIDATE prerequisites
2. DELEGATE to module function
3. LOG messages via this.log()
4. PLAY sound via sfx.click()
5. REFRESH affected UI panels
6. RENDER via this.renderAll()
7. UPDATE resource bar if resources changed
8. CHECK victory if cities/elimination changed
```

**Module Pattern (economy.js, diplomacy.js, etc.):**
- Functions take state as parameters, mutate in-place
- Return message arrays or result objects
- Never import from game.js (clean dependency direction)

**UI Pattern (ui.js):**
- `bindUI(gameState, callbacks)` returns object of show functions
- Panels are always in DOM, toggled via `style.display`
- Buttons wire to callbacks via `btn.onclick = () => callbacks.onXxx(data)`
- HTML built via string concatenation, inserted via `innerHTML`

**Save Pattern (save.js):**
- Maps → Arrays via spread: `[...map.entries()]`
- Sets → Arrays via spread: `[...set]`
- Load reverses: `new Map(data)`, `new Set(data)`
- Version gate: `if (data.version !== SAVE_VERSION) return null`

### File Reference Table

| File | Lines | Role | Key Exports |
|------|-------|------|-------------|
| `src/config.js` | ~600 | Constants, unit types, terrain, faction defs | All constants |
| `src/economy.js` | 355 | Resource collection, upkeep, growth | `collectResources`, `processUpkeep`, `processCityGrowth` |
| `src/diplomacy.js` | 492 | Relations, treaties, grievances | `setRelation`, `canAttack`, `addGrievance`, `aiDecideWar` |
| `src/map.js` | 808 | Terrain, city radius, territory | `generateMap`, `captureCityTerritory`, `foundCity` |
| `src/unit.js` | ~400 | Unit creation, movement, costs | `createUnit`, `canAfford`, `getReachableTiles` |
| `src/lords.js` | 245 | Lord creation, XP, army | `createLord`, `awardXP`, `lordCombatant` |
| `src/battle.js` | ~500 | Combat resolution, capture | `resolveCombat`, `captureTile` |
| `src/game.js` | ~4600 | Main orchestrator, all handlers | `Game` class |
| `src/ui.js` | 1127 | All UI panels | `bindUI` |
| `src/renderer.js` | ~1300 | Three.js rendering | `GameRenderer` |
| `src/turnmanager.js` | 230 | Turn cycle FSM | `createTurnManager` |
| `src/save.js` | 185 | localStorage persistence | `saveGame`, `loadGame` |
| `src/tech.js` | 327 | Tech tree | `createTechState`, `addResearch` |

---

## Part 2: Feature 1 — City Unrest & Loyalty System

### 2.1 Data Structures

**Add to `src/config.js`:**
```js
// City Unrest System
export const UNREST_THRESHOLDS = {
    NONE: 0,        // No effect
    LOW: 25,        // -25% yields
    MEDIUM: 50,     // -50% yields, -1 attack to produced units
    HIGH: 75,       // -75% yields, -2 attack to produced units
    REBELLION: 100  // City rebels
};

export const UNREST_DECAY_RATES = {
    GARRISON: 3,           // per turn, unit present in city
    GOVERNOR: 5,           // per turn, lord assigned as governor
    WALLS: 2,              // per turn, if WALLS building present
    CITY_LEVEL: 1,         // per city level
    FORTIFICATION: 1       // per 50% fortification remaining
};

export const UNREST_INCREASE_RATES = {
    DISTANCE: 2,           // per tile distance from capital
    NO_GARRISON: 5,        // per turn, no unit in city
    CULTURAL_PRESSURE: 3,  // per adjacent enemy city
    RECENT_CONQUEST: 10,   // immediate on capture, decays 1/turn
    OCCUPATION: 2          // per turn while enemy units adjacent
};

export const UNREST_REDUCTION_TECH = {
    FORTIFICATION: 0.5,    // 50% reduction in unrest increase
    FEUDALISM: 0.75        // 25% reduction (stacks multiplicatively)
};
```

**Add to tile objects (in `src/map.js` `foundCity` and `captureCityTerritory`):**
```js
// After city creation/capture:
tile.unrest = 0;                // 0-100
tile.lastConqueredTurn = 0;     // turn when captured (0 if founded)
tile.unrestReasons = [];        // computed each turn for UI display
```

### 2.2 New Functions in `src/economy.js`

**Add these exports:**

```js
/**
 * Calculate unrest for a single city tile.
 * @param {Map} tiles - tile map
 * @param {string} cityKey - tile key "x,z"
 * @param {string} owner - faction slot
 * @param {Map} units - unit map (for garrison check)
 * @param {Array} lords - lords array (for governor check)
 * @param {number} currentTurn - game turn
 * @returns {{ amount: number, reasons: Array<{reason: string, amount: number}> }}
 */
export function calculateUnrest(tiles, cityKey, owner, units, lords, currentTurn) {
    const tile = tiles.get(cityKey);
    if (!tile || tile.terrain !== 'CITY') return { amount: 0, reasons: [] };

    let unrest = tile.unrest || 0;
    const reasons = [];

    // --- INCREASES ---
    // Distance from capital (nearest city of same owner)
    const capital = getNearestCity(tiles, owner, tile);
    if (capital) {
        const dist = Math.abs(tile.x - capital.x) + Math.abs(tile.z - capital.z);
        const distUnrest = Math.floor(dist * UNREST_INCREASE_RATES.DISTANCE);
        if (distUnrest > 0) {
            unrest += distUnrest;
            reasons.push({ reason: 'distance', amount: distUnrest });
        }
    }

    // No garrison
    const hasGarrison = hasUnitAt(tiles, units, owner, tile.x, tile.z);
    if (!hasGarrison) {
        unrest += UNREST_INCREASE_RATES.NO_GARRISON;
        reasons.push({ reason: 'no_garrison', amount: UNREST_INCREASE_RATES.NO_GARRISON });
    }

    // Cultural pressure (adjacent enemy cities)
    const adjacentCities = getAdjacentEnemyCities(tiles, owner, tile);
    const pressure = adjacentCities.length * UNREST_INCREASE_RATES.CULTURAL_PRESSURE;
    if (pressure > 0) {
        unrest += pressure;
        reasons.push({ reason: 'cultural_pressure', amount: pressure });
    }

    // Recent conquest (decays over time)
    if (tile.lastConqueredTurn && tile.lastConqueredTurn > 0) {
        const turnsSinceConquest = currentTurn - tile.lastConqueredTurn;
        if (turnsSinceConquest < 10) {
            const conquestUnrest = Math.max(0, UNREST_INCREASE_RATES.RECENT_CONQUEST - turnsSinceConquest);
            unrest += conquestUnrest;
            reasons.push({ reason: 'recent_conquest', amount: conquestUnrest });
        }
    }

    // --- DECREASES ---
    // Governor
    const governor = findGovernor(lords, cityKey);
    if (governor) {
        const decay = UNREST_DECAY_RATES.GOVERNOR;
        unrest = Math.max(0, unrest - decay);
        reasons.push({ reason: 'governor', amount: -decay });
    }

    // Garrison (if present, reduce from the no_garrison penalty)
    if (hasGarrison) {
        const decay = UNREST_DECAY_RATES.GARRISON;
        unrest = Math.max(0, unrest - decay);
        reasons.push({ reason: 'garrison', amount: -decay });
    }

    // Walls
    const tileBuildings = this.gameState.buildings.get(cityKey) || [];
    if (tileBuildings.includes('WALLS')) {
        const decay = UNREST_DECAY_RATES.WALLS;
        unrest = Math.max(0, unrest - decay);
        reasons.push({ reason: 'walls', amount: -decay });
    }

    // City level
    const levelDecay = (tile.cityLevel || 1) * UNREST_DECAY_RATES.CITY_LEVEL;
    unrest = Math.max(0, unrest - levelDecay);
    reasons.push({ reason: 'city_level', amount: -levelDecay });

    // Clamp 0-100
    unrest = Math.max(0, Math.min(100, unrest));

    return { amount: unrest, reasons };
}

/**
 * Apply unrest effects to city yields.
 * @param {object} tile - city tile
 * @param {object} resources - faction resources (mutated)
 * @returns {string[]} messages
 */
export function applyUnrestEffects(tile, resources) {
    const messages = [];
    const unrest = tile.unrest || 0;

    if (unrest >= UNREST_THRESHOLDS.HIGH) {
        // -75% yields
        const penalty = 0.75;
        for (const res of ['gold', 'food', 'wood', 'iron', 'production']) {
            const loss = Math.floor(resources[res] * penalty);
            if (loss > 0) {
                resources[res] -= loss;
                messages.push(`${tile.cityName || 'City'}: Unrest caused -${loss} ${res}`);
            }
        }
    } else if (unrest >= UNREST_THRESHOLDS.MEDIUM) {
        const penalty = 0.50;
        for (const res of ['gold', 'food', 'wood', 'iron', 'production']) {
            const loss = Math.floor(resources[res] * penalty);
            if (loss > 0) {
                resources[res] -= loss;
                messages.push(`${tile.cityName || 'City'}: Unrest caused -${loss} ${res}`);
            }
        }
    } else if (unrest >= UNREST_THRESHOLDS.LOW) {
        const penalty = 0.25;
        for (const res of ['gold', 'food', 'wood', 'iron', 'production']) {
            const loss = Math.floor(resources[res] * penalty);
            if (loss > 0) {
                resources[res] -= loss;
            }
        }
    }

    return messages;
}

/**
 * Process unrest for all cities of a faction. Returns rebellion events.
 * @param {Map} tiles
 * @param {string} owner
 * @param {Map} units
 * @param {Array} lords
 * @param {number} currentTurn
 * @returns {{ messages: string[], rebellions: Array<{cityKey: string, newOwner: string|null}> }}
 */
export function processUnrest(tiles, owner, units, lords, currentTurn) {
    const messages = [];
    const rebellions = [];

    for (const [key, tile] of tiles) {
        if (tile.owner !== owner || tile.terrain !== 'CITY') continue;

        const { amount, reasons } = calculateUnrest(tiles, key, owner, units, lords, currentTurn);
        tile.unrest = amount;
        tile.unrestReasons = reasons;

        // Check for rebellion
        if (amount >= UNREST_THRESHOLDS.REBELLION) {
            // 30% chance per turn at 100% unrest
            if (Math.random() < 0.3) {
                const newOwner = findHighestInfluenceOwner(tiles, owner, tile);
                tile.owner = newOwner;
                tile.unrest = 50; // New owner starts with some unrest
                tile.lastConqueredTurn = currentTurn;
                rebellions.push({ cityKey: key, newOwner });
                const name = tile.cityName || `City at [${tile.x}, ${tile.z}]`;
                messages.push(`${name} has rebelled! ${newOwner ? `Now controlled by ${newOwner}` : 'Independent!'}`);
            }
        }
    }

    return { messages, rebellions };
}

// Helper functions (private to module)
function hasUnitAt(tiles, units, owner, x, z) {
    for (const u of units.values()) {
        if (u.owner === owner && u.x === x && u.z === z) return true;
    }
    return false;
}

function getNearestCity(tiles, owner, fromTile) {
    let nearest = null;
    let minDist = Infinity;
    for (const t of tiles.values()) {
        if (t.owner === owner && t.terrain === 'CITY' && t !== fromTile) {
            const d = Math.abs(t.x - fromTile.x) + Math.abs(t.z - fromTile.z);
            if (d < minDist) { minDist = d; nearest = t; }
        }
    }
    return nearest;
}

function getAdjacentEnemyCities(tiles, owner, tile) {
    const enemies = [];
    const dirs = [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];
    for (const [dx, dz] of dirs) {
        const neighbor = tiles.get(`${tile.x + dx},${tile.z + dz}`);
        if (neighbor && neighbor.terrain === 'CITY' && neighbor.owner && neighbor.owner !== owner) {
            enemies.push(neighbor);
        }
    }
    return enemies;
}

function findGovernor(lords, cityKey) {
    return lords.find(l => l.governingCity === cityKey);
}

function findHighestInfluenceOwner(tiles, currentOwner, tile) {
    const counts = {};
    const dirs = [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];
    for (const [dx, dz] of dirs) {
        const neighbor = tiles.get(`${tile.x + dx},${tile.z + dz}`);
        if (neighbor && neighbor.owner && neighbor.owner !== currentOwner) {
            counts[neighbor.owner] = (counts[neighbor.owner] || 0) + 1;
        }
    }
    let maxCount = 0;
    let result = null;
    for (const [owner, count] of Object.entries(counts)) {
        if (count > maxCount) { maxCount = count; result = owner; }
    }
    return result;
}
```

### 2.3 Integration in `src/game.js`

**In `initState()` (after line ~268), add tile initialization:**
```js
// Initialize unrest on existing cities
for (const [key, tile] of this.tiles) {
    if (tile.terrain === 'CITY') {
        tile.unrest = 0;
        tile.lastConqueredTurn = 0;
        tile.unrestReasons = [];
    }
}
```

**In `captureCityTerritory()` (map.js), add after capture:**
```js
tile.lastConqueredTurn = currentTurn; // pass turn as parameter
tile.unrest = 50; // captured cities start at 50% unrest
```

**In `turnmanager.js` `endPlayerTurn()`, add after `processCityGrowth` (line ~50):**
```js
// Process city unrest for each faction
for (const f of factions) {
    if (gameState.eliminated && gameState.eliminated.has(f)) continue;
    const { messages, rebellions } = processUnrest(
        gameState.tiles, f, gameState.units, gameState.lords, gameState.turn
    );
    if (logger) messages.forEach(m => logger(m));
    // Handle rebellions (check victory after)
    for (const r of rebellions) {
        if (r.newOwner === null) {
            // City became independent — remove from eliminated check
        }
    }
}
```

**In `ui.js` `showTileInfo()`, add unrest display after city info:**
```js
// After city level/fort display:
if (tile.unrest !== undefined && tile.unrest > 0) {
    const unrestColor = tile.unrest >= 75 ? '#ff4444' :
                        tile.unrest >= 50 ? '#ff8844' :
                        tile.unrest >= 25 ? '#ffcc44' : '#88ff88';
    html += `<div class="stat-row">
        <span class="stat-ico">⚠️</span>Unrest
        <b style="color:${unrestColor}">${tile.unrest}%</b>
    </div>`;
    if (tile.unrestReasons && tile.unrestReasons.length > 0) {
        html += `<div style="font-size:10px; color:#999; margin-left:20px;">`;
        for (const r of tile.unrestReasons) {
            html += `${r.reason}: ${r.amount > 0 ? '+' : ''}${r.amount}<br>`;
        }
        html += `</div>`;
    }
}
```

### 2.4 Save/Load Changes

**In `save.js` `saveGame()`, add to data object:**
```js
// Tiles already serialize unrest via spread (tile objects include all properties)
// No explicit save needed — unrest is on tile objects which are serialized
```

**In `save.js` `loadGame()`, add backward compat:**
```js
// After tiles are loaded:
for (const [key, tile] of tiles) {
    if (tile.terrain === 'CITY') {
        if (tile.unrest === undefined) tile.unrest = 0;
        if (tile.lastConqueredTurn === undefined) tile.lastConqueredTurn = 0;
        if (tile.unrestReasons === undefined) tile.unrestReasons = [];
    }
}
```

### 2.5 Testing

**Create `tests/unrest.test.js`:**
```js
import { describe, it, expect } from 'vitest';
import { calculateUnrest, applyUnrestEffects, processUnrest } from '../src/economy.js';

describe('City Unrest System', () => {
    describe('calculateUnrest', () => {
        it('returns 0 for a founded city with garrison', () => {
            const tiles = new Map();
            tiles.set('5,5', { x: 5, z: 5, terrain: 'CITY', owner: 'player', cityLevel: 2, unrest: 0 });
            const units = new Map();
            units.set(1, { id: 1, owner: 'player', x: 5, z: 5 });
            const result = calculateUnrest(tiles, '5,5', 'player', units, [], 10);
            expect(result.amount).toBe(0);
        });

        it('adds unrest when no garrison present', () => {
            const tiles = new Map();
            tiles.set('5,5', { x: 5, z: 5, terrain: 'CITY', owner: 'player', cityLevel: 1, unrest: 0 });
            const units = new Map();
            const result = calculateUnrest(tiles, '5,5', 'player', units, [], 10);
            expect(result.amount).toBeGreaterThan(0);
            expect(result.reasons.some(r => r.reason === 'no_garrison')).toBe(true);
        });

        it('adds unrest from cultural pressure', () => {
            const tiles = new Map();
            tiles.set('5,5', { x: 5, z: 5, terrain: 'CITY', owner: 'player', cityLevel: 1, unrest: 0 });
            tiles.set('6,5', { x: 6, z: 5, terrain: 'CITY', owner: 'ai1', cityLevel: 2 });
            const units = new Map();
            units.set(1, { id: 1, owner: 'player', x: 5, z: 5 });
            const result = calculateUnrest(tiles, '5,5', 'player', units, [], 10);
            expect(result.reasons.some(r => r.reason === 'cultural_pressure')).toBe(true);
        });

        it('reduces unrest with governor assigned', () => {
            const tiles = new Map();
            tiles.set('5,5', { x: 5, z: 5, terrain: 'CITY', owner: 'player', cityLevel: 1, unrest: 30 });
            const units = new Map();
            units.set(1, { id: 1, owner: 'player', x: 5, z: 5 });
            const lords = [{ id: 10, owner: 'player', governingCity: '5,5' }];
            const result = calculateUnrest(tiles, '5,5', 'player', units, lords, 10);
            expect(result.reasons.some(r => r.reason === 'governor')).toBe(true);
        });
    });

    describe('applyUnrestEffects', () => {
        it('applies no penalty below 25% unrest', () => {
            const tile = { unrest: 20, cityName: 'Test' };
            const resources = { gold: 100, food: 50, wood: 30, iron: 20, production: 10 };
            const msgs = applyUnrestEffects(tile, resources);
            expect(resources.gold).toBe(100);
            expect(msgs.length).toBe(0);
        });

        it('applies 75% penalty at high unrest', () => {
            const tile = { unrest: 80, cityName: 'Test' };
            const resources = { gold: 100, food: 50, wood: 30, iron: 20, production: 10 };
            applyUnrestEffects(tile, resources);
            expect(resources.gold).toBeLessThan(100);
        });
    });

    describe('processUnrest', () => {
        it('triggers rebellion at 100% unrest (random)', () => {
            const tiles = new Map();
            tiles.set('5,5', { x: 5, z: 5, terrain: 'CITY', owner: 'player', cityLevel: 1, unrest: 100 });
            const units = new Map();
            let rebellionCount = 0;
            for (let i = 0; i < 100; i++) {
                const tile = { ...tiles.get('5,5') };
                tiles.set('5,5', tile);
                const result = processUnrest(tiles, 'player', units, [], 10);
                if (result.rebellions.length > 0) rebellionCount++;
            }
            expect(rebellionCount).toBeGreaterThan(0);
        });
    });
});
```

---

## Part 3: Feature 2 — Peace Negotiations with Demands

### 3.1 Data Structures

**Add to `src/config.js`:**
```js
// Peace Negotiation System
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
    POWER_RATIO_THRESHOLD: 0.7,  // below this, more likely to accept
    WEARINESS_THRESHOLD: 30,     // above this, more likely to accept
    RELATIONSHIP_BONUS: 0.002,   // per relationship point
    TREATY_HISTORY_PENALTY: -0.1 // per broken treaty
};
```

### 3.2 New Functions in `src/diplomacy.js`

**Add these exports:**

```js
/**
 * Create a peace demand object.
 * @param {string} type - 'gold' | 'territory' | 'tribute'
 * @param {object} params - { amount, tiles, duration }
 * @returns {object} demand
 */
export function createPeaceDemand(type, params = {}) {
    return {
        type,
        amount: params.amount || 0,
        tiles: params.tiles || [],
        duration: params.duration || 0,
        perTurn: params.perTurn || 0
    };
}

/**
 * Evaluate if a peace demand is acceptable.
 * @param {object} demand - peace demand
 * @param {string} defender - faction being asked to accept
 * @param {string} attacker - faction proposing peace
 * @param {object} diploState - diplomacy state
 * @param {object} resources - defender's resources
 * @param {number} powerRatio - attacker power / defender power
 * @param {number} warWeariness - defender's war weariness
 * @returns {{ accepted: boolean, reason: string }}
 */
export function evaluatePeaceDemand(demand, defender, attacker, diploState, resources, powerRatio, warWeariness) {
    const rel = getRelation(diploState, defender, attacker);
    const def = AI_PERSONALITIES[attacker] || AI_PERSONALITIES.DEFENSIVE;

    // Base acceptance chance
    let chance = def.acceptPeace;

    // Power ratio modifier (weaker = more likely to accept)
    if (powerRatio < PEACE_ACCEPTANCE_MODIFIERS.POWER_RATIO_THRESHOLD) {
        chance += 0.3;
    } else if (powerRatio > 1.5) {
        chance -= 0.2;
    }

    // War weariness modifier
    if (warWeariness > PEACE_ACCEPTANCE_MODIFIERS.WEARINESS_THRESHOLD) {
        chance += 0.2;
    }

    // Relationship modifier
    chance += (rel.relationship || 0) * PEACE_ACCEPTANCE_MODIFIERS.RELATIONSHIP_BONUS;

    // Treaty history penalty
    chance += (rel.brokenTreaties || 0) * PEACE_ACCEPTANCE_MODIFIERS.TREATY_HISTORY_PENALTY;

    // Demand severity modifier
    if (demand.type === 'gold') {
        const affordability = (resources.gold || 0) / Math.max(1, demand.amount);
        if (affordability < 0.5) chance -= 0.3; // can't afford
        else if (affordability > 2) chance += 0.1; // easy to pay
    } else if (demand.type === 'territory') {
        chance -= demand.tiles.length * 0.1; // each tile costs acceptance
    } else if (demand.type === 'tribute') {
        chance -= demand.perTurn * 0.02; // ongoing cost
    }

    // Clamp and roll
    chance = Math.max(0.05, Math.min(0.95, chance));
    const accepted = Math.random() < chance;

    return {
        accepted,
        reason: accepted ? 'Demand accepted' : 'Demand rejected'
    };
}

/**
 * Apply war weariness to a faction.
 * @param {object} diploState
 * @param {string} faction
 * @param {number} amount
 */
export function applyWarWeariness(diploState, faction, amount) {
    if (!diploState.warWeariness) diploState.warWeariness = {};
    diploState.warWeariness[faction] = (diploState.warWeariness[faction] || 0) + amount;
}

/**
 * Process war weariness decay for all factions.
 * Called each turn in endPlayerTurn.
 * @param {object} diploState
 * @param {string[]} factions
 */
export function processWarWeariness(diploState, factions) {
    if (!diploState.warWeariness) diploState.warWeariness = {};

    for (const f of factions) {
        // Check if faction is at war with anyone
        let atWar = false;
        for (const other of factions) {
            if (other === f) continue;
            const rel = getRelation(diploState, f, other);
            if (rel.state === DIPLOMACY_STATES.WAR) { atWar = true; break; }
        }

        if (atWar) {
            // Accumulate weariness
            diploState.warWeariness[f] = (diploState.warWeariness[f] || 0) + WAR_WEARINESS_RATES.PER_TURN;
        } else {
            // Decay weariness at peace
            diploState.warWeariness[f] = Math.max(0,
                (diploState.warWeariness[f] || 0) + WAR_WEARINESS_RATES.DECAY_AT_PEACE);
        }
    }
}

/**
 * Get war weariness for a faction.
 * @param {object} diploState
 * @param {string} faction
 * @returns {number}
 */
export function getWarWeariness(diploState, faction) {
    return (diploState.warWeariness || {})[faction] || 0;
}
```

### 3.3 Integration in `src/game.js`

**Add new handler method:**
```js
/**
 * Handle peace negotiation with demands.
 * @param {string} target - target faction
 * @param {object} demands - { type, amount, tiles, duration, perTurn }
 */
handlePeaceNegotiation(target, demands) {
    const diplo = this.gameState.diplomacy;
    const rel = getRelation(diplo, PLAYER_FACTION, target);
    const targetRel = getRelation(diplo, target, PLAYER_FACTION);

    // Must be at war
    if (rel.state !== DIPLOMACY_STATES.WAR) {
        this.log('Can only negotiate peace during war.');
        return;
    }

    // Validate demands
    if (demands.type === 'gold' && demands.amount > PEACE_DEMAND_LIMITS.MAX_GOLD_DEMAND) {
        this.log(`Gold demand capped at ${PEACE_DEMAND_LIMITS.MAX_GOLD_DEMAND}.`);
        return;
    }

    // Calculate power ratio
    const playerPower = this._factionPower(PLAYER_FACTION);
    const targetPower = this._factionPower(target);
    const powerRatio = playerPower / Math.max(1, targetPower);

    // Get target's war weariness
    const weariness = getWarWeariness(diplo, target);

    // Create demand object
    const demand = createPeaceDemand(demands.type, demands);

    // Evaluate acceptance
    const result = evaluatePeaceDemand(
        demand, target, PLAYER_FACTION, diplo,
        this.gameState.resources[target], powerRatio, weariness
    );

    if (result.accepted) {
        // Apply demand effects
        if (demand.type === 'gold') {
            this.gameState.resources[target].gold -= demand.amount;
            this.gameState.resources[PLAYER_FACTION].gold += demand.amount;
            this.log(`${this.factionColors[target].name} paid ${demand.amount} gold in reparations.`);
        } else if (demand.type === 'territory') {
            for (const tileKey of demand.tiles) {
                const tile = this.tiles.get(tileKey);
                if (tile && tile.owner === target) {
                    tile.owner = PLAYER_FACTION;
                    this.log(`Territory ${tileKey} transferred.`);
                }
            }
        } else if (demand.type === 'tribute') {
            // Store tribute in diplomacy state for ongoing payment
            rel.tribute = { from: target, to: PLAYER_FACTION, perTurn: demand.perTurn, turnsLeft: demand.duration };
        }

        // Set peace
        setRelation(diplo, PLAYER_FACTION, target, DIPLOMACY_STATES.PEACE, this.gameState.turn);
        this.log(`Peace established with ${this.factionColors[target].name}.`);
    } else {
        this.log(`${this.factionColors[target].name} rejected your peace terms.`);
    }

    sfx.click();
    this.ui.showDiplomacyPanel();
}
```

**In `initUI()`, add callback:**
```js
onPeaceNegotiation: (target, demands) => this.handlePeaceNegotiation(target, demands),
```

**In `turnmanager.js` `endPlayerTurn()`, add war weariness processing:**
```js
// Process war weariness
if (gameState.diplomacy) {
    processWarWeariness(gameState.diplomacy, factions);
}
```

### 3.4 UI Changes in `src/ui.js`

**Modify `showDiplomacyPanel()` to add peace negotiation demands:**

When the player is at war with a faction, add a "Negotiate Peace" section:

```js
// After existing war actions:
if (rel.state === DIPLOMACY_STATES.WAR && isPlayerInvolved) {
    html += `<div style="margin-top:8px; padding:4px; border-left:3px solid #ff8844;">
        <b>Peace Negotiation</b><br>
        <div style="margin:4px 0;">
            <label>Gold reparations:</label>
            <input type="number" id="peace-gold-amount" value="100" min="0" max="500"
                   style="width:60px; background:#222; color:#fff; border:1px solid #555;">
        </div>
        <div style="margin:4px 0;">
            <label>Territory (comma-separated keys):</label>
            <input type="text" id="peace-territory" placeholder="e.g. 5,6 7,8"
                   style="width:120px; background:#222; color:#fff; border:1px solid #555;">
        </div>
        <div style="margin:4px 0;">
            <label>Tribute per turn:</label>
            <input type="number" id="peace-tribute-perturn" value="5" min="0" max="15"
                   style="width:60px; background:#222; color:#fff; border:1px solid #555;">
            <label>for</label>
            <input type="number" id="peace-tribute-duration" value="10" min="1" max="20"
                   style="width:40px; background:#222; color:#fff; border:1px solid #555;">
            <label>turns</label>
        </div>
        <button class="btn" id="propose-peace-btn" data-target="${b}">Propose Peace</button>
    </div>`;
}
```

**Wire up the button:**
```js
const peaceBtn = document.getElementById('propose-peace-btn');
if (peaceBtn) {
    peaceBtn.onclick = () => {
        const gold = parseInt(document.getElementById('peace-gold-amount')?.value) || 0;
        const territoryStr = document.getElementById('peace-territory')?.value || '';
        const tributePerTurn = parseInt(document.getElementById('peace-tribute-perturn')?.value) || 0;
        const tributeDuration = parseInt(document.getElementById('peace-tribute-duration')?.value) || 0;

        const tiles = territoryStr.split(/\s+/).filter(t => t.includes(','));

        let demands;
        if (gold > 0) {
            demands = { type: 'gold', amount: gold };
        } else if (tiles.length > 0) {
            demands = { type: 'territory', tiles };
        } else if (tributePerTurn > 0) {
            demands = { type: 'tribute', perTurn: tributePerTurn, duration: tributeDuration };
        } else {
            demands = { type: 'gold', amount: 0 }; // free peace
        }

        callbacks.onPeaceNegotiation && callbacks.onPeaceNegotiation(target, demands);
    };
}
```

---

## Part 4: Feature 3 — Trade Route Establishment

### 4.1 Data Structures

**Add to `src/config.js`:**
```js
// Trade Route System
export const TRADE_ROUTE_BASE_INCOME = 10;
export const TRADE_ROUTE_DISTANCE_BONUS = 0.5;  // per tile distance
export const TRADE_ROUTE_CITY_LEVEL_BONUS = 2;  // per city level
export const TRADE_ROUTE_MAX = 5;               // per faction
export const TRADE_ROUTE_MIN_CITY_LEVEL = 2;     // both cities must be this level
export const RAID_STEAL_PERCENT = 0.5;           // 50% of route income
export const RAID_DISRUPT_TURNS = 3;
export const TRADE_ROUTE_VISUAL_COLOR = 0xffd700; // gold dashed line
```

### 4.2 New Functions in `src/economy.js`

```js
/**
 * Create a trade route between two cities.
 * @param {object} params - { from: {owner, cityKey, x, z}, to: {owner, cityKey, x, z}, id }
 * @returns {object} route
 */
export function createTradeRoute(params) {
    const distance = Math.abs(params.from.x - params.to.x) + Math.abs(params.from.z - params.to.z);
    const income = TRADE_ROUTE_BASE_INCOME
        + Math.floor(distance * TRADE_ROUTE_DISTANCE_BONUS)
        + (params.fromLevel || 1) * TRADE_ROUTE_CITY_LEVEL_BONUS
        + (params.toLevel || 1) * TRADE_ROUTE_CITY_LEVEL_BONUS;

    return {
        id: params.id || Date.now(),
        from: params.from,
        to: params.to,
        income,
        path: computeRoutePath(params.from, params.to),
        disrupted: false,
        disruptedTurnsLeft: 0,
        establishedTurn: params.turn || 0
    };
}

/**
 * Compute path between two cities (simple Manhattan path).
 */
function computeRoutePath(from, to) {
    const path = [];
    let x = from.x, z = from.z;
    while (x !== to.x) {
        path.push(`${x},${z}`);
        x += x < to.x ? 1 : -1;
    }
    while (z !== to.z) {
        path.push(`${x},${z}`);
        z += z < to.z ? 1 : -1;
    }
    path.push(`${to.x},${to.z}`);
    return path;
}

/**
 * Validate if a trade route can be established.
 * @param {Map} tiles
 * @param {object} diploState
 * @param {string} fromOwner
 * @param {string} toOwner
 * @param {string} fromCityKey
 * @param {string} toCityKey
 * @param {Array} existingRoutes
 * @returns {{ valid: boolean, reason: string }}
 */
export function validateTradeRoute(tiles, diploState, fromOwner, toOwner, fromCityKey, toCityKey, existingRoutes) {
    // Check city levels
    const fromTile = tiles.get(fromCityKey);
    const toTile = tiles.get(toCityKey);
    if (!fromTile || !toTile) return { valid: false, reason: 'City not found' };
    if ((fromTile.cityLevel || 1) < TRADE_ROUTE_MIN_CITY_LEVEL) {
        return { valid: false, reason: `From city must be level ${TRADE_ROUTE_MIN_CITY_LEVEL}+` };
    }
    if ((toTile.cityLevel || 1) < TRADE_ROUTE_MIN_CITY_LEVEL) {
        return { valid: false, reason: `To city must be level ${TRADE_ROUTE_MIN_CITY_LEVEL}+` };
    }

    // Check diplomatic status (peace or trade pact required)
    const rel = getRelation(diploState, fromOwner, toOwner);
    if (rel.state !== DIPLOMACY_STATES.PEACE && rel.state !== DIPLOMACY_STATES.TRADE_PACT &&
        rel.state !== DIPLOMACY_STATES.ALLIANCE && fromOwner === toOwner) {
        // Same owner always allowed
    } else if (rel.state === DIPLOMACY_STATES.WAR) {
        return { valid: false, reason: 'Cannot trade with enemy' };
    }

    // Check route cap
    const fromRoutes = existingRoutes.filter(r => r.from.owner === fromOwner || r.to.owner === fromOwner);
    if (fromRoutes.length >= TRADE_ROUTE_MAX) {
        return { valid: false, reason: `Route cap reached (${TRADE_ROUTE_MAX})` };
    }

    // Check duplicate
    const duplicate = existingRoutes.find(r =>
        (r.from.cityKey === fromCityKey && r.to.cityKey === toCityKey) ||
        (r.from.cityKey === toCityKey && r.to.cityKey === fromCityKey)
    );
    if (duplicate) return { valid: false, reason: 'Route already exists' };

    return { valid: true, reason: 'OK' };
}

/**
 * Check for raids on trade routes.
 * @param {Array} routes - trade routes
 * @param {Map} units - all units
 * @param {string} raiderFaction - faction doing the raiding
 * @returns {{ raided: Array, messages: string[] }}
 */
export function processTradeRouteRaids(routes, units, raiderFaction) {
    const raided = [];
    const messages = [];

    for (const route of routes) {
        if (route.disrupted) continue;
        if (route.from.owner === raiderFaction || route.to.owner === raiderFaction) continue;

        // Check if raider has a military unit on the route path
        for (const tileKey of route.path) {
            const [x, z] = tileKey.split(',').map(Number);
            for (const unit of units.values()) {
                if (unit.owner === raiderFaction && unit.x === x && unit.z === z) {
                    if (!UNIT_TYPE[unit.type].naval && unit.type !== 'WORKER') {
                        // Raid succeeds
                        const stolen = Math.floor(route.income * RAID_STEAL_PERCENT);
                        route.disrupted = true;
                        route.disruptedTurnsLeft = RAID_DISRUPT_TURNS;
                        raided.push({ route, stolen, raider: raiderFaction });
                        messages.push(`${unit.type} raided a trade route! Stole ${stolen} gold.`);
                        break;
                    }
                }
            }
            if (raided.find(r => r.route.id === route.id)) break;
        }
    }

    return { raided, messages };
}
```

### 4.3 Integration in `src/game.js`

**Add handler:**
```js
handleEstablishTrade(cityKey, targetCityKey) {
    const route = createTradeRoute({
        from: { owner: PLAYER_FACTION, cityKey, ...this.tiles.get(cityKey) },
        to: { owner: targetOwner, cityKey: targetCityKey, ...this.tiles.get(targetCityKey) },
        turn: this.gameState.turn
    });

    const validation = validateTradeRoute(
        this.tiles, this.gameState.diplomacy,
        PLAYER_FACTION, targetOwner, cityKey, targetCityKey,
        this.gameState.tradeRoutes
    );

    if (!validation.valid) {
        this.log(validation.reason);
        return;
    }

    this.gameState.tradeRoutes.push(route);
    this.log(`Trade route established! +${route.income} gold/turn`);
    sfx.click();
    this.ui.updateResourceBar();
}
```

**In `turnmanager.js`, add route income and raid processing:**
```js
// Trade route income
if (gameState.tradeRoutes) {
    for (const f of factions) {
        const routeIncome = getTradeRouteIncome(gameState.tiles, f, gameState.tradeRoutes);
        if (routeIncome > 0) {
            gameState.resources[f].gold += routeIncome;
        }
    }

    // Process raids
    for (const f of factions) {
        const { raided, messages } = processTradeRouteRaids(gameState.tradeRoutes, gameState.units, f);
        if (logger) messages.forEach(m => logger(m));
        for (const r of raided) {
            gameState.resources[r.raider].gold += r.stolen;
            gameState.resources[r.route.from.owner].gold -= r.stolen;
        }
    }

    // Disruption decay
    for (const route of gameState.tradeRoutes) {
        if (route.disrupted && route.disruptedTurnsLeft > 0) {
            route.disruptedTurnsLeft--;
            if (route.disruptedTurnsLeft <= 0) route.disrupted = false;
        }
    }
}
```

### 4.4 Save/Load

**In `save.js`, add to data object:**
```js
tradeRoutes: gameState.tradeRoutes || [],
```

**In `loadGame`, add:**
```js
tradeRoutes: data.tradeRoutes || [],
```

**Bump `SAVE_VERSION` to 5.**

---

## Part 5: Feature 4 — Lord Skill Trees

### 5.1 Data Structures

**Add to `src/config.js`:**
```js
// Lord Skill Trees
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
                    { id: 'warlord_fury', name: 'Warlord\'s Fury', tier: 3, prereqs: ['inspiring_leader', 'army_commander'], effect: { allUnitsAttackBonus: 1 }, desc: '+1 attack to ALL friendly units' }
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
                    { id: 'unbreakable', name: 'Unbreakable', tier: 2, prereqs: ['iron_skin', 'fortify'], effect: { surviveLethal: true }, desc: 'Survive fatal hit at 1 HP (once)' },
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
```

### 5.2 New Functions in `src/lords.js`

```js
/**
 * Get available skills for a lord (prerequisites met, not already learned).
 * @param {object} lord
 * @returns {object[]} available skills
 */
export function getAvailableSkills(lord) {
    const tree = LORD_SKILL_TREES[lord.class];
    if (!tree) return [];

    const available = [];
    for (const branch of Object.values(tree.branches)) {
        for (const skill of branch.skills) {
            if (lord.skills && lord.skills.includes(skill.id)) continue; // already learned
            if (skill.prereqs.length === 0) {
                available.push(skill);
            } else {
                // Check if all prerequisites are met
                const met = skill.prereqs.every(preId =>
                    lord.skills && lord.skills.includes(preId)
                );
                if (met) available.push(skill);
            }
        }
    }
    return available;
}

/**
 * Invest a skill point in a skill.
 * @param {object} lord
 * @param {string} skillId
 * @returns {{ success: boolean, message: string }}
 */
export function investSkillPoint(lord, skillId) {
    if (!lord.skillPoints || lord.skillPoints <= 0) {
        return { success: false, message: 'No skill points available' };
    }

    const available = getAvailableSkills(lord);
    const skill = available.find(s => s.id === skillId);
    if (!skill) {
        return { success: false, message: 'Skill not available or prerequisites not met' };
    }

    lord.skillPoints--;
    if (!lord.skills) lord.skills = [];
    lord.skills.push(skillId);

    // Apply immediate effects
    if (skill.effect.hp) lord.maxHp += skill.effect.hp;
    if (skill.effect.commandBonus) lord.stats.command += skill.effect.commandBonus;

    return { success: true, message: `${lord.name} learned ${skill.name}!` };
}

/**
 * Get aggregated skill effects for a lord.
 * @param {object} lord
 * @returns {object} combined effects
 */
export function getSkillEffects(lord) {
    const effects = {
        attack: 0,
        defense: 0,
        hp: 0,
        critChance: 0,
        lifesteal: 0,
        lowHpBonus: 0,
        adjacentAttackBonus: 0,
        adjacentDefenseBonus: 0,
        siegeBonus: 0,
        cityAttackBonus: 0,
        commandBonus: 0,
        healAdjacent: 0,
        goldBonus: 0,
        upkeepReduction: 0,
        tradeRouteBonus: 0,
        allResourceBonus: 0,
        cityYieldBonus: 0
    };

    if (!lord.skills) return effects;

    const tree = LORD_SKILL_TREES[lord.class];
    if (!tree) return effects;

    for (const branch of Object.values(tree.branches)) {
        for (const skill of branch.skills) {
            if (lord.skills.includes(skill.id)) {
                for (const [key, val] of Object.entries(skill.effect)) {
                    if (typeof val === 'number' && effects[key] !== undefined) {
                        effects[key] += val;
                    } else if (typeof val === 'boolean') {
                        effects[key] = val;
                    } else if (typeof val === 'object' && val !== null) {
                        // Handle nested effects like { attack: 1, defense: 1 }
                        for (const [k, v] of Object.entries(val)) {
                            if (effects[k] !== undefined) effects[k] += v;
                        }
                    }
                }
            }
        }
    }

    return effects;
}
```

### 5.3 Integration in `src/game.js`

**Add handler:**
```js
handleSkillInvestment(lordId, skillId) {
    const lord = this.gameState.lords.find(l => l.id === lordId);
    if (!lord || lord.owner !== PLAYER_FACTION) {
        this.log('Lord not found.');
        return;
    }

    const result = investSkillPoint(lord, skillId);
    this.log(result.message);

    if (result.success) {
        sfx.click();
        this.ui.showLordInfo(lord);
        this.renderAll();
    }
}
```

**In `awardXP` (lords.js), add skill point grant on level-up:**
```js
// After level-up in awardXP:
lord.skillPoints = (lord.skillPoints || 0) + 1;
messages.push(`${lord.name} gained a skill point!`);
```

### 5.4 UI in `src/ui.js`

**Add skill tree panel to `showLordInfo()`:**
```js
// After lord stats display:
if (lord.skillPoints && lord.skillPoints > 0) {
    html += `<div style="margin-top:8px; padding:4px; border-left:3px solid #ffd700;">
        <b>Skill Points: ${lord.skillPoints}</b>`;
    const available = getAvailableSkills(lord);
    for (const skill of available) {
        html += `<button class="btn btn-sm skill-invest-btn" data-lord-id="${lord.id}" data-skill-id="${skill.id}"
                    style="display:block; margin:2px 0; width:100%;">
            ${skill.name} — ${skill.desc}
        </button>`;
    }
    html += `</div>`;
}
```

**Wire up skill investment buttons:**
```js
const skillBtns = document.querySelectorAll('.skill-invest-btn');
for (const btn of skillBtns) {
    btn.onclick = () => {
        const lordId = parseInt(btn.dataset.lordId);
        const skillId = btn.dataset.skillId;
        callbacks.onSkillInvestment && callbacks.onSkillInvestment(lordId, skillId);
    };
}
```

---

## Part 6: Feature 5 — Victory Progress Tracker

### 6.1 New Function in `src/game.js`

```js
/**
 * Get victory progress data for UI display.
 * @returns {object}
 */
getVictoryProgress() {
    const gs = this.gameState;
    const ts = gs.techState;
    const vs = gs.victoryState || {};

    const totalTechs = Object.keys(TECHS).length;
    const researchedTechs = ts ? ts.researched.size : 0;

    return {
        domination: {
            eliminated: gs.eliminated ? gs.eliminated.size : 0,
            total: FACTIONS.length,
            progress: (gs.eliminated ? gs.eliminated.size : 0) / FACTIONS.length
        },
        science: {
            researched: researchedTechs,
            total: totalTechs,
            currentTech: ts ? ts.current : null,
            progress: researchedTechs / totalTechs
        },
        economic: {
            gold: (gs.resources && gs.resources.player && gs.resources.player.gold) || 0,
            goldTarget: ECONOMIC_VICTORY_GOLD,
            tradeRoutes: (vs.tradeRoutes && vs.tradeRoutes.player) || 0,
            routeTarget: ECONOMIC_VICTORY_TRADE_ROUTES,
            progress: Math.min(
                ((gs.resources && gs.resources.player && gs.resources.player.gold) || 0) / ECONOMIC_VICTORY_GOLD,
                ((vs.tradeRoutes && vs.tradeRoutes.player) || 0) / ECONOMIC_VICTORY_TRADE_ROUTES
            )
        },
        score: {
            playerScore: this._calculateScores()[PLAYER_FACTION] || 0,
            aiScore: Math.max(...Object.entries(this._calculateScores())
                .filter(([f]) => f !== PLAYER_FACTION)
                .map(([, s]) => s)),
            turn: gs.turn,
            maxTurn: SCORE_VICTORY_TURN,
            progress: gs.turn / SCORE_VICTORY_TURN
        }
    };
}
```

### 6.2 UI Panel in `src/ui.js`

**Add victory tracker panel:**

In `index.html`, add:
```html
<div id="victory-panel" style="display:none; position:fixed; top:50px; right:10px; width:280px; background:#1a1a2e; border:1px solid #444; padding:8px; z-index:100; font-size:12px;">
    <div id="victory-panel-body"></div>
</div>
```

**In ui.js, add show function:**
```js
function showVictoryPanel() {
    const panel = document.getElementById('victory-panel-body');
    if (!panel) return;

    const data = callbacks.getVictoryProgress ? callbacks.getVictoryProgress() : null;
    if (!data) return;

    let html = `<h3 style="margin:0 0 6px;">Victory Progress</h3>`;

    // Domination
    html += `<div style="margin:4px 0;">
        <b>⚔️ Domination</b> ${data.domination.eliminated}/${data.domination.total} eliminated
        <div style="background:#333; height:6px; border-radius:3px;">
            <div style="background:#ff4444; width:${data.domination.progress * 100}%; height:100%; border-radius:3px;"></div>
        </div>
    </div>`;

    // Science
    html += `<div style="margin:4px 0;">
        <b>🔬 Science</b> ${data.science.researched}/${data.science.total} techs
        ${data.science.currentTech ? `<br><span style="color:#999;">Researching: ${data.science.currentTech}</span>` : ''}
        <div style="background:#333; height:6px; border-radius:3px;">
            <div style="background:#4488ff; width:${data.science.progress * 100}%; height:100%; border-radius:3px;"></div>
        </div>
    </div>`;

    // Economic
    html += `<div style="margin:4px 0;">
        <b>💰 Economic</b> ${data.economic.gold}/${data.economic.goldTarget} gold, ${data.economic.tradeRoutes}/${data.economic.routeTarget} routes
        <div style="background:#333; height:6px; border-radius:3px;">
            <div style="background:#ffd700; width:${data.economic.progress * 100}%; height:100%; border-radius:3px;"></div>
        </div>
    </div>`;

    // Score
    html += `<div style="margin:4px 0;">
        <b>📊 Score</b> You: ${data.score.playerScore} | Best AI: ${data.score.aiScore} | Turn ${data.score.turn}/${data.score.maxTurn}
        <div style="background:#333; height:6px; border-radius:3px;">
            <div style="background:#44ff44; width:${data.score.progress * 100}%; height:100%; border-radius:3px;"></div>
        </div>
    </div>`;

    panel.innerHTML = html;
}
```

**Toggle with Tab key:**
```js
document.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
        e.preventDefault();
        const panel = document.getElementById('victory-panel');
        if (panel) {
            panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
            if (panel.style.display === 'block') showVictoryPanel();
        }
    }
});
```

**Add to `updateAll()`:**
```js
function updateAll() {
    updateResourceBar();
    showDiplomacyPanel();
    showLordPanel();
    if (document.getElementById('victory-panel')?.style.display === 'block') {
        showVictoryPanel();
    }
}
```

---

## Part 7: Features 6-15 (Abbreviated)

For the remaining features, here are the key implementation points:

### Feature 6: Turn Summary / Event Log
- Add `gameState.eventLog = []` to `initState()`
- Add `addEvent(category, message)` to `game.js`
- Call `addEvent()` in `runAITurn()` for each action type
- Add event log panel to `index.html` and `ui.js`
- Add category filtering and scrollback

### Feature 7: City Tile Yield Overlay
- Add `tile.yieldPreview` cache to each tile
- Toggle with 'Y' key
- Render yield icons as HTML overlays on each tile position
- Update cache when tiles change ownership

### Feature 8: Difficulty Settings
- Add `DIFFICULTY_PRESETS` to `config.js`
- Add selector to `menus.js` start menu
- Store `gameState.difficulty` in state
- Apply modifiers in `createUnit()` and `collectResources()`

### Feature 9: Mountain Passes
- Add `PASS` terrain type to `config.js`
- Generate 2-4 passes per continent in `generateMap()`
- Update `isPassable()` to allow passes
- Update movement cost calculation

### Feature 10: River Crossing Penalty
- Add `RIVER_CROSSING_DEFENSE_PENALTY` to config
- Track `unit.crossedRiverThisTurn` flag
- Apply penalty in `resolveCombat()`
- End movement on river crossing

### Feature 11: Spy System
- Add `SPY` unit type to config
- Add spy action execution in `game.js`
- Add spy UI panel with action buttons
- Add detection chance and relationship penalties

### Feature 12: Coalition Wars
- Add coalition logic to `diplomacy.js`
- Add ally selection UI when declaring war
- Apply shared war declaration penalties

### Feature 13: Minimap
- Add minimap canvas to `renderer.js`
- Render territory/units at 1px per tile
- Click to jump camera
- Toggle with 'M' key

### Feature 14: City Quick-Jump
- Add city name links in resource bar
- Click to jump camera
- Add [ ] keyboard shortcuts to cycle

### Feature 15: Army Composition Panel
- Add panel showing all lords and their armies
- Click lord to select on map
- Drag-and-drop to reassign units

---

## Part 8: Implementation Order

| Phase | Features | Files Modified | Estimated Hours |
|-------|----------|----------------|-----------------|
| 1 | 5, 6, 7, 8 | ui.js, game.js, config.js, menus.js, renderer.js | 10-12 |
| 2 | 2, 3 | diplomacy.js, economy.js, game.js, ui.js | 12-14 |
| 3 | 9, 10 | map.js, config.js, unit.js, battle.js | 6-8 |
| 4 | 1, 4, 11, 12 | economy.js, lords.js, diplomacy.js, game.js, ui.js | 18-22 |
| 5 | 13, 14, 15 | renderer.js, ui.js, lords.js | 8-10 |

**Total: ~54-66 hours of implementation**

---

**End of Detailed Plan**
