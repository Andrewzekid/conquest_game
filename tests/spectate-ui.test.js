import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const htmlPath = resolve(import.meta.dirname, '..', 'index.html');
const html = readFileSync(htmlPath, 'utf-8');

const gameSrc = readFileSync(resolve(import.meta.dirname, '..', 'src', 'game.js'), 'utf-8');

const uiSrc = readFileSync(resolve(import.meta.dirname, '..', 'src', 'ui.js'), 'utf-8');

describe('spectate-ui', () => {
  it('spectate-controls div does NOT have class="hidden"', () => {
    // The bug was that class="hidden" with !important overrode inline display:flex
    const match = html.match(/id="spectate-controls"[^>]*>/);
    expect(match).not.toBeNull();
    expect(match[0]).not.toContain('class="hidden"');
  });

  it('spectate-controls has style="display:none" for initial state', () => {
    const match = html.match(/id="spectate-controls"[^>]*style="[^"]*display:none[^"]*"/);
    expect(match).not.toBeNull();
  });

  it('spectate-controls contains FF and Auto buttons', () => {
    expect(html).toContain('id="btn-ff-1"');
    expect(html).toContain('id="btn-ff-5"');
    expect(html).toContain('id="btn-ff-10"');
    expect(html).toContain('id="btn-ff-auto"');
  });

  it('CSS .hidden rule uses !important (confirms root cause)', () => {
    // Verify the CSS rule exists that caused the bug
    expect(html).toContain('.hidden { display: none !important; }');
  });

  // Regression guard for the "this.gameState is undefined" crash at game.js:142.
  // _initSpectateUI is invoked from the constructor BEFORE initState() builds
  // this.gameState, so it must NOT touch this.gameState. The spectate flag is
  // set authoritatively inside initState's gameState object literal instead.
  // This is a source-invariant test (the suite has no DOM/WebGL harness to boot
  // Game for real); it pins the invariant the crash violated.
  describe('spectate constructor ordering (regression)', () => {
    it('_initSpectateUI does not reference this.gameState', () => {
      const fnBody = gameSrc.match(/_initSpectateUI\(\)\s*{([\s\S]*?)\n    }/);
      expect(fnBody, '_initSpectateUI must exist').not.toBeNull();
      expect(fnBody[1]).not.toMatch(/this\.gameState/);
    });

    it('initState sets gameState.spectateMode from this.spectateMode', () => {
      // The gameState object literal in initState must carry the spectate flag
      // so pure render/UI code (renderer.js reads gameState.spectateMode) has it
      // without depending on constructor call order.
      expect(gameSrc).toMatch(/spectateMode:\s*this\.spectateMode/);
    });

    it('loadFromState mirrors the spectate flag onto gameState', () => {
      // Loaded games skip initState, so the flag must be mirrored there too.
      expect(gameSrc).toMatch(/this\.gameState\.spectateMode\s*=\s*this\.spectateMode/);
    });
  });

  // Spectate mode is view-only: the diplomacy panel stays visible for
  // inspection, but the player-slot action buttons (Propose/Declare War, the
  // peace-with-demands form, Accept/Decline on pending offers) must not render,
  // and handleDiplomacy must ignore any action that slips through.
  describe('spectate diplomacy is view-only', () => {
    it('diplomacy action buttons are suppressed in spectate mode', () => {
      expect(uiSrc).toMatch(/if \(involvesPlayer && !gameState\.spectateMode\)/);
    });

    it('pending-offer Accept/Decline buttons are suppressed in spectate mode', () => {
      expect(uiSrc).toMatch(/if \(!gameState\.spectateMode\) \{\s*row\.appendChild\(mkBtn\('Accept', 'acceptOffer', i\)\);/);
    });

    it('handleDiplomacy guards on spectateMode before touching state', () => {
      const m = gameSrc.match(/handleDiplomacy\(action, target\)\s*\{([\s\S]*?)const diplo = this\.gameState\.diplomacy;/);
      expect(m, 'handleDiplomacy body not found').not.toBeNull();
      expect(m[1]).toMatch(/if \(this\.spectateMode\)/);
    });
  });

  // The faction picked on the start menu must actually be in a spectate game:
  // it leads the AI faction list so it always lands in slot 0 (previously the
  // selection was discarded, so the picked faction often wasn't playing at
  // all — reported as "my faction doesn't build any units").
  describe('spectate selected faction + slot-0 parity', () => {
    const menusSrc = readFileSync(resolve(import.meta.dirname, '..', 'src', 'menus.js'), 'utf-8');

    it('spectate faction list starts with the selected faction (slot 0)', () => {
      expect(menusSrc).toContain('[_selectedFaction, ...FACTION_IDS.filter(id => id !== _selectedFaction)]');
    });

    it('faction selection is not disabled in spectate mode', () => {
      expect(menusSrc).not.toContain("factionWrap.style.pointerEvents = _spectateMode ? 'none' : 'auto'");
    });

    it('slot 0 gets a victory target in spectate mode', () => {
      expect(gameSrc).toContain('if (slot === PLAYER_FACTION && !this.spectateMode) continue;');
    });

    it('spectate victory check treats slot 0 as a normal AI faction', () => {
      expect(gameSrc).not.toContain("const aiAlive = FACTIONS.filter(f => f !== PLAYER_FACTION && !this.gameState.eliminated.has(f));");
    });
  });
});

  // In spectate the 'player' slot is AI-run: its techs live in
  // aiTechStates['player'], not the dormant human techState. Reading the wrong
  // one made the selected faction report 0 techs ("researches no techs").
  describe('spectate slot-0 tech state + score threshold', () => {
    it('_factionTechState reads aiTechStates for slot 0 in spectate', () => {
      expect(gameSrc).toMatch(/_factionTechState\(f\)\s*{[\s\S]*?if \(f === PLAYER_FACTION && !this\.spectateMode\) return gs\.techState;/);
    });

    it('score/ranking/progress reads go through _factionTechState', () => {
      expect(gameSrc).not.toContain("const fTs = f === PLAYER_FACTION ? gs.techState : (gs.aiTechStates && gs.aiTechStates[f]);");
      expect(gameSrc.match(/this\._factionTechState\(f\)/g).length).toBeGreaterThanOrEqual(3);
    });

    it('spectate mode logs victory but does not end the game', () => {
      expect(gameSrc).toMatch(/announce victory but keep the game running/);
      expect(gameSrc).not.toContain('bestTechs');
    });
  });

  // Barracks bonus must be read from ANY influence tile (not just the city
  // tile), and must reflect the building's upgrade level via
  // MILITARY_BUILDING_LEVELS.BARRACKS. The old code checked only
  // `buildings.get(cityKey)` and hardcoded Lv.2 / 25% — so a Barracks on an
  // influence tile appeared to grant nothing (reported as "barracks doesn't
  // give XP or discount").
  describe('barracks influence + level display', () => {
    it('ui.js has bestBarracksInInfluence scanning the city influence', () => {
      expect(uiSrc).toMatch(/export function bestBarracksInInfluence/);
      expect(uiSrc).toMatch(/getBuildingState\(gameState\.buildingState, k, 'BARRACKS'\)/);
      expect(uiSrc).toMatch(/MILITARY_BUILDING_LEVELS\.BARRACKS/);
    });

    it('train menu uses barracksInfo.goldMult (not hardcoded 0.75)', () => {
      expect(uiSrc).not.toContain("effCost.gold || 0) * 0.75");
      expect(uiSrc).toMatch(/effCost\.gold \|\| 0\) \* barracksInfo\.goldMult/);
    });

    it('train menu shows the actual veteran level (not hardcoded Lv.2)', () => {
      expect(uiSrc).toMatch(/label \+= ` ★Lv\.\$\{bLvl\}`/);
      expect(uiSrc).not.toContain("★'");
    });

    it('train menu no longer checks only the city tile', () => {
      expect(uiSrc).not.toContain("buildings.get(cityKey) || []).includes('BARRACKS')");
    });
  });

  // The tech-tree panel must render the atomic era (TANK/BATTLESHIP/
  // AIRCRAFT_CARRIER/RPG_TEAM live there). Previously ui.js had its own
  // hardcoded eraOrder that ended at 'modern', so the 7 atomic techs never
  // showed up in the panel — reported as "battleship / aircraft carrier /
  // RPG team not in the tech tree". It now imports the canonical
  // ERA_ORDER/ERA_NAMES from tech.js.
  describe('tech tree shows the atomic era', () => {
    it('ui.js imports ERA_ORDER and ERA_NAMES from tech.js', () => {
      expect(uiSrc).toMatch(/import \{[^}]*ERA_ORDER[^}]*\} from '\.\/tech\.js'/);
      expect(uiSrc).toMatch(/import \{[^}]*ERA_NAMES[^}]*\} from '\.\/tech\.js'/);
    });

    it('ui.js does not carry its own hardcoded eraOrder missing atomic', () => {
      expect(uiSrc).not.toContain("const eraOrder = ['ancient'");
    });

    it('ui.js has an atomic era color', () => {
      expect(uiSrc).toMatch(/atomic: '#[0-9a-f]{6}'/);
    });

    it('tech.js ERA_ORDER includes atomic as the final era', () => {
      const techSrc = readFileSync(resolve(import.meta.dirname, '..', 'src', 'tech.js'), 'utf-8');
      expect(techSrc).toMatch(/ERA_ORDER = \[[^\]]*'atomic'\]/);
    });
  });
