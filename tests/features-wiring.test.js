import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const gameSrc = () => readFileSync(join(here, '..', 'src', 'game.js'), 'utf8');
const uiSrc = () => readFileSync(join(here, '..', 'src', 'ui.js'), 'utf8');
const htmlSrc = () => readFileSync(join(here, '..', 'index.html'), 'utf8');

// Source-invariant wiring checks for Features 6-15. Game/ui require a DOM +
// WebGL, so we assert the integration points exist in source rather than
// instantiating them. Mirrors the spectate-ui / lord-skills source-invariant
// tests.

describe('Features 6-15 — game.js wiring', () => {
  const src = gameSrc();

  it('imports the new pure modules (eventlog/difficulty/spy/ui_data) and coalition helpers', () => {
    expect(src).toMatch(/from '.\/eventlog.js'/);
    expect(src).toMatch(/from '.\/difficulty.js'/);
    expect(src).toMatch(/from '.\/spy.js'/);
    expect(src).toMatch(/from '.\/ui_data.js'/);
    expect(src).toMatch(/formCoalition|declareCoalitionWar|eligibleCoalitionAllies/);
  });

  it('initState seeds eventLog and difficulty', () => {
    expect(src).toMatch(/eventLog:\s*\[\]/);
    expect(src).toMatch(/difficulty:\s*this\.difficulty\s*\|\|\s*'NORMAL'/);
  });

  it('loadFromState backfills eventLog, difficulty, and coalitions', () => {
    expect(src).toMatch(/Array\.isArray\(this\.gameState\.eventLog\)/);
    expect(src).toMatch(/this\.gameState\.difficulty\s*=\s*'NORMAL'/);
    expect(src).toMatch(/diploState?\.coalitions|coalitions\s*=\s*\{\}/);
  });

  it('exposes addEvent, setDifficulty, handleSpyAction, handleDeclareCoalitionWar', () => {
    expect(src).toMatch(/addEvent\(category,\s*message\)/);
    expect(src).toMatch(/setDifficulty\(key\)/);
    expect(src).toMatch(/handleSpyAction\(/);
    expect(src).toMatch(/handleDeclareCoalitionWar\(/);
  });

  it('runAITurn records a turn-summary event', () => {
    expect(src).toMatch(/addEvent\('turn'/);
  });

  it('uses the difficulty + spy helpers from the pure modules', () => {
    expect(src).toMatch(/resolveSpyAction/);
    expect(src).toMatch(/isSpyUnit/);
    expect(src).toMatch(/applyDifficultyYield|getDifficulty|difficultyOptions/);
  });
});

describe('Features 6-15 — map.js / battle.js / diplomacy.js', () => {
  const mapSrc = readFileSync(join(here, '..', 'src', 'map.js'), 'utf8');
  const battleSrc = readFileSync(join(here, '..', 'src', 'battle.js'), 'utf8');
  const diploSrc = readFileSync(join(here, '..', 'src', 'diplomacy.js'), 'utf8');

  it('map.js generates passes and imports PASS constants', () => {
    expect(mapSrc).toMatch(/export function generatePasses/);
    expect(mapSrc).toMatch(/PASS_COUNT_PER_CONTINENT/);
    expect(mapSrc).toMatch(/generatePasses\(tiles,\s*passCount\)/);
  });

  it('battle.js applies the river-crossing penalty to defender and attacker', () => {
    expect(battleSrc).toMatch(/riverCrossingDefensePenalty/);
    expect(battleSrc).toMatch(/defRiverPenalty/);
    expect(battleSrc).toMatch(/atkRiverPenalty/);
    expect(battleSrc).toMatch(/RIVER_CROSSING_DEFENSE_PENALTY/);
  });

  it('diplomacy.js exports coalition functions and imports COALITION constants', () => {
    expect(diploSrc).toMatch(/export function formCoalition/);
    expect(diploSrc).toMatch(/export function declareCoalitionWar/);
    expect(diploSrc).toMatch(/export function eligibleCoalitionAllies/);
    expect(diploSrc).toMatch(/COALITION_MAX_ALLIES/);
  });
});

describe('Features 6-15 — UI panels (source-invariant where DOM-bound)', () => {
  const html = htmlSrc();

  it('index.html has a victory panel (Feature 5, already shipped) — still present', () => {
    expect(html).toMatch(/id="victory-panel"/);
  });

  it('Feature 6: index.html has a combat/event log container (combat-log) for events', () => {
    // The existing combat log doubles as the event log surface.
    expect(html).toMatch(/id="combat-log"/);
  });
});

describe('Features 6-15 — config constants exist', () => {
  const cfg = readFileSync(join(here, '..', 'src', 'config.js'), 'utf8');
  it('event log + difficulty + pass + river + spy + coalition constants are present', () => {
    expect(cfg).toMatch(/EVENT_LOG_MAX/);
    expect(cfg).toMatch(/DIFFICULTY_PRESETS/);
    expect(cfg).toMatch(/PASS_TERRAIN_KEY/);
    expect(cfg).toMatch(/RIVER_CROSSING_DEFENSE_PENALTY/);
    expect(cfg).toMatch(/SPY_ACTIONS/);
    expect(cfg).toMatch(/COALITION_MAX_ALLIES/);
  });
  it('SPY unit type and PASS terrain are defined', () => {
    expect(cfg).toMatch(/SPY:\s*\{\s*name:\s*'Spy'/);
    expect(cfg).toMatch(/PASS:\s*\{\s*key:\s*'PASS'/);
  });
});