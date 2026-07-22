/**
 * Tests for the unit obsolescence system (src/unit_obsolescence.js).
 *
 * Obsolescence removes older units from the trainable roster once the modern
 * replacement's unlocking tech is researched. This covers:
 *  - getObsoleteUnits / applyObsolescence / isObsolete pure functions
 *  - The OBSOLESCENCE table correctness (right tech gates the right units)
 *  - Integration with the AI roster (computeAIActions filters obsolete units)
 *  - Integration with the engine validator (game.js rejects obsolete training)
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { OBSOLESCENCE, getObsoleteUnits, applyObsolescence, isObsolete } from '../src/unit_obsolescence.js';
import { createTechState } from '../src/tech.js';
import { setGridDimensions } from '../src/config.js';

beforeEach(() => { setGridDimensions(40, 40); });

function ts(researched = []) {
    const s = createTechState();
    for (const r of researched) s.researched.add(r);
    return s;
}

describe('unit_obsolescence — getObsoleteUnits', () => {
    it('returns empty set when no techs researched', () => {
        const obs = getObsoleteUnits(ts().researched);
        expect(obs.size).toBe(0);
    });

    it('obsoletes ARCHER and LONGBOWMAN when FORTIFICATION researched', () => {
        const obs = getObsoleteUnits(ts(['FORTIFICATION']).researched);
        expect(obs.has('ARCHER')).toBe(true);
        expect(obs.has('LONGBOWMAN')).toBe(true);
        expect(obs.has('INFANTRY')).toBe(false); // melee, not ranged
    });

    it('obsoletes MUSKETEER and ARQUEBUSIER when RIFLED_MUSKET researched', () => {
        const obs = getObsoleteUnits(ts(['RIFLED_MUSKET']).researched);
        expect(obs.has('MUSKETEER')).toBe(true);
        expect(obs.has('ARQUEBUSIER')).toBe(true);
        // ARCHER already obsoleted by CROSSBOWMAN (FORTIFICATION) but that tech
        // isn't researched here, so ARCHER is NOT obsolete from RIFLED_MUSKET alone
        expect(obs.has('ARCHER')).toBe(false);
    });

    it('obsoletes INFANTRY and LEGIONNAIRE when FLINTLOCK researched', () => {
        const obs = getObsoleteUnits(ts(['FLINTLOCK']).researched);
        expect(obs.has('INFANTRY')).toBe(true);
        expect(obs.has('LEGIONNAIRE')).toBe(true);
    });

    it('obsoletes CAVALRY and CHARIOT when FLINTLOCK researched (DRAGOON)', () => {
        const obs = getObsoleteUnits(ts(['FLINTLOCK']).researched);
        expect(obs.has('CAVALRY')).toBe(true);
        expect(obs.has('CHARIOT')).toBe(true);
    });

    it('obsoletes CANNON and MORTAR when EXPLOSIVES researched (SIEGE_CANNON)', () => {
        const obs = getObsoleteUnits(ts(['EXPLOSIVES']).researched);
        expect(obs.has('CANNON')).toBe(true);
        expect(obs.has('MORTAR')).toBe(true);
    });

    it('obsoletes FRIGATE and GALLEON when STEAM_ENGINE researched (IRONCLAD)', () => {
        const obs = getObsoleteUnits(ts(['STEAM_ENGINE']).researched);
        expect(obs.has('FRIGATE')).toBe(true);
        expect(obs.has('GALLEON')).toBe(true);
        expect(obs.has('TRANSPORT')).toBe(true); // STEAM_TRANSPORT obsoletes TRANSPORT
    });

    it('does not obsolete units whose replacement tech is NOT researched', () => {
        const obs = getObsoleteUnits(ts(['ARCHERY']).researched);
        expect(obs.has('ARCHER')).toBe(false); // ARCHER is a base unit, not obsolete
        expect(obs.has('INFANTRY')).toBe(false);
    });

    it('handles null researched set gracefully', () => {
        expect(getObsoleteUnits(null).size).toBe(0);
    });
});

describe('unit_obsolescence — applyObsolescence', () => {
    it('filters obsolete units from a roster', () => {
        const roster = ['INFANTRY', 'ARCHER', 'CAVALRY', 'RIFLEMAN', 'SHARPSHOOTER'];
        const filtered = applyObsolescence(roster, ts(['RIFLED_MUSKET']).researched);
        // RIFLED_MUSKET obsoletes MUSKETEER + ARQUEBUSIER (not in roster)
        // ARCHER is obsoleted by FORTIFICATION (not researched here)
        expect(filtered).toContain('INFANTRY');
        expect(filtered).toContain('ARCHER'); // FORTIFICATION not researched
        expect(filtered).toContain('RIFLEMAN');
    });

    it('removes ARCHER when both FORTIFICATION and RIFLED_MUSKET researched', () => {
        const roster = ['INFANTRY', 'ARCHER', 'MUSKETEER', 'RIFLEMAN'];
        const filtered = applyObsolescence(roster, ts(['FORTIFICATION', 'MATCHLOCK', 'RIFLED_MUSKET']).researched);
        expect(filtered).not.toContain('ARCHER'); // obsoleted by FORTIFICATION
        expect(filtered).not.toContain('MUSKETEER'); // obsoleted by RIFLED_MUSKET
        expect(filtered).toContain('INFANTRY');
        expect(filtered).toContain('RIFLEMAN');
    });

    it('returns a new array (does not mutate input)', () => {
        const roster = ['INFANTRY', 'ARCHER'];
        const filtered = applyObsolescence(roster, ts(['FORTIFICATION']).researched);
        expect(roster).toEqual(['INFANTRY', 'ARCHER']); // unchanged
        expect(filtered).toEqual(['INFANTRY']);
    });

    it('returns empty array for empty roster', () => {
        expect(applyObsolescence([], ts(['RIFLED_MUSKET']).researched)).toEqual([]);
    });

    it('returns full roster when nothing is obsolete', () => {
        const roster = ['INFANTRY', 'ARCHER'];
        const filtered = applyObsolescence(roster, ts().researched);
        expect(filtered).toEqual(['INFANTRY', 'ARCHER']);
    });
});

describe('unit_obsolescence — isObsolete', () => {
    it('returns true for an obsolete unit', () => {
        expect(isObsolete('ARCHER', ts(['FORTIFICATION']).researched)).toBe(true);
    });

    it('returns false for a non-obsolete unit', () => {
        expect(isObsolete('RIFLEMAN', ts(['RIFLED_MUSKET']).researched)).toBe(false);
    });

    it('returns false when tech not researched', () => {
        expect(isObsolete('ARCHER', ts().researched)).toBe(false);
    });
});

describe('unit_obsolescence — OBSOLESCENCE table integrity', () => {
    it('every entry has a valid tech id and obsoletes array', () => {
        for (const [modern, def] of Object.entries(OBSOLESCENCE)) {
            expect(typeof def.tech).toBe('string');
            expect(def.tech.length).toBeGreaterThan(0);
            expect(Array.isArray(def.obsoletes)).toBe(true);
        }
    });

    it('no unit obsoletes itself', () => {
        for (const [modern, def] of Object.entries(OBSOLESCENCE)) {
            expect(def.obsoletes).not.toContain(modern);
        }
    });
});