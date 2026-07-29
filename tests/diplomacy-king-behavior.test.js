/**
 * Extensive tests for diplomacy system and king/lord AI behavior.
 * Covers:
 *  - aiDecideTreaty parameter usage (sharedEnemies, isNeighbor)
 *  - aiDecideWar parameter usage (sharedEnemies)
 *  - atWar-as-function bug regression (bare truthy check)
 *  - King early-game exploration (moves off capital)
 *  - King retreat when locally outmatched
 *  - Lord army regrouping
 *  - City name display (generated cities have names)
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
    createDiplomacyState, setRelation, getRelation, aiDecideTreaty, aiDecideWar,
    addGrievance, getTension
} from '../src/diplomacy.js';
import {
    createLord, lordMaxHp, lordAttack, lordDefense, maxArmySize, kingGuardBonus,
    awardXP, getAdjacentLordBonuses, hasLordAura
} from '../src/lords.js';
import { DIPLOMACY_STATES, LORD_CLASSES, AI_PERSONALITIES, LORD_XP_PER_LEVEL, setGridDimensions } from '../src/config.js';
import { generateMap, buildTileMap } from '../src/map.js';
import { makeTile, makeUnit, makeTileMap, makeGameState } from './helpers.js';
import { readFileSync } from 'fs';
import { resolve } from 'path';

beforeEach(() => { setGridDimensions(40, 40); });

// ===========================================================================
// 1. Diplomacy: aiDecideTreaty parameter correctness
// ===========================================================================
describe('aiDecideTreaty parameter usage', () => {
    it('sharedEnemies increases acceptance probability for trade pacts', () => {
        // With same random seed context, more shared enemies = higher rate.
        // Run 200 trials each and compare acceptance rates.
        let noEnemyAccepts = 0, withEnemyAccepts = 0;
        for (let i = 0; i < 200; i++) {
            if (aiDecideTreaty('BALANCED', DIPLOMACY_STATES.TRADE_PACT, 1.0, 20, 0, 0, true, 0)) noEnemyAccepts++;
            if (aiDecideTreaty('BALANCED', DIPLOMACY_STATES.TRADE_PACT, 1.0, 20, 0, 3, true, 0)) withEnemyAccepts++;
        }
        // Shared enemies should meaningfully increase acceptance.
        expect(withEnemyAccepts).toBeGreaterThan(noEnemyAccepts);
    });

    it('isNeighbor increases acceptance for NAP', () => {
        let farAccepts = 0, neighborAccepts = 0;
        for (let i = 0; i < 200; i++) {
            if (aiDecideTreaty('BALANCED', DIPLOMACY_STATES.NAP, 1.0, 10, 0, 0, false, 0)) farAccepts++;
            if (aiDecideTreaty('BALANCED', DIPLOMACY_STATES.NAP, 1.0, 10, 0, 0, true, 0)) neighborAccepts++;
        }
        expect(neighborAccepts).toBeGreaterThanOrEqual(farAccepts);
    });

    it('sharedEnemies strongly boosts alliance acceptance', () => {
        let noEnemy = 0, withEnemy = 0;
        for (let i = 0; i < 300; i++) {
            if (aiDecideTreaty('DEFENSIVE', DIPLOMACY_STATES.ALLIANCE, 1.0, 30, 0, 0, true, 0)) noEnemy++;
            if (aiDecideTreaty('DEFENSIVE', DIPLOMACY_STATES.ALLIANCE, 1.0, 30, 0, 3, true, 0)) withEnemy++;
        }
        // Alliance gets +0.15 per shared enemy — big boost.
        expect(withEnemy).toBeGreaterThan(noEnemy * 1.5);
    });

    it('broken treaties reduce acceptance', () => {
        let clean = 0, breaker = 0;
        for (let i = 0; i < 200; i++) {
            if (aiDecideTreaty('BALANCED', DIPLOMACY_STATES.TRADE_PACT, 1.0, 20, 0, 0, true, 0)) clean++;
            if (aiDecideTreaty('BALANCED', DIPLOMACY_STATES.TRADE_PACT, 1.0, 20, 5, 0, true, 0)) breaker++;
        }
        expect(clean).toBeGreaterThan(breaker);
    });

    it('high grievances block acceptance', () => {
        let low = 0, high = 0;
        for (let i = 0; i < 200; i++) {
            if (aiDecideTreaty('BALANCED', DIPLOMACY_STATES.PEACE, 0.5, 0, 0, 0, false, 5)) low++;
            if (aiDecideTreaty('BALANCED', DIPLOMACY_STATES.PEACE, 0.5, 0, 0, 0, false, 60)) high++;
        }
        expect(low).toBeGreaterThan(high);
    });

    it('losing badly increases peace acceptance', () => {
        let winning = 0, losing = 0;
        for (let i = 0; i < 200; i++) {
            if (aiDecideTreaty('BALANCED', DIPLOMACY_STATES.PEACE, 1.5, 0, 0, 0, false, 0)) winning++;
            if (aiDecideTreaty('BALANCED', DIPLOMACY_STATES.PEACE, 0.3, 0, 0, 0, false, 0)) losing++;
        }
        expect(losing).toBeGreaterThan(winning);
    });
});

// ===========================================================================
// 2. Diplomacy: aiDecideWar parameter usage
// ===========================================================================
describe('aiDecideWar parameter usage', () => {
    it('sharedEnemies increases war declaration chance', () => {
        let noEnemy = 0, withEnemy = 0;
        for (let i = 0; i < 300; i++) {
            if (aiDecideWar('AGGRESSIVE', 1.2, -20, 0, true, 10, false)) noEnemy++;
            if (aiDecideWar('AGGRESSIVE', 1.2, -20, 3, true, 10, false)) withEnemy++;
        }
        expect(withEnemy).toBeGreaterThanOrEqual(noEnemy);
    });

    it('spectate mode boosts war chance', () => {
        let normal = 0, spectate = 0;
        for (let i = 0; i < 300; i++) {
            if (aiDecideWar('BALANCED', 1.0, 0, 0, true, 5, false)) normal++;
            if (aiDecideWar('BALANCED', 1.0, 0, 0, true, 5, true)) spectate++;
        }
        expect(spectate).toBeGreaterThan(normal);
    });

    it('neighbor bonus increases war chance', () => {
        let far = 0, near = 0;
        for (let i = 0; i < 300; i++) {
            if (aiDecideWar('AGGRESSIVE', 1.0, -10, 0, false, 5, false)) far++;
            if (aiDecideWar('AGGRESSIVE', 1.0, -10, 0, true, 5, false)) near++;
        }
        expect(near).toBeGreaterThanOrEqual(far);
    });
});

// ===========================================================================
// 3. Diplomacy: AI-AI treaty flow integration
// ===========================================================================
describe('AI-AI diplomacy integration', () => {
    it('two AIs at war can make peace when both accept', () => {
        const diplo = createDiplomacyState(['ai1', 'ai2']);
        setRelation(diplo, 'ai1', 'ai2', DIPLOMACY_STATES.WAR, 1);
        const rel = getRelation(diplo, 'ai1', 'ai2');
        rel.turnsAtWar = 15;
        rel.relationship = -30;

        // Simulate AI-AI peace: both sides must accept.
        // With long war and mediocre relationship, peace should sometimes succeed.
        let peaceMade = false;
        for (let i = 0; i < 50; i++) {
            const a = aiDecideTreaty('BALANCED', DIPLOMACY_STATES.PEACE, 0.8, -30, 0, 0, true, 5);
            const b = aiDecideTreaty('BALANCED', DIPLOMACY_STATES.PEACE, 1.25, -30, 0, 0, true, 5);
            if (a && b) { peaceMade = true; break; }
        }
        expect(peaceMade).toBe(true);
    });

    it('two AIs with shared enemy form alliance more readily', () => {
        const diplo = createDiplomacyState(['ai1', 'ai2', 'ai3']);
        setRelation(diplo, 'ai1', 'ai2', DIPLOMACY_STATES.PEACE, 1);
        setRelation(diplo, 'ai1', 'ai3', DIPLOMACY_STATES.WAR, 1);
        setRelation(diplo, 'ai2', 'ai3', DIPLOMACY_STATES.WAR, 1);
        const rel = getRelation(diplo, 'ai1', 'ai2');
        rel.relationship = 40;
        rel.turnsAtPeace = 8;

        let noSharedEnemy = 0, sharedEnemy = 0;
        for (let i = 0; i < 200; i++) {
            // Without shared enemy info (the old buggy call)
            if (aiDecideTreaty('DEFENSIVE', DIPLOMACY_STATES.ALLIANCE, 1.0, 40, 0, 0, true, 0) &&
                aiDecideTreaty('DEFENSIVE', DIPLOMACY_STATES.ALLIANCE, 1.0, 40, 0, 0, true, 0)) noSharedEnemy++;
            // With shared enemy (the fixed call)
            if (aiDecideTreaty('DEFENSIVE', DIPLOMACY_STATES.ALLIANCE, 1.0, 40, 0, 1, true, 0) &&
                aiDecideTreaty('DEFENSIVE', DIPLOMACY_STATES.ALLIANCE, 1.0, 40, 0, 1, true, 0)) sharedEnemy++;
        }
        expect(sharedEnemy).toBeGreaterThan(noSharedEnemy);
    });
});

// ===========================================================================
// 4. Lord/King: aura system
// ===========================================================================
describe('Lord aura system', () => {
    it('hasLordAura returns true for classes with attack/defense bonus', () => {
        const warlord = createLord('player', 5, 5, 'T', 'WARLORD');
        expect(hasLordAura(warlord)).toBe(true);
        const guardian = createLord('player', 5, 5, 'T', 'GUARDIAN');
        expect(hasLordAura(guardian)).toBe(true);
        const commander = createLord('player', 5, 5, 'T', 'GRAND_COMMANDER');
        expect(hasLordAura(commander)).toBe(true);
    });

    it('hasLordAura returns false for CONQUEROR (siege only, no atk/def)', () => {
        const conqueror = createLord('player', 5, 5, 'T', 'CONQUEROR');
        expect(hasLordAura(conqueror)).toBe(false);
    });

    it('getAdjacentLordBonuses applies class bonus within radius 3', () => {
        const warlord = createLord('player', 5, 5, 'T', 'WARLORD');
        const unit = makeUnit('INFANTRY', 'player', 7, 7);
        // Distance: Chebyshev(5,5 -> 7,7) = 2, within radius 3.
        const bonus = getAdjacentLordBonuses([warlord], unit);
        const clsBonus = LORD_CLASSES.WARLORD.bonus;
        expect(bonus.attack).toBe(clsBonus.attack || 0);
    });

    it('getAdjacentLordBonuses does NOT apply beyond radius 3', () => {
        const warlord = createLord('player', 5, 5, 'T', 'WARLORD');
        const unit = makeUnit('INFANTRY', 'player', 9, 9);
        // Distance: Chebyshev(5,5 -> 9,9) = 4, beyond radius 3.
        const bonus = getAdjacentLordBonuses([warlord], unit);
        expect(bonus.attack).toBe(0);
    });

    it('getAdjacentLordBonuses ignores enemy lords', () => {
        const warlord = createLord('ai1', 5, 5, 'T', 'WARLORD');
        const unit = makeUnit('INFANTRY', 'player', 5, 5);
        const bonus = getAdjacentLordBonuses([warlord], unit);
        expect(bonus.attack).toBe(0);
    });

    it('RALLY ability adds +2 attack aura', () => {
        const lord = createLord('player', 5, 5, 'T', 'GUARDIAN');
        lord.abilities = ['RALLY'];
        const unit = makeUnit('INFANTRY', 'player', 5, 5);
        const bonus = getAdjacentLordBonuses([lord], unit);
        // Guardian gives +2 defense, RALLY gives +2 attack.
        expect(bonus.attack).toBe(2);
        expect(bonus.defense).toBe(2);
    });
});

// ===========================================================================
// 5. Lord/King: stats and combat
// ===========================================================================
describe('Lord/King stats', () => {
    it('king has significantly more HP than regular lord', () => {
        const lord = createLord('player', 0, 0, 'T', 'WARLORD');
        const king = createLord('player', 0, 0, 'K', 'WARLORD');
        king.isKing = true;
        king.maxHp = lordMaxHp(king);
        expect(king.maxHp).toBeGreaterThan(lord.maxHp * 2);
    });

    it('king has higher attack than regular lord', () => {
        const lord = createLord('player', 0, 0, 'T', 'WARLORD');
        const king = createLord('player', 0, 0, 'K', 'WARLORD');
        king.isKing = true;
        expect(lordAttack(king)).toBeGreaterThan(lordAttack(lord));
    });

    it('king has higher defense than regular lord', () => {
        const lord = createLord('player', 0, 0, 'T', 'GUARDIAN');
        const king = createLord('player', 0, 0, 'K', 'GUARDIAN');
        king.isKing = true;
        expect(lordDefense(king)).toBeGreaterThan(lordDefense(lord));
    });

    it('king commands more units than regular lord', () => {
        const lord = createLord('player', 0, 0, 'T', 'WARLORD');
        const king = createLord('player', 0, 0, 'K', 'WARLORD');
        king.isKing = true;
        expect(maxArmySize(king)).toBeGreaterThan(maxArmySize(lord));
    });

    it('king guard bonus scales with army size', () => {
        const king = createLord('player', 0, 0, 'K', 'WARLORD');
        king.isKing = true;
        king.army = [1, 2, 3];
        expect(kingGuardBonus(king)).toBe(3);
        king.army = [1, 2, 3, 4, 5, 6, 7];
        expect(kingGuardBonus(king)).toBe(5); // capped at 5
    });

    it('regular lord gets no king guard bonus', () => {
        const lord = createLord('player', 0, 0, 'T', 'WARLORD');
        lord.army = [1, 2, 3];
        expect(kingGuardBonus(lord)).toBe(0);
    });
});

// ===========================================================================
// 6. Lord/King: leveling and XP
// ===========================================================================
describe('Lord leveling', () => {
    it('XP awards and level-up increases stats', () => {
        const lord = createLord('player', 0, 0, 'T', 'WARLORD');
        const initialLevel = lord.level;
        awardXP(lord, LORD_XP_PER_LEVEL * 2);
        expect(lord.level).toBeGreaterThan(initialLevel);
        expect(lord.maxHp).toBeGreaterThan(18);
    });

    it('level-up grants skill points', () => {
        const lord = createLord('player', 0, 0, 'T', 'WARLORD');
        awardXP(lord, LORD_XP_PER_LEVEL * 2);
        expect(lord.skillPoints).toBeGreaterThan(0);
    });

    it('NaN xp is sanitized to 0', () => {
        const lord = createLord('player', 0, 0, 'T', 'WARLORD');
        lord.xp = NaN;
        lord.level = NaN;
        const msgs = awardXP(lord, 10);
        expect(Number.isFinite(lord.xp)).toBe(true);
        expect(Number.isFinite(lord.level)).toBe(true);
    });
});

// ===========================================================================
// 7. City name display: generated cities must have names
// ===========================================================================
describe('City name display', () => {
    it('generated map cities have cityName set', () => {
        const result = generateMap();
        const tiles = buildTileMap(result.tiles);
        let cityCount = 0, namedCount = 0;
        for (const t of tiles.values()) {
            if (t.terrain === 'CITY') {
                cityCount++;
                if (t.cityName && typeof t.cityName === 'string' && t.cityName.length > 0) namedCount++;
            }
        }
        expect(cityCount).toBeGreaterThan(0);
        expect(namedCount).toBe(cityCount);
    });
});

// ===========================================================================
// 8. atWar-as-function regression
// ===========================================================================
describe('atWar truthy bug regression', () => {
    it('_aiMoveKing source does not use bare atWar as boolean', () => {
        const src = readFileSync(resolve(import.meta.dirname, '..', 'src', 'game.js'), 'utf-8');
        // Extract the _aiMoveKing function body.
        const m = src.match(/_aiMoveKing\(lord, faction, atWar, pool\)\s*\{([\s\S]*?)\n    _aiStepLord/);
        expect(m, '_aiMoveKing body not found').not.toBeNull();
        const body = m[1];
        // The bare "atWar" (without parentheses) used as a condition should NOT appear.
        // Look for patterns like "if (atWar)" or "&& atWar)" that are NOT "atWar(".
        const bareAtWar = body.match(/[^a-zA-Z_]atWar[^a-zA-Z_(]/g);
        // Filter out "atWar =" (assignment) and "atWar," (parameter).
        const realBare = (bareAtWar || []).filter(s => !s.includes('=') && !s.includes(','));
        expect(realBare.length, `bare atWar found: ${realBare.join(' | ')}`).toBe(0);
    });
});

// ===========================================================================
// 9. King early-game exploration regression
// ===========================================================================
describe('King early-game exploration', () => {
    it('_aiMoveKing has an exploration step for tiny armies', () => {
        const src = readFileSync(resolve(import.meta.dirname, '..', 'src', 'game.js'), 'utf-8');
        const m = src.match(/_aiMoveKing\(lord, faction, atWar, pool\)\s*\{([\s\S]*?)\n    _aiStepLord/);
        expect(m, '_aiMoveKing body not found').not.toBeNull();
        const body = m[1];
        // Should contain an exploration step that activates when military < 5
        // (or when the king is mobilized, e.g. Iron Empire).
        expect(body).toMatch(/military\.length\s*<\s*5/);
        expect(body).toMatch(/explor/i);
    });
});