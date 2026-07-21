/** Main game orchestrator: wires all systems together. */
import { GRID_SIZE, MAP_SIZES, calculateMapDimensions, setGridDimensions, TERRAIN, UNIT_TYPE, UNIT_COST, CAPTURE_COST, INITIAL_RESOURCES,
         DIPLOMACY_STATES, LORD_RECRUIT_COST, LORD_CLASSES, BRIDGE_COST, EXTRA_UNITS, BUILDING_TYPE,
         SIEGE_TOWER_COST, SIEGE_TOWER_BUILD_TURNS, SIEGE_TOWER_BUILD_RADIUS, NAVAL_UNITS,
         SIEGE_ENGINES, AOE_RADIUS, AOE_SPLASH_FRACTION, BURN_TURNS, BURN_DAMAGE_PER_TURN,
         PILLAGE_GOLD_REWARD,
         CONCEAL_TERRAINS, CONCEAL_TURNS_MOUNTAIN, CONCEAL_TURNS_FOREST, CONCEAL_MAX_PER_TILE,
         CONCEAL_MAX_TURNS, CONCEAL_REVEAL_COOLDOWN,
         AMBUSH_ATTACK_BONUS, AMBUSH_DEFENSE_BONUS,
         CHARGE_UNITS, CHARGE_ATTACK_BONUS, CHARGE_RANGE,
         CHARGE_EXHAUST_TURNS, CHARGE_EXHAUST_RANGED_VULN,
         CHARIOT_CHARGE_UNITS, CHARIOT_CHARGE_RANGE, CHARIOT_CHARGE_STUN_TURNS,
         CHARIOT_CHARGE_ATTACK_BONUS, CHARIOT_CHARGE_VULN_TYPES, CHARIOT_CHARGE_VULN_MULT,
         RANGED_BOMBARD_FORT_DAMAGE, RANGED_BOMBARD_TYPES,
         LADDER_COST, LADDER_BUILD_TURNS, LADDER_BUILD_RADIUS,
         STRUCTURE_TYPE, STRUCTURE_COST,
         FACTIONS, PLAYER_FACTION, FACTION_COLORS, CITY_INFLUENCE_RADIUS,
         GRIEVANCE_WAR_THRESHOLD, NEUTRAL_CITY_GRUDGE_RADIUS, MIN_CITY_SPACING,
          CITY_LEVEL_UP_COST, CITY_MAX_LEVEL,
          MILITARY_BUILDING_LEVELS } from './config.js';
import { generateMap, buildTileMap, getOwnedCities, getInfluencedTiles, cityRadius,
         captureCityTerritory, besiegeCity, foundCity, isPassable, expandCityTerritory } from './map.js';
import { createUnit, canAfford, spendCost, getReachableTiles, getAttackTargets, getMoveRange } from './unit.js';
import { resolveCombat, canCaptureTile } from './battle.js';
import { createTurnManager } from './turnmanager.js';
import { computeAIActions, kingRangedResponse } from './ai.js';
import { GameRenderer } from './renderer.js';
import { bindUI } from './ui.js';
import { computeVisibility, updateExplored } from './fog.js';
import { createDiplomacyState, setRelation, getRelation, canAttack, aiDecideWar, aiDecideTreaty, isAllied, relKey, getTension, addGrievance, grievanceLevel,
         createPeaceDemand, evaluatePeaceDemand, getWarWeariness, applyWarWeariness, processWarWeariness, PEACE_DEMAND_LIMITS,
         formCoalition, eligibleCoalitionAllies, declareCoalitionWar, getCoalition } from './diplomacy.js';
import { createLord, canRecruitLord, awardXP, assignGovernance, assignArmy,
         findCommandingLord, canCommand, removeUnitFromArmies, maxArmySize,
         lordCombatant, lordMaxHp, lordAttack, lordDefense, syncLordHp,
         getAvailableSkills, investSkillPoint, getSkillEffects } from './lords.js';
import { constructBuilding, removeBuilding, pillageableOn, getBuildingState, upgradeBuilding, damageBuilding, clearBuildingsOnTile, getMilitaryBuildingDefenseBonus } from './building.js';
import { MILITARY_BUILDING_DEFENSE, MILITARY_PILLAGE_GOLD, UNREST_INCREASE_RATES, SPY_ACTION_COST } from './config.js';
import { collectResources, processUpkeep, getUnitCap, countCities, countTiles,
         createTradeRoute, validateTradeRoute, getTradeRouteIncome, processTradeRouteRaids } from './economy.js';
import { getFactionDef, getUnitCostFor, getFactionVision, FACTION_IDS,
         getDiplomacyBonus, getGoldPerConquest, getCavalryChargeBonus } from './faction.js';
import { initAIState, createAIState, serializeAIState, deserializeAIState } from './ai_goals.js';
import { addEvent as addEventEntry } from './eventlog.js';
import { getDifficulty, applyDifficultyYield, applyDifficultyUpkeep, aiAggression, difficultyOptions } from './difficulty.js';
import { resolveSpyAction, isSpyUnit, spyDetectionBonus } from './spy.js';
import { buildMinimapData, getCityJumpList, getArmyComposition } from './ui_data.js';
import { sfx, unlockAudio, isMuted, setMuted } from './sound.js';
import { saveGame, loadGame, loadSavedExists, clearSave } from './save.js';
import { showStartMenu, showPauseMenu, hidePauseMenu } from './menus.js';
import { nextStepToward, goalValid } from './path.js';
import { createTechState, serializeTechState, deserializeTechState,
         addResearch, selectResearch, getResearchProgress, calculateResearchOutput,
         getUnlockedUnits, getUnlockedBuildings, getTechBonuses, getCurrentEra,
         TECHS, ERA_NAMES, canResearch, getAvailableTechs } from './tech.js';
import { VICTORY_TYPES, SCORE_VICTORY_TURN, SCIENCE_VICTORY_COST, SCIENCE_VICTORY_BUILD_TURNS,
         ECONOMIC_VICTORY_GOLD, ECONOMIC_VICTORY_TRADE_ROUTES } from './config.js';

const DRAG_THRESHOLD = 6; // px; under this a press→release is a click

export class Game {
    /**
     * @param options - { playerFactionId, aiFactionIds, mapSize } OR { load:true }
     * @param hooks   - { onMuteChanged }
     */
    constructor(options = {}, hooks = {}) {
        this.hooks = hooks || {};
        this.spectateMode = !!options.spectate;
        unlockAudio();

        if (options && options.load) {
            const state = loadGame();
            if (!state) {
                // No save to load �?fall back to a fresh medium game.
                options = { playerFactionId: 'crimson', aiFactionIds: null, mapSize: 'medium' };
            } else {
                this.loadFromState(state);
                this.start();
                return;
            }
        }

        // Resolve faction binding + map size.
        // In spectate mode there is no human player; slot 0 is just another AI.
        const playerFactionId = this.spectateMode ? null : (options.playerFactionId || 'crimson');
        const maxAi = Math.max(0, FACTIONS.length - 1);
        const others = (options.aiFactionIds && options.aiFactionIds.length)
            ? options.aiFactionIds.slice(0, maxAi)
            : ['crimson', 'roman', 'viking', 'azure', 'byzantine', 'verdant', 'spanish', 'polish', 'violet', 'obsidian', 'golden', 'iron', 'shadow', 'storm']
                  .filter(id => id !== (playerFactionId || '_none_'))
                  .slice(0, maxAi);
        this._buildFactionBindings(playerFactionId, others);

        // Spectate UI controls.
        if (this.spectateMode) this._initSpectateUI();
        const sizeKey = options.mapSize || 'medium';
        const { width, height } = calculateMapDimensions(sizeKey);
        setGridDimensions(width, height);

        this.initState();
        this.initRenderer();
        this.initUI();
        this.initInput();
        this.start();
    }

    /** Bind slots player/ai1/ai2/ai3 to chosen faction defs; build colors + def map. */
    _buildFactionBindings(playerFactionId, aiFactionIds) {
        const slots = FACTIONS; // ['player','ai1','ai2','ai3'] or more
        // In spectate mode slot 0 is also AI, so no human faction is assigned there.
        const ids = this.spectateMode
            ? aiFactionIds.slice(0, slots.length)
            : [playerFactionId, ...aiFactionIds];
        this.factionAssignments = {};
        this.factionDefs = {};
        this.factionColors = {};
        // Defensive: ensure no two slots share a faction def. A duplicate def
        // would create two lords carrying the king's name (the "two kings"
        // bug). Fill any missing/duplicate slot with an unused faction.
        const used = new Set();
        const allIds = FACTION_IDS;
        const pickUnused = () => {
            for (const candidate of allIds) {
                if (!used.has(candidate)) return candidate;
            }
            return 'crimson';
        };
        for (let i = 0; i < slots.length; i++) {
            const slot = slots[i];
            let id = ids[i];
            if (!id || used.has(id)) id = pickUnused();
            used.add(id);
            const def = getFactionDef(id) || getFactionDef('crimson');
            this.factionAssignments[slot] = def.id;
            this.factionDefs[slot] = def;
            this.factionColors[slot] = def.color;
        }
    }

    /** Spectate mode UI: show fast-forward / auto controls, hide end turn, and
     *  reveal the AI Goals debug panel. */
    _initSpectateUI() {
        const endBtn = document.getElementById('btn-end-turn');
        const spectateControls = document.getElementById('spectate-controls');
        if (endBtn) endBtn.style.display = 'none';
        if (spectateControls) {
            spectateControls.style.display = 'flex';
        }
        const aiGoalsPanel = document.getElementById('ai-goals-panel');
        if (aiGoalsPanel) aiGoalsPanel.style.display = 'block';
        // gameState.spectateMode is set authoritatively in initState (which runs
        // after this in the constructor); don't touch it here — gameState isn't
        // built yet when _initSpectateUI is called.
    }

    /** Run N full rounds in spectate mode automatically. A monotonically
     *  increasing token cancels any previously scheduled fast-forward loop so
     *  pressing FF5 then FF10 (or FF5 twice) never runs two loops at once �?     *  the newest request wins and the old one stops itself on the next tick. */
    fastForwardTurns(n) {
        if (!this.spectateMode || this.gameState.gameOver) return;
        // Stop auto-FF when the user asks for a fixed fast-forward.
        if (this._autoFF) {
            this._autoFF = false;
            const status = document.getElementById('ff-status');
            if (status) status.textContent = '';
        }
        // Cancel any in-progress fast-forward loop by bumping the token.
        this._ffToken = (this._ffToken || 0) + 1;
        const myToken = this._ffToken;
        const status = document.getElementById('ff-status');
        if (status) status.textContent = `Fast-forwarding ${n} turns...`;
        let done = 0;
        const step = () => {
            // If a newer FF/auto request superseded this one, stop silently.
            if (myToken !== this._ffToken) return;
            if (done >= n || this.gameState.gameOver || this.gameState.paused) {
                if (status) status.textContent = '';
                return;
            }
            this._rebuildDiploCache();
            this.gameState.turnManager.endPlayerTurn();
            done++;
            if (myToken === this._ffToken && status)
                status.textContent = `Fast-forwarding ${n - done} turns...`;
            setTimeout(step, 120);
        };
        step();
    }

    /** Toggle continuous auto-advance in spectate mode. */
    toggleAutoFastForward() {
        if (!this.spectateMode) return;
        this._autoFF = !this._autoFF;
        // Bump the FF token so any in-progress fixed fast-forward stops.
        this._ffToken = (this._ffToken || 0) + 1;
        const status = document.getElementById('ff-status');
        if (status) status.textContent = this._autoFF ? 'Auto: ON' : 'Auto: OFF';
        if (this._autoFF) this._autoFFLoop();
    }

    _autoFFLoop() {
        if (!this._autoFF || this.gameState.gameOver || this.gameState.paused) return;
        this._rebuildDiploCache();
        this.gameState.turnManager.endPlayerTurn();
        setTimeout(() => this._autoFFLoop(), 250);
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
            buildingState: new Map(),
            tradeRoutes: [],
            tradeRouteNextId: 1,
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
            // Faction identity (runtime binding of slots �?defs).
            factionAssignments: this.factionAssignments,
            factionDefs: this.factionDefs,
            factionColors: this.factionColors,
            // Multi-turn unit production: cityKey -> { unitType, turnsLeft, veteran, faction }.
            production: new Map(),
            // Engineer construction projects: engineerId -> { type, turnsLeft, x, z, faction }.
            // Currently used for Siege Towers built near enemy cities.
            construction: new Map(),
            // Engineer-built defensive structures: tileKey -> { type, owner }.
            // Structures are placed on owned tiles within city influence and removed
            // when an enemy captures the tile.
            structures: new Map(),
            // Bridge tile keys (rivers bridged by Siege/Engineer). Also mirrored on tile.bridge.
            bridges: new Set(),
            // Concealment system: tileKey -> [unitId, ...] for units hidden in terrain.
            concealedUnits: new Map(),
            // Pending ambush opportunity (player choice).
            pendingAmbush: null,
            // Charge targets for cavalry selection highlighting.
            chargeTargets: [],
            // King abilities.
            kingCooldowns: Object.fromEntries(FACTIONS.map(f => [f, 0])),
            tempBonuses: {},       // faction -> {attack,defense} for this turn
            graveyard: [],         // fallen units (for Obsidian Raise Dead)
            eliminated: new Set(),
            // Per-faction reputation (0-100, starts 50). Breaking treaties or
            // declaring war on peaceful factions lowers it; long peace raises it.
            // AI uses it to decide whether to deal with you. Byzantine Empire's
            // diplomacyBonus raises its starting reputation.
            reputation: Object.fromEntries(FACTIONS.map(slot => {
                const def = this.factionAssignments ? getFactionDef(this.factionAssignments[slot]) : null;
                return [slot, Math.min(100, 50 + getDiplomacyBonus(def))];
            })),
            gameOver: false,
            winner: null,
            paused: false,
            // Spectate flag mirrored onto gameState so pure render/UI code
            // (e.g. renderer.js) can read it without reaching back into the
            // Game instance. Set here in initState so it always exists before
            // any reader — _initSpectateUI used to set it before gameState was
            // built, throwing "can't access spectateMode of undefined".
            spectateMode: this.spectateMode,
            // Feature 6: rolling event log (capped; oldest drop off).
            eventLog: [],
            // Feature 8: active difficulty preset key (defaults to NORMAL).
            difficulty: this.difficulty || 'NORMAL'
        };

        // Tech tree state (4X feature): single-track research progress.
        this.gameState.techState = createTechState();

        // Victory tracking state.
        this.gameState.victoryState = {
            // Science victory: projects built per faction
            projects: {},
            // Economic victory: trade routes per faction
            tradeRoutes: {},
            // Score victory: snapshot at key turns
            scoreSnapshots: {}
        };

        // Per-faction AI goal-sequence state (see src/ai_goals.js). Persists the
        // faction's ordered goals + scarcity streak across turns so plans are
        // stable instead of recomputed (and thrashing) every turn.
        this.gameState.aiState = initAIState(FACTIONS);

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
            // createLord computed maxHp with isKing=false (12 HP). Now that the
            // king flag is set, recompute so the king gets its full HP (>=50).
            king.maxHp = lordMaxHp(king);
            king.hp = king.maxHp;
            this.gameState.lords.push(king);
            assignArmy(king, unit.id);
            unit.lordId = king.id;
        }

        // Everyone starts NEUTRAL (Civ6-style). Wars must be formally declared
        // �?canAttack() only permits WAR, so neutral factions can't be attacked
        // accidentally. createDiplomacyState already initializes every pair to
        // NEUTRAL, so no override loop is needed here.

        // Stash placed Natural Wonders so start() can announce them (the UI
        // log isn't available yet during initState).
        this._mapWonders = mapData.wonders || [];

        this.updateFog();

        this.gameState.turnManager = createTurnManager(
            this.gameState,
            FACTIONS,
            (phase) => this.onPhaseChange(phase),
            (faction) => this.runAITurn(faction),
            () => this.renderAll(),
            this.spectateMode
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
        // Backfill city-unrest fields for saves made before the unrest system.
        // calculateUnrest already tolerates undefined, but normalizing here keeps
        // tile.unrest a stable number for the UI right after load.
        if (this.tiles) {
            for (const tile of this.tiles.values()) {
                if (tile.terrain !== 'CITY') continue;
                if (tile.unrest == null) tile.unrest = 0;
                if (tile.lastConqueredTurn == null) tile.lastConqueredTurn = 0;
                if (!Array.isArray(tile.unrestReasons)) tile.unrestReasons = [];
            }
        }
        // Trade routes (Feature 3): backfill the array + id counter for old saves.
        if (!Array.isArray(this.gameState.tradeRoutes)) this.gameState.tradeRoutes = [];
        if (!this.gameState.tradeRouteNextId) this.gameState.tradeRouteNextId = this.gameState.tradeRoutes.length + 1;
        // War-weariness store (Feature 2): backfill for old saves.
        if (!this.gameState.diplomacy) this.gameState.diplomacy = createDiplomacyState(FACTIONS);
        if (!this.gameState.diplomacy.warWeariness) this.gameState.diplomacy.warWeariness = {};
        // Mirror the instance spectate flag onto gameState for pure render/UI
        // code (loaded games skip initState, where this is normally set).
        this.gameState.spectateMode = this.spectateMode;
        // Backfill unit.factionId for saves made before Phase G (battle.js reads
        // faction passives off it). Derive from the slot->def assignment.
        if (this.gameState.factionAssignments) {
            for (const u of this.gameState.units.values()) {
                if (!u.factionId) u.factionId = this.gameState.factionAssignments[u.owner] || null;
            }
        }
        this.gameState.moveTargets = new Set();
        this.gameState.attackTargets = [];
        this.gameState.bridgeTargets = [];
        if (!this.gameState.production) this.gameState.production = new Map();
        if (!this.gameState.construction) this.gameState.construction = new Map();
                        if (!this.gameState.structures) this.gameState.structures = new Map();
        if (!this.gameState.bridges) this.gameState.bridges = new Set();
        if (!this.gameState.scryRevealed) this.gameState.scryRevealed = new Set();
        if (!this.gameState.concealedUnits) this.gameState.concealedUnits = new Map();
        if (!this.gameState.chargeTargets) this.gameState.chargeTargets = [];
        // Tech tree state (4X feature) — absent on old saves.
        if (!this.gameState.techState) this.gameState.techState = createTechState();
        if (this.gameState.techState && this.gameState.techState.researched && Array.isArray(this.gameState.techState.researched)) {
            this.gameState.techState.researched = new Set(this.gameState.techState.researched);
        }
        // Victory state — absent on old saves.
        if (!this.gameState.victoryState) {
            this.gameState.victoryState = { projects: {}, tradeRoutes: {}, scoreSnapshots: {} };
        }
        // Reputation may be absent in pre-Phase-E saves �?default everyone to 50.
        if (!this.gameState.reputation) {
            this.gameState.reputation = Object.fromEntries(FACTIONS.map(f => [f, 50]));
        }
        // AI goal-sequence state — absent on saves created before the goal
        // revamp. Backfill a fresh record per faction so old saves load fine.
        if (!this.gameState.aiState) {
            this.gameState.aiState = initAIState(FACTIONS);
        } else {
            for (const f of FACTIONS) {
                if (!this.gameState.aiState[f]) this.gameState.aiState[f] = createAIState();
            }
        }
        // pendingOffers may be absent on old saves.
        if (!this.gameState.diplomacy) this.gameState.diplomacy = createDiplomacyState(FACTIONS);
        if (!this.gameState.diplomacy.pendingOffers) this.gameState.diplomacy.pendingOffers = [];
        // Feature 6 event log + Feature 8 difficulty — absent on old saves.
        if (!Array.isArray(this.gameState.eventLog)) this.gameState.eventLog = [];
        if (!this.gameState.difficulty) this.gameState.difficulty = 'NORMAL';
        // Feature 12 coalition store — absent on old saves.
        if (!this.gameState.diplomacy.coalitions) this.gameState.diplomacy.coalitions = {};
        this.gameState.pendingAmbush = null;
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
            // Backfill combat fields for pre-lord-combat saves: lords now have
            // HP and can attack once per turn.
            if (typeof lord.maxHp !== 'number') lord.maxHp = lordMaxHp(lord);
            if (typeof lord.hp !== 'number') lord.hp = lord.maxHp;
            if (typeof lord.hasAttackedThisTurn !== 'boolean') lord.hasAttackedThisTurn = false;
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
            onPeaceNegotiation: (target, demands) => this.handlePeaceNegotiation(target, demands),
            onRecruitLord: this.spectateMode ? null : () => this.handleRecruitLord(),
            onLevelUpCity: (tile) => this.handleLevelUpCity(tile),
            onEstablishTrade: (cityKey, targetCityKey) => this.handleEstablishTrade(cityKey, targetCityKey),
            onActivateKing: (lord) => this.handleActivateKing(lord),
            onSkillInvestment: (lordId, skillId) => this.handleSkillInvestment(lordId, skillId),
            getVictoryProgress: () => this.getVictoryProgress(),
            onCancelGoal: (unit) => this.handleCancelGoal(unit),
            onFoundCity: (unit) => this.handleFoundCity(unit),
            onBuildSiegeTower: (unit) => this.handleBuildSiegeTower(unit),
            onBuildSiegeEngine: (unit, engineType) => this.handleBuildSiegeEngine(unit, engineType),
            onBuildStructure: (unit, structureType) => this.handleBuildStructure(unit, structureType),
            onBoard: (unit, transport) => this.handleBoard(unit, transport),
            onDisembark: (transport) => this.handleDisembark(transport),
            onWorkerBuild: (unit, buildingType) => this.handleWorkerBuild(unit, buildingType),
            onJoinArmy: (unit, lord) => this.handleJoinArmy(unit, lord),
            onDisband: (unit) => this.handleDisband(unit),
            onPillage: (unit, tile) => this.handlePillage(unit, tile),
            onUpgradeBuilding: (buildingType, tile) => this.handleUpgradeBuilding(buildingType, tile),
            onAttackBuilding: (unit, tile) => this.handleAttackBuilding(unit, tile),
            onConceal: (unit) => this.handleConceal(unit),
            onReveal: (unit, dir) => this.handleReveal(unit, dir),
            onCharge: (unit, targetId) => this.handleChargeById(unit, targetId),
            onAmbushConfirm: () => this.handleAmbushConfirm(),
            onAmbushDecline: () => this.handleAmbushDecline(),
            onResearch: (techId) => this.handleResearch(techId),
            onEndTurn: () => this.endPlayerTurn()
        });
    }

    /** In spectate mode the viewer may pan/zoom but cannot command units. */
    _canPlayerAct() {
        if (this.spectateMode) return false;
        return this.gameState.turnManager.phase === PLAYER_FACTION;
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
            // (Found City, Build Siege Tower, Board, Cancel Goal, King ability�?
            // stay put and remain clickable as you move the mouse toward them.
            const hasSelection = this.gameState.selectedUnit || this.gameState.selectedLord;
            if (hasSelection) return;
            if (hit.lord) this.ui.showLordInfo(hit.lord);
            else if (hit.unit) this.ui.showUnitInfo(hit.unit);
            else { this.ui.showLordInfo(null); this.ui.showUnitInfo(null); }
        });

        // When the cursor leaves the map canvas, clear the hover info panel �?        // but only if nothing is selected (a selected unit/lord keeps its panel
        // pinned so its action buttons stay usable). Without this the panel
        // could stay stuck on the last hovered unit when the mouse moves off the
        // map onto the surrounding page chrome.
        dom.addEventListener('mouseleave', () => {
            const hasSelection = this.gameState.selectedUnit || this.gameState.selectedLord;
            if (hasSelection) return;
            this.ui.showLordInfo(null);
            this.ui.showUnitInfo(null);
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
            if (this.spectateMode) return;  // no commands in spectate mode

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
            // Escape unpins (deselects) the current unit/lord, which also clears
            // the hover info panel �?a quick way to dismiss a stuck menu.
            if (e.key === 'Escape' && !this.spectateMode) {
                if (this.gameState.selectedUnit || this.gameState.selectedLord) {
                    this.deselect();
                }
                return;
            }
            if (!panKey(e)) return;
            if (e.key.startsWith('Arrow')) e.preventDefault();
            this._keys.add(e.key.toLowerCase());
        });
        window.addEventListener('keyup', (e) => { this._keys.delete(e.key.toLowerCase()); });
        // If the window loses focus or the game pauses while a key is held, the
        // keyup never fires �?clear the set so the camera doesn't drift forever.
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
        // the raycast hits the child part-meshes �?climb the parent chain.
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
     *  Screen-right  = world (+X, −Z); screen-down = world (+X, +Z) (both /�?).
     *  Content moves OPPOSITE to the drag (drag bottom-left �?map goes top-right). */
    _panBy(dx, dy) {
        const cam = this.renderer.camera;
        const worldPerPixel = (cam.right - cam.left) / window.innerWidth;
        const k = worldPerPixel * 0.7071; // 1/�? �?screen axis �?world XZ
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
        if (this.spectateMode) return;
        if (this.gameState.turnManager.phase !== PLAYER_FACTION) return;
        const { tile, unit: clickedUnit, lord: clickedLord, top } = this._resolveHit();
        if (!tile && !clickedUnit && !clickedLord) { this.deselect(); return; }

        const sel = this.gameState.selectedUnit;

        // Units that are concealed or setting up concealment cannot act normally
        // (move, attack, charge, bridge, besiege, etc.). They can only be selected
        // and then use the UI Reveal button.
        const selConcealed = sel && (sel.concealState === 'concealed' || sel.concealState === 'concealing');
        if (selConcealed) {
            // Still allow re-selecting another own unit / lord or deselecting,
            // but ignore map commands for this unit.
            let topIsLord = false;
            if (top) { let c = top; while (c) { if (c.userData && c.userData.lordId !== undefined) { topIsLord = true; break; } c = c.parent; } }
            if (topIsLord && clickedLord && clickedLord.owner === PLAYER_FACTION) {
                this.selectLord(clickedLord);
            } else if (clickedUnit && clickedUnit.owner === PLAYER_FACTION) {
                this.selectUnit(clickedUnit);
            } else if (clickedLord && clickedLord.owner === PLAYER_FACTION) {
                this.selectLord(clickedLord);
            } else if (sel && (!clickedUnit || clickedUnit.owner !== PLAYER_FACTION) && (!clickedLord || clickedLord.owner !== PLAYER_FACTION)) {
                this.deselect();
            }
            return;
        }

        // 0) Lord/King move: a selected, still-movable player lord clicks a reachable tile.
        const selLord = this.gameState.selectedLord;
        if (selLord && selLord.owner === PLAYER_FACTION && !selLord.hasMovedThisTurn && tile) {
            if (this.gameState.moveTargets.has(`${tile.x},${tile.z}`)) {
                this.moveLord(selLord, tile.x, tile.z);
                return;
            }
        }

        // 0a) Lord/King attack: a selected player lord clicks an adjacent enemy
        //     (unit or exposed lord) that's in its attack list. Lords fight like units.
        if (selLord && selLord.owner === PLAYER_FACTION && !selLord.hasAttackedThisTurn) {
            const tgt = clickedUnit || clickedLord;
            if (tgt && tgt.owner !== PLAYER_FACTION &&
                this.gameState.attackTargets.some(t => t.id === tgt.id)) {
                this.handleLordAttack(selLord, tgt);
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

        // 1c) Arrow bombard: a selected player Archer/Longbowman fires at an
        // enemy fortified city within attack range, chipping 1 fortification.
        if (sel && sel.owner === PLAYER_FACTION && tile && tile.terrain === 'CITY' &&
            tile.owner !== PLAYER_FACTION && (tile.fortification || 0) > 0 &&
            !sel.hasAttackedThisTurn && RANGED_BOMBARD_TYPES.includes(sel.type)) {
            const range = (UNIT_TYPE[sel.type].attackRange) || 2;
            const dist = Math.abs(sel.x - tile.x) + Math.abs(sel.z - tile.z);
            if (dist <= range) { this.handleArrowBombard(sel, tile); return; }
        }

        // 1b) Charge: a selected player cavalry clicks an adjacent enemy for charge attack.
        if (sel && sel.owner === PLAYER_FACTION && clickedUnit && clickedUnit.owner !== PLAYER_FACTION) {
            const isChargeTarget = this.gameState.chargeTargets &&
                this.gameState.chargeTargets.some(u => u.id === clickedUnit.id);
            if (isChargeTarget && !sel.hasAttackedThisTurn && CHARGE_UNITS.includes(sel.type)) {
                this.handleCharge(sel, clickedUnit);
                return;
            }
        }

        // 1d) Chariot charge: a selected chariot clicks a tile at the end of one
        //     of its 4 orthogonal charge lanes to charge through it.
        if (sel && sel.owner === PLAYER_FACTION && tile && CHARIOT_CHARGE_UNITS.includes(sel.type) &&
            this.gameState.chariotChargeTargets && this.gameState.chariotChargeTargets.size) {
            const lane = this.gameState.chariotChargeTargets.get(`${tile.x},${tile.z}`);
            if (lane && !sel.hasMovedThisTurn && !sel.hasAttackedThisTurn) {
                this.handleChariotCharge(sel, lane.dx, lane.dz);
                return;
            }
        }

        // 2) Attack: a selected player unit clicks an enemy unit in attack range.
        if (sel && sel.owner === PLAYER_FACTION && clickedUnit && clickedUnit.owner !== PLAYER_FACTION) {
            const inRange = this.gameState.attackTargets.some(u => u.id === clickedUnit.id);
            if (inRange && !sel.hasAttackedThisTurn) { this.handleAttack(sel, clickedUnit); return; }
        }

        // 2b) Attack an exposed enemy lord: a selected player unit clicks an
        //     enemy lord with no bodyguard unit on its tile, in attack range.
        if (sel && sel.owner === PLAYER_FACTION && !sel.hasAttackedThisTurn &&
            clickedLord && clickedLord.owner !== PLAYER_FACTION) {
            const inRange = this.gameState.attackTargets.some(t => t.id === clickedLord.id);
            if (inRange) { this.handleAttack(sel, lordCombatant(clickedLord)); return; }
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
        if (this.spectateMode) return;
        const sel = this.gameState.selectedUnit;
        const selLord = this.gameState.selectedLord;
        const target = sel || selLord;
        if (!target || target.owner !== PLAYER_FACTION) return;
        const { tile } = this._resolveHit();
        if (!tile) return; // ignore unexplored tiles �?no goal intel on hidden terrain
        // Right-click the selection's own tile �?cancel its goal.
        if (target.x === tile.x && target.z === tile.z) {
            this.handleCancelGoal(target);
            return;
        }
        // Don't allow goals onto fortified enemy cities (can't move there).
        if (tile.terrain === 'CITY' && tile.owner !== PLAYER_FACTION && (tile.fortification || 0) > 0) {
            this.log('Cannot set a goal on a fortified enemy city �?besiege it first.');
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

        // Concealed units are ambushers-in-waiting: they cannot move or act
        // normally until they reveal themselves via handleReveal.
        const isConcealed = unit.concealState === 'concealed' || unit.concealState === 'concealing';

        if (!unit.hasMovedThisTurn && !isConcealed) {
            const reach = getReachableTiles(unit, this.tiles);
            for (const other of this.gameState.units.values()) {
                if (other.id === unit.id) continue;
                if (other.owner !== unit.owner) reach.delete(`${other.x},${other.z}`);
            }
            // Exclude fortified enemy cities from move targets �?UNLESS a
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
            // Only factions we're at war with may be attacked �?peace, trade
            // pact, and alliance units are never valid attack targets.
            const warTargets = getAttackTargets(unit, this.gameState.units)
                .filter(t => canAttack(this.gameState.diplomacy, unit.owner, t.owner));
            this.gameState.attackTargets = warTargets;
            // Lords/kings fight too: an EXPOSED enemy lord (no friendly unit
            // bodyguarding it on the same tile) within attack range can be
            // struck directly. A lord stacked with a unit is protected by that
            // unit (attack the unit first; once it dies the lord is exposed).
            const udef = UNIT_TYPE[unit.type];
            const range = (udef && udef.attackRange) || (udef && udef.ranged ? 2 : 1);
            for (const l of (this.gameState.lords || [])) {
                if (!l || l.owner === unit.owner) continue;
                if ((l.hp || 0) <= 0) continue;
                if (!canAttack(this.gameState.diplomacy, unit.owner, l.owner)) continue;
                const dist = Math.max(Math.abs(unit.x - l.x), Math.abs(unit.z - l.z));
                if (dist > range) continue;
                const guarded = [...this.gameState.units.values()].some(
                    u => u.owner === l.owner && u.x === l.x && u.z === l.z);
                if (guarded) continue;
                this.gameState.attackTargets.push(lordCombatant(l));
            }
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

        // Charge targets for cavalry: adjacent enemies that can be charged.
        this.gameState.chargeTargets = [];
        if (unit.owner === PLAYER_FACTION && !unit.hasAttackedThisTurn &&
            CHARGE_UNITS.includes(unit.type)) {
            for (const other of this.gameState.units.values()) {
                if (other.owner === unit.owner) continue;
                if (!canAttack(this.gameState.diplomacy, unit.owner, other.owner)) continue;
                const dist = Math.max(Math.abs(unit.x - other.x), Math.abs(unit.z - other.z));
                if (dist <= CHARGE_RANGE) {
                    this.gameState.chargeTargets.push(other);
                }
            }
        }

        // Chariot charge lanes: for a chariot that hasn't moved/acted, each of
        // the 4 orthogonal directions that contains at least one at-war enemy in
        // range becomes a chargeable lane. Map of destination tileKey -> {dx,dz}.
        this.gameState.chariotChargeTargets = new Map();
        if (unit.owner === PLAYER_FACTION && !unit.hasMovedThisTurn && !unit.hasAttackedThisTurn &&
            CHARIOT_CHARGE_UNITS.includes(unit.type)) {
            for (const lane of this._chariotChargeLanes(unit)) {
                this.gameState.chariotChargeTargets.set(`${lane.landX},${lane.landZ}`, lane);
            }
        }

        this.ui.showUnitInfo(unit);
        this.renderer.highlightMoveTargets(this.gameState.moveTargets);
        this.renderer.highlightAttackTargets(this.gameState.attackTargets);
        this.renderer.highlightBridgeTargets(this.gameState.bridgeTargets || []);
        if (this.renderer.highlightChariotChargeTargets) {
            this.renderer.highlightChariotChargeTargets(this.gameState.chariotChargeTargets);
        }
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
            // Lords move to empty tiles only �?not onto any unit (so clicking your
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
                // Lords/kings are land units �?they cannot walk on water, and
                // rivers are only passable where a bridge has been built. (Same
                // rule path.js applies to land units.) Without this, a player
                // could click a water tile and teleport a lord across the sea.
                if (t && (t.terrain === 'WATER' || (t.terrain === 'RIVER' && !t.bridge))) {
                    reach.delete(key);
                }
            }
            this.gameState.moveTargets = reach;
        } else {
            this.gameState.moveTargets.clear();
        }
        // Lords are melee combatants: they can attack adjacent at-war enemy
        // units, and exposed at-war enemy lords (a stacked enemy lord is
        // guarded by its unit and not directly targetable).
        this.gameState.attackTargets = [];
        if (!lord.hasAttackedThisTurn && lord.owner === PLAYER_FACTION) {
            for (const u of this.gameState.units.values()) {
                if (u.owner === lord.owner) continue;
                if (!canAttack(this.gameState.diplomacy, lord.owner, u.owner)) continue;
                if (Math.max(Math.abs(u.x - lord.x), Math.abs(u.z - lord.z)) <= 1) {
                    this.gameState.attackTargets.push(u);
                }
            }
            for (const other of (this.gameState.lords || [])) {
                if (!other || other === lord || other.owner === lord.owner) continue;
                if ((other.hp || 0) <= 0) continue;
                if (!canAttack(this.gameState.diplomacy, lord.owner, other.owner)) continue;
                if (Math.max(Math.abs(other.x - lord.x), Math.abs(other.z - lord.z)) > 1) continue;
                const guarded = [...this.gameState.units.values()].some(
                    u => u.owner === other.owner && u.x === other.x && u.z === other.z);
                if (guarded) continue;
                this.gameState.attackTargets.push(lordCombatant(other));
            }
        }

        this.ui.showLordInfo(lord);
        this.renderer.highlightMoveTargets(this.gameState.moveTargets);
        this.renderer.highlightAttackTargets(this.gameState.attackTargets);
        this.log(`Selected lord: ${lord.name} (Lv.${lord.level})${lord.isKing ? ' 👑' : ''}`);
    }

    moveLord(lord, x, z) {
        const destTile = this.tiles.get(`${x},${z}`);
        // Land units only: never let a lord/king step onto water or an unbridged
        // river, even if a stale move-target set slipped through.
        if (destTile && (destTile.terrain === 'WATER' || (destTile.terrain === 'RIVER' && !destTile.bridge))) {
            return;
        }
        lord.x = x;
        lord.z = z;
        lord.hasMovedThisTurn = true;
        const pool = this.gameState.resources[lord.owner];
        if (destTile && destTile.terrain === 'CITY' && destTile.owner !== lord.owner &&
            (canCaptureTile(lord.owner, destTile, pool) || this.siegeTowerAdjacentTo(destTile, lord.owner))) {
            pool.gold -= CAPTURE_COST;
            const prevOwner = destTile.owner;
            const wasNeutral = !prevOwner;
            captureCityTerritory(this.tiles, destTile, lord.owner, this.gameState.structures, this.gameState.buildings, this.gameState.buildingState).forEach(m => this.log(m));
            this._awardCaptureGrievances(destTile, lord.owner, prevOwner, wasNeutral);
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
            const prevOwner = destTile.owner;
            const wasNeutral = !prevOwner;
            captureCityTerritory(this.tiles, destTile, unit.owner, this.gameState.structures, this.gameState.buildings, this.gameState.buildingState).forEach(m => this.log(m));
            sfx.capture();
            this._awardCaptureGrievances(destTile, unit.owner, prevOwner, wasNeutral);
        }
        // Arrived at goal �?clear it.
        if (unit.goal && unit.goal.x === x && unit.goal.z === z) unit.goal = null;

        // Check for ambush trigger from concealed enemies.
        this._checkAmbushTrigger(unit, x, z);
        // Check for an enemy fall trap on the destination tile.
        this._checkFallTrap(unit);

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
        // A lord defender has no separate commanding lord (it IS the lord).
        const defenderLord = defender._isLord ? null : findCommandingLord(this.gameState.lords, defender);

        const result = resolveCombat(attacker, defender, terrain, attackerLord, defenderLord,
            this.gameState.buildings, this.gameState.lords, this.gameState.tempBonuses, false, this.gameState.structures,
            !!(defenderTile && defenderTile.terrain === 'CITY' && (defenderTile.fortification || 0) <= 0));
        result.messages.forEach(m => this.log(m));
        sfx.attack();

        this._playAttackAnimation(attacker, defender);
        attacker.hasAttackedThisTurn = true;

        const nameOf = (c) => c._isLord ? c.name : (UNIT_TYPE[c.type] && UNIT_TYPE[c.type].name) || c.type;
        if (result.defenderDied) {
            this._onCombatantDeath(defender);
            this.log(`${nameOf(defender)} destroyed!`);
            // Obsidian respawn-on-kill passive (only meaningful when killing a unit).
            this._maybeRespawnOnKill(attacker.owner);
        }
        if (result.attackerDied) {
            this._onCombatantDeath(attacker);
            this.log(`${nameOf(attacker)} destroyed!`);
            this.gameState.selectedUnit = null;
        }

        // Long-range siege engines (CATAPULT, TREBUCHET): AOE splash damage to
        // enemy units adjacent to the target, and a burn DoT on survivors.
        const atkDef = UNIT_TYPE[attacker.type];
        if (atkDef && atkDef.aoe) {
            this._applyAoeAndFire(attacker, defender, result.damageToDefender || 0);
            // Lobbed projectile + ground shockwave VFX (transient, self-retiring).
            if (this.renderer && this.renderer.addImpact) {
                this.renderer.addImpact(defender.x, defender.z, attacker.x, attacker.z);
            }
        }
        this.gameState.moveTargets.clear();
        this.gameState.attackTargets = [];
        this.renderer.clearHighlights();
        this.renderAll();
        this.ui.updateResourceBar();
        this.checkVictory();
    }

    /**
     * Play the right attack animation for an attacker vs defender pair.
     * Used for player attacks, AI attacks, lord attacks, charges, and ambushes.
     */
    _playAttackAnimation(attacker, defender) {
        if (!this.renderer) return;
        // Lord combatants don't have a rendered unit model, so skip animation.
        if (attacker._isLord) return;
        const def = UNIT_TYPE[attacker.type];
        const fx = this.renderer;
        if (def && def.ranged && ['ARCHER', 'LONGBOWMAN'].includes(attacker.type)) {
            fx.addArrowShot(attacker.id, attacker.x, attacker.z, defender.x, defender.z);
        } else if (CHARGE_UNITS.includes(attacker.type)) {
            fx.addCavalryCharge(attacker.id, attacker.x, attacker.z, defender.x, defender.z);
        } else {
            fx.addSwordLunge(attacker.id, attacker.x, attacker.z, defender.x, defender.z);
        }
    }

    /** Normalize a clicked target (a unit, a lord object, or an already-built
     *  lord combatant) into something resolveCombat can fight. Units are their
     *  own combatant; lord objects are wrapped via lordCombatant. */
    _asCombatant(target) {
        if (!target) return null;
        if (target._isLord) return target;            // already a combatant
        if (UNIT_TYPE[target.type]) return target;     // a real unit
        return lordCombatant(target);                 // a lord/king object
    }

    /** A lord/king attacks an adjacent enemy (a unit or another lord). The lord
     *  is the attacker, so it has no separate commanding lord; it can take
     *  counter-attack damage and die like any combatant. */
    handleLordAttack(lord, target) {
        if (!lord || lord.hasAttackedThisTurn || !target) return;
        if (!canAttack(this.gameState.diplomacy, lord.owner, target.owner)) {
            this.log(`Cannot attack: not at war with ${target.owner}!`);
            return;
        }
        const atk = lordCombatant(lord);
        const def = this._asCombatant(target);
        if (!atk || !def) return;
        const defenderTile = this.tiles.get(`${def.x},${def.z}`);
        const terrain = defenderTile ? defenderTile.terrain : 'PLAINS';
        const defenderLord = def._isLord ? null : findCommandingLord(this.gameState.lords, def);
        const result = resolveCombat(atk, def, terrain, null, defenderLord,
            this.gameState.buildings, this.gameState.lords, this.gameState.tempBonuses, false, this.gameState.structures,
            !!(defenderTile && defenderTile.terrain === 'CITY' && (defenderTile.fortification || 0) <= 0));
        result.messages.forEach(m => this.log(m));
        sfx.attack();
        this._playAttackAnimation(atk, def);
        lord.hasAttackedThisTurn = true;
        syncLordHp(atk); // resolveCombat already syncs, but be safe.

        const nameOf = (c) => c._isLord ? c.name : (UNIT_TYPE[c.type] && UNIT_TYPE[c.type].name) || c.type;
        if (result.defenderDied) {
            this._onCombatantDeath(def);
            this.log(`${nameOf(def)} destroyed by ${lord.name}!`);
        }
        if (result.attackerDied) {
            this._onCombatantDeath(atk);
            this.log(`${nameOf(atk)} fell in battle!`);
            this.gameState.selectedLord = null;
        }
        this.gameState.moveTargets.clear();
        this.gameState.attackTargets = [];
        this.renderer.clearHighlights();
        this.renderAll();
        this.ui.updateResourceBar();
        this.checkVictory();
    }

    /** Route a combatant death to the right cleanup: units via _onUnitDeath,
     *  lords/kings via _onLordDeath. */
    _onCombatantDeath(c) {
        if (!c) return;
        if (c._isLord) this._onLordDeath(c._lord);
        else this._onUnitDeath(c);
    }

    /** A lord/king has fallen. Removes the lord, frees its army, and �?if it was
     *  a king �?eliminates the faction (the king is the faction's leader). */
    _onLordDeath(lord) {
        if (!lord) return;
        const idx = this.gameState.lords.indexOf(lord);
        if (idx >= 0) this.gameState.lords.splice(idx, 1);
        // Disband the fallen lord's army: its units keep existing but lose their
        // commanding lord (and the stat/aura bonuses that came with it).
        for (const u of this.gameState.units.values()) {
            if (u.lordId === lord.id) u.lordId = null;
        }
        const wasKing = !!lord.isKing;
        const title = wasKing ? 'King' : 'Lord';
        const nm = lord.name || title;
        this.log(`${title} ${nm} has fallen in battle!`);
        if (wasKing) this._onKingDeath(lord);
    }

    /** A faction's king has died �?the faction is eliminated. Its units are
     *  removed and its cities go neutral so they can be recaptured. */
    _onKingDeath(king) {
        const f = king.owner;
        const name = this.factionColors[f] ? this.factionColors[f].name : f;
        if (!this.gameState.eliminated) this.gameState.eliminated = new Set();
        if (this.gameState.eliminated.has(f)) return;
        this.gameState.eliminated.add(f);
        this.log(`${name}'s king has fallen �?${name} is eliminated!`);
        // Remove the faction's remaining units and lords.
        for (const u of [...this.gameState.units.values()]) {
            if (u.owner === f) this._onUnitDeath(u);
        }
        this.gameState.lords = (this.gameState.lords || []).filter(l => l.owner !== f);
        // Its cities become neutral (open for conquest).
        for (const t of this.tiles.values()) {
            if (t.owner === f) { t.owner = null; t.loyalty = 0; }
        }
        // Its defensive structures collapse with the faction.
        if (this.gameState.structures) {
            for (const [skey, s] of [...this.gameState.structures]) {
                if (s.owner === f) this.gameState.structures.delete(skey);
            }
        }
        sfx.defeat();
        this.checkVictory();
    }

    // --- Cavalry Charge System ---
    /**
     * A cavalry unit charges an adjacent enemy, moving onto their tile and
     * attacking with a bonus. After charging, the unit cannot move for the
     * rest of the turn.
     */
    handleCharge(attacker, defender) {
        if (!attacker || !defender) return;
        if (!CHARGE_UNITS.includes(attacker.type)) {
            this.log('Only cavalry units can charge.');
            return;
        }
        if (attacker.hasAttackedThisTurn) {
            this.log('This unit has already acted this turn.');
            return;
        }
        if (!canAttack(this.gameState.diplomacy, attacker.owner, defender.owner)) {
            this.log('Cannot charge: not at war with that faction!');
            return;
        }
        // Check range (must be adjacent)
        const dist = Math.max(Math.abs(attacker.x - defender.x), Math.abs(attacker.z - defender.z));
        if (dist > CHARGE_RANGE) {
            this.log('Target is too far to charge.');
            return;
        }
        // Move attacker to defender's tile
        attacker.x = defender.x;
        attacker.z = defender.z;
        this.log(`🐎 ${UNIT_TYPE[attacker.type].name} charges ${UNIT_TYPE[defender.type].name}!`);
        // Traps and spiked defenses punish the charge before the blow lands.
        this._checkFallTrap(attacker);
        const survivedCharge = this.gameState.units.has(attacker.id) && this._applySpikesOnCharge(attacker);
        if (!survivedCharge) {
            this.gameState.moveTargets.clear();
            this.gameState.attackTargets = [];
            this.gameState.chargeTargets = [];
            this.renderer.clearHighlights();
            this.renderAll();
            this.ui.updateResourceBar();
            this.checkVictory();
            return;
        }
        sfx.attack();
        this._playAttackAnimation(attacker, defender);
        // Apply charge bonus temporarily. Polish Winged Hussars passive adds
        // extra charge damage on top of the base charge bonus.
        const originalAttack = attacker.attack ?? UNIT_TYPE[attacker.type].attack;
        const cdef = this.factionDefs ? this.factionDefs[attacker.owner] : null;
        attacker.attack = originalAttack + CHARGE_ATTACK_BONUS + getCavalryChargeBonus(cdef);
        // Execute combat
        const defenderTile = this.tiles.get(`${defender.x},${defender.z}`);
        const terrain = defenderTile ? defenderTile.terrain : 'PLAINS';
        const attackerLord = findCommandingLord(this.gameState.lords, attacker);
        const defenderLord = findCommandingLord(this.gameState.lords, defender);
        const result = resolveCombat(attacker, defender, terrain, attackerLord, defenderLord,
            this.gameState.buildings, this.gameState.lords, this.gameState.tempBonuses, false, this.gameState.structures,
            !!(defenderTile && defenderTile.terrain === 'CITY' && (defenderTile.fortification || 0) <= 0));
        result.messages.forEach(m => this.log(m));
        // Restore original attack
        attacker.attack = originalAttack;
        // Mark as acted (both move and attack used). Charging exhausts the
        // cavalry: it can't move next turn and is vulnerable to ranged fire.
        attacker.hasAttackedThisTurn = true;
        attacker.hasMovedThisTurn = true;
        attacker.chargeExhausted = CHARGE_EXHAUST_TURNS;
        this.log(`🐎 ${UNIT_TYPE[attacker.type].name} is exhausted �?cannot move next turn, vulnerable to ranged fire.`);
        // Handle deaths
        if (result.defenderDied) {
            this._onUnitDeath(defender);
            this.log(`${UNIT_TYPE[defender.type].name} destroyed!`);
            this._maybeRespawnOnKill(attacker.owner);
        }
        if (result.attackerDied) {
            this._onUnitDeath(attacker);
            this.log(`${UNIT_TYPE[attacker.type].name} destroyed in charge!`);
        }
        this.gameState.moveTargets.clear();
        this.gameState.attackTargets = [];
        this.gameState.chargeTargets = [];
        this.renderer.clearHighlights();
        this.renderAll();
        this.ui.updateResourceBar();
        this.checkVictory();
    }

    /** Compute the chariot's available charge lanes: for each of the 4
     *  orthogonal directions, scan up to CHARIOT_CHARGE_RANGE tiles. A lane is
     *  valid if it contains at least one at-war enemy and the path to (and
     *  including) the enemy is over passable, in-bounds terrain. Returns an
     *  array of { dx, dz, landX, landZ, hits: [unit] } where (landX,landZ) is
     *  the tile the chariot ends on (last passable tile reached along the lane). */
    _chariotChargeLanes(unit) {
        const lanes = [];
        const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
        for (const [dx, dz] of dirs) {
            const hits = [];
            let landX = unit.x, landZ = unit.z;
            let blocked = false;
            for (let step = 1; step <= CHARIOT_CHARGE_RANGE; step++) {
                const cx = unit.x + dx * step, cz = unit.z + dz * step;
                const t = this.tiles.get(`${cx},${cz}`);
                if (!t || !isPassable(t)) { blocked = true; break; }
                // A fortified enemy city blocks the lane (can't trample walls).
                if (t.terrain === 'CITY' && t.owner && t.owner !== unit.owner &&
                    (t.fortification || 0) > 0) { blocked = true; break; }
                const enemy = this._unitAt(cx, cz);
                if (enemy && enemy.owner !== unit.owner &&
                    canAttack(this.gameState.diplomacy, unit.owner, enemy.owner)) {
                    hits.push(enemy);
                }
                landX = cx; landZ = cz;
                // Stop advancing past a friendly-occupied tile (can't overrun allies).
                if (enemy && enemy.owner === unit.owner) { landX = unit.x + dx * (step - 1); landZ = unit.z + dz * (step - 1); break; }
            }
            void blocked;
            if (hits.length) lanes.push({ dx, dz, landX, landZ, hits });
        }
        return lanes;
    }

    /** Return the unit standing on (x,z), if any. */
    _unitAt(x, z) {
        for (const u of this.gameState.units.values()) {
            if (u.x === x && u.z === z) return u;
        }
        return null;
    }

    /** Execute a chariot charge in orthogonal direction (dx,dz). Every enemy in
     *  the lane is struck with a bonus (extra vs infantry/artillery). The
     *  chariot ends on the last passable tile and is stunned for
     *  CHARIOT_CHARGE_STUN_TURNS turns. Works for player and AI (isAI skips UI). */
    handleChariotCharge(attacker, dx, dz, isAI = false) {
        if (!attacker) return false;
        if (!CHARIOT_CHARGE_UNITS.includes(attacker.type)) {
            if (!isAI) this.log('Only chariots can perform a charge.');
            return false;
        }
        if (attacker.hasMovedThisTurn || attacker.hasAttackedThisTurn) {
            if (!isAI) this.log('A chariot cannot move and charge on the same turn.');
            return false;
        }
        // Recompute the lane fresh so we act on current state.
        const lane = this._chariotChargeLanes(attacker).find(l => l.dx === dx && l.dz === dz);
        if (!lane || !lane.hits.length) {
            if (!isAI) this.log('No valid charge target in that direction.');
            return false;
        }
        this.log(`🛞 ${UNIT_TYPE[attacker.type].name} #${attacker.id} charges ${lane.hits.length} enemy target(s)!`);
        sfx.attack();
        const originalAttack = attacker.attack ?? UNIT_TYPE[attacker.type].attack;
        // Strike each enemy in the lane (nearest first).
        const ordered = lane.hits.slice().sort((a, b) =>
            (Math.abs(a.x - attacker.x) + Math.abs(a.z - attacker.z)) -
            (Math.abs(b.x - attacker.x) + Math.abs(b.z - attacker.z)));
        for (const defender of ordered) {
            if (!this.gameState.units.has(attacker.id)) break;   // chariot died mid-lane
            if (!this.gameState.units.has(defender.id)) continue; // already dead
            const vuln = CHARIOT_CHARGE_VULN_TYPES.includes(defender.type);
            const bonus = CHARIOT_CHARGE_ATTACK_BONUS +
                (vuln ? Math.round(originalAttack * (CHARIOT_CHARGE_VULN_MULT - 1)) : 0);
            attacker.attack = originalAttack + bonus;
            const defTile = this.tiles.get(`${defender.x},${defender.z}`);
            const terrain = defTile ? defTile.terrain : 'PLAINS';
            const atkLord = findCommandingLord(this.gameState.lords, attacker);
            const defLord = findCommandingLord(this.gameState.lords, defender);
            // Charge is a one-sided smash: no counter-attack (noCounter=true).
            const result = resolveCombat(attacker, defender, terrain, atkLord, defLord,
                this.gameState.buildings, this.gameState.lords, this.gameState.tempBonuses,
                false, this.gameState.structures,
                !!(defTile && defTile.terrain === 'CITY' && (defTile.fortification || 0) <= 0), true);
            result.messages.forEach(m => this.log(m));
            attacker.attack = originalAttack;
            if (result.defenderDied) {
                this._onUnitDeath(defender);
                this.log(`${UNIT_TYPE[defender.type].name} destroyed by the charge!`);
                this._maybeRespawnOnKill(attacker.owner);
            }
            if (result.attackerDied) {
                this._onUnitDeath(attacker);
                this.log(`${UNIT_TYPE[attacker.type].name} destroyed during the charge!`);
                break;
            }
        }
        // Move the chariot to the landing tile if it survived and the tile is free.
        if (this.gameState.units.has(attacker.id)) {
            const occupant = this._unitAt(lane.landX, lane.landZ);
            if (!occupant || occupant.id === attacker.id) {
                attacker.x = lane.landX;
                attacker.z = lane.landZ;
            }
            this._checkFallTrap(attacker);
            // Charging exhausts the chariot: stunned (no move/attack) for 2 turns.
            attacker.hasMovedThisTurn = true;
            attacker.hasAttackedThisTurn = true;
            attacker.stunnedTurns = Math.max(attacker.stunnedTurns || 0, CHARIOT_CHARGE_STUN_TURNS);
            this.log(`🛞 ${UNIT_TYPE[attacker.type].name} #${attacker.id} is stunned for ${CHARIOT_CHARGE_STUN_TURNS} turns after charging.`);
        }
        this.gameState.moveTargets.clear();
        this.gameState.attackTargets = [];
        this.gameState.chargeTargets = [];
        this.gameState.chariotChargeTargets = new Map();
        this.renderer.clearHighlights();
        this.renderAll();
        this.ui.updateResourceBar();
        this.checkVictory();
        return true;
    }

    // --- Concealment / Ambush System ---
    /**
     * Check if a unit is currently visible to any enemy faction.
     */
    _isInEnemyVision(unit) {
        for (const other of this.gameState.units.values()) {
            if (other.owner === unit.owner) continue;
            if (other.concealState === 'concealed') continue; // concealed units don't provide vision
            if (canAttack(this.gameState.diplomacy, unit.owner, other.owner)) {
                const vision = (UNIT_TYPE[other.type] && UNIT_TYPE[other.type].vision) || 3;
                const dist = Math.max(Math.abs(unit.x - other.x), Math.abs(unit.z - other.z));
                if (dist <= vision) return true;
            }
        }
        for (const t of this.tiles.values()) {
            if (t.terrain === 'CITY' && t.owner && t.owner !== unit.owner) {
                if (canAttack(this.gameState.diplomacy, unit.owner, t.owner)) {
                    const dist = Math.max(Math.abs(unit.x - t.x), Math.abs(unit.z - t.z));
                    if (dist <= cityRadius(t)) return true;
                }
            }
        }
        return false;
    }

    /**
     * A unit begins concealing itself in the current tile's terrain.
     * When isAI is true, the player-owner guard and UI feedback are skipped
     * so the AI can use the same logic.
     */
    handleConceal(unit, isAI = false) {
        if (!unit || (!isAI && unit.owner !== PLAYER_FACTION)) return;
        if (unit.hasMovedThisTurn || unit.hasAttackedThisTurn) {
            if (!isAI) this.log('Unit must not have acted this turn to conceal.');
            return;
        }
        const tile = this.tiles.get(`${unit.x},${unit.z}`);
        if (!tile || !CONCEAL_TERRAINS.includes(tile.terrain)) {
            this.log('Can only conceal in mountains or forests.');
            return;
        }
        if (this._isInEnemyVision(unit)) {
            this.log('Cannot conceal while in enemy vision!');
            return;
        }
        const tileKey = `${unit.x},${unit.z}`;
        const concealed = this.gameState.concealedUnits.get(tileKey) || [];
        if (concealed.length >= CONCEAL_MAX_PER_TILE) {
            this.log('This tile already has maximum concealed units.');
            return;
        }
        const turnsNeeded = tile.terrain === 'MOUNTAIN' ? CONCEAL_TURNS_MOUNTAIN : CONCEAL_TURNS_FOREST;
        unit.concealState = 'concealing';
        unit.concealTurnsLeft = turnsNeeded;
        unit.concealTerrain = tile.terrain;
        unit.hasAttackedThisTurn = true;
        this.log(`${UNIT_TYPE[unit.type].name} begins concealing in ${tile.terrain.toLowerCase()} (${turnsNeeded} turn(s)).`);
        sfx.click();
        this.renderAll();
    }

    /**
     * Tick concealment progress for all units at turn start.
     */
    _tickConcealment() {
        for (const unit of this.gameState.units.values()) {
            // Decrement the post-reveal cooldown so a unit that timed out of
            // concealment can eventually hide again.
            if (unit.concealCooldown && unit.concealCooldown > 0) unit.concealCooldown--;
            if (unit.concealState === 'concealing') {
                if (this._isInEnemyVision(unit)) {
                    unit.concealState = null;
                    unit.concealTurnsLeft = 0;
                    unit.concealTerrain = null;
                    this.log(`${UNIT_TYPE[unit.type].name}'s concealment was interrupted by enemy vision!`);
                    continue;
                }
                unit.concealTurnsLeft--;
                if (unit.concealTurnsLeft <= 0) {
                    unit.concealState = 'concealed';
                    unit.concealTurnsElapsed = 0;
                    const tileKey = `${unit.x},${unit.z}`;
                    const concealed = this.gameState.concealedUnits.get(tileKey) || [];
                    if (!concealed.includes(unit.id)) concealed.push(unit.id);
                    this.gameState.concealedUnits.set(tileKey, concealed);
                    this.log(`${UNIT_TYPE[unit.type].name} is now fully concealed!`);
                } else {
                    this.log(`${UNIT_TYPE[unit.type].name}: ${unit.concealTurnsLeft} turn(s) until concealed.`);
                }
            } else if (unit.concealState === 'concealed') {
                // Concealment timeout: if no enemy ever approaches, a hidden
                // unit eventually gives up the ambush and advances. Without
                // this, two AIs that conceal their front lines stare at each
                // other forever. On timeout, reveal and set a cooldown so the
                // AI advances for a few turns before it can re-conceal.
                unit.concealTurnsElapsed = (unit.concealTurnsElapsed || 0) + 1;
                if (unit.concealTurnsElapsed >= CONCEAL_MAX_TURNS) {
                    unit.concealState = null;
                    unit.concealTerrain = null;
                    unit.concealTurnsElapsed = 0;
                    unit.concealCooldown = CONCEAL_REVEAL_COOLDOWN;
                    const tileKey = `${unit.x},${unit.z}`;
                    const concealed = this.gameState.concealedUnits.get(tileKey) || [];
                    this.gameState.concealedUnits.set(tileKey, concealed.filter(id => id !== unit.id));
                    this.log(`${UNIT_TYPE[unit.type].name} gave up its ambush and advanced after lying in wait.`);
                }
            }
        }
    }

    /**
     * Check if a moving unit triggers an ambush from concealed enemies.
     */
    _checkAmbushTrigger(movingUnit, x, z) {
        for (let dx = -1; dx <= 1; dx++) {
            for (let dz = -1; dz <= 1; dz++) {
                const checkX = x + dx, checkZ = z + dz;
                const tileKey = `${checkX},${checkZ}`;
                const concealed = this.gameState.concealedUnits.get(tileKey) || [];
                for (const unitId of concealed) {
                    const ambusher = this.gameState.units.get(unitId);
                    if (!ambusher) continue;
                    if (ambusher.owner === movingUnit.owner) continue;
                    if (!canAttack(this.gameState.diplomacy, ambusher.owner, movingUnit.owner)) continue;
                    if (ambusher.owner === PLAYER_FACTION) {
                        this.gameState.pendingAmbush = {
                            ambusherId: unitId,
                            targetId: movingUnit.id,
                            fromTile: tileKey
                        };
                        this.log(`⚠️ Ambush opportunity! ${UNIT_TYPE[ambusher.type].name} can surprise attack!`);
                    } else {
                        this._executeAmbush(ambusher, movingUnit);
                    }
                    return;
                }
            }
        }
    }

    /**
     * Execute an ambush attack with bonuses.
     */
    _executeAmbush(ambusher, target) {
        ambusher.concealState = null;
        ambusher.concealTerrain = null;
        const tileKey = `${ambusher.x},${ambusher.z}`;
        const concealed = this.gameState.concealedUnits.get(tileKey) || [];
        this.gameState.concealedUnits.set(tileKey, concealed.filter(id => id !== ambusher.id));
        const originalAttack = ambusher.attack ?? UNIT_TYPE[ambusher.type].attack;
        ambusher.attack = originalAttack + AMBUSH_ATTACK_BONUS;
        this.log(`🗡�?${UNIT_TYPE[ambusher.type].name} ambushes ${UNIT_TYPE[target.type].name}! (+${AMBUSH_ATTACK_BONUS} attack)`);
        this.handleAttack(ambusher, target);
        ambusher.attack = originalAttack;
    }

    /**
     * Player confirms ambush attack.
     */
    handleAmbushConfirm() {
        const ambush = this.gameState.pendingAmbush;
        if (!ambush) return;
        const ambusher = this.gameState.units.get(ambush.ambusherId);
        const target = this.gameState.units.get(ambush.targetId);
        if (!ambusher || !target) return;
        this._executeAmbush(ambusher, target);
        this.gameState.pendingAmbush = null;
    }

    /**
     * Player declines ambush (stays concealed).
     */
    handleAmbushDecline() {
        this.gameState.pendingAmbush = null;
        this.log('Ambush opportunity passed.');
    }

    /**
     * A concealed player unit reveals itself to make a single surprise attack
     * on an adjacent enemy. Revealing uses the unit's action and move for the turn.
     */
    handleReveal(unit, dir) {
        if (!unit || unit.owner !== PLAYER_FACTION) return;
        if (unit.concealState !== 'concealed') {
            this.log('Unit is not concealed.');
            return;
        }
        // dir is one of: 'n','s','e','w' or a {dx,dz} object from the UI.
        let dx = 0, dz = 0;
        if (typeof dir === 'string') {
            if (dir === 'n') dz = -1;
            else if (dir === 's') dz = 1;
            else if (dir === 'e') dx = 1;
            else if (dir === 'w') dx = -1;
        } else if (dir && typeof dir.dx === 'number' && typeof dir.dz === 'number') {
            dx = dir.dx; dz = dir.dz;
        }
        if (dx === 0 && dz === 0) {
            this.log('Choose an adjacent direction to reveal and attack.');
            return;
        }
        const targetX = unit.x + dx, targetZ = unit.z + dz;
        const targetTile = this.tiles.get(`${targetX},${targetZ}`);
        if (!targetTile) {
            this.log('Target tile is off the map.');
            return;
        }
        // Find an at-war enemy unit or exposed lord on that tile.
        let target = null;
        for (const u of this.gameState.units.values()) {
            if (u.x === targetX && u.z === targetZ && u.owner !== PLAYER_FACTION &&
                canAttack(this.gameState.diplomacy, PLAYER_FACTION, u.owner)) {
                target = u; break;
            }
        }
        if (!target) {
            for (const l of this.gameState.lords) {
                if (l.x === targetX && l.z === targetZ && l.owner !== PLAYER_FACTION &&
                    canAttack(this.gameState.diplomacy, PLAYER_FACTION, l.owner)) {
                    const guarded = [...this.gameState.units.values()].some(
                        u => u.owner === l.owner && u.x === l.x && u.z === l.z);
                    if (!guarded) { target = lordCombatant(l); break; }
                }
            }
        }
        if (!target) {
            this.log('No enemy target in that direction.');
            return;
        }
        this._executeAmbush(unit, target);
        unit.hasMovedThisTurn = true;
        this.renderAll();
        this.ui.updateResourceBar();
    }

    /**
     * UI wrapper for charge: look up the target by id and perform the charge.
     */
    handleChargeById(attacker, targetId) {
        if (!attacker || !targetId) return;
        const defender = this.gameState.units.get(targetId);
        if (!defender) return;
        this.handleCharge(attacker, defender);
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
        // Trigger AOE impact visual: expanding ring + lobbed projectile.
        if (this.renderer && this.renderer.addImpact) {
            this.renderer.addImpact(primary.x, primary.z, attacker.x, attacker.z);
        }
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

    /** An Archer/Longbowman looses arrows at an enemy fortified city within range,
     *  chipping its fortification by a nerfed amount (bows harass, not breach).
     *  Uses the unit's attack action for the turn. */
    handleArrowBombard(unit, cityTile) {
        if (!unit || unit.owner !== PLAYER_FACTION || !RANGED_BOMBARD_TYPES.includes(unit.type)) return;
        if (unit.hasAttackedThisTurn) { this.log('This unit has already acted this turn.'); return; }
        if (!cityTile || cityTile.terrain !== 'CITY' || cityTile.owner === PLAYER_FACTION) return;
        if (!canAttack(this.gameState.diplomacy, PLAYER_FACTION, cityTile.owner)) {
            this.log('Cannot bombard: not at war with that faction.'); return;
        }
        const fort = cityTile.fortification || 0;
        if (fort <= 0) { this.log('That city is already breached.'); return; }
        cityTile.fortification = Math.max(0, fort - RANGED_BOMBARD_FORT_DAMAGE);
        unit.hasAttackedThisTurn = true;
        sfx.attack();
        this.log(`🏹 ${UNIT_TYPE[unit.type].name} bombards city [${cityTile.x}, ${cityTile.z}] �?fortification ${cityTile.fortification}/${cityTile.fortMax}.`);
        if (cityTile.fortification === 0) this.log(`City [${cityTile.x}, ${cityTile.z}] is BREACHED �?it can now be captured!`);
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
        // when the location is invalid (already a city, water, mountain, river�?.
        if (tile.terrain === before && tile.terrain !== 'CITY') {
            if (msgs.length) this.log(msgs[0]);
            return;
        }
        msgs.forEach(m => this.log(m));
        sfx.capture();
        // The tile's terrain changed (PLAINS -> CITY); rebuild its mesh so the
        // keep/flag scenery appears (the base mesh was built for the old terrain).
        this.renderer.updateTileTerrain(tile);
        // Civ6 border tension: founding too close to a neighbor angers them.
        this._awardFoundGrievances(tile, PLAYER_FACTION);
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
        this.log(`🔨 Engineer #${engineer.id} started a Siege Tower near [${target.x}, ${target.z}] �?ready in ${SIEGE_TOWER_BUILD_TURNS} turns.`);
        this.ui.showUnitInfo(engineer);
        this.renderAll();
        this.ui.updateResourceBar();
    }

    /** An Engineer starts constructing a field Catapult or Trebuchet.
     *  Pays the unit cost up front; the engine spawns after its buildTurns.
     *  This is the player-side handler for the UI siege-engine buttons. */
    handleBuildSiegeEngine(unit, engineType) {
        if (!unit || unit.type !== 'ENGINEER' || unit.owner !== PLAYER_FACTION) return;
        if (!SIEGE_ENGINES.includes(engineType)) { this.log('Invalid siege engine type.'); return; }
        if (unit.hasAttackedThisTurn) { this.log('This engineer has already acted this turn.'); return; }
        if (this.gameState.construction && this.gameState.construction.has(unit.id)) {
            this.log('This engineer is already building something.'); return;
        }
        const def = this.factionDefs[PLAYER_FACTION];
        const cost = getUnitCostFor(engineType, def);
        const pool = this.gameState.resources.player;
        if (!canAfford(engineType, pool, cost)) { this.log('Not enough resources to build this siege engine.'); return; }
        this.gameState.resources.player = spendCost(engineType, pool, cost);
        const buildTurns = UNIT_TYPE[engineType].buildTurns || 2;
        this.gameState.construction.set(unit.id, {
            type: 'SIEGE_ENGINE', engineType,
            turnsLeft: buildTurns,
            x: unit.x, z: unit.z, faction: PLAYER_FACTION
        });
        unit.hasAttackedThisTurn = true;
        sfx.besiege();
        this.log(`🔨 Engineer #${unit.id} started building a ${UNIT_TYPE[engineType].name} �?ready in ${buildTurns} turns.`);
        this.ui.showUnitInfo(unit);
        this.renderAll();
        this.ui.updateResourceBar();
    }

    /** An Engineer starts constructing a defensive structure (SPIKES,
     *  FORTIFICATION, or FALL_TRAP) on its current tile. The tile must be owned,
     *  within a city's influence, and free of an existing structure. Pays
     *  STRUCTURE_COST up front; the structure completes after buildTurns. */
    handleBuildStructure(engineer, structureType) {
        // Any unit with the canBuildStructure flag (Engineer, Legionnaire) may
        // build defensive structures on its current tile.
        if (!engineer || engineer.owner !== PLAYER_FACTION) return;
        const usd = UNIT_TYPE[engineer.type];
        if (!usd || !usd.canBuildStructure) return;
        const sdef = STRUCTURE_TYPE[structureType];
        if (!sdef) { this.log('Invalid structure type.'); return; }
        if (engineer.hasAttackedThisTurn) { this.log('This engineer has already acted this turn.'); return; }
        if (this.gameState.construction && this.gameState.construction.has(engineer.id)) {
            this.log('This engineer is already building something.'); return;
        }
        const tile = this.tiles.get(`${engineer.x},${engineer.z}`);
        if (!tile) return;
        if (tile.owner !== PLAYER_FACTION) { this.log('Structures can only be built on your own tiles.'); return; }
        if (tile.terrain === 'WATER' || tile.terrain === 'RIVER') { this.log('Cannot build a structure on water.'); return; }
        if (tile.terrain === 'CITY') { this.log('Cities are already fortified �?build structures on the surrounding land.'); return; }
        const skey = `${tile.x},${tile.z}`;
        if (this.gameState.structures && this.gameState.structures.has(skey)) {
            this.log('There is already a structure on this tile.'); return;
        }
        const influence = getInfluencedTiles(this.tiles, PLAYER_FACTION, CITY_INFLUENCE_RADIUS);
        if (influence && !influence.has(skey)) {
            this.log('Structures must be built within a city\'s influence.'); return;
        }
        const cost = STRUCTURE_COST[structureType] || {};
        const pool = this.gameState.resources.player;
        for (const [res, amt] of Object.entries(cost)) {
            if ((pool[res] || 0) < amt) { this.log(`Not enough resources to build ${sdef.name}.`); return; }
        }
        for (const [res, amt] of Object.entries(cost)) pool[res] = (pool[res] || 0) - amt;
        this.gameState.construction.set(engineer.id, {
            type: 'STRUCTURE', structureType,
            turnsLeft: sdef.buildTurns || 2,
            x: tile.x, z: tile.z, faction: PLAYER_FACTION
        });
        engineer.hasAttackedThisTurn = true; // starting construction uses the action
        sfx.besiege();
        this.log(`🔨 Engineer #${engineer.id} started building ${sdef.name} at [${tile.x}, ${tile.z}] �?ready in ${sdef.buildTurns || 2} turns.`);
        this.ui.showUnitInfo(engineer);
        this.renderAll();
        this.ui.updateResourceBar();
    }

    /** Fall-trap check after a unit enters a tile by any means (move, goal
     *  auto-step, charge). An enemy FALL_TRAP on the tile springs: the unit
     *  takes damage and is stunned (skips its next turn), and the trap is
     *  consumed. Friendly structures do nothing. */
    _checkFallTrap(unit) {
        if (!unit || !this.gameState.structures) return;
        const skey = `${unit.x},${unit.z}`;
        const s = this.gameState.structures.get(skey);
        if (!s || s.type !== 'FALL_TRAP' || s.owner === unit.owner) return;
        const dmg = (STRUCTURE_TYPE.FALL_TRAP && STRUCTURE_TYPE.FALL_TRAP.damage) || 3;
        unit.hp -= dmg;
        unit.stunnedTurns = Math.max(unit.stunnedTurns || 0, 1);
        this.gameState.structures.delete(skey); // a fall trap is one-shot
        const name = UNIT_TYPE[unit.type] ? UNIT_TYPE[unit.type].name : unit.type;
        this.log(`🪤 ${name} #${unit.id} triggered a fall trap at [${unit.x}, ${unit.z}] �?${dmg} damage and stunned for a turn!`);
        if (unit.hp <= 0) {
            this._onUnitDeath(unit);
            this.log(`${name} #${unit.id} was killed by the fall trap!`);
        }
    }

    /** True if an enemy warship is orthogonally adjacent to (cx,cz), blockading
     *  the harbor and preventing ship production. */
    _isHarborBlockaded(cx, cz) {
        for (const u of this.gameState.units.values()) {
            if (u.owner === PLAYER_FACTION || u.boarded) continue;
            const def = UNIT_TYPE[u.type];
            if (!def || !def.naval) continue;
            if (u.type === 'TRANSPORT') continue;
            if (Math.abs(u.x - cx) + Math.abs(u.z - cz) === 1) return true;
        }
        return false;
    }

    /** Spikes check for a cavalry charge: if the tile the charger storms onto
     *  has enemy SPIKES, the charger is impaled before its blow lands.
     *  Returns true if the charger survives (false if the spikes killed it). */
    _applySpikesOnCharge(attacker) {
        if (!attacker || !this.gameState.structures) return true;
        const s = this.gameState.structures.get(`${attacker.x},${attacker.z}`);
        if (!s || s.type !== 'SPIKES' || s.owner === attacker.owner) return true;
        const dmg = (STRUCTURE_TYPE.SPIKES && STRUCTURE_TYPE.SPIKES.damageVsCavalry) || 4;
        attacker.hp -= dmg;
        const name = UNIT_TYPE[attacker.type] ? UNIT_TYPE[attacker.type].name : attacker.type;
        this.log(`🦔 ${name} #${attacker.id} charges into spiked defenses �?takes ${dmg} damage! (HP ${Math.max(0, attacker.hp)}/${attacker.maxHp})`);
        if (attacker.hp <= 0) {
            this._onUnitDeath(attacker);
            this.log(`${name} #${attacker.id} was impaled on the spikes!`);
            return false;
        }
        return true;
    }

    /** A unit joins a lord's army if the lord has command capacity. */
    handleJoinArmy(unit, lord) {
        if (!unit || !lord) return;
        if (unit.owner !== PLAYER_FACTION || lord.owner !== PLAYER_FACTION) {
            this.log('Only your own units can join your lords.'); return;
        }
        if (unit.type === 'SETTLER' || unit.type === 'WORKER') {
            this.log('Settlers and workers cannot join armies.'); return;
        }
        if (unit.x !== lord.x || unit.z !== lord.z) {
            this.log('Unit must be on the same tile as the lord.'); return;
        }
        if (!canCommand(lord)) {
            this.log(`${lord.name} cannot command more units.`); return;
        }
        if ((lord.army || []).includes(unit.id)) {
            this.log('This unit is already in the lord\'s army.'); return;
        }
        assignArmy(lord, unit.id);
        unit.lordId = lord.id;
        this.log(`${UNIT_TYPE[unit.type].name} #${unit.id} joined ${lord.name}'s army (${lord.army.length}/${maxArmySize(lord)}).`);
        sfx.click();
        this.ui.showUnitInfo(unit);
        this.renderAll();
    }

    /** An Engineer starts constructing Ladders near an enemy city.
     *  Pays LADDER_COST up front; ladders complete after LADDER_BUILD_TURNS.
     *  Ladders allow infantry to assault fortified cities (cheaper alternative to siege tower). */
    handleBuildLadder(engineer) {
        if (!engineer || engineer.type !== 'ENGINEER' || engineer.owner !== PLAYER_FACTION) return;
        if (engineer.hasAttackedThisTurn) { this.log('This engineer has already acted this turn.'); return; }
        if (this.gameState.construction && this.gameState.construction.has(engineer.id)) {
            this.log('This engineer is already building something.'); return;
        }
        const target = this._siegeTargetNear(engineer, LADDER_BUILD_RADIUS);
        if (!target) { this.log('No enemy city nearby to build ladders against.'); return; }
        const pool = this.gameState.resources.player;
        for (const [res, amt] of Object.entries(LADDER_COST)) {
            if ((pool[res] || 0) < amt) { this.log('Not enough resources to build ladders.'); return; }
        }
        for (const [res, amt] of Object.entries(LADDER_COST)) pool[res] = (pool[res] || 0) - amt;
        this.gameState.construction.set(engineer.id, {
            type: 'LADDER', turnsLeft: LADDER_BUILD_TURNS,
            x: engineer.x, z: engineer.z, faction: PLAYER_FACTION,
            targetCity: `${target.x},${target.z}`
        });
        engineer.hasAttackedThisTurn = true; // starting construction uses the action
        sfx.besiege();
        this.log(`🪜 Engineer #${engineer.id} started building Ladders near [${target.x}, ${target.z}] �?ready in ${LADDER_BUILD_TURNS} turn.`);
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
        this.log(`�?Unit #${unit.id} (${unit.type}) disembarked at [${dest.x}, ${dest.z}].`);
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

    /** Tick one faction's in-progress construction projects: decrement the
     *  counter and spawn the unit when it finishes. Handles Siege Towers and
     *  field-built siege engines (Catapult/Trebuchet). */
    _tickConstructionFor(faction) {
        if (!this.gameState.construction || this.gameState.construction.size === 0) return;
        const def = this.factionDefs[faction];
        const factionName = this.factionColors[faction] ? this.factionColors[faction].name : faction;
        for (const [engId, proj] of [...this.gameState.construction]) {
            if (proj.faction !== faction) continue;
            proj.turnsLeft--;
            if (proj.turnsLeft <= 0) {
                const tile = this.tiles.get(`${proj.x},${proj.z}`);
                if (proj.type === 'STRUCTURE') {
                    // Engineer defensive structure completes on its tile �?only
                    // if the tile is still friendly and structure-free (an enemy
                    // taking the tile mid-build interrupts the project).
                    const skey = `${proj.x},${proj.z}`;
                    if (tile && tile.owner === faction &&
                        !(this.gameState.structures && this.gameState.structures.has(skey))) {
        if (!this.gameState.structures) this.gameState.structures = new Map();
                        const sName = (STRUCTURE_TYPE[proj.structureType] || {}).name || proj.structureType;
                        this.gameState.structures.set(skey, { type: proj.structureType, owner: faction });
                        this.log(`${factionName}: ${sName} completed at [${proj.x}, ${proj.z}]!`);
                        sfx.levelUp();
                    }
                    this.gameState.construction.delete(engId);
                    continue;
                }
                if (tile) {
                    let unit;
                    if (proj.type === 'SIEGE_ENGINE') {
                        unit = createUnit(proj.engineType, faction, proj.x, proj.z, { factionDef: def });
                        this.log(`${factionName}: ${UNIT_TYPE[proj.engineType].name} completed at [${proj.x}, ${proj.z}]!`);
                    } else {
                        unit = createUnit('SIEGE_TOWER', faction, proj.x, proj.z, { factionDef: def });
                        this.log(`${factionName}: Siege Tower completed at [${proj.x}, ${proj.z}]! Adjacent units can now assault fortified cities.`);
                    }
                    this.gameState.units.set(unit.id, unit);
                    const lordHere = this.gameState.lords.find(l =>
                        l.owner === faction && l.x === proj.x && l.z === proj.z && canCommand(l));
                    if (lordHere) { assignArmy(lordHere, unit.id); unit.lordId = lordHere.id; }
                    sfx.levelUp();
                }
                this.gameState.construction.delete(engId);
            } else if (faction === PLAYER_FACTION) {
                const label = proj.type === 'STRUCTURE'
                    ? ((STRUCTURE_TYPE[proj.structureType] || {}).name || 'Structure')
                    : proj.type === 'SIEGE_ENGINE'
                        ? UNIT_TYPE[proj.engineType].name
                        : 'Siege Tower';
                this.log(`${label} at [${proj.x}, ${proj.z}]: ${proj.turnsLeft} turn(s) left.`);
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
        const messages = constructBuilding(buildingType, tile, this.gameState.resources.player, this.gameState.buildings, influence, this.tiles, this.gameState.buildingState);
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
            this.gameState.buildings, influence, this.tiles, this.gameState.buildingState);
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
        const removed = removeBuilding(targetTile, this.gameState.buildings, this.gameState.buildingState);
        if (!removed) { this.log('Nothing to pillage there.'); return; }
        const reward = BUILDING_TYPE[removed] && BUILDING_TYPE[removed].military ? MILITARY_PILLAGE_GOLD : PILLAGE_GOLD_REWARD;
        this.gameState.resources.player.gold = (this.gameState.resources.player.gold || 0) + reward;
        unit.hasAttackedThisTurn = true;
        const bName = BUILDING_TYPE[removed] ? BUILDING_TYPE[removed].name : removed;
        this.log(`${UNIT_TYPE[unit.type].name} pillaged a ${bName} at [${targetTile.x}, ${targetTile.z}] (+${reward} gold)!`);
        sfx.capture();
        this.ui.showUnitInfo(unit);
        this.renderAll();
        this.ui.updateResourceBar();
    }

    /** A military unit attacks an adjacent enemy military structure (6c). The
     *  structure takes damage based on the attacker's attack minus its defense;
     *  at 0 hp it is destroyed and pillaged for gold. Structures do not retaliate. */
    handleAttackBuilding(unit, targetTile) {
        if (!unit || unit.owner !== PLAYER_FACTION) return;
        if (unit.type === 'SETTLER' || unit.type === 'WORKER') { this.log('Only military units can attack structures.'); return; }
        if (unit.hasAttackedThisTurn) { this.log('This unit has already acted this turn.'); return; }
        if (!targetTile) return;
        if (Math.max(Math.abs(targetTile.x - unit.x), Math.abs(targetTile.z - unit.z)) > 1) {
            this.log('Target structure is not adjacent.'); return;
        }
        // Find an enemy military building on that tile.
        const list = this.gameState.buildings.get(`${targetTile.x},${targetTile.z}`) || [];
        const bType = list.find(b => BUILDING_TYPE[b] && BUILDING_TYPE[b].military &&
            targetTile.owner && targetTile.owner !== PLAYER_FACTION);
        if (!bType) { this.log('No enemy military structure to attack there.'); return; }
        if (!canAttack(this.gameState.diplomacy, PLAYER_FACTION, targetTile.owner)) {
            this.log('Cannot attack: not at war with that faction.'); return;
        }
        const def = MILITARY_BUILDING_DEFENSE[bType] || 0;
        const dmg = Math.max(1, unit.attack - def);
        const destroyed = damageBuilding(`${targetTile.x},${targetTile.z}`, bType, dmg, this.gameState.buildingState);
        unit.hasAttackedThisTurn = true;
        if (destroyed) {
            const removed = removeBuilding(targetTile, this.gameState.buildings, this.gameState.buildingState);
            this.gameState.resources.player.gold = (this.gameState.resources.player.gold || 0) + MILITARY_PILLAGE_GOLD;
            this.log(`${UNIT_TYPE[unit.type].name} destroyed and pillaged ${BUILDING_TYPE[bType].name} (+${MILITARY_PILLAGE_GOLD} gold)!`);
        } else {
            this.log(`${UNIT_TYPE[unit.type].name} dealt ${dmg} damage to ${BUILDING_TYPE[bType].name}.`);
        }
        sfx.attack();
        this.ui.showUnitInfo(unit);
        this.renderAll();
        this.ui.updateResourceBar();
    }

    /** Return the best { veteranLevel, goldMult } for a military building type
     *  serving the given training city (the building may sit on any tile within
     *  the city's influence, incl. the city tile itself). Defaults to the base
     *  (no building) when none exists. */
    bestMilitaryLevel(cityTile, type) {
        const levels = MILITARY_BUILDING_LEVELS[type];
        if (!levels) return null;
        const radius = cityRadius(cityTile);
        let best = { veteranLevel: 1, goldMult: 1, level: 1 };
        for (let dx = -radius; dx <= radius; dx++) {
            for (let dz = -radius; dz <= radius; dz++) {
                if (Math.max(Math.abs(dx), Math.abs(dz)) > radius) continue;
                const k = `${cityTile.x + dx},${cityTile.z + dz}`;
                const list = this.gameState.buildings.get(k) || [];
                if (!list.includes(type)) continue;
                const st = getBuildingState(this.gameState.buildingState, k, type);
                const lvl = levels[st.level - 1];
                if (lvl && lvl.goldMult < best.goldMult) {
                    best = { veteranLevel: lvl.veteranLevel, goldMult: lvl.goldMult, level: st.level };
                }
            }
        }
        return best;
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
        // Ships require a Harbor in this city's influence (and the harbor must be coastal).
        if (NAVAL_UNITS.includes(unitType)) {
            const harborInfo = this.bestMilitaryLevel(tile, 'HARBOR');
            if (!harborInfo) { this.log('Ships require a Harbor in this city (or its influence).'); return; }
            // 6c �?Enemy warship blockade: an adjacent enemy ship blocks ship production.
            const blocked = this._isHarborBlockaded(tile.x, tile.z);
            if (blocked) { this.log('The harbor is blockaded by enemy ships!'); return; }
        }
        // Siege engines require a Siege Workshop in this city's influence.
        if (SIEGE_ENGINES.includes(unitType)) {
            const workshop = this.bestMilitaryLevel(tile, 'SIEGE_WORKSHOP');
            if (!workshop) { this.log('Siege engines require a Siege Workshop in this city (or its influence).'); return; }
        }
        // A city already busy with multi-turn production can't start another.
        if (this.gameState.production && this.gameState.production.has(cityKey)) {
            this.log('This city is already producing a unit.');
            return;
        }
        // Veteran level + gold discount come from the best Barracks in influence.
        const barracks = this.bestMilitaryLevel(tile, 'BARRACKS');
        const veteran = barracks ? barracks.veteranLevel : 1;
        const goldMult = barracks ? barracks.goldMult : 1;
        let cost = getUnitCostFor(unitType, def);
        if (goldMult !== 1) cost = { ...cost, gold: Math.floor((cost.gold || 0) * goldMult) };

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
                unitType, turnsLeft: buildTurns, veteran, faction: PLAYER_FACTION
            });
            sfx.click();
            this.log(`Started ${UNIT_TYPE[unitType].name} production at [${tile.x}, ${tile.z}] �?ready in ${buildTurns} turns.`);
        } else {
            const unit = createUnit(unitType, 'player', tile.x, tile.z, { veteran, factionDef: def });
            this.gameState.units.set(unit.id, unit);
            const lordHere = this.gameState.lords.find(l =>
                l.owner === 'player' && l.x === tile.x && l.z === tile.z && canCommand(l));
            if (lordHere) {
                assignArmy(lordHere, unit.id);
                unit.lordId = lordHere.id;
                this.log(`${UNIT_TYPE[unitType].name} joined ${lordHere.name}'s army (${lordHere.army.length}/${maxArmySize(lordHere)})`);
            }
            sfx.click();
            this.log(`Trained ${UNIT_TYPE[unitType].name}${veteran > 1 ? ' (veteran)' : ''} at [${tile.x}, ${tile.z}]`);
        }
        this.ui.showBuildMenu(tile);
        this.renderAll();
        this.ui.updateResourceBar();
    }

    /** Select a technology to research for the player faction. */
    handleResearch(techId) {
        const tech = TECHS[techId];
        if (!tech) { this.log('Unknown technology.'); return; }
        const ts = this.gameState.techState;
        if (!ts) { this.log('No tech state available.'); return; }
        if (ts.researched && ts.researched.has(techId)) {
            this.log(`${tech.name} already researched.`);
            return;
        }
        if (!selectResearch(ts, techId)) {
            this.log(`${tech.name} not available yet (prerequisites not met).`);
            return;
        }
        sfx.click();
        this.log(`Researching ${tech.name}...`);
        this.renderAll();
    }

    /** Upgrade a military building (BARRACKS/HARBOR) on a tile to the next level. */
    handleUpgradeBuilding(buildingType, tile) {
        if (!tile) return;
        const msgs = upgradeBuilding(buildingType, tile, this.gameState.resources.player,
            this.gameState.buildings, this.gameState.buildingState);
        msgs.forEach(m => this.log(m));
        sfx.click();
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
        if (!this.gameState.reputation) this.gameState.reputation = Object.fromEntries(FACTIONS.map(f => [f, 50]));
        const rep = this.gameState.reputation;
        const adjustRep = (faction, delta) => {
            rep[faction] = Math.max(0, Math.min(100, (rep[faction] == null ? 50 : rep[faction]) + delta));
        };
        const treatyLabel = (type) => type === DIPLOMACY_STATES.PEACE ? 'peace'
            : type === DIPLOMACY_STATES.TRADE_PACT ? 'a trade pact'
            : type === DIPLOMACY_STATES.NAP ? 'a non-aggression pact'
            : type === DIPLOMACY_STATES.CEASEFIRE ? 'a ceasefire'
            : 'an alliance';
        const nameOf = (f) => this.factionColors[f] ? this.factionColors[f].name : f;
        // Player proposes a treaty to an AI; the AI accepts/rejects via
        // aiDecideTreaty using its personality, the power ratio, and the
        // current relationship score. Alliances also require decent reputation.
        const propose = (type) => {
            const rel = getRelation(diplo, 'player', target);
            const ratio = Math.max(0.1, this._factionPower('player') / Math.max(1, this._factionPower(target)));
            const def = this.factionDefs[target];
            const pers = (def && def.aiPersonality) || 'DEFENSIVE';
            const playerRep = rep.player == null ? 50 : rep.player;
            if (type === DIPLOMACY_STATES.ALLIANCE && (playerRep < 30 || (rel.relationship || 0) <= -20)) {
                this.log(`${nameOf(target)} spurns your alliance proposal (low standing).`);
                return;
            }
            // A low-reputation player is treated as if its relationship score were
            // worse, so the AI is less willing to sign trade/peace with a known
            // treaty-breaker. Past broken treaties (trust) cool it further.
            const effRel = (rel.relationship || 0) + (playerRep - 50) / 2 - (rel.brokenTreaties || 0) * 5;
            const theirGrievances = getRelation(diplo, target, 'player').grievances || 0;
            if (aiDecideTreaty(pers, type, ratio, effRel, rel.brokenTreaties || 0, 0, false, theirGrievances)) {
                const turn = this.gameState.turn || 0;
                const duration = type === DIPLOMACY_STATES.NAP ? 15 :
                                type === DIPLOMACY_STATES.CEASEFIRE ? 8 : 0;
                setRelation(diplo, 'player', target, type, turn, duration);
                if (type === DIPLOMACY_STATES.TRADE_PACT) rel.tradeAmount = 10;
                this.log(`${nameOf(target)} accepts your proposal �?${treatyLabel(type)} established.`);
                if (type === DIPLOMACY_STATES.ALLIANCE) this.updateFog();
            } else {
                this.log(`${nameOf(target)} rejects your ${treatyLabel(type)} proposal.`);
            }
        };

        if (action === 'proposePeace') {
            propose(DIPLOMACY_STATES.PEACE);
        } else if (action === 'proposeTrade') {
            propose(DIPLOMACY_STATES.TRADE_PACT);
        } else if (action === 'proposeAlliance') {
            propose(DIPLOMACY_STATES.ALLIANCE);
        } else if (action === 'declareWar') {
            const prevRel = getRelation(diplo, 'player', target);
            const prevState = prevRel.state;
            const turn = this.gameState.turn || 0;
            setRelation(diplo, 'player', target, DIPLOMACY_STATES.WAR, turn);
            // The act of declaring war angers the target (+10). The breach
            // grievance for breaking an active treaty is awarded centrally by
            // setRelation (mutual, scaled for early NAP/ceasefire breaks).
            addGrievance(diplo, target, 'player', 10, 'war declared');
            // Reputation cost scales with the weight of whatever treaty is being
            // broken (alliance hurts most; neutral skirmish least).
            const repHit = prevState === DIPLOMACY_STATES.ALLIANCE ? 30
                : prevState === DIPLOMACY_STATES.NAP ? 20
                : prevState === DIPLOMACY_STATES.CEASEFIRE ? 15
                : prevState === DIPLOMACY_STATES.PEACE ? 15
                : prevState === DIPLOMACY_STATES.TRADE_PACT ? 10
                : prevState === DIPLOMACY_STATES.NEUTRAL ? 5 : 0;
            if (repHit > 0) adjustRep('player', -repHit);
            this.log(`War declared on ${nameOf(target)}!${repHit > 0 ? ` (Reputation -${repHit})` : ''}`);
            // Joint war: the player's allies are dragged in against the target.
            this._jointWar(PLAYER_FACTION, target);
        } else if (action === 'proposeNap') {
            propose(DIPLOMACY_STATES.NAP);
        } else if (action === 'proposeCeasefire') {
            propose(DIPLOMACY_STATES.CEASEFIRE);
        } else if (action === 'cancelTrade') {
            const rel = getRelation(diplo, 'player', target);
            if (rel.state === DIPLOMACY_STATES.TRADE_PACT) {
                rel.tradeAmount = 0;
                setRelation(diplo, 'player', target, DIPLOMACY_STATES.PEACE);
                adjustRep('player', -5);
                this.log(`Trade pact with ${nameOf(target)} cancelled. (Reputation -5)`);
            }
        } else if (action === 'acceptOffer' || action === 'declineOffer') {
            const idx = Number(target);
            const offer = diplo.pendingOffers[idx];
            if (!offer || offer.to !== PLAYER_FACTION) return;
            diplo.pendingOffers.splice(idx, 1);
            if (action === 'acceptOffer') {
                const turn = this.gameState.turn || 0;
                const duration = offer.type === DIPLOMACY_STATES.NAP ? 15 :
                                offer.type === DIPLOMACY_STATES.CEASEFIRE ? 8 : 0;
                setRelation(diplo, 'player', offer.from, offer.type, turn, duration);
                if (offer.type === DIPLOMACY_STATES.TRADE_PACT) {
                    getRelation(diplo, 'player', offer.from).tradeAmount = 10;
                }
                this.log(`You accepted ${treatyLabel(offer.type)} with ${nameOf(offer.from)}.`);
                adjustRep('player', +3);
                if (offer.type === DIPLOMACY_STATES.ALLIANCE) this.updateFog();
            } else {
                this.log(`You declined ${nameOf(offer.from)}'s ${treatyLabel(offer.type)} offer.`);
            }
        }
        sfx.click();
        this.ui.showDiplomacyPanel();
    }

    /** Handle a player-proposed peace with demands (gold reparations, territory
     *  cession, or ongoing tribute). The target AI evaluates the demand using
     *  its personality, the power ratio, war weariness, and the relationship
     *  score; on acceptance the demand is applied and peace is established. */
    handlePeaceNegotiation(target, demands) {
        const diplo = this.gameState.diplomacy;
        const nameOf = (f) => this.factionColors[f] ? this.factionColors[f].name : f;
        const rel = getRelation(diplo, PLAYER_FACTION, target);

        if (rel.state !== DIPLOMACY_STATES.WAR) {
            this.log(`Can only negotiate peace during war with ${nameOf(target)}.`);
            sfx.click();
            this.ui.showDiplomacyPanel();
            return;
        }

        // Validate demand magnitude against the configured caps.
        if (demands.type === 'gold' && demands.amount > PEACE_DEMAND_LIMITS.MAX_GOLD_DEMAND) {
            this.log(`Gold demand capped at ${PEACE_DEMAND_LIMITS.MAX_GOLD_DEMAND}.`);
            return;
        }
        if (demands.type === 'territory' && (demands.tiles || []).length > PEACE_DEMAND_LIMITS.MAX_TERRITORY_TILES) {
            this.log(`Territory demand capped at ${PEACE_DEMAND_LIMITS.MAX_TERRITORY_TILES} tiles.`);
            return;
        }
        if (demands.type === 'tribute') {
            if (demands.perTurn > PEACE_DEMAND_LIMITS.MAX_TRIBUTE_PER_TURN ||
                demands.duration > PEACE_DEMAND_LIMITS.MAX_TRIBUTE_DURATION) {
                this.log(`Tribute capped at ${PEACE_DEMAND_LIMITS.MAX_TRIBUTE_PER_TURN}g for ${PEACE_DEMAND_LIMITS.MAX_TRIBUTE_DURATION} turns.`);
                return;
            }
        }

        const playerPower = this._factionPower(PLAYER_FACTION);
        const targetPower = this._factionPower(target);
        const powerRatio = playerPower / Math.max(1, targetPower);
        const weariness = getWarWeariness(diplo, target);
        const demand = createPeaceDemand(demands.type, demands);
        const targetDef = this.factionDefs ? this.factionDefs[target] : null;
        const personality = (targetDef && targetDef.aiPersonality) || 'DEFENSIVE';
        const targetRes = this.gameState.resources && this.gameState.resources[target] || { gold: 0 };

        const result = evaluatePeaceDemand(
            demand, target, PLAYER_FACTION, diplo, targetRes, powerRatio, weariness, personality
        );

        if (result.accepted) {
            if (demand.type === 'gold' && demand.amount > 0) {
                const tr = this.gameState.resources[target];
                const pr = this.gameState.resources[PLAYER_FACTION];
                const paid = Math.min(demand.amount, (tr && tr.gold) || 0);
                if (tr) tr.gold = Math.max(0, (tr.gold || 0) - paid);
                if (pr) pr.gold = (pr.gold || 0) + paid;
                this.log(`${nameOf(target)} pays ${paid} gold in reparations.`);
            } else if (demand.type === 'territory') {
                let transferred = 0;
                for (const tileKey of demand.tiles) {
                    const tile = this.tiles.get(tileKey);
                    if (tile && tile.owner === target) {
                        tile.owner = PLAYER_FACTION;
                        transferred++;
                    }
                }
                this.log(`${nameOf(target)} cedes ${transferred} tile(s).`);
            } else if (demand.type === 'tribute') {
                // Store the tribute on the relation; the turn manager pays it out
                // each turn until the duration expires.
                rel.tribute = { from: target, to: PLAYER_FACTION,
                                perTurn: demand.perTurn, turnsLeft: demand.duration };
                this.log(`${nameOf(target)} agrees to pay ${demand.perTurn} gold/turn for ${demand.duration} turns.`);
            }
            setRelation(diplo, PLAYER_FACTION, target, DIPLOMACY_STATES.PEACE, this.gameState.turn || 0);
            this.log(`Peace established with ${nameOf(target)}.`);
        } else {
            this.log(`${nameOf(target)} rejects your peace terms (chance ${Math.round(result.chance * 100)}%).`);
        }

        sfx.click();
        this.ui.showDiplomacyPanel();
        this.renderAll();
    }

    /** Establish a trade route from one of the player's cities (≥ min level) to
     *  a target city. Routes pay income per turn based on distance + both city
     *  levels; enemy units on the route's path can raid and disrupt them. Each
     *  established route also counts toward the economic victory threshold. */
    handleEstablishTrade(cityKey, targetCityKey) {
        const nameOf = (f) => this.factionColors[f] ? this.factionColors[f].name : f;
        const fromTile = this.tiles.get(cityKey);
        const toTile = this.tiles.get(targetCityKey);
        if (!fromTile || !toTile) { this.log('Trade route: city not found.'); return; }
        const targetOwner = toTile.owner;
        if (!targetOwner) { this.log('Trade route: destination is not a founded city.'); return; }

        const validation = validateTradeRoute(
            this.tiles, this.gameState.diplomacy,
            PLAYER_FACTION, targetOwner, cityKey, targetCityKey,
            this.gameState.tradeRoutes
        );
        if (!validation.valid) { this.log(`Trade route rejected: ${validation.reason}`); sfx.click(); return; }

        if (!this.gameState.tradeRouteNextId) this.gameState.tradeRouteNextId = 1;
        const route = createTradeRoute({
            id: this.gameState.tradeRouteNextId++,
            from: { owner: PLAYER_FACTION, cityKey, x: fromTile.x, z: fromTile.z },
            to: { owner: targetOwner, cityKey: targetCityKey, x: toTile.x, z: toTile.z },
            fromLevel: fromTile.cityLevel || 1,
            toLevel: toTile.cityLevel || 1,
            turn: this.gameState.turn || 0
        });
        this.gameState.tradeRoutes.push(route);
        // Economic victory counter: track routes per faction.
        if (!this.gameState.victoryState) this.gameState.victoryState = { projects: {}, tradeRoutes: {}, scoreSnapshots: {} };
        const vr = this.gameState.victoryState.tradeRoutes || (this.gameState.victoryState.tradeRoutes = {});
        vr[PLAYER_FACTION] = (vr[PLAYER_FACTION] || 0) + 1;
        this.log(`Trade route established to ${nameOf(targetOwner)}! +${route.income} gold/turn.`);
        sfx.click();
        this.ui.updateResourceBar();
        this.renderAll();
    }

    /** Award grievances when a city is captured. Former owner gets the biggest
     *  grievance; neutral cities within NEUTRAL_CITY_GRUDGE_RADIUS of a faction's
     *  city also generate a smaller grievance (Civ6 border tension). */
    _awardCaptureGrievances(cityTile, newOwner, prevOwner, wasNeutral) {
        const diplo = this.gameState.diplomacy;
        const other = newOwner;
        // Spanish Conquistadors passive: plunder gold on city conquest.
        const conquerorDef = this.factionDefs ? this.factionDefs[other] : null;
        const plunder = getGoldPerConquest(conquerorDef);
        if (plunder > 0) {
            const res = this.gameState.resources && this.gameState.resources[other];
            if (res) {
                res.gold = (res.gold || 0) + plunder;
                this.log(`${(conquerorDef && conquerorDef.name) || other} plunders ${plunder} gold from the conquered city!`);
            }
        }
        // City unrest: a freshly-captured city starts at elevated unrest and
        // remembers the conquest turn (the recent-conquest spike decays over
        // UNREST_INCREASE_RATES.RECENT_CONQUEST_DECAY_TURNS via calculateUnrest).
        if (cityTile) {
            cityTile.lastConqueredTurn = this.gameState.turn || 0;
            cityTile.unrest = UNREST_INCREASE_RATES.CAPTURE_INITIAL;
        }
        // Former owner gets +25 grievance for losing a city
        if (prevOwner && prevOwner !== other) {
            addGrievance(diplo, prevOwner, other, 25, 'city captured');
        }
        // Neutral capture: factions with cities within the grudge radius
        // see it as an aggressive land grab.
        if (wasNeutral && NEUTRAL_CITY_GRUDGE_RADIUS > 0) {
            for (const f of FACTIONS) {
                if (f === other || (this.gameState.eliminated && this.gameState.eliminated.has(f))) continue;
                // Check if this faction has a city within the grievance radius
                for (const t of this.tiles.values()) {
                    if (t.terrain === 'CITY' && t.owner === f) {
                        const dist = Math.abs(t.x - cityTile.x) + Math.abs(t.z - cityTile.z);
                        if (dist <= NEUTRAL_CITY_GRUDGE_RADIUS) {
                            addGrievance(diplo, f, other, 20, 'aggressive settlement');
                            break; // one grievance per faction per capture
                        }
                    }
                }
            }
        }
        this._invalidateDiploCache();
    }

    /** Award a grievance to any neighbor with a city within MIN_CITY_SPACING of
     *  a freshly-founded city (Civ6 border tension from settling too close).
     *  Called after a successful foundCity on both the player and AI paths. */
    _awardFoundGrievances(cityTile, founder) {
        if (MIN_CITY_SPACING <= 0) return;
        const diplo = this.gameState.diplomacy;
        for (const f of FACTIONS) {
            if (f === founder || (this.gameState.eliminated && this.gameState.eliminated.has(f))) continue;
            for (const t of this.tiles.values()) {
                if (t.terrain === 'CITY' && t.owner === f) {
                    const dist = Math.abs(t.x - cityTile.x) + Math.abs(t.z - cityTile.z);
                    if (dist <= MIN_CITY_SPACING) {
                        addGrievance(diplo, f, founder, 15, 'founded city too close');
                        break; // one grievance per neighbor per founding
                    }
                }
            }
        }
        this._invalidateDiploCache();
    }

    /** Joint war: declaring war on a faction drags the declarer's allies into
     *  the war on the declarer's side. Relations are symmetric (relKey), so a
     *  single setRelation call per ally suffices. */
    _jointWar(declarer, target) {
        const diplo = this.gameState.diplomacy;
        const nm = (f) => this.factionColors[f] ? this.factionColors[f].name : f;
        for (const ally of FACTIONS) {
            if (ally === declarer || ally === target) continue;
            if (this.gameState.eliminated && this.gameState.eliminated.has(ally)) continue;
            if (isAllied(diplo, declarer, ally) &&
                getRelation(diplo, ally, target).state !== DIPLOMACY_STATES.WAR) {
                setRelation(diplo, ally, target, DIPLOMACY_STATES.WAR);
                this.log(`${nm(ally)} joins the war against ${nm(target)} (alliance obligation).`);
            }
        }
    }

    handleRecruitLord() {
        if (this.spectateMode) return; // no recruiting while spectating
        if (!canRecruitLord(this.gameState.resources.player)) {
            this.log(`Cannot afford to recruit a lord! (${LORD_RECRUIT_COST.gold}g, ${LORD_RECRUIT_COST.food}f)`);
            return;
        }
        // The recruited lord comes with a free Infantry �?respect the unit cap
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

    /** Spend a lord's skill point on a skill-tree node (Feature 4). Only the
     *  player's own lords can be invested in; AI lords auto-spend is handled
     *  separately in runAITurn. */
    handleSkillInvestment(lordId, skillId) {
        const lord = this.gameState.lords.find(l => l.id === lordId);
        if (!lord || lord.owner !== PLAYER_FACTION) { this.log('Lord not found.'); return; }
        const result = investSkillPoint(lord, skillId);
        this.log(result.message);
        if (result.success) {
            sfx.click();
            this.ui.showLordInfo(lord);
            this.renderAll();
        }
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
                this.log(`${name}: King ${king.name} Scries enemy cities �?revealed for this turn!`);
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
            case 'stampede':
                this.gameState.tempBonuses[faction] = { attack: 2, defense: 0 };
                this.log(`${name}: King ${king.name} calls a Stampede! +2 attack this turn.`);
                break;
            case 'ironwill': {
                this.gameState.tempBonuses[faction] = { attack: 0, defense: 3 };
                for (const t of this.tiles.values()) {
                    if (t.terrain === 'CITY' && t.owner === faction) {
                        t.fortification = (t.fortification || 0) + 3;
                    }
                }
                this.log(`${name}: King ${king.name} invokes Iron Will! +3 defense, +3 fortification to all cities.`);
                break;
            }
            case 'vanish':
                this.gameState.tempBonuses[faction] = { attack: 0, defense: 2 };
                this.log(`${name}: King ${king.name} Vanishes into shadow! +2 defense this turn.`);
                break;
            case 'tempest': {
                this.gameState.tempBonuses[faction] = { attack: 2, defense: 0 };
                let struck = 0;
                for (const u of this.gameState.units.values()) {
                    if (u.owner === faction) continue;
                    if (!canAttack(this.gameState.diplomacy, faction, u.owner)) continue;
                    const close = [...this.gameState.units.values()].some(fu =>
                        fu.owner === faction && Math.max(Math.abs(fu.x - u.x), Math.abs(fu.z - u.z)) <= 2);
                    if (close) {
                        u.hp = Math.max(0, (u.hp || 0) - 3);
                        struck++;
                    }
                }
                this.log(`${name}: King ${king.name} summons a Tempest! ${struck} enemy unit(s) struck for 3 damage.`);
                break;
            }
            case 'wintersgrasp':
                this.gameState.tempBonuses[faction] = { attack: 0, defense: 2 };
                this.log(`${name}: King ${king.name} casts Winter's Grasp! +2 defense this turn.`);
                break;
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
     *  goal toward it, using the unit's FULL move range (cavalry 3, infantry 2,
     *  etc.) rather than a single tile. Stops early if it reaches the goal,
     *  can't path further, or hits a fortified enemy city (besiege first). */
    _processAutoGoals() {
        for (const unit of this.gameState.units.values()) {
            if (unit.owner !== PLAYER_FACTION || !unit.goal) continue;
            if (unit.hasMovedThisTurn) continue;
            if (!goalValid(this.tiles, unit, unit.goal)) { unit.goal = null; continue; }
            if (unit.x === unit.goal.x && unit.z === unit.goal.z) { unit.goal = null; continue; }
            const range = getMoveRange(unit) || 1;
            let moved = false;
            for (let s = 0; s < range; s++) {
                if (!unit.goal) break;
                if (unit.x === unit.goal.x && unit.z === unit.goal.z) break;
                if (!goalValid(this.tiles, unit, unit.goal)) { unit.goal = null; break; }
                const step = nextStepToward(this.tiles, this.gameState.units, unit, unit.goal);
                if (!step) { unit.goal = null; this.log(`🎯 ${UNIT_TYPE[unit.type].name} #${unit.id} can't reach its goal �?cancelled.`); break; }
                // Don't auto-walk onto a fortified enemy city (must besiege first).
                const dest = this.tiles.get(`${step.x},${step.z}`);
                if (dest && dest.terrain === 'CITY' && dest.owner !== PLAYER_FACTION && (dest.fortification || 0) > 0) {
                    break; // stop adjacent; player can besiege/capture manually
                }
                // Perform a plain move (no capture cost for friendly tiles; capture if possible).
                unit.x = step.x; unit.z = step.z; unit.hasMovedThisTurn = true; moved = true;
                // An enemy fall trap on the destination springs now.
                this._checkFallTrap(unit);
                if (!this.gameState.units.has(unit.id)) break; // the trap killed it
                const pool = this.gameState.resources[PLAYER_FACTION];
                if (dest && dest.terrain === 'CITY' && dest.owner !== PLAYER_FACTION &&
                    (canCaptureTile(PLAYER_FACTION, dest, pool) || this.siegeTowerAdjacentTo(dest, PLAYER_FACTION))) {
                    pool.gold -= CAPTURE_COST;
                    captureCityTerritory(this.tiles, dest, PLAYER_FACTION, this.gameState.structures, this.gameState.buildings, this.gameState.buildingState).forEach(m => this.log(m));
                    sfx.capture();
                    unit.goal = null; // captured the target city �?done
                    break;
                }
                if (unit.goal && unit.x === unit.goal.x && unit.z === unit.goal.z) {
                    unit.goal = null;
                    this.log(`🎯 ${UNIT_TYPE[unit.type].name} #${unit.id} reached its goal.`);
                    break;
                }
            }
            if (moved) sfx.move();
        }
        this.checkVictory();
    }

    /** At the start of the player's turn, auto-step every player LORD/KING that
     *  has a goal toward it. Lords move 2 tiles per turn and share tiles with
     *  their own army, so own-faction units don't block their pathing. */
    _processLordGoals() {
        for (const lord of this.gameState.lords) {
            if (lord.owner !== PLAYER_FACTION || !lord.goal) continue;
            if (lord.hasMovedThisTurn) continue;
            if (lord.x === lord.goal.x && lord.z === lord.goal.z) { lord.goal = null; continue; }
            const range = 2; // lords move 2 tiles per turn
            let moved = false;
            for (let s = 0; s < range; s++) {
                if (!lord.goal) break;
                if (lord.x === lord.goal.x && lord.z === lord.goal.z) break;
                const step = nextStepToward(this.tiles, this.gameState.units, lord, lord.goal, 200, PLAYER_FACTION);
                if (!step) {
                    lord.goal = null;
                    this.log(`🎯 Lord ${lord.name} can't reach its goal �?cancelled.`);
                    break;
                }
                // Don't step onto a fortified enemy city (must besiege first).
                const dest = this.tiles.get(`${step.x},${step.z}`);
                if (dest && dest.terrain === 'CITY' && dest.owner !== PLAYER_FACTION && (dest.fortification || 0) > 0) {
                    lord.goal = null;
                    this.log(`🎯 Lord ${lord.name}'s goal is a fortified city �?cancelled (besiege it first).`);
                    break;
                }
                lord.x = step.x; lord.z = step.z; lord.hasMovedThisTurn = true; moved = true;
                // Capture a breached enemy city on arrival (like units do).
                if (dest && dest.terrain === 'CITY' && canCaptureTile(PLAYER_FACTION, dest, this.gameState.resources[PLAYER_FACTION])) {
                    this.gameState.resources[PLAYER_FACTION].gold -= CAPTURE_COST;
                    captureCityTerritory(this.tiles, dest, PLAYER_FACTION, this.gameState.structures, this.gameState.buildings, this.gameState.buildingState).forEach(m => this.log(m));
                    sfx.capture();
                    lord.goal = null;
                    break;
                }
                if (lord.goal && lord.x === lord.goal.x && lord.z === lord.goal.z) {
                    lord.goal = null;
                    this.log(`🎯 Lord ${lord.name} reached its goal.`);
                    break;
                }
            }
            if (moved) sfx.move();
        }
        this.checkVictory();
    }

    /** Rebuild the per-turn diplomacy cache: each faction's power, its city
     *  list, and pairwise nearest-city distances. Called once at the start of
     *  endPlayerTurn (and invalidated whenever a city changes hands mid-turn via
     *  _invalidateDiploCache). This turns the AI diplomacy phase from
     *  O(factions × tiles²) into O(factions × tiles) + O(factions² × cities²). */
    _rebuildDiploCache() {
        const power = {};
        const cities = {};
        for (const f of FACTIONS) { power[f] = 0; cities[f] = []; }
        for (const u of this.gameState.units.values()) {
            if (u.boarded || power[u.owner] === undefined) continue;
            const type = u.type;
            if (type === 'SETTLER' || type === 'WORKER') continue; // non-combat
            const def = UNIT_TYPE[type];
            if (def && def.naval) continue; // ships counted separately below
            let weight = 1;
            if (type === 'SCOUT') weight = 0.5;
            else if (type === 'CAVALRY' || type === 'CATAPHRACT') weight = 1.5;
            else if (type === 'SIEGE' || type === 'ARTILLERY' || type === 'CATAPULT' || type === 'TREBUCHET') weight = 2;
            else if (type === 'LONGBOWMAN') weight = 1.2;
            power[u.owner] += weight;
        }
        // Lord power: each lord adds 3 (kings are special targets)
        for (const l of (this.gameState.lords || [])) {
            if (power[l.owner] !== undefined) power[l.owner] += 3;
        }
        for (const t of this.tiles.values()) {
            if (t.terrain === 'CITY' && t.owner && cities[t.owner] !== undefined) {
                cities[t.owner].push(t);
                // Base city presence, plus fortification level and walled-city
                // bonuses so power reflects actual defenses, not just city count.
                power[t.owner] += 2 + (t.fortMax || 0) * 3;
                const bs = this.gameState.buildings && this.gameState.buildings.get(`${t.x},${t.z}`);
                if (Array.isArray(bs) && bs.includes('WALLS')) power[t.owner] += 5;
            }
        }
        for (const f of FACTIONS) {
            const gold = (this.gameState.resources[f] && this.gameState.resources[f].gold) || 0;
            power[f] += Math.floor(gold / 100);
        }
        // Pairwise nearest-city Manhattan distance (O(cities_a × cities_b) per
        // pair �?tiny compared to the old O(tiles²) scan).
        const dist = {};
        for (let i = 0; i < FACTIONS.length; i++) {
            for (let j = i + 1; j < FACTIONS.length; j++) {
                const a = FACTIONS[i], b = FACTIONS[j];
                const ca = cities[a] || [], cb = cities[b] || [];
                let minDist = Infinity;
                for (const ta of ca) {
                    for (const tb of cb) {
                        const d = Math.abs(ta.x - tb.x) + Math.abs(ta.z - tb.z);
                        if (d < minDist) minDist = d;
                    }
                }
                dist[`${a}:${b}`] = minDist === Infinity ? 50 : minDist;
            }
        }
        this._diploCache = { power, cities, dist, turn: this.gameState.turn };
    }

    /** Invalidate the diplomacy cache (e.g. after a city capture mid-turn). */
    _invalidateDiploCache() { this._diploCache = null; }

    /** Rough military/economic power of a faction: units + cities (weighted) +
     *  a gold contribution. Used by the AI to judge whether it has the advantage
     *  to declare war. Uses the per-turn cache when available. */
    _factionPower(faction) {
        if (this._diploCache && this._diploCache.turn === this.gameState.turn) {
            return this._diploCache.power[faction] || 0;
        }
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
    /** Diplomatic strategy types based on personality.
     *  Controls how each faction approaches war and alliances:
     *  - AGGRESSIVE: Declares war on neighbors readily, doesn't seek distant alliances
     *  - DEFENSIVE: Only wars if much stronger, seeks alliances against threats
     *  - ECONOMIC: Prefers trade, avoids war, seeks distant alliances for security
     *  - BALANCED: "Attack close, ally far" - wars on neighbors, allies with distant factions */
    _getDiplomaticStrategy(personality) {
        const strategies = {
            AGGRESSIVE: { warThreshold: 1.1, allyThreshold: 0.6, preferNeighbors: true, seekDistantAllies: false, breakAllianceThreshold: 1.5 },
            DEFENSIVE:  { warThreshold: 1.6, allyThreshold: 0.9, preferNeighbors: false, seekDistantAllies: true, breakAllianceThreshold: 2.0 },
            ECONOMIC:   { warThreshold: 2.0, allyThreshold: 0.7, preferNeighbors: false, seekDistantAllies: true, breakAllianceThreshold: 2.5 },
            BALANCED:   { warThreshold: 1.3, allyThreshold: 0.8, preferNeighbors: true, seekDistantAllies: true, breakAllianceThreshold: 1.8 }
        };
        return strategies[personality] || strategies.DEFENSIVE;
    }

    /** Calculate distance between two factions' nearest cities. Uses the
     *  per-turn cache (O(cities²) once) instead of an O(tiles²) scan per call. */
    _factionDistance(factionA, factionB) {
        if (this._diploCache && this._diploCache.turn === this.gameState.turn) {
            const k = `${factionA}:${factionB}`;
            return this._diploCache.dist[k] != null ? this._diploCache.dist[k]
                : (this._diploCache.dist[`${factionB}:${factionA}`] != null
                    ? this._diploCache.dist[`${factionB}:${factionA}`] : 50);
        }
        let minDist = Infinity;
        for (const t of this.tiles.values()) {
            if (t.terrain !== 'CITY' || t.owner !== factionA) continue;
            for (const t2 of this.tiles.values()) {
                if (t2.terrain !== 'CITY' || t2.owner !== factionB) continue;
                const d = Math.abs(t.x - t2.x) + Math.abs(t.z - t2.z);
                if (d < minDist) minDist = d;
            }
        }
        return minDist === Infinity ? 50 : minDist;
    }

    /** Check if two factions share a common enemy (for alliance synergy). */
    _hasSharedEnemy(factionA, factionB) {
        const atWarWithA = new Set();
        const atWarWithB = new Set();
        for (const f of FACTIONS) {
            if (f === factionA || f === factionB) continue;
            if (getRelation(this.gameState.diplomacy, factionA, f).state === DIPLOMACY_STATES.WAR) atWarWithA.add(f);
            if (getRelation(this.gameState.diplomacy, factionB, f).state === DIPLOMACY_STATES.WAR) atWarWithB.add(f);
        }
        for (const f of atWarWithA) { if (atWarWithB.has(f)) return true; }
        return false;
    }

    /** AI may declare war based on personality, strategy, and distance ("attack close").
     *  At most one declaration per turn. */
    _aiMaybeDeclareWar(faction, def, factionName) {
        if (!def) return;
        const personality = def.aiPersonality || 'DEFENSIVE';
        const strategy = this._getDiplomaticStrategy(personality);
        const myPower = this._factionPower(faction);
        if (myPower <= 0) return;
        let declared = false;
        const candidates = FACTIONS.filter(o => o !== faction &&
            getRelation(this.gameState.diplomacy, faction, o).state !== DIPLOMACY_STATES.WAR);
        // Score candidates based on strategic priorities
        const scored = candidates.map(other => {
            const rel = getRelation(this.gameState.diplomacy, faction, other);
            const theirPower = Math.max(1, this._factionPower(other));
            const ratio = myPower / theirPower;
            const distance = this._factionDistance(faction, other);
            let score = 0;
            // "Attack close" �?prefer nearby targets
            if (strategy.preferNeighbors) {
                if (distance <= 5) score += 30;
                else if (distance <= 10) score += 15;
                else score -= 10;
            } else {
                score -= distance * 0.5;
            }
            if (ratio < strategy.warThreshold) return { other, score: -Infinity };
            score += (ratio - 1) * 20;
            const isAlly = rel.state === DIPLOMACY_STATES.ALLIANCE;
            if (isAlly && ratio < strategy.breakAllianceThreshold) return { other, score: -Infinity };
            if (isAlly) score -= 30;
            const PEACE_COOLDOWN = 6;
            if (rel.state !== DIPLOMACY_STATES.WAR && (rel.turnsAtPeace || 0) < PEACE_COOLDOWN) return { other, score: -Infinity };
            score += (100 - theirPower) * 0.1;
            if (other === PLAYER_FACTION) score += 10;
            // Grievance tension: the angrier we are, the more we want war
            const tension = getTension(this.gameState.diplomacy, faction, other);
            score += tension * 0.3;
            // Grievance precondition: once tension crosses the war threshold and
            // we're not badly outmatched, this is a strong candidate to strike
            // first (Civ6 "grievance builds until war").
            if (tension >= GRIEVANCE_WAR_THRESHOLD && ratio >= 0.8) score += 50;
            return { other, score };
        });
        scored.sort((a, b) => b.score - a.score);
        for (const { other, score } of scored) {
            if (declared || score === -Infinity) continue;
            const rel = getRelation(this.gameState.diplomacy, faction, other);
            const theirPower = Math.max(1, this._factionPower(other));
            const ratio = myPower / theirPower;
            const distance = this._factionDistance(faction, other);
            const isNeighbor = distance <= 8;
            const tension = getTension(this.gameState.diplomacy, faction, other);
            if (!aiDecideWar(personality, ratio, rel.relationship || 0, 0, isNeighbor, tension)) continue;
            const prevState = rel.state;
            const turn = this.gameState.turn || 0;
            setRelation(this.gameState.diplomacy, faction, other, DIPLOMACY_STATES.WAR, turn);
            // The act of declaring war angers the target (+10). The breach
            // grievance for breaking an active treaty is awarded centrally by
            // setRelation (mutual, scaled for early NAP/ceasefire breaks).
            addGrievance(this.gameState.diplomacy, other, faction, 10, 'war declared');
            if (this.gameState.reputation) {
                const hit = prevState === DIPLOMACY_STATES.ALLIANCE ? 30
                    : prevState === DIPLOMACY_STATES.NAP ? 20
                    : prevState === DIPLOMACY_STATES.CEASEFIRE ? 15
                    : prevState === DIPLOMACY_STATES.PEACE ? 15
                    : prevState === DIPLOMACY_STATES.TRADE_PACT ? 10
                    : prevState === DIPLOMACY_STATES.NEUTRAL ? 5 : 0;
                if (hit > 0) {
                    this.gameState.reputation[faction] = Math.max(0,
                        (this.gameState.reputation[faction] == null ? 50 : this.gameState.reputation[faction]) - hit);
                }
            }
            const otherName = this.factionColors[other] ? this.factionColors[other].name : other;
            this.log(`${factionName} has declared war on ${otherName}! (power ${myPower} vs ${theirPower})`);
            sfx.attack();
            declared = true;
        }
    }

    /** AI may propose a treaty (peace / trade / alliance) to one other faction
     *  per turn. Uses diplomatic strategy for "attack close, ally far":
     *  - Weak factions ally with other weak factions against strong threats
     *  - "Attack close, ally far": propose alliances with distant factions
     *  - Shared enemies greatly increase alliance likelihood
     *  AI->player offers are pushed to pendingOffers; AI-AI offers resolve
     *  automatically via aiDecideTreaty on both sides. */
    _aiMaybeProposeTreaty(faction, def, factionName) {
        if (!def) return;
        const personality = def.aiPersonality || 'DEFENSIVE';
        const strategy = this._getDiplomaticStrategy(personality);
        const myPower = Math.max(1, this._factionPower(faction));
        const diplo = this.gameState.diplomacy;
        const alive = (o) => !(this.gameState.eliminated && this.gameState.eliminated.has(o));

        // Stale offer cleanup: remove pending offers from this faction older than
        // 10 turns so the UI doesn't accumulate dead entries.
        if (diplo.pendingOffers) {
            diplo.pendingOffers = diplo.pendingOffers.filter(o =>
                o.from !== faction || (this.gameState.turn - (o.turnProposed || 0)) <= 10);
        }

        // Build a scored list of candidates for treaties
        const candidates = [];
        for (const other of FACTIONS) {
            if (other === faction || !alive(other)) continue;
            const rel = getRelation(diplo, faction, other);
            const theirPower = Math.max(1, this._factionPower(other));
            const ratio = myPower / theirPower;
            const distance = this._factionDistance(faction, other);
            const sharedEnemy = this._hasSharedEnemy(faction, other);
            const isNeighbor = distance <= 8;
            const isDistant = distance > 12;

            let allianceScore = 0, tradeScore = 0, peaceScore = 0, napScore = 0, ceasefireScore = 0;

            // --- WAR -> PEACE ---
            if (rel.state === DIPLOMACY_STATES.WAR) {
                if (ratio < 0.8 || (rel.turnsAtWar || 0) > 8) peaceScore = 100;
                else if (ratio < 1.0 && (rel.turnsAtWar || 0) > 4) peaceScore = 50;
            }

            // --- ALLIANCE scoring ---
            if (rel.state !== DIPLOMACY_STATES.WAR) {
                // "Ally far" strategy: prefer alliances with distant factions
                if (strategy.seekDistantAllies && isDistant) allianceScore += 40;
                // Weak factions seek alliances against strong threats
                if (ratio < 0.9) allianceScore += 30;
                // Shared enemy bonus
                if (sharedEnemy) allianceScore += 50;
                // "Attack close, ally far" (BALANCED): ally with distant factions
                if (strategy.preferNeighbors && isDistant) allianceScore += 25;
                // Don't ally with neighbors we're stronger than (likely war targets)
                if (strategy.preferNeighbors && isNeighbor && ratio > 1.3) allianceScore -= 30;
                // Relationship contribution
                allianceScore += (rel.relationship || 0) * 0.3;
                // Existing treaties help
                if (rel.state === DIPLOMACY_STATES.TRADE_PACT) { allianceScore += 20; if ((rel.turnsAtPeace || 0) > 6) allianceScore += 15; }
                if (rel.state === DIPLOMACY_STATES.PEACE) allianceScore += 10;
                // No alliance if vastly stronger (no need)
                if (ratio > strategy.allyThreshold * 2) allianceScore -= 40;
            }

            // --- TRADE scoring ---
            if (rel.state === DIPLOMACY_STATES.PEACE || rel.state === DIPLOMACY_STATES.TRADE_PACT) {
                if (personality === 'ECONOMIC') tradeScore += 30;
                if (isDistant) tradeScore += 20;
                if (sharedEnemy) tradeScore -= 10;
                tradeScore += (rel.relationship || 0) * 0.2;
                if (rel.state === DIPLOMACY_STATES.TRADE_PACT) tradeScore = -Infinity; // already have it
            }

            // Grievance tension between these two factions (directed: ours vs theirs)
            const tension = getTension(diplo, faction, other);

            // --- NAP scoring (propose when neutral with decent relations) ---
            if (rel.state === DIPLOMACY_STATES.NEUTRAL) {
                if (isNeighbor && (rel.relationship || 0) > -20) napScore += 40;
                if (sharedEnemy) napScore += 20;
                if (distance > 12) napScore += 10; // NAP with distant is cheap insurance
                if (tension > GRIEVANCE_WAR_THRESHOLD * 0.5) napScore -= 50; // too tense for NAP
            }

            // --- CEASEFIRE scoring (propose during war when peace is too much) ---
            if (rel.state === DIPLOMACY_STATES.WAR && peaceScore > 0 && peaceScore < 60) {
                ceasefireScore = peaceScore * 0.6;
                if (tension > GRIEVANCE_WAR_THRESHOLD * 0.8) ceasefireScore -= 30;
                if (rel.turnsAtWar > 15) ceasefireScore += 20; // war-weariness
            } else if (rel.state === DIPLOMACY_STATES.WAR && peaceScore <= 0) {
                if (rel.turnsAtWar > 20) ceasefireScore = 30; // war-weariness alone
            }

            candidates.push({ other, ratio, theirPower, distance, sharedEnemy, isNeighbor, isDistant, allianceScore, tradeScore, peaceScore, napScore, ceasefireScore, rel });
        }

        // Sort by best opportunity
        candidates.sort((a, b) => Math.max(b.peaceScore, b.allianceScore, b.tradeScore, b.napScore, b.ceasefireScore) - Math.max(a.peaceScore, a.allianceScore, a.tradeScore, a.napScore, a.ceasefireScore));

        for (const c of candidates) {
            const { other, ratio, theirPower, rel, allianceScore, tradeScore, peaceScore, napScore, ceasefireScore, sharedEnemy, isDistant } = c;
            let type = null;

            // Pick best treaty type based on strategic scores
            if (ceasefireScore > 40) type = DIPLOMACY_STATES.CEASEFIRE;
            else if (peaceScore > 60) type = DIPLOMACY_STATES.PEACE;
            else if (napScore > 40 && Math.random() < 0.5) type = DIPLOMACY_STATES.NAP;
            else if (allianceScore > 40 && Math.random() < 0.3 + (allianceScore / 200)) type = DIPLOMACY_STATES.ALLIANCE;
            else if (tradeScore > 30 && Math.random() < 0.35) type = DIPLOMACY_STATES.TRADE_PACT;

            // Fallback to simple logic if scoring didn't produce a type
            if (!type) {
                if (rel.state === DIPLOMACY_STATES.WAR) {
                    if (ratio < 0.8 || (rel.turnsAtWar || 0) > 8) type = DIPLOMACY_STATES.PEACE;
                } else if (rel.state === DIPLOMACY_STATES.NEUTRAL) {
                    if ((rel.relationship || 0) > 0 && Math.random() < 0.2) type = DIPLOMACY_STATES.NAP;
                } else if (rel.state === DIPLOMACY_STATES.PEACE) {
                    if ((rel.relationship || 0) > 40 && Math.random() < 0.2) type = DIPLOMACY_STATES.ALLIANCE;
                    else if ((rel.relationship || 0) > 0 && Math.random() < 0.3) type = DIPLOMACY_STATES.TRADE_PACT;
                } else if (rel.state === DIPLOMACY_STATES.TRADE_PACT) {
                    if ((rel.relationship || 0) > 50 && (rel.turnsAtPeace || 0) > 6 && Math.random() < 0.15) type = DIPLOMACY_STATES.ALLIANCE;
                }
            }

            if (!type) continue;

            const otherName = this.factionColors[other] ? this.factionColors[other].name : other;
            const label = type === DIPLOMACY_STATES.PEACE ? 'peace'
                : type === DIPLOMACY_STATES.TRADE_PACT ? 'a trade pact'
                : type === DIPLOMACY_STATES.NAP ? 'a non-aggression pact'
                : type === DIPLOMACY_STATES.CEASEFIRE ? 'a ceasefire'
                : 'an alliance';

            if (other === PLAYER_FACTION) {
                const dup = diplo.pendingOffers.some(o =>
                    o.from === faction && o.to === other && o.type === type);
                if (dup) continue;
                diplo.pendingOffers.push({ from: faction, to: other, type, turnProposed: this.gameState.turn });
                const reason = sharedEnemy ? ' (shared enemy!)' : isDistant ? ' (distant friend)' : '';
                this.log(`${factionName} proposes ${label} with ${otherName}${reason}. (Diplomacy panel �?respond.)`);
                return;
            }

            // AI-AI: both sides must agree
            const otherDef = this.factionDefs[other];
            const otherPers = (otherDef && otherDef.aiPersonality) || 'DEFENSIVE';
            const theirGriev = rel.grievances || 0;
            const bt = rel.brokenTreaties || 0;
            const a = aiDecideTreaty(personality, type, ratio, rel.relationship || 0, bt, 0, false, theirGriev);
            const b = aiDecideTreaty(otherPers, type, theirPower / myPower, rel.relationship || 0, bt, 0, false, theirGriev);
            if (a && b) {
                const turn = this.gameState.turn || 0;
                const duration = type === DIPLOMACY_STATES.NAP ? 15 :
                                type === DIPLOMACY_STATES.CEASEFIRE ? 8 : 0;
                setRelation(diplo, faction, other, type, turn, duration);
                if (type === DIPLOMACY_STATES.TRADE_PACT) {
                    rel.tradeAmount = 10;
                    // Pick export material based on resource surplus
                    const myRes = this.gameState.resources[faction] || {};
                    if ((myRes.iron || 0) > 50) rel.tradeMaterial = 'IRON';
                    else if ((myRes.wood || 0) > 50) rel.tradeMaterial = 'WOOD';
                    else if ((myRes.food || 0) > 50) rel.tradeMaterial = 'FOOD';
                    else rel.tradeMaterial = 'GOLD';
                }
                const reason = sharedEnemy ? ' (shared enemy!)' : '';
                this.log(`${factionName} and ${otherName} signed ${label}.${reason}`);
            }
            return;
        }
    }

    /** Move AI lords/kings outward so they lead expansion and press the map
     *  instead of sitting on the capital. Lords move before units so the army
     *  can follow their lead, and their target depends on class and the position
     *  of their army. Lords share tiles with their own army, so own units never
     *  block. */
    _aiMoveLords(faction) {
        const lords = (this.gameState.lords || []).filter(l =>
            l.owner === faction && !l.hasMovedThisTurn);
        if (!lords.length) return;
        const atWar = (o) => canAttack(this.gameState.diplomacy, faction, o);
        const pool = this.gameState.resources[faction];
        const ownCities = [...this.tiles.values()].filter(t => t.terrain === 'CITY' && t.owner === faction);

        const armyCentroid = (lord) => {
            const army = (lord.army || []).map(id => this.gameState.units.get(id)).filter(Boolean);
            if (!army.length) return { x: lord.x, z: lord.z };
            const sx = army.reduce((a, u) => a + u.x, 0);
            const sz = army.reduce((a, u) => a + u.z, 0);
            return { x: Math.round(sx / army.length), z: Math.round(sz / army.length) };
        };

        const nearestEnemyCity = (ref) => {
            let target = null, best = Infinity;
            for (const t of this.tiles.values()) {
                if (t.terrain !== 'CITY' || !t.owner || t.owner === faction) continue;
                if (!atWar(t.owner)) continue;
                const d = Math.abs(t.x - ref.x) + Math.abs(t.z - ref.z);
                if (d < best) { best = d; target = t; }
            }
            return target;
        };

        const nearestThreatenedOwnCity = (lord) => {
            let target = null, best = Infinity;
            for (const c of ownCities) {
                let threatened = false;
                for (const u of this.gameState.units.values()) {
                    if (u.owner === faction) continue;
                    if (!atWar(u.owner)) continue;
                    if (Math.abs(u.x - c.x) + Math.abs(u.z - c.z) <= 6) { threatened = true; break; }
                }
                if (!threatened) continue;
                const d = Math.abs(c.x - lord.x) + Math.abs(c.z - lord.z);
                if (d < best) { best = d; target = c; }
            }
            return target;
        };

        const pickTarget = (lord) => {
            const cls = (lord.class && LORD_CLASSES[lord.class]) || {};
            const bonus = cls.bonus || {};
            const centroid = armyCentroid(lord);
            // Guardian lords protect threatened cities; otherwise they hold near the capital.
            if (lord.class === 'GUARDIAN') {
                const threatened = nearestThreatenedOwnCity(lord);
                if (threatened) return threatened;
                const capital = ownCities.find(t => t.isCapital) || ownCities[0];
                if (capital) return capital;
            }
            // Warlord / Conqueror / Grand Commander push toward the enemy.
            const enemyCity = nearestEnemyCity(centroid) || nearestEnemyCity(lord);
            if (enemyCity) return enemyCity;
            // Fallback: nearest unowned land tile.
            let best = Infinity, target = null;
            for (const t of this.tiles.values()) {
                if (t.owner) continue;
                if (t.terrain === 'WATER' || t.terrain === 'RIVER' || t.terrain === 'MOUNTAIN') continue;
                const d = Math.abs(t.x - lord.x) + Math.abs(t.z - lord.z);
                if (d < best) { best = d; target = t; }
            }
            if (target) return target;
            // Last resort: nearest enemy-owned tile.
            for (const t of this.tiles.values()) {
                if (!t.owner || t.owner === faction) continue;
                const d = Math.abs(t.x - lord.x) + Math.abs(t.z - lord.z);
                if (d < best) { best = d; target = t; }
            }
            return target;
        };

        for (const lord of lords) {
            if (lord.isKing) {
                this._aiMoveKing(lord, faction, atWar, pool);
                continue;
            }
            // Don't let a lord charge ahead of its army. If separated from the
            // bulk of its troops, regroup first; only then push the objective.
            const centroid = armyCentroid(lord);
            const distToArmy = Math.abs(lord.x - centroid.x) + Math.abs(lord.z - centroid.z);
            let target;
            if ((lord.army || []).length > 0 && distToArmy > 4) {
                target = centroid;
            } else {
                target = pickTarget(lord);
            }
            if (!target) continue;
            for (let s = 0; s < 2; s++) {
                if (lord.x === target.x && lord.z === target.z) break;
                const step = nextStepToward(this.tiles, this.gameState.units, lord, target, 200, faction);
                if (!step || (step.x === lord.x && step.z === lord.z)) break;
                const destTile = this.tiles.get(`${step.x},${step.z}`);
                // Lords may enter a capturable city (breached / siege-tower adjacent).
                if (destTile && destTile.terrain === 'CITY' && destTile.owner && destTile.owner !== faction &&
                    !canCaptureTile(faction, destTile, pool) && !this.siegeTowerAdjacentTo(destTile, faction)) break;
                lord.x = step.x; lord.z = step.z;
            }
            lord.hasMovedThisTurn = true;
        }
    }

    /** Move an AI king. The king is a powerful early-game combatant and should
     *  be used aggressively: he intercepts enemy kings that harass friendly
     *  territory, anchors to the main conquest group, supports siege attacks on
     *  enemy cities, and retreats only when locally outmatched. */
    _aiMoveKing(lord, faction, atWar, pool) {
        const factionName = this.factionColors[faction] ? this.factionColors[faction].name : faction;

        // Military units (not scouts/settlers/workers) for army-strength checks.
        const military = [...this.gameState.units.values()].filter(u =>
            u.owner === faction && !['SCOUT', 'SETTLER', 'WORKER'].includes(u.type));
        const ownCities = getOwnedCities(this.tiles, faction);
        const nearestOwnCity = () => {
            let best = null, bestD = Infinity;
            for (const c of ownCities) {
                const d = Math.abs(c.x - lord.x) + Math.abs(c.z - lord.z);
                if (d < bestD) { bestD = d; best = c; }
            }
            return best;
        };

        const enemyUnits = [...this.gameState.units.values()].filter(u => u.owner !== faction && atWar(u.owner));
        const enemyLords = this.gameState.lords.filter(l => l.owner !== faction && atWar(l.owner));

        // Local power within Chebyshev radius (units + lords).
        const localPower = (x, z, radius, friendly) => {
            let power = 0;
            for (const u of this.gameState.units.values()) {
                if ((u.owner === faction) !== friendly) continue;
                if (Math.max(Math.abs(u.x - x), Math.abs(u.z - z)) > radius) continue;
                power += (u.hp || 1) + ((UNIT_TYPE[u.type] && UNIT_TYPE[u.type].attack) || 0);
            }
            for (const l of this.gameState.lords) {
                if ((l.owner === faction) !== friendly) continue;
                if (Math.max(Math.abs(l.x - x), Math.abs(l.z - z)) > radius) continue;
                power += (l.hp || 1) + lordAttack(l);
            }
            return power;
        };
        const friendLocal = localPower(lord.x, lord.z, 3, true);
        const foeLocal = localPower(lord.x, lord.z, 3, false);

        // 1) Capture a breached/unclaimed city that is within reach and empty.
        for (const t of this.tiles.values()) {
            if (t.terrain !== 'CITY' || t.owner === faction) continue;
            if (!canCaptureTile(faction, t, pool) && !this.siegeTowerAdjacentTo(t, faction)) continue;
            const dist = Math.max(Math.abs(t.x - lord.x), Math.abs(t.z - lord.z));
            if (dist > 2) continue;
            const enemyOnTile = enemyUnits.some(u => u.x === t.x && u.z === t.z);
            if (enemyOnTile) continue;
            this._aiStepLord(lord, t.x, t.z, faction, pool, factionName);
            return;
        }

        // 2) Retreat when locally outmatched (power-ratio based, not a fixed count).
        if (foeLocal > 0 && foeLocal > friendLocal * 1.3) {
            const home = nearestOwnCity();
            if (home) { this._aiStepLord(lord, home.x, home.z, faction, pool, factionName); return; }
        }

        // 2b) Respond to ranged fire. A ranged enemy (attackRange >= 2) hitting
        //     the king from outside the king's melee reach (Chebyshev > 1) is
        //     untouchable by the king's adjacent-only attack, so sitting still
        //     just eats damage. Close to melee if we can win locally; otherwise
        //     retreat out of range. The king steps TWICE here so it can actually
        //     reach a distance-2 archer or escape a distance-3 kill zone in one
        //     turn (its normal move is 1 tile/turn). Scoped to ranged response
        //     so the king doesn't generally outrun its army.
        {
            const resp = kingRangedResponse(lord, enemyUnits, friendLocal, foeLocal);
            if (resp) {
                if (resp.close) {
                    for (let s = 0; s < 2; s++) {
                        if (Math.max(Math.abs(lord.x - resp.target.x), Math.abs(lord.z - resp.target.z)) <= 1) break;
                        this._aiStepLord(lord, resp.target.x, resp.target.z, faction, pool, factionName);
                    }
                    return;
                }
                // Outmatched or too far to close �?retreat toward the nearest
                // own city, up to 2 steps, to escape the kill-zone.
                const home = nearestOwnCity();
                if (home) {
                    for (let s = 0; s < 2; s++) {
                        const nd = Math.max(Math.abs(resp.shooter.x - lord.x), Math.abs(resp.shooter.z - lord.z));
                        if (nd > resp.srange) break; // escaped
                        this._aiStepLord(lord, home.x, home.z, faction, pool, factionName);
                    }
                    return;
                }
            }
        }

        // 3) Early-game harassment response: an enemy king is pressing our territory.
        //    If our king can win locally, move to stop them instead of turtling.
        const earlyGame = military.length < 8;
        if (earlyGame && atWar) {
            let harasser = null, bestD = Infinity;
            for (const ek of enemyLords) {
                if (!ek.isKing) continue;
                const nearCity = ownCities.some(c => Math.abs(ek.x - c.x) + Math.abs(ek.z - c.z) <= 8);
                if (!nearCity) continue;
                const d = Math.abs(ek.x - lord.x) + Math.abs(ek.z - lord.z);
                if (d < bestD) { bestD = d; harasser = ek; }
            }
            if (harasser && friendLocal > foeLocal * 0.8) {
                this._aiStepLord(lord, harasser.x, harasser.z, faction, pool, factionName);
                return;
            }
        }

        // 3b) Join a crucial siege. If our army is besieging an at-war enemy
        //     city (>=3 friendly military within Chebyshev 3) and the enemy king
        //     is present (within Chebyshev 2), and we clearly outnumber the
        //     defenders locally, the king steps in to help crack the city �?a
        //     high-value objective at low risk. The retreat gate (step 2)
        //     already ensures we only advance when not locally outmatched.
        if (atWar) {
            let target = null, bestD = Infinity;
            for (const c of this.tiles.values()) {
                if (c.terrain !== 'CITY' || c.owner === faction || !atWar(c.owner)) continue;
                // (a) our army is besieging it: >=3 friendly military nearby.
                let friends = 0;
                for (const u of military) {
                    if (Math.max(Math.abs(u.x - c.x), Math.abs(u.z - c.z)) <= 3) {
                        friends++;
                        if (friends >= 3) break;
                    }
                }
                if (friends < 3) continue;
                // (b) the enemy king is present.
                const enemyKing = enemyLords.find(l => l.isKing &&
                    Math.max(Math.abs(l.x - c.x), Math.abs(l.z - c.z)) <= 2);
                if (!enemyKing) continue;
                // low risk: we outnumber the defenders locally.
                if (localPower(c.x, c.z, 3, true) <= localPower(c.x, c.z, 3, false) * 1.3) continue;
                const d = Math.max(Math.abs(c.x - lord.x), Math.abs(c.z - lord.z));
                if (d < bestD) { bestD = d; target = c; }
            }
            if (target && Math.max(Math.abs(lord.x - target.x), Math.abs(lord.z - target.z)) > 1) {
                this._aiStepLord(lord, target.x, target.z, faction, pool, factionName);
                return;
            }
        }

        // 4) Anchor to the main conquest group or military centroid once we have
        //    a modest force (3+ military units). This gets the king into fights.
        if (military.length >= 3) {
            let anchor = null;
            let bestArmy = null, bestSize = 1;
            for (const l of this.gameState.lords) {
                if (l.owner !== faction || l.isKing) continue;
                const size = (l.army || []).length;
                if (size >= 2 && size > bestSize) { bestSize = size; bestArmy = l; }
            }
            if (bestArmy) {
                anchor = bestArmy;
            } else {
                let sx = 0, sz = 0;
                for (const u of military) { sx += u.x; sz += u.z; }
                anchor = { x: Math.round(sx / military.length), z: Math.round(sz / military.length) };
            }
            if (anchor && Math.max(Math.abs(lord.x - anchor.x), Math.abs(lord.z - anchor.z)) > 2) {
                this._aiStepLord(lord, anchor.x, anchor.z, faction, pool, factionName);
                return;
            }
        }

        // 5) Anti-camp: if the king is stuck beside an enemy city it cannot take,
        //    count turns and move away before it creates a stalemate.
        const adjacentEnemyCity = [...this.tiles.values()].find(t =>
            t.terrain === 'CITY' && t.owner && t.owner !== faction && atWar(t.owner) &&
            Math.max(Math.abs(t.x - lord.x), Math.abs(t.z - lord.z)) <= 1);
        if (adjacentEnemyCity && !canCaptureTile(faction, adjacentEnemyCity, pool) && !this.siegeTowerAdjacentTo(adjacentEnemyCity, faction)) {
            lord.campTurns = (lord.campTurns || 0) + 1;
            if (lord.campTurns >= 2) {
                const home = nearestOwnCity();
                if (home) {
                    this._aiStepLord(lord, home.x, home.z, faction, pool, factionName);
                    lord.campTurns = 0;
                    return;
                }
            }
        } else {
            lord.campTurns = 0;
        }

        // 6) No objective / tiny army: stay within a few tiles of the nearest
        //    own city so the king is available to defend.
        const home = nearestOwnCity();
        if (home && Math.max(Math.abs(lord.x - home.x), Math.abs(lord.z - home.z)) > 3) {
            this._aiStepLord(lord, home.x, home.z, faction, pool, factionName);
            return;
        }

        lord.hasMovedThisTurn = true;
    }

    /** Take one A* step for a lord toward a target; capture cities along the way. */
    _aiStepLord(lord, targetX, targetZ, faction, pool, factionName) {
        const step = nextStepToward(this.tiles, this.gameState.units, lord, { x: targetX, z: targetZ }, 200, faction);
        if (step && (step.x !== lord.x || step.z !== lord.z)) {
            const destTile = this.tiles.get(`${step.x},${step.z}`);
            // Block entry into enemy city that is not yet capturable.
            if (destTile && destTile.terrain === 'CITY' && destTile.owner && destTile.owner !== faction &&
                !canCaptureTile(faction, destTile, pool) && !this.siegeTowerAdjacentTo(destTile, faction)) {
                // no step
            } else {
                lord.x = step.x; lord.z = step.z;
                if (destTile && destTile.terrain === 'CITY' && destTile.owner !== faction &&
                    (canCaptureTile(faction, destTile, pool) || this.siegeTowerAdjacentTo(destTile, faction))) {
                    pool.gold -= CAPTURE_COST;
                    const prevOwner = destTile.owner;
                    const wasNeutral = !prevOwner;
                    captureCityTerritory(this.tiles, destTile, faction, this.gameState.structures, this.gameState.buildings, this.gameState.buildingState).forEach(m => this.log(`${factionName}: ${m}`));
                    this._awardCaptureGrievances(destTile, faction, prevOwner, wasNeutral);
                    this.checkVictory();
                }
            }
        }
        lord.hasMovedThisTurn = true;
    }

    /** An AI lord/king attacks an adjacent at-war enemy. Prioritizes exposed
     *  enemy lords/kings, then vulnerable support units, then the weakest unit.
     *  Reuses the player's handleLordAttack so logging/cleanup are consistent. */
    _aiLordAttack(faction) {
        for (const lord of (this.gameState.lords || [])) {
            if (lord.owner !== faction || lord.hasAttackedThisTurn) continue;
            let best = null, bestScore = -Infinity;
            // Exposed enemy lords/kings are the highest-value targets.
            for (const other of this.gameState.lords) {
                if (other === lord || other.owner === faction) continue;
                if (!canAttack(this.gameState.diplomacy, faction, other.owner)) continue;
                if (Math.max(Math.abs(other.x - lord.x), Math.abs(other.z - lord.z)) > 1) continue;
                const guarded = [...this.gameState.units.values()]
                    .some(u => u.owner === other.owner && u.x === other.x && u.z === other.z);
                if (guarded) continue;
                let score = 300 - (other.hp || 0);
                if (other.isKing) score += 200;
                if (score > bestScore) { bestScore = score; best = other; }
            }
            // Adjacent enemy units.
            for (const u of this.gameState.units.values()) {
                if (u.owner === faction) continue;
                if (!canAttack(this.gameState.diplomacy, faction, u.owner)) continue;
                if (Math.max(Math.abs(u.x - lord.x), Math.abs(u.z - lord.z)) > 1) continue;
                let score = 100 - (u.hp || 0);
                if (u.type === 'SETTLER' || u.type === 'WORKER' || u.type === 'SCOUT') score += 40;
                else if (['ARCHER', 'LONGBOWMAN', 'ARTILLERY', 'CATAPULT', 'TREBUCHET', 'MEDIC'].includes(u.type)) score += 20;
                if (score > bestScore) { bestScore = score; best = u; }
            }
            if (best) this.handleLordAttack(lord, best);
        }
    }

    /** Any AI unit that still has its action and sits adjacent to an exposed
     *  at-war enemy lord attacks that lord. */
    _aiUnitAttackLords(faction) {
        for (const unit of this.gameState.units.values()) {
            if (unit.owner !== faction || unit.hasAttackedThisTurn) continue;
            const udef = UNIT_TYPE[unit.type];
            const range = (udef && udef.attackRange) || (udef && udef.ranged ? 2 : 1);
            for (const other of this.gameState.lords) {
                if (other.owner === faction) continue;
                if (!canAttack(this.gameState.diplomacy, faction, other.owner)) continue;
                if (Math.max(Math.abs(unit.x - other.x), Math.abs(unit.z - other.z)) > range) continue;
                const guarded = [...this.gameState.units.values()]
                    .some(u => u.owner === other.owner && u.x === other.x && u.z === other.z);
                if (guarded) continue;
                this.handleAttack(unit, lordCombatant(other));
                break;
            }
        }
    }

    /** Decide whether this AI faction should activate its king ability this turn.
     *  Uses deterministic heuristics instead of random chance: offensive abilities
     *  fire when pushing a city or outnumbered, defensive abilities fire when the
     *  kingdom is threatened. */
    _aiShouldActivateKing(faction, def) {
        const king = this.gameState.lords.find(l => l.owner === faction && l.isKing);
        if (!king || !king.active) return false;
        const id = king.active.id;
        const atWar = (o) => canAttack(this.gameState.diplomacy, faction, o);
        const enemyUnits = [...this.gameState.units.values()].filter(u => u.owner !== faction && atWar(u.owner));
        const ownCities = getOwnedCities(this.tiles, faction);
        const threatened = ownCities.some(c => enemyUnits.some(u => Math.abs(u.x - c.x) + Math.abs(u.z - c.z) <= 5));
        const enemyNearKing = enemyUnits.some(u => Math.max(Math.abs(u.x - king.x), Math.abs(u.z - king.z)) <= 3);
        const enemyCityNear = [...this.tiles.values()].some(t =>
            t.terrain === 'CITY' && t.owner && t.owner !== faction && atWar(t.owner) &&
            Math.abs(t.x - king.x) + Math.abs(t.z - king.z) <= 8);
        const res = this.gameState.resources[faction];

        switch (id) {
            case 'bloodlust':
            case 'stampede':
                return enemyCityNear || enemyUnits.length >= 3;
            case 'bulwark':
            case 'ironwill':
            case 'wintersgrasp':
            case 'vanish':
                return threatened || enemyNearKing;
            case 'tempest':
                return enemyUnits.some(u => [...this.gameState.units.values()].some(fu =>
                    fu.owner === faction && Math.max(Math.abs(fu.x - u.x), Math.abs(fu.z - u.z)) <= 2));
            case 'harvest':
                return (res.gold || 0) < 60 || (res.food || 0) < 50;
            case 'raise':
                return this.gameState.graveyard.some(g => g.owner === faction);
            case 'scry':
                return false; // AI already has full map knowledge; don't pollute player fog
        }
        return false;
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

        // --- AI diplomacy: propose peace/trade/alliance from a position of
        // need or friendship. AI->player offers land in pendingOffers. ---
        this._aiMaybeProposeTreaty(faction, def, factionName);

        // Tick this AI faction's in-progress Siege Tower builds.
        this._tickConstructionFor(faction);

        // Lead from the front: move AI lords/kings outward toward a target so
        // they expand and press the map instead of sitting home guarding the
        // capital. Done before unit actions so the army repositions around the
        // relocated lord.
        this._aiMoveLords(faction);
        // Lords/kings lead from the front: after moving, an AI lord attacks an
        // adjacent at-war enemy (unit or exposed lord) if it has one.
        this._aiLordAttack(faction);

        const actions = computeAIActions(this.gameState.units, this.gameState.tiles, pool, faction, this.gameState.buildings, influence, def, this.gameState.diplomacy,
            this.gameState.lords, this.gameState.tempBonuses, this.gameState.structures, this.gameState.buildingState,
            this.gameState.aiState ? this.gameState.aiState[faction] : null);

        // AI king: activate when off cooldown and a heuristic trigger is met.
        if ((this.gameState.kingCooldowns[faction] || 0) <= 0 && this._aiShouldActivateKing(faction, def)) {
            this.activateKing(faction);
        }

        for (const action of actions) {
            switch (action.type) {
                case 'train': {
                    const tile = this.tiles.get(action.tileKey);
                    if (tile) {
                        if (this.gameState.trainedThisTurn.has(action.tileKey)) break;
                        // Siege engines require a Siege Workshop in this city's influence.
                        if (SIEGE_ENGINES.includes(action.unitType) && !this.bestMilitaryLevel(tile, 'SIEGE_WORKSHOP')) break;
                        // Ships require a Harbor in this city's influence.
                        if (NAVAL_UNITS.includes(action.unitType)) {
                            if (!this.bestMilitaryLevel(tile, 'HARBOR')) break;
                            // 6c �?Enemy warship blockade blocks ship production.
                            if (this._isHarborBlockaded(tile.x, tile.z)) break;
                        }
                        const unitCap = getUnitCap(this.tiles, faction);
                        const count = [...this.gameState.units.values()].filter(u => u.owner === faction).length;
                        const barracks = this.bestMilitaryLevel(tile, 'BARRACKS');
                        const veteran = barracks ? barracks.veteranLevel : 1;
                        const goldMult = barracks ? barracks.goldMult : 1;
                        let cost = getUnitCostFor(action.unitType, def);
                        if (goldMult !== 1) cost = { ...cost, gold: Math.floor((cost.gold || 0) * goldMult) };
                        if (count < unitCap && canAfford(action.unitType, pool, cost)) {
                            this.gameState.resources[faction] = spendCost(action.unitType, pool, cost);
                            const unit = createUnit(action.unitType, faction, tile.x, tile.z, { veteran, factionDef: def });
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
                case 'recruitLord': {
                    const nonKings = (this.gameState.lords || []).filter(l => l.owner === faction && !l.isKing);
                    const cities = getOwnedCities(this.tiles, faction);
                    if (!cities.length) break;
                    // Cap scales with empire size: one non-king lord per city,
                    // min 3, so each major army group can have a commander.
                    if (nonKings.length >= Math.max(3, cities.length)) break;
                    if (!canRecruitLord(pool)) break;
                    // Note: a lord's single bodyguard INFANTRY is allowed to
                    // exceed the unit cap �?it should not block army growth.
                    const city = cities[0];
                    pool.gold -= LORD_RECRUIT_COST.gold;
                    pool.food -= LORD_RECRUIT_COST.food;
                    const lord = createLord(faction, city.x, city.z);
                    const unit = createUnit('INFANTRY', faction, city.x, city.z, { factionDef: def });
                    this.gameState.units.set(unit.id, unit);
                    assignArmy(lord, unit.id);
                    unit.lordId = lord.id;
                    this.gameState.lords.push(lord);
                    this.log(`${factionName} recruited lord ${lord.name} the ${lord.class} at [${city.x}, ${city.z}]`);
                    break;
                }
                case 'build': {
                    const tile = this.tiles.get(action.tileKey);
                    if (tile) {
                        const msgs = constructBuilding(action.buildingType, tile, pool, this.gameState.buildings, influence, this.tiles, this.gameState.buildingState);
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
                        const msgs = constructBuilding(action.buildingType, tile, pool, this.gameState.buildings, influence, this.tiles, this.gameState.buildingState);
                        if (msgs.length && msgs[0].startsWith('Built')) {
                            unit.hasAttackedThisTurn = true;
                            msgs.forEach(m => this.log(`${factionName}: ${m}`));
                        }
                    }
                    break;
                }
                case 'upgradeBuilding': {
                    const tile = this.tiles.get(action.tileKey);
                    if (tile) {
                        const msgs = upgradeBuilding(action.buildingType, tile, pool, this.gameState.buildings, this.gameState.buildingState);
                        msgs.forEach(m => this.log(`${factionName}: ${m}`));
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
                        const removed = removeBuilding(tile, this.gameState.buildings, this.gameState.buildingState);
                        if (removed) {
                            const reward = BUILDING_TYPE[removed] && BUILDING_TYPE[removed].military ? MILITARY_PILLAGE_GOLD : PILLAGE_GOLD_REWARD;
                            pool.gold = (pool.gold || 0) + reward;
                            unit.hasAttackedThisTurn = true;
                            const bName = BUILDING_TYPE[removed] ? BUILDING_TYPE[removed].name : removed;
                            this.log(`${factionName}: pillaged a ${bName} at [${tile.x}, ${tile.z}] (+${reward} gold).`);
                        }
                    }
                    break;
                }
                case 'attackBuilding': {
                    // A military unit damages an adjacent enemy military structure.
                    const unit = this.gameState.units.get(action.unitId);
                    const tile = this.tiles.get(action.tileKey);
                    if (unit && tile && !unit.hasAttackedThisTurn && tile.owner &&
                        tile.owner !== faction && canAttack(this.gameState.diplomacy, faction, tile.owner) &&
                        Math.max(Math.abs(tile.x - unit.x), Math.abs(tile.z - unit.z)) <= 1) {
                        const list = this.gameState.buildings.get(`${tile.x},${tile.z}`) || [];
                        const bType = list.find(b => BUILDING_TYPE[b] && BUILDING_TYPE[b].military);
                        if (bType) {
                            const def = MILITARY_BUILDING_DEFENSE[bType] || 0;
                            const dmg = Math.max(1, unit.attack - def);
                            const destroyed = damageBuilding(`${tile.x},${tile.z}`, bType, dmg, this.gameState.buildingState);
                            unit.hasAttackedThisTurn = true;
                            if (destroyed) {
                                removeBuilding(tile, this.gameState.buildings, this.gameState.buildingState);
                                pool.gold = (pool.gold || 0) + MILITARY_PILLAGE_GOLD;
                                this.log(`${factionName}: destroyed and pillaged ${BUILDING_TYPE[bType].name} at [${tile.x}, ${tile.z}] (+${MILITARY_PILLAGE_GOLD} gold)!`);
                            } else {
                                this.log(`${factionName}: dealt ${dmg} damage to ${BUILDING_TYPE[bType].name} at [${tile.x}, ${tile.z}].`);
                            }
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
                            const prevOwner = dest.owner;
                            const wasNeutral = !prevOwner;
                            captureCityTerritory(this.tiles, dest, faction, this.gameState.structures, this.gameState.buildings, this.gameState.buildingState).forEach(m => this.log(`${factionName}: ${m}`));
                            this._awardCaptureGrievances(dest, faction, prevOwner, wasNeutral);
                        }
                        // An enemy fall trap on the destination springs now.
                        this._checkFallTrap(unit);
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
                            attackerLord, defenderLord, this.gameState.buildings, this.gameState.lords, this.gameState.tempBonuses, false, this.gameState.structures,
                            !!(defenderTile && defenderTile.terrain === 'CITY' && (defenderTile.fortification || 0) <= 0));
                        result.messages.forEach(m => this.log(m));
                        attacker.hasAttackedThisTurn = true;
                        this._playAttackAnimation(attacker, defender);
                        if (result.defenderDied) {
                            this._onUnitDeath(defender);
                            this._maybeRespawnOnKill(faction);
                        }
                        if (result.attackerDied) this._onUnitDeath(attacker);
                        if (UNIT_TYPE[attacker.type].aoe) {
                            this._applyAoeAndFire(attacker, defender, result.damageToDefender || 0);
                            if (this.renderer && this.renderer.addImpact) {
                                this.renderer.addImpact(defender.x, defender.z, attacker.x, attacker.z);
                            }
                        }
                    }
                    break;
                }
                case 'capture': {
                    const unit = this.gameState.units.get(action.unitId);
                    const tile = this.tiles.get(action.tileKey);
                    // Ownership re-checked: another unit may have taken the city
                    // earlier in this same action loop.
                    if (unit && tile && tile.terrain === 'CITY' && tile.owner !== faction && pool.gold >= CAPTURE_COST) {
                        pool.gold -= CAPTURE_COST;
                        const prevOwner = tile.owner;
                        const wasNeutral = !prevOwner;
                        captureCityTerritory(this.tiles, tile, faction, this.gameState.structures, this.gameState.buildings, this.gameState.buildingState).forEach(m => this.log(`${factionName}: ${m}`));
                        this._awardCaptureGrievances(tile, faction, prevOwner, wasNeutral);
                        // Garrison the capturing unit on the city tile.
                        unit.x = tile.x; unit.z = tile.z; unit.hasMovedThisTurn = true;
                        this.renderer.updateTileTerrain(tile);
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
                            this.renderer.updateTileTerrain(tile);
                            this._awardFoundGrievances(tile, faction);
                            this.gameState.units.delete(unit.id);
                            removeUnitFromArmies(this.gameState.lords, unit.id);
                        } else if (msgs.length) {
                            this.log(`${factionName}: ${msgs[0]}`);
                        }
                    }
                    break;
                }
                case 'levelUpCity': {
                    // AI invests resources to grow a city a level (mirrors the
                    // player's handleLevelUpCity). Ownership re-checked in case
                    // the city changed hands since the action was planned.
                    const tile = this.tiles.get(action.tileKey);
                    if (tile && tile.terrain === 'CITY' && tile.owner === faction &&
                        (tile.cityLevel || 1) < CITY_MAX_LEVEL) {
                        const lvl = tile.cityLevel || 1;
                        const cost = {
                            gold: CITY_LEVEL_UP_COST.gold * lvl,
                            food: CITY_LEVEL_UP_COST.food * lvl,
                            production: CITY_LEVEL_UP_COST.production * lvl
                        };
                        if (pool.gold >= cost.gold && pool.food >= cost.food &&
                            (pool.production || 0) >= cost.production) {
                            pool.gold -= cost.gold;
                            pool.food -= cost.food;
                            pool.production = (pool.production || 0) - cost.production;
                            tile.cityLevel = lvl + 1;
                            tile.fortMax = 2 + tile.cityLevel;
                            tile.fortification = tile.fortMax;
                            const claimed = expandCityTerritory(this.tiles, tile, faction);
                            this.renderer.updateTileTerrain(tile);
                            this.log(`${factionName}: city at [${tile.x}, ${tile.z}] leveled up to Lv.${tile.cityLevel}${claimed ? ` (+${claimed} tiles)` : ''}.`);
                        }
                    }
                    break;
                }
                case 'buildSiegeTower': {
                    // An AI engineer starts a siege tower vs an adjacent enemy
                    // city. Mirrors the player's handleBuildSiegeTower but for
                    // an AI faction (ticks down via _tickConstructionFor).
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
                case 'buildStructure': {
                    // An AI engineer (or Legionnaire) starts a defensive structure
                    // (SPIKES / FORTIFICATION / FALL_TRAP) on its current tile.
                    // Mirrors the player's handleBuildStructure; ticks via
                    // _tickConstructionFor.
                    const unit = this.gameState.units.get(action.unitId);
                    if (!unit || unit.owner !== faction) break;
                    const usd2 = UNIT_TYPE[unit.type];
                    if (!usd2 || !usd2.canBuildStructure) break;
                    if (unit.hasAttackedThisTurn) break;
                    if (this.gameState.construction && this.gameState.construction.has(unit.id)) break;
                    const sdef = STRUCTURE_TYPE[action.structureType];
                    if (!sdef) break;
                    const tile = this.tiles.get(`${unit.x},${unit.z}`);
                    if (!tile || tile.owner !== faction || tile.terrain === 'CITY' ||
                        tile.terrain === 'WATER' || tile.terrain === 'RIVER') break;
                    if (this.gameState.structures && this.gameState.structures.has(`${tile.x},${tile.z}`)) break;
                    const sCost = STRUCTURE_COST[action.structureType] || {};
                    let canPayS = true;
                    for (const [res, amt] of Object.entries(sCost)) {
                        if ((pool[res] || 0) < amt) { canPayS = false; break; }
                    }
                    if (!canPayS) break;
                    for (const [res, amt] of Object.entries(sCost)) pool[res] = (pool[res] || 0) - amt;
                    this.gameState.construction.set(unit.id, {
                        type: 'STRUCTURE', structureType: action.structureType,
                        turnsLeft: sdef.buildTurns || 2, x: tile.x, z: tile.z, faction
                    });
                    unit.hasAttackedThisTurn = true;
                    this.log(`${factionName}: engineer started ${sdef.name} at [${tile.x}, ${tile.z}].`);
                    break;
                }
                case 'buildBridge': {
                    // An AI engineer bridges an adjacent unbridged river tile.
                    // Mirrors the player's handleBuildBridge (no UI highlights).
                    const unit = this.gameState.units.get(action.unitId);
                    if (!unit || (unit.type !== 'ENGINEER' && unit.type !== 'SIEGE') ||
                        unit.owner !== faction) break;
                    if (unit.hasAttackedThisTurn) break;
                    const riverTile = this.tiles.get(action.tileKey);
                    if (!riverTile || riverTile.terrain !== 'RIVER' || riverTile.bridge) break;
                    const dist = Math.abs(unit.x - riverTile.x) + Math.abs(unit.z - riverTile.z);
                    if (dist !== 1) break;
                    let canPayB = true;
                    for (const [res, amt] of Object.entries(BRIDGE_COST)) {
                        if ((pool[res] || 0) < amt) { canPayB = false; break; }
                    }
                    if (!canPayB) break;
                    for (const [res, amt] of Object.entries(BRIDGE_COST)) pool[res] = (pool[res] || 0) - amt;
                    riverTile.bridge = true;
                    if (this.gameState.bridges) this.gameState.bridges.add(`${riverTile.x},${riverTile.z}`);
                    unit.hasAttackedThisTurn = true;
                    this.log(`${factionName}: engineer built a bridge at [${riverTile.x}, ${riverTile.z}].`);
                    break;
                }
                case 'board': {
                    // An AI land unit boards an orthogonally-adjacent friendly
                    // transport (mirrors the player's handleBoard, no UI).
                    const unit = this.gameState.units.get(action.unitId);
                    const transport = this.gameState.units.get(action.transportId);
                    if (!unit || !transport || unit.owner !== faction || transport.owner !== faction) break;
                    if (transport.type !== 'TRANSPORT' || unit.boarded) break;
                    const ndef = UNIT_TYPE[unit.type];
                    if (!ndef || ndef.naval) break;
                    const cap = UNIT_TYPE.TRANSPORT.capacity || 2;
                    if (((transport.cargo || []).length) >= cap) break;
                    if (Math.abs(unit.x - transport.x) + Math.abs(unit.z - transport.z) !== 1) break;
                    if (!transport.cargo) transport.cargo = [];
                    transport.cargo.push(unit.id);
                    unit.boarded = transport.id;
                    unit.x = transport.x; unit.z = transport.z;
                    unit.hasMovedThisTurn = true;
                    unit.hasAttackedThisTurn = true;
                    this.log(`${factionName}: ${UNIT_TYPE[unit.type].name} boarded a transport.`);
                    break;
                }
                case 'disembark': {
                    // An AI transport unloads one carried unit onto an adjacent
                    // passable land tile (mirrors handleDisembark, no UI).
                    const transport = this.gameState.units.get(action.unitId);
                    if (!transport || transport.owner !== faction || transport.type !== 'TRANSPORT') break;
                    if (!transport.cargo || transport.cargo.length === 0) break;
                    let dest = null;
                    for (const [dx, dz] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
                        const t = this.tiles.get(`${transport.x + dx},${transport.z + dz}`);
                        if (!t || !isPassable(t)) continue;
                        let blocked = false;
                        for (const u of this.gameState.units.values()) {
                            if (!u.boarded && u.x === t.x && u.z === t.z) { blocked = true; break; }
                        }
                        if (!blocked) { dest = t; break; }
                    }
                    if (!dest) break;
                    const unitId = transport.cargo.shift();
                    const unit = this.gameState.units.get(unitId);
                    if (!unit) break;
                    unit.boarded = false;
                    unit.x = dest.x; unit.z = dest.z;
                    unit.hasMovedThisTurn = true;
                    unit.hasAttackedThisTurn = true;
                    this._checkFallTrap(unit);
                    this.log(`${factionName}: ${UNIT_TYPE[unit.type].name} disembarked at [${dest.x}, ${dest.z}].`);
                    break;
                }
                case 'charge': {
                    // AI cavalry charge �?mirrors handleCharge for an AI faction.
                    const attacker = this.gameState.units.get(action.fromId);
                    const defender = this.gameState.units.get(action.toId);
                    if (!attacker || !defender) break;
                    if (!CHARGE_UNITS.includes(attacker.type)) break;
                    if (attacker.hasAttackedThisTurn) break;
                    if (!canAttack(this.gameState.diplomacy, attacker.owner, defender.owner)) break;
                    if (Math.max(Math.abs(attacker.x - defender.x), Math.abs(attacker.z - defender.z)) > CHARGE_RANGE) break;
                    attacker.x = defender.x; attacker.z = defender.z;
                    // Traps and spiked defenses punish the charge before the blow.
                    this._checkFallTrap(attacker);
                    if (!this.gameState.units.has(attacker.id)) break; // died to a trap
                    if (!this._applySpikesOnCharge(attacker)) break;   // impaled on spikes
                    const originalAttack = attacker.attack ?? UNIT_TYPE[attacker.type].attack;
                    const cdef = this.factionDefs ? this.factionDefs[attacker.owner] : null;
                    attacker.attack = originalAttack + CHARGE_ATTACK_BONUS + getCavalryChargeBonus(cdef);
                    const defenderTile = this.tiles.get(`${defender.x},${defender.z}`);
                    const terrain = defenderTile ? defenderTile.terrain : 'PLAINS';
                    const attackerLord = findCommandingLord(this.gameState.lords, attacker);
                    const defenderLord = findCommandingLord(this.gameState.lords, defender);
                    const result = resolveCombat(attacker, defender, terrain,
                        attackerLord, defenderLord, this.gameState.buildings, this.gameState.lords, this.gameState.tempBonuses, false, this.gameState.structures,
                        !!(defenderTile && defenderTile.terrain === 'CITY' && (defenderTile.fortification || 0) <= 0));
                    attacker.attack = originalAttack;
                    result.messages.forEach(m => this.log(m));
                    attacker.hasAttackedThisTurn = true;
                    attacker.hasMovedThisTurn = true;
                    attacker.chargeExhausted = CHARGE_EXHAUST_TURNS;
                    this._playAttackAnimation(attacker, defender);
                    if (result.defenderDied) {
                        this._onUnitDeath(defender);
                        this._maybeRespawnOnKill(faction);
                    }
                    if (result.attackerDied) this._onUnitDeath(attacker);
                    break;
                }
                case 'chariotCharge': {
                    // AI chariot charge �?mirrors handleChariotCharge for an AI faction.
                    const attacker = this.gameState.units.get(action.fromId);
                    if (!attacker) break;
                    if (!CHARIOT_CHARGE_UNITS.includes(attacker.type)) break;
                    if (attacker.hasAttackedThisTurn || attacker.hasMovedThisTurn) break;
                    if (attacker.stunnedTurns && attacker.stunnedTurns > 0) break;
                    const ok = this.handleChariotCharge(attacker, action.dx, action.dz, true);
                    if (!ok) break;
                    break;
                }
                case 'conceal': {
                    const unit = this.gameState.units.get(action.unitId);
                    if (unit && unit.owner === faction) this.handleConceal(unit, true);
                    break;
                }
            }
        }
        // Mop-up: any AI unit that still has its action and is adjacent to an
        // exposed at-war enemy lord strikes the lord (lords fight, so a lone
        // enemy lord is fair game). Runs after the main action loop so it never
        // pre-empts a unit's planned move/attack.
        this._aiUnitAttackLords(faction);
        this.updateFog();
        this.checkVictory();
        // Feature 6: record a turn-summary event so the event log captures AI
        // activity even when no specific combat/capture event fired.
        this.addEvent('turn', `${factionName} completed turn ${this.gameState.turn || 0}.`);
    }

    updateFog() {
        // In spectate mode, reveal the entire map so the viewer can watch all factions.
        if (this.spectateMode) {
            this.gameState.visible = new Set();
            this.gameState.explored = new Set();
            for (const t of this.tiles.values()) {
                const k = `${t.x},${t.z}`;
                this.gameState.visible.add(k);
                this.gameState.explored.add(k);
            }
            return;
        }
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
        // Allied shared vision: units, lords, and cities of factions allied to
        // the player also feed the player's visibility (but NOT explored �?only
        // the player's own sight permanently reveals terrain).
        const diplo = this.gameState.diplomacy;
        if (diplo) {
            for (const u of this.gameState.units.values()) {
                if (u.owner !== PLAYER_FACTION && isAllied(diplo, PLAYER_FACTION, u.owner)) {
                    const r = (UNIT_TYPE[u.type] && UNIT_TYPE[u.type].vision) || baseVision;
                    sources.push({ x: u.x, z: u.z, radius: r, ally: true });
                }
            }
            for (const l of this.gameState.lords) {
                if (l.owner !== PLAYER_FACTION && isAllied(diplo, PLAYER_FACTION, l.owner)) {
                    sources.push({ x: l.x, z: l.z, radius: baseVision, ally: true });
                }
            }
            for (const t of this.tiles.values()) {
                if (t.owner !== PLAYER_FACTION && t.terrain === 'CITY' &&
                    isAllied(diplo, PLAYER_FACTION, t.owner)) {
                    sources.push({ x: t.x, z: t.z, radius: cityRadius(t), ally: true });
                }
            }
        }
        const baseVisible = computeVisibility(sources);
        // Explored only grows from real vision �?never from Scry (which is a
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
            this._tickConcealment(); // concealment progress
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
            // Rebuild the diplomacy cache once per round so the AI diplomacy
            // phase (power/distance scoring) is O(cities²) instead of O(tiles²).
            this._rebuildDiploCache();
            this.gameState.turnManager.endPlayerTurn();
            this.ui.updateAll();
        } finally {
            this._endingTurn = false;
        }
    }

    checkVictory() {
        if (this.spectateMode) return; // no victory/defeat in spectate mode
        if (this.gameState.gameOver) return;
        if (!this.gameState.eliminated) this.gameState.eliminated = new Set();
        // Elimination runs in spectate mode too — a faction that loses its
        // last city (or its king) is out, even with no human player.
        for (const f of FACTIONS) {
            if (this.gameState.eliminated.has(f)) continue;
            if (countCities(this.tiles, f) === 0) {
                this.gameState.eliminated.add(f);
                const name = this.factionColors[f] ? this.factionColors[f].name : f;
                this.log(`${name} has lost all cities and is eliminated!`);
            }
        }
        if (this.spectateMode) return; // no victory/defeat screen in spectate mode
        const playerAlive = !this.gameState.eliminated.has(PLAYER_FACTION);

        // Check multiple victory conditions for the player.
        const victoryType = this._checkPlayerVictory();
        if (victoryType) {
            this.endGame('victory', victoryType);
            return;
        }

        // Domination defeat: player eliminated.
        if (!playerAlive) {
            this.endGame('defeat');
            return;
        }

        // Domination victory: all AI eliminated.
        const aiRemaining = FACTIONS.filter(f => f !== PLAYER_FACTION && !this.gameState.eliminated.has(f));
        if (aiRemaining.length === 0) {
            this.endGame('victory', VICTORY_TYPES.DOMINATION);
        }
    }

    /** Check if the player has achieved any non-domination victory condition. */
    _checkPlayerVictory() {
        const gs = this.gameState;
        const ts = gs.techState;
        const vs = gs.victoryState || {};

        // Science Victory: research all techs + build space program project.
        if (ts && ts.researched && ts.researched.size >= Object.keys(TECHS).length) {
            const projects = vs.projects || {};
            if ((projects.player || 0) >= SCIENCE_VICTORY_BUILD_TURNS) {
                return VICTORY_TYPES.SCIENCE;
            }
        }

        // Economic Victory: accumulate enough gold + enough trade routes.
        const playerGold = (gs.resources && gs.resources.player && gs.resources.player.gold) || 0;
        const playerTradeRoutes = (vs.tradeRoutes && vs.tradeRoutes.player) || 0;
        if (playerGold >= ECONOMIC_VICTORY_GOLD && playerTradeRoutes >= ECONOMIC_VICTORY_TRADE_ROUTES) {
            return VICTORY_TYPES.ECONOMIC;
        }

        // Score Victory: highest score at turn 200.
        if (gs.turn >= SCORE_VICTORY_TURN) {
            const scores = this._calculateScores();
            const playerScore = scores[PLAYER_FACTION] || 0;
            let highest = 0;
            for (const f of FACTIONS) {
                if (f === PLAYER_FACTION) continue;
                if ((scores[f] || 0) > highest) highest = scores[f] || 0;
            }
            if (playerScore > highest) {
                return VICTORY_TYPES.SCORE;
            }
        }

        return null;
    }

    /** Calculate faction scores for score victory. */
    _calculateScores() {
        const gs = this.gameState;
        const scores = {};
        for (const f of FACTIONS) {
            let score = 0;
            // Cities owned (5 pts each).
            score += countCities(this.tiles, f) * 5;
            // Tiles owned (1 pt each).
            score += countTiles(this.tiles, f);
            // Units alive (2 pts each).
            for (const u of gs.units.values()) {
                if (u.owner === f) score += 2;
            }
            // Techs researched (10 pts each). Single-track: only player can research.
            if (f === PLAYER_FACTION && gs.techState && gs.techState.researched) {
                score += gs.techState.researched.size * 10;
            }
            // Gold (0.1 pts per gold).
            score += Math.floor(((gs.resources && gs.resources[f] && gs.resources[f].gold) || 0) * 0.1);
            scores[f] = score;
        }
        return scores;
    }

    /** Victory progress data for the tracker panel (Feature 5). Pulls the
     *  same numbers `_checkPlayerVictory` and `_calculateScores` use, so the
     *  tracker always agrees with the actual victory checks. */
    getVictoryProgress() {
        const gs = this.gameState;
        const ts = gs.techState;
        const vs = gs.victoryState || {};
        const scores = this._calculateScores();
        const totalTechs = Object.keys(TECHS).length;
        const researchedTechs = ts && ts.researched ? ts.researched.size : 0;

        const aiFactions = FACTIONS.filter(f => f !== PLAYER_FACTION);
        const aiEliminated = aiFactions.filter(f => gs.eliminated && gs.eliminated.has(f)).length;
        const playerGold = (gs.resources && gs.resources[PLAYER_FACTION] && gs.resources[PLAYER_FACTION].gold) || 0;
        const playerRoutes = (vs.tradeRoutes && vs.tradeRoutes[PLAYER_FACTION]) || 0;
        let bestAiScore = 0;
        for (const f of aiFactions) bestAiScore = Math.max(bestAiScore, scores[f] || 0);
        const playerScore = scores[PLAYER_FACTION] || 0;

        return {
            domination: {
                eliminated: aiEliminated,
                total: aiFactions.length,
                progress: aiFactions.length ? aiEliminated / aiFactions.length : 0
            },
            science: {
                researched: researchedTechs,
                total: totalTechs,
                currentTech: ts ? ts.current : null,
                progress: totalTechs ? researchedTechs / totalTechs : 0
            },
            economic: {
                gold: playerGold,
                goldTarget: ECONOMIC_VICTORY_GOLD,
                tradeRoutes: playerRoutes,
                routeTarget: ECONOMIC_VICTORY_TRADE_ROUTES,
                progress: Math.min(
                    playerGold / Math.max(1, ECONOMIC_VICTORY_GOLD),
                    playerRoutes / Math.max(1, ECONOMIC_VICTORY_TRADE_ROUTES)
                )
            },
            score: {
                playerScore,
                aiScore: bestAiScore,
                turn: gs.turn || 0,
                maxTurn: SCORE_VICTORY_TURN,
                progress: Math.min(1, (gs.turn || 0) / Math.max(1, SCORE_VICTORY_TURN))
            }
        };
    }

    /** Append an event to the rolling event log (Feature 6). The log is capped;
     *  oldest entries drop off. Safe to call before gameState is built. */
    addEvent(category, message) {
        if (!this.gameState) return;
        if (!Array.isArray(this.gameState.eventLog)) this.gameState.eventLog = [];
        return addEventEntry(this.gameState.eventLog, category, message, this.gameState.turn || 0);
    }

    /** Set the active difficulty (Feature 8). Called from the start menu. */
    setDifficulty(key) {
        this.difficulty = key || 'NORMAL';
        if (this.gameState) this.gameState.difficulty = this.difficulty;
    }

    /** Execute a spy action (Feature 11). `spy` is a SPY unit id; `targetFaction`
     *  is the faction acted against. Spends gold, resolves success/detection,
     *  applies the relationship penalty to the spy's owner→target relation, and
     *  logs the outcome. Returns the spy result object. */
    handleSpyAction(spyId, action, targetFaction, extra = {}) {
        const spy = this.gameState.units.get(spyId);
        if (!spy || !isSpyUnit(spy)) return { success: false, detected: false, message: 'No spy unit' };
        const res = this.gameState.resources[spy.owner];
        const cost = (SPY_ACTION_COST || { gold: 25 }).gold;
        if (res && (res.gold || 0) < cost) return { success: false, detected: false, message: 'Not enough gold' };
        if (res) res.gold -= cost;
        const result = resolveSpyAction({
            action, spy, targetFaction,
            targetTileKey: extra.targetTileKey, targetLordId: extra.targetLordId, targetCityKey: extra.targetCityKey,
            detectionBonus: extra.detectionBonus || 0, successBonus: extra.successBonus || 0,
            rng: extra.rng
        });
        if (result.relationPenalty) {
            const rel = getRelation(this.gameState.diplomacy, spy.owner, targetFaction);
            rel.relationship = Math.max(-100, (rel.relationship || 0) - result.relationPenalty);
        }
        this.addEvent('spy', result.message);
        return result;
    }

    /** Declare a coalition war (Feature 12). `leader` invites eligible allies
     *  and all join the war against `target`. Returns the list of joiners. */
    handleDeclareCoalitionWar(leader, target, candidateAllies) {
        const allies = eligibleCoalitionAllies(this.gameState.diplomacy, leader, target, candidateAllies || FACTIONS);
        const joiners = declareCoalitionWar(this.gameState.diplomacy, leader, target, allies, this.gameState.turn || 0);
        this.addEvent('diplomacy', `${leader} formed a coalition war against ${target} with ${allies.join(', ') || 'no allies'}`);
        return joiners;
    }

    endGame(result, victoryType) {
        this.gameState.gameOver = true;
        this.gameState.winner = result;
        const banner = document.getElementById('game-over');
        const text = document.getElementById('game-over-text');
        const typeLabel = victoryType ? ` (${victoryType.toUpperCase()})` : '';
        if (text) {
            text.textContent = result === 'victory'
                ? `VICTORY${typeLabel} — you achieved ${victoryType || 'domination'}!`
                : 'DEFEAT — you lost your last city.';
        }
        if (banner) {
            banner.style.background = result === 'victory' ? 'rgba(20,90,30,0.92)' : 'rgba(100,20,20,0.92)';
            banner.style.display = 'flex';
        }
        if (result === 'victory') sfx.victory(); else sfx.defeat();
        this.log(result === 'victory' ? `VICTORY (${victoryType})!` : 'DEFEAT.');
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
        this.log(`${myName} �?your conquest begins!`);
        this.log('Click your unit, then a highlighted tile to move (captures it).');
        this.log('Right-click a tile to set an auto-move goal. Click an enemy unit to attack.');
        this.log('Click your city to build/train. Besiege enemy cities with Siege units before capturing.');
        this.log('Drag the map to pan. Esc to pause.');
        // Announce any Natural Wonders on this map.
        for (const w of (this._mapWonders || [])) {
            this.log(`${w.wonder.emoji || '⭐'} Natural Wonder: ${w.wonder.name} at [${w.x}, ${w.z}] — capture it for a bonus!`);
        }
        // Process any goals on the very first turn too.
        this.renderAll();
        this.ui.updateAll();
    }
}
