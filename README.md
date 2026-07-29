<div align="center">

```
 ██████  ██████  ███    ██  ██████  ██    ██ ███████ ███████ ████████
██      ██    ██ ████   ██ ██       ██  ██  ██         ██       ██
██      ██    ██ ██ ██  ██ ██        ████   █████      ██       ██
██      ██    ██ ██  ██ ██ ██         ██    ██         ██       ██
 ██████  ██████  ██   ████  ██████    ██    ███████    ██       ██
```

# ⚔ Conquest

### A browser-based turn-based 4X strategy game built with Three.js

<strong>Found cities · Raise armies · Recruit hero lords · Research tech · Wage war · Forge alliances</strong>

<br>

[![Factions](https://img.shields.io/badge/factions-15-8a2be2?style=flat-square)](src/config.js)
[![Tests](https://img.shields.io/badge/tests-1274-2ea44f?style=flat-square)](tests/)
[![Coverage](https://img.shields.io/badge/source-25.7k_lines-0366d6?style=flat-square)](src/)
[![Commits](https://img.shields.io/badge/commits-109-ff6f00?style=flat-square)](https://github.com/Andrewzekid/conquest_game/commits/master)
[![Engine](https://img.shields.io/badge/engine-Three.js-8e44ad?style=flat-square)](https://threejs.org)
[![Test Runner](https://img.shields.io/badge/test-vitest-fcc72b?style=flat-square)](https://vitest.dev)

</div>

---

## 🎮 Play

The game runs entirely in the browser. Native ES modules require HTTP serving:

```bash
# Option 1 — Python server with filesystem saves (recommended)
python3 server.py 8000

# Option 2 — Static server (saves use localStorage)
python3 -m http.server 8000

# Option 3 — Node
npx serve .
```

Open <http://localhost:8000>, pick a faction + map size from the start menu, and play.
The **Spectate** checkbox lets you watch AI-only games with a live multi-panel debug UI.

---

## 🌍 Game Overview

<table>
<tr>
<td width="50%">

### 🏛 Lead a Faction
Choose from **15 thematic factions**, each with a unique unit roster, passive economic/military bonuses, a king ability, and an AI personality. From the Crimson Legion and Golden Horde to the Roman Legion, Viking Raiders, and Polish Winged Hussars.

</td>
<td width="50%">

### 🗺 Procedural World
Every game generates **2–4 irregular continents** with meandering rivers, mountain ranges with carved passes, varied biomes, and Natural Wonders. Choose from 6 map sizes (Tiny → Epic).

</td>
</tr>
<tr>
<td width="50%">

### ⚔️ 4X Core Loop
**eXplore** the fog of war · **eXpand** by founding and conquering cities · **eXploit** resources through workers and trade routes · **eXterminate** rivals with combined-arms warfare.

</td>
<td width="50%">

### 🏆 Four Victory Paths
**Domination** — eliminate all rivals · **Science** — complete the space program · **Economic** — accumulate gold and trade routes · **Score** — highest score by turn 200

</td>
</tr>
</table>

---

## ⚙️ Features

### 🏔 Map & Terrain
| Feature | Detail |
|---------|--------|
| Layout | Irregular continents, rivers, mountain passes, biomes, Natural Wonders |
| Sizes | Tiny (400 tiles, 3 players) → Epic (6000 tiles, 10 players) |
| Generation | Heightmap-based with erosion simulation, flood-fill cleanup, strategic resource placement |

### 🏙 Economy & Cities
| Feature | Detail |
|---------|--------|
| Citizens | Civ-style tile working — cities grow and level up when well-fed |
| Buildings | FARMs, LUMBERMILLs, MINEs, MARKETs, Barracks, Siege Workshops, Harbors, Walls, Libraries, Research Institutes |
| Improvements | Workers build roads, bridges, forts, and terrain improvements |
| Trade Routes | Connect cities for income — enemy units can raid and disrupt them |
| Resource System | Gold, food, wood, iron, production with scarcity-aware AI spending |

### ⚔️ Combat System
| Mechanic | Description |
|----------|-------------|
| Type advantages | Strong vs weak matchups (e.g., anti-cavalry vs cavalry) |
| Charge mechanics | Cavalry & chariots deal bonus damage on first strike |
| Ranged bombardment | Archers, artillery, siege units attack from distance |
| AOE splash | Siege units (catapults, trebuchets, cannon) damage multiple tiles |
| Concealment & ambush | Units hide in forests and mountains for surprise attacks |
| Encirclement | Surrounding a unit grants combat bonuses |
| Fortifications | Bunkers, forts, mines, spikes — buildable defensive structures |
| Engineers | Build siege towers, repair, construct battlefield defenses |
| River crossings | Penalty for attacking across unbridged rivers |
| Modern warfare | Armor, anti-armor RPGs, mobilized infantry, combat engineers |

### 👑 Lords & Kings
| Feature | Detail |
|---------|--------|
| Hero lords | Recruitable units with 4 classes, stats, abilities, and skill trees |
| Skill trees | Warlord / Guardian / Conqueror / Grand Commander — 2 branches, 5 tiers each |
| King mechanics | Your king leads from the front; losing them is catastrophic |
| Army command | Lords lead army groups; their bonuses apply to nearby troops |

### 🕵️ Espionage
| Feature | Detail |
|---------|--------|
| Spy actions | Gather intel, sabotage production, assassinate units, incite unrest |
| Detection | Spies have detection chances based on the target's counters |
| Consequences | Failed spy actions damage diplomatic relations |

### 🤝 Diplomacy
| Feature | Detail |
|---------|--------|
| Relations | Tracked per pair; grievances drive war declarations |
| Treaties | Non-aggression pacts, ceasefires, alliances, trade pacts |
| Peace deals | Negotiate with demands for gold, tribute, territory |
| Coalition wars | Invite allies into a joint war with shared diplomatic fallout |

### 🏛 Technology
| Feature | Detail |
|---------|--------|
| Tech tree | Single-track research from Ancient → Atomic era |
| Unlocks | New units, buildings, structures, and abilities |
| Obsolescence | Older units auto-upgrade when their replacement is researched |
| Science victory | Build space program components after researching rocketry |

---

## 🤖 AI System

The AI runs **every faction's turn autonomously** with a multi-layered decision architecture. Below is a breakdown of the major subsystems:

### 🎯 Goal System (`src/ai_goals.js`)

Persistent goal sequences that drive faction behavior across turns:

| Goal Type | Behavior |
|-----------|----------|
| **Conquest** | Pick a target city, build an army, capture it, consolidate |
| **Settle** | Find unclaimed land, ferry settlers overseas if needed |
| **Develop Economy** | Build improvements, grow cities, establish trade routes |
| **Tech Rush** | Prioritize research buildings, fund science |
| **Decisive Battle** | Seek out and destroy enemy army concentrations |
| **Spy** | Train and deploy spies against a specific rival |
| **Victory Pursuit** | Shift strategy based on nearest victory condition |

Goals have stability checks — the AI doesn't abandon a goal on every setback.

### 🏘 Theater System (`src/ai_theater.js`)

Geographic command that prevents the AI from idling troops on one continent while another is under attack:

- **Per-landmass theaters** — one theater per continent where the faction has cities
- **Dynamic urgency** — 75% active threat (enemy units on the ground) + 25% latent threat (hostile transport ships off the coast)
- **Theater budgets** — production resources split by urgency × city count
- **Cross-theater ferries** — quiet theaters donate troops to threatened theaters via naval transport
- **Garrison quotas** — each theater keeps only enough groups for local defense; surplus attacks or embarks

### 🗺 Strategic Planning (`src/ai_army_plan.js`)

High-level military coordination:

- **Strategic target selection** — scores enemy cities by reachable power, weakness, distance, capital status, and goal alignment
- **Beachhead landing engine** — scans coastal terrain for safe disembarkation tiles with minimal enemy proximity
- **Staging area coordination** — groups form up 2–4 tiles behind the beachhead before committing
- **Siege/screen role split** — when 2+ groups target the same city, the strongest sieges while others guard the perimeter
- **Flanking detection** — groups approaching from opposite angles (>90°) get complementary assault/flank assignments
- **Inter-group reinforcement** — troubled groups receive help from nearby healthy groups; retreat when outmatched

### 🚢 Naval Groups (`src/ai.js`)

Ships are clustered into tactical fleet groups with defined roles:

| Role | Behavior |
|------|----------|
| **amphibious** | Transport + escort pair — escorted flotilla for troop delivery |
| **transport** | Unescorted transport — sails after 5-turn wait if no escort found |
| **besiege** | Warships near an enemy coast — blockade harbors, shell cities |
| **defend** | Warships near friendly coast — intercept incoming enemies |
| **strike** | Roaming war fleet — hunts enemy ships, sails toward enemy shores |

Groups are rebuilt every turn from scratch (dynamic re-clustering ensures ships re-group as they move).

### 🐜 Per-Unit Tactics (`src/ai.js`)

Individual units execute the group plan with tactical awareness:

- **Step targeting** — path toward objectives avoiding friendly stacks and claimed tiles
- **Combat evaluation** — `isFavorableAttack` simulates the fight (type advantages, terrain, lords, encirclement) before committing
- **Escort timeout** — transports wait up to 5 turns for a warship escort before sailing unescorted into dangerous waters
- **Retreat logic** — groups pull back to the nearest friendly city when locally outmatched
- **Defensive structures** — engineers build forts, bunkers, minefields, and anti-tank mines
- **Siege tower construction** — engineers build mobile towers to breach city walls

### 📊 Debug Panels

Spectate mode includes HTML-based debug panels:

| Panel | Shows |
|-------|-------|
| **AI Goals** | Each faction's active goal, stability, target tile, and sub-steps |
| **Army Groups** | Land army groups (lord, stance, objective, power, composition) + naval fleet groups |
| **Theater Info** | Per-theater urgency, garrison needs, ferry plans |
| **Recent Actions** | Last 12 significant actions (train, build, capture) per faction |

---

## 🧪 Testing

```bash
npm test              # vitest run (one-shot, 1274 tests)
npm run test:watch    # watch mode
```

Test architecture:
- **Pure-logic tests** — `ai.test.js`, `battle.test.js`, `diplomacy.test.js`, `economy.test.js`, `lords.test.js`, `map.test.js`, `path.test.js`, `tech.test.js`, `unit.test.js`, and 56 more
- **Scenario tests** — `ai-scenarios.test.js`, `ai-goal-scenarios.test.js`, `ai-siege-escort.test.js`, `ai-tech-harbor-conquest.test.js`
- **Integration tests** — `ai-integration.test.js`, `ai-phases-integration.test.js`, `ai-reachability-infrastructure.test.js`
- **Invariant tests** — DOM-bound modules covered by source-structure assertions
- **Regression tests** — `bugfixes-engineer-king-water.test.js`, `zero-hp-death.test.js`, `nan-hp-stress.test.js`

---

## 🏗 Project Layout

```
src/
├── game.js              # Integrator (class Game) — the god object
├── config.js            # All tunable constants, unit/terrain/faction data
│
├── ai.js                # AI turn computation + army groups + naval groups
├── ai_goals.js          # Persistent AI goal sequences
├── ai_theater.js        # Theater system (urgency, budgets, ferries)
├── ai_army_plan.js      # Strategic planning (targets, beachheads, flanks)
├── ai_debug_ui.js       # Debug panel builder
│
├── economy.js           # Resources, trade routes, unrest
├── diplomacy.js         # Relations, treaties, coalitions, peace
├── lords.js             # Hero units + skill trees
├── battle.js            # Combat resolution
├── unit.js              # Unit costs, attack targets
├── building.js          # Building state management
│
├── map.js               # Procedural generation, passes, influence
├── renderer.js          # Three.js 3D rendering
├── ui.js                # DOM UI controller
├── ui_data.js           # Victory progress + UI state
│
├── path.js              # A*/BFS pathfinding
├── tech.js              # Tech tree + unlocking
├── fog.js               # Fog of war
├── spy.js               # Espionage system
├── eventlog.js          # Game event log
├── difficulty.js        # Difficulty presets
│
├── unit_obsolescence.js # Tech-driven unit upgrades
└── faction.js           # Faction definitions

tests/                   # 64 Vitest suites (1274 tests)
index.html               # Entry point + inline styles
```

---

## 💾 Save System

| Server | Save Target | Load Method |
|--------|-------------|-------------|
| `server.py` (Python) | `saves/conquest_save.json` on disk | GET `/api/load` |
| Static HTTP server | `localStorage` | Browser local storage |

Save format is versioned (currently v7). Incompatible older saves are rejected with a clear message.

---

## 🛠 Tech Stack

| Layer | Technology |
|-------|-----------|
| **Rendering** | Three.js (r160) via importmap — no bundler |
| **Modules** | Native ES modules (`"type": "module"`) |
| **Architecture** | `class Game` integrator backed by pure-logic modules that never import the DOM |
| **Testing** | Vitest — runs in Node, no DOM/WebGL required |
| **Distribution** | 31 source files, 25,654 lines, zero dependencies beyond Three.js |

---

<div align="center">
<sub><strong>Conquest</strong> · Browser-based 4X strategy · 15 factions · 64 test suites · 109 commits</sub>
</div>
