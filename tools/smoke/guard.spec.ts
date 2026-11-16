import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  compareTrees,
  findBlockingProcesses,
  judgeRealProfile,
  parseRegQuery,
  staleBuildReasons,
  tearoffLoginItems,
  treeDiffIsEmpty,
  type TreeEntry,
} from './guard.ts';

const proc = (name: string, commandLine = '') => ({
  pid: 1,
  name,
  commandLine,
});

describe('findBlockingProcesses', () => {
  it('stops for the owner’s Tearoff and for a simulator', () => {
    const blocking = findBlockingProcesses([
      proc('tearoff.exe'),
      proc('iRacingSim64DX11.exe'),
      proc('Le Mans Ultimate.exe'),
      proc('LMU.exe'),
    ]);

    expect(blocking.map((p) => p.reason)).toEqual([
      'Tearoff is running',
      'iRacing is running',
      'Le Mans Ultimate is running',
      'Le Mans Ultimate is running',
    ]);
  });

  it('does not stop for services, launchers or other apps', () => {
    expect(
      findBlockingProcesses([
        proc('iRacingService64.exe'),
        proc('iRacingUI.exe'),
        proc('steam.exe'),
        proc('node.exe', 'node vitest run'),
      ])
    ).toEqual([]);
  });

  it('stops for an Electron started on a checkout, not for its helpers or a script', () => {
    const dev = proc(
      'electron.exe',
      '"W:\\tearoff\\node_modules\\electron\\dist\\electron.exe" . --enable-logging'
    );
    const helper = proc(
      'electron.exe',
      '"W:\\tearoff\\node_modules\\electron\\dist\\electron.exe" --type=renderer --user-data-dir=x'
    );
    const script = proc(
      'electron.exe',
      '"W:\\tearoff\\node_modules\\electron\\dist\\electron.exe" "C:\\Temp\\capture.cjs" out story'
    );

    expect(findBlockingProcesses([dev, helper, script])).toEqual([
      { ...dev, reason: expect.stringContaining('Electron app') },
    ]);
  });
});

const tree = (entries: Record<string, [number, number]>) =>
  new Map<string, TreeEntry>(
    Object.entries(entries).map(([file, [size, mtimeMs]]) => [
      file,
      { size, mtimeMs },
    ])
  );

describe('compareTrees', () => {
  it('finds nothing in two equal listings', () => {
    const before = tree({ 'config.json': [10, 1], 'laps.db': [20, 2] });

    expect(treeDiffIsEmpty(compareTrees(before, new Map(before)))).toBe(true);
  });

  it('names what was added, removed and changed', () => {
    const diff = compareTrees(
      tree({ 'config.json': [10, 1], 'laps.db': [20, 2], old: [1, 1] }),
      tree({ 'config.json': [10, 5], 'laps.db': [20, 2], fresh: [1, 1] })
    );

    expect(diff).toEqual({
      added: ['fresh'],
      removed: ['old'],
      changed: ['config.json'],
    });
  });
});

describe('judgeRealProfile', () => {
  const log = path.join('logs', 'main.log');
  const none = { added: [], removed: [], changed: [] };

  it('passes an untouched profile', () => {
    expect(judgeRealProfile(none, [], new Set())).toMatchObject({
      touched: [],
      logChanged: false,
      ownLinesInSharedLog: [],
    });
  });

  it('does not blame the run for the shared log growing with other lines', () => {
    const verdict = judgeRealProfile(
      { ...none, changed: [log] },
      ['[t] [info]  [sessionLifecycle] Driver joined: carIdx=0'],
      new Set(['[t] [info]  [OverlayManager] Found 1 display(s):'])
    );

    expect(verdict.touched).toEqual([]);
    expect(verdict.logChanged).toBe(true);
    expect(verdict.ownLinesInSharedLog).toEqual([]);
  });

  it('blames the run when its own log lines are in the shared log', () => {
    const line = '[t] [info]  [OverlayManager] Found 1 display(s):';

    expect(
      judgeRealProfile({ ...none, changed: [log] }, [line], new Set([line]))
        .ownLinesInSharedLog
    ).toEqual([line]);
  });

  it('reports any other file, whatever happened to it', () => {
    const verdict = judgeRealProfile(
      {
        added: ['laps.v1.bak.db'],
        removed: ['x.json'],
        changed: ['config.json'],
      },
      [],
      new Set()
    );

    expect(verdict.touched).toEqual([
      'added laps.v1.bak.db',
      'removed x.json',
      'changed config.json',
    ]);
  });
});

describe('login items', () => {
  const output = [
    '',
    'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Run',
    '    Steam    REG_SZ    "W:\\Steam\\steam.exe" -silent',
    '    electron.app.tearoff    REG_SZ    C:\\Users\\me\\AppData\\Local\\tearoff\\tearoff.exe',
    '    GalaxyClient    REG_SZ    ',
    '',
  ].join('\r\n');

  it('parses reg query output', () => {
    const items = parseRegQuery(output);

    expect(items.get('Steam')).toBe('"W:\\Steam\\steam.exe" -silent');
    expect(items.size).toBe(3);
  });

  it('finds the entry the app writes for itself', () => {
    expect(
      tearoffLoginItems(parseRegQuery(output)).map(([name]) => name)
    ).toEqual(['electron.app.tearoff']);
  });
});

describe('staleBuildReasons', () => {
  const fresh = {
    nativeSourceMs: 100,
    oldestAddonMs: 200,
    newestAddonMs: 210,
    packagedMs: 300,
    headCommitMs: 250,
  };

  it('has nothing to say about a build made in order', () => {
    expect(staleBuildReasons(fresh)).toEqual([]);
  });

  it('catches an addon built before the native sources changed', () => {
    expect(staleBuildReasons({ ...fresh, nativeSourceMs: 205 })).toEqual([
      expect.stringContaining('npm run irsdk:build'),
    ]);
  });

  it('catches a package made before the addons or the commit', () => {
    expect(staleBuildReasons({ ...fresh, newestAddonMs: 301 })).toEqual([
      expect.stringContaining('older than the native addons'),
    ]);
    expect(staleBuildReasons({ ...fresh, headCommitMs: 301 })).toEqual([
      expect.stringContaining('older than the commit'),
    ]);
  });

  it('checks only the addons for the dev target, and nothing it cannot know', () => {
    expect(
      staleBuildReasons({ nativeSourceMs: 300, oldestAddonMs: 200 })
    ).toHaveLength(1);
    expect(staleBuildReasons({})).toEqual([]);
  });
});
