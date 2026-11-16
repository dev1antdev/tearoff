import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export interface RunningProcess {
  pid: number;
  name: string;
  commandLine: string;
}

/** Every process on the machine, with its command line (Windows only). */
export function listProcesses(): RunningProcess[] {
  if (process.platform !== 'win32') return [];
  const json = execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      'Get-CimInstance Win32_Process | Select-Object ProcessId, Name, CommandLine | ConvertTo-Json -Compress',
    ],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
  );
  const raw: unknown = JSON.parse(json);
  const rows = Array.isArray(raw) ? raw : [raw];
  return rows
    .filter(
      (row): row is Record<string, unknown> =>
        typeof row === 'object' && row !== null
    )
    .map((row) => ({
      pid: Number(row.ProcessId),
      name: String(row.Name ?? ''),
      commandLine: String(row.CommandLine ?? ''),
    }));
}

export interface BlockingProcess extends RunningProcess {
  reason: string;
}

/**
 * The processes a launch would disturb: the owner's own Tearoff, a simulator,
 * or a development copy of the app. A helper process of Electron (`--type=`)
 * and an Electron that runs a script file are not the app.
 */
export function findBlockingProcesses(
  processes: readonly RunningProcess[]
): BlockingProcess[] {
  const blocking: BlockingProcess[] = [];
  for (const proc of processes) {
    const name = proc.name.toLowerCase();
    let reason: string | undefined;
    if (name === 'tearoff.exe' || name === 'tearoff') {
      reason = 'Tearoff is running';
    } else if (/^iracingsim/.test(name)) {
      reason = 'iRacing is running';
    } else if (/^(le mans ultimate|lmu)(\.exe)?$/.test(name)) {
      reason = 'Le Mans Ultimate is running';
    } else if (
      /^electron(\.exe)?$/.test(name) &&
      !proc.commandLine.includes('--type=') &&
      !/\.(c|m)?js(["\s]|$)/i.test(proc.commandLine)
    ) {
      reason = 'An Electron app is running from a checkout (a dev Tearoff?)';
    }
    if (reason) blocking.push({ ...proc, reason });
  }
  return blocking;
}

export interface TreeEntry {
  size: number;
  mtimeMs: number;
}

/** Every file under a folder with its size and modification time. Read only. */
export function snapshotTree(root: string): Map<string, TreeEntry> {
  const entries = new Map<string, TreeEntry>();
  const walk = (dir: string): void => {
    let names: fs.Dirent[];
    try {
      names = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of names) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else {
        try {
          const stat = fs.statSync(full);
          entries.set(path.relative(root, full), {
            size: stat.size,
            mtimeMs: stat.mtimeMs,
          });
        } catch {
          // Gone between the listing and the stat: not there, then.
        }
      }
    }
  };
  walk(root);
  return entries;
}

export interface TreeDiff {
  added: string[];
  removed: string[];
  changed: string[];
}

export function compareTrees(
  before: ReadonlyMap<string, TreeEntry>,
  after: ReadonlyMap<string, TreeEntry>
): TreeDiff {
  const diff: TreeDiff = { added: [], removed: [], changed: [] };
  for (const [file, entry] of after) {
    const was = before.get(file);
    if (!was) diff.added.push(file);
    else if (was.size !== entry.size || was.mtimeMs !== entry.mtimeMs) {
      diff.changed.push(file);
    }
  }
  for (const file of before.keys()) {
    if (!after.has(file)) diff.removed.push(file);
  }
  return diff;
}

export const treeDiffIsEmpty = (diff: TreeDiff): boolean =>
  diff.added.length + diff.removed.length + diff.changed.length === 0;

/** The log every Tearoff process and every spec run on this machine appends to. */
export const SHARED_LOG = path.join('logs', 'main.log');

export interface RealProfileVerdict {
  /** Files other than the shared log that differ. Any entry stops the gate. */
  touched: string[];
  /** Whether the shared log grew or changed while the app ran. */
  logChanged: boolean;
  /** Lines added to the shared log that this run's own log also holds. */
  ownLinesInSharedLog: string[];
  /** A few of the lines added, to see who wrote them. */
  appendedSample: string[];
}

/**
 * Judges a before/after pair of the real profile. `main.log` is judged apart:
 * spec runs elsewhere on the machine append to it, so it changing proves
 * nothing, while one of this run's own log lines turning up in it would.
 */
export function judgeRealProfile(
  diff: TreeDiff,
  appendedLines: readonly string[],
  ownLogLines: ReadonlySet<string>
): RealProfileVerdict {
  const isLog = (file: string) => path.normalize(file) === SHARED_LOG;
  const all = [
    ...diff.added.map((file) => `added ${file}`),
    ...diff.removed.map((file) => `removed ${file}`),
    ...diff.changed.map((file) => `changed ${file}`),
  ];
  const touched = all.filter(
    (line) => !isLog(line.slice(line.indexOf(' ') + 1))
  );
  return {
    touched,
    logChanged: all.length !== touched.length,
    ownLinesInSharedLog: appendedLines.filter((line) => ownLogLines.has(line)),
    appendedSample: appendedLines.slice(-6),
  };
}

/** The lines a file gained after `fromSize` bytes. Read only. */
export function readAppendedLines(file: string, fromSize: number): string[] {
  try {
    const size = fs.statSync(file).size;
    if (size <= fromSize) return [];
    const length = Math.min(size - fromSize, 4 * 1024 * 1024);
    const buffer = Buffer.alloc(length);
    const handle = fs.openSync(file, 'r');
    try {
      fs.readSync(handle, buffer, 0, length, size - length);
    } finally {
      fs.closeSync(handle);
    }
    return buffer
      .toString('utf8')
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0);
  } catch {
    return [];
  }
}

const RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';

/** Parses `reg query` output into value name -> data. */
export function parseRegQuery(output: string): Map<string, string> {
  const values = new Map<string, string>();
  for (const line of output.split(/\r?\n/)) {
    const match = /^\s{4}(.+?)\s{4}(REG_\w+)\s{4}(.*)$/.exec(line);
    if (match) values.set(match[1], match[3]);
  }
  return values;
}

/**
 * The programs Windows starts at sign-in for this user. The app rewrites its
 * own entry on every start (`setLoginItemSettings`), under a name made from
 * the app's name, so a smoke build shares it with the installed app.
 */
export function readLoginItems(): Map<string, string> {
  if (process.platform !== 'win32') return new Map();
  try {
    return parseRegQuery(
      execFileSync('reg.exe', ['query', RUN_KEY], { encoding: 'utf8' })
    );
  } catch {
    return new Map();
  }
}

export const tearoffLoginItems = (
  items: ReadonlyMap<string, string>
): [string, string][] =>
  [...items].filter(([name, data]) => /tearoff/i.test(`${name} ${data}`));

export interface BuildTimes {
  /** The newest native source file (C++ and binding.gyp). */
  nativeSourceMs?: number;
  /** The oldest and newest addon in build/Release. */
  oldestAddonMs?: number;
  newestAddonMs?: number;
  /** When the packaged app was written; undefined for the dev target. */
  packagedMs?: number;
  /** The commit the checkout is on. */
  headCommitMs?: number;
}

/**
 * Why the build under test is not the code in the checkout. A run of a stale
 * build passes or fails for something that is not what will be released.
 */
export function staleBuildReasons(times: BuildTimes): string[] {
  const reasons: string[] = [];
  const { nativeSourceMs, oldestAddonMs, newestAddonMs, packagedMs } = times;
  if (
    nativeSourceMs !== undefined &&
    oldestAddonMs !== undefined &&
    nativeSourceMs > oldestAddonMs
  ) {
    reasons.push(
      'the native addons in build/Release are older than the native sources: run "npm run irsdk:build", then package again'
    );
  }
  if (packagedMs !== undefined) {
    if (newestAddonMs !== undefined && newestAddonMs > packagedMs) {
      reasons.push(
        'the packaged app is older than the native addons in build/Release: package again'
      );
    }
    if (times.headCommitMs !== undefined && times.headCommitMs > packagedMs) {
      reasons.push(
        'the packaged app is older than the commit the checkout is on: package again'
      );
    }
  }
  return reasons;
}

/** The newest and oldest modification time of the files a filter accepts. */
export function modifiedRange(
  root: string,
  accept: (file: string) => boolean
): { oldest?: number; newest?: number } {
  let oldest: number | undefined;
  let newest: number | undefined;
  for (const [file, entry] of snapshotTree(root)) {
    if (!accept(file)) continue;
    oldest = Math.min(oldest ?? entry.mtimeMs, entry.mtimeMs);
    newest = Math.max(newest ?? entry.mtimeMs, entry.mtimeMs);
  }
  return { oldest, newest };
}
