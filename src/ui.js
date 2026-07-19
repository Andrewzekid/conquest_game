/** UI: resource bar, tile/unit info, build menu, diplomacy panel, lord panel, combat log. */
import { UNIT_TYPE, BUILDING_TYPE, DIPLOMACY_STATES, LORD_ABILITIES,
         FACTIONS, PLAYER_FACTION, FACTION_COLORS, LORD_CLASSES, TERRAIN, TERRAIN_BONUS,
         EXTRA_UNITS, NAVAL_UNITS, SIEGE_ENGINES, CHARGE_UNITS, CONCEAL_TERRAINS,
         cityGrowthThreshold, CITY_MAX_LEVEL } from './config.js';
import { getBuildableBuildings, pillageableOn } from './building.js';
import { getDiplomacySummary, stateLabel, relationshipLabel } from './diplomacy.js';
import { getInfluencedTiles, isPassable } from './map.js';
import { maxArmySize, lordAttack, lordDefense, kingGuardBonus } from './lords.js';
import { getUnitCostFor, getFactionDef } from './faction.js';
import { getUnitCap, unitCapForCity } from './economy.js';

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

    function updateResourceBar() {
        const r = gameState.resources.player;
        if (els.gold) els.gold.textContent = Math.floor(r.gold);
        if (els.food) els.food.textContent = Math.floor(r.food);
        if (els.wood) els.wood.textContent = Math.floor(r.wood);
        if (els.iron) els.iron.textContent = Math.floor(r.iron);
        if (els.production) els.production.textContent = Math.floor(r.production || 0);
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

    /** Calculate and display production breakdown tooltips for each resource. */
    function updateResourceTooltips() {
        const tiles = gameState.tiles;
        const buildings = gameState.buildings;
        const units = gameState.units;
        if (!tiles) return;

        // Calculate production sources
        let goldCities = 0, goldMarkets = 0, goldTrade = 0, goldUpkeep = 0;
        let foodFarms = 0, foodCities = 0, foodTerrain = 0, foodUpkeep = 0;
        let woodMills = 0, woodCities = 0, woodForests = 0, woodUpkeep = 0;
        let ironMines = 0, ironMountains = 0, ironHills = 0, ironUpkeep = 0;
        let prodCities = 0, prodBarracks = 0, prodWorkshops = 0;

        // Count cities and their base production
        for (const tile of tiles.values()) {
            if (tile.owner !== PLAYER_FACTION) continue;
            const key = `${tile.x},${tile.z}`;
            const tileBuildings = buildings.get(key) || [];

            if (tile.terrain === 'CITY') {
                const cl = tile.cityLevel || 1;
                goldCities += 8 + (cl - 1) * 2; // Base city gold
                foodCities += 2 + cl; // City food
                woodCities += 1 + cl; // City wood (new feature)
                prodCities += 2 * cl; // City production

                // Building bonuses on city tile
                for (const bType of tileBuildings) {
                    if (bType === 'MARKET') goldMarkets += 10;
                    if (bType === 'BARRACKS') prodBarracks += 10;
                    if (bType === 'SIEGE_WORKSHOP') prodWorkshops += 5;
                    if (bType === 'HARBOR') prodWorkshops += 5;
                }
            } else {
                // Non-city tiles: check for terrain improvements
                const terrain = TERRAIN[tile.terrain];
                if (terrain && terrain.resource) {
                    const amount = terrain.amount || 0;
                    if (terrain.resource === 'food') foodTerrain += amount;
                    if (terrain.resource === 'wood') woodForests += amount;
                    if (terrain.resource === 'iron') {
                        if (tile.terrain === 'MOUNTAIN') ironMountains += amount;
                        else if (tile.terrain === 'HILLS') ironHills += amount;
                    }
                }

                // Building bonuses on non-city tiles
                for (const bType of tileBuildings) {
                    if (bType === 'FARM') foodFarms += 5;
                    if (bType === 'LUMBERMILL') woodMills += 5;
                    if (bType === 'MINE') ironMines += 5;
                }
            }
        }

        // Calculate unit upkeep
        for (const unit of units.values()) {
            if (unit.owner !== PLAYER_FACTION) continue;
            const upkeep = unit.upkeep || {};
            goldUpkeep += upkeep.gold || 0;
            foodUpkeep += upkeep.food || 0;
            woodUpkeep += upkeep.wood || 0;
            ironUpkeep += upkeep.iron || 0;
        }

        // Trade routes (simplified - count trade pacts)
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

        // Gold tooltip
        setTooltip('gold-cities', goldCities);
        setTooltip('gold-markets', goldMarkets);
        setTooltip('gold-trade', goldTrade);
        setTooltip('gold-upkeep', -goldUpkeep, false);
        setTooltip('gold-net', goldCities + goldMarkets + goldTrade - goldUpkeep);

        // Food tooltip
        setTooltip('food-farms', foodFarms);
        setTooltip('food-cities', foodCities);
        setTooltip('food-terrain', foodTerrain);
        setTooltip('food-upkeep', -foodUpkeep, false);
        setTooltip('food-net', foodFarms + foodCities + foodTerrain - foodUpkeep);

        // Wood tooltip
        setTooltip('wood-mills', woodMills);
        setTooltip('wood-cities', woodCities);
        setTooltip('wood-forests', woodForests);
        setTooltip('wood-upkeep', -woodUpkeep, false);
        setTooltip('wood-net', woodMills + woodCities + woodForests - woodUpkeep);

        // Iron tooltip
        setTooltip('iron-mines', ironMines);
        setTooltip('iron-mountains', ironMountains);
        setTooltip('iron-hills', ironHills);
        setTooltip('iron-upkeep', -ironUpkeep, false);
        setTooltip('iron-net', ironMines + ironMountains + ironHills - ironUpkeep);

        // Production tooltip
        setTooltip('prod-cities', prodCities);
        setTooltip('prod-barracks', prodBarracks);
        setTooltip('prod-workshops', prodWorkshops);
        setTooltip('prod-net', prodCities + prodBarracks + prodWorkshops);
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
        let info = `${td.name} [${tile.x}, ${tile.z}]`;
        if (td.resource && td.amount) info += ` — ${td.amount} ${td.resource}`;
        info += ` (${bonusTxt})`;
        if (tile.terrain === 'CITY') {
            // Show city name, level, and health bar (fortification)
            const cityName = tile.cityName || `City`;
            const cityLevel = tile.cityLevel || 1;
            const fort = tile.fortification || 0;
            const fortMax = tile.fortMax || 1;
            const fortPct = Math.round((fort / fortMax) * 100);
            const breached = fort === 0 && tile.owner !== PLAYER_FACTION;
            info += ` | 🏰 ${cityName} (Lv.${cityLevel})`;
            info += ` | HP: ${fort}/${fortMax} (${fortPct}%)${breached ? ' BREACHED' : ''}`;
        }
        if (tile.terrain === 'RIVER') {
            info += tile.bridge ? ' | 🌉 Bridged' : ' | Impassable (needs bridge)';
        }
        if (tile.wonder) {
            info += ` | ${tile.wonder.emoji || ''} ${tile.wonder.name}`;
        }
        if (els.info) els.info.textContent = info;

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
        }

        // Natural Wonder: show its per-turn bonus (and who reaps it).
        if (tile.wonder && els.ownership) {
            const bonusTxt = Object.entries(tile.wonder.bonus)
                .map(([r, a]) => `+${a} ${r}`).join(', ');
            const who = tile.owner ? ` (${tile.owner === PLAYER_FACTION ? 'you' : fcOf(tile.owner).name || tile.owner})` : ' — capture it to claim!';
            els.ownership.textContent += ` | ${tile.wonder.emoji || '✨'} ${tile.wonder.name}: ${bonusTxt}${who}`;
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
        let html = `
            <strong>${stats.name}</strong> (Lv.${lvl}) #${unit.id}<br>
            HP: ${unit.hp}/${unit.maxHp} | XP: ${unit.xp || 0}/${30 * lvl}<br>
            ATK: ${atk} | DEF: ${def} | Move: ${stats.moveRange}<br>
            Owner: ${fc.name || unit.owner}<br>
            ${unit.hasMovedThisTurn ? '(Moved)' : '(Can move)'}
            ${unit.hasAttackedThisTurn ? '(Attacked)' : '(Can attack)'}<br>`;
        if (unit.burn && unit.burn > 0) {
            html += `<span style="font-size:11px; color:#ff7b3a;">🔥 On fire — taking ${2} dmg/turn for ${unit.burn} turn${unit.burn === 1 ? '' : 's'}.</span><br>`;
        }
        if (unit.boarded) {
            html += `<span style="font-size:11px; color:#9cf;">🚢 Aboard a transport (disembark to act).</span><br>`;
        }
        if (unit.owner === PLAYER_FACTION) {
            // Conceal / Reveal controls for forest/mountain ambush mechanic.
            const tile = gameState.tiles.get(`${unit.x},${unit.z}`);
            const canConceal = tile && CONCEAL_TERRAINS.includes(tile.terrain) &&
                !unit.hasMovedThisTurn && !unit.hasAttackedThisTurn &&
                unit.concealState !== 'concealing' && unit.concealState !== 'concealed';
            if (canConceal) {
                const turns = tile.terrain === 'MOUNTAIN' ? 2 : 1;
                html += `<button id="conceal-btn" style="font-size:11px; padding:2px 6px; margin-top:2px; color:#7cf;" title="Conceal this unit in the ${tile.terrain.toLowerCase()} (${turns} turn${turns === 1 ? '' : 's'}). Concealed units cannot move.">🌲 Conceal in ${tile.terrain} (${turns}t)</button><br>`;
            }
            if (unit.concealState === 'concealing') {
                html += `<span style="font-size:11px; color:#7cf;">🌲 Concealing: ${unit.concealTurnsLeft} turn${unit.concealTurnsLeft === 1 ? '' : 's'} left.</span><br>`;
            }
            if (unit.concealState === 'concealed') {
                html += `<div style="font-size:11px; color:#7cfc00; margin-top:4px;">🌲 Concealed — cannot move.</div>`;
                html += `<div style="font-size:10px; color:#9ab;">Reveal to ambush an adjacent square:</div>`;
                const dirs = [
                    { key: 'n', dx: 0, dz: -1, label: '⬆ N' },
                    { key: 's', dx: 0, dz: 1, label: '⬇ S' },
                    { key: 'e', dx: 1, dz: 0, label: '➡ E' },
                    { key: 'w', dx: -1, dz: 0, label: '⬅ W' }
                ];
                html += `<div style="display:flex; gap:2px; flex-wrap:wrap; margin:2px 0;">`;
                for (const d of dirs) {
                    html += `<button class="reveal-dir-btn" data-dx="${d.dx}" data-dz="${d.dz}" style="font-size:10px; padding:2px 6px;" title="Reveal and ambush the tile to the ${d.key.toUpperCase()}">${d.label}</button>`;
                }
                html += `</div>`;
            }
            // Cavalry charge hint/button when adjacent to an enemy.
            if (CHARGE_UNITS.includes(unit.type) && !unit.hasAttackedThisTurn && !unit.hasMovedThisTurn) {
                const chargeTargets = (gameState.chargeTargets || []).filter(u => u && u.owner !== PLAYER_FACTION);
                if (chargeTargets.length) {
                    html += `<div style="font-size:11px; color:#ffd35a; margin-top:4px;">🐎 Charge adjacent enemy:</div>`;
                    for (const tgt of chargeTargets) {
                        html += `<button class="charge-btn" data-target-id="${tgt.id}" style="font-size:10px; padding:2px 4px; margin:1px; display:block; width:90%;" title="Charge ${UNIT_TYPE[tgt.type].name} #${tgt.id} for +${2} attack (exhausts cavalry).">⚔️ Charge ${UNIT_TYPE[tgt.type].name} #${tgt.id}</button>`;
                    }
                }
            }
            if (unit.type === 'SETTLER') {
                html += `<button id="found-city-btn" style="font-size:11px; padding:2px 6px; margin-top:2px;" title="Found a new city on this tile (consumes the settler).">🏠 Found City Here</button><br>`;
            }
            if (unit.type === 'ENGINEER' || unit.type === 'SIEGE') {
                html += `<span style="font-size:11px; color:#7cf;">Click an adjacent river tile to build a bridge.</span><br>`;
            }
            if (unit.type === 'ENGINEER') {
                const constructing = gameState.construction && gameState.construction.get(unit.id);
                if (constructing) {
                    const label = constructing.type === 'SIEGE_ENGINE'
                        ? `Building ${UNIT_TYPE[constructing.engineType] ? UNIT_TYPE[constructing.engineType].name : 'Siege Engine'}`
                        : 'Building Siege Tower';
                    html += `<span style="font-size:11px; color:#ffd700;">🔨 ${label} — ready in ${constructing.turnsLeft} turn${constructing.turnsLeft === 1 ? '' : 's'}.</span><br>`;
                } else if (!unit.hasAttackedThisTurn) {
                    // Siege Tower button (if near an enemy city).
                    if (gameState.siegeTowerTarget) {
                        const tgt = gameState.siegeTowerTarget;
                        html += `<button id="build-tower-btn" style="font-size:11px; padding:2px 6px; margin-top:2px;" title="Build a Siege Tower here (3 turns) to assault the nearby enemy city.">🏯 Build Siege Tower (3t)</button><br>`;
                        html += `<span style="font-size:10px; color:#9ab;">Siege target: city at [${tgt.x}, ${tgt.z}]</span><br>`;
                    }
                    // Siege Engine build buttons (CATAPULT/TREBUCHET) — field
                    // construction, no workshop required. Gives factions without
                    // a Siege Workshop a path to long-range siege engines.
                    html += `<div style="font-size:11px; color:#9fd; margin-top:4px;">Build siege engine (field project):</div>`;
                    html += `<button class="build-siege-engine-btn" data-engine="CATAPULT" style="font-size:10px; padding:2px 4px; margin:1px; display:block; width:90%;" title="Build a Catapult (2 turns). Long-range AOE siege with fire.">💣 Build Catapult (2t)</button>`;
                    html += `<button class="build-siege-engine-btn" data-engine="TREBUCHET" style="font-size:10px; padding:2px 4px; margin:1px; display:block; width:90%;" title="Build a Trebuchet (2 turns). Strongest long-range AOE siege.">💣 Build Trebuchet (2t)</button>`;
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
                        html += `<button id="board-btn" data-transport-id="${tr.id}" style="font-size:11px; padding:2px 6px; margin-top:2px;" title="Board this transport to cross water.">🚢 Board Transport #${tr.id}</button><br>`;
                    }
                }
            }
            if (unit.type === 'TRANSPORT' && unit.cargo && unit.cargo.length) {
                const land = findAdjacentLand(gameState, unit);
                if (land) {
                    html += `<button id="disembark-btn" style="font-size:11px; padding:2px 6px; margin-top:2px;" title="Disembark one carried unit onto the adjacent land tile.">⚓ Disembark at [${land.x}, ${land.z}]</button><br>`;
                }
                html += `<span style="font-size:10px; color:#9ab;">Carrying ${unit.cargo.length}/${UNIT_TYPE.TRANSPORT.capacity || 2} units.</span><br>`;
            }
            if (unit.goal) {
                html += `🎯 Auto-moving to [${unit.goal.x}, ${unit.goal.z}] `;
                html += `<button id="cancel-goal-btn" style="font-size:10px; padding:1px 5px;">Cancel</button>`;
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
                    const opts = getBuildableBuildings(wtile, gameState.resources.player, gameState.buildings, influence, gameState.tiles)
                        .filter(b => b.canBuild && b.type !== 'HARBOR' && b.type !== 'SIEGE_WORKSHOP' &&
                            b.type !== 'MARKET' && b.type !== 'BARRACKS' && b.type !== 'WALLS');
                    if (opts.length) {
                        html += `<div style="font-size:11px; color:#9fd; margin-top:4px;">Build improvement here:</div>`;
                        for (const b of opts) {
                            html += `<button class="worker-build-btn" data-bldg="${b.type}" style="font-size:10px; padding:2px 4px; margin:1px; display:block; width:90%;">${b.name} (${formatCost(b.cost)})</button>`;
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
                html += `<button id="disband-btn" style="font-size:10px; padding:2px 6px; margin-top:4px; color:#f88;" title="Destroy this unit (refunds 25% of gold cost).">✖ Disband Unit</button><br>`;
            }
            // Join a lord's army: if a lord with command capacity is on the same
            // tile and this unit isn't already in that lord's army, show a button.
            if (unit.owner === PLAYER_FACTION && !unit.boarded) {
                const lordsHere = (gameState.lords || []).filter(l =>
                    l.owner === PLAYER_FACTION && l.x === unit.x && l.z === unit.z &&
                    canCommand(l) && !(l.army || []).includes(unit.id));
                for (const lord of lordsHere) {
                    html += `<button class="join-army-btn" data-lord-id="${lord.id}" style="font-size:10px; padding:2px 6px; margin-top:2px; color:#9cf;" title="Join ${lord.name}'s army (${lord.army.length}/${maxArmySize(lord)}).">⚔️ Join ${lord.name}'s Army</button><br>`;
                }
            }
            // Pillage: a military unit adjacent to an enemy tile with a terrain
            // improvement can destroy it for a gold reward (uses its action).
            if (unit.type !== 'SETTLER' && unit.type !== 'WORKER' && !unit.hasAttackedThisTurn) {
                const ptile = findAdjacentPillageable(gameState, unit);
                if (ptile) {
                    const bName = (BUILDING_TYPE[pillageableOn(ptile, gameState.buildings)[0]] || {}).name || 'improvement';
                    html += `<button id="pillage-btn" data-ptx="${ptile.x}" data-ptz="${ptile.z}" style="font-size:10px; padding:2px 6px; margin-top:2px; color:#fc6;" title="Pillage the enemy ${bName} at [${ptile.x}, ${ptile.z}] for gold.">🔥 Pillage ${bName} [${ptile.x},${ptile.z}]</button><br>`;
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
        const cls = LORD_CLASSES[lord.class] || { name: '?', icon: '👑', desc: '' };
        const abilities = lord.abilities.map(a => LORD_ABILITIES[a]?.name || a).join(', ') || 'None';
        const fc = fcOf(lord.owner);
        const army = (lord.army && lord.army.length) ? lord.army.length : 0;
        let html = `
            <strong>${cls.icon} ${lord.name} the ${cls.name}</strong> (Lv.${lord.level})${lord.isKing ? ' 👑 KING' : ''}<br>
            Owner: ${fc.name || lord.owner}<br>
            HP: ${lord.hp == null ? '?' : Math.max(0, lord.hp|0)}/${lord.maxHp == null ? '?' : lord.maxHp|0}
             | ATK ${lordAttack(lord)} | DEF ${lordDefense(lord) + kingGuardBonus(lord)}<br>
            XP: ${lord.xp}/${50 * lord.level}<br>
            CMD: ${lord.stats.command} | CMB: ${lord.stats.combat} | GOV: ${lord.stats.governance}<br>
            Class: ${cls.name} — ${cls.desc}<br>
            Army: ${army}/${maxArmySize(lord)} units${lord.isKing ? ` (King's Guard: +${kingGuardBonus(lord)} DEF from bodyguard)` : ''}<br>
            Abilities: ${abilities}<br>
            ${lord.hasAttackedThisTurn ? '' : '(Can attack) '}${lord.hasMovedThisTurn ? '(Moved)' : '(Can move)'}
        `;
        // Player lord auto-move goal status + cancel.
        if (lord.owner === PLAYER_FACTION) {
            if (lord.goal) {
                html += `🎯 Auto-moving to [${lord.goal.x}, ${lord.goal.z}] `;
                html += `<button id="lord-cancel-goal-btn" style="font-size:10px; padding:1px 5px;">Cancel</button><br>`;
            } else {
                html += `<span style="font-size:11px; color:#9ab;">Right-click a tile to set an auto-move goal.</span><br>`;
            }
        }
        // King active ability button (player only).
        if (lord.isKing && lord.owner === PLAYER_FACTION && lord.active) {
            const cd = (gameState.kingCooldowns && gameState.kingCooldowns[PLAYER_FACTION]) || 0;
            const ready = cd <= 0;
            html += `<button id="king-act-btn" style="margin-top:4px; padding:4px; width:100%;" ${ready ? '' : 'disabled'}>
                ${ready ? `⚡ ${lord.active.name}` : `${lord.active.name} (${cd}t)`}
            </button>`;
            html += `<div style="font-size:10px; color:#9ab;">${lord.active.desc}</div>`;
        }
        if (els.unitInfo) els.unitInfo.innerHTML = html;
        const kab = document.getElementById('king-act-btn');
        if (kab) kab.onclick = () => callbacks.onActivateKing && callbacks.onActivateKing(lord);
        const lcbtn = document.getElementById('lord-cancel-goal-btn');
        if (lcbtn) lcbtn.onclick = () => callbacks.onCancelGoal && callbacks.onCancelGoal(lord);
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
        if (u.canBuildImprovement) tags.push('builds terrain improvements');
        if (u.buildTurns && u.buildTurns > 1) tags.push(`${u.buildTurns}-turn build`);
        if (tags.length) txt += `. <span style="color:#ffd700;">${tags.join('; ')}.</span>`;
        // Faction flavor for this unit.
        if (def && def.unitMods && def.unitMods[type]) {
            const m = def.unitMods[type];
            const parts = [];
            if (m.attack) parts.push(`${m.attack > 0 ? '+' : ''}${m.attack} ATK`);
            if (m.defense) parts.push(`${m.defense > 0 ? '+' : ''}${m.defense} DEF`);
            if (m.hp) parts.push(`${m.hp > 0 ? '+' : ''}${m.hp} HP`);
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
        const buildable = getBuildableBuildings(tile, gameState.resources.player, gameState.buildings, influence, gameState.tiles);
        if (els.buildMenu) {
            els.buildMenu.innerHTML = '<h3>Build</h3>';
            // Hover description panel (updates as you hover building/unit buttons).
            const desc = document.createElement('div');
            desc.style.cssText = 'font-size:11px; color:#cde; background:#11141d; border:1px solid #334; padding:6px; border-radius:4px; min-height:30px; margin-bottom:6px; line-height:1.4;';
            desc.innerHTML = '<span style="color:#789;">Hover a building or unit to see its description.</span>';
            els.buildMenu.appendChild(desc);
            const setDesc = (html) => { desc.innerHTML = html || '<span style="color:#789;">Hover a building or unit to see its description.</span>'; };

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
                cityHeader.textContent = `City Lv.${cityLevel} (influence ${3 + (cityLevel - 1)}) • Fort ${tile.fortification||0}/${tile.fortMax||0}${hasBarracks ? ' • Barracks' : ''} • Unit cap ${used}/${cap} (+${unitCapForCity(cityLevel + 1) - unitCapForCity(cityLevel)} on level up)`;
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

            const div = document.createElement('div');
            div.style.cssText = 'margin: 4px 0; padding: 4px; border-left: 3px solid #888;';
            const stateColor = rel.state === 'war' ? '#ff4444' :
                               rel.state === 'peace' ? '#44ff44' :
                               rel.state === 'alliance' ? '#4488ff' : '#ffaa00';
            div.innerHTML = `
                <span style="color:${stateColor}; font-weight:bold;">${stateLabel(rel.state)}</span>
                — ${aName} vs ${bName}
                ${rel.tradeAmount > 0 ? `(Trade: ${rel.tradeAmount}g)` : ''}
                <span style="opacity:.6; font-size:10px;">[${relationshipLabel(rel.relationship)} ${rel.relationship|0}]</span>
            `;

            // Action buttons only on rows involving the player. The available
            // action set depends on the current state (see plan E5).
            if (involvesPlayer) {
                if (rel.state === 'war') {
                    div.appendChild(mkBtn(`Propose Peace`, 'proposePeace', target));
                } else if (rel.state === 'peace') {
                    div.appendChild(mkBtn(`Propose Trade`, 'proposeTrade', target));
                    div.appendChild(mkBtn(`Propose Alliance`, 'proposeAlliance', target));
                    div.appendChild(mkBtn(`Declare War`, 'declareWar', target));
                } else if (rel.state === 'trade_pact') {
                    div.appendChild(mkBtn(`Cancel Trade`, 'cancelTrade', target));
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
                const kind = o.type === 'peace' ? 'Peace' : o.type === 'trade_pact' ? 'Trade Pact' : 'Alliance';
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

        // Recruit lord button
        const recruitBtn = document.createElement('button');
        recruitBtn.textContent = 'Recruit Lord (150g, 50f)';
        recruitBtn.style.cssText = 'margin-top:5px; padding:4px; width:100%;';
        recruitBtn.onclick = () => {
            if (callbacks.onRecruitLord) callbacks.onRecruitLord();
        };
        els.lordPanel.appendChild(recruitBtn);
    }

    function addCombatLog(message) {
        if (!els.combatLog) return;
        const entry = document.createElement('div');
        entry.textContent = message;
        entry.style.cssText = 'padding: 2px 0; border-bottom: 1px solid #333; font-size: 12px;';
        els.combatLog.insertBefore(entry, els.combatLog.firstChild);
        // Keep only last 20 messages
        while (els.combatLog.children.length > 20) {
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

    function updateAll() {
        updateResourceBar();
        showDiplomacyPanel();
        showLordPanel();
    }

    return {
        updateResourceBar,
        showTileInfo,
        showUnitInfo,
        showLordInfo,
        showBuildMenu,
        showDiplomacyPanel,
        showLordPanel,
        addCombatLog,
        updateAll
    };
}