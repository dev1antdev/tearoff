import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CdpSession, listTargets, type CdpTarget } from './cdp.ts';
import {
  badTokens,
  isNoise,
  widgetFromText,
  windowKind,
  type PageProblem,
  type WindowKind,
} from './errors.ts';
import {
  compareTrees,
  findBlockingProcesses,
  judgeRealProfile,
  listProcesses,
  modifiedRange,
  readAppendedLines,
  readLoginItems,
  SHARED_LOG,
  snapshotTree,
  staleBuildReasons,
  tearoffLoginItems,
  type TreeEntry,
} from './guard.ts';
import { inspectProfile } from './inspect.ts';
import { planGrid, rectsOverlap } from './layout.ts';
import {
  click,
  clickMenuSwitch,
  CLICK_FIRST_PAGE_SWITCH,
  goToSettingsPage,
  hasWidgetBox,
  isolateWidget,
  READ_APP_STATE,
  READ_DASHBOARD_UPDATES,
  READ_DISPLAY,
  READ_OVERLAY_VISIBILITY,
  READ_SETTINGS_PAGE,
  READ_WIDGET_BOXES,
  saveDashboard,
  scrollSettingsPage,
  setBackdrop,
  WATCH_DASHBOARD_UPDATES,
  type AppState,
  type SettingsPageState,
  type WidgetBox,
} from './pageScripts.ts';
import {
  copyProfile,
  readConfig,
  turnAutoStartOff,
  widgetsByProfile,
  type WidgetSummary,
} from './profile.ts';
import {
  buildReport,
  judge,
  type RunResult,
  type SettingsPageRow,
  type WidgetCapture,
  type WidgetRow,
} from './report.ts';

const REPO = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..'
);
const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));
const say = (text: string) => process.stdout.write(`[smoke] ${text}\n`);

interface Options {
  tape: string;
  simulator: 'lmu' | 'iracing';
  tapeSeconds: number;
  speed: number;
  loop: boolean;
  profileMode: 'fresh' | 'copy';
  copyFrom?: string;
  target: 'packaged' | 'dev';
  executable: string;
  runId: string;
  outDir: string;
  profileDir: string;
  realProfile: string;
  points: number;
  walkSettings: boolean;
  startTimeoutSeconds: number;
}

const USAGE = `Usage: npm run smoke:app -- --tape <file.lmudt|file.irdt> [options]

  --profile fresh|copy     fresh (default): a new profile with every widget the
                           simulator supports switched on, in a grid.
                           copy: a copy of the profile in --copy-from.
  --copy-from <dir>        the profile to copy (default: %APPDATA%\\tearoff).
  --target packaged|dev    packaged (default) runs --exe; dev runs npm start.
  --exe <file>             the packaged app (default out/smoke/tearoff-win32-x64/tearoff.exe).
  --speed <n>              replay speed, 0.25 to 100 (default 2 for iRacing; 4 for
                           LMU, which plays at about its recorded pace whatever
                           this says, and can take minutes to start at 1).
  --no-loop                stop at the end of the recording instead of looping.
  --points <n>             how many times every widget is captured (default 3).
  --tape-seconds <n>       length of the recording (default 240 LMU, 600 iRacing).
  --out <dir>              the report folder (default smoke-results/<run-id>).
  --profile-dir <dir>      the isolated profile (default <out>/profile); must not exist.
  --real-profile <dir>     the profile that must not change (default %APPDATA%\\tearoff).
  --run-id <name>          a name for the run.
  --skip-settings          do not open the settings pages.
`;

function parseOptions(argv: string[]): Options {
  const value = (name: string): string | undefined => {
    const index = argv.indexOf(name);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const tape = value('--tape');
  if (!tape) throw new Error(USAGE);
  const tapePath = path.resolve(tape);
  if (!fs.existsSync(tapePath)) throw new Error(`No recording at ${tapePath}`);
  const extension = path.extname(tapePath).toLowerCase();
  if (extension !== '.lmudt' && extension !== '.irdt') {
    throw new Error('--tape must be an .lmudt or .irdt recording');
  }
  const simulator = extension === '.lmudt' ? 'lmu' : 'iracing';
  const profileMode = value('--profile') === 'copy' ? 'copy' : 'fresh';
  const target = value('--target') === 'dev' ? 'dev' : 'packaged';
  // An iRacing recording does play faster, and the app then times laps from
  // fewer samples: at 8x the laps it measured were seconds off and never
  // became a reference. An LMU recording is handed out one recorded frame
  // per poll of the bridge, so it plays at about its recorded pace at any
  // speed above 1; at exactly 1 its first frame can be minutes in coming
  // (the bridge reopens a recording whose first frame is not yet due, which
  // starts its clock again), so the default keeps clear of that.
  const speed = Number(value('--speed') ?? (simulator === 'lmu' ? 4 : 2));
  if (!Number.isFinite(speed) || speed < 0.25 || speed > 100) {
    throw new Error('--speed must be between 0.25 and 100');
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const runId = (
    value('--run-id') ?? `${stamp}-${simulator}-${profileMode}`
  ).replace(/[^a-z0-9_-]+/gi, '-');
  const outDir = path.resolve(
    value('--out') ?? path.join(REPO, 'smoke-results', runId)
  );
  const appData =
    process.env.APPDATA ?? path.join(os.homedir(), 'AppData/Roaming');
  const realProfile = path.resolve(
    value('--real-profile') ?? path.join(appData, 'tearoff')
  );
  const profileDir = path.resolve(
    value('--profile-dir') ?? path.join(outDir, 'profile')
  );
  if (/[\s"&|<>^%!]/.test(profileDir)) {
    throw new Error(
      '--profile-dir needs a path without spaces or shell characters'
    );
  }
  const inside = (child: string, parent: string) =>
    !path.relative(parent, child).startsWith('..') &&
    !path.isAbsolute(path.relative(parent, child));
  if (inside(profileDir, realProfile) || inside(outDir, realProfile)) {
    throw new Error('The run must not write inside the real profile');
  }
  return {
    tape: tapePath,
    simulator,
    tapeSeconds: Number(
      value('--tape-seconds') ?? (simulator === 'lmu' ? 240 : 600)
    ),
    speed,
    loop: !argv.includes('--no-loop'),
    profileMode,
    copyFrom:
      profileMode === 'copy'
        ? path.resolve(value('--copy-from') ?? realProfile)
        : undefined,
    target,
    executable: path.resolve(
      value('--exe') ??
        path.join(REPO, 'out/smoke/tearoff-win32-x64/tearoff.exe')
    ),
    runId,
    outDir,
    profileDir,
    realProfile,
    points: Math.max(1, Math.min(8, Number(value('--points') ?? 3) || 3)),
    walkSettings: !argv.includes('--skip-settings'),
    startTimeoutSeconds: target === 'dev' ? 300 : 120,
  };
}

const freePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });

/** Stops a process this run started, and everything under it, by its id. */
function killTree(pid: number | undefined): void {
  if (!pid) return;
  try {
    if (process.platform === 'win32') {
      execFileSync('taskkill', ['/pid', String(pid), '/t', '/f'], {
        stdio: 'ignore',
      });
    } else {
      process.kill(pid, 'SIGKILL');
    }
  } catch {
    // Already gone.
  }
}

interface AppWindow {
  target: CdpTarget;
  session: CdpSession;
  kind: WindowKind;
  label: string;
}

const textOf = (value: unknown): string => {
  if (typeof value !== 'object' || value === null) return String(value ?? '');
  const record = value as Record<string, unknown>;
  if (typeof record.value === 'string') return record.value;
  if (record.value !== undefined) return JSON.stringify(record.value);
  return String(record.description ?? record.type ?? '');
};

/** The app's windows, each with a debugging session that records errors. */
class Windows {
  private readonly byId = new Map<string, AppWindow>();
  private refreshing: Promise<void> | undefined;

  constructor(
    private readonly port: number,
    private readonly report: (
      window: AppWindow,
      problem: Pick<PageProblem, 'source' | 'level' | 'text' | 'url'>
    ) => void
  ) {}

  refresh(): Promise<void> {
    this.refreshing ??= this.doRefresh().finally(() => {
      this.refreshing = undefined;
    });
    return this.refreshing;
  }

  all(kind?: WindowKind): AppWindow[] {
    return [...this.byId.values()].filter(
      (window) => !window.session.isClosed && (!kind || window.kind === kind)
    );
  }

  first(kind: WindowKind): AppWindow | undefined {
    return this.all(kind)[0];
  }

  closeAll(): void {
    for (const window of this.byId.values()) window.session.close();
    this.byId.clear();
  }

  private async doRefresh(): Promise<void> {
    let targets: CdpTarget[];
    try {
      targets = await listTargets(this.port);
    } catch {
      return;
    }
    const live = new Set(targets.map((target) => target.id));
    for (const [id, window] of this.byId) {
      if (!live.has(id) || window.session.isClosed) {
        window.session.close();
        this.byId.delete(id);
      }
    }
    for (const target of targets) {
      if (this.byId.has(target.id) || !target.webSocketDebuggerUrl) continue;
      if (target.type !== 'page' && target.type !== 'webview') continue;
      try {
        await this.attach(target);
      } catch {
        // Closed while attaching: the next refresh sees what is there.
      }
    }
  }

  private async attach(target: CdpTarget): Promise<void> {
    const session = await CdpSession.connect(target.webSocketDebuggerUrl ?? '');
    const kind = target.type === 'webview' ? 'other' : windowKind(target.url);
    const window: AppWindow = {
      target,
      session,
      kind,
      // A window without a title is known by the end of its address.
      label: `${kind} window "${target.title || target.url.split('/').pop()}"`,
    };
    session.on('Runtime.exceptionThrown', (params) => {
      const details = (params.exceptionDetails ?? {}) as Record<
        string,
        unknown
      >;
      const exception = (details.exception ?? {}) as Record<string, unknown>;
      this.report(window, {
        source: 'exception',
        level: 'error',
        text: `${String(details.text ?? 'Uncaught')} ${String(exception.description ?? textOf(exception))}`.trim(),
        url: typeof details.url === 'string' ? details.url : undefined,
      });
    });
    session.on('Runtime.consoleAPICalled', (params) => {
      const type = String(params.type);
      if (type !== 'error' && type !== 'warning' && type !== 'assert') return;
      const args = Array.isArray(params.args) ? params.args : [];
      this.report(window, {
        source: 'console',
        level: type === 'warning' ? 'warning' : 'error',
        text: args.map(textOf).join(' '),
      });
    });
    session.on('Log.entryAdded', (params) => {
      const entry = (params.entry ?? {}) as Record<string, unknown>;
      if (entry.level !== 'error' && entry.level !== 'warning') return;
      this.report(window, {
        source: 'log',
        level: entry.level,
        text: String(entry.text ?? ''),
        url: typeof entry.url === 'string' ? entry.url : undefined,
      });
    });
    session.on('Inspector.targetCrashed', () => {
      this.report(window, {
        source: 'crash',
        level: 'error',
        text: "The window's renderer process crashed",
      });
    });
    this.byId.set(target.id, window);
    await session.send('Runtime.enable');
    await session.send('Log.enable');
    await session.send('Page.enable');
  }
}

async function waitFor<T>(
  probe: () => Promise<T | undefined | false>,
  timeoutMs: number,
  intervalMs = 400
): Promise<T | undefined> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const value = await probe();
      if (value !== undefined && value !== false) return value;
    } catch {
      // The window may be reloading; ask again.
    }
    if (Date.now() >= deadline) return undefined;
    await sleep(intervalMs);
  }
}

async function capture(
  session: CdpSession,
  file: string,
  clip?: { x: number; y: number; width: number; height: number; scale: number }
): Promise<boolean> {
  const result = await session.send(
    'Page.captureScreenshot',
    { format: 'png', ...(clip ? { clip } : {}) },
    25_000
  );
  if (typeof result.data !== 'string') return false;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.from(result.data, 'base64'));
  return true;
}

const safeName = (text: string): string =>
  text.replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '') || 'window';

/**
 * Widgets whose resting state is an empty box, from their own manifests and
 * components: said beside an empty one so it is not taken for a failure.
 */
const DRAWS_ONLY: Record<string, string> = {
  garagecover: 'draws only while the car is in the garage',
  pitlanehelper: 'draws only in the pit lane',
  hybrid: 'draws only for a car with a hybrid system',
  rejoin: 'draws only when the car is slow or stopped on track',
  heartrate: 'needs a HypeRate device to be set',
  streamchat: 'needs a chat channel to be set',
  stintplan: 'needs a race plan',
  strategytimeline: 'needs a race plan',
};

const FIXED_PAGES = [
  'general',
  'keybindings',
  'profiles',
  'driver-tags',
  'race-plan',
  'car-setup',
  'laps',
  'advanced',
  'release-notes',
  'about',
];

async function main(): Promise<number> {
  let options: Options;
  try {
    options = parseOptions(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : error}\n`);
    return 2;
  }
  if (options.target === 'packaged' && !fs.existsSync(options.executable)) {
    process.stderr.write(
      `No packaged app at ${options.executable}.\nBuild one with: $env:IRDASHIES_OUT_DIR='out/smoke'; npx electron-forge package\n`
    );
    return 2;
  }
  if (fs.existsSync(options.profileDir)) {
    process.stderr.write(
      `${options.profileDir} already exists; a run needs a new profile folder.\n`
    );
    return 2;
  }

  // Nothing is launched while the owner's Tearoff or a simulator is up.
  const blocking = findBlockingProcesses(listProcesses());
  if (blocking.length > 0) {
    process.stderr.write(
      `Not launching: ${blocking.map((proc) => `${proc.reason} (${proc.name}, pid ${proc.pid})`).join('; ')}.\nTry again when it is closed.\n`
    );
    return 2;
  }
  const loginBefore = tearoffLoginItems(readLoginItems());
  if (loginBefore.length > 0) {
    process.stderr.write(
      `Not launching: Tearoff is registered to start with Windows (${loginBefore.map(([name]) => name).join(', ')}).\nEvery start of the app rewrites that entry, so a run would replace or remove it. Turn "start with Windows" off in the installed app first, and on again afterwards.\n`
    );
    return 2;
  }

  const shotsDir = path.join(options.outDir, 'shots');
  fs.mkdirSync(shotsDir, { recursive: true });
  const relative = (file: string) =>
    path.relative(options.outDir, file).replaceAll('\\', '/');

  const realBefore = fs.existsSync(options.realProfile)
    ? snapshotTree(options.realProfile)
    : undefined;
  const sharedLog = path.join(options.realProfile, SHARED_LOG);
  const sharedLogSize = realBefore?.get(SHARED_LOG)?.size ?? 0;

  let gitHead = 'unknown';
  let headCommitMs: number | undefined;
  try {
    const git = (args: string[]) =>
      execFileSync('git', args, { cwd: REPO, encoding: 'utf8' }).trim();
    gitHead = git(['rev-parse', '--short', 'HEAD']);
    headCommitMs = Number(git(['log', '-1', '--format=%ct'])) * 1000;
  } catch {
    // Not a checkout: the report says unknown.
  }
  // Is the build the code in the checkout? A stale one tests something else.
  const nativeSources = modifiedRange(path.join(REPO, 'src/app'), (file) =>
    /\/native\/.*\.(cc|cpp|h|hpp)$/.test(`/${file.replaceAll('\\', '/')}`)
  );
  const addons = modifiedRange(path.join(REPO, 'build/Release'), (file) =>
    file.endsWith('.node')
  );
  const asar = path.join(
    path.dirname(options.executable),
    'resources/app.asar'
  );
  const staleBuild = staleBuildReasons({
    nativeSourceMs: Math.max(
      nativeSources.newest ?? 0,
      fs.statSync(path.join(REPO, 'binding.gyp'), { throwIfNoEntry: false })
        ?.mtimeMs ?? 0
    ),
    oldestAddonMs: addons.oldest,
    newestAddonMs: addons.newest,
    packagedMs:
      options.target === 'packaged'
        ? fs.statSync(asar, { throwIfNoEntry: false })?.mtimeMs
        : undefined,
    headCommitMs,
  });
  for (const reason of staleBuild) say(`WARNING: ${reason}`);

  const result: RunResult = {
    runId: options.runId,
    startedAt: new Date().toISOString(),
    finishedAt: '',
    gitHead,
    appVersion: 'unknown',
    target: options.target,
    executable: options.target === 'dev' ? 'npm start' : options.executable,
    tape: options.tape,
    speed: options.speed,
    loop: options.loop,
    profileMode: options.profileMode,
    profileSource: options.copyFrom,
    profileDir: options.profileDir,
    simulator: null,
    display: 'unknown',
    layoutNote: '',
    notes: [],
    staleBuild,
    windows: [],
    widgets: [],
    settingsPages: [],
    toggles: [],
    problems: [],
    quit: { clean: false, detail: 'The app was never started.' },
    realProfile: {
      checked: false,
      path: options.realProfile,
      touched: [],
      logChanged: false,
      ownLinesInSharedLog: [],
      appendedSample: [],
    },
    loginItems: {
      before: loginBefore.map(([name]) => name),
      after: [],
    },
  };

  // The profile: a new one, or the user's data from an existing one.
  let widgetsBefore: Map<string, WidgetSummary[]> | undefined;
  let originalDb: string | undefined;
  if (options.profileMode === 'copy' && options.copyFrom) {
    const copied = copyProfile(options.copyFrom, options.profileDir);
    result.notes.push(`copied from the source profile: ${copied.join(', ')}`);
    const configFile = path.join(options.profileDir, 'config.json');
    const config = readConfig(configFile);
    if (!config.parsed) {
      result.notes.push(
        `the copied config.json does not parse: ${config.error}`
      );
    } else if (turnAutoStartOff(config.config)) {
      fs.writeFileSync(configFile, JSON.stringify(config.config));
      result.notes.push(
        '"start with Windows" was on in the copied profile and was turned off in the copy, so the run does not register this build to start at sign-in'
      );
    }
    widgetsBefore = widgetsByProfile(readConfig(configFile).config);
    // Kept apart, untouched, to hold the upgraded library against.
    const originals = path.join(options.outDir, 'original');
    fs.mkdirSync(originals, { recursive: true });
    for (const name of fs.readdirSync(options.profileDir)) {
      if (/^laps\.db(-wal|-shm)?$/.test(name) || name === 'config.json') {
        fs.copyFileSync(
          path.join(options.profileDir, name),
          path.join(originals, name)
        );
      }
    }
    if (fs.existsSync(path.join(originals, 'laps.db'))) {
      originalDb = path.join(originals, 'laps.db');
    }
  } else {
    fs.mkdirSync(options.profileDir, { recursive: true });
  }
  const filesBefore: Map<string, TreeEntry> = snapshotTree(options.profileDir);

  const startedMs = Date.now();
  let phase = 'start';
  let widgetIds: string[] = [];
  const port = await freePort();
  const windows = new Windows(port, (window, problem) => {
    if (isNoise(problem.text)) return;
    result.problems.push({
      ...problem,
      window: window.label,
      kind: window.kind,
      widget: widgetFromText(problem.text, widgetIds),
      phase,
      atMs: Date.now() - startedMs,
    });
  });

  // Start the app on the recording, with its own profile and a debugging port.
  // Without anything a benchmark or another replay left in the environment.
  const env: NodeJS.ProcessEnv = Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) =>
        name !== 'ELECTRON_RUN_AS_NODE' &&
        !/^(PERF_|IRDASHIES_(LMU|TELEMETRY|IRSDK)_)/.test(name)
    )
  );
  env.NODE_OPTIONS = '';
  env.VSCODE_INSPECTOR_OPTIONS = '';
  env.ELECTRON_ENABLE_LOGGING = '1';
  env.IRDASHIES_SIM = options.simulator;
  const prefix =
    options.simulator === 'lmu'
      ? 'IRDASHIES_LMU_REPLAY'
      : 'IRDASHIES_TELEMETRY_REPLAY';
  env[prefix] = options.tape;
  env[`${prefix}_SPEED`] = String(options.speed);
  env[`${prefix}_LOOP`] = options.loop ? '1' : '0';

  const appArguments = [
    `--user-data-dir=${options.profileDir}`,
    `--remote-debugging-port=${port}`,
  ];
  const appOutput = fs.openSync(
    path.join(options.outDir, 'app-output.log'),
    'w'
  );
  let child: ChildProcess | undefined;
  const stop = () => killTree(child?.pid);
  process.once('SIGINT', () => {
    stop();
    process.exit(130);
  });

  const captures = new Map<string, WidgetCapture[]>();
  const windowShots = new Map<string, string[]>();
  let state: AppState | undefined;
  let refresher: NodeJS.Timeout | undefined;

  const addWindowShot = (label: string, file: string) => {
    windowShots.set(label, [...(windowShots.get(label) ?? []), relative(file)]);
  };

  try {
    say(
      `${options.runId}: ${options.simulator} recording at ${options.speed}x, ${options.profileMode} profile, ${options.target} build`
    );
    child =
      options.target === 'packaged'
        ? spawn(options.executable, appArguments, {
            cwd: path.dirname(options.executable),
            env,
            stdio: ['ignore', appOutput, appOutput],
          })
        : spawn(
            process.env.ComSpec ?? 'cmd.exe',
            ['/d', '/s', '/c', `npm.cmd start -- -- ${appArguments.join(' ')}`],
            { cwd: REPO, env, stdio: ['ignore', appOutput, appOutput] }
          );
    const started = child;
    let exited: number | null | undefined;
    started.once('exit', (code) => {
      exited = code;
    });
    result.quit = { clean: false, detail: 'The app was still running.' };

    const up = await waitFor(
      async () => {
        if (exited !== undefined) throw new Error('exited');
        const targets = await listTargets(port);
        return targets.some((target) => target.type === 'page');
      },
      options.startTimeoutSeconds * 1000,
      1000
    );
    if (!up) {
      throw new Error(
        exited !== undefined
          ? `the app exited with code ${exited} before any window opened (see app-output.log)`
          : `no window answered on the debugging port within ${options.startTimeoutSeconds}s`
      );
    }
    say(`windows are up after ${Math.round((Date.now() - startedMs) / 1000)}s`);
    await windows.refresh();
    refresher = setInterval(() => void windows.refresh(), 2000);

    const settings = await waitFor(async () => {
      await windows.refresh();
      return windows.first('settings');
    }, 60_000);
    if (!settings) throw new Error('the settings window never opened');
    const readState = () => settings.session.evaluate<AppState>(READ_APP_STATE);
    state = await waitFor(readState, 60_000, 1000);
    if (!state) throw new Error('the settings window never answered');
    result.appVersion = state.version;
    result.simulator = state.simulator;
    widgetIds = [
      ...new Set(state.dashboard.widgets.map((w) => w.type ?? w.id)),
    ];

    const overlay = await waitFor(async () => {
      await windows.refresh();
      return windows.first('overlay') ?? windows.first('widget');
    }, 60_000);
    if (!overlay) throw new Error('no overlay window opened');
    const display = await overlay.session.evaluate<{
      width: number;
      height: number;
      scale: number;
    }>(READ_DISPLAY);
    result.display = `${display.width}x${display.height} at scale ${display.scale}`;

    if (options.profileMode === 'fresh') {
      phase = 'setting up the dashboard';
      const disabled = new Set(state.disabledForSim);
      const typeOf = (w: { id: string; type?: string }) => w.type ?? w.id;
      const onOverlay = state.dashboard.widgets.filter(
        (w) => !disabled.has(typeOf(w)) && typeOf(w) !== 'gantry'
      );
      const plan = planGrid(
        display,
        onOverlay.map((w) => ({
          id: w.id,
          width: w.layout.width,
          height: w.layout.height,
        }))
      );
      const placed = new Map(plan.placements.map((p) => [p.id, p]));
      const dashboard = {
        ...state.dashboard,
        widgets: state.dashboard.widgets.map((widget) => {
          const type = typeOf(widget);
          if (disabled.has(type)) return widget;
          const place = placed.get(widget.id);
          return {
            ...widget,
            enabled: true,
            ...(place
              ? {
                  layout: {
                    x: place.x,
                    y: place.y,
                    width: place.width,
                    height: place.height,
                  },
                  ...(place.scale !== 100 ? { scale: place.scale } : {}),
                }
              : {}),
            // As the performance harness does for a replay: nothing hides
            // because the recording's driver is not "on track".
            config: {
              ...widget.config,
              showOnlyWhenOnTrack: false,
              ...(type === 'radar'
                ? { autoHide: false, hideInPit: false, hideInPitBox: false }
                : {}),
              ...(type === 'flag' ? { showNoFlagState: true } : {}),
            },
          };
        }),
      };
      await settings.session.evaluate(saveDashboard(dashboard));
      const scaled = plan.placements.filter((p) => p.scale !== 100);
      result.layoutNote =
        `${plan.placements.length} widgets laid out in a grid` +
        (plan.layers > 1
          ? ` on ${plan.layers} sheets (the display cannot hold them side by side, so boxes overlap and every widget is captured on its own)`
          : ', none over another') +
        (scaled.length > 0
          ? `; scaled to fit the display: ${scaled.map((p) => `${p.id} ${p.scale}%`).join(', ')}`
          : '') +
        '. Every widget was set to show off track as well.';
      const expected = plan.placements.length;
      const drawn = await waitFor(
        async () => {
          await windows.refresh();
          const window = windows.first('overlay');
          if (!window) return false;
          const boxes =
            await window.session.evaluate<WidgetBox[]>(READ_WIDGET_BOXES);
          return boxes.length >= expected;
        },
        45_000,
        1000
      );
      if (!drawn) {
        result.notes.push(
          `the overlay did not show all ${expected} widget boxes within 45s of switching them on`
        );
      }
      state = (await waitFor(readState, 20_000, 1000)) ?? state;
      widgetsBefore = new Map([
        [
          state.profileId,
          state.dashboard.widgets.map((w) => ({
            id: w.id,
            type: w.type ?? w.id,
            enabled: w.enabled,
            config: JSON.stringify(w.config ?? {}),
          })),
        ],
      ]);
    } else {
      result.layoutNote =
        "The profile's own layout and settings, unchanged; overlapping widgets are captured on their own.";
    }

    const waitingSince = Date.now();
    const running = await waitFor(
      async () => (await readState()).running,
      240_000,
      1000
    );
    const waited = Math.round((Date.now() - waitingSince) / 1000);
    if (!running) {
      result.notes.push(
        `the app did not report the recording as a running simulator within ${waited}s; the captures went ahead without it`
      );
    } else if (waited > 15) {
      result.notes.push(
        `the recording took ${waited}s to start playing after the windows were up`
      );
    }
    const telemetryStart = Date.now();
    // How long the recording lasts on the clock: an LMU one plays at its
    // recorded pace whatever the speed says.
    const wallSeconds =
      options.tapeSeconds /
      (options.simulator === 'lmu'
        ? Math.min(1, options.speed)
        : options.speed);

    const captureRound = async (round: number): Promise<void> => {
      phase = `capture ${round}`;
      await windows.refresh();
      const dir = path.join(shotsDir, `capture${round}`);
      for (const window of windows.all()) {
        if (window.kind === 'settings' || window.kind === 'other') continue;
        const transparent =
          window.kind === 'overlay' || window.kind === 'widget';
        const name = safeName(`${window.kind}-${window.target.title}`);
        try {
          if (transparent) {
            // The overlay is transparent: give the picture a background.
            await window.session.evaluate(setBackdrop(true));
          }
          const file = path.join(dir, `window-${name}.png`);
          if (await capture(window.session, file))
            addWindowShot(window.label, file);
          if (window.kind === 'gantry') {
            const text = await window.session.evaluate<string>(
              `(document.body.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 600)`
            );
            captures.set('gantry', [
              ...(captures.get('gantry') ?? []),
              {
                round,
                drawn: text.length > 0,
                text,
                badTokens: badTokens(text),
                overflowX: 0,
                overflowY: 0,
                cut: false,
                screenshot: relative(file),
              },
            ]);
          }
          if (!transparent) continue;
          const view = await window.session.evaluate<{
            innerWidth: number;
            innerHeight: number;
          }>(READ_DISPLAY);
          const boxes =
            await window.session.evaluate<WidgetBox[]>(READ_WIDGET_BOXES);
          for (const box of boxes) {
            const x = Math.max(0, box.x);
            const y = Math.max(0, box.y);
            const width = Math.min(view.innerWidth, box.x + box.width) - x;
            const height = Math.min(view.innerHeight, box.y + box.height) - y;
            const entry: WidgetCapture = {
              round,
              drawn:
                !box.hidden &&
                (box.text.length > 0 || box.media > 0 || box.painted > 0),
              text: box.text,
              badTokens: badTokens(box.text),
              overflowX: box.overflowX,
              overflowY: box.overflowY,
              cut: width < box.width - 1 || height < box.height - 1,
            };
            if (width > 1 && height > 1) {
              const overlapped = boxes.some(
                (other) => other.id !== box.id && rectsOverlap(box, other)
              );
              if (overlapped) {
                await window.session.evaluate(isolateWidget(box.id));
              }
              const shot = path.join(dir, `${safeName(box.id)}.png`);
              const taken = await capture(window.session, shot, {
                x,
                y,
                width,
                height,
                // A widget shrunk to fit is captured at its own size.
                scale: Math.min(2, 100 / Math.max(50, box.scale)),
              });
              if (taken) entry.screenshot = relative(shot);
              if (overlapped)
                await window.session.evaluate(isolateWidget(null));
            }
            captures.set(box.id, [...(captures.get(box.id) ?? []), entry]);
          }
        } catch (error) {
          result.notes.push(
            `capture ${round} of the ${window.label} failed: ${error instanceof Error ? error.message : error}`
          );
        } finally {
          if (transparent && !window.session.isClosed) {
            await window.session
              .evaluate(isolateWidget(null))
              .catch(() => undefined);
            await window.session
              .evaluate(setBackdrop(false))
              .catch(() => undefined);
          }
        }
      }
      say(
        `capture ${round} done at ${Math.round((Date.now() - telemetryStart) / 1000)}s of telemetry`
      );
    };

    for (let round = 1; round <= options.points; round += 1) {
      const due =
        telemetryStart + (wallSeconds * 1000 * round) / (options.points + 1);
      phase = `waiting for capture ${round}`;
      if (Date.now() < due) await sleep(due - Date.now());
      await captureRound(round);
    }

    // The settings window, page by page. A window that starts hidden in the
    // tray (the "start minimised" setting) cannot be photographed.
    const settingsShown =
      options.walkSettings &&
      (await settings.session
        .send('Page.captureScreenshot', { format: 'png' }, 12_000)
        .then(
          (shot) => typeof shot.data === 'string',
          () => false
        ));
    if (options.walkSettings && !settingsShown) {
      result.notes.push(
        'the settings window could not be photographed (it starts hidden when "start minimised" is on), so its pages and the toggles were not checked'
      );
    }
    if (settingsShown) {
      const session = settings.session;
      // The window keeps its own width, so the page is laid out as it is on
      // this screen; it is made taller so a page needs fewer pictures.
      const size = await session.evaluate<{
        innerWidth: number;
        innerHeight: number;
      }>(READ_DISPLAY);
      await session.send('Emulation.setDeviceMetricsOverride', {
        width: size.innerWidth,
        height: Math.max(size.innerHeight, 1000),
        deviceScaleFactor: 1,
        mobile: false,
      });
      result.notes.push(
        `the settings window is ${size.innerWidth}x${size.innerHeight}; its pages were photographed ${Math.max(size.innerHeight, 1000)} pixels tall`
      );
      const pressEscape = async () => {
        for (const type of ['keyDown', 'keyUp']) {
          await session.send('Input.dispatchKeyEvent', {
            type,
            key: 'Escape',
            code: 'Escape',
            windowsVirtualKeyCode: 27,
          });
        }
      };
      const readPage = () =>
        session.evaluate<SettingsPageState>(READ_SETTINGS_PAGE);
      const settingsDir = path.join(shotsDir, 'settings');
      phase = 'settings window as it opened';
      await sleep(500);
      const opened = path.join(settingsDir, '00-as-opened.png');
      if (await capture(session, opened)) addWindowShot(settings.label, opened);
      const atStart = await readPage();
      if (atStart.dialog) {
        result.notes.push(
          `the settings window opened with a dialog over it (in the picture "as opened"): "${atStart.dialog.replace(/\s+/g, ' ').slice(0, 160)}"; closed with Escape`
        );
        await pressEscape();
        await sleep(500);
      }
      const pages = [
        ...FIXED_PAGES,
        ...widgetIds.filter((id) => id !== 'telemetryinspector').sort(),
      ];
      for (const [index, page] of pages.entries()) {
        phase = `settings page ${page}`;
        const row: SettingsPageRow = {
          page,
          heading: '',
          textLength: 0,
          controls: 0,
          badTokens: [],
          screenshots: [],
        };
        try {
          await session.evaluate(goToSettingsPage(page));
          await waitFor(
            async () => {
              const now = await readPage();
              return now.hash === `#/settings/${page}` && now.textLength > 0;
            },
            5000,
            250
          );
          await sleep(450);
          let now = await readPage();
          if (now.dialog) {
            await pressEscape();
            await sleep(400);
            now = await readPage();
          }
          row.heading = now.heading;
          row.textLength = now.textLength;
          row.controls = now.controls;
          row.badTokens = badTokens(now.text);
          const base = `${String(index + 1).padStart(2, '0')}-${safeName(page)}`;
          const first = path.join(settingsDir, `${base}.png`);
          if (await capture(session, first))
            row.screenshots.push(relative(first));
          // A long page is looked at to its end, a screen at a time.
          const screens = Math.min(3, Math.ceil(now.scrollable / 700));
          for (let screen = 1; screen <= screens; screen += 1) {
            await session.evaluate(scrollSettingsPage(screen));
            await sleep(250);
            const more = path.join(settingsDir, `${base}-${screen + 1}.png`);
            if (await capture(session, more))
              row.screenshots.push(relative(more));
          }
          if (now.hash !== `#/settings/${page}`) {
            row.problem = `the app went to ${now.hash} instead`;
          } else if (now.textLength < 20) {
            row.problem = 'the page is blank';
          } else if (/No settings available/i.test(now.text)) {
            row.problem = 'the page says it has no settings';
          } else if (row.badTokens.length > 0) {
            row.problem = `shows ${row.badTokens.join(', ')}`;
          }
        } catch (error) {
          row.problem = `could not be opened: ${error instanceof Error ? error.message : error}`;
        }
        result.settingsPages.push(row);
      }
      say(`${result.settingsPages.length} settings pages opened`);

      // What a user flips, and whether the overlay follows.
      phase = 'toggles';
      const overlayWindows = () => [
        ...windows.all('overlay'),
        ...windows.all('widget'),
      ];
      const onScreen = async (id: string): Promise<boolean> => {
        await windows.refresh();
        for (const window of overlayWindows()) {
          try {
            if (await window.session.evaluate<boolean>(hasWidgetBox(id)))
              return true;
          } catch {
            // A window that closed has no box.
          }
        }
        return false;
      };
      const firstOverlay = windows.first('overlay') ?? windows.first('widget');
      const readVisibility = () =>
        firstOverlay
          ? firstOverlay.session.evaluate<{
              boxes: number;
              hidden: boolean | null;
            }>(READ_OVERLAY_VISIBILITY)
          : Promise.resolve({ boxes: 0, hidden: null });

      const before = await readVisibility();
      if (before.boxes === 0 || before.hidden !== false) {
        result.toggles.push({
          name: 'overlay on/off switch',
          passed: false,
          detail: 'There was no visible widget on the overlay to watch.',
        });
      } else {
        const clicked = await session.evaluate<boolean>(
          click('button[aria-label="Overlay"]')
        );
        const off = await waitFor(
          async () => (await readVisibility()).hidden === true,
          6000
        );
        if (off && firstOverlay) {
          const file = path.join(shotsDir, 'toggles', 'overlay-off.png');
          if (await capture(firstOverlay.session, file)) {
            addWindowShot(firstOverlay.label, file);
          }
        }
        await session.evaluate(click('button[aria-label="Overlay"]'));
        const on = await waitFor(
          async () => (await readVisibility()).hidden === false,
          6000
        );
        result.toggles.push({
          name: 'overlay on/off switch',
          passed: Boolean(clicked && off && on),
          detail: !clicked
            ? 'The switch was not found in the settings header.'
            : `Off hid the overlay: ${off ? 'yes' : 'NO'}. On brought it back: ${on ? 'yes' : 'NO'}.`,
        });
      }

      const current = (await waitFor(readState, 10_000)) ?? state;
      const candidates = current.dashboard.widgets
        .filter((w) => w.enabled && (w.type ?? w.id) === w.id)
        .map((w) => w.id)
        .sort(
          (a, b) =>
            Number(b === 'relative') - Number(a === 'relative') ||
            Number(b === 'standings') - Number(a === 'standings')
        );
      let chosen: string | undefined;
      for (const id of candidates) {
        if (!(await onScreen(id))) continue;
        await session.evaluate(goToSettingsPage(id));
        await sleep(600);
        const was = await session.evaluate<string | null>(clickMenuSwitch(id));
        if (was === null) continue;
        chosen = id;
        const gone = await waitFor(async () => !(await onScreen(id)), 8000);
        await session.evaluate(clickMenuSwitch(id));
        const back = await waitFor(() => onScreen(id), 12_000);
        result.toggles.push({
          name: `widget ${id} off and on`,
          passed: Boolean(was === 'true' && gone && back),
          detail: `Off removed it from the overlay: ${gone ? 'yes' : 'NO'}. On brought it back: ${back ? 'yes' : 'NO'}.`,
        });
        break;
      }
      if (!chosen) {
        result.toggles.push({
          name: 'a widget off and on',
          passed: false,
          detail: 'No widget on the overlay had a switch in the settings menu.',
        });
      } else {
        const id = chosen;
        const configOf = async (): Promise<string> =>
          JSON.stringify(
            (await readState()).dashboard.widgets.find((w) => w.id === id)
              ?.config ?? {}
          );
        await session.evaluate(goToSettingsPage(id));
        await sleep(600);
        const original = await configOf();
        await windows.refresh();
        const watcher = windows.first('overlay') ?? windows.first('widget');
        const updatesBefore = watcher
          ? await watcher.session.evaluate<number>(WATCH_DASHBOARD_UPDATES)
          : 0;
        const flipped = await session.evaluate<{
          label: string;
          before: string;
        } | null>(CLICK_FIRST_PAGE_SWITCH);
        if (!flipped) {
          result.toggles.push({
            name: `a setting of ${id} changed and changed back`,
            passed: false,
            detail: 'The page has no on/off setting to flip.',
          });
        } else {
          const changed = await waitFor(
            async () => (await configOf()) !== original,
            6000
          );
          const told = watcher
            ? await waitFor(
                async () =>
                  (await watcher.session.evaluate<number>(
                    READ_DASHBOARD_UPDATES
                  )) > updatesBefore,
                6000
              )
            : false;
          await session.evaluate(CLICK_FIRST_PAGE_SWITCH);
          const restored = await waitFor(
            async () => (await configOf()) === original,
            6000
          );
          result.toggles.push({
            name: `setting "${flipped.label}" of ${id} changed and changed back`,
            passed: Boolean(changed && told && restored),
            detail: `Stored: ${changed ? 'yes' : 'NO'}. The overlay was sent the change: ${told ? 'yes' : 'NO'}. Changed back to what it was: ${restored ? 'yes' : 'NO'}.`,
          });
        }
      }
      await session
        .send('Emulation.clearDeviceMetricsOverride')
        .catch(() => undefined);
    }

    // Quit the way the tray's Quit does: the browser is asked to close, which
    // runs the app's own shutdown and its storage flush. (Closing the
    // settings window from its page destroys that window and nothing else.)
    phase = 'quit';
    clearInterval(refresher);
    refresher = undefined;
    const version: unknown = await (
      await fetch(`http://127.0.0.1:${port}/json/version`, {
        signal: AbortSignal.timeout(5000),
      })
    ).json();
    const browserUrl =
      typeof version === 'object' && version !== null
        ? (version as Record<string, unknown>).webSocketDebuggerUrl
        : undefined;
    if (typeof browserUrl !== 'string') {
      throw new Error(
        'the app gave no browser debugging address to quit it by'
      );
    }
    const browser = await CdpSession.connect(browserUrl);
    const quitStarted = Date.now();
    // The answer is the connection closing.
    browser.send('Browser.close', {}, 5000).catch(() => undefined);
    // Let go of every window, so nothing of this run holds the app open.
    await sleep(500);
    windows.closeAll();
    browser.close();
    const gone = await waitFor(async () => exited !== undefined, 60_000, 250);
    const seconds = (Date.now() - quitStarted) / 1000;
    say(
      gone
        ? `the app ended with exit code ${exited} after ${seconds.toFixed(1)}s`
        : 'the app did not end'
    );
    result.quit = gone
      ? {
          clean: exited === 0,
          detail: `Asked to quit, the process ended ${seconds.toFixed(1)}s later with exit code ${exited}.`,
        }
      : {
          clean: false,
          detail:
            'Asked to quit, the app was still running 60s later; it was killed.',
        };
    if (gone && seconds > 5) {
      result.notes.push(
        `the process took ${seconds.toFixed(1)}s to end after it was asked to quit (see "App quit" in main.log for when the app itself was done)`
      );
    }
  } catch (error) {
    result.fatal = error instanceof Error ? error.message : String(error);
    say(`stopped: ${result.fatal}`);
  } finally {
    if (refresher) clearInterval(refresher);
    windows.closeAll();
    stop();
    fs.closeSync(appOutput);
  }

  // Nothing of this run may be left running. A process of the app that
  // outlived it carries the profile folder only this run uses in Chromium's
  // own switch, which nothing else on the machine does (this tool's command
  // line names the folder under another switch).
  await sleep(1500);
  const ownSwitch = `--user-data-dir=${options.profileDir}`.toLowerCase();
  const leftovers = listProcesses().filter(
    (proc) =>
      proc.pid !== process.pid &&
      /^(tearoff|electron)(\.exe)?$/i.test(proc.name) &&
      proc.commandLine.replaceAll('"', '').toLowerCase().includes(ownSwitch)
  );
  for (const proc of leftovers) killTree(proc.pid);
  if (leftovers.length > 0) {
    const kinds = leftovers.map(
      (proc) =>
        `${proc.pid} ${/--type=([\w-]+)/.exec(proc.commandLine)?.[1] ?? 'main process'}`
    );
    result.notes.push(
      `${leftovers.length} process(es) of the app were still running after it ended and were killed by process id: ${kinds.join(', ')}`
    );
    await sleep(1000);
  }

  // The widgets, as the report lists them.
  if (state) {
    const disabled = new Set(state.disabledForSim);
    const logFile = path.join(options.profileDir, 'logs', 'main.log');
    const logText = fs.existsSync(logFile)
      ? fs.readFileSync(logFile, 'utf8')
      : '';
    result.widgets = state.dashboard.widgets
      .map((widget): WidgetRow => {
        const type = widget.type ?? widget.id;
        const config = widget.config ?? {};
        const errors = [
          ...new Set([
            ...result.problems
              .filter((p) => p.level === 'error' && p.widget === type)
              .map((p) => p.text.split('\n')[0]),
            ...logText
              .split(/\r?\n/)
              .filter((line) => line.includes(`[ErrorBoundary:widget:${type}]`))
              .map((line) => line.replace(/^\[[^\]]+\] \[\w+\]\s+/, '')),
          ]),
        ].slice(0, 4);
        const shots = captures.get(widget.id) ?? [];
        return {
          id: widget.id,
          type,
          enabled: widget.enabled,
          disabledForSim: disabled.has(type),
          ownWindow: type === 'gantry' || widget.placement === 'gantry',
          captures: shots,
          errors,
          hints: [
            ...(config.showOnlyWhenOnTrack === true
              ? ['set to show only on track']
              : []),
            ...(DRAWS_ONLY[type] && !shots.some((shot) => shot.drawn)
              ? [DRAWS_ONLY[type]]
              : []),
          ],
        };
      })
      .sort((a, b) => a.id.localeCompare(b.id));
  }
  result.windows = [...windowShots].map(([label, screenshots]) => ({
    label,
    screenshots,
  }));

  try {
    result.inspection = inspectProfile({
      profileDir: options.profileDir,
      scratch: path.join(options.outDir, 'inspect'),
      filesBefore,
      widgetsBefore,
      originalDb,
    });
  } catch (error) {
    result.notes.push(
      `the profile could not be inspected: ${error instanceof Error ? error.message : error}`
    );
  }

  if (realBefore) {
    const diff = compareTrees(realBefore, snapshotTree(options.realProfile));
    result.realProfile = {
      checked: true,
      path: options.realProfile,
      ...judgeRealProfile(
        diff,
        readAppendedLines(sharedLog, sharedLogSize),
        new Set(result.inspection?.log.lines ?? [])
      ),
    };
  }
  result.loginItems.after = tearoffLoginItems(readLoginItems()).map(
    ([name]) => name
  );
  result.finishedAt = new Date().toISOString();

  const verdict = judge(result);
  fs.writeFileSync(path.join(options.outDir, 'report.md'), buildReport(result));
  fs.writeFileSync(
    path.join(options.outDir, 'result.json'),
    JSON.stringify(
      {
        ...result,
        inspection: result.inspection && {
          ...result.inspection,
          log: { ...result.inspection.log, lines: undefined },
        },
        verdict,
      },
      null,
      2
    )
  );
  say(
    `${verdict.verdict}: ${verdict.blocking.length} blocking, ${verdict.attention.length} to look at`
  );
  for (const line of verdict.blocking) say(`  blocking: ${line}`);
  say(`report: ${path.join(options.outDir, 'report.md')}`);
  if (
    result.realProfile.touched.length > 0 ||
    result.realProfile.ownLinesInSharedLog.length > 0
  ) {
    process.stderr.write(
      '\nSTOP: the real profile changed during this run. Do not run again before finding out why.\n'
    );
    return 3;
  }
  return verdict.verdict === 'FAIL' ? 1 : 0;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    const text = error instanceof Error ? error.stack : String(error);
    process.stderr.write(`The smoke run failed: ${text}\n`);
    process.exitCode = 1;
  }
);
