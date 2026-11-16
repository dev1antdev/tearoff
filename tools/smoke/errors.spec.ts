import { describe, expect, it } from 'vitest';
import {
  badTokens,
  isNoise,
  parseMainLog,
  summariseLog,
  widgetFromText,
  windowKind,
  isOwnWindowWidget,
} from './errors.ts';

const PACKAGED =
  'file:///W:/app/resources/app.asar/.vite/renderer/main_window/index.html';

describe('isOwnWindowWidget', () => {
  it('names the widgets that are a window of their own', () => {
    expect(isOwnWindowWidget('gantry')).toBe(true);
    expect(isOwnWindowWidget('pitwall')).toBe(true);
    expect(isOwnWindowWidget('standings')).toBe(false);
    expect(isOwnWindowWidget('overlay')).toBe(false);
  });
});

describe('windowKind', () => {
  it('tells the windows of a packaged build apart by their route', () => {
    expect(windowKind(PACKAGED)).toBe('overlay');
    expect(windowKind(`${PACKAGED}#/settings/relative`)).toBe('settings');
    expect(windowKind(`${PACKAGED}#/gantry`)).toBe('gantry');
    expect(windowKind(`${PACKAGED}#/pitwall`)).toBe('pitwall');
    expect(windowKind(`${PACKAGED}#/overlay-widget`)).toBe('widget');
    expect(windowKind(`${PACKAGED}#/tape-replay`)).toBe('tape');
  });

  it('knows the dev server address as the overlay', () => {
    expect(windowKind('http://localhost:5173/')).toBe('overlay');
    expect(windowKind('http://localhost:5173/#/settings')).toBe('settings');
    // Not the overlay, which is what a route nobody listed would be taken for.
    expect(windowKind('http://localhost:5173/#/pitwall')).toBe('pitwall');
  });

  it('does not take another page for a window of widgets', () => {
    expect(
      windowKind(PACKAGED.replace('index.html', 'index-widget-preview.html'))
    ).toBe('other');
    expect(windowKind('https://app.hyperate.io/abc')).toBe('other');
  });
});

describe('widgetFromText', () => {
  const ids = ['standings', 'laptimelog', 'fuel'];

  it('reads the widget an error boundary names', () => {
    expect(
      widgetFromText(
        '[ErrorBoundary:widget:laptimelog] x is not a function',
        ids
      )
    ).toBe('laptimelog');
  });

  it('reads the widget from the file a stack names', () => {
    expect(
      widgetFromText(
        'TypeError: boom\n    at render (file:///app/assets/Standings-Bx81kQz2.js:1:99)',
        ids
      )
    ).toBe('standings');
  });

  it('names no widget for a shared file or an unknown one', () => {
    expect(
      widgetFromText('at file:///app/assets/index-Bx81kQz2.js:1:99', ids)
    ).toBeUndefined();
    expect(widgetFromText('plain message', ids)).toBeUndefined();
  });
});

describe('isNoise', () => {
  it('drops the browser talking, keeps the app', () => {
    expect(isNoise('%cElectron Security Warning (Insecure CSP)')).toBe(true);
    expect(isNoise("Refused to apply style from 'https://x'")).toBe(false);
    expect(isNoise('TypeError: undefined is not a function')).toBe(false);
  });
});

describe('badTokens', () => {
  it('finds what must never be shown, once each', () => {
    expect(badTokens('Gap NaN s, NaN laps, driver undefined')).toEqual([
      'NaN',
      'undefined',
    ]);
    expect(badTokens('name: [object Object]')).toEqual(['[object Object]']);
  });

  it('leaves ordinary text alone', () => {
    expect(badTokens('Fernando Alonso 1:23.456 -- 12.3 L')).toEqual([]);
    expect(badTokens('Nanterre undefinedness')).toEqual([]);
  });
});

const LOG = [
  '[2026-11-16 00:32:48.327] [info]  [setup] Switching telemetry source to lmu',
  "[2026-11-16 00:32:48.360] [info]  [LapLibrary] Recording the player's laps for lmu",
  '[2026-11-16 00:32:48.371] [info]  [Ledger] Stint 1 opened (joined) at 139.9 s',
  '[2026-11-16 00:32:48.353] [warn]  [lmuSdkBridge] Slow loop: worst 18.0ms over 1 iterations',
  '[2026-11-16 00:33:18.353] [warn]  [lmuSdkBridge] Slow loop: worst 101.1ms over 2157 iterations',
  '[2026-11-16 00:33:20.000] [error] [renderer] [ErrorBoundary:widget:fuel] boom (attempt 1/3)',
  '    at Fuel (file:///app/assets/Fuel-abc123.js:1:1)',
  '[2026-11-16 00:33:25.000] [info]  App quit',
].join('\r\n');

describe('parseMainLog', () => {
  it('splits the file into entries and keeps a stack with its line', () => {
    const entries = parseMainLog(LOG);

    expect(entries).toHaveLength(7);
    expect(entries[5]).toMatchObject({ level: 'error' });
    expect(entries[5].text).toContain('at Fuel (file:///app/assets/Fuel');
    expect(entries[6].text).toBe('App quit');
  });

  it('is empty for an empty file', () => {
    expect(parseMainLog('')).toEqual([]);
  });
});

describe('summariseLog', () => {
  const summary = summariseLog(parseMainLog(LOG));

  it('counts a warning that repeats with other numbers as one kind', () => {
    expect(summary.warnings).toHaveLength(1);
    expect(summary.warnings[0]).toMatchObject({
      count: 2,
      firstTime: '2026-11-16 00:32:48.353',
    });
  });

  it("leaves out the warnings about the run's own two strangers, and no others", () => {
    const stamp = '[2026-11-16 16:33:15.665] [warn] ';
    const lines = [
      `${stamp} [ComponentServer] Request refused (origin): Host "localhost:53467", Origin "https://example.com"`,
      `${stamp} [ComponentServer] Request refused (host): Host "rebound.example:53467", Origin none`,
      `${stamp} Bridge proxy: connection refused (origin): Host "localhost:53467", Origin "https://example.com"`,
      `${stamp} Bridge proxy: connection refused (origin): Host "localhost:53467", Origin "https://elsewhere.example"`,
      `${stamp} [ComponentServer] Request refused (host): Host "another.example:53467", Origin none`,
    ];
    const kinds = summariseLog(parseMainLog(lines.join('\n'))).warnings;

    expect(kinds.map((kind) => kind.text)).toEqual([
      expect.stringContaining('https://elsewhere.example'),
      expect.stringContaining('another.example'),
    ]);
  });

  it('lists every error', () => {
    expect(summary.errors).toHaveLength(1);
    expect(summary.errors[0].text).toContain('[ErrorBoundary:widget:fuel]');
  });

  it('finds the lines that show the recorders came up, and the quit', () => {
    expect(summary.evidence.telemetrySource).toHaveLength(1);
    expect(summary.evidence.lapLibrary[0]).toContain('Recording the player');
    expect(summary.evidence.stints[0]).toContain('Stint 1 opened');
    expect(summary.evidence.trackProfiles).toEqual([]);
    expect(summary.evidence.quit).toHaveLength(1);
  });
});
