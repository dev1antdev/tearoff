import { useLayoutEffect, useState, type RefObject } from 'react';
import { getColor } from '@irdashies/utils/colors';

/**
 * What a canvas widget paints with that the driver's settings change: the
 * palette's neutrals (`slate-*`, remapped on `.overlay-window`) and the
 * overlay's font face. A canvas cannot read CSS variables, so they are read
 * from the element it sits in when they change, not on every frame.
 */
export interface CanvasTheme {
  /** `--color-slate-<shade>`, as `#rrggbb` where it can be read. */
  slate: (shade: 200 | 300 | 400 | 500 | 600 | 900 | 950) => string;
  /** The overlay's font family, for `ctx.font`. */
  font: string;
}

/** A CSS colour at `alpha`: inside `oklch(…)` / `rgb(…)`, or as hex digits. */
export const withAlpha = (color: string, alpha: number): string =>
  color.startsWith('#')
    ? `${color}${Math.round(alpha * 255)
        .toString(16)
        .padStart(2, '0')}`
    : color.replace(/\)\s*$/, ` / ${alpha})`);

const SHADES = [200, 300, 400, 500, 600, 900, 950] as const;

/**
 * A CSS colour as `#rrggbb`, painted once on a one-pixel canvas and read
 * back. The palette's colours are `oklch(…)`, which a canvas parses more
 * slowly than hex each time a frame sets one. Left as it is where nothing
 * can be painted.
 */
export const toHex = (
  color: string,
  probe: CanvasRenderingContext2D | null
) => {
  if (!probe || !color) return color;
  probe.fillStyle = '#000000';
  probe.fillStyle = color;
  probe.fillRect(0, 0, 1, 1);
  // A stand-in canvas (a test's) may paint nothing to read back.
  const pixel = probe.getImageData(0, 0, 1, 1)?.data;
  if (!pixel) return color;
  const [r, g, b] = pixel;
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
};

export const readCanvasTheme = (from: Element): CanvasTheme => {
  const probe = document
    .createElement('canvas')
    .getContext('2d', { willReadFrequently: true });
  const shades = new Map(
    SHADES.map((s) => [s, toHex(getColor('slate', s, from), probe)])
  );
  return {
    slate: (shade) => shades.get(shade) ?? '',
    font: getComputedStyle(from).fontFamily || 'sans-serif',
  };
};

/**
 * The canvas theme of the overlay `ref` sits in. Read again when the
 * overlay's classes change (the palette and the font are classes on
 * `.overlay-window`) and once the web fonts have loaded, since a canvas
 * paints in another face until they have. Null until the element mounts.
 */
export const useCanvasTheme = (ref: RefObject<Element | null>) => {
  const [theme, setTheme] = useState<CanvasTheme | null>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    let live = true;
    const read = () => live && setTheme(readCanvasTheme(element));
    read();
    void document.fonts?.ready.then(read);
    const overlay = element.closest('.overlay-window');
    const observer = overlay ? new MutationObserver(read) : undefined;
    if (overlay) observer?.observe(overlay, { attributeFilter: ['class'] });
    return () => {
      live = false;
      observer?.disconnect();
    };
  }, [ref]);
  return theme;
};
