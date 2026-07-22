/** Combat system: full battle resolution with HP, death, XP, siege, lords. */
import { UNIT_TYPE, TERRAIN_BONUS, TYPE_ADVANTAGE, LORD_XP_PER_KILL, UNIT_XP_PER_KILL, CHARGE_EXHAUST_RANGED_VULN, ENCIRCLEMENT_DEFENSE_PENALTY, STRUCTURE_TYPE, COUNTER_ATTACK_MULTIPLIER, RIVER_CROSSING_DEFENSE_PENALTY, SIEGE_TOWER_CITY_DEFENSE_REDUCTION } from './config.js';
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
 * @param units - optional full units Map (for adjacency-based passives like
 *   MUSKETEER volley fire and LINE_INFANTRY formation).
 * @returns { messages: string[], defenderDied: boolean, attackerDied: boolean }
 */
export function resolveCombat(attackerUnit, defenderUnit, terrain, attackerLord = null, defenderLord = null, buildings = null, lords = null, tempBonuses = null, encircled = false, structures = null, defenderCityBreached = false, noCounter = false, units = null) {
    const messages = [];
    if (!attackerUnit || !defenderUnit) return { messages: ['No combat: missing unit'], defenderDied: false, attackerDied: false, damageToDefender: 0 };

    // Siege-only units (SIEGE) can only attack cities — block attacks on units.
    const atkType = UNIT_TYPE[attackerUnit.type];
    if (atkType && atkType.siegeOnly && terrain !== 'CITY') {
        return { messages: [`${combatName(attackerUnit)} can only attack cities!`], defenderDied: false, attackerDied: false, damageToDefender: 0 };
    }

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
    if (TYPE_ADVANTAGE[attackerUnit.type]) {
        const adv = TYPE_ADVANTAGE[attackerUnit.type];
        const targets = Array.isArray(adv.strongAgainst) ? adv.strongAgainst : [adv.strongAgainst];
        if (targets.includes(defenderUnit.type)) {
            atkMultiplier *= adv.multiplier;
            messages.push(`${attackerUnit.type} has type advantage vs ${defenderUnit.type}!`);
        }
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

    // Siege-specific temp bonus: Iron Will gives +siegeAttack to siege units.
    const SIEGE_TYPES = new Set(['SIEGE', 'ARTILLERY', 'CATAPULT', 'TREBUCHET', 'CANNON', 'MORTAR', 'FIELD_GUN', 'HORSE_ARTILLERY', 'SIEGE_CANNON', 'RAILGUN', 'SIEGE_TOWER']);
    if (SIEGE_TYPES.has(attackerUnit.type) && atkTemp.siegeAttack) {
        effectiveAttack += atkTemp.siegeAttack;
    }

    // --- New European-faction/unit attacker bonuses (Phase G) ---
    const atkDef = getFactionDef(attackerUnit.factionId);
    // BERSERKER frenzy: +3 attack when below 50% HP (glass cannon bites back).
    if (attackerUnit.type === 'BERSERKER' && attackerUnit.hp < (attackerUnit.maxHp || atkStats.hp) * 0.5) {
        effectiveAttack += 3;
        messages.push(`${combatName(attackerUnit)} is in a frenzy! (+3 atk)`);
    }
    // WINGED_HUSSAR alpha strike is handled below as a damage multiplier (2x on
    // the first attack each turn) — it does not add raw attack here.

    // === RENAISSANCE/ENLIGHTENMENT/MODERN ERA UNIT BONUSES ===
    // MUSKETEER volley fire: +1 attack per adjacent friendly MUSKETEER.
    if (attackerUnit.type === 'MUSKETEER' && units) {
        let adjacentMusketters = 0;
        for (const other of units.values()) {
            if (other.owner !== attackerUnit.owner || other.type !== 'MUSKETEER' || other.id === attackerUnit.id) continue;
            if (Math.abs(other.x - attackerUnit.x) + Math.abs(other.z - attackerUnit.z) === 1) adjacentMusketters++;
        }
        if (adjacentMusketters > 0) {
            effectiveAttack += adjacentMusketters;
            messages.push(`${combatName(attackerUnit)} volley fire: +${adjacentMusketters} atk (${adjacentMusketters} adjacent)`);
        }
    }
    // LINE_INFANTRY formation: +2 defense when 2+ friendly infantry adjacent.
    // (Defense bonus applied below in defender section)

    // Precompute isCity once — used by several per-unit bonus blocks below
    // BEFORE the general siege-bonus section. Declaring it here (before the
    // per-unit blocks that reference it) avoids a temporal-dead-zone
    // ReferenceError ("Cannot access 'isCity' before initialization").
    const isCity = terrain === 'CITY';
    // Defender's tile key — precomputed here (with isCity) because per-unit
    // bonus blocks below (e.g. DEMOLITION_SQUAD) reference it BEFORE the
    // defender-defense section where it used to be declared (same TDZ
    // ReferenceError class as isCity above).
    const tileKey = `${defenderUnit.x},${defenderUnit.z}`;

    // CANNON siege bonus: additional +4 vs cities (stacks with base siegeBonus).
    if (attackerUnit.type === 'CANNON' && isCity) {
        effectiveAttack += 4;
        messages.push(`${combatName(attackerUnit)} cannonball barrage: +4 vs city`);
    }
    // MORTAR AOE: splash damage handled separately in AOE section.

    // SHARPSHOOTER sniper: +3 vs lords, settlers, engineers.
    if (attackerUnit.type === 'SHARPSHOOTER' && defenderUnit) {
        if (defenderUnit.lordId || defenderUnit._isLord || defenderUnit.type === 'SETTLER' || defenderUnit.type === 'ENGINEER') {
            effectiveAttack += 3;
            messages.push(`${combatName(attackerUnit)} precision shot: +3 vs high-value target`);
        }
    }
    // DEMOLITION_SQUAD demolish: +5 vs cities and buildings.
    if (attackerUnit.type === 'DEMOLITION_SQUAD' && (isCity || (buildings && buildings.get(tileKey)?.length > 0))) {
        effectiveAttack += 5;
        messages.push(`${combatName(attackerUnit)} demolition charge: +5 vs fortification`);
    }
    // SIEGE_CANNON fort buster: +6 vs cities.
    if (attackerUnit.type === 'SIEGE_CANNON' && isCity) {
        effectiveAttack += 6;
        messages.push(`${combatName(attackerUnit)} fort buster: +6 vs city`);
    }
    // TORPEDO_BOAT torpedo: +8 vs naval units.
    if (attackerUnit.type === 'TORPEDO_BOAT' && defStats.naval) {
        effectiveAttack += 8;
        messages.push(`${combatName(attackerUnit)} torpedo strike: +8 vs naval`);
    }

    // Siege bonus: artillery vs cities, lord siege ability, or Conqueror class.
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
    // (tileKey was precomputed above, next to isCity.)
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
    // RIFLEMAN accurate: ignores 50% of target defense. Must run AFTER the
    // effectiveDefense declaration above — before this fix it referenced the
    // binding in its temporal dead zone (ReferenceError on every attack).
    if (attackerUnit.type === 'RIFLEMAN') {
        effectiveDefense *= 0.5;
        messages.push(`${combatName(attackerUnit)} rifled accuracy: target defense halved!`);
    }
    if (structureDef > 0) {
        messages.push(`${combatName(defenderUnit)} is protected by a Fortification (+${structureDef} def)`);
    }
    // Siege Tower support: a friendly SIEGE_TOWER adjacent to an unbreached
    // city undermines its defenses — the garrison can't fully man the walls
    // while a tower is at the gates. Lowers the city's defense bonus for
    // combat against that city (attackers of the tower's owner only).
    if (isCity && !defenderCityBreached && units) {
        let towerSupport = false;
        for (const u of units.values()) {
            if (u.owner !== attackerUnit.owner || u.type !== 'SIEGE_TOWER') continue;
            if (Math.abs(u.x - defenderUnit.x) + Math.abs(u.z - defenderUnit.z) === 1) { towerSupport = true; break; }
        }
        if (towerSupport) {
            effectiveDefense -= SIEGE_TOWER_CITY_DEFENSE_REDUCTION;
            messages.push(`A siege tower undermines the city walls (-${SIEGE_TOWER_CITY_DEFENSE_REDUCTION} def)`);
        }
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
    // === RENAISSANCE/ENLIGHTENMENT/MODERN ERA DEFENDER BONUSES ===
    // LINE_INFANTRY formation: +2 defense when 2+ friendly infantry adjacent.
    if (defenderUnit.type === 'LINE_INFANTRY' && units) {
        const infantryTypes = new Set(['INFANTRY', 'LINE_INFANTRY', 'RIFLEMAN', 'MUSKETEER']);
        let adjacentInfantry = 0;
        for (const other of units.values()) {
            if (other.owner !== defenderUnit.owner || other.id === defenderUnit.id) continue;
            if (!infantryTypes.has(other.type)) continue;
            if (Math.abs(other.x - defenderUnit.x) + Math.abs(other.z - defenderUnit.z) === 1) adjacentInfantry++;
        }
        if (adjacentInfantry >= 2) {
            effectiveDefense += 2;
            messages.push(`${combatName(defenderUnit)} formation discipline: +2 def (${adjacentInfantry} adjacent)`);
        }
    }
    // IRONCLAD armored: reduces ranged damage taken by 50%.
    if (defenderUnit.type === 'IRONCLAD' && atkStats.ranged) {
        effectiveDefense += Math.floor(effectiveDefense * 0.5);
        messages.push(`${combatName(defenderUnit)} armored hull: +50% effective defense vs ranged`);
    }
    // IRONCLAD_FRIGATE heavyArmor: takes 1 less damage from all sources.
    if (defenderUnit.type === 'IRONCLAD_FRIGATE') {
        effectiveDefense += 3;
        messages.push(`${combatName(defenderUnit)} heavy armor: +3 defense`);
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
    // Ranged distance falloff: ranged attacks deal reduced damage at range.
    // Distance 1 (adjacent) = no penalty; each additional tile = 25% less.
    if (atkStats.ranged) {
        const dist = Math.max(Math.abs(attackerUnit.x - defenderUnit.x), Math.abs(attackerUnit.z - defenderUnit.z));
        if (dist > 1) {
            const falloff = Math.pow(0.75, dist - 1);
            damageToDefender = Math.max(1, Math.floor(damageToDefender * falloff));
            messages.push(`${combatName(attackerUnit)} ranged attack at distance ${dist}: ×${falloff.toFixed(2)} damage`);
        }
    }
    // Ranged dodge chance: defenders at range have a chance to dodge. 8% per
    // tile of distance beyond 1, capped at 32% (distance 5+).
    if (atkStats.ranged && !defStats.naval) {
        const dist = Math.max(Math.abs(attackerUnit.x - defenderUnit.x), Math.abs(attackerUnit.z - defenderUnit.z));
        const dodgeChance = Math.min(0.32, (dist - 1) * 0.08);
        if (dodgeChance > 0 && Math.random() < dodgeChance) {
            damageToDefender = 0;
            messages.push(`${combatName(defenderUnit)} dodges the ranged attack!`);
        }
    }
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

    // Lifesteal: attacker heals a fraction of damage dealt (Viking Berserker
    // Rage ability). Only applies when the attacker's faction has a lifesteal
    // tempBonus and the attacker's type is in the lifestealTypes whitelist.
    if (atkTemp && atkTemp.lifesteal && atkTemp.lifesteal > 0) {
        const allowedTypes = atkTemp.lifestealTypes;
        if (!allowedTypes || allowedTypes.includes(attackerUnit.type)) {
            const healAmount = Math.floor(damageToDefender * atkTemp.lifesteal);
            if (healAmount > 0 && attackerUnit.hp > 0) {
                const before = attackerUnit.hp;
                attackerUnit.hp = Math.min(attackerUnit.maxHp || before, before + healAmount);
                if (attackerUnit.hp > before) {
                    messages.push(`${combatName(attackerUnit)} drains ${attackerUnit.hp - before} HP via lifesteal`);
                }
            }
        }
    }

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
        if (TYPE_ADVANTAGE[defenderUnit.type]) {
            const adv = TYPE_ADVANTAGE[defenderUnit.type];
            const targets = Array.isArray(adv.strongAgainst) ? adv.strongAgainst : [adv.strongAgainst];
            if (targets.includes(attackerUnit.type)) {
                defMultiplier *= adv.multiplier;
                messages.push(`${combatName(defenderUnit)} counter type advantage!`);
            }
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
export function canCaptureTile(unitOwner, tile, resources, diploState = null, currentTurn = null) {
    // Can't capture own tile
    if (tile.owner === unitOwner) return false;
    // Must have gold
    if (resources.gold < 20) return false;
    // A fortified city must be besieged (fortification reduced to 0) before capture.
    if (tile.terrain === 'CITY' && (tile.fortification || 0) > 0) return false;
    // Breach delay: a freshly breached city can't be captured until the next turn.
    if (tile.terrain === 'CITY' && tile.breachedTurn && currentTurn !== null && currentTurn < tile.breachedTurn) return false;
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
    // Sever the combatants' `_lord` back-references as well: a shallow clone of
    // a lordCombatant keeps `_lord` pointing at the REAL lord, so resolveCombat's
    // syncLordHp/awardXP would write simulated (often lethal) hp and XP onto the
    // real lord with no death routing — the "0 HP king never dies" bug.
    if (aClone._lord) aClone._lord = cloneLord(aClone._lord);
    if (dClone._lord) dClone._lord = cloneLord(dClone._lord);
    const result = resolveCombat(aClone, dClone, terrain, cloneLord(attackerLord), cloneLord(defenderLord), buildings, lords, tempBonuses, encircled, structures, defenderCityBreached);
    return {
        defenderDied: result.defenderDied,
        attackerDied: result.attackerDied,
        damageToDefender: dHp0 - (dClone.hp || 0),
        damageToAttacker: aHp0 - (aClone.hp || 0)
    };
}