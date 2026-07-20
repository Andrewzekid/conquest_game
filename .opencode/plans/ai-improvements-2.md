# AI Improvements — Phase 2

## Overview

Builds on the Phase 1 grievance/diplomacy/expansion system. Fixes critical bugs, wires the grievance system into AI decisions, adds economic AI (the biggest gap), improves tactical combat, and adds lord/naval/polish features.

---

## Priority 1: Bug Fixes (~20 lines)

### 1a — Undefined `tension` in NAP/ceasefire scoring
- **File:** `src/game.js:2972,2978`
- **Bug:** `tension` used but never defined; the NAP penalty (`napScore -= 50`) and ceasefire penalty (`ceasefireScore -= 30`) against high tension are dead code.
- **Fix:** Add `const tension = getTension(diplo, faction, other);` at line ~2925 (alongside existing `lvl`). Ensure `getTension` is imported at top of file.
- **Test:** With grievances ≥ 20 against a faction, AI should be ~50% less likely to propose NAP that turn.

### 1b — Chariot charge terrain check casing
- **File:** `src/ai.js:1740`
- **Bug:** `'water'` and `'mountain'` lowercase; config.js uses uppercase `'WATER'`/`'MOUNTAIN'`. Chariots can charge through water.
- **Fix:** Change `'water'` → `'WATER'`, `'mountain'` → `'MOUNTAIN'`.

### 1c — AI war declarations don't add grievances
- **File:** `src/game.js` `_aiMaybeDeclareWar` (~line 2889)
- **Bug:** Only the player's `declareWar` in `handleDiplomacy` calls `addGrievance`. The AI declares war for free — the target never gets angry.
- **Fix:** After `setRelation(diplo, faction, other, DIPLOMACY_STATES.WAR)`, add `addGrievance(diplo, other, faction, 10, 'war declared')`. If breaking NAP, add extra +25.
- **Test:** After AI declares war, diplomatic summary for the target should show 10+ grievances against the attacker.

### 1d — `NEUTRAL_CITY_GRUDGE_RADIUS` dead config
- **File:** `src/config.js:446`, `src/game.js` `_awardCaptureGrievances`
- **Bug:** The constant `NEUTRAL_CITY_GRUDGE_RADIUS` is defined but never imported or checked. The capture grievance function exists but ignores the radius check.
- **Fix:** Import into game.js. In `_awardCaptureGrievances`, scan factions with cities within this radius and only award neighbor grievances within the range.

---

## Priority 2: Grievance-Driven War & Diplomacy (~40 lines)

The grievance system is built but doesn't influence AI. Wired correctly, it creates the "tension spiral → war" dynamic from Civ6.

### 2a — Grievances drive war likelihood
- **File:** `src/game.js` `_aiMaybeDeclareWar` (scoring loop, ~line 2870)
- **Change:** Add `score += tension * 0.3` to each candidate's score (where `tension` is `getTension(diplo, faction, other)`). At the GRIEVANCE_WAR_THRESHOLD of 40, this adds +12 — enough to meaningfully push borderline candidates over the edge.
- **Impact:** A faction that has accumulated grievances (e.g., trespass + city captures) against another will substantially increase its war odds.

### 2b — Grievances lower treaty acceptance
- **File:** `src/diplomacy.js` `aiDecideTreaty`
- **Change:** Add `grievances` parameter (directed: grievances the deciding faction holds against the offering faction). Apply penalty: `-0.05 per 10 grievances`, capped at `-0.25`. Apply this to ALL treaty types (peace, trade, alliance, NAP, ceasefire).
- **Impact:** A faction with 50+ grievances will be ~25% less likely to accept any treaty from that faction.

### 2c — Trespass escalation spiral
- **File:** `src/turnmanager.js:80-90`
- **Change:** Double the trespass grievance (2→4) when the aggrieved faction's `grievanceLevel` is already `hostile` against the trespasser. Creates a feedback loop: more trespass → more grievances → more trespass penalties → war.
- **Impact:** Prolonged peacetime troop positioning in foreign territory becomes increasingly provocative, making war more likely over time.

### 2d — Denunciation event
- **File:** `src/game.js` new helper, called from `updatePeaceCounters` or similar periodic tick
- **Change:** When `grievanceLevel` reaches `furious` (tension ≥ 40) for an AI faction against the player, create a `diplomaticEvents` entry of type `'denounce'` and apply a -5 player reputation penalty. Display in the UI's diplomatic events log.
- **Impact:** Gives the player visible feedback that their actions have angered an AI faction, serving as a warning before war.

---

## Priority 3: Economic AI (~80 lines)

The biggest gap. The AI is strong tactically but has zero economic strategy — it never sells resources, builds walls, or boosts cities.

### 3a — Sell excess resources at market
- **File:** `src/ai.js` `computeAIActions`, before the training loop (~line 85)
- **Change:** After the capture-first pass (step 0) and before training (step 2), check resource stockpiles:
  ```js
  // Sell excess resources at market to fund military
  if ((res.gold || 0) < 30) {
      for (const r of ['iron', 'wood', 'food']) {
          if ((res[r] || 0) > 50) {
              const sellAmt = Math.min(res[r] - 20, 30); // keep 20, sell up to 30
              const goldGain = sellAmt * MARKET_RATES[r]; // MARKET_RATES from config
              res.gold = (res.gold || 0) + goldGain;
              res[r] -= sellAmt;
          }
      }
  }
  ```
- **Requires:** Import `MARKET_RATES` (or define a simple 0.5 ratio) and `sellAtMarket` from `economy.js`.
- **Impact:** Prevents the AI from gold-starving with 200 wood in the bank. Most impactful single change for AI competitiveness.

### 3b — Build walls in border cities
- **File:** `src/ai.js` building priority (step 1, after Siege Workshop, ~line 150)
- **Change:** Add walls as a building option. For each owned city, if within 6 tiles of an enemy city and no WALLS building exists, add to build queue. Priority below Siege Workshop but above economy buildings.
- **Requires:** Import `BUILDING_TYPE` if not already imported; `BUILDING_TYPE.WALLS` should exist in config.
- **Impact:** AI cities become significantly harder to capture, forcing the player to bring siege.

### 3c — City level-up investment
- **File:** `src/ai.js` `computeAIActions`, new block after economy buildings (~line 350)
- **Change:** For each city reachable by a worker, if the city has all terrain improvements built AND has excess food (surplus > 5), spend `CITY_LEVEL_UP_COST` to boost growth.
- **Requires:** Check if `CITY_LEVEL_UP_COST` exists in config; verify there's a mechanism to spend resources on city growth (e.g., a `boostCityGrowth` function).
- **Impact:** Border cities level up faster, expanding influence and claiming more tiles for the AI.

### 3d — Trade route establishment
- **File:** `src/ai.js` after building Harbor (~line 245)
- **Change:** After building a Harbor, establish a trade route with a friendly faction. If `getTradeRouteIncome` or `establishTradeRoute` exists, call it. Otherwise, add a simple +2 gold per turn bonus for having any Harbor + trading partner.
- **Impact:** Adds passive income for AI factions with Harbors.

---

## Priority 4: Tactical Combat Improvements (~80 lines)

### 4a — Universal retreat below 20% HP
- **File:** `src/ai.js` `planGroup` step 1 (line ~1685)
- **Change:** Add `u.hp < u.maxHp * 0.2` as a universal retreat trigger for ALL unit types, not just fragile ones.
- **Impact:** Prevents wounded melee units from fighting to the death when they have no chance.

### 4b — Wider retreat evaluation radius
- **File:** `src/ai.js` `localPowerBalance` (line ~1337) and `computeStance` call site
- **Change:** For `computeStance` and retreat decisions, increase the power balance radius from Chebyshev 2 to 4. The current radius is too short — enemies 3 tiles away are invisible.
- **Impact:** Army groups correctly assess threats approaching from beyond immediate contact range.

### 4c — Settler escort
- **File:** `src/ai.js` settler movement block (~line 370)
- **Change:** After finding a settle spot, scan for the nearest non-settler military unit within 5 tiles. If one exists and is idle (no other action), set both the settler and the escort to move toward the found spot. If no escort available, the settler waits 1-2 turns (skips this turn) rather than walking unguarded.
- **Impact:** Dramatically reduces settler deaths to player cavalry/raiders.

### 4d — Siege AOE targeting
- **File:** `src/ai.js` `planGroup` ranged step (~line 1826)
- **Change:** When evaluating targets for CATAPULT/TREBUCHET (units with `aoe: true`), add +30 score if the target has 2+ enemy units in splash range (Chebyshev 1). Check unit config's `aoe` property.
- **Impact:** The AI uses catapults/trebuchets to hit clustered enemies, making siege units more effective in field battles.

### 4e — Multi-front awareness in army groups
- **File:** `src/ai.js` conquest/patrol assignment (~line 647)
- **Change:** Instead of assigning the top ~50% of groups to conquest with no spatial awareness, cluster enemy cities by region (e.g., nearest 3 cities form a front). Assign each conquest group to a different front. Patrol groups stay near friendly cities on the opposite side from conquered targets.
- **Impact:** Prevents the "both armies march east while the western border is undefended" problem.

---

## Priority 5: Lord & Governor AI (~50 lines)

### 5a — Assign governor lords
- **File:** `src/ai.js` new function called from `computeAIActions`
- **Change:** After recruiting a lord, evaluate if they should govern a city. Criteria: has `ADMINISTRATOR` ability, or no army assigned and no combat bonuses. Best city: highest population or capital. Call `assignGovernance` from `lords.js`.
- **Impact:** Lords with ADMINISTRATOR provide +50% city yields instead of wandering uselessly.

### 5b — King protection
- **File:** `src/ai.js` army group assignment (~line 630)
- **Change:** If a lord/king has <3 friendly units within radius 2, mark the nearest army group as "king's guard" — their objective moves to within 3 tiles of the king. Overrides conquest/patrol assignment.
- **Impact:** Prevents the king from being assassinated alone.

### 5c — Lord movement in army groups
- **File:** `src/ai.js` `planGroup` after advance step (~line 1890)
- **Change:** After all units in a group have acted, issue a `moveToward` action for any lord in the group to move toward the group centroid. Only if the lord hasn't already moved this turn (attacked, charged, etc.).
- **Impact:** Lords don't get left behind when their army advances.

---

## Priority 6: Naval & Amphibious (~60 lines)

### 6a — Naval escort for transports
- **File:** `src/ai.js` transport handling (~line 560)
- **Change:** When a loaded transport begins moving toward a landing zone, check if any friendly warship is within 3 tiles. If not, assign the nearest free warship to step toward the transport (escort behavior). If no warship is available, the transport still proceeds, but at higher risk.
- **Impact:** Transports are less vulnerable to interception.

### 6b — Amphibious assault (transport military units)
- **File:** `src/ai.js` new action type "load military"
- **Change:** Allow transports to carry non-settler military units. When a transport is empty and near a shore with idle military units, load them. When near an enemy coastal city, disembark for assault. This requires:
  - Adding a `boarded` flag check for military units (currently only settlers)
  - Creating a `disembark` action that places units adjacent to the transport
- **Impact:** Enables full naval invasions, not just settler colonization.

### 6c — Harbor blockade
- **File:** `src/ai.js` warship movement (~line 600)
- **Change:** When a warship has no adjacent attack target and is near an enemy Harbor city, step toward a tile adjacent to the Harbor and stay there. While adjacent to an enemy Harbor, that Harbor's ship production is disabled (add check to `canAfford`/`roster.includes` for naval units).
- **Impact:** AI can strategically disable enemy navies.

---

## Priority 7: Polish & Balance (~40 lines)

### 7a — `BALANCED` personality
- **File:** `src/config.js`
- **Change:** Add `BALANCED: { warChance: 0.5, acceptAlliance: 0.2, acceptTrade: 0.3, acceptPeace: 0.4 }`. Already referenced by `_getDiplomaticStrategy` in game.js. Can be used for new factions.
- **Impact:** Fills the gap between DEFENSIVE and AGGRESSIVE.

### 7b — Improved power formula
- **File:** `src/game.js` `_factionPower` (~line 2774)
- **Change:** Weight units by role: scouts × 0.5, workers/settlers × 0 (non-combat), infantry × 1, cavalry × 1.5, siege × 2, lords × 3. Add +3 per city fortification level (total of all city levels). Add +5 per walled city.
- **Impact:** AI power calculations better reflect actual military strength.

### 7c — Trade material negotiation
- **File:** `src/game.js` `_aiMaybeProposeTreaty` (~line 3044)
- **Change:** When establishing a trade pact, pick the export material based on resource surplus:
  - If `resources[faction].iron > 50` → export `IRON`
  - Else if `resources[faction].wood > 50` → export `WOOD`
  - Else → export `GOLD` (default)
- **Impact:** AI trade pacts export meaningful resources instead of always defaulting to gold.

### 7d — Stale offer cleanup
- **File:** `src/game.js` `_aiMaybeProposeTreaty` (~line 3024)
- **Change:** At the start of the function, filter `diplo.pendingOffers` to remove offers where `faction` is the proposer AND `gameState.turn - turnProposed > 10`.
- **Impact:** Prevents stale UI entries.

---

## Files Affected

| File | Lines Changed | Features |
|------|--------------|----------|
| `src/config.js` | +5 | BALANCED personality |
| `src/diplomacy.js` | ~10 | aiDecideTreaty grievance parameter |
| `src/game.js` | ~80 | 1a, 1c, 1d, 2a, 2d, 7b, 7c, 7d |
| `src/ai.js` | ~150 | 1b, 3a, 3b, 3c, 3d, 4a, 4b, 4c, 4d, 4e, 5a, 5b, 5c, 6a, 6b, 6c |
| `src/turnmanager.js` | ~5 | 2c |
| `src/economy.js` | ~0 | (use `sellAtMarket` if it exists, otherwise minor) |
