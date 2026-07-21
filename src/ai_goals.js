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
export const GOAL_KINDS = ['conquest', 'defense', 'settle', 'expand-islands', 'develop-economy',
    'diplomacy', 'spy', 'chokepoint', 'scout', 'attack-king'];

// Personality multipliers on each goal kind's base score. AGGRESSIVE leans into
// conquest, ECONOMIC into settle/develop-economy, DEFENSIVE into defense. This
// is the first place `aiPersonality` actually shapes the AI's military/economic
// posture (it previously only affected diplomacy rolls).
const PERSONALITY_WEIGHTS = {
    AGGRESSIVE: { conquest: 1.3, defense: 0.8, settle: 0.8, 'expand-islands': 1.1, 'develop-economy': 0.6,
                  diplomacy: 0.6, spy: 0.8, chokepoint: 1.1, scout: 0.7, 'attack-king': 1.4 },
    DEFENSIVE:  { conquest: 0.8, defense: 1.4, settle: 1.0, 'expand-islands': 0.8, 'develop-economy': 1.0,
                  diplomacy: 1.0, spy: 0.9, chokepoint: 1.3, scout: 0.8, 'attack-king': 0.6 },
    ECONOMIC:   { conquest: 0.6, defense: 0.9, settle: 1.0, 'expand-islands': 0.9, 'develop-economy': 1.4,
                  diplomacy: 1.3, spy: 1.1, chokepoint: 0.7, scout: 0.9, 'attack-king': 0.7 },
    BALANCED:   { conquest: 1.0, defense: 1.0, settle: 1.0, 'expand-islands': 1.0, 'develop-economy': 1.0,
                  diplomacy: 1.0, spy: 1.0, chokepoint: 1.0, scout: 1.0, 'attack-king': 1.0 },
};

// Base scores per goal kind before personality weighting.
const BASE_SCORE = {
    conquest: 100, defense: 90, settle: 70, 'expand-islands': 80, 'develop-economy': 50,
    diplomacy: 40, spy: 35, chokepoint: 45, scout: 55, 'attack-king': 85,
};

function manhattan(ax, az, bx, bz) {
    return Math.abs(ax - bx) + Math.abs(az - bz);
}

/** Classify the current game phase by turn number.
 *  Early game: exploration and expansion. Mid: military buildup and wars.
 *  Late: victory-condition push. */
function computeGamePhase(turn) {
    if (turn < 30) return 'early';
    if (turn < 80) return 'mid';
    return 'late';
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
        victoryTarget: null,        // chosen victory type string ('domination'|'science'|'economic'|'score')
    };
}

/** Initialize aiState for every faction slot. */
export function initAIState(factions) {
    const out = {};
    for (const f of factions) out[f] = createAIState();
    return out;
}

/** Choose a victory target for an AI faction based on personality and game state.
 *  Returns a VICTORY_TYPES string. */
export function chooseVictoryTarget(personality, cityCount, techCount, gold, tradeRoutes) {
    const weights = {
        AGGRESSIVE: { domination: 60, science: 10, economic: 15, score: 15 },
        DEFENSIVE:  { domination: 40, science: 15, economic: 20, score: 25 },
        ECONOMIC:   { domination: 15, science: 25, economic: 45, score: 15 },
        BALANCED:   { domination: 35, science: 15, economic: 25, score: 25 }
    };
    const w = { ...(weights[personality] || weights.BALANCED) };

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

/** Re-evaluate victory target every 20 turns. If we're far behind on our
 *  current target, switch to a more achievable one. */
export function reevaluateVictoryTarget(aiState, personality, scores, myFaction, turn) {
    if (turn % 20 !== 0 || turn < 20) return;
    const myScore = scores[myFaction] || 0;
    const maxScore = Math.max(...Object.values(scores));
    if (maxScore === 0) return;

    const ratio = myScore / maxScore;
    if (ratio >= 0.8) return; // we're competitive, keep current target

    // We're falling behind — consider switching
    const vt = aiState.victoryTarget;
    if (vt === 'domination' && ratio < 0.5) {
        aiState.victoryTarget = personality === 'ECONOMIC' ? 'economic' : 'score';
    } else if (vt === 'economic' && ratio < 0.6) {
        aiState.victoryTarget = 'score';
    }
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
 *            foreignMassWithoutCity, neutralFactions:Set, hasSpies:boolean,
 *            hasChokepoints:boolean, unexploredTiles:number } */
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
        case 'diplomacy':
            return (ctx.neutralFactions && ctx.neutralFactions.size > 0) || ctx.enemies.size === 0;
        case 'spy':
            return ctx.enemies.size > 0 && ctx.hasSpies;
        case 'chokepoint':
            return !!ctx.hasChokepoints;
        case 'scout':
            return (ctx.unexploredTiles || 0) > 20;
        case 'attack-king':
            // Valid while at war with the target faction. If the king died or
            // the war ended, the goal is dropped on the next replan.
            return goal.targetFaction ? ctx.enemies.has(goal.targetFaction) : ctx.enemies.size > 0;
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
 *   neutralFactions,    // Set — factions we're not at war with (for diplomacy goal)
 *   hasSpies,           // boolean — does the faction have SPY units (for spy goal)
 *   hasChokepoints,     // boolean — are there mountain passes/bridges near borders
 *   unexploredTiles,    // number — count of tiles not yet owned by anyone (for scout goal)
 *   spyTargetKey,       // string|null — tile key of nearest enemy city (for spy goal)
 *   chokepointKey,      // string|null — tile key of a strategic chokepoint
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
        neutralFactions = new Set(), hasSpies = false, hasChokepoints = false,
        unexploredTiles = 0, spyTargetKey = null, chokepointKey = null,
        enemyKings = [],
    } = input;

    const enemySet = new Set(enemies || []);
    const ctx = {
        enemies: enemySet, defensive: !!activeObjectives.defensive,
        myCityCount, settlerTarget, scarcityTriggered,
        needsNavalExpansion, isIslandFaction, foreignMassWithoutCity,
        neutralFactions, hasSpies, hasChokepoints, unexploredTiles,
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

    // Diplomacy: pursue trade/alliance when at peace with neighbors or not at war.
    // Higher score when there are neutral factions to trade with and we're not
    // currently at war (so diplomacy is useful, not wasted).
    if (neutralFactions.size > 0 || enemySet.size === 0) {
        const diplomacyBonus = enemySet.size === 0 ? 30 : 0;
        push('diplomacy',
            (BASE_SCORE.diplomacy + diplomacyBonus) * weights.diplomacy,
            null, null, 'medium', {});
    }
    // Spy: use espionage when at war and we have spy units.
    if (enemySet.size > 0 && hasSpies) {
        push('spy',
            BASE_SCORE.spy * weights.spy,
            spyTargetKey, null, 'medium', { spyAction: 'GATHER_INTEL' });
    }
    // Chokepoint: control strategic passes/bridges when they exist near borders.
    if (hasChokepoints) {
        push('chokepoint',
            BASE_SCORE.chokepoint * weights.chokepoint,
            chokepointKey, null, 'medium', {});
    }
    // Scout: explore unexplored regions, especially in early game.
    if (unexploredTiles > 20) {
        push('scout',
            BASE_SCORE.scout * weights.scout,
            null, null, 'long', {});
    }

    // Attack Enemy King: when an at-war enemy king is exposed (no bodyguard
    // unit on its tile), prioritize assassinating it — a faction whose king
    // dies is eliminated, the single highest-value action in the game. The
    // goal targets the king's current tile and stores the king id in meta.
    {
        const exposedKing = enemyKings.find(king =>
            king.owner !== factionDef.id &&
            enemySet.has(king.owner) &&
            king.isKing && !king.guarded);
        if (exposedKing) {
            const d = manhattan(homeAnchor.x, homeAnchor.z, exposedKing.x, exposedKing.z);
            // Closer exposed kings score higher; the base (85) puts it just
            // below conquest so a live conquest still wins when the king is
            // far away but a nearby exposed king jumps to the top.
            const score = (BASE_SCORE['attack-king'] - d * 0.5) * weights['attack-king'];
            push('attack-king',
                score,
                `${exposedKing.x},${exposedKing.z}`,
                exposedKing.owner,
                'immediate',
                { kingId: exposedKing.id });
        }
    }

    // Victory-target modifiers: weight goals based on the chosen victory type.
    const vt = (aiState && aiState.victoryTarget) || 'domination';
    const vtModifiers = {
        domination: { conquest: 1.4, defense: 1.1, settle: 0.9, 'expand-islands': 1.0, 'develop-economy': 0.7,
                      diplomacy: 0.6, spy: 1.2, chokepoint: 1.1, scout: 0.7, 'attack-king': 1.3 },
        science:    { conquest: 0.6, defense: 1.0, settle: 1.1, 'expand-islands': 0.8, 'develop-economy': 1.3,
                      diplomacy: 1.0, spy: 1.1, chokepoint: 0.8, scout: 1.0, 'attack-king': 0.9 },
        economic:   { conquest: 0.5, defense: 0.8, settle: 1.2, 'expand-islands': 1.0, 'develop-economy': 1.5,
                      diplomacy: 1.3, spy: 0.9, chokepoint: 0.7, scout: 0.9, 'attack-king': 0.8 },
        score:      { conquest: 0.9, defense: 1.0, settle: 1.1, 'expand-islands': 0.9, 'develop-economy': 1.1,
                      diplomacy: 1.0, spy: 1.0, chokepoint: 1.0, scout: 1.0, 'attack-king': 1.1 }
    };
    const vtMod = vtModifiers[vt] || vtModifiers.domination;
    for (const c of candidates) {
        c._score *= (vtMod[c.kind] || 1.0);
    }

    // Game-phase modifiers: early game favors scouting and expansion, mid-game
    // favors military buildup and conquest, late game pushes victory conditions.
    const phase = computeGamePhase(turn);
    const phaseMod = {
        early:  { conquest: 0.7, defense: 0.8, settle: 1.4, 'expand-islands': 1.2, 'develop-economy': 1.1,
                  diplomacy: 0.9, spy: 0.5, chokepoint: 0.6, scout: 1.5, 'attack-king': 0.9 },
        mid:    { conquest: 1.1, defense: 1.0, settle: 1.0, 'expand-islands': 1.0, 'develop-economy': 1.0,
                  diplomacy: 1.0, spy: 1.0, chokepoint: 1.0, scout: 0.7, 'attack-king': 1.1 },
        late:   { conquest: 1.3, defense: 1.1, settle: 0.6, 'expand-islands': 0.8, 'develop-economy': 0.8,
                  diplomacy: 0.7, spy: 1.2, chokepoint: 1.1, scout: 0.4, 'attack-king': 1.3 },
    };
    const pm = phaseMod[phase] || phaseMod.mid;
    for (const c of candidates) {
        c._score *= (pm[c.kind] || 1.0);
    }

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