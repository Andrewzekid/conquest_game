/** Start menu (choose faction + map) and pause menu. Overlays live in index.html.
 *  Phase F: Added player count slider and spectate mode. */
import { FACTION_DEFS, FACTION_IDS } from './faction.js';
import { MAP_SIZES, FACTIONS, MAX_FACTIONS, setFactionSlots } from './config.js';
import { sfx, unlockAudio } from './sound.js';
import { loadSavedExists } from './save.js';

let _selectedFaction = 'crimson';
let _playerCount = 4;
let _spectateMode = false;
let _onStart = null;

function el(id) { return document.getElementById(id); }

function renderFactionCards() {
    const wrap = el('start-factions');
    if (!wrap) return;
    wrap.innerHTML = '';
    for (const id of FACTION_IDS) {
        const d = FACTION_DEFS[id];
        const card = document.createElement('div');
        card.className = 'faction-card' + (id === _selectedFaction ? ' selected' : '');
        card.dataset.fid = id;
        const roster = d.roster.map(r => r[0] + r.toLowerCase().slice(1)).join(', ');
        card.innerHTML = `
            <div class="fc-emoji">${d.emoji}</div>
            <div class="fc-name">${d.name}</div>
            <div class="fc-line"><b>King:</b> ${d.king.name}</div>
            <div class="fc-line"><b>Active:</b> ${d.king.active.name} — ${d.king.active.desc}</div>
            <div class="fc-line"><b>Passive:</b> ${d.passive.desc}</div>
            <div class="fc-line"><b>Roster:</b> ${roster}</div>
        `;
        card.onclick = () => {
            _selectedFaction = id;
            sfx.click();
            renderFactionCards();
        };
        wrap.appendChild(card);
    }
}

/** Show the start menu; calls onStart({ playerFactionId, aiFactionIds, mapSize, playerCount, spectate }). */
export function showStartMenu(onStart) {
    _onStart = onStart;
    unlockAudio();
    const menu = el('start-menu');
    if (!menu) { if (onStart) onStart({ playerFactionId: 'crimson', aiFactionIds: null, mapSize: 'medium', playerCount: 4, spectate: false }); return; }

    // Pre-fill size select.
    const sizeSel = el('start-size');
    if (sizeSel) sizeSel.value = 'medium';

    // Player count slider
    const playerSlider = el('start-players');
    const playerDisplay = el('start-players-display');
    if (playerSlider) {
        playerSlider.value = _playerCount;
        if (playerDisplay) playerDisplay.textContent = _playerCount;
        playerSlider.oninput = () => {
            _playerCount = parseInt(playerSlider.value);
            if (playerDisplay) playerDisplay.textContent = _playerCount;
            sfx.click();
        };
    }

    // Spectate mode checkbox
    const spectateCheck = el('start-spectate');
    if (spectateCheck) {
        spectateCheck.checked = _spectateMode;
        spectateCheck.onchange = () => {
            _spectateMode = spectateCheck.checked;
            sfx.click();
            // Disable faction selection in spectate mode
            const factionWrap = el('start-factions');
            if (factionWrap) {
                factionWrap.style.opacity = _spectateMode ? '0.5' : '1';
                factionWrap.style.pointerEvents = _spectateMode ? 'none' : 'auto';
            }
        };
    }

    const hasSave = loadSavedExists();
    const cont = el('start-continue');
    if (cont) cont.style.display = hasSave ? 'inline-block' : 'none';

    renderFactionCards();
    menu.style.display = 'flex';

    const startBtn = el('start-go');
    if (startBtn) startBtn.onclick = () => {
        sfx.click();
        const mapSize = (sizeSel && sizeSel.value) || 'medium';
        menu.style.display = 'none';
        // Build AI faction ids based on player count.
        // In spectate mode there is no human player, so EVERY slot (including
        // slot 0) is an AI and needs its own faction def. Using playerCount-1
        // left the last slot with no faction → it fell back to 'crimson',
        // giving Crimson (and the selected faction) two kings.
        const aiCount = _spectateMode ? _playerCount : _playerCount - 1;
        // In spectate mode, the selected faction is irrelevant; use a stable
        // list of factions so every slot gets a distinct def.
        const others = _spectateMode
            ? FACTION_IDS.slice()
            : FACTION_IDS.filter(id => id !== _selectedFaction);
        const aiFactionIds = others.slice(0, aiCount);
        // Configure the global FACTIONS array before the game initializes.
        setFactionSlots(_playerCount);
        if (_onStart) _onStart({
            playerFactionId: _spectateMode ? null : _selectedFaction,
            aiFactionIds,
            mapSize,
            playerCount: _playerCount,
            spectate: _spectateMode
        });
    };
    if (cont) cont.onclick = () => { sfx.click(); menu.style.display = 'none'; if (_onStart) _onStart({ load: true }); };
}

let _pauseState = { onResume: null, onSave: null, onLoad: null, onMenu: null, muted: false };

export function showPauseMenu(handlers) {
    _pauseState = { ...handlers };
    const menu = el('pause-menu');
    if (!menu) return;
    const mutedBtn = el('pause-mute');
    if (mutedBtn) mutedBtn.textContent = _pauseState.muted ? 'Unmute' : 'Mute';
    menu.style.display = 'flex';
}

export function hidePauseMenu() {
    const menu = el('pause-menu');
    if (menu) menu.style.display = 'none';
}

export function bindPauseButtons(handlers) {
    const wire = (id, fn) => { const b = el(id); if (b) b.onclick = fn; };
    wire('pause-resume', () => { sfx.click(); handlers.onResume && handlers.onResume(); });
    wire('pause-save', () => { sfx.click(); handlers.onSave && handlers.onSave(); });
    wire('pause-load', () => { sfx.click(); handlers.onLoad && handlers.onLoad(); });
    wire('pause-menu-btn', () => { sfx.click(); handlers.onMenu && handlers.onMenu(); });
    wire('pause-mute', () => {
        handlers.onToggleMute && handlers.onToggleMute();
        const b = el('pause-mute');
        if (b) b.textContent = handlers.isMuted ? 'Unmute' : 'Mute';
    });
}