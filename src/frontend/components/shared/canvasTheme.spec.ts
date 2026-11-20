import { afterEach, describe, expect, it } from 'vitest';
import { readCanvasTheme, withAlpha } from './canvasTheme';

describe('readCanvasTheme', () => {
  afterEach(() => document.body.replaceChildren());

  it("reads the palette's neutrals and the font where the canvas sits", () => {
    // As ThemeManager's palette class does: slate remapped on the overlay.
    const overlay = document.createElement('div');
    overlay.style.setProperty('--color-slate-300', 'oklch(0.8 0 0)');
    overlay.style.fontFamily = 'Figtree, sans-serif';
    const canvas = document.createElement('canvas');
    overlay.append(canvas);
    document.body.append(overlay);

    const theme = readCanvasTheme(canvas);
    expect(theme.slate(300)).toBe('oklch(0.8 0 0)');
    expect(theme.font).toBe('Figtree, sans-serif');
  });
});

describe('withAlpha', () => {
  it('puts the alpha inside a theme colour, or after a hex', () => {
    expect(withAlpha('oklch(0.8 0 0)', 0.35)).toBe('oklch(0.8 0 0 / 0.35)');
    expect(withAlpha('oklch(70.4% 0.04 256.788)', 0.6)).toBe(
      'oklch(70.4% 0.04 256.788 / 0.6)'
    );
    expect(withAlpha('#0f172a', 0.8)).toBe('#0f172acc');
  });
});
