import {
  DEFAULT_CANVAS_THEME,
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

/** The radar's ink in the overlay's palette and font. */
export const radarInkFrom = (theme: CanvasTheme): RadarInk => {
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

/** Where no overlay has been read: the settings preview, tests. */
export const DEFAULT_RADAR_INK = radarInkFrom(DEFAULT_CANVAS_THEME);

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
