/** AI goal-sequence system.

 The previous AI (`src/ai.js` `computeAIActions`) planned every turn from
 scratch: `detectActiveObjectives` returned a single spatial snapshot that fed
 only training composition, and `aiPersonality` was ignored entirely. This
 module introduces a persistent, ordered *goal sequence* per faction (conquest,
 settle, defense, expand-islands, develop-economy) that survives across turns
 (so plans don't thrash), is weighted by faction personality, and is consumed
 by the existing `computeAIActions` blocks to coordinate spending/movement.

 The module is pure: every function operates on the data passed in. The only
 stateful object is an `aiState` record the caller owns and mutates via
 `selectGoals`; nothing else is touched. This keeps it unit-testable without a
 Game instance (mirrors the rest of the codebase's pure-logic layer).
*/
import { AI_GOAL_MIN_STABILITY_TURNS, AI_ARTILLERY_RESERVE_DEFAULT } from './config.js';

// Goal kinds, in the canonical order used for display/debug.
export const GOAL_KINDS = ['conquest', 'defense', 'settle', 'expand-islands', 'develop-economy'];

// Personality multipliers on each goal kind's base score. AGGRESSIVE leans into
// conquest, ECONOMIC into settle/develop-economy, DEFENSIVE into defense. This
// is the first place `aiPersonality` actually shapes the AI's military/economic
// posture (it previously only affected diplomacy rolls).
const PERSONALITY_WEIGHTS = {
    AGGRESSIVE: { conquest: 1.3, defense: 0.8, settle: 0.8, 'expand-islands': 1.1, 'develop-economy': 0.6 },
    DEFENSIVE:  { conquest: 0.8, defense: 1.4, settle: 1.0, 'expand-islands': 0.8, 'develop-economy': 1.0 },
    ECONOMIC:   { conquest: 0.6, defense: 0.9, settle: 1.3, 'expand-islands': 0.9, 'develop-economy': 1.4 },
    BALANCED:   { conquest: 1.0, defense: 1.0, settle: 1.0, 'expand-islands': 1.0, 'develop-economy': 1.0 },
};

// Base scores per goal kind before personality weighting.
const BASE_SCORE = {
    conquest: 100, defense: 90, settle: 70, 'expand-islands': 80, 'develop-economy': 50,
};

function manhattan(ax, az, bx, bz) {
    return Math.abs(ax - bx) + Math.abs(az - bz);
}

/** A fresh per-faction AI state record. */
export function createAIState() {
    return {
        goals: [],                 // ordered Goal[]; [0] is the active/dominant goal
        lastPlanTurn: 0,            // turn the goals were last (re)computed
        planLockUntil: 0,           // don't replace goals before this turn (stability)
        progress: {},               // kind -> { since, attempts, lastTileKey }
        artilleryReserve: AI_ARTILLERY_RESERVE_DEFAULT,
        settlerScarcityTurns: 0,    // consecutive scarce turns (see ai.js settler block)
        prevStock: null,            // last turn's resource stock snapshot (for flow calc)
        drainingResource: null,     // worst per-turn-draining resource this turn (food/wood/iron/gold)
        lastFlow: null,              // per-resource net change vs prevStock { gold, food, wood, iron }
    };
}

/** Initialize aiState for every faction slot. */
export function initAIState(factions) {
    const out = {};
    for (const f of factions) out[f] = createAIState();
    return out;
}

/** JSON-safe serialization (the record uses only plain objects/arrays). Kept
 *  for symmetry with tech.js' serializeTechState so a future schema bump has a
 *  single touchpoint. */
export function serializeAIState(s) { return s ? JSON.parse(JSON.stringify(s)) : null; }
export function deserializeAIState(s) { return s ? JSON.parse(JSON.stringify(s)) : null; }

function ensureProgress(aiState) {
    if (!aiState.progress) aiState.progress = {};
    return aiState.progress;
}

/** Is a goal's precondition still met given the current context? A goal that
 *  becomes invalid forces a replan even inside the stability lock window.
 *  `ctx` = { enemies:Set, defensive:boolean, myCityCount, settlerTarget,
 *            scarcityTriggered, needsNavalExpansion, isIslandFaction,
 *            foreignMassWithoutCity } */
function goalValid(goal, ctx) {
    switch (goal.kind) {
        case 'conquest':
            return goal.targetFaction ? ctx.enemies.has(goal.targetFaction) : ctx.enemies.size > 0;
        case 'defense':
            return !!ctx.defensive;
        case 'settle':
            return ctx.myCityCount < ctx.settlerTarget || ctx.scarcityTriggered;
        case 'expand-islands':
            return ctx.needsNavalExpansion || (ctx.isIslandFaction && ctx.foreignMassWithoutCity);
        case 'develop-economy':
            return true; // always a valid fallback
        default:
            return false;
    }
}

/** Pick the nearest at-war enemy city to the home anchor. Returns
 *  { x, z, owner } or null. Pure, operates on the passed candidate arrays. */
function nearestEnemyCity(enemyCities, homeAnchor) {
    if (!enemyCities.length) return null;
    if (!homeAnchor) return enemyCities[0];
    let best = null, bestD = Infinity;
    for (const c of enemyCities) {
        const d = manhattan(homeAnchor.x, homeAnchor.z, c.x, c.z);
        if (d < bestD) { bestD = d; best = c; }
    }
    return best;
}

/**
 * Select (or reconfirm) this faction's ordered goal sequence.
 *
 * input = {
 *   aiState, turn, factionDef,
 *   enemies,            // iterable of enemy faction ids (at-war)
 *   enemyCities,        // [{x,z,owner}] at-war enemy cities
 *   ownCities,          // [{x,z}]
 *   homeAnchor,         // {x,z}|null (first own city / representative tile)
 *   activeObjectives,   // { siege, raid, defensive, decisive, kind } from detectActiveObjectives
 *   threatenedOwnCity,  // {x,z}|null — own city near enemy mil (defense target)
 *   isIslandFaction, needsNavalExpansion, foreignMassWithoutCity,
 *   myCityCount, settlerTarget, scarcityTriggered,
 *   bestFoundSpotKey,   // string|null — cached settle target tile key
 *   foreignShoreKey,    // string|null — expand-islands target tile key
 *   bestEconTileKey,    // string|null — develop-economy target tile key
 * }
 * Returns the ordered Goal[] (also written to aiState.goals when re-planned).
 */
export function selectGoals(input) {
    const {
        aiState, turn, factionDef,
        enemies, enemyCities, ownCities, homeAnchor,
        activeObjectives = {}, threatenedOwnCity = null,
        isIslandFaction = false, needsNavalExpansion = false, foreignMassWithoutCity = false,
        myCityCount = 0, settlerTarget = 8, scarcityTriggered = false,
        bestFoundSpotKey = null, foreignShoreKey = null, bestEconTileKey = null,
    } = input;

    const enemySet = new Set(enemies || []);
    const ctx = {
        enemies: enemySet, defensive: !!activeObjectives.defensive,
        myCityCount, settlerTarget, scarcityTriggered,
        needsNavalExpansion, isIslandFaction, foreignMassWithoutCity,
    };

    // Stability: keep the existing plan if it's still locked and every goal is
    // still valid. The dominant (first) goal being invalid forces a replan.
    if (aiState && Array.isArray(aiState.goals) && aiState.goals.length &&
        turn < (aiState.planLockUntil || 0)) {
        if (goalValid(aiState.goals[0], ctx)) return aiState.goals;
        // else fall through to replan
    }

    const personality = (factionDef && factionDef.aiPersonality) || 'BALANCED';
    const weights = PERSONALITY_WEIGHTS[personality] || PERSONALITY_WEIGHTS.BALANCED;

    const candidates = [];
    const push = (kind, score, targetTileKey, targetFaction, horizon, meta) => {
        candidates.push({
            kind,
            priority: 0,            // normalized after sorting
            horizon,
            targetTileKey: targetTileKey || null,
            targetFaction: targetFaction || null,
            meta: meta || {},
            stabilityTurns: AI_GOAL_MIN_STABILITY_TURNS,
            born: turn,
            _score: score,           // raw weighted score (stripped before return)
        });
    };

    // Conquest: at least one at-war enemy. Target nearest enemy city.
    if (enemySet.size > 0) {
        const tgt = nearestEnemyCity(enemyCities, homeAnchor);
        push('conquest',
            BASE_SCORE.conquest * weights.conquest,
            tgt ? `${tgt.x},${tgt.z}` : null,
            tgt ? tgt.owner : (enemySet.values().next().value || null),
            'short',
            { cityX: tgt ? tgt.x : null, cityZ: tgt ? tgt.z : null });
    }
    // Defense: an own city is threatened.
    if (activeObjectives.defensive && threatenedOwnCity) {
        push('defense',
            BASE_SCORE.defense * weights.defense,
            `${threatenedOwnCity.x},${threatenedOwnCity.z}`,
            null, 'immediate', {});
    }
    // Settle: below target city count, or scarce on resources.
    if (myCityCount < settlerTarget || scarcityTriggered) {
        push('settle',
            (BASE_SCORE.settle + (scarcityTriggered ? 40 : 0)) * weights.settle,
            bestFoundSpotKey, null, 'long', { scarcityTriggered });
    }
    // Expand to new islands: needs a fleet to reach foreign land.
    if (needsNavalExpansion || (isIslandFaction && foreignMassWithoutCity)) {
        push('expand-islands',
            BASE_SCORE['expand-islands'] * weights['expand-islands'],
            foreignShoreKey, null, 'long', {});
    }
    // Develop economy: always a valid baseline.
    push('develop-economy',
        BASE_SCORE['develop-economy'] * weights['develop-economy'],
        bestEconTileKey, null, 'long', {});

    // Sort by weighted score desc, keep the top 3.
    candidates.sort((a, b) => b._score - a._score);
    const goals = candidates.slice(0, 3);

    // Normalize priorities to 0..1 from the top score.
    const topScore = goals.length ? goals[0]._score : 1;
    for (const g of goals) g.priority = topScore > 0 ? g._score / topScore : 0;

    // Strip the raw score helper before persisting/returning.
    for (const g of goals) delete g._score;

    if (aiState) {
        aiState.goals = goals;
        aiState.lastPlanTurn = turn;
        aiState.planLockUntil = turn + AI_GOAL_MIN_STABILITY_TURNS;
        // Cache the settle found-spot so ai.js' settler block can reuse it.
        const prog = ensureProgress(aiState);
        const settleGoal = goals.find(g => g.kind === 'settle');
        if (settleGoal && bestFoundSpotKey) {
            prog.settle = prog.settle || { since: turn, attempts: 0, lastTileKey: null };
            prog.settle.lastTileKey = bestFoundSpotKey;
        }
    }
    return goals;
}

/** Build the AI Goals debug-panel HTML (pure string — testable without a DOM).
 *  `factions` is the ordered list of faction slots to render; `factionDefs` and
 *  `factionColors` map slot -> def / color. `spectateMode` controls whether the
 *  player's own slot (if any) is shown too. */
export function buildAIGoalsHTML(aiState, factions, factionDefs, factionColors, spectateMode = true) {
    if (!aiState) return '<h3>AI Goals</h3><p class="muted">No AI state</p>';
    let rows = '';
    for (const slot of factions) {
        const st = aiState[slot];
        if (!st || !Array.isArray(st.goals) || !st.goals.length) continue;
        const def = factionDefs && factionDefs[slot];
        const color = factionColors && factionColors[slot];
        const colorHex = (color && typeof color.tile === 'number')
            ? '#' + color.tile.toString(16).padStart(6, '0')
            : '#888';
        const name = (def && (def.name || (color && color.name))) || slot;
        const emoji = (def && def.emoji) || '';
        const goalHtml = st.goals.map((g, i) => {
            const mark = i === 0 ? '★' : '·';
            const tgt = g.targetTileKey ? ` → ${g.targetTileKey}` : '';
            const pct = Math.round((g.priority || 0) * 100);
            return `<div style="font-size:11px;line-height:1.35;">${mark} <strong>${g.kind}</strong> <span class="muted">(p=${pct}%, ${g.horizon})${tgt}</span></div>`;
        }).join('');
        rows += `<div style="margin:4px 0;padding:4px 6px;border-left:3px solid ${colorHex};background:rgba(255,255,255,0.03);">
  <div style="font-weight:600;">${emoji} ${name}</div>${goalHtml}</div>`;
    }
    if (!rows) rows = '<p class="muted">No active goals</p>';
    return `<h3>AI Goals</h3>${rows}`;
}