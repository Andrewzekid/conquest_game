import { describe, it, expect } from 'vitest';
import { addEvent, filterEvents, recentEvents } from '../src/eventlog.js';
import { EVENT_LOG_MAX, EVENT_CATEGORIES } from '../src/config.js';

describe('Event Log (Feature 6)', () => {
  it('appends an entry with turn/category/message', () => {
    const log = [];
    const e = addEvent(log, 'combat', 'Crimson attacked Verdant', 5);
    expect(e).toMatchObject({ turn: 5, category: 'combat', message: 'Crimson attacked Verdant' });
    expect(log.length).toBe(1);
  });

  it('coerces unknown categories to "system"', () => {
    const log = [];
    addEvent(log, 'nonsense', 'x');
    expect(log[0].category).toBe('system');
  });

  it('ignores empty messages', () => {
    const log = [];
    addEvent(log, 'combat', '');
    addEvent(log, 'combat', null);
    expect(log.length).toBe(0);
  });

  it('caps the log at EVENT_LOG_MAX, dropping oldest', () => {
    const log = [];
    for (let i = 0; i < EVENT_LOG_MAX + 20; i++) addEvent(log, 'system', `e${i}`, i);
    expect(log.length).toBe(EVENT_LOG_MAX);
    // Oldest dropped: first kept entry should be e20 (we added 100, cap 80).
    expect(log[0].message).toBe(`e${20}`);
    expect(log[log.length - 1].message).toBe(`e${EVENT_LOG_MAX + 19}`);
  });

  it('filterEvents returns only matching categories', () => {
    const log = [];
    addEvent(log, 'combat', 'a');
    addEvent(log, 'diplomacy', 'b');
    addEvent(log, 'combat', 'c');
    const combats = filterEvents(log, ['combat']);
    expect(combats.length).toBe(2);
    expect(combats.every(e => e.category === 'combat')).toBe(true);
  });

  it('filterEvents with no categories returns all', () => {
    const log = [];
    addEvent(log, 'combat', 'a');
    addEvent(log, 'diplomacy', 'b');
    expect(filterEvents(log).length).toBe(2);
  });

  it('recentEvents returns the last N', () => {
    const log = [];
    for (let i = 0; i < 5; i++) addEvent(log, 'system', `e${i}`);
    const r = recentEvents(log, 2);
    expect(r.length).toBe(2);
    expect(r[1].message).toBe('e4');
  });

  it('EVENT_CATEGORIES includes the expected keys', () => {
    expect(EVENT_CATEGORIES).toContain('combat');
    expect(EVENT_CATEGORIES).toContain('diplomacy');
    expect(EVENT_CATEGORIES).toContain('spy');
  });
});