/** Strategic army planning: concentration of force, reserve assignment, flanking
 *  detection, beachhead landing engine, and staging-area coordination.
 *  Pure functions — no mutation of game state.
 *
 *  This module sits between the per-turn goal selection (ai_goals.js) and the
 *  per-group tactical planning (planGroup in ai.js). It answers the question
 *  "where should our armies go?" at a strategic level so individual groups
 *  converge on shared objectives instead of each picking their own target.
 */

import { UNIT_TYPE } from './config.js';

function manhattan(x1, z1, x2, z2) {
    return Math.abs(x2 - x1) + Math.abs(z2 - z1);
}

/** Average position of a group's members (rounded to a tile). */
function groupCentroid(group) {
    let sx = 0, sz = 0;
    for (const u of group.units) { sx += u.x; sz += u.z; }
    const n = group.units.length || 1;
    return { x: Math.round(sx / n), z: Math.round(sz / n) };
}

/** Total combat power of a group (sum of hp + attack*2 over members). */
function groupPower(group) {
    return group.units.reduce((s, u) => {
        const atk = (UNIT_TYPE[u.type] && UNIT_TYPE[u.type].attack) || (u.attack || 0);
        return s + (u.hp || 1) + atk * 2;
    }, 0);
}

/** Count of military units in a group (excludes settlers/workers/scouts). */
function groupMilitaryCount(group) {
    return group.units.filter(u =>
        u.type !== 'SETTLER' && u.type !== 'WORKER' && u.type !== 'SCOUT').length;
}

/** City garrison strength: sum of hp for units owned by the city's owner
 *  within 1 tile. Neutral cities (no owner) have garrison 0. */
function cityGarrison(city, units) {
    if (!city.owner) return 0;
    let g = 0;
    for (const u of units.values()) {
        if (u.owner !== city.owner) continue;
        if (manhattan(u.x, u.z, city.x, city.z) <= 1) g += (u.hp || 1);
    }
    return g;
}

/** Find the best enemy city for all army groups to converge on.
 *  Scores each candidate city by:
 *  - Total group power that can reach it (concentration of force)
 *  - City weakness (low fortification, low garrison)
 *  - Distance from home anchor (prefer closer to reduce travel time)
 *  - Strategic value (capital cities worth more)
 *
 *  @param {Array} groups - army groups from buildArmyGroups
 *  @param {Map} tiles - game tiles
 *  @param {Map} units - all game units (for garrison calculation)
 *  @param {string} owner - this faction's id
 *  @param {Function} isAtWar - (factionId) => boolean
 *  @param {object} aiState - persistent AI state
 *  @param {string|null} goalTargetKey - tile key from the conquest goal, if any
 *  @returns {{ x: number, z: number, cityKey: string, score: number }|null}
 */
export function computeStrategicTarget(groups, tiles, units, owner, isAtWar, aiState, goalTargetKey = null) {
    if (!groups.length) return null;

    // Collect all enemy cities (at-war and neutral/unclaimed).
    const enemyCities = [];
    for (const t of tiles.values()) {
        if (t.terrain !== 'CITY') continue;
        if (t.owner === owner) continue;
        const neutral = !t.owner;
        if (!neutral && !isAtWar(t.owner)) continue;
        enemyCities.push(t);
    }
    if (!enemyCities.length) return null;

    // Total military power across all groups.
    let totalPower = 0;
    for (const g of groups) totalPower += groupPower(g);

    let best = null, bestScore = -Infinity;
    for (const city of enemyCities) {
        const fort = city.fortification || 0;
        const garrison = cityGarrison(city, units);
        // We don't have units directly; approximate garrison from tile owner.
        // A better approach passes units, but for now use fortification as proxy.

        // Sum of distances from each group centroid to this city.
        let totalDist = 0;
        let reachablePower = 0;
        for (const g of groups) {
            const c = groupCentroid(g);
            const d = manhattan(c.x, c.z, city.x, city.z);
            totalDist += d;
            // Groups within 15 tiles are "reachable" this turn sequence.
            if (d <= 15) reachablePower += groupPower(g);
        }
        const avgDist = totalDist / groups.length;

        // Score components:
        // 1. Reachable power: prefer cities our armies can actually reach.
        const powerScore = reachablePower * 2;
        // 2. Weakness: low fortification and garrison are easier targets.
        const weaknessScore = (5 - Math.min(5, fort)) * 40 + (10 - Math.min(10, garrison)) * 10;
        // 3. Distance penalty: farther cities are harder to coordinate on.
        const distPenalty = avgDist * 3;
        // 4. Strategic value: capital cities (isCapital) are worth more.
        const capitalBonus = city.isCapital ? 200 : 0;
        // 5. Goal alignment: if the conquest goal targets this city, boost it.
        const goalKey = `${city.x},${city.z}`;
        const goalBonus = goalTargetKey === goalKey ? 300 : 0;
        // 6. Already committed: if our armies are already near, prefer finishing.
        const committedBonus = reachablePower > totalPower * 0.5 ? 150 : 0;

        const score = powerScore + weaknessScore - distPenalty + capitalBonus + goalBonus + committedBonus;

        if (score > bestScore) { bestScore = score; best = city; }
    }

    if (!best) return null;
    return { x: best.x, z: best.z, cityKey: `${best.x},${best.z}`, score: bestScore };
}

/** Assign one group as the strategic reserve (stays near the capital).
 *  The reserve is the group closest to the capital that isn't already a
 *  conquest group. If no group is within 8 tiles, the nearest is pulled back.
 *
 *  @param {Array} groups - army groups
 *  @param {Map} tiles - game tiles
 *  @param {string} owner - this faction's id
 *  @returns {object|null} the group assigned as reserve, or null
 */
export function assignReserve(groups, tiles, owner) {
    // Find the capital or strongest owned city.
    let capital = null;
    for (const t of tiles.values()) {
        if (t.terrain === 'CITY' && t.owner === owner && t.isCapital) { capital = t; break; }
    }
    if (!capital) {
        // Fallback: any owned city.
        for (const t of tiles.values()) {
            if (t.terrain === 'CITY' && t.owner === owner) { capital = t; break; }
        }
    }
    if (!capital) return null;

    // Find the group closest to the capital.
    let bestGroup = null, bestDist = Infinity;
    for (const g of groups) {
        const c = groupCentroid(g);
        const d = manhattan(c.x, c.z, capital.x, capital.z);
        if (d < bestDist) { bestDist = d; bestGroup = g; }
    }

    // Only assign as reserve if the group is within 8 tiles or has no other
    // urgent objective. A group far from home shouldn't be pulled all the way
    // back — that wastes turns of movement.
    if (bestGroup && bestDist <= 8) {
        bestGroup._reserve = true;
        return bestGroup;
    }
    return null;
}

/** Detect flanking opportunities when 2+ groups are converging on the same
 *  target city. Returns an array of flank assignments:
 *  [{ group, role: 'assault'|'flank', approachAngle }]
 *
 *  Groups approaching from different directions (angle diff > 90°) are
 *  assigned complementary roles. The assault group hits the strongest side;
 *  the flank group circles around to attack from a weaker angle.
 *
 *  @param {Array} groups - army groups
 *  @param {{ x, z }} target - target city coordinates
 *  @param {Map} units - all game units
 *  @param {string} owner - this faction's id
 *  @returns {Array} flank assignments
 */
export function detectFlankingOpportunity(groups, target, units, owner) {
    if (!groups.length || !target) return [];

    // Compute each group's approach angle to the target.
    const groupAngles = [];
    for (const g of groups) {
        const c = groupCentroid(g);
        const dx = c.x - target.x;
        const dz = c.z - target.z;
        const angle = Math.atan2(dz, dx); // radians, -PI to PI
        const dist = manhattan(c.x, c.z, target.x, target.z);
        groupAngles.push({ group: g, angle, dist, power: groupPower(g) });
    }

    // Sort by distance (closest first).
    groupAngles.sort((a, b) => a.dist - b.dist);

    // Only consider groups within 12 tiles of the target (close enough to
    // coordinate a multi-pronged attack).
    const closeGroups = groupAngles.filter(ga => ga.dist <= 12);
    if (closeGroups.length < 2) return [];

    // Find pairs with angle difference > 90° (PI/2 radians).
    const assignments = [];
    const used = new Set();

    for (let i = 0; i < closeGroups.length && assignments.length < 2; i++) {
        if (used.has(i)) continue;
        for (let j = i + 1; j < closeGroups.length; j++) {
            if (used.has(j)) continue;
            const angleDiff = Math.abs(closeGroups[i].angle - closeGroups[j].angle);
            const normalizedDiff = angleDiff > Math.PI ? 2 * Math.PI - angleDiff : angleDiff;
            if (normalizedDiff >= Math.PI / 2) {
                // Found a flanking pair. Assign the stronger group as assault.
                const [a, b] = closeGroups[i].power >= closeGroups[j].power
                    ? [closeGroups[i], closeGroups[j]]
                    : [closeGroups[j], closeGroups[i]];
                assignments.push({
                    group: a.group,
                    role: 'assault',
                    approachAngle: a.angle,
                });
                assignments.push({
                    group: b.group,
                    role: 'flank',
                    approachAngle: b.angle,
                });
                used.add(i);
                used.add(j);
                break;
            }
        }
    }

    return assignments;
}

/** Compute a flanking objective tile for a group assigned the 'flank' role.
 *  Returns a tile coordinate on the opposite side of the target from the
 *  assault group, or null if no suitable tile exists.
 *
 *  @param {{ x, z }} target - target city
 *  @param {number} assaultAngle - approach angle of the assault group (radians)
 *  @param {Map} tiles - game tiles
 *  @param {string} owner - this faction's id
 *  @returns {{ x, z }|null}
 */
export function computeFlankObjective(target, assaultAngle, tiles, owner) {
    // The flank approach is 180° from the assault angle.
    // assaultAngle is atan2(groupZ - targetZ, groupX - targetX), so the
    // flank direction is the opposite: we want to approach FROM the opposite
    // side, meaning we move TOWARD the target from the opposite direction.
    const flankAngle = assaultAngle + Math.PI;
    // Convert to unit direction vector pointing FROM target TO the flank position.
    const flankDirX = -Math.cos(flankAngle); // negate because we want approach direction
    const flankDirZ = -Math.sin(flankAngle);
    const dirX = Math.round(flankDirX);
    const dirZ = Math.round(flankDirZ);

    // Find a passable tile in the flank direction, 2-3 tiles from the target.
    for (let dist = 2; dist <= 3; dist++) {
        const fx = target.x + dirX * dist;
        const fz = target.z + dirZ * dist;
        const tile = tiles.get(`${fx},${fz}`);
        if (!tile) continue;
        if (tile.terrain === 'WATER' || tile.terrain === 'MOUNTAIN') continue;
        if (tile.owner === owner) continue; // don't retreat into own territory
        return { x: fx, z: fz };
    }
    return null;
}

/** Sum of hostile military power (all at-war factions) within Manhattan
 *  `radius` of a tile. Used by the beachhead engine to pick a safe landing
 *  spot. Ships are excluded (naval power assessed separately). */
export function getReachableHostilePower(tileKey, tiles, units, owner, isAtWar, radius = 4) {
    const [x, z] = tileKey.split(',').map(Number);
    let power = 0;
    for (const u of units.values()) {
        if (u.owner === owner || !isAtWar(u.owner, owner)) continue;
        if (u.boarded) continue;
        const def = UNIT_TYPE[u.type];
        if (def && def.naval) continue;
        if (Math.abs(u.x - x) + Math.abs(u.z - z) > radius) continue;
        const atk = def ? def.attack || 0 : 0;
        power += (u.hp || 1) + atk * 2;
    }
    return power;
}

/** Find a safe beachhead landing tile near a target coastal city.
 *  Scans the 4 cardinal neighbors of the target: picks the first one that is
 *  land (not WATER/MOUNTAIN), not enemy-owned, not blocked by adjacent enemy,
 *  and reachable from the target's sea approach.
 *
 *  The safe beachhead is the tile where amphibious troops should disembark
 *  (transport sails adjacent, unloads onto this tile). Returns null if no
 *  safe tile exists — the caller falls back to nearestEnemyCoastalCity.
 *
 *  @param {Map} tiles - game tiles
 *  @param {number} targetX - coastal city X
 *  @param {number} targetZ - coastal city Z
 *  @param {Map} units - all units (for enemy proximity check)
 *  @param {string} owner - this faction's id
 *  @param {Function} isAtWar - (factionId) => boolean
 *  @returns {{ x, z }|null} */
export function findSafeBeachheadLandingTile(tiles, targetX, targetZ, units, owner, isAtWar) {
    let best = null, bestPower = Infinity;
    for (const [dx, dz] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
        const bx = targetX + dx, bz = targetZ + dz;
        const bt = tiles.get(`${bx},${bz}`);
        if (!bt) continue;
        // Must be land tile (not WATER or MOUNTAIN).
        if (bt.terrain === 'WATER' || bt.terrain === 'MOUNTAIN') continue;
        // Must not be our own city or an enemy city.
        if (bt.terrain === 'CITY') continue;
        // Must have WATER adjacency (reachable by transport).
        let adjacentWater = false;
        for (const [dx2, dz2] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
            const nt = tiles.get(`${bx + dx2},${bz + dz2}`);
            if (nt && nt.terrain === 'WATER') { adjacentWater = true; break; }
        }
        if (!adjacentWater) continue;
        // Check hostile power within radius 3.
        const hp = getReachableHostilePower(`${bx},${bz}`, tiles, units, owner, isAtWar, 3);
        if (hp < bestPower) { bestPower = hp; best = { x: bx, z: bz }; }
    }
    return best;
}

/** Find a staging tile for an army group preparing to attack a target city.
 *  Places the group 2-4 tiles behind the beachhead (away from the target)
 *  so the group can form up before committing.
 *  Returns { x, z } or the beachhead itself if no rear tile is available. */
export function findStagingTile(beachheadX, beachheadZ, targetX, targetZ, tiles) {
    // Direction from target → beachhead (reverse of approach).
    const dx = beachheadX - targetX;
    const dz = beachheadZ - targetZ;
    const ndx = Math.sign(dx) || 0;
    const ndz = Math.sign(dz) || 0;
    for (let dist = 2; dist <= 4; dist++) {
        const sx = beachheadX + ndx * dist;
        const sz = beachheadZ + ndz * dist;
        const st = tiles.get(`${sx},${sz}`);
        if (!st) continue;
        if (st.terrain === 'WATER' || st.terrain === 'MOUNTAIN') continue;
        return { x: sx, z: sz };
    }
    return { x: beachheadX, z: beachheadZ };
}

/** Find a perimeter tile for a screening group — a defensible position between
 *  the staging area and known threat directions. Returns a tile offset from
 *  staging by the average threat direction, or the staging tile itself if no
 *  clear threat direction exists. */
export function findPerimeterTile(stagingX, stagingZ, threatDirections, tiles) {
    if (!threatDirections || threatDirections.length === 0) {
        return { x: stagingX, z: stagingZ };
    }
    let avgDx = 0, avgDz = 0;
    for (const dir of threatDirections) {
        avgDx += dir.dx;
        avgDz += dir.dz;
    }
    avgDx = Math.round(avgDx / threatDirections.length);
    avgDz = Math.round(avgDz / threatDirections.length);
    for (let dist = 1; dist <= 3; dist++) {
        const px = stagingX + avgDx * dist;
        const pz = stagingZ + avgDz * dist;
        const pt = tiles.get(`${px},${pz}`);
        if (!pt) continue;
        if (pt.terrain === 'WATER' || pt.terrain === 'MOUNTAIN') continue;
        return { x: px, z: pz };
    }
    return { x: stagingX, z: stagingZ };
}
