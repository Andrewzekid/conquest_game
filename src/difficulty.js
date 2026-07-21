/** Difficulty settings (Feature 8): pure accessors over DIFFICULTY_PRESETS.
 *  A missing/unknown difficulty always falls back to NORMAL so old saves and
 *  unconfigured games keep working unchanged. */
import { DIFFICULTY_PRESETS, DIFFICULTY_DEFAULT } from './config.js';

/** Get the preset object for a difficulty key (always returns a valid preset). */
export function getDifficulty(key) {
    return DIFFICULTY_PRESETS[key] || DIFFICULTY_PRESETS[DIFFICULTY_DEFAULT];
}

/** Is the given faction the human player? The economy applies player-side
 *  modifiers to the player and AI-side modifiers to every other faction. */
export function isPlayerSide(faction, playerFaction) {
    return faction === playerFaction;
}

/** Yield multiplier applied to a faction's per-turn resource income under the
 *  current difficulty. AIs get their resource multiplier; the player gets the
 *  player yield multiplier. */
export function yieldMultiplier(difficulty, faction, playerFaction) {
    const p = getDifficulty(difficulty);
    return isPlayerSide(faction, playerFaction) ? p.playerYieldMult : p.aiResourceMult;
}

/** Upkeep multiplier applied to a faction's unit upkeep under the difficulty.
 *  AIs and the player use their respective multipliers. */
export function upkeepMultiplier(difficulty, faction, playerFaction) {
    const p = getDifficulty(difficulty);
    return isPlayerSide(faction, playerFaction) ? p.playerUpkeepMult : p.aiUpkeepMult;
}

/** The AI aggression scalar (used by diplomacy/AI decisioning). */
export function aiAggression(difficulty) {
    return getDifficulty(difficulty).aiAggression;
}

/** XP gain multiplier for AI units (player units are unaffected). */
export function aiXpMultiplier(difficulty) {
    return getDifficulty(difficulty).aiXpMult;
}

/** Apply the difficulty yield multiplier to a single resource amount for a
 *  faction. Returns the scaled amount (floored to an integer). */
export function applyDifficultyYield(amount, difficulty, faction, playerFaction) {
    if (!amount) return 0;
    return Math.floor(amount * yieldMultiplier(difficulty, faction, playerFaction));
}

/** Scale an upkeep cost for a faction under the difficulty. Returns the
 *  scaled cost (floored). */
export function applyDifficultyUpkeep(cost, difficulty, faction, playerFaction) {
    if (!cost) return 0;
    return Math.floor(cost * upkeepMultiplier(difficulty, faction, playerFaction));
}

/** List of difficulty keys in display order (for the start-menu selector). */
export function difficultyOptions() {
    return Object.values(DIFFICULTY_PRESETS);
}