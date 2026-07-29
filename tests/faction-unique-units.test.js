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

describe('anti-armor line: RPG / anti-tank gun', () => {
    it('ANTI_TANK_GUN and RPG_TEAM exist with the antiCavalry + antiArmor flags', () => {
        expect(UNIT_TYPE.ANTI_TANK_GUN).toBeDefined();
        expect(UNIT_TYPE.ANTI_TANK_GUN.antiCavalry).toBe(true);
        expect(UNIT_TYPE.ANTI_TANK_GUN.antiArmor).toBe(true);
        expect(UNIT_TYPE.RPG_TEAM).toBeDefined();
        expect(UNIT_TYPE.RPG_TEAM.antiCavalry).toBe(true);
        expect(UNIT_TYPE.RPG_TEAM.antiArmor).toBe(true);
        // RPG team has AOE splash (shaped-charge spray).
        expect(UNIT_TYPE.RPG_TEAM.aoe).toBe(true);
    });

    it('RPG_TEAM is the strongest anti-armor unit (more attack than ANTI_TANK_GUN)', () => {
        expect(UNIT_TYPE.RPG_TEAM.attack).toBeGreaterThan(UNIT_TYPE.ANTI_TANK_GUN.attack);
    });

    it('ANTI_TANK_GUN and RPG_TEAM are in EXTRA_UNITS and have costs', async () => {
        const { EXTRA_UNITS, UNIT_COST } = await import('../src/config.js');
        expect(EXTRA_UNITS).toContain('ANTI_TANK_GUN');
        expect(EXTRA_UNITS).toContain('RPG_TEAM');
        expect(UNIT_COST.ANTI_TANK_GUN).toBeDefined();
        expect(UNIT_COST.RPG_TEAM).toBeDefined();
        expect(UNIT_COST.RPG_TEAM.gold).toBeGreaterThan(UNIT_COST.ANTI_TANK_GUN.gold);
    });

    it('ROCKETRY tech unlocks RPG_TEAM and requires ANTI_ARMOR + EXPLOSIVES', async () => {
        const { TECHS } = await import('../src/tech.js');
        expect(TECHS.ROCKETRY).toBeDefined();
        expect(TECHS.ROCKETRY.unlocks.some(u => u.id === 'RPG_TEAM')).toBe(true);
        expect(TECHS.ROCKETRY.prerequisites).toContain('ANTI_ARMOR');
        expect(TECHS.ROCKETRY.prerequisites).toContain('EXPLOSIVES');
    });

    it('ANTI_ARMOR tech unlocks ANTI_TANK_GUN', async () => {
        const { TECHS } = await import('../src/tech.js');
        expect(TECHS.ANTI_ARMOR.unlocks.some(u => u.id === 'ANTI_TANK_GUN')).toBe(true);
    });

    it('RPG_TEAM has strong type advantages vs all armored units', async () => {
        const { TYPE_ADVANTAGE } = await import('../src/config.js');
        const adv = TYPE_ADVANTAGE.RPG_TEAM;
        expect(adv).toBeDefined();
        const targets = Array.isArray(adv.strongAgainst) ? adv.strongAgainst : [adv.strongAgainst];
        expect(targets).toContain('TANK');
        expect(targets).toContain('HEAVY_TANK');
        expect(targets).toContain('ARMORED_CAR');
        expect(adv.multiplier).toBeGreaterThan(1.5);
    });

    it('researching ROCKETRY obsoletes ANTI_TANK_GUN and BAYONET_RIFLE (RPG replaces them)', () => {
        const ts = createTechState();
        ts.researched.add('ROCKETRY');
        const roster = ['BAYONET_RIFLE', 'ANTI_TANK_GUN', 'RPG_TEAM'];
        const obsoleted = applyObsolescence(roster, ts.researched);
        expect(obsoleted).not.toContain('BAYONET_RIFLE');
        expect(obsoleted).not.toContain('ANTI_TANK_GUN');
        expect(obsoleted).toContain('RPG_TEAM');
    });
});

describe('combat engineer line (engineer upgrade)', () => {
    it('COMBAT_ENGINEER exists with canBuildBridge + canBuildStructure + demolish', () => {
        expect(UNIT_TYPE.COMBAT_ENGINEER).toBeDefined();
        expect(UNIT_TYPE.COMBAT_ENGINEER.canBuildBridge).toBe(true);
        expect(UNIT_TYPE.COMBAT_ENGINEER.canBuildStructure).toBe(true);
        expect(UNIT_TYPE.COMBAT_ENGINEER.demolish).toBe(true);
        expect(UNIT_TYPE.COMBAT_ENGINEER.mobilized).toBe(true);
    });

    it('DEMOLITION_SQUAD keeps engineer utility (canBuildBridge + canBuildStructure)', () => {
        expect(UNIT_TYPE.DEMOLITION_SQUAD.canBuildBridge).toBe(true);
        expect(UNIT_TYPE.DEMOLITION_SQUAD.canBuildStructure).toBe(true);
    });

    it('COMBAT_ENGINEER is faster than the basic ENGINEER', () => {
        expect(UNIT_TYPE.COMBAT_ENGINEER.moveRange).toBeGreaterThan(UNIT_TYPE.ENGINEER.moveRange);
    });

    it('INTERNAL_COMBUSTION obsoletes ENGINEER and DEMOLITION_SQUAD (COMBAT_ENGINEER replaces them)', () => {
        const ts = createTechState();
        ts.researched.add('INTERNAL_COMBUSTION');
        const roster = ['ENGINEER', 'DEMOLITION_SQUAD', 'COMBAT_ENGINEER'];
        const obsoleted = applyObsolescence(roster, ts.researched);
        expect(obsoleted).not.toContain('ENGINEER');
        expect(obsoleted).not.toContain('DEMOLITION_SQUAD');
        expect(obsoleted).toContain('COMBAT_ENGINEER');
    });
});

describe('modern engineer structures (mines / bunkers)', () => {
    it('STRUCTURE_TYPE defines MINEFIELD, BUNKER, and AT_MINE', async () => {
        const { STRUCTURE_TYPE } = await import('../src/config.js');
        expect(STRUCTURE_TYPE.MINEFIELD).toBeDefined();
        expect(STRUCTURE_TYPE.BUNKER).toBeDefined();
        expect(STRUCTURE_TYPE.AT_MINE).toBeDefined();
    });

    it('modern structures are tech-gated (techRequired set)', async () => {
        const { STRUCTURE_TYPE } = await import('../src/config.js');
        expect(STRUCTURE_TYPE.MINEFIELD.techRequired).toBe('EXPLOSIVES');
        expect(STRUCTURE_TYPE.BUNKER.techRequired).toBe('INTERNAL_COMBUSTION');
        expect(STRUCTURE_TYPE.AT_MINE.techRequired).toBe('ARMOR');
    });

    it('medieval structures have no techRequired (always available)', async () => {
        const { STRUCTURE_TYPE } = await import('../src/config.js');
        expect(STRUCTURE_TYPE.SPIKES.techRequired).toBeUndefined();
        expect(STRUCTURE_TYPE.FORTIFICATION.techRequired).toBeUndefined();
        expect(STRUCTURE_TYPE.FALL_TRAP.techRequired).toBeUndefined();
    });

    it('MINEFIELD damages all units (not just cavalry) and is one-shot', async () => {
        const { STRUCTURE_TYPE } = await import('../src/config.js');
        expect(STRUCTURE_TYPE.MINEFIELD.damage).toBeGreaterThan(0);
        // MINEFIELD has no damageVsCavalry-only field — it's a general damage.
        expect(STRUCTURE_TYPE.MINEFIELD.damageVsCavalry).toBeUndefined();
    });

    it('AT_MINE has a heavy damageVsArmor and a light infantry damage', async () => {
        const { STRUCTURE_TYPE } = await import('../src/config.js');
        expect(STRUCTURE_TYPE.AT_MINE.damageVsArmor).toBeGreaterThan(STRUCTURE_TYPE.AT_MINE.damage);
        expect(STRUCTURE_TYPE.AT_MINE.stun).toBe(true);
    });

    it('BUNKER grants a bigger defense bonus than FORTIFICATION + an hpBonus', async () => {
        const { STRUCTURE_TYPE } = await import('../src/config.js');
        expect(STRUCTURE_TYPE.BUNKER.defenseBonus).toBeGreaterThan(STRUCTURE_TYPE.FORTIFICATION.defenseBonus);
        expect(STRUCTURE_TYPE.BUNKER.hpBonus).toBeGreaterThan(0);
    });

    it('EXPLOSIVES tech unlocks the MINEFIELD structure', async () => {
        const { TECHS, getUnlockedStructures, createTechState } = await import('../src/tech.js');
        expect(TECHS.EXPLOSIVES.unlocks.some(u => u.type === 'structure' && u.id === 'MINEFIELD')).toBe(true);
        const ts = createTechState();
        ts.researched.add('EXPLOSIVES');
        expect(getUnlockedStructures(ts).has('MINEFIELD')).toBe(true);
    });

    it('INTERNAL_COMBUSTION unlocks the BUNKER structure', async () => {
        const { TECHS, getUnlockedStructures, createTechState } = await import('../src/tech.js');
        expect(TECHS.INTERNAL_COMBUSTION.unlocks.some(u => u.type === 'structure' && u.id === 'BUNKER')).toBe(true);
        const ts = createTechState();
        ts.researched.add('INTERNAL_COMBUSTION');
        expect(getUnlockedStructures(ts).has('BUNKER')).toBe(true);
    });

    it('ARMOR unlocks the AT_MINE structure', async () => {
        const { TECHS, getUnlockedStructures, createTechState } = await import('../src/tech.js');
        expect(TECHS.ARMOR.unlocks.some(u => u.type === 'structure' && u.id === 'AT_MINE')).toBe(true);
        const ts = createTechState();
        ts.researched.add('ARMOR');
        expect(getUnlockedStructures(ts).has('AT_MINE')).toBe(true);
    });

    it('modern structures have STRUCTURE_COST entries', async () => {
        const { STRUCTURE_COST } = await import('../src/config.js');
        expect(STRUCTURE_COST.MINEFIELD).toBeDefined();
        expect(STRUCTURE_COST.BUNKER).toBeDefined();
        expect(STRUCTURE_COST.AT_MINE).toBeDefined();
        expect(STRUCTURE_COST.BUNKER.gold).toBeGreaterThan(STRUCTURE_COST.FORTIFICATION.gold);
    });
});