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

  it('TANK/HEAVY_TANK/MOTOR_ARTILLERY have distinct model features', () => {
    const EOL = '\r?\n';
    const grab = (from, to) => {
      const re = new RegExp(`case '${from}': \\{([\\s\\S]*?)${EOL}            \\}${EOL}            case '${to}'`);
      const m = rendererSrc.match(re);
      return m ? m[1] : '';
    };
    const tankCase = grab('TANK', 'HEAVY_TANK');
    const heavyCase = grab('HEAVY_TANK', 'ARMORED_CAR');
    const motorCase = grab('MOTOR_ARTILLERY', 'TANK');
    // TANK: road wheels + antenna; HEAVY_TANK: twin road wheels + turret dome;
    // MOTOR_ARTILLERY: howitzer battery (no turret cylinder with 0.15 radius).
    expect(tankCase).toMatch(/road wheel|road wheels/i);
    expect(heavyCase).toMatch(/turretdome|turret dome/i);
    expect(motorCase).toMatch(/howitzer/i);
    expect(motorCase).not.toMatch(/const turret/);
  });

  it('ironclad-era ships have distinct superstructure features', () => {
    const shipFn = rendererSrc.match(/makeShipModel\(type, color\) \{[\s\S]*?\n    \}/)[0];
    // BATTLESHIP: two funnels + raised bridge + main turret amidships.
    expect(shipFn).toMatch(/isBattle/);
    expect(shipFn).toMatch(/raised bridge|bridge superstructure/i);
    expect(shipFn).toMatch(/extra main turret/i);
    // MONITOR: flat casemate + rotating turret, distinct from the others.
    expect(shipFn).toMatch(/isMonitor/);
    expect(shipFn).toMatch(/casemate/);
  });
});
