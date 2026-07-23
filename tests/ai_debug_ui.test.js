import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildAIDebugHTML } from '../src/ai.js';

const here = dirname(fileURLToPath(import.meta.url));

function mkState() {
    const tiles = new Map();
    tiles.set('3,3', { x: 3, z: 3, terrain: 'CITY', owner: 'ai1', cityLevel: 1 });
    const units = new Map();
    units.set(1, { id: 1, type: 'WARRIOR', owner: 'ai1', x: 3, z: 4 });
    units.set(2, { id: 2, type: 'ARCHER', owner: 'ai1', x: 4, z: 3 });
    const resources = { ai1: { gold: 50, food: 20, wood: 10, iron: 5, production: 8 } };
    const buildings = new Map();
    const lords = [];
    const aiState = {
        ai1: {
            goals: [{ kind: 'conquest', priority: 0.8, horizon: 'mid', targetTileKey: '7,7' }],
            recentActions: [{ type: 'train', unitType: 'WARRIOR' }],
            armyGroups: [
                { size: 5, stance: 'attack', objective: '7,7' },
                { size: 2, stance: 'hold', objective: '3,3' },
            ],
        },
    };
    const factionDefs = { ai1: { name: 'Test AI', emoji: '🤖', roster: [] } };
    const factionColors = { ai1: { name: 'Test AI', tile: 0xff0000 } };
    return { tiles, units, resources, buildings, lords, aiState, factionDefs, factionColors };
}

describe('buildAIDebugHTML — resource income', () => {
    it('renders stockpile + per-turn income for each resource', () => {
        const s = mkState();
        const html = buildAIDebugHTML(s.units, s.aiState, ['ai1'], s.factionDefs, s.factionColors,
            s.tiles, s.resources, s.buildings, s.lords);
        // Stockpiles shown as integer floors.
        expect(html).toContain('gold: 50 (+');
        expect(html).toContain('food: 20 (+');
        expect(html).toContain('wood: 10 (+');
        expect(html).toContain('iron: 5 (+');
        expect(html).toContain('production: 8 (+');
        // A lone Lv1 city yields 2 + level = 3 food per turn.
        expect(html).toContain('food: 20 (+3/t)');
    });

    it('skips the income line when tiles/resources are not provided', () => {
        const s = mkState();
        const html = buildAIDebugHTML(s.units, s.aiState, ['ai1'], s.factionDefs, s.factionColors);
        expect(html).not.toContain('/t)');
        expect(html).toContain('AI Debug'); // panel still renders
    });
});

describe('buildAIDebugHTML — army groups', () => {
    it('renders per-faction army groups with size, stance and objective', () => {
        const s = mkState();
        const html = buildAIDebugHTML(s.units, s.aiState, ['ai1'], s.factionDefs, s.factionColors,
            s.tiles, s.resources, s.buildings, s.lords);
        expect(html).toContain('Army groups:');
        expect(html).toContain('5u attack → 7,7');
        expect(html).toContain('2u hold → 3,3');
    });

    it('omits the army-group section when none are recorded', () => {
        const s = mkState();
        delete s.aiState.ai1.armyGroups;
        const html = buildAIDebugHTML(s.units, s.aiState, ['ai1'], s.factionDefs, s.factionColors,
            s.tiles, s.resources, s.buildings, s.lords);
        expect(html).not.toContain('Army groups:');
    });
});

// Source-invariant: computeAIActions must persist the lightweight army-group
// summary each turn so the debug panel has something to render.
describe('AI debug — army group persistence (source-invariant)', () => {
    const aiSrc = readFileSync(join(here, '..', 'src', 'ai.js'), 'utf8');

    it('computeAIActions stores aiState.armyGroups', () => {
        expect(aiSrc).toMatch(/aiState\.armyGroups = groups\.map/);
    });

    it('showAIDebugPanel threads tiles/resources through to buildAIDebugHTML', () => {
        const uiSrc = readFileSync(join(here, '..', 'src', 'ui.js'), 'utf8');
        expect(uiSrc).toMatch(/buildAIDebugHTML\([\s\S]*?gameState\.tiles, gameState\.resources, gameState\.buildings, gameState\.lords\)/);
    });
});
