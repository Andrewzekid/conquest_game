/** Diplomacy system: relations, treaties, trade agreements between factions.
 *  Phase E overhaul: alliance mechanics, relationship scores, peace duration
 *  tracking, diplomatic events, and improved AI decision-making. */
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
            relations[key] = {
                state: DIPLOMACY_STATES.WAR,
                tradeAmount: 0,
                turnsAtPeace: 0,
                turnsAllied: 0,
                turnsAtWar: 0,
                // Relationship score: -100 (hostile) to +100 (friendly)
                relationship: -20,
                // History counters
                warsDeclared: 0,
                peaceTreaties: 0,
                tradesMade: 0
            };
        }
    }
    return { relations, pendingOffers: [], diplomaticEvents: [] };
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
        turnsAtPeace: 0,
        turnsAllied: 0,
        turnsAtWar: 0,
        relationship: -50,
        warsDeclared: 0,
        peaceTreaties: 0,
        tradesMade: 0
    };
}

/** Set the diplomatic state between two factions. Tracks transitions. */
export function setRelation(diploState, a, b, state) {
    const key = relKey(a, b);
    if (!diploState.relations[key]) {
        diploState.relations[key] = {
            state, tradeAmount: 0, turnsAtPeace: 0, turnsAllied: 0, turnsAtWar: 0,
            relationship: state === DIPLOMACY_STATES.WAR ? -50 : 0,
            warsDeclared: 0, peaceTreaties: 0, tradesMade: 0
        };
    } else {
        const rel = diploState.relations[key];
        const prevState = rel.state;
        rel.state = state;
        if (state === DIPLOMACY_STATES.PEACE && prevState === DIPLOMACY_STATES.WAR) {
            rel.turnsAtPeace = 0;
            rel.peaceTreaties++;
            rel.relationship = Math.min(100, (rel.relationship || 0) + 30);
            rel.turnsAtWar = 0;
            if (diploState.diplomaticEvents) {
                diploState.diplomaticEvents.push({ type: 'peace', factions: [a, b] });
            }
        } else if (state === DIPLOMACY_STATES.WAR && prevState !== DIPLOMACY_STATES.WAR) {
            rel.turnsAtWar = 0;
            rel.warsDeclared++;
            rel.relationship = Math.max(-100, (rel.relationship || 0) - 40);
            rel.turnsAtPeace = 0;
            rel.turnsAllied = 0;
            if (diploState.diplomaticEvents) {
                diploState.diplomaticEvents.push({ type: 'war', factions: [a, b] });
            }
        } else if (state === DIPLOMACY_STATES.ALLIANCE) {
            rel.turnsAllied = 0;
            rel.relationship = Math.min(100, (rel.relationship || 0) + 50);
            if (diploState.diplomaticEvents) {
                diploState.diplomaticEvents.push({ type: 'alliance', factions: [a, b] });
            }
        } else if (state === DIPLOMACY_STATES.TRADE_PACT) {
            rel.tradesMade++;
            rel.relationship = Math.min(100, (rel.relationship || 0) + 20);
            if (diploState.diplomaticEvents) {
                diploState.diplomaticEvents.push({ type: 'trade', factions: [a, b] });
            }
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

/** Check if two factions have a trade pact. */
export function hasTradePact(diploState, a, b) {
    return getRelation(diploState, a, b).state === DIPLOMACY_STATES.TRADE_PACT;
}

/** Check if two factions are at peace (not war, not alliance, not trade). */
export function isAtPeace(diploState, a, b) {
    const s = getRelation(diploState, a, b).state;
    return s !== DIPLOMACY_STATES.WAR;
}

/** Propose a treaty from one faction to another. */
export function proposeTreaty(diploState, from, to, type, details = {}) {
    const offer = { from, to, type, details, turnProposed: 0 };
    diploState.pendingOffers.push(offer);
    return offer;
}

/**
 * AI decides whether to accept a treaty offer.
 * Factors in personality, power ratio, and relationship score.
 */
export function aiDecideTreaty(personality, type, powerRatio, relationship = 0) {
    const p = AI_PERSONALITIES[personality] || AI_PERSONALITIES.DEFENSIVE;
    // Relationship modifier: friendly factions more likely to accept
    const relMod = Math.max(-0.3, Math.min(0.3, relationship / 200));

    if (type === DIPLOMACY_STATES.TRADE_PACT) {
        const base = p.acceptTrade;
        const powerMod = powerRatio > 1.2 ? 0.2 : 0;
        return Math.random() < base + powerMod + relMod;
    }
    if (type === DIPLOMACY_STATES.ALLIANCE) {
        const base = p.acceptAlliance;
        const powerMod = powerRatio > 1.5 ? 0.3 : 0;
        // Alliances need decent relationship
        const relReq = relationship > -20 ? 0 : -0.3;
        return Math.random() < base + powerMod + relMod + relReq;
    }
    if (type === DIPLOMACY_STATES.PEACE) {
        if (personality === 'AGGRESSIVE' && powerRatio < 0.8) return Math.random() < 0.6;
        // Long wars make peace more likely
        return Math.random() < 0.8 + relMod;
    }
    return false;
}

/** AI decides whether to declare war. Factors in relationship score. */
export function aiDecideWar(personality, powerRatio, relationship = 0) {
    const p = AI_PERSONALITIES[personality] || AI_PERSONALITIES.DEFENSIVE;
    const effectiveChance = p.warChance * Math.min(2, powerRatio);
    // Bad relationship makes war more likely; good relationship deters it
    const relMod = Math.max(-0.2, Math.min(0.2, -relationship / 200));
    return Math.random() < effectiveChance + relMod;
}

/** Process trade pact: exchange resources between factions each turn. */
export function processTradePacts(diploState, resources) {
    const messages = [];
    for (const [key, rel] of Object.entries(diploState.relations)) {
        if (rel.state === DIPLOMACY_STATES.TRADE_PACT && rel.tradeAmount > 0) {
            const [a, b] = key.split(':');
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

/** Increment peace/alliance/war counters each turn. */
export function updatePeaceCounters(diploState) {
    for (const rel of Object.values(diploState.relations)) {
        if (rel.state === DIPLOMACY_STATES.PEACE) {
            rel.turnsAtPeace = (rel.turnsAtPeace || 0) + 1;
            // Slowly improve relationship during peace
            rel.relationship = Math.min(100, (rel.relationship || 0) + 1);
        } else if (rel.state === DIPLOMACY_STATES.ALLIANCE) {
            rel.turnsAllied = (rel.turnsAllied || 0) + 1;
            rel.relationship = Math.min(100, (rel.relationship || 0) + 2);
        } else if (rel.state === DIPLOMACY_STATES.TRADE_PACT) {
            rel.turnsAtPeace = (rel.turnsAtPeace || 0) + 1;
            rel.relationship = Math.min(100, (rel.relationship || 0) + 1);
        } else if (rel.state === DIPLOMACY_STATES.WAR) {
            rel.turnsAtWar = (rel.turnsAtWar || 0) + 1;
            // Relationship slowly worsens during long wars
            rel.relationship = Math.max(-100, (rel.relationship || 0) - 1);
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
            summary.push({
                a, b,
                state: rel.state,
                tradeAmount: rel.tradeAmount,
                turnsAtPeace: rel.turnsAtPeace || 0,
                turnsAllied: rel.turnsAllied || 0,
                turnsAtWar: rel.turnsAtWar || 0,
                relationship: rel.relationship || 0
            });
        }
    }
    return summary;
}

/** Get a human-readable label for a diplomatic state. */
export function stateLabel(state) {
    switch (state) {
        case DIPLOMACY_STATES.WAR: return '⚔️ War';
        case DIPLOMACY_STATES.PEACE: return '🕊️ Peace';
        case DIPLOMACY_STATES.ALLIANCE: return '🤝 Alliance';
        case DIPLOMACY_STATES.TRADE_PACT: return '💰 Trade Pact';
        default: return state;
    }
}

/** Get a relationship score label. */
export function relationshipLabel(score) {
    if (score >= 60) return 'Friendly';
    if (score >= 20) return 'Cordial';
    if (score >= -20) return 'Neutral';
    if (score >= -60) return 'Hostile';
    return 'Bitter';
}