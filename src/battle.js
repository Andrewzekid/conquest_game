/** Combat system: full battle resolution with HP, death, XP, siege, lords. */
import { UNIT_TYPE, TERRAIN_BONUS, TYPE_ADVANTAGE, LORD_XP_PER_KILL, UNIT_XP_PER_KILL } from './config.js';
import { getLordCombatBonus, getLordSiegeBonus, getLordClassBonus, getAdjacentLordBonuses, awardXP } from './lords.js';
import { getBuildingDefenseBonus } from './building.js';
import { awardUnitXP } from './unit.js';

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
 * @returns { messages: string[], defenderDied: boolean, attackerDied: boolean }
 */
export function resolveCombat(attackerUnit, defenderUnit, terrain, attackerLord = null, defenderLord = null, buildings = null, lords = null, tempBonuses = null) {
    const messages = [];
    if (!attackerUnit || !defenderUnit) return { messages: ['No combat: missing unit'], defenderDied: false, attackerDied: false, damageToDefender: 0 };

    const atkStats = UNIT_TYPE[attackerUnit.type];
    const defStats = UNIT_TYPE[defenderUnit.type];
    const terrainBonus = TERRAIN_BONUS[terrain] || TERRAIN_BONUS.PLAINS;
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
    }

    // Defender defense: terrain + buildings + lord stats + class + adjacent auras.
    const tileKey = `${defenderUnit.x},${defenderUnit.z}`;
    const buildingDef = buildings ? getBuildingDefenseBonus(tileKey, buildings) : 0;
    const defLordBonus = getLordCombatBonus(defenderLord);
    const defClass = getLordClassBonus(defenderLord);
    const defAdj = getAdjacentLordBonuses(lords, defenderUnit);
    const defTemp = (tempBonuses && tempBonuses[defenderUnit.owner]) || { attack: 0, defense: 0 };
    const defPower = defenderUnit.defense ?? defStats.defense;
    // defClass.defense is now an AoE (radius 1) applied via defAdj, not army-only.
    let effectiveDefense = defPower + defTerrainBonus.defense + buildingDef
        + defLordBonus.defense + defAdj.defense + defTemp.defense;

    const damageToDefender = Math.max(1, Math.floor(effectiveAttack - effectiveDefense * 0.3));
    defenderUnit.hp -= damageToDefender;
    messages.push(`${attackerUnit.type} attacks ${defenderUnit.type} for ${damageToDefender} damage (HP: ${Math.max(0, defenderUnit.hp)}/${defenderUnit.maxHp})`);

    const defenderDied = defenderUnit.hp <= 0;
    if (defenderDied) {
        messages.push(`${defenderUnit.type} was destroyed!`);
        // Award XP to the attacker's lord and the attacker unit itself.
        if (attackerLord) {
            const xpMsgs = awardXP(attackerLord, LORD_XP_PER_KILL);
            messages.push(...xpMsgs);
        }
        messages.push(...awardUnitXP(attackerUnit, UNIT_XP_PER_KILL));
        return { messages, defenderDied: true, attackerDied: false, damageToDefender };
    }

    // --- Defender counter-attack (only if melee and survived) ---
    // Ranged units don't counter-attack when attacked at melee range
    if (!defStats.ranged) {
        let defMultiplier = 1.0;
        if (TYPE_ADVANTAGE[defenderUnit.type]?.strongAgainst === attackerUnit.type) {
            defMultiplier *= TYPE_ADVANTAGE[defenderUnit.type].multiplier;
            messages.push(`${defenderUnit.type} counter type advantage!`);
        }

        const effectiveAttackDef = (defenderUnit.attack ?? defStats.attack) * defMultiplier + defLordBonus.attack;
        const effectiveDefenseAtk = (attackerUnit.defense ?? atkStats.defense) + atkLordBonus.defense;
        const damageToAttacker = Math.max(1, Math.floor(effectiveAttackDef - effectiveDefenseAtk * 0.3));
        attackerUnit.hp -= damageToAttacker;
        messages.push(`${defenderUnit.type} counter-attacks for ${damageToAttacker} damage (HP: ${Math.max(0, attackerUnit.hp)}/${attackerUnit.maxHp})`);

        const attackerDied = attackerUnit.hp <= 0;
        if (attackerDied) {
            messages.push(`${attackerUnit.type} was destroyed in counter-attack!`);
            if (defenderLord) {
                const xpMsgs = awardXP(defenderLord, LORD_XP_PER_KILL);
                messages.push(...xpMsgs);
            }
            return { messages, defenderDied: false, attackerDied: true, damageToDefender };
        }
    }

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