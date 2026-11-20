import {
  withAlpha,
  type CanvasTheme,
} from '@irdashies/domain/widgetPresentation/canvasTheme';

/** The radar's neutrals and type: what the palette and the font change. */
export interface RadarInk {
  font: string;
  /** Under the road, the disc behind everything; given their opacity. */
  roadEdge: string;
  roadSurface: string;
  backdrop: string;
  /** Rings and crosshair, and the ring distances. */
  guide: string;
  guideText: string;
  /** Outlines and halos that keep cars and text apart from what is under. */
  dark: string;
  darkSoft: string;
  halo: string;
  bodyEdge: string;
  /** The pace car, hazard and notice text. */
  light: string;
  noticeBackdrop: string;
}

/** Until the overlay has been read, and in tests: the old fixed shades. */
export const DEFAULT_RADAR_INK: RadarInk = {
  font: 'Lato, sans-serif',
  roadEdge: '#e2e8f0',
  roadSurface: '#475569',
  backdrop: '#0f172a',
  guide: 'rgba(148, 163, 184, 0.35)',
  guideText: 'rgba(203, 213, 225, 0.6)',
  dark: '#0f172a',
  darkSoft: 'rgba(15, 23, 42, 0.25)',
  halo: 'rgba(15, 23, 42, 0.85)',
  bodyEdge: 'rgba(15, 23, 42, 0.9)',
  light: '#e2e8f0',
  noticeBackdrop: 'rgba(15, 23, 42, 0.8)',
};

/** The radar's ink in the overlay's palette and font. */
export const radarInkFrom = (theme: CanvasTheme | null): RadarInk => {
  if (!theme) return DEFAULT_RADAR_INK;
  const dark = theme.slate(900);
  return {
    font: theme.font,
    roadEdge: theme.slate(200),
    roadSurface: theme.slate(600),
    // The overlays' panel ground.
    backdrop: theme.slate(950),
    guide: withAlpha(theme.slate(400), 0.35),
    guideText: withAlpha(theme.slate(300), 0.6),
    dark,
    darkSoft: withAlpha(dark, 0.25),
    halo: withAlpha(dark, 0.85),
    bodyEdge: withAlpha(dark, 0.9),
    light: theme.slate(200),
    noticeBackdrop: withAlpha(dark, 0.8),
  };
};

/**
 * The ink of the frame being drawn. `drawRadar` sets it from its scene before
 * it paints anything and the helpers it calls read it, as `projector` and
 * `pose` are scratch for that one frame: drawing is synchronous, so two
 * radars (the widget and the settings preview) cannot mix theirs.
 */
export const ink: RadarInk = { ...DEFAULT_RADAR_INK };

export const paintWith = (next: RadarInk) => {
  Object.assign(ink, next);
};
