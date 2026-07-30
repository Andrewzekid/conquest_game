import { GRID_WIDTH, GRID_HEIGHT } from './config.js';

/** Flood-fill over WATER/RIVER tiles. Returns true if the water body
 *  contains at least `minSize` tiles OR touches a map edge (open water).
 *  This prevents harbors/ship spawns on enclosed river ponds. */
export function isWaterConnectedToOpenWater(tiles, startKey, minSize = 4) {
    const start = tiles.get(startKey);
    if (!start || (start.terrain !== 'WATER' && start.terrain !== 'RIVER')) return false;
    const visited = new Set([startKey]);
    const queue = [startKey];
    const dirs = [[0, 1], [0, -1], [1, 0], [-1, 0]];
    let size = 0;
    while (queue.length) {
        const k = queue.pop();
        const [x, z] = k.split(',').map(Number);
        size++;
        if (x === 0 || z === 0 || x === GRID_WIDTH - 1 || z === GRID_HEIGHT - 1) return true;
        for (const [dx, dz] of dirs) {
            const nx = x + dx, nz = z + dz;
            const nk = `${nx},${nz}`;
            if (visited.has(nk)) continue;
            const t = tiles.get(nk);
            if (!t || (t.terrain !== 'WATER' && t.terrain !== 'RIVER')) continue;
            visited.add(nk);
            queue.push(nk);
        }
    }
    return size >= minSize;
}
