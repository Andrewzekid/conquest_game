/**
 * Army Groups panel tests — buildArmyGroupsHTML renders each faction's army
 * groups (leader, stance, objective, power, unit-type composition) in its own
 * panel, separate from AI Debug and AI Goals.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildArmyGroupsHTML } from '../src/ai.js';

const here = dirname(fileURLToPath(import.meta.url));

function mkState() {
    const aiState = {
        ai1: {
            armyGroups: [
                {
                    id: 'lord:7', size: 5, stance: 'engage', objective: '7,7',
                    lord: 'King Test', power: 42,
                    composition: { INFANTRY: 4, SIEGE_CANNON: 1 },
                },
                {
                    id: 'cluster:12', size: 2, stance: 'hold', objective: null,
                    lord: null, power: 10,
                    composition: { ARCHER: 2 },
                },
            ],
        },
        ai2: { armyGroups: [] },
    };
    const factionDefs = {
        ai1: { name: 'Test AI', emoji: '🤖', roster: [] },
        ai2: { name: 'Other AI', emoji: '👾', roster: [] },
    };
    const factionColors = {
        ai1: { name: 'Test AI', tile: 0xff0000 },
        ai2: { name: 'Other AI', tile: 0x00ff00 },
    };
    return { aiState, factionDefs, factionColors };
}

describe('buildArmyGroupsHTML', () => {
    it('renders group composition as "Name ×count" using display names', () => {
        const s = mkState();
        const html = buildArmyGroupsHTML(s.aiState, ['ai1', 'ai2'], s.factionDefs, s.factionColors);
        expect(html).toContain('Infantry ×4');
        expect(html).toContain('Siege Cannon ×1');
        expect(html).toContain('Archer ×2');
    });

    it('renders leader, stance, objective and power per group', () => {
        const s = mkState();
        const html = buildArmyGroupsHTML(s.aiState, ['ai1', 'ai2'], s.factionDefs, s.factionColors);
        expect(html).toContain('King Test');
        expect(html).toContain('engage → 7,7');
        expect(html).toContain('pow 42');
        expect(html).toContain('hold');
    });

    it('skips factions with no groups and shows an empty state when none exist', () => {
        const s = mkState();
        const html = buildArmyGroupsHTML(s.aiState, ['ai1', 'ai2'], s.factionDefs, s.factionColors);
        expect(html).not.toContain('Other AI');
        const empty = buildArmyGroupsHTML({}, ['ai1'], s.factionDefs, s.factionColors);
        expect(empty).toContain('No army groups');
    });
});

// Source-invariants: the panel exists, is wired into the UI update cycle, and
// is revealed in spectate mode.
describe('Army Groups panel wiring (source-invariant)', () => {
    const indexHtml = readFileSync(join(here, '..', 'index.html'), 'utf8');
    const uiSrc = readFileSync(join(here, '..', 'src', 'ui.js'), 'utf8');
    const gameSrc = readFileSync(join(here, '..', 'src', 'game.js'), 'utf8');

    it('index.html has the army-groups panel', () => {
        expect(indexHtml).toContain('id="army-groups-panel"');
        expect(indexHtml).toContain('id="army-groups-panel-body"');
    });

    it('ui.js caches the elements and calls showArmyGroupsPanel in updateAll', () => {
        expect(uiSrc).toContain("getElementById('army-groups-panel-body')");
        expect(uiSrc).toContain("getElementById('army-groups-panel')");
        expect(uiSrc).toMatch(/showArmyGroupsPanel\(\)/);
    });

    it('spectate init reveals the army-groups panel', () => {
        expect(gameSrc).toContain("getElementById('army-groups-panel')");
    });
});
