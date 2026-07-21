import { describe, it, expect } from 'vitest';
import { buildAIGoalsHTML, createAIState, initAIState } from '../src/ai_goals.js';

describe('buildAIGoalsHTML', () => {
  it('returns a no-state message when aiState is null', () => {
    const html = buildAIGoalsHTML(null, [], {}, {}, true);
    expect(html).toContain('No AI state');
    expect(html).toContain('AI Goals');
  });

  it('renders each faction with its ordered goals', () => {
    const aiState = initAIState(['crimson', 'azure']);
    aiState.crimson.goals = [
      { kind: 'conquest', priority: 1, horizon: 'short', targetTileKey: '5,5', targetFaction: 'azure' },
      { kind: 'develop-economy', priority: 0.5, horizon: 'long', targetTileKey: null, targetFaction: null },
    ];
    aiState.azure.goals = [
      { kind: 'defense', priority: 1, horizon: 'immediate', targetTileKey: '2,2', targetFaction: null },
    ];
    const factionDefs = {
      crimson: { name: 'Crimson Legion', emoji: '🔥' },
      azure: { name: 'Azure Dominion', emoji: '🌊' },
    };
    const factionColors = {
      crimson: { tile: 0x9c2a2a, name: 'Crimson Legion' },
      azure: { tile: 0x2a5c9c, name: 'Azure Dominion' },
    };
    const html = buildAIGoalsHTML(aiState, ['crimson', 'azure'], factionDefs, factionColors, true);
    expect(html).toContain('Crimson Legion');
    expect(html).toContain('conquest');
    expect(html).toContain('5,5');
    expect(html).toContain('Azure Dominion');
    expect(html).toContain('defense');
    expect(html).toContain('2,2');
    // The dominant goal is marked with a star.
    expect(html).toContain('★');
  });

  it('shows no-active-goals message when all factions have empty goals', () => {
    const aiState = initAIState(['crimson']);
    const html = buildAIGoalsHTML(aiState, ['crimson'], {}, {}, true);
    expect(html).toContain('No active goals');
  });

  it('skips factions with no goals', () => {
    const aiState = initAIState(['crimson', 'azure']);
    aiState.crimson.goals = [
      { kind: 'settle', priority: 1, horizon: 'long', targetTileKey: '3,3', targetFaction: null },
    ];
    const html = buildAIGoalsHTML(aiState, ['crimson', 'azure'], {
      crimson: { name: 'Crimson', emoji: '' },
      azure: { name: 'Azure', emoji: '' },
    }, {}, true);
    expect(html).toContain('Crimson');
    expect(html).not.toContain('Azure');
  });

  it('renders priority as a percentage', () => {
    const aiState = initAIState(['crimson']);
    aiState.crimson.goals = [
      { kind: 'conquest', priority: 1, horizon: 'short', targetTileKey: '1,1', targetFaction: 'x' },
      { kind: 'settle', priority: 0.7, horizon: 'long', targetTileKey: '2,2', targetFaction: null },
    ];
    const html = buildAIGoalsHTML(aiState, ['crimson'], { crimson: { name: 'C', emoji: '' } }, {}, true);
    expect(html).toContain('p=100%');
    expect(html).toContain('p=70%');
  });
});