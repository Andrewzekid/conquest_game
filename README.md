# Conquest

A browser-based turn-based 4X strategy game built with **Three.js** and ES
modules. Found cities, raise armies, recruit hero lords, research a tech tree,
wage war and forge alliances against up to 14 AI rivals — across a procedurally
generated world of continents, rivers, mountains, and passes.

![factions](https://img.shields.io/badge/factions-15-blue) ![tests](https://img.shields.io/badge/tests-593-brightgreen) ![engine](https://img.shields.io/badge/engine-Three.js-black)

---

## Play

The game runs entirely in the browser. Because it uses native ES modules, it
needs to be served over HTTP (opening `index.html` directly via `file://` won't
load the modules). Any static server works:

```bash
# Option 1 — Python's built-in server
python3 -m http.server 8000

# Option 2 — Node
npx serve .
```

Then open <http://localhost:8000> and pick a faction + map size from the start
menu. A **Spectate** checkbox lets you watch AI-only games (with a live AI-goals
debug panel).

---

## What it is

You lead one of 15 thematic factions on a hex-free tile grid rendered in 3D.
Each turn you collect resources, move units, fight battles, build improvements,
negotiate with neighbors, and push toward one of four victory conditions. The
AI runs its own turns with persistent goals, personalities, and a resource-aware
economy — so the world feels alive whether you're playing or spectating.

### Core loop

- **Economy** — Cities work surrounding tiles (Civ-style citizens). Build
  FARMs, LUMBERMILLs, MINEs, MARKETs, and military buildings. Cities grow and
  level up automatically when well-fed.
- **Military** — Train infantry, archers, cavalry, siege, and faction-unique
  units; board transports and cross the sea; besiege and assault walled cities.
- **Lords & kings** — Recruit hero lords with classes, stats, abilities, and a
  full skill tree. Your king leads from the front; losing them is catastrophic.
- **Diplomacy** — Directed grievances drive war declarations; sign NAPs,
  ceasefires, and alliances; trade materials; negotiate peace with demands
  (gold, tribute, territory); form coalition wars with allies.
- **Tech** — A single-track research tree unlocks new units and buildings.
- **Victory** — Domination (eliminate rivals), Science (complete the space
  program), Economic (gold + trade routes), or Score (highest at turn 200).

---

## Features

- **15 factions**, each with a unique roster, passive bonuses, king ability,
  and AI personality (Aggressive / Defensive / Economic / Balanced). From the
  Crimson Legion and Golden Horde to the Roman Legion, Viking Raiders,
  Byzantine Empire, Spanish Conquistadors, and Polish Winged Hussars.
- **Procedural maps** — 2–4 irregular continents, meandering rivers, mountain
  ranges with carved **passes**, biomes, and Natural Wonders. Small / Medium /
  Large sizes.
- **Combat depth** — type advantages, charge mechanics (cavalry & chariots),
  ranged bombardment, AOE siege with fire, concealment & ambushes,
  encirclement, counter-attacks, fortifications, and river-crossing penalties.
- **City unrest & loyalty** — conquered cities rebel if under-garrisoned; decay
  over time or flip back to a high-influence neighbor.
- **Trade routes** — connect cities for income; enemy units raid and disrupt
  them. Counts toward the Economic victory.
- **Lord skill trees** — four classes (Warlord / Guardian / Conqueror / Grand
  Commander), two branches each, five tiers; spend level-up points.
- **Spy system** — train spies to gather intel, sabotage, assassinate, or
  incite unrest, with detection chances and relationship penalties.
- **Coalition wars** — invite allies into a joint war; share the diplomatic
  fallout.
- **Difficulty presets** — Easy / Normal / Hard / Brutal scale AI economy,
  upkeep, aggression, and XP.
- **Spectate mode** — watch AI-only games with a debug panel showing each
  faction's ordered goals and target tiles.
- **Victory progress tracker** — a Tab-toggled panel showing live progress
  toward all four victory conditions.

---

## Tech stack

- **Three.js** (r160) via importmap for 3D rendering — no bundler.
- **Pure ES modules** (`"type": "module"`); the integrator is `class Game` in
  `src/game.js`, backed by pure-logic modules (`config`, `economy`,
  `diplomacy`, `lords`, `map`, `ai`, `battle`, …) that never import the DOM.
- **Vitest** for unit tests, run in Node — no DOM/WebGL required. Tests cover
  the pure logic plus source-invariant checks for the DOM-bound integrator.

---

## Project layout

```
src/
  game.js         integrator (class Game) — the god object
  config.js       all tunable constants, unit/terrain/faction data
  ai.js           AI turn computation (goals, composition, scarcity)
  ai_goals.js     persistent AI goal-sequence state
  diplomacy.js    relations, treaties, coalitions, peace demands
  economy.js      resources, trade routes, unrest
  lords.js        hero units + skill trees
  map.js          procedural generation, passes, influence
  battle.js       combat resolution
  unit.js / building.js / tech.js / fog.js / path.js / renderer.js / ui.js
  eventlog.js difficulty.js spy.js ui_data.js   (feature modules)
tests/            vitest suites (593 tests)
index.html        markup + inline styles + entry script
```

---

## Testing

```bash
npm test          # vitest run (one-shot)
npm run test:watch
```

All 593 tests pass. Pure-logic modules are tested directly; the DOM/WebGL-bound
`Game`/`ui`/`renderer` are covered by source-invariant assertions.

---

## Save games

Saves persist to `localStorage` automatically and are versioned (currently
save format v5). The loader backfills any fields added by newer features, so
old saves keep working without a version bump.