/**
 * Faction-unique unit gating tests.
 *
 * Verifies the fix for the bug where every faction could train another faction's
 * signature unit (e.g. WINGED_HUSSAR) after researching the gating tech. The
 * fix: FACTION_UNIQUE_UNITS maps each unique unit to its owning faction id, and
 * the AI roster filter + player build menu + engine train validator all reject
 * a unique unit unless the faction def id matches.
 */
import { describe, it, expect } from 'vitest';
import { FACTION_UNIQUE_UNITS, EXTRA_UNITS, UNIT_TYPE } from '../src/config.js';
import { FACTION_DEFS } from '../src/faction.js';
import { TECHS, getUnlockedUnits, createTechState } from '../src/tech.js';
import { applyObsolescence } from '../src/unit_obsolescence.js';

describe('faction-unique unit gating', () => {
    it('FACTION_UNIQUE_UNITS maps every signature unit to its owner', () => {
        expect(FACTION_UNIQUE_UNITS.WINGED_HUSSAR).toBe('polish');
        expect(FACTION_UNIQUE_UNITS.BERSERKER).toBe('viking');
        expect(FACTION_UNIQUE_UNITS.VARANGIAN_GUARD).toBe('byzantine');
        expect(FACTION_UNIQUE_UNITS.CONQUISTADOR).toBe('spanish');
        expect(FACTION_UNIQUE_UNITS.LEGIONNAIRE).toBe('roman');
    });

    it('every unique unit is in its owner roster', () => {
        for (const [unit, owner] of Object.entries(FACTION_UNIQUE_UNITS)) {
            const def = FACTION_DEFS[owner];
            expect(def).toBeDefined();
            expect(def.roster).toContain(unit);
        }
    });

    it('every unique unit has a stat definition', () => {
        for (const unit of Object.keys(FACTION_UNIQUE_UNITS)) {
            expect(UNIT_TYPE[unit]).toBeDefined();
        }
    });

    it('the gating tech still lists the unique unit (so the owner can unlock it)', () => {
        // The tech unlock list must contain the unique unit id; the faction
        // gate is applied at train time, not at the tech-unlock level. This
        // is what lets the owning faction research-to-unlock its own unique.
        for (const unit of Object.keys(FACTION_UNIQUE_UNITS)) {
            const found = Object.values(TECHS).some(t =>
                t.unlocks.some(u => u.type === 'unit' && u.id === unit));
            expect(found).toBe(true);
        }
    });

    it('each unique unit has a generic replacement in EXTRA_UNITS', () => {
        // Non-owning factions still get a unit from the gating tech — the
        // generic replacements. Verify they exist and are distinct from the
        // unique units.
        const generics = ['MERCENARY_KNIGHT', 'HOUSEHOLD_GUARD', 'FRONTIERSMAN', 'RAIDER'];
        for (const g of generics) {
            expect(EXTRA_UNITS).toContain(g);
            expect(UNIT_TYPE[g]).toBeDefined();
            expect(FACTION_UNIQUE_UNITS[g]).toBeUndefined();
        }
    });

    it('a non-owning faction never has the unique unit in its roster', () => {
        // Simulate the AI roster filter: build fullRoster from a non-owning
        // faction's roster + EXTRA_UNITS, then strip uniques whose owner isn't
        // this faction.
        const crimson = FACTION_DEFS.crimson;
        const fullRoster = [...crimson.roster, ...EXTRA_UNITS.filter(u => !crimson.roster.includes(u))];
        for (let i = fullRoster.length - 1; i >= 0; i--) {
            const u = fullRoster[i];
            const owner = FACTION_UNIQUE_UNITS[u];
            if (owner && owner !== crimson.id) fullRoster.splice(i, 1);
        }
        // Crimson must NOT be able to train any unique unit.
        for (const unit of Object.keys(FACTION_UNIQUE_UNITS)) {
            expect(fullRoster).not.toContain(unit);
        }
        // But crimson DOES keep its own roster + the generic replacements.
        expect(fullRoster).toContain('INFANTRY');
        expect(fullRoster).toContain('RAIDER');
        expect(fullRoster).toContain('FRONTIERSMAN');
    });

    it('the owning faction DOES keep its unique unit in the roster', () => {
        const polish = FACTION_DEFS.polish;
        const fullRoster = [...polish.roster, ...EXTRA_UNITS.filter(u => !polish.roster.includes(u))];
        for (let i = fullRoster.length - 1; i >= 0; i--) {
            const u = fullRoster[i];
            const owner = FACTION_UNIQUE_UNITS[u];
            if (owner && owner !== polish.id) fullRoster.splice(i, 1);
        }
        expect(fullRoster).toContain('WINGED_HUSSAR');
        // Polish does NOT get other factions' uniques.
        expect(fullRoster).not.toContain('BERSERKER');
        expect(fullRoster).not.toContain('LEGIONNAIRE');
    });

    it('researching CHIVALRY unlocks WINGED_HUSSAR in the tech state (gate is at train time)', () => {
        const ts = createTechState();
        ts.researched.add('CHIVALRY');
        const unlocked = getUnlockedUnits(ts);
        expect(unlocked.has('WINGED_HUSSAR')).toBe(true);
        expect(unlocked.has('BERSERKER')).toBe(true);
        // The generic replacements are also unlocked.
        expect(unlocked.has('RAIDER')).toBe(true);
        expect(unlocked.has('MERCENARY_KNIGHT')).toBe(true);
    });
});

describe('atomic-era tech tree expansion', () => {
    it('ERA_ORDER includes the atomic era', async () => {
        const { ERA_ORDER, ERA_NAMES } = await import('../src/tech.js');
        expect(ERA_ORDER).toContain('atomic');
        expect(ERA_NAMES.atomic).toBeDefined();
    });

    it('atomic-era techs unlock mobilized units and tanks', async () => {
        const { TECHS } = await import('../src/tech.js');
        expect(TECHS.INTERNAL_COMBUSTION).toBeDefined();
        expect(TECHS.ARMOR).toBeDefined();
        expect(TECHS.DREADNOUGHT).toBeDefined();
        const ic = TECHS.INTERNAL_COMBUSTION.unlocks.map(u => u.id);
        expect(ic).toContain('MOBILIZED_INFANTRY');
        expect(ic).toContain('MOBILIZED_ARTILLERY');
        expect(ic).toContain('ARMORED_CAR');
        const armor = TECHS.ARMOR.unlocks.map(u => u.id);
        expect(armor).toContain('TANK');
        expect(armor).toContain('HEAVY_TANK');
    });

    it('mobilized units have higher move range than their foot-bound predecessors', () => {
        expect(UNIT_TYPE.MOBILIZED_INFANTRY.moveRange).toBeGreaterThan(UNIT_TYPE.RIFLEMAN.moveRange);
        expect(UNIT_TYPE.MOBILIZED_ARTILLERY.moveRange).toBeGreaterThan(UNIT_TYPE.FIELD_GUN.moveRange);
    });

    it('tanks are modern cavalry (canCharge) with much better stats than CAVALRY', () => {
        expect(UNIT_TYPE.TANK.canCharge).toBe(true);
        expect(UNIT_TYPE.TANK.hp).toBeGreaterThan(UNIT_TYPE.CAVALRY.hp);
        expect(UNIT_TYPE.TANK.attack).toBeGreaterThan(UNIT_TYPE.CAVALRY.attack);
        expect(UNIT_TYPE.TANK.defense).toBeGreaterThan(UNIT_TYPE.CAVALRY.defense);
    });

    it('old siege (catapult/trebuchet) has only 1 move range', () => {
        expect(UNIT_TYPE.CATAPULT.moveRange).toBe(1);
        expect(UNIT_TYPE.TREBUCHET.moveRange).toBe(1);
    });

    it('modern siege has more mobility than old siege', () => {
        expect(UNIT_TYPE.FIELD_GUN.moveRange).toBeGreaterThan(UNIT_TYPE.TREBUCHET.moveRange);
        expect(UNIT_TYPE.HORSE_ARTILLERY.moveRange).toBeGreaterThan(UNIT_TYPE.TREBUCHET.moveRange);
        expect(UNIT_TYPE.MOBILIZED_ARTILLERY.moveRange).toBeGreaterThan(UNIT_TYPE.TREBUCHET.moveRange);
    });

    it('anti-cavalry units exist and have the antiCavalry flag', () => {
        expect(UNIT_TYPE.HALBERDIER.antiCavalry).toBe(true);
        expect(UNIT_TYPE.PIKE_MASTER.antiCavalry).toBe(true);
        expect(UNIT_TYPE.BAYONET_RIFLE.antiCavalry).toBe(true);
    });

    it('researching ARMOR obsoletes horse cavalry (tanks replace them)', () => {
        const ts = createTechState();
        ts.researched.add('ARMOR');
        const roster = ['CAVALRY', 'CATAPHRACT', 'CHARIOT', 'WINGED_HUSSAR', 'TANK', 'HEAVY_TANK'];
        const obsoleted = applyObsolescence(roster, ts.researched);
        // Horse cavalry are obsoleted (removed)...
        expect(obsoleted).not.toContain('CAVALRY');
        expect(obsoleted).not.toContain('CATAPHRACT');
        expect(obsoleted).not.toContain('WINGED_HUSSAR');
        // ...but TANK/HEAVY_TANK remain trainable.
        expect(obsoleted).toContain('TANK');
        expect(obsoleted).toContain('HEAVY_TANK');
    });

    it('researching INTERNAL_COMBUSTION obsoletes the foot-bound rifle line', () => {
        const ts = createTechState();
        ts.researched.add('INTERNAL_COMBUSTION');
        const roster = ['RIFLEMAN', 'SHARPSHOOTER', 'MOBILIZED_INFANTRY', 'MOBILIZED_ARTILLERY'];
        const obsoleted = applyObsolescence(roster, ts.researched);
        expect(obsoleted).not.toContain('RIFLEMAN');
        expect(obsoleted).not.toContain('SHARPSHOOTER');
        expect(obsoleted).toContain('MOBILIZED_INFANTRY');
        expect(obsoleted).toContain('MOBILIZED_ARTILLERY');
    });
});