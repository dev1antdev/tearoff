import fs from 'node:fs';
import path from 'node:path';

/**
 * What Chromium keeps in a user-data folder. None of it is the user's
 * settings, and a copy of it would carry caches from another build.
 */
const CHROMIUM_NAMES = new Set(
  [
    'blob_storage',
    'Cache',
    'Code Cache',
    'Crashpad',
    'DawnCache',
    'DawnGraphiteCache',
    'DawnWebGPUCache',
    'Dictionaries',
    'DIPS',
    'DIPS-wal',
    'DIPS-shm',
    'Extension State',
    'GPUCache',
    'GPUPersistentCache',
    'GrShaderCache',
    'Local State',
    'lockfile',
    'Network',
    'Partitions',
    'Preferences',
    'Service Worker',
    'Session Storage',
    'ShaderCache',
    'Shared Dictionary',
    'SharedStorage',
    'SharedStorage-wal',
    'Trust Tokens',
    'Trust Tokens-journal',
    'WebStorage',
    'DevToolsActivePort',
    'declarative_performance_observer.db',
    'declarative_performance_observer.db-journal',
    'electron-log-preload.js',
  ].map((name) => name.toLowerCase())
);

/**
 * Whether a top-level entry of a profile is the user's own data. The logs
 * stay behind: a run's log should hold that run and nothing else.
 */
export const isUserData = (name: string): boolean =>
  !CHROMIUM_NAMES.has(name.toLowerCase()) && name.toLowerCase() !== 'logs';

/** Copies the user's data of a profile into a new folder. Reads the source only. */
export function copyProfile(source: string, destination: string): string[] {
  fs.mkdirSync(destination, { recursive: true });
  const copied: string[] = [];
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    if (!isUserData(entry.name)) continue;
    fs.cpSync(
      path.join(source, entry.name),
      path.join(destination, entry.name),
      { recursive: true, errorOnExist: true, force: false }
    );
    copied.push(entry.isDirectory() ? `${entry.name}/` : entry.name);
  }
  return copied.sort();
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export interface ConfigRead {
  parsed: boolean;
  error?: string;
  config: Record<string, unknown>;
}

export function readConfig(file: string): ConfigRead {
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!isRecord(raw)) {
      return { parsed: false, error: 'not an object', config: {} };
    }
    return { parsed: true, config: raw };
  } catch (error) {
    return {
      parsed: false,
      error: error instanceof Error ? error.message : String(error),
      config: {},
    };
  }
}

/**
 * Turns "start with Windows" off in every dashboard of a config. The app
 * registers itself at sign-in on each start when the setting is on, and a
 * smoke build must never become what Windows starts.
 */
export function turnAutoStartOff(config: Record<string, unknown>): boolean {
  let changed = false;
  const dashboards = isRecord(config.dashboards) ? config.dashboards : {};
  for (const dashboard of Object.values(dashboards)) {
    if (!isRecord(dashboard) || !isRecord(dashboard.generalSettings)) continue;
    if (dashboard.generalSettings.enableAutoStart === true) {
      dashboard.generalSettings.enableAutoStart = false;
      changed = true;
    }
  }
  return changed;
}

export interface WidgetSummary {
  id: string;
  type: string;
  enabled: boolean;
  /** The widget's settings as JSON, to tell a changed one from a kept one. */
  config: string;
}

/** The widgets of every stored profile: profile id -> its widgets. */
export function widgetsByProfile(
  config: Record<string, unknown>
): Map<string, WidgetSummary[]> {
  const result = new Map<string, WidgetSummary[]>();
  const dashboards = isRecord(config.dashboards) ? config.dashboards : {};
  for (const [profileId, dashboard] of Object.entries(dashboards)) {
    const widgets =
      isRecord(dashboard) && Array.isArray(dashboard.widgets)
        ? dashboard.widgets
        : [];
    result.set(
      profileId,
      widgets.filter(isRecord).map((widget) => ({
        id: String(widget.id),
        type: String(widget.type ?? widget.id),
        enabled: widget.enabled === true,
        config: JSON.stringify(widget.config ?? {}),
      }))
    );
  }
  return result;
}

export interface WidgetComparison {
  profiles: number;
  widgetsBefore: number;
  widgetsAfter: number;
  /** A widget the user had that is no longer stored. */
  lost: string[];
  /** A widget stored now that was not there: one the new build adds. */
  gained: string[];
  /** A widget whose on/off switch is not what it was. */
  enabledChanged: string[];
  /** A widget whose settings lost a key or changed a value the user had. */
  settingsChanged: string[];
}

/** The keys of `before` that `after` lost or holds another value for. */
function changedKeys(before: unknown, after: unknown, prefix = ''): string[] {
  if (!isRecord(before)) {
    return JSON.stringify(before) === JSON.stringify(after) ? [] : [prefix];
  }
  if (!isRecord(after)) return [prefix];
  return Object.keys(before).flatMap((key) =>
    changedKeys(before[key], after[key], prefix ? `${prefix}.${key}` : key)
  );
}

/**
 * Compares what the user had with what the app left. A new build may add
 * widgets and add settings to the ones there; it must not drop a widget,
 * flip its switch, or change a value the user had set.
 */
export function compareWidgets(
  before: ReadonlyMap<string, WidgetSummary[]>,
  after: ReadonlyMap<string, WidgetSummary[]>
): WidgetComparison {
  const comparison: WidgetComparison = {
    profiles: before.size,
    widgetsBefore: 0,
    widgetsAfter: 0,
    lost: [],
    gained: [],
    enabledChanged: [],
    settingsChanged: [],
  };
  for (const widgets of after.values()) {
    comparison.widgetsAfter += widgets.length;
  }
  for (const [profileId, widgets] of before) {
    comparison.widgetsBefore += widgets.length;
    const now = new Map(
      (after.get(profileId) ?? []).map((widget) => [widget.id, widget])
    );
    const had = new Set(widgets.map((widget) => widget.id));
    for (const widget of widgets) {
      const kept = now.get(widget.id);
      const name = `${profileId}/${widget.id}`;
      if (!kept) {
        comparison.lost.push(name);
        continue;
      }
      if (kept.enabled !== widget.enabled) {
        comparison.enabledChanged.push(
          `${name} (${widget.enabled ? 'on' : 'off'} -> ${kept.enabled ? 'on' : 'off'})`
        );
      }
      const keys = changedKeys(
        JSON.parse(widget.config) as unknown,
        JSON.parse(kept.config) as unknown
      );
      if (keys.length > 0) {
        comparison.settingsChanged.push(
          `${name}: ${keys.slice(0, 6).join(', ')}${keys.length > 6 ? ', ...' : ''}`
        );
      }
    }
    for (const id of now.keys()) {
      if (!had.has(id)) comparison.gained.push(`${profileId}/${id}`);
    }
  }
  return comparison;
}
