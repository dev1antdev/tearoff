/** What a window of the app is, told from the address it loaded. */
export type WindowKind =
  'overlay' | 'widget' | 'settings' | 'gantry' | 'tape' | 'other';

export function windowKind(url: string): WindowKind {
  const hash = url.includes('#') ? url.slice(url.indexOf('#')) : '';
  if (hash.startsWith('#/tape-replay')) return 'tape';
  if (hash.startsWith('#/gantry')) return 'gantry';
  if (hash.startsWith('#/settings')) return 'settings';
  if (hash === '#/overlay-widget') return 'widget';
  // The overlay loads the renderer's index with no route; anything else
  // (the hidden controller host, a web view) is not a window to look at.
  const page = url.split('#')[0].split('?')[0];
  if (/\/hidHost|hid-host/i.test(page)) return 'other';
  return /index\.html$|\/$|:\d+$/.test(page) ? 'overlay' : 'other';
}

export interface PageProblem {
  source: 'exception' | 'console' | 'log' | 'crash';
  level: 'error' | 'warning';
  /** The window it came from, by kind and title. */
  window: string;
  kind: WindowKind;
  /** The widget it belongs to, when the text or the stack names one. */
  widget?: string;
  text: string;
  url?: string;
  /** What the run was doing: start, capture 1, settings, toggles, server, quit. */
  phase: string;
  /** Milliseconds since the app was started. */
  atMs: number;
}

/**
 * The widget a message is about. An error boundary names the widget type; a
 * stack names the lazily loaded file of the widget, which the bundler calls
 * after the component (`Standings-ab12cd.js`).
 */
export function widgetFromText(
  text: string,
  widgetIds: readonly string[]
): string | undefined {
  const boundary = /\[ErrorBoundary:widget:([a-z0-9-]+)\]/i.exec(text);
  if (boundary) return boundary[1].toLowerCase();
  const known = new Set(widgetIds);
  for (const match of text.matchAll(/([A-Za-z]+)-[A-Za-z0-9_-]{6,}\.js/g)) {
    const name = match[1].toLowerCase();
    if (known.has(name)) return name;
  }
  return undefined;
}

/**
 * Messages that are the browser or the harness talking, not the app: the
 * development-only security banner, DevTools' own probes, and the warning
 * Chromium prints for the transparent background the capture sets.
 */
const NOISE = [
  /Electron Security Warning/i,
  /Autofill\.(enable|setAddresses)/i,
  /Download the React DevTools/i,
  /\[vite\]/i,
  /DevTools failed to load source map/i,
];

export const isNoise = (text: string): boolean =>
  NOISE.some((pattern) => pattern.test(text));

/** Text that should never be on a widget or a settings page. */
const BAD_TOKENS = /\bNaN\b|\bundefined\b|\[object Object\]|\bInfinity\b/g;

export function badTokens(text: string): string[] {
  return [...new Set(text.match(BAD_TOKENS) ?? [])];
}

export interface LogEntry {
  time: string;
  level: string;
  text: string;
}

const LOG_LINE = /^\[(\d{4}-\d{2}-\d{2} [\d:.]+)\] \[(\w+)\]\s+(.*)$/;

/** Splits electron-log's file into entries; a stack stays with its line. */
export function parseMainLog(content: string): LogEntry[] {
  const entries: LogEntry[] = [];
  for (const line of content.split(/\r?\n/)) {
    const match = LOG_LINE.exec(line);
    if (match) {
      entries.push({ time: match[1], level: match[2], text: match[3] });
    } else if (line.trim() && entries.length > 0) {
      entries[entries.length - 1].text += `\n${line}`;
    }
  }
  return entries;
}

export interface CountedLine {
  text: string;
  count: number;
  firstTime: string;
}

export interface LogSummary {
  entries: number;
  errors: CountedLine[];
  warnings: CountedLine[];
  /** The lines that show the recorders and the telemetry source came up. */
  evidence: Record<string, string[]>;
}

const EVIDENCE: Record<string, RegExp> = {
  telemetrySource: /\[setup\] Switching telemetry source/,
  lapLibrary: /\[LapLibrary\]/,
  stints: /\[Ledger\]/,
  trackProfiles: /\[TrackProfiles\]/,
  update: /\[update\]|update-electron-app|Squirrel/i,
  releaseNotes: /\[ReleaseNotes\]/,
  quit: /^App quit$|\[Shutdown\]/,
};

const firstLine = (text: string): string => text.split('\n')[0];

function count(entries: readonly LogEntry[]): CountedLine[] {
  const byText = new Map<string, CountedLine>();
  for (const entry of entries) {
    // Numbers differ from one occurrence to the next; the line is the same.
    const key = firstLine(entry.text).replace(/\d+(\.\d+)?/g, '#');
    const seen = byText.get(key);
    if (seen) seen.count += 1;
    else {
      byText.set(key, {
        text: entry.text.slice(0, 1200),
        count: 1,
        firstTime: entry.time,
      });
    }
  }
  return [...byText.values()];
}

/**
 * The two strangers the run itself sends to the built-in web server. The app
 * warns about each, as it should; those warnings are the run's own doing.
 */
export const SMOKE_STRANGERS = {
  origin: 'https://example.com',
  host: 'rebound.example',
} as const;

const OWN_KNOCKS: readonly string[] = [
  `Origin "${SMOKE_STRANGERS.origin}"`,
  `Host "${SMOKE_STRANGERS.host}:`,
];

const isOwnKnock = (text: string): boolean =>
  text.includes(' refused (') && OWN_KNOCKS.some((mark) => text.includes(mark));

export function summariseLog(entries: readonly LogEntry[]): LogSummary {
  const evidence: Record<string, string[]> = {};
  for (const [name, pattern] of Object.entries(EVIDENCE)) {
    evidence[name] = entries
      .filter((entry) => pattern.test(firstLine(entry.text)))
      .slice(0, 12)
      .map(
        (entry) => `[${entry.time}] [${entry.level}] ${firstLine(entry.text)}`
      );
  }
  return {
    entries: entries.length,
    errors: count(entries.filter((entry) => entry.level === 'error')),
    warnings: count(
      entries.filter(
        (entry) => entry.level === 'warn' && !isOwnKnock(entry.text)
      )
    ),
    evidence,
  };
}
