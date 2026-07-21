/**
 * Battle integration tests for faction passives.
 * Verifies that faction-specific combat bonuses trigger correctly when
 * units have the appropriate factionId set.
 */
import { describe, it, expect } from 'vitest';
import { resolveCombat } from '../src/battle.js';
import { makeUnit } from './helpers.js';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('faction passives in combat', () => {

    // --- Viking: heal on kill ---
    describe('Viking heal-on-kill', () => {
        it('heals attacker when killing a defender', () => {
            const atk = makeUnit('INFANTRY', 'player', 0, 0, { factionId: 'viking', hp: 8, maxHp: 10 });
            const def = makeUnit('INFANTRY', 'ai1', 1, 0, { hp: 1 }); // will die
            const res = resolveCombat(atk, def, 'PLAINS');
            expect(res.defenderDied).toBe(true);
            expect(atk.hp).toBeGreaterThan(8); // healed
            expect(res.messages.some(m => /raids and heals/i.test(m))).toBe(true);
        });

        it('does NOT heal if attacker is already at max HP', () => {
            const atk = makeUnit('INFANTRY', 'player', 0, 0, { factionId: 'viking', hp: 10, maxHp: 10 });
            const def = makeUnit('INFANTRY', 'ai1', 1, 0, { hp: 1 });
            const res = resolveCombat(atk, def, 'PLAINS');
            expect(res.defenderDied).toBe(true);
            expect(atk.hp).toBe(10); // no change
        });

        it('does NOT heal if attacker is not viking', () => {
            const atk = makeUnit('INFANTRY', 'player', 0, 0, { factionId: 'crimson', hp: 5, maxHp: 10 });
            const def = makeUnit('INFANTRY', 'ai1', 1, 0, { hp: 1 });
            resolveCombat(atk, def, 'PLAINS');
            expect(atk.hp).toBe(5); // no heal
        });
    });

    // --- Roman: city capture bonus ---
    describe('Roman city capture bonus', () => {
        it('gives +1 attack when fighting in a city', () => {
            const atk = makeUnit('INFANTRY', 'player', 0, 0, { factionId: 'roman' });
            const def = makeUnit('INFANTRY', 'ai1', 1, 0);
            const res = resolveCombat(atk, def, 'CITY');
            expect(res.messages.some(m => /Roman discipline vs city/i.test(m))).toBe(true);
        });

        it('does NOT give city bonus on open terrain', () => {
            const atk = makeUnit('INFANTRY', 'player', 0, 0, { factionId: 'roman' });
            const def = makeUnit('INFANTRY', 'ai1', 1, 0);
            const res = resolveCombat(atk, def, 'PLAINS');
            expect(res.messages.some(m => /Roman discipline/i.test(m))).toBe(false);
        });
    });

    // --- Byzantine: fortified defense ---
    describe('Byzantine fortified defense', () => {
        it('gives +2 defense when defender has not moved', () => {
            const atk = makeUnit('INFANTRY', 'player', 0, 0);
            const def = makeUnit('INFANTRY', 'ai1', 1, 0, {
                factionId: 'byzantine',
                hasMovedThisTurn: false,
            });
            const res = resolveCombat(atk, def, 'PLAINS');
            expect(res.messages.some(m => /fortified.*\+2 def/i.test(m))).toBe(true);
        });

        it('does NOT give fortified bonus if defender moved this turn', () => {
            const atk = makeUnit('INFANTRY', 'player', 0, 0);
            const def = makeUnit('INFANTRY', 'ai1', 1, 0, {
                factionId: 'byzantine',
                hasMovedThisTurn: true,
            });
            const res = resolveCombat(atk, def, 'PLAINS');
            expect(res.messages.some(m => /fortified/i.test(m))).toBe(false);
        });
    });

    // --- Winged Hussar: charge multiplier ---
    describe('Winged Hussar charge', () => {
        it('deals 2x damage on first attack', () => {
            const atk = makeUnit('WINGED_HUSSAR', 'player', 0, 0, {
                factionId: 'polish',
                hasAttackedThisTurn: false,
            });
            const def = makeUnit('INFANTRY', 'ai1', 1, 0, { hp: 100 });
            const res = resolveCombat(atk, def, 'PLAINS');
            expect(res.messages.some(m => /winged charge.*×2/i.test(m))).toBe(true);
        });

        it('does NOT double on second attack same turn', () => {
            const atk = makeUnit('WINGED_HUSSAR', 'player', 0, 0, {
                factionId: 'polish',
                hasAttackedThisTurn: true,
            });
            const def = makeUnit('INFANTRY', 'ai1', 1, 0, { hp: 100 });
            const res = resolveCombat(atk, def, 'PLAINS');
            expect(res.messages.some(m => /winged charge/i.test(m))).toBe(false);
        });
    });

    // --- Berserker: frenzy ---
    describe('Berserker frenzy', () => {
        it('adds +3 attack when below 50% HP', () => {
            const atk = makeUnit('BERSERKER', 'player', 0, 0, {
                factionId: 'viking',
                hp: 4, // 4/12 = 33% < 50%
                maxHp: 12,
            });
            const def = makeUnit('INFANTRY', 'ai1', 1, 0, { hp: 100 });
            const res = resolveCombat(atk, def, 'PLAINS');
            expect(res.messages.some(m => /frenzy/i.test(m))).toBe(true);
        });

        it('does NOT frenzy when above 50% HP', () => {
            const atk = makeUnit('BERSERKER', 'player', 0, 0, {
                factionId: 'viking',
                hp: 10, // 10/12 = 83% > 50%
                maxHp: 12,
            });
            const def = makeUnit('INFANTRY', 'ai1', 1, 0, { hp: 100 });
            const res = resolveCombat(atk, def, 'PLAINS');
            expect(res.messages.some(m => /frenzy/i.test(m))).toBe(false);
        });
    });

    // --- Conquistador: city attack bonus ---
    describe('Conquistador city bonus', () => {
        it('gives +2 attack in city terrain', () => {
            const atk = makeUnit('CONQUISTADOR', 'player', 0, 0, { factionId: 'spanish' });
            const def = makeUnit('INFANTRY', 'ai1', 1, 0);
            const res = resolveCombat(atk, def, 'CITY');
            expect(res.messages.some(m => /city assault/i.test(m))).toBe(true);
        });

        it('does NOT give city bonus on open terrain', () => {
            const atk = makeUnit('CONQUISTADOR', 'player', 0, 0, { factionId: 'spanish' });
            const def = makeUnit('INFANTRY', 'ai1', 1, 0);
            const res = resolveCombat(atk, def, 'PLAINS');
            expect(res.messages.some(m => /city assault/i.test(m))).toBe(false);
        });
    });

    // --- Varangian Guard: lord adjacency defense ---
    describe('Varangian Guard lord guard', () => {
        it('gives +2 defense when friendly lord is adjacent', () => {
            const def = makeUnit('VARANGIAN_GUARD', 'player', 5, 5, { factionId: 'byzantine' });
            const atk = makeUnit('INFANTRY', 'ai1', 4, 5);
            const lords = [{ owner: 'player', x: 5, z: 4, class: 'WARLORD', abilities: [] }];
            const res = resolveCombat(atk, def, 'PLAINS', null, null, null, lords);
            expect(res.messages.some(m => /guards its lord/i.test(m))).toBe(true);
        });

        it('does NOT give guard bonus when lord is far away', () => {
            const def = makeUnit('VARANGIAN_GUARD', 'player', 5, 5, { factionId: 'byzantine' });
            const atk = makeUnit('INFANTRY', 'ai1', 4, 5);
            const lords = [{ owner: 'player', x: 20, z: 20, class: 'WARLORD', abilities: [] }];
            const res = resolveCombat(atk, def, 'PLAINS', null, null, null, lords);
            expect(res.messages.some(m => /guards its lord/i.test(m))).toBe(false);
        });

        it('does NOT give guard bonus with no lords', () => {
            const def = makeUnit('VARANGIAN_GUARD', 'player', 5, 5, { factionId: 'byzantine' });
            const atk = makeUnit('INFANTRY', 'ai1', 4, 5);
            const res = resolveCombat(atk, def, 'PLAINS', null, null, null, []);
            expect(res.messages.some(m => /guards its lord/i.test(m))).toBe(false);
        });
    });

    // --- No faction passive (baseline) ---
    describe('non-faction units', () => {
        it('no faction-specific messages for plain crimson faction', () => {
            const atk = makeUnit('INFANTRY', 'player', 0, 0, { factionId: 'crimson' });
            const def = makeUnit('INFANTRY', 'ai1', 1, 0, { factionId: 'verdant' });
            const res = resolveCombat(atk, def, 'PLAINS');
            expect(res.messages.some(m => /Roman discipline/i.test(m))).toBe(false);
            expect(res.messages.some(m => /fortified/i.test(m))).toBe(false);
            expect(res.messages.some(m => /raids and heals/i.test(m))).toBe(false);
            expect(res.messages.some(m => /winged charge/i.test(m))).toBe(false);
        });
    });
});
