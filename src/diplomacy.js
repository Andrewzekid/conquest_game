/** Diplomacy system: relations, treaties, trade agreements between factions. */
import { DIPLOMACY_STATES, AI_PERSONALITIES } from './config.js';

/**
 * Create the diplomacy state for the game.
 * Tracks pairwise relations between all factions.
 */
export function createDiplomacyState(factions) {
    const relations = {};
    for (let i = 0; i < factions.length; i++) {
        for (let j = i + 1; j < factions.length; j++) {
            const a = factions[i], b = factions[j];
            const key = relKey(a, b);
            // Player and AI start at war
            relations[key] = {
                state: DIPLOMACY_STATES.WAR,
                tradeAmount: 0,
                turnsAtPeace: 0
            };
        }
    }
    return { relations, pendingOffers: [] };
}

/** Get the relation key for two factions (order-independent). */
export function relKey(a, b) {
    return [a, b].sort().join(':');
}

/** Get the current diplomatic state between two factions. */
export function getRelation(diploState, a, b) {
    return diploState.relations[relKey(a, b)] || {
        state: DIPLOMACY_STATES.WAR,
        tradeAmount: 0,
        turnsAtPeace: 0
    };
}

/** Set the diplomatic state between two factions. */
export function setRelation(diploState, a, b, state) {
    const key = relKey(a, b);
    if (!diploState.relations[key]) {
        diploState.relations[key] = { state, tradeAmount: 0, turnsAtPeace: 0 };
    } else {
        const rel = diploState.relations[key];
        const wasWar = rel.state === DIPLOMACY_STATES.WAR;
        rel.state = state;
        if (state === DIPLOMACY_STATES.PEACE && wasWar) {
            rel.turnsAtPeace = 0;
        }
    }
}

/** Check if two factions can attack each other (at war). */
export function canAttack(diploState, a, b) {
    return getRelation(diploState, a, b).state === DIPLOMACY_STATES.WAR;
}

/** Check if two factions are allied. */
export function isAllied(diploState, a, b) {
    return getRelation(diploState, a, b).state === DIPLOMACY_STATES.ALLIANCE;
}

/** Propose a treaty from one faction to another. */
export function proposeTreaty(diploState, from, to, type, details = {}) {
    const offer = { from, to, type, details, turnProposed: 0 };
    diploState.pendingOffers.push(offer);
    return offer;
}

/**
 * AI decides whether to accept a treaty offer.
 * @param personality - one of AI_PERSONALITIES
 * @param powerRatio - offerer's power / receiver's power (1.0 = equal)
 */
export function aiDecideTreaty(personality, type, powerRatio) {
    const p = AI_PERSONALITIES[personality] || AI_PERSONALITIES.DEFENSIVE;
    if (type === DIPLOMACY_STATES.TRADE_PACT) {
        // More likely to accept trade if weaker or economic
        const base = p.acceptTrade;
        const modifier = powerRatio > 1.2 ? 0.2 : 0; // more likely to accept if offerer is stronger
        return Math.random() < base + modifier;
    }
    if (type === DIPLOMACY_STATES.ALLIANCE) {
        const base = p.acceptAlliance;
        const modifier = powerRatio > 1.5 ? 0.3 : 0;
        return Math.random() < base + modifier;
    }
    if (type === DIPLOMACY_STATES.PEACE) {
        // AI accepts peace if it's losing or defensive
        if (personality === 'AGGRESSIVE' && powerRatio < 0.8) return Math.random() < 0.6;
        return Math.random() < 0.8;
    }
    return false;
}

/** AI decides whether to declare war. */
export function aiDecideWar(personality, powerRatio) {
    const p = AI_PERSONALITIES[personality] || AI_PERSONALITIES.DEFENSIVE;
    // More likely to declare war if stronger
    const effectiveChance = p.warChance * Math.min(2, powerRatio);
    return Math.random() < effectiveChance;
}

/** Process trade pact: exchange resources between factions. */
export function processTradePacts(diploState, resources) {
    const messages = [];
    for (const [key, rel] of Object.entries(diploState.relations)) {
        if (rel.state === DIPLOMACY_STATES.TRADE_PACT && rel.tradeAmount > 0) {
            const [a, b] = key.split(':');
            // Each side gives gold to the other
            if (resources[a] && resources[b]) {
                const amt = rel.tradeAmount;
                if (resources[a].gold >= amt && resources[b].gold >= amt) {
                    resources[a].gold -= amt;
                    resources[b].gold += amt;
                    resources[b].gold -= amt;
                    resources[a].gold += amt;
                    messages.push(`Trade pact: ${a} and ${b} exchanged ${amt} gold.`);
                }
            }
        }
    }
    return messages;
}

/** Increment peace counters; after long peace, AI may propose alliance. */
export function updatePeaceCounters(diploState) {
    for (const rel of Object.values(diploState.relations)) {
        if (rel.state === DIPLOMACY_STATES.PEACE) {
            rel.turnsAtPeace++;
        }
    }
}

/** Get a summary of all diplomatic relations for UI display. */
export function getDiplomacySummary(diploState, factions) {
    const summary = [];
    for (let i = 0; i < factions.length; i++) {
        for (let j = i + 1; j < factions.length; j++) {
            const a = factions[i], b = factions[j];
            const rel = getRelation(diploState, a, b);
            summary.push({ a, b, state: rel.state, tradeAmount: rel.tradeAmount, turnsAtPeace: rel.turnsAtPeace });
        }
    }
    return summary;
}