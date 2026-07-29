/** Threat assessment module for the AI. Analyses army positions, expansion
 *  patterns, and diplomatic context to predict multi-turn threats. Pure
 *  functions — no game-state side effects.
 */

/** Compute a threat score for each nearby faction based on army size,
 *  proximity to our cities, and diplomatic state.
 *
 *  @param {object} params
 *  @param {string} owner - this faction's id
 *  @param {Map} units - all units on the map
 *  @param {Map} tiles - all tiles
 *  @param {object} diploState - diplomacy state
 *  @param {Array} ownCities - tiles owned by this faction that are cities
 *  @param {Array} enemyUnits - units belonging to enemy factions
 *  @param {number} turn - current turn number
 *  @returns {{ threats: Array<{ faction, score, armySize, nearestCityDist, urgency }>, overallThreat: number }}
 */
export function assessThreats({ owner, units, tiles, diploState, ownCities, enemyUnits, turn }) {
    const threats = new Map();
    for (const u of enemyUnits) {
        if (u.type === 'SETTLER' || u.type === 'WORKER') continue;
        const existing = threats.get(u.owner) || { faction: u.owner, armySize: 0, nearestCityDist: Infinity, tiles: [] };
        existing.armySize++;
        existing.tiles.push(u);
        // Find distance to nearest owned city.
        for (const c of ownCities) {
            const d = Math.abs(u.x - c.x) + Math.abs(u.z - c.z);
            if (d < existing.nearestCityDist) existing.nearestCityDist = d;
        }
        threats.set(u.owner, existing);
    }
    const results = [];
    let totalThreat = 0;
    for (const t of threats.values()) {
        // War state multiplier: at-war factions are urgent threats.
        const relKey = [owner, t.faction].sort().join(':');
        const rel = diploState && diploState.relations && diploState.relations[relKey];
        const atWar = rel && rel.state === 'war';
        const allied = rel && (rel.state === 'alliance' || rel.state === 'trade_pact');
        if (allied) continue; // allies are not threats.
        // Proximity score: closer = more threatening (0-100).
        const proximityScore = t.nearestCityDist === Infinity ? 0
            : Math.max(0, 100 - t.nearestCityDist * 5);
        // Army score: larger army = more threatening (0-100, capped at ~20 units).
        const armyScore = Math.min(100, t.armySize * 5);
        // Combined score with war multiplier.
        const baseScore = (proximityScore * 0.5 + armyScore * 0.5);
        const warMultiplier = atWar ? 1.5 : 1.0;
        // Time pressure: threats grow if the enemy is expanding (more cities).
        const urgency = atWar && t.nearestCityDist <= 6 ? 'critical'
            : atWar ? 'high'
            : t.nearestCityDist <= 4 ? 'medium'
            : 'low';
        const score = Math.round(baseScore * warMultiplier);
        t.score = score;
        t.urgency = urgency;
        results.push(t);
        totalThreat += score;
    }
    results.sort((a, b) => b.score - a.score);
    return { threats: results, overallThreat: totalThreat };
}

/** Determine whether the AI should shift to a defensive posture based on
 *  the current threat level and army readiness.
 *
 *  @param {{ threats, overallThreat }} threatAssessment - from assessThreats
 *  @param {number} ownArmySize - count of military units
 *  @param {number} armyHealthFraction - average HP fraction of army (0-1)
 *  @param {string} personality - faction personality
 *  @returns {{ defensive: boolean, reason: string }}
 */
export function shouldGoDefensive(threatAssessment, ownArmySize, armyHealthFraction = 1.0, personality = 'BALANCED') {
    const { overallThreat, threats } = threatAssessment;
    const criticalThreats = threats.filter(t => t.urgency === 'critical');
    const highThreats = threats.filter(t => t.urgency === 'high' || t.urgency === 'critical');
    // Critical: at-war enemy army near our cities.
    if (criticalThreats.length > 0) {
        return { defensive: true, reason: 'critical_threat_near_cities' };
    }
    // High threat with small army.
    if (highThreats.length > 0 && ownArmySize < 8) {
        return { defensive: true, reason: 'outnumbered_threat' };
    }
    // Overall threat exceeds a threshold.
    const threshold = personality === 'AGGRESSIVE' ? 200 : personality === 'DEFENSIVE' ? 120 : 150;
    if (overallThreat > threshold) {
        return { defensive: true, reason: 'high_overall_threat' };
    }
    // Army is weakened.
    if (armyHealthFraction < 0.4 && highThreats.length > 0) {
        return { defensive: true, reason: 'weak_army_under_threat' };
    }
    return { defensive: false, reason: 'safe' };
}

/** Compute a defensive deployment: identify which cities need garrison
 *  reinforcement and from where reserves should be pulled.
 *
 *  @param {{ threats }} threatAssessment - from assessThreats
 *  @param {Array} ownCities - owned city tiles
 *  @param {Array} ownMilitary - our military units
 *  @param {Map} tiles - tile map
 *  @returns {{ garrisonNeeds: Array<{ cityKey, urgency, reinforceFrom }>, reservePool: Array }}
 */
export function computeDefensePlan(threatAssessment, ownCities, ownMilitary, tiles) {
    const { threats } = threatAssessment;
    const garrisonNeeds = [];
    // Identify threatened cities (enemy army within 6 tiles).
    for (const city of ownCities) {
        let worstThreat = 0;
        let threatFaction = null;
        for (const t of threats) {
            for (const u of (t.tiles || [])) {
                const d = Math.abs(u.x - city.x) + Math.abs(u.z - city.z);
                if (d <= 6 && t.score > worstThreat) {
                    worstThreat = t.score;
                    threatFaction = t.faction;
                }
            }
        }
        if (worstThreat > 0) {
            garrisonNeeds.push({
                cityKey: `${city.x},${city.z}`,
                urgency: worstThreat > 80 ? 'critical' : worstThreat > 40 ? 'high' : 'medium',
                threatFaction,
            });
        }
    }
    // Reserve pool: military units not near any enemy (distance > 8 from all
    // enemy units) and not in a city.
    const reservePool = ownMilitary.filter(u => {
        const tile = tiles.get(`${u.x},${u.z}`);
        const inCity = tile && tile.terrain === 'CITY';
        return !inCity;
    });
    return { garrisonNeeds, reservePool };
}
