# Implementation Plan: 5 New European Factions + Tech-Tree Units

## Overview

| Component | Current | After | Change |
|-----------|---------|-------|--------|
| Factions | 10 | 15 | +5 European factions |
| Unit types | 22 | 28 | +6 new units |
| Tech tree | 16 techs | 16 techs | Modified unlocks (no new techs) |
| Save version | 4 | 5 | Backward-compatible bump |

---

## Part 1: New Units (6 units)

### 1. LEGIONNAIRE
- **Era:** Ancient
- **Unlocked by:** BRONZE_WORKING
- **Stats:** HP: 14, ATK: 4, DEF: 5, Move: 1
- **Ranged:** No, Range: 1
- **Upkeep:** food: 4, gold: 3
- **Special:** Can build fortifications on owned tiles (like Engineer but combat-capable)
- **Role:** Heavy infantry tank — slow but very durable

### 2. BERSERKER
- **Era:** Medieval
- **Unlocked by:** CHIVALRY
- **Stats:** HP: 12, ATK: 9, DEF: 1, Move: 2
- **Ranged:** No, Range: 1
- **Upkeep:** food: 3, gold: 4
- **Special:** +3 attack when below 50% HP (frenzy bonus). Cannot be healed by Medics.
- **Role:** Glass cannon melee — high risk, high reward

### 3. VARANGIAN_GUARD
- **Era:** Medieval
- **Unlocked by:** FORTIFICATION
- **Stats:** HP: 16, ATK: 6, DEF: 6, Move: 2
- **Ranged:** No, Range: 1
- **Upkeep:** food: 4, gold: 5, iron: 1
- **Special:** +2 defense when adjacent to a friendly lord. Immune to morale effects.
- **Role:** Elite bodyguard unit — strongest when protecting lords

### 4. CONQUISTADOR
- **Era:** Industrial
- **Unlocked by:** GUNPOWDER
- **Stats:** HP: 10, ATK: 7, DEF: 3, Move: 3
- **Ranged:** Yes, Range: 2
- **Upkeep:** food: 3, gold: 6, iron: 1
- **Special:** Mounted gunpowder unit. +2 attack vs. units in cities.
- **Role:** Mobile ranged assault — siege specialist on horseback

### 5. WINGED_HUSSAR
- **Era:** Medieval
- **Unlocked by:** CHIVALRY
- **Stats:** HP: 18, ATK: 8, DEF: 4, Move: 3
- **Ranged:** No, Range: 1
- **Upkeep:** food: 5, gold: 6, iron: 2
- **Special:** Charge attack deals 2x damage on first attack each turn. +1 move on open terrain.
- **Role:** Devastating shock cavalry — alpha strike specialist

### 6. CROSSBOWMAN
- **Era:** Medieval
- **Unlocked by:** FORTIFICATION
- **Stats:** HP: 10, ATK: 7, DEF: 2, Move: 1
- **Ranged:** Yes, Range: 3
- **Upkeep:** food: 3, gold: 5, wood: 2
- **Special:** None (straightforward upgrade to Archer)
- **Role:** Long-range infantry — better Archer with longer range

### Unit Stat Comparison Table

| Unit | HP | ATK | DEF | Move | Range | Cost Tier | Special |
|------|-----|-----|-----|------|-------|-----------|---------|
| INFANTRY (existing) | 10 | 3 | 2 | 2 | 1 | Low | — |
| LEGIONNAIRE (new) | 14 | 4 | 5 | 1 | 1 | Medium | Build fortifications |
| ARCHER (existing) | 8 | 4 | 1 | 2 | 2 | Low | — |
| CROSSBOWMAN (new) | 10 | 7 | 2 | 1 | 3 | Medium | Longer range |
| CAVALRY (existing) | 12 | 5 | 3 | 3 | 1 | Medium | — |
| WINGED_HUSSAR (new) | 18 | 8 | 4 | 3 | 1 | High | 2x charge damage |
| PIKEMAN (existing) | 12 | 4 | 4 | 2 | 1 | Low | — |
| BERSERKER (new) | 12 | 9 | 1 | 2 | 1 | Medium | Frenzy at low HP |
| CATAPHRACT (existing) | 16 | 6 | 5 | 2 | 1 | High | — |
| VARANGIAN_GUARD (new) | 16 | 6 | 6 | 2 | 1 | High | +2 def near lords |
| ARTILLERY (existing) | 6 | 7 | 0 | 1 | 2 | High | Siege bonus |
| CONQUISTADOR (new) | 10 | 7 | 3 | 3 | 2 | High | +2 vs. cities |

---

## Part 2: New Factions (5 European factions)

### 1. Roman Legion 🏛️ (`roman`)
- **Color:** `{ tile: 0xb87333, unit: 0xdd9944, name: 'Roman Legion' }`
- **AI Personality:** `AGGRESSIVE`
- **Roster:** `['INFANTRY', 'PIKEMAN', 'SIEGE', 'LEGIONNAIRE']`
- **unitMods:**
  - `INFANTRY: { defense: 1, hp: 2 }`
  - `LEGIONNAIRE: { defense: 1 }`
  - `SIEGE: { costGoldMult: 0.85 }`
- **Passive:** `{ attackBonus: 1, cityCaptureBonus: 1, desc: '+1 attack to all units. +1 damage when capturing cities.' }`
- **King:**
  - Name: `'Consul Marcus'`
  - Class: `'WARLORD'`
  - Active: `{ id: 'discipline', name: 'Discipline', cooldown: 4, desc: '+3 attack and +2 defense to all units for the rest of this turn.' }`

### 2. Viking Raiders ⚔️ (`viking`)
- **Color:** `{ tile: 0x4a6a8a, unit: 0x88bbdd, name: 'Viking Raiders' }`
- **AI Personality:** `AGGRESSIVE`
- **Roster:** `['INFANTRY', 'CAVALRY', 'SCOUT', 'BERSERKER']`
- **unitMods:**
  - `INFANTRY: { attack: 1 }`
  - `BERSERKER: { hp: 2 }`
  - `SCOUT: { attack: 1 }`
- **Passive:** `{ healOnKill: 3, raidingGoldBonus: 10, desc: 'Units heal 3 HP on kill. Raiding/pillaging gives +10 gold.' }`
- **King:**
  - Name: `'jarl Ragnar'`
  - Class: `'WARLORD'`
  - Active: `{ id: 'berserker_rage', name: 'Berserker Rage', cooldown: 4, desc: 'All BERSERKER and INFANTRY units gain +4 attack and lifesteal (heal 50% of damage dealt) this turn.' }`

### 3. Byzantine Empire 🦅 (`byzantine`)
- **Color:** `{ tile: 0x7b2d8b, unit: 0xaa55cc, name: 'Byzantine Empire' }`
- **AI Personality:** `DEFENSIVE`
- **Roster:** `['INFANTRY', 'ARCHER', 'CAVALRY', 'VARANGIAN_GUARD']`
- **unitMods:**
  - `CAVALRY: { defense: 2, hp: 2 }`
  - `VARANGIAN_GUARD: { defense: 1 }`
  - `ARCHER: { attack: 1 }`
- **Passive:** `{ diplomacyBonus: 10, fortifiedDefenseBonus: 2, desc: '+10 starting reputation with all factions. Fortified units gain +2 defense.' }`
- **King:**
  - Name: `'Emperor Constantine'`
  - Class: `'GUARDIAN'`
  - Active: `{ id: 'golden_gate', name: 'Golden Gate', cooldown: 5, desc: 'All cities gain +5 fortification. All units heal to full HP.' }`

### 4. Spanish Conquistadors 🗡️ (`spanish`)
- **Color:** `{ tile: 0xc9302c, unit: 0xff5544, name: 'Spanish Conquistadors' }`
- **AI Personality:** `AGGRESSIVE`
- **Roster:** `['INFANTRY', 'CAVALRY', 'ARCHER', 'CONQUISTADOR']`
- **unitMods:**
  - `CONQUISTADOR: { attack: 1, hp: 2 }`
  - `CAVALRY: { attack: 1 }`
  - `INFANTRY: { defense: 1 }`
- **Passive:** `{ settlerCostReduction: 0.3, goldPerConquest: 25, desc: 'Settlers cost 30% less. Gain 25 gold when conquering a city.' }`
- **King:**
  - Name: `'King Ferdinand'`
  - Class: `'CONQUEROR'`
  - Active: `{ id: 'manifest_destiny', name: 'Manifest Destiny', cooldown: 5, desc: 'All CONQUISTADOR units gain +2 move and double attack range this turn. Cities produce a free Settler if you have fewer than 3 cities.' }`

### 5. Polish Winged Hussars 🐎 (`polish`)
- **Color:** `{ tile: 0xdc143c, unit: 0xff6b6b, name: 'Polish Winged Hussars' }`
- **AI Personality:** `AGGRESSIVE`
- **Roster:** `['INFANTRY', 'PIKEMAN', 'CAVALRY', 'WINGED_HUSSAR']`
- **unitMods:**
  - `WINGED_HUSSAR: { attack: 2, moveRange: 1 }`
  - `CAVALRY: { attack: 1, moveRange: 1 }`
  - `PIKEMAN: { defense: 1 }`
- **Passive:** `{ cavalryChargeBonus: 2, openTerrainMoveBonus: 1, desc: 'Cavalry charge deals +2 bonus damage. All units gain +1 move on open terrain.' }`
- **King:**
  - Name: `'King Jan Sobieski'`
  - Class: `'WARLORD'`
  - Active: `{ id: 'winged_charge', name: 'Winged Charge', cooldown: 4, desc: 'All cavalry and WINGED_HUSSAR units charge this turn (free charge attacks on adjacent enemies, +3 bonus damage).' }`

---

## Part 3: Tech Tree Modifications

No new techs are added. Existing techs get additional unit unlocks.

### Updated TECHS Unlocks

| Tech | Era | Existing Unlocks | New Unlocks |
|------|-----|------------------|-------------|
| BRONZE_WORKING | Ancient | PIKEMAN | + LEGIONNAIRE |
| MATHEMATICS | Classical | CATAPULT, MARKET | — (no change) |
| CHIVALRY | Medieval | CATAPHRACT, CHARIOT | + BERSERKER, WINGED_HUSSAR |
| FORTIFICATION | Medieval | WALLS | + CROSSBOWMAN, VARANGIAN_GUARD |
| GUNPOWDER | Industrial | ARTILLERY | + CONQUISTADOR |
| MEDICINE | Industrial | MEDIC | — (no change) |

### New Tech Tree Visual

```
ANCIENT (free):
  ARCHERY → ARCHER, LONGBOWMAN
  BRONZE_WORKING → PIKEMAN, LEGIONNAIRE
  ANIMAL_HUSBANDRY → CAVALRY

CLASSICAL (80 pts):
  MATHEMATICS (requires ARCHERY) → CATAPULT, MARKET
  ENGINEERING (requires BRONZE_WORKING) → bonuses
  NAVAL_ENGINEERING (requires ANIMAL_HUSBANDRY) → HARBOR, GALLEY, TRANSPORT
  SIEGE_CRAFT (requires BRONZE_WORKING + MATHEMATICS) → SIEGE_WORKSHOP, TREBUCHET

MEDIEVAL (150 pts):
  FORTIFICATION (requires ENGINEERING) → WALLS, CROSSBOWMAN, VARANGIAN_GUARD
  CHIVALRY (requires MATHEMATICS + ANIMAL_HUSBANDRY) → CATAPHRACT, CHARIOT, BERSERKER, WINGED_HUSSAR
  CARTOGRAPHY (requires NAVAL_ENGINEERING) → FRIGATE, GALLEON
  FEUDALISM (requires SIEGE_CRAFT) → SIEGE_TOWER

INDUSTRIAL (250 pts):
  GUNPOWDER (requires SIEGE_CRAFT + CHIVALRY) → ARTILLERY, CONQUISTADOR
  MEDICINE (requires FEUDALISM) → MEDIC
  MACHINERY (requires ENGINEERING + FORTIFICATION) → WORKER
  MASS_PRODUCTION (requires CARTOGRAPHY + MEDICINE) → bonuses
```

---

## Part 4: Files to Modify

### A. `src/config.js`
1. Increase `MAX_FACTIONS` from 10 → 15
2. Add `FACTION_COLORS` entries for `ai10` through `ai14`:
   ```js
   ai10: { tile: 0xb87333, unit: 0xdd9944, name: 'Roman Legion' },
   ai11: { tile: 0x4a6a8a, unit: 0x88bbdd, name: 'Viking Raiders' },
   ai12: { tile: 0x7b2d8b, unit: 0xaa55cc, name: 'Byzantine Empire' },
   ai13: { tile: 0xc9302c, unit: 0xff5544, name: 'Spanish Conquistadors' },
   ai14: { tile: 0xdc143c, unit: 0xff6b6b, name: 'Polish Winged Hussars' }
   ```
3. Add `FACTION_CITY_NAMES` entries for roman, viking, byzantine, spanish, polish
4. Add 6 new unit types to `UNIT_TYPE`:
   - LEGIONNAIRE
   - BERSERKER
   - VARANGIAN_GUARD
   - CONQUISTADOR
   - WINGED_HUSSAR
   - CROSSBOWMAN
5. Add new units to `EXTRA_UNITS` array

### B. `src/faction.js`
1. Add 5 new entries to `FACTION_DEFS`:
   - roman, viking, byzantine, spanish, polish
2. Add `'frost'` and 5 new faction ids to `FACTION_SLOT_MAP`
3. Add helper functions for new passive types:
   - `getHealOnKill(def)` → for Viking
   - `getRaidingGoldBonus(def)` → for Viking
   - `getDiplomacyBonus(def)` → for Byzantine
   - `getFortifiedDefenseBonus(def)` → for Byzantine
   - `getGoldPerConquest(def)` → for Spanish
   - `getCavalryChargeBonus(def)` → for Polish
   - `getOpenTerrainMoveBonus(def)` → for Polish
   - `getCityCaptureBonus(def)` → for Roman
4. Update `getUnitStatsFor` to handle new passive-driven stat modifiers

### C. `src/tech.js`
1. Update unlocks in 6 existing TECHS entries:
   - BRONZE_WORKING: add `{ type: 'unit', id: 'LEGIONNAIRE' }`
   - CHIVALRY: add `{ type: 'unit', id: 'BERSERKER' }` and `{ type: 'unit', id: 'WINGED_HUSSAR' }`
   - FORTIFICATION: add `{ type: 'unit', id: 'CROSSBOWMAN' }` and `{ type: 'unit', id: 'VARANGIAN_GUARD' }`
   - GUNPOWDER: add `{ type: 'unit', id: 'CONQUISTADOR' }`

### D. `src/unit.js`
1. Add special behavior for BERSERKER frenzy (check HP < 50% in combat calculation)
2. Add special behavior for VARANGIAN_GUARD adjacency bonus
3. Add special behavior for WINGED_HUSSAR charge multiplier
4. Add special behavior for CONQUISTADOR city attack bonus

### E. `src/battle.js`
1. Integrate BERSERKER frenzy bonus into damage calculation
2. Integrate VARANGIAN_GUARD adjacency defense bonus
3. Integrate WINGED_HUSSAR charge multiplier
4. Integrate CONQUISTADOR city attack bonus
5. Integrate Roman city capture bonus
6. Integrate Viking heal-on-kill

### F. `src/game.js`
1. Update default AI faction list in `_buildFactionBindings` to include the 5 new factions
2. Update `initState` starting units if any faction needs different starting units
3. Integrate new passive effects into relevant game systems

### G. `src/save.js`
1. Bump `SAVE_VERSION` from 4 → 5
2. Add backward compatibility: `|| []` fallbacks for new unit categories

### H. `src/ui.js`
1. Add new unit names/icons to the build menu display
2. Ensure the tech research panel shows newly unlocked units

### I. `index.html`
1. Add new unit icons to the icon sprite sheet (if icons exist)

### J. Tests
1. Update `tests/config.test.js` to validate new unit types and faction constants
2. Update `tests/faction.test.js` to validate new faction definitions
3. Update `tests/tech.test.js` to validate new tech unlocks
4. Add `tests/new-factions.test.js` for faction-specific mechanics
5. Add `tests/new-units.test.js` for unit stat validation

---

## Part 5: Implementation Order

### Phase 1: Unit Definitions
1. `src/config.js` — add 6 new unit types to `UNIT_TYPE`
2. `src/unit.js` — add special unit behaviors

### Phase 2: Tech Integration
3. `src/tech.js` — update 6 existing tech entries with new unlocks

### Phase 3: Faction Definitions
4. `src/faction.js` — add 5 new `FACTION_DEFS` entries
5. `src/faction.js` — update `FACTION_SLOT_MAP`
6. `src/faction.js` — add new passive helper functions

### Phase 4: Config Expansion
7. `src/config.js` — increase `MAX_FACTIONS` to 15
8. `src/config.js` — add `FACTION_COLORS` for ai10-ai14
9. `src/config.js` — add `FACTION_CITY_NAMES` for new factions

### Phase 5: Game Logic
10. `src/battle.js` — integrate new unit combat bonuses
11. `src/game.js` — update default AI list
12. `src/game.js` — integrate new passive effects

### Phase 6: Persistence & UI
13. `src/save.js` — bump version, add fallbacks
14. `src/ui.js` — display new units in menus

### Phase 7: Verification
15. Run `node -c` on all modified files
16. Run `npx vitest run` — fix any failures
17. Add new test files for factions and units

### Phase 8: Commit
18. Commit all changes

---

## Part 6: Balance Considerations

### Power Budget by Faction
- **Roman:** +1 attack (offensive) + city capture bonus → strong in conquest
- **Viking:** heal on kill + raiding gold → snowball via combat
- **Byzantine:** diplomacy bonus + fortified defense → strong in diplomacy/defense
- **Spanish:** cheaper settlers + conquest gold → expansionist/economic
- **Polish:** cavalry charge bonus + open terrain move → mobile shock warfare

### Counter-play
- Roman vs. Viking: Roman's discipline vs. Viking's frenzy — disciplined formation beats individual berserkers
- Byzantine vs. Polish: Fortified defense negates cavalry charge — Byzantines turtle, Poles must find open ground
- Spanish vs. Roman: Spanish economic advantage vs. Roman military — economic victory vs. domination
- Viking vs. Byzantine: Viking aggression vs. Byzantine defense — raiders can't break fortified positions easily

### Unit Cost Scaling
| Unit | Cost Tier | Compared To |
|------|-----------|-------------|
| LEGIONNAIRE | Medium | Slightly more than Infantry |
| BERSERKER | Medium | Similar to Pikeman |
| VARANGIAN_GUARD | High | Similar to Cataphract |
| CONQUISTADOR | High | Similar to Artillery |
| WINGED_HUSSAR | High | More than Cavalry |
| CROSSBOWMAN | Medium | More than Archer |

---

## Part 7: Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| New units break combat balance | Medium | High | Extensive testing with different faction matchups |
| Save compatibility issues | Low | High | Version bump + fallbacks in loadGame |
| Tech tree becomes too complex | Low | Medium | Only modifying existing techs, not adding new ones |
| AI doesn't use new units effectively | Medium | Medium | AI roster selection is slot-based; new units auto-available |
| UI doesn't display new units properly | Low | Medium | Check unit name/icon mapping in ui.js |

---

## Part 8: Testing Strategy

### Unit Tests
- Validate all 6 new unit types in `UNIT_TYPE` have required fields
- Validate unit stat calculations with faction mods
- Validate tech unlock integration

### Faction Tests
- Validate all 5 new faction definitions have required fields
- Validate passive effects trigger correctly
- Validate king abilities have correct structure

### Integration Tests
- Validate new factions can be assigned to slots
- Validate save/load with new units and factions
- Validate tech tree progression with new unlocks

### Manual Testing
- Playtest each new faction for 10+ turns
- Test combat between new units and existing units
- Test victory conditions still work
