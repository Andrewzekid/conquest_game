/** Combat system: full battle resolution with HP, death, XP, siege, lords. */
import { UNIT_TYPE, TERRAIN_BONUS, TYPE_ADVANTAGE, LORD_XP_PER_KILL, UNIT_XP_PER_KILL, CHARGE_EXHAUST_RANGED_VULN, ENCIRCLEMENT_DEFENSE_PENALTY, STRUCTURE_TYPE, COUNTER_ATTACK_MULTIPLIER, RIVER_CROSSING_DEFENSE_PENALTY } from './config.js';
import { getLordCombatBonus, getLordSiegeBonus, getLordClassBonus, getAdjacentLordBonuses, awardXP, syncLordHp } from './lords.js';
import { getBuildingDefenseBonus } from './building.js';
import { awardUnitXP } from './unit.js';
import { isPassable } from './map.js';
import { getFactionDef, getCityCaptureBonus, getFortifiedDefenseBonus, getHealOnKill } from './faction.js';

/** Fallback stats for combatants with no UNIT_TYPE entry (lords/kings, which
 *  fight as unit-like combatants). They are melee, non-naval, no siege bonus. */
const LORD_FALLBACK_STATS = { ranged: false, naval: false, siegeBonus: 0, besiege: false, aoe: false, attack: 0, defense: 0 };
function combatStats(u) { return UNIT_TYPE[u.type] || LORD_FALLBACK_STATS; }
/** Display name for combat log lines (lords use their proper name). */
function combatName(u) { return u.name || u.type; }

/** River-crossing penalty (Feature 10): a unit that crossed a river this turn
 *  is bogged down and fights at a defense disadvantage until its next turn.
 *  Returns the flat defense penalty (0 if the unit didn't cross). Pure. */
export function riverCrossingDefensePenalty(unit) {
    if (!unit || !unit.crossedRiverThisTurn) return 0;
    return RIVER_CROSSING_DEFENSE_PENALTY;
}

/**
 * Is `defender` encircled? A defender is encircled when ALL four orthogonal
 * neighbor tiles are blocked (off-map, impassable terrain, or enemy-occupied)
 * AND at least 2 enemy units are orthogonally adjacent. Encirclement is a
 * positional property of the defender, evaluated by the attacker's side, and
 * applies symmetrically to the player and the AI. Naval defenders are exempt
 * (water tiles have no meaningful orthogonal-land surround).
 *
 * @param defender - the defending unit/lord combatant
 * @param units - full units Map (to check occupancy)
 * @param tiles - full tiles Map (to check passability/off-map)
 */
export function isEncircled(defender, units, tiles) {
    if (!defender || !units || !tiles) return false;
    if (UNIT_TYPE[defender.type] && UNIT_TYPE[defender.type].naval) return false;
    const dirs = [[0, 1], [0, -1], [1, 0], [-1, 0]];
    let escapes = 0;
    let enemyAdj = 0;
    for (const [dx, dz] of dirs) {
        const nx = defender.x + dx, nz = defender.z + dz;
        const k = `${nx},${nz}`;
        const t = tiles.get(k);
        // Off-map or impassable terrain = blocked (no escape that way).
        if (!t || !isPassable(t)) continue;
        // Is there a unit on this neighbor tile?
        let occ = null;
        for (const u of units.values()) {
            if (u.x === nx && u.z === nz) { occ = u; break; }
        }
        if (occ) {
            if (occ.owner !== defender.owner) {
                // Enemy-occupied = blocked (and counts toward the surround).
                enemyAdj++;
            } else {
                // Friendly-occupied = an escape route (allies don't trap you).
                escapes++;
            }
        } else {
            // Empty passable tile = a real escape route.
            escapes++;
        }
    }
    return escapes === 0 && enemyAdj >= 2;
}

/**
 * Resolve combat between attacker and defender.
 * Applies damage to HP, handles death, awards XP to surviving lords.
 *
 * @param attackerUnit - the attacking unit
 * @param defenderUnit - the defending unit
 * @param terrain - terrain key string of the defender's tile
 * @param attackerLord - optional lord leading the attacker
 * @param defenderLord - optional lord leading the defender
 * @param buildings - Map<tileKey, buildingType[]> for building defense bonuses
 * @param lords - full lords array (for adjacency aura bonuses)
 * @param tempBonuses - optional map faction->{attack,defense} from king actives (Bloodlust/Bulwark)
 * @param structures - optional Map<tileKey, {type, owner}> of engineer-built
 *   structures; a friendly FORTIFICATION on the defender's tile grants its
 *   defenseBonus.
 * @param defenderCityBreached - true when the defender stands on a CITY tile
 *   whose fortification is 0: the city's terrain and building (walls) defense
 *   bonuses no longer apply — the defenses are down.
 * @returns { messages: string[], defenderDied: boolean, attackerDied: boolean }
 */
export function resolveCombat(attackerUnit, defenderUnit, terrain, attackerLord = null, defenderLord = null, buildings = null, lords = null, tempBonuses = null, encircled = false, structures = null, defenderCityBreached = false, noCounter = false) {
    const messages = [];
    if (!attackerUnit || !defenderUnit) return { messages: ['No combat: missing unit'], defenderDied: false, attackerDied: false, damageToDefender: 0 };

    const atkStats = combatStats(attackerUnit);
    const defStats = combatStats(defenderUnit);
    // A breached city gives no defensive terrain bonus — treat it as open ground.
    const terrainBonus = defenderCityBreached ? TERRAIN_BONUS.PLAINS : (TERRAIN_BONUS[terrain] || TERRAIN_BONUS.PLAINS);
    // Naval units defending on water/river are in their element — no exposed-
    // crossing penalty (the -2 WATER/RIVER defense bonus doesn't apply to ships).
    const defTerrainBonus = (defStats.naval && (terrain === 'WATER' || terrain === 'RIVER'))
        ? { attack: 0, defense: 0 }
        : terrainBonus;

    // --- Attacker damage calculation ---
    let atkMultiplier = 1.0;
    if (TYPE_ADVANTAGE[attackerUnit.type]?.strongAgainst === defenderUnit.type) {
        atkMultiplier *= TYPE_ADVANTAGE[attackerUnit.type].multiplier;
        messages.push(`${attackerUnit.type} has type advantage vs ${defenderUnit.type}!`);
    }

    // Attacker bonuses: own commanding lord's stats + class bonus + adjacent auras.
    const atkLordBonus = getLordCombatBonus(attackerLord);
    const atkClass = getLordClassBonus(attackerLord);
    const atkAdj = getAdjacentLordBonuses(lords, attackerUnit);
    const atkTemp = (tempBonuses && tempBonuses[attackerUnit.owner]) || { attack: 0, defense: 0 };
    const atkPower = attackerUnit.attack ?? atkStats.attack;
    // atkClass.attack is now an AoE (radius 1) applied via atkAdj, not army-only.
    let effectiveAttack = atkPower * atkMultiplier + (terrainBonus.attack || 0)
        + atkLordBonus.attack + atkAdj.attack + atkTemp.attack;

    // --- New European-faction/unit attacker bonuses (Phase G) ---
    const atkDef = getFactionDef(attackerUnit.factionId);
    // BERSERKER frenzy: +3 attack when below 50% HP (glass cannon bites back).
    if (attackerUnit.type === 'BERSERKER' && attackerUnit.hp < (attackerUnit.maxHp || atkStats.hp) * 0.5) {
        effectiveAttack += 3;
        messages.push(`${combatName(attackerUnit)} is in a frenzy! (+3 atk)`);
    }
    // WINGED_HUSSAR alpha strike is handled below as a damage multiplier (2x on
    // the first attack each turn) — it does not add raw attack here.

    // Siege bonus: artillery vs cities, lord siege ability, or Conqueror class.
    const isCity = terrain === 'CITY';
    if (isCity) {
        if (atkStats.siegeBonus) {
            effectiveAttack += atkStats.siegeBonus;
            messages.push(`Artillery siege bonus: +${atkStats.siegeBonus}`);
        }
        const lordSiege = getLordSiegeBonus(attackerLord);
        if (lordSiege > 0) {
            effectiveAttack += lordSiege;
            messages.push(`${attackerLord.name}'s Siege Master: +${lordSiege}`);
        }
        if (atkClass.siege > 0) {
            effectiveAttack += atkClass.siege;
            messages.push(`${attackerLord ? attackerLord.name : 'Conqueror'} class siege: +${atkClass.siege}`);
        }
        // CONQUISTADOR: mounted gunpowder unit, +2 attack vs units in cities.
        if (atkStats.cityBonus) {
            effectiveAttack += atkStats.cityBonus;
            messages.push(`${combatName(attackerUnit)} city assault: +${atkStats.cityBonus}`);
        }
        // Roman Legion passive: +1 damage when capturing/attacking cities.
        const romanCityBonus = getCityCaptureBonus(atkDef);
        if (romanCityBonus > 0) {
            effectiveAttack += romanCityBonus;
            messages.push(`${combatName(attackerUnit)} Roman discipline vs city: +${romanCityBonus}`);
        }
    }

    // Defender defense: terrain + buildings + structures + lord stats + class + adjacent auras.
    const tileKey = `${defenderUnit.x},${defenderUnit.z}`;
    // Walls/buildings only protect while the city stands — a breached city's
    // building defense bonus is gone too.
    const buildingDef = (buildings && !defenderCityBreached) ? getBuildingDefenseBonus(tileKey, buildings) : 0;
    if (defenderCityBreached) messages.push(`The city is breached — its defenses are down!`);
    // Engineer-built FORTIFICATION on the defender's tile (must belong to the
    // defender's faction — structures of the attacker don't help the defender).
    const fort = (structures && structures.get(tileKey)) || null;
    const structureDef = (fort && fort.owner === defenderUnit.owner && STRUCTURE_TYPE[fort.type])
        ? (STRUCTURE_TYPE[fort.type].defenseBonus || 0) : 0;
    const defLordBonus = getLordCombatBonus(defenderLord);
    const defClass = getLordClassBonus(defenderLord);
    const defAdj = getAdjacentLordBonuses(lords, defenderUnit);
    const defTemp = (tempBonuses && tempBonuses[defenderUnit.owner]) || { attack: 0, defense: 0 };
    const defPower = defenderUnit.defense ?? defStats.defense;
    // defClass.defense is now an AoE (radius 1) applied via defAdj, not army-only.
    let effectiveDefense = defPower + defTerrainBonus.defense + buildingDef + structureDef
        + defLordBonus.defense + defAdj.defense + defTemp.defense;
    if (structureDef > 0) {
        messages.push(`${combatName(defenderUnit)} is protected by a Fortification (+${structureDef} def)`);
    }
    // --- New European-faction/unit defender bonuses (Phase G) ---
    const defDef = getFactionDef(defenderUnit.factionId);
    // VARANGIAN_GUARD: +2 defense when a friendly lord is adjacent (Chebyshev-1).
    if (defenderUnit.type === 'VARANGIAN_GUARD' && lords) {
        const guarded = lords.some(l => l && l.owner === defenderUnit.owner &&
            Math.max(Math.abs(l.x - defenderUnit.x), Math.abs(l.z - defenderUnit.z)) <= 1);
        if (guarded) {
            effectiveDefense += 2;
            messages.push(`${combatName(defenderUnit)} guards its lord (+2 def)`);
        }
    }
    // Byzantine Empire passive: fortified units (holding position this turn)
    // gain +2 defense.
    const byzFort = getFortifiedDefenseBonus(defDef);
    if (byzFort > 0 && !defenderUnit.hasMovedThisTurn) {
        effectiveDefense += byzFort;
        messages.push(`${combatName(defenderUnit)} is fortified (+${byzFort} def)`);
    }
    // Encircled defenders fight at a disadvantage (no room to maneuver).
    if (encircled) {
        effectiveDefense -= ENCIRCLEMENT_DEFENSE_PENALTY;
        messages.push(`${combatName(defenderUnit)} is encircled! (-${ENCIRCLEMENT_DEFENSE_PENALTY} def, no counter)`);
    }
    // River-crossing penalty (Feature 10): a defender that crossed a river this
    // turn is bogged down and easier to hit.
    const defRiverPenalty = riverCrossingDefensePenalty(defenderUnit);
    if (defRiverPenalty > 0) {
        effectiveDefense -= defRiverPenalty;
        messages.push(`${combatName(defenderUnit)} crossed a river this turn (-${defRiverPenalty} def)`);
    }

    let damageToDefender = Math.max(1, Math.floor(effectiveAttack - effectiveDefense * 0.3));
    // WINGED_HUSSAR: devastating alpha strike — the first attack each turn deals
    // 2x damage (chargeMultiplier). Only the hussar's own first swing, not a
    // counter-attack (this branch is the attacker's strike).
    if (attackerUnit.type === 'WINGED_HUSSAR' && atkStats.chargeMultiplier &&
        !attackerUnit.hasAttackedThisTurn) {
        damageToDefender = Math.max(1, Math.floor(damageToDefender * atkStats.chargeMultiplier));
        messages.push(`${combatName(attackerUnit)} winged charge deals ×${atkStats.chargeMultiplier} damage!`);
    }
    // Exhausted cavalry (charged last turn) is extra vulnerable to ranged fire
    // — archers and artillery exploit the spent, immobile mount.
    if (defenderUnit.chargeExhausted && defenderUnit.chargeExhausted > 0 && atkStats.ranged) {
        damageToDefender = Math.max(1, Math.floor(damageToDefender * CHARGE_EXHAUST_RANGED_VULN));
        messages.push(`${defenderUnit.type} is exhausted — ranged fire deals ${damageToDefender} (×${CHARGE_EXHAUST_RANGED_VULN})!`);
    }
    defenderUnit.hp -= damageToDefender;
    messages.push(`${combatName(attackerUnit)} attacks ${combatName(defenderUnit)} for ${damageToDefender} damage (HP: ${Math.max(0, defenderUnit.hp)}/${defenderUnit.maxHp})`);

    // Keep a lord combatant's hp synced onto its lord object as it changes.
    const sync = () => { syncLordHp(attackerUnit); syncLordHp(defenderUnit); };

    const defenderDied = defenderUnit.hp <= 0;
    if (defenderDied) {
        messages.push(`${combatName(defenderUnit)} was destroyed!`);
        // Viking Raiders passive: the killing unit heals a few HP on the kill.
        const healOnKill = getHealOnKill(atkDef);
        if (healOnKill > 0 && attackerUnit.hp > 0) {
            const before = attackerUnit.hp;
            attackerUnit.hp = Math.min(attackerUnit.maxHp || before, before + healOnKill);
            if (attackerUnit.hp > before) {
                messages.push(`${combatName(attackerUnit)} raids and heals ${attackerUnit.hp - before} HP`);
            }
        }
        // Award XP: a lord attacker earns lord XP; otherwise the attacker's
        // commanding lord (if any) and the attacker unit itself gain XP.
        if (attackerUnit._isLord) {
            messages.push(...awardXP(attackerUnit._lord, LORD_XP_PER_KILL));
        } else {
            if (attackerLord) messages.push(...awardXP(attackerLord, LORD_XP_PER_KILL));
            messages.push(...awardUnitXP(attackerUnit, UNIT_XP_PER_KILL));
        }
        sync();
        return { messages, defenderDied: true, attackerDied: false, damageToDefender };
    }

    // --- Defender counter-attack ---
    // Only a melee defender counter-attacks, and only against a melee attacker:
    // a unit being shot from range cannot strike back, and ranged defenders
    // don't counter at melee. Encircled defenders cannot counter-attack (they
    // are surrounded). Counter-attacks are weaker than full attacks.
    if (!defStats.ranged && !atkStats.ranged && !encircled && !noCounter) {
        let defMultiplier = 1.0;
        if (TYPE_ADVANTAGE[defenderUnit.type]?.strongAgainst === attackerUnit.type) {
            defMultiplier *= TYPE_ADVANTAGE[defenderUnit.type].multiplier;
            messages.push(`${combatName(defenderUnit)} counter type advantage!`);
        }

        const effectiveAttackDef = (defenderUnit.attack ?? defStats.attack) * defMultiplier + defLordBonus.attack;
        let effectiveDefenseAtk = (attackerUnit.defense ?? atkStats.defense) + atkLordBonus.defense;
        // River-crossing penalty also applies to the attacker on the counter.
        const atkRiverPenalty = riverCrossingDefensePenalty(attackerUnit);
        if (atkRiverPenalty > 0) effectiveDefenseAtk -= atkRiverPenalty;
        const damageToAttacker = Math.max(1, Math.floor((effectiveAttackDef - effectiveDefenseAtk * 0.3) * COUNTER_ATTACK_MULTIPLIER));
        attackerUnit.hp -= damageToAttacker;
        messages.push(`${combatName(defenderUnit)} counter-attacks for ${damageToAttacker} damage (HP: ${Math.max(0, attackerUnit.hp)}/${attackerUnit.maxHp})`);

        const attackerDied = attackerUnit.hp <= 0;
        if (attackerDied) {
            messages.push(`${combatName(attackerUnit)} was destroyed in counter-attack!`);
            if (defenderUnit._isLord) {
                messages.push(...awardXP(defenderUnit._lord, LORD_XP_PER_KILL));
            } else {
                if (defenderLord) messages.push(...awardXP(defenderLord, LORD_XP_PER_KILL));
                messages.push(...awardUnitXP(defenderUnit, UNIT_XP_PER_KILL));
            }
            sync();
            return { messages, defenderDied: false, attackerDied: true, damageToDefender };
        }
    }

    sync();
    return { messages, defenderDied: false, attackerDied: false, damageToDefender };
}

/**
 * Check if a unit can capture a tile.
 * Must be military unit, tile must be unowned or enemy-owned, and player has gold.
 */
export function canCaptureTile(unitOwner, tile, resources, diploState = null) {
    // Can't capture own tile
    if (tile.owner === unitOwner) return false;
    // Must have gold
    if (resources.gold < 20) return false;
    // A fortified city must be besieged (fortification reduced to 0) before capture.
    if (tile.terrain === 'CITY' && (tile.fortification || 0) > 0) return false;
    return true;
}

/**
 * Capture a tile: deduct gold, set owner.
 * Returns messages array.
 */
export function captureTile(tile, unitOwner, resources) {
    const messages = [];
    resources.gold -= 20;
    const prevOwner = tile.owner;
    tile.owner = unitOwner;
    tile.loyalty = 3; // turns until fully loyal (revolt risk)
    if (prevOwner) {
        messages.push(`${unitOwner} captured tile [${tile.x}, ${tile.z}] from ${prevOwner}!`);
    } else {
        messages.push(`${unitOwner} claimed tile [${tile.x}, ${tile.z}]!`);
    }
    return messages;
}

/**
 * Process loyalty decay for captured tiles.
 * Returns messages for any revolts.
 */
export function processLoyalty(tiles, owner) {
    const messages = [];
    for (const tile of tiles.values()) {
        if (tile.owner === owner && tile.loyalty > 0) {
            tile.loyalty--;
            if (tile.loyalty === 0) {
                // Small chance of revolt
                if (Math.random() < 0.1) {
                    tile.owner = null;
                    messages.push(`Revolt at [${tile.x}, ${tile.z}]! Tile lost.`);
                }
            }
        }
    }
    return messages;
}

/**
 * Predict the outcome of a combat WITHOUT mutating any real state. Used by
 * the AI to decide whether an attack is favorable before committing.
 *
 * Shallow-clones the attacker and defender (resolveCombat only mutates `hp` on
 * the objects it's handed), passes `null` for both lords so awardXP cannot
 * mutate real lords during prediction, and runs resolveCombat on the clones.
 * The real `lords` array is still passed so adjacency auras are computed
 * (getAdjacentLordBonuses only reads from lords, it never mutates them).
 *
 * Returns { defenderDied, attackerDied, damageToDefender, damageToAttacker }.
 */
export function simulateCombat(attackerUnit, defenderUnit, terrain, attackerLord = null, defenderLord = null, buildings = null, lords = null, tempBonuses = null, encircled = false, structures = null, defenderCityBreached = false) {
    if (!attackerUnit || !defenderUnit) {
        return { defenderDied: false, attackerDied: false, damageToDefender: 0, damageToAttacker: 0 };
    }
    const aClone = { ...attackerUnit };
    const dClone = { ...defenderUnit };
    const aHp0 = aClone.hp;
    const dHp0 = dClone.hp;
    // Clone the lords so that awardXP (fired on a predicted kill) mutates the
    // clone instead of the real lord, while the real lord's combat bonuses
    // (read off .stats/.class/.abilities) still apply to the damage math. The
    // real `lords` array is passed through so adjacency auras are computed
    // (getAdjacentLordBonuses only reads from it, never mutates).
    const cloneLord = (l) => l
        ? { ...l, stats: { ...(l.stats || {}) }, abilities: [...(l.abilities || [])], army: [...(l.army || [])] }
        : null;
    const result = resolveCombat(aClone, dClone, terrain, cloneLord(attackerLord), cloneLord(defenderLord), buildings, lords, tempBonuses, encircled, structures, defenderCityBreached);
    return {
        defenderDied: result.defenderDied,
        attackerDied: result.attackerDied,
        damageToDefender: dHp0 - (dClone.hp || 0),
        damageToAttacker: aHp0 - (aClone.hp || 0)
    };
}