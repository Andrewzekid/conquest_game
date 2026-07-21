/** Turn manager: phase FSM (player -> each AI faction -> player) */
import { collectResources, processUpkeep, processCityGrowth, processNeutralCityGrowth,
         processUnrest, applyFactionUnrest, getTradeRouteIncome, processTradeRouteRaids } from './economy.js';
import { PLAYER_FACTION, UNIT_TYPE } from './config.js';
import { regenFortification } from './map.js';
import { processTradePacts, updatePeaceCounters, addGrievance, getRelation, grievanceLevel,
         processWarWeariness } from './diplomacy.js';
import { addResearch, calculateResearchOutput, autoSelectResearch, TECHS } from './tech.js';

/** Medics heal adjacent (Chebyshev-1) friendly non-medic units by their `heal`
 *  amount, capped at maxHp. Applied to every faction at turn start. */
function processMedicHeal(units) {
    const medics = [];
    for (const u of units.values()) {
        if (u.type === 'MEDIC') medics.push(u);
    }
    for (const medic of medics) {
        const heal = (UNIT_TYPE.MEDIC && UNIT_TYPE.MEDIC.heal) || 2;
        for (const u of units.values()) {
            if (u.owner !== medic.owner) continue;
            if (u.id === medic.id) continue;
            if (u.type === 'MEDIC') continue;
            // BERSERKERS fight beyond the aid of medics (noMedic flag).
            if (UNIT_TYPE[u.type] && UNIT_TYPE[u.type].noMedic) continue;
            if (Math.abs(u.x - medic.x) > 1 || Math.abs(u.z - medic.z) > 1) continue;
            if (u.hp < u.maxHp) u.hp = Math.min(u.maxHp, u.hp + heal);
        }
    }
}

export function createTurnManager(gameState, factions, onPhaseChange, runAI, renderAll, spectateMode = false) {
    let currentPhase = PLAYER_FACTION;
    // In spectate mode, ALL factions are AI-controlled (including the "player" slot)
    const aiFactions = spectateMode ? [...factions] : factions.filter(f => f !== PLAYER_FACTION);
    let recalcFog = null;
    let onAutosave = null;
    let logger = null;

    function endPlayerTurn() {
        // In spectate mode, skip the player phase check - AI handles everything
        if (!spectateMode && currentPhase !== PLAYER_FACTION) return;

        // Collect resources + upkeep for every faction (using faction defs for passives)
        for (const f of factions) {
            const def = (gameState.factionDefs && gameState.factionDefs[f]) || null;
            collectResources(gameState.tiles, f, gameState.resources[f], gameState.buildings, gameState.lords, def);
            processUpkeep(gameState.units, f, gameState.resources[f]);
            // Natural city growth (Civ6-style): well-fed empires grow and level up
            // their cities automatically over time.
            const fname = (gameState.factionColors && gameState.factionColors[f] && gameState.factionColors[f].name) || f;
            processCityGrowth(gameState.tiles, f, gameState.resources[f], (m) => logger ? logger(`${fname}: ${m}`) : null);
            // City unrest & loyalty: recompute each city's unrest, resolve
            // rebellions, then apply a faction-wide yield penalty. Cities
            // captured this turn (tile.lastConqueredTurn) get a recent-conquest
            // spike that decays over the following turns.
            if (!gameState.eliminated || !gameState.eliminated.has(f)) {
                const { messages: unrestMsgs, rebellions } = processUnrest(
                    gameState.tiles, f, gameState.units, gameState.lords, gameState.turn, gameState.buildings, gameState.resources[f]);
                if (logger) unrestMsgs.forEach(m => logger(`${fname}: ${m}`));
                if (rebellions && rebellions.length) {
                    // A rebelled city may flip to a new owner; ownership change
                    // is handled inside processUnrest. Re-check elimination is
                    // done by the host game's victory check on the next render.
                }
                const penaltyMsgs = applyFactionUnrest(gameState.tiles, f, gameState.resources[f]);
                if (logger) penaltyMsgs.forEach(m => logger(`${fname}: ${m}`));
            }
        }

        // Neutral (unowned) cities also grow and expand influence over time.
        processNeutralCityGrowth(gameState.tiles, (m) => logger ? logger(m) : null);

        // Trade routes: pay out income per faction, process raids (an enemy
        // military unit on a route's path steals gold and disrupts it), then
        // tick disruption timers. Run once per round after resources collected.
        if (Array.isArray(gameState.tradeRoutes) && gameState.tradeRoutes.length) {
            for (const f of factions) {
                const inc = getTradeRouteIncome(gameState.tiles, f, gameState.tradeRoutes);
                if (inc > 0 && gameState.resources[f]) {
                    gameState.resources[f].gold = (gameState.resources[f].gold || 0) + inc;
                }
            }
            for (const f of factions) {
                const { raided, messages: rmsgs } = processTradeRouteRaids(gameState.tradeRoutes, gameState.units, f);
                if (logger) rmsgs.forEach(m => logger(m));
                for (const r of raided) {
                    const stolen = r.stolen;
                    if (gameState.resources[f]) gameState.resources[f].gold = (gameState.resources[f].gold || 0) + stolen;
                    const victim = r.route.from.owner;
                    if (victim !== f && gameState.resources[victim]) {
                        // stolen gold is income that won't be paid; subtract from victim.
                        gameState.resources[victim].gold = Math.max(0, (gameState.resources[victim].gold || 0) - stolen);
                    }
                }
            }
            // Disruption decay: disrupted routes recover after their timer ends.
            for (const route of gameState.tradeRoutes) {
                if (route.disrupted && route.disruptedTurnsLeft > 0) {
                    route.disruptedTurnsLeft -= 1;
                    if (route.disruptedTurnsLeft <= 0) route.disrupted = false;
                }
            }
        }

        // Tech tree: accumulate research for the player each turn.
        if (gameState.techState) {
            const researchPts = calculateResearchOutput(gameState.tiles, PLAYER_FACTION, gameState.buildings);
            if (researchPts > 0) {
                const completed = addResearch(gameState.techState, researchPts);
                if (completed && completed.length > 0) {
                    for (const techId of completed) {
                        if (logger) logger(`Research complete: ${techId}!`);
                    }
                }
            }
        }

        // AI factions research from the shared tech tree.
        if (gameState.aiTechStates) {
            for (const ai of aiFactions) {
                if (gameState.eliminated && gameState.eliminated.has(ai)) continue;
                const aiTs = gameState.aiTechStates[ai];
                if (!aiTs) continue;
                if (!aiTs.current) {
                    const def = (gameState.factionDefs && gameState.factionDefs[ai]) || null;
                    const personality = (def && def.aiPersonality) || 'BALANCED';
                    autoSelectResearch(aiTs, personality);
                }
                const researchPts = calculateResearchOutput(gameState.tiles, ai, gameState.buildings);
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

        // Diplomacy bookkeeping: tick peace/alliance/war counters (which drift
        // relationship scores), then pay out trade-pact bonuses.
        if (gameState.diplomacy) {
            updatePeaceCounters(gameState.diplomacy, gameState.turn);
            // Precompute which factions own a Harbor so trade pacts can pay a
            // Harbor+trade passive gold bonus.
            const harborFactions = new Set();
            if (gameState.buildings) {
                for (const [key, list] of gameState.buildings) {
                    if (!Array.isArray(list) || !list.includes('HARBOR')) continue;
                    const t = gameState.tiles.get(key);
                    if (t && t.owner) harborFactions.add(t.owner);
                }
            }
            const tradeMsgs = processTradePacts(gameState.diplomacy, gameState.resources, harborFactions);
            if (logger) tradeMsgs.forEach(m => logger(m));
            // War weariness: accumulate while at war, decay at peace. Drives
            // peace-demand acceptance (weary factions concede more readily).
            processWarWeariness(gameState.diplomacy, factions);
            // Tribute payouts from accepted peace demands: the `from` faction
            // pays `to` perTurn gold each turn until turnsLeft hits 0.
            const rels = gameState.diplomacy.relations || {};
            for (const rel of Object.values(rels)) {
                if (!rel.tribute || rel.tribute.turnsLeft <= 0) continue;
                const fromRes = gameState.resources[rel.tribute.from];
                const toRes = gameState.resources[rel.tribute.to];
                if (fromRes && toRes) {
                    const paid = Math.min(rel.tribute.perTurn, fromRes.gold || 0);
                    fromRes.gold = Math.max(0, (fromRes.gold || 0) - paid);
                    toRes.gold = (toRes.gold || 0) + paid;
                }
                rel.tribute.turnsLeft -= 1;
                if (rel.tribute.turnsLeft <= 0) {
                    if (logger) logger(`Tribute from ${rel.tribute.from} to ${rel.tribute.to} has ended.`);
                    rel.tribute = null;
                }
            }
        }
        // Reputation drift: a faction at peace with everyone slowly rebuilds
        // trust (+1/turn, capped 100). War stops the recovery; treaty breaks and
        // surprise declarations already applied one-time hits in handleDiplomacy.
        if (gameState.reputation && gameState.diplomacy) {
            for (const f of factions) {
                if (gameState.eliminated && gameState.eliminated.has(f)) continue;
                let atWar = false;
                for (const o of factions) {
                    if (o === f) continue;
                    const s = gameState.diplomacy.relations[`${[f, o].sort().join(':')}`];
                    if (s && s.state === 'war') { atWar = true; break; }
                }
                if (!atWar) {
                    gameState.reputation[f] = Math.min(100, (gameState.reputation[f] == null ? 50 : gameState.reputation[f]) + 1);
                }
            }
        }

        // Civ6-style tension: any non-at-war faction whose tile hosts another
        // faction's military unit grows aggrieved (units in foreign territory).
        // Scanned once per round; +2 per offending unit per turn.
        if (gameState.diplomacy) {
            for (const u of gameState.units.values()) {
                if (gameState.eliminated && gameState.eliminated.has(u.owner)) continue;
                const t = gameState.tiles.get(`${u.x},${u.z}`);
                if (!t || !t.owner || t.owner === u.owner) continue;
                // At war → no grievance (that's just combat). Only peacetime
                // trespass counts as a provocation.
                if (getRelation(gameState.diplomacy, u.owner, t.owner).state === 'war') continue;
                const existing = getRelation(gameState.diplomacy, t.owner, u.owner).grievances || 0;
                const amount = grievanceLevel(existing) === 'hostile' || grievanceLevel(existing) === 'furious' ? 4 : 2;
                addGrievance(gameState.diplomacy, t.owner, u.owner, amount, 'troops in territory');
            }
        }

        // Denunciation: if any AI faction holds furious grievances against the
        // player and hasn't denounced recently, apply a reputation penalty and
        // log it. Once per relation, not every turn.
        if (gameState.diplomacy && gameState.diplomacy.diplomaticEvents) {
            for (const [key, rel] of Object.entries(gameState.diplomacy.relations)) {
                const [a, b] = key.split(':');
                if (a !== 'player' && b !== 'player') continue;
                if ((rel.grievances || 0) < 40) continue;
                const aiFaction = a === 'player' ? b : a;
                if (gameState.eliminated && gameState.eliminated.has(aiFaction)) continue;
                // Check if already denounced recently (last 10 turns)
                const events = gameState.diplomacy.diplomaticEvents;
                let recentDenounce = false;
                for (let i = events.length - 1; i >= 0; i--) {
                    if (events[i].type === 'denounce' && events[i].factions && events[i].factions.includes(aiFaction) && events[i].turn > gameState.turn - 10) {
                        recentDenounce = true; break;
                    }
                }
                if (!recentDenounce && gameState.reputation) {
                    gameState.reputation.player = Math.max(0, (gameState.reputation.player || 50) - 5);
                    events.push({ type: 'denounce', factions: [aiFaction], turn: gameState.turn, message: 'denounced you' });
                    if (logger) logger(`A faction has denounced you! (Reputation -5)`);
                }
            }
        }

        // Medics heal adjacent friendly units (once per round, all factions).
        processMedicHeal(gameState.units);

        gameState.turn++;

        // Reset all unit per-turn flags
        for (const unit of gameState.units.values()) {
            unit.hasMovedThisTurn = false;
            unit.hasAttackedThisTurn = false;
        }
        // Post-charge exhaustion: cavalry that charged last turn can't move
        // this turn and stays vulnerable to ranged fire. The counter starts at
        // 2 — at the first reset it imposes immobility and drops to 1 (vulnerable
        // for this turn); at the next reset it clears to 0 (free again).
        for (const unit of gameState.units.values()) {
            if (unit.chargeExhausted && unit.chargeExhausted > 0) {
                if (unit.chargeExhausted >= 2) unit.hasMovedThisTurn = true;
                unit.chargeExhausted -= 1;
            }
        }
        // Fall-trap stun: a unit that triggered an enemy fall trap loses its
        // next turn (cannot move or attack), then the stun clears.
        for (const unit of gameState.units.values()) {
            if (unit.stunnedTurns && unit.stunnedTurns > 0) {
                unit.hasMovedThisTurn = true;
                unit.hasAttackedThisTurn = true;
                unit.stunnedTurns -= 1;
            }
        }
        // Reset lord per-turn flags (lords/kings can move and attack once per
        // turn, like units) and slowly regenerate their HP between battles.
        // Kings resting inside one of their own cities recover faster.
        if (gameState.lords) {
            for (const lord of gameState.lords) {
                lord.hasMovedThisTurn = false;
                lord.hasAttackedThisTurn = false;
                if (typeof lord.maxHp === 'number' && typeof lord.hp === 'number' && lord.hp < lord.maxHp) {
                    const tile = gameState.tiles && gameState.tiles.get(`${lord.x},${lord.z}`);
                    const inOwnCity = tile && tile.terrain === 'CITY' && tile.owner === lord.owner;
                    const heal = (lord.isKing && inOwnCity) ? 5 : 2;
                    lord.hp = Math.min(lord.maxHp, lord.hp + heal);
                }
            }
        }

        // Each city may train one unit per turn — reset the limit.
        if (gameState.trainedThisTurn) gameState.trainedThisTurn.clear();

        // King active cooldowns tick down.
        if (gameState.kingCooldowns) {
            for (const f of factions) {
                if (gameState.kingCooldowns[f] > 0) gameState.kingCooldowns[f]--;
            }
        }
        // One-turn king actives (Bloodlust/Bulwark) expire.
        if (gameState.tempBonuses) for (const k of Object.keys(gameState.tempBonuses)) delete gameState.tempBonuses[k];

        // Fortifications regrow on cities not being actively besieged.
        regenFortification(gameState.tiles, gameState.units);

        // Run each AI faction in sequence. Each faction is wrapped in try/catch
        // so a bug or unexpected state in one AI's turn can't freeze the whole
        // round (which would hang the game in both normal and spectate/auto mode).
        for (const ai of aiFactions) {
            if (gameState.gameOver) break;
            if (gameState.eliminated && gameState.eliminated.has(ai)) continue;
            currentPhase = ai;
            if (onPhaseChange) onPhaseChange(currentPhase);
            if (runAI) {
                try {
                    runAI(ai);
                } catch (err) {
                    // Log and keep going — one broken AI turn must not halt the round.
                    if (logger) logger(`⚠️ AI turn error for ${ai}: ${err && err.message ? err.message : err}`);
                    if (typeof console !== 'undefined' && console.error) console.error('AI turn error:', err);
                }
            }
            if (typeof recalcFog === 'function') recalcFog();
        }

        currentPhase = PLAYER_FACTION;
        if (onPhaseChange) onPhaseChange(currentPhase);

        // Clear selection
        gameState.selectedUnit = null;
        gameState.selectedLord = null;
        gameState.moveTargets.clear();
        gameState.attackTargets = [];
        gameState.chargeTargets = [];
        gameState.bridgeTargets = [];
        gameState.siegeTowerTarget = null;
        gameState.chariotChargeTargets = [];

        if (renderAll) renderAll();
        if (typeof onAutosave === 'function') onAutosave();
    }

    return {
        get phase() { return currentPhase; },
        set phase(v) { currentPhase = v; },
        endPlayerTurn,
        setRecalcFog: (fn) => { recalcFog = fn; },
        setAutosave: (fn) => { onAutosave = fn; },
        setLogger: (fn) => { logger = fn; }
    };
}