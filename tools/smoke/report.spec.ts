import { describe, expect, it } from 'vitest';
import type {
  DbInfo,
  LapLibraryInspection,
  ProfileInspection,
} from './inspect.ts';
import {
  buildReport,
  judge,
  widgetStatus,
  type RunResult,
  type WidgetCapture,
  type WidgetRow,
} from './report.ts';

const capture = (overrides: Partial<WidgetCapture> = {}): WidgetCapture => ({
  round: 1,
  drawn: true,
  text: 'P1 Alonso',
  badTokens: [],
  overflowX: 0,
  overflowY: 0,
  cut: false,
  screenshot: 'shots/capture1/standings.png',
  ...overrides,
});

const row = (overrides: Partial<WidgetRow> = {}): WidgetRow => ({
  id: 'standings',
  type: 'standings',
  enabled: true,
  disabledForSim: false,
  ownWindow: false,
  captures: [capture()],
  errors: [],
  hints: [],
  ...overrides,
});

const result = (overrides: Partial<RunResult> = {}): RunResult => ({
  runId: 'lmu-fresh',
  startedAt: '2026-11-16T00:00:00.000Z',
  finishedAt: '2026-11-16T00:03:00.000Z',
  gitHead: 'abc1234',
  appVersion: '2.2.1+abc1234',
  target: 'packaged',
  executable: 'out/smoke/tearoff.exe',
  tape: 'lmu-session.lmudt',
  speed: 4,
  loop: true,
  profileMode: 'fresh',
  profileDir: 'profiles/lmu-fresh',
  simulator: 'lmu',
  display: '1920x1080 at scale 1',
  layoutNote: '33 widgets laid out in a grid, none over another.',
  notes: [],
  staleBuild: [],
  windows: [],
  widgets: [row()],
  settingsPages: [],
  toggles: [],
  server: [],
  problems: [],
  quit: { clean: true, detail: 'Ended in 0.4s with exit code 0.' },
  realProfile: {
    checked: true,
    path: 'C:/Users/me/AppData/Roaming/tearoff',
    touched: [],
    logChanged: false,
    ownLinesInSharedLog: [],
    appendedSample: [],
  },
  loginItems: { before: [], after: [] },
  ...overrides,
});

describe('widgetStatus', () => {
  it('is rendered when any capture drew something', () => {
    expect(
      widgetStatus(
        row({ captures: [capture({ drawn: false }), capture({ round: 2 })] })
      )
    ).toBe('rendered');
  });

  it('is empty when no capture drew anything', () => {
    expect(
      widgetStatus(row({ captures: [capture({ drawn: false, text: '' })] }))
    ).toBe('empty');
  });

  it('is missing when switched on and never on screen', () => {
    expect(widgetStatus(row({ captures: [] }))).toBe('missing');
  });

  it('puts an error above a picture that looks fine', () => {
    expect(
      widgetStatus(row({ errors: ['[ErrorBoundary:widget:standings] boom'] }))
    ).toBe('error');
  });

  it('does not expect a widget that is off or that the sim cannot run', () => {
    expect(widgetStatus(row({ enabled: false, captures: [] }))).toBe('off');
    expect(widgetStatus(row({ disabledForSim: true, captures: [] }))).toBe(
      'not for this simulator'
    );
    expect(
      widgetStatus(row({ enabled: false, disabledForSim: true, captures: [] }))
    ).toBe('not for this simulator');
  });

  it('knows a widget with a window of its own', () => {
    expect(widgetStatus(row({ ownWindow: true, captures: [] }))).toBe(
      'own window'
    );
  });
});

const database = (schemaVersion: number, file = 'laps.db'): DbInfo => ({
  file,
  exists: true,
  schemaVersion,
  integrity: 'ok',
  tables: [{ name: 'lap', rows: 2 }],
});

/** What the profile holds after a run, with a lap library to judge. */
const inspection = (lapLibrary: LapLibraryInspection): ProfileInspection => ({
  log: {
    file: 'profile/logs/main.log',
    exists: true,
    summary: { entries: 3, errors: [], warnings: [], evidence: {} },
    lines: [],
  },
  lapLibrary,
  config: { parsed: true, profiles: ['default'] },
  files: [],
  trackProfiles: [],
  shouldNotBeThere: [],
});

describe('judge, on the lap library of a copied profile', () => {
  const same = { equal: true, differences: [] };

  it('passes an upgrade whose backup is the library as it was, beside an older backup', () => {
    // The profile was upgraded once before: `laps.v1.bak.db` came with it.
    const verdict = judge(
      result({
        inspection: inspection({
          current: database(3),
          original: database(2),
          backups: [
            database(1, 'laps.v1.bak.db'),
            database(2, 'laps.v2.bak.db'),
          ],
          backupsOfOriginalSchema: 1,
          backupMatchesOriginal: same,
          rowsKept: same,
          rowsAdded: [],
        }),
      })
    );

    expect(verdict).toEqual({ verdict: 'PASS', blocking: [], attention: [] });
  });

  it('fails an upgrade that kept nothing of the library as it was, whatever older backup is there', () => {
    const verdict = judge(
      result({
        inspection: inspection({
          current: database(3),
          original: database(2),
          backups: [database(1, 'laps.v1.bak.db')],
          backupsOfOriginalSchema: 0,
          rowsKept: same,
          rowsAdded: [],
        }),
      })
    );

    expect(verdict.verdict).toBe('FAIL');
    expect(verdict.blocking).toEqual([
      'the lap library was upgraded without a backup',
    ]);
  });

  it('fails when the backup of that schema is not the library as it was', () => {
    const verdict = judge(
      result({
        inspection: inspection({
          current: database(3),
          original: database(2),
          backups: [database(2, 'laps.v2.bak.db')],
          backupsOfOriginalSchema: 1,
          backupMatchesOriginal: {
            equal: false,
            differences: ['table lap: 1 row differs'],
          },
          rowsKept: same,
          rowsAdded: [],
        }),
      })
    );

    expect(verdict.blocking).toEqual([
      'the lap library backup is not the library as it was',
    ]);
  });

  it('asks for no backup where nothing was upgraded', () => {
    const verdict = judge(
      result({
        inspection: inspection({
          current: database(3),
          original: database(3),
          backups: [database(2, 'laps.v2.bak.db')],
          backupsOfOriginalSchema: 0,
          rowsKept: same,
          rowsAdded: [],
        }),
      })
    );

    expect(verdict.verdict).toBe('PASS');
  });
});

describe('judge', () => {
  it('passes a run with nothing wrong', () => {
    expect(judge(result())).toEqual({
      verdict: 'PASS',
      blocking: [],
      attention: [],
    });
  });

  it('asks for a look at an empty widget without failing the run', () => {
    const verdict = judge(
      result({
        widgets: [
          row({
            id: 'hybrid',
            captures: [capture({ drawn: false, text: '' })],
          }),
        ],
      })
    );

    expect(verdict.verdict).toBe('ATTENTION');
    expect(verdict.attention).toEqual(['1 widget drew nothing: hybrid']);
  });

  it('fails on a widget error, a missing widget and a shown NaN', () => {
    const verdict = judge(
      result({
        widgets: [
          row({ id: 'fuel', errors: ['boom'] }),
          row({ id: 'timing', captures: [] }),
          row({ id: 'relative', captures: [capture({ badTokens: ['NaN'] })] }),
        ],
      })
    );

    expect(verdict.verdict).toBe('FAIL');
    expect(verdict.blocking).toEqual([
      '1 widget with an error: fuel',
      '1 widget switched on but never on screen: timing',
      'NaN / undefined shown by: relative',
    ]);
  });

  it('fails a run of a build that is not the code in the checkout', () => {
    expect(
      judge(
        result({ staleBuild: ['the packaged app is older: package again'] })
      ).blocking
    ).toEqual([
      'not the code in the checkout: the packaged app is older: package again',
    ]);
  });

  it('fails when the real profile changed', () => {
    const base = result();
    const verdict = judge(
      result({
        realProfile: { ...base.realProfile, touched: ['changed config.json'] },
      })
    );

    expect(verdict.verdict).toBe('FAIL');
    expect(verdict.blocking[0]).toContain('changed config.json');
  });

  it('fails when the run’s own log lines are in the real profile’s log', () => {
    const base = result();

    expect(
      judge(
        result({
          realProfile: {
            ...base.realProfile,
            logChanged: true,
            ownLinesInSharedLog: ['[t] [info] App quit'],
          },
        })
      ).verdict
    ).toBe('FAIL');
  });

  it('does not fail because someone else wrote to the shared log', () => {
    const base = result();

    expect(
      judge(result({ realProfile: { ...base.realProfile, logChanged: true } }))
        .verdict
    ).toBe('PASS');
  });

  it('fails on window errors, asks for a look at warnings', () => {
    const problem = {
      source: 'exception' as const,
      window: 'overlay window "Tearoff"',
      kind: 'overlay' as const,
      text: 'TypeError: x',
      phase: 'capture 1',
      atMs: 1000,
    };

    expect(
      judge(result({ problems: [{ ...problem, level: 'error' }] })).blocking
    ).toEqual(["1 different error in the app's windows (1 in all)"]);
    expect(
      judge(result({ problems: [{ ...problem, level: 'warning' }] }))
    ).toMatchObject({
      verdict: 'ATTENTION',
      attention: ["1 different warning in the app's windows (1 in all)"],
    });
  });

  it('fails when the app did not quit, a toggle failed or the run stopped', () => {
    const verdict = judge(
      result({
        quit: { clean: false, detail: 'killed' },
        toggles: [{ name: 'overlay on/off switch', passed: false, detail: '' }],
        fatal: 'no overlay window opened',
      })
    );

    expect(verdict.blocking).toEqual([
      'the run did not finish: no overlay window opened',
      'the overlay did not follow: overlay on/off switch',
      'the app did not quit: killed',
    ]);
  });

  it('fails when the Windows start-up entry changed', () => {
    expect(
      judge(
        result({ loginItems: { before: [], after: ['electron.app.tearoff'] } })
      ).blocking
    ).toEqual(['the Windows start-up entry for Tearoff changed']);
  });
});

describe('buildReport', () => {
  it('starts with the verdict and lists every widget with its picture', () => {
    const report = buildReport(
      result({
        widgets: [
          row(),
          row({
            id: 'hybrid',
            captures: [
              capture({ drawn: false, text: '', screenshot: 'h.png' }),
            ],
            hints: ['draws only for a car with a hybrid system'],
          }),
        ],
      })
    );

    expect(report.split('\n')[2]).toBe(
      '**Verdict: ATTENTION** (0 blocking, 1 to look at)'
    );
    expect(report).toContain(
      '| standings | rendered | drawn in 1 of 1 captures <br>reads: "P1 Alonso" | [1](shots/capture1/standings.png) |'
    );
    expect(report).toContain(
      '| hybrid | empty | drawn in 0 of 1 captures; draws only for a car with a hybrid system | [1](h.png) |'
    );
    expect(report).toContain('1 rendered, 1 empty.');
  });

  it('says the real profile was left alone, and by whom the log grew', () => {
    const base = result();
    const report = buildReport(
      result({
        realProfile: {
          ...base.realProfile,
          logChanged: true,
          appendedSample: ['[t] [info]  [sessionLifecycle] Driver joined'],
        },
      })
    );

    expect(report).toContain(
      'no file was added, removed or changed, apart from `logs/main.log`.'
    );
    expect(report).toContain('another process wrote them');
    expect(report).toContain('[sessionLifecycle] Driver joined');
  });

  it('groups a repeated error and names its window and widget', () => {
    const problem = {
      source: 'console' as const,
      level: 'error' as const,
      window: 'overlay window "Tearoff"',
      kind: 'overlay' as const,
      widget: 'fuel',
      text: '[ErrorBoundary:widget:fuel] boom',
      phase: 'capture 2',
      atMs: 1,
    };
    const report = buildReport(result({ problems: [problem, problem] }));

    expect(report).toContain(
      '- **error** (console, 2 times) in overlay window "Tearoff", widget `fuel`, during capture 2:'
    );
  });

  it('escapes a pipe in widget text so the table holds', () => {
    const report = buildReport(
      result({ widgets: [row({ captures: [capture({ text: 'a | b' })] })] })
    );

    expect(report).toContain('reads: "a \\| b"');
  });
});
