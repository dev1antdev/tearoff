/** A widget to place: its id and the size its default layout gives it. */
export interface WidgetSize {
  id: string;
  width: number;
  height: number;
}

export interface Placement {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Content scale in percent, 100 unless the widget is larger than the display. */
  scale: number;
  /** 0 for the first sheet of the grid; later sheets lie over earlier ones. */
  layer: number;
}

export interface GridPlan {
  placements: Placement[];
  /** How many sheets the widgets needed. More than one means boxes overlap. */
  layers: number;
}

export interface GridOptions {
  /** Space between boxes and from the display edge. */
  gap?: number;
  /** The app's own limits for a widget's content scale, in percent. */
  minScale?: number;
  scaleStep?: number;
}

/**
 * Lays widgets out in rows at the size their defaults give them, so that no
 * box covers another. A widget larger than the display is scaled down with
 * the app's own per-widget scale (never below its minimum) so the whole of it
 * is drawn. When one display cannot hold every widget, the rest start again
 * from the top left on a further sheet: those boxes overlap the first sheet,
 * and the capture takes each widget on its own.
 */
export function planGrid(
  display: { width: number; height: number },
  widgets: readonly WidgetSize[],
  options: GridOptions = {}
): GridPlan {
  const gap = options.gap ?? 8;
  const minScale = options.minScale ?? 50;
  const step = options.scaleStep ?? 5;
  const maxWidth = Math.max(1, display.width - gap * 2);
  const maxHeight = Math.max(1, display.height - gap * 2);

  const sized = widgets.map((widget) => {
    const fit = Math.min(1, maxWidth / widget.width, maxHeight / widget.height);
    const scale = Math.max(
      minScale,
      Math.min(100, Math.floor((fit * 100) / step) * step)
    );
    return {
      id: widget.id,
      scale,
      // Still too large at the smallest scale: the box is cut to the display.
      width: Math.min(maxWidth, Math.ceil((widget.width * scale) / 100)),
      height: Math.min(maxHeight, Math.ceil((widget.height * scale) / 100)),
    };
  });
  // Tallest first keeps the rows even; the id keeps the order stable.
  sized.sort((a, b) => b.height - a.height || a.id.localeCompare(b.id));

  const placements: Placement[] = [];
  let layer = 0;
  let x = gap;
  let y = gap;
  let rowHeight = 0;
  for (const box of sized) {
    if (x > gap && x + box.width > display.width - gap) {
      x = gap;
      y += rowHeight + gap;
      rowHeight = 0;
    }
    if (y > gap && y + box.height > display.height - gap) {
      layer += 1;
      x = gap;
      y = gap;
      rowHeight = 0;
    }
    placements.push({ ...box, x, y, layer });
    x += box.width + gap;
    rowHeight = Math.max(rowHeight, box.height);
  }
  return { placements, layers: placements.length === 0 ? 0 : layer + 1 };
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Whether two boxes share any area. */
export const rectsOverlap = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.width &&
  b.x < a.x + a.width &&
  a.y < b.y + b.height &&
  b.y < a.y + a.height;
