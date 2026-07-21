# Plan: AI Competitiveness — Aggressive Expansion & Diplomacy Revamp

**Goal:** Make the AI a more competitive opponent by (1) expanding its city count
aggressively via settlers + neutral-city founding + sniping weak enemy cities, and
(2) revamping the diplomacy system into a richer, relationship-driven model with a
new Non-Aggression Pact (NAP) state.

**Scope confirmed with user:**
- Expansion: **Aggressive** (capture weak enemy cities even at peace-risk; respect only
  active NAP/alliance, not merely peace).
- Diplomacy: **Full revamp** — NEUTRAL start state, NAP, ceasefire-with-expiry,
  formal war declarations, relationship-driven behavior, betrayal memory/trust.
- Add a distinct **NAP** state between WAR and PEACE.

---

## Part A — Aggressive AI City Expansion

### A1. Raise settler production & caps  (`src/ai.js:246-268`)
- Increase `settlerTarget` (currently `Math.max(4, GRID_SIZE/5)`) and `settlerCap`
  (`Math.ceil(myCityCount/2)+1`) so factions aim for more cities.
- Allow more than `maxSettlersThisTurn = 3` when the faction is safe and below target.
- Lower the defensive floor (`militaryCount < 4 || meleeCount < 1`) so expansion is
  less often blocked — but keep a small army minimum to avoid undefended founding.

### A2. Improve found-spot scoring  (`src/ai.js:776-856` `findFoundSpot`)
- Strengthen the **frontier bonus** (currently +60 if dist>8, +30 if >5, +10 if >3) so
  settlers push into new regions rather than clustering.
- Add a penalty for founding too close to strong enemy cities; add a bonus for tiles
  near weakly-defended (low fortification / no garrison) enemy cities to set up snipes.
- Prefer tiles adjacent to resources AND within reach of a defending army.

### A3. Aggressively snipe weak enemy cities  (`src/ai.js:1091-1116` `findAdjacentCapturable`, `:80-111`, `:1770-1777`)
- Add a **weakness score** for target cities: low `fortification`, small/no garrison,
  low city level. Currently capture requires `fortification <= 0` (breached). Add a
  path that lets the AI **breach then capture** in the same plan for weak cities.
- When at war, prioritize enemy cities whose garrison is below a threshold
  (`cityThreatLevel` at `:2071-2083` already computes nearby enemy strength — reuse it).
- Let conquer-army groups (role `conquest`, `:625-658`) target weak enemy cities
  directly via `pickGroupObjective` weakness weighting (`:1457/1471`).

### A4. Neutral-city rush  (`src/ai.js:636-637`, `pickGroupObjective :1433-1511`)
- `hasConquestTargets` already triggers on unowned CITY — bump the priority weight of
  neutral unclaimed cities (currently `800 - d - fort*10 + 200`) so the AI races to grab
  free cities early (first-expander advantage).

### A5. Defensive structures scale with expansion  (`src/ai.js:444-468`)
- As city count grows, ensure new cities get FORTIFICATION/SPIKES quickly so expanded
  territory isn't instantly recaptured. Tie engineer cap to `myCityCount`.

### A6. Tunables  (`src/config.js`)
- Add `SETTLER_AGGRESSION`, `WEAK_CITY_GARRISON_THRESHOLD`, `FRONTIER_BONUS` constants
  so behavior is data-driven, not hardcoded.

---

## Part B — Diplomacy System Revamp

### B1. New state model  (`src/config.js:433-438`)
Add to `DIPLOMACY_STATES`:
```
NEUTRAL: 'neutral',        // default start; can't be attacked without a formal war declaration
NAP: 'non_aggression',     // no attacks, no vision; expires after N turns
CEASEFIRE: 'ceasefire',    // temporary peace with explicit expiry turn
```
- **Initialize all pairs to NEUTRAL** instead of WAR (`src/game.js:266` loop).
- Keep WAR / PEACE / ALLIANCE / TRADE_PACT.

### B1.5 Civ6-style Grievance System (core of the revamp)
A **directed `grievances` score** per relation: `grievances[faction] = points` meaning
"how mad *this faction* is at *that faction*". This replaces the vague single
`relationship` number as the driver of hostility. Grievances accrue from concrete
aggressive acts and **decay slowly** over time (Civ6: grievances fade, they don't flip
instantly). `relationship` becomes a derived value: `relationship = baseFromState ± f(grievances)`.

**Data model** — extend per-relation struct in `diplomacy.js:18-34` (also `:47-59`,
`:66-70`) with:
```
grievances: 0,            // points THIS faction holds against the OTHER
grievanceLog: [],         // [{turn, type, amount, by}] for UI/debug
```
Global `gameState.reputation` (player) stays, but AI opinions are now driven by
per-relation `grievances`, not global rep.

**Grievance triggers** (each awards points to the *wronged* faction's side):

| Trigger | Points | Where to wire (real hooks) |
|---|---|---|
| **Units in foreign territory** (periodic, while NOT at war) | +2/turn per offending unit | New scan in `turnmanager.js:62-78` (once/round): for each unit whose `tile.owner` (`t.owner`, `map.js:342`) is a different, non-at-war faction → `addGrievance(victim, owner, 2)`. Use `relKey`/`getRelation` to skip war pairs. |
| **Founded city too close** to another faction's city | +15 | In `foundCity` (`map.js:622`) or call sites `game.js:1779`/`3449`: before claiming, scan `_factionDistance` (`game.js:2793`) / `cities` cache (`game.js:2716`); if any other faction has a city within `MIN_CITY_SPACING` (new const, e.g. 6), award grievance to that neighbor. |
| **Captured a neutral city near them** | +20 | After `captureCityTerritory` (`map.js:548`) at `game.js:1003/3192/3384/3427`: for each other faction Y with a city within `NEUTRAL_CITY_GRUDGE_RADIUS` (e.g. 8) of the captured city, `addGrievance(Y, capturer, 20)`. Call `_invalidateDiploCache()`. |
| **Captured their city** (war or snipe) | +25 | Same capture hooks when `oldOwner` is a faction (not null). |
| **Declared war on them** | +10 | `game.js:2445` (player) / `:2871` (AI) — award to target. |
| **Broke a treaty (NAP/ceasefire/peace/alliance)** | +30 + scaled | `diplomacy.js:75-77` already does `brokenTreaties++`; also push a `grievances` delta there (reads prevState). Early NAP/ceasefire break = bigger hit. |
| **Troops killed / units lost to them** | +1 per unit | Optional, in `battle.js` resolveCombat / `captureCityTerritory` messages — award victim per lost unit. (Stretch; can skip for v1.) |
| **Liberated / helped their enemy** | context | Stretch: allying a faction's rival adds grievance. |

**Decay & thresholds** (new `config.js` consts): `GRIEVANCE_DECAY_PER_TURN` (e.g. −1,
min 0), `GRIEVANCE_WAR_THRESHOLD` (e.g. 40 → AI will consider/preface war),
`GRIEVANCE_HOSTILE` (e.g. 15 → stops accepting treaties). Decay applied in
`updatePeaceCounters` (`diplomacy.js:255-273`) per relation.

**Helper API** (new in `diplomacy.js`): `addGrievance(diplo, victim, agg, amount)`,
`grievanceLevel(rel)` → 'none'|'annoyed'|'hostile'|'furious', `relationshipFromGrievances(rel, state)`.

### B2. Relation data + transitions  (`src/diplomacy.js:12-138`)
- Extend `createDiplomacyState` per-relation struct with: `expiresOn` (for NAP/ceasefire),
  `lastWarDeclaredTurn`, `formalWar` flag, `grudges` map (factionId -> turns of hostility
  memory), `trust` (derived from `brokenTreaties`).
- `setRelation` (`:63-110`): handle NEUTRAL↔NAP↔CEASEFIRE↔PEACE↔ALLIANCE↔WAR transitions;
  on entering NAP/CEASEFIRE set `expiresOn = currentTurn + duration`.
- `canAttack` (`:113-114`) → only WAR (and breach of NAP = auto-WAR). NEUTRAL/NÃP/PEACE/
  ALLIANCE/TRADE all block attacks; CEASEFIRE blocks attacks until expiry.

### B3. Expiry & drift  (`src/turnmanager.js:54-58`)
- In `updatePeaceCounters` (`diplomacy.js:255-273`): tick down NAP/CEASEFIRE; on expiry
  revert to NEUTRAL (or WAR if grudge active). Continue relationship drift.

### B4. Formal war declarations  (`src/game.js` `_aiMaybeDeclareWar :2827-2882`, `handleDiplomacy :2400-2481`)
- Declaring war from NEUTRAL/NAP/PEACE now requires a **formal declaration** that sets
  `formalWar=true`, `lastWarDeclaredTurn`, and starts a `PEACE_COOLDOWN` (already exists,
  `:2856`). Breaking NAP/ceasefire early applies a **reputation + trust penalty** and
  records a grudge.
- Player `declareWar` button triggers the same formal path; rep hit scales with how many
  active treaties were broken.

### B5. Grievance-driven AI  (`src/diplomacy.js:152-208`, `src/game.js :2781-3005`)
Now driven primarily by `grievances` (B1.5), not the old `relationship`:
- `aiDecideWar` (`diplomacy.js` ~197): base chance from personality `warChance`,
  multiplied by `min(2.5, powerRatio)`, then **modified by grievances the target holds
  against us** (`grievanceLevel`) — high grievances → AI prefers to strike first / pre-empt;
  low grievances + strong neighbor → AI still may hold (aggressive factions lower the
  `GRIEVANCE_WAR_THRESHOLD`). Also factor `brokenTreaties` (betrayal memory): a faction
  that broke treaties with us is a preferred target.
- `aiDecideTreaty` (`diplomacy.js` ~152): reject NAP/peace/alliance if
  `grievanceLevel >= hostile` unless we are losing (`localPowerBalance` unfavorable →
  offer ceasefire to buy time). NAP is the cheap low-commitment option; alliance requires
  both low grievances AND trust (`brokenTreaties == 0`).
- Distance/power scoring stays; extend **shared-enemy** + **grudge** bonuses
  (`:2813-2823`) to NAP proposals. A faction holding grievances against a common rival
  is a better NAP/alliance partner.
- `_aiMaybeDeclareWar` (`game.js:2827`): when grievances against a neighbor cross
  `GRIEVANCE_WAR_THRESHOLD` and power ratio is favorable, the AI may declare a
  *formal* war (B4) even without the player prompting — this is the Civ6 "grievance
  builds until war" behavior. Still respects `PEACE_COOLDOWN` (`:2856`).

### B6. Vision rules  (`src/game.js:3629-3689` `updateFog`)
- NAP / CEASEFIRE / PEACE grant **no** vision (unchanged). ALLIANCE grants shared vision
  (unchanged). NEUTRAL = no vision. Document clearly.

### B7. Player UI  (`src/ui.js:820-900`)
- Add buttons per state: NEUTRAL → "Propose NAP", "Declare War"; NAP → "Propose Peace",
  "Upgrade to Alliance", "Declare War" (with early-break warning); CEASEFIRE → shows
  expiry turn + "Declare War"; PEACE → existing. Show `expiresOn` countdown for NAP/
  ceasefire. Keep `getDiplomacySummary` (`diplomacy.js:276`) returning the new fields.

### B8. Reputation & trust  (`game.js`, `turnmanager.js:62-74`)
- Keep global `reputation`; make NAP/ceasefire break cost reputation like alliance break.
- `effective relationship` for AI (currently `relationship + (playerRep-50)/2`,
  `game.js:2418`) now also reduced when player has broken past treaties (read `brokenTreaties`).

### B9. Save/load  (`src/save.js:19, 76-96`)
- Whole-object serialize already covers new fields. Add backward-compat defaults for
  `expiresOn`, `grudges`, `formalWar`, `lastWarDeclaredTurn` (mirror existing fill at
  `:79-86`). Guard in `game.js:308-310` init.

---

## Implementation Order
1. **B1+B2** config + relation struct + transitions (foundation).
2. **B3+B4** expiry/drift + formal war declarations.
3. **B5+B6** relationship-driven AI + vision rules.
4. **B7+B8+B9** UI + reputation + save/load.
5. **A1–A6** expansion aggressiveness (independent; can parallel B work).
6. Manual playtest: spectate mode (`game.js` spectate) to watch AI expand & diplomatize;
   verify no crashes in save/load and turn loop.

## Risks / Notes
- `canAttack` is called ~25× in `game.js` — changing its semantics (NEUTRAL blocks attack)
  is the single highest-leverage change; must verify neutral factions can't be attacked
  accidentally and that the AI still finds war targets.
- Raising settler caps risks unit-cap saturation (`AI_MAX_UNITS`) — keep
  `capRoom()` guards (`ai.js:65`).
- `proposeTreaty` (`diplomacy.js:134-138`) is dead code; either remove or rewire during
  revamp.
- All pairs starting at NEUTRAL (not WAR) changes early-game pacing — may need to tune
  how fast factions drift to WAR.

## Verification
- `node --check` / project lint on edited files.
- Run a headless/spectate game; assert AI founds > baseline cities and forms NAPs/
  ceasefires/formal wars without errors.
- Save → reload → diplomacy state + expiry preserved.
