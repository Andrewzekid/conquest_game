/** Event log (Feature 6): a rolling, capped record of noteworthy game events.
 *  Pure functions over a plain array — no game-state side effects beyond the
 *  array passed in. Each entry: { turn, category, message }. The log is capped
 *  at EVENT_LOG_MAX entries; the oldest drop off.
 */
import { EVENT_LOG_MAX, EVENT_CATEGORIES } from './config.js';

/** Append an event to the log (mutates the array in place, capping its size).
 *  Unknown categories are coerced to 'system'. Returns the entry that was
 *  added (or null if the message was empty). */
export function addEvent(eventLog, category, message, turn = 0) {
    if (!Array.isArray(eventLog)) return null;
    if (message == null || message === '') return null;
    const cat = EVENT_CATEGORIES.includes(category) ? category : 'system';
    const entry = { turn: turn || 0, category: cat, message: String(message), ts: eventLog.length };
    eventLog.push(entry);
    if (eventLog.length > EVENT_LOG_MAX) {
        eventLog.splice(0, eventLog.length - EVENT_LOG_MAX);
    }
    return entry;
}

/** Return only entries matching one of the given categories (or all if none
 *  given). Returns a new array; does not mutate the log. */
export function filterEvents(eventLog, categories = []) {
    if (!Array.isArray(eventLog)) return [];
    if (!categories || !categories.length) return eventLog.slice();
    const want = new Set(categories);
    return eventLog.filter(e => want.has(e.category));
}

/** The most recent N events (newest last, as stored). */
export function recentEvents(eventLog, n = 10) {
    if (!Array.isArray(eventLog)) return [];
    return eventLog.slice(-Math.max(0, n | 0));
}