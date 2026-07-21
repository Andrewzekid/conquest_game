import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

// Feature 5 (Victory Progress Tracker): getVictoryProgress lives on class Game
// and reads from gameState (techState, victoryState, resources, eliminated,
// _calculateScores). Instantiating Game requires a DOM + WebGL, so these tests
// are source-invariant: they assert the method exists, returns the four victory
// tracks with the expected subfields, and that the UI panel + Tab wiring render
// it. This mirrors the spectate-ui / lord-skills source-invariant tests.

describe('Victory Progress Tracker — game.js getVictoryProgress', () => {
  const src = readFileSync(join(here, '..', 'src', 'game.js'), 'utf8');

  it('defines a getVictoryProgress method', () => {
    expect(src).toMatch(/getVictoryProgress\s*\(/);
  });

  it('exposes the callback to the UI via initUI', () => {
    expect(src).toMatch(/getVictoryProgress:\s*\(\)\s*=>\s*this\.getVictoryProgress\(\)/);
  });

  it('returns all four victory tracks (domination/science/economic/score)', () => {
    // Grab the body of getVictoryProgress to assert the returned keys.
    const m = src.match(/getVictoryProgress\(\)\s*\{([\s\S]*?)\n    endGame/);
    expect(m, 'getVictoryProgress body not found').not.toBeNull();
    const body = m[1];
    expect(body).toMatch(/domination:/);
    expect(body).toMatch(/science:/);
    expect(body).toMatch(/economic:/);
    expect(body).toMatch(/score:/);
  });

  it('domination counts eliminated AI rivals out of total AIs', () => {
    const m = src.match(/getVictoryProgress\(\)\s*\{([\s\S]*?)\n    endGame/);
    const body = m[1];
    expect(body).toMatch(/aiFactions\.filter.*eliminated/);
    expect(body).toMatch(/progress:\s*aiFactions\.length\s*\?\s*aiEliminated\s*\/\s*aiFactions\.length/);
  });

  it('science progress divides researched techs by total tech count', () => {
    const m = src.match(/getVictoryProgress\(\)\s*\{([\s\S]*?)\n    endGame/);
    const body = m[1];
    expect(body).toMatch(/researchedTechs\s*\/\s*totalTechs/);
  });

  it('economic progress is the min of gold ratio and trade-route ratio', () => {
    const m = src.match(/getVictoryProgress\(\)\s*\{([\s\S]*?)\n    endGame/);
    const body = m[1];
    expect(body).toMatch(/Math\.min\([\s\S]*?playerGold\s*\/[\s\S]*?ECONOMIC_VICTORY_GOLD[\s\S]*?playerRoutes\s*\/[\s\S]*?ECONOMIC_VICTORY_TRADE_ROUTES/);
  });

  it('score progress tracks current turn against SCORE_VICTORY_TURN', () => {
    const m = src.match(/getVictoryProgress\(\)\s*\{([\s\S]*?)\n    endGame/);
    const body = m[1];
    expect(body).toMatch(/SCORE_VICTORY_TURN/);
    expect(body).toMatch(/bestAiScore/);
  });
});

describe('Victory Progress Tracker — ui.js panel', () => {
  const src = readFileSync(join(here, '..', 'src', 'ui.js'), 'utf8');

  it('caches the victory panel elements in the els object', () => {
    expect(src).toMatch(/victoryPanel:\s*document\.getElementById\('victory-panel-body'\)/);
    expect(src).toMatch(/victoryPanelWrap:\s*document\.getElementById\('victory-panel'\)/);
  });

  it('defines a showVictoryPanel function that reads getVictoryProgress', () => {
    expect(src).toMatch(/function showVictoryPanel/);
    expect(src).toMatch(/callbacks\.getVictoryProgress/);
  });

  it('renders all four victory sections with progress bars', () => {
    expect(src).toMatch(/Domination/);
    expect(src).toMatch(/Science/);
    expect(src).toMatch(/Economic/);
    expect(src).toMatch(/Score/);
    expect(src).toMatch(/progress-fill/);
  });

  it('wires showVictoryPanel into updateAll and the returned API', () => {
    // updateAll calls it
    const upd = src.match(/function updateAll\(\)\s*\{([\s\S]*?)\n    \}/);
    expect(upd).not.toBeNull();
    expect(upd[1]).toMatch(/showVictoryPanel\(\)/);
    // returned API includes it
    expect(src).toMatch(/showVictoryPanel,/);
  });

  it('adds a Tab-key toggle that flips the victory panel display', () => {
    expect(src).toMatch(/e\.key\s*!?==?\s*['"]Tab['"]/);
    expect(src).toMatch(/victoryPanelWrap\.style\.display/);
  });
});

describe('Victory Progress Tracker — index.html', () => {
  const src = readFileSync(join(here, '..', 'index.html'), 'utf8');

  it('contains a hidden #victory-panel side panel with a body', () => {
    expect(src).toMatch(/id="victory-panel"\s+class="side-panel"/);
    expect(src).toMatch(/id="victory-panel-body"/);
  });

  it('styles the victory panel and progress bar', () => {
    expect(src).toMatch(/#victory-panel\s*\{/);
    expect(src).toMatch(/\.progress-track/);
    expect(src).toMatch(/\.progress-fill/);
  });
});