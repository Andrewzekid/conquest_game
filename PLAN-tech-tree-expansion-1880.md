# Tech Tree Expansion Plan: Gunpowder Era to 1880

## Overview

| Component | Current | After | Change |
|-----------|---------|-------|--------|
| Eras | 4 | 7 | +3 new eras |
| Techs | 16 | 31 | +15 new techs |
| Unit Types | 28 | 52 | +24 new units |
| Building Types | 8 | 13 | +5 new buildings |
| Research Costs | 40-250 | 40-800 | Extended progression |

---

## Part 1: Era Structure

| Era | Time Period | Research Cost | Theme |
|-----|-------------|---------------|-------|
| Ancient | -4000 to -500 | 40 | Free starting |
| Classical | -500 to 500 | 80 | Empires |
| Medieval | 500 to 1400 | 150 | Feudalism |
| Industrial | 1400 to 1700 | 250 | Gunpowder |
| **Renaissance** | 1700 to 1800 | 400 | Early modern firearms |
| **Enlightenment** | 1800 to 1850 | 600 | Industrial revolution |
| **Modern** | 1850 to 1880 | 800 | Rail & telegraph |

---

## Part 2: New Technologies (15 techs)

### Renaissance Era (400 pts)

```
MATCHLOCK: {GUNPOWDER}
  - Unlocks: MUSKETEER, ARQUEBUSIER, PINNACE
  - Bonus: +1 ranged damage

BASTION_FORT: {FORTIFICATION, GUNPOWDER}
  - Unlocks: CITADEL building
  - Bonus: +3 city defense

OCEAN_NAVIGATION: {CARTOGRAPHY, GUNPOWDER}
  - Unlocks: MAN_OF_WAR, GALLEASS, JUNK
  - Bonus: naval units +2 vision
```

### Enlightenment Era (600 pts)

```
FLINTLOCK: {MATCHLOCK}
  - Unlocks: LINE_INFANTRY, DRAGOON, CORVETTE
  - Bonus: infantry +1 attack

METALLURGY: {MATCHLOCK, MACHINERY}
  - Unlocks: CANNON, MORTAR, FROLIC
  - Bonus: siege units +2 siege power

ACADEMY: {MEDICINE, MATCHLOCK}
  - Unlocks: UNIVERSITY building
  - Bonus: research speed +25%

BANKING: {MASS_PRODUCTION}
  - Unlocks: BANK building, MERCHANTMAN
  - Bonus: +15% gold income
```

### Modern Era (800 pts)

```
RIFLED_MUSKET: {FLINTLOCK, METALLURGY}
  - Unlocks: RIFLEMAN, SHARPSHOOTER
  - Bonus: ranged units +1 range

STEAM_ENGINE: {METALLURGY, BANKING}
  - Unlocks: IRONCLAD, STEAM_TRANSPORT, GUNBOAT
  - Bonus: naval units +1 move

RAILROAD: {STEAM_ENGINE, ACADEMY}
  - Unlocks: RAILGUN, ARMORED_TRAIN
  - Bonus: units +1 move on roads

TELEGRAPH: {ACADEMY, BANKING}
  - Unlocks: COMMAND_POST building
  - Bonus: lords +2 command range

EXPLOSIVES: {METALLURGY, FLINTLOCK}
  - Unlocks: DEMOLITION_SQUAD, SIEGE_CANNON
  - Bonus: vs cities +3 damage

FIELD_ARTILLERY: {CANNON, RAILROAD}
  - Unlocks: FIELD_GUN, HORSE_ARTILLERY
  - Bonus: artillery +1 move

IRONCLADS: {STEAM_ENGINE, OCEAN_NAVIGATION}
  - Unlocks: IRONCLAD_FRIGATE, MONITOR, FRIGATE_2
  - Bonus: naval +2 HP

ELECTRICITY: {TELEGRAPH, ACADEMY}
  - Unlocks: POWER_PLANT building
  - Bonus: +20% production

SUBMARINE: {IRONCLADS, EXPLOSIVES}
  - Unlocks: SUBMARINE, TORPEDO_BOAT
  - Bonus: naval stealth
```

---

## Part 3: New Units (24 units)

### Land Units (18)

#### Renaissance Era Land
| Unit | HP | ATK | DEF | Move | Range | Cost | Special |
|------|-----|-----|-----|------|-------|------|---------|
| MUSKETEER | 14 | 8 | 4 | 2 | 2 | High | Volley fire: +1 ATK per adjacent friendly musketeer |
| ARQUEBUSIER | 12 | 7 | 3 | 2 | 2 | Medium | Slow reload: cannot attack turn after firing |

#### Enlightenment Era Land
| Unit | HP | ATK | DEF | Move | Range | Cost | Special |
|------|-----|-----|-----|------|-------|------|---------|
| LINE_INFANTRY | 16 | 9 | 5 | 2 | 2 | High | Formation: +2 DEF with 2+ adjacent infantry |
| DRAGOON | 14 | 8 | 4 | 3 | 2 | High | Hybrid: can charge (melee) or fire (ranged) |
| CANNON | 10 | 12 | 2 | 1 | 3 | Very High | Siege: +4 siege damage |
| MORTAR | 8 | 10 | 1 | 1 | 4 | High | AOE: 2-tile splash damage |

#### Modern Era Land
| Unit | HP | ATK | DEF | Move | Range | Cost | Special |
|------|-----|-----|-----|------|-------|------|---------|
| RIFLEMAN | 18 | 11 | 6 | 2 | 3 | Very High | Accurate: ignores 50% target defense |
| SHARPSHOOTER | 12 | 10 | 3 | 2 | 4 | Very High | Sniper: +3 vs lords/high-value targets |
| RAILGUN | 12 | 15 | 3 | 2 | 4 | Very High | Devastating: must reload 2 turns after firing |
| ARMORED_TRAIN | 25 | 10 | 8 | 3 | 3 | Very High | Mobile: can move and fire same turn |
| FIELD_GUN | 10 | 13 | 2 | 2 | 3 | Very High | Rapid fire: can attack twice per turn |
| HORSE_ARTILLERY | 10 | 12 | 2 | 3 | 3 | Very High | Fast deploy: 1-turn setup |
| DEMOLITION_SQUAD | 10 | 8 | 2 | 2 | 1 | High | Demolish: +5 vs cities/buildings |
| SIEGE_CANNON | 8 | 14 | 1 | 1 | 4 | Very High | Fort buster: destroys walls in 2 hits |

### Naval Units (6)

#### Renaissance Era Naval
| Unit | HP | ATK | DEF | Move | Range | Cost | Special |
|------|-----|-----|-----|------|-------|------|---------|
| MAN_OF_WAR | 35 | 12 | 8 | 3 | 3 | Very High | Flagship: +1 ATK to adjacent naval |
| GALLEASS | 25 | 10 | 6 | 3 | 3 | High | Oared: no coastal movement penalty |
| PINNACE | 18 | 7 | 4 | 4 | 2 | Medium | Scout: +2 vision, fast |

#### Enlightenment Era Naval
| Unit | HP | ATK | DEF | Move | Range | Cost | Special |
|------|-----|-----|-----|------|-------|------|---------|
| CORVETTE | 22 | 9 | 5 | 4 | 2 | High | Fast raider: +1 move, can pillage from sea |
| FROLIC | 30 | 11 | 7 | 3 | 3 | High | Broadside: can fire 2 tiles left/right |

#### Modern Era Naval
| Unit | HP | ATK | DEF | Move | Range | Cost | Special |
|------|-----|-----|-----|------|-------|------|---------|
| IRONCLAD | 40 | 14 | 10 | 3 | 3 | Very High | Armored: -50% ranged damage taken |
| STEAM_TRANSPORT | 20 | 2 | 6 | 4 | 1 | High | Capacity 4, immune to wind |
| GUNBOAT | 18 | 10 | 5 | 4 | 2 | High | Shallow draft: can enter rivers |
| IRONCLAD_FRIGATE | 45 | 15 | 12 | 3 | 3 | Very High | Heavy: -1 damage from all sources |
| MONITOR | 35 | 16 | 14 | 2 | 4 | Very High | Turret: no firing direction penalty |
| FRIGATE_2 | 38 | 13 | 9 | 4 | 3 | Very High | Fast: +1 move over standard frigate |
| SUBMARINE | 25 | 12 | 6 | 3 | 3 | Very High | Stealth: invisible when submerged |
| TORPEDO_BOAT | 15 | 18 | 3 | 4 | 2 | Very High | Devastating: +8 vs ships, fragile |

---

## Part 4: New Buildings (5 buildings)

| Building | Era | Cost | Terrain | Bonus | Special |
|----------|-----|------|---------|-------|---------|
| CITADEL | Renaissance | Gold: 120, Wood: 40, Iron: 30 | City | +8 defense | Upgrades Walls |
| UNIVERSITY | Enlightenment | Gold: 150, Wood: 60 | City | +3 research | Academic |
| BANK | Enlightenment | Gold: 200, Wood: 40 | City | +20 gold/turn | Economic |
| COMMAND_POST | Modern | Gold: 180, Wood: 50, Iron: 40 | City | +8 production | +2 lord command |
| POWER_PLANT | Modern | Gold: 250, Wood: 60, Iron: 50 | City | +12 production | Industrial |

---

## Part 5: Tech Bonus Keys

```javascript
// New bonus keys for getTechBonuses():
infantryAttackBonus: 0,
siegePowerBonus: 0,
researchSpeedBonus: 0,
goldIncomeBonus: 0,
rangedRangeBonus: 0,
navalMoveBonus: 0,
roadMoveBonus: 0,
lordCommandBonus: 0,
cityDamageBonus: 0,
artilleryMoveBonus: 0,
navalHpBonus: 0,
productionBonus: 0
```

---

## Part 6: Type Advantage Updates

```javascript
// New type advantages:
MUSKETEER:      { strongAgainst: 'CROSSBOWMAN', multiplier: 1.4 },
LINE_INFANTRY:  { strongAgainst: 'MUSKETEER', multiplier: 1.3 },
RIFLEMAN:      { strongAgainst: 'LINE_INFANTRY', multiplier: 1.4 },
CANNON:        { strongAgainst: 'MUSKETEER', multiplier: 1.5 },
MORTAR:        { strongAgainst: 'LINE_INFANTRY', multiplier: 1.5 },
IRONCLAD:      { strongAgainst: 'FRIGATE', multiplier: 1.6 },
MONITOR:       { strongAgainst: 'IRONCLAD', multiplier: 1.4 },
RAILGUN:       { strongAgainst: 'CANNON', multiplier: 1.5 },
SUBMARINE:     { strongAgainst: 'MAN_OF_WAR', multiplier: 1.5 },
TORPEDO_BOAT:  { strongAgainst: 'IRONCLAD', multiplier: 1.8 }
```

---

## Part 7: Unit Categories

```javascript
// Update EXTRA_UNITS:
EXTRA_UNITS = ['SETTLER', 'ENGINEER', 'WORKER', 'CAVALRY', 'CHARIOT', 'LONGBOWMAN',
  'CATAPHRACT', 'MEDIC', 'SIEGE_TOWER', 'LEGIONNAIRE', 'BERSERKER', 'VARANGIAN_GUARD',
  'CONQUISTADOR', 'WINGED_HUSSAR', 'CROSSBOWMAN',
  'MUSKETEER', 'ARQUEBUSIER', 'LINE_INFANTRY', 'DRAGOON', 'RIFLEMAN', 'SHARPSHOOTER',
  'RAILGUN', 'ARMORED_TRAIN', 'FIELD_GUN', 'HORSE_ARTILLERY', 'DEMOLITION_SQUAD', 'SIEGE_CANNON'];

// Update NAVAL_UNITS:
NAVAL_UNITS = ['GALLEY', 'TRANSPORT', 'FRIGATE', 'GALLEON',
  'MAN_OF_WAR', 'GALLEASS', 'PINNACE', 'CORVETTE', 'FROLIC',
  'IRONCLAD', 'STEAM_TRANSPORT', 'GUNBOAT', 'IRONCLAD_FRIGATE', 'MONITOR',
  'FRIGATE_2', 'SUBMARINE', 'TORPEDO_BOAT'];
```

---

## Part 8: Files to Modify

### A. `src/config.js`
1. Add 3 new era constants to ERA_ORDER
2. Add 24 new unit types to UNIT_TYPE
3. Add 24 new unit costs to UNIT_COST
4. Add 5 new building types to BUILDING_TYPE
5. Update TYPE_ADVANTAGE with new matchups
6. Update EXTRA_UNITS and NAVAL_UNITS arrays
7. Update PILLAGEABLE_BUILDINGS if needed

### B. `src/tech.js`
1. Add 15 new TECHS entries
2. Update ERA_ORDER array
3. Update ERA_NAMES object
4. Update getTechBonuses() bonus aggregation
5. Update autoSelectResearch() AI priorities

### C. `src/unit.js`
1. Add special behavior checks for new unit abilities

### D. `src/building.js`
1. Add CITADEL as WALLS upgrade
2. Implement new building construction

### E. `src/battle.js`
1. Integrate tech bonuses into damage calculation
2. Integrate unit special abilities

### F. `src/economy.js`
1. Integrate UNIVERSITY, BANK, POWER_PLANT bonuses

---

## Part 9: Implementation Order

### Phase 1: Era Constants (config.js)
### Phase 2: Unit Definitions (config.js)
### Phase 3: Tech Definitions (tech.js)
### Phase 4: Building Definitions (config.js)
### Phase 5: Unit Behaviors (unit.js)
### Phase 6: Building Logic (building.js)
### Phase 7: Combat Integration (battle.js)
### Phase 8: Economy Integration (economy.js)
### Phase 9: Verification (tests)
### Phase 10: Documentation
