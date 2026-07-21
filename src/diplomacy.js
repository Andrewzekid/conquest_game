/** Diplomacy system: relations, treaties, trade agreements between factions.
 *  Phase E overhaul: alliance mechanics, relationship scores, peace duration
 *  tracking, diplomatic events, and improved AI decision-making.
 *  Phase F: AI is much harder to negotiate with. Wars are grinding affairs.
 *  Trade pacts now specify which material is traded. */
import { DIPLOMACY_STATES, AI_PERSONALITIES, TRADE_MATERIALS,
         GRIEVANCE_DECAY_PER_TURN, GRIEVANCE_WAR_THRESHOLD, GRIEVANCE_HOSTILE,
         WAR_WEARINESS_RATES, PEACE_DEMAND_LIMITS, PEACE_ACCEPTANCE_MODIFIERS,
         COALITION_MAX_ALLIES, COALITION_JOIN_RELATIONSHIP_THRESHOLD, COALITION_SHARED_PENALTY } from './config.js';

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
                state: DIPLOMACY_STATES.NEUTRAL,
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
                brokenTreaties: 0,
                // Civ6-style directed tension: points THIS faction holds against
                // the OTHER. Drives war declarations and treaty acceptance.
                grievances: 0,
                grievanceLog: [],
                expiresOn: null,
                // Formal-war tracking: a declaration sets formalWar and stamps the
                // turn, so expired treaties / peace cooldowns can reference it.
                formalWar: false,
                lastWarDeclaredTurn: 0,
                // Per-faction hostility memory (factionId -> turns of accumulated
                // hostility). Supplements the directed `grievances` score.
                grudges: {},
                // Derived trust in [0..1]: drops as treaties are broken.
                trust: 1
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
        state: DIPLOMACY_STATES.NEUTRAL,
        tradeAmount: 0,
        tradeMaterial: null,
        turnsAtPeace: 0,
        turnsAllied: 0,
        turnsAtWar: 0,
        relationship: 0,
        warsDeclared: 0,
        peaceTreaties: 0,
        tradesMade: 0,
        brokenTreaties: 0,
        grievances: 0,
        grievanceLog: [],
        expiresOn: null,
        formalWar: false,
        lastWarDeclaredTurn: 0,
        grudges: {},
        trust: 1
    };
}

/** Set the diplomatic state between two factions. Tracks transitions. */
export function setRelation(diploState, a, b, state, currentTurn = 0, duration = 0) {
    const key = relKey(a, b);
    if (!diploState.relations[key]) {
        diploState.relations[key] = {
            state, tradeAmount: 0, tradeMaterial: null, turnsAtPeace: 0, turnsAllied: 0, turnsAtWar: 0,
            relationship: state === DIPLOMACY_STATES.WAR ? -50 : state === DIPLOMACY_STATES.NEUTRAL ? 0 : 0,
            warsDeclared: 0, peaceTreaties: 0, tradesMade: 0, brokenTreaties: 0,
            grievances: 0, grievanceLog: [], expiresOn: null,
            formalWar: state === DIPLOMACY_STATES.WAR,
            lastWarDeclaredTurn: state === DIPLOMACY_STATES.WAR ? currentTurn : 0,
            grudges: {}, trust: 1
        };
    } else {
        const rel = diploState.relations[key];
        const prevState = rel.state;
        // Breaking a formal treaty (non-default) into war is a betrayal
        const isDefault = prevState === DIPLOMACY_STATES.NEUTRAL || prevState === DIPLOMACY_STATES.WAR;
        if (!isDefault && state === DIPLOMACY_STATES.WAR && prevState !== state) {
            rel.brokenTreaties = (rel.brokenTreaties || 0) + 1;
            rel.trust = Math.max(0, 1 - (rel.brokenTreaties) * 0.25);
            // Civ6-style: a broken treaty generates directed grievances on BOTH
            // sides (mutual hostility from the collapsed treaty). Early NAP/
            // ceasefire breaks (before expiry) hurt more.
            let breach = 15;
            if (prevState === DIPLOMACY_STATES.NAP || prevState === DIPLOMACY_STATES.CEASEFIRE) {
                breach = 25;
                if (rel.expiresOn && currentTurn > 0 && currentTurn < rel.expiresOn) breach += 15; // early break
            } else if (prevState === DIPLOMACY_STATES.ALLIANCE) {
                breach = 30;
            }
            addGrievance(diploState, a, b, breach, `treaty broken (${prevState})`);
            addGrievance(diploState, b, a, breach, `treaty broken (${prevState})`);
        }
        rel.state = state;
        // Handle expiry for temporary states
        if (state === DIPLOMACY_STATES.NAP || state === DIPLOMACY_STATES.CEASEFIRE) {
            rel.expiresOn = (currentTurn > 0) ? currentTurn + (duration > 0 ? duration : 10) : null;
        } else {
            rel.expiresOn = null;
        }
        if (state === DIPLOMACY_STATES.NEUTRAL) {
            // Reset counters, relationship drifts toward 0
            rel.relationship = Math.min(0, Math.max(-20, (rel.relationship || 0)));
            if (diploState.diplomaticEvents) {
                diploState.diplomaticEvents.push({ type: 'neutral', factions: [a, b] });
            }
        } else if (state === DIPLOMACY_STATES.PEACE && prevState === DIPLOMACY_STATES.WAR) {
            rel.turnsAtPeace = 0;
            rel.peaceTreaties++;
            rel.relationship = Math.min(100, (rel.relationship || 0) + 15);
            rel.turnsAtWar = 0;
            if (diploState.diplomaticEvents) {
                diploState.diplomaticEvents.push({ type: 'peace', factions: [a, b] });
            }
        } else if (state === DIPLOMACY_STATES.PEACE && prevState !== DIPLOMACY_STATES.WAR && prevState !== DIPLOMACY_STATES.NEUTRAL) {
            rel.peaceTreaties = (rel.peaceTreaties || 0) + 1;
            rel.relationship = Math.min(100, (rel.relationship || 0) + 10);
            if (diploState.diplomaticEvents) {
                diploState.diplomaticEvents.push({ type: 'peace', factions: [a, b] });
            }
        } else if (state === DIPLOMACY_STATES.WAR && prevState !== DIPLOMACY_STATES.WAR) {
            rel.turnsAtWar = 0;
            rel.warsDeclared++;
            rel.formalWar = true;
            rel.lastWarDeclaredTurn = currentTurn || rel.lastWarDeclaredTurn || 0;
            rel.relationship = Math.max(-100, (rel.relationship || 0) - 50);
            rel.turnsAtPeace = 0;
            rel.turnsAllied = 0;
            if (diploState.diplomaticEvents) {
                diploState.diplomaticEvents.push({ type: 'war', factions: [a, b] });
            }
        } else if (state === DIPLOMACY_STATES.ALLIANCE) {
            rel.turnsAllied = 0;
            rel.relationship = Math.min(100, (rel.relationship || 0) + 30);
            if (diploState.diplomaticEvents) {
                diploState.diplomaticEvents.push({ type: 'alliance', factions: [a, b] });
            }
        } else if (state === DIPLOMACY_STATES.TRADE_PACT) {
            rel.tradesMade++;
            rel.relationship = Math.min(100, (rel.relationship || 0) + 10);
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

/**
 * Civ6-style tension: a victim faction accumulates grievances against an
 * aggressor for concrete hostile acts (capturing a city near them, war
 * declaration, treaty breach, troops in their territory). Tension decays
 * slowly each turn so old slights fade.
 * @param {object} diploState
 * @param {string} victim - faction that is aggrieved
 * @param {string} aggressor - faction that committed the act
 * @param {number} amount - points to add (>=0)
 * @param {string} [reason] - short label for the grievance log
 */
export function addGrievance(diploState, victim, aggressor, amount, reason) {
    if (!diploState || !diploState.relations) return;
    if (victim === aggressor) return;
    const rel = diploState.relations[relKey(victim, aggressor)];
    if (!rel) return;
    rel.grievances = (rel.grievances || 0) + Math.max(0, amount);
    if (!rel.grievanceLog) rel.grievanceLog = [];
    rel.grievanceLog.push({ turn: diploState.turn || 0, amount, reason: reason || 'act' });
    // Keep log bounded to avoid unbounded growth across long games.
    if (rel.grievanceLog.length > 30) rel.grievanceLog.shift();
}

/** Get the directed tension a victim holds against an aggressor. */
export function getTension(diploState, victim, aggressor) {
    const rel = diploState.relations[relKey(victim, aggressor)];
    return rel ? (rel.grievances || 0) : 0;
}

/** Categorical level of tension a victim holds against an aggressor. */
export function grievanceLevel(tension) {
    if (tension >= GRIEVANCE_WAR_THRESHOLD) return 'furious';
    if (tension >= GRIEVANCE_HOSTILE) return 'hostile';
    if (tension > 0) return 'annoyed';
    return 'none';
}

/** Decay all grievances by GRIEVANCE_DECAY_PER_TURN each turn (min 0). */
export function applyTensionDecay(diploState) {
    if (!diploState || !diploState.relations) return;
    for (const rel of Object.values(diploState.relations)) {
        if (rel.grievances && rel.grievances > 0) {
            rel.grievances = Math.max(0, rel.grievances - GRIEVANCE_DECAY_PER_TURN);
        }
    }
}

/** Derive a relationship modifier from directed grievances + treaty state.
 *  High tension makes the effective relationship colder; formal treaties warm
 *  it. Returned as a delta to add to the raw `relationship` score. */
export function relationshipFromGrievances(rel, state) {
    const g = (rel && rel.grievances) || 0;
    // Each point of tension cools the relationship a little, capped.
    let delta = -Math.min(40, g * 0.5);
    if (state === DIPLOMACY_STATES.ALLIANCE) delta += 10;
    else if (state === DIPLOMACY_STATES.PEACE || state === DIPLOMACY_STATES.TRADE_PACT) delta += 5;
    else if (state === DIPLOMACY_STATES.WAR) delta -= 10;
    return delta;
}

/** Check if two factions are allied. */
export function isAllied(diploState, a, b) {
    return getRelation(diploState, a, b).state === DIPLOMACY_STATES.ALLIANCE;
}

/** Check if two factions have a trade pact. */
export function hasTradePact(diploState, a, b) {
    return getRelation(diploState, a, b).state === DIPLOMACY_STATES.TRADE_PACT;
}

/** Check if two factions are at peace (not war). */
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
export function aiDecideTreaty(personality, type, powerRatio, relationship = 0, brokenTreaties = 0, sharedEnemies = 0, isNeighbor = false, grievances = 0) {
    const p = AI_PERSONALITIES[personality] || AI_PERSONALITIES.DEFENSIVE;
    // Relationship modifier: friendly factions more likely to accept
    const relMod = Math.max(-0.2, Math.min(0.2, relationship / 300));
    // Trust penalty: each broken treaty makes the AI 10% less likely to accept
    const trustPenalty = brokenTreaties * 0.1;
    // Shared enemies bonus: common enemies make alliances/trade more attractive
    const sharedEnemyBonus = sharedEnemies * 0.1;
    // Neighbor bonus: adjacent factions benefit more from trade/alliances
    const neighborBonus = isNeighbor ? 0.08 : 0;
    // Grievance penalty: each 10 grievances makes the AI ~5% less willing
    // to accept any treaty from that faction. Capped at -0.25.
    const grievancePenalty = -Math.min(0.25, grievances * 0.005);

    if (type === DIPLOMACY_STATES.TRADE_PACT) {
        const base = p.acceptTrade || 0.3;
        // Trade requires positive relationship and decent power balance
        const powerMod = powerRatio > 1.3 ? 0.1 : (powerRatio < 0.7 ? -0.1 : 0);
        const relReq = relationship > 10 ? 0.1 : (relationship < -30 ? -0.2 : 0);
        return Math.random() < (base + powerMod + relMod + relReq - trustPenalty + sharedEnemyBonus + neighborBonus + grievancePenalty);
    }
    if (type === DIPLOMACY_STATES.ALLIANCE) {
        const base = p.acceptAlliance || 0.2;
        // Alliances need good relationship and trust, but shared enemies help a lot
        const powerMod = powerRatio > 1.5 ? 0.15 : 0;
        const relReq = relationship > 20 ? 0.15 : (relationship < 0 ? -0.4 : 0);
        // Shared enemies significantly boost alliance chance
        const allianceSharedBonus = sharedEnemies * 0.15;
        return Math.random() < (base + powerMod + relMod + relReq - trustPenalty * 1.5 + allianceSharedBonus + neighborBonus + grievancePenalty);
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
        return Math.random() < (base + losingMod + relMod + aggroMod + economicMod - trustPenalty + sharedEnemyBonus + grievancePenalty);
    }
    if (type === DIPLOMACY_STATES.NAP) {
        // NAP is easier to accept — it's just a promise not to attack
        const base = p.acceptPeace || 0.5;
        const relReq = relationship < -30 ? -0.3 : (relationship < 0 ? -0.1 : 0.1);
        return Math.random() < (base + relMod + relReq - trustPenalty * 0.5 + neighborBonus * 0.5 + grievancePenalty);
    }
    if (type === DIPLOMACY_STATES.CEASEFIRE) {
        // Ceasefire is easier than full peace — temporary halt, no treaty
        const base = p.acceptPeace || 0.5;
        const losingMod = powerRatio < 0.5 ? 0.2 : (powerRatio < 0.8 ? 0.05 : -0.1);
        const aggroMod = personality === 'AGGRESSIVE' ? -0.1 : 0;
        return Math.random() < (base + losingMod + relMod + aggroMod - trustPenalty * 0.3 + grievancePenalty);
    }
    return false;
}

/** AI decides whether to declare war. Factors in relationship score, shared enemies,
 *  and geographic proximity. AI is more aggressive in declaring war.
 *  Phase G: Improved diplomacy - AI considers shared enemies (more likely to attack
 *  factions your allies hate) and prefers wars with neighbors. */
export function aiDecideWar(personality, powerRatio, relationship = 0, sharedEnemies = 0, isNeighbor = false, grievances = 0) {
    const p = AI_PERSONALITIES[personality] || AI_PERSONALITIES.DEFENSIVE;
    const effectiveChance = p.warChance * Math.min(2.5, powerRatio);
    // Bad relationship makes war more likely; good relationship deters it
    const relMod = Math.max(-0.15, Math.min(0.15, -relationship / 300));
    // Shared enemies bonus: if we have common enemies, we're more likely to attack
    // (the enemy of my enemy is my friend... but also a potential target)
    const sharedEnemyBonus = sharedEnemies * 0.08;
    // Neighbor bonus: AI prefers to expand into adjacent territory
    const neighborBonus = isNeighbor ? 0.12 : 0;
    // Grievance pre-empt: the angrier we are at the target, the more we want to
    // strike first. Capped so it tips borderline cases without guaranteeing war.
    const grievanceMod = Math.min(0.3, (grievances || 0) * 0.005);
    return Math.random() < effectiveChance + relMod + sharedEnemyBonus + neighborBonus + grievanceMod;
}

/** Process trade pact: exchange the specified trade material between factions.
 *  Phase F: Trade pacts now specify which material is traded. The exporting
 *  faction loses that resource, the importing faction gains it, plus both
 *  get a small gold bonus for maintaining trade. A faction that also owns a
 *  Harbor earns an extra +2 gold/turn on each of its trade pacts (maritime
 *  trade income). `harborFactions` is a Set of faction ids with ≥1 Harbor. */
export function processTradePacts(diploState, resources, harborFactions) {
    const messages = [];
    const harbors = harborFactions || new Set();
    for (const [key, rel] of Object.entries(diploState.relations)) {
        if (rel.state !== DIPLOMACY_STATES.TRADE_PACT) continue;
        const [a, b] = key.split(':');
        if (!resources[a] || !resources[b]) continue;
        const amt = rel.tradeAmount || 5;
        const material = rel.tradeMaterial || 'gold';

        // Both sides get a small gold bonus for trade
        resources[a].gold = (resources[a].gold || 0) + 3;
        resources[b].gold = (resources[b].gold || 0) + 3;

        // Harbor maritime-trade bonus: +2 gold/turn per trade pact for a party
        // that owns a Harbor.
        if (harbors.has(a)) resources[a].gold = (resources[a].gold || 0) + 2;
        if (harbors.has(b)) resources[b].gold = (resources[b].gold || 0) + 2;

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

/** Increment peace/alliance/war counters each turn. Also decays grievances
 *  and handles NAP/CEASEFIRE expiry. */
export function updatePeaceCounters(diploState, currentTurn = 0) {
    applyTensionDecay(diploState);
    for (const rel of Object.values(diploState.relations)) {
        if (rel.state === DIPLOMACY_STATES.PEACE) {
            rel.turnsAtPeace = (rel.turnsAtPeace || 0) + 1;
            rel.relationship = Math.min(100, (rel.relationship || 0) + 1);
        } else if (rel.state === DIPLOMACY_STATES.ALLIANCE) {
            rel.turnsAllied = (rel.turnsAllied || 0) + 1;
            rel.relationship = Math.min(100, (rel.relationship || 0) + 2);
        } else if (rel.state === DIPLOMACY_STATES.TRADE_PACT) {
            rel.turnsAtPeace = (rel.turnsAtPeace || 0) + 1;
            rel.relationship = Math.min(100, (rel.relationship || 0) + 1);
        } else if (rel.state === DIPLOMACY_STATES.WAR) {
            rel.turnsAtWar = (rel.turnsAtWar || 0) + 1;
            rel.relationship = Math.max(-100, (rel.relationship || 0) - 1);
        } else if (rel.state === DIPLOMACY_STATES.NEUTRAL) {
            // Tick the peace cooldown counter so the PEACE_COOLDOWN gate in
            // _aiMaybeDeclareWar can eventually expire for neutral pairs
            // (otherwise a NEUTRAL start would block all war declarations).
            // Relationship drifts slowly toward 0; grievances drive real shifts.
            rel.turnsAtPeace = (rel.turnsAtPeace || 0) + 1;
            const r = rel.relationship || 0;
            if (r < 0) rel.relationship = Math.min(0, r + 0.5);
            else if (r > 0) rel.relationship = Math.max(0, r - 0.5);
        } else if (rel.state === DIPLOMACY_STATES.NAP) {
            rel.turnsAtPeace = (rel.turnsAtPeace || 0) + 1;
            rel.relationship = Math.min(100, (rel.relationship || 0) + 1);
            // Check expiry: revert to NEUTRAL, or to WAR if grievances have built up.
            if (rel.expiresOn && currentTurn > 0 && currentTurn >= rel.expiresOn) {
                rel.state = (rel.grievances || 0) >= GRIEVANCE_WAR_THRESHOLD
                    ? DIPLOMACY_STATES.WAR : DIPLOMACY_STATES.NEUTRAL;
                rel.expiresOn = null;
            }
        } else if (rel.state === DIPLOMACY_STATES.CEASEFIRE) {
            rel.turnsAtPeace = (rel.turnsAtPeace || 0) + 1;
            rel.relationship = Math.min(100, (rel.relationship || 0) + 1);
            // Check expiry: revert to NEUTRAL, or to WAR if grievances have built up.
            if (rel.expiresOn && currentTurn > 0 && currentTurn >= rel.expiresOn) {
                rel.state = (rel.grievances || 0) >= GRIEVANCE_WAR_THRESHOLD
                    ? DIPLOMACY_STATES.WAR : DIPLOMACY_STATES.NEUTRAL;
                rel.expiresOn = null;
            }
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
                relationship: rel.relationship || 0,
                grievances: rel.grievances || 0
            });
        }
    }
    return summary;
}

/** Get a human-readable label for a diplomatic state. */
export function stateLabel(state) {
    switch (state) {
        case DIPLOMACY_STATES.NEUTRAL: return '⚪ Neutral';
        case DIPLOMACY_STATES.NAP: return '🛡️ Non-Aggression';
        case DIPLOMACY_STATES.CEASEFIRE: return '🕊️ Ceasefire';
        case DIPLOMACY_STATES.WAR: return '⚔️ War';
        case DIPLOMACY_STATES.PEACE: return '🕊️ Peace';
        case DIPLOMACY_STATES.ALLIANCE: return '🤝 Alliance';
        case DIPLOMACY_STATES.TRADE_PACT: return '💰 Trade Pact';
        default: return state || '?';
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

// --- Peace Negotiations with Demands ---
// A war-weary faction is more willing to accept harsh peace terms (gold
// reparations, territory cession, or ongoing tribute). War weariness is
// stored on the diplomacy state as `warWeariness[faction]`.

/** Create a peace demand object.
 *  @param {'gold'|'territory'|'tribute'} type
 *  @param {object} params - { amount, tiles, duration, perTurn } */
export function createPeaceDemand(type, params = {}) {
    return {
        type,
        amount: params.amount || 0,
        tiles: params.tiles || [],
        duration: params.duration || 0,
        perTurn: params.perTurn || 0
    };
}

/** Evaluate whether a peace demand is acceptable to the defending faction.
 *  NOTE: `personality` is the DEFENDER's aiPersonality string (e.g. 'AGGRESSIVE'),
 *  NOT a faction slot — the original plan keyed AI_PERSONALITIES by the attacker
 *  faction id, which would always miss and fall back to DEFENSIVE.
 *  @returns {{ accepted: boolean, chance: number, reason: string }} */
export function evaluatePeaceDemand(demand, defender, attacker, diploState, resources, powerRatio, warWeariness, personality) {
    const rel = getRelation(diploState, defender, attacker);
    const p = AI_PERSONALITIES[personality] || AI_PERSONALITIES.DEFENSIVE;

    // Base acceptance chance from the defender's personality.
    let chance = p.acceptPeace;

    // Power ratio (attacker / defender): a weaker defender is more likely to accept.
    if (powerRatio < PEACE_ACCEPTANCE_MODIFIERS.POWER_RATIO_THRESHOLD) {
        chance += 0.3;
    } else if (powerRatio > 1.5) {
        chance -= 0.2;
    }

    // War weariness: a weary defender wants out.
    if (warWeariness > PEACE_ACCEPTANCE_MODIFIERS.WEARINESS_THRESHOLD) {
        chance += 0.2;
    }

    // Relationship score (friendlier factions concede more readily).
    chance += (rel.relationship || 0) * PEACE_ACCEPTANCE_MODIFIERS.RELATIONSHIP_BONUS;

    // Past broken treaties erode trust.
    chance += (rel.brokenTreaties || 0) * PEACE_ACCEPTANCE_MODIFIERS.TREATY_HISTORY_PENALTY;

    // Demand severity modifier.
    if (demand.type === 'gold') {
        const affordability = (resources && resources.gold || 0) / Math.max(1, demand.amount);
        if (affordability < 0.5) chance -= 0.3;       // can't afford it
        else if (affordability > 2) chance += 0.1;    // easy to pay
    } else if (demand.type === 'territory') {
        chance -= (demand.tiles || []).length * 0.1;  // each tile costs acceptance
    } else if (demand.type === 'tribute') {
        chance -= (demand.perTurn || 0) * 0.02;      // ongoing cost
    }

    chance = Math.max(0.05, Math.min(0.95, chance));
    const accepted = Math.random() < chance;
    return {
        accepted,
        chance,
        reason: accepted ? 'Demand accepted' : 'Demand rejected'
    };
}

/** Apply war-weariness delta to a faction (positive accumulates, negative decays). */
export function applyWarWeariness(diploState, faction, amount) {
    if (!diploState.warWeariness) diploState.warWeariness = {};
    diploState.warWeariness[faction] = (diploState.warWeariness[faction] || 0) + amount;
}

/** Get the war weariness for a faction (0 if none recorded). */
export function getWarWeariness(diploState, faction) {
    return (diploState.warWeariness || {})[faction] || 0;
}

/** Process war weariness for all factions: accumulate while at war, decay at peace.
 *  Called once per round in endPlayerTurn. */
export function processWarWeariness(diploState, factions) {
    if (!diploState.warWeariness) diploState.warWeariness = {};
    for (const f of factions) {
        let atWar = false;
        for (const other of factions) {
            if (other === f) continue;
            if (getRelation(diploState, f, other).state === DIPLOMACY_STATES.WAR) { atWar = true; break; }
        }
        if (atWar) {
            diploState.warWeariness[f] = (diploState.warWeariness[f] || 0) + WAR_WEARINESS_RATES.PER_TURN;
        } else {
            diploState.warWeariness[f] = Math.max(0,
                (diploState.warWeariness[f] || 0) + WAR_WEARINESS_RATES.DECAY_AT_PEACE);
        }
    }
}

export { PEACE_DEMAND_LIMITS };

// --- Coalition Wars (Feature 12) ---
// A coalition is a temporary alliance-of-convenience for a joint war. The
// leader invites up to COALITION_MAX_ALLIES allies who are friendly enough
// (relationship ≥ threshold); all join the war against the target together
// and share a fraction of the leader's war-declaration penalty. Coalition
// membership is recorded on the diplomacy state so it can be dissolved later.

/** Record a coalition under `diploState.coalitions[leader] = [allies...]`. */
export function formCoalition(diploState, leader, allies) {
    if (!diploState.coalitions) diploState.coalitions = {};
    const list = (allies || []).filter(a => a && a !== leader).slice(0, COALITION_MAX_ALLIES);
    diploState.coalitions[leader] = list;
    return list;
}

/** Which allies of `leader` are eligible to join a coalition war against
 *  `target`? Must be at peace with the target, at war-or-peace (not allied to
 *  target), and friendly enough with the leader. Pure (does not mutate). */
export function eligibleCoalitionAllies(diploState, leader, target, candidates) {
    const out = [];
    for (const a of candidates || []) {
        if (!a || a === leader || a === target) continue;
        const relLeader = getRelation(diploState, leader, a);
        const relTarget = getRelation(diploState, a, target);
        if (relTarget.state === DIPLOMACY_STATES.ALLIANCE) continue; // won't betray an ally
        if ((relLeader.relationship || 0) < COALITION_JOIN_RELATIONSHIP_THRESHOLD) continue;
        out.push(a);
        if (out.length >= COALITION_MAX_ALLIES) break;
    }
    return out;
}

/** Declare a coalition war: every member (leader + allies) goes to WAR with
 *  the target. Each joiner takes COALITION_SHARED_PENALTY fraction of the
 *  leader's relationship penalty. Returns the list of joiners actually at war
 *  with the target afterwards. Mutates diploState. */
export function declareCoalitionWar(diploState, leader, target, allies, currentTurn = 0) {
    const joiners = [leader];
    setRelation(diploState, leader, target, DIPLOMACY_STATES.WAR, currentTurn);
    const relLT = getRelation(diploState, leader, target);
    const leaderPenalty = relLT.relationship || -50;
    for (const a of allies || []) {
        if (!a || a === leader || a === target) continue;
        setRelation(diploState, a, target, DIPLOMACY_STATES.WAR, currentTurn);
        const relAT = getRelation(diploState, a, target);
        // Share a fraction of the leader's penalty so joiners also lose standing.
        relAT.relationship = Math.max(-100, (relAT.relationship || 0) + Math.floor(leaderPenalty * COALITION_SHARED_PENALTY));
        relAT.warsDeclared = (relAT.warsDeclared || 0) + 1;
        joiners.push(a);
    }
    formCoalition(diploState, leader, joiners.filter(j => j !== leader));
    return joiners;
}

/** Read back a faction's current coalition (empty if none). */
export function getCoalition(diploState, leader) {
    return (diploState.coalitions && diploState.coalitions[leader]) || [];
}