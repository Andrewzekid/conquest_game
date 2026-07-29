import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { LORD_SKILL_TREES } from '../src/config.js';
import { createLord, awardXP, getAvailableSkills, investSkillPoint, getSkillEffects }
  from '../src/lords.js';

const here = dirname(fileURLToPath(import.meta.url));

describe('Lord Skill Trees — data structure', () => {
  it('defines trees for all 4 classes with 2 branches of 5 skills each', () => {
    for (const cls of ['WARLORD', 'GUARDIAN', 'CONQUEROR', 'GRAND_COMMANDER']) {
      const tree = LORD_SKILL_TREES[cls];
      expect(tree, `${cls} tree missing`).toBeDefined();
      const branches = Object.keys(tree.branches);
      expect(branches.length).toBe(2);
      for (const b of branches) {
        expect(tree.branches[b].skills.length).toBe(5);
        for (const s of tree.branches[b].skills) {
          expect(s.id).toBeTruthy();
          expect(s.tier).toBeGreaterThanOrEqual(1);
          expect(Array.isArray(s.prereqs)).toBe(true);
          expect(s.effect).toBeDefined();
        }
      }
    }
  });

  it('tier-1 skills have no prereqs; tier-2 require two tier-1; tier-3 require two tier-2', () => {
    for (const tree of Object.values(LORD_SKILL_TREES)) {
      for (const branch of Object.values(tree.branches)) {
        const t1 = branch.skills.filter(s => s.tier === 1);
        const t2 = branch.skills.filter(s => s.tier === 2);
        const t3 = branch.skills.filter(s => s.tier === 3);
        expect(t1.length).toBe(2);
        expect(t2.length).toBe(2);
        expect(t3.length).toBe(1);
        for (const s of t1) expect(s.prereqs.length).toBe(0);
        for (const s of t2) expect(s.prereqs.length).toBe(2);
        for (const s of t3) expect(s.prereqs.length).toBe(2);
      }
    }
  });
});

describe('Lord Skill Trees — getAvailableSkills', () => {
  it('a fresh lord sees only the 4 tier-1 skills (2 per branch)', () => {
    const lord = createLord('player', 0, 0, 'Test', 'WARLORD');
    const avail = getAvailableSkills(lord);
    expect(avail.length).toBe(4);
    expect(avail.every(s => s.tier === 1)).toBe(true);
  });

  it('learning one tier-1 skill removes it from available', () => {
    const lord = createLord('player', 0, 0, 'Test', 'WARLORD');
    lord.skillPoints = 5;
    investSkillPoint(lord, 'blade_master');
    const avail = getAvailableSkills(lord);
    expect(avail.find(s => s.id === 'blade_master')).toBeUndefined();
  });

  it('a tier-2 skill becomes available only when both its tier-1 prereqs are learned', () => {
    const lord = createLord('player', 0, 0, 'Test', 'WARLORD');
    lord.skills = ['blade_master']; // only one of two prereqs
    let avail = getAvailableSkills(lord);
    expect(avail.find(s => s.id === 'critical_strike')).toBeUndefined();
    lord.skills.push('toughness'); // both prereqs now
    avail = getAvailableSkills(lord);
    expect(avail.find(s => s.id === 'critical_strike')).toBeDefined();
  });

  it('a tier-3 skill unlocks once both tier-2 prereqs are learned', () => {
    const lord = createLord('player', 0, 0, 'Test', 'WARLORD');
    lord.skills = ['blade_master', 'toughness', 'critical_strike', 'lifesteal'];
    const avail = getAvailableSkills(lord);
    expect(avail.find(s => s.id === 'berserker_fury')).toBeDefined();
  });

  it('returns [] for an unknown class', () => {
    const lord = { class: 'NOPE', skills: [] };
    expect(getAvailableSkills(lord)).toEqual([]);
  });
});

describe('Lord Skill Trees — investSkillPoint', () => {
  it('spends a point and records the skill', () => {
    const lord = createLord('player', 0, 0, 'Test', 'WARLORD');
    lord.skillPoints = 1;
    const r = investSkillPoint(lord, 'blade_master');
    expect(r.success).toBe(true);
    expect(lord.skillPoints).toBe(0);
    expect(lord.skills).toContain('blade_master');
  });

  it('refuses when no skill points remain', () => {
    const lord = createLord('player', 0, 0, 'Test', 'WARLORD');
    lord.skillPoints = 0;
    const r = investSkillPoint(lord, 'blade_master');
    expect(r.success).toBe(false);
    expect(lord.skills).not.toContain('blade_master');
  });

  it('refuses a skill whose prerequisites are unmet', () => {
    const lord = createLord('player', 0, 0, 'Test', 'WARLORD');
    lord.skillPoints = 1;
    const r = investSkillPoint(lord, 'critical_strike'); // needs blade_master + toughness
    expect(r.success).toBe(false);
  });

  it('applies immediate HP from the Toughness skill', () => {
    const lord = createLord('player', 0, 0, 'Test', 'WARLORD');
    lord.skillPoints = 1;
    const beforeHp = lord.maxHp;
    investSkillPoint(lord, 'toughness'); // effect.hp = 3
    expect(lord.maxHp).toBe(beforeHp + 3);
    expect(lord.hp).toBe(beforeHp + 3);
  });

  it('applies immediate command capacity from Army Commander', () => {
    const lord = createLord('player', 0, 0, 'Test', 'WARLORD');
    lord.skills = ['rally_cry', 'inspire'];
    lord.skillPoints = 1;
    const beforeCmd = lord.stats.command;
    investSkillPoint(lord, 'army_commander'); // commandBonus: 2
    expect(lord.stats.command).toBe(beforeCmd + 2);
  });
});

describe('Lord Skill Trees — getSkillEffects', () => {
  it('returns zeroed effects for a lord with no skills', () => {
    const lord = createLord('player', 0, 0, 'Test', 'WARLORD');
    const e = getSkillEffects(lord);
    expect(e.attack).toBe(0);
    expect(e.defense).toBe(0);
    expect(e.siegeBonus).toBe(0);
  });

  it('sums numeric effects across learned skills', () => {
    const lord = createLord('player', 0, 0, 'Test', 'CONQUEROR');
    lord.skills = ['siege_expert', 'siege_master']; // siegeBonus 2 + 3 = 5
    const e = getSkillEffects(lord);
    expect(e.siegeBonus).toBe(5);
  });

  it('flattens nested allUnitsBonus {attack, defense}', () => {
    const lord = createLord('player', 0, 0, 'Test', 'GRAND_COMMANDER');
    lord.skills = ['extended_command', 'tactical_mind', 'master_strategist', 'field_marshal', 'supreme_commander'];
    const e = getSkillEffects(lord);
    // supreme_commander: allUnitsBonus {attack:1, defense:1}
    expect(e.attack).toBe(1);
    expect(e.defense).toBe(1);
  });

  it('ORs boolean effects (surviveLethal)', () => {
    const lord = createLord('player', 0, 0, 'Test', 'GUARDIAN');
    lord.skills = ['iron_skin', 'fortify', 'unbreakable'];
    const e = getSkillEffects(lord);
    expect(e.surviveLethal).toBe(true);
  });
});

describe('Lord Skill Trees — awardXP grants skill points', () => {
  it('a lord gains a skill point on each level-up', () => {
    const lord = createLord('player', 0, 0, 'Test', 'WARLORD');
    const startLevel = lord.level;
    const startPoints = lord.skillPoints || 0;
    // Push enough XP to gain at least one level.
    awardXP(lord, 1000);
    expect(lord.level).toBeGreaterThan(startLevel);
    expect(lord.skillPoints).toBeGreaterThan(startPoints);
  });
});

describe('Lord Skill Trees — handler wiring (source-invariant)', () => {
  it('game.js exposes handleSkillInvestment and the onSkillInvestment callback', () => {
    const src = readFileSync(join(here, '..', 'src', 'game.js'), 'utf8');
    expect(src).toMatch(/handleSkillInvestment/);
    expect(src).toMatch(/onSkillInvestment/);
  });

  it('ui.js renders .skill-invest-btn buttons and wires them', () => {
    const src = readFileSync(join(here, '..', 'src', 'ui.js'), 'utf8');
    expect(src).toMatch(/skill-invest-btn/);
    expect(src).toMatch(/onSkillInvestment/);
  });
});