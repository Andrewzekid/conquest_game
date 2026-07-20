/** Fog of war logic (pure, no engine deps) */
import { GRID_SIZE } from './config.js';

/** Default sight radius for units/lords. */
export const VISION_RADIUS = 3;

/**
 * Compute the set of visible tile keys from a list of sight sources.
 * Each source: { x, z, radius }.
 * @returns Set<string>
 */
export function computeVisibility(sources) {
    const visible = new Set();
    for (const s of sources) {
        const r = s.radius || VISION_RADIUS;
        const r2 = r * r;
        for (let dx = -r; dx <= r; dx++) {
            for (let dz = -r; dz <= r; dz++) {
                if (dx * dx + dz * dz > r2) continue; // circular vision
                const nx = s.x + dx;
                const nz = s.z + dz;
                if (nx < 0 || nx >= GRID_SIZE || nz < 0 || nz >= GRID_SIZE) continue;
                visible.add(`${nx},${nz}`);
            }
        }
    }
    return visible;
}

/**
 * Mark currently-visible tiles as explored (persistent memory of the map).
 */
export function updateExplored(explored, visible) {
    for (const k of visible) explored.add(k);
    return explored;
}