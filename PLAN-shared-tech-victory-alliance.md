# Shared Tech Tree, AI Victory Pursuit, and Coalition Targeting

## Overview

Three interconnected features that transform the AI from a flat conqueror into a strategic competitor:

1. **Shared Tech Tree** — AI factions actively research techs from the same global tech tree as the player
2. **AI Victory Pursuit** — AI selects a target victory type (science, economic, domination, score) and pursues it through research, economy, and warfare
3. **Coalition Targeting** — Factions detect the leading faction and form coalitions to counter it, including joint war declarations

---

## Phase 1: AI Tech Research

### Problem
The turnmanager only runs research for `PLAYER_FACTION` (`turnmanager.js:107`). AI factions never unlock advanced units — they're stuck with ancient-era units (INFANTRY, ARCHER, CAVALRY, PIKEMAN, SCOUT, SIEGE) while the player advances to ARTILLERY, CATAPHRACT, CROSSBOWMAN, etc.

### Architecture Decision: Per-Faction Tech State

The tech tree is shared (all factions research from the same pool), but each faction has its own research progress. This mirrors how Civ games work: each civ researches independently but the tech tree is global.

**Why not a single global state?** If all factions shared one `techState`, researching the same tech would complete it for everyone instantly. That eliminates the strategic choice.

### Changes

#### 1.1 — Add per-faction AI tech states to gameState

**File: `src/game.js`**

In `initState()` (around line 286), after creating `this.gameState.techState`:
```js
// Per-faction AI tech states (player uses the global techState).
this.gameState.aiTechStates = {};
for (const f of this.gameState.factions) {
    if (f === PLAYER_FACTION) continue;
    this.gameState.aiTechStates[f] = createTechState();
}
```

In `loadFromState()` (around line 388), restore from save:
```js
this.gameState.aiTechStates = {};
if (state.aiTechStates) {
    for (const [f, ts] of Object.entries(state.aiTechStates)) {
        this.gameState.aiTechStates[f] = deserializeTechState(ts);
    }
}
// Backfill any missing factions (e.g. save from before this feature).
for (const f of this.gameState.factions) {
    if (f === PLAYER_FACTION) continue;
    if (!this.gameState.aiTechStates[f]) {
        this.gameState.aiTechStates[f] = createTechState();
    }
}
```

#### 1.2 — AI auto-selects research target

**File: `src/tech.js`** — add a new function:
```js
/** Auto-select a research target for an AI faction based on personality and game state.
 *  Returns the selected tech id, or null if nothing to research. */
export function autoSelectResearch(state, personality) {
    if (state.current) return state.current; // already researching
    const available = getAvailableTechs(state);
    if (available.length === 0) return null;

    // Personality-based priority ordering
    const priorities = {
        AGGRESSIVE: ['CHIVALRY', 'GUNPOWDER', 'SIEGE_CRAFT', 'FORTIFICATION',
                     'MATHEMATICS', 'ENGINEERING', 'NAVAL_ENGINEERING', 'ANIMAL_HUSBANDRY',
                     'ARCHERY', 'BRONZE_WORKING', 'CARTOGRAPHY', 'FEUDALISM',
                     'MEDICINE', 'MACHINERY', 'MASS_PRODUCTION'],
        DEFENSIVE:  ['FORTIFICATION', 'ENGINEERING', 'MEDICINE', 'FEUDALISM',
                     'BRONZE_WORKING', 'SIEGE_CRAFT', 'MATHEMATICS', 'ARCHERY',
                     'ANIMAL_HUSBANDRY', 'NAVAL_ENGINEERING', 'CHIVALRY', 'GUNPOWDER',
                     'CARTOGRAPHY', 'MACHINERY', 'MASS_PRODUCTION'],
        ECONOMIC:   ['MATHEMATICS', 'ENGINEERING', 'NAVAL_ENGINEERING', 'MASS_PRODUCTION',
                     'CARTOGRAPHY', 'ARCHERY', 'ANIMAL_HUSBANDRY', 'BRONZE_WORKING',
                     'SIEGE_CRAFT', 'FORTIFICATION', 'CHIVALRY', 'GUNPOWDER',
                     'MEDICINE', 'FEUDALISM', 'MACHINERY'],
        BALANCED:   ['ARCHERY', 'BRONZE_WORKING', 'ANIMAL_HUSBANDRY', 'MATHEMATICS',
                     'ENGINEERING', 'NAVAL_ENGINEERING', 'SIEGE_CRAFT', 'FORTIFICATION',
                     'CHIVALRY', 'CARTOGRAPHY', 'FEUDALISM', 'GUNPOWDER',
                     'MEDICINE', 'MACHINERY', 'MASS_PRODUCTION']
    };
    const list = priorities[personality] || priorities.BALANCED;
    for (const id of list) {
        if (available.includes(id)) {
            selectResearch(state, id);
            return id;
        }
    }
    // Fallback: pick first available
    selectResearch(state, available[0]);
    return available[0];
}
```

#### 1.3 — Add AI research to turnmanager

**File: `src/turnmanager.js`** — modify `endPlayerTurn()`, after the player tech block (line 116):

```js
// AI factions research from the shared tech tree.
if (gameState.aiTechStates) {
    for (const ai of aiFactions) {
        if (gameState.eliminated && gameState.eliminated.has(ai)) continue;
        const aiTs = gameState.aiTechStates[ai];
        if (!aiTs) continue;
        // Auto-select research if none in progress.
        if (!aiTs.current) {
            const def = (gameState.factionDefs && gameState.factionDefs[ai]) || null;
            const personality = (def && def.aiPersonality) || 'BALANCED';
            autoSelectResearch(aiTs, personality);
        }
        const researchPts = calculateResearchOutput(gameState.tiles, ai);
        if (researchPts > 0) {
            const completed = addResearch(aiTs, researchPts);
            if (completed && completed.length && logger) {
                const fname = (gameState.factionColors && gameState.factionColors[ai] && gameState.factionColors[ai].name) || ai;
                for (const techId of completed) {
                    const tech = TECHS[techId];
                    logger(`${fname} researched ${tech ? tech.name : techId}!`);
                }
            }
        }
    }
}
```

#### 1.4 — AI trains tech-gated units

**File: `src/ai.js`** — modify `findAffordableUnit()` (around line 1108):

Filter `fullRoster` by the AI faction's tech state:
```js
// Get unlocked units for this faction from its tech state.
const aiTs = gameState.aiTechStates && gameState.aiTechStates[faction];
const unlockedUnits = aiTs ? getUnlockedUnits(aiTs) : new Set();
// Filter roster to only include unlocked units + always-available extras.
const availableRoster = fullRoster.filter(u =>
    unlockedUnits.has(u) || EXTRA_UNITS.includes(u) || isFactionUnique(u));
```

The `isFactionUnique` check ensures faction roster units (e.g. BERSERKER for viking) are always available even if the tech isn't researched — they're faction-specific, not tech-gated.

#### 1.5 — Save/load aiTechStates

**File: `src/save.js`**:

In `saveGame()`, add after `aiState`:
```js
aiTechStates: gameState.aiTechStates ? Object.fromEntries(
    Object.entries(gameState.aiTechStates).map(([f, ts]) => [f, serializeTechState(ts)])
) : null,
```

In `loadGame()`, add to the state object:
```js
aiTechStates: data.aiTechStates ? Object.fromEntries(
    Object.entries(data.aiTechStates).map(([f, ts]) => [f, deserializeTechState(ts)])
) : null,
```

#### 1.6 — Update scores for AI tech research

**File: `src/game.js`** — `_calculateScores()` (line 4720):

Currently only player gets tech score points. Change to count all factions:
```js
// Techs researched (10 pts each) — all factions.
const fTs = f === PLAYER_FACTION ? gs.techState : (gs.aiTechStates && gs.aiTechStates[f]);
if (fTs && fTs.researched) {
    score += fTs.researched.size * 10;
}
```

---

## Phase 2: AI Victory-Condition Pursuit

### Problem
AI plays to conquer, not to win. It doesn't know which victory condition it's pursuing, so it can't build trade routes for economic victory, accumulate gold, or prioritize science buildings.

### Design

Each AI faction has a **victory strategy** — a target victory type that influences its goal scoring, research priorities, and building choices. The strategy is chosen at game start based on personality and can shift if the faction falls behind.

| Personality | Default Victory Target | Alt Victory Target |
|------------|----------------------|-------------------|
| AGGRESSIVE | DOMINATION | SCORE |
| DEFENSIVE  | DOMINATION | SCORE |
| ECONOMIC   | ECONOMIC | SCIENCE |
| BALANCED   | DOMINATION | ECONOMIC |

### Changes

#### 2.1 — Add victoryTarget to aiState

**File: `src/ai_goals.js`** — `createAIState()`:

Add:
```js
victoryTarget: null,      // chosen victory type string (VICTORY_TYPES.*)
victoryScore: {},         // per-victory-type readiness score { domination, science, economic, score }
```

#### 2.2 — Choose victory target at game start

**File: `src/ai_goals.js`** — add new function:
```js
/** Choose a victory target for an AI faction based on personality, city count,
 *  and tech progress. Returns a VICTORY_TYPES string. */
export function chooseVictoryTarget(personality, cityCount, techCount, gold, tradeRoutes) {
    const weights = {
        AGGRESSIVE: { domination: 60, science: 10, economic: 15, score: 15 },
        DEFENSIVE:  { domination: 40, science: 15, economic: 20, score: 25 },
        ECONOMIC:   { domination: 15, science: 25, economic: 45, score: 15 },
        BALANCED:   { domination: 35, science: 15, economic: 25, score: 25 }
    };
    const w = weights[personality] || weights.BALANCED;

    // Adjust based on game state
    if (cityCount >= 5) w.domination += 10;
    if (cityCount <= 2) w.domination -= 15;
    if (techCount >= 5) w.science += 15;
    if (gold > 500) w.economic += 10;
    if (tradeRoutes >= 3) w.economic += 10;

    // Pick the weighted random winner
    const entries = Object.entries(w).filter(([, v]) => v > 0);
    const total = entries.reduce((s, [, v]) => s + v, 0);
    let r = Math.random() * total;
    for (const [type, weight] of entries) {
        r -= weight;
        if (r <= 0) return type;
    }
    return 'domination';
}
```

#### 2.3 — Adjust goal scoring based on victory target

**File: `src/ai_goals.js`** — `selectGoals()`:

After computing candidate scores, apply victory-target modifiers:
```js
const vt = aiState.victoryTarget || 'domination';
const vtModifiers = {
    domination: { conquest: 1.4, defense: 1.1, settle: 0.9, 'expand-islands': 1.0, 'develop-economy': 0.7 },
    science:    { conquest: 0.6, defense: 1.0, settle: 1.1, 'expand-islands': 0.8, 'develop-economy': 1.3 },
    economic:   { conquest: 0.5, defense: 0.8, settle: 1.2, 'expand-islands': 1.0, 'develop-economy': 1.5 },
    score:      { conquest: 0.9, defense: 1.0, settle: 1.1, 'expand-islands': 0.9, 'develop-economy': 1.1 }
};
const vtMod = vtModifiers[vt] || vtModifiers.domination;
for (const c of candidates) {
    c._score *= (vtMod[c.kind] || 1.0);
}
```

#### 2.4 — AI builds victory-relevant buildings

**File: `src/ai.js`** — modify `placeBuilding()` (around line 1432):

After the existing building priority chain, add victory-target-aware logic:
```js
const vt = aiState && aiState.victoryTarget;
// Science: prioritize MARKET in cities (gold funds research buildings)
if (vt === 'science' && !hasBuilding && !hasFarmNearby && tile.terrain === 'CITY') {
    return { key, score: 150, type: 'MARKET' };
}
// Economic: prioritize MARKET and HARBOR
if (vt === 'economic' && !hasBuilding) {
    if (tile.terrain === 'CITY') return { key, score: 160, type: 'MARKET' };
    if (isCoastal && !hasHarbor) return { key, score: 140, type: 'HARBOR' };
}
// Domination: prioritize BARRACKS and SIEGE_WORKSHOP
if (vt === 'domination' && !hasBuilding) {
    if (!hasBarracks) return { key, score: 140, type: 'BARRACKS' };
    if (!hasSiegeWorkshop) return { key, score: 130, type: 'SIEGE_WORKSHOP' };
}
```

#### 2.5 — AI prioritizes trade routes for economic victory

**File: `src/ai.js`** — modify economy block (around line 1521):

When `vt === 'economic'`, boost MARKET and HARBOR scores:
```js
if (vt === 'economic') {
    if (!hasMarket && tile.terrain === 'CITY') {
        score += 100;
    }
    if (!hasHarbor && isCoastal) {
        score += 80;
    }
}
```

#### 2.6 — AI builds space program project for science victory

**File: `src/ai.js`** — after the building block, add a new block:

```js
// --- Block 7.5: Science Victory Project ---
if (vt === 'science' && gameState.techState && gameState.techState.researched.size >= Object.keys(TECHS).length) {
    // All techs researched — start building space program
    if (!gameState.victoryState) gameState.victoryState = { projects: {}, tradeRoutes: {}, scoreSnapshots: {} };
    if (!gameState.victoryState.projects) gameState.victoryState.projects = {};
    const progress = gameState.victoryState.projects[faction] || 0;
    if (progress < SCIENCE_VICTORY_BUILD_TURNS) {
        // Find a city to build the project
        const myCities = [];
        for (const [key, t] of tiles) {
            if (t.owner === faction && t.terrain === 'CITY') myCities.push({ key, t });
        }
        if (myCities.length) {
            const city = myCities[Math.floor(Math.random() * myCities.length)];
            const res = gameState.resources[faction];
            const cost = SCIENCE_VICTORY_COST;
            if (res && res.gold >= cost.gold && res.food >= cost.food &&
                res.wood >= cost.wood && res.iron >= cost.iron) {
                res.gold -= cost.gold;
                res.food -= cost.food;
                res.wood -= cost.wood;
                res.iron -= cost.iron;
                gameState.victoryState.projects[faction] = progress + 1;
                if (logger) logger(`${factionName} building Space Program (${progress + 1}/${SCIENCE_VICTORY_BUILD_TURNS})`);
            }
        }
    }
}
```

#### 2.7 — AI accumulates gold for economic victory

**File: `src/ai.js`** — modify economy block:

When `vt === 'economic'` and gold is below `ECONOMIC_VICTORY_GOLD`, reduce spending:
```js
if (vt === 'economic') {
    const targetGold = ECONOMIC_VICTORY_GOLD;
    const currentGold = (gameState.resources[faction] && gameState.resources[faction].gold) || 0;
    if (currentGold < targetGold * 0.8) {
        // Hoard gold: skip non-essential unit training
        if (unitCount > aiState.defensiveFloor + 2) {
            // Only train if we have surplus
            continue; // skip unit training block
        }
    }
}
```

#### 2.8 — Shift victory target if falling behind

**File: `src/ai_goals.js`** — add function:
```js
/** Re-evaluate victory target every 20 turns. If we're far behind on our
 *  current target, switch to a more achievable one. */
export function reevaluteVictoryTarget(aiState, personality, scores, myFaction, turn) {
    if (turn % 20 !== 0 || turn < 20) return;
    const myScore = scores[myFaction] || 0;
    const maxScore = Math.max(...Object.values(scores));
    if (maxScore === 0) return;

    const ratio = myScore / maxScore;
    if (ratio >= 0.8) return; // we're competitive, keep current target

    // We're falling behind — consider switching
    const vt = aiState.victoryTarget;
    if (vt === 'domination' && ratio < 0.5) {
        // Switch to score or economic (less resource-intensive)
        aiState.victoryTarget = personality === 'ECONOMIC' ? 'economic' : 'score';
    } else if (vt === 'economic' && ratio < 0.6) {
        aiState.victoryTarget = 'score';
    }
    // Don't switch away from score — it's always achievable
}
```

---

## Phase 3: Coalition Targeting

### Problem
The coalition system exists in `diplomacy.js` (lines 596-648) but is never called by the AI. The AI declares solo wars without considering that a leading faction threatens everyone.

### Design

Every turn, each AI faction evaluates who the biggest threat is. If one faction dominates (owns >30% of cities, or is close to a victory), other factions form coalitions against it. The coalition leader is the strongest non-dominant faction; allies join if they have sufficient relationship with the leader.

### Changes

#### 3.1 — Add power ranking function

**File: `src/game.js`** — add new method:
```js
/** Calculate a comprehensive power ranking for each faction.
 *  Returns { factionId: { score, cities, units, techs, gold, victoryProgress } } */
calculatePowerRankings() {
    const gs = this.gameState;
    const rankings = {};
    const totalTiles = this.tiles.size;

    for (const f of FACTIONS) {
        if (gs.eliminated && gs.eliminated.has(f)) continue;
        let cities = 0, units = 0, tilesOwned = 0;
        for (const t of this.tiles.values()) {
            if (t.owner === f) {
                tilesOwned++;
                if (t.terrain === 'CITY') cities++;
            }
        }
        for (const u of gs.units.values()) {
            if (u.owner === f && !u.boarded) units++;
        }
        const gold = (gs.resources[f] && gs.resources[f].gold) || 0;
        const fTs = f === PLAYER_FACTION ? gs.techState : (gs.aiTechStates && gs.aiTechStates[f]);
        const techs = fTs && fTs.researched ? fTs.researched.size : 0;
        const tilePercent = totalTiles > 0 ? tilesOwned / totalTiles : 0;

        // Composite score (weighted)
        const score = cities * 20 + units * 3 + techs * 10 + Math.floor(gold / 50) + Math.floor(tilePercent * 100);

        rankings[f] = {
            score, cities, units, techs, gold, tilesOwned,
            tilePercent,
            isDominant: tilePercent > 0.3 || cities >= 6,
            isLeading: false // set below
        };
    }

    // Mark the leader
    let maxScore = 0, leader = null;
    for (const [f, r] of Object.entries(rankings)) {
        if (r.score > maxScore) { maxScore = r.score; leader = f; }
    }
    if (leader) rankings[leader].isLeading = true;

    return rankings;
}
```

#### 3.2 — AI evaluates coalition opportunity

**File: `src/game.js`** — add new method:
```js
/** Should this AI faction consider forming or joining a coalition?
 *  Returns { target, allies } or null. */
_evaluateCoalition(faction, def) {
    const gs = this.gameState;
    const rankings = this.calculatePowerRankings();
    const myRank = rankings[faction];
    if (!myRank) return null;

    // Find the dominant/leading faction
    let target = null;
    for (const [f, r] of Object.entries(rankings)) {
        if (f === faction) continue;
        if (r.isDominant || r.isLeading) {
            target = f;
            break;
        }
    }
    if (!target) return null;

    // Check if we're already at war with the target
    const relTarget = getRelation(gs.diplomacy, faction, target);
    if (relTarget.state === DIPLOMACY_STATES.WAR) return null;

    // Find potential allies: factions that are NOT the target and are at peace
    const candidates = FACTIONS.filter(f =>
        f !== faction && f !== target &&
        !gs.eliminated?.has(f) &&
        getRelation(gs.diplomacy, f, target).state !== DIPLOMACY_STATES.WAR
    );

    // Score potential allies by relationship with us
    const allies = [];
    for (const a of candidates) {
        const rel = getRelation(gs.diplomacy, faction, a);
        if (rel.state === DIPLOMACY_STATES.ALLIANCE || rel.relationship >= 30) {
            allies.push(a);
        }
    }

    if (allies.length === 0) return null;

    return { target, allies: allies.slice(0, COALITION_MAX_ALLIES) };
}
```

#### 3.3 — AI declares coalition war

**File: `src/game.js`** — modify `_aiMaybeDeclareWar()` (around line 3361):

Before the solo war logic, check for coalition opportunity:
```js
// Coalition war: if a faction is dominant, form a coalition against it
const coalition = this._evaluateCoalition(faction, def);
if (coalition) {
    const targetRank = rankings[coalition.target];
    const myPower = this._factionPower(faction);
    const targetPower = this._factionPower(coalition.target);

    // Only form coalition if the target is actually strong
    if (targetPower > myPower * 1.2) {
        // Check if we have enough allies to make it viable
        let alliedPower = myPower;
        for (const a of coalition.allies) alliedPower += this._factionPower(a);

        if (alliedPower > targetPower * 0.8) {
            // We can win together — declare coalition war
            const joiners = declareCoalitionWar(
                gs.diplomacy, faction, coalition.target,
                coalition.allies, gs.turn
            );
            if (logger) {
                const targetName = this.factionColors[coalition.target]?.name || coalition.target;
                const joinerNames = joiners.filter(j => j !== faction)
                    .map(j => this.factionColors[j]?.name || j).join(', ');
                logger(`${factionName} formed a coalition against ${targetName}! Allies: ${joinerNames}`);
            }
            return; // coalition war declared, skip solo war
        }
    }
}
```

#### 3.4 — Target priority scoring

**File: `src/game.js`** — enhance `_aiMaybeDeclareWar()` scoring:

When evaluating war targets, add a "threat" score based on the target's power ranking:
```js
// Threat assessment: how dangerous is this faction to us?
const targetRank = rankings ? rankings[other] : null;
if (targetRank) {
    if (targetRank.isDominant) score += 40;
    if (targetRank.isLeading) score += 20;
    // Bonus for targeting factions close to victory
    if (targetRank.victoryProgress && targetRank.victoryProgress > 0.7) score += 30;
}
```

---

## Phase 4: Victory Progress UI

### Problem
The player has no way to see how other factions are doing. There's no scoreboard, no power ranking, no way to know who's winning.

### Changes

#### 4.1 — Add power rankings to gameState

**File: `src/game.js`** — in `endPlayerTurn()` or after AI turns, compute and store rankings:
```js
// Update power rankings for the UI panel
this.gameState.powerRankings = this.calculatePowerRankings();
```

#### 4.2 — Add victory progress getter for all factions

**File: `src/game.js`** — add new method:
```js
/** Get victory progress for ALL factions (not just the player).
 *  Used by the scoreboard/ranking panel. */
getAllFactionProgress() {
    const gs = this.gameState;
    const result = {};

    for (const f of FACTIONS) {
        if (gs.eliminated && gs.eliminated.has(f)) {
            result[f] = { eliminated: true };
            continue;
        }

        const fTs = f === PLAYER_FACTION ? gs.techState : (gs.aiTechStates && gs.aiTechStates[f]);
        const techs = fTs && fTs.researched ? fTs.researched.size : 0;
        const totalTechs = Object.keys(TECHS).length;
        const cities = countCities(this.tiles, f);
        const gold = (gs.resources[f] && gs.resources[f].gold) || 0;
        const scores = this._calculateScores();

        // Victory-specific progress
        let dominationProg = 0, scienceProg = 0, economicProg = 0;
        const aiFactions = FACTIONS.filter(x => x !== f && !gs.eliminated?.has(x));
        if (aiFactions.length > 0) {
            const eliminated = aiFactions.filter(x => gs.eliminated?.has(x)).length;
            dominationProg = eliminated / aiFactions.length;
        }
        scienceProg = techs / totalTechs;
        const tradeRoutes = (gs.victoryState?.tradeRoutes?.[f]) || 0;
        economicProg = Math.min(gold / ECONOMIC_VICTORY_GOLD, tradeRoutes / ECONOMIC_VICTORY_TRADE_ROUTES);

        // Closest victory
        const victories = [
            { type: 'domination', progress: dominationProg },
            { type: 'science', progress: scienceProg },
            { type: 'economic', progress: economicProg },
            { type: 'score', progress: (gs.turn || 0) / SCORE_VICTORY_TURN }
        ];
        const closest = victories.reduce((a, b) => b.progress > a.progress ? b : a);

        result[f] = {
            score: scores[f] || 0,
            cities,
            techs,
            totalTechs,
            gold,
            victoryTarget: gs.aiTechStates?.[f]?.victoryTarget || null,
            closestVictory: closest.type,
            closestProgress: closest.progress,
            isDominant: (gs.powerRankings?.[f]?.isDominant) || false
        };
    }

    return result;
}
```

#### 4.3 — Add scoreboard UI panel

**File: `src/ui.js`** — add new panel function:

```js
showScoreboard() {
    if (!callbacks.getAllFactionProgress) return;
    const progress = callbacks.getAllFactionProgress();
    const rankings = game.gameState.powerRankings || {};

    let html = '<div class="panel scoreboard-panel">';
    html += '<h3>Scoreboard</h3>';

    // Sort by score descending
    const sorted = Object.entries(progress)
        .filter(([, p]) => !p.eliminated)
        .sort((a, b) => (b[1].score || 0) - (a[1].score || 0));

    html += '<div class="scoreboard-grid">';
    html += '<div class="sb-header"><span>Rank</span><span>Faction</span><span>Score</span><span>Cities</span><span>Tech</span><span>Gold</span><span>Target</span><span>Closest Victory</span></div>';

    sorted.forEach(([faction, data], i) => {
        const color = factionColors[faction];
        const hex = color ? '#' + color.tile.toString(16).padStart(6, '0') : '#888';
        const name = color?.name || faction;
        const pct = Math.round((data.closestProgress || 0) * 100);
        const isDom = data.isDominant ? ' <span class="dominant-tag">DOMINANT</span>' : '';
        html += `<div class="sb-row" style="border-left:3px solid ${hex};">
            <span>${i + 1}</span>
            <span style="color:${hex};font-weight:600;">${name}${isDom}</span>
            <span>${data.score || 0}</span>
            <span>${data.cities || 0}</span>
            <span>${data.techs || 0}/${data.totalTechs || 16}</span>
            <span>${data.gold || 0}g</span>
            <span>${data.victoryTarget || '—'}</span>
            <span>${data.closestVictory} ${pct}%</span>
        </div>`;
    });

    // Eliminated factions
    const eliminated = Object.entries(progress).filter(([, p]) => p.eliminated);
    if (eliminated.length) {
        html += '<div class="sb-eliminated"><h4>Eliminated</h4>';
        eliminated.forEach(([f]) => {
            const name = factionColors[f]?.name || f;
            html += `<span class="eliminated-tag">${name}</span>`;
        });
        html += '</div>';
    }

    html += '</div></div>';
    this.showPanel(html);
}
```

#### 4.4 — Add scoreboard button to top bar

**File: `src/index.html`** — in the top controls bar, add a button:
```html
<button id="btn-scoreboard" title="Scoreboard & Rankings">🏆</button>
```

**File: `src/ui.js`** — bind the button:
```js
document.getElementById('btn-scoreboard')?.addEventListener('click', () => this.showScoreboard());
```

#### 4.5 — Keyboard shortcut

Add `Tab` key to toggle scoreboard (common in strategy games).

---

## Phase 5: Tests

### New test files needed:

#### `tests/ai-tech-research.test.js`
- AI faction auto-selects research on first turn
- AI research completes over multiple turns
- AI unlocks units after researching tech
- Different personalities choose different research priorities
- AI tech state saves/loads correctly
- AI tech progress visible in scores

#### `tests/ai-victory-pursuit.test.js`
- Victory target chosen based on personality
- Goal scoring adjusted by victory target
- Science victory: AI builds space program after all techs
- Economic victory: AI accumulates gold, builds markets/harbors
- Victory target reevaluated when falling behind
- AI doesn't waste resources on impossible victory

#### `tests/coalition-targeting.test.js`
- Coalition formed against dominant faction
- Coalition requires minimum ally relationship
- Coalition war declares WAR for all members
- Coalition members share relationship penalty
- No coalition if no dominant faction
- No coalition if already at war with target
- Power rankings calculated correctly
- Threat assessment affects war target scoring

#### `tests/victory-progress-ui.test.js`
- getAllFactionProgress returns data for all factions
- Eliminated factions marked correctly
- Power rankings computed correctly
- Closest victory identified correctly

---

## File Summary

| File | Changes |
|------|---------|
| `src/tech.js` | Add `autoSelectResearch()` function |
| `src/ai_goals.js` | Add `chooseVictoryTarget()`, `reevaluteVictoryTarget()`, victory-target goal modifiers, `victoryTarget` to aiState |
| `src/turnmanager.js` | Add AI research loop after player research |
| `src/ai.js` | Filter roster by tech state, victory-target building priorities, science project block, economic hoarding logic |
| `src/game.js` | Add `aiTechStates` to gameState, `calculatePowerRankings()`, `_evaluateCoalition()`, `getAllFactionProgress()`, coalition war in `_aiMaybeDeclareWar()`, update `_calculateScores()` |
| `src/save.js` | Serialize/deserialize `aiTechStates` |
| `src/ui.js` | Add `showScoreboard()` panel, bind button |
| `src/config.js` | No changes needed (constants already exist) |
| `tests/ai-tech-research.test.js` | New file |
| `tests/ai-victory-pursuit.test.js` | New file |
| `tests/coalition-targeting.test.js` | New file |
| `tests/victory-progress-ui.test.js` | New file |

## Implementation Order

1. **Phase 1** (AI Tech Research) — foundation, everything else depends on this
2. **Phase 2** (AI Victory Pursuit) — needs tech research to be meaningful
3. **Phase 3** (Coalition Targeting) — needs power rankings which need tech research
4. **Phase 4** (Victory Progress UI) — display layer, can be done in parallel with 2/3
5. **Phase 5** (Tests) — after each phase, write tests for it

## Dependencies

- `serializeTechState`/`deserializeTechState` from `tech.js` — reuse for aiTechStates
- `SCIENCE_VICTORY_COST`, `SCIENCE_VICTORY_BUILD_TURNS`, `ECONOMIC_VICTORY_GOLD`, `ECONOMIC_VICTORY_TRADE_ROUTES` from `config.js` — already exist
- `COALITION_MAX_ALLIES`, `COALITION_JOIN_RELATIONSHIP_THRESHOLD`, `COALITION_SHARED_PENALTY` from `config.js` — already exist
- `formCoalition`, `eligibleCoalitionAllies`, `declareCoalitionWar` from `diplomacy.js` — already exist, just never called
- `getUnlockedUnits` from `tech.js` — used to filter AI unit roster
- `VICTORY_TYPES` from `config.js` — used for victory target strings
