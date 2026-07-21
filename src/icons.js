// src/icons.js
// Central vector icon set for the whole UI. Every icon is a 24x24 viewBox SVG.
// DOM consumers use svgIcon(); the 3D renderer uses svgDataURL() to paint
// crisp high-DPI textures onto canvas sprites (replacing the old emoji glyphs).

const C = {
  steel: '#c2cad6', darkSteel: '#6b7480', gold: '#e8c468', goldDeep: '#b8923a',
  wood: '#a9743b', woodDark: '#6e4a25', red: '#d4564b', green: '#6fbf73',
  blue: '#5b8def', iron: '#9aa3b0', leather: '#8a5a2b', leatherLt: '#b07c45',
  parch: '#e9dcc0', ink: '#2a2f3a', shadow: '#1b2230', white: '#f3f5f9',
  purple: '#9b6bd4', water: '#3f7fbf', fire: '#e07b3a'
};

// Inner SVG markup (no outer <svg>). Use a 24x24 coordinate space.
const ICONS = {
  // ---- Resources ----
  gold: `<circle cx="12" cy="12" r="8" fill="${C.gold}" stroke="${C.goldDeep}" stroke-width="1.5"/><circle cx="12" cy="12" r="4.5" fill="none" stroke="${C.goldDeep}" stroke-width="1.2"/><path d="M12 4 v2 M12 18 v2 M4 12 h2 M18 12 h2" stroke="${C.goldDeep}" stroke-width="1.2" stroke-linecap="round"/>`,
  food: `<path d="M12 3 C7 3 5 7 5 11 c0 4 3 5 7 5 s7 -1 7 -5 c0 -4 -2 -8 -7 -8 Z" fill="${C.green}" stroke="${C.green}" stroke-width="0.5"/><path d="M12 19 v3 M9 21 h6" stroke="${C.woodDark}" stroke-width="1.5" stroke-linecap="round"/>`,
  wood: `<rect x="5" y="9" width="14" height="3" rx="1.2" fill="${C.wood}" stroke="${C.woodDark}" stroke-width="0.8"/><rect x="5" y="13" width="14" height="3" rx="1.2" fill="${C.wood}" stroke="${C.woodDark}" stroke-width="0.8"/><circle cx="7.5" cy="10.5" r="1" fill="${C.woodDark}"/><circle cx="16.5" cy="14.5" r="1" fill="${C.woodDark}"/>`,
  iron: `<path d="M6 8 h12 l-2 11 H8 Z" fill="${C.iron}" stroke="${C.darkSteel}" stroke-width="1.2"/><path d="M5 8 h14" stroke="${C.darkSteel}" stroke-width="1.5" stroke-linecap="round"/>`,
  production: `<path d="M12 3 a9 9 0 1 1 -8.5 6.2" fill="none" stroke="${C.blue}" stroke-width="2.4" stroke-linecap="round"/><path d="M12 3 v6 l4 2.5" fill="none" stroke="${C.blue}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`,

  // ---- Stats ----
  attack: `<path d="M4 20 L14 10 M14 10 L11 7 M14 10 l3 -1 M11 7 l3 -3 3 3 -3 3 Z" fill="${C.steel}" stroke="${C.darkSteel}" stroke-width="1" stroke-linejoin="round"/>`,
  defense: `<path d="M12 3 l7 3 v5 c0 5 -3 8 -7 10 c-4 -2 -7 -5 -7 -10 V6 Z" fill="${C.steel}" stroke="${C.darkSteel}" stroke-width="1.4" stroke-linejoin="round"/><path d="M9 12 l2 2 4 -4" fill="none" stroke="${C.gold}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>`,
  hp: `<path d="M12 20 C3 14 4 6 9 6 c2 0 3 1.5 3 3 c0 -1.5 1 -3 3 -3 c5 0 6 8 -3 14 Z" fill="${C.red}" stroke="${C.red}" stroke-width="0.6"/>`,
  move: `<path d="M12 3 l8 8 h-4 v8 h-8 v-8 H4 Z" fill="${C.green}" stroke="${C.shadow}" stroke-width="1" stroke-linejoin="round"/>`,
  range: `<circle cx="12" cy="12" r="3" fill="${C.blue}"/><circle cx="12" cy="12" r="8" fill="none" stroke="${C.blue}" stroke-width="1.4" stroke-dasharray="2 2"/>`,
  level: `<path d="M12 3 l2.6 5.6 6 .8 -4.4 4.2 1.1 6 -5.3 -2.9 -5.3 2.9 1.1 -6 -4.4 -4.2 6 -.8 Z" fill="${C.gold}" stroke="${C.goldDeep}" stroke-width="1" stroke-linejoin="round"/>`,

  // ---- Buildings ----
  farm: `<rect x="4" y="14" width="16" height="6" rx="1" fill="${C.woodDark}"/><path d="M4 14 c0 -5 3 -8 8 -8 s8 3 8 8" fill="${C.green}" stroke="${C.green}" stroke-width="0.5"/><path d="M12 6 v8 M8 10 l4 -4 4 4" stroke="${C.woodDark}" stroke-width="1.2" fill="none"/>`,
  lumbermill: `<rect x="4" y="13" width="16" height="7" rx="1" fill="${C.wood}"/><path d="M9 13 l3 -7 3 7 Z" fill="${C.woodDark}"/><path d="M6 16 h12 M9 19 h6" stroke="${C.woodDark}" stroke-width="1"/>`,
  mine: `<path d="M4 17 h16 v3 H4 Z" fill="${C.darkSteel}"/><path d="M7 17 l5 -9 5 9 Z" fill="${C.iron}" stroke="${C.darkSteel}" stroke-width="0.8"/><path d="M12 8 v9" stroke="${C.darkSteel}" stroke-width="0.8"/>`,
  market: `<path d="M5 9 h14 l-1.5 11 H6.5 Z" fill="${C.parch}" stroke="${C.woodDark}" stroke-width="1"/><path d="M5 9 q7 -5 14 0" fill="none" stroke="${C.woodDark}" stroke-width="1.2"/><path d="M9 9 v11 M15 9 v11" stroke="${C.woodDark}" stroke-width="0.8"/>`,
  barracks: `<path d="M4 20 v-9 l8 -5 8 5 v9 Z" fill="${C.darkSteel}" stroke="${C.shadow}" stroke-width="1"/><path d="M4 11 l8 -5 8 5" fill="none" stroke="${C.steel}" stroke-width="1.4"/><rect x="10" y="13" width="4" height="7" fill="${C.gold}"/>`,
  walls: `<rect x="3" y="10" width="18" height="9" fill="${C.darkSteel}" stroke="${C.shadow}" stroke-width="0.8"/><path d="M3 10 v-3 h3 v3 h3 v-3 h3 v3 h3 v-3 h3 v3 h3" fill="${C.steel}"/>`,
  harbor: `<path d="M5 13 h14 v2 H5 Z" fill="${C.wood}"/><path d="M12 3 v9 M12 3 l6 6" stroke="${C.steel}" stroke-width="1.6" fill="none" stroke-linecap="round"/><path d="M6 15 q6 4 12 0" fill="${C.water}"/>`,
  siege_workshop: `<rect x="4" y="11" width="16" height="9" fill="${C.woodDark}"/><circle cx="9" cy="9" r="3" fill="none" stroke="${C.iron}" stroke-width="2"/><circle cx="15" cy="9" r="3" fill="none" stroke="${C.iron}" stroke-width="2"/><path d="M5 11 v9 M19 11 v9" stroke="${C.wood}" stroke-width="1.4"/>`,

  // ---- Units (land) ----
  INFANTRY: `<path d="M12 3 a2.4 2.4 0 1 1 0 4.8 a2.4 2.4 0 0 1 0 -4.8 Z" fill="${C.steel}"/><path d="M8 10 l4 -2 4 2 -1 8 h-6 Z" fill="${C.steel}" stroke="${C.darkSteel}" stroke-width="0.8"/><path d="M12 12 v7" stroke="${C.gold}" stroke-width="1.4"/>`,
  ARCHER: `<circle cx="12" cy="5" r="2.4" fill="${C.green}"/><path d="M8 11 l4 -2 4 2 -1 7 h-6 Z" fill="${C.green}" stroke="${C.darkSteel}" stroke-width="0.8"/><path d="M17 6 q4 6 0 12" fill="none" stroke="${C.woodDark}" stroke-width="1.4"/><path d="M17 6 l-2 6 2 6" stroke="${C.steel}" stroke-width="1"/>`,
  LONGBOWMAN: `<circle cx="12" cy="5" r="2.4" fill="${C.green}"/><path d="M8 11 l4 -2 4 2 -1 7 h-6 Z" fill="${C.green}" stroke="${C.darkSteel}" stroke-width="0.8"/><path d="M18 4 q5 8 0 16" fill="none" stroke="${C.woodDark}" stroke-width="1.6"/><path d="M18 4 l-3 8 3 8" stroke="${C.steel}" stroke-width="1"/>`,
  PIKEMAN: `<circle cx="12" cy="4" r="2.2" fill="${C.steel}"/><path d="M9 10 l3 -2 3 2 -1 8 h-4 Z" fill="${C.steel}"/><path d="M12 2 v12" stroke="${C.woodDark}" stroke-width="1.6"/><path d="M12 2 l2 3 -2 1 -2 -3 Z" fill="${C.iron}"/>`,
  CAVALRY: `<path d="M5 16 q-1 -5 4 -6 q3 -4 7 -2 q1 4 -2 5 l3 1 -1 3 -3 -1 q-1 3 -4 2 q-3 0 -4 -2 Z" fill="${C.leather}"/><circle cx="9" cy="7" r="2" fill="${C.steel}"/><path d="M16 8 l4 -2 -1 4 -3 1 Z" fill="${C.steel}" stroke="${C.darkSteel}" stroke-width="0.6"/>`,
  CATAPHRACT: `<path d="M4 16 q-1 -5 4 -6 q3 -4 7 -2 q1 4 -2 5 l3 1 -1 3 -3 -1 q-1 3 -4 2 q-3 0 -4 -2 Z" fill="${C.iron}" stroke="${C.darkSteel}" stroke-width="1"/><circle cx="9" cy="7" r="2" fill="${C.steel}"/><path d="M16 8 l4 -2 -1 4 -3 1 Z" fill="${C.steel}"/><path d="M6 12 h6" stroke="${C.gold}" stroke-width="1.2"/>`,
  CHARIOT: `<path d="M5 15 h11 v2 H5 Z" fill="${C.wood}"/><circle cx="8" cy="18" r="2.4" fill="none" stroke="${C.iron}" stroke-width="2"/><circle cx="15" cy="18" r="2.4" fill="none" stroke="${C.iron}" stroke-width="2"/><path d="M16 9 l4 -3 -1 6 -3 1 Z" fill="${C.steel}"/><path d="M10 9 v6" stroke="${C.gold}" stroke-width="1.4"/>`,
  SCOUT: `<circle cx="12" cy="5" r="2.2" fill="${C.green}"/><path d="M9 11 l3 -2 3 2 -1 7 h-4 Z" fill="${C.green}"/><circle cx="17" cy="9" r="2.6" fill="none" stroke="${C.steel}" stroke-width="1.4"/><path d="M17 6.4 v5.2 M14.4 9 h5.2" stroke="${C.steel}" stroke-width="1"/>`,
  SIEGE: `<path d="M9 4 h6 v3 H9 Z" fill="${C.iron}"/><circle cx="9" cy="14" r="4" fill="none" stroke="${C.iron}" stroke-width="2.4"/><circle cx="9" cy="14" r="1.4" fill="${C.darkSteel}"/><path d="M15 7 h3 l-1 4" stroke="${C.woodDark}" stroke-width="1.6" fill="none"/>`,
  SETTLER: `<path d="M12 3 a2.2 2.2 0 1 1 0 4.4 a2.2 2.2 0 0 1 0 -4.4 Z" fill="${C.gold}"/><path d="M8 11 l4 -2 4 2 -1 8 h-6 Z" fill="${C.gold}" stroke="${C.goldDeep}" stroke-width="0.8"/><path d="M5 19 h14 v2 H5 Z" fill="${C.wood}"/>`,
  ENGINEER: `<circle cx="12" cy="5" r="2.2" fill="${C.wood}"/><path d="M9 11 l3 -2 3 2 -1 7 h-4 Z" fill="${C.wood}"/><path d="M16 13 l4 -4 -1.4 1.4 1.4 1.4 -1.4 1.4 1.4 1.4 -4 4 Z" fill="${C.steel}" stroke="${C.darkSteel}" stroke-width="0.6"/>`,
  MEDIC: `<circle cx="12" cy="5" r="2.2" fill="${C.white}"/><path d="M9 11 l3 -2 3 2 -1 7 h-4 Z" fill="${C.white}" stroke="${C.darkSteel}" stroke-width="0.8"/><path d="M12 14 v5 M9.5 16.5 h5" stroke="${C.red}" stroke-width="2" stroke-linecap="round"/>`,
  SIEGE_TOWER: `<rect x="7" y="6" width="10" height="15" rx="1" fill="${C.wood}" stroke="${C.woodDark}" stroke-width="1"/><path d="M7 10 h10 M7 14 h10 M7 18 h10" stroke="${C.woodDark}" stroke-width="0.8"/><path d="M9 6 v-2 h6 v2" fill="${C.woodDark}"/>`,
  CATAPULT: `<path d="M5 18 h12 l-2 -3 H7 Z" fill="${C.wood}"/><path d="M7 15 q-2 -6 4 -7" fill="none" stroke="${C.woodDark}" stroke-width="2"/><circle cx="7" cy="15" r="2" fill="${C.iron}"/><circle cx="13" cy="8" r="1.6" fill="${C.steel}"/>`,
  TREBUCHET: `<path d="M5 19 h14" stroke="${C.woodDark}" stroke-width="2"/><path d="M8 19 V8 M16 19 V11" stroke="${C.wood}" stroke-width="2"/><path d="M8 8 L18 13" stroke="${C.woodDark}" stroke-width="1.6"/><circle cx="8" cy="8" r="1.8" fill="${C.iron}"/><circle cx="18" cy="13" r="1.8" fill="${C.steel}"/>`,
  WORKER: `<circle cx="12" cy="5" r="2.2" fill="${C.wood}"/><path d="M9 11 l3 -2 3 2 -1 7 h-4 Z" fill="${C.wood}"/><path d="M9 14 h6" stroke="${C.gold}" stroke-width="1.4"/>`,
  // ---- New European-faction units (Phase G) ----
  LEGIONNAIRE: `<circle cx="12" cy="4.5" r="2.2" fill="${C.steel}"/><path d="M9 10 l3 -2 3 2 -1 8 h-4 Z" fill="${C.darkSteel}" stroke="${C.shadow}" stroke-width="0.8"/><path d="M6 11 q-2 4 0 7 h-3 Z" fill="${C.red}" stroke="${C.shadow}" stroke-width="0.6"/><path d="M12 3 v-1.5" stroke="${C.red}" stroke-width="1.4"/>`,
  BERSERKER: `<circle cx="12" cy="5" r="2.2" fill="${C.leather}"/><path d="M8 11 l4 -2 4 2 -1 7 h-6 Z" fill="${C.leather}" stroke="${C.shadow}" stroke-width="0.8"/><path d="M14 7 l5 -2 -1 5 -4 1 Z" fill="${C.iron}" stroke="${C.darkSteel}" stroke-width="0.6"/><path d="M14 7 l4 3" stroke="${C.woodDark}" stroke-width="1.4"/>`,
  VARANGIAN_GUARD: `<circle cx="12" cy="5" r="2.2" fill="${C.steel}"/><path d="M8 11 l4 -2 4 2 -1 7 h-4 Z" fill="${C.steel}" stroke="${C.darkSteel}" stroke-width="1"/><path d="M15 4 l5 5 -3 3 -5 -5 Z" fill="${C.iron}" stroke="${C.darkSteel}" stroke-width="0.6"/><path d="M16 9 l3 9" stroke="${C.woodDark}" stroke-width="1.6"/>`,
  CONQUISTADOR: `<path d="M5 16 q-1 -5 4 -6 q3 -4 7 -2 q1 4 -2 5 l3 1 -1 3 -3 -1 q-1 3 -4 2 q-3 0 -4 -2 Z" fill="${C.steel}" stroke="${C.darkSteel}" stroke-width="0.8"/><circle cx="9" cy="7" r="2" fill="${C.gold}"/><path d="M16 8 l5 -1 -1 4 -3 1 Z" fill="${C.darkSteel}"/><path d="M17 9 l3 1" stroke="${C.gold}" stroke-width="1.2"/>`,
  WINGED_HUSSAR: `<path d="M5 16 q-1 -5 4 -6 q3 -4 7 -2 q1 4 -2 5 l3 1 -1 3 -3 -1 q-1 3 -4 2 q-3 0 -4 -2 Z" fill="${C.white}" stroke="${C.shadow}" stroke-width="0.8"/><circle cx="9" cy="7" r="2" fill="${C.steel}"/><path d="M16 5 q3 -1 5 2 M16 7 q3 0 5 3" fill="none" stroke="${C.white}" stroke-width="1.2"/><path d="M16 8 l4 -2 -1 4 -3 1 Z" fill="${C.gold}"/>`,
  CROSSBOWMAN: `<circle cx="12" cy="5" r="2.2" fill="${C.steel}"/><path d="M8 11 l4 -2 4 2 -1 7 h-6 Z" fill="${C.steel}" stroke="${C.darkSteel}" stroke-width="0.8"/><path d="M7 7 l9 8 M16 7 l-9 8" stroke="${C.woodDark}" stroke-width="1.6"/><path d="M11.5 14.5 l1 0" stroke="${C.steel}" stroke-width="1.6"/>`,

  // ---- Units (naval) ----
  GALLEY: `<path d="M4 14 h16 l-2 4 H6 Z" fill="${C.wood}"/><path d="M12 4 v9 M12 4 l5 6" stroke="${C.steel}" stroke-width="1.6" fill="none"/><path d="M6 18 q6 3 12 0" fill="${C.water}"/>`,
  TRANSPORT: `<path d="M3 13 h18 l-2 5 H5 Z" fill="${C.wood}"/><rect x="6" y="8" width="12" height="5" fill="${C.woodDark}"/><path d="M7 8 v-3 h7 v3" fill="none" stroke="${C.steel}" stroke-width="1.4"/>`,
  TRIREME: `<path d="M4 14 h16 l-2 4 H6 Z" fill="${C.wood}"/><path d="M12 3 v10 M12 3 l5 6" stroke="${C.steel}" stroke-width="1.6"/><path d="M6 18 q6 3 12 0" fill="${C.water}"/><path d="M5 17 h14" stroke="${C.iron}" stroke-width="1.2"/>`,
  FRIGATE: `<path d="M3 13 h18 l-3 5 H6 Z" fill="${C.iron}"/><path d="M12 2 v10 M12 2 l6 7" stroke="${C.steel}" stroke-width="1.6"/><rect x="9" y="9" width="4" height="4" fill="${C.darkSteel}"/>`,
  GALLEON: `<path d="M3 14 h18 l-3 5 H6 Z" fill="${C.wood}"/><path d="M8 14 V3 h4 v11 M14 14 V6 h3 v8" fill="none" stroke="${C.steel}" stroke-width="1.4"/><path d="M6 19 q7 3 14 0" fill="${C.water}"/>`,
  CARAVEL: `<path d="M4 14 h16 l-2 4 H6 Z" fill="${C.wood}"/><path d="M12 4 v10 M12 4 l5 6 M12 7 l-4 4" stroke="${C.steel}" stroke-width="1.4"/><path d="M6 18 q6 3 12 0" fill="${C.water}"/>`,
  BATTLESHIP: `<path d="M3 13 h18 l-4 6 H7 Z" fill="${C.darkSteel}"/><rect x="10" y="6" width="4" height="7" fill="${C.iron}"/><path d="M12 3 v3 M8 9 h8" stroke="${C.steel}" stroke-width="1.4"/><path d="M5 19 h14" stroke="${C.fire}" stroke-width="1.4"/>`,
  SUBMARINE: `<path d="M4 13 q8 -6 16 0 q-8 5 -16 0 Z" fill="${C.iron}"/><circle cx="16" cy="13" r="2" fill="${C.darkSteel}"/><path d="M8 10 v-3 h2 v3" stroke="${C.steel}" stroke-width="1.4"/>`,
  DESTROYER: `<path d="M3 13 h18 l-3 5 H6 Z" fill="${C.steel}"/><path d="M12 4 v9 M12 4 l5 6" stroke="${C.iron}" stroke-width="1.6"/><path d="M6 18 q6 3 12 0" fill="${C.water}"/>`,
  IRONCLAD: `<path d="M4 13 h16 l-2 5 H6 Z" fill="${C.iron}"/><rect x="9" y="8" width="6" height="5" fill="${C.darkSteel}"/><path d="M12 3 v5" stroke="${C.steel}" stroke-width="2"/>`,

  // ---- UI glyphs ----
  endturn: `<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 7 v5 l4 2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`,
  mute: `<path d="M5 9 h3 l4 -3 v12 l-4 -3 H5 Z" fill="currentColor"/><path d="M16 9 l4 6 M20 9 l-4 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`,
  unmute: `<path d="M5 9 h3 l4 -3 v12 l-4 -3 H5 Z" fill="currentColor"/><path d="M15 8 q4 4 0 8 M17 6 q6 6 0 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>`,
  settings: `<circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 2 v3 M12 19 v3 M2 12 h3 M19 12 h3 M4.5 4.5 l2 2 M17.5 17.5 l2 2 M19.5 4.5 l-2 2 M6.5 17.5 l-2 2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`,
  flag: `<path d="M6 3 v18 M6 4 h12 l-3 4 3 4 H6" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>`,
  crown: `<path d="M3 8 l3 6 3 -4 3 4 3 -4 3 4 3 -6 -2 11 H5 Z" fill="${C.gold}" stroke="${C.goldDeep}" stroke-width="1" stroke-linejoin="round"/>`,
  star: `<path d="M12 3 l2.6 5.6 6 .8 -4.4 4.2 1.1 6 -5.3 -2.9 -5.3 2.9 1.1 -6 -4.4 -4.2 6 -.8 Z" fill="${C.gold}" stroke="${C.goldDeep}" stroke-width="0.8" stroke-linejoin="round"/>`,
  heart: `<path d="M12 20 C3 14 4 6 9 6 c2 0 3 1.5 3 3 c0 -1.5 1 -3 3 -3 c5 0 6 8 -3 14 Z" fill="${C.red}"/>`,
  target: `<circle cx="12" cy="12" r="3" fill="none" stroke="${C.red}" stroke-width="2"/><circle cx="12" cy="12" r="8" fill="none" stroke="${C.red}" stroke-width="1.6" stroke-dasharray="2 2"/>`,
  swords: `<path d="M4 4 L15 15 M15 15 l-3 -1 M15 15 l-1 3" stroke="${C.red}" stroke-width="2" stroke-linecap="round"/><path d="M20 4 L9 15 M9 15 l3 -1 M9 15 l1 3" stroke="${C.steel}" stroke-width="2" stroke-linecap="round"/>`,
  scroll: `<path d="M6 4 h12 v13 H6 Z" fill="${C.parch}" stroke="${C.woodDark}" stroke-width="1"/><path d="M9 8 h6 M9 11 h6" stroke="${C.woodDark}" stroke-width="1"/>`,
  coin: `<circle cx="12" cy="12" r="8" fill="${C.gold}" stroke="${C.goldDeep}" stroke-width="1.5"/><path d="M12 7 v10 M9 10 h6 M9 14 h6" stroke="${C.goldDeep}" stroke-width="1.4"/>`,
  gear: `<circle cx="12" cy="12" r="3.5" fill="none" stroke="${C.blue}" stroke-width="2"/><path d="M12 3 v3 M12 18 v3 M3 12 h3 M18 12 h3 M5 5 l2 2 M17 17 l2 2 M19 5 l-2 2 M7 17 l-2 2" stroke="${C.blue}" stroke-width="2" stroke-linecap="round"/>`,
  pillage: `<path d="M12 3 l9 16 H3 Z" fill="${C.gold}" stroke="${C.goldDeep}" stroke-width="1"/><path d="M12 9 v5 M12 16 v0.5" stroke="${C.goldDeep}" stroke-width="2" stroke-linecap="round"/>`,
  charge: `<path d="M13 2 L5 13 h5 l-2 9 9 -12 h-5 Z" fill="${C.gold}" stroke="${C.goldDeep}" stroke-width="0.8" stroke-linejoin="round"/>`,
  join: `<circle cx="9" cy="9" r="4" fill="none" stroke="${C.blue}" stroke-width="2"/><path d="M15 7 v8 M11 11 h8" stroke="${C.blue}" stroke-width="2" stroke-linecap="round"/>`,
  city: `<path d="M5 20 V10 l4 -3 4 3 v10 Z" fill="${C.steel}" stroke="${C.darkSteel}" stroke-width="1"/><path d="M13 20 v-7 l3 -2 3 2 v7 Z" fill="${C.iron}" stroke="${C.darkSteel}" stroke-width="1"/>`,
  wonder: `<path d="M12 3 l2 5 5 0 -4 4 1.5 5 -4.5 -3 -4.5 3 1.5 -5 -4 -4 5 0 Z" fill="${C.purple}" stroke="${C.purple}" stroke-width="0.4"/>`,

  // --- Status / structure glyphs (3D world) ---
  spikes: `<path d="M12 4 l3 6 -3 -1 -3 1 Z M5 16 l3 4 -3 -1 -3 1 Z M19 16 l3 4 -3 -1 -3 1 Z" fill="${C.iron}" stroke="${C.darkSteel}" stroke-width="0.8" stroke-linejoin="round"/>`,
  trap: `<path d="M4 12 a8 8 0 0 1 16 0 a8 8 0 0 1 -16 0 Z" fill="none" stroke="${C.woodDark}" stroke-width="1.6"/><path d="M8 12 l8 0 M12 8 l0 8" stroke="${C.woodDark}" stroke-width="1.2" stroke-dasharray="2 2"/>`,
  fire: `<path d="M12 3 c3 4 -1 5 1 8 c2 -1 2 -4 1 -5 c3 3 4 6 2 9 c-1 3 -7 3 -9 0 c-2 -4 0 -7 2 -9 c1 2 1 4 2 4 c1 -2 -1 -4 1 -7 Z" fill="${C.fire}" stroke="${C.red}" stroke-width="0.6"/>`,
  stun: `<path d="M12 4 a8 7 0 1 0 0.1 0 Z" fill="${C.gold}" stroke="${C.goldDeep}" stroke-width="1"/><circle cx="9" cy="11" r="1.3" fill="${C.shadow}"/><circle cx="15" cy="11" r="1.3" fill="${C.shadow}"/><path d="M9 16 q3 2 6 0" stroke="${C.shadow}" stroke-width="1.2" fill="none"/>`,
  exhausted: `<path d="M8 9 q2 -2 4 0 M16 9 q-2 -2 -4 0" stroke="${C.blue}" stroke-width="1.6" fill="none" stroke-linecap="round"/><circle cx="8" cy="12" r="1.3" fill="${C.blue}"/><circle cx="16" cy="12" r="1.3" fill="${C.blue}"/>`,
  bridge: `<path d="M3 14 h18" stroke="${C.woodDark}" stroke-width="2"/><path d="M5 14 q7 -8 14 0" fill="none" stroke="${C.wood}" stroke-width="1.6"/><path d="M7 14 v4 M12 14 v4 M17 14 v4" stroke="${C.woodDark}" stroke-width="1.4"/>`,
  conceal: `<path d="M3 12 q4 -5 9 -5 q5 0 9 5 q-4 5 -9 5 q-5 0 -9 -5 Z" fill="${C.green}" stroke="${C.green}" stroke-width="0.4"/><circle cx="12" cy="12" r="2.6" fill="${C.shadow}"/><path d="M12 9.4 v5.2" stroke="${C.green}" stroke-width="1"/>`,
};

function wrap(name, inner, { size = 20, cls = '' } = {}) {
  const display = (name === 'endturn' || name === 'mute' || name === 'unmute' || name === 'settings' || name === 'flag' || name === 'swords')
    ? 'inline-block;vertical-align:middle' : 'inline-block;vertical-align:middle';
  return `<svg class="${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" style="${display}" aria-hidden="true">${inner}</svg>`;
}

export function hasIcon(name) { return !!ICONS[name]; }

// Returns an <svg> string for use in innerHTML. `name` is any key above, or a
// UNIT_TYPE key for units, or a BUILDING_TYPE key for buildings.
export function svgIcon(name, opts = {}) {
  const inner = ICONS[name] || ICONS.flag;
  return wrap(name, inner, opts);
}

// Returns a data: URL of a standalone SVG sized to `size` px, suitable for
// drawing onto a canvas (used by the 3D renderer for crisp unit/building sprites).
export function svgDataURL(name, size = 128) {
  const inner = ICONS[name] || ICONS.flag;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none">${inner}</svg>`;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}
