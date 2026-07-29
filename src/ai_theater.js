/** Theater system — geographic command for AI military coordination.
 *
 *  The map is split into theaters (one per contiguous landmass the faction
 *  has cities on). Each theater gets:
 *    - The army groups whose centroid falls on that landmass
 *    - Its own local objectives (defense, conquest within the theater)
 *    - A production budget to train units in its cities
 *    - A naval ferry request when another theater needs reinforcements
 *
 *  This prevents the AI from idling troops on one landmass while another
 *  is under attack, and lets it manage multi-island empires effectively.
 */
import { countCities } from './economy.js';

/** Represents one geographic theater for a faction. */
export class Theater {
    id;          // landmass ID (integer)
    label;       // human-readable label
    landmassId;  // matches computeLandmasses output
    cityCount;   // number of owned cities here
    groups;      // army groups assigned to this theater
    enemyUnits;  // enemy units on this landmass
    urgency;     // 0..1: how badly this theater needs reinforcements
    homeTheater; // true if this is where the faction's capital is
    budget;      // share of resources allocated to this theater
    portCity;    // coastal city for naval logistics, or null

    constructor(id, label, landmassId, homeTheater = false) {
        this.id = id;
        this.label = label;
        this.landmassId = landmassId;
        this.cityCount = 0;
        this.groups = [];
        this.enemyUnits = 0;
        this.urgency = 0;
        this.homeTheater = homeTheater;
        this.budget = null;
        this.portCity = null;
    }
}

/** Create theaters for a faction: one per distinct landmass that has at least
 *  one of the faction's cities. Also identifies the home theater (where the
 *  capital — the faction's first city — sits) and coastal port cities. */
export function createTheaters(tiles, owner, land) {
    const theaters = new Map(); // landmassId -> Theater
    let homeMass = null;
    let firstCityKey = null;

    // Find the faction's first-placed city (the capital) to determine home theater.
    for (const t of tiles.values()) {
        if (t.terrain === 'CITY' && t.owner === owner) {
            firstCityKey = `${t.x},${t.z}`;
            break;
        }
    }
    if (!firstCityKey) return theaters;
    homeMass = land.idOf.get(firstCityKey);

    // Create one theater per landmass where the faction has cities.
    for (const t of tiles.values()) {
        if (t.terrain !== 'CITY' || t.owner !== owner) continue;
        const massId = land.idOf.get(`${t.x},${t.z}`);
        if (massId == null) continue;
        if (!theaters.has(massId)) {
            const isHome = massId === homeMass;
            const label = isHome ? 'home' : `theater_${massId}`;
            theaters.set(massId, new Theater(massId, label, massId, isHome));
        }
        theaters.get(massId).cityCount++;
    }

    // Find port city for each theater (coastal city with HARBOR, or just coastal).
    for (const [massId, theater] of theaters) {
        for (const t of tiles.values()) {
            if (t.terrain !== 'CITY' || t.owner !== owner) continue;
            if (land.idOf.get(`${t.x},${t.z}`) !== massId) continue;
            const key = `${t.x},${t.z}`;
            if (isCoastal(key, tiles)) {
                theater.portCity = { x: t.x, z: t.z };
                break;
            }
        }
    }

    return theaters;
}

/** Assign army groups to theaters based on their centroid's landmass.
 *  Groups whose centroid falls on water (approaching a target by sea) are
 *  assigned to their origin theater (nearest owned city's landmass). */
export function assignGroupsToTheaters(groups, theaters, tiles, land, owner) {
    const unassigned = [];
    for (const g of groups) {
        const c = groupCentroid(g);
        const massId = land.idOf.get(`${c.x},${c.z}`);
        let theater = massId != null ? theaters.get(massId) : null;
        if (!theater) {
            // Group is at sea or on unowned land — find nearest owned city's theater.
            let bestDist = Infinity;
            for (const t of theaters.values()) {
                for (const city of getOwnedCities(tiles, owner)) {
                    if (land.idOf.get(`${city.x},${city.z}`) !== t.landmassId) continue;
                    const d = Math.max(Math.abs(c.x - city.x), Math.abs(c.z - city.z));
                    if (d < bestDist) { bestDist = d; theater = t; }
                }
            }
        }
        if (theater) {
            theater.groups.push(g);
        } else {
            unassigned.push(g);
        }
    }
    // Groups that couldn't be assigned go to the home theater.
    const home = [...theaters.values()].find(t => t.homeTheater);
    if (home) {
        for (const g of unassigned) home.groups.push(g);
    }
}

/** Count enemy units on each theater's landmass to compute urgency. */
export function computeTheaterUrgency(theaters, tiles, units, owner, isAtWar, land) {
    for (const t of theaters.values()) {
        t.enemyUnits = 0;
    }
    for (const u of units.values()) {
        if (u.owner === owner || !isAtWar(u.owner, owner)) continue;
        if (u.boarded) continue;
        const massId = land.idOf.get(`${u.x},${u.z}`);
        if (massId != null && theaters.has(massId)) {
            theaters.get(massId).enemyUnits++;
        }
    }
    for (const t of theaters.values()) {
        // Urgency based on enemy-to-friendly ratio on this landmass.
        const friendGroups = t.groups.reduce((s, g) => s + g.units.length, 0);
        const ratio = friendGroups > 0 ? t.enemyUnits / friendGroups : t.enemyUnits;
        t.urgency = Math.min(1, ratio * 0.5);
        // If there are enemy units on the home landmass at all, raise urgency.
        if (t.homeTheater && t.enemyUnits > 0) {
            t.urgency = Math.max(t.urgency, 0.5);
        }
    }
}

/** Allocate a share of the faction's production to each theater based on
 *  urgency and city count. The per-theater budget caps how many units can
 *  be trained in that theater's cities each turn. Returns a Map of
 *  theater -> { gold, production, maxUnits }. */
export function allocateTheaterBudgets(theaters, resources, owner) {
    const totalGold = resources.gold || 0;
    const totalProd = resources.production || 0;
    const totalWood = resources.wood || 0;
    const totalFood = resources.food || 0;
    const totalIron = resources.iron || 0;

    const totalUrgency = [...theaters.values()].reduce((s, t) => s + t.urgency, 0) || 1;
    const totalCities = [...theaters.values()].reduce((s, t) => s + t.cityCount, 0) || 1;

    for (const t of theaters.values()) {
        // Budget = weighted by urgency (60%) and city count (40%).
        const urgencyShare = t.urgency / totalUrgency;
        const cityShare = t.cityCount / totalCities;
        const share = urgencyShare * 0.6 + cityShare * 0.4;
        t.budget = {
            gold: Math.floor(totalGold * share),
            production: Math.floor(totalProd * share),
            wood: Math.floor(totalWood * share),
            food: Math.floor(totalFood * share),
            iron: Math.floor(totalIron * share),
            maxUnits: Math.max(1, Math.ceil(t.cityCount * 1.5))
        };
    }
}

/** Decide which units to train in each theater's cities.
 *  Returns an array of { theaterId, cityTile, unitType } suggested builds.
 *  High-urgency theaters train more combat units; low-urgency ones train
 *  workers/settlers if the home landmass has room. */
export function planTheaterProduction(theaters, tiles, owner, land, isAtWar) {
    const suggestions = [];
    for (const t of theaters.values()) {
        if (!t.budget) continue;
        if (t.cityCount === 0) continue;
        let unitsToTrain = 0;
        const cap = t.budget.maxUnits;
        // Find this theater's cities.
        const theaterCities = [];
        for (const tile of tiles.values()) {
            if (tile.terrain !== 'CITY' || tile.owner !== owner) continue;
            if (land.idOf.get(`${tile.x},${tile.z}`) !== t.landmassId) continue;
            theaterCities.push(tile);
        }
        for (const city of theaterCities) {
            if (unitsToTrain >= cap) break;
            const key = `${city.x},${city.z}`;
            suggestions.push({ theaterId: t.id, cityKey: key });
            unitsToTrain++;
        }
    }
    return suggestions;
}

/** How many units should stay behind as garrison in a theater? One per city,
 *  +1 per city when the theater is seriously threatened (urgency > 0.5) and
 *  +1 for a city with high unrest (> 50). Groups beyond this quota are
 *  surplus — free to attack in-theater or embark for another theater. */
export function garrisonNeeds(theater, tiles, owner, land) {
    let need = 0;
    for (const t of tiles.values()) {
        if (t.terrain !== 'CITY' || t.owner !== owner) continue;
        if (land.idOf.get(`${t.x},${t.z}`) !== theater.landmassId) continue;
        need += 1;
        if (theater.urgency > 0.5) need += 1;
        if ((t.unrest || 0) > 50) need += 1;
    }
    return need;
}

/** Nearest attackable city (enemy at war, or neutral) ON a given landmass —
 *  the in-theater offensive target for groups released from garrison duty.
 *  Returns the city tile or null. */
export function findTheaterTarget(tiles, owner, landmassId, land, isAtWar, fromX, fromZ) {
    let best = null, bestDist = Infinity;
    for (const t of tiles.values()) {
        if (t.terrain !== 'CITY' || t.owner === owner) continue;
        if (t.owner && isAtWar && !isAtWar(t.owner)) continue;
        if (land.idOf.get(`${t.x},${t.z}`) !== landmassId) continue;
        const d = Math.abs(t.x - fromX) + Math.abs(t.z - fromZ);
        if (d < bestDist) { bestDist = d; best = t; }
    }
    return best;
}

/** Pair every needy theater with a quiet donor theater for naval reinforcement.
 *  A theater is needy when it is under pressure (urgency ≥ 0.3), outnumbered
 *  locally, and has a port to receive troops. A donor is any OTHER theater
 *  that is quiet (urgency < 0.2), has a port to embark from, and still has
 *  groups available (per the caller's donorFilter). Returns an array of
 *  { donor, needy, fromPort, toPort } — one plan per needy theater.
 *
 *  This replaces the old home→overseas-only planFerry: reinforcement can now
 *  flow between ANY pair of landmasses, which is what lets large idle armies
 *  on safe continents join the fight instead of sitting at home. */
export function planFerries(theaters, units, tiles, owner, land, donorFilter = null) {
    const plans = [];
    const list = [...theaters.values()];
    for (const needy of list) {
        if (needy.urgency < 0.3 || !needy.portCity) continue;
        const friendPower = needy.groups.reduce((s, g) => s + g.units.length, 0);
        if (friendPower >= needy.enemyUnits) continue;
        let bestDonor = null, bestDist = Infinity;
        for (const donor of list) {
            if (donor === needy || donor.urgency >= 0.2 || !donor.portCity) continue;
            if (donorFilter && !donorFilter(donor)) continue;
            const d = Math.abs(donor.portCity.x - needy.portCity.x) +
                      Math.abs(donor.portCity.z - needy.portCity.z);
            if (d < bestDist) { bestDist = d; bestDonor = donor; }
        }
        if (bestDonor) {
            plans.push({
                donor: bestDonor,
                needy,
                fromPort: bestDonor.portCity,
                toPort: needy.portCity
            });
        }
    }
    return plans;
}

function groupCentroid(group) {
    let sx = 0, sz = 0;
    for (const u of group.units || []) { sx += u.x; sz += u.z; }
    const n = (group.units && group.units.length) || 1;
    return { x: Math.round(sx / n), z: Math.round(sz / n) };
}

function isCoastal(tileKey, tiles) {
    const [x, z] = tileKey.split(',').map(Number);
    for (const [dx, dz] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
        const nt = tiles.get(`${x + dx},${z + dz}`);
        if (nt && (nt.terrain === 'WATER' || nt.terrain === 'RIVER')) return true;
    }
    return false;
}

function getOwnedCities(tiles, owner) {
    const cities = [];
    for (const t of tiles.values()) {
        if (t.terrain === 'CITY' && t.owner === owner) cities.push(t);
    }
    return cities;
}

/** Find an owned city on a specific landmass that isn't already used for a
 *  training action this turn. Returns the tile or null. */
export function findTheaterCity(tiles, owner, landmassId, land, actions) {
    const occupied = new Set();
    for (const a of actions) if (a.tileKey) occupied.add(a.tileKey);
    for (const t of tiles.values()) {
        if (t.terrain !== 'CITY' || t.owner !== owner) continue;
        const k = `${t.x},${t.z}`;
        if (occupied.has(k)) continue;
        if (land.idOf.get(k) === landmassId) return t;
    }
    // Fallback: any city on that landmass even if occupied.
    for (const t of tiles.values()) {
        if (t.terrain !== 'CITY' || t.owner !== owner) continue;
        const k = `${t.x},${t.z}`;
        if (land.idOf.get(k) === landmassId) return t;
    }
    return null;
}
