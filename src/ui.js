/** UI: resource bar, tile/unit info, build menu, diplomacy panel, lord panel, combat log. */
import { UNIT_TYPE, BUILDING_TYPE, DIPLOMACY_STATES, LORD_ABILITIES,
          FACTIONS, PLAYER_FACTION, FACTION_COLORS, LORD_CLASSES, TERRAIN, TERRAIN_BONUS,
          EXTRA_UNITS, NAVAL_UNITS, SIEGE_ENGINES, CHARGE_UNITS, CHARIOT_CHARGE_UNITS, CONCEAL_TERRAINS,
          STRUCTURE_TYPE, STRUCTURE_COST, LORD_RECRUIT_COST,
          cityGrowthThreshold, CITY_MAX_LEVEL, MILITARY_BUILDING_LEVELS, BUILDING_MAX_LEVEL,
          TRADE_ROUTE_MIN_CITY_LEVEL } from './config.js';
import { getBuildableBuildings, pillageableOn, getBuildingState } from './building.js';
import { getDiplomacySummary, stateLabel, relationshipLabel, grievanceLevel, getRelation } from './diplomacy.js';
import { buildAIGoalsHTML } from './ai_goals.js';
import { getInfluencedTiles, isPassable } from './map.js';
import { maxArmySize, lordAttack, lordDefense, kingGuardBonus, canCommand, getAvailableSkills, getSkillEffects } from './lords.js';
import { getUnitCostFor, getFactionDef } from './faction.js';
import { getUnitCap, unitCapForCity, grossYields, upkeepTotals } from './economy.js';
import { svgIcon, hasIcon } from './icons.js';
import { getUnlockedUnits, TECHS } from './tech.js';

// Map building types to their icon names in src/icons.js.
const BUILDING_ICON = {
    FARM: 'farm', LUMBERMILL: 'lumbermill', MINE: 'mine', MARKET: 'market',
    BARRACKS: 'barracks', WALLS: 'walls', HARBOR: 'harbor', SIEGE_WORKSHOP: 'siege_workshop'
};
const RES_ORDER = [['gold', 'g'], ['food', 'f'], ['wood', 'w'], ['iron', 'i'], ['production', 'pr']];
// Renders a cost object as small colored chips (green if affordable, red if not).
function costChips(cost, res) {
    const parts = [];
    for (const [key, abbr] of RES_ORDER) {
        const v = cost[key];
        if (!v) continue;
        const ok = (res[key] || 0) >= v;
        parts.push(`<span class="${ok ? 'ok' : 'no'}">${v}${abbr}</span>`);
    }
    return parts.join('');
}

export function bindUI(gameState, callbacks) {
    const els = {
        gold: document.getElementById('res-gold'),
        food: document.getElementById('res-food'),
        wood: document.getElementById('res-wood'),
        iron: document.getElementById('res-iron'),
        production: document.getElementById('res-production'),
        turn: document.getElementById('turn-count'),
        info: document.getElementById('info'),
        ownership: document.getElementById('ownership'),
        unitInfo: document.getElementById('unit-info'),
        buildMenu: document.getElementById('build-menu-body'),
        diplomacyPanel: document.getElementById('diplomacy-panel-body'),
        lordPanel: document.getElementById('lord-panel-body'),
        aiGoalsPanel: document.getElementById('ai-goals-panel-body'),
        aiGoalsPanelWrap: document.getElementById('ai-goals-panel'),
        victoryPanel: document.getElementById('victory-panel-body'),
        victoryPanelWrap: document.getElementById('victory-panel'),
        techPanel: document.getElementById('tech-panel-body'),
        techPanelWrap: document.getElementById('tech-panel'),
        combatLog: document.getElementById('combat-log'),
        phaseIndicator: document.getElementById('phase-indicator')
    };

    // Faction color/name for a slot, from runtime binding (fallback to static).
    function fcOf(slot) {
        return (gameState.factionColors && gameState.factionColors[slot]) || FACTION_COLORS[slot] || { name: slot };
    }
    function defOf(slot) {
        const id = gameState.factionAssignments && gameState.factionAssignments[slot];
        return id ? getFactionDef(id) : null;
    }

    /** Nearest orthogonal friendly Transport with free cargo to `unit`, or null. */
    function findAdjacentTransport(state, unit) {
        const units = state.units;
        if (!units) return null;
        for (let dx = -1; dx <= 1; dx++) {
            for (let dz = -1; dz <= 1; dz++) {
                if (dx === 0 && dz === 0) continue;
                if (dx !== 0 && dz !== 0) continue; // orthogonal only
                for (const u of units.values()) {
                    if (u.type === 'TRANSPORT' && u.owner === unit.owner &&
                        u.x === unit.x + dx && u.z === unit.z + dz) {
                        const cap = (UNIT_TYPE.TRANSPORT && UNIT_TYPE.TRANSPORT.capacity) || 2;
                        const used = (u.cargo && u.cargo.length) || 0;
                        if (used < cap) return u;
                    }
                }
            }
        }
        return null;
    }

    /** An orthogonally-adjacent passable land tile to disembark onto, or null.
     *  Picks the first unoccupied (no enemy) land tile. */
    function findAdjacentLand(state, transport) {
        const tiles = state.tiles;
        const units = state.units;
        if (!tiles) return null;
        let best = null;
        for (let dx = -1; dx <= 1; dx++) {
            for (let dz = -1; dz <= 1; dz++) {
                if (dx === 0 && dz === 0) continue;
                if (dx !== 0 && dz !== 0) continue; // orthogonal only
                const k = `${transport.x + dx},${transport.z + dz}`;
                const t = tiles.get(k);
                if (!t) continue;
                if (!isPassable(t)) continue; // land units need a passable (non-water/bridged-river) tile
                // Don't disembark onto an enemy-occupied tile.
                let blocked = false;
                if (units) {
                    for (const u of units.values()) {
                        if (u.owner !== transport.owner && u.x === t.x && u.z === t.z) { blocked = true; break; }
                    }
                }
                if (blocked) continue;
                best = t;
                break;
            }
            if (best) break;
        }
        return best;
    }

    /** An adjacent (Chebyshev-1) enemy-owned tile that has a pillageable terrain
     *  improvement, or null. Used to surface a Pillage button on military units. */
    function findAdjacentPillageable(state, unit) {
        const tiles = state.tiles;
        if (!tiles) return null;
        for (let dx = -1; dx <= 1; dx++) {
            for (let dz = -1; dz <= 1; dz++) {
                const t = tiles.get(`${unit.x + dx},${unit.z + dz}`);
                if (!t) continue;
                if (!t.owner || t.owner === unit.owner) continue;
                if (pillageableOn(t, state.buildings).length > 0) return t;
            }
        }
        return null;
    }

    let _netGold = 0, _netFood = 0, _netWood = 0, _netIron = 0, _netProd = 0;

    function stockpileColor(val) {
        if (val < 20) return '#ff6666';
        if (val < 50) return '#ffcc44';
        return '#ffffff';
    }

    function updateResourceBar() {
        const r = gameState.resources.player;
        const set = (el, val, net) => {
            if (!el) return;
            const color = stockpileColor(val);
            const sign = net >= 0 ? '+' : '';
            el.innerHTML = `<span style="color:${color}">${Math.floor(val)}</span> <span style="color:${net >= 0 ? '#7cfc00' : '#ff6666'}; font-size:11px;">${sign}${Math.floor(net)}/t</span>`;
        };
        if (els.gold) set(els.gold, r.gold, _netGold);
        if (els.food) set(els.food, r.food, _netFood);
        if (els.wood) set(els.wood, r.wood, _netWood);
        if (els.iron) set(els.iron, r.iron, _netIron);
        if (els.production) set(els.production, r.production || 0, _netProd);
        if (els.turn) els.turn.textContent = gameState.turn;
        if (els.phaseIndicator) {
            const phase = gameState.turnManager ? gameState.turnManager.phase : PLAYER_FACTION;
            if (phase === PLAYER_FACTION) {
                els.phaseIndicator.textContent = 'YOUR TURN';
            } else {
                const fc = fcOf(phase);
                els.phaseIndicator.textContent = fc ? `${fc.name} (AI)` : phase.toUpperCase();
            }
        }
        // Update resource tooltips with production breakdown
        updateResourceTooltips();
    }

    /** Calculate and display production breakdown tooltips for each resource.
     *  Derives the breakdown from the real economy (grossYields + upkeepTotals
     *  in economy.js) so the income shown always matches what actually lands in
     *  the resource pool — no phantom "+N/t" that never reaches the stockpile. */
    function updateResourceTooltips() {
        const tiles = gameState.tiles;
        const buildings = gameState.buildings;
        const units = gameState.units;
        if (!tiles) return;

        const def = defOf(PLAYER_FACTION);
        const lords = gameState.lords || [];
        const y = grossYields(tiles, PLAYER_FACTION, buildings, lords, def);
        const up = upkeepTotals(units, PLAYER_FACTION);

        // Trade routes (simplified - count trade pacts). Not part of terrain
        // production, so added to gold separately.
        let goldTrade = 0;
        const diplo = gameState.diplomacy;
        if (diplo && diplo.relations) {
            for (const rel of Object.values(diplo.relations)) {
                if (rel.state === DIPLOMACY_STATES.TRADE_PACT && rel.tradeAmount) {
                    goldTrade += rel.tradeAmount;
                }
            }
        }

        // Update tooltip elements
        const setTooltip = (id, value, isPositive = true) => {
            const el = document.getElementById(id);
            if (el) {
                const prefix = value >= 0 ? '+' : '';
                el.textContent = `${prefix}${Math.floor(value)}`;
                el.className = `tooltip-value ${value >= 0 ? 'tooltip-positive' : 'tooltip-negative'}`;
            }
        };

        // Net per resource = gross categories - upkeep (+ trade for gold).
        _netGold = y.gold.city + y.gold.market + y.gold.terrain + y.gold.wonder + goldTrade - up.gold;
        _netFood = y.food.city + y.food.farm + y.food.terrain + y.food.wonder + y.food.passive - up.food;
        _netWood = y.wood.city + y.wood.lumbermill + y.wood.terrain + y.wood.wonder - up.wood;
        _netIron = y.iron.city + y.iron.mine + y.iron.terrain + y.iron.wonder - up.iron;
        _netProd = y.production.city + y.production.barracks + y.production.workshop +
            y.production.harbor + y.production.wonder;

        // Gold tooltip
        setTooltip('gold-cities', y.gold.city);
        setTooltip('gold-markets', y.gold.market);
        setTooltip('gold-trade', goldTrade);
        setTooltip('gold-upkeep', -up.gold, false);
        setTooltip('gold-net', _netGold);

        // Food tooltip
        setTooltip('food-farms', y.food.farm);
        setTooltip('food-cities', y.food.city);
        setTooltip('food-terrain', y.food.terrain);
        setTooltip('food-upkeep', -up.food, false);
        setTooltip('food-net', _netFood);

        // Wood tooltip
        setTooltip('wood-mills', y.wood.lumbermill);
        setTooltip('wood-cities', y.wood.city);
        setTooltip('wood-forests', y.wood.terrain);
        setTooltip('wood-upkeep', -up.wood, false);
        setTooltip('wood-net', _netWood);

        // Iron tooltip (terrain iron covers both mountains and hills)
        setTooltip('iron-mines', y.iron.mine);
        setTooltip('iron-mountains', y.iron.terrain);
        setTooltip('iron-hills', 0);
        setTooltip('iron-upkeep', -up.iron, false);
        setTooltip('iron-net', _netIron);

        // Production tooltip
        setTooltip('prod-cities', y.production.city);
        setTooltip('prod-barracks', y.production.barracks);
        setTooltip('prod-workshops', y.production.workshop + y.production.harbor);
        setTooltip('prod-net', _netProd);
    }

    function showTileInfo(tile) {
        if (!tile) {
            if (els.info) els.info.textContent = 'Hover over a tile';
            if (els.ownership) els.ownership.textContent = '';
            return;
        }
        const td = TERRAIN[tile.terrain] || { name: 'Unknown', resource: '?', amount: 0 };
        const tb = TERRAIN_BONUS[tile.terrain] || { attack: 0, defense: 0 };
        const bonusTxt = `Atk ${tb.attack>=0?'+':''}${tb.attack} / Def ${tb.defense>=0?'+':''}${tb.defense}`;
        let info = `<strong>${td.name}</strong> <span style="color:var(--muted);">[${tile.x}, ${tile.z}]</span>`;
        if (td.resource && td.amount) info += ` — ${td.amount} ${td.resource}`;
        info += ` <span style="color:var(--muted);">(${bonusTxt})</span>`;
        if (tile.terrain === 'CITY') {
            // Show city name, level, and health bar (fortification)
            const cityName = tile.cityName || `City`;
            const cityLevel = tile.cityLevel || 1;
            const fort = tile.fortification || 0;
            const fortMax = tile.fortMax || 1;
            const fortPct = Math.round((fort / fortMax) * 100);
            const breached = fort === 0 && tile.owner !== PLAYER_FACTION;
            info += ` &nbsp;${svgIcon('city', {size:16})} <strong>${cityName}</strong> (Lv.${cityLevel})`;
            info += ` &nbsp;${svgIcon('hp', {size:14})} ${fort}/${fortMax} (${fortPct}%)${breached ? ' <span style="color:var(--bad);">BREACHED</span>' : ''}`;
            // City unrest & loyalty: show the unrest level + color-coded severity.
            const unrest = tile.unrest || 0;
            if (unrest > 0) {
                const unrestColor = unrest >= 75 ? 'var(--bad)'
                    : unrest >= 50 ? '#ff8844'
                    : unrest >= 25 ? '#ffcc44' : 'var(--good)';
                info += ` &nbsp;⚠️ Unrest <b style="color:${unrestColor}">${Math.round(unrest)}%</b>`;
            }
        }
        if (tile.terrain === 'RIVER') {
            info += tile.bridge ? ` &nbsp;${svgIcon('bridge', {size:14})} Bridged` : ' &nbsp;<span style="color:var(--bad);">Impassable (needs bridge)</span>';
        }
        if (tile.wonder) {
            info += ` &nbsp;${tile.wonder.emoji || svgIcon('wonder', {size:14})} ${tile.wonder.name}`;
        }
        if (els.info) els.info.innerHTML = info;

        if (els.ownership) {
            if (tile.owner === PLAYER_FACTION) {
                els.ownership.textContent = 'Owned by you';
                els.ownership.style.color = '#4488ff';
            } else if (tile.owner) {
                const fc = fcOf(tile.owner);
                els.ownership.textContent = `Owned by ${fc.name || tile.owner}`;
                els.ownership.style.color = '#ff8866';
            } else {
                els.ownership.textContent = 'Unclaimed Territory';
                els.ownership.style.color = '#ccc';
            }
        }

        // Show buildings on tile
        const buildings = gameState.buildings.get(`${tile.x},${tile.z}`) || [];
        if (buildings.length > 0 && els.ownership) {
            const buildingNames = buildings.map(b => BUILDING_TYPE[b]?.name || b).join(', ');
            els.ownership.textContent += ` | Buildings: ${buildingNames}`;
        }

        // Owned city: show natural-growth progress toward the next level.
        if (tile.terrain === 'CITY' && tile.owner === PLAYER_FACTION && els.ownership) {
            const lvl = tile.cityLevel || 1;
            if (lvl >= CITY_MAX_LEVEL) {
                els.ownership.textContent += ` | Growth: MAX (Lv.${CITY_MAX_LEVEL})`;
            } else {
                const need = cityGrowthThreshold(lvl);
                const have = Math.floor(tile.growth || 0);
                const est = Math.max(1, Math.ceil((need - have) / 2)); // ~2 growth/turn rough estimate
                els.ownership.textContent += ` | Growth: ${have}/${need} (~${est}t to Lv.${lvl + 1})`;
            }
            // Unrest driver breakdown (only when the city is actually restless).
            const reasons = Array.isArray(tile.unrestReasons) ? tile.unrestReasons : [];
            if ((tile.unrest || 0) > 0 && reasons.length) {
                const parts = reasons.map(r => `${r.reason}${r.amount > 0 ? '+' : ''}${r.amount}`).join(', ');
                els.ownership.textContent += ` | Unrest: ${parts}`;
            }
        }

        // Natural Wonder: show its per-turn bonus (and who reaps it).
        if (tile.wonder && els.ownership) {
            const bonusTxt = Object.entries(tile.wonder.bonus)
                .map(([r, a]) => `+${a} ${r}`).join(', ');
            const who = tile.owner ? ` (${tile.owner === PLAYER_FACTION ? 'you' : fcOf(tile.owner).name || tile.owner})` : ' — capture it to claim!';
            els.ownership.textContent += ` | ${tile.wonder.emoji || ''} ${tile.wonder.name}: ${bonusTxt}${who}`;
            els.ownership.style.color = '#ffd35a';
        }
    }

    function showUnitInfo(unit) {
        if (!unit) {
            if (els.unitInfo) els.unitInfo.innerHTML = '';
            return;
        }
        const stats = UNIT_TYPE[unit.type];
        const lvl = unit.level || 1;
        const atk = unit.attack ?? stats.attack;
        const def = unit.defense ?? stats.defense;
        const fc = fcOf(unit.owner);
        const srow = (ic, label, val) => `<div class="stat-row"><span class="stat-ico">${svgIcon(ic, { size: 16 })}</span>${label}<b>${val}</b></div>`;
        const canMove = !unit.hasMovedThisTurn;
        const canAtk = !unit.hasAttackedThisTurn;
        let html = `<div class="info-card"><h4>${stats.name} · Lv.${lvl} #${unit.id}</h4>`;
        html += srow('hp', 'HP', `${unit.hp}/${unit.maxHp}`);
        html += srow('attack', 'Attack', atk);
        html += srow('defense', 'Defense', def);
        html += srow('move', 'Move', stats.moveRange);
        html += srow('swords', 'XP', `${unit.xp || 0}/${30 * lvl}`);
        html += srow('flag', 'Owner', fc.name || unit.owner);
        html += `<div class="stat-row"><span class="stat-ico">${svgIcon(canMove ? 'move' : 'exhausted', { size: 16 })}</span>Status<b style="color:${canMove ? 'var(--good)' : 'var(--bad)'}">${canMove ? 'Can move' : 'Moved'}</b></div>`;
        html += `<div class="stat-row"><span class="stat-ico">${svgIcon(canAtk ? 'swords' : 'stun', { size: 16 })}</span><b style="margin-left:0;color:${canAtk ? 'var(--good)' : 'var(--bad)'}">${canAtk ? 'Can attack' : 'Attacked'}</b></div>`;
        html += `</div>`;
        if (unit.burn && unit.burn > 0) {
            html += `<div class="stat-row"><span class="stat-ico">${svgIcon('fire', { size: 16 })}</span><span style="color:#ff7b3a;">On fire — ${2} dmg/turn (${unit.burn}t)</span></div>`;
        }
        if (unit.boarded) {
            html += `<div class="stat-row"><span class="stat-ico">${svgIcon('TRANSPORT', { size: 16 })}</span><span style="color:#9cf;">Aboard a transport (disembark to act)</span></div>`;
        }
        if (unit.owner === PLAYER_FACTION) {
            // Conceal / Reveal controls for forest/mountain ambush mechanic.
            const tile = gameState.tiles.get(`${unit.x},${unit.z}`);
            const canConceal = tile && CONCEAL_TERRAINS.includes(tile.terrain) &&
                !unit.hasMovedThisTurn && !unit.hasAttackedThisTurn &&
                unit.concealState !== 'concealing' && unit.concealState !== 'concealed';
            if (canConceal) {
                const turns = tile.terrain === 'MOUNTAIN' ? 2 : 1;
                html += `<button id="conceal-btn" class="btn btn-sm" style="margin-top:4px; color:#7cf;" title="Conceal this unit in the ${tile.terrain.toLowerCase()} (${turns} turn${turns === 1 ? '' : 's'}). Concealed units cannot move.">${svgIcon('conceal', { size: 14 })} Conceal (${turns}t)</button><br>`;
            }
            if (unit.concealState === 'concealing') {
                html += `<div class="stat-row"><span class="stat-ico">${svgIcon('conceal', { size: 16 })}</span><span style="color:#7cf;">Concealing: ${unit.concealTurnsLeft}t left</span></div>`;
            }
            if (unit.concealState === 'concealed') {
                html += `<div class="stat-row"><span class="stat-ico">${svgIcon('conceal', { size: 16 })}</span><span style="color:#7cfc00;">Concealed — cannot move</span></div>`;
                html += `<div style="font-size:10px; color:#9ab; margin:2px 0;">Reveal to ambush:</div>`;
                const dirs = [
                    { key: 'n', dx: 0, dz: -1, label: 'N' },
                    { key: 's', dx: 0, dz: 1, label: 'S' },
                    { key: 'e', dx: 1, dz: 0, label: 'E' },
                    { key: 'w', dx: -1, dz: 0, label: 'W' }
                ];
                html += `<div style="display:flex; gap:4px; flex-wrap:wrap; margin:2px 0;">`;
                for (const d of dirs) {
                    html += `<button class="reveal-dir-btn btn btn-sm" data-dx="${d.dx}" data-dz="${d.dz}" title="Reveal and ambush the tile to the ${d.key.toUpperCase()}">${d.label}</button>`;
                }
                html += `</div>`;
            }
            // Cavalry charge hint/button when adjacent to an enemy.
            if (CHARGE_UNITS.includes(unit.type) && !unit.hasAttackedThisTurn && !unit.hasMovedThisTurn) {
                const chargeTargets = (gameState.chargeTargets || []).filter(u => u && u.owner !== PLAYER_FACTION);
                if (chargeTargets.length) {
                    html += `<div style="font-size:11px; color:#ffd35a; margin-top:6px;">${svgIcon('charge', { size: 14 })} Charge an adjacent enemy:</div>`;
                    for (const tgt of chargeTargets) {
                        html += `<button class="charge-btn btn btn-sm" data-target-id="${tgt.id}" style="display:block; width:100%; margin:2px 0;" title="Charge ${UNIT_TYPE[tgt.type].name} #${tgt.id} for +${2} attack (exhausts cavalry).">${svgIcon('charge', { size: 13 })} ${UNIT_TYPE[tgt.type].name} #${tgt.id}</button>`;
                    }
                }
            }
            // Chariot charge: directional lanes (click the highlighted gold tile).
            if (CHARIOT_CHARGE_UNITS.includes(unit.type)) {
                if (unit.stunnedTurns && unit.stunnedTurns > 0) {
                    html += `<div style="font-size:11px; color:#c99; margin-top:4px;">${svgIcon('stun', { size: 14 })} Stunned for ${unit.stunnedTurns} more turn${unit.stunnedTurns === 1 ? '' : 's'} (charge recovery).</div>`;
                } else if (!unit.hasAttackedThisTurn && !unit.hasMovedThisTurn) {
                    const lanes = gameState.chariotChargeTargets;
                    const laneCount = lanes instanceof Map ? lanes.size : (lanes ? lanes.length : 0);
                    if (laneCount) {
                        html += `<div style="font-size:11px; color:#ffd35a; margin-top:4px;">${svgIcon('CHARIOT', { size: 14 })} Charge (up to 3 tiles): click a gold-highlighted tile. Stuns the chariot 2 turns; massive damage vs infantry/artillery.</div>`;
                    } else {
                        html += `<div style="font-size:11px; color:#9ab; margin-top:4px;">${svgIcon('CHARIOT', { size: 14 })} No enemy in a straight charge lane. (Cannot move and charge the same turn.)</div>`;
                    }
                } else if (unit.hasMovedThisTurn) {
                    html += `<div style="font-size:11px; color:#9ab; margin-top:4px;">${svgIcon('CHARIOT', { size: 14 })} Chariot already moved — cannot charge this turn.</div>`;
                }
            }
            if (unit.type === 'SETTLER') {
                html += `<button id="found-city-btn" class="btn btn-sm" style="margin-top:4px;" title="Found a new city on this tile (consumes the settler).">${svgIcon('city', { size: 14 })} Found City Here</button><br>`;
            }
            if (unit.type === 'ENGINEER' || unit.type === 'SIEGE') {
                html += `<div style="font-size:11px; color:#7cf;">${svgIcon('bridge', { size: 13 })} Click an adjacent river tile to build a bridge.</div><br>`;
            }
            if (unit.type === 'ENGINEER') {
                const constructing = gameState.construction && gameState.construction.get(unit.id);
                if (constructing) {
                    const label = constructing.type === 'SIEGE_ENGINE'
                        ? `Building ${UNIT_TYPE[constructing.engineType] ? UNIT_TYPE[constructing.engineType].name : 'Siege Engine'}`
                        : constructing.type === 'STRUCTURE'
                            ? `Building ${(STRUCTURE_TYPE[constructing.structureType] || {}).name || 'Structure'}`
                            : 'Building Siege Tower';
                    html += `<div style="font-size:11px; color:#ffd700;">${svgIcon('ENGINEER', { size: 14 })} ${label} — ready in ${constructing.turnsLeft} turn${constructing.turnsLeft === 1 ? '' : 's'}.</div><br>`;
                } else if (!unit.hasAttackedThisTurn) {
                    // Siege Tower button (if near an enemy city).
                    if (gameState.siegeTowerTarget) {
                        const tgt = gameState.siegeTowerTarget;
                        html += `<button id="build-tower-btn" class="btn btn-sm" style="margin-top:4px;" title="Build a Siege Tower here (3 turns) to assault the nearby enemy city.">${svgIcon('SIEGE_TOWER', { size: 14 })} Build Siege Tower (3t)</button><br>`;
                        html += `<span style="font-size:10px; color:#9ab;">Siege target: city at [${tgt.x}, ${tgt.z}]</span><br>`;
                    }
                    // Siege Engine build buttons (CATAPULT/TREBUCHET) — field
                    // construction, no workshop required. Gives factions without
                    // a Siege Workshop a path to long-range siege engines.
                    html += `<div style="font-size:11px; color:#9fd; margin-top:4px;">Build siege engine (field project):</div>`;
                    html += `<button class="build-siege-engine-btn btn btn-sm" data-engine="CATAPULT" style="display:block; width:100%; margin:2px 0;" title="Build a Catapult (2 turns). Long-range AOE siege with fire.">${svgIcon('CATAPULT', { size: 13 })} Build Catapult (2t)</button>`;
                    html += `<button class="build-siege-engine-btn btn btn-sm" data-engine="TREBUCHET" style="display:block; width:100%; margin:2px 0;" title="Build a Trebuchet (2 turns). Strongest long-range AOE siege.">${svgIcon('TREBUCHET', { size: 13 })} Build Trebuchet (2t)</button>`;
                    // Defensive structures (traps/fortifications) on the
                    // engineer's current tile: must be owned land within a
                    // city's influence, free of an existing structure.
                    const stile = gameState.tiles.get(`${unit.x},${unit.z}`);
                    const canSite = stile && stile.owner === PLAYER_FACTION &&
                        stile.terrain !== 'CITY' && stile.terrain !== 'WATER' && stile.terrain !== 'RIVER' &&
                        !(gameState.structures && gameState.structures.has(`${unit.x},${unit.z}`));
                    if (canSite) {
                        html += `<div style="font-size:11px; color:#fda; margin-top:4px;">Build structure here:</div>`;
                        for (const sType of Object.keys(STRUCTURE_TYPE)) {
                            const s = STRUCTURE_TYPE[sType];
                            html += `<button class="build-structure-btn btn btn-sm" data-structure="${sType}" style="display:block; width:100%; margin:2px 0;" title="${s.desc} (${s.buildTurns || 2} turns)">${svgIcon('spikes', { size: 13 })} ${s.name} (${formatCost(STRUCTURE_COST[sType] || {})})</button>`;
                        }
                    }
                }
            }
            // Non-engineer units with canBuildStructure (e.g. Legionnaire) can
            // raise defensive structures on their current tile — but only the
            // structure buttons, not the engineer-only siege engines/towers.
            const usd = UNIT_TYPE[unit.type];
            if (usd && usd.canBuildStructure && unit.type !== 'ENGINEER' &&
                unit.owner === PLAYER_FACTION && !unit.hasAttackedThisTurn) {
                const constructing2 = gameState.construction && gameState.construction.get(unit.id);
                if (!constructing2) {
                    const stile = gameState.tiles.get(`${unit.x},${unit.z}`);
                    const canSite = stile && stile.owner === PLAYER_FACTION &&
                        stile.terrain !== 'CITY' && stile.terrain !== 'WATER' && stile.terrain !== 'RIVER' &&
                        !(gameState.structures && gameState.structures.has(`${unit.x},${unit.z}`));
                    if (canSite) {
                        html += `<div style="font-size:11px; color:#fda; margin-top:4px;">Build structure here:</div>`;
                        for (const sType of Object.keys(STRUCTURE_TYPE)) {
                            const s = STRUCTURE_TYPE[sType];
                            html += `<button class="build-structure-btn btn btn-sm" data-structure="${sType}" style="display:block; width:100%; margin:2px 0;" title="${s.desc} (${s.buildTurns || 2} turns)">${svgIcon('spikes', { size: 13 })} ${s.name} (${formatCost(STRUCTURE_COST[sType] || {})})</button>`;
                        }
                    }
                }
            }
            // Navy: a land unit adjacent to a friendly Transport with free cargo
            // can board it; a Transport with cargo adjacent to land can disembark.
            const def = UNIT_TYPE[unit.type];
            if (def && !def.naval && !unit.boarded) {
                const tr = findAdjacentTransport(gameState, unit);
                if (tr) {
                    const cargoLen = (tr.cargo && tr.cargo.length) || 0;
                    if (cargoLen < (UNIT_TYPE.TRANSPORT.capacity || 2)) {
                        html += `<button id="board-btn" data-transport-id="${tr.id}" class="btn btn-sm" style="margin-top:4px;" title="Board this transport to cross water.">${svgIcon('TRANSPORT', { size: 14 })} Board Transport #${tr.id}</button><br>`;
                    }
                }
            }
            if (unit.type === 'TRANSPORT' && unit.cargo && unit.cargo.length) {
                const land = findAdjacentLand(gameState, unit);
                if (land) {
                    html += `<button id="disembark-btn" class="btn btn-sm" style="margin-top:4px;" title="Disembark one carried unit onto the adjacent land tile.">${svgIcon('harbor', { size: 14 })} Disembark at [${land.x}, ${land.z}]</button><br>`;
                }
                html += `<span style="font-size:10px; color:#9ab;">Carrying ${unit.cargo.length}/${UNIT_TYPE.TRANSPORT.capacity || 2} units.</span><br>`;
            }
            if (unit.goal) {
                html += `${svgIcon('target', { size: 13 })} Auto-moving to [${unit.goal.x}, ${unit.goal.z}] `;
                html += `<button id="cancel-goal-btn" class="btn btn-sm" style="margin-left:4px;">Cancel</button>`;
            } else {
                html += `<span style="font-size:11px; color:#9ab;">Right-click a tile to set an auto-move goal.</span>`;
            }
            // Worker: list buildable terrain improvements for its current tile
            // (owned + within a city's influence radius). Building uses the
            // worker's action for the turn.
            if (unit.type === 'WORKER' && !unit.hasAttackedThisTurn) {
                const wtile = gameState.tiles.get(`${unit.x},${unit.z}`);
                if (wtile && wtile.owner === PLAYER_FACTION) {
                    const influence = getInfluencedTiles(gameState.tiles, PLAYER_FACTION);
                    const opts = getBuildableBuildings(wtile, gameState.resources.player, gameState.buildings, influence, gameState.tiles, gameState.tech)
                        .filter(b => b.canBuild && b.type !== 'HARBOR' && b.type !== 'SIEGE_WORKSHOP' &&
                            b.type !== 'MARKET' && b.type !== 'BARRACKS' && b.type !== 'WALLS');
                    if (opts.length) {
                        html += `<div style="font-size:11px; color:#9fd; margin-top:4px;">Build improvement here:</div>`;
                        for (const b of opts) {
                            html += `<button class="worker-build-btn btn btn-sm" data-bldg="${b.type}" style="display:block; width:100%; margin:2px 0;">${b.name} (${formatCost(b.cost)})</button>`;
                        }
                    } else {
                        html += `<span style="font-size:10px; color:#9ab;">No improvement can be built on this tile.</span><br>`;
                    }
                } else {
                    html += `<span style="font-size:10px; color:#9ab;">Move onto your own land within a city's influence to build.</span><br>`;
                }
            }
            // Disband: destroy this unit, refunding a fraction of its gold cost.
            // Useful to free up the unit cap or remove a stranded unit.
            if (!unit.boarded) {
                html += `<button id="disband-btn" class="btn btn-sm" style="margin-top:4px; color:#f88;" title="Destroy this unit (refunds 25% of gold cost).">${svgIcon('exhausted', { size: 13 })} Disband Unit</button><br>`;
            }
            // Join a lord's army: if a lord with command capacity is on the same
            // tile and this unit isn't already in that lord's army, show a button.
            if (unit.owner === PLAYER_FACTION && !unit.boarded) {
                const lordsHere = (gameState.lords || []).filter(l =>
                    l.owner === PLAYER_FACTION && l.x === unit.x && l.z === unit.z &&
                    canCommand(l) && !(l.army || []).includes(unit.id));
                for (const lord of lordsHere) {
                    html += `<button class="join-army-btn btn btn-sm" data-lord-id="${lord.id}" style="margin-top:4px; color:#9cf;" title="Join ${lord.name}'s army (${lord.army.length}/${maxArmySize(lord)}).">${svgIcon('join', { size: 13 })} Join ${lord.name}'s Army</button><br>`;
                }
            }
            // Pillage: a military unit adjacent to an enemy tile with a terrain
            // improvement can destroy it for a gold reward (uses its action).
            if (unit.type !== 'SETTLER' && unit.type !== 'WORKER' && !unit.hasAttackedThisTurn) {
                const ptile = findAdjacentPillageable(gameState, unit);
                if (ptile) {
                    const bName = (BUILDING_TYPE[pillageableOn(ptile, gameState.buildings)[0]] || {}).name || 'improvement';
                    html += `<button id="pillage-btn" data-ptx="${ptile.x}" data-ptz="${ptile.z}" class="btn btn-sm" style="margin-top:4px; color:#fc6;" title="Pillage the enemy ${bName} at [${ptile.x}, ${ptile.z}] for gold.">${svgIcon('pillage', { size: 13 })} Pillage ${bName} [${ptile.x},${ptile.z}]</button><br>`;
                }
            }
        }
        if (els.unitInfo) els.unitInfo.innerHTML = html;
        const cbtn = document.getElementById('cancel-goal-btn');
        if (cbtn) cbtn.onclick = () => callbacks.onCancelGoal && callbacks.onCancelGoal(unit);
        const fbtn = document.getElementById('found-city-btn');
        if (fbtn) fbtn.onclick = () => callbacks.onFoundCity && callbacks.onFoundCity(unit);
        const tbtn = document.getElementById('build-tower-btn');
        if (tbtn) tbtn.onclick = () => callbacks.onBuildSiegeTower && callbacks.onBuildSiegeTower(unit);
        const bbtn = document.getElementById('board-btn');
        if (bbtn) bbtn.onclick = () => {
            const tr = gameState.units.get(bbtn.dataset.transportId);
            if (tr && callbacks.onBoard) callbacks.onBoard(unit, tr);
        };
        const dbtn = document.getElementById('disembark-btn');
        if (dbtn) dbtn.onclick = () => callbacks.onDisembark && callbacks.onDisembark(unit);
        const wbtns = document.querySelectorAll('.worker-build-btn');
        wbtns.forEach(b => {
            b.onclick = () => callbacks.onWorkerBuild && callbacks.onWorkerBuild(unit, b.dataset.bldg);
        });
        const disbtn = document.getElementById('disband-btn');
        if (disbtn) disbtn.onclick = () => {
            if (confirm(`Disband this ${UNIT_TYPE[unit.type].name}? Refunds 25% of its gold cost.`)) {
                callbacks.onDisband && callbacks.onDisband(unit);
            }
        };
        const pbtn = document.getElementById('pillage-btn');
        if (pbtn) pbtn.onclick = () => {
            const t = gameState.tiles.get(`${pbtn.dataset.ptx},${pbtn.dataset.ptz}`);
            if (t) callbacks.onPillage && callbacks.onPillage(unit, t);
        };
        const jbtns = document.querySelectorAll('.join-army-btn');
        jbtns.forEach(b => {
            b.onclick = () => {
                const lord = (gameState.lords || []).find(l => l.id === Number(b.dataset.lordId));
                if (lord && callbacks.onJoinArmy) callbacks.onJoinArmy(unit, lord);
            };
        });
        const sebtns = document.querySelectorAll('.build-siege-engine-btn');
        sebtns.forEach(b => {
            b.onclick = () => callbacks.onBuildSiegeEngine && callbacks.onBuildSiegeEngine(unit, b.dataset.engine);
        });
        const stbtns = document.querySelectorAll('.build-structure-btn');
        stbtns.forEach(b => {
            b.onclick = () => callbacks.onBuildStructure && callbacks.onBuildStructure(unit, b.dataset.structure);
        });
        const concealBtn = document.getElementById('conceal-btn');
        if (concealBtn) concealBtn.onclick = () => callbacks.onConceal && callbacks.onConceal(unit);
        const revealBtns = document.querySelectorAll('.reveal-dir-btn');
        revealBtns.forEach(b => {
            b.onclick = () => callbacks.onReveal && callbacks.onReveal(unit, { dx: Number(b.dataset.dx), dz: Number(b.dataset.dz) });
        });
        const chargeBtns = document.querySelectorAll('.charge-btn');
        chargeBtns.forEach(b => {
            b.onclick = () => callbacks.onCharge && callbacks.onCharge(unit, Number(b.dataset.targetId));
        });
    }

    function showLordInfo(lord) {
        if (!lord) {
            if (els.unitInfo) els.unitInfo.innerHTML = '';
            return;
        }
        const cls = LORD_CLASSES[lord.class] || { name: '?', icon: 'star', desc: '' };
        const abilities = lord.abilities.map(a => LORD_ABILITIES[a]?.name || a).join(', ') || 'None';
        const fc = fcOf(lord.owner);
        const army = (lord.army && lord.army.length) ? lord.army.length : 0;
        const srow = (ic, label, val) => `<div class="stat-row"><span class="stat-ico">${svgIcon(ic, { size: 16 })}</span>${label}<b>${val}</b></div>`;
        const titleIco = lord.isKing ? 'crown' : cls.icon;
        let html = `<div class="info-card"><h4>${svgIcon(titleIco, { size: 16 })} ${lord.name} the ${cls.name}${lord.isKing ? ' · KING' : ''}</h4>`;
        html += srow('hp', 'HP', `${lord.hp == null ? '?' : Math.max(0, lord.hp | 0)}/${lord.maxHp == null ? '?' : lord.maxHp | 0}`);
        html += srow('attack', 'Attack', lordAttack(lord));
        html += srow('defense', 'Defense', lordDefense(lord) + kingGuardBonus(lord));
        html += srow('swords', 'XP', `${lord.xp}/${50 * lord.level}`);
        html += srow('flag', 'Owner', fc.name || lord.owner);
        html += srow('join', 'Army', `${army}/${maxArmySize(lord)}${lord.isKing ? ` (+${kingGuardBonus(lord)} guard DEF)` : ''}`);
        html += `<div class="stat-row"><span class="stat-ico">${svgIcon('star', { size: 16 })}</span>CMD/CMB/GOV<b>${lord.stats.command}/${lord.stats.combat}/${lord.stats.governance}</b></div>`;
        html += `<div style="font-size:11px; color:var(--muted); margin-top:4px;">${cls.name} — ${cls.desc}</div>`;
        html += `<div style="font-size:11px; color:var(--muted);">Abilities: ${abilities}</div>`;
        html += `<div class="stat-row" style="margin-top:4px;"><span class="stat-ico">${svgIcon((!lord.hasMovedThisTurn) ? 'move' : 'exhausted', { size: 16 })}</span><b style="margin-left:0;color:${(!lord.hasMovedThisTurn) ? 'var(--good)' : 'var(--bad)'}">${lord.hasMovedThisTurn ? 'Moved' : 'Can move'}</b></div>`;
        html += `</div>`;
        // Player lord auto-move goal status + cancel.
        if (lord.owner === PLAYER_FACTION) {
            if (lord.goal) {
                html += `${svgIcon('target', { size: 13 })} Auto-moving to [${lord.goal.x}, ${lord.goal.z}] `;
                html += `<button id="lord-cancel-goal-btn" class="btn btn-sm" style="margin-left:4px;">Cancel</button><br>`;
            } else {
                html += `<span style="font-size:11px; color:#9ab;">Right-click a tile to set an auto-move goal.</span><br>`;
            }
        }
        // King active ability button (player only).
        if (lord.isKing && lord.owner === PLAYER_FACTION && lord.active) {
            const cd = (gameState.kingCooldowns && gameState.kingCooldowns[PLAYER_FACTION]) || 0;
            const ready = cd <= 0;
            html += `<button id="king-act-btn" class="btn btn-primary btn-sm" style="margin-top:6px; width:100%;" ${ready ? '' : 'disabled'}>
                ${ready ? `${svgIcon('charge', { size: 13 })} ${lord.active.name}` : `${lord.active.name} (${cd}t)`}
            </button>`;
            html += `<div style="font-size:10px; color:#9ab;">${lord.active.desc}</div>`;
        }
        // Skill tree (Feature 4): show unspent points, learned skills, and
        // available skills as invest buttons. Player lords only.
        if (lord.owner === PLAYER_FACTION) {
            const known = (lord.skills || []).length ? lord.skills.join(', ') : 'None';
            html += `<div style="margin-top:6px; padding:4px; border-left:3px solid #ffd700; font-size:11px;">`;
            html += `<b style="color:#ffd700;">Skill Points: ${lord.skillPoints || 0}</b><br>`;
            html += `<span style="opacity:.7;">Learned: ${known}</span><br>`;
            const available = getAvailableSkills(lord);
            if ((lord.skillPoints || 0) > 0 && available.length) {
                html += `<div style="margin-top:3px;">Available to learn:</div>`;
                for (const skill of available) {
                    html += `<button class="btn btn-sm skill-invest-btn" data-lord-id="${lord.id}" data-skill-id="${skill.id}"
                        style="display:block; margin:2px 0; width:100%; text-align:left;">
                        ${skill.name} <span style="opacity:.6;">(T${skill.tier})</span> — ${skill.desc}
                    </button>`;
                }
            } else if ((lord.skillPoints || 0) > 0) {
                html += `<div style="color:#9ab; margin-top:3px;">No skills available (prerequisites unmet).</div>`;
            }
            html += `</div>`;
        }
        if (els.unitInfo) els.unitInfo.innerHTML = html;
        const kab = document.getElementById('king-act-btn');
        if (kab) kab.onclick = () => callbacks.onActivateKing && callbacks.onActivateKing(lord);
        const lcbtn = document.getElementById('lord-cancel-goal-btn');
        if (lcbtn) lcbtn.onclick = () => callbacks.onCancelGoal && callbacks.onCancelGoal(lord);
        const skillBtns = document.querySelectorAll('.skill-invest-btn');
        skillBtns.forEach(b => {
            b.onclick = () => callbacks.onSkillInvestment &&
                callbacks.onSkillInvestment(Number(b.dataset.lordId), b.dataset.skillId);
        });
    }

    function describeBuilding(type) {
        const b = BUILDING_TYPE[type];
        if (!b) return '';
        const bonusTxt = b.bonus ? Object.entries(b.bonus).map(([k, v]) => `+${v} ${k}`).join(', ') : '';
        let txt = `<b>${b.name}.</b> ${b.desc || ''}`;
        if (bonusTxt) txt += ` <span style="color:#7cfc00;">(${bonusTxt}/turn)</span>`;
        if (b.terrain && b.terrain !== 'CITY') txt += ` Must be built on ${TERRAIN[b.terrain] ? TERRAIN[b.terrain].name : b.terrain}.`;
        else if (b.terrain === 'CITY') txt += ' Built in a city.';
        return txt;
    }

    function describeUnit(type, def) {
        const u = UNIT_TYPE[type];
        if (!u) return '';
        let txt = `<b>${u.name}.</b> HP ${u.hp} • ATK ${u.attack} • DEF ${u.defense} • Move ${u.moveRange}`;
        const tags = [];
        if (u.ranged) tags.push(`ranged (range ${u.attackRange || 2})`);
        if (u.aoe) tags.push(`AOE splash (radius ${1})`);
        if (u.canSetFire) tags.push('sets area on fire');
        if (u.besiege) tags.push('besieges cities');
        if (u.siegeBonus) tags.push(`+${u.siegeBonus} vs cities`);
        if (u.vision) tags.push(`vision ${u.vision}`);
        if (u.canFoundCity) tags.push('founds a new city');
        if (u.canBuildBridge) tags.push('builds bridges over rivers');
        if (u.canBuildStructure && type !== 'ENGINEER') tags.push('builds fortifications');
        if (u.canBuildImprovement) tags.push('builds terrain improvements');
        if (u.frenzy) tags.push('+3 ATK below 50% HP (frenzy)');
        if (u.noMedic) tags.push('cannot be healed by medics');
        if (u.lordGuard) tags.push('+2 DEF near a friendly lord');
        if (u.cityBonus) tags.push(`+${u.cityBonus} ATK vs city units`);
        if (u.chargeMultiplier) tags.push(`×${u.chargeMultiplier} damage on first attack`);
        if (u.openTerrainMoveBonus) tags.push(`+${u.openTerrainMoveBonus} move on open terrain`);
        if (u.buildTurns && u.buildTurns > 1) tags.push(`${u.buildTurns}-turn build`);
        if (tags.length) txt += `. <span style="color:#ffd700;">${tags.join('; ')}.</span>`;
        // Faction flavor for this unit.
        if (def && def.unitMods && def.unitMods[type]) {
            const m = def.unitMods[type];
            const parts = [];
            if (m.attack) parts.push(`${m.attack > 0 ? '+' : ''}${m.attack} ATK`);
            if (m.defense) parts.push(`${m.defense > 0 ? '+' : ''}${m.defense} DEF`);
            if (m.hp) parts.push(`${m.hp > 0 ? '+' : ''}${m.hp} HP`);
            if (m.moveRange) parts.push(`${m.moveRange > 0 ? '+' : ''}${m.moveRange} MOV`);
            if (m.costGoldMult) parts.push(`${Math.round(m.costGoldMult * 100)}% gold cost`);
            if (parts.length) txt += ` <span style="color:#9cf;">Faction: ${parts.join(', ')}.</span>`;
        }
        return txt;
    }

    function showBuildMenu(tile) {
        if (!tile || tile.owner !== PLAYER_FACTION) {
            if (els.buildMenu) els.buildMenu.innerHTML = '';
            return;
        }
        const influence = getInfluencedTiles(gameState.tiles, PLAYER_FACTION);
        const inInfluence = influence.has(`${tile.x},${tile.z}`);
        const buildable = getBuildableBuildings(tile, gameState.resources.player, gameState.buildings, influence, gameState.tiles, gameState.tech);
        if (els.buildMenu) {
            els.buildMenu.innerHTML = '';
            const desc = document.createElement('div');
            desc.className = 'bm-desc';
            desc.innerHTML = '<span style="color:#789;">Hover a building or unit to see its description.</span>';
            els.buildMenu.appendChild(desc);
            const setDesc = (html) => { desc.innerHTML = html || '<span style="color:#789;">Hover a building or unit to see its description.</span>'; };
            const buildingGrid = document.createElement('div');
            buildingGrid.className = 'bm-grid';
            els.buildMenu.appendChild(buildingGrid);
            const unitGrid = document.createElement('div');
            unitGrid.className = 'bm-grid';

            if (!inInfluence) {
                const note = document.createElement('div');
                note.textContent = 'Outside any city\'s influence — capture a city nearby to build here.';
                note.style.cssText = 'font-size:11px; color:#ffaa00; margin-bottom:6px;';
                els.buildMenu.appendChild(note);
            }
            for (const b of buildable) {
                const btn = document.createElement('button');
                btn.textContent = `${b.name} (${formatCost(b.cost)})`;
                btn.disabled = !b.canBuild;
                btn.title = (BUILDING_TYPE[b.type] && BUILDING_TYPE[b.type].desc) ? BUILDING_TYPE[b.type].desc : (b.reason || '');
                btn.style.cssText = 'display:block; margin:2px; padding:4px; width:100%;';
                btn.onmouseenter = () => setDesc(describeBuilding(b.type) + (b.reason && !b.canBuild ? ` <span style="color:#ff8866;">(${b.reason})</span>` : ''));
                btn.onmouseleave = () => setDesc('');
                btn.onclick = () => {
                    if (callbacks.onBuild) callbacks.onBuild(b.type, tile);
                };
                els.buildMenu.appendChild(btn);
            }

            // Upgrade section (Area 6b): for each existing military building on
            // this tile below max level, show an Upgrade button with its cost.
            const existing = gameState.buildings.get(`${tile.x},${tile.z}`) || [];
            for (const bType of existing) {
                const bData = BUILDING_TYPE[bType];
                if (!bData || !bData.military) continue;
                const levels = MILITARY_BUILDING_LEVELS[bType];
                if (!levels) continue;
                const st = getBuildingState(gameState.buildingState, `${tile.x},${tile.z}`, bType);
                if (st.level >= BUILDING_MAX_LEVEL) continue;
                const next = levels[st.level];
                if (!next || !next.upgradeCost) continue;
                const upBtn = document.createElement('button');
                upBtn.textContent = `⬆ Upgrade ${bData.name} → L${st.level + 1} (${formatCost(next.upgradeCost)})`;
                const canAffordUp = Object.entries(next.upgradeCost)
                    .every(([r, a]) => (gameState.resources.player[r] || 0) >= a);
                upBtn.disabled = !canAffordUp;
                upBtn.style.cssText = 'display:block; margin:2px; padding:4px; width:100%; background:#2a3a5a;';
                upBtn.onclick = () => {
                    if (callbacks.onUpgradeBuilding) callbacks.onUpgradeBuilding(bType, tile);
                };
                els.buildMenu.appendChild(upBtn);
            }

            // Unit training (only in cities) — one unit per city per turn.
            if (tile.terrain === 'CITY') {
                const trainedSet = gameState.trainedThisTurn || new Set();
                const cityKey = `${tile.x},${tile.z}`;
                const alreadyTrained = trainedSet.has(cityKey);
                const cityLevel = tile.cityLevel || 1;
                const hasBarracks = (gameState.buildings.get(cityKey) || []).includes('BARRACKS');
                const def = defOf(PLAYER_FACTION);
                const roster = (def && def.roster) || Object.keys(UNIT_TYPE);
                const fullRoster = [...roster, ...EXTRA_UNITS.filter(u => !roster.includes(u))];
                // Tech gating: faction-roster units are always available, but
                // EXTRA_UNITS that are unlocked by a tech are only shown once
                // that tech is researched. Mirrors the AI's filter in ai.js. This
                // stops gunpowder-era units (and other faction's signature units
                // like LEGIONNAIRE/BERSERKER) appearing in the build menu from
                // turn 1 — they must be researched first.
                const ts = gameState.techState;
                if (ts && ts.researched) {
                    const unlocked = getUnlockedUnits(ts);
                    const filtered = fullRoster.filter(u => {
                        if (roster.includes(u)) return true; // faction-roster always available
                        if (EXTRA_UNITS.includes(u) && !unlocked.has(u)) {
                            // Only block if some tech actually unlocks this unit.
                            const hasTechUnlock = Object.values(TECHS).some(t =>
                                t.unlocks.some(ul => ul.type === 'unit' && ul.id === u));
                            if (hasTechUnlock) return false;
                        }
                        return true;
                    });
                    fullRoster.length = 0;
                    for (const u of filtered) fullRoster.push(u);
                }
                // Ships are unlocked per-city by a Harbor (coastal cities only).
                const hasHarbor = (gameState.buildings.get(cityKey) || []).includes('HARBOR');
                if (hasHarbor) {
                    for (const ship of NAVAL_UNITS) {
                        if (!fullRoster.includes(ship)) fullRoster.push(ship);
                    }
                }
                // Siege engines are unlocked per-city by a Siege Workshop.
                const hasWorkshop = (gameState.buildings.get(cityKey) || []).includes('SIEGE_WORKSHOP');
                if (hasWorkshop) {
                    for (const engine of SIEGE_ENGINES) {
                        if (!fullRoster.includes(engine)) fullRoster.push(engine);
                    }
                }

                const cityHeader = document.createElement('div');
                cityHeader.style.cssText = 'margin-top:8px; font-size:11px; color:#9fd;';
                const cap = getUnitCap(gameState.tiles, PLAYER_FACTION);
                const used = [...gameState.units.values()].filter(u => u.owner === PLAYER_FACTION).length;
                // Compute per-city yield (terrain + improvements)
                const radius = 3 + (cityLevel - 1);
                let cFood = 0, cWood = 0, cIron = 0, cGold = 8 + (cityLevel - 1) * 2;
                for (const ct of gameState.tiles.values()) {
                    if (ct.owner !== PLAYER_FACTION) continue;
                    if (Math.abs(ct.x - tile.x) > radius || Math.abs(ct.z - tile.z) > radius) continue;
                    const ctk = `${ct.x},${ct.z}`;
                    const cb = (gameState.buildings.get(ctk) || []);
                    if (ct.terrain === 'CITY') {
                        cb.forEach(bt => {
                            if (bt === 'MARKET') cGold += 10;
                        });
                    } else {
                        const terr = TERRAIN[ct.terrain];
                        if (terr && terr.resource) {
                            const amt = terr.amount || 0;
                            if (terr.resource === 'food') cFood += amt;
                            else if (terr.resource === 'wood') cWood += amt;
                            else if (terr.resource === 'iron') cIron += amt;
                        }
                        cb.forEach(bt => {
                            if (bt === 'FARM') cFood += 5;
                            else if (bt === 'LUMBERMILL') cWood += 5;
                            else if (bt === 'MINE') cIron += 5;
                        });
                    }
                }
                cityHeader.textContent = `City Lv.${cityLevel} (influence ${radius}) • Fort ${tile.fortification||0}/${tile.fortMax||0}${hasBarracks ? ' • Barracks' : ''} • Unit cap ${used}/${cap}`;
                cityHeader.textContent += ` • Yield: +${cFood}f +${cWood}w +${cIron}i +${cGold}g`;
                els.buildMenu.appendChild(cityHeader);

                // Natural-growth progress bar toward the next level.
                const growthDiv = document.createElement('div');
                if (cityLevel >= CITY_MAX_LEVEL) {
                    growthDiv.innerHTML = `<span style="color:#7cf;">Growth: MAX (Lv.${CITY_MAX_LEVEL})</span>`;
                } else {
                    const need = cityGrowthThreshold(cityLevel);
                    const have = Math.floor(tile.growth || 0);
                    const pct = Math.max(0, Math.min(100, (have / need) * 100));
                    growthDiv.innerHTML =
                        `<span style="color:#7cf;">Growth ${have}/${need} → Lv.${cityLevel + 1}</span>` +
                        ` <span style="display:inline-block; width:80px; height:7px; background:#222; border:1px solid #555; vertical-align:middle; margin:0 2px;">` +
                        `<span style="display:block; width:${pct}%; height:100%; background:#4caf50;"></span></span>`;
                }
                growthDiv.style.cssText = 'font-size:11px; margin:2px 0 6px;';
                els.buildMenu.appendChild(growthDiv);

                // Multi-turn production status: if this city is already producing
                // a unit (e.g. a Settler), show progress and block new training.
                const producing = gameState.production && gameState.production.get(cityKey);
                if (producing) {
                    const prod = document.createElement('div');
                    const uName = (UNIT_TYPE[producing.unitType] && UNIT_TYPE[producing.unitType].name) || producing.unitType;
                    prod.innerHTML = `🔨 Producing <b>${uName}</b> — ready in <b>${producing.turnsLeft}</b> turn${producing.turnsLeft === 1 ? '' : 's'}.`;
                    prod.style.cssText = 'font-size:11px; color:#ffd700; background:#1b1a10; border:1px solid #665; padding:4px; border-radius:4px; margin:4px 0;';
                    els.buildMenu.appendChild(prod);
                }

                // Level-up city button (grows influence radius + yield).
                const lvlCost = {
                    gold: 80 * cityLevel, food: 40 * cityLevel, production: 20 * cityLevel
                };
                const lvlBtn = document.createElement('button');
                lvlBtn.textContent = `⬆ Level Up City (${formatCost(lvlCost)})`;
                lvlBtn.disabled = !checkAffordable(lvlCost, gameState.resources.player);
                lvlBtn.title = 'Increase city level: +1 influence radius, higher yields, and stronger fortification.';
                lvlBtn.style.cssText = 'display:block; margin:2px 0 6px; padding:4px; width:100%;';
                lvlBtn.onmouseenter = () => setDesc('<b>Level Up City.</b> +1 influence radius, higher gold/production yields, and stronger fortification (fort max = 2 + city level).');
                lvlBtn.onclick = () => {
                    if (callbacks.onLevelUpCity) callbacks.onLevelUpCity(tile);
                };
                els.buildMenu.appendChild(lvlBtn);

                // Trade routes (Feature 3): a level-2+ player city can establish a
                // route to another qualifying city (own or friendly ≥ min level).
                if (cityLevel >= TRADE_ROUTE_MIN_CITY_LEVEL) {
                    const trHeader = document.createElement('h3');
                    trHeader.textContent = 'Trade Routes';
                    trHeader.style.marginTop = '6px';
                    els.buildMenu.appendChild(trHeader);
                    const myRoutes = (gameState.tradeRoutes || []).filter(r =>
                        r.from && r.from.cityKey === `${tile.x},${tile.z}`);
                    if (myRoutes.length) {
                        for (const r of myRoutes) {
                            const rd = document.createElement('div');
                            rd.style.cssText = 'font-size:11px; color:#9cf; margin:2px 0;';
                            const tgt = gameState.tiles.get(r.to.cityKey);
                            const tgtName = tgt ? (tgt.cityName || `City [${tgt.x},${tgt.z}]`) : r.to.cityKey;
                            rd.textContent = `→ ${tgtName}: +${r.income}g/turn${r.disrupted ? ' (raided!)' : ''}`;
                            els.buildMenu.appendChild(rd);
                        }
                    } else {
                        const none = document.createElement('div');
                        none.style.cssText = 'font-size:11px; color:#789; margin:2px 0;';
                        none.textContent = 'No routes from this city yet.';
                        els.buildMenu.appendChild(none);
                    }
                    // Candidate destinations: other player-owned or peaceful-friendly
                    // cities ≥ min level, not already routed from this city.
                    const existingTargets = new Set(myRoutes.map(r => r.to.cityKey));
                    let anyCandidate = false;
                    for (const t of gameState.tiles.values()) {
                        if (t.terrain !== 'CITY') continue;
                        if (t === tile) continue;
                        if ((t.cityLevel || 1) < TRADE_ROUTE_MIN_CITY_LEVEL) continue;
                        const tkey = `${t.x},${t.z}`;
                        if (existingTargets.has(tkey)) continue;
                        // Same owner always allowed; otherwise require peace/trade/alliance.
                        const friendly = t.owner === PLAYER_FACTION ||
                            (gameState.diplomacy && ['peace', 'trade_pact', 'alliance', 'non_aggression', 'ceasefire']
                                .includes(getRelation(gameState.diplomacy, PLAYER_FACTION, t.owner).state));
                        if (!t.owner || !friendly) continue;
                        anyCandidate = true;
                        const tb = document.createElement('button');
                        const tName = t.cityName || `City [${t.x},${t.z}]`;
                        const tFac = t.owner === PLAYER_FACTION ? '(yours)' : `(${fcOf(t.owner).name || t.owner})`;
                        tb.textContent = `Establish → ${tName} ${tFac}`;
                        tb.style.cssText = 'display:block; margin:2px; padding:4px; width:100%; background:#2a3a2a;';
                        tb.onclick = () => {
                            if (callbacks.onEstablishTrade) callbacks.onEstablishTrade(`${tile.x},${tile.z}`, tkey);
                        };
                        els.buildMenu.appendChild(tb);
                    }
                    if (!anyCandidate) {
                        const nc = document.createElement('div');
                        nc.style.cssText = 'font-size:11px; color:#789;';
                        nc.textContent = 'No qualifying destination cities (need level 2+ friendly city).';
                        els.buildMenu.appendChild(nc);
                    }
                }

                const trainHeader = document.createElement('h3');
                trainHeader.textContent = 'Train Unit';
                trainHeader.style.marginTop = '6px';
                els.buildMenu.appendChild(trainHeader);

                if (alreadyTrained) {
                    const used = document.createElement('div');
                    used.textContent = 'This city has already trained a unit this turn.';
                    used.style.cssText = 'font-size:11px; color:#ff8866; margin-bottom:4px;';
                    els.buildMenu.appendChild(used);
                }
                if (producing) {
                    const busy = document.createElement('div');
                    busy.textContent = 'This city is producing a unit — finish it before training another.';
                    busy.style.cssText = 'font-size:11px; color:#ff8866; margin-bottom:4px;';
                    els.buildMenu.appendChild(busy);
                }

                for (const unitType of fullRoster) {
                    // Faction unit cost (costGoldMult) + Barracks 25% gold discount + veteran.
                    let effCost = getUnitCostFor(unitType, def);
                    if (hasBarracks) effCost = { ...effCost, gold: Math.floor((effCost.gold || 0) * 0.75) };
                    const buildTurns = (UNIT_TYPE[unitType].buildTurns || 1);
                    const btn = document.createElement('button');
                    const canTrain = !alreadyTrained && !producing && checkAffordable(effCost, gameState.resources.player);
                    let label = `${UNIT_TYPE[unitType].name} (${formatCost(effCost)})`;
                    if (hasBarracks) label += ' ★';
                    if (buildTurns > 1) label += ` ⟳${buildTurns}t`;
                    btn.textContent = label;
                    btn.disabled = !canTrain;
                    btn.title = hasBarracks
                        ? 'Barracks: trains as veteran (Lv.2) for 25% less gold.'
                        : 'Train this unit here.';
                    btn.style.cssText = 'display:block; margin:2px; padding:4px; width:100%;';
                    let uDesc = describeUnit(unitType, def);
                    if (hasBarracks) uDesc += ' <span style="color:#9cf;">Barracks: trains as veteran (Lv.2) for 25% less gold.</span>';
                    if (buildTurns > 1) uDesc += ` <span style="color:#ffd700;">Takes ${buildTurns} turns to build (queued; produced over multiple turns).</span>`;
                    btn.onmouseenter = () => setDesc(uDesc);
                    btn.onmouseleave = () => setDesc('');
                    btn.onclick = () => {
                        if (callbacks.onTrain) callbacks.onTrain(unitType, tile);
                    };
                    els.buildMenu.appendChild(btn);
                }
            }
        }
    }

    function showDiplomacyPanel() {
        if (!els.diplomacyPanel) return;
        const summary = getDiplomacySummary(gameState.diplomacy, FACTIONS);
        const rep = gameState.reputation || {};
        els.diplomacyPanel.innerHTML = '<h3>Diplomacy</h3>';

        // Player reputation header (how trustworthy the world finds you).
        const myRep = rep[PLAYER_FACTION] == null ? 50 : rep[PLAYER_FACTION];
        const repHdr = document.createElement('div');
        repHdr.style.cssText = 'margin:4px 0; padding:4px; border-left:3px solid #d4af37; font-size:12px;';
        repHdr.innerHTML = `Your reputation: <b>${myRep}</b> <span style="opacity:.7;">(${relationshipLabel(myRep - 50)})</span>`;
        els.diplomacyPanel.appendChild(repHdr);

        const mkBtn = (label, action, target) => {
            const b = document.createElement('button');
            b.textContent = label;
            b.style.cssText = 'margin:2px 2px 0 0; padding:2px 6px; font-size:11px; cursor:pointer;';
            b.onclick = () => callbacks.onDiplomacy && callbacks.onDiplomacy(action, target);
            return b;
        };

        for (const rel of summary) {
            const involvesPlayer = rel.a === PLAYER_FACTION || rel.b === PLAYER_FACTION;
            const target = rel.a === PLAYER_FACTION ? rel.b : rel.a;
            const targetName = fcOf(target).name || target;
            const aName = fcOf(rel.a).name || rel.a;
            const bName = fcOf(rel.b).name || rel.b;
            const grievance = grievanceLevel(rel.grievances || 0);

            const div = document.createElement('div');
            div.style.cssText = 'margin: 4px 0; padding: 4px; border-left: 3px solid #888;';
            const stateColor = rel.state === 'war' ? '#ff4444' :
                               rel.state === 'peace' ? '#44ff44' :
                               rel.state === 'alliance' ? '#4488ff' :
                               rel.state === 'neutral' ? '#aaaaaa' :
                               rel.state === 'non_aggression' ? '#88cc88' :
                               rel.state === 'ceasefire' ? '#88cccc' : '#ffaa00';
            let extraInfo = '';
            if (rel.tradeAmount > 0) extraInfo += ` (Trade: ${rel.tradeAmount}g)`;
            if (rel.expiresOn && gameState.turn) {
                const turnsLeft = rel.expiresOn - gameState.turn;
                extraInfo += ` <span style="opacity:.6;">(expires in ${turnsLeft} turn${turnsLeft !== 1 ? 's' : ''})</span>`;
            }
            div.innerHTML = `
                <span style="color:${stateColor}; font-weight:bold;">${stateLabel(rel.state)}</span>
                — ${aName} vs ${bName}${extraInfo}
                <span style="opacity:.6; font-size:10px;">[${relationshipLabel(rel.relationship)} ${rel.relationship|0}]</span>
                <br><span style="font-size:10px; color:${grievance === 'furious' ? '#ff4444' : grievance === 'hostile' ? '#ff8844' : '#999'};">
                Tension: ${grievance} (${rel.grievances || 0})
                </span>
            `;

            // Action buttons only on rows involving the player. The available
            // action set depends on the current state.
            if (involvesPlayer) {
                if (rel.state === 'neutral') {
                    div.appendChild(mkBtn(`Propose NAP`, 'proposeNap', target));
                    div.appendChild(mkBtn(`Propose Peace`, 'proposePeace', target));
                    div.appendChild(mkBtn(`Propose Trade`, 'proposeTrade', target));
                    div.appendChild(mkBtn(`Propose Alliance`, 'proposeAlliance', target));
                    div.appendChild(mkBtn(`Declare War`, 'declareWar', target));
                } else if (rel.state === 'non_aggression') {
                    div.appendChild(mkBtn(`Propose Ceasefire`, 'proposeCeasefire', target));
                    div.appendChild(mkBtn(`Propose Peace`, 'proposePeace', target));
                    div.appendChild(mkBtn(`Propose Trade`, 'proposeTrade', target));
                    div.appendChild(mkBtn(`Propose Alliance`, 'proposeAlliance', target));
                    div.appendChild(mkBtn(`💥 Break NAP → War`, 'declareWar', target));
                } else if (rel.state === 'ceasefire') {
                    div.appendChild(mkBtn(`Propose NAP`, 'proposeNap', target));
                    div.appendChild(mkBtn(`Propose Peace`, 'proposePeace', target));
                    div.appendChild(mkBtn(`Propose Trade`, 'proposeTrade', target));
                    div.appendChild(mkBtn(`Propose Alliance`, 'proposeAlliance', target));
                    div.appendChild(mkBtn(`Declare War`, 'declareWar', target));
                } else if (rel.state === 'war') {
                    div.appendChild(mkBtn(`Propose Ceasefire`, 'proposeCeasefire', target));
                    div.appendChild(mkBtn(`Propose Peace`, 'proposePeace', target));
                    // Peace Negotiation with demands: gold reparations, territory
                    // cession, or ongoing tribute. Visible only while at war.
                    const wear = (gameState.diplomacy.warWeariness || {})[target] || 0;
                    const neg = document.createElement('div');
                    neg.style.cssText = 'margin-top:6px; padding:4px; border-left:3px solid #ff8844; font-size:11px;';
                    neg.innerHTML = `
                        <b>Peace Negotiation</b> <span style="opacity:.6;">(war weariness ${Math.round(wear)})</span><br>
                        <label>Gold: </label><input type="number" id="peace-gold-${target}" value="100" min="0" max="500" style="width:54px; background:#222; color:#fff; border:1px solid #555;">
                        &nbsp;<label>Tribute g/turn: </label><input type="number" id="peace-trib-${target}" value="0" min="0" max="15" style="width:40px; background:#222; color:#fff; border:1px solid #555;">
                        <input type="number" id="peace-tribturns-${target}" value="10" min="1" max="20" style="width:36px; background:#222; color:#fff; border:1px solid #555;">t<br>
                        <label>Territory (e.g. 5,6 7,8): </label><input type="text" id="peace-terr-${target}" placeholder="x,z ..." style="width:120px; background:#222; color:#fff; border:1px solid #555;"><br>
                        <button class="btn" id="propose-peace-${target}" style="margin-top:3px;">Propose Peace w/ Demands</button>
                    `;
                    div.appendChild(neg);
                    const pBtn = neg.querySelector(`#propose-peace-${target}`);
                    if (pBtn) {
                        pBtn.onclick = () => {
                            const gold = parseInt(neg.querySelector(`#peace-gold-${target}`)?.value) || 0;
                            const tribPerTurn = parseInt(neg.querySelector(`#peace-trib-${target}`)?.value) || 0;
                            const tribTurns = parseInt(neg.querySelector(`#peace-tribturns-${target}`)?.value) || 0;
                            const terrStr = (neg.querySelector(`#peace-terr-${target}`)?.value || '').trim();
                            const tiles = terrStr.split(/\s+/).filter(t => t.includes(','));
                            let demands;
                            if (tiles.length > 0) demands = { type: 'territory', tiles };
                            else if (tribPerTurn > 0) demands = { type: 'tribute', perTurn: tribPerTurn, duration: tribTurns };
                            else demands = { type: 'gold', amount: gold };
                            callbacks.onPeaceNegotiation && callbacks.onPeaceNegotiation(target, demands);
                        };
                    }
                } else if (rel.state === 'peace') {
                    div.appendChild(mkBtn(`Propose NAP`, 'proposeNap', target));
                    div.appendChild(mkBtn(`Propose Trade`, 'proposeTrade', target));
                    div.appendChild(mkBtn(`Propose Alliance`, 'proposeAlliance', target));
                    div.appendChild(mkBtn(`Declare War`, 'declareWar', target));
                } else if (rel.state === 'trade_pact') {
                    div.appendChild(mkBtn(`Cancel Trade`, 'cancelTrade', target));
                    div.appendChild(mkBtn(`Propose NAP`, 'proposeNap', target));
                    div.appendChild(mkBtn(`Propose Alliance`, 'proposeAlliance', target));
                    div.appendChild(mkBtn(`Declare War`, 'declareWar', target));
                } else if (rel.state === 'alliance') {
                    div.appendChild(mkBtn(`Declare War`, 'declareWar', target));
                }
            }

            els.diplomacyPanel.appendChild(div);
        }

        // Pending AI offers to the player, with Accept/Decline buttons.
        const offers = (gameState.diplomacy && gameState.diplomacy.pendingOffers) || [];
        const playerOffers = offers.map((o, i) => ({ o, i })).filter(x => x.o.to === PLAYER_FACTION);
        if (playerOffers.length) {
            const hdr = document.createElement('div');
            hdr.style.cssText = 'margin-top:6px; font-weight:bold; font-size:12px;';
            hdr.textContent = 'Pending offers:';
            els.diplomacyPanel.appendChild(hdr);
            for (const { o, i } of playerOffers) {
                const fromName = fcOf(o.from).name || o.from;
                const row = document.createElement('div');
                row.style.cssText = 'margin:3px 0; padding:3px; border-left:3px solid #4488ff; font-size:11px;';
                const kind = o.type === 'peace' ? 'Peace' : o.type === 'trade_pact' ? 'Trade Pact' : o.type === 'non_aggression' ? 'NAP' : o.type === 'ceasefire' ? 'Ceasefire' : 'Alliance';
                row.innerHTML = `${fromName} proposes <b>${kind}</b>`;
                row.appendChild(mkBtn('Accept', 'acceptOffer', i));
                row.appendChild(mkBtn('Decline', 'declineOffer', i));
                els.diplomacyPanel.appendChild(row);
            }
        }
    }

    function showLordPanel() {
        if (!els.lordPanel) return;
        const playerLords = gameState.lords.filter(l => l.owner === 'player');
        els.lordPanel.innerHTML = '<h3>Lords</h3>';

        if (playerLords.length === 0) {
            els.lordPanel.innerHTML += '<p>No lords</p>';
        }

        for (const lord of playerLords) {
            const cls = LORD_CLASSES[lord.class] || { name: '?', icon: '👑', desc: '' };
            const div = document.createElement('div');
            div.style.cssText = 'margin: 4px 0; padding: 4px; border-left: 3px solid #ffd700;';
            const abilities = lord.abilities.map(a => LORD_ABILITIES[a]?.name || a).join(', ') || 'None';
            const army = (lord.army && lord.army.length) ? lord.army.length : 0;
            div.innerHTML = `
                <strong>${cls.icon} ${lord.name} the ${cls.name}</strong> (Lv.${lord.level})${lord.isKing ? ' 👑' : ''}<br>
                XP: ${lord.xp}/${50 * lord.level} | Army: ${army}/${maxArmySize(lord)}<br>
                CMD: ${lord.stats.command} | CMB: ${lord.stats.combat} | GOV: ${lord.stats.governance}<br>
                Class: ${cls.name}<br>
                Abilities: ${abilities}<br>
                ${lord.governingCity ? `Governing: ${lord.governingCity}` : ''}
            `;
            // King active ability button.
            if (lord.isKing && lord.active) {
                const cd = (gameState.kingCooldowns && gameState.kingCooldowns[PLAYER_FACTION]) || 0;
                const ready = cd <= 0;
                const kab = document.createElement('button');
                kab.textContent = ready ? `⚡ ${lord.active.name}` : `${lord.active.name} (${cd}t)`;
                kab.disabled = !ready;
                kab.style.cssText = 'margin-top:3px; padding:3px; width:100%; font-size:11px;';
                kab.title = lord.active.desc;
                kab.onclick = () => callbacks.onActivateKing && callbacks.onActivateKing(lord);
                div.appendChild(kab);
            }
            els.lordPanel.appendChild(div);
        }

        // Recruit lord button (only for the human player — hidden in spectate).
        if (callbacks.onRecruitLord) {
            const recruitBtn = document.createElement('button');
            recruitBtn.textContent = `Recruit Lord (${LORD_RECRUIT_COST.gold}g, ${LORD_RECRUIT_COST.food}f)`;
            recruitBtn.style.cssText = 'margin-top:5px; padding:4px; width:100%;';
            recruitBtn.onclick = () => callbacks.onRecruitLord();
            els.lordPanel.appendChild(recruitBtn);
        }
    }

    function addCombatLog(message) {
        if (!els.combatLog) return;
        const entry = document.createElement('div');
        entry.textContent = message;
        // Categorize by content for colored left border + icon prefix
        let catClass = 'log-default';
        const m = message.toLowerCase();
        if (/[🐎🗡️🦔🪤🏹]|attacks?|charges?|destroyed|killed|ambush|bombard|breached|splash|fell in battle|impaled|trap|spikes/.test(m)) {
            catClass = 'log-combat';
        } else if (/declar.*(?:war|peace)|peace treaty|nap|alliance|ceasefire|trade pact|denounce|offers? (?:peace|nap|ceasefire|alliance|trade)|treaty|cancel.*trade/.test(m)) {
            catClass = 'log-diplomacy';
        } else if (/[💰]|trained|selling|market|sell|afford|recruit|Gold/.test(m)) {
            catClass = 'log-economy';
        } else if (/🔨|started building|ready in|producing|builds?\b|built/.test(m)) {
            catClass = 'log-production';
        }
        const icon = catClass === 'log-combat' ? '⚔️' :
                     catClass === 'log-diplomacy' ? '🏛️' :
                     catClass === 'log-economy' ? '💰' :
                     catClass === 'log-production' ? '🔨' : '';
        entry.innerHTML = `${icon ? `<span style="margin-right:4px;">${icon}</span>` : ''}<span>${message}</span>`;
        entry.className = catClass;
        els.combatLog.insertBefore(entry, els.combatLog.firstChild);
        while (els.combatLog.children.length > 30) {
            els.combatLog.removeChild(els.combatLog.lastChild);
        }
    }

    function formatCost(cost) {
        const parts = [];
        for (const [res, amt] of Object.entries(cost)) {
            if (amt > 0) parts.push(`${amt}${res[0]}`);
        }
        return parts.join(' ');
    }

    function checkAffordable(cost, resources) {
        for (const [res, amt] of Object.entries(cost)) {
            if ((resources[res] || 0) < amt) return false;
        }
        return true;
    }

    // End turn button
    const endTurnBtn = document.getElementById('btn-end-turn');
    if (endTurnBtn) {
        endTurnBtn.addEventListener('click', () => {
            if (callbacks.onEndTurn) { callbacks.onEndTurn(); return; }
            if (gameState.turnManager && gameState.turnManager.phase === PLAYER_FACTION && !gameState.gameOver) {
                gameState.turnManager.endPlayerTurn();
                updateAll();
            }
        });
    }

    // Tab key toggles the Victory Progress panel (Feature 5). preventDefault keeps
    // Tab from stealing focus while the player is browsing the map. The panel is
    // hidden by default; first Tab shows it (and showVictoryPanel populates it on
    // the next updateAll), second Tab hides it.
    if (els.victoryPanelWrap) {
        document.addEventListener('keydown', (e) => {
            if (e.key !== 'Tab') return;
            const tag = (e.target && e.target.tagName) || '';
            if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
            e.preventDefault();
            const wrap = els.victoryPanelWrap;
            const open = wrap.style.display === 'block';
            wrap.style.display = open ? 'none' : 'block';
            if (!open) showVictoryPanel();
        });
    }

    // T key toggles the Tech Tree panel.
    if (els.techPanelWrap) {
        document.addEventListener('keydown', (e) => {
            if (e.key !== 't' && e.key !== 'T') return;
            const tag = (e.target && e.target.tagName) || '';
            if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
            e.preventDefault();
            const wrap = els.techPanelWrap;
            const open = wrap.style.display === 'block';
            wrap.style.display = open ? 'none' : 'block';
            if (!open) showTechPanel();
        });
    }

    // Scoreboard button: shows the faction rankings panel.
    const sbBtn = document.getElementById('btn-scoreboard');
    if (sbBtn) {
        sbBtn.addEventListener('click', () => {
            showScoreboard();
        });
    }

    function updateAll() {
        updateResourceBar();
        showDiplomacyPanel();
        showLordPanel();
        showAIGoalsPanel();
        showVictoryPanel();
        showTechPanel();
    }

    // Spectate-only debug panel: each AI faction's current ordered goal
    // sequence (kind, priority, horizon, target tile). Rendered from the pure
    // buildAIGoalsHTML helper so the panel logic stays unit-testable. No-op when
    // the panel wrapper is hidden (normal play) — avoids wasted DOM work.
    function showAIGoalsPanel() {
        if (!els.aiGoalsPanel || !els.aiGoalsPanelWrap) return;
        if (els.aiGoalsPanelWrap.style.display === 'none') return;
        els.aiGoalsPanel.innerHTML = buildAIGoalsHTML(
            gameState.aiState, FACTIONS, gameState.factionDefs, gameState.factionColors, true);
    }

    // Victory Progress Tracker (Feature 5): a glanceable panel summarizing the
    // player's progress toward each of the four victory conditions (domination,
    // science, economic, score). Rendered from the pure getVictoryProgress()
    // callback so the logic stays in game.js and the panel stays declarative.
    // No-op when the panel wrapper is hidden.
    function showVictoryPanel() {
        if (!els.victoryPanel || !els.victoryPanelWrap) return;
        if (els.victoryPanelWrap.style.display === 'none') return;
        if (typeof callbacks.getVictoryProgress !== 'function') return;
        let p;
        try { p = callbacks.getVictoryProgress(); }
        catch (e) { return; }
        if (!p) return;

        const bar = (frac) => {
            const pct = Math.max(0, Math.min(1, frac)) * 100;
            return `<div class="progress-track"><div class="progress-fill" style="width:${pct.toFixed(0)}%"></div></div>`;
        };
        const fmt = (n) => Math.floor(n);

        const dom = p.domination || {};
        const sci = p.science || {};
        const eco = p.economic || {};
        const sc = p.score || {};
        const html = `
            <div class="victory-section">
                <div class="victory-label">⚔️ Domination</div>
                <div class="victory-detail">${fmt(dom.eliminated||0)}/${fmt(dom.total||0)} rivals eliminated</div>
                ${bar(dom.progress||0)}
            </div>
            <div class="victory-section">
                <div class="victory-label">🔬 Science</div>
                <div class="victory-detail">${fmt(sci.researched||0)}/${fmt(sci.total||0)} techs${sci.currentTech ? ' · researching '+sci.currentTech : ''}</div>
                ${bar(sci.progress||0)}
            </div>
            <div class="victory-section">
                <div class="victory-label">💰 Economic</div>
                <div class="victory-detail">${fmt(eco.gold||0)}g / ${fmt(eco.goldTarget||0)}g · ${fmt(eco.tradeRoutes||0)}/${fmt(eco.routeTarget||0)} routes</div>
                ${bar(eco.progress||0)}
            </div>
            <div class="victory-section">
                <div class="victory-label">🏆 Score (turn ${fmt(sc.turn||0)}/${fmt(sc.maxTurn||0)})</div>
                <div class="victory-detail">You ${fmt(sc.playerScore||0)} · Best AI ${fmt(sc.aiScore||0)}</div>
                ${bar(sc.progress||0)}
            </div>`;
        els.victoryPanel.innerHTML = html;
    }

    // Tech Tree Panel: shows all techs grouped by era, with status indicators
    // (researched, available, locked). Clicking an available tech starts research.
    function showTechPanel() {
        if (!els.techPanel || !els.techPanelWrap) return;
        if (els.techPanelWrap.style.display === 'none') return;
        const ts = gameState.techState;
        if (!ts) { els.techPanel.innerHTML = '<p>No tech state available.</p>'; return; }

        const eraOrder = ['ancient', 'classical', 'medieval', 'industrial', 'renaissance', 'enlightenment', 'modern'];
        const eraNames = { ancient: 'Ancient', classical: 'Classical', medieval: 'Medieval', industrial: 'Industrial', renaissance: 'Renaissance', enlightenment: 'Enlightenment', modern: 'Modern' };
        const eraColor = { ancient: '#c8a06e', classical: '#d4af37', medieval: '#8b5cf6', industrial: '#6b7280', renaissance: '#3b82f6', enlightenment: '#f59e0b', modern: '#ef4444' };

        let html = '<h3>Research</h3>';
        if (ts.current) {
            const curTech = TECHS[ts.current];
            if (curTech) {
                const pct = curTech.cost > 0 ? Math.floor((ts.progress / curTech.cost) * 100) : 0;
                html += `<div style="margin:4px 0;padding:6px;border-left:3px solid #4caf50;background:#1a2a1a;font-size:12px;">
                    Researching: <b>${curTech.name}</b><br>
                    <div class="progress-track" style="margin-top:4px;"><div class="progress-fill" style="width:${pct}%"></div></div>
                    <span style="opacity:.7;">${ts.progress}/${curTech.cost} pts</span>
                </div>`;
            }
        } else {
            html += '<div style="margin:4px 0;padding:6px;border-left:3px solid #888;font-size:12px;opacity:.7;">No tech selected — pick one below.</div>';
        }

        for (const era of eraOrder) {
            const techs = Object.values(TECHS).filter(t => t.era === era);
            if (techs.length === 0) continue;
            html += `<div style="margin:6px 0 2px;"><b style="color:${eraColor[era] || '#aaa'};">${eraNames[era]}</b></div>`;
            for (const tech of techs) {
                const researched = ts.researched.has(tech.id);
                const available = !researched && tech.prerequisites.every(p => ts.researched.has(p));
                const isCurrent = ts.current === tech.id;
                const borderColor = researched ? '#4caf50' : isCurrent ? '#2196f3' : available ? '#ff9800' : '#444';
                const opacity = researched ? '0.7' : available ? '1' : '0.5';
                const cursor = available && !isCurrent ? 'pointer' : 'default';
                const unlockText = tech.unlocks.map(u => {
                    if (u.type === 'building') return BUILDING_TYPE[u.id]?.name || u.id;
                    if (u.type === 'unit') return UNIT_TYPE[u.id]?.name || u.id;
                    return u.id;
                }).join(', ');
                html += `<div style="margin:2px 0;padding:4px 6px;border-left:3px solid ${borderColor};opacity:${opacity};cursor:${cursor};font-size:12px;background:#1a1a2a;"
                    data-tech-id="${tech.id}" class="tech-card">
                    <b>${tech.name}</b> (${tech.cost} pts)
                    ${researched ? ' ✓' : ''}
                    ${unlockText ? `<br><span style="opacity:.7;">Unlocks: ${unlockText}</span>` : ''}
                    ${tech.bonus && Object.keys(tech.bonus).length ? `<br><span style="opacity:.7;">Bonus: ${tech.desc.split('.').pop().trim()}</span>` : ''}
                </div>`;
            }
        }

        els.techPanel.innerHTML = html;

        // Attach click handlers for available techs
        els.techPanel.querySelectorAll('.tech-card').forEach(card => {
            card.addEventListener('click', () => {
                const id = card.dataset.techId;
                if (!id) return;
                const t = TECHS[id];
                if (!t) return;
                const researched = ts.researched.has(id);
                const available = !researched && t.prerequisites.every(p => ts.researched.has(p));
                if (available && callbacks.onResearch) {
                    callbacks.onResearch(id);
                    showTechPanel();
                }
            });
        });
    }

    // Scoreboard Panel: shows all factions' power rankings, scores, and
    // closest victory progress. Accessible via the scoreboard button.
    function showScoreboard() {
        if (typeof callbacks.getAllFactionProgress !== 'function') return;
        let progress;
        try { progress = callbacks.getAllFactionProgress(); }
        catch (e) { return; }
        if (!progress) return;

        // Sort by score descending
        const sorted = Object.entries(progress)
            .filter(([, p]) => !p.eliminated)
            .sort((a, b) => (b[1].score || 0) - (a[1].score || 0));

        const eliminated = Object.entries(progress).filter(([, p]) => p.eliminated);

        let html = '<div class="scoreboard">';
        html += '<h3>Scoreboard</h3>';
        html += '<div class="sb-header"><span>#</span><span>Faction</span><span>Score</span><span>Cities</span><span>Tech</span><span>Gold</span><span>Target</span><span>Closest Victory</span></div>';

        sorted.forEach(([faction, data], i) => {
            const color = callbacks.factionColors && callbacks.factionColors[faction];
            const hex = color ? '#' + color.tile.toString(16).padStart(6, '0') : '#888';
            const name = color?.name || faction;
            const pct = Math.round((data.closestProgress || 0) * 100);
            const isDom = data.isDominant ? ' <span class="dominant-tag">DOMINANT</span>' : '';
            html += `<div class="sb-row" style="border-left:3px solid ${hex};">
                <span>${i + 1}</span>
                <span style="color:${hex};font-weight:600;">${name}${isDom}</span>
                <span>${data.score || 0}</span>
                <span>${data.cities || 0}</span>
                <span>${data.techs || 0}/${data.totalTechs || 16}</span>
                <span>${data.gold || 0}g</span>
                <span>${data.victoryTarget || '—'}</span>
                <span>${data.closestVictory} ${pct}%</span>
            </div>`;
        });

        if (eliminated.length) {
            html += '<div class="sb-eliminated"><h4>Eliminated</h4>';
            eliminated.forEach(([f]) => {
                const name = callbacks.factionColors && callbacks.factionColors[f] ? callbacks.factionColors[f].name : f;
                html += `<span class="eliminated-tag">${name}</span> `;
            });
            html += '</div>';
        }

        html += '</div>';

        // Display in the victory panel area or a dedicated panel
        if (els.victoryPanel) {
            els.victoryPanel.innerHTML = html;
            if (els.victoryPanelWrap) els.victoryPanelWrap.style.display = 'block';
        }
    }

    return {
        updateResourceBar,
        showTileInfo,
        showUnitInfo,
        showLordInfo,
        showBuildMenu,
        showDiplomacyPanel,
        showLordPanel,
        showAIGoalsPanel,
        showVictoryPanel,
        showTechPanel,
        showScoreboard,
        addCombatLog,
        updateAll
    };
}