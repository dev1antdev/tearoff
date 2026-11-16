import type { DashboardLayout } from '@irdashies/types';

/** Where a widget sits on the browser dashboard page. */
export interface BrowserPosition {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Far beyond any screen; keeps a hostile number from reaching the file. */
const COORDINATE_LIMIT = 100_000;
const MAX_WIDGETS = 2000;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const coordinate = (value: unknown, min: number): number | null =>
  typeof value === 'number' &&
  Number.isFinite(value) &&
  value >= min &&
  value <= COORDINATE_LIMIT
    ? value
    : null;

/** The four numbers and nothing else, or null if any of them is not one. */
export function readBrowserPosition(value: unknown): BrowserPosition | null {
  if (!isRecord(value)) return null;
  const x = coordinate(value.x, -COORDINATE_LIMIT);
  const y = coordinate(value.y, -COORDINATE_LIMIT);
  const width = coordinate(value.width, 1);
  const height = coordinate(value.height, 1);
  if (x === null || y === null || width === null || height === null) {
    return null;
  }
  return { x, y, width, height };
}

const samePosition = (a: unknown, b: BrowserPosition): boolean =>
  isRecord(a) &&
  a.x === b.x &&
  a.y === b.y &&
  a.width === b.width &&
  a.height === b.height;

/**
 * The stored dashboard with the browser positions from `incoming` laid over
 * it, or null when that changes nothing.
 *
 * The browser dashboard page lets its widgets be dragged about, and saves
 * where they were left. It used to send the whole dashboard back for that,
 * which let anything that could reach the socket rewrite every setting. Only
 * the positions are read out of what arrives: of widgets the stored dashboard
 * already has, and only as four bounded numbers.
 */
export function mergeBrowserPositions(
  stored: DashboardLayout,
  incoming: unknown
): DashboardLayout | null {
  if (!isRecord(incoming) || !Array.isArray(incoming.widgets)) return null;
  if (incoming.widgets.length > MAX_WIDGETS) return null;

  const positions = new Map<string, BrowserPosition>();
  for (const widget of incoming.widgets) {
    if (!isRecord(widget) || typeof widget.id !== 'string') continue;
    if (!isRecord(widget.config)) continue;
    const position = readBrowserPosition(widget.config.browserPosition);
    if (position) positions.set(widget.id, position);
  }
  if (positions.size === 0) return null;

  let changed = false;
  const widgets = stored.widgets.map((widget) => {
    const position = positions.get(widget.id);
    const config = widget.config as Record<string, unknown> | undefined;
    if (!position || samePosition(config?.browserPosition, position)) {
      return widget;
    }
    changed = true;
    return { ...widget, config: { ...config, browserPosition: position } };
  });
  return changed ? { ...stored, widgets } : null;
}
