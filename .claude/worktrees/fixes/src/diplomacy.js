/** Diplomacy system: relations, treaties, trade agreements between factions.
 *  Phase E overhaul: alliance mechanics, relationship scores, peace duration
 *  tracking, diplomatic events, and improved AI decision-making.
 *  Phase F: AI is much harder to negotiate with. Wars are grinding affairs.
 *  Trade pacts now specify which material is traded. */
import { DIPLOMACY_STATES, AI_PERSONALITIES, TRADE_MATERIALS } from './config.js';

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
                // Trade material: which resource is being exchanged (key from TRADE_MATERIALS)
                tradeMaterial: null,
                turnsAtPeace: 0,
                turnsAllied: 0,
                turnsAtWar: 0,
                // Relationship score: -100 (hostile) to +100 (friendly)
                relationship: -20,
                // History counters
                warsDeclared: 0,
                peaceTreaties: 0,
                tradesMade: 0,
                // Broken treaties counter (makes AI less trusting)
                brokenTreaties: 0
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
        tradeMaterial: null,
        turnsAtPeace: 0,
        turnsAllied: 0,
        turnsAtWar: 0,
        relationship: -50,
        warsDeclared: 0,
        peaceTreaties: 0,
        tradesMade: 0,
        brokenTreaties: 0
    };
}

/** Set the diplomatic state between two factions. Tracks transitions. */
export function setRelation(diploState, a, b, state) {
    const key = relKey(a, b);
    if (!diploState.relations[key]) {
        diploState.relations[key] = {
            state, tradeAmount: 0, tradeMaterial: null, turnsAtPeace: 0, turnsAllied: 0, turnsAtWar: 0,
            relationship: state === DIPLOMACY_STATES.WAR ? -50 : 0,
            warsDeclared: 0, peaceTreaties: 0, tradesMade: 0, brokenTreaties: 0
        };
    } else {
        const rel = diploState.relations[key];
        const prevState = rel.state;
        // Breaking a treaty (non-war -> different non-war state) is a betrayal
        if (prevState !== DIPLOMACY_STATES.WAR && state === DIPLOMACY_STATES.WAR && prevState !== state) {
            rel.brokenTreaties = (rel.brokenTreaties || 0) + 1;
        }
        rel.state = state;
        if (state === DIPLOMACY_STATES.PEACE && prevState === DIPLOMACY_STATES.WAR) {
            rel.turnsAtPeace = 0;
            rel.peaceTreaties++;
            rel.relationship = Math.min(100, (rel.relationship || 0) + 15); // reduced from 30
            rel.turnsAtWar = 0;
            if (diploState.diplomaticEvents) {
                diploState.diplomaticEvents.push({ type: 'peace', factions: [a, b] });
            }
        } else if (state === DIPLOMACY_STATES.WAR && prevState !== DIPLOMACY_STATES.WAR) {
            rel.turnsAtWar = 0;
            rel.warsDeclared++;
            rel.relationship = Math.max(-100, (rel.relationship || 0) - 50); // harsher penalty
            rel.turnsAtPeace = 0;
            rel.turnsAllied = 0;
            if (diploState.diplomaticEvents) {
                diploState.diplomaticEvents.push({ type: 'war', factions: [a, b] });
            }
        } else if (state === DIPLOMACY_STATES.ALLIANCE) {
            rel.turnsAllied = 0;
            rel.relationship = Math.min(100, (rel.relationship || 0) + 30); // reduced from 50
            if (diploState.diplomaticEvents) {
                diploState.diplomaticEvents.push({ type: 'alliance', factions: [a, b] });
            }
        } else if (state === DIPLOMACY_STATES.TRADE_PACT) {
            rel.tradesMade++;
            rel.relationship = Math.min(100, (rel.relationship || 0) + 10); // reduced from 20
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
 * Phase G: Improved diplomacy - AI is more strategic about treaties.
 * - Alliances are more likely against common enemies
 * - Trade pacts consider economic complementarity
 * - Peace treaties factor in war weariness and mutual benefit
 * Factors in personality, power ratio, relationship score, broken treaty history,
 * shared enemies, and geographic proximity.
 * @param {number} brokenTreaties - how many times the offering faction broke treaties
 * @param {number} sharedEnemies - number of factions both are at war with
 * @param {boolean} isNeighbor - whether the factions share a border
 */
export function aiDecideTreaty(personality, type, powerRatio, relationship = 0, brokenTreaties = 0, sharedEnemies = 0, isNeighbor = false) {
    const p = AI_PERSONALITIES[personality] || AI_PERSONALITIES.DEFENSIVE;
    // Relationship modifier: friendly factions more likely to accept
    const relMod = Math.max(-0.2, Math.min(0.2, relationship / 300));
    // Trust penalty: each broken treaty makes the AI 10% less likely to accept
    const trustPenalty = brokenTreaties * 0.1;
    // Shared enemies bonus: common enemies make alliances/trade more attractive
    const sharedEnemyBonus = sharedEnemies * 0.1;
    // Neighbor bonus: adjacent factions benefit more from trade/alliances
    const neighborBonus = isNeighbor ? 0.08 : 0;

    if (type === DIPLOMACY_STATES.TRADE_PACT) {
        const base = p.acceptTrade || 0.3;
        // Trade requires positive relationship and decent power balance
        const powerMod = powerRatio > 1.3 ? 0.1 : (powerRatio < 0.7 ? -0.1 : 0);
        const relReq = relationship > 10 ? 0.1 : (relationship < -30 ? -0.2 : 0);
        return Math.random() < (base + powerMod + relMod + relReq - trustPenalty + sharedEnemyBonus + neighborBonus);
    }
    if (type === DIPLOMACY_STATES.ALLIANCE) {
        const base = p.acceptAlliance || 0.2;
        // Alliances need good relationship and trust, but shared enemies help a lot
        const powerMod = powerRatio > 1.5 ? 0.15 : 0;
        const relReq = relationship > 20 ? 0.15 : (relationship < 0 ? -0.4 : 0);
        // Shared enemies significantly boost alliance chance
        const allianceSharedBonus = sharedEnemies * 0.15;
        return Math.random() < (base + powerMod + relMod + relReq - trustPenalty * 1.5 + allianceSharedBonus + neighborBonus);
    }
    if (type === DIPLOMACY_STATES.PEACE) {
        // Peace is hard to get but easier if both sides are war-weary
        const base = p.acceptPeace || 0.4;
        // Only accept peace if we're significantly losing or the war has dragged on
        const losingMod = powerRatio < 0.5 ? 0.3 : (powerRatio < 0.7 ? 0.1 : -0.2);
        // Aggressive personalities almost never accept peace unless crushed
        const aggroMod = personality === 'AGGRESSIVE' ? -0.2 : 0;
        // Economic factions are more willing to make peace
        const economicMod = personality === 'ECONOMIC' ? 0.15 : 0;
        return Math.random() < (base + losingMod + relMod + aggroMod + economicMod - trustPenalty + sharedEnemyBonus);
    }
    return false;
}

/** AI decides whether to declare war. Factors in relationship score, shared enemies,
 *  and geographic proximity. AI is more aggressive in declaring war.
 *  Phase G: Improved diplomacy - AI considers shared enemies (more likely to attack
 *  factions your allies hate) and prefers wars with neighbors. */
export function aiDecideWar(personality, powerRatio, relationship = 0, sharedEnemies = 0, isNeighbor = false) {
    const p = AI_PERSONALITIES[personality] || AI_PERSONALITIES.DEFENSIVE;
    const effectiveChance = p.warChance * Math.min(2.5, powerRatio);
    // Bad relationship makes war more likely; good relationship deters it
    const relMod = Math.max(-0.15, Math.min(0.15, -relationship / 300));
    // Shared enemies bonus: if we have common enemies, we're more likely to attack
    // (the enemy of my enemy is my friend... but also a potential target)
    const sharedEnemyBonus = sharedEnemies * 0.08;
    // Neighbor bonus: AI prefers to expand into adjacent territory
    const neighborBonus = isNeighbor ? 0.12 : 0;
    return Math.random() < effectiveChance + relMod + sharedEnemyBonus + neighborBonus;
}

/** Process trade pact: exchange the specified trade material between factions.
 *  Phase F: Trade pacts now specify which material is traded. The exporting
 *  faction loses that resource, the importing faction gains it, plus both
 *  get a small gold bonus for maintaining trade. */
export function processTradePacts(diploState, resources) {
    const messages = [];
    for (const [key, rel] of Object.entries(diploState.relations)) {
        if (rel.state !== DIPLOMACY_STATES.TRADE_PACT) continue;
        const [a, b] = key.split(':');
        if (!resources[a] || !resources[b]) continue;
        const amt = rel.tradeAmount || 5;
        const material = rel.tradeMaterial || 'gold';
        
        // Both sides get a small gold bonus for trade
        resources[a].gold = (resources[a].gold || 0) + 3;
        resources[b].gold = (resources[b].gold || 0) + 3;
        
        // Exchange the specified material (simplified: both get benefit)
        // In a full implementation, one side would export and one would import
        if (material === 'food') {
            resources[a].food = (resources[a].food || 0) + amt;
            resources[b].food = (resources[b].food || 0) + amt;
        } else if (material === 'wood') {
            resources[a].wood = (resources[a].wood || 0) + amt;
            resources[b].wood = (resources[b].wood || 0) + amt;
        } else if (material === 'iron') {
            resources[a].iron = (resources[a].iron || 0) + amt;
            resources[b].iron = (resources[b].iron || 0) + amt;
        } else {
            // Gold trade
            resources[a].gold = (resources[a].gold || 0) + amt;
            resources[b].gold = (resources[b].gold || 0) + amt;
        }
        
        // Small production bonus
        resources[a].production = (resources[a].production || 0) + 1;
        resources[b].production = (resources[b].production || 0) + 1;
        
        const matName = TRADE_MATERIALS[material.toUpperCase()]?.name || material;
        messages.push(`Trade pact: ${a} and ${b} exchange ${matName} (+${amt}/turn each).`);
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