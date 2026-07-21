import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const htmlPath = resolve(import.meta.dirname, '..', 'index.html');
const html = readFileSync(htmlPath, 'utf-8');

const gameSrc = readFileSync(resolve(import.meta.dirname, '..', 'src', 'game.js'), 'utf-8');

describe('spectate-ui', () => {
  it('spectate-controls div does NOT have class="hidden"', () => {
    // The bug was that class="hidden" with !important overrode inline display:flex
    const match = html.match(/id="spectate-controls"[^>]*>/);
    expect(match).not.toBeNull();
    expect(match[0]).not.toContain('class="hidden"');
  });

  it('spectate-controls has style="display:none" for initial state', () => {
    const match = html.match(/id="spectate-controls"[^>]*style="[^"]*display:none[^"]*"/);
    expect(match).not.toBeNull();
  });

  it('spectate-controls contains FF and Auto buttons', () => {
    expect(html).toContain('id="btn-ff-1"');
    expect(html).toContain('id="btn-ff-5"');
    expect(html).toContain('id="btn-ff-10"');
    expect(html).toContain('id="btn-ff-auto"');
  });

  it('CSS .hidden rule uses !important (confirms root cause)', () => {
    // Verify the CSS rule exists that caused the bug
    expect(html).toContain('.hidden { display: none !important; }');
  });

  // Regression guard for the "this.gameState is undefined" crash at game.js:142.
  // _initSpectateUI is invoked from the constructor BEFORE initState() builds
  // this.gameState, so it must NOT touch this.gameState. The spectate flag is
  // set authoritatively inside initState's gameState object literal instead.
  // This is a source-invariant test (the suite has no DOM/WebGL harness to boot
  // Game for real); it pins the invariant the crash violated.
  describe('spectate constructor ordering (regression)', () => {
    it('_initSpectateUI does not reference this.gameState', () => {
      const fnBody = gameSrc.match(/_initSpectateUI\(\)\s*{([\s\S]*?)\n    }/);
      expect(fnBody, '_initSpectateUI must exist').not.toBeNull();
      expect(fnBody[1]).not.toMatch(/this\.gameState/);
    });

    it('initState sets gameState.spectateMode from this.spectateMode', () => {
      // The gameState object literal in initState must carry the spectate flag
      // so pure render/UI code (renderer.js reads gameState.spectateMode) has it
      // without depending on constructor call order.
      expect(gameSrc).toMatch(/spectateMode:\s*this\.spectateMode/);
    });

    it('loadFromState mirrors the spectate flag onto gameState', () => {
      // Loaded games skip initState, so the flag must be mirrored there too.
      expect(gameSrc).toMatch(/this\.gameState\.spectateMode\s*=\s*this\.spectateMode/);
    });
  });
});
