import { describe, it, expect } from 'vitest';
import { hasIcon, svgIcon, svgDataURL } from '../src/icons.js';

describe('icons', () => {
  describe('hasIcon', () => {
    it('returns true for known icons', () => {
      expect(hasIcon('gold')).toBe(true);
      expect(hasIcon('food')).toBe(true);
      expect(hasIcon('attack')).toBe(true);
      expect(hasIcon('INFANTRY')).toBe(true);
      expect(hasIcon('farm')).toBe(true);
      expect(hasIcon('flag')).toBe(true);
    });

    it('returns false for unknown icons', () => {
      expect(hasIcon('nonexistent')).toBe(false);
      expect(hasIcon('')).toBe(false);
    });
  });

  describe('svgIcon', () => {
    it('returns SVG string', () => {
      const svg = svgIcon('gold');
      expect(svg).toContain('<svg');
      expect(svg).toContain('viewBox="0 0 24 24"');
    });

    it('includes size', () => {
      const svg = svgIcon('gold', { size: 32 });
      expect(svg).toContain('width="32"');
      expect(svg).toContain('height="32"');
    });

    it('falls back to flag for unknown', () => {
      const svg = svgIcon('nonexistent');
      expect(svg).toContain('<svg');
    });

    it('includes class when provided', () => {
      const svg = svgIcon('gold', { cls: 'my-class' });
      expect(svg).toContain('class="my-class"');
    });
  });

  describe('svgDataURL', () => {
    it('returns data URL', () => {
      const url = svgDataURL('gold');
      expect(url).toContain('data:image/svg+xml');
    });

    it('falls back to flag for unknown', () => {
      const url = svgDataURL('nonexistent');
      expect(url).toContain('data:image/svg+xml');
    });

    it('respects size parameter', () => {
      const url = svgDataURL('gold', 64);
      const decoded = decodeURIComponent(url);
      expect(decoded).toContain('width="64"');
    });
  });
});
