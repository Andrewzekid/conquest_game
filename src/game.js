/** Main game orchestrator: wires all systems together. */
import { GRID_SIZE, MAP_SIZES, setGridSize, TERRAIN, UNIT_TYPE, UNIT_COST, CAPTURE_COST, INITIAL_RESOURCES,
         DIPLOMACY_STATES, LORD_RECRUIT_COST, BRIDGE_COST, EXTRA_UNITS, BUILDING_TYPE,
         SIEGE_TOWER_COST, SIEGE_TOWER_BUILD_TURNS, SIEGE_TOWER_BUILD_RADIUS, NAVAL_UNITS,
         SIEGE_ENGINES, AOE_RADIUS, AOE_SPLASH_FRACTION, BURN_TURNS, BURN_DAMAGE_PER_TURN,
         PILLAGE_GOLD_REWARD,
         FACTIONS, PLAYER_FACTION, FACTION_COLORS, CITY_INFLUENCE_RADIUS } from './config.js';
import { generateMap, buildTileMap, getOwnedCities, getInfluencedTiles, cityRadius,
         captureCityTerritory, besiegeCity, foundCity, isPassable, expandCityTerritory } from './map.js';
import { createUnit, canAfford, spendCost, getReachableTiles, getAttackTargets, getMoveRange } from './unit.js';
import { resolveCombat, canCaptureTile } from './battle.js';
import { createTurnManager } from './turnmanager.js';
import { computeAIActions } from './ai.js';
import { GameRenderer } from './renderer.js';
import { bindUI } from './ui.js';
import { computeVisibility, updateExplored } from './fog.js';
import { createDiplomacyState, setRelation, getRelation, canAttack, aiDecideWar } from './diplomacy.js';
import { createLord, canRecruitLord, awardXP, assignGovernance, assignArmy,
         findCommandingLord, canCommand, removeUnitFromArmies, maxArmySize } from './lords.js';
import { constructBuilding, removeBuilding, pillageableOn } from './building.js';
import { collectResources, processUpkeep, getUnitCap, countCities, countTiles } from './economy.js';
import { getFactionDef, getUnitCostFor, getFactionVision } from './faction.js';
import { sfx, unlockAudio, isMuted, setMuted } from './sound.js';
import { saveGame, loadGame, loadSavedExists, clearSave } from './save.js';
import { showStartMenu, showPauseMenu, hidePauseMenu } from './menus.js';
import { nextStepToward, goalValid } from './path.js';

const DRAG_THRESHOLD = 6; // px; under this a press→release is a click

export class Game {
    /**
     * @param options - { playerFactionId, aiFactionIds, mapSize } OR { load:true }
     * @param hooks   - { onMuteChanged }
     */
    constructor(options = {}, hooks = {}) {
        this.hooks = hooks || {};
        unlockAudio();

        if (options && options.load) {
            const state = loadGame();
            if (!state) {
                // No save to load — fall back to a fresh medium game.
                options = { playerFactionId: 'crimson', aiFactionIds: null, mapSize: 'medium' };
            } else {
                this.loadFromState(state);
                this.start();
                return;
            }
        }

        // Resolve faction binding + map size.
        const playerFactionId = options.playerFactionId || 'crimson';
        const others = (options.aiFactionIds && options.aiFactionIds.length)
            ? options.aiFactionIds.slice(0, 3)
            : ['crimson', 'verdant', 'violet', 'azure', 'obsidian'].filter(id => id !== playerFactionId).slice(0, 3);
        this._buildFactionBindings(playerFactionId, others);
        const sizeKey = options.mapSize || 'medium';
        setGridSize(MAP_SIZES[sizeKey] || MAP_SIZES.medium);

        this.initState();
        this.initRenderer();
        this.initUI();
        this.initInput();
        this.start();
    }

    /** Bind slots player/ai1/ai2/ai3 to chosen faction defs; build colors + def map. */
    _buildFactionBindings(playerFactionId, aiFactionIds) {
        const slots = FACTIONS; // ['player','ai1','ai2','ai3']
        const ids = [playerFactionId, ...aiFactionIds];
        this.factionAssignments = {};
        this.factionDefs = {};
        this.factionColors = {};
        for (let i = 0; i < slots.length; i++) {
            const slot = slots[i];
            const id = ids[i];
            const def = getFactionDef(id) || getFactionDef('crimson');
            this.factionAssignments[slot] = def.id;
            this.factionDefs[slot] = def;
            this.factionColors[slot] = def.color;
        }
    }

    initState() {
        const mapData = generateMap();
        this.tiles = buildTileMap(mapData.tiles);
        this.factions = FACTIONS;

        this.gameState = {
            tiles: this.tiles,
            units: new Map(),
            lords: [],
            buildings: new Map(),
            tradeRoutes: [],
            resources: Object.fromEntries(FACTIONS.map(f => [f, { ...INITIAL_RESOURCES }])),
            diplomacy: createDiplomacyState(FACTIONS),
            turn: 1,
            selectedUnit: null,
            selectedTile: null,
            selectedLord: null,
            moveTargets: new Set(),
            attackTargets: [],
            visible: new Set(),
            explored: new Set(),
            // Enemy cities revealed by the player's Scry ability. Temporary:
            // shown brightly for the current turn, cleared at the next player
            // turn start. Never written into `explored` (no permanent intel).
            scryRevealed: new Set(),
            trainedThisTurn: new Set(),
            // Faction identity (runtime binding of slots → defs).
            factionAssignments: this.factionAssignments,
            factionDefs: this.factionDefs,
            factionColors: this.factionColors,
            // Multi-turn unit production: cityKey -> { unitType, turnsLeft, veteran, faction }.
            production: new Map(),
            // Engineer construction projects: engineerId -> { type, turnsLeft, x, z, faction }.
            // Currently used for Siege Towers built near enemy cities.
            construction: new Map(),
            // Bridge tile keys (rivers bridged by Siege/Engineer). Also mirrored on tile.bridge.
            bridges: new Set(),
            // King abilities.
            kingCooldowns: Object.fromEntries(FACTIONS.map(f => [f, 0])),
            tempBonuses: {},       // faction -> {attack,defense} for this turn
            graveyard: [],         // fallen units (for Obsidian Raise Dead)
            eliminated: new Set(),
            gameOver: false,
            winner: null,
            paused: false
        };

        // Create a starting unit + king lord for each faction at its start city.
        for (const slot of FACTIONS) {
            const def = this.factionDefs[slot];
            const start = this.tiles.get(mapData.startKeys[slot]);
            if (!start) continue;
            const unit = createUnit('INFANTRY', slot, start.x, start.z, { factionDef: def });
            this.gameState.units.set(unit.id, unit);
            const king = createLord(slot, start.x, start.z, def.king.name, def.king.class);
            king.isKing = true;
            king.active = def.king.active;
            this.gameState.lords.push(king);
            assignArmy(king, unit.id);
            unit.lordId = king.id;
        }

        // Everyone starts at war with everyone else (free-for-all conquest).
        for (let i = 0; i < FACTIONS.length; i++) {
            for (let j = i + 1; j < FACTIONS.length; j++) {
                setRelation(this.gameState.diplomacy, FACTIONS[i], FACTIONS[j], DIPLOMACY_STATES.WAR);
            }
        }

        // Stash placed Natural Wonders so start() can announce them (the UI
        // log isn't available yet during initState).
        this._mapWonders = mapData.wonders || [];

        this.updateFog();

        this.gameState.turnManager = createTurnManager(
            this.gameState,
            FACTIONS,
            (phase) => this.onPhaseChange(phase),
            (faction) => this.runAITurn(faction),
            () => this.renderAll()
        );
        this.gameState.turnManager.setRecalcFog(() => this.updateFog());
        this.gameState.turnManager.setAutosave(() => saveGame(this.gameState));
        this.gameState.turnManager.setLogger((m) => this.log(m));
    }

    /** Rebuild the game from a saved state object. */
    loadFromState(state) {
        this.factions = FACTIONS;
        this.gameState = state;
        this.tiles = state.tiles;
        this.gameState.moveTargets = new Set();
        this.gameState.attackTargets = [];
        this.gameState.bridgeTargets = [];
        if (!this.gameState.production) this.gameState.production = new Map();
        if (!this.gameState.construction) this.gameState.construction = new Map();
        if (!this.gameState.bridges) this.gameState.bridges = new Set();
        if (!this.gameState.scryRevealed) this.gameState.scryRevealed = new Set();
        this.gameState.selectedUnit = null;
        this.gameState.selectedLord = null;
        this.gameState.selectedTile = null;
        this.gameState.paused = false;
        if (!this.gameState.factionDefs) {
            // Rebuild defs/colors from saved assignments.
            this.factionDefs = {};
            this.factionColors = {};
            this.factionAssignments = state.factionAssignments || {};
            for (const slot of FACTIONS) {
                const def = getFactionDef(this.factionAssignments[slot]) || getFactionDef('crimson');
                this.factionDefs[slot] = def;
                this.factionColors[slot] = def.color;
            }
            this.gameState.factionDefs = this.factionDefs;
            this.gameState.factionColors = this.factionColors;
        } else {
            this.factionDefs = this.gameState.factionDefs;
            this.factionColors = this.gameState.factionColors;
            this.factionAssignments = this.gameState.factionAssignments;
        }
        // Restore king active references on lords (not serialized cleanly).
        for (const lord of this.gameState.lords) {
            if (lord.isKing) {
                const def = this.factionDefs[lord.owner];
                if (def) lord.active = def.king.active;
            }
        }
        if (!this.gameState.turnManager) {
            this.gameState.turnManager = createTurnManager(
                this.gameState, FACTIONS,
                (phase) => this.onPhaseChange(phase),
                (faction) => this.runAITurn(faction),
                () => this.renderAll()
            );
            this.gameState.turnManager.setRecalcFog(() => this.updateFog());
            this.gameState.turnManager.setAutosave(() => saveGame(this.gameState));
            this.gameState.turnManager.setLogger((m) => this.log(m));
        }
        this.updateFog();
        this.initRenderer();
        this.initUI();
        this.initInput();
        this.renderAll();
        this.ui.updateAll();
    }

    initRenderer() {
        this.renderer = new GameRenderer();
        const tilesArray = [...this.tiles.values()];
        this.renderer.createMapMesh(tilesArray);
        // Apply fog before the first animation frame so enemy capitals never
        // flash visible at game start.
        if (this.gameState) this.renderer.renderAll(this.gameState);
        this.renderer.animate();
    }

    initUI() {
        this.ui = bindUI(this.gameState, {
            onBuild: (buildingType, tile) => this.handleBuild(buildingType, tile),
            onTrain: (unitType, tile) => this.handleTrain(unitType, tile),
            onDiplomacy: (action, target) => this.handleDiplomacy(action, target),
            onRecruitLord: () => this.handleRecruitLord(),
            onLevelUpCity: (tile) => this.handleLevelUpCity(tile),
            onActivateKing: (lord) => this.handleActivateKing(lord),
            onCancelGoal: (unit) => this.handleCancelGoal(unit),
            onFoundCity: (unit) => this.handleFoundCity(unit),
            onBuildSiegeTower: (unit) => this.handleBuildSiegeTower(unit),
            onBoard: (unit, transport) => this.handleBoard(unit, transport),
            onDisembark: (transport) => this.handleDisembark(transport),
            onWorkerBuild: (unit, buildingType) => this.handleWorkerBuild(unit, buildingType),
            onDisband: (unit) => this.handleDisband(unit),
            onPillage: (unit, tile) => this.handlePillage(unit, tile),
            onEndTurn: () => this.endPlayerTurn()
        });
    }

    initInput() {
        this.mouse = { x: 0, y: 0 };
        const camera = this.renderer.camera;
        const dom = this.renderer.renderer.domElement;

        // --- Drag-to-pan state (left or right button) ---
        this._drag = { active: false, downX: 0, downY: 0, lastX: 0, lastY: 0, moved: false, button: 0 };

        const isUIEvent = (event) => event.target && event.target.closest &&
            event.target.closest('#ui-top, #ui-bottom, .side-panel, #combat-log, .overlay');

        window.addEventListener('mousemove', (event) => {
            if (this.gameState.paused) return;
            if (isUIEvent(event)) return;
            this.mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
            this.mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

            // Live drag panning.
            if (this._drag.active) {
                const dx = event.clientX - this._drag.lastX;
                const dy = event.clientY - this._drag.lastY;
                if (Math.abs(event.clientX - this._drag.downX) > DRAG_THRESHOLD ||
                    Math.abs(event.clientY - this._drag.downY) > DRAG_THRESHOLD) {
                    this._drag.moved = true;
                }
                if (this._drag.moved) this._panBy(dx, dy);
                this._drag.lastX = event.clientX;
                this._drag.lastY = event.clientY;
                return;
            }

            const hit = this._resolveHit();
            // The tile hover bar always tracks the cursor.
            this.ui.showTileInfo(hit.tile);
            // The unit/lord info panel is STICKY while a player unit or lord is
            // selected: hover no longer overwrites it, so its action buttons
            // (Found City, Build Siege Tower, Board, Cancel Goal, King ability…)
            // stay put and remain clickable as you move the mouse toward them.
            const hasSelection = this.gameState.selectedUnit || this.gameState.selectedLord;
            if (hasSelection) return;
            if (hit.lord) this.ui.showLordInfo(hit.lord);
            else if (hit.unit) this.ui.showUnitInfo(hit.unit);
            else { this.ui.showLordInfo(null); this.ui.showUnitInfo(null); }
        });

        dom.addEventListener('mousedown', (event) => {
            if (this.gameState.gameOver) return;
            if (isUIEvent(event)) return;
            unlockAudio();
            this._drag.active = true;
            this._drag.button = event.button;
            this._drag.downX = this._drag.lastX = event.clientX;
            this._drag.downY = this._drag.lastY = event.clientY;
            this._drag.moved = false;
        });

        window.addEventListener('mouseup', (event) => {
            if (!this._drag.active) return;
            const wasDrag = this._drag.moved;
            const btn = this._drag.button;
            this._drag.active = false;
            if (wasDrag) return;            // a drag, not a click
            if (this.gameState.paused) return;
            if (isUIEvent(event)) return;

            if (btn === 2) {
                this._handleRightClick();
                return;
            }
            if (btn !== 0) return;
            this._handleLeftClick();
        });

        // Right-click sets unit goals; suppress the browser context menu.
        dom.addEventListener('contextmenu', (e) => e.preventDefault());

        // --- WASD / arrow keys to pan the map (held-key, continuous) ---
        this._keys = new Set();
        const panKey = (e) => {
            const k = e.key.toLowerCase();
            return k === 'w' || k === 'a' || k === 's' || k === 'd' ||
                   k === 'arrowup' || k === 'arrowdown' || k === 'arrowleft' || k === 'arrowright';
        };
        const clearKeys = () => this._keys.clear();
        window.addEventListener('keydown', (e) => {
            // Don't hijack typing in inputs/selects.
            const t = e.target;
            if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
            if (!panKey(e)) return;
            if (e.key.startsWith('Arrow')) e.preventDefault();
            this._keys.add(e.key.toLowerCase());
        });
        window.addEventListener('keyup', (e) => { this._keys.delete(e.key.toLowerCase()); });
        // If the window loses focus or the game pauses while a key is held, the
        // keyup never fires — clear the set so the camera doesn't drift forever.
        window.addEventListener('blur', clearKeys);
        document.addEventListener('visibilitychange', () => { if (document.hidden) clearKeys(); });

        // Drive the pan every frame.
        const PAN_SPEED = 0.8; // world units per frame at base zoom
        const tick = () => {
            if (!this.gameState.paused && this._keys.size) {
                const cam = this.renderer.camera;
                const scale = (cam.right - cam.left) / 24; // faster when zoomed out
                let dx = 0, dz = 0;
                if (this._keys.has('w') || this._keys.has('arrowup')) dz -= PAN_SPEED * scale;
                if (this._keys.has('s') || this._keys.has('arrowdown')) dz += PAN_SPEED * scale;
                if (this._keys.has('a') || this._keys.has('arrowleft')) dx -= PAN_SPEED * scale;
                if (this._keys.has('d') || this._keys.has('arrowright')) dx += PAN_SPEED * scale;
                if (dx || dz) this._panBy(dx, dz);
            }
            requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
    }

    /** Resolve what's under the cursor, respecting fog of war:
     *  - tiles not yet explored return null (no intel on hidden terrain/cities);
     *  - enemy units/lords on tiles the player can't currently see return null. */
    _resolveHit() {
        const camera = this.renderer.camera;
        const intersects = this.renderer.getIntersects(this.mouse, camera);
        if (!intersects || intersects.length === 0) {
            return { intersects: [], tile: null, unit: null, lord: null, top: null };
        }
        const objs = intersects.map(i => i.object);
        const top = intersects[0].object;
        const explored = this.gameState.explored;
        const visible = this.gameState.visible;

        // Tile: only if explored, or currently visible (Scry-revealed).
        const tileMesh = objs.find(o => o.userData.x !== undefined);
        let tile = null;
        if (tileMesh) {
            const k = `${tileMesh.userData.x},${tileMesh.userData.z}`;
            if ((explored && explored.has(k)) || (visible && visible.has(k))) tile = this.tiles.get(k);
        }

        // Entity: own entities always shown; enemy only if currently visible.
        // Unit/lord models are Groups whose userData sits on the parent, while
        // the raycast hits the child part-meshes — climb the parent chain.
        const climb = (o, key) => {
            let cur = o;
            while (cur) { if (cur.userData && cur.userData[key] !== undefined) return cur; cur = cur.parent; }
            return null;
        };
        const unitMesh = objs.map(o => climb(o, 'unitId')).find(Boolean);
        const lordMesh = objs.map(o => climb(o, 'lordId')).find(Boolean);
        let unit = unitMesh ? this.gameState.units.get(unitMesh.userData.unitId) : null;
        let lord = lordMesh ? this.gameState.lords.find(l => l.id === lordMesh.userData.lordId) : null;
        if (unit && unit.owner !== PLAYER_FACTION && visible && !visible.has(`${unit.x},${unit.z}`)) unit = null;
        if (lord && lord.owner !== PLAYER_FACTION && visible && !visible.has(`${lord.x},${lord.z}`)) lord = null;

        return { intersects, tile, unit, lord, top };
    }

    /** Pan the camera + OrbitControls target by screen-space delta (in pixels).
     *  The camera is at a 45° angle, so screen axes are diagonal to world X/Z.
     *  Screen-right  = world (+X, −Z); screen-down = world (+X, +Z) (both /√2).
     *  Content moves OPPOSITE to the drag (drag bottom-left → map goes top-right). */
    _panBy(dx, dy) {
        const cam = this.renderer.camera;
        const worldPerPixel = (cam.right - cam.left) / window.innerWidth;
        const k = worldPerPixel * 0.7071; // 1/√2 — screen axis → world XZ
        // Camera world delta = k*dx*(+X,−Z) + k*dy*(+X,+Z)
        const wx = k * (dx + dy);
        const wz = k * (dy - dx);
        cam.position.x += wx;
        cam.position.z += wz;
        const ctrl = this.renderer.controls;
        ctrl.target.x += wx;
        ctrl.target.z += wz;
        ctrl.update();
    }

    _handleLeftClick() {
        if (this.gameState.turnManager.phase !== PLAYER_FACTION) return;
        const { tile, unit: clickedUnit, lord: clickedLord, top } = this._resolveHit();
        if (!tile && !clickedUnit && !clickedLord) { this.deselect(); return; }

        const sel = this.gameState.selectedUnit;

        // 0) Lord/King move: a selected, still-movable player lord clicks a reachable tile.
        const selLord = this.gameState.selectedLord;
        if (selLord && selLord.owner === PLAYER_FACTION && !selLord.hasMovedThisTurn && tile) {
            if (this.gameState.moveTargets.has(`${tile.x},${tile.z}`)) {
                this.moveLord(selLord, tile.x, tile.z);
                return;
            }
        }

        // 0b) Bridge: a selected player Engineer/Siege clicks an adjacent river tile.
        if (sel && sel.owner === PLAYER_FACTION && tile && tile.terrain === 'RIVER' && !tile.bridge &&
            !sel.hasAttackedThisTurn && (UNIT_TYPE[sel.type].canBuildBridge || sel.type === 'SIEGE')) {
            const dist = Math.abs(sel.x - tile.x) + Math.abs(sel.z - tile.z);
            if (dist === 1) { this.handleBuildBridge(sel, tile); return; }
        }

        // 1) Besiege: a selected player SIEGE/ARTILLERY clicks an adjacent fortified enemy city.
        if (sel && sel.owner === PLAYER_FACTION && tile && tile.terrain === 'CITY' &&
            tile.owner !== PLAYER_FACTION && (tile.fortification || 0) > 0 &&
            UNIT_TYPE[sel.type].besiege && !sel.hasAttackedThisTurn) {
            const dist = Math.abs(sel.x - tile.x) + Math.abs(sel.z - tile.z);
            if (dist <= 1) { this.handleBesiege(sel, tile); return; }
        }

        // 2) Attack: a selected player unit clicks an enemy unit in attack range.
        if (sel && sel.owner === PLAYER_FACTION && clickedUnit && clickedUnit.owner !== PLAYER_FACTION) {
            const inRange = this.gameState.attackTargets.some(u => u.id === clickedUnit.id);
            if (inRange && !sel.hasAttackedThisTurn) { this.handleAttack(sel, clickedUnit); return; }
        }

        // 3) Move: a selected, still-movable player unit clicks a reachable tile.
        if (sel && sel.owner === PLAYER_FACTION && !sel.hasMovedThisTurn && tile) {
            if (this.gameState.moveTargets.has(`${tile.x},${tile.z}`)) {
                this.moveUnit(sel, tile.x, tile.z); return;
            }
        }

        // 4) Select a player unit / lord.
        let topIsLord = false;
        if (top) { let c = top; while (c) { if (c.userData && c.userData.lordId !== undefined) { topIsLord = true; break; } c = c.parent; } }
        if (topIsLord && clickedLord && clickedLord.owner === PLAYER_FACTION) {
            this.selectLord(clickedLord);
        } else if (clickedUnit && clickedUnit.owner === PLAYER_FACTION) {
            this.selectUnit(clickedUnit);
        } else if (clickedLord && clickedLord.owner === PLAYER_FACTION) {
            this.selectLord(clickedLord);
        } else if (sel) {
            this.deselect();
        }

        // 5) Build menu on owned tiles.
        if (tile && tile.owner === PLAYER_FACTION) {
            this.gameState.selectedTile = tile;
            this.ui.showBuildMenu(tile);
            this.renderer.showInfluence(this.tiles, PLAYER_FACTION, CITY_INFLUENCE_RADIUS);
        } else {
            this.gameState.selectedTile = null;
            this.ui.showBuildMenu(null);
            this.renderer.clearInfluence();
        }
    }

    /** Right-click: set an auto-move goal for the selected player unit OR lord
     *  onto the hovered tile, or clear the goal if the selection is right-clicked. */
    _handleRightClick() {
        const sel = this.gameState.selectedUnit;
        const selLord = this.gameState.selectedLord;
        const target = sel || selLord;
        if (!target || target.owner !== PLAYER_FACTION) return;
        const { tile } = this._resolveHit();
        if (!tile) return; // ignore unexplored tiles — no goal intel on hidden terrain
        // Right-click the selection's own tile → cancel its goal.
        if (target.x === tile.x && target.z === tile.z) {
            this.handleCancelGoal(target);
            return;
        }
        // Don't allow goals onto fortified enemy cities (can't move there).
        if (tile.terrain === 'CITY' && tile.owner !== PLAYER_FACTION && (tile.fortification || 0) > 0) {
            this.log('Cannot set a goal on a fortified enemy city — besiege it first.');
            return;
        }
        target.goal = { x: tile.x, z: tile.z };
        sfx.click();
        const label = sel ? `${UNIT_TYPE[sel.type].name} #${sel.id}` : `Lord ${selLord.name}`;
        this.log(`🎯 ${label} auto-moving to [${tile.x}, ${tile.z}].`);
        if (sel) this.ui.showUnitInfo(sel); else this.ui.showLordInfo(selLord);
        this.renderAll();
    }

    deselect() {
        this.gameState.selectedUnit = null;
        this.gameState.selectedLord = null;
        this.gameState.moveTargets.clear();
        this.gameState.attackTargets = [];
        this.gameState.bridgeTargets = [];
        this.gameState.siegeTowerTarget = null;
        this.gameState.selectedTile = null;
        this.renderer.clearHighlights();
        this.renderer.clearInfluence();
        this.ui.showUnitInfo(null);
        this.ui.showBuildMenu(null);
    }

    selectUnit(unit) {
        this.gameState.selectedUnit = unit;
        this.gameState.selectedLord = null;
        this.renderer.clearHighlights();

        if (!unit.hasMovedThisTurn) {
            const reach = getReachableTiles(unit, this.tiles);
            for (const other of this.gameState.units.values()) {
                if (other.id === unit.id) continue;
                if (other.owner !== unit.owner) reach.delete(`${other.x},${other.z}`);
            }
            // Exclude fortified enemy cities from move targets — UNLESS a
            // friendly Siege Tower is orthogonally adjacent (canAssault), which
            // lets units storm the walls directly.
            for (const key of [...reach]) {
                const t = this.tiles.get(key);
                if (t && t.terrain === 'CITY' && t.owner !== unit.owner && (t.fortification || 0) > 0) {
                    if (!this.siegeTowerAdjacentTo(t, unit.owner)) reach.delete(key);
                }
            }
            this.gameState.moveTargets = reach;
        } else {
            this.gameState.moveTargets.clear();
        }

        if (!unit.hasAttackedThisTurn) {
            // Only factions we're at war with may be attacked — peace, trade
            // pact, and alliance units are never valid attack targets.
            const warTargets = getAttackTargets(unit, this.gameState.units)
                .filter(t => canAttack(this.gameState.diplomacy, unit.owner, t.owner));
            this.gameState.attackTargets = warTargets;
        } else {
            this.gameState.attackTargets = [];
        }

        // Bridge targets: an Engineer or Siege unit can bridge an adjacent
        // unbridged river. Highlight them so the player knows where to click.
        this.gameState.bridgeTargets = [];
        const udef = UNIT_TYPE[unit.type];
        if (unit.owner === PLAYER_FACTION && !unit.hasAttackedThisTurn &&
            (udef.canBuildBridge || unit.type === 'SIEGE')) {
            for (let dx = -1; dx <= 1; dx++) {
                for (let dz = -1; dz <= 1; dz++) {
                    if (Math.abs(dx) + Math.abs(dz) !== 1) continue; // orthogonal neighbors
                    const t = this.tiles.get(`${unit.x + dx},${unit.z + dz}`);
                    if (t && t.terrain === 'RIVER' && !t.bridge) {
                        this.gameState.bridgeTargets.push(t);
                    }
                }
            }
        }

        // Siege Tower construction: an Engineer within range of an enemy city
        // can start building one (the UI surfaces a button when this is set).
        this.gameState.siegeTowerTarget = null;
        if (unit.owner === PLAYER_FACTION && udef.canBuildSiegeTower && !unit.hasAttackedThisTurn &&
            !(this.gameState.construction && this.gameState.construction.has(unit.id))) {
            const tgt = this._siegeTargetNear(unit, SIEGE_TOWER_BUILD_RADIUS);
            if (tgt) this.gameState.siegeTowerTarget = tgt;
        }

        this.ui.showUnitInfo(unit);
        this.renderer.highlightMoveTargets(this.gameState.moveTargets);
        this.renderer.highlightAttackTargets(this.gameState.attackTargets);
        this.renderer.highlightBridgeTargets(this.gameState.bridgeTargets || []);
    }

    selectLord(lord) {
        this.gameState.selectedLord = lord;
        this.gameState.selectedUnit = null;
        this.renderer.clearHighlights();

        // Lords (including the king) move 2 tiles per turn, like Infantry.
        if (!lord.hasMovedThisTurn && lord.owner === PLAYER_FACTION) {
            const range = 2;
            const reach = new Set();
            for (let dx = -range; dx <= range; dx++) {
                for (let dz = -range; dz <= range; dz++) {
                    if (dx === 0 && dz === 0) continue;
                    if (Math.abs(dx) + Math.abs(dz) > range) continue;
                    const k = `${lord.x + dx},${lord.z + dz}`;
                    if (this.tiles.has(k)) reach.add(k);
                }
            }
            // Lords move to empty tiles only — not onto any unit (so clicking your
            // own unit selects it instead of stacking), and not onto fortified
            // enemy cities.
            for (const other of this.gameState.units.values()) {
                reach.delete(`${other.x},${other.z}`);
            }
            for (const key of [...reach]) {
                const t = this.tiles.get(key);
                if (t && t.terrain === 'CITY' && t.owner !== lord.owner && (t.fortification || 0) > 0) {
                    reach.delete(key);
                }
            }
            this.gameState.moveTargets = reach;
        } else {
            this.gameState.moveTargets.clear();
        }
        this.gameState.attackTargets = [];

        this.ui.showLordInfo(lord);
        this.renderer.highlightMoveTargets(this.gameState.moveTargets);
        this.log(`Selected lord: ${lord.name} (Lv.${lord.level})${lord.isKing ? ' 👑' : ''}`);
    }

    moveLord(lord, x, z) {
        lord.x = x;
        lord.z = z;
        lord.hasMovedThisTurn = true;

        const destTile = this.tiles.get(`${x},${z}`);
        const pool = this.gameState.resources[lord.owner];
        if (destTile && destTile.terrain === 'CITY' && destTile.owner !== lord.owner &&
            (canCaptureTile(lord.owner, destTile, pool) || this.siegeTowerAdjacentTo(destTile, lord.owner))) {
            pool.gold -= CAPTURE_COST;
            captureCityTerritory(this.tiles, destTile, lord.owner).forEach(m => this.log(m));
            sfx.capture();
        }
        sfx.move();

        this.gameState.selectedLord = null;
        this.gameState.moveTargets.clear();
        this.renderer.clearHighlights();
        this.updateFog();
        this.renderAll();
        this.ui.updateResourceBar();
        this.checkVictory();
    }

    moveUnit(unit, x, z) {
        unit.x = x;
        unit.z = z;
        unit.hasMovedThisTurn = true;

        const destTile = this.tiles.get(`${x},${z}`);
        const pool = this.gameState.resources[unit.owner];
        // Civ6 territory: units capture CITIES only. A city is captured if it's
        // breached (fortification 0) OR stormed via an adjacent friendly Siege
        // Tower (canAssault bypasses the fortification gate).
        if (destTile && destTile.terrain === 'CITY' && destTile.owner !== unit.owner &&
            (canCaptureTile(unit.owner, destTile, pool) || this.siegeTowerAdjacentTo(destTile, unit.owner))) {
            pool.gold -= CAPTURE_COST;
            captureCityTerritory(this.tiles, destTile, unit.owner).forEach(m => this.log(m));
            sfx.capture();
        }
        // Arrived at goal → clear it.
        if (unit.goal && unit.goal.x === x && unit.goal.z === z) unit.goal = null;

        this.gameState.selectedUnit = null;
        this.gameState.moveTargets.clear();
        this.gameState.attackTargets = [];
        this.renderer.clearHighlights();
        this.updateFog();
        this.renderAll();
        this.ui.updateResourceBar();
        this.checkVictory();
    }

    handleAttack(attacker, defender) {
        if (attacker.hasAttackedThisTurn) return;
        if (!canAttack(this.gameState.diplomacy, attacker.owner, defender.owner)) {
            this.log(`Cannot attack: not at war with ${defender.owner}!`);
            return;
        }
        const defenderTile = this.tiles.get(`${defender.x},${defender.z}`);
        const terrain = defenderTile ? defenderTile.terrain : 'PLAINS';
        const attackerLord = findCommandingLord(this.gameState.lords, attacker);
        const defenderLord = findCommandingLord(this.gameState.lords, defender);

        const result = resolveCombat(attacker, defender, terrain, attackerLord, defenderLord,
            this.gameState.buildings, this.gameState.lords, this.gameState.tempBonuses);
        result.messages.forEach(m => this.log(m));
        sfx.attack();

        attacker.hasAttackedThisTurn = true;

        if (result.defenderDied) {
            this._onUnitDeath(defender);
            this.log(`${UNIT_TYPE[defender.type].name} destroyed!`);
            // Obsidian respawn-on-kill passive.
            this._maybeRespawnOnKill(attacker.owner);
        }
        if (result.attackerDied) {
            this._onUnitDeath(attacker);
            this.log(`${UNIT_TYPE[attacker.type].name} destroyed!`);
            this.gameState.selectedUnit = null;
        }

        // Long-range siege engines (CATAPULT, TREBUCHET): AOE splash damage to
        // enemy units adjacent to the target, and a burn DoT on survivors.
        if (UNIT_TYPE[attacker.type].aoe) {
            this._applyAoeAndFire(attacker, defender, result.damageToDefender || 0);
        }
        this.gameState.moveTargets.clear();
        this.gameState.attackTargets = [];
        this.renderer.clearHighlights();
        this.renderAll();
        this.ui.updateResourceBar();
        this.checkVictory();
    }

    /** Record a fallen unit in the graveyard for Raise Dead. */
    _onUnitDeath(unit) {
        this.gameState.units.delete(unit.id);
        removeUnitFromArmies(this.gameState.lords, unit.id);
        this.gameState.graveyard.push({
            type: unit.type, owner: unit.owner, x: unit.x, z: unit.z, level: unit.level
        });
    }

    /**
     * AOE splash + fire ailment for siege engines (CATAPULT, TREBUCHET).
     * Finds enemy units within Chebyshev AOE_RADIUS of the primary target's tile
     * (excluding the primary, which already took full damage) and applies splash
     * = floor(primaryDamage * AOE_SPLASH_FRACTION), min 1. If the attacker can
     * set fire, primary survivors and splash victims are set burning (burn DoT).
     */
    _applyAoeAndFire(attacker, primary, primaryDamage) {
        const atkDef = UNIT_TYPE[attacker.type];
        if (!atkDef.aoe) return;
        const splash = Math.max(1, Math.floor((primaryDamage || 0) * AOE_SPLASH_FRACTION));
        const splashVictims = [];
        for (const u of this.gameState.units.values()) {
            if (u.id === primary.id) continue;
            if (u.owner === attacker.owner) continue;
            if (u.boarded) continue;
            if (!canAttack(this.gameState.diplomacy, attacker.owner, u.owner)) continue;
            if (Math.max(Math.abs(u.x - primary.x), Math.abs(u.z - primary.z)) <= AOE_RADIUS) {
                splashVictims.push(u);
            }
        }
        if (splashVictims.length) {
            this.log(`${UNIT_TYPE[attacker.type].name} splash hits ${splashVictims.length} nearby unit(s) for ${splash}!`);
            for (const u of splashVictims) {
                u.hp -= splash;
                if (u.hp <= 0) {
                    this._onUnitDeath(u);
                    this.log(`${UNIT_TYPE[u.type].name} destroyed by splash!`);
                }
            }
        }
        // Fire ailment: burn the primary target (if it survived) and the splash
        // survivors. Burn ticks once per round in onPhaseChange(PLAYER_FACTION).
        if (atkDef.canSetFire) {
            const ignite = (u) => {
                if (!u || u.hp <= 0) return;
                if (!u.burn || u.burn < BURN_TURNS) u.burn = BURN_TURNS;
            };
            if (primary.hp > 0) ignite(primary);
            for (const u of splashVictims) if (u.hp > 0) ignite(u);
            if (primary.hp > 0 || splashVictims.some(u => u.hp > 0)) {
                this.log(`🔥 The area is set ablaze! Burning units take ${BURN_DAMAGE_PER_TURN} dmg/turn for ${BURN_TURNS} turns.`);
                sfx.attack();
            }
        }
    }

    /** Obsidian Pact passive: chance to revive a fallen unit when destroying an enemy. */
    _maybeRespawnOnKill(owner) {
        const def = this.factionDefs[owner];
        if (!def || !def.passive || !def.passive.respawnOnKill) return;
        if (Math.random() > (def.passive.respawnChance || 0)) return;
        const fallen = this.gameState.graveyard
            .filter(g => g.owner === owner)
            .sort((a, b) => 0); // any fallen unit
        if (fallen.length === 0) return;
        const g = fallen[0];
        const capital = getOwnedCities(this.tiles, owner)[0] || this.tiles.get(`${g.x},${g.z}`);
        if (!capital) return;
        const unit = createUnit(g.type, owner, capital.x, capital.z, { factionDef: def });
        if (g.level > 1) { unit.level = g.level; }
        this.gameState.units.set(unit.id, unit);
        this.gameState.graveyard = this.gameState.graveyard.filter(x => x !== g);
        const name = this.factionColors[owner].name || owner;
        this.log(`${name} resurrected a ${UNIT_TYPE[g.type].name} at the capital!`);
    }

    /** Player SIEGE/ARTILLERY besieges an adjacent enemy city (an action, no move). */
    handleBesiege(unit, cityTile) {
        const msgs = besiegeCity(unit, cityTile);
        msgs.forEach(m => this.log(m));
        if (msgs.length) sfx.besiege();
        unit.hasAttackedThisTurn = true; // besieging uses the unit's action
        this.gameState.moveTargets.clear();
        this.gameState.attackTargets = [];
        this.gameState.bridgeTargets = [];
        this.renderer.clearHighlights();
        this.renderAll();
        this.ui.updateResourceBar();
    }

    /** A Settler founds a new city on its current tile (consumes the settler). */
    handleFoundCity(unit) {
        if (!unit || unit.type !== 'SETTLER' || unit.owner !== PLAYER_FACTION) return;
        const tile = this.tiles.get(`${unit.x},${unit.z}`);
        if (!tile) return;
        const before = tile.terrain;
        const msgs = foundCity(this.tiles, tile, PLAYER_FACTION);
        // foundCity returns a single error message and leaves the tile unchanged
        // when the location is invalid (already a city, water, mountain, river…).
        if (tile.terrain === before && tile.terrain !== 'CITY') {
            if (msgs.length) this.log(msgs[0]);
            return;
        }
        msgs.forEach(m => this.log(m));
        sfx.capture();
        // Consume the settler.
        this.gameState.units.delete(unit.id);
        removeUnitFromArmies(this.gameState.lords, unit.id);
        this.gameState.selectedUnit = null;
        this.gameState.moveTargets.clear();
        this.gameState.attackTargets = [];
        this.gameState.bridgeTargets = [];
        this.renderer.clearHighlights();
        this.updateFog();
        this.renderAll();
        this.ui.updateResourceBar();
        this.ui.showUnitInfo(null);
        this.checkVictory();
    }

    /** An Engineer or Siege unit builds a bridge onto an adjacent unbridged river. */
    handleBuildBridge(unit, riverTile) {
        const udef = UNIT_TYPE[unit.type];
        if (!udef.canBuildBridge && unit.type !== 'SIEGE') return;
        if (unit.hasAttackedThisTurn) { this.log('This unit has already acted this turn.'); return; }
        if (!riverTile || riverTile.terrain !== 'RIVER' || riverTile.bridge) {
            this.log('Can only bridge an unbridged river tile.');
            return;
        }
        const dist = Math.abs(unit.x - riverTile.x) + Math.abs(unit.z - riverTile.z);
        if (dist !== 1) { this.log('Must be adjacent to the river tile.'); return; }
        const pool = this.gameState.resources[unit.owner];
        for (const [res, amt] of Object.entries(BRIDGE_COST)) {
            if ((pool[res] || 0) < amt) { this.log('Not enough resources to build a bridge.'); return; }
        }
        for (const [res, amt] of Object.entries(BRIDGE_COST)) pool[res] = (pool[res] || 0) - amt;
        riverTile.bridge = true;
        if (this.gameState.bridges) this.gameState.bridges.add(`${riverTile.x},${riverTile.z}`);
        unit.hasAttackedThisTurn = true; // bridge-building uses the unit's action
        sfx.besiege();
        this.log(`${udef.name} built a bridge at [${riverTile.x}, ${riverTile.z}]!`);
        this.gameState.moveTargets.clear();
        this.gameState.attackTargets = [];
        this.gameState.bridgeTargets = [];
        this.renderer.clearHighlights();
        this.renderAll();
        this.ui.updateResourceBar();
    }

    /** True if a friendly Siege Tower is orthogonally adjacent to `cityTile`,
     *  enabling a direct assault on a fortified enemy city. */
    siegeTowerAdjacentTo(cityTile, owner) {
        for (const u of this.gameState.units.values()) {
            if (u.owner !== owner || u.type !== 'SIEGE_TOWER') continue;
            if (Math.abs(u.x - cityTile.x) + Math.abs(u.z - cityTile.z) === 1) return true;
        }
        return false;
    }

    /** Find an enemy (at-war) city within Chebyshev `radius` of `tile` for an
     *  Engineer to build a Siege Tower against. Returns the city tile or null. */
    _siegeTargetNear(engineer, radius) {
        let best = null, bestDist = Infinity;
        for (const t of this.tiles.values()) {
            if (t.terrain !== 'CITY' || !t.owner || t.owner === engineer.owner) continue;
            if (!canAttack(this.gameState.diplomacy, engineer.owner, t.owner)) continue;
            const d = Math.max(Math.abs(t.x - engineer.x), Math.abs(t.z - engineer.z));
            if (d <= radius && d < bestDist) { bestDist = d; best = t; }
        }
        return best;
    }

    /** An Engineer starts constructing a Siege Tower near an enemy city.
     *  Pays SIEGE_TOWER_COST up front; the tower spawns after BUILD_TURNS. */
    handleBuildSiegeTower(engineer) {
        if (!engineer || engineer.type !== 'ENGINEER' || engineer.owner !== PLAYER_FACTION) return;
        if (engineer.hasAttackedThisTurn) { this.log('This engineer has already acted this turn.'); return; }
        if (this.gameState.construction && this.gameState.construction.has(engineer.id)) {
            this.log('This engineer is already building a siege tower.'); return;
        }
        const target = this._siegeTargetNear(engineer, SIEGE_TOWER_BUILD_RADIUS);
        if (!target) { this.log('No enemy city nearby to build a siege tower against.'); return; }
        const pool = this.gameState.resources.player;
        for (const [res, amt] of Object.entries(SIEGE_TOWER_COST)) {
            if ((pool[res] || 0) < amt) { this.log('Not enough resources to build a siege tower.'); return; }
        }
        for (const [res, amt] of Object.entries(SIEGE_TOWER_COST)) pool[res] = (pool[res] || 0) - amt;
        this.gameState.construction.set(engineer.id, {
            type: 'SIEGE_TOWER', turnsLeft: SIEGE_TOWER_BUILD_TURNS,
            x: engineer.x, z: engineer.z, faction: PLAYER_FACTION
        });
        engineer.hasAttackedThisTurn = true; // starting construction uses the action
        sfx.besiege();
        this.log(`🔨 Engineer #${engineer.id} started a Siege Tower near [${target.x}, ${target.z}] — ready in ${SIEGE_TOWER_BUILD_TURNS} turns.`);
        this.ui.showUnitInfo(engineer);
        this.renderAll();
        this.ui.updateResourceBar();
    }

    /** A land unit boards an orthogonally-adjacent friendly Transport with free
     *  cargo. The unit is stowed (boarded flag) and stops rendering until
     *  disembarked. Boarding uses the unit's move for the turn. */
    handleBoard(unit, transport) {
        if (!unit || !transport) return;
        if (unit.owner !== PLAYER_FACTION || transport.owner !== PLAYER_FACTION) return;
        const ndef = UNIT_TYPE[unit.type], tdef = UNIT_TYPE[transport.type];
        if (!ndef || ndef.naval) { this.log('Only land units can board a transport.'); return; }
        if (!tdef || !tdef.naval || transport.type !== 'TRANSPORT') { this.log('Only transports can be boarded.'); return; }
        if (unit.boarded) { this.log('This unit is already aboard a transport.'); return; }
        const cap = tdef.capacity || 2;
        if ((transport.cargo && transport.cargo.length) || 0 >= cap) { this.log('That transport is full.'); return; }
        const adj = Math.abs(unit.x - transport.x) + Math.abs(unit.z - transport.z);
        if (adj !== 1) { this.log('Move next to the transport to board it.'); return; }
        if (!transport.cargo) transport.cargo = [];
        transport.cargo.push(unit.id);
        unit.boarded = transport.id;
        // Stow the unit at the transport's location so it travels with it.
        unit.x = transport.x; unit.z = transport.z;
        unit.hasMovedThisTurn = true;
        if (unit.hasAttackedThisTurn === false) unit.hasAttackedThisTurn = true;
        this.log(`🚢 Unit #${unit.id} (${unit.type}) boarded Transport #${transport.id}.`);
        sfx.click();
        this.gameState.selectedUnit = null;
        this.gameState.moveTargets.clear();
        this.ui.showUnitInfo(transport);
        this.renderAll();
    }

    /** A Transport with cargo disembarks one carried unit onto an orthogonally
     *  adjacent passable land tile. Disembarking uses the transport's move. */
    handleDisembark(transport) {
        if (!transport || transport.owner !== PLAYER_FACTION || transport.type !== 'TRANSPORT') return;
        if (!transport.cargo || transport.cargo.length === 0) { this.log('This transport is empty.'); return; }
        // Find the adjacent land tile (reusing the same logic as the UI helper).
        let dest = null;
        for (let dx = -1; dx <= 1 && !dest; dx++) {
            for (let dz = -1; dz <= 1 && !dest; dz++) {
                if (dx === 0 && dz === 0) continue;
                if (dx !== 0 && dz !== 0) continue;
                const k = `${transport.x + dx},${transport.z + dz}`;
                const t = this.tiles.get(k);
                if (!t || !isPassable(t)) continue;
                let blocked = false;
                for (const u of this.gameState.units.values()) {
                    if (!u.boarded && u.owner !== transport.owner && u.x === t.x && u.z === t.z) { blocked = true; break; }
                }
                if (blocked) continue;
                dest = t;
            }
        }
        if (!dest) { this.log('No adjacent land tile to disembark onto.'); return; }
        const unitId = transport.cargo.shift();
        const unit = this.gameState.units.get(unitId);
        if (!unit) return;
        unit.boarded = false;
        unit.x = dest.x; unit.z = dest.z;
        unit.hasMovedThisTurn = true;
        unit.hasAttackedThisTurn = true;
        this.log(`⚓ Unit #${unit.id} (${unit.type}) disembarked at [${dest.x}, ${dest.z}].`);
        sfx.click();
        this.ui.showUnitInfo(transport);
        this.renderAll();
    }

    /** Tick engineer construction (Siege Towers) for the player at turn start. */
    _tickConstruction() { this._tickConstructionFor(PLAYER_FACTION); }

    /** Fire ailment: burning units (set by CATAPULT/TREBUCHET) take
     *  BURN_DAMAGE_PER_TURN each round, then their counter decrements. Deaths
     *  go through _onUnitDeath so graveyard/cleanup is consistent. Ticked once
     *  per round at the start of the player's turn. */
    _tickBurn() {
        const burning = [];
        for (const u of this.gameState.units.values()) {
            if (u.burn && u.burn > 0) burning.push(u);
        }
        if (burning.length === 0) return;
        for (const u of burning) {
            u.hp -= BURN_DAMAGE_PER_TURN;
            const name = UNIT_TYPE[u.type] ? UNIT_TYPE[u.type].name : u.type;
            this.log(`🔥 ${name} burns for ${BURN_DAMAGE_PER_TURN} (HP ${Math.max(0, u.hp)}/${u.maxHp}).`);
            if (u.hp <= 0) {
                this._onUnitDeath(u);
                this.log(`${name} burned to death!`);
            }
            u.burn -= 1;
        }
        this.ui.updateResourceBar();
    }

    /** Tick one faction's in-progress Siege Tower builds: decrement the
     *  counter and spawn the tower when it finishes. Used for both the player
     *  (at player turn start) and each AI (at the start of its turn). */
    _tickConstructionFor(faction) {
        if (!this.gameState.construction || this.gameState.construction.size === 0) return;
        const def = this.factionDefs[faction];
        const factionName = this.factionColors[faction] ? this.factionColors[faction].name : faction;
        for (const [engId, proj] of [...this.gameState.construction]) {
            if (proj.faction !== faction) continue;
            proj.turnsLeft--;
            if (proj.turnsLeft <= 0) {
                const tile = this.tiles.get(`${proj.x},${proj.z}`);
                if (tile) {
                    const unit = createUnit('SIEGE_TOWER', faction, proj.x, proj.z, { factionDef: def });
                    this.gameState.units.set(unit.id, unit);
                    const lordHere = this.gameState.lords.find(l =>
                        l.owner === faction && l.x === proj.x && l.z === proj.z && canCommand(l));
                    if (lordHere) { assignArmy(lordHere, unit.id); unit.lordId = lordHere.id; }
                    this.log(`${factionName}: Siege Tower completed at [${proj.x}, ${proj.z}]! Adjacent units can now assault fortified cities.`);
                    sfx.levelUp();
                }
                this.gameState.construction.delete(engId);
            } else if (faction === PLAYER_FACTION) {
                this.log(`Siege Tower at [${proj.x}, ${proj.z}]: ${proj.turnsLeft} turn(s) left.`);
            }
        }
    }

    /** Tick multi-turn production for the player (once per player-turn start). */
    _tickProduction() {
        if (!this.gameState.production || this.gameState.production.size === 0) return;
        const def = this.factionDefs[PLAYER_FACTION];
        for (const [cityKey, prod] of [...this.gameState.production]) {
            if (prod.faction !== PLAYER_FACTION) continue;
            prod.turnsLeft--;
            if (prod.turnsLeft <= 0) {
                const tile = this.tiles.get(cityKey);
                if (tile) {
                    const unit = createUnit(prod.unitType, PLAYER_FACTION, tile.x, tile.z,
                        { veteran: prod.veteran, factionDef: def });
                    this.gameState.units.set(unit.id, unit);
                    const lordHere = this.gameState.lords.find(l =>
                        l.owner === PLAYER_FACTION && l.x === tile.x && l.z === tile.z && canCommand(l));
                    if (lordHere) { assignArmy(lordHere, unit.id); unit.lordId = lordHere.id; }
                    this.log(`${UNIT_TYPE[prod.unitType].name} completed at [${tile.x}, ${tile.z}]!`);
                    sfx.levelUp();
                }
                this.gameState.production.delete(cityKey);
            } else {
                this.log(`${UNIT_TYPE[prod.unitType].name} at [${cityKey}]: ${prod.turnsLeft} turn(s) left.`);
            }
        }
    }

    handleBuild(buildingType, tile) {
        const influence = getInfluencedTiles(this.tiles, PLAYER_FACTION, CITY_INFLUENCE_RADIUS);
        const messages = constructBuilding(buildingType, tile, this.gameState.resources.player, this.gameState.buildings, influence, this.tiles);
        messages.forEach(m => this.log(m));
        sfx.click();
        this.ui.showBuildMenu(tile);
        this.renderAll();
        this.ui.updateResourceBar();
    }

    /** A Worker unit builds a terrain improvement on its current tile (its
     *  action for the turn). The tile must be owned by the player and within a
     *  city's influence radius. Constructing uses the worker's action. */
    handleWorkerBuild(worker, buildingType) {
        if (!worker || worker.owner !== PLAYER_FACTION || worker.type !== 'WORKER') return;
        if (worker.hasAttackedThisTurn) { this.log('This worker has already acted this turn.'); return; }
        const tile = this.tiles.get(`${worker.x},${worker.z}`);
        if (!tile) return;
        if (tile.owner !== PLAYER_FACTION) { this.log('Workers can only build on your own tiles.'); return; }
        const influence = getInfluencedTiles(this.tiles, PLAYER_FACTION, CITY_INFLUENCE_RADIUS);
        const messages = constructBuilding(buildingType, tile, this.gameState.resources.player,
            this.gameState.buildings, influence, this.tiles);
        if (messages.length && messages[0].startsWith('Built')) {
            worker.hasAttackedThisTurn = true; // building uses the worker's action
            sfx.click();
            this.gameState.selectedUnit = worker;
        }
        messages.forEach(m => this.log(m));
        this.ui.showUnitInfo(worker);
        this.renderAll();
        this.ui.updateResourceBar();
    }

    /** Disband (destroy) one of your own units, refunding a fraction of its
     *  cost. Useful to free up the unit cap or remove a stranded unit. */
    handleDisband(unit) {
        if (!unit || unit.owner !== PLAYER_FACTION) return;
        if (unit.boarded) { this.log('Disembark the unit before disbanding it.'); return; }
        const cost = getUnitCostFor(unit.type, this.factionDefs[PLAYER_FACTION]);
        const refund = { gold: Math.floor((cost.gold || 0) * 0.25) };
        this.gameState.resources.player.gold = (this.gameState.resources.player.gold || 0) + refund.gold;
        this._onUnitDeath(unit);
        if (this.gameState.selectedUnit && this.gameState.selectedUnit.id === unit.id) {
            this.gameState.selectedUnit = null;
        }
        this.log(`Disbanded ${UNIT_TYPE[unit.type].name}${refund.gold ? ` (refunded ${refund.gold} gold)` : ''}.`);
        this.ui.showUnitInfo(null);
        this.gameState.moveTargets.clear();
        this.gameState.attackTargets = [];
        this.renderer.clearHighlights();
        this.renderAll();
        this.ui.updateResourceBar();
    }

    /** A military unit pillages (destroys) an enemy terrain improvement on an
     *  adjacent or same-tile enemy-owned tile, pocketing a gold reward. The
     *  pillage uses the unit's action for the turn. */
    handlePillage(unit, targetTile) {
        if (!unit || unit.owner !== PLAYER_FACTION) return;
        if (unit.type === 'SETTLER' || unit.type === 'WORKER') { this.log('Only military units can pillage.'); return; }
        if (unit.hasAttackedThisTurn) { this.log('This unit has already acted this turn.'); return; }
        if (!targetTile) return;
        // Must be within Chebyshev 1 (adjacent or same tile).
        if (Math.max(Math.abs(targetTile.x - unit.x), Math.abs(targetTile.z - unit.z)) > 1) {
            this.log('Target is not adjacent.'); return;
        }
        if (!targetTile.owner || targetTile.owner === PLAYER_FACTION) { this.log('Can only pillage enemy improvements.'); return; }
        if (!canAttack(this.gameState.diplomacy, PLAYER_FACTION, targetTile.owner)) {
            this.log('Cannot pillage: not at war with that faction.'); return;
        }
        const removed = removeBuilding(targetTile, this.gameState.buildings);
        if (!removed) { this.log('Nothing to pillage there.'); return; }
        this.gameState.resources.player.gold = (this.gameState.resources.player.gold || 0) + PILLAGE_GOLD_REWARD;
        unit.hasAttackedThisTurn = true;
        const bName = BUILDING_TYPE[removed] ? BUILDING_TYPE[removed].name : removed;
        this.log(`${UNIT_TYPE[unit.type].name} pillaged a ${bName} at [${targetTile.x}, ${targetTile.z}] (+${PILLAGE_GOLD_REWARD} gold)!`);
        sfx.capture();
        this.ui.showUnitInfo(unit);
        this.renderAll();
        this.ui.updateResourceBar();
    }

    handleTrain(unitType, tile) {
        const cityKey = `${tile.x},${tile.z}`;
        if (this.gameState.trainedThisTurn.has(cityKey)) {
            this.log('This city has already produced a unit this turn.');
            return;
        }
        const def = this.factionDefs[PLAYER_FACTION];
        if (!def.roster.includes(unitType) && !EXTRA_UNITS.includes(unitType) && !NAVAL_UNITS.includes(unitType) && !SIEGE_ENGINES.includes(unitType)) {
            this.log('Your faction cannot train that unit.');
            return;
        }
        // Ships require a Harbor in this city (and the city must be coastal).
        if (NAVAL_UNITS.includes(unitType)) {
            const hasHarbor = (this.gameState.buildings.get(cityKey) || []).includes('HARBOR');
            if (!hasHarbor) { this.log('Ships require a Harbor in this city.'); return; }
        }
        // Siege engines require a Siege Workshop in this city.
        if (SIEGE_ENGINES.includes(unitType)) {
            const hasWorkshop = (this.gameState.buildings.get(cityKey) || []).includes('SIEGE_WORKSHOP');
            if (!hasWorkshop) { this.log('Siege engines require a Siege Workshop in this city.'); return; }
        }
        // A city already busy with multi-turn production can't start another.
        if (this.gameState.production && this.gameState.production.has(cityKey)) {
            this.log('This city is already producing a unit.');
            return;
        }
        const hasBarracks = (this.gameState.buildings.get(cityKey) || []).includes('BARRACKS');
        let cost = getUnitCostFor(unitType, def);
        if (hasBarracks) cost = { ...cost, gold: Math.floor((cost.gold || 0) * 0.75) };

        if (!canAfford(unitType, this.gameState.resources.player, cost)) {
            this.log('Cannot afford this unit!');
            return;
        }
        const unitCap = getUnitCap(this.tiles, 'player');
        const playerUnits = [...this.gameState.units.values()].filter(u => u.owner === 'player').length;
        if (playerUnits >= unitCap) {
            this.log(`Unit cap reached (${unitCap}). Capture more cities!`);
            return;
        }

        this.gameState.resources.player = spendCost(unitType, this.gameState.resources.player, cost);
        this.gameState.trainedThisTurn.add(cityKey);

        const buildTurns = (UNIT_TYPE[unitType].buildTurns || 1);
        if (buildTurns > 1) {
            // Multi-turn production (e.g. Settler): queue it, spawn when complete.
            this.gameState.production.set(cityKey, {
                unitType, turnsLeft: buildTurns, veteran: hasBarracks, faction: PLAYER_FACTION
            });
            sfx.click();
            this.log(`Started ${UNIT_TYPE[unitType].name} production at [${tile.x}, ${tile.z}] — ready in ${buildTurns} turns.`);
        } else {
            const unit = createUnit(unitType, 'player', tile.x, tile.z, { veteran: hasBarracks, factionDef: def });
            this.gameState.units.set(unit.id, unit);
            const lordHere = this.gameState.lords.find(l =>
                l.owner === 'player' && l.x === tile.x && l.z === tile.z && canCommand(l));
            if (lordHere) {
                assignArmy(lordHere, unit.id);
                unit.lordId = lordHere.id;
                this.log(`${UNIT_TYPE[unitType].name} joined ${lordHere.name}'s army (${lordHere.army.length}/${maxArmySize(lordHere)})`);
            }
            sfx.click();
            this.log(`Trained ${UNIT_TYPE[unitType].name}${hasBarracks ? ' (veteran)' : ''} at [${tile.x}, ${tile.z}]`);
        }
        this.ui.showBuildMenu(tile);
        this.renderAll();
        this.ui.updateResourceBar();
    }

    handleLevelUpCity(tile) {
        const level = tile.cityLevel || 1;
        const cost = { gold: 80 * level, food: 40 * level, production: 20 * level };
        const r = this.gameState.resources.player;
        if (r.gold < cost.gold || r.food < cost.food || (r.production || 0) < cost.production) {
            this.log('Not enough resources to level up this city.');
            return;
        }
        r.gold -= cost.gold;
        r.food -= cost.food;
        r.production = (r.production || 0) - cost.production;
        tile.cityLevel = level + 1;
        tile.fortMax = 2 + tile.cityLevel;
        tile.fortification = tile.fortMax;     // a leveled city is fully fortified
        // The expanded influence radius claims the newly-reached unowned tiles.
        const claimed = expandCityTerritory(this.tiles, tile, PLAYER_FACTION);
        sfx.levelUp();
        this.log(`City at [${tile.x}, ${tile.z}] leveled up to Lv.${tile.cityLevel} (influence ${3 + (tile.cityLevel - 1)}, fort ${tile.fortMax})!${claimed ? ` Claimed ${claimed} new tile(s).` : ''}`);
        this.ui.showBuildMenu(tile);
        this.renderAll();
        this.ui.updateResourceBar();
    }

    handleDiplomacy(action, target) {
        const diplo = this.gameState.diplomacy;
        const tName = this.factionColors[target] ? this.factionColors[target].name : target;
        if (action === 'proposePeace') {
            setRelation(diplo, 'player', target, DIPLOMACY_STATES.PEACE);
            this.log(`Peace established with ${tName}.`);
        } else if (action === 'declareWar') {
            setRelation(diplo, 'player', target, DIPLOMACY_STATES.WAR);
            this.log(`War declared on ${tName}!`);
        } else if (action === 'proposeTrade') {
            setRelation(diplo, 'player', target, DIPLOMACY_STATES.TRADE_PACT);
            const rel = getRelation(diplo, 'player', target);
            rel.tradeAmount = 10;
            this.log(`Trade pact established with ${tName} (10g/turn exchange).`);
        }
        sfx.click();
        this.ui.showDiplomacyPanel();
    }

    handleRecruitLord() {
        if (!canRecruitLord(this.gameState.resources.player)) {
            this.log('Cannot afford to recruit a lord! (150g, 50f)');
            return;
        }
        // The recruited lord comes with a free Infantry — respect the unit cap
        // (raising it requires capturing/leveling cities).
        const unitCap = getUnitCap(this.tiles, PLAYER_FACTION);
        const playerUnits = [...this.gameState.units.values()].filter(u => u.owner === 'player').length;
        if (playerUnits >= unitCap) {
            this.log(`Unit cap reached (${unitCap}). Capture or level up a city to recruit more!`);
            return;
        }
        const playerCities = getOwnedCities(this.tiles, PLAYER_FACTION);
        if (playerCities.length === 0) { this.log('Need a city to recruit a lord!'); return; }
        const city = playerCities[0];
        this.gameState.resources.player.gold -= LORD_RECRUIT_COST.gold;
        this.gameState.resources.player.food -= LORD_RECRUIT_COST.food;
        const lord = createLord(PLAYER_FACTION, city.x, city.z);
        const unit = createUnit('INFANTRY', PLAYER_FACTION, city.x, city.z, { factionDef: this.factionDefs[PLAYER_FACTION] });
        this.gameState.units.set(unit.id, unit);
        assignArmy(lord, unit.id);
        unit.lordId = lord.id;
        this.gameState.lords.push(lord);
        sfx.click();
        this.log(`Recruited lord ${lord.name} with a new Infantry army at [${city.x}, ${city.z}]`);
        this.ui.showLordPanel();
        this.ui.updateResourceBar();
        this.renderAll();
    }

    /** Activate the player's king active ability. */
    handleActivateKing(lord) {
        if (!lord || !lord.isKing || lord.owner !== PLAYER_FACTION) return;
        if ((this.gameState.kingCooldowns[PLAYER_FACTION] || 0) > 0) {
            this.log('King ability on cooldown.');
            return;
        }
        this.activateKing(PLAYER_FACTION);
    }

    /** Apply a faction's king active ability (player or AI). */
    activateKing(faction) {
        const def = this.factionDefs[faction];
        if (!def) return;
        const king = this.gameState.lords.find(l => l.owner === faction && l.isKing);
        if (!king) return;
        const cd = king.active ? king.active.cooldown : 4;
        const id = king.active ? king.active.id : 'bloodlust';
        const name = this.factionColors[faction] ? this.factionColors[faction].name : faction;
        sfx.king();

        switch (id) {
            case 'bloodlust':
                this.gameState.tempBonuses[faction] = { attack: 3, defense: 0 };
                this.log(`${name}: King ${king.name} unleashes Bloodlust! +3 attack this turn.`);
                break;
            case 'bulwark':
                this.gameState.tempBonuses[faction] = { attack: 0, defense: 3 };
                this.log(`${name}: King ${king.name} raises a Bulwark! +3 defense this turn.`);
                break;
            case 'harvest': {
                const r = this.gameState.resources[faction];
                r.food = (r.food || 0) + 80;
                r.gold = (r.gold || 0) + 40;
                this.log(`${name}: King ${king.name} calls a Harvest! +80 food, +40 gold.`);
                break;
            }
            case 'scry':
                // Player-only: temporarily reveal every enemy city for this turn.
                // AI Scry is flavor-only (the AI already has full map knowledge and
                // must NOT pollute the player's fog / explored memory).
                if (faction === PLAYER_FACTION) {
                    for (const t of this.tiles.values()) {
                        if (t.terrain === 'CITY' && t.owner && t.owner !== faction) {
                            this.gameState.scryRevealed.add(`${t.x},${t.z}`);
                        }
                    }
                    this.updateFog(); // union scryRevealed into visible for the render
                }
                this.log(`${name}: King ${king.name} Scries enemy cities — revealed for this turn!`);
                break;
            case 'raise': {
                const fallen = this.gameState.graveyard.filter(g => g.owner === faction);
                if (fallen.length === 0) { this.log(`${name}: no fallen units to raise.`); break; }
                const g = fallen[fallen.length - 1];
                const capital = getOwnedCities(this.tiles, faction)[0];
                if (!capital) { this.log(`${name}: no capital to raise the dead at.`); break; }
                const unit = createUnit(g.type, faction, capital.x, capital.z, { factionDef: def });
                if (g.level > 1) unit.level = g.level;
                this.gameState.units.set(unit.id, unit);
                this.gameState.graveyard = this.gameState.graveyard.filter(x => x !== g);
                this.log(`${name}: King ${king.name} raises a ${UNIT_TYPE[g.type].name} from the dead!`);
                break;
            }
        }
        this.gameState.kingCooldowns[faction] = cd;
        if (faction === PLAYER_FACTION) {
            this.ui.showLordInfo(king);
            this.ui.showLordPanel();
            this.renderAll();
        }
    }

    handleCancelGoal(unit) {
        if (!unit || unit.owner !== PLAYER_FACTION) return;
        unit.goal = null;
        const label = unit.type ? `${UNIT_TYPE[unit.type].name} #${unit.id}` : `Lord ${unit.name}`;
        this.log(`🎯 ${label} auto-move cancelled.`);
        if (unit.type) this.ui.showUnitInfo(unit); else this.ui.showLordInfo(unit);
        this.renderAll();
    }

    /** At the start of the player's turn, auto-step every player unit that has a
     *  goal one move toward it. */
    _processAutoGoals() {
        for (const unit of this.gameState.units.values()) {
            if (unit.owner !== PLAYER_FACTION || !unit.goal) continue;
            if (unit.hasMovedThisTurn) continue;
            if (!goalValid(this.tiles, unit, unit.goal)) { unit.goal = null; continue; }
            if (unit.x === unit.goal.x && unit.z === unit.goal.z) { unit.goal = null; continue; }
            const step = nextStepToward(this.tiles, this.gameState.units, unit, unit.goal);
            if (!step) { unit.goal = null; this.log(`🎯 ${UNIT_TYPE[unit.type].name} #${unit.id} can't reach its goal — cancelled.`); continue; }
            // Perform a plain move (no capture cost for friendly tiles; capture if possible).
            unit.x = step.x; unit.z = step.z; unit.hasMovedThisTurn = true;
            sfx.move();
            const dest = this.tiles.get(`${step.x},${step.z}`);
            const pool = this.gameState.resources[PLAYER_FACTION];
            if (dest && dest.terrain === 'CITY' && dest.owner !== PLAYER_FACTION &&
                (canCaptureTile(PLAYER_FACTION, dest, pool) || this.siegeTowerAdjacentTo(dest, PLAYER_FACTION))) {
                pool.gold -= CAPTURE_COST;
                captureCityTerritory(this.tiles, dest, PLAYER_FACTION).forEach(m => this.log(m));
                sfx.capture();
            }
            if (unit.goal && unit.x === unit.goal.x && unit.z === unit.goal.z) {
                unit.goal = null;
                this.log(`🎯 ${UNIT_TYPE[unit.type].name} #${unit.id} reached its goal.`);
            }
        }
        this.checkVictory();
    }

    /** At the start of the player's turn, auto-step every player LORD/KING that
     *  has a goal one tile toward it. Lords share tiles with their own army, so
     *  own-faction units don't block their pathing. */
    _processLordGoals() {
        for (const lord of this.gameState.lords) {
            if (lord.owner !== PLAYER_FACTION || !lord.goal) continue;
            if (lord.hasMovedThisTurn) continue;
            if (lord.x === lord.goal.x && lord.z === lord.goal.z) { lord.goal = null; continue; }
            const step = nextStepToward(this.tiles, this.gameState.units, lord, lord.goal, 200, PLAYER_FACTION);
            if (!step) {
                lord.goal = null;
                this.log(`🎯 Lord ${lord.name} can't reach its goal — cancelled.`);
                continue;
            }
            // Don't step onto a fortified enemy city (must besiege first).
            const dest = this.tiles.get(`${step.x},${step.z}`);
            if (dest && dest.terrain === 'CITY' && dest.owner !== PLAYER_FACTION && (dest.fortification || 0) > 0) {
                lord.goal = null;
                this.log(`🎯 Lord ${lord.name}'s goal is a fortified city — cancelled (besiege it first).`);
                continue;
            }
            lord.x = step.x; lord.z = step.z; lord.hasMovedThisTurn = true;
            sfx.move();
            // Capture a breached enemy city on arrival (like units do).
            if (dest && dest.terrain === 'CITY' && canCaptureTile(PLAYER_FACTION, dest, this.gameState.resources[PLAYER_FACTION])) {
                this.gameState.resources[PLAYER_FACTION].gold -= CAPTURE_COST;
                captureCityTerritory(this.tiles, dest, PLAYER_FACTION).forEach(m => this.log(m));
                sfx.capture();
            }
            if (lord.goal && lord.x === lord.goal.x && lord.z === lord.goal.z) {
                lord.goal = null;
                this.log(`🎯 Lord ${lord.name} reached its goal.`);
            }
        }
        this.checkVictory();
    }

    /** Rough military/economic power of a faction: units + cities (weighted) +
     *  a gold contribution. Used by the AI to judge whether it has the advantage
     *  to declare war. */
    _factionPower(faction) {
        let units = 0, cities = 0;
        for (const u of this.gameState.units.values()) {
            if (u.owner === faction && !u.boarded) units++;
        }
        for (const t of this.tiles.values()) {
            if (t.owner === faction && t.terrain === 'CITY') cities++;
        }
        const gold = (this.gameState.resources[faction] && this.gameState.resources[faction].gold) || 0;
        return units + cities * 2 + Math.floor(gold / 100);
    }

    /** AI may unilaterally declare war on a faction it's at peace/trade/
     *  alliance with when it has a clear power advantage. War declarations are
     *  gated by personality (warChance) and the power ratio; breaking an
     *  alliance needs a bigger edge. At most one declaration per turn. */
    _aiMaybeDeclareWar(faction, def, factionName) {
        if (!def) return;
        const personality = def.aiPersonality || 'DEFENSIVE';
        const myPower = this._factionPower(faction);
        if (myPower <= 0) return;
        let declared = false;
        // Evaluate the weakest non-war neighbor first (best victim), but also
        // consider the player specifically so the AI pressures you when ahead.
        const candidates = FACTIONS.filter(o => o !== faction &&
            getRelation(this.gameState.diplomacy, faction, o).state !== DIPLOMACY_STATES.WAR);
        // Sort by power ascending (prefer declaring on the weak), but give a
        // small preference to the player so games stay tense.
        candidates.sort((a, b) => this._factionPower(a) - this._factionPower(b));
        for (const other of candidates) {
            if (declared) break;
            const rel = getRelation(this.gameState.diplomacy, faction, other);
            const theirPower = Math.max(1, this._factionPower(other));
            const ratio = myPower / theirPower;
            // Threshold: clear advantage needed. Alliances need a bigger edge.
            const isAlly = rel.state === DIPLOMACY_STATES.ALLIANCE;
            const threshold = isAlly ? 1.8 : 1.3;
            if (ratio < threshold) continue;
            if (!aiDecideWar(personality, ratio)) continue;
            setRelation(this.gameState.diplomacy, faction, other, DIPLOMACY_STATES.WAR);
            const otherName = this.factionColors[other] ? this.factionColors[other].name : other;
            this.log(`${factionName} has declared war on ${otherName}! (power ${myPower} vs ${theirPower})`);
            sfx.attack();
            declared = true;
        }
    }

    runAITurn(faction) {
        const pool = this.gameState.resources[faction];
        const def = this.factionDefs[faction];
        const influence = getInfluencedTiles(this.tiles, faction);
        const factionName = this.factionColors[faction] ? this.factionColors[faction].name : faction;

        // --- AI diplomacy: declare war from a position of strength. ---
        // The AI evaluates each faction it is NOT at war with; if it has a clear
        // power advantage it may break the peace and declare war (war is
        // unilateral). Aggressive personalities do this more readily; breaking
        // an alliance requires a larger advantage. At most one declaration per
        // turn keeps the board from descending into instant chaos.
        this._aiMaybeDeclareWar(faction, def, factionName);

        // Tick this AI faction's in-progress Siege Tower builds.
        this._tickConstructionFor(faction);

        const actions = computeAIActions(this.gameState.units, this.gameState.tiles, pool, faction, this.gameState.buildings, influence, def, this.gameState.diplomacy);

        // AI king: activate when off cooldown (simple heuristic).
        if ((this.gameState.kingCooldowns[faction] || 0) <= 0 && Math.random() < 0.5) {
            this.activateKing(faction);
        }

        for (const action of actions) {
            switch (action.type) {
                case 'train': {
                    const tile = this.tiles.get(action.tileKey);
                    if (tile) {
                        if (this.gameState.trainedThisTurn.has(action.tileKey)) break;
                        // Siege engines require a Siege Workshop in this city.
                        if (SIEGE_ENGINES.includes(action.unitType) &&
                            !(this.gameState.buildings.get(action.tileKey) || []).includes('SIEGE_WORKSHOP')) break;
                        // Ships require a Harbor in this city.
                        if (NAVAL_UNITS.includes(action.unitType) &&
                            !(this.gameState.buildings.get(action.tileKey) || []).includes('HARBOR')) break;
                        const unitCap = getUnitCap(this.tiles, faction);
                        const count = [...this.gameState.units.values()].filter(u => u.owner === faction).length;
                        const hasBarracks = (this.gameState.buildings.get(action.tileKey) || []).includes('BARRACKS');
                        let cost = getUnitCostFor(action.unitType, def);
                        if (hasBarracks) cost = { ...cost, gold: Math.floor((cost.gold || 0) * 0.75) };
                        if (count < unitCap && canAfford(action.unitType, pool, cost)) {
                            this.gameState.resources[faction] = spendCost(action.unitType, pool, cost);
                            const unit = createUnit(action.unitType, faction, tile.x, tile.z, { veteran: hasBarracks, factionDef: def });
                            this.gameState.units.set(unit.id, unit);
                            const lordHere = this.gameState.lords.find(l =>
                                l.owner === faction && l.x === tile.x && l.z === tile.z && canCommand(l));
                            if (lordHere) { assignArmy(lordHere, unit.id); unit.lordId = lordHere.id; }
                            this.gameState.trainedThisTurn.add(action.tileKey);
                            this.log(`${factionName} trained ${UNIT_TYPE[action.unitType].name}`);
                        }
                    }
                    break;
                }
                case 'build': {
                    const tile = this.tiles.get(action.tileKey);
                    if (tile) {
                        const msgs = constructBuilding(action.buildingType, tile, pool, this.gameState.buildings, influence, this.tiles);
                        msgs.forEach(m => this.log(`${factionName}: ${m}`));
                    }
                    break;
                }
                case 'workerBuild': {
                    // A Worker builds a terrain improvement on its current tile.
                    const unit = this.gameState.units.get(action.unitId);
                    const tile = unit ? this.tiles.get(`${unit.x},${unit.z}`) : null;
                    if (unit && tile && unit.type === 'WORKER' && tile.owner === faction &&
                        !unit.hasAttackedThisTurn && influence && influence.has(`${tile.x},${tile.z}`)) {
                        const msgs = constructBuilding(action.buildingType, tile, pool, this.gameState.buildings, influence, this.tiles);
                        if (msgs.length && msgs[0].startsWith('Built')) {
                            unit.hasAttackedThisTurn = true;
                            msgs.forEach(m => this.log(`${factionName}: ${m}`));
                        }
                    }
                    break;
                }
                case 'pillage': {
                    // A military unit destroys an enemy improvement on an adjacent tile.
                    const unit = this.gameState.units.get(action.unitId);
                    const tile = this.tiles.get(action.tileKey);
                    if (unit && tile && !unit.hasAttackedThisTurn && tile.owner &&
                        tile.owner !== faction && canAttack(this.gameState.diplomacy, faction, tile.owner) &&
                        Math.max(Math.abs(tile.x - unit.x), Math.abs(tile.z - unit.z)) <= 1) {
                        const removed = removeBuilding(tile, this.gameState.buildings);
                        if (removed) {
                            pool.gold = (pool.gold || 0) + PILLAGE_GOLD_REWARD;
                            unit.hasAttackedThisTurn = true;
                            const bName = BUILDING_TYPE[removed] ? BUILDING_TYPE[removed].name : removed;
                            this.log(`${factionName}: pillaged a ${bName} at [${tile.x}, ${tile.z}] (+${PILLAGE_GOLD_REWARD} gold).`);
                        }
                    }
                    break;
                }
                case 'move': {
                    const unit = this.gameState.units.get(action.unitId);
                    if (unit) {
                        unit.x = action.tx; unit.z = action.tz; unit.hasMovedThisTurn = true;
                        const dest = this.tiles.get(`${action.tx},${action.tz}`);
                        if (dest && dest.terrain === 'CITY' && dest.owner !== faction &&
                            (canCaptureTile(faction, dest, pool) || this.siegeTowerAdjacentTo(dest, faction))) {
                            pool.gold -= CAPTURE_COST;
                            captureCityTerritory(this.tiles, dest, faction).forEach(m => this.log(`${factionName}: ${m}`));
                        }
                    }
                    break;
                }
                case 'attack': {
                    const attacker = this.gameState.units.get(action.fromId);
                    const defender = this.gameState.units.get(action.toId);
                    if (attacker && defender &&
                        canAttack(this.gameState.diplomacy, attacker.owner, defender.owner)) {
                        const defenderTile = this.tiles.get(`${defender.x},${defender.z}`);
                        const terrain = defenderTile ? defenderTile.terrain : 'PLAINS';
                        const attackerLord = findCommandingLord(this.gameState.lords, attacker);
                        const defenderLord = findCommandingLord(this.gameState.lords, defender);
                        const result = resolveCombat(attacker, defender, terrain,
                            attackerLord, defenderLord, this.gameState.buildings, this.gameState.lords, this.gameState.tempBonuses);
                        result.messages.forEach(m => this.log(m));
                        attacker.hasAttackedThisTurn = true;
                        if (result.defenderDied) {
                            this._onUnitDeath(defender);
                            this._maybeRespawnOnKill(faction);
                        }
                        if (result.attackerDied) this._onUnitDeath(attacker);
                        if (UNIT_TYPE[attacker.type].aoe) {
                            this._applyAoeAndFire(attacker, defender, result.damageToDefender || 0);
                        }
                    }
                    break;
                }
                case 'capture': {
                    const unit = this.gameState.units.get(action.unitId);
                    const tile = this.tiles.get(action.tileKey);
                    if (unit && tile && tile.terrain === 'CITY' && pool.gold >= CAPTURE_COST) {
                        pool.gold -= CAPTURE_COST;
                        captureCityTerritory(this.tiles, tile, faction).forEach(m => this.log(`${factionName}: ${m}`));
                    }
                    break;
                }
                case 'besiege': {
                    const unit = this.gameState.units.get(action.unitId);
                    const tile = this.tiles.get(action.tileKey);
                    if (unit && tile) {
                        const msgs = besiegeCity(unit, tile);
                        msgs.forEach(m => this.log(`${factionName}: ${m}`));
                        if (msgs.length) sfx.besiege();
                    }
                    break;
                }
                case 'foundCity': {
                    const unit = this.gameState.units.get(action.unitId);
                    const tile = this.tiles.get(action.tileKey);
                    if (unit && tile && unit.type === 'SETTLER') {
                        const before = tile.terrain;
                        const msgs = foundCity(this.tiles, tile, faction);
                        if (tile.terrain !== before || tile.owner === faction) {
                            msgs.forEach(m => this.log(`${factionName}: ${m}`));
                            sfx.capture();
                            this.gameState.units.delete(unit.id);
                            removeUnitFromArmies(this.gameState.lords, unit.id);
                        } else if (msgs.length) {
                            this.log(`${factionName}: ${msgs[0]}`);
                        }
                    }
                    break;
                }
                case 'buildSiegeTower': {
                    // An AI engineer starts a siege tower vs an adjacent enemy
                    // city. Mirrors the player's handleBuildSiegeTower but for
                    // an AI faction (ticks down via _tickConstruction only for
                    // the player; AI towers complete via _aiTickConstruction).
                    const unit = this.gameState.units.get(action.unitId);
                    const tile = this.tiles.get(action.tileKey);
                    if (!unit || unit.type !== 'ENGINEER' || unit.owner !== faction) break;
                    if (unit.hasAttackedThisTurn) break;
                    if (this.gameState.construction && this.gameState.construction.has(unit.id)) break;
                    if (!tile || tile.terrain !== 'CITY' || tile.owner === faction ||
                        !canAttack(this.gameState.diplomacy, faction, tile.owner)) break;
                    let canPay = true;
                    for (const [res, amt] of Object.entries(SIEGE_TOWER_COST)) {
                        if ((pool[res] || 0) < amt) { canPay = false; break; }
                    }
                    if (!canPay) break;
                    for (const [res, amt] of Object.entries(SIEGE_TOWER_COST)) pool[res] = (pool[res] || 0) - amt;
                    this.gameState.construction.set(unit.id, {
                        type: 'SIEGE_TOWER', turnsLeft: SIEGE_TOWER_BUILD_TURNS,
                        x: unit.x, z: unit.z, faction
                    });
                    unit.hasAttackedThisTurn = true;
                    sfx.besiege();
                    this.log(`${factionName}: engineer started a Siege Tower near [${tile.x}, ${tile.z}].`);
                    break;
                }
            }
        }
        this.updateFog();
        this.checkVictory();
    }

    updateFog() {
        const playerDef = this.factionDefs[PLAYER_FACTION];
        const baseVision = getFactionVision(playerDef);
        const sources = [];
        for (const u of this.gameState.units.values()) {
            if (u.owner === PLAYER_FACTION) {
                const r = (UNIT_TYPE[u.type] && UNIT_TYPE[u.type].vision) || baseVision;
                sources.push({ x: u.x, z: u.z, radius: r });
            }
        }
        for (const l of this.gameState.lords) {
            if (l.owner === PLAYER_FACTION) sources.push({ x: l.x, z: l.z, radius: baseVision });
        }
        for (const t of this.tiles.values()) {
            if (t.owner === PLAYER_FACTION && t.terrain === 'CITY') {
                sources.push({ x: t.x, z: t.z, radius: cityRadius(t) });
            }
        }
        const baseVisible = computeVisibility(sources);
        // Explored only grows from real vision — never from Scry (which is a
        // temporary, one-turn reveal and must not leave permanent intel).
        this.gameState.explored = updateExplored(this.gameState.explored, baseVisible);
        this.gameState.visible = baseVisible;
        if (this.gameState.scryRevealed && this.gameState.scryRevealed.size) {
            for (const k of this.gameState.scryRevealed) this.gameState.visible.add(k);
        }
    }

    onPhaseChange(phase) {
        if (phase === PLAYER_FACTION) {
            // Start of the player's turn: complete multi-turn production, then
            // auto-navigate units with goals.
            this._tickProduction();
            this._tickConstruction();
            this._tickBurn(); // fire ailment ticks once per round (start of player turn)
            this._processAutoGoals();
            this._processLordGoals();
            // Scry reveal expires at the start of the player's next turn.
            if (this.gameState.scryRevealed) this.gameState.scryRevealed.clear();
            this.updateFog();
            this.renderAll();
            this.ui.updateResourceBar();
            this.ui.showLordPanel();
        }
    }

    log(msg) {
        this.ui.addCombatLog(msg);
    }

    renderAll() {
        this.renderer.renderAll(this.gameState);
    }

    /** End the player's turn (called from the End Turn button in ui.js, which also
     *  plays the end-turn SFX via the button click). */
    endPlayerTurn() {
        if (this.gameState.gameOver) return;
        if (this.gameState.turnManager.phase !== PLAYER_FACTION) return;
        // Re-entrancy guard: a loaded save re-binds the End Turn button, which
        // can fire this twice synchronously; the second pass would pass the
        // PLAYER-phase guard (the first run already returned phase to PLAYER)
        // and run the AI turn a second time. Block any nested call.
        if (this._endingTurn) return;
        this._endingTurn = true;
        try {
            sfx.endTurn();
            this.gameState.turnManager.endPlayerTurn();
            this.ui.updateAll();
        } finally {
            this._endingTurn = false;
        }
    }

    checkVictory() {
        if (this.gameState.gameOver) return;
        if (!this.gameState.eliminated) this.gameState.eliminated = new Set();
        for (const f of FACTIONS) {
            if (this.gameState.eliminated.has(f)) continue;
            if (countCities(this.tiles, f) === 0) {
                this.gameState.eliminated.add(f);
                const name = this.factionColors[f] ? this.factionColors[f].name : f;
                this.log(`${name} has lost all cities and is eliminated!`);
            }
        }
        const playerAlive = !this.gameState.eliminated.has(PLAYER_FACTION);
        const aiRemaining = FACTIONS.filter(f => f !== PLAYER_FACTION && !this.gameState.eliminated.has(f));
        if (!playerAlive) this.endGame('defeat');
        else if (aiRemaining.length === 0) this.endGame('victory');
    }

    endGame(result) {
        this.gameState.gameOver = true;
        this.gameState.winner = result;
        const banner = document.getElementById('game-over');
        const text = document.getElementById('game-over-text');
        if (text) {
            text.textContent = result === 'victory'
                ? 'VICTORY — you conquered every enemy city!'
                : 'DEFEAT — you lost your last city.';
        }
        if (banner) {
            banner.style.background = result === 'victory' ? 'rgba(20,90,30,0.92)' : 'rgba(100,20,20,0.92)';
            banner.style.display = 'flex';
        }
        if (result === 'victory') sfx.victory(); else sfx.defeat();
        this.log(result === 'victory' ? 'VICTORY!' : 'DEFEAT.');
        clearSave();
    }

    // --- Pause / save / mute hooks (called from index.html + menus.js) ---
    togglePause() {
        if (this.gameState.gameOver) return;
        this.gameState.paused = !this.gameState.paused;
        if (this.gameState.paused) {
            showPauseMenu({
                onResume: () => this.togglePause(),
                onSave: () => this.save(),
                onLoad: () => this.load(),
                onMenu: () => this.toMenu(),
                onToggleMute: () => this.toggleMute(),
                isMuted: isMuted()
            });
        } else {
            hidePauseMenu();
        }
    }
    resume() { if (this.gameState.paused) this.togglePause(); }
    save() {
        if (saveGame(this.gameState)) this.log('Game saved.');
        else this.log('Save failed.');
    }
    load() {
        const state = loadGame();
        if (!state) { this.log('No save found.'); return; }
        hidePauseMenu();
        this.loadFromState(state);
        this.log('Game loaded.');
    }
    toMenu() {
        hidePauseMenu();
        clearSave();
        location.reload();
    }
    toggleMute() {
        setMuted(!isMuted());
        const m = isMuted();
        const btn = document.getElementById('btn-mute');
        if (btn) btn.textContent = m ? '🔇' : '🔊';
        const pbtn = document.getElementById('pause-mute');
        if (pbtn) pbtn.textContent = m ? 'Unmute' : 'Mute';
        if (this.hooks && this.hooks.onMuteChanged) this.hooks.onMuteChanged(m);
    }

    start() {
        const myName = this.factionColors[PLAYER_FACTION] ? this.factionColors[PLAYER_FACTION].name : 'You';
        this.log(`${myName} — your conquest begins!`);
        this.log('Click your unit, then a highlighted tile to move (captures it).');
        this.log('Right-click a tile to set an auto-move goal. Click an enemy unit to attack.');
        this.log('Click your city to build/train. Besiege enemy cities with Siege units before capturing.');
        this.log('Drag the map to pan. Esc to pause.');
        // Announce any Natural Wonders on this map.
        for (const w of (this._mapWonders || [])) {
            this.log(`${w.wonder.emoji || '✨'} Natural Wonder: ${w.wonder.name} at [${w.x}, ${w.z}] — capture it for a bonus!`);
        }
        // Process any goals on the very first turn too.
        this.renderAll();
        this.ui.updateAll();
    }
}