# AI Implementation Reference

A living reference for the current AI architecture in `src/ai.js` (and the
lord/king movement in `src/game.js`). This documents *how the AI works today*
so future changes have a map. It is intentionally separate from
`AI_IMPROVEMENT_PLAN.md`, which lists problems and proposed fixes.

The AI is **pure**: `computeAIActions` (`ai.js:49`) takes game state and
returns a list of action objects; it has no engine/DOM dependencies. The
engine (`game.js`) applies them. Action shapes are documented at
`ai.js:23-35`.

---

## Top-level flow (`computeAIActions`, `ai.js:49`)

Inputs: `units, tiles, resources, owner, buildings, influence, factionDef,
diploState, lords, tempBonuses, structures`.

Early setup:
- `myUnits` — this faction's units, excluding `boarded` ones (`ai.js:51`).
- `roster` = `factionDef.roster` (`ai.js:56`).
- `hasSiegeWorkshop` — scanned from `buildings` (`ai.js:60-63`).
- `fullRoster` = roster + `EXTRA_UNITS` (deduped) + `CATAPULT`/`TREBUCHET`
  if a workshop exists (`ai.js:66-67`). This is the set the AI may train.
- `hasTrainableSiege` — roster has SIEGE/ARTILLERY **or** a workshop
  (`ai.js:72`). Factions with neither (Verdant, Storm) have no trainable
  siege and must rely on ENGINEER-built Siege Towers.
- `isAtWar(other)` / `enemies` / `atWar` (`ai.js:75-77`).
- `activeObjectives` — detected threats/opportunities (`ai.js:78`).
- `canBuildAt(t)` — influence-aware build gate (`ai.js:80`).
- `myCityCount`, `hasBarracks`, `trainCount()` (`ai.js:82-84`).
- `aiUnitCap = min(getUnitCap(tiles, owner), AI_MAX_UNITS)` — matches the
  engine's per-city cap (5 + (level-1)*2 per city) so a large empire can field
  a bigger army; `AI_MAX_UNITS` (`config.js:289`, now 40) is a sanity ceiling
  (`ai.js:89`). `capRoom()` checks remaining room (`ai.js:90`).
- `land = computeLandmasses(tiles)` — flood-fill labels continents/islands for
  naval logic (`ai.js:99`).

The body is a sequence of numbered "blocks" that push actions, guarded by
affordability (`canAfford`), the unit cap (`capRoom`), and role composition.
Blocks run in priority order; earlier blocks reserve resources so later ones
can't drain them.

### Numbered blocks (in execution order)

| Block | Location | Purpose |
|-------|----------|---------|
| 0     | capture | Capture breached/weak neutral or enemy cities with adjacent units. |
| 0a    | market (`ai.js:165`) | Sell surplus wood/iron/food at the market for gold. Sells wood only when stockpiled > 50. |
| 0ab   | bridges | Engineer builds bridges (see Engineers). |
| 0h    | harbor (`ai.js:264-279`) | Build a HARBOR on a coastal city when `needsNavalExpansion`. Reserves gold. |
| 1a    | barracks+workshop (`ai.js:318`) | Build BARRACKS / SIEGE_WORKSHOP on a city tile. Workshop at peace is unreserved (Area 4 issue). |
| 1b    | siege (`ai.js:362-378`) | Train CATAPULT/TREBUCHET up to `siegeCap` when `siegeCount < siegeCap`. `siegeCount` includes ENGINEER + SIEGE_TOWER (Area 4 issue). |
| 1c    | engineers (`ai.js:431`) | Train ENGINEERs up to `engCap`. Cap is tiny (Area 1 issue). |
| 1d    | harbor fallback (`ai.js:451-463`) | Build HARBOR when `myCityCount >= 2 \|\| hasBarracks`. |
| 1ab   | walls | Build WALLS on threatened cities. |
| 2     | settlers (`ai.js:635-687`) | Move/settle settlers; board onto transports; found cities via `findFoundSpot`. |
| 2b    | scouts | Move scouts to explore. |
| 2c    | ships (`ai.js:523-547`) | Train GALLEY/TRANSPORT. TRANSPORT is gated on `needsExpansionFleet` (`ai.js:529`). |
| 2d    | land units (`ai.js:548`) | Main training loop: fill role deficits up to `aiUnitCap`. |
| 3     | economy buildings | Build FARM/LUMBERMILL/MINE/MARKET on worked tiles. |
| 3b    | city level-up | Pay `CITY_LEVEL_UP_COST` to grow a city's level (raises cap + influence). |
| 4+    | army grouping / `planGroup` | Group military units by commanding lord + spatial clustering; assign objective + stance; emit coordinated moves (screen fragile units, focus fire, encircle, retreat when outmatched, conceal for ambush, advance in formation). |

---

## Engineer system

- **Training**: block 1c (`ai.js:431`). `engCap = Math.max(atWar ?
  (hasTrainableSiege ? 3 : 5) : 1, Math.ceil(myCityCount / 3))`. Gated by
  `canAfford('ENGINEER')` only — no reservation (Area 1, finding 3).
- **Role**: `unitRole('ENGINEER') === 'support'`. The `support` role is
  suppressed in `roleDeficit` below `total >= 8` (`ai.js:1656`) and has a low
  target fraction (0.05–0.15), so the main loop rarely demands engineers
  (Area 1, finding 2).
- **Movement**: greedy 1-step `stepToward` the nearest at-war enemy city
  (`ai.js:774-775`). No river-aware routing; falls through to army-group
  handling as FRAGILE when blocked (`ai.js:1949`).
- **Usage**:
  - **Siege towers** (`ai.js:722-730`): `findEnemyCityWithin(unit, tiles,
    owner, isAtWar, SIEGE_TOWER_BUILD_RADIUS)` (now radius 3). Pays
    `SIEGE_TOWER_COST`, builds over `SIEGE_TOWER_BUILD_TURNS`.
  - **Ladders**: same pattern, `LADDER_BUILD_RADIUS` (now 3).
  - **Traps/fortifications** (`ai.js:731-755`): builds SPIKES/FORTIFICATION/
    FALL_TRAP only when `cityThreatLevel(homeCity).enemies > 0` — home-defense
    only (Area 1, finding 4).
  - **Bridges**: `findBridgeTarget` (`ai.js:1224-1242`). Returns null when not
    at war (`ai.js:1225`) or no at-war enemy city (`ai.js:1226`). Requires
    orthogonal adjacency to an unbridged river whose far side is passable land
    strictly closer to the objective; multi-tile rivers unbridgeable
    (Area 1, finding 6).

---

## Siege system

- **Workshop gate**: `hasSiegeWorkshop` unlocks CATAPULT/TREBUCHET in
  `fullRoster` (`ai.js:60-67`). `needsSiegeWorkshopFirst` (`ai.js:288`) =
  `atWar && !hasTrainableSiege && !hasSiegeWorkshop && myCityCount >= 1` —
  the build-before-Barracks + reservation path fires **only at war**
  (Area 4, finding 1).
- **Caps**: `siegeCap = max(2, round(aiUnitCap * 0.15))` (`ai.js:376`).
  `siegeCount` includes ENGINEER + SIEGE_TOWER (`ai.js:362-364`), which can
  crowd out real siege for no-siege-roster factions (Area 4, finding 3).
- **Composition**: `factionComposition` (`ai.js:1623`) — `has('siege')` is
  `roster.some(t => unitRole(t) === role && !(role === 'siege' && t ===
  'SIEGE_TOWER'))`. `roleDeficit` (`ai.js:1652`) suppresses `support` below
  `total >= 8` (`ai.js:1656`).
- **No-siege-roster factions** (Verdant, Golden, Storm): without a workshop
  they have zero siege demand and spam infantry/cavalry; even with a workshop,
  CATAPULT/TREBUCHET iron cost (`config.js:124-125`) gates them out
  (Area 4, finding 2).

---

## Naval system

- **`needsNavalExpansion`** (`ai.js:104, 126`): true when the faction
  `isIslandFaction` (home landmass < 30 tiles, or < 10% of map) **or**
  `hasForeignLandmassWithoutCity(...)` AND home mass is small / has no enemy
  cities. Borderline 30–39 tile islands can fall through (Area 3, finding 4).
- **Harbor**: blocks 0h (`ai.js:264-279`) and 1d (`ai.js:451-463`). Requires
  an owned `isCoastalCity` (orthogonal WATER/RIVER neighbor, `ai.js:2704`).
  Costs `wood: 30` (`config.js:310`) — wood scarcity on a treeless island
  blocks it (Area 3, finding 2).
- **Ships**: block 2c (`ai.js:523-547`). TRANSPORT training is gated on
  `needsExpansionFleet` (`ai.js:529`), not just `needsNavalExpansion`
  (Area 3, finding 5).
- **Ferrying**: settler loop (`ai.js:635-687`) boards settlers onto transports
  via `nearestWaitingSettler` (`ai.js:945-955`). Settlers saturate the home
  island first because `findFoundSpot` restricts to the settler's own landmass
  (`ai.js:1310`) with no coastal preference (`ai.js:1295`) (Area 3, findings
  1 & 3).
- **`hasForeignLandmassWithoutCity`** (`ai.js:2656`): doesn't verify the
  foreign landmass is settleable (Area 3, finding 6).
- **Harbor blockade**: `_isHarborBlockaded` (`game.js:2000`) silently kills
  ship training (`game.js:3684`).

---

## King & lord movement (`game.js`)

- **`_aiMoveKing`** (`game.js:3344-3502`): moves the king 1 tile/turn via
  `_aiStepLord`. Steps in order: (1) capture breached city, (2) retreat when
  `foeLocal > friendLocal * 1.3` (Chebyshev-3 power ratio, `game.js:3394`),
  (3) early-game harassment, (3b) crucial-siege join (requires enemy king
  present, `game.js:3417-3449`), (4) anchor to main group (`game.js:3453`),
  (5) anti-camp, (6) home tether. **No "respond to ranged fire" step** and
  only 1 tile/turn (Area 5, findings 2 & 3).
- **`_aiMoveLords`** (`game.js:3235`): moves non-king lords 2 tiles/turn
  (loops `s < 2`, `game.js:3326`).
- **`_aiLordAttack`** (`game.js:3543`): attacks only Chebyshev ≤ 1
  (`game.js:3551, 3563`). Ranged units at distance 2–3 are untouchable by
  a melee king (Area 5, finding 1).
- **`localPower`** (`game.js:3364`): sums unit power within Chebyshev 3; does
  not distinguish ranged vs melee (Area 5, finding 4).

---

## Map generation (`map.js`)

- **`generateMap()`** (`map.js:345`): no parameters. Land = continent-disc +
  two-octave sine-noise mask in `applyContinentMask` (`map.js:85`),
  `CUTOFF = 0.15` (`map.js:96`).
- **`pickContinentCenters()`** (`map.js:46-75`): deliberately spawns "small
  islets" — 3rd/4th continent radius is `mapHalf * 0.16–0.26` (`map.js:55`),
  often producing 1–3 tile islands (Area 2, finding 2).
- **No landmass prune**: `computeLandmasses` (`ai.js:2674`) only *labels*
  islands for naval decisions; nothing removes small ones (Area 2, finding 3).
- **`ensureCityAccessibility`** (`map.js:187`): grows land around each city to
  guarantee ≥ `MIN_CITY_LAND = 12` connected land tiles (`map.js:185`); does
  not relocate starts or touch non-city islands (Area 2, finding 4).
- **City/starting placement** (`map.js:395-463`): avoids WATER/MOUNTAIN/RIVER
  but has no minimum-landmass / mainland-proximity check (Area 2, finding 5).
- **`getInfluencedTiles`** (`map.js:511`): per-faction union of all owned
  cities' influence. For per-city influence use `cityRadius(c)` (`map.js:28`).
- **`captureCityTerritory`** (`map.js:548-591`): dismantles engineer
  structures on flipped tiles (`map.js:580-588`).
- **Rivers** (`map.js:238`): carved before city placement, avoid CITY tiles.

---

## Building system (`building.js`, `config.js`)

- **`BUILDING_TYPE`** (`config.js:302-314`): BARRACKS, SIEGE_WORKSHOP, HARBOR,
  MARKET, WALLS all have `terrain: 'CITY'` — forced onto the city tile. No
  `level`/`hp`/`upgradeable` fields.
- **`constructBuilding`** (`building.js:31`): gates on influence (`building.js:42`)
  + terrain match (`building.js:48`). HARBOR also requires `isCoastal`
  (`building.js:54`).
- **`getBuildableBuildings`** (`building.js:128`): same terrain gate
  (`building.js:141`); drives the player build menu.
- **`buildings`** = `Map<tileKey, string[]>` (`building.js:78`); save format
  `[...entries()]` (`save.js:16, 72`); `SAVE_VERSION = 2` (`save.js:5`).
- **Veteran/discount**: boolean `hasBarracks` → `veteran: true` (Lv.2 only,
  `unit.js:17`) + flat `gold * 0.75` (`game.js:2370, 3690`). No L3+ path.
- **HP/pillage**: buildings have no HP; `PILLAGEABLE_BUILDINGS`
  (`config.js:170`) = FARM/LUMBERMILL/MINE only; `removeBuilding`
  (`building.js:94`) handles those. `resolveCombat` (`battle.js`) is
  unit-vs-unit only. Engineer `STRUCTURE_TYPE` (spikes/fortification/fall-trap)
  is the closest destructible-structure analog but has no HP and is removed
  on tile-capture, not by direct attack.
- **Renderer**: `makeBuildingProp(type)` (`renderer.js:918`) takes only a type
  string; `renderBuildings` (`renderer.js:1010`).

---

## Economy notes (`economy.js`)

- Civ6-style worked-tile cap: `getUnitCap(tiles, owner)` = sum over owned
  cities of `5 + (level-1)*2` (`economy.js:347`).
- `collectResources` / `grossYields` (`economy.js:25, 46`): per-source
  breakdown so the UI shows the same income the engine applies.
- `processUpkeep` (`economy.js:182`): gold + food per unit; starvation
  attritions units. **User constraint: do not reduce food production for a
  city.**
- `sellAtMarket` (`economy.js:215`), `processCityGrowth` (`economy.js:260`),
  `processNeutralCityGrowth` (`economy.js:293`).

---

## Pathing (`path.js`)

- `nextStepToward` (`path.js:18`): BFS one step toward a goal. Blocks WATER
  and unbridged RIVER for non-naval units (`path.js:64`). This is why
  engineers/land units can't cross rivers without a bridge.

---

## Diplomacy (`diplomacy.js`)

- `canAttack(diploState, owner, other)` — the AI only attacks factions it is
  at war with (`ai.js:75`). `atWarFactions` lists them (`ai.js:76`).