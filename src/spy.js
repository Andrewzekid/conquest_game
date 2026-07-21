/** Spy system (Feature 11): covert actions performed by SPY units. Pure
 *  functions — no game-state side effects beyond the objects passed in. Each
 *  action has a success chance (does the action land?) and a detection chance
 *  (is the spy noticed, triggering relationship/reputation penalties?).
 *  Determined-randomness is injected via a provided rng so tests are stable.
 */
import { SPY_ACTIONS, SPY_DETECTION_RELATION_PENALTY } from './config.js';

const rand = (rng) => (typeof rng === 'function' ? rng() : Math.random());

/** Resolve a spy action.
 *  @param {object} opts { action: 'GATHER_INTEL'|..., spy, targetFaction, rng, detectionBonus, successBonus }
 *  @returns {{ success, detected, action, effect, relationPenalty, message }}
 *  - success: did the action achieve its goal?
 *  - detected: was the spy noticed (always true on a failed action)?
 *  - effect: action-specific payload (e.g. { unrest: 30 } for INCITE_UNREST)
 *  - relationPenalty: relationship points subtracted from spy.owner→target
 *  - message: human-readable log line */
export function resolveSpyAction(opts) {
    const actionKey = opts && opts.action;
    const def = SPY_ACTIONS[actionKey];
    if (!def) return { success: false, detected: false, action: actionKey, effect: null, relationPenalty: 0, message: 'Unknown spy action' };
    const r = opts.rng;
    const successBonus = opts.successBonus || 0;
    const detectionBonus = opts.detectionBonus || 0;

    const successChance = Math.max(0.05, Math.min(0.97, def.baseSuccess + successBonus));
    const detectionChance = Math.max(0.02, Math.min(0.95, def.baseDetection + detectionBonus));

    const success = rand(r) < successChance;
    // A failed action is always noticed; a successful one rolls detection.
    const detected = success ? (rand(r) < detectionChance) : true;

    const effect = buildEffect(def, success, opts);
    let relationPenalty = 0;
    if (detected) {
        relationPenalty = def.relationPenalty + (success ? 0 : SPY_DETECTION_RELATION_PENALTY);
    }
    const owner = opts.spy && opts.spy.owner ? opts.spy.owner : 'unknown';
    const message = formatMessage(def, success, detected, owner, opts.targetFaction);
    return { success, detected, action: actionKey, effect, relationPenalty, message };
}

function buildEffect(def, success, opts) {
    if (!success) return null;
    switch (def.key) {
        case 'GATHER_INTEL':
            return { intel: { faction: opts.targetFaction, tiles: true, armies: true } };
        case 'SABOTAGE':
            return { sabotage: { tileKey: opts.targetTileKey || null, turns: 2 } };
        case 'ASSASSINATE':
            return { assassinate: { lordId: opts.targetLordId || null, damage: 10 } };
        case 'INCITE_UNREST':
            return { unrest: { cityKey: opts.targetCityKey || null, amount: def.unrestAmount || 30 } };
        default:
            return null;
    }
}

function formatMessage(def, success, detected, owner, target) {
    const verb = def.label.toLowerCase();
    if (success && !detected) return `${owner}'s spy ${verb}ed ${target} undetected.`;
    if (success && detected)  return `${owner}'s spy ${verb}ed ${target} but was detected!`;
    return `${owner}'s spy failed to ${verb} ${target} and was detected.`;
}

/** Whether a unit is a spy. Pure helper usable by combat/movement code. */
export function isSpyUnit(unit) {
    return !!(unit && unit.isSpy);
}

/** Detection bonus from the target's defensive improvements (walls/governor
 *  reduce success / raise detection). Pure so it can be tested. */
export function spyDetectionBonus(targetTile, buildings) {
    let bonus = 0;
    if (!targetTile) return bonus;
    if (targetTile.terrain === 'CITY') bonus += 0.15;
    const b = buildings && buildings.get ? buildings.get(`${targetTile.x},${targetTile.z}`) : null;
    if (b && b.WALLS) bonus += 0.15;
    return bonus;
}