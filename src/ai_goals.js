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
import { AI_GOAL_MIN_STABILITY_TURNS, AI_ARTILLERY_RESERVE_DEFAULT,
         WAR_OBJECTIVE_CAPITAL_BONUS, WAR_OBJECTIVE_KEY_BUILDING_BONUS,
         WAR_OBJECTIVE_VICTORY_LEADER_BONUS, WAR_OBJECTIVE_RESOURCE_CONTENDER_BONUS,
         WAR_OBJECTIVE_MIN_CITIES, GRID_SIZE } from './config.js';

// Goal kinds, in the canonical order used for display/debug.
export const GOAL_KINDS = ['conquest', 'defense', 'settle', 'expand-islands', 'develop-economy',
    'diplomacy', 'spy', 'chokepoint', 'scout', 'attack-king',
    'take-key-city', 'disrupt-victory', 'resource-war'];

// Personality multipliers on each goal kind's base score. AGGRESSIVE leans into
// conquest, ECONOMIC into settle/develop-economy, DEFENSIVE into defense. This
// is the first place `aiPersonality` actually shapes the AI's military/economic
// posture (it previously only affected diplomacy rolls).
const PERSONALITY_WEIGHTS = {
    AGGRESSIVE: { conquest: 1.3, defense: 0.8, settle: 0.8, 'expand-islands': 1.1, 'develop-economy': 0.6,
                  diplomacy: 0.6, spy: 0.8, chokepoint: 1.1, scout: 0.7, 'attack-king': 1.4 },
    DEFENSIVE:  { conquest: 0.8, defense: 1.4, settle: 1.0, 'expand-islands': 0.8, 'develop-economy': 1.0,
                  diplomacy: 1.0, spy: 0.9, chokepoint: 1.3, scout: 0.8, 'attack-king': 0.6 },
    ECONOMIC:   { conquest: 0.6, defense: 0.9, settle: 1.3, 'expand-islands': 0.9, 'develop-economy': 1.4,
                  diplomacy: 1.3, spy: 1.1, chokepoint: 0.7, scout: 0.9, 'attack-king': 0.7 },
    BALANCED:   { conquest: 1.0, defense: 1.0, settle: 1.0, 'expand-islands': 1.0, 'develop-economy': 1.0,
                  diplomacy: 1.0, spy: 1.0, chokepoint: 1.0, scout: 1.0, 'attack-king': 1.0 },
};

// Base scores per goal kind before personality weighting.
const BASE_SCORE = {
    conquest: 100, defense: 90, settle: 70, 'expand-islands': 80, 'develop-economy': 50,
    diplomacy: 40, spy: 35, chokepoint: 45, scout: 55, 'attack-king': 85,
    'take-key-city': 75, 'disrupt-victory': 90, 'resource-war': 65,
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
        case 'conquest': {
            if (goal.targetFaction ? !ctx.enemies.has(goal.targetFaction) : ctx.enemies.size === 0) return false;
            // Re-check reachability for LAND conquest goals: if the target became
            // unreachable by land (e.g. a bridge was destroyed), force a replan.
            // NAVAL conquest goals stay valid while at war even without a
            // transport — the transport/harbor is what the AI is trying to build,
            // so dropping the goal before the infrastructure exists would prevent
            // it from ever being built.
            if (goal.targetTileKey && ctx.tiles && ctx.ownCities.length) {
                const [tx, tz] = goal.targetTileKey.split(',').map(Number);
                const tier = (goal.meta && goal.meta.reachability) || 'land';
                if (tier === 'land') {
                    let ok = false;
                    for (const o of ctx.ownCities) {
                        if (isReachableByLand(ctx.tiles, o.x, o.z, tx, tz)) { ok = true; break; }
                    }
                    if (!ok) return false;
                }
            }
            return true;
        }
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
        case 'take-key-city':
            // Valid while at war with a faction that has key cities.
            return goal.targetFaction ? ctx.enemies.has(goal.targetFaction) : false;
        case 'disrupt-victory':
            // Valid while at war with a faction that's leading in victory progress.
            return goal.targetFaction ? ctx.enemies.has(goal.targetFaction) : false;
        case 'resource-war':
            // Valid while at war with a faction that controls contested resources.
            return goal.targetFaction ? ctx.enemies.has(goal.targetFaction) : false;
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

/** Check if a path between two tiles crosses water or an unbridged river (for
 *  goal water-barrier filtering). Uses a simple line-of-sight check: if any
 *  tile along the Chebyshev-1 path is WATER or an unbridged RIVER, the target
 *  is considered barrier-separated. This prevents lords from trying to walk to
 *  targets across the sea or an unbridged river, and lets the AI plan to build
 *  engineers (bridges) or harbors (transports). */
export function pathCrossesWater(tiles, fromX, fromZ, toX, toZ) {
    if (!tiles) return false;
    const dx = Math.sign(toX - fromX);
    const dz = Math.sign(toZ - fromZ);
    let x = fromX, z = fromZ;
    while (x !== toX || z !== toZ) {
        if (x !== toX) x += dx;
        else if (z !== toZ) z += dz;
        const t = tiles.get(`${x},${z}`);
        if (t && (t.terrain === 'WATER' || (t.terrain === 'RIVER' && !t.bridge))) return true;
    }
    return false;
}

/** Real land-path reachability via bounded BFS. Returns true if a land unit
 *  can walk from (fromX,fromZ) to (toX,toZ) without crossing WATER or an
 *  unbridged RIVER, within `maxSteps` (default GRID_SIZE*4). This replaces the
 *  naive line-trace `pathCrossesWater` for final reachability decisions: the
 *  line trace mis-classifies curving coastlines (reachable flagged unreachable)
 *  and narrow straits (unreachable flagged reachable). The BFS uses the same
 *  passability rules as src/path.js.
 *
 *  Pure: operates only on the passed tiles Map. Returns false if either
 *  endpoint is missing or the goal is unreachable within the cap. */
export function isReachableByLand(tiles, fromX, fromZ, toX, toZ, maxSteps) {
    if (!tiles) return false;
    const startKey = `${fromX},${fromZ}`;
    const goalKey = `${toX},${toZ}`;
    if (startKey === goalKey) return true;
    if (!tiles.has(startKey) || !tiles.has(goalKey)) return false;
    const cap = maxSteps || (GRID_SIZE * 4);
    const visited = new Set([startKey]);
    // head-indexed queue (O(1) dequeue) — mirrors path.js's BFS pattern.
    const queue = [[fromX, fromZ]];
    let head = 0;
    let steps = 0;
    const dirs = [[0, 1], [0, -1], [1, 0], [-1, 0]];
    while (head < queue.length && steps++ < cap) {
        const [cx, cz] = queue[head++];
        for (const [dx, dz] of dirs) {
            const nx = cx + dx, nz = cz + dz;
            const k = `${nx},${nz}`;
            if (visited.has(k)) continue;
            const t = tiles.get(k);
            if (!t) continue;
            // Land passability: WATER and unbridged RIVER are impassable.
            if (t.terrain === 'WATER' || (t.terrain === 'RIVER' && !t.bridge)) {
                visited.add(k);
                continue;
            }
            if (k === goalKey) return true;
            visited.add(k);
            queue.push([nx, nz]);
        }
    }
    return false;
}

/** Classify a conquest candidate's reachability tier from a given origin.
 *  Returns 'land' (walkable), 'naval' (different landmass / across water, but
 *  reachable with transports), or 'unreachable' (no land path and no naval
 *  capability). Uses isReachableByLand for the land check and falls back to
 *  pathCrossesWater as a fast pre-filter. Pure. */
export function classifyReachability(tiles, fromX, fromZ, c, hasTransport) {
    if (isReachableByLand(tiles, fromX, fromZ, c.x, c.z)) return 'land';
    // Across a water barrier. Always classified 'naval' — the AI can always
    // build a harbor + transports to reach it, so 'unreachable' is never the
    // right classification. The `hasTransport` arg is retained for API compat
    // but no longer changes the result.
    return 'naval';
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
        tiles = null, myUnits = [],
    } = input;

    const enemySet = new Set(enemies || []);
    const hasTransportNow = myUnits && myUnits.some(u => u.type === 'TRANSPORT' || u.type === 'STEAM_TRANSPORT');
    const ctx = {
        enemies: enemySet, defensive: !!activeObjectives.defensive,
        myCityCount, settlerTarget, scarcityTriggered,
        needsNavalExpansion, isIslandFaction, foreignMassWithoutCity,
        neutralFactions, hasSpies, hasChokepoints, unexploredTiles,
        tiles: tiles || null, ownCities: ownCities || [], hasTransport: hasTransportNow,
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
    const push = (kind, score, targetTileKey, targetFaction, horizon, meta, plan = null) => {
        candidates.push({
            kind,
            priority: 0,            // normalized after sorting
            horizon,
            targetTileKey: targetTileKey || null,
            targetFaction: targetFaction || null,
            meta: meta || {},
            plan: plan || null,     // ordered infrastructure steps (Part B)
            stabilityTurns: AI_GOAL_MIN_STABILITY_TURNS,
            born: turn,
            _score: score,           // raw weighted score (stripped before return)
        });
    };

    // Conquest: at least one at-war enemy. Pick the nearest REACHABLE enemy
    // city — reachable by land, or by naval if we have transports/a harbor.
    // Never target an unreachable city (the old code fell back to water-
    // separated cities when all were unreachable, leaving the army stuck at the
    // shore forever). If no reachable conquest target exists, skip the conquest
    // goal this cycle; the expand-islands / naval-prep goals handle building
    // the infrastructure to reach foreign landmasses.
    if (enemySet.size > 0) {
        const hasTransport = myUnits && myUnits.some(u => u.type === 'TRANSPORT' || u.type === 'STEAM_TRANSPORT');
        // Compute reachability from the nearest owned city to each candidate,
        // not just homeAnchor — a forward city on the target's landmass makes
        // it land-reachable even if the capital is on a different mass. When
        // `tiles` is not available (abstract/test contexts without a map), fall
        // back to legacy behavior and treat all candidates as land-reachable.
        // Cross-water targets are classified 'naval' (reachable once a harbor +
        // transports are built) rather than 'unreachable' — the AI can always
        // build the infrastructure, so the goal stays to drive that building.
        const origins = (ownCities && ownCities.length) ? ownCities : (homeAnchor ? [homeAnchor] : []);
        const hasTiles = !!tiles;
        const classify = (c) => {
            if (!hasTiles) return 'land';
            if (!origins.length) return 'naval';
            for (const o of origins) {
                if (isReachableByLand(tiles, o.x, o.z, c.x, c.z)) return 'land';
            }
            return 'naval';
        };
        const land = [], naval = [];
        for (const c of enemyCities) {
            const tier = classify(c);
            if (tier === 'land') land.push(c);
            else if (tier === 'naval') naval.push(c);
        }
        let tgt = null, tier = null;
        if (land.length) { tgt = nearestEnemyCity(land, homeAnchor); tier = 'land'; }
        else if (naval.length) { tgt = nearestEnemyCity(naval, homeAnchor); tier = 'naval'; }
        // If tgt is null (all unreachable AND no transports), no conquest goal
        // is pushed — the expand-islands goal handles building the infrastructure
        // to reach foreign landmasses first.
        if (tgt) {
            // Naval conquest objectives are real but can't be pressed until
            // infrastructure (harbor + transports) is built. Score them lower so
            // they don't dominate over the expand-islands/naval-prep goals that
            // build that infrastructure, but keep the goal so the AI knows what
            // it's building toward (and so harbor/transport logic can key off
            // `conquestAcrossWater` / `meta.requiresNaval`).
            const scoreScale = tier === 'naval' ? 0.6 : 1.0;
            // Long-term infrastructure plan for naval conquest: build a harbor,
            // train transports, board the army, sail to the target. The ai.js
            // spending blocks read this plan to prioritize harbor/transport
            // production and the embarkation coordinator boards the army.
            const navalPlan = tier === 'naval' ? [
                { kind: 'buildHarbor' },
                { kind: 'trainTransport', count: 2 },
                { kind: 'boardArmy' },
                { kind: 'sailTo', targetTileKey: `${tgt.x},${tgt.z}` },
            ] : null;
            push('conquest',
                BASE_SCORE.conquest * weights.conquest * scoreScale,
                `${tgt.x},${tgt.z}`,
                tgt.owner,
                'short',
                { cityX: tgt.x, cityZ: tgt.z, reachability: tier, requiresNaval: tier === 'naval' },
                navalPlan);
        }
    }

    // War Objectives: targeted strategic goals that make wars more meaningful
    // and drive AI to pursue specific objectives beyond generic conquest.

    // Take Key City: target a high-value enemy city (capital, or city with
    // important buildings). Higher priority than generic conquest when we
    // have enough cities to warrant strategic targeting.
    if (enemySet.size > 0 && myCityCount >= WAR_OBJECTIVE_MIN_CITIES) {
        for (const ec of enemyCities) {
            const isCapital = ec.isCapital;
            const hasKeyBuilding = ec.hasKeyBuilding;
            if (!isCapital && !hasKeyBuilding) continue;
            const bonus = (isCapital ? WAR_OBJECTIVE_CAPITAL_BONUS : 0)
                + (hasKeyBuilding ? WAR_OBJECTIVE_KEY_BUILDING_BONUS : 0);
            const score = (BASE_SCORE['take-key-city'] + bonus) * weights.conquest;
            push('take-key-city',
                score,
                `${ec.x},${ec.z}`,
                ec.owner,
                'short',
                { cityX: ec.x, cityZ: ec.z, isCapital, hasKeyBuilding });
            break; // one take-key-city goal per plan
        }
    }

    // Disrupt Victory: target a faction that's leading in victory progress.
    // This gives other factions a strategic reason to war the leader.
    if (enemySet.size > 0 && input.victoryLeader && input.victoryLeader !== factionDef.id) {
        const leaderCities = enemyCities.filter(c => c.owner === input.victoryLeader);
        if (leaderCities.length > 0) {
            const tgt = leaderCities[0];
            push('disrupt-victory',
                (BASE_SCORE['disrupt-victory'] + WAR_OBJECTIVE_VICTORY_LEADER_BONUS) * weights.conquest,
                `${tgt.x},${tgt.z}`,
                input.victoryLeader,
                'medium',
                { cityX: tgt.x, cityZ: tgt.z, reason: 'victory threat' });
        }
    }

    // Resource War: target a faction that controls a resource we critically
    // need but don't have. Gives wars an economic justification.
    if (enemySet.size > 0 && input.contestedResourceFaction) {
        const rcities = enemyCities.filter(c => c.owner === input.contestedResourceFaction);
        if (rcities.length > 0) {
            const tgt = rcities[0];
            push('resource-war',
                (BASE_SCORE['resource-war'] + WAR_OBJECTIVE_RESOURCE_CONTENDER_BONUS) * weights.conquest,
                `${tgt.x},${tgt.z}`,
                input.contestedResourceFaction,
                'short',
                { cityX: tgt.x, cityZ: tgt.z, resource: input.contestedResource });
        }
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
    // unit on its tile), consider assassinating it. Uses a low base score (40)
    // so conquest/defense goals always win when both exist — the king should
    // join the conquest group, not chase the enemy king across the map.
    {
        const exposedKing = enemyKings.find(king =>
            king.owner !== factionDef.id &&
            enemySet.has(king.owner) &&
            king.isKing && !king.guarded);
        if (exposedKing) {
            const dKing = manhattan(homeAnchor.x, homeAnchor.z, exposedKing.x, exposedKing.z);
            const score = (40 - dKing * 0.3) * weights['attack-king'];
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
                      diplomacy: 0.6, spy: 1.2, chokepoint: 1.1, scout: 0.7, 'attack-king': 1.3,
                      'take-key-city': 1.4, 'disrupt-victory': 1.3, 'resource-war': 1.1 },
        science:    { conquest: 0.6, defense: 1.0, settle: 1.1, 'expand-islands': 0.8, 'develop-economy': 1.3,
                      diplomacy: 1.0, spy: 1.1, chokepoint: 0.8, scout: 1.0, 'attack-king': 0.9,
                      'take-key-city': 0.8, 'disrupt-victory': 1.4, 'resource-war': 0.9 },
        economic:   { conquest: 0.5, defense: 0.8, settle: 1.2, 'expand-islands': 1.0, 'develop-economy': 1.5,
                      diplomacy: 1.3, spy: 0.9, chokepoint: 0.7, scout: 0.9, 'attack-king': 0.8,
                      'take-key-city': 0.7, 'disrupt-victory': 1.2, 'resource-war': 1.4 },
        score:      { conquest: 0.9, defense: 1.0, settle: 1.1, 'expand-islands': 0.9, 'develop-economy': 1.1,
                      diplomacy: 1.0, spy: 1.0, chokepoint: 1.0, scout: 1.0, 'attack-king': 1.1,
                      'take-key-city': 1.0, 'disrupt-victory': 1.2, 'resource-war': 1.0 }
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
                  diplomacy: 0.9, spy: 0.5, chokepoint: 0.6, scout: 1.5, 'attack-king': 0.9,
                  'take-key-city': 0.6, 'disrupt-victory': 0.7, 'resource-war': 0.8 },
        mid:    { conquest: 1.1, defense: 1.0, settle: 1.0, 'expand-islands': 1.0, 'develop-economy': 1.0,
                  diplomacy: 1.0, spy: 1.0, chokepoint: 1.0, scout: 0.7, 'attack-king': 1.1,
                  'take-key-city': 1.2, 'disrupt-victory': 1.1, 'resource-war': 1.0 },
        late:   { conquest: 1.3, defense: 1.1, settle: 0.6, 'expand-islands': 0.8, 'develop-economy': 0.8,
                  diplomacy: 0.7, spy: 1.2, chokepoint: 1.1, scout: 0.4, 'attack-king': 1.3,
                  'take-key-city': 1.3, 'disrupt-victory': 1.4, 'resource-war': 1.2 },
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