/** BFS pathfinding for unit auto-navigation. No terrain is impassable, but tiles
 *  occupied by other units are avoided. Returns the next step {x,z} toward the
 *  goal, or null if already there / unreachable. */

import { UNIT_TYPE } from './config.js';

function key(x, z) { return `${x},${z}`; }
function isNaval(unit) { return !!(unit && UNIT_TYPE[unit.type] && UNIT_TYPE[unit.type].naval); }

/**
 * @param tiles - Map<key, tile>
 * @param units - Map<id, unit>
 * @param unit - the moving unit
 * @param goal - {x,z}
 * @param maxRange - max steps to search (safety cap)
 * @returns {x,z} next step, or null
 */
export function nextStepToward(tiles, units, unit, goal, maxRange = 200, owner = null) {
    if (!goal) return null;
    if (unit.x === goal.x && unit.z === goal.z) return null;

    // Build blocked set (other units' tiles). If `owner` is given (e.g. a lord
    // navigating), own-faction units do NOT block — a lord shares tiles with its
    // army. Enemy units and other lords still block. Allow the goal tile even if
    // a unit is there — we stop adjacent to an unreachable goal.
    const blocked = new Set();
    if (units) {
        for (const u of units.values()) {
            if (u.id === unit.id) continue;
            if (owner && u.owner === owner) continue; // own units don't block lords
            blocked.add(key(u.x, u.z));
        }
    }

    const start = key(unit.x, unit.z);
    const goalKey = key(goal.x, goal.z);
    const prev = new Map();
    const visited = new Set([start]);
    // Use a head index instead of queue.shift() (which is O(n) and makes BFS
    // O(n²)). With a head pointer, dequeue is O(1) and BFS is O(n).
    const queue = [[unit.x, unit.z]];
    let head = 0;
    const dirs = [[0,1],[0,-1],[1,0],[-1,0]];
    let found = false;
    let steps = 0;
    const maxSteps = maxRange * maxRange;

    while (head < queue.length && steps++ < maxSteps) {
        const [cx, cz] = queue[head++];
        if (cx === goal.x && cz === goal.z) { found = true; break; }
        for (const [dx, dz] of dirs) {
            const nx = cx + dx, nz = cz + dz;
            const k = key(nx, nz);
            if (visited.has(k)) continue;
            if (!tiles.has(k)) continue;
            // Terrain passability — except the goal tile itself (we stop
            // adjacent to an unreachable goal). Naval units sail on water and
            // rivers; land units need solid ground (rivers need a bridge).
            const t = tiles.get(k);
            if (k !== goalKey) {
                if (isNaval(unit)) {
                    if (t.terrain !== 'WATER' && t.terrain !== 'RIVER') { visited.add(k); continue; }
                } else {
                    if (t.terrain === 'WATER' || (t.terrain === 'RIVER' && !t.bridge)) { visited.add(k); continue; }
                }
            }
            // Don't path through occupied tiles (except the goal tile itself).
            if (blocked.has(k) && k !== goalKey) { visited.add(k); continue; }
            visited.add(k);
            prev.set(k, key(cx, cz));
            queue.push([nx, nz]);
        }
    }

    if (!found) {
        // If the exact goal is blocked/unreachable, aim for the nearest visited
        // tile adjacent to the goal.
        let best = null, bestDist = Infinity;
        for (const k of visited) {
            const [x, z] = k.split(',').map(Number);
            const d = Math.abs(x - goal.x) + Math.abs(z - goal.z);
            if (d < bestDist && !(x === unit.x && z === unit.z)) { bestDist = d; best = { x, z }; }
        }
        if (best) return best;
        return null;
    }

    // Walk back from goal to the first step after start.
    let cur = goalKey;
    let firstStep = null;
    while (cur && cur !== start) {
        firstStep = cur;
        cur = prev.get(cur);
    }
    if (!firstStep) return null;
    const [fx, fz] = firstStep.split(',').map(Number);
    return { x: fx, z: fz };
}

/** Is a goal still valid/reachable in principle? */
export function goalValid(tiles, unit, goal) {
    if (!goal) return false;
    return tiles.has(key(goal.x, goal.z));
}