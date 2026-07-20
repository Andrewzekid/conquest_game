/** Synthesized sound effects via the WebAudio API — no external asset files.
 *  Each SFX is a short oscillator + gain envelope. Mute state persists. */

let _ctx = null;
let _muted = false;
try { _muted = localStorage.getItem('conquest_muted') === '1'; } catch (e) { _muted = false; }

function ctx() {
    if (_ctx) return _ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    _ctx = new AC();
    return _ctx;
}

/** Must be called from a user gesture to unlock audio on some browsers. */
export function unlockAudio() {
    const c = ctx();
    if (c && c.state === 'suspended') c.resume();
}

export function isMuted() { return _muted; }
export function setMuted(m) {
    _muted = !!m;
    try { localStorage.setItem('conquest_muted', _muted ? '1' : '0'); } catch (e) { /* ignore */ }
}

/**
 * Play a tone with a frequency ramp and gain envelope.
 * @param opts { freq, freqEnd, type, dur, vol, attack, decay }
 */
function tone({ freq, freqEnd = null, type = 'sine', dur = 0.18, vol = 0.2, attack = 0.005 }) {
    if (_muted) return;
    const c = ctx();
    if (!c) return;
    if (c.state === 'suspended') c.resume();
    const now = c.currentTime;
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    if (freqEnd) osc.frequency.exponentialRampToValueAtTime(Math.max(40, freqEnd), now + dur);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(vol, now + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    osc.connect(gain).connect(c.destination);
    osc.start(now);
    osc.stop(now + dur + 0.02);
}

/** A quick two-note chirp. */
function chirp(a, b, opts = {}) {
    tone({ freq: a, ...opts });
    setTimeout(() => tone({ freq: b, ...opts }), 90);
}

export const sfx = {
    click() { tone({ freq: 420, type: 'square', dur: 0.05, vol: 0.12 }); },
    move() { tone({ freq: 320, freqEnd: 440, type: 'triangle', dur: 0.12, vol: 0.14 }); },
    attack() { tone({ freq: 200, freqEnd: 90, type: 'sawtooth', dur: 0.22, vol: 0.22 }); },
    capture() { chirp(440, 660, { type: 'triangle', dur: 0.16, vol: 0.18 }); },
    levelUp() { chirp(523, 784, { type: 'square', dur: 0.18, vol: 0.16 }); },
    endTurn() { tone({ freq: 300, freqEnd: 220, type: 'sine', dur: 0.18, vol: 0.14 }); },
    king() { chirp(392, 659, { type: 'square', dur: 0.22, vol: 0.18 }); },
    besiege() { tone({ freq: 120, freqEnd: 80, type: 'square', dur: 0.3, vol: 0.18 }); },
    victory() { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => tone({ freq: f, type: 'triangle', dur: 0.3, vol: 0.2 }), i * 130)); },
    defeat() { [392, 330, 262, 196].forEach((f, i) => setTimeout(() => tone({ freq: f, type: 'sawtooth', dur: 0.35, vol: 0.18 }), i * 160)); }
};