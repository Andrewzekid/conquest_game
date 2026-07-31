import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { UNIT_TYPE } from '../src/config.js';
import { hasIcon } from '../src/icons.js';

const rendererSrc = readFileSync(new URL('../src/renderer.js', import.meta.url), 'utf8');

function hasModelCase(type) {
  // A unit is considered to have a model branch if the renderer source contains
  // a switch case for it. Ships are grouped into a shared makeShipModel branch,
  // but each still has its own `case 'TYPE':` label.
  const re = new RegExp(`case\\s+'${type}':`);
  return re.test(rendererSrc);
}

describe('unit graphics coverage', () => {
  it('every UNIT_TYPE has a 2D SVG icon', () => {
    const missing = Object.keys(UNIT_TYPE).filter(t => !hasIcon(t));
    expect(missing, `missing icons: ${missing.join(', ')}`).toEqual([]);
  });

  it('every UNIT_TYPE has a dedicated 3D model branch', () => {
    const missing = Object.keys(UNIT_TYPE).filter(t => !hasModelCase(t));
    expect(missing, `missing model cases: ${missing.join(', ')}`).toEqual([]);
  });
});
