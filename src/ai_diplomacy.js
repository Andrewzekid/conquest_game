/** Goal-driven diplomacy module. Adjusts diplomacy decisions based on the
 *  AI's active goal sequence so military and economic postures are aligned.
 *
 *  Pure functions — no game-state side effects beyond the objects passed in.
 *  This module is consumed by diplomacy.js (aiDecideTreaty, aiDecideWar) to
 *  inject goal-aware overrides into the base personality-driven chances.
 */
import { DIPLOMACY_STATES, AI_PERSONALITIES } from './config.js';

/** Adjust diplomacy chances based on the active goal sequence.
 *  Returns an object with overrides for warChance, acceptTrade, acceptPeace,
 *  and acceptAlliance that the caller can blend into the base personality
 *  chances.
 *
 *  @param {Array} goals - the faction's ordered goal sequence from selectGoals
 *  @param {object} diploState - current diplomacy state
 *  @param {string} owner - this faction's id
 *  @param {string} personality - faction personality (AGGRESSIVE/DEFENSIVE/etc)
 *  @param {number} turn - current turn number
 *  @returns {{ warChance, acceptTrade, acceptPeace, acceptAlliance }}
 */
export function adjustDiplomacyByGoal(goals, diploState, owner, personality, turn) {
    const base = AI_PERSONALITIES[personality] || AI_PERSONALITIES.BALANCED;
    const topGoal = goals && goals.length ? goals[0] : null;
    const overrides = {
        warChance: base.warChance,
        acceptTrade: base.acceptTrade,
        acceptPeace: base.acceptPeace,
        acceptAlliance: base.acceptAlliance,
    };
    if (!topGoal) return overrides;

    switch (topGoal.kind) {
        case 'conquest':
            // When pursuing conquest, increase war chances against the target
            // and reduce trade/peace willingness with them.
            overrides.warChance = Math.min(1.0, base.warChance + 0.2);
            overrides.acceptTrade = Math.max(0.05, base.acceptTrade - 0.15);
            overrides.acceptPeace = Math.max(0.05, base.acceptPeace - 0.2);
            overrides.acceptAlliance = Math.max(0.05, base.acceptAlliance - 0.1);
            break;
        case 'defense':
            // When defending, be more cautious about new wars but more willing
            // to accept peace if we're under pressure.
            overrides.warChance = Math.max(0.05, base.warChance - 0.15);
            overrides.acceptPeace = Math.min(0.9, base.acceptPeace + 0.15);
            break;
        case 'develop-economy':
            // When developing economy, seek trade agreements and avoid wars.
            overrides.warChance = Math.max(0.05, base.warChance - 0.1);
            overrides.acceptTrade = Math.min(0.9, base.acceptTrade + 0.2);
            overrides.acceptAlliance = Math.min(0.8, base.acceptAlliance + 0.1);
            break;
        case 'settle':
            // When settling, be moderate — expand peacefully if possible.
            overrides.warChance = Math.max(0.1, base.warChance - 0.05);
            overrides.acceptTrade = Math.min(0.8, base.acceptTrade + 0.1);
            break;
        case 'spy':
            // When spying, maintain tension — don't accept peace too easily
            // (need time to gather intel), but don't start new wars either.
            overrides.warChance = Math.max(0.1, base.warChance - 0.1);
            overrides.acceptPeace = Math.max(0.1, base.acceptPeace - 0.15);
            break;
        case 'expand-islands':
            // Naval expansion needs peace at home — accept trade, avoid wars.
            overrides.warChance = Math.max(0.05, base.warChance - 0.1);
            overrides.acceptTrade = Math.min(0.85, base.acceptTrade + 0.15);
            break;
        case 'diplomacy':
            // Full diplomatic mode — maximize trade and alliance opportunities.
            overrides.acceptTrade = Math.min(0.95, base.acceptTrade + 0.25);
            overrides.acceptAlliance = Math.min(0.85, base.acceptAlliance + 0.2);
            overrides.acceptPeace = Math.min(0.8, base.acceptPeace + 0.15);
            break;
        case 'chokepoint':
            // Chokepoint control is military — maintain war readiness.
            overrides.warChance = Math.min(0.9, base.warChance + 0.1);
            break;
        case 'scout':
            // Scouting is neutral — no major diplomacy changes.
            break;
    }
    return overrides;
}

/** Decide whether to declare war on a target faction.
 *  Factors in the current goal, power ratio, and strategic context.
 *
 *  @param {object} aiState - persistent AI state with goals
 *  @param {object} diploState - current diplomacy state
 *  @param {string} owner - this faction's id
 *  @param {string} targetFaction - potential war target
 *  @param {number} powerRatio - our power / their power (>1 means we're stronger)
 *  @returns {{ declare: boolean, reason: string }}
 */
export function shouldDeclareWar(aiState, diploState, owner, targetFaction, powerRatio) {
    const goals = aiState && aiState.goals;
    const topGoal = goals && goals.length ? goals[0] : null;

    // If already at war with the target, no need to declare again.
    const relKey = [owner, targetFaction].sort().join(':');
    const rel = diploState && diploState.relations && diploState.relations[relKey];
    if (rel && rel.state === DIPLOMACY_STATES.WAR) {
        return { declare: false, reason: 'already_at_war' };
    }

    // Conquest / war objective goals targeting this faction: declare if we're
    // strong enough. This covers 'conquest', 'take-key-city', 'disrupt-victory',
    // and 'resource-war' — all war-driven goal kinds.
    const warGoalKinds = new Set(['conquest', 'take-key-city', 'disrupt-victory', 'resource-war']);
    if (topGoal && warGoalKinds.has(topGoal.kind) && topGoal.targetFaction === targetFaction) {
        if (powerRatio >= 1.1) {
            return { declare: true, reason: `${topGoal.kind}_goal_stronger` };
        }
        return { declare: false, reason: `${topGoal.kind}_goal_but_weaker` };
    }

    // No conquest goal: only declare if we're much stronger and aggressive.
    if (powerRatio >= 1.5) {
        const personality = aiState && aiState.personality || 'BALANCED';
        if (personality === 'AGGRESSIVE') {
            return { declare: true, reason: 'aggressive_power_advantage' };
        }
    }

    return { declare: false, reason: 'no_strategic_reason' };
}

/** Decide whether to accept a peace offer.
 *  Factors in war weariness, army losses, goal status, and strategic position.
 *
 *  @param {object} aiState - persistent AI state with goals
 *  @param {object} diploState - current diplomacy state
 *  @param {string} owner - this faction's id
 *  @param {string} attackerFaction - faction offering peace
 *  @param {number} warTurns - how many turns the war has lasted
 *  @param {number} armyLossFraction - fraction of army lost (0-1)
 *  @returns {{ accept: boolean, reason: string }}
 */
export function shouldAcceptPeace(aiState, diploState, owner, attackerFaction, warTurns, armyLossFraction = 0) {
    const goals = aiState && aiState.goals;
    const topGoal = goals && goals.length ? goals[0] : null;

    // If the conquest goal targets this faction and we're winning, reject peace.
    if (topGoal && topGoal.kind === 'conquest' && topGoal.targetFaction === attackerFaction) {
        if (warTurns < 10) {
            return { accept: false, reason: 'conquest_in_progress' };
        }
    }

    // Defense goal: accept peace once the threat is neutralized (war > 5 turns
    // with no active defense objective).
    if (topGoal && topGoal.kind === 'defense') {
        if (warTurns >= 5) {
            return { accept: true, reason: 'defense_goal_war_weary' };
        }
    }

    // High army losses: accept peace regardless of goals.
    if (armyLossFraction >= 0.4) {
        return { accept: true, reason: 'heavy_army_losses' };
    }

    // Long war with no clear objective: accept peace.
    if (warTurns >= 15 && (!topGoal || topGoal.kind !== 'conquest')) {
        return { accept: true, reason: 'long_war_no_objective' };
    }

    // Spy goal: maintain tension to gather intel, but accept peace once enough
    // time has elapsed to complete the intelligence cycle.
    if (topGoal && topGoal.kind === 'spy' && topGoal.targetFaction === attackerFaction) {
        if (warTurns < 8) {
            return { accept: false, reason: 'spy_intel_in_progress' };
        }
        return { accept: true, reason: 'spy_intel_complete' };
    }

    return { accept: false, reason: 'continue_war' };
}
