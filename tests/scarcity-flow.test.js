import { describe, it, expect } from 'vitest';
import { computeScarcity, resourceNeedWeights } from '../src/ai.js';
import { FACTION_DEFS } from '../src/faction.js';
import { SCARCITY_FLOW_THRESHOLDS } from '../src/config.js';

describe('Flow-aware scarcity — computeScarcity', () => {
  it('counts stock-short resources when there is no previous snapshot', () => {
    const r = computeScarcity({ gold: 10, wood: 10, iron: 10, food: 10 }, null, SCARCITY_FLOW_THRESHOLDS);
    expect(r.stockScarce).toBe(4);
    expect(r.flowScarce).toBe(0); // no prev → no flow
    expect(r.scarce).toBe(4);
    expect(r.drainingResource).toBeNull();
  });

  it('returns zero scarcity for a healthy stock with no drain', () => {
    const r = computeScarcity({ gold: 500, wood: 400, iron: 300, food: 400 },
      { gold: 500, wood: 400, iron: 300, food: 400 }, SCARCITY_FLOW_THRESHOLDS);
    expect(r.scarce).toBe(0);
    expect(r.drainingResource).toBeNull();
  });

  it('flags a fast-draining resource as flow-scarce even with a healthy stock', () => {
    // Food drops 30 in one turn (threshold is -8). Stock is still fine (400).
    const r = computeScarcity({ gold: 500, wood: 400, iron: 300, food: 400 },
      { gold: 500, wood: 400, iron: 300, food: 430 }, SCARCITY_FLOW_THRESHOLDS);
    expect(r.flow.food).toBe(-30);
    expect(r.flowScarce).toBe(1);
    expect(r.scarce).toBe(1); // stock fine, but the drain counts
    expect(r.drainingResource).toBe('food');
  });

  it('picks the worst-draining resource when several drain at once', () => {
    // Food -30, wood -20, iron -2 (not past -5 threshold), gold steady.
    const r = computeScarcity({ gold: 500, wood: 380, iron: 298, food: 400 },
      { gold: 500, wood: 400, iron: 300, food: 430 }, SCARCITY_FLOW_THRESHOLDS);
    expect(r.flowScarce).toBe(2); // food + wood
    expect(r.drainingResource).toBe('food'); // most negative
  });

  it('caps combined scarcity at 4', () => {
    const r = computeScarcity({ gold: 10, wood: 10, iron: 10, food: 10 },
      { gold: 100, wood: 100, iron: 100, food: 100 }, SCARCITY_FLOW_THRESHOLDS);
    // stockScarce=4, flowScarce=4 → capped at 4.
    expect(r.scarce).toBe(4);
  });

  it('a small drain below the threshold does NOT count as flow-scarce', () => {
    // Food drops 3 (threshold -8): not a fast drain.
    const r = computeScarcity({ gold: 500, wood: 400, iron: 300, food: 397 },
      { gold: 500, wood: 400, iron: 300, food: 400 }, SCARCITY_FLOW_THRESHOLDS);
    expect(r.flowScarce).toBe(0);
    expect(r.drainingResource).toBeNull();
  });

  it('flow is exactly the per-resource delta vs prev', () => {
    const r = computeScarcity({ gold: 90, wood: 50, iron: 40, food: 60 },
      { gold: 100, wood: 60, iron: 30, food: 50 }, SCARCITY_FLOW_THRESHOLDS);
    expect(r.flow).toEqual({ gold: -10, wood: -10, iron: 10, food: 10 });
  });
});

describe('Flow-aware scarcity — resourceNeedWeights biases toward the drain', () => {
  const def = FACTION_DEFS.golden;

  it('without a drain, food terrain has the baseline weight', () => {
    const w0 = resourceNeedWeights(def, { food: 200 }, null);
    const wFood = resourceNeedWeights(def, { food: 200 }, 'food');
    // Draining food should raise PLAINS/RIVER weights above the no-drain case.
    expect(wFood.PLAINS).toBeGreaterThan(w0.PLAINS);
    expect(wFood.RIVER).toBeGreaterThan(w0.RIVER);
  });

  it('a wood drain raises FOREST weight', () => {
    const w0 = resourceNeedWeights(def, { wood: 200 }, null);
    const wWood = resourceNeedWeights(def, { wood: 200 }, 'wood');
    expect(wWood.FOREST).toBeGreaterThan(w0.FOREST);
  });

  it('an iron drain raises MOUNTAIN/HILLS weight', () => {
    const w0 = resourceNeedWeights(def, { iron: 200 }, null);
    const wIron = resourceNeedWeights(def, { iron: 200 }, 'iron');
    expect(wIron.MOUNTAIN).toBeGreaterThan(w0.MOUNTAIN);
    expect(wIron.HILLS).toBeGreaterThan(w0.HILLS);
  });

  it('a gold drain raises DESERT/MOUNTAIN weight', () => {
    const w0 = resourceNeedWeights(def, { gold: 500 }, null);
    const wGold = resourceNeedWeights(def, { gold: 500 }, 'gold');
    expect(wGold.DESERT).toBeGreaterThan(w0.DESERT);
  });

  it('a null drain leaves weights unchanged vs no drain', () => {
    expect(resourceNeedWeights(def, { food: 200 }, null))
      .toEqual(resourceNeedWeights(def, { food: 200 }));
  });
});

describe('Flow-aware scarcity — config + aiState wiring', () => {
  it('SCARCITY_FLOW_THRESHOLDS covers gold/food/wood/iron with negative floors', () => {
    for (const r of ['gold', 'food', 'wood', 'iron']) {
      expect(SCARCITY_FLOW_THRESHOLDS[r]).toBeLessThan(0);
    }
  });
});