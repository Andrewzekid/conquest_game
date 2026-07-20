# AI Improvement Plan — Engineers, Map Islands, Naval Expansion, Siege, Kings, Military Structures

This document records the root-cause findings and recommended fixes for six
AI/map problems reported in the browser 4X game, plus a seventh building-system
feature request. All findings are verified against the current code (post-commit
`4a149a9`) with `file:line` evidence. The companion file `AI_IMPLEMENTATION.md`
documents the current AI architecture as a living reference.

The existing `IMPLEMENTATION_PLAN.md` is an unrelated old concealment/charge doc
and is not touched by this work.

---

## Area 1 — Engineers not built / not used (army = mostly infantry)

### Findings (root causes, ranked)

1. **The engineer cap is tiny and is the sole trainer.** Block 1c (`ai.js:431`):
   `engCap = Math.max(atWar ? (hasTrainableSiege ? 3 : 5) : 1, Math.ceil(myCityCount / 3))`.
   At peace → 1 engineer per 3 cities; at war → 3 (or 5 for no-siege factions).
   Against `AI_MAX_UNITS = 40` (`config.js:289`) engineers are a negligible
   fraction, so the army is dominated by INFANTRY (the cheapest melee and the
   defense-floor pick at `ai.js:1705-1709`).

2. **The role/composition logic never demands engineers.** `roleDeficit`
   (`ai.js:1652`) suppresses the `support` role entirely below `total >= 8`
   (`ai.js:1656`), and the `support` target fraction is only 0.05–0.15
   (`ai.js:1628-1638`). Because block 1c fills that small support bucket
   *before* the main training loop (`ai.js:553`), the support deficit is ≤ 0
   and the loop keeps producing melee/ranged/cavalry. ENGINEER appears in the
   fallback orders only at position 5 (`ai.js:1728, 1736`) and is absent from
   the decisive/raid/defensive fallbacks (`ai.js:1730, 1732, 1734`).

3. **No reservation for engineers; iron-gated.** `UNIT_COST.ENGINEER =
   { gold:60, food:10, wood:20, iron:10, production:20 }` (`config.js:117`).
   Block 1c's only gate beyond the cap is `canAfford('ENGINEER', res, ec)`
   (`ai.js:436`). Unlike siege (`ai.js:406`) and the siege workshop
   (`ai.js:297`), there is no save-up reservation, so an iron-poor faction
   trains zero engineers indefinitely.

4. **Traps/fortifications only build during home-defense.** The structure
   branch (`ai.js:731-755`) fires only when `cityThreatLevel(homeCity).enemies
   > 0` — an at-war enemy within Manhattan 5 of a friendly city
   (`ai.js:2860`). At peace or on the offensive this is false, so engineers
   never build SPIKES/FORTIFICATION/FALL_TRAP. This directly explains "not
   laying traps."

5. **Siege towers require the engineer to already be within Chebyshev 2 of an
   at-war enemy city** (`ai.js:723`, `SIEGE_TOWER_BUILD_RADIUS=2`,
   `config.js:139`). The engineer closes distance only via the greedy 1-step
   `stepToward` (`ai.js:774`), which cannot cross rivers (`ai.js:1901`) and
   cannot step onto a fortified enemy city without an adjacent friendly Siege
   Tower (`ai.js:1917`). If it stalls en route it never reaches build range
   and never builds a tower. *(Now raised to 3 — see fix.)*

6. **Bridges are offensive-only and geometrically strict.** `findBridgeTarget`
   returns `null` when not at war (`ai.js:1225`) or when no at-war enemy city
   exists (`ai.js:1226`). It requires the engineer to be orthogonally adjacent
   to an unbridged river whose far side (2 tiles over) is passable land
   **strictly closer** to the objective (`ai.js:1239`). Multi-tile rivers are
   unbridgeable (`ai.js:1238`). The engineer reaches the bank only via greedy
   `stepToward`, which may approach at an angle that fails the "far side
   closer" test.

7. **Engineer movement is greedy 1-step toward the nearest at-war enemy city**
   (`ai.js:775`), with no river-aware routing and no multi-turn pathfinding.
   When `stepToward` returns null (blocked/equidistant) the engineer emits no
   move and falls through to army-group handling where it is treated as
   FRAGILE (`ai.js:1949`).

### Recommended fixes (Area 1)

- **Raise & rebase the engineer cap** (`ai.js:431`): make it a meaningful
  fraction of the army, e.g.
  `engCap = Math.max(atWar ? Math.max(4, Math.ceil(myCityCount/2)) : Math.max(2, Math.ceil(myCityCount/2)), ...)`
  so a mid-game empire fields several engineers. Keep a separate support
  fraction so medics aren't crowded out.
- **Make `support` a real deficit role** (`ai.js:1656`): lower the
  `total >= 8` suppression to `total >= 4` and bump the `support` target so
  the training loop itself can demand engineers, not just block 1c.
- **Add engineer reservation** mirroring the siege-workshop reservation
  (`ai.js:297`): when `engNow < engCap` and iron is short, reserve the
  engineer cost so the spending spree can't drain it.
- **Broaden trap-building** (`ai.js:731-755`): also build forward structures
  on the offensive — e.g. when an engineer is within 2 tiles of an at-war
  enemy city but outside siege-tower range, or when screening a chokepoint —
  not only when a home city is threatened.
- **Relax bridge gating** (`ai.js:1225`): allow bridging toward *any*
  objective the engineer is already pathing toward (settler-led expansion,
  friendly territory across a river), not only at-war enemy cities. Relax the
  "far side strictly closer" test to "far side is passable land that
  progresses toward the objective" so angled approaches work. (Multi-tile
  rivers remain a known limitation — note it.)
- **Give engineers river-aware routing**: have the engineer's objective
  consider pathability, and when stalled at a riverbank, prefer stepping
  *along* the bank to reach a perpendicular bridging spot.
- **Raise the siege-build radius to 3** (`config.js:139, 149`): done —
  `SIEGE_TOWER_BUILD_RADIUS` and `LADDER_BUILD_RADIUS` are now 3, giving
  engineers more build opportunities before they stall.

---

## Area 2 — Tiny detached island nations from map generation

### Findings (root causes)

1. **`generateMap()`** (`map.js:345`) takes no parameters; land is a
   continent-disc + two-octave sine-noise mask in `applyContinentMask`
   (`map.js:85`), `CUTOFF = 0.15` (`map.js:96`).

2. **`pickContinentCenters()` deliberately spawns "small islets"**
   (`map.js:55`): the 3rd/4th continent radius is only
   `mapHalf * 0.16–0.26`. With the noise octaves (±0.22 slow, ±0.10 fast) a
   center can easily produce just 1–3 land tiles.

3. **There is NO small-island removal / minimum-landmass filter anywhere.**
   The only flood-fill, `computeLandmasses` (`ai.js:2674`), lives in AI code
   and only *labels* islands for naval decisions — it never prunes them.

4. **`ensureCityAccessibility`** (`map.js:187`) only guarantees each CITY's
   connected land component is ≥ `MIN_CITY_LAND = 12` (`map.js:185`) — and it
   does so by *growing land around the city* (converting water→plains,
   `map.js:229`), not by relocating the start. Non-city islands are never
   touched.

5. **City/starting placement** (`map.js:395-463`) avoids WATER/MOUNTAIN/RIVER
   but has **no minimum-landmass or mainland-proximity check**, so a faction
   can start on a 12-tile island. `canFoundOn` (`ai.js:1256`) likewise has no
   landmass-size gate.

6. **No config knob controls water fraction, continent count, or minimum
   landmass size** — these are local literals in `map.js`.

### Recommended fixes (Area 2)

- **Add a post-generation landmass pass in `map.js`**: after
  `applyContinentMask`/`assignBiomes`, run a flood-fill and convert any
  landmass below a `MIN_LANDMASS_SIZE` threshold (e.g. 20–30 tiles) back to
  WATER — eliminating stray 1–3 tile islets. Re-run before city placement so
  cities never land on a doomed islet.
- **Drop or enlarge the "small islets" continent class** (`map.js:55`): raise
  its radius floor (e.g. `mapHalf * 0.28–0.40`) so any continent that survives
  is mainland-sized, or remove the 3rd/4th continent entirely on small maps.
- **Require starting capitals on the largest landmass** (`map.js:433-463`):
  when assigning faction starts, restrict candidate cities to those on the
  biggest landmass (or a landmass ≥ `MIN_START_LANDMASS`). Falls back to the
  largest available if too few qualify.
- **Expose knobs in `config.js`**: `MIN_LANDMASS_SIZE`, `MIN_START_LANDMASS`,
  water-ratio bounds, continent count — so this is tunable without editing
  map.js literals.
- **Note**: rivers (`map.js:238`) run before city placement and avoid CITY
  tiles, so they're unaffected; just ensure the prune pass runs before rivers
  carve (or re-validate after).

---

## Area 3 — AI doesn't build Harbor + Transport when stuck on an island

### Findings (root causes, ranked)

1. **No coastal city — the single most likely cause.** Both harbor blocks
   require an owned CITY that is `isCoastalCity` (orthogonal WATER/RIVER
   neighbor, `ai.js:2704`). `findFoundSpot` (`ai.js:1295`) has **zero
   coastal-preference scoring**, so the AI routinely founds inland on a tiny
   island and permanently locks itself out of harbor construction. Block 0h
   (`ai.js:264`) also reserves nothing when no coastal city exists.

2. **Wood scarcity.** `HARBOR` costs `wood: 30` (`config.js:310`),
   `TRANSPORT` costs `wood: 20` (`config.js:127`). A treeless tiny island
   can't accumulate that; `canAffordBuilding('HARBOR')` (`ai.js:1414`) fails
   every turn. Market sales (`ai.js:165`) only sell wood when stockpiled > 50,
   so they never help reach 30. No logic prioritizes lumbermills/forest tiles
   to fund a harbor.

3. **Settlers saturate the home island before any ferrying.** `findFoundSpot`
   restricts candidates to the settler's own landmass (`ai.js:1310`); as long
   as ANY foundable tile remains on the tiny island, settlers walk there and
   found, never boarding. Transports trained in the meantime sit idle
   (`nearestWaitingSettler` returns null → no-op, `ai.js:946-955`). Ferrying
   only begins after the island is 100% full — so even with a harbor +
   transport, the overseas expansion the user expects never happens.

4. **`needsNavalExpansion` false for borderline 30–39 tile islands**
   (`ai.js:104, 126`): an island that misses both `isIslandFaction` gates
   (`<30` false, `<10%` borderline) AND has `homeMassSettleable >= 3` AND an
   enemy city gets `needsNavalExpansion = false`, so block 0h won't fire and
   block 1d only fires if `myCityCount >= 2 || hasBarracks`.

5. **TRANSPORT training is strictly gated on `needsExpansionFleet`**
   (`ai.js:529, 537`): a faction that builds a harbor via block 1d's
   `myCityCount >= 2 || hasBarracks` gate but has `isIslandFaction=false` AND
   `needsNavalExpansion=false` only ever trains GALLEY — never a TRANSPORT.

6. **`hasForeignLandmassWithoutCity` doesn't verify the foreign landmass is
   settleable** (`ai.js:2656`): false positives (harbor built for a useless
   rock) and false negatives (suppressed expansion when the home island is
   genuinely too small but every foreign mass already has a friendly city).

7. **Harbor blockade silently kills ship training** (`game.js:3684`,
   `_isHarborBlockaded` at 2000) — situational but compounding.

### Recommended fixes (Area 3)

- **Coastal-preference in city founding** (`ai.js:1295` `findFoundSpot`): add
  a strong score bonus for tiles orthogonally adjacent to WATER/RIVER when
  the faction `isIslandFaction || needsNavalExpansion` (and lacks a harbor).
  This is the highest-leverage fix — it unblocks the whole naval pipeline.
- **Lower the wood gate / add wood reservation for harbors**: either reduce
  `HARBOR` wood cost (e.g. 30→15) for a coastal city, or have block 0h
  reserve wood (not just gold) and prioritize a LUMBERMILL on the first
  forest tile. Consider a one-time "colonial starter" wood grant for island
  factions.
- **Ferry before saturation**: in the settler loop (`ai.js:635-687`), when
  `needsNavalExpansion` and a transport exists (or is queued), prefer
  boarding a settler onto a transport over founding on a marginal home tile —
  i.e. raise the found-spot acceptance threshold so settlers don't waste
  themselves on the last 1–2 sub-par home tiles.
- **Relax `needsNavalExpansion`** (`ai.js:104, 126`): raise the
  `isIslandFaction` size threshold (e.g. `< 50`) and add a "home mass too
  small to be worth filling" trigger so borderline islands still expand.
- **Train TRANSPORT whenever a harbor exists and `needsNavalExpansion`**,
  decoupling it from `needsExpansionFleet` so a continental faction that
  wants overseas land still gets a transport.
- **Fix `hasForeignLandmassWithoutCity`** (`ai.js:2656`) to require the
  foreign landmass to contain at least one `canFoundOn` tile.
- **Proactive transport scouting** (`ai.js:945-955`): when an empty transport
  has no waiting settler, sail it toward the nearest foreign settleable
  landmass so it's positioned to ferry — instead of idling.

---

## Area 4 — Verdant Realm & Golden Horde have trivially low siege production

### Findings (root causes, ranked)

Both factions have **no SIEGE/ARTILLERY in roster** (Verdant
`[INFANTRY, ARCHER, SCOUT]`, Golden `[INFANTRY, CAVALRY, SCOUT, ARCHER]`).
Their only siege paths are (a) a Siege Workshop → CATAPULT/TREBUCHET, or (b)
ENGINEER-built Siege Towers.

1. **The Siege Workshop is not built at peace (no reservation).**
   `needsSiegeWorkshopFirst = atWar && !hasTrainableSiege &&
   !hasSiegeWorkshop` (`ai.js:288`) — the build-before-Barracks +
   cost-reservation logic fires **only at war**. At peace, block 1a
   (`ai.js:318`) builds the workshop only if
   `canAffordBuilding('SIEGE_WORKSHOP', res)` with **no reservation**.
   SIEGE_WORKSHOP costs `gold:80` (`config.js:312`); under the lean economy
   the spending spree drains gold first, so the workshop is delayed
   indefinitely. Without it, `fullRoster` never gains CATAPULT/TREBUCHET
   (`ai.js:67`), `has('siege')` is false (`ai.js:1623`), the siege composition
   target is zeroed (`ai.js:1644`), and the AI has **zero siege demand** — it
   spams INFANTRY/ARCHER (Verdant) or CAVALRY (Golden, which is cavalry-heavy
   0.45 and gets a gold discount).

2. **CATAPULT/TREBUCHET cost iron** (`config.js:124-125`): CATAPULT
   `iron:15`, TREBUCHET `iron:25`. Neither Verdant nor Golden needs iron for
   anything else in their roster, so they don't prioritize iron terrain and
   stay iron-poor — even with a workshop, `canAfford` fails and no siege
   engine is ever trained.

3. **Engineers crowd the siege cap (block 1b).** `siegeCount` includes
   `ENGINEER` and `SIEGE_TOWER` (`ai.js:362-364`). For a no-siege-roster
   faction at war, `engCap` is up to 5 (`ai.js:431`), so `siegeCount` easily
   meets `siegeCap` (`max(2, round(aiUnitCap*0.15))`, `ai.js:376`) and block
   1b's `siegeCount < siegeCap` gate (`ai.js:378`) skips CATAPULT/TREBUCHET
   training.

4. **The engineer-only path rarely delivers.** Without a workshop, the only
   siege is ENGINEER-built Siege Towers, but engineers barely reach within
   Chebyshev 2 of an enemy city (Area 1, finding 5). So Verdant/Golden
   produce almost no siege of any kind.

### Recommended fixes (Area 4)

- **Reserve for the Siege Workshop at peace for no-siege-roster factions**
  (`ai.js:288, 318`): extend `needsSiegeWorkshopFirst` to also fire when
  `!hasTrainableSiege && myCityCount >= 1` (not just `atWar`), and reserve its
  cost so the spending spree can't starve it. This is the highest-leverage
  fix — it gives Verdant/Golden a trainable siege path before war breaks out.
- **Drop the iron cost from CATAPULT/TREBUCHET** (`config.js:124-125`): set
  CATAPULT `iron:0`, TREBUCHET `iron:10` (or 0), consistent with the earlier
  SIEGE_TOWER/SIEGE_WORKSHOP iron removal and the user's "decrease siege
  engine cost" request. This removes the iron-poverty gate that blocks
  no-siege factions.
- **Stop counting ENGINEER/SIEGE_TOWER in `siegeCount`** (`ai.js:362-364`)
  when `hasSiegeWorkshop` is true (or always) — engineers are a means to
  build towers, not siege units; counting them suppresses real siege in block
  1b. The `has('siege')` fix (`ai.js:1623`) already prevents the
  cavalry-fallthrough that the engineer-counting was originally added to
  solve, so it's safe to revert that part.
- **Boost siege priority for no-siege-roster factions at war**: once a
  workshop exists, weight the siege deficit higher so Verdant/Golden actually
  field CATAPULTs rather than endless infantry/cavalry.

---

## Area 5 — Kings stay stationary under ranged fire (should retreat or close & attack)

### Findings (root causes)

1. **The king is melee and can only attack adjacent enemies.** `_aiLordAttack`
   (`game.js:3543`) restricts attacks to Chebyshev ≤ 1 (`game.js:3551, 3563`).
   A ranged unit (ARCHER range 2, LONGBOWMAN/ARTILLERY/CATAPULT/TREBUCHET
   range 3) hitting the king from distance 2–3 is **untouchable** by the
   king.

2. **`_aiMoveKing` has no "respond to ranged attackers" step.** Its steps
   (`game.js:3344-3502`) are: capture breached city → retreat when
   `foeLocal > friendLocal*1.3` (Chebyshev-3 power ratio, `game.js:3394`) →
   early-game harassment → crucial-siege join → anchor to main group →
   anti-camp → home tether. A single ranged unit plinking the king rarely
   exceeds the `friendLocal*1.3` retreat threshold, so **no step fires** and
   the king sits still, eating ranged damage turn after turn.

3. **The king moves only 1 tile/turn.** `_aiMoveKing` calls `_aiStepLord`
   once per step-block and returns, so the king advances 1 tile per turn —
   half the 2-tile move of non-king lords (`_aiMoveLords` loops `s<2`,
   `game.js:3326`). Even if the king wanted to close on a ranged unit at
   distance 2, it can't reach and attack it in one turn.

4. **No detection of "I'm being outranged."** `localPower`
   (`game.js:3364`) counts all units within Chebyshev 3 but doesn't
   distinguish ranged vs melee or whether the king can retaliate. There's no
   heuristic for "an enemy can hit me but I can't hit back."

### Recommended fixes (Area 5)

- **Add a "respond to ranged fire" step in `_aiMoveKing`** (early, before the
  anchor step): scan at-war enemy units whose `attackRange >= 2` and
  Chebyshev distance to the king is ≤ their range but > 1 (the king is in
  their kill-zone but can't counter). For the nearest such attacker:
  - If the king can close to melee this turn (distance ≤ king moveRange and
    the king isn't locally outmatched) → step toward it so `_aiLordAttack` can
    hit it next.
  - Else (outmatched or can't close) → retreat toward the nearest friendly
    city/army, out of the attacker's range (step so the new distance >
    attacker's attackRange).
  Reuse the existing `localPower` for the outmatched check and
  `UNIT_TYPE[u.type].attackRange` for the kill-zone test.
- **Let the king move 2 tiles/turn** like other lords (loop `_aiStepLord`
  twice in `_aiMoveKing`, or refactor to share `_aiMoveLords`'s 2-step loop)
  so it can actually close on ranged units and escape ranged kill-zones.
- **Lower/adjust the retreat threshold for ranged-only threats**: even when
  total foe power doesn't exceed `friendLocal*1.3`, if the only nearby foes
  are ranged units the king can't counter, trigger a retreat/close step.

---

## Area 6 — Military structures buildable in influence, upgradeable, attackable, defensible

### Current state (verified)

- `BUILDING_TYPE` (`config.js:302-314`): `BARRACKS`, `SIEGE_WORKSHOP`,
  `HARBOR`, `MARKET`, `WALLS` all have `terrain: 'CITY'` — forced onto the
  city tile. No `level`/`hp`/`upgradeable` fields. Buildings are pure data.
- `constructBuilding` (`building.js:48-51`) hard-gates on
  `tile.terrain !== bData.terrain`. `getBuildableBuildings`
  (`building.js:141`) same. The influence Set is already passed in and checked
  (`building.js:42`); `canBuildAt` (`ai.js:80`) is already influence-aware.
  So the *only* blocker to building-in-influence is the terrain gate, not
  influence.
- Every AI build block hard-codes `t.terrain === 'CITY'` (`ai.js:267, 290,
  306, 319, 331, 454`).
- `buildings` is `Map<tileKey, string[]>` (`building.js:78`); save format is
  `[...entries()]` of string arrays (`save.js:16, 72`), `SAVE_VERSION = 2`
  (`save.js:5`).
- Train veteran/discount is a **boolean**: `hasBarracks` → `veteran: true`
  (Lv.2 only, `unit.js:17`) + flat `gold*0.75` (`game.js:2370, 3690`). No
  Lv.3+ veteran path, no diminishing returns.
- Buildings have **no HP**, are **not** in `PILLAGEABLE_BUILDINGS`
  (`config.js:170` = FARM/LUMBERMILL/MINE only), and `resolveCombat`
  (`battle.js`) is unit-vs-unit only. The only HP-like structure stat is
  tile-level city `fortification` (`map.js:643`). Engineer `STRUCTURE_TYPE`
  (spikes/fortification/fall-trap) is the closest destructible-structure
  analog but also has no HP and is removed on tile-capture
  (`map.js:580-588`), not by direct attack.
- Renderer `makeBuildingProp(type)` (`renderer.js:918`) takes only a type
  string — no level/HP visualization.

### Recommended design (Area 6)

This is the largest change; do it in four sub-parts.

**6a. Build military structures anywhere in a city's influence.**
- Add a flag to the three military buildings in `BUILDING_TYPE` (`config.js`):
  `influenceBuildable: true` on `BARRACKS`, `SIEGE_WORKSHOP`, `HARBOR` (leave
  `MARKET`/`WALLS` city-only, and `FARM`/`LUMBERMILL`/`MINE` terrain-matched).
- `constructBuilding` (`building.js:48`): if `bData.influenceBuildable`,
  accept any passable land tile in influence (reject
  `WATER`/`MOUNTAIN`/`RIVER`/`CITY`-optional) instead of requiring
  `bData.terrain`. Keep the HARBOR `isCoastal` check (`building.js:54`) — it
  already works on any tile.
- `getBuildableBuildings` (`building.js:141`): apply the same relaxation so
  the player's build menu offers these on non-city influence tiles.
- AI build blocks (`ai.js:267, 290, 306, 319, 331, 454`): replace
  `t.terrain === 'CITY'` with an influence-tile scan — prefer the city tile
  if free, else the nearest suitable influence tile (coastal for HARBOR).
  Reuse `getInfluencedTiles` (`map.js:511`) + `canBuildAt`.
- Player UI: `showBuildMenu` (`ui.js:634`) already lists
  `getBuildableBuildings` for the selected tile, so selecting a non-city
  influence tile will now show BARRACKS/SIEGE_WORKSHOP/HARBOR. (Training
  buttons stay city-only, `ui.js:672` — unchanged.)

**6b. Upgrade Barracks & Harbor to level 3 (higher veteran level + cheaper, diminishing returns).**
- **Data model**: add a parallel
  `gameState.buildingState: Map<"tileKey:type", {level, hp, maxHp}>` (keeps
  the existing `string[]` shape and save compat; defaults to level 1 / full
  hp when absent). Serialize in `save.js` alongside `buildings`; bump
  `SAVE_VERSION` to 3 and migrate old saves (treat absent state as level 1).
- **Config** (`config.js`): add `MILITARY_BUILDING_LEVELS` for BARRACKS and
  HARBOR — per-level `{upgradeCost, veteranLevel, goldMult}` with
  diminishing returns, max level 3. Example curve:
  - BARRACKS: L1 {veteran Lv2, gold 0.75×} (current) → L2 {upgrade
    ~90g/20i, veteran Lv3, gold 0.65×} → L3 {upgrade ~150g/30i, veteran Lv4,
    gold 0.60×}.
  - HARBOR: L1 {naval veteran Lv2, gold 0.85×} → L2 {veteran Lv3, gold 0.75×}
    → L3 {veteran Lv4, gold 0.70×}.
- **`createUnit`** (`unit.js:17`): extend `opts.veteran` from boolean to a
  `veteranLevel` (1-4); the existing `level`-based stat formula
  (`maxHp = hp + (level-1)*3`, `attack/defense += (level-1)`) already scales
  — just feed it the building's veteran level.
- **Train handlers** (`game.js:2368-2395` player, `3688-3693` AI): replace
  boolean `hasBarracks` with a lookup of the **highest-level BARRACKS in the
  training city's influence** (new helper
  `bestMilitaryLevel(tiles, cityTile, 'BARRACKS', buildings, buildingState)`
  using per-city `cityRadius`); pass its `veteranLevel` and `goldMult` to
  `createUnit`/`spendCost`. Same for HARBOR → naval training at a coastal
  city. This also makes a non-city barracks serve its city.
- **Upgrade action**: `handleUpgradeBuilding(type, tile)` (player, game.js)
  + `case 'upgradeBuilding'` (AI, game.js): validate level < 3, affordability,
  deduct `upgradeCost`, increment `buildingState` level, restore hp to new
  maxHp.
- **AI upgrade logic** (ai.js): when affordable and the front-line city would
  benefit, emit `upgradeBuilding` for BARRACKS/HARBOR (prioritize the
  highest-threat/frontier city).
- **UI** (`ui.js:634`): in `showBuildMenu`, when a military building exists on
  the tile and level < 3, show an "Upgrade → L2/L3 (cost)" button and the
  current level.

**6c. Structures outside the city can be attacked and pillaged.**
- **HP**: store `hp`/`maxHp` in `buildingState` (6b). Config
  `MILITARY_BUILDING_HP = {BARRACKS: 20, SIEGE_WORKSHOP: 25, HARBOR: 30}` and
  a small `defense` so they're not trivially one-shot.
- **Attack**: add `handleAttackBuilding(unit, tile)` (game.js) + `case
  'attackBuilding'` (AI). Deal `max(1, unit.attack - buildingDefense)` to the
  building's hp (no retaliation — it's a structure); at hp ≤ 0 destroy it
  (remove from `buildings` + `buildingState`), award pillage gold, log.
  Reuse the existing attack-range/adjacency rules. Render a health bar /
  damaged-state for wounded structures (renderer — see 6d).
- **Pillage**: add `BARRACKS`/`SIEGE_WORKSHOP`/`HARBOR` to
  `PILLAGEABLE_BUILDINGS` (`config.js:170`) and extend `removeBuilding`
  (`building.js:94`) to also clear `buildingState`. Pillaging an undamaged
  military structure gives a bigger reward (e.g. 2× `PILLAGE_GOLD_REWARD`).
- **AI**: extend `findAdjacentPillageable` (`ai.js:1178`) to target enemy
  military structures, and add an "attack structure" action when adjacent to
  a weakened high-value structure (priority: HARBOR > SIEGE_WORKSHOP >
  BARRACKS).
- **Tile capture**: when a tile with a military building flips owner (extend
  `captureCityTerritory`/tile-flip in `map.js:548-591`), dismantle the old
  owner's military building on that tile (mirror the engineer-structure
  removal at `map.js:580-588`).

**6d. Troops defend key military structures at risk.**
- **AI defense**: add a step in the army-group/patrol logic
  (`planGroup`/patrol assignment, ai.js ~1040+) that, for each friendly
  military structure with an at-war enemy within ~4 tiles, assigns 1-2 nearby
  military units to defend it (move onto/adjacent to the structure tile).
  Reuse the `cityThreatLevel` pattern (`ai.js:2860`) generalized to
  structure tiles. Prioritize defending HARBOR/SIEGE_WORKSHOP over BARRACKS.
- **Player**: units already defend the tile they stand on; garrisoning a
  structure means standing on its tile (the building's `defense` bonus, if
  any, applies via `getBuildingDefenseBonus` — extend it to include
  military-structure defense for units on that tile).
- **Renderer** (`renderer.js:918, 1010`): extend `makeBuildingProp` to
  accept a level (tiered visual — e.g. bigger/extra flag for L2/L3) and an hp
  ratio (health bar / smoke when damaged). `renderBuildings` reads
  `buildingState` to pass level/hp.

### Cross-cutting notes
- This area touches the most files (`config.js`, `building.js`, `unit.js`,
  `game.js`, `ai.js`, `battle.js`, `map.js`, `ui.js`, `renderer.js`,
  `save.js`) and is save-format-breaking (`SAVE_VERSION` 2→3). Implement
  last, after Areas 1-5, and migrate saves.
- `getInfluencedTiles` (`map.js:511`) is per-faction (union of all owned
  cities); for per-city influence lookups (6b train handler, 6a AI placement)
  use `cityRadius(c)` (`map.js:28`) directly on the relevant city.

---

## Verification

- **Syntax**: `node --check` on every modified `src/` file.
- **Headless checks** (the AI modules are DOM-free and importable in Node):
  - Engineer cap/diversity: instantiate `computeAIActions` for a mid-size
    empire and assert engineers are a non-trivial fraction of train actions.
  - Siege for no-siege factions: with a Siege Workshop present, assert
    Verdant/Golden emit CATAPULT/TREBUCHET train actions (not zero) and that
    engineers don't suppress the siege cap.
  - Map: extract the landmass-prune helper and unit-test it on a synthetic
    tile grid — assert no landmass below `MIN_LANDMASS_SIZE` survives, and all
    faction starts are on the largest landmass.
  - Naval: assert `findFoundSpot` returns a coastal tile for an island
    faction lacking a harbor.
  - King ranged response: unit-test the new `_aiMoveKing` step with a king at
    Chebyshev 2 from an enemy ARCHER and assert it steps toward (or retreats
    from) the archer rather than staying put.
- **In-browser smoke test** (the real check): spectate an all-AI match on a
  medium map; over ~60 fast-forwarded turns confirm:
  - Engineers are built and used (siege towers, traps, bridges) — not just
    infantry.
  - Verdant and Golden Horde build a Siege Workshop and field
    CATAPULT/TREBUCHET (not zero siege).
  - No faction is stranded on a tiny islet; no sub-threshold islands exist
    on the map.
  - An island faction builds a Harbor + TRANSPORT and founds a city on a
    foreign continent.
  - A king taking ranged fire retreats or closes to attack the ranged unit
    instead of sitting still.
- Commit per area and push to `origin/master` only after the smoke test
  passes.