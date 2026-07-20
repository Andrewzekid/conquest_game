# Implementation Plan: Concealment/Ambush & Cavalry Charge Systems

## Overview
This document outlines the implementation plan for two new tactical mechanics:
1. **Concealment/Ambush System** - Units can hide in terrain and launch surprise attacks
2. **Cavalry Charge** - Mounted units can charge into enemy tiles for bonus damage

---

## 1. Concealment / Ambush System

### 1.1 Core Mechanics
- Units can conceal themselves in MOUNTAIN (2 turns) or FOREST (1 turn) terrain
- Must be **outside enemy vision** to begin/complete concealment
- Max 2 units can conceal per tile
- Once concealed, units are invisible to enemies
- When an enemy enters the same or adjacent tile, concealed units may reveal for a surprise attack
- Surprise attack grants: +3 attack bonus, +2 defense on counter-attack

### 1.2 Data Model Changes

#### Unit Object (src/unit.js)
```javascript
// Add to unit object:
{
  // ... existing fields ...
  concealState: null,        // null | 'concealing' | 'concealed'
  concealTurnsLeft: 0,      // turns remaining to become fully concealed
  concealTerrain: null       // terrain type where concealed (for visual)
}
```

#### Game State (src/game.js initState)
```javascript
// Add to gameState:
{
  // ... existing fields ...
  concealedUnits: new Map()  // tileKey -> [unitId, unitId] (max 2)
}
```

### 1.3 Config Constants (src/config.js) - DONE
```javascript
export const CONCEAL_TERRAINS = ['MOUNTAIN', 'FOREST'];
export const CONCEAL_TURNS_MOUNTAIN = 2;
export const CONCEAL_TURNS_FOREST = 1;
export const CONCEAL_MAX_PER_TILE = 2;
export const AMBUSH_ATTACK_BONUS = 3;
export const AMBUSH_DEFENSE_BONUS = 2;
```

### 1.4 Implementation Steps

#### Step 1: Add Conceal Action Handler (src/game.js)
```javascript
/**
 * A unit begins concealing itself in the current tile's terrain.
 * Requirements:
 * - Unit is on CONCEAL_TERRAINS terrain
 * - Unit is NOT in enemy vision
 * - Tile has < CONCEAL_MAX_PER_TILE concealed units
 * - Unit has not moved or attacked this turn
 */
handleConceal(unit) {
  if (!unit || unit.owner !== PLAYER_FACTION) return;
  if (unit.hasMovedThisTurn || unit.hasAttackedThisTurn) {
    this.log('Unit must not have acted this turn to conceal.');
    return;
  }
  
  const tile = this.tiles.get(`${unit.x},${unit.z}`);
  if (!tile || !CONCEAL_TERRAINS.includes(tile.terrain)) {
    this.log('Can only conceal in mountains or forests.');
    return;
  }
  
  // Check if in enemy vision
  if (this._isInEnemyVision(unit)) {
    this.log('Cannot conceal while in enemy vision!');
    return;
  }
  
  // Check tile capacity
  const tileKey = `${unit.x},${unit.z}`;
  const concealed = this.gameState.concealedUnits.get(tileKey) || [];
  if (concealed.length >= CONCEAL_MAX_PER_TILE) {
    this.log('This tile already has maximum concealed units.');
    return;
  }
  
  // Start concealment
  const turnsNeeded = tile.terrain === 'MOUNTAIN' ? CONCEAL_TURNS_MOUNTAIN : CONCEAL_TURNS_FOREST;
  unit.concealState = 'concealing';
  unit.concealTurnsLeft = turnsNeeded;
  unit.concealTerrain = tile.terrain;
  
  // Mark as acted
  unit.hasAttackedThisTurn = true;
  
  this.log(`${UNIT_TYPE[unit.type].name} begins concealing in ${tile.terrain.toLowerCase()} (${turnsNeeded} turn(s)).`);
  sfx.click();
  this.renderAll();
}
```

#### Step 2: Tick Concealment Progress (src/game.js onPhaseChange)
```javascript
/**
 * Tick concealment progress for all units at turn start.
 * Units that complete concealment become fully hidden.
 */
_tickConcealment() {
  for (const unit of this.gameState.units.values()) {
    if (unit.concealState === 'concealing') {
      // Check if still outside enemy vision
      if (this._isInEnemyVision(unit)) {
        // Concealment interrupted
        unit.concealState = null;
        unit.concealTurnsLeft = 0;
        unit.concealTerrain = null;
        this.log(`${UNIT_TYPE[unit.type].name}'s concealment was interrupted by enemy vision!`);
        continue;
      }
      
      unit.concealTurnsLeft--;
      if (unit.concealTurnsLeft <= 0) {
        unit.concealState = 'concealed';
        // Add to concealed units map
        const tileKey = `${unit.x},${unit.z}`;
        const concealed = this.gameState.concealedUnits.get(tileKey) || [];
        concealed.push(unit.id);
        this.gameState.concealedUnits.set(tileKey, concealed);
        this.log(`${UNIT_TYPE[unit.type].name} is now fully concealed!`);
      } else {
        this.log(`${UNIT_TYPE[unit.type].name}: ${unit.concealTurnsLeft} turn(s) until concealed.`);
      }
    }
  }
}
```

#### Step 3: Vision Check Helper (src/game.js)
```javascript
/**
 * Check if a unit is currently visible to any enemy faction.
 */
_isInEnemyVision(unit) {
  // Use the fog system to check if the tile is in any enemy's vision
  // For simplicity, check if any enemy unit/lord/city can see this tile
  for (const other of this.gameState.units.values()) {
    if (other.owner === unit.owner) continue;
    if (canAttack(this.gameState.diplomacy, unit.owner, other.owner)) {
      const vision = (UNIT_TYPE[other.type] && UNIT_TYPE[other.type].vision) || 3;
      const dist = Math.max(Math.abs(unit.x - other.x), Math.abs(unit.z - other.z));
      if (dist <= vision) return true;
    }
  }
  // Also check enemy cities
  for (const t of this.tiles.values()) {
    if (t.terrain === 'CITY' && t.owner && t.owner !== unit.owner) {
      if (canAttack(this.gameState.diplomacy, unit.owner, t.owner)) {
        const dist = Math.max(Math.abs(unit.x - t.x), Math.abs(unit.z - t.z));
        if (dist <= cityRadius(t)) return true;
      }
    }
  }
  return false;
}
```

#### Step 4: Ambush Trigger (src/game.js moveUnit)
```javascript
// In moveUnit(), after moving, check for ambush opportunities
moveUnit(unit, x, z) {
  // ... existing move logic ...
  
  // Check if moving into ambush range of concealed enemies
  this._checkAmbushTrigger(unit, x, z);
}

/**
 * Check if a moving unit triggers an ambush from concealed enemies.
 */
_checkAmbushTrigger(movingUnit, x, z) {
  // Check same tile and adjacent tiles for concealed enemies
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      const checkX = x + dx, checkZ = z + dz;
      const tileKey = `${checkX},${checkZ}`;
      const concealed = this.gameState.concealedUnits.get(tileKey) || [];
      
      for (const unitId of concealed) {
        const ambusher = this.gameState.units.get(unitId);
        if (!ambusher) continue;
        if (ambusher.owner === movingUnit.owner) continue;
        if (!canAttack(this.gameState.diplomacy, ambusher.owner, movingUnit.owner)) continue;
        
        // Ambush opportunity! For player units, prompt; for AI, auto-decide
        if (ambusher.owner === PLAYER_FACTION) {
          // Store ambush opportunity for UI to present
          this.gameState.pendingAmbush = {
            ambusherId: unitId,
            targetId: movingUnit.id,
            fromTile: tileKey
          };
          this.log(`⚠️ Ambush opportunity! ${UNIT_TYPE[ambusher.type].name} can surprise attack!`);
          // UI should show an "Ambush!" button
        } else {
          // AI auto-ambush
          this._executeAmbush(ambusher, movingUnit);
        }
        return; // Only one ambush per move
      }
    }
  }
}
```

#### Step 5: Execute Ambush (src/game.js)
```javascript
/**
 * Execute an ambush attack with bonuses.
 */
_executeAmbush(ambusher, target) {
  // Reveal the ambusher
  ambusher.concealState = null;
  ambusher.concealTerrain = null;
  const tileKey = `${ambusher.x},${ambusher.z}`;
  const concealed = this.gameState.concealedUnits.get(tileKey) || [];
  this.gameState.concealedUnits.set(tileKey, concealed.filter(id => id !== ambusher.id));
  
  // Apply ambush bonuses to combat
  const originalAttack = ambusher.attack ?? UNIT_TYPE[ambusher.type].attack;
  ambusher.attack = originalAttack + AMBUSH_ATTACK_BONUS;
  
  this.log(`🗡️ ${UNIT_TYPE[ambusher.type].name} ambushes ${UNIT_TYPE[target.type].name}! (+${AMBUSH_ATTACK_BONUS} attack)`);
  
  // Execute combat
  this.handleAttack(ambusher, target);
  
  // Restore original attack (bonus was temporary)
  ambusher.attack = originalAttack;
}

/**
 * Player confirms ambush attack.
 */
handleAmbushConfirm() {
  const ambush = this.gameState.pendingAmbush;
  if (!ambush) return;
  
  const ambusher = this.gameState.units.get(ambush.ambusherId);
  const target = this.gameState.units.get(ambush.targetId);
  if (!ambusher || !target) return;
  
  this._executeAmbush(ambusher, target);
  this.gameState.pendingAmbush = null;
}

/**
 * Player declines ambush (stays concealed).
 */
handleAmbushDecline() {
  this.gameState.pendingAmbush = null;
  this.log('Ambush opportunity passed.');
}
```

#### Step 6: Fog of War Integration (src/fog.js)
```javascript
// Modify computeVisibility to exclude concealed enemy units
export function computeVisibility(sources, concealedUnits = null) {
  // ... existing visibility computation ...
  
  // After computing visible tiles, remove tiles that only contain concealed enemies
  // (concealed units don't reveal their tile to enemies)
}
```

#### Step 7: Renderer Updates (src/renderer.js)
```javascript
// In renderAll(), handle concealed units:
// - Own concealed units: show with transparency/stealth effect
// - Enemy concealed units: don't render at all (unless player has vision and they're 'concealing')

// Add visual indicator for concealment:
if (unit.concealState === 'concealed') {
  mesh.traverse(o => {
    if (o.isMesh && o.material) {
      o.material.transparent = true;
      o.material.opacity = 0.4; // Stealth effect
    }
  });
  // Add a "hidden" icon
  mesh.add(this.makeIconSprite('👁️', 0.4, 1.2));
} else if (unit.concealState === 'concealing') {
  // Show progress indicator
  mesh.add(this.makeIconSprite('⏳', 0.4, 1.2));
}
```

#### Step 8: UI Updates (src/ui.js)
```javascript
// Add "Conceal" button to unit info panel when applicable
// Add "Ambush!" button when pendingAmbush is set

showUnitInfo(unit) {
  // ... existing code ...
  
  // Add Conceal button if applicable
  if (unit.owner === PLAYER_FACTION && 
      !unit.hasMovedThisTurn && !unit.hasAttackedThisTurn &&
      !unit.concealState &&
      CONCEAL_TERRAINS.includes(this.tiles.get(`${unit.x},${unit.z}`)?.terrain)) {
    // Add "Conceal" button
  }
  
  // Show concealment status
  if (unit.concealState === 'concealing') {
    info += `<br>⏳ Concealing: ${unit.concealTurnsLeft} turn(s) left`;
  } else if (unit.concealState === 'concealed') {
    info += `<br>👁️ Concealed (invisible to enemies)`;
  }
}
```

#### Step 9: Save/Load Integration (src/save.js)
```javascript
// Add concealedUnits to save data
data.concealedUnits = [...(gameState.concealedUnits || []).entries()];

// Restore on load
concealedUnits: new Map(data.concealedUnits || [])
```

---

## 2. Cavalry Charge System

### 2.1 Core Mechanics
- CAVALRY and CATAPHRACT units can charge an adjacent enemy
- Charge moves the unit onto the enemy's tile (same tile combat)
- Grants +2 attack bonus
- After charging, unit cannot move for the rest of the turn
- Charge range: 1 tile (Chebyshev distance)

### 2.2 Config Constants (src/config.js) - DONE
```javascript
export const CHARGE_UNITS = ['CAVALRY', 'CATAPHRACT'];
export const CHARGE_ATTACK_BONUS = 2;
export const CHARGE_RANGE = 1;
```

### 2.3 Implementation Steps

#### Step 1: Add Charge Handler (src/game.js)
```javascript
/**
 * A cavalry unit charges an adjacent enemy, moving onto their tile.
 * Requirements:
 * - Unit type is in CHARGE_UNITS
 * - Target is within CHARGE_RANGE (adjacent)
 * - Unit has not attacked this turn
 * - At war with target's faction
 */
handleCharge(attacker, defender) {
  if (!attacker || !defender) return;
  if (!CHARGE_UNITS.includes(attacker.type)) {
    this.log('Only cavalry units can charge.');
    return;
  }
  if (attacker.hasAttackedThisTurn) {
    this.log('This unit has already acted this turn.');
    return;
  }
  if (!canAttack(this.gameState.diplomacy, attacker.owner, defender.owner)) {
    this.log('Cannot charge: not at war with that faction!');
    return;
  }
  
  // Check range
  const dist = Math.max(Math.abs(attacker.x - defender.x), Math.abs(attacker.z - defender.z));
  if (dist > CHARGE_RANGE) {
    this.log('Target is too far to charge.');
    return;
  }
  
  // Move attacker to defender's tile
  const oldX = attacker.x, oldZ = attacker.z;
  attacker.x = defender.x;
  attacker.z = defender.z;
  
  this.log(`🐎 ${UNIT_TYPE[attacker.type].name} charges ${UNIT_TYPE[defender.type].name}!`);
  sfx.attack();
  
  // Apply charge bonus and attack
  const originalAttack = attacker.attack ?? UNIT_TYPE[attacker.type].attack;
  attacker.attack = originalAttack + CHARGE_ATTACK_BONUS;
  
  // Execute combat
  const defenderTile = this.tiles.get(`${defender.x},${defender.z}`);
  const terrain = defenderTile ? defenderTile.terrain : 'PLAINS';
  const attackerLord = findCommandingLord(this.gameState.lords, attacker);
  const defenderLord = findCommandingLord(this.gameState.lords, defender);
  
  const result = resolveCombat(attacker, defender, terrain, attackerLord, defenderLord,
    this.gameState.buildings, this.gameState.lords, this.gameState.tempBonuses);
  result.messages.forEach(m => this.log(m));
  
  // Restore original attack
  attacker.attack = originalAttack;
  
  // Mark as acted (both move and attack used)
  attacker.hasAttackedThisTurn = true;
  attacker.hasMovedThisTurn = true; // Cannot move after charging
  
  // Handle deaths
  if (result.defenderDied) {
    this._onUnitDeath(defender);
    this.log(`${UNIT_TYPE[defender.type].name} destroyed!`);
    this._maybeRespawnOnKill(attacker.owner);
  }
  if (result.attackerDied) {
    this._onUnitDeath(attacker);
    this.log(`${UNIT_TYPE[attacker.type].name} destroyed in charge!`);
    // Attacker died, so they don't stay on the tile
  }
  
  this.gameState.moveTargets.clear();
  this.gameState.attackTargets = [];
  this.renderer.clearHighlights();
  this.renderAll();
  this.ui.updateResourceBar();
  this.checkVictory();
}
```

#### Step 2: Add Charge Targets to Selection (src/game.js selectUnit)
```javascript
// In selectUnit(), add charge targets
selectUnit(unit) {
  // ... existing code ...
  
  // Add charge targets for cavalry
  this.gameState.chargeTargets = [];
  if (unit.owner === PLAYER_FACTION && !unit.hasAttackedThisTurn &&
      CHARGE_UNITS.includes(unit.type)) {
    for (const other of this.gameState.units.values()) {
      if (other.owner === unit.owner) continue;
      if (!canAttack(this.gameState.diplomacy, unit.owner, other.owner)) continue;
      const dist = Math.max(Math.abs(unit.x - other.x), Math.abs(unit.z - other.z));
      if (dist <= CHARGE_RANGE) {
        this.gameState.chargeTargets.push(other);
      }
    }
  }
  
  // Highlight charge targets (different color from regular attack)
  this.renderer.highlightChargeTargets(this.gameState.chargeTargets || []);
}
```

#### Step 3: Handle Charge Click (src/game.js _handleLeftClick)
```javascript
// In _handleLeftClick(), add charge handling before regular attack
// 1b) Charge: a selected player cavalry clicks an adjacent enemy
if (sel && sel.owner === PLAYER_FACTION && clickedUnit && clickedUnit.owner !== PLAYER_FACTION) {
  const isChargeTarget = this.gameState.chargeTargets && 
    this.gameState.chargeTargets.some(u => u.id === clickedUnit.id);
  if (isChargeTarget && !sel.hasAttackedThisTurn && CHARGE_UNITS.includes(sel.type)) {
    this.handleCharge(sel, clickedUnit);
    return;
  }
}
```

#### Step 4: Renderer Updates (src/renderer.js)
```javascript
// Add charge target highlighting (different color from attack)
highlightChargeTargets(units) {
  const CHARGE_HIGHLIGHT = 0xff8800; // Orange for charge
  for (const unit of units) {
    const mesh = this.tileMeshes.get(`${unit.x},${unit.z}`);
    if (mesh && mesh.visible) {
      mesh.material.emissive = new THREE.Color(CHARGE_HIGHLIGHT);
      mesh.material.emissiveIntensity = 0.8;
    }
  }
}
```

#### Step 5: UI Updates (src/ui.js)
```javascript
// Show charge option in unit info
showUnitInfo(unit) {
  // ... existing code ...
  
  if (CHARGE_UNITS.includes(unit.type) && !unit.hasAttackedThisTurn) {
    info += `<br>🐎 <b>Charge:</b> Rush adjacent enemy (+${CHARGE_ATTACK_BONUS} atk, no move after)`;
  }
}
```

#### Step 6: AI Integration (src/ai.js)
```javascript
// Add charge action type for AI cavalry
// AI should consider charging when:
// - Adjacent to a weaker enemy
// - The charge bonus would be decisive
// - The AI doesn't need to move after (defensive position or target is high value)
```

---

## 3. File Changes Summary

| File | Changes |
|------|---------|
| `src/config.js` | Add concealment and charge constants (DONE) |
| `src/game.js` | Add handlers, tick functions, ambush logic, charge logic |
| `src/unit.js` | Add concealState fields to unit creation |
| `src/fog.js` | Exclude concealed units from vision |
| `src/renderer.js` | Stealth visuals, charge highlights |
| `src/ui.js` | Conceal button, ambush prompt, charge info |
| `src/save.js` | Persist concealedUnits map |
| `src/ai.js` | AI concealment and charge decisions |
| `src/battle.js` | Optional: ambush defense bonus handling |

---

## 4. Testing Checklist

### Concealment
- [ ] Unit can begin concealing in forest (1 turn)
- [ ] Unit can begin concealing in mountain (2 turns)
- [ ] Concealment fails if in enemy vision
- [ ] Concealment interrupted if enemy gains vision during process
- [ ] Fully concealed unit is invisible to enemies
- [ ] Max 2 units per tile
- [ ] Concealed unit revealed when enemy enters same/adjacent tile
- [ ] Ambush grants +3 attack bonus
- [ ] Player gets ambush prompt, AI auto-decides

### Cavalry Charge
- [ ] Cavalry can charge adjacent enemy
- [ ] Cataphract can charge adjacent enemy
- [ ] Charge grants +2 attack bonus
- [ ] Unit moves to enemy's tile
- [ ] Unit cannot move after charging
- [ ] Charge targets highlighted in orange
- [ ] AI uses charge tactically

---

## 5. Implementation Order

1. **Phase 1: Cavalry Charge** (simpler, fewer dependencies)
   - Add handleCharge()
   - Add charge target selection
   - Add click handling
   - Add renderer highlighting
   - Test and verify

2. **Phase 2: Concealment Basics**
   - Add concealState to units
   - Add handleConceal()
   - Add _tickConcealment()
   - Add vision check helper
   - Test concealment setup

3. **Phase 3: Ambush System**
   - Add ambush trigger on move
   - Add ambush execution
   - Add UI prompts
   - Test ambush flow

4. **Phase 4: Polish**
   - Renderer stealth visuals
   - AI integration
   - Save/load integration
   - Balance testing