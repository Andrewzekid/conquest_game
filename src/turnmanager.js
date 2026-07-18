/** Turn manager: phase FSM (player -> each AI faction -> player) */
import { collectResources, processUpkeep, processCityGrowth, processNeutralCityGrowth } from './economy.js';
import { PLAYER_FACTION, UNIT_TYPE } from './config.js';
import { regenFortification } from './map.js';
import { processTradePacts, updatePeaceCounters } from './diplomacy.js';

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
            if (Math.abs(u.x - medic.x) > 1 || Math.abs(u.z - medic.z) > 1) continue;
            if (u.hp < u.maxHp) u.hp = Math.min(u.maxHp, u.hp + heal);
        }
    }
}

export function createTurnManager(gameState, factions, onPhaseChange, runAI, renderAll) {
    let currentPhase = PLAYER_FACTION;
    const aiFactions = factions.filter(f => f !== PLAYER_FACTION);
    let recalcFog = null;
    let onAutosave = null;
    let logger = null;

    function endPlayerTurn() {
        if (currentPhase !== PLAYER_FACTION) return;

        // Collect resources + upkeep for every faction (using faction defs for passives)
        for (const f of factions) {
            const def = (gameState.factionDefs && gameState.factionDefs[f]) || null;
            collectResources(gameState.tiles, f, gameState.resources[f], gameState.buildings, gameState.lords, def);
            processUpkeep(gameState.units, f, gameState.resources[f]);
            // Natural city growth (Civ6-style): well-fed empires grow and level up
            // their cities automatically over time.
            const fname = (gameState.factionColors && gameState.factionColors[f] && gameState.factionColors[f].name) || f;
            processCityGrowth(gameState.tiles, f, gameState.resources[f], (m) => logger ? logger(`${fname}: ${m}`) : null);
        }

        // Neutral (unowned) cities also grow and expand influence over time.
        processNeutralCityGrowth(gameState.tiles, (m) => logger ? logger(m) : null);

        // Diplomacy bookkeeping: tick peace/alliance/war counters (which drift
        // relationship scores), then pay out trade-pact bonuses.
        if (gameState.diplomacy) {
            updatePeaceCounters(gameState.diplomacy);
            const tradeMsgs = processTradePacts(gameState.diplomacy, gameState.resources);
            if (logger) tradeMsgs.forEach(m => logger(m));
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
        // Reset lord per-turn flags (lords/kings can move once per turn too).
        if (gameState.lords) {
            for (const lord of gameState.lords) lord.hasMovedThisTurn = false;
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

        // Run each AI faction in sequence
        for (const ai of aiFactions) {
            if (gameState.gameOver) break;
            if (gameState.eliminated && gameState.eliminated.has(ai)) continue;
            currentPhase = ai;
            if (onPhaseChange) onPhaseChange(currentPhase);
            if (runAI) runAI(ai);
            if (typeof recalcFog === 'function') recalcFog();
        }

        currentPhase = PLAYER_FACTION;
        if (onPhaseChange) onPhaseChange(currentPhase);

        // Clear selection
        gameState.selectedUnit = null;
        gameState.moveTargets.clear();

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