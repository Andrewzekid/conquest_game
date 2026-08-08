import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GRID_SIZE, TERRAIN, FACTION_COLORS, PLAYER_FACTION, LORD_CLASSES, BUILDING_TYPE, UNIT_TYPE, NATURAL_WONDERS } from './config.js';
import { hasLordAura } from './lords.js';
import { svgDataURL, hasIcon } from './icons.js';

const HIGHLIGHT_MOVE = 0x2244aa;
const HIGHLIGHT_ATTACK = 0xaa0000;
const BREACH_COLOR = 0xff3322;

// Common base Y for all tile columns. Every tile box extends downward from its
// terrain-top Y to this base so raised tiles (mountain/city) read as solid
// columns instead of floating slabs above an empty gap. Must sit below the
// lowest terrain top (WATER at -0.05).
const TILE_COLUMN_BOTTOM = -0.1;

// Top-surface Y for a terrain type. Shared by createMapMesh and updateTileTerrain
// (the old inline ladder in updateTileTerrain drifted from this one —the bug).
export function heightFor(terrain) {
    if (terrain === 'MOUNTAIN') return 0.5;
    if (terrain === 'CITY') return 0.55;
    if (terrain === 'HILLS') return 0.18;
    if (terrain === 'WATER') return -0.05;
    if (terrain === 'RIVER') return -0.04;
    return 0;
}

// Maps each unit type to an icon name from src/icons.js (unit icon keys match
// the type name). Unknown types fall back to a generic flag glyph.
const UNIT_ICON_NAME = {
    INFANTRY: 'INFANTRY', ARCHER: 'ARCHER', ARTILLERY: 'ARTILLERY', CAVALRY: 'CAVALRY',
    PIKEMAN: 'PIKEMAN', SCOUT: 'SCOUT', SIEGE: 'SIEGE', SETTLER: 'SETTLER', ENGINEER: 'ENGINEER',
    LONGBOWMAN: 'LONGBOWMAN', CATAPHRACT: 'CATAPHRACT', CHARIOT: 'CHARIOT', MEDIC: 'MEDIC', SIEGE_TOWER: 'SIEGE_TOWER',
    CATAPULT: 'CATAPULT', TREBUCHET: 'TREBUCHET', WORKER: 'WORKER',
    GALLEY: 'GALLEY', TRANSPORT: 'TRANSPORT', TRIREME: 'TRIREME', FRIGATE: 'FRIGATE',
    GALLEON: 'GALLEON', CARAVEL: 'CARAVEL', BATTLESHIP: 'BATTLESHIP', SUBMARINE: 'SUBMARINE',
    DESTROYER: 'DESTROYER', IRONCLAD: 'IRONCLAD'
};

export class GameRenderer {
    constructor() {
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x1b2230);

        const aspect = window.innerWidth / window.innerHeight;
        const d = 12;
        this.camera = new THREE.OrthographicCamera(-d * aspect, d * aspect, d, -d, 1, 1000);
        this.camera.position.set(24, 26, 24);
        this.camera.lookAt(0, 0, 0);

        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        document.body.appendChild(this.renderer.domElement);

        // Game.js owns left/right-drag panning (threshold click); OrbitControls
        // only zooms (wheel). Rotating is disabled (top-down 2.5D).
        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableRotate = false;
        this.controls.enablePan = false;
        this.controls.enableZoom = true;

        const light = new THREE.DirectionalLight(0xffffff, 1);
        light.position.set(10, 20, 10);
        this.scene.add(light);
        this.scene.add(new THREE.AmbientLight(0x505060));

        this.mapGroup = new THREE.Group();
        this.scene.add(this.mapGroup);
        this.unitGroup = new THREE.Group();
        this.scene.add(this.unitGroup);
        this.lordGroup = new THREE.Group();
        this.scene.add(this.lordGroup);
        this.buildingGroup = new THREE.Group();
        this.scene.add(this.buildingGroup);
        this.markerGroup = new THREE.Group(); // goal markers etc.
        this.scene.add(this.markerGroup);
        this.auraGroup = new THREE.Group(); // lord AoE rings
        this.scene.add(this.auraGroup);
        this.bridgeGroup = new THREE.Group(); // bridges over rivers
        this.scene.add(this.bridgeGroup);
        this.structureGroup = new THREE.Group(); // engineer-built structures (spikes/fortifications/traps)
        this.scene.add(this.structureGroup);
        this.effectsGroup = new THREE.Group(); // transient VFX (AOE impact rings, projectiles)
        this.scene.add(this.effectsGroup);
        this.labelGroup = new THREE.Group(); // floating text labels (city names)
        this.scene.add(this.labelGroup);
        this._effects = [];   // active transient effects: { obj, born, life, kind }
        this._flames = [];     // active fire-ailment flame markers (for flicker)
        this._iconMatCache = {};   // iconName -> SpriteMaterial
        this._textMatCache = {};   // text+color -> SpriteMaterial
        this._unitPaletteCache = {}; // colorHex -> palette materials
        this._matCacheSet = new Set(); // all cached materials that must not be disposed

        this.tileMeshes = new Map(); // `${x},${z}` -> base tile Mesh
        this.tileHeights = new Map();
        this.cityProps = new Map(); // `${x},${z}` -> keep mesh (for breach tint)

        window.addEventListener('resize', () => this.onWindowResize());
    }

    /** True if a material is a shared cached sprite material (icon/text) that
     *  must NOT be disposed when its sprite is removed —it's reused across
     *  renders. Disposing it would corrupt every subsequent icon/label. */
    _isCachedMaterial(mat) {
        if (!mat) return false;
        if (this._iconMatCache) { for (const k in this._iconMatCache) if (this._iconMatCache[k] === mat) return true; }
        if (this._textMatCache) { for (const k in this._textMatCache) if (this._textMatCache[k] === mat) return true; }
        return false;
    }

    /** Dispose geometries and non-cached materials of all children of a Group,
     *  then clear it. group.clear() alone detaches children but leaves their
     *  GPU resources alive —over ~200 turns this leaked enough WebGL memory
     *  to crash the context (white screen, vanished icons/city names). Cached
     *  sprite materials (_iconMatCache / _textMatCache) are shared across
     *  renders and are intentionally preserved. */
    _disposeGroupChildren(group) {
        if (!group) return;
        group.traverse(obj => {
            if (obj.isMesh) {
                if (obj.geometry && typeof obj.geometry.dispose === 'function') obj.geometry.dispose();
                if (obj.material) {
                    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
                    for (const m of mats) {
                        if (!this._isCachedMaterial(m) && typeof m.dispose === 'function') m.dispose();
                    }
                }
            }
        });
        group.clear();
    }

    /** Remove a single object from its parent, disposing its geometry and
     *  non-cached materials. Used for transient VFX in effectsGroup (which is
     *  NOT bulk-cleared each render, so its children must be cleaned up
     *  individually when their lifetime ends). */
    _disposeAndRemove(obj) {
        if (!obj) return;
        if (obj.parent) obj.parent.remove(obj);
        obj.traverse(child => {
            if (child.isMesh) {
                if (child.geometry && typeof child.geometry.dispose === 'function') child.geometry.dispose();
                if (child.material) {
                    const mats = Array.isArray(child.material) ? child.material : [child.material];
                    for (const m of mats) {
                        if (!this._isCachedMaterial(m) && typeof m.dispose === 'function') m.dispose();
                    }
                }
            }
        });
    }

    onWindowResize() {
        const aspect = window.innerWidth / window.innerHeight;
        const d = 12;
        this.camera.left = -d * aspect;
        this.camera.right = d * aspect;
        this.camera.top = d;
        this.camera.bottom = -d;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }

    /** Faction color object for a slot, from gameState or the static fallback. */
    fcolor(gameState, owner) {
        if (gameState && gameState.factionColors && gameState.factionColors[owner]) {
            return gameState.factionColors[owner];
        }
        return FACTION_COLORS[owner] || { tile: 0x666666, unit: 0xffffff, name: owner };
    }

    // --- 3D scenery per terrain type (added as children of the base tile mesh) ---
    makeScenery(terrain, tile) {
        const group = new THREE.Group();
        let keep = null;
        if (terrain === 'MOUNTAIN') {
            const peak = new THREE.Mesh(new THREE.ConeGeometry(0.6, 0.9, 5),
                new THREE.MeshPhongMaterial({ color: 0x8a7a68 }));
            peak.position.y = 0.45;
            group.add(peak);
            const snow = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.4, 5),
                new THREE.MeshPhongMaterial({ color: 0xf4f6f8 }));
            snow.position.y = 0.85;
            group.add(snow);
        } else if (terrain === 'HILLS') {
            // Hills: smaller mountain peaks (same style as mountains but lower)
            const peak1 = new THREE.Mesh(new THREE.ConeGeometry(0.4, 0.55, 5),
                new THREE.MeshPhongMaterial({ color: 0x8a7a68 }));
            peak1.position.set(-0.15, 0.28, 0.1);
            group.add(peak1);
            const peak2 = new THREE.Mesh(new THREE.ConeGeometry(0.35, 0.45, 5),
                new THREE.MeshPhongMaterial({ color: 0x9a8a78 }));
            peak2.position.set(0.2, 0.23, -0.1);
            group.add(peak2);
            // Small grass patches at base
            const grass = new THREE.Mesh(new THREE.SphereGeometry(0.3, 6, 4, 0, Math.PI * 2, 0, Math.PI / 2),
                new THREE.MeshPhongMaterial({ color: 0x6a8a45 }));
            grass.scale.set(1, 0.2, 1);
            grass.position.set(0, 0.02, 0.2);
            group.add(grass);
        } else if (terrain === 'WATER') {
            const plane = new THREE.Mesh(new THREE.PlaneGeometry(0.95, 0.95),
                new THREE.MeshPhongMaterial({ color: 0x3f8fd0, transparent: true, opacity: 0.55 }));
            plane.rotation.x = -Math.PI / 2;
            plane.position.y = 0.06;
            group.add(plane);
        } else if (terrain === 'FOREST') {
            const tree = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.5, 6),
                new THREE.MeshPhongMaterial({ color: 0x256325 }));
            tree.position.set(0.1, 0.25, -0.05);
            group.add(tree);
            const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.12, 5),
                new THREE.MeshPhongMaterial({ color: 0x5a3b1a }));
            trunk.position.set(0.1, 0.06, -0.05);
            group.add(trunk);
        } else if (terrain === 'CITY') {
            // City meshes vary per-city so they don't all look identical.
            // Variation axes:
            //   - cityLevel: bigger cities get taller keeps + extra towers
            //   - a stable per-tile hash: picks one of 8 "styles" so
            //     neighboring cities read as distinct settlements.
            // The keep mesh is still tracked in cityProps for breach/ownership
            // tinting in renderAll.
            const level = (tile && tile.cityLevel) || 1;
            const hash = (tile ? (tile.x * 73856093) ^ (tile.z * 19349663) : 0) >>> 0;
            const style = hash % 8;
            const stone = new THREE.MeshPhongMaterial({ color: 0xb9b2a0 });
            const roofColor = [0x8a4a2a, 0x4a6a8a, 0x6a8a4a, 0x8a6a8a, 0x6a4a2a, 0x4a8a8a, 0x8a8a4a, 0x5a6a9a][style];
            const roof = new THREE.MeshPhongMaterial({ color: roofColor });
            const keepH = 0.4 + Math.min(level, 6) * 0.06;
            if (style === 0) {
                // Square keep + 4 corner towers (classic castle).
                keep = new THREE.Mesh(new THREE.BoxGeometry(0.42, keepH, 0.42), stone);
                keep.position.y = keepH / 2 + 0.1;
                group.add(keep);
                const cap = new THREE.Mesh(new THREE.ConeGeometry(0.32, 0.18, 4), roof);
                cap.position.y = keepH + 0.18;
                group.add(cap);
                const towerGeo = new THREE.CylinderGeometry(0.1, 0.12, 0.45, 6);
                for (const [ox, oz] of [[0.32, 0.32], [-0.32, 0.32], [0.32, -0.32], [-0.32, -0.32]]) {
                    const t = new THREE.Mesh(towerGeo, stone);
                    t.position.set(ox, 0.33, oz);
                    group.add(t);
                    const tc = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.16, 6), roof);
                    tc.position.set(ox, 0.58, oz);
                    group.add(tc);
                }
            } else if (style === 1) {
                // Round keep (cylindrical donjon) with a ring of smaller towers.
                keep = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.28, keepH, 10), stone);
                keep.position.y = keepH / 2 + 0.1;
                group.add(keep);
                const cap = new THREE.Mesh(new THREE.ConeGeometry(0.26, 0.22, 10), roof);
                cap.position.y = keepH + 0.2;
                group.add(cap);
                const ringCount = 3 + (level >= 3 ? 1 : 0);
                for (let i = 0; i < ringCount; i++) {
                    const a = (i / ringCount) * Math.PI * 2;
                    const t = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 0.35, 6), stone);
                    t.position.set(Math.cos(a) * 0.4, 0.27, Math.sin(a) * 0.4);
                    group.add(t);
                }
            } else if (style === 2) {
                // Cathedral/temple: a tall central spire + a wide base.
                keep = new THREE.Mesh(new THREE.BoxGeometry(0.34, keepH * 0.7, 0.34), stone);
                keep.position.y = keepH * 0.35 + 0.1;
                group.add(keep);
                const spire = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.5, 8), roof);
                spire.position.y = keepH * 0.7 + 0.35;
                group.add(spire);
                const ball = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 8),
                    new THREE.MeshPhongMaterial({ color: 0xe8c468, emissive: 0xe8c468, emissiveIntensity: 0.4 }));
                ball.position.y = keepH * 0.7 + 0.62;
                group.add(ball);
            } else if (style === 3) {
                // Star fort: a low wide bastion with 5 triangular bastion points.
                keep = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.36, keepH * 0.6, 5), stone);
                keep.position.y = keepH * 0.3 + 0.1;
                group.add(keep);
                for (let i = 0; i < 5; i++) {
                    const a = (i / 5) * Math.PI * 2;
                    const b = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.28, 4), roof);
                    b.position.set(Math.cos(a) * 0.42, 0.26, Math.sin(a) * 0.42);
                    b.rotation.y = a;
                    group.add(b);
                }
            } else if (style === 4) {
                // Industrial town: a squat main building with two chimneys
                // belching smoke (a faint dark cone). Reads as a 19th-c factory
                // town —distinct from the medieval castles.
                keep = new THREE.Mesh(new THREE.BoxGeometry(0.46, keepH * 0.55, 0.36), stone);
                keep.position.y = keepH * 0.275 + 0.1;
                group.add(keep);
                const brick = new THREE.MeshPhongMaterial({ color: 0x8a4a2a });
                for (const [ox, oz] of [[-0.14, -0.12], [0.14, -0.12]]) {
                    const ch = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.5, 6), brick);
                    ch.position.set(ox, 0.45, oz);
                    group.add(ch);
                    const smoke = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.22, 6),
                        new THREE.MeshBasicMaterial({ color: 0x3a3a3a, transparent: true, opacity: 0.5 }));
                    smoke.position.set(ox, 0.78, oz);
                    group.add(smoke);
                }
                const roofSlab = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.05, 0.36), roof);
                roofSlab.position.y = keepH * 0.55 + 0.12;
                group.add(roofSlab);
            } else if (style === 5) {
                // Modern city: a cluster of tall blocky towers (skyscrapers)
                // with a glass-blue tint. Scales aggressively with level so
                // high-level modern cities look like real metropolises.
                const glassColor = new THREE.MeshPhongMaterial({ color: 0x9ab4d4, shininess: 60 });
                const towers = [
                    [0, 0, 0.5 + keepH],
                    [0.22, 0.18, 0.35 + keepH * 0.7],
                    [-0.2, 0.16, 0.3 + keepH * 0.6],
                    [0.18, -0.2, 0.28 + keepH * 0.5]
                ];
                let firstMesh = null;
                for (const [ox, oz, h] of towers) {
                    const w = 0.16 + (h > 0.5 ? 0.04 : 0);
                    const t = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), glassColor);
                    t.position.set(ox, h / 2 + 0.1, oz);
                    group.add(t);
                    if (!firstMesh) firstMesh = t;
                }
                keep = firstMesh; // tint the tallest tower for breach/owner
                // A faint emissive cap on the tallest tower so it reads at night.
                const cap = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.04, 0.18),
                    new THREE.MeshPhongMaterial({ color: roofColor, emissive: roofColor, emissiveIntensity: 0.3 }));
                cap.position.set(0, 0.5 + keepH + 0.14, 0);
                group.add(cap);
            } else if (style === 6) {
                // Harbor town: a row of gabled warehouses facing the coast + a
                // small lighthouse. Distinct silhouette from inland cities.
                keep = new THREE.Mesh(new THREE.BoxGeometry(0.5, keepH * 0.5, 0.3), stone);
                keep.position.y = keepH * 0.25 + 0.1;
                group.add(keep);
                // Gabled roof (a triangular prism along the long axis).
                const gable = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.5, 4), roof);
                gable.rotation.z = Math.PI / 4;
                gable.scale.set(1, 0.5, 1);
                gable.position.y = keepH * 0.5 + 0.18;
                group.add(gable);
                // Lighthouse: a thin striped tower.
                const lh = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.6, 8),
                    new THREE.MeshPhongMaterial({ color: 0xece4d0 }));
                lh.position.set(0.3, 0.4, 0.3);
                group.add(lh);
                const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 8),
                    new THREE.MeshPhongMaterial({ color: 0xffe070, emissive: 0xffe070, emissiveIntensity: 0.7 }));
                lamp.position.set(0.3, 0.74, 0.3);
                group.add(lamp);
            } else {
                // Hillfort / steppe camp: a terraced ring of small huts with a
                // central banner pole. Reads as a tribal/regional capital —
                // distinct from the masonry of the other styles.
                const earthMat = new THREE.MeshPhongMaterial({ color: 0x9a7a5a });
                keep = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.32, keepH * 0.4, 8), earthMat);
                keep.position.y = keepH * 0.2 + 0.1;
                group.add(keep);
                const hutCount = 4 + (level >= 3 ? 1 : 0);
                for (let i = 0; i < hutCount; i++) {
                    const a = (i / hutCount) * Math.PI * 2;
                    const hut = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.24, 5), roof);
                    hut.position.set(Math.cos(a) * 0.34, 0.22, Math.sin(a) * 0.34);
                    group.add(hut);
                }
                // Central banner pole.
                const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.5, 5),
                    new THREE.MeshPhongMaterial({ color: 0x5a3b1a }));
                pole.position.y = 0.35;
                group.add(pole);
                const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.18, 0.12),
                    new THREE.MeshPhongMaterial({ color: roofColor, side: THREE.DoubleSide }));
                flag.position.set(0.09, 0.52, 0);
                group.add(flag);
            }
            // High-level cities get a second wall ring for visual weight.
            if (level >= 4) {
                const wall = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.05, 6, 16),
                    new THREE.MeshPhongMaterial({ color: 0x9a9a8a }));
                wall.rotation.x = Math.PI / 2;
                wall.position.y = 0.12;
                group.add(wall);
            }
            // Level-6+ cities get a third outer ring + corner markers —they
            // read as major capitals at a glance.
            if (level >= 6) {
                const outer = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.04, 6, 20),
                    new THREE.MeshPhongMaterial({ color: 0xb0a888 }));
                outer.rotation.x = Math.PI / 2;
                outer.position.y = 0.1;
                group.add(outer);
                for (let i = 0; i < 4; i++) {
                    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
                    const m = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.22, 5),
                        new THREE.MeshPhongMaterial({ color: roofColor, emissive: roofColor, emissiveIntensity: 0.2 }));
                    m.position.set(Math.cos(a) * 0.6, 0.21, Math.sin(a) * 0.6);
                    group.add(m);
                }
            }
        } else if (terrain === 'DESERT') {
            const dune = new THREE.Mesh(new THREE.SphereGeometry(0.4, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2),
                new THREE.MeshPhongMaterial({ color: 0xd8c184 }));
            dune.scale.set(1, 0.25, 1);
            dune.position.set(-0.1, 0.06, 0.1);
            group.add(dune);
        } else if (terrain === 'RIVER') {
            const plane = new THREE.Mesh(new THREE.PlaneGeometry(0.95, 0.95),
                new THREE.MeshPhongMaterial({ color: 0x3aa0e0, transparent: true, opacity: 0.6 }));
            plane.rotation.x = -Math.PI / 2;
            plane.position.y = 0.06;
            group.add(plane);
        }
        return { group, keep };
    }

    /** A glowing monument marking a Natural Wonder tile: a tall obelisk in the
     *  wonder's color with a softly emissive top + the wonder's emoji label, so
     *  wonders read as large, distinctive features on the map. */
    makeWonderProp(wonder) {
        const g = new THREE.Group();
        const color = (wonder && wonder.color) || 0xc8a030;
        const mat = new THREE.MeshPhongMaterial({ color, shininess: 80, emissive: color, emissiveIntensity: 0.25 });
        // Stepped obelisk base + tapered shaft.
        const base = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.1, 0.34), mat);
        base.position.y = 0.1; g.add(base);
        const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.18, 0.7, 6), mat);
        shaft.position.y = 0.5; g.add(shaft);
        const cap = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.22, 6),
            new THREE.MeshPhongMaterial({ color, emissive: color, emissiveIntensity: 0.7 }));
        cap.position.y = 0.95; g.add(cap);
        // Two smaller flanking pillars so the structure reads as "large".
        for (const sx of [-0.28, 0.28]) {
            const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.5, 5), mat);
            pillar.position.set(sx, 0.35, 0); g.add(pillar);
            const top = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 8),
                new THREE.MeshPhongMaterial({ color, emissive: color, emissiveIntensity: 0.6 }));
            top.position.set(sx, 0.64, 0); g.add(top);
        }
        const emoji = (wonder && wonder.emoji) || '\u2728';
        g.add(this.makeIconSprite(emoji, 0.6, 1.25));
        return g;
    }

    /** Dispose an object and its descendants' geometries and materials. Cached
     *  materials are skipped so they can be reused. */
    _disposeObject(obj) {
        if (!obj) return;
        obj.traverse(o => {
            if (o.geometry) {
                o.geometry.dispose();
                o.geometry = null;
            }
            if (o.material) {
                const mats = Array.isArray(o.material) ? o.material : [o.material];
                for (const mat of mats) {
                    if (this._matCacheSet && this._matCacheSet.has(mat)) continue;
                    if (mat.map) mat.map.dispose();
                    mat.dispose();
                }
                o.material = null;
            }
        });
    }

    /** Dispose every child of a group so geometries and materials are freed from
     *  GPU memory. Cached materials (icons, text labels, unit palettes) are
     *  skipped so they can be reused. This is called before rebuilding dynamic
     *  groups in renderAll to prevent the WebGL context from being exhausted
     *  after many turns. */
    _disposeGroup(group) {
        if (!group) return;
        this._disposeObject(group);
        group.clear();
    }

    createMapMesh(tilesData) {
        this._disposeGroup(this.mapGroup);
        this.tileMeshes.clear();
        this.tileHeights.clear();
        this.cityProps.clear();

        tilesData.forEach(t => {
            const material = new THREE.MeshPhongMaterial({ color: TERRAIN[t.terrain].color });
            // Per-tile column: top at the terrain's surface Y, bottom at the
            // shared TILE_COLUMN_BOTTOM. The geometry is translated so its top
            // sits at the mesh origin (world Y = y) and it hangs downward to the
            // base. Raised tiles (mountain/city) thus read as solid columns
            // reaching down to the base instead of floating slabs, while the
            // mesh.position.y stays at the top surface y — so all scenery
            // children (parented to the mesh) and all tileHeights consumers keep
            // their existing offsets unchanged.
            const y = heightFor(t.terrain);
            const h = y - TILE_COLUMN_BOTTOM;
            const geo = new THREE.BoxGeometry(1 * 0.95, h, 1 * 0.95);
            geo.translate(0, -h / 2, 0);
            const mesh = new THREE.Mesh(geo, material);
            mesh.position.set(t.x - GRID_SIZE / 2, y, t.z - GRID_SIZE / 2);
            mesh.userData = { ...TERRAIN[t.terrain], x: t.x, z: t.z };
            this.mapGroup.add(mesh);
            this.tileMeshes.set(`${t.x},${t.z}`, mesh);
            this.tileHeights.set(`${t.x},${t.z}`, y);

            // 3D scenery as a child (hidden with the parent in fog).
            const { group, keep } = this.makeScenery(t.terrain, t);
            mesh.add(group);
            if (keep) this.cityProps.set(`${t.x},${t.z}`, keep);
            // Natural Wonder: a glowing monument child marks the tile.
            if (t.wonder) mesh.add(this.makeWonderProp(t.wonder));
        });
    }

    /** Refresh a single tile's mesh after its terrain changes at runtime (e.g.
     *  a Settler founds a city on a plains tile). The base mesh was built for the
     *  original terrain, so without this the new city never gets a keep prop and
     *  renderAll keeps coloring it as the old terrain. Rebuilds scenery, height,
     *  userData and the cityProps entry for this tile. */
    updateTileTerrain(tile) {
        const key = `${tile.x},${tile.z}`;
        const mesh = this.tileMeshes.get(key);
        if (!mesh) return;
        // Drop existing scenery / wonder children (base mesh stays).
        for (const child of [...mesh.children]) {
            this._disposeObject(child);
            mesh.remove(child);
        }
        const terrain = tile.terrain;
        // Rebuild the column geometry so the tile keeps a solid base down to
        // TILE_COLUMN_BOTTOM after a runtime terrain change (e.g. a Settler
        // founding a city on plains). The old code only moved position.y, which
        // left the 0.2-tall slab floating at the new height.
        const y = heightFor(terrain);
        const h = y - TILE_COLUMN_BOTTOM;
        mesh.geometry.dispose();
        mesh.geometry = new THREE.BoxGeometry(1 * 0.95, h, 1 * 0.95);
        mesh.geometry.translate(0, -h / 2, 0);
        mesh.position.y = y;
        mesh.userData = { ...TERRAIN[terrain], x: tile.x, z: tile.z };
        this.tileHeights.set(key, y);
        const { group, keep } = this.makeScenery(terrain, tile);
        mesh.add(group);
        if (keep) this.cityProps.set(key, keep); else this.cityProps.delete(key);
        if (tile.wonder) mesh.add(this.makeWonderProp(tile.wonder));
        mesh.material.color = new THREE.Color(TERRAIN[terrain].color);
    }

    animate() {
        requestAnimationFrame(() => this.animate());
        const now = performance.now();
        // Animate transient VFX (AOE impact rings / projectiles) and retire
        // expired ones. effectsGroup is NOT cleared by renderAll, so these live
        // across frames until their life elapses.
        if (this._effects.length) {
            const alive = [];
            for (const fx of this._effects) {
                const t = (now - fx.born) / fx.life; // 0..1
                if (t >= 1) { this._disposeAndRemove(fx.obj); continue; }
                if (fx.kind === 'ring') {
                    const s = 0.4 + t * 1.6;
                    fx.obj.scale.set(s, s, s);
                    fx.obj.material.opacity = 0.8 * (1 - t);
                } else if (fx.kind === 'burst') {
                    const s = 0.3 + t * 1.5;
                    fx.obj.scale.set(s, s, s);
                    fx.obj.material.opacity = 0.9 * (1 - t);
                } else if (fx.kind === 'debris') {
                    fx.obj.position.y += 0.005;
                    if (fx.obj.material) fx.obj.material.opacity = 0.8 * (1 - t);
                }
                alive.push(fx);
            }
            this._effects = alive;
        }
        // Flicker fire-ailment flame markers (opacity/scale oscillation).
        if (this._flames.length) {
            const f = 0.7 + 0.3 * Math.sin(now / 90);
            for (const fl of this._flames) {
                if (fl.material) fl.material.opacity = 0.6 + 0.3 * f;
                fl.scale.set(1, 0.9 + 0.2 * f, 1);
            }
        }
        // Pulse aura rings slowly.
        if (this._auraRings && this._auraRings.length) {
            const p = 0.3 + 0.3 * Math.sin(now / 700);
            for (const ring of this._auraRings) {
                if (ring.material) ring.material.opacity = 0.25 + 0.3 * p;
            }
        }
        this.controls.update();
        this.renderer.render(this.scene, this.camera);
    }

    /** Spawn a transient AOE impact effect at a tile: an expanding ring on the
     *  ground plus a lobbed rock. Lives ~700ms. Called when a CATAPULT/TREBUCHET
     *  attacks. */
    /**
     * Animate a unit model to show an attack. The model is looked up in the
     * current unit group by unitId; if it isn't rendered this frame we skip.
     */
    _animateModel(unitId, animFn, duration = 300) {
        let mesh = null;
        this.unitGroup.traverse(o => {
            if (o.userData && o.userData.unitId === unitId && !mesh) mesh = o;
        });
        if (!mesh) return;
        const startPos = mesh.position.clone();
        const startRot = mesh.rotation.clone();
        const startTime = performance.now();
        const loop = () => {
            const t = Math.min(1, (performance.now() - startTime) / duration);
            animFn(mesh, t, startPos, startRot);
            if (t < 1) requestAnimationFrame(loop);
            else { mesh.position.copy(startPos); mesh.rotation.copy(startRot); }
        };
        loop();
    }

    addArrowShot(attackerId, fromX, fromZ, toX, toZ) {
        const y0 = (this.tileHeights.get(`${fromX},${fromZ}`) || 0) + 0.55;
        const y1 = (this.tileHeights.get(`${toX},${toZ}`) || 0) + 0.55;
        const x0 = fromX - GRID_SIZE / 2, z0 = fromZ - GRID_SIZE / 2;
        const x1 = toX - GRID_SIZE / 2, z1 = toZ - GRID_SIZE / 2;
        const arrow = new THREE.Group();
        const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.45, 6), new THREE.MeshBasicMaterial({ color: 0x6a4220 }));
        shaft.rotation.z = Math.PI / 2; shaft.position.x = 0.22; arrow.add(shaft);
        const head = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.08, 6), new THREE.MeshBasicMaterial({ color: 0xc0c4cc }));
        head.rotation.z = -Math.PI / 2; head.position.x = 0.5; arrow.add(head);
        arrow.position.set(x0, y0, z0);
        arrow.lookAt(x1, y1, z1);
        this.effectsGroup.add(arrow);
        const start = performance.now();
        const life = 320;
        const step = () => {
            const t = Math.min(1, (performance.now() - start) / life);
            if (t >= 1 || !arrow.parent) { if (arrow.parent) this._disposeAndRemove(arrow); return; }
            arrow.position.set(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, z0 + (z1 - z0) * t);
            requestAnimationFrame(step);
        };
        step();
        // Archer body recoil.
        this._animateModel(attackerId, (m, t, p, r) => {
            const recoil = Math.sin(t * Math.PI) * 0.12;
            m.position.set(p.x - (x1 - x0) * recoil * 0.5, p.y, p.z - (z1 - z0) * recoil * 0.5);
            m.rotation.y = r.y + Math.sin(t * Math.PI) * 0.15;
        }, 320);
    }

    addSwordLunge(attackerId, fromX, fromZ, toX, toZ) {
        this._animateModel(attackerId, (m, t, p, r) => {
            const forward = Math.sin(t * Math.PI) * 0.45;
            const dx = toX - fromX, dz = toZ - fromZ;
            const len = Math.sqrt(dx * dx + dz * dz) || 1;
            m.position.set(p.x + (dx / len) * forward, p.y, p.z + (dz / len) * forward);
            m.rotation.z = r.z + Math.sin(t * Math.PI) * 0.25;
        }, 300);
    }

    addCavalryCharge(attackerId, fromX, fromZ, toX, toZ) {
        this._animateModel(attackerId, (m, t, p, r) => {
            const forward = Math.sin(t * Math.PI) * 0.85;
            const dx = toX - fromX, dz = toZ - fromZ;
            const len = Math.sqrt(dx * dx + dz * dz) || 1;
            // Slight rear-up peak at mid-animation.
            const rear = Math.sin(t * Math.PI) * 0.18;
            m.position.set(p.x + (dx / len) * forward, p.y + rear, p.z + (dz / len) * forward);
            m.rotation.x = r.x - rear * 0.8;
        }, 380);
    }

    addImpact(x, z, fromX, fromZ) {
        const cx = x - GRID_SIZE / 2, cz = z - GRID_SIZE / 2;
        const y = (this.tileHeights.get(`${x},${z}`) || 0) + 0.1;
        // Expanding shockwave ring flat on the ground.
        const ring = new THREE.Mesh(
            new THREE.RingGeometry(0.25, 0.32, 18),
            new THREE.MeshBasicMaterial({ color: 0xffaa33, transparent: true, opacity: 0.8, side: THREE.DoubleSide }));
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(cx, y, cz);
        this.effectsGroup.add(ring);
        this._effects.push({ obj: ring, born: performance.now(), life: 700, kind: 'ring' });
        // Lobbed rock travelling from attacker tile toward the target, arcing
        // up and back down. Self-managed via its own rAF loop; removed on impact.
        const rock = new THREE.Mesh(
            new THREE.DodecahedronGeometry(0.12, 0),
            new THREE.MeshBasicMaterial({ color: 0x6b6b6b, transparent: true, opacity: 1 }));
        const fx0 = (fromX != null ? fromX : x) - GRID_SIZE / 2;
        const fz0 = (fromZ != null ? fromZ : z) - GRID_SIZE / 2;
        rock.position.set(fx0, y + 1.0, fz0);
        const rockLife = 600;
        const t0 = performance.now();
        this.effectsGroup.add(rock);
        const step = () => {
            const tt = (performance.now() - t0) / rockLife;
            if (tt >= 1 || !rock.parent) { if (rock.parent) this._disposeAndRemove(rock); return; }
            rock.position.x = fx0 + (cx - fx0) * tt;
            rock.position.z = fz0 + (cz - fz0) * tt;
            rock.position.y = y + 1.0 + Math.sin(tt * Math.PI) * 1.2;
            requestAnimationFrame(step);
        };
        step();
    }

    /** Animate a lord model (lives in lordGroup, not unitGroup). */
    _animateLordModel(lordId, animFn, duration = 300) {
        let mesh = null;
        this.lordGroup.traverse(o => {
            if (o.userData && o.userData.lordId === lordId && !mesh) mesh = o;
        });
        if (!mesh) return;
        const startPos = mesh.position.clone();
        const startRot = mesh.rotation.clone();
        const startTime = performance.now();
        const loop = () => {
            const t = Math.min(1, (performance.now() - startTime) / duration);
            animFn(mesh, t, startPos, startRot);
            if (t < 1) requestAnimationFrame(loop);
            else { mesh.position.copy(startPos); mesh.rotation.copy(startRot); }
        };
        loop();
    }

    /** Small reusable impact burst at a world coordinate (used by projectiles). */
    _addImpactBurst(x, y, z, color = 0xffaa33, life = 400) {
        const burst = new THREE.Mesh(new THREE.SphereGeometry(0.08, 6, 6),
            new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9 }));
        burst.position.set(x, y, z);
        this.effectsGroup.add(burst);
        this._effects.push({ obj: burst, born: performance.now(), life, kind: 'burst' });
        const ring = new THREE.Mesh(new THREE.RingGeometry(0.1, 0.18, 12),
            new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.7, side: THREE.DoubleSide }));
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(x, y + 0.02, z);
        this.effectsGroup.add(ring);
        this._effects.push({ obj: ring, born: performance.now(), life: life + 100, kind: 'ring' });
    }

    // ===================================================================
    //  NEW ATTACK ANIMATIONS —added for all unit ages and types
    // ===================================================================

    /** Gunfire: small fast bullet + muzzle flash + smoke (MUSKETEER, RIFLEMAN, etc.) */
    addGunfire(attackerId, fromX, fromZ, toX, toZ, opts = {}) {
        const y0 = (this.tileHeights.get(`${fromX},${fromZ}`) || 0) + 0.35;
        const y1 = (this.tileHeights.get(`${toX},${toZ}`) || 0) + 0.35;
        const x0 = fromX - GRID_SIZE / 2, z0 = fromZ - GRID_SIZE / 2;
        const x1 = toX - GRID_SIZE / 2, z1 = toZ - GRID_SIZE / 2;
        // Muzzle flash
        const flash = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 6),
            new THREE.MeshBasicMaterial({ color: 0xffdd44, transparent: true, opacity: 0.9 }));
        flash.position.set(x0, y0, z0);
        this.effectsGroup.add(flash);
        // Smoke puff
        const smoke = new THREE.Mesh(new THREE.SphereGeometry(0.08, 6, 6),
            new THREE.MeshBasicMaterial({ color: 0xcccccc, transparent: true, opacity: 0.6 }));
        smoke.position.set(x0, y0, z0);
        this.effectsGroup.add(smoke);
        // Bullet
        const bullet = new THREE.Mesh(new THREE.SphereGeometry(0.025, 5, 5),
            new THREE.MeshBasicMaterial({ color: opts.bulletColor || 0x888899 }));
        bullet.position.set(x0, y0, z0);
        this.effectsGroup.add(bullet);
        const start = performance.now();
        const life = opts.speed || 200;
        const step = () => {
            const t = Math.min(1, (performance.now() - start) / life);
            if (t >= 1 || !bullet.parent) {
                if (bullet.parent) this._disposeAndRemove(bullet);
                if (flash.parent) this._disposeAndRemove(flash);
                if (smoke.parent) this._disposeAndRemove(smoke);
                if (t >= 1) this._addImpactBurst(x1, y1, z1, 0xcccccc, 300);
                return;
            }
            bullet.position.set(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, z0 + (z1 - z0) * t);
            flash.material.opacity = 0.9 * (1 - t * 2);
            flash.scale.setScalar(1 + t * 3);
            smoke.material.opacity = 0.6 * (1 - t);
            smoke.scale.setScalar(1 + t * 2);
            requestAnimationFrame(step);
        };
        step();
        this._animateModel(attackerId, (m, t, p, r) => {
            const dx = toX - fromX, dz = toZ - fromZ;
            const len = Math.sqrt(dx * dx + dz * dz) || 1;
            const recoil = Math.sin(t * Math.PI) * 0.15;
            m.position.set(p.x - (dx / len) * recoil, p.y, p.z - (dz / len) * recoil);
        }, life);
    }

    /** Cannon shot: arcing cannonball with impact burst (CANNON, FIELD_GUN, etc.) */
    addCannonShot(attackerId, fromX, fromZ, toX, toZ, opts = {}) {
        const y0 = (this.tileHeights.get(`${fromX},${fromZ}`) || 0) + 0.3;
        const y1 = (this.tileHeights.get(`${toX},${toZ}`) || 0) + 0.1;
        const x0 = fromX - GRID_SIZE / 2, z0 = fromZ - GRID_SIZE / 2;
        const x1 = toX - GRID_SIZE / 2, z1 = toZ - GRID_SIZE / 2;
        const flash = new THREE.Mesh(new THREE.SphereGeometry(0.1, 6, 6),
            new THREE.MeshBasicMaterial({ color: 0xff8822, transparent: true, opacity: 1 }));
        flash.position.set(x0, y0, z0);
        this.effectsGroup.add(flash);
        const ball = new THREE.Mesh(new THREE.SphereGeometry(opts.ballSize || 0.06, 8, 8),
            new THREE.MeshBasicMaterial({ color: 0x2a2a2a }));
        ball.position.set(x0, y0, z0);
        this.effectsGroup.add(ball);
        const start = performance.now();
        const life = opts.speed || 400;
        const step = () => {
            const t = Math.min(1, (performance.now() - start) / life);
            if (t >= 1 || !ball.parent) {
                if (ball.parent) this._disposeAndRemove(ball);
                if (flash.parent) this._disposeAndRemove(flash);
                if (t >= 1) this._addImpactBurst(x1, y1, z1, 0xff8844, 500);
                return;
            }
            ball.position.set(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t + Math.sin(t * Math.PI) * 0.6, z0 + (z1 - z0) * t);
            flash.material.opacity = 1 - t * 3;
            flash.scale.setScalar(1 + t * 2);
            requestAnimationFrame(step);
        };
        step();
        this._animateModel(attackerId, (m, t, p, r) => {
            const dx = toX - fromX, dz = toZ - fromZ;
            const len = Math.sqrt(dx * dx + dz * dz) || 1;
            const recoil = Math.sin(t * Math.PI) * 0.2;
            m.position.set(p.x - (dx / len) * recoil, p.y, p.z - (dz / len) * recoil);
            m.rotation.z = r.z + Math.sin(t * Math.PI) * 0.15;
        }, life);
    }

    /** Mortar / howitzer shell: steep high arc (MORTAR, HORSE_ARTILLERY, MOBILIZED_ARTILLERY) */
    addMortarShell(attackerId, fromX, fromZ, toX, toZ, opts = {}) {
        const y0 = (this.tileHeights.get(`${fromX},${fromZ}`) || 0) + 0.4;
        const y1 = (this.tileHeights.get(`${toX},${toZ}`) || 0) + 0.1;
        const x0 = fromX - GRID_SIZE / 2, z0 = fromZ - GRID_SIZE / 2;
        const x1 = toX - GRID_SIZE / 2, z1 = toZ - GRID_SIZE / 2;
        const shell = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.035, 0.1, 6),
            new THREE.MeshBasicMaterial({ color: opts.color || 0x5a5a3a }));
        shell.position.set(x0, y0, z0);
        this.effectsGroup.add(shell);
        const start = performance.now();
        const life = opts.speed || 500;
        const step = () => {
            const t = Math.min(1, (performance.now() - start) / life);
            if (t >= 1 || !shell.parent) {
                if (shell.parent) this._disposeAndRemove(shell);
                if (t >= 1) this._addImpactBurst(x1, y1, z1, 0xff6633, 550);
                return;
            }
            shell.position.set(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t + Math.sin(t * Math.PI) * 1.5, z0 + (z1 - z0) * t);
            shell.rotation.x = t * Math.PI * 2;
            requestAnimationFrame(step);
        };
        step();
    }

    /** Railgun bolt: fast bright energy bolt (RAILGUN) */
    addRailgunBolt(attackerId, fromX, fromZ, toX, toZ) {
        const y0 = (this.tileHeights.get(`${fromX},${fromZ}`) || 0) + 0.3;
        const y1 = (this.tileHeights.get(`${toX},${toZ}`) || 0) + 0.3;
        const x0 = fromX - GRID_SIZE / 2, z0 = fromZ - GRID_SIZE / 2;
        const x1 = toX - GRID_SIZE / 2, z1 = toZ - GRID_SIZE / 2;
        const bolt = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.15, 6),
            new THREE.MeshBasicMaterial({ color: 0x44aaff }));
        bolt.position.set(x0, y0, z0);
        bolt.lookAt(x1, y1, z1);
        this.effectsGroup.add(bolt);
        const glow = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 6),
            new THREE.MeshBasicMaterial({ color: 0x88ddff, transparent: true, opacity: 0.7 }));
        glow.position.set(x0, y0, z0);
        this.effectsGroup.add(glow);
        const start = performance.now();
        const life = 150;
        const step = () => {
            const t = Math.min(1, (performance.now() - start) / life);
            if (t >= 1 || !bolt.parent) {
                if (bolt.parent) this._disposeAndRemove(bolt);
                if (glow.parent) this._disposeAndRemove(glow);
                if (t >= 1) {
                    const flash = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 8),
                        new THREE.MeshBasicMaterial({ color: 0xaaddff, transparent: true, opacity: 0.8 }));
                    flash.position.set(x1, y1, z1);
                    this.effectsGroup.add(flash);
                    this._effects.push({ obj: flash, born: performance.now(), life: 300, kind: 'burst' });
                }
                return;
            }
            const cx = x0 + (x1 - x0) * t, cy = y0 + (y1 - y0) * t, cz = z0 + (z1 - z0) * t;
            bolt.position.set(cx, cy, cz);
            bolt.lookAt(x1, y1, z1);
            glow.position.set(cx, cy, cz);
            glow.material.opacity = 0.7 * (1 - t * 0.5);
            requestAnimationFrame(step);
        };
        step();
    }

    /** Torpedo: slow underwater projectile with bubbles (SUBMARINE, TORPEDO_BOAT) */
    addTorpedo(attackerId, fromX, fromZ, toX, toZ) {
        const y0 = 0.08;
        const y1 = 0.08;
        const x0 = fromX - GRID_SIZE / 2, z0 = fromZ - GRID_SIZE / 2;
        const x1 = toX - GRID_SIZE / 2, z1 = toZ - GRID_SIZE / 2;
        const torp = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.18, 6),
            new THREE.MeshBasicMaterial({ color: 0x8899aa }));
        torp.position.set(x0, y0, z0);
        torp.lookAt(x1, 0, z1);
        this.effectsGroup.add(torp);
        const bubbleMat = new THREE.MeshBasicMaterial({ color: 0xeeeeff, transparent: true, opacity: 0.4 });
        const bubbles = [];
        for (let i = 0; i < 4; i++) {
            const b = new THREE.Mesh(new THREE.SphereGeometry(0.015, 4, 4), bubbleMat);
            b.position.set(x0 + (Math.random() - 0.5) * 0.1, y0 + Math.random() * 0.05, z0 + (Math.random() - 0.5) * 0.1);
            this.effectsGroup.add(b);
            bubbles.push(b);
        }
        const start = performance.now();
        const life = 500;
        const step = () => {
            const t = Math.min(1, (performance.now() - start) / life);
            if (t >= 1 || !torp.parent) {
                if (torp.parent) this._disposeAndRemove(torp);
                for (const b of bubbles) if (b.parent) this._disposeAndRemove(b);
                if (t >= 1) {
                    const burst = new THREE.Mesh(new THREE.SphereGeometry(0.15, 8, 8),
                        new THREE.MeshBasicMaterial({ color: 0x4488ff, transparent: true, opacity: 0.6 }));
                    burst.position.set(x1, y1, z1);
                    this.effectsGroup.add(burst);
                    this._effects.push({ obj: burst, born: performance.now(), life: 600, kind: 'burst' });
                }
                return;
            }
            torp.position.set(x0 + (x1 - x0) * t, y0, z0 + (z1 - z0) * t);
            for (const b of bubbles) {
                b.position.x += (Math.random() - 0.5) * 0.02;
                b.position.z += (Math.random() - 0.5) * 0.02;
                b.position.y += 0.01;
                b.material.opacity = 0.4 * (1 - t);
            }
            requestAnimationFrame(step);
        };
        step();
    }

    /** Broadside: chain of cannonballs from naval sailing ships (FRIGATE, GALLEON, etc.) */
    addNavalBroadside(attackerId, fromX, fromZ, toX, toZ) {
        const y0 = (this.tileHeights.get(`${fromX},${fromZ}`) || 0) + 0.2;
        const y1 = (this.tileHeights.get(`${toX},${toZ}`) || 0) + 0.1;
        const x0 = fromX - GRID_SIZE / 2, z0 = fromZ - GRID_SIZE / 2;
        const x1 = toX - GRID_SIZE / 2, z1 = toZ - GRID_SIZE / 2;
        for (let i = 0; i < 3; i++) {
            const offX = (i - 1) * 0.12;
            const ball = new THREE.Mesh(new THREE.SphereGeometry(0.04, 6, 6),
                new THREE.MeshBasicMaterial({ color: 0x2a2a2a }));
            const bx0 = x0 + offX, bz0 = z0;
            const bx1 = x1 + offX * 0.3, bz1 = z1;
            ball.position.set(bx0, y0, bz0);
            this.effectsGroup.add(ball);
            const delay = i * 60;
            const bStart = performance.now() + delay;
            const bStep = () => {
                const t = Math.min(1, (performance.now() - bStart) / 350);
                if (t >= 1 || !ball.parent) {
                    if (ball.parent) this._disposeAndRemove(ball);
                    if (t >= 1) this._addImpactBurst(bx1, y1, bz1, 0xff8844, 300);
                    return;
                }
                ball.position.set(bx0 + (bx1 - bx0) * t, y0 + (y1 - y0) * t + Math.sin(t * Math.PI) * 0.3, bz0 + (bz1 - bz0) * t);
                requestAnimationFrame(bStep);
            };
            setTimeout(bStep, delay);
        }
        this._animateModel(attackerId, (m, t, p, r) => {
            const dx = toX - fromX, dz = toZ - fromZ;
            const len = Math.sqrt(dx * dx + dz * dz) || 1;
            const recoil = Math.sin(t * Math.PI) * 0.12;
            m.position.set(p.x - (dx / len) * recoil, p.y, p.z - (dz / len) * recoil);
            m.rotation.z = r.z + Math.sin(t * Math.PI) * 0.08;
        }, 400);
    }

    /** Ram impact: heavy forward thrust with debris burst (SIEGE, GALLEY, TRIREME) */
    addRamImpact(attackerId, fromX, fromZ, toX, toZ) {
        this._animateModel(attackerId, (m, t, p, r) => {
            const dx = toX - fromX, dz = toZ - fromZ;
            const len = Math.sqrt(dx * dx + dz * dz) || 1;
            const forward = Math.sin(t * Math.PI) * 0.5;
            m.position.set(p.x + (dx / len) * forward, p.y, p.z + (dz / len) * forward);
            m.rotation.z = r.z + Math.sin(t * Math.PI) * 0.15;
        }, 350);
        setTimeout(() => {
            const mx = (fromX + toX) / 2 - GRID_SIZE / 2;
            const mz = (fromZ + toZ) / 2 - GRID_SIZE / 2;
            const my = (this.tileHeights.get(`${Math.round((fromX + toX) / 2)},${Math.round((fromZ + toZ) / 2)}`) || 0) + 0.1;
            const burst = new THREE.Mesh(new THREE.SphereGeometry(0.1, 6, 6),
                new THREE.MeshBasicMaterial({ color: 0xaa8844, transparent: true, opacity: 0.8 }));
            burst.position.set(mx, my, mz);
            this.effectsGroup.add(burst);
            this._effects.push({ obj: burst, born: performance.now(), life: 400, kind: 'burst' });
            for (let i = 0; i < 4; i++) {
                const d = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 0.02),
                    new THREE.MeshBasicMaterial({ color: 0x6a4220 }));
                d.position.set(mx + (Math.random() - 0.5) * 0.2, my + 0.1, mz + (Math.random() - 0.5) * 0.2);
                this.effectsGroup.add(d);
                this._effects.push({ obj: d, born: performance.now(), life: 500, kind: 'debris' });
            }
        }, 175);
    }

    /** Explosion: fireball expanding then fading (DEMOLITION_SQUAD) */
    /** Visual effect when a trap (SPIKES / FALL_TRAP / MINEFIELD / AT_MINE)
     *  detonates at a tile. */
    addTrapEffect(x, z, type) {
        const cx = x - GRID_SIZE / 2, cz = z - GRID_SIZE / 2;
        const y = (this.tileHeights.get(`${x},${z}`) || 0) + 0.1;
        if (type === 'SPIKES') {
            // Wooden-splinter burst —brown debris rising from the tile.
            const colors = [0x8b5e3c, 0xa0724b, 0x6b4226];
            for (let i = 0; i < 6; i++) {
                const d = new THREE.Mesh(
                    new THREE.BoxGeometry(0.04, 0.04, 0.12),
                    new THREE.MeshBasicMaterial({ color: colors[i % colors.length], transparent: true, opacity: 0.8 }));
                d.position.set(cx + (Math.random() - 0.5) * 0.3, y + 0.1, cz + (Math.random() - 0.5) * 0.3);
                d.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
                this.effectsGroup.add(d);
                this._effects.push({ obj: d, born: performance.now(), life: 500, kind: 'debris' });
            }
            this._addImpactBurst(cx, y, cz, 0xc8a06e, 400);
        } else if (type === 'FALL_TRAP') {
            // Dust cloud —gray particles rising + ground ring.
            const dust = new THREE.Mesh(
                new THREE.SphereGeometry(0.15, 8, 8),
                new THREE.MeshBasicMaterial({ color: 0x888877, transparent: true, opacity: 0.6 }));
            dust.position.set(cx, y + 0.05, cz);
            this.effectsGroup.add(dust);
            this._effects.push({ obj: dust, born: performance.now(), life: 600, kind: 'burst' });
            const ring = new THREE.Mesh(
                new THREE.RingGeometry(0.2, 0.35, 18),
                new THREE.MeshBasicMaterial({ color: 0x999988, transparent: true, opacity: 0.5, side: THREE.DoubleSide }));
            ring.rotation.x = -Math.PI / 2;
            ring.position.set(cx, y, cz);
            this.effectsGroup.add(ring);
            this._effects.push({ obj: ring, born: performance.now(), life: 500, kind: 'ring' });
        } else if (type === 'MINEFIELD') {
            // Orange-red explosive burst + dark smoke debris.
            const burst = new THREE.Mesh(
                new THREE.SphereGeometry(0.18, 8, 8),
                new THREE.MeshBasicMaterial({ color: 0xff6633, transparent: true, opacity: 0.9 }));
            burst.position.set(cx, y + 0.1, cz);
            this.effectsGroup.add(burst);
            this._effects.push({ obj: burst, born: performance.now(), life: 400, kind: 'burst' });
            for (let i = 0; i < 4; i++) {
                const d = new THREE.Mesh(
                    new THREE.SphereGeometry(0.06, 6, 6),
                    new THREE.MeshBasicMaterial({ color: 0x444444, transparent: true, opacity: 0.7 }));
                d.position.set(cx + (Math.random() - 0.5) * 0.4, y + 0.05, cz + (Math.random() - 0.5) * 0.4);
                this.effectsGroup.add(d);
                this._effects.push({ obj: d, born: performance.now(), life: 600, kind: 'debris' });
            }
        } else if (type === 'AT_MINE') {
            // Shaped charge —bright white flash + large fireball + sparks.
            const flash = new THREE.Mesh(
                new THREE.SphereGeometry(0.22, 8, 8),
                new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 1 }));
            flash.position.set(cx, y + 0.15, cz);
            this.effectsGroup.add(flash);
            this._effects.push({ obj: flash, born: performance.now(), life: 200, kind: 'burst' });
            const fire = new THREE.Mesh(
                new THREE.SphereGeometry(0.2, 8, 8),
                new THREE.MeshBasicMaterial({ color: 0xff4400, transparent: true, opacity: 0.9 }));
            fire.position.set(cx, y + 0.1, cz);
            this.effectsGroup.add(fire);
            this._effects.push({ obj: fire, born: performance.now(), life: 500, kind: 'burst' });
            for (let i = 0; i < 6; i++) {
                const d = new THREE.Mesh(
                    new THREE.SphereGeometry(0.04, 4, 4),
                    new THREE.MeshBasicMaterial({ color: 0xffaa00, transparent: true, opacity: 0.8 }));
                d.position.set(cx + (Math.random() - 0.5) * 0.5, y + 0.05, cz + (Math.random() - 0.5) * 0.5);
                this.effectsGroup.add(d);
                this._effects.push({ obj: d, born: performance.now(), life: 500, kind: 'debris' });
            }
        }
    }

    addExplosion(atkX, atkZ, defX, defZ) {
        const cx = (atkX != null ? atkX : defX) - GRID_SIZE / 2;
        const cz = (atkZ != null ? atkZ : defZ) - GRID_SIZE / 2;
        const cy = (this.tileHeights.get(`${atkX != null ? atkX : defX},${atkZ != null ? atkZ : defZ}`) || 0) + 0.1;
        const targetX = defX - GRID_SIZE / 2, targetZ = defZ - GRID_SIZE / 2;
        const fire = new THREE.Mesh(new THREE.SphereGeometry(0.15, 8, 8),
            new THREE.MeshBasicMaterial({ color: 0xff4400, transparent: true, opacity: 0.9 }));
        fire.position.set(cx, cy, cz);
        this.effectsGroup.add(fire);
        const start = performance.now();
        const life = 500;
        const step = () => {
            const t = Math.min(1, (performance.now() - start) / life);
            if (t >= 1 || !fire.parent) {
                if (fire.parent) this._disposeAndRemove(fire);
                return;
            }
            const dx = targetX - cx, dz = targetZ - cz;
            fire.position.set(cx + dx * t, cy + Math.sin(t * Math.PI) * 0.4, cz + dz * t);
            fire.scale.setScalar(1 + t * 2);
            fire.material.color.setHSL(0.08 - t * 0.08, 1, 0.5 - t * 0.3);
            fire.material.opacity = 0.9 * (1 - t);
            requestAnimationFrame(step);
        };
        step();
        const smoke = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 8),
            new THREE.MeshBasicMaterial({ color: 0x444444, transparent: true, opacity: 0.5 }));
        smoke.position.set(targetX, cy + 0.3, targetZ);
        this.effectsGroup.add(smoke);
        this._effects.push({ obj: smoke, born: performance.now(), life: 800, kind: 'debris' });
    }

    /** Tank shell: flat fast shell with heavy impact (TANK, HEAVY_TANK). */
    addTankShell(attackerId, fromX, fromZ, toX, toZ) {
        const y0 = (this.tileHeights.get(`${fromX},${fromZ}`) || 0) + 0.25;
        const y1 = (this.tileHeights.get(`${toX},${toZ}`) || 0) + 0.1;
        const x0 = fromX - GRID_SIZE / 2, z0 = fromZ - GRID_SIZE / 2;
        const x1 = toX - GRID_SIZE / 2, z1 = toZ - GRID_SIZE / 2;
        // Muzzle flash
        const flash = new THREE.Mesh(new THREE.SphereGeometry(0.12, 6, 6),
            new THREE.MeshBasicMaterial({ color: 0xffaa44, transparent: true, opacity: 1 }));
        flash.position.set(x0, y0, z0);
        this.effectsGroup.add(flash);
        // Shell
        const shell = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 8),
            new THREE.MeshBasicMaterial({ color: 0x3a3a2a }));
        shell.position.set(x0, y0, z0);
        this.effectsGroup.add(shell);
        // Smoke trail
        const smokeTrail = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 6),
            new THREE.MeshBasicMaterial({ color: 0x888888, transparent: true, opacity: 0.5 }));
        smokeTrail.position.set(x0, y0, z0);
        this.effectsGroup.add(smokeTrail);
        const start = performance.now();
        const life = 280;
        const step = () => {
            const t = Math.min(1, (performance.now() - start) / life);
            if (t >= 1 || !shell.parent) {
                if (shell.parent) this._disposeAndRemove(shell);
                if (flash.parent) this._disposeAndRemove(flash);
                if (smokeTrail.parent) this._disposeAndRemove(smokeTrail);
                if (t >= 1) this._addImpactBurst(x1, y1, z1, 0xff6633, 550);
                return;
            }
            shell.position.set(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, z0 + (z1 - z0) * t);
            flash.material.opacity = 1 - t * 3;
            flash.scale.setScalar(1 + t * 2);
            smokeTrail.position.copy(shell.position);
            smokeTrail.material.opacity = 0.5 * (1 - t);
            smokeTrail.scale.setScalar(1 + t);
            requestAnimationFrame(step);
        };
        step();
        this._animateModel(attackerId, (m, t, p, r) => {
            const dx = toX - fromX, dz = toZ - fromZ;
            const len = Math.sqrt(dx * dx + dz * dz) || 1;
            const recoil = Math.sin(t * Math.PI) * 0.15;
            m.position.set(p.x - (dx / len) * recoil, p.y, p.z - (dz / len) * recoil);
        }, life);
    }

    /** Rocket: projectile with smoke trail (ANTI_TANK_GUN, RPG_TEAM). */
    addRocket(attackerId, fromX, fromZ, toX, toZ) {
        const y0 = (this.tileHeights.get(`${fromX},${fromZ}`) || 0) + 0.3;
        const y1 = (this.tileHeights.get(`${toX},${toZ}`) || 0) + 0.15;
        const x0 = fromX - GRID_SIZE / 2, z0 = fromZ - GRID_SIZE / 2;
        const x1 = toX - GRID_SIZE / 2, z1 = toZ - GRID_SIZE / 2;
        // Launch flash
        const flash = new THREE.Mesh(new THREE.SphereGeometry(0.08, 6, 6),
            new THREE.MeshBasicMaterial({ color: 0xffcc44, transparent: true, opacity: 1 }));
        flash.position.set(x0, y0, z0);
        this.effectsGroup.add(flash);
        // Rocket
        const rocket = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.03, 0.1, 6),
            new THREE.MeshBasicMaterial({ color: 0x4a5a3a }));
        rocket.position.set(x0, y0, z0);
        rocket.lookAt(x1, y1, z1);
        this.effectsGroup.add(rocket);
        // Smoke trail
        const trail = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 6),
            new THREE.MeshBasicMaterial({ color: 0x999999, transparent: true, opacity: 0.6 }));
        trail.position.set(x0, y0, z0);
        this.effectsGroup.add(trail);
        const start = performance.now();
        const life = 300;
        const step = () => {
            const t = Math.min(1, (performance.now() - start) / life);
            if (t >= 1 || !rocket.parent) {
                if (rocket.parent) this._disposeAndRemove(rocket);
                if (flash.parent) this._disposeAndRemove(flash);
                if (trail.parent) this._disposeAndRemove(trail);
                if (t >= 1) this._addImpactBurst(x1, y1, z1, 0xff8844, 450);
                return;
            }
            rocket.position.set(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t + Math.sin(t * Math.PI) * 0.3, z0 + (z1 - z0) * t);
            rocket.lookAt(x1, y1, z1);
            flash.material.opacity = 1 - t * 2;
            flash.scale.setScalar(1 + t * 2);
            trail.position.copy(rocket.position);
            trail.material.opacity = 0.6 * (1 - t);
            trail.scale.setScalar(1 + t * 1.5);
            requestAnimationFrame(step);
        };
        step();
        this._animateModel(attackerId, (m, t, p, r) => {
            const dx = toX - fromX, dz = toZ - fromZ;
            const len = Math.sqrt(dx * dx + dz * dz) || 1;
            const recoil = Math.sin(t * Math.PI) * 0.2;
            m.position.set(p.x - (dx / len) * recoil, p.y, p.z - (dz / len) * recoil);
            m.rotation.z = r.z + Math.sin(t * Math.PI) * 0.12;
        }, life);
    }

    /** Pike stab: longer thrust for polearm units (PIKEMAN, HALBERDIER, PIKE_MASTER). */
    addPikeStab(attackerId, fromX, fromZ, toX, toZ) {
        this._animateModel(attackerId, (m, t, p, r) => {
            const dx = toX - fromX, dz = toZ - fromZ;
            const len = Math.sqrt(dx * dx + dz * dz) || 1;
            // Long forward thrust, no rotation —the pike stays level
            const forward = Math.sin(t * Math.PI) * 0.6;
            m.position.set(p.x + (dx / len) * forward, p.y, p.z + (dz / len) * forward);
        }, 280);
    }

    /** Lord/king attack with faction-specific visuals. */
    addLordAttack(lordId, factionId, fromX, fromZ, toX, toZ) {
        let mesh = null;
        this.lordGroup.traverse(o => {
            if (o.userData && o.userData.lordId === lordId && !mesh) mesh = o;
        });
        if (!mesh) return;
        const startPos = mesh.position.clone();
        const startRot = mesh.rotation.clone();
        const y0 = startPos.y + 0.8;
        const x0 = startPos.x, z0 = startPos.z;
        const x1 = toX - GRID_SIZE / 2, z1 = toZ - GRID_SIZE / 2;
        const y1 = (this.tileHeights.get(`${toX},${toZ}`) || 0) + 0.5;
        const fid = factionId || '';
        const colorMap = {
            crimson: 0xff3322, verdant: 0x44cc44, violet: 0xcc66ff,
            azure: 0x4488ff, obsidian: 0x8800cc, iron: 0x888899,
            shadow: 0x6633aa, storm: 0x44ddff, frost: 0xaaddff,
            golden: 0xffd700, polish: 0xeeeeff, roman: 0xcc4444,
            byzantine: 0xff8800, spanish: 0xdd8833, viking: 0x88aacc
        };
        const color = colorMap[fid] || 0xffd700;
        const isKing = mesh.scale.x > 1.1; // kings are 1.25x
        const duration = isKing ? 380 : 320;
        // Faction-specific projectile or visual
        if (fid === 'storm') {
            // Lightning bolt
            const bolt = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.025, 0.3, 5),
                new THREE.MeshBasicMaterial({ color: 0x44ddff }));
            bolt.position.set(x0, y0, z0);
            bolt.lookAt(x1, y1, z1);
            this.effectsGroup.add(bolt);
            const glow = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 6),
                new THREE.MeshBasicMaterial({ color: 0x88ddff, transparent: true, opacity: 0.7 }));
            glow.position.set(x0, y0, z0);
            this.effectsGroup.add(glow);
            const t0 = performance.now();
            const l0 = 180;
            const step = () => {
                const t = Math.min(1, (performance.now() - t0) / l0);
                if (t >= 1 || !bolt.parent) {
                    if (bolt.parent) this._disposeAndRemove(bolt);
                    if (glow.parent) this._disposeAndRemove(glow);
                    if (t >= 1) this._addImpactBurst(x1, y1, z1, 0x88ddff, 300);
                    return;
                }
                bolt.position.set(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, z0 + (z1 - z0) * t);
                bolt.lookAt(x1, y1, z1);
                glow.position.copy(bolt.position);
                requestAnimationFrame(step);
            };
            step();
        } else if (fid === 'frost') {
            // Ice shard
            const shard = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.15, 5),
                new THREE.MeshBasicMaterial({ color: 0xaaddff }));
            shard.position.set(x0, y0, z0);
            shard.lookAt(x1, y1, z1);
            this.effectsGroup.add(shard);
            const t0 = performance.now();
            const l0 = 250;
            const step = () => {
                const t = Math.min(1, (performance.now() - t0) / l0);
                if (t >= 1 || !shard.parent) {
                    if (shard.parent) this._disposeAndRemove(shard);
                    if (t >= 1) this._addImpactBurst(x1, y1, z1, 0xaaddff, 350);
                    return;
                }
                shard.position.set(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t + Math.sin(t * Math.PI) * 0.4, z0 + (z1 - z0) * t);
                shard.rotation.x = t * Math.PI;
                requestAnimationFrame(step);
            };
            step();
        } else if (fid === 'iron') {
            // Heavy hammer smash —big impact ring at target, no projectile
            const t0 = performance.now();
            setTimeout(() => this._addImpactBurst(x1, y1, z1, 0x888899, 500), 200);
        } else if (fid === 'shadow') {
            // Dagger toss —small fast projectile
            const dagger = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.015, 0.1),
                new THREE.MeshBasicMaterial({ color: 0x6633aa }));
            dagger.position.set(x0, y0, z0);
            dagger.lookAt(x1, y1, z1);
            this.effectsGroup.add(dagger);
            const t0 = performance.now();
            const step = () => {
                const t = Math.min(1, (performance.now() - t0) / 200);
                if (t >= 1 || !dagger.parent) {
                    if (dagger.parent) this._disposeAndRemove(dagger);
                    return;
                }
                dagger.position.set(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, z0 + (z1 - z0) * t);
                requestAnimationFrame(step);
            };
            step();
        } else if (fid === 'crimson' || fid === 'obsidian' || fid === 'roman') {
            // Melee slash/stab —colored blade arc model animation only
            // (no projectile, just the lunge)
        } else if (fid === 'violet') {
            // Magic orb
            const orb = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 8),
                new THREE.MeshBasicMaterial({ color: 0xcc66ff }));
            orb.position.set(x0, y0, z0);
            this.effectsGroup.add(orb);
            const t0 = performance.now();
            const step = () => {
                const t = Math.min(1, (performance.now() - t0) / 280);
                if (t >= 1 || !orb.parent) {
                    if (orb.parent) this._disposeAndRemove(orb);
                    if (t >= 1) this._addImpactBurst(x1, y1, z1, 0xcc66ff, 350);
                    return;
                }
                orb.position.set(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t + Math.sin(t * Math.PI) * 0.3, z0 + (z1 - z0) * t);
                orb.scale.setScalar(1 + Math.sin(t * Math.PI) * 0.5);
                requestAnimationFrame(step);
            };
            step();
        } else {
            // Default: colored energy bolt
            const bolt = new THREE.Mesh(new THREE.SphereGeometry(0.04, 6, 6),
                new THREE.MeshBasicMaterial({ color }));
            bolt.position.set(x0, y0, z0);
            this.effectsGroup.add(bolt);
            const t0 = performance.now();
            const step = () => {
                const t = Math.min(1, (performance.now() - t0) / 250);
                if (t >= 1 || !bolt.parent) {
                    if (bolt.parent) this._disposeAndRemove(bolt);
                    if (t >= 1) this._addImpactBurst(x1, y1, z1, color, 300);
                    return;
                }
                bolt.position.set(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t + Math.sin(t * Math.PI) * 0.3, z0 + (z1 - z0) * t);
                requestAnimationFrame(step);
            };
            step();
        }
        // Model lunge
        const dx = toX - fromX, dz = toZ - fromZ;
        const len = Math.sqrt(dx * dx + dz * dz) || 1;
        const lungeStart = performance.now();
        const loop = () => {
            const t = Math.min(1, (performance.now() - lungeStart) / duration);
            if (t < 1) {
                const forward = Math.sin(t * Math.PI) * 0.5;
                mesh.position.set(startPos.x + (dx / len) * forward, startPos.y, startPos.z + (dz / len) * forward);
                mesh.rotation.z = startRot.z + Math.sin(t * Math.PI) * 0.25;
                requestAnimationFrame(loop);
            } else {
                mesh.position.copy(startPos);
                mesh.rotation.copy(startRot);
            }
        };
        loop();
    }

    getIntersects(mouse, camera) {
        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(mouse, camera);
        return raycaster.intersectObjects(this.scene.children, true);
    }

    // --- Ownership + highlight painting ---
    setOwnershipEmissive(mesh, owner) {
        const fc = owner ? this.fcolor(this._gs, owner) : null;
        if (fc) {
            mesh.material.emissive = new THREE.Color(fc.tile);
            mesh.material.emissiveIntensity = 0.5;
        } else {
            mesh.material.emissive = new THREE.Color(0x000000);
            mesh.material.emissiveIntensity = 0;
        }
    }

    clearHighlights() {
        const visible = this._fogVisible || null;
        const explored = this._fogExplored || null;
        for (const mesh of this.tileMeshes.values()) {
            const key = `${mesh.userData.x},${mesh.userData.z}`;
            if (explored && !explored.has(key)) continue;
            if (visible && !visible.has(key)) {
                mesh.material.emissive = new THREE.Color(0x050505);
                mesh.material.emissiveIntensity = 0;
                continue;
            }
            this.setOwnershipEmissive(mesh, mesh.userData.owner);
        }
    }

    // --- City area-of-influence overlay (Civ 6 style) ---
    showInfluence(tiles, owner, radius) {
        this.clearInfluence();
        if (!this.influenceGroup) {
            this.influenceGroup = new THREE.Group();
            this.scene.add(this.influenceGroup);
        }
        const fc = this.fcolor(this._gs, owner) || { tile: 0xffffff };
        const geo = new THREE.CircleGeometry(radius + 0.5, 48);
        for (const t of tiles.values()) {
            if (t.owner !== owner || t.terrain !== 'CITY') continue;
            const mat = new THREE.MeshBasicMaterial({
                color: fc.tile, transparent: true, opacity: 0.14, depthWrite: false
            });
            const disc = new THREE.Mesh(geo, mat);
            disc.rotation.x = -Math.PI / 2;
            disc.position.set(t.x - GRID_SIZE / 2, 0.95, t.z - GRID_SIZE / 2);
            this.influenceGroup.add(disc);
        }
    }

    clearInfluence() {
        if (this.influenceGroup) this._disposeGroupChildren(this.influenceGroup);
    }

    highlightMoveTargets(keys) {
        for (const key of keys) {
            const mesh = this.tileMeshes.get(key);
            if (mesh && mesh.visible) {
                mesh.material.emissive = new THREE.Color(HIGHLIGHT_MOVE);
                mesh.material.emissiveIntensity = 0.7;
            }
        }
    }

    highlightAttackTargets(units) {
        for (const unit of units) {
            const mesh = this.tileMeshes.get(`${unit.x},${unit.z}`);
            if (mesh && mesh.visible) {
                mesh.material.emissive = new THREE.Color(HIGHLIGHT_ATTACK);
                mesh.material.emissiveIntensity = 0.8;
            }
        }
    }

    highlightBridgeTargets(tiles) {
        for (const t of tiles) {
            const mesh = this.tileMeshes.get(`${t.x},${t.z}`);
            if (mesh && mesh.visible) {
                mesh.material.emissive = new THREE.Color(0x22bb88); // teal = build-bridge target
                mesh.material.emissiveIntensity = 0.75;
            }
        }
    }

    highlightChargeTargets(units) {
        for (const unit of units) {
            const mesh = this.tileMeshes.get(`${unit.x},${unit.z}`);
            if (mesh && mesh.visible) {
                mesh.material.emissive = new THREE.Color(0xff8800); // orange = charge target
                mesh.material.emissiveIntensity = 0.85;
            }
        }
    }

    /** Highlight chariot charge landing tiles (Map of tileKey -> lane). */
    highlightChariotChargeTargets(targets) {
        if (!targets) return;
        const keys = targets instanceof Map ? [...targets.keys()] : targets;
        for (const key of keys) {
            const mesh = this.tileMeshes.get(key);
            if (mesh && mesh.visible) {
                mesh.material.emissive = new THREE.Color(0xffcc00); // gold = chariot charge lane
                mesh.material.emissiveIntensity = 0.9;
            }
        }
    }

    // --- Detailed unit models (multi-part groups instead of single shapes) ---
    // Each model is a Group whose origin sits at the unit's feet (y=0); the
    // render loop places it on top of its tile. A shared accent palette gives
    // every faction's units readable detail (skin, wood, metal, cloth) while
    // the body color carries the faction identity.
    _unitPalette(color) {
        const key = color;
        if (!this._unitPaletteCache[key]) {
            const palette = {
                body:   new THREE.MeshPhongMaterial({ color, shininess: 30 }),
                armor:  new THREE.MeshPhongMaterial({ color, shininess: 80 }),
                skin:   new THREE.MeshPhongMaterial({ color: 0xe0b080 }),
                wood:   new THREE.MeshPhongMaterial({ color: 0x6a4220 }),
                darkWood: new THREE.MeshPhongMaterial({ color: 0x4a3015 }),
                metal:  new THREE.MeshPhongMaterial({ color: 0xc0c4cc, shininess: 90 }),
                dark:   new THREE.MeshPhongMaterial({ color: 0x23232a }),
                cloth:  new THREE.MeshPhongMaterial({ color: 0x8a3b2a }),
                white:  new THREE.MeshPhongMaterial({ color: 0xf2f2f0 }),
                sail:   new THREE.MeshPhongMaterial({ color: 0xeae4d2, side: THREE.DoubleSide })
            };
            for (const mat of Object.values(palette)) this._matCacheSet.add(mat);
            this._unitPaletteCache[key] = palette;
        }
        return this._unitPaletteCache[key];
    }

    _addHumanoid(g, P, opts = {}) {
        const tall = opts.tall ? 1.18 : 1;
        // Legs
        for (const sx of [-0.05, 0.05]) {
            const leg = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.2 * tall, 0.08), P.dark);
            leg.position.set(sx, 0.1 * tall, 0); g.add(leg);
        }
        // Torso
        const torso = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.24 * tall, 0.13),
            opts.armor ? P.armor : P.body);
        torso.position.y = 0.34 * tall; g.add(torso);
        // Belt/skirt accent
        const belt = new THREE.Mesh(new THREE.BoxGeometry(0.21, 0.05, 0.14), P.cloth);
        belt.position.y = 0.24 * tall; g.add(belt);
        // Arms
        for (const sx of [-0.13, 0.13]) {
            const arm = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.2 * tall, 0.05),
                opts.armor ? P.armor : P.body);
            arm.position.set(sx, 0.35 * tall, 0); g.add(arm);
        }
        // Head + helmet
        const head = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 8), P.skin);
        head.position.y = 0.53 * tall; g.add(head);
        const helm = new THREE.Mesh(new THREE.SphereGeometry(0.075, 8, 8, 0, Math.PI * 2, 0, Math.PI / 2),
            opts.helmet ? P.metal : P.dark);
        helm.position.y = 0.545 * tall; g.add(helm);
        return tall;
    }

    /** Create a small decorative animal companion at ground level. */
    _makeAnimal(type) {
        const g = new THREE.Group();
        if (type === 'BEAR') {
            const fur = new THREE.MeshPhongMaterial({ color: 0x5a3a1a });
            const body = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.08, 0.18), fur);
            body.position.y = 0.04; g.add(body);
            const head = new THREE.Mesh(new THREE.SphereGeometry(0.045, 6, 6), fur);
            head.position.set(0, 0.08, 0.1); g.add(head);
            for (const sx of [-0.03, 0.03]) {
                const ear = new THREE.Mesh(new THREE.SphereGeometry(0.015, 5, 5), fur);
                ear.position.set(sx, 0.1, 0.08); g.add(ear);
            }
        } else if (type === 'BOAR') {
            const hide = new THREE.MeshPhongMaterial({ color: 0x4a3a2a });
            const body = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.06, 0.14), hide);
            body.position.y = 0.03; g.add(body);
            const snout = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.06, 6), hide);
            snout.rotation.x = -Math.PI / 2;
            snout.position.set(0, 0.05, 0.08); g.add(snout);
            for (const sx of [-0.02, 0.02]) {
                const tusk = new THREE.Mesh(new THREE.ConeGeometry(0.006, 0.02, 4), new THREE.MeshPhongMaterial({ color: 0xf2f2f0 }));
                tusk.position.set(sx, 0.04, 0.1); tusk.rotation.x = 0.5; g.add(tusk);
            }
        } else if (type === 'WOLF') {
            const pelt = new THREE.MeshPhongMaterial({ color: 0x6a6a7a });
            const body = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.18), pelt);
            body.position.y = 0.03; g.add(body);
            const head = new THREE.Mesh(new THREE.SphereGeometry(0.035, 6, 6), pelt);
            head.position.set(0, 0.07, 0.1); g.add(head);
            for (const sx of [-0.015, 0.015]) {
                const ear = new THREE.Mesh(new THREE.ConeGeometry(0.01, 0.025, 4), pelt);
                ear.position.set(sx, 0.085, 0.08); g.add(ear);
            }
            const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.01, 0.06, 4), pelt);
            tail.position.set(0, 0.04, -0.1); g.add(tail);
        } else if (type === 'RAVEN') {
            const body = new THREE.Mesh(new THREE.SphereGeometry(0.035, 6, 6), new THREE.MeshPhongMaterial({ color: 0x1a1a1a }));
            body.position.y = 0.05; g.add(body);
            const beak = new THREE.Mesh(new THREE.ConeGeometry(0.01, 0.03, 4), new THREE.MeshPhongMaterial({ color: 0xcc8833 }));
            beak.position.set(0, 0.055, 0.04); g.add(beak);
        } else if (type === 'EAGLE') {
            const white = new THREE.MeshPhongMaterial({ color: 0xf2f2f0 });
            const body = new THREE.Mesh(new THREE.SphereGeometry(0.04, 6, 6), white);
            body.position.y = 0.06; g.add(body);
            const beak = new THREE.Mesh(new THREE.ConeGeometry(0.01, 0.03, 4), new THREE.MeshPhongMaterial({ color: 0xcc8833 }));
            beak.position.set(0, 0.07, 0.04); g.add(beak);
            for (const sx of [-0.06, 0.06]) {
                const wing = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.01, 0.04), white);
                wing.position.set(sx, 0.06, 0); g.add(wing);
            }
        } else if (type === 'LION') {
            const mane = new THREE.MeshPhongMaterial({ color: 0xcc8833 });
            const body = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.07, 0.16), mane);
            body.position.y = 0.035; g.add(body);
            const head = new THREE.Mesh(new THREE.SphereGeometry(0.045, 6, 6), mane);
            head.position.set(0, 0.085, 0.09); g.add(head);
            const maneRing = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.015, 6, 12), mane);
            maneRing.position.set(0, 0.09, 0.07); maneRing.rotation.x = 0.3; g.add(maneRing);
        }
        return g;
    }

    _addShield(g, P, side) {
        const s = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.07, 0.02, 8), P.metal);
        s.rotation.x = Math.PI / 2;
        s.position.set(side * 0.17, 0.34, 0.02); g.add(s);
    }

    _addBow(g, P, x, height, scale) {
        const bow = new THREE.Mesh(new THREE.TorusGeometry(0.12 * scale, 0.012, 6, 12, Math.PI * 1.2), P.wood);
        bow.rotation.y = Math.PI / 2;
        bow.rotation.z = -0.2;
        bow.position.set(x, height, 0.08);
        g.add(bow);
        // Bowstring
        const string = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.22 * scale, 4), P.dark);
        string.position.set(x, height, 0.13);
        g.add(string);
    }

    /** Add a horse body to group g. Returns the horse group so the caller can
     *  reposition it. Mirrors the inline horse build in CAVALRY/CATAPHRACT. */
    _addHorse(g, P, opts = {}) {
        const bodyMat = opts.armored ? P.armor : P.body;
        const body = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.2, 0.46), bodyMat);
        body.position.y = 0.3; g.add(body);
        const neck = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.18, 0.1), bodyMat);
        neck.position.set(0, 0.4, 0.24); g.add(neck);
        const head = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.09, 0.14), P.skin);
        head.position.set(0, 0.5, 0.3); g.add(head);
        for (const [sx, sz] of [[-0.08, 0.16], [0.08, 0.16], [-0.08, -0.16], [0.08, -0.16]]) {
            const leg = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.24, 0.05), P.dark);
            leg.position.set(sx, 0.12, sz); g.add(leg);
        }
        const tail = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.14, 0.04), P.dark);
        tail.position.set(0, 0.26, -0.24); g.add(tail);
        return g;
    }

    /** Build a mounted unit: horse + rider + distinctive weapon/helmet/wings.
     *  Used for CAVALRY, CATAPHRACT, DRAGOON, WINGED_HUSSAR, CONQUISTADOR,
     *  MERCENARY_KNIGHT and FRONTIERSMAN to keep cavalry silhouettes consistent. */
    _addCavalry(g, P, opts = {}) {
        const armored = opts.armored || false;
        const weapon = opts.weapon || 'saber';
        const wings = opts.wings || false;
        const morion = opts.morion || false;
        const riderArmor = opts.riderArmor !== undefined ? opts.riderArmor : armored;
        const riderHelmet = opts.riderHelmet !== undefined ? opts.riderHelmet : true;
        const tall = opts.tall || false;
        if (armored) {
            const body = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.22, 0.5), P.armor);
            body.position.y = 0.34; g.add(body);
            const neck = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.2, 0.12), P.armor);
            neck.position.set(0, 0.42, 0.28); g.add(neck);
            const head = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.16), P.body);
            head.position.set(0, 0.5, 0.36); g.add(head);
            for (const [sx, sz] of [[-0.1, 0.18], [0.1, 0.18], [-0.1, -0.18], [0.1, -0.18]]) {
                const leg = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.26, 0.06), P.dark);
                leg.position.set(sx, 0.13, sz); g.add(leg);
            }
            const tail = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.16, 0.04), P.dark);
            tail.position.set(0, 0.28, -0.27); g.add(tail);
        } else {
            const body = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.2, 0.46), P.body);
            body.position.y = 0.3; g.add(body);
            const neck = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.18, 0.1), P.body);
            neck.position.set(0, 0.4, 0.24); g.add(neck);
            const head = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.09, 0.14), P.skin);
            head.position.set(0, 0.5, 0.3); g.add(head);
            for (const [sx, sz] of [[-0.08, 0.16], [0.08, 0.16], [-0.08, -0.16], [0.08, -0.16]]) {
                const leg = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.24, 0.05), P.dark);
                leg.position.set(sx, 0.12, sz); g.add(leg);
            }
            const tail = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.14, 0.04), P.dark);
            tail.position.set(0, 0.26, -0.24); g.add(tail);
        }
        const rider = new THREE.Group();
        const rt = this._addHumanoid(rider, P, { armor: riderArmor, helmet: riderHelmet, tall });
        rider.position.set(0, armored ? 0.46 : 0.42, -0.05);
        g.add(rider);
        if (weapon === 'lance') {
            const lance = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.7, 6), P.wood);
            lance.rotation.z = 0.35;
            lance.position.set(0.18, armored ? 0.7 : 0.65, 0.1);
            g.add(lance);
        } else if (weapon === 'saber') {
            const saber = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.2, 0.04), P.metal);
            saber.position.set(0.16, armored ? 0.6 : 0.55, 0.05);
            g.add(saber);
        } else if (weapon === 'carbine') {
            const carbine = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.2, 0.03), P.metal);
            carbine.position.set(0.16, armored ? 0.6 : 0.55, 0.05);
            g.add(carbine);
        } else if (weapon === 'arquebus') {
            const gun = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.28, 0.04), P.dark);
            gun.position.set(0.16, armored ? 0.62 : 0.57, 0.06);
            g.add(gun);
        } else if (weapon === 'bow') {
            this._addBow(g, P, 0.16, armored ? 0.62 : 0.58, 1);
        }
        if (wings) {
            for (const sx of [-0.12, 0.12]) {
                const wing = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.3, 0.18),
                    new THREE.MeshPhongMaterial({ color: 0xf2f2f0, side: THREE.DoubleSide }));
                wing.position.set(sx, armored ? 0.7 : 0.65, -0.12);
                wing.rotation.x = 0.3;
                g.add(wing);
            }
        }
        if (morion) {
            const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.02, 12), P.metal);
            brim.position.set(0, rt * 0.545 + 0.02, 0);
            rider.add(brim);
            const comb = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.06, 0.12), P.metal);
            comb.position.set(0, rt * 0.545 + 0.06, 0);
            rider.add(comb);
        }
        return g;
    }

    /** Build a wheeled cannon/barrel rig. Used by CANNON, FIELD_GUN, SIEGE_CANNON,
     *  HORSE_ARTILLERY and ANTI_TANK_GUN to keep artillery silhouettes consistent. */
    _addCannon(g, P, opts = {}) {
        const carriageW = opts.carriageW ?? 0.3;
        const carriageH = opts.carriageH ?? 0.1;
        const carriageD = opts.carriageD ?? 0.45;
        const carriageColor = opts.carriageColor || P.darkWood;
        const base = new THREE.Mesh(new THREE.BoxGeometry(carriageW, carriageH, carriageD), carriageColor);
        base.position.y = carriageH / 2;
        g.add(base);
        if (opts.shield) {
            const s = new THREE.Mesh(new THREE.BoxGeometry(opts.shield.w, opts.shield.h, 0.02), P.metal);
            s.position.set(0, carriageH / 2 + opts.shield.h / 2, opts.shield.z);
            g.add(s);
        }
        const wheels = opts.wheels || [{ x: -0.18, z: -0.05 }, { x: 0.18, z: -0.05 }];
        const wheelRadius = opts.wheelRadius ?? 0.12;
        const wheelWidth = opts.wheelWidth ?? 0.03;
        const wheelColor = opts.wheelColor || P.wood;
        const wheelY = opts.wheelY ?? wheelRadius;
        for (const w of wheels) {
            const wheel = new THREE.Mesh(new THREE.CylinderGeometry(wheelRadius, wheelRadius, wheelWidth, 12), wheelColor);
            wheel.rotation.z = Math.PI / 2;
            wheel.position.set(w.x, wheelY, w.z);
            g.add(wheel);
        }
        const barrelRTop = opts.barrelRTop ?? 0.035;
        const barrelRBot = opts.barrelRBot ?? 0.055;
        const barrelLen = opts.barrelLen ?? 0.5;
        const barrelColor = opts.barrelColor || P.metal;
        const barrelAngle = opts.barrelAngle ?? Math.PI / 2.2;
        const barrelY = opts.barrelY ?? 0.22;
        const barrelZ = opts.barrelZ ?? 0.05;
        const barrel = new THREE.Mesh(new THREE.CylinderGeometry(barrelRTop, barrelRBot, barrelLen, 10), barrelColor);
        barrel.rotation.x = barrelAngle;
        barrel.position.set(0, barrelY, barrelZ);
        g.add(barrel);
        return g;
    }

    /** Build a basic ship hull/deck/bow. Used by makeShipModel for every vessel. */
    _addShipHull(g, P, opts = {}) {
        const length = opts.length ?? 1.0;
        const width = opts.width ?? 0.56;
        const height = opts.height ?? 0.2;
        const submarine = opts.submarine ?? false;
        const metal = opts.metal ?? false;
        const hullH = submarine ? 0.16 : height;
        const hullMat = metal ? P.metal : P.darkWood;
        const hull = new THREE.Mesh(new THREE.BoxGeometry(width, hullH, length), hullMat);
        hull.position.y = submarine ? 0.08 : height / 2;
        g.add(hull);
        const deckMat = metal ? P.dark : P.wood;
        const deck = new THREE.Mesh(new THREE.BoxGeometry(width * 0.86, 0.05, length * 0.9), deckMat);
        deck.position.y = submarine ? 0.14 : 0.2;
        g.add(deck);
        if (!submarine) {
            const bowMat = metal ? P.metal : P.darkWood;
            const bow = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.22, 4), bowMat);
            bow.rotation.x = Math.PI / 2;
            bow.rotation.y = Math.PI / 4;
            bow.position.set(0, 0.12, length / 2 + 0.06);
            g.add(bow);
        }
        return g;
    }

    makeShipModel(type, color) {
        const P = this._unitPalette(color);
        const g = new THREE.Group();
        const isTransport = ['TRANSPORT', 'STEAM_TRANSPORT', 'MERCHANTMAN', 'TRANSPORT_SHIP'].includes(type);
        const isAncient = ['GALLEY', 'TRIREME', 'GALLEASS'].includes(type);
        const isMultiMast = ['GALLEON', 'MAN_OF_WAR', 'FROLIC'].includes(type);
        const isLightSail = ['FRIGATE', 'CORVETTE', 'PINNACE', 'FRIGATE_2', 'CARAVEL'].includes(type);
        const isIronclad = ['IRONCLAD', 'IRONCLAD_FRIGATE', 'BATTLESHIP', 'DESTROYER', 'MONITOR'].includes(type);
        const isSub = ['SUBMARINE', 'SUBMARINE_II'].includes(type);
        const isTorpedo = ['TORPEDO_BOAT', 'GUNBOAT'].includes(type);
        const isCarrier = type === 'AIRCRAFT_CARRIER';
        let length = 1.0;
        let width = 0.56;
        let metal = false;
        if (isTransport) { length = 0.72; width = 0.64; }
        else if (isAncient) { length = 0.9; width = 0.46; }
        else if (isMultiMast) { length = 1.05; width = 0.58; }
        else if (isLightSail) { length = 0.86; width = 0.42; }
        else if (isIronclad) { length = 1.0; width = 0.56; }
        else if (isTorpedo) { length = 0.7; width = 0.34; metal = true; }
        else if (isSub) { length = 0.56; width = 0.46; }
        else if (isCarrier) { length = 1.15; width = 0.6; metal = true; }
        this._addShipHull(g, P, { length, width, metal, submarine: isSub });
        if (isSub) {
            const tower = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.12, 0.16), P.metal);
            tower.position.set(0, 0.2, -0.04); g.add(tower);
            const prop = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.24, 8), P.dark);
            prop.rotation.z = Math.PI / 2;
            prop.position.set(0, 0.12, 0.14); g.add(prop);
            if (type === 'SUBMARINE_II') {
                const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.1, 6), P.metal);
                scope.position.set(0, 0.27, -0.04); g.add(scope);
            }
        } else if (isCarrier) {
            const flightDeck = new THREE.Mesh(new THREE.BoxGeometry(width * 0.92, 0.04, length * 0.95), P.dark);
            flightDeck.position.y = 0.22; g.add(flightDeck);
            const island = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.18, 0.22), P.metal);
            island.position.set(width * 0.25, 0.32, -0.15); g.add(island);
            const plane = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.03, 0.18), P.white);
            plane.position.set(0.05, 0.25, 0.18); g.add(plane);
        } else if (isIronclad) {
            // Ironclads share a hull but get distinct tall superstructures so
            // each steamship reads at a glance:
            //  - IRONCLAD / IRONCLAD_FRIGATE: low casemate + tumblehome hull,
            //    single funnel, broadside gunports.
            //  - MONITOR: flat low profile, single rotating turret, no masts.
            //  - BATTLESHIP: tall two-funnel silhouette, two big turrets with
            //    long barrels, raised bridge.
            //  - DESTROYER: long slim hull, raked twin funnels, small guns fwd/aft.
            const isBattle = type === 'BATTLESHIP';
            const isDestroyer = type === 'DESTROYER';
            const isMonitor = type === 'MONITOR';
            if (isMonitor) {
                const casemate = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.06, 0.34), P.metal);
                casemate.position.y = 0.24; g.add(casemate);
                const turret = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.11, 0.16, 12), P.dark);
                turret.rotation.x = Math.PI / 2;
                turret.position.set(0, 0.3, 0.02); g.add(turret);
                const gb = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.026, 0.34, 8), P.dark);
                gb.rotation.x = Math.PI / 2.1; gb.position.set(0, 0.3, 0.18); g.add(gb);
                const smokebox = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.035, 0.14, 8), P.dark);
                smokebox.position.set(-0.1, 0.3, -0.12); g.add(smokebox);
            } else {
                // Funnels: raked for destroyers, straight for battleships.
                const funnelCount = isBattle || isDestroyer ? 2 : 1;
                for (let i = 0; i < funnelCount; i++) {
                    const fr = i === 0 ? -0.08 : 0.02;
                    const funnel = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.04, isDestroyer ? 0.3 : 0.26, 8), P.dark);
                    funnel.position.set(fr, 0.36, -0.12 - i * 0.22);
                    if (isDestroyer) funnel.rotation.z = 0.35 - i * 0.18;
                    g.add(funnel);
                }
                // Raised bridge superstructure amidships.
                const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.1, isDestroyer ? 0.16 : 0.2), P.metal);
                bridge.position.set(0, 0.3, -0.02); g.add(bridge);
                if (isDestroyer) {
                    for (const sz of [0.2, -0.24]) {
                        const gun = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.016, 0.2, 8), P.dark);
                        gun.rotation.x = Math.PI / 2; gun.position.set(0, 0.32, sz); g.add(gun);
                    }
                } else {
                    // Turrets with barrels forward and aft.
                    for (const sz of [0.22, -0.28]) {
                        const turret = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.1, 0.13, 12), P.dark);
                        turret.rotation.x = Math.PI / 2;
                        turret.position.set(0, 0.27, sz); g.add(turret);
                        const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.02, 0.3, 8), P.dark);
                        barrel.rotation.x = Math.PI / 2;
                        barrel.position.set(0, 0.27, sz + 0.2); g.add(barrel);
                    }
                    if (isBattle) {
                        // Extra main turret amidships for the big-gun silhouette.
                        const mt = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.16, 12), P.dark);
                        mt.rotation.x = Math.PI / 2;
                        mt.position.set(0, 0.28, 0.12); g.add(mt);
                        const mb = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.028, 0.36, 8), P.dark);
                        mb.rotation.x = Math.PI / 2;
                        mb.position.set(0, 0.28, 0.32); g.add(mb);
                    }
                }
            }
        } else if (isTorpedo) {
            const gun = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.025, 0.22, 8), P.dark);
            gun.rotation.x = Math.PI / 2; gun.position.set(0, 0.24, 0.1); g.add(gun);
            for (const sx of [-0.06, 0.06]) {
                const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.16, 8), P.metal);
                tube.rotation.x = Math.PI / 2;
                tube.position.set(sx, 0.2, length / 2 - 0.05); g.add(tube);
            }
        } else if (isTransport) {
            const crate = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.16, 0.28), P.wood);
            crate.position.y = 0.3; g.add(crate);
            if (type === 'STEAM_TRANSPORT' || type === 'TRANSPORT_SHIP') {
                const stack = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.24, 6), P.metal);
                stack.position.set(0.16, 0.24, -0.12); g.add(stack);
                if (type === 'TRANSPORT_SHIP') {
                    const stack2 = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.24, 6), P.metal);
                    stack2.position.set(-0.16, 0.24, -0.12); g.add(stack2);
                }
            } else if (type === 'MERCHANTMAN') {
                const stack = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.2, 6), P.metal);
                stack.position.set(0.12, 0.22, -0.1); g.add(stack);
            }
        } else if (isAncient) {
            for (const sz of [-length * 0.32, length * 0.32]) {
                const oar = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.4, 5), P.wood);
                oar.rotation.x = Math.PI / 2;
                oar.position.set(0, 0.18, sz); g.add(oar);
            }
            const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.55, 6), P.darkWood);
            mast.position.y = 0.42; g.add(mast);
            const sail = new THREE.Mesh(new THREE.PlaneGeometry(0.32, 0.34), P.sail);
            sail.position.set(0.02, 0.48, 0); g.add(sail);
            const flag = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.12, 0.1),
                new THREE.MeshPhongMaterial({ color }));
            flag.position.set(0, 0.62, -0.28); g.add(flag);
        } else if (isMultiMast) {
            const mastCount = type === 'MAN_OF_WAR' ? 3 : 2;
            for (let i = 0; i < mastCount; i++) {
                const z = -length * 0.25 + i * length * 0.25;
                const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.028, 0.6, 6), P.darkWood);
                mast.position.set(0, 0.45, z); g.add(mast);
                const sail = new THREE.Mesh(new THREE.PlaneGeometry(0.28, 0.34), P.sail);
                sail.position.set(0.02, 0.5, z); g.add(sail);
            }
            const flag = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.12, 0.1),
                new THREE.MeshPhongMaterial({ color }));
            flag.position.set(0, 0.65, -length * 0.35); g.add(flag);
        } else if (isLightSail) {
            const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.028, 0.58, 6), P.darkWood);
            mast.position.y = 0.44; g.add(mast);
            const sail = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.36), P.sail);
            sail.position.set(0.02, 0.5, 0); g.add(sail);
            const flag = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.12, 0.1),
                new THREE.MeshPhongMaterial({ color }));
            flag.position.set(0, 0.65, -0.28); g.add(flag);
        }
        return g;
    }

    makeLordModel(lord, fc, factionId) {
        const g = new THREE.Group();
        const isKing = lord.isKing;
        const s = isKing ? 1.25 : 1.0;
        const cls = LORD_CLASSES[lord.class] || {};
        const bonus = cls.bonus || {};

        // Faction body color carries faction identity; emissive glow makes lords
        // readable against any terrain (the old class-only colors made every
        // Warlord look identical regardless of faction).
        const bodyColor = fc ? fc.unit : 0xffd700;
        const P = this._unitPalette(bodyColor);
        // King trim: gold accent material for crowns/capes
        const goldMat = new THREE.MeshPhongMaterial({ color: 0xffd700, emissive: 0xffd700, emissiveIntensity: isKing ? 0.5 : 0.25 });
        const emissive = new THREE.Color(bodyColor);
        const emInt = isKing ? 0.35 : 0.22;

        // Class-based weapon accessory (held in addition to faction weapon)
        const addClassWeapon = (tall) => {
            if (lord.class === 'WARLORD') {
                // Greatsword across back
                const blade = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.4, 0.1), P.metal);
                blade.position.set(0, 0.5 * tall, -0.1); blade.rotation.x = 0.2; g.add(blade);
            } else if (lord.class === 'GUARDIAN') {
                // Tower shield on left arm
                const shield = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.28, 0.03), P.metal);
                shield.position.set(-0.2, 0.34 * tall, 0.06); g.add(shield);
            } else if (lord.class === 'CONQUEROR') {
                // Banner pole
                const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.55, 5), P.wood);
                pole.position.set(0.18, 0.55 * tall, -0.08); g.add(pole);
                const banner = new THREE.Mesh(new THREE.PlaneGeometry(0.14, 0.18),
                    new THREE.MeshPhongMaterial({ color: bodyColor, side: THREE.DoubleSide }));
                banner.position.set(0.18, 0.7 * tall, -0.08); g.add(banner);
            } else if (lord.class === 'GRAND_COMMANDER') {
                // Command staff
                const staff = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.6, 6), P.wood);
                staff.position.set(0.18, 0.5 * tall, 0.04); g.add(staff);
                const orb = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 8), goldMat);
                orb.position.set(0.18, 0.82 * tall, 0.04); g.add(orb);
            }
        };

        // King cape: a draped box behind the torso
        const addCape = (tall) => {
            const cape = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.34 * tall, 0.04),
                new THREE.MeshPhongMaterial({ color: isKing ? 0x8a1a1a : bodyColor, side: THREE.DoubleSide }));
            cape.position.set(0, 0.36 * tall, -0.1); g.add(cape);
        };

        // King-specific jewelry, 3D crown, and regalia. Adds to targetGroup
        // (rider for mounted lords, g for foot lords) so coordinates are
        // relative to the humanoid body.
        const addKingRegalia = (tall, targetGroup) => {
            if (!isKing) return;
            const kg = targetGroup || g;
            // Gold gorget (collar ring at neck level)
            const gorget = new THREE.Mesh(new THREE.TorusGeometry(0.08, 0.015, 8, 16), goldMat);
            gorget.position.y = 0.49 * tall; kg.add(gorget);
            // Gold arm rings
            for (const sx of [-0.13, 0.13]) {
                const armRing = new THREE.Mesh(new THREE.TorusGeometry(0.04, 0.008, 6, 12), goldMat);
                armRing.position.set(sx, 0.38 * tall, 0); kg.add(armRing);
            }
            // 3D crown (ring + spikes + gem)
            const crownRing = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.012, 8, 16), goldMat);
            crownRing.position.y = 0.56 * tall; kg.add(crownRing);
            for (let i = 0; i < 5; i++) {
                const angle = (i / 5) * Math.PI * 2;
                const spike = new THREE.Mesh(new THREE.ConeGeometry(0.012, 0.04, 5), goldMat);
                spike.position.set(Math.cos(angle) * 0.06, 0.59 * tall, Math.sin(angle) * 0.06);
                kg.add(spike);
            }
            // Crown gem
            const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.02),
                new THREE.MeshPhongMaterial({ color: bodyColor, emissive: bodyColor, emissiveIntensity: 0.7 }));
            gem.position.y = 0.6 * tall; kg.add(gem);
        };

        // Build the lord body + faction-specific decoration
        const fid = factionId || '';
        const tall = 1;
        if (['golden', 'polish', 'roman', 'byzantine', 'spanish'].includes(fid)) {
            // ---- Mounted lord (horse) ----
            this._addHorse(g, P, { armored: fid === 'roman' || fid === 'byzantine' });
            const rider = new THREE.Group();
            const rt = this._addHumanoid(rider, P, { armor: true, helmet: true, tall: true });
            rider.position.set(0, 0.46, -0.05); g.add(rider);
            addClassWeapon(rt);
            addCape(rt);
            addKingRegalia(rt, rider);
            // Faction-specific rider weapon
            if (fid === 'golden' || fid === 'polish') {
                // Lance
                const lance = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.8, 6), P.wood);
                lance.rotation.z = 0.3; lance.position.set(0.18, 0.7, 0.1); g.add(lance);
            } else if (fid === 'roman') {
                // Gladius (short sword)
                const gladius = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.2, 0.04), P.metal);
                gladius.position.set(0.16, 0.55, 0.04); g.add(gladius);
            } else if (fid === 'spanish') {
                // Rapier
                const rapier = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.28, 0.03), P.metal);
                rapier.position.set(0.16, 0.5, 0.04); g.add(rapier);
            } else if (fid === 'byzantine') {
                // Scepter
                const scepter = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.4, 6), P.metal);
                scepter.position.set(0.16, 0.6, 0.04); g.add(scepter);
                const orbTop = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 8), goldMat);
                orbTop.position.set(0.16, 0.82, 0.04); g.add(orbTop);
            }
            // Polish winged hussar wings
            if (fid === 'polish') {
                for (const sx of [-0.12, 0.12]) {
                    const wing = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.3, 0.18),
                        new THREE.MeshPhongMaterial({ color: 0xf2f2f0, side: THREE.DoubleSide }));
                    wing.position.set(sx, 0.6, -0.12); wing.rotation.x = 0.3; g.add(wing);
                }
            }
        } else {
            // ---- Foot lord (humanoid) ----
            const t = this._addHumanoid(g, P, { armor: true, helmet: true, tall: true });
            addClassWeapon(t);
            addCape(t);
            addKingRegalia(t, g);
            // Faction-specific weapon/decoration
            if (fid === 'crimson') {
                // Greatsword (two-handed)
                const sword = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.32, 0.1), P.metal);
                sword.position.set(0.14, 0.4 * t, 0.06); g.add(sword);
                // Flame plume on helm
                const flame = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.14, 6),
                    new THREE.MeshPhongMaterial({ color: 0xff5522, emissive: 0xff3322, emissiveIntensity: 0.6 }));
                flame.position.set(0, 0.62 * t, 0); g.add(flame);
            } else if (fid === 'verdant') {
                // Bow
                this._addBow(g, P, 0.16, 0.4 * t, 1.1);
                // Leafy shoulder accents
                for (const sx of [-0.13, 0.13]) {
                    const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 6),
                        new THREE.MeshPhongMaterial({ color: 0x4a9a3a, emissive: 0x2a6a2a, emissiveIntensity: 0.2 }));
                    leaf.position.set(sx, 0.42 * t, 0); g.add(leaf);
                }
            } else if (fid === 'violet') {
                // Magic staff
                const staff = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.55, 6), P.wood);
                staff.position.set(0.16, 0.45 * t, 0.04); g.add(staff);
                const orb = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 10),
                    new THREE.MeshPhongMaterial({ color: 0xcc66ff, emissive: 0x9933cc, emissiveIntensity: 0.6 }));
                orb.position.set(0.16, 0.74 * t, 0.04); g.add(orb);
            } else if (fid === 'azure') {
                // Spear + shield
                const spear = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.7, 6), P.wood);
                spear.position.set(0.12, 0.5 * t, 0.04); g.add(spear);
                const tip = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.08, 6), P.metal);
                tip.position.set(0.12, 0.88 * t, 0.04); g.add(tip);
                this._addShield(g, P, -1);
            } else if (fid === 'obsidian') {
                // Dark blade + skull pauldron
                const darkBlade = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.3, 0.06),
                    new THREE.MeshPhongMaterial({ color: 0x2a2a3a, emissive: 0x880000, emissiveIntensity: 0.4 }));
                darkBlade.position.set(0.16, 0.4 * t, 0.04); g.add(darkBlade);
                const skull = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 6),
                    new THREE.MeshPhongMaterial({ color: 0xeeeeee, emissive: 0x660000, emissiveIntensity: 0.3 }));
                skull.position.set(-0.16, 0.46 * t, 0); g.add(skull);
            } else if (fid === 'iron') {
                // Warhammer + gear cog pauldron
                const hammer = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.34, 6), P.metal);
                hammer.position.set(0.16, 0.4 * t, 0.04); g.add(hammer);
                const head = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.08, 0.08), P.metal);
                head.position.set(0.16, 0.6 * t, 0.04); g.add(head);
                const cog = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.015, 6, 12), P.metal);
                cog.position.set(-0.16, 0.46 * t, 0); g.add(cog);
                // Mobilized king: tracks, drive wheels, and mechanical armor
                if (isKing) {
                    const trackMat = new THREE.MeshPhongMaterial({ color: 0x3a3a4a });
                    for (const sx of [-0.12, 0.12]) {
                        const track = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.04, 0.26), trackMat);
                        track.position.set(sx, -0.01, 0); g.add(track);
                        for (const sz of [-0.09, 0, 0.09]) {
                            const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.05, 8), trackMat);
                            wheel.rotation.x = Math.PI / 2;
                            wheel.position.set(sx, -0.005, sz); g.add(wheel);
                        }
                    }
                    // Mechanical back-mount gears
                    const bigGear = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.012, 8, 16), P.metal);
                    bigGear.position.set(0, 0.38 * t, 0); g.add(bigGear);
                    const smallGear = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.01, 6, 12), P.metal);
                    smallGear.position.set(-0.08, 0.44 * t, 0); smallGear.rotation.y = 0.3; g.add(smallGear);
                    // Boiler / steam cylinder on the back
                    const boiler = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 0.16, 8),
                        new THREE.MeshPhongMaterial({ color: 0x888899 }));
                    boiler.position.set(0.08, 0.28 * t, 0); boiler.rotation.z = 0.2; g.add(boiler);
                }
            } else if (fid === 'shadow') {
                // Hooded cloak + daggers
                const hood = new THREE.Mesh(new THREE.SphereGeometry(0.085, 8, 8, 0, Math.PI * 2, 0, Math.PI / 1.6),
                    new THREE.MeshPhongMaterial({ color: 0x2a1a3a }));
                hood.position.y = 0.54 * t; g.add(hood);
                const cloak = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.4 * t, 0.05),
                    new THREE.MeshPhongMaterial({ color: 0x2a1a3a }));
                cloak.position.set(0, 0.32 * t, -0.08); g.add(cloak);
                for (const dx of [-0.04, 0.08]) {
                    const dagger = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.16, 0.03), P.metal);
                    dagger.position.set(0.12 + dx, 0.34 * t, 0.1); g.add(dagger);
                }
            } else if (fid === 'storm') {
                // Trident + lightning glow
                const trident = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.65, 6), P.metal);
                trident.position.set(0.16, 0.48 * t, 0.04); g.add(trident);
                for (const dz of [-0.05, 0, 0.05]) {
                    const prong = new THREE.Mesh(new THREE.ConeGeometry(0.018, 0.12, 5), P.metal);
                    prong.position.set(0.16, 0.82 * t, 0.04 + dz); g.add(prong);
                }
                // Lightning aura spark
                const spark = new THREE.Mesh(new THREE.SphereGeometry(0.04, 6, 6),
                    new THREE.MeshPhongMaterial({ color: 0x88ddff, emissive: 0x44aaff, emissiveIntensity: 0.7 }));
                spark.position.set(0, 0.62 * t, 0); g.add(spark);
            } else if (fid === 'frost') {
                // Ice axe + fur cloak
                const axe = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.36, 6), P.wood);
                axe.position.set(0.16, 0.4 * t, 0.04); g.add(axe);
                const axeHead = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.06, 0.03),
                    new THREE.MeshPhongMaterial({ color: 0xaaddff, emissive: 0x6699cc, emissiveIntensity: 0.3 }));
                axeHead.position.set(0.22, 0.58 * t, 0.04); g.add(axeHead);
                const fur = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.32 * t, 0.05),
                    new THREE.MeshPhongMaterial({ color: 0xeef4ff }));
                fur.position.set(0, 0.34 * t, -0.08); g.add(fur);
            } else if (fid === 'viking') {
                // Axe + horned helmet
                const axe = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.34, 6), P.wood);
                axe.position.set(0.16, 0.4 * t, 0.04); g.add(axe);
                const axeHead = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.05, 0.03), P.metal);
                axeHead.position.set(0.22, 0.56 * t, 0.04); g.add(axeHead);
                for (const sx of [-0.05, 0.05]) {
                    const horn = new THREE.Mesh(new THREE.ConeGeometry(0.025, 0.12, 6), P.white);
                    horn.position.set(sx, 0.58 * t, 0); horn.rotation.z = sx > 0 ? 0.5 : -0.5; g.add(horn);
                }
            }
        }

        // King-only ground effects: animal companion + expanded base glow
        if (isKing) {
            const companionMap = {
                crimson: null, verdant: null, violet: 'RAVEN', azure: 'EAGLE',
                obsidian: 'WOLF', iron: 'BOAR', shadow: 'RAVEN', storm: null,
                frost: 'BEAR', golden: 'EAGLE', polish: 'EAGLE', roman: 'EAGLE',
                byzantine: 'RAVEN', spanish: 'WOLF', viking: 'BEAR'
            };
            const animal = companionMap[fid];
            if (animal) {
                const beast = this._makeAnimal(animal);
                const angle = Math.PI * 1.7 + (fid.length * 0.25);
                beast.position.set(Math.cos(angle) * 0.26, 0.005, Math.sin(angle) * 0.26);
                g.add(beast);
            }
        }

        // Apply emissive glow to all child meshes so lords read against terrain
        g.traverse(o => {
            if (o.isMesh && o.material && o.material.emissive) {
                o.material.emissive = emissive;
                o.material.emissiveIntensity = emInt;
            }
        });

        // Class icon floating above (group scale handles king enlargement)
        if (cls.icon) {
            g.add(this.makeIconSprite(cls.icon, 0.55, 1.1));
        }
        // King crown sprite + base glow ring
        if (isKing) {
            g.add(this.makeIconSprite('crown', 0.5, 1.35));
            const ring = new THREE.Mesh(new THREE.RingGeometry(0.28, 0.34, 24),
                new THREE.MeshBasicMaterial({ color: 0xffd700, transparent: true, opacity: 0.5, depthWrite: false }));
            ring.rotation.x = -Math.PI / 2;
            ring.position.y = 0.02; g.add(ring);
        }
        // Scale entire group (king = 1.25×)
        g.scale.setScalar(s);
        return g;
    }

    makeUnitModel(type, color) {
        const P = this._unitPalette(color);
        const g = new THREE.Group();
        switch (type) {
            case 'INFANTRY': {
                const t = this._addHumanoid(g, P, { helmet: true });
                // Sword in right hand, shield on left.
                const sword = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.22, 0.08), P.metal);
                sword.position.set(0.16, 0.3 * t, 0); g.add(sword);
                const guard = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.03, 0.03), P.dark);
                guard.position.set(0.16, 0.42 * t, 0); g.add(guard);
                this._addShield(g, P, -1);
                break;
            }
            case 'ARCHER': {
                const t = this._addHumanoid(g, P, { helmet: false });
                this._addBow(g, P, 0.16, 0.4 * t, 1);
                // Quiver on the back.
                const quiver = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.16, 6), P.cloth);
                quiver.position.set(-0.1, 0.38 * t, -0.08); g.add(quiver);
                break;
            }
            case 'LONGBOWMAN': {
                const t = this._addHumanoid(g, P, { tall: true, helmet: false });
                this._addBow(g, P, 0.17, 0.46 * t, 1.4);
                const quiver = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.18, 6), P.cloth);
                quiver.position.set(-0.1, 0.42 * t, -0.08); g.add(quiver);
                break;
            }
            case 'CROSSBOWMAN': {
                const t = this._addHumanoid(g, P, { helmet: false });
                const stock = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.03, 0.04), P.wood);
                stock.position.set(0.14, 0.38 * t, 0.06); g.add(stock);
                const prod = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.012, 6, 12, Math.PI), P.wood);
                prod.rotation.y = Math.PI / 2;
                prod.position.set(0.14, 0.38 * t, 0.06); g.add(prod);
                const bolt = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.16, 4), P.metal);
                bolt.rotation.z = Math.PI / 2;
                bolt.position.set(0.14, 0.38 * t, 0.06); g.add(bolt);
                break;
            }
            case 'LEGIONNAIRE': {
                const t = this._addHumanoid(g, P, { armor: true, helmet: true });
                // Large rectangular scutum on the left arm.
                const scutum = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.28, 0.18), P.metal);
                scutum.position.set(-0.18, 0.34 * t, 0.04); g.add(scutum);
                // Pilum (throwing spear).
                const pilum = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.55, 6), P.wood);
                pilum.rotation.z = 0.15; pilum.position.set(0.18, 0.42 * t, 0.04); g.add(pilum);
                const tip = new THREE.Mesh(new THREE.ConeGeometry(0.02, 0.07, 6), P.metal);
                tip.rotation.z = -0.15; tip.position.set(0.18, 0.72 * t, 0.04); g.add(tip);
                break;
            }
            case 'BERSERKER': {
                const t = this._addHumanoid(g, P, { helmet: false });
                // Bare arms override.
                for (const sx of [-0.13, 0.13]) {
                    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.052, 0.18 * t, 0.052), P.skin);
                    arm.position.set(sx, 0.35 * t, 0); g.add(arm);
                }
                // Big battle axe.
                const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.34, 6), P.wood);
                handle.position.set(0.18, 0.4 * t, 0.04); handle.rotation.z = 0.3; g.add(handle);
                const head = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.06, 0.04), P.metal);
                head.position.set(0.24, 0.58 * t, 0.04); head.rotation.z = 0.3; g.add(head);
                break;
            }
            case 'VARANGIAN_GUARD': {
                const t = this._addHumanoid(g, P, { armor: true, helmet: true });
                // Long two-handed axe.
                const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.7, 6), P.wood);
                handle.position.set(0.14, 0.5, 0.08); handle.rotation.z = 0.25; g.add(handle);
                const blade = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.08, 0.04), P.metal);
                blade.position.set(0.14, 0.86, 0.08); blade.rotation.z = 0.25; g.add(blade);
                const spike = new THREE.Mesh(new THREE.ConeGeometry(0.025, 0.08, 6), P.metal);
                spike.position.set(0.14, 0.14, 0.08); spike.rotation.z = -0.25; g.add(spike);
                break;
            }
            case 'HOUSEHOLD_GUARD': {
                const t = this._addHumanoid(g, P, { armor: true, helmet: true });
                const sword = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.22, 0.08), P.metal);
                sword.position.set(0.16, 0.32 * t, 0); g.add(sword);
                this._addShield(g, P, -1);
                break;
            }
            case 'RAIDER': {
                const t = this._addHumanoid(g, P, { helmet: false });
                const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.32, 6), P.wood);
                handle.position.set(0.16, 0.38 * t, 0.04); handle.rotation.z = 0.3; g.add(handle);
                const head = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.05, 0.03), P.metal);
                head.position.set(0.22, 0.56 * t, 0.04); head.rotation.z = 0.3; g.add(head);
                break;
            }
            case 'SPY': {
                const t = this._addHumanoid(g, P, { helmet: false });
                const cloakMat = new THREE.MeshPhongMaterial({ color: 0x2a1a3a });
                const cloak = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.34 * t, 0.05), cloakMat);
                cloak.position.set(0, 0.34 * t, -0.1); g.add(cloak);
                const hood = new THREE.Mesh(new THREE.SphereGeometry(0.075, 8, 8, 0, Math.PI * 2, 0, Math.PI / 1.6), cloakMat);
                hood.position.y = 0.53 * t; g.add(hood);
                const dagger = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.12, 0.02), P.metal);
                dagger.position.set(0.12, 0.3 * t, 0.1); g.add(dagger);
                break;
            }
            case 'COMBAT_ENGINEER': {
                const t = this._addHumanoid(g, P, { helmet: true });
                // Wrench/hammer tool.
                const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.2, 5), P.wood);
                handle.position.set(0.16, 0.36 * t, 0.04); handle.rotation.z = 0.2; g.add(handle);
                const head = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.04, 0.04), P.metal);
                head.position.set(0.16, 0.47 * t, 0.04); g.add(head);
                // Satchel.
                const satchel = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.08, 0.06), P.cloth);
                satchel.position.set(-0.12, 0.26 * t, 0.1); g.add(satchel);
                break;
            }
            case 'PIKEMAN': {
                const t = this._addHumanoid(g, P, { armor: true, helmet: true });
                const pike = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.85, 6), P.wood);
                pike.position.set(0.1, 0.5, 0.02); g.add(pike);
                const tip = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.08, 6), P.metal);
                tip.position.set(0.1, 0.96, 0.02); g.add(tip);
                this._addShield(g, P, -1);
                break;
            }
            case 'HALBERDIER': {
                const t = this._addHumanoid(g, P, { armor: true, helmet: true });
                const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.8, 6), P.wood);
                pole.position.set(0.1, 0.48, 0.04); g.add(pole);
                const blade = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.06, 0.02), P.metal);
                blade.position.set(0.1, 0.82, 0.04); g.add(blade);
                const spike = new THREE.Mesh(new THREE.ConeGeometry(0.025, 0.08, 6), P.metal);
                spike.position.set(0.1, 0.9, 0.04); g.add(spike);
                this._addShield(g, P, -1);
                break;
            }
            case 'PIKE_MASTER': {
                const t = this._addHumanoid(g, P, { armor: true, helmet: true });
                const pike = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 1.0, 6), P.wood);
                pike.position.set(0.1, 0.55, 0.04); g.add(pike);
                const tip = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.09, 6), P.metal);
                tip.position.set(0.1, 1.1, 0.04); g.add(tip);
                this._addShield(g, P, -1);
                break;
            }
            case 'BAYONET_RIFLE': {
                const t = this._addHumanoid(g, P, { helmet: true });
                const rifle = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.44, 6), P.dark);
                rifle.rotation.z = 0.14; rifle.position.set(0.16, 0.36 * t, 0.02); g.add(rifle);
                const bayonet = new THREE.Mesh(new THREE.ConeGeometry(0.012, 0.06, 6), P.metal);
                bayonet.rotation.z = -0.14; bayonet.position.set(0.16, 0.6 * t, 0.02); g.add(bayonet);
                break;
            }
            case 'CATAPHRACT': {
                this._addCavalry(g, P, { armored: true, weapon: 'lance', riderArmor: true });
                break;
            }
            case 'CAVALRY': {
                this._addCavalry(g, P, { weapon: 'saber' });
                break;
            }
            case 'WINGED_HUSSAR': {
                this._addCavalry(g, P, { armored: true, weapon: 'lance', wings: true, riderArmor: true });
                break;
            }
            case 'STONE_GUARD': {
                // Heavily armored statue-like warrior with a tower shield.
                const t = this._addHumanoid(g, P, { armor: true, helmet: true, shield: true });                const towerShield = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.6, 0.32), P.metal);
                towerShield.position.set(-0.18, 0.4 * t, 0.04); g.add(towerShield);
                break;
            }
            case 'BATTLE_MAGE': {
                // Robed spellcaster holding a glowing staff.
                const t = this._addHumanoid(g, P, { helmet: false });
                const robe = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.3, 0.14), P.cloth);
                robe.position.set(0, 0.34 * t, -0.06); g.add(robe);
                const staff = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.7, 6), P.white);
                staff.position.set(0.16, 0.45 * t, 0.04); g.add(staff);
                const orb = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 8), P.cloth);
                orb.position.set(0.16, 0.82 * t, 0.04); g.add(orb);
                break;
            }
            case 'SHINOBI': {
                // Hooded assassin with a short blade.
                const t = this._addHumanoid(g, P, { helmet: true });
                const cloak = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.28, 0.05), P.dark);
                cloak.position.set(0, 0.36 * t, -0.1); g.add(cloak);
                const blade = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.22, 0.012), P.metal);
                blade.position.set(0.16, 0.42 * t, 0.04); blade.rotation.z = -0.2; g.add(blade);
                break;
            }
            case 'JAGUAR_WARRIOR': {
                // Feathered warrior with a macuahuitl-style club.
                const t = this._addHumanoid(g, P, { helmet: false });
                const headdress = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.1, 0.18), P.cloth);
                headdress.position.set(0, 0.72 * t, -0.04); g.add(headdress);
                const macahuitl = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.28, 0.02), P.wood);
                macahuitl.position.set(0.16, 0.4 * t, 0.04); macahuitl.rotation.z = -0.15; g.add(macahuitl);
                break;
            }
            case 'CONQUISTADOR': {
                this._addCavalry(g, P, { weapon: 'arquebus', morion: true });
                break;
            }
            case 'MERCENARY_KNIGHT': {
                this._addCavalry(g, P, { armored: true, weapon: 'saber', riderArmor: true });
                break;
            }
            case 'FRONTIERSMAN': {
                this._addCavalry(g, P, { weapon: 'arquebus', riderHelmet: false });
                break;
            }
            case 'DRAGOON': {
                this._addCavalry(g, P, { weapon: 'carbine' });
                break;
            }
            case 'CHARIOT': {
                // Horse pulling a two-wheeled cart with a standing driver.
                const body = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.18, 0.4), P.body);
                body.position.set(0, 0.3, 0.26); g.add(body);
                const neck = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.16, 0.09), P.body);
                neck.position.set(0, 0.39, 0.46); g.add(neck);
                const head = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.08, 0.13), P.skin);
                head.position.set(0, 0.48, 0.52); g.add(head);
                for (const [sx, sz] of [[-0.07, 0.38], [0.07, 0.38], [-0.07, 0.16], [0.07, 0.16]]) {
                    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.22, 0.05), P.dark);
                    leg.position.set(sx, 0.11, sz); g.add(leg);
                }
                const cart = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.14, 0.22), P.wood);
                cart.position.set(0, 0.26, -0.1); g.add(cart);
                for (const sx of [-0.16, 0.16]) {
                    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.03, 10), P.dark);
                    wheel.rotation.z = Math.PI / 2;
                    wheel.position.set(sx, 0.13, -0.1); g.add(wheel);
                }
                const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.4, 5), P.wood);
                pole.rotation.x = Math.PI / 2; pole.position.set(0, 0.24, 0.12); g.add(pole);
                const driver = new THREE.Group();
                this._addHumanoid(driver, P, { helmet: true });
                driver.position.set(0, 0.3, -0.14); g.add(driver);
                break;
            }
            case 'SCOUT': {
                const t = this._addHumanoid(g, P, { helmet: false });
                const cape = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.26, 0.04), P.cloth);
                cape.position.set(0, 0.34 * t, -0.09); g.add(cape);
                break;
            }
            case 'MEDIC': {
                const t = this._addHumanoid(g, P, { helmet: false });
                const staff = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.6, 6), P.white);
                staff.position.set(0.14, 0.4, 0.04); g.add(staff);
                const v = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.02, 0.02), P.white);
                v.position.set(0.14, 0.62, 0.04); g.add(v);
                const h = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.08, 0.02), P.white);
                h.position.set(0.14, 0.62, 0.04); g.add(h);
                break;
            }
            case 'ENGINEER': {
                const t = this._addHumanoid(g, P, { helmet: true });
                const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.22, 5), P.wood);
                handle.position.set(0.16, 0.36 * t, 0.04); g.add(handle);
                const head = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.04, 0.04), P.metal);
                head.position.set(0.16, 0.48 * t, 0.04); g.add(head);
                break;
            }
            case 'WORKER': {
                const t = this._addHumanoid(g, P, { helmet: false });
                const sh = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.34, 5), P.wood);
                sh.position.set(0.14, 0.4 * t, 0.06); sh.rotation.z = 0.3; g.add(sh);
                const blade = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.06, 0.012), P.metal);
                blade.position.set(0.22, 0.56 * t, 0.06); blade.rotation.z = 0.3; g.add(blade);
                break;
            }
            case 'SETTLER': {
                const base = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.12, 0.5), P.wood);
                base.position.y = 0.2; g.add(base);
                const canvas = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.34, 8, 1, false, 0, Math.PI), P.white);
                canvas.rotation.z = Math.PI / 2;
                canvas.position.set(0, 0.34, 0); g.add(canvas);
                for (const sz of [-0.16, 0.16]) {
                    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.03, 10), P.dark);
                    wheel.rotation.z = Math.PI / 2;
                    wheel.position.set(0.18, 0.08, sz); g.add(wheel);
                }
                break;
            }
            case 'SIEGE': {
                const log = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.6, 8), P.darkWood);
                log.rotation.x = Math.PI / 2;
                log.position.y = 0.22; g.add(log);
                const ramHead = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.12, 6), P.metal);
                ramHead.rotation.x = Math.PI / 2; ramHead.position.set(0, 0.22, 0.36); g.add(ramHead);
                const roof = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.04, 0.5), P.wood);
                roof.position.y = 0.34; g.add(roof);
                for (const [sx, sz] of [[-0.16, -0.2], [0.16, -0.2], [-0.16, 0.2], [0.16, 0.2]]) {
                    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.03, 10), P.dark);
                    wheel.rotation.z = Math.PI / 2;
                    wheel.position.set(sx, 0.1, sz); g.add(wheel);
                }
                break;
            }
            case 'ARTILLERY': {
                const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 0.42, 12), P.metal);
                barrel.rotation.x = Math.PI / 2; barrel.position.set(0, 0.24, 0.04); g.add(barrel);
                const mount = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.12, 0.3), P.darkWood);
                mount.position.y = 0.14; g.add(mount);
                for (const sx of [-0.14, 0.14]) {
                    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.03, 12), P.dark);
                    wheel.rotation.z = Math.PI / 2;
                    wheel.position.set(sx, 0.12, -0.05); g.add(wheel);
                }
                break;
            }
            case 'SIEGE_TOWER': {
                const frame = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.8, 0.4), P.darkWood);
                frame.position.y = 0.42; g.add(frame);
                for (let i = 0; i < 5; i++) {
                    const rung = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.02, 0.02), P.wood);
                    rung.position.set(0, 0.12 + i * 0.14, 0.21); g.add(rung);
                }
                const platform = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.04, 0.42), P.wood);
                platform.position.y = 0.82; g.add(platform);
                for (const sx of [-0.2, 0.2]) {
                    for (const sz of [-0.16, 0.16]) {
                        const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.03, 10), P.dark);
                        wheel.rotation.z = Math.PI / 2;
                        wheel.position.set(sx, 0.1, sz); g.add(wheel);
                    }
                }
                break;
            }
            case 'CATAPULT': {
                const base = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.14, 0.42), P.darkWood);
                base.position.y = 0.16; g.add(base);
                const arm = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.5, 0.05), P.wood);
                arm.position.set(0, 0.32, 0.08);
                arm.rotation.x = -0.7; g.add(arm);
                const bucket = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.06, 0.1, 8), P.metal);
                bucket.position.set(0, 0.5, 0.18); g.add(bucket);
                const cross = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.05, 0.05), P.wood);
                cross.position.set(0, 0.28, -0.06); g.add(cross);
                for (const sx of [-0.16, 0.16]) {
                    for (const sz of [-0.14, 0.14]) {
                        const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.03, 10), P.dark);
                        wheel.rotation.z = Math.PI / 2;
                        wheel.position.set(sx, 0.1, sz); g.add(wheel);
                    }
                }
                break;
            }
            case 'TIGER_CANNON': {
                // Ornate Chinese cannon: longer barrel, tiger-striped carriage.
                const carriage = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.12, 0.5), P.darkWood);
                carriage.position.y = 0.16; g.add(carriage);
                const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, 0.6, 12), P.metal);
                barrel.rotation.x = Math.PI / 2; barrel.position.set(0, 0.26, 0.08); g.add(barrel);
                for (const sx of [-0.14, 0.14]) {
                    for (const sz of [-0.18, 0.18]) {
                        const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.03, 10), P.dark);
                        wheel.rotation.z = Math.PI / 2;
                        wheel.position.set(sx, 0.1, sz); g.add(wheel);
                    }
                }
                break;
            }
            case 'TREBUCHET': {
                const base = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.12, 0.5), P.darkWood);
                base.position.y = 0.16; g.add(base);
                for (const sx of [-0.14, 0.14]) {
                    const post = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.55, 0.05), P.wood);
                    post.position.set(sx, 0.42, 0); post.rotation.z = sx * 0.5; g.add(post);
                }
                const beam = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.7, 0.05), P.wood);
                beam.position.set(0, 0.5, 0.02); beam.rotation.z = 0.5; g.add(beam);
                const cw = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.12), P.dark);
                cw.position.set(0.22, 0.34, 0.02); g.add(cw);
                const sling = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.03, 0.12), P.cloth);
                sling.position.set(-0.26, 0.62, 0.02); g.add(sling);
                for (const sx of [-0.18, 0.18]) {
                    for (const sz of [-0.18, 0.18]) {
                        const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.03, 10), P.dark);
                        wheel.rotation.z = Math.PI / 2;
                        wheel.position.set(sx, 0.1, sz); g.add(wheel);
                    }
                }
                break;
            }
            case 'MUSKETEER': {
                const t = this._addHumanoid(g, P, { helmet: true });
                const rifle = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.34, 6), P.metal);
                rifle.rotation.z = 0.12; rifle.position.set(0.18, 0.36 * t, 0.02); g.add(rifle);
                break;
            }
            case 'ARQUEBUSIER': {
                const t = this._addHumanoid(g, P, { helmet: false });
                const gun = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.26, 0.04), P.dark);
                gun.position.set(0.16, 0.34 * t, 0.06); g.add(gun);
                break;
            }
            case 'LINE_INFANTRY': {
                const t = this._addHumanoid(g, P, { armor: true, helmet: true });
                const rifle = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.36, 6), P.metal);
                rifle.rotation.z = 0.14; rifle.position.set(0.18, 0.37 * t, 0.02); g.add(rifle);
                break;
            }
            case 'CANNON': {
                this._addCannon(g, P, {
                    carriageW: 0.3, carriageH: 0.1, carriageD: 0.45,
                    wheels: [{ x: -0.18, z: -0.05 }, { x: 0.18, z: -0.05 }],
                    wheelRadius: 0.12, wheelY: 0.12,
                    barrelRTop: 0.035, barrelRBot: 0.055, barrelLen: 0.5,
                    barrelAngle: Math.PI / 2.2, barrelY: 0.22, barrelZ: 0.05
                });
                break;
            }
            case 'MORTAR': {
                const basePlate = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.08, 0.32), P.metal);
                basePlate.position.y = 0.08;
                g.add(basePlate);
                const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.35, 10), P.dark);
                barrel.rotation.x = Math.PI / 6;
                barrel.position.set(0, 0.22, -0.02);
                g.add(barrel);
                for (const sx of [-0.1, 0.1]) {
                    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.3, 6), P.metal);
                    leg.position.set(sx, 0.18, 0.08);
                    leg.rotation.x = -Math.PI / 6;
                    g.add(leg);
                }
                break;
            }
            case 'FIELD_GUN': {
                this._addCannon(g, P, {
                    carriageW: 0.32, carriageH: 0.1, carriageD: 0.52,
                    shield: { w: 0.34, h: 0.22, z: 0.02 },
                    wheels: [{ x: -0.19, z: 0 }, { x: 0.19, z: 0 }],
                    wheelRadius: 0.13, wheelY: 0.13, wheelColor: P.darkWood,
                    barrelRTop: 0.03, barrelRBot: 0.045, barrelLen: 0.58,
                    barrelAngle: Math.PI / 2.1, barrelY: 0.24, barrelZ: 0.12
                });
                break;
            }
            case 'HORSE_ARTILLERY': {
                const horse = this._addHorse(g, P, { armored: false });
                horse.position.set(-0.16, 0, 0.18);
                const carriage = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.1, 0.45), P.darkWood);
                carriage.position.set(0.12, 0.12, -0.12);
                g.add(carriage);
                for (const sx of [0.02, 0.22]) {
                    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.03, 12), P.wood);
                    w.rotation.z = Math.PI / 2;
                    w.position.set(sx, 0.11, -0.12);
                    g.add(w);
                }
                const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.05, 0.45, 10), P.metal);
                barrel.rotation.x = Math.PI / 2.2;
                barrel.position.set(0.12, 0.22, -0.05);
                g.add(barrel);
                break;
            }
            case 'SIEGE_CANNON': {
                this._addCannon(g, P, {
                    carriageW: 0.34, carriageH: 0.12, carriageD: 0.3,
                    wheels: [{ x: -0.14, z: -0.02 }, { x: 0.14, z: -0.02 }],
                    wheelRadius: 0.09, wheelY: 0.1, wheelColor: P.dark,
                    barrelRTop: 0.06, barrelRBot: 0.07, barrelLen: 0.36,
                    barrelAngle: Math.PI / 2, barrelY: 0.24, barrelZ: 0.08
                });
                break;
            }
            case 'RIFLEMAN': {
                const t = this._addHumanoid(g, P, { helmet: true });
                const rifle = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.42, 6), P.dark);
                rifle.rotation.z = 0.14; rifle.position.set(0.16, 0.36 * t, 0.02); g.add(rifle);
                break;
            }
            case 'SHARPSHOOTER': {
                const t = this._addHumanoid(g, P, { helmet: false });
                const scope = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.04, 0.04), P.metal);
                scope.position.set(0.08, 0.46 * t, 0.12); g.add(scope);
                const rifle = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.44, 6), P.dark);
                rifle.rotation.z = 0.16; rifle.position.set(0.16, 0.35 * t, 0.04); g.add(rifle);
                break;
            }
            case 'RAILGUN': {
                const chassis = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 0.28), P.darkWood);
                chassis.position.y = 0.16; g.add(chassis);
                const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.48, 10), P.metal);
                barrel.rotation.x = Math.PI / 2; barrel.position.set(0, 0.24, 0.1); g.add(barrel);
                break;
            }
            case 'ARMORED_TRAIN': {
                const car = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.2, 0.28), P.dark);
                car.position.y = 0.16; g.add(car);
                const turret = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.16, 12), P.metal);
                turret.rotation.x = Math.PI / 2; turret.position.set(0, 0.24, 0.08); g.add(turret);
                break;
            }
            case 'DEMOLITION_SQUAD': {
                const t = this._addHumanoid(g, P, { helmet: true });
                const satchel = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.08), P.cloth);
                satchel.position.set(-0.12, 0.28 * t, 0.1); g.add(satchel);
                break;
            }
            case 'ANTI_TANK_GUN': {
                this._addCannon(g, P, {
                    carriageW: 0.34, carriageH: 0.1, carriageD: 0.5,
                    shield: { w: 0.36, h: 0.24, z: 0.08 },
                    wheels: [{ x: -0.2, z: 0 }, { x: 0.2, z: 0 }],
                    wheelRadius: 0.14, wheelY: 0.14, wheelColor: P.dark,
                    barrelRTop: 0.025, barrelRBot: 0.04, barrelLen: 0.7,
                    barrelAngle: Math.PI / 2.05, barrelY: 0.26, barrelZ: 0.12
                });
                break;
            }
            case 'RPG_TEAM': {
                const t = this._addHumanoid(g, P, { helmet: true });
                const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.36, 8), P.dark);
                tube.rotation.z = 0.4; tube.position.set(0.16, 0.4 * t, 0.08); g.add(tube);
                const warhead = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.08, 8), P.metal);
                warhead.rotation.z = -0.4; warhead.position.set(0.16, 0.6 * t, 0.08); g.add(warhead);
                const box = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.1, 0.08), P.cloth);
                box.position.set(-0.16, 0.08, 0.08); g.add(box);
                break;
            }
            case 'MOBILIZED_INFANTRY': {
                // Small truck plus a rifleman.
                const truck = new THREE.Group();
                const cab = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.16, 0.16), P.dark);
                cab.position.set(-0.14, 0.16, 0); truck.add(cab);
                const bed = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.1, 0.18), P.dark);
                bed.position.set(0.1, 0.13, 0); truck.add(bed);
                for (const sx of [-0.22, 0.22]) {
                    for (const sz of [-0.1, 0.1]) {
                        const w = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.04, 8), P.dark);
                        w.rotation.z = Math.PI / 2;
                        w.position.set(sx, 0.06, sz); truck.add(w);
                    }
                }
                truck.position.set(-0.05, 0, 0.12); g.add(truck);
                const soldier = new THREE.Group();
                this._addHumanoid(soldier, P, { helmet: true });
                const rifle = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.3, 6), P.dark);
                rifle.position.set(0.14, 0.36, 0.02); soldier.add(rifle);
                soldier.position.set(0.18, 0, -0.12); g.add(soldier);
                break;
            }
            case 'MOBILIZED_ARTILLERY': {
                // Truck towing a long field gun.
                const cab = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.18, 0.18), P.dark);
                cab.position.set(-0.18, 0.18, 0); g.add(cab);
                const bed = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.12, 0.22), P.dark);
                bed.position.set(0.12, 0.16, 0); g.add(bed);
                for (const sx of [-0.24, 0.24]) {
                    for (const sz of [-0.12, 0.12]) {
                        const w = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.04, 8), P.dark);
                        w.rotation.z = Math.PI / 2;
                        w.position.set(sx, 0.07, sz); g.add(w);
                    }
                }
                const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.035, 0.5, 10), P.metal);
                barrel.rotation.x = Math.PI / 2.2;
                barrel.position.set(0.12, 0.28, 0.06); g.add(barrel);
                break;
            }
            case 'MOTOR_ARTILLERY': {
                // Self-propelled howitzer: boxy fighting compartment with a
                // heavy short howitzer, shelter door, and big truck wheels.
                const hull = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.18, 0.34), P.dark);
                hull.position.y = 0.18; g.add(hull);
                const battery = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.12, 0.26), P.metal);
                battery.position.y = 0.3; g.add(battery);
                const howitzer = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.062, 0.46, 12), P.dark);
                howitzer.rotation.x = Math.PI / 2.15; howitzer.position.set(0, 0.32, 0.2); g.add(howitzer);
                // Open ammunition tray on the back.
                const tray = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.05, 0.12), P.metal);
                tray.position.set(0, 0.28, -0.14); g.add(tray);
                for (const sx of [-0.21, 0.21]) {
                    for (const sz of [-0.12, 0.12]) {
                        const w = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.05, 8), P.dark);
                        w.rotation.z = Math.PI / 2;
                        w.position.set(sx, 0.09, sz); g.add(w);
                    }
                }
                break;
            }
            case 'TANK': {
                // Medium tank: sloped front hull, road wheels + track skirt, a
                // compact turret with a short high-velocity gun and antenna.
                const hull = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.16, 0.56), P.dark);
                hull.position.y = 0.18; g.add(hull);
                const glacis = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.06, 0.12), P.dark);
                glacis.rotation.x = 0.5; glacis.position.set(0, 0.22, 0.24); g.add(glacis);
                const turret = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.11, 0.18, 10), P.metal);
                turret.rotation.x = Math.PI / 2; turret.position.set(0, 0.28, 0.04); g.add(turret);
                const hatch = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.03, 0.08), P.dark);
                hatch.position.set(-0.04, 0.3, 0); g.add(hatch);
                const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.022, 0.5, 8), P.dark);
                barrel.rotation.x = Math.PI / 2.1; barrel.position.set(0, 0.28, 0.22); g.add(barrel);
                const muzzle = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.05, 8), P.metal);
                muzzle.rotation.x = Math.PI / 2.1; muzzle.position.set(0, 0.28, 0.44); g.add(muzzle);
                for (const sx of [-0.16, 0.16]) {
                    // Track skirt + 3 road wheels for that recognizable tank look.
                    const skirt = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.07, 0.54), P.dark);
                    skirt.position.set(sx, 0.09, 0); g.add(skirt);
                    for (let i = -1; i <= 1; i++) {
                        const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.05, 10), P.metal);
                        wheel.rotation.x = Math.PI / 2;
                        wheel.position.set(sx, 0.085, i * 0.17); g.add(wheel);
                    }
                }
                const whip = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.14, 5), P.metal);
                whip.position.set(0.14, 0.34, -0.2); g.add(whip);
                break;
            }
            case 'HEAVY_TANK': {
                // Heavy tank: noticeably larger and taller with a slab front,
                // big rounded turret, thick-barreled main gun and dual road wheels.
                const hull = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.2, 0.68), P.dark);
                hull.position.y = 0.2; g.add(hull);
                const pike = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.08, 0.14), P.dark);
                pike.rotation.x = 0.5; pike.position.set(0, 0.25, 0.26); g.add(pike);
                const turret = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.15, 0.2, 12), P.dark);
                turret.rotation.x = Math.PI / 2; turret.position.set(0, 0.34, 0.03); g.add(turret);
                const turretdome = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.06, 10), P.metal);
                turretdome.position.set(0, 0.4, -0.02); g.add(turretdome);
                const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.038, 0.62, 10), P.dark);
                barrel.rotation.x = Math.PI / 2.1; barrel.position.set(0, 0.34, 0.28); g.add(barrel);
                const muzzleBrake = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.08, 8), P.metal);
                muzzleBrake.rotation.x = Math.PI / 2.1; muzzleBrake.position.set(0, 0.34, 0.44); g.add(muzzleBrake);
                for (const sx of [-0.22, 0.22]) {
                    for (let i = -1; i <= 1; i++) {
                        // Dual road wheels under a wide track skirt.
                        const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.06, 10), P.metal);
                        wheel.rotation.x = Math.PI / 2;
                        wheel.position.set(sx, 0.09, -0.15 + i * 0.15); g.add(wheel);
                    }
                    const skirt = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.09, 0.52), P.dark);
                    skirt.position.set(sx, 0.12, 0.02); g.add(skirt);
                }
                break;
            }
            case 'ARMORED_CAR': {
                const hull = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.16, 0.28), P.dark);
                hull.position.y = 0.16; g.add(hull);
                const turret = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.14, 12), P.metal);
                turret.rotation.x = Math.PI / 2; turret.position.set(0, 0.26, 0.02); g.add(turret);
                const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.025, 0.36, 10), P.dark);
                barrel.rotation.x = Math.PI / 2.2; barrel.position.set(0, 0.28, 0.14); g.add(barrel);
                for (const sx of [-0.2, 0.2]) {
                    for (const sz of [-0.12, 0.12]) {
                        const w = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.04, 8), P.dark);
                        w.rotation.z = Math.PI / 2;
                        w.position.set(sx, 0.07, sz); g.add(w);
                    }
                }
                break;
            }
            case 'GALLEY':
            case 'TRANSPORT':
            case 'TRIREME':
            case 'FRIGATE':
            case 'GALLEON':
            case 'CARAVEL':
            case 'BATTLESHIP':
            case 'SUBMARINE':
            case 'DESTROYER':
            case 'IRONCLAD':
            case 'STEAM_TRANSPORT':
            case 'GUNBOAT':
            case 'IRONCLAD_FRIGATE':
            case 'MONITOR':
            case 'FRIGATE_2':
            case 'TORPEDO_BOAT':
            case 'MAN_OF_WAR':
            case 'GALLEASS':
            case 'PINNACE':
            case 'CORVETTE':
            case 'FROLIC':
            case 'MERCHANTMAN':
            case 'AIRCRAFT_CARRIER':
            case 'TRANSPORT_SHIP':
            case 'SUBMARINE_II':
                return this.makeShipModel(type, color);
            default: {
                this._addHumanoid(g, P, { helmet: true });
                break;
            }
        }
        return g;
    }

    // Renders a crisp vector icon (from src/icons.js) as a sprite. The texture is
    // painted asynchronously from an SVG data URL; until it loads we show a tiny
    // placeholder so nothing pops in empty. Sprites share one cached material per
    // icon name.
    makeIconSprite(name, size = 0.6, y = 0.55) {
        if (!this._iconMatCache) this._iconMatCache = {};
        const iconName = hasIcon(name) ? name : (UNIT_ICON_NAME[name] || null);
        const key = iconName || name;
        if (!this._iconMatCache[key]) {
            const canvas = document.createElement('canvas');
            canvas.width = 128; canvas.height = 128;
            const ctx = canvas.getContext('2d');
            const tex = new THREE.CanvasTexture(canvas);
            tex.anisotropy = 4;
            const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true });
            this._matCacheSet.add(mat);
            this._iconMatCache[key] = mat;
            if (iconName) {
                const img = new Image();
                img.onload = () => {
                    ctx.clearRect(0, 0, 128, 128);
                    ctx.drawImage(img, 0, 0, 128, 128);
                    tex.needsUpdate = true;
                };
                img.src = svgDataURL(iconName, 128);
            } else {
                // Unknown glyph: fall back to the old emoji text rendering.
                ctx.font = '72px serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(name, 64, 70);
                tex.needsUpdate = true;
            }
        }
        const sprite = new THREE.Sprite(this._iconMatCache[key]);
        sprite.scale.set(size, size, size);
        sprite.position.set(0, y, 0);
        return sprite;
    }

    /** A crisp text label rendered to a canvas and shown as a sprite. Used for
     *  city names floating above each city. The material is cached per-text
     *  string so repeated cities don't re-rasterize. The sprite is sized in
     *  world units (scale) and placed at an absolute world position by the
     *  caller. */
    makeTextSprite(text, opts = {}) {
        if (!this._textMatCache) this._textMatCache = {};
        const key = text + '|' + (opts.color || '') + '|' + (opts.bg || '');
        if (!this._textMatCache[key]) {
            const canvas = document.createElement('canvas');
            const fontSize = opts.fontSize || 48;
            canvas.width = 256; canvas.height = 64;
            const ctx = canvas.getContext('2d');
            if (opts.bg) {
                ctx.fillStyle = opts.bg;
                ctx.fillRect(0, 0, canvas.width, canvas.height);
            }
            ctx.font = `bold ${fontSize}px Rajdhani, sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = opts.color || '#ffffff';
            ctx.strokeStyle = 'rgba(0,0,0,0.85)';
            ctx.lineWidth = 6;
            ctx.strokeText(text, canvas.width / 2, canvas.height / 2);
            ctx.fillText(text, canvas.width / 2, canvas.height / 2);
            const tex = new THREE.CanvasTexture(canvas);
            tex.anisotropy = 4;
            const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true });
            this._matCacheSet.add(mat);
            this._textMatCache[key] = mat;
        }
        const sprite = new THREE.Sprite(this._textMatCache[key]);
        const scale = opts.scale || 1.6;
        sprite.scale.set(scale * 4, scale, scale);
        return sprite;
    }

    // --- Building 3D props (per BUILDING_TYPE) ---
    makeBuildingProp(type) {
        const g = new THREE.Group();
        const icon = BUILDING_TYPE[type] && BUILDING_TYPE[type].name ? null : null;
        let color = 0xaaaaaa;
        switch (type) {
            case 'FARM':       color = 0x6ab04c; break;
            case 'LUMBERMILL': color = 0x8a5a2b; break;
            case 'MINE':       color = 0x555555; break;
            case 'MARKET':     color = 0xd9a441; break;
            case 'BARRACKS':   color = 0x884422; break;
            case 'WALLS':      color = 0x9a9a9a; break;
            case 'HARBOR':     color = 0x2a9da0; break;
            case 'SIEGE_WORKSHOP': color = 0x6a5a44; break;
        }
        const mat = new THREE.MeshPhongMaterial({ color });
        if (type === 'WALLS') {
            const wall = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.35, 0.18), mat);
            wall.position.y = 0.2;
            g.add(wall);
        } else if (type === 'HARBOR') {
            // Dock slab + a mast with a sail.
            const dock = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.08, 0.6), mat);
            dock.position.y = 0.08;
            g.add(dock);
            const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.6, 6),
                new THREE.MeshPhongMaterial({ color: 0x6a4220 }));
            mast.position.y = 0.38;
            g.add(mast);
            const sail = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.3, 0.25),
                new THREE.MeshPhongMaterial({ color: 0xeaeaea }));
            sail.position.set(0.08, 0.42, 0);
            g.add(sail);
        } else if (type === 'SIEGE_WORKSHOP') {
            // Workshop: heavy timber frame + an anvil + a stored beam/catapult arm.
            const slab = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.06, 0.55), mat);
            slab.position.y = 0.08; g.add(slab);
            const frame = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.28, 0.36), mat);
            frame.position.y = 0.24; g.add(frame);
            // Anvil.
            const anvil = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.08, 0.14),
                new THREE.MeshPhongMaterial({ color: 0x333333 }));
            anvil.position.set(0.18, 0.16, 0.18); g.add(anvil);
            // Stored throwing beam leaning on the side.
            const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.5, 6),
                new THREE.MeshPhongMaterial({ color: 0x6a4220 }));
            beam.position.set(-0.18, 0.3, -0.1); beam.rotation.z = 0.7; g.add(beam);
        } else if (type === 'LUMBERMILL') {
            for (let i = 0; i < 3; i++) {
                const log = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.4, 6), mat);
                log.rotation.z = Math.PI / 2;
                log.position.set(0, 0.1 + i * 0.14, 0);
                g.add(log);
            }
        } else if (type === 'MINE') {
            const head = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.25, 0.2), mat);
            head.position.y = 0.4;
            g.add(head);
            const hole = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.1, 8),
                new THREE.MeshPhongMaterial({ color: 0x111111 }));
            hole.position.y = 0.05;
            g.add(hole);
        } else if (type === 'FARM') {
            const field = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.05, 0.55), mat);
            field.position.y = 0.08;
            g.add(field);
            const hut = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.22, 0.18),
                new THREE.MeshPhongMaterial({ color: 0x9a7a44 }));
            hut.position.set(0.2, 0.18, 0.2);
            g.add(hut);
        } else if (type === 'MARKET') {
            const base = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.2, 0.4), mat);
            base.position.y = 0.15;
            g.add(base);
            const roof = new THREE.Mesh(new THREE.ConeGeometry(0.32, 0.2, 4),
                new THREE.MeshPhongMaterial({ color: 0xb33 }));
            roof.position.y = 0.35; roof.rotation.y = Math.PI / 4;
            g.add(roof);
        } else { // BARRACKS + default
            const body = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.35, 0.4), mat);
            body.position.y = 0.22;
            g.add(body);
            const flag = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.3, 0.03),
                new THREE.MeshPhongMaterial({ color: 0xff3333 }));
            flag.position.set(0.2, 0.45, 0.2);
            g.add(flag);
        }
        // Emoji label so the building type is readable in 2.5D.
        const labels = { FARM: 'food', LUMBERMILL: 'wood', MINE: 'mine', MARKET: 'market', BARRACKS: 'barracks', WALLS: 'walls', HARBOR: 'harbor' };
        if (labels[type]) g.add(this.makeIconSprite(labels[type], 0.45, 0.7));
        return g;
    }

    renderBuildings(gameState) {
        this._disposeGroupChildren(this.buildingGroup);
        const visible = gameState.visible || null;
        const bState = gameState.buildingState || null;
        for (const [tileKey, list] of gameState.buildings) {
            const tile = gameState.tiles.get(tileKey);
            if (!tile) continue;
            // Enemy buildings: hide unless their tile is visible to the player.
            if (tile.owner !== PLAYER_FACTION && visible && !visible.has(tileKey)) continue;
            const [bx, bz] = tileKey.split(',').map(Number);
            const baseY = this.tileHeights.get(tileKey) || 0;
            list.forEach((bType, i) => {
                const prop = this.makeBuildingProp(bType);
                const ox = (i % 2) * 0.25 - 0.12;
                const oz = Math.floor(i / 2) * 0.25 - 0.12;
                prop.position.set(bx - GRID_SIZE / 2 + ox, baseY, bz - GRID_SIZE / 2 + oz);
                // Area 6d: show level + damage for military structures.
                if (bState && BUILDING_TYPE[bType] && BUILDING_TYPE[bType].military) {
                    const st = bState.get(`${tileKey}:${bType}`);
                    if (st) {
                        if (st.level >= 2) {
                            // One star per veteran level above 1, fanned out.
                            const n = Math.min(st.level - 1, 3);
                            for (let s = 0; s < n; s++) {
                                const lvl = this.makeIconSprite('star', 0.28, 1.1);
                                lvl.position.x = (s - (n - 1) / 2) * 0.32;
                                prop.add(lvl);
                            }
                        }
                        if (st.maxHp > 0 && st.hp < st.maxHp) {
                            const ratio = Math.max(0, st.hp / st.maxHp);
                            // Tint the prop red as it takes damage.
                            prop.traverse(o => {
                                if (o.isMesh && o.material && o.material.color) {
                                    o.material = o.material.clone();
                                    o.material.color.lerp(new THREE.Color(0xff4444), 1 - ratio);
                                }
                            });
                            const bar = this.makeIconSprite('heart', 0.35, 1.4);
                            prop.add(bar);
                        }
                    }
                }
                this.buildingGroup.add(prop);
            });
        }
    }

    // --- Goal markers for player units with an auto-navigation goal ---
    renderGoalMarkers(gameState) {
        this._disposeGroupChildren(this.markerGroup);
        for (const unit of gameState.units.values()) {
            if (unit.owner !== PLAYER_FACTION || !unit.goal) continue;
            const sprite = this.makeIconSprite('target', 0.7, 0.8);
            sprite.position.set(unit.goal.x - GRID_SIZE / 2, 0.4, unit.goal.z - GRID_SIZE / 2);
            this.markerGroup.add(sprite);
        }
        // AI faction goal targets (spectate-only): a flat tinted disc per goal at
        // the objective tile, tinted with the faction's tile color so each AI's
        // current objective is visible on the map. The dominant goal gets a
        // larger, brighter disc.
        if (gameState.spectateMode && gameState.aiState) {
            for (const slot of Object.keys(gameState.aiState)) {
                const st = gameState.aiState[slot];
                if (!st || !Array.isArray(st.goals)) continue;
                const fc = this.fcolor(gameState, slot) || { tile: 0x888888 };
                const col = new THREE.Color(fc.tile || 0x888888);
                st.goals.forEach((g, i) => {
                    if (!g.targetTileKey) return;
                    const [gx, gz] = g.targetTileKey.split(',').map(Number);
                    const isTop = i === 0;
                    const disc = new THREE.Mesh(
                        new THREE.CircleGeometry(isTop ? 0.45 : 0.28, 20),
                        new THREE.MeshBasicMaterial({
                            color: col, transparent: true,
                            opacity: isTop ? 0.85 : 0.5, depthWrite: false
                        }));
                    disc.rotation.x = -Math.PI / 2;
                    disc.position.set(gx - GRID_SIZE / 2, 0.7, gz - GRID_SIZE / 2);
                    this.markerGroup.add(disc);
                });
            }
        }
    }

    // --- Bridges across river tiles (built by Siege/Engineer units). ---
    renderBridges(gameState) {
        if (!this.bridgeGroup) return;
        this._disposeGroupChildren(this.bridgeGroup);
        const explored = gameState.explored || null;
        for (const [key, tile] of gameState.tiles) {
            if (!tile.bridge || tile.terrain !== 'RIVER') continue;
            if (explored && !explored.has(key)) continue;
            const [bx, bz] = key.split(',').map(Number);
            const baseY = (this.tileHeights.get(key) || 0) + 0.12;
            // Detect river orientation: if the river runs along the Z axis (the
            // N/S neighbors are river but E/W aren't), the bridge deck must
            // rotate 90° to span it. Otherwise it spans the X axis (default).
            const n = gameState.tiles.get(`${bx},${bz + 1}`);
            const s = gameState.tiles.get(`${bx},${bz - 1}`);
            const e = gameState.tiles.get(`${bx + 1},${bz}`);
            const w = gameState.tiles.get(`${bx - 1},${bz}`);
            const nsRiver = (n && n.terrain === 'RIVER') || (s && s.terrain === 'RIVER');
            const ewRiver = (e && e.terrain === 'RIVER') || (w && w.terrain === 'RIVER');
            const zAligned = nsRiver && !ewRiver;
            const group = new THREE.Group();
            // Wooden plank deck: individual planks laid side by side across
            // the span, alternating two wood tones. No siderails.
            const plankMatA = new THREE.MeshPhongMaterial({ color: 0x8a5a2b });
            const plankMatB = new THREE.MeshPhongMaterial({ color: 0x755026 });
            const PLANKS = 6;
            for (let i = 0; i < PLANKS; i++) {
                const plank = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.07, 0.7),
                    i % 2 ? plankMatB : plankMatA);
                plank.position.set(-0.4 + i * 0.16, 0, 0);
                group.add(plank);
            }
            if (zAligned) group.rotation.y = Math.PI / 2;
            group.position.set(bx - GRID_SIZE / 2, baseY, bz - GRID_SIZE / 2);
            this.bridgeGroup.add(group);
        }
    }

    /** A small prop marking an engineer-built structure on a tile. */
    makeStructureProp(type) {
        const g = new THREE.Group();
        if (type === 'SPIKES') {
            const mat = new THREE.MeshPhongMaterial({ color: 0x8a5a2b });
            for (const [ox, oz] of [[-0.18, -0.18], [0.18, -0.18], [-0.18, 0.18], [0.18, 0.18], [0, 0]]) {
                const spike = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.3, 5), mat);
                spike.position.set(ox, 0.22, oz);
                g.add(spike);
            }
            g.add(this.makeIconSprite('spikes', 0.4, 0.55));
        } else if (type === 'FORTIFICATION') {
            const mat = new THREE.MeshPhongMaterial({ color: 0x7a7a82 });
            const wall = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.28, 0.16), mat);
            wall.position.y = 0.2; g.add(wall);
            const wall2 = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.28, 0.7), mat);
            wall2.position.y = 0.2; g.add(wall2);
            g.add(this.makeIconSprite('walls', 0.4, 0.55));
        } else if (type === 'FALL_TRAP') {
            const pit = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.06, 10),
                new THREE.MeshPhongMaterial({ color: 0x2a1f14 }));
            pit.position.y = 0.12; g.add(pit);
            g.add(this.makeIconSprite('trap', 0.4, 0.5));
        } else if (type === 'MINEFIELD') {
            // A scatter of small dark discs (buried mines) + a warning sign.
            const discMat = new THREE.MeshPhongMaterial({ color: 0x2a2a30, emissive: 0x1a1a20, emissiveIntensity: 0.2 });
            for (let i = 0; i < 5; i++) {
                const a = (i / 5) * Math.PI * 2;
                const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.05, 8), discMat);
                disc.position.set(Math.cos(a) * 0.26, 0.1, Math.sin(a) * 0.26);
                g.add(disc);
                // A tiny red marker nub on each mine.
                const nub = new THREE.Mesh(new THREE.SphereGeometry(0.025, 6, 6),
                    new THREE.MeshPhongMaterial({ color: 0xcc2222, emissive: 0xcc2222, emissiveIntensity: 0.5 }));
                nub.position.set(Math.cos(a) * 0.26, 0.14, Math.sin(a) * 0.26);
                g.add(nub);
            }
            g.add(this.makeIconSprite('trap', 0.4, 0.5));
        } else if (type === 'BUNKER') {
            // A squat reinforced-concrete pillbox: a low wide box with a slit
            // (darker stripe) and a small flag. Reads as a hardened fortification.
            const mat = new THREE.MeshPhongMaterial({ color: 0x6a6a72 });
            const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.34, 0.5), mat);
            body.position.y = 0.27; g.add(body);
            // Slit (a thin dark inset on the front face).
            const slit = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.06, 0.02),
                new THREE.MeshPhongMaterial({ color: 0x1a1a1e }));
            slit.position.set(0, 0.34, 0.26);
            g.add(slit);
            // Corner stubs for a chunky silhouette.
            for (const [ox, oz] of [[0.24, 0.24], [-0.24, 0.24], [0.24, -0.24], [-0.24, -0.24]]) {
                const stub = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.4, 0.1), mat);
                stub.position.set(ox, 0.3, oz);
                g.add(stub);
            }
            g.add(this.makeIconSprite('walls', 0.42, 0.6));
        } else if (type === 'AT_MINE') {
            // Anti-tank mine: a single larger shaped-charge disc with a red
            // sensor stripe, plus a couple of small rocks for camouflage.
            const mat = new THREE.MeshPhongMaterial({ color: 0x3a3a42, emissive: 0x202028, emissiveIntensity: 0.3 });
            const body = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.18, 0.1, 10), mat);
            body.position.y = 0.12; g.add(body);
            const stripe = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.02, 6, 12),
                new THREE.MeshPhongMaterial({ color: 0xcc2222, emissive: 0xcc2222, emissiveIntensity: 0.6 }));
            stripe.rotation.x = Math.PI / 2;
            stripe.position.y = 0.17;
            g.add(stripe);
            for (const [ox, oz] of [[-0.22, 0.18], [0.2, -0.2]]) {
                const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.06),
                    new THREE.MeshPhongMaterial({ color: 0x8a8a82 }));
                rock.position.set(ox, 0.1, oz);
                g.add(rock);
            }
            g.add(this.makeIconSprite('trap', 0.4, 0.5));
        } else {
            // Unknown structure: a generic marker.
            g.add(this.makeIconSprite('trap', 0.4, 0.5));
        }
        return g;
    }

    // --- Engineer structures (spikes / fortifications / fall traps). ---
    // Fall traps are hidden from other factions (a trap you can see is useless);
    // in spectate mode everything is shown.
    renderStructures(gameState) {
        if (!this.structureGroup) return;
        this._disposeGroupChildren(this.structureGroup);
        const structures = gameState.structures;
        if (!structures || !structures.size) return;
        const visible = gameState.visible || null;
        for (const [key, s] of structures) {
            const tile = gameState.tiles.get(key);
            if (!tile) continue;
            // Trap-type structures (FALL_TRAP/MINEFIELD/AT_MINE) are hidden
            // from other factions —a mine you can see is useless. BUNKER and
            // FORTIFICATION are visible to everyone (they're fortifications,
            // not concealed). In spectate mode everything is shown.
            const isTrap = s.type === 'FALL_TRAP' || s.type === 'MINEFIELD' || s.type === 'AT_MINE';
            if (isTrap && s.owner !== PLAYER_FACTION && visible) continue;
            if (tile.owner !== PLAYER_FACTION && visible && !visible.has(key)) continue;
            const [bx, bz] = key.split(',').map(Number);
            const baseY = (this.tileHeights.get(key) || 0) + 0.1;
            const prop = this.makeStructureProp(s.type);
            prop.position.set(bx - GRID_SIZE / 2, baseY, bz - GRID_SIZE / 2);
            this.structureGroup.add(prop);
        }
    }
    renderAuras(gameState) {
        this._disposeGroupChildren(this.auraGroup);
        this._auraRings = [];
        const visible = gameState.visible || null;
        for (const lord of gameState.lords) {
            if (!hasLordAura(lord)) continue;
            const isPlayer = lord.owner === PLAYER_FACTION;
            if (!isPlayer && visible && !visible.has(`${lord.x},${lord.z}`)) continue;
            const fc = this.fcolor(gameState, lord.owner);
            const cb = (LORD_CLASSES[lord.class] || {}).bonus || {};
            let color;
            if (cb.attack && cb.defense) color = 0xffd700;
            else if (cb.attack) color = 0xff3322;
            else if (cb.defense) color = 0x3388ff;
            else color = fc.tile;
            const baseY = (this.tileHeights.get(`${lord.x},${lord.z}`) || 0) + 0.04;
            const radius = 3.0;
            const segments = 48;
            const disc = new THREE.Mesh(new THREE.CircleGeometry(radius, segments),
                new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.08, depthWrite: false }));
            disc.rotation.x = -Math.PI / 2;
            disc.position.set(lord.x - GRID_SIZE / 2, baseY, lord.z - GRID_SIZE / 2);
            this.auraGroup.add(disc);
            const ring = new THREE.Mesh(new THREE.RingGeometry(radius - 0.06, radius + 0.02, segments),
                new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.45, depthWrite: false }));
            ring.rotation.x = -Math.PI / 2;
            ring.position.set(lord.x - GRID_SIZE / 2, baseY + 0.01, lord.z - GRID_SIZE / 2);
            this.auraGroup.add(ring);
            this._auraRings.push(ring);
        }
    }

    renderAll(gameState) {
        this._gs = gameState; // for fcolor() in setOwnershipEmissive/showInfluence
        // Sync ownership onto mesh userData (source of truth is the tile objects)
        for (const [key, mesh] of this.tileMeshes) {
            const tile = gameState.tiles.get(key);
            mesh.userData.owner = tile ? tile.owner : null;
        }

        // --- Fog of war: set tile visibility + base color BEFORE highlights ---
        const explored = gameState.explored || null;
        const visible = gameState.visible || null;
        this._fogExplored = explored;
        this._fogVisible = visible;
        for (const [key, mesh] of this.tileMeshes) {
            const baseColor = new THREE.Color(TERRAIN[mesh.userData.key].color);
            const isVisible = !!(visible && visible.has(key));
            // A tile shows if it has been explored OR is currently visible (the
            // latter covers Scry-revealed enemy cities, which are never added to
            // explored so the reveal stays temporary).
            if (!(explored && explored.has(key)) && !isVisible) {
                mesh.visible = false;
                continue;
            }
            mesh.visible = true;
            if (!isVisible) {
                // Explored-but-not-visible: dim, and tint toward owner if claimed.
                let c = baseColor.clone().multiplyScalar(0.35);
                if (mesh.userData.owner) {
                    const fc = this.fcolor(gameState, mesh.userData.owner);
                    c = new THREE.Color(fc.tile).lerp(c, 0.55);
                }
                mesh.material.color = c;
            } else {
                // Visible: blend the terrain base with the owner's faction color
                // so occupied territory (and captured cities) read clearly even
                // for dark factions (e.g. black Obsidian). Unowned = pure terrain.
                if (mesh.userData.owner) {
                    const fc = this.fcolor(gameState, mesh.userData.owner);
                    mesh.material.color = baseColor.clone().lerp(new THREE.Color(fc.tile), 0.55);
                } else {
                    mesh.material.color = baseColor;
                }
            }
        }

        // Breached city keeps glow red; owned+fortified keeps glow faction color.
        for (const [key, keep] of this.cityProps) {
            const tile = gameState.tiles.get(key);
            if (!tile) continue;
            const isExp = !!(explored && explored.has(key));
            const isVis = !!(visible && visible.has(key));
            if (!isExp && !isVis) continue;
            const breached = tile.terrain === 'CITY' && (tile.fortification || 0) === 0 && tile.fortMax > 0;
            if (breached) {
                keep.material.emissive = new THREE.Color(BREACH_COLOR);
                keep.material.emissiveIntensity = 0.9;
            } else if (tile.owner) {
                const fc = this.fcolor(gameState, tile.owner);
                keep.material.emissive = new THREE.Color(fc.tile);
                keep.material.emissiveIntensity = 0.45;
            } else {
                keep.material.emissive = new THREE.Color(0x000000);
                keep.material.emissiveIntensity = 0;
            }
        }

        this.clearHighlights();
        this.highlightMoveTargets(gameState.moveTargets || []);
        this.highlightAttackTargets(gameState.attackTargets || []);

        // City name labels: one floating text sprite per visible/explored city.
        // Rebuilt each render (cheap —sprites reuse cached materials). The
        // label sits above the keep and is tinted by the owner's faction color
        // so ownership is readable at a glance.
        this._disposeGroupChildren(this.labelGroup);
        for (const [key, tile] of gameState.tiles) {
            if (tile.terrain !== 'CITY') continue;
            const isExp = !!(explored && explored.has(key));
            const isVis = !!(visible && visible.has(key));
            if (!isExp && !isVis) continue;
            const name = tile.cityName || `City ${tile.x},${tile.z}`;
            const owner = tile.owner;
            let color = '#ffffff';
            if (owner) {
                const fc = this.fcolor(gameState, owner);
                const hex = '#' + (fc.tile >>> 0).toString(16).padStart(6, '0');
                // Lighten dark faction colors so the text stays legible against
                // the dark map background.
                color = hex;
            }
            const lvl = tile.cityLevel || 1;
            const label = this.makeTextSprite(name, { color, scale: 0.55 + Math.min(lvl, 5) * 0.04 });
            const y = (this.tileHeights.get(key) || 0) + 1.1;
            label.position.set(tile.x - GRID_SIZE / 2, y, tile.z - GRID_SIZE / 2);
            this.labelGroup.add(label);
        }

        // Rebuild unit markers (distinct shape per unit type) —enemy units
        // only render on tiles the player can currently see.
        this._disposeGroupChildren(this.unitGroup);
        this._flames = []; // repopulated below with live flame meshes for flicker
        for (const unit of gameState.units.values()) {
            // Units embarked aboard a Transport are hidden (rendered as cargo pips on the ship).
            if (unit.boarded) continue;
            const isPlayer = unit.owner === PLAYER_FACTION;
            if (!isPlayer && visible && !visible.has(`${unit.x},${unit.z}`)) continue;
            const fc = this.fcolor(gameState, unit.owner);
            const naval = UNIT_TYPE[unit.type] && UNIT_TYPE[unit.type].naval;
            // Detailed multi-part model; ships sit lower on the water.
            const mesh = this.makeUnitModel(unit.type, fc.unit);
            const yOffset = naval ? 0.06 : 0.16;
            const y = (this.tileHeights.get(`${unit.x},${unit.z}`) || 0) + yOffset;
            mesh.position.set(unit.x - GRID_SIZE / 2, y, unit.z - GRID_SIZE / 2);
            mesh.userData = { unitId: unit.id, x: unit.x, z: unit.z };
            // Faint faction-tinted emissive keeps dark units (e.g. black Obsidian)
            // readable against any terrain.
            mesh.traverse(o => {
                if (o.isMesh && o.material && o.material.emissive) {
                    o.material.emissive = new THREE.Color(fc.unit);
                    o.material.emissiveIntensity = 0.18;
                }
            });
            if (hasIcon(unit.type)) {
                mesh.add(this.makeIconSprite(unit.type, 0.45, naval ? 0.7 : 0.95));
            }
            // Cargo pips on a Transport: one dot per carried unit.
            if (unit.type === 'TRANSPORT' && unit.cargo && unit.cargo.length) {
                for (let i = 0; i < unit.cargo.length; i++) {
                    const pip = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 6),
                        new THREE.MeshPhongMaterial({ color: 0xffe070 }));
                    pip.position.set(0.18 - i * 0.18, 0.55, 0);
                    mesh.add(pip);
                }
            }
            // Fire ailment: a flickering flame cone above a burning unit.
            if (unit.burn && unit.burn > 0) {
                const flame = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.28, 8),
                    new THREE.MeshBasicMaterial({ color: 0xff6622, transparent: true, opacity: 0.9 }));
                flame.position.set(0, naval ? 0.85 : 1.15, 0);
                mesh.add(flame);
                mesh.add(this.makeIconSprite('fire', 0.32, naval ? 0.95 : 1.3));
                this._flames.push(flame); // tracked so animate() can flicker it
            }
            // Stun (chariot post-charge / fall trap): dizzy indicator above unit.
            if (unit.stunnedTurns && unit.stunnedTurns > 0) {
                mesh.add(this.makeIconSprite('stun', 0.32, naval ? 0.95 : 1.3));
            } else if (unit.chargeExhausted && unit.chargeExhausted > 0) {
                // Exhausted cavalry: sweat/fatigue indicator.
                mesh.add(this.makeIconSprite('exhausted', 0.3, naval ? 0.95 : 1.3));
            }
            this.unitGroup.add(mesh);
        }

        // Rebuild lord markers —each lord is a humanoid figure with
        // faction-specific weapons, mounts, and decorations. Kings get a crown
        // sprite, gold base ring, cape, and 1.25× scale.
        this._disposeGroupChildren(this.lordGroup);
        for (const lord of gameState.lords) {
            const isPlayer = lord.owner === PLAYER_FACTION;
            if (!isPlayer && visible && !visible.has(`${lord.x},${lord.z}`)) continue;
            const fc = this.fcolor(gameState, lord.owner);
            const factionId = (gameState.factionAssignments && gameState.factionAssignments[lord.owner]) || null;
            const mesh = this.makeLordModel(lord, fc, factionId);
            const y = (this.tileHeights.get(`${lord.x},${lord.z}`) || 0) + 0.05;
            mesh.position.set(lord.x - GRID_SIZE / 2, y, lord.z - GRID_SIZE / 2);
            mesh.userData = { lordId: lord.id, x: lord.x, z: lord.z };
            this.lordGroup.add(mesh);
        }

        this.renderBuildings(gameState);
        this.renderGoalMarkers(gameState);
        this.renderAuras(gameState);
        this.renderBridges(gameState);
        this.renderStructures(gameState);
        this.renderMinimap(gameState);
    }

    // --- Minimap ---
    // Draws the whole map onto the #minimap canvas: terrain colors dimmed by
    // fog, ownership tint, city dots, and a viewport rectangle for the current
    // camera frustum. Clicking the minimap recenters the camera on the clicked
    // tile (wired up in game.js via setMinimapClickHandler).
    renderMinimap(gameState) {
        const canvas = document.getElementById('minimap');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const W = canvas.width, H = canvas.height;
        const tiles = gameState.tiles;
        if (!tiles || tiles.size === 0) return;
        // Determine map bounds from the tile set (GRID_WIDTH/HEIGHT may not be
        // set yet on first render).
        let maxX = 0, maxZ = 0;
        for (const t of tiles.values()) {
            if (t.x > maxX) maxX = t.x;
            if (t.z > maxZ) maxZ = t.z;
        }
        const gw = maxX + 1, gh = maxZ + 1;
        const sx = W / gw, sz = H / gh;
        ctx.fillStyle = '#0e1320';
        ctx.fillRect(0, 0, W, H);
        const explored = gameState.explored || null;
        const visible = gameState.visible || null;
        for (const t of tiles.values()) {
            const key = `${t.x},${t.z}`;
            const isExp = !!(explored && explored.has(key));
            const isVis = !!(visible && visible.has(key));
            if (!isExp && !isVis) continue;
            const terr = TERRAIN[t.terrain] || TERRAIN.PLAINS;
            let c = new THREE.Color(terr.color);
            if (t.owner) {
                const fc = this.fcolor(gameState, t.owner);
                c = c.lerp(new THREE.Color(fc.tile), 0.85);
            }
            if (!isVis) c = c.multiplyScalar(0.4);
            const hex = '#' + (c.getHexString ? c.getHexString() : c.toString(16).padStart(6, '0'));
            ctx.fillStyle = hex;
            ctx.fillRect(t.x * sx, t.z * sz, Math.ceil(sx), Math.ceil(sz));
        }
        // City dots (brighter, so cities pop on the minimap).
        for (const t of tiles.values()) {
            if (t.terrain !== 'CITY') continue;
            const key = `${t.x},${t.z}`;
            const isExp = !!(explored && explored.has(key));
            const isVis = !!(visible && visible.has(key));
            if (!isExp && !isVis) continue;
            ctx.fillStyle = t.owner ? '#ffe070' : '#c9b06b';
            ctx.beginPath();
            ctx.arc(t.x * sx + sx / 2, t.z * sz + sz / 2, Math.max(1.5, sx * 0.6), 0, Math.PI * 2);
            ctx.fill();
        }
        // Viewport rectangle: project the camera's world-space bounds back to
        // tile space. The orthographic camera spans [left,right] x [top,bottom]
        // in world units; tile (x,z) sits at world (x - GRID_SIZE/2, z - GRID_SIZE/2).
        const cam = this.camera;
        const halfW = (cam.right - cam.left) / 2;
        const halfH = (cam.top - cam.bottom) / 2;
        const cx = cam.position.x, cz = cam.position.z;
        const gs = GRID_SIZE;
        // World -> tile: tileX = worldX + gs/2. Invert the tile->world translation.
        const tileMinX = (cx - halfW) + gs / 2;
        const tileMaxX = (cx + halfW) + gs / 2;
        const tileMinZ = (cz - halfH) + gs / 2;
        const tileMaxZ = (cz + halfH) + gs / 2;
        ctx.strokeStyle = 'rgba(232,196,104,0.9)';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(
            Math.max(0, tileMinX * sx),
            Math.max(0, tileMinZ * sz),
            Math.min(W, (tileMaxX - tileMinX) * sx),
            Math.min(H, (tileMaxZ - tileMinZ) * sz)
        );
    }

    /** Convert a minimap canvas click (in canvas pixel coords) to a tile
     *  coordinate, for the click-to-recenter handler in game.js. */
    minimapClickToTile(canvasX, canvasY, gameState) {
        const tiles = gameState.tiles;
        if (!tiles || tiles.size === 0) return null;
        let maxX = 0, maxZ = 0;
        for (const t of tiles.values()) {
            if (t.x > maxX) maxX = t.x;
            if (t.z > maxZ) maxZ = t.z;
        }
        const gw = maxX + 1, gh = maxZ + 1;
        const canvas = document.getElementById('minimap');
        const W = canvas ? canvas.width : 168, H = canvas ? canvas.height : 168;
        const tx = Math.floor((canvasX / W) * gw);
        const tz = Math.floor((canvasY / H) * gh);
        return { x: tx, z: tz };
    }
}
