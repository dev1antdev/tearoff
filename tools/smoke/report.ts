import type { PageProblem } from './errors.ts';
import type { RealProfileVerdict } from './guard.ts';
import type { ProfileInspection } from './inspect.ts';

/** What one capture of one widget found. */
export interface WidgetCapture {
  round: number;
  /** Whether anything was drawn in the box. */
  drawn: boolean;
  text: string;
  badTokens: string[];
  overflowX: number;
  overflowY: number;
  /** Cut by the window: the box is larger than what the display shows. */
  cut: boolean;
  screenshot?: string;
}

export type WidgetStatus =
  | 'rendered'
  | 'empty'
  | 'error'
  | 'missing'
  | 'off'
  | 'not for this simulator'
  | 'own window';

export interface WidgetRow {
  id: string;
  type: string;
  enabled: boolean;
  disabledForSim: boolean;
  ownWindow: boolean;
  captures: WidgetCapture[];
  /** Messages the windows or the log attribute to this widget. */
  errors: string[];
  /** Settings that explain an empty box, e.g. "shown only on track". */
  hints: string[];
}

/**
 * A widget's line in the report. An error wins over everything; a widget is
 * rendered when any capture drew something, since several only draw at
 * moments (a flag, a car alongside).
 */
export function widgetStatus(row: WidgetRow): WidgetStatus {
  if (row.disabledForSim) return 'not for this simulator';
  if (!row.enabled) return 'off';
  if (row.errors.length > 0) return 'error';
  if (row.ownWindow) return 'own window';
  if (row.captures.length === 0) return 'missing';
  return row.captures.some((capture) => capture.drawn) ? 'rendered' : 'empty';
}

export interface SettingsPageRow {
  page: string;
  heading: string;
  textLength: number;
  controls: number;
  badTokens: string[];
  /** Why the page counts as broken, when it does. */
  problem?: string;
  screenshots: string[];
}

export interface ToggleCheck {
  name: string;
  passed: boolean;
  detail: string;
}

export interface RunResult {
  runId: string;
  startedAt: string;
  finishedAt: string;
  gitHead: string;
  appVersion: string;
  target: string;
  executable: string;
  tape: string;
  speed: number;
  loop: boolean;
  profileMode: 'fresh' | 'copy';
  profileSource?: string;
  profileDir: string;
  simulator: string | null;
  display: string;
  layoutNote: string;
  /** Things the harness did to the profile or could not do. */
  notes: string[];
  /** Why the build under test is not the code in the checkout, if it is not. */
  staleBuild: string[];
  windows: { label: string; screenshots: string[] }[];
  widgets: WidgetRow[];
  settingsPages: SettingsPageRow[];
  toggles: ToggleCheck[];
  /** The built-in web server, asked as a browser source and as a stranger. */
  server: ToggleCheck[];
  problems: PageProblem[];
  quit: { clean: boolean; detail: string };
  inspection?: ProfileInspection;
  realProfile: RealProfileVerdict & { checked: boolean; path: string };
  loginItems: { before: string[]; after: string[] };
  /** Set when the run stopped early. */
  fatal?: string;
}

export interface Verdict {
  verdict: 'PASS' | 'ATTENTION' | 'FAIL';
  blocking: string[];
  attention: string[];
}

const plural = (count: number, word: string): string =>
  `${count} ${word}${count === 1 ? '' : 's'}`;

/** What stops a release, and what a person should look at before one. */
export function judge(result: RunResult): Verdict {
  const blocking: string[] = [];
  const attention: string[] = [];
  if (result.fatal) blocking.push(`the run did not finish: ${result.fatal}`);
  for (const reason of result.staleBuild) {
    blocking.push(`not the code in the checkout: ${reason}`);
  }
  if (result.realProfile.touched.length > 0) {
    blocking.push(
      `the real profile changed: ${result.realProfile.touched.join('; ')}`
    );
  }
  if (result.realProfile.ownLinesInSharedLog.length > 0) {
    blocking.push("this run wrote to the real profile's main.log");
  }
  if (!result.realProfile.checked) {
    attention.push('the real profile was not checked');
  }
  if (
    result.loginItems.after.join('|') !== result.loginItems.before.join('|')
  ) {
    blocking.push('the Windows start-up entry for Tearoff changed');
  }

  const byStatus = (status: WidgetStatus) =>
    result.widgets.filter((row) => widgetStatus(row) === status);
  const errored = byStatus('error');
  const missing = byStatus('missing');
  const empty = byStatus('empty');
  if (errored.length > 0) {
    blocking.push(
      `${plural(errored.length, 'widget')} with an error: ${errored.map((row) => row.id).join(', ')}`
    );
  }
  if (missing.length > 0) {
    blocking.push(
      `${plural(missing.length, 'widget')} switched on but never on screen: ${missing.map((row) => row.id).join(', ')}`
    );
  }
  if (empty.length > 0) {
    attention.push(
      `${plural(empty.length, 'widget')} drew nothing: ${empty.map((row) => row.id).join(', ')}`
    );
  }
  const tokens = result.widgets.filter((row) =>
    row.captures.some((capture) => capture.badTokens.length > 0)
  );
  if (tokens.length > 0) {
    blocking.push(
      `NaN / undefined shown by: ${tokens.map((row) => row.id).join(', ')}`
    );
  }
  const overflowing = result.widgets.filter((row) =>
    row.captures.some(
      (capture) => capture.overflowX > 4 || capture.overflowY > 4
    )
  );
  if (overflowing.length > 0) {
    attention.push(
      `content larger than the box: ${overflowing.map((row) => row.id).join(', ')}`
    );
  }

  const errors = result.problems.filter((problem) => problem.level === 'error');
  const warnings = result.problems.length - errors.length;
  const distinct = (list: readonly PageProblem[]) =>
    new Set(list.map((problem) => problem.text.slice(0, 200))).size;
  if (errors.length > 0) {
    blocking.push(
      `${plural(distinct(errors), 'different error')} in the app's windows (${errors.length} in all)`
    );
  }
  if (warnings > 0) {
    attention.push(
      `${plural(distinct(result.problems.filter((problem) => problem.level !== 'error')), 'different warning')} in the app's windows (${warnings} in all)`
    );
  }

  const brokenPages = result.settingsPages.filter((page) => page.problem);
  if (brokenPages.length > 0) {
    blocking.push(
      `settings pages with a problem: ${brokenPages.map((page) => page.page).join(', ')}`
    );
  }
  const failedToggles = result.toggles.filter((toggle) => !toggle.passed);
  if (failedToggles.length > 0) {
    blocking.push(
      `the overlay did not follow: ${failedToggles.map((toggle) => toggle.name).join(', ')}`
    );
  }
  const failedServer = result.server.filter((check) => !check.passed);
  if (failedServer.length > 0) {
    blocking.push(
      `the browser source server: ${failedServer.map((check) => check.name).join(', ')}`
    );
  }
  if (!result.quit.clean)
    blocking.push(`the app did not quit: ${result.quit.detail}`);

  const inspection = result.inspection;
  if (inspection) {
    const log = inspection.log.summary;
    if (!inspection.log.exists) blocking.push('the app wrote no main.log');
    if (log.errors.length > 0) {
      blocking.push(
        `${plural(log.errors.length, 'kind')} of error in main.log`
      );
    }
    if (log.warnings.length > 0) {
      attention.push(
        `${plural(log.warnings.length, 'kind')} of warning in main.log`
      );
    }
    if (!inspection.config.parsed) {
      blocking.push(`config.json does not parse: ${inspection.config.error}`);
    }
    const widgets = inspection.config.comparison;
    if (widgets) {
      if (widgets.lost.length > 0) {
        blocking.push(
          `widgets lost from config.json: ${widgets.lost.join(', ')}`
        );
      }
      if (widgets.enabledChanged.length > 0) {
        blocking.push(
          `widget switches changed: ${widgets.enabledChanged.join(', ')}`
        );
      }
      if (widgets.settingsChanged.length > 0) {
        attention.push(
          `settings the user had were changed in ${plural(widgets.settingsChanged.length, 'widget')}`
        );
      }
    }
    const library = inspection.lapLibrary;
    if (library.current.error) {
      blocking.push(`laps.db cannot be read: ${library.current.error}`);
    }
    if (library.current.integrity && library.current.integrity !== 'ok') {
      blocking.push(`laps.db fails its integrity check`);
    }
    if (library.backupMatchesOriginal && !library.backupMatchesOriginal.equal) {
      blocking.push('the lap library backup is not the library as it was');
    }
    if (library.rowsKept && !library.rowsKept.equal) {
      blocking.push('the lap library lost or changed rows in the upgrade');
    }
    if (
      library.original?.exists &&
      library.original.schemaVersion !== library.current.schemaVersion &&
      library.backups.length === 0
    ) {
      blocking.push('the lap library was upgraded without a backup');
    }
    for (const line of inspection.shouldNotBeThere) attention.push(line);
  }

  return {
    verdict:
      blocking.length > 0
        ? 'FAIL'
        : attention.length > 0
          ? 'ATTENTION'
          : 'PASS',
    blocking,
    attention,
  };
}

const cell = (text: string): string =>
  text.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

const short = (text: string, length: number): string =>
  text.length > length ? `${text.slice(0, length - 1)}...` : text;

function widgetNotes(row: WidgetRow): string {
  const notes: string[] = [];
  const drawn = row.captures.filter((capture) => capture.drawn).length;
  if (row.captures.length > 0) {
    notes.push(`drawn in ${drawn} of ${row.captures.length} captures`);
  }
  const tokens = new Set(row.captures.flatMap((capture) => capture.badTokens));
  if (tokens.size > 0) notes.push(`shows ${[...tokens].join(', ')}`);
  const overflow = Math.max(
    0,
    ...row.captures.map((c) => Math.max(c.overflowX, c.overflowY))
  );
  if (overflow > 4) notes.push(`content ${overflow}px larger than the box`);
  if (row.captures.some((capture) => capture.cut)) {
    notes.push('cut by the display');
  }
  notes.push(...row.hints, ...row.errors.map((error) => short(error, 160)));
  return notes.join('; ');
}

/** The report a person reads: what ran, what was seen, and the verdict. */
export function buildReport(result: RunResult): string {
  const verdict = judge(result);
  const lines: string[] = [];
  const add = (...text: string[]) => lines.push(...text);
  const counts = new Map<WidgetStatus, number>();
  for (const row of result.widgets) {
    const status = widgetStatus(row);
    counts.set(status, (counts.get(status) ?? 0) + 1);
  }

  add(
    `# Tearoff app smoke: ${result.runId}`,
    '',
    `**Verdict: ${verdict.verdict}** (${verdict.blocking.length} blocking, ${verdict.attention.length} to look at)`,
    ''
  );
  if (verdict.blocking.length > 0) {
    add('Blocking:', ...verdict.blocking.map((line) => `- ${line}`), '');
  }
  if (verdict.attention.length > 0) {
    add('To look at:', ...verdict.attention.map((line) => `- ${line}`), '');
  }

  add(
    '## What ran',
    '',
    `- Build: ${result.target} \`${result.executable}\`, version ${result.appVersion}, commit ${result.gitHead}`,
    `- Recording: \`${result.tape}\` at ${result.speed}x${result.loop ? ', looping' : ''}; simulator: ${result.simulator ?? 'none'}`,
    `- Profile: ${result.profileMode}${result.profileSource ? ` of \`${result.profileSource}\`` : ''} in \`${result.profileDir}\``,
    `- Display: ${result.display}. ${result.layoutNote}`,
    `- Started ${result.startedAt}, finished ${result.finishedAt}`,
    ...result.notes.map((note) => `- Note: ${note}`),
    ''
  );

  const real = result.realProfile;
  add(
    '## The real profile',
    '',
    real.checked
      ? real.touched.length === 0
        ? `\`${real.path}\`: no file was added, removed or changed${real.logChanged ? ', apart from `logs/main.log`' : ''}.`
        : `\`${real.path}\` CHANGED: ${real.touched.join('; ')}`
      : 'Not checked.',
    ...(real.logChanged
      ? [
          '',
          `\`logs/main.log\` there changed while the app ran. ${
            real.ownLinesInSharedLog.length === 0
              ? "None of the lines it gained is a line of this run's own log, so another process wrote them (spec runs on this machine append to it). The last of them:"
              : "It holds lines of this run's own log:"
          }`,
          '',
          '```',
          ...(real.ownLinesInSharedLog.length > 0
            ? real.ownLinesInSharedLog.slice(0, 6)
            : real.appendedSample),
          '```',
        ]
      : []),
    '',
    `Windows start-up entries naming Tearoff: before ${result.loginItems.before.length === 0 ? 'none' : result.loginItems.before.join(', ')}; after ${result.loginItems.after.length === 0 ? 'none' : result.loginItems.after.join(', ')}.`,
    ''
  );

  add(
    '## Widgets',
    '',
    [...counts].map(([status, count]) => `${count} ${status}`).join(', ') + '.',
    '',
    '| Widget | Status | Notes | Screenshot |',
    '| --- | --- | --- | --- |'
  );
  for (const row of result.widgets) {
    const shots = row.captures
      .filter((capture) => capture.screenshot)
      .map((capture) => `[${capture.round}](${capture.screenshot})`)
      .join(' ');
    const sample = row.captures.find((capture) => capture.text)?.text ?? '';
    add(
      `| ${cell(row.id)} | ${widgetStatus(row)} | ${cell(widgetNotes(row))}${sample ? ` <br>reads: "${cell(short(sample, 90))}"` : ''} | ${shots} |`
    );
  }
  add('');

  add('## Windows', '');
  for (const window of result.windows) {
    add(
      `- ${window.label}: ${window.screenshots.map((shot, index) => `[${index + 1}](${shot})`).join(' ')}`
    );
  }
  add('');

  add(
    '## Settings pages',
    '',
    `${result.settingsPages.length} pages opened, ${result.settingsPages.filter((page) => page.problem).length} with a problem.`,
    '',
    '| Page | Heading | Text | Controls | Problem | Screenshots |',
    '| --- | --- | --- | --- | --- | --- |'
  );
  for (const page of result.settingsPages) {
    add(
      `| ${cell(page.page)} | ${cell(page.heading)} | ${page.textLength} | ${page.controls} | ${cell(page.problem ?? '')} | ${page.screenshots.map((shot, index) => `[${index + 1}](${shot})`).join(' ')} |`
    );
  }
  add('');

  add('## What a user flips', '');
  for (const toggle of result.toggles) {
    add(
      `- ${toggle.passed ? 'ok' : 'FAILED'}: ${toggle.name}. ${toggle.detail}`
    );
  }
  if (result.toggles.length === 0) add('- Not run.');
  add('', '## Browser source server', '');
  for (const check of result.server) {
    add(`- ${check.passed ? 'ok' : 'FAILED'}: ${check.name}. ${check.detail}`);
  }
  if (result.server.length === 0) add('- Not run.');
  add(
    '',
    `Quit: ${result.quit.clean ? 'clean' : 'NOT clean'}. ${result.quit.detail}`,
    ''
  );

  add('## Errors and warnings in the windows', '');
  if (result.problems.length === 0) add('None.');
  const grouped = new Map<string, { problem: PageProblem; count: number }>();
  for (const problem of result.problems) {
    const key = `${problem.level}|${problem.kind}|${problem.widget ?? ''}|${problem.text.slice(0, 300)}`;
    const seen = grouped.get(key);
    if (seen) seen.count += 1;
    else grouped.set(key, { problem, count: 1 });
  }
  for (const { problem, count } of grouped.values()) {
    add(
      `- **${problem.level}** (${problem.source}${count > 1 ? `, ${count} times` : ''}) in ${problem.window}${problem.widget ? `, widget \`${problem.widget}\`` : ''}, during ${problem.phase}:`,
      '',
      '  ```',
      ...short(problem.text, 1500)
        .split('\n')
        .map((line) => `  ${line}`),
      '  ```'
    );
  }
  add('');

  const inspection = result.inspection;
  if (inspection) {
    const log = inspection.log.summary;
    add(
      '## The profile after the run',
      '',
      `### main.log (${log.entries} entries, \`${inspection.log.file}\`)`,
      ''
    );
    for (const [name, found] of Object.entries(log.evidence)) {
      add(`${name}:${found.length === 0 ? ' no such line' : ''}`);
      if (found.length > 0) add('', '```', ...found, '```');
      add('');
    }
    for (const [title, list] of [
      ['Errors', log.errors],
      ['Warnings', log.warnings],
    ] as const) {
      add(`${title}: ${list.length === 0 ? 'none' : ''}`, '');
      for (const line of list) {
        add(
          '```',
          `[${line.firstTime}] x${line.count} ${short(line.text, 900)}`,
          '```'
        );
      }
      add('');
    }

    const library = inspection.lapLibrary;
    const describe = (db: typeof library.current): string =>
      !db.exists
        ? 'not there'
        : db.error
          ? `unreadable: ${db.error}`
          : `schema ${db.schemaVersion}, integrity ${db.integrity}; ${db.tables.map((table) => `${table.name} ${table.rows}`).join(', ')}`;
    add(
      '### Lap library',
      '',
      `- \`laps.db\` now: ${describe(library.current)}`,
      ...(library.original
        ? [`- as it was before the run: ${describe(library.original)}`]
        : []),
      ...library.backups.map(
        (backup) => `- backup \`${backup.file}\`: ${describe(backup)}`
      ),
      ...(library.backups.length === 0 ? ['- no backup file beside it'] : []),
      ...(library.backupMatchesOriginal
        ? [
            `- backup against the library as it was: ${library.backupMatchesOriginal.equal ? 'the same tables, columns and rows' : library.backupMatchesOriginal.differences.join('; ')}`,
          ]
        : []),
      ...(library.rowsKept
        ? [
            `- rows the user had, in the upgraded library: ${library.rowsKept.equal ? 'all there, unchanged' : library.rowsKept.differences.join('; ')}`,
          ]
        : []),
      ''
    );

    const widgets = inspection.config.comparison;
    add(
      '### config.json',
      '',
      `- ${inspection.config.parsed ? 'parses' : `DOES NOT PARSE: ${inspection.config.error}`}; profiles: ${inspection.config.profiles.join(', ') || 'none'}`,
      ...(widgets
        ? [
            `- widgets before ${widgets.widgetsBefore}, after ${widgets.widgetsAfter}; lost: ${widgets.lost.join(', ') || 'none'}; added by this build: ${widgets.gained.length}`,
            `- switches changed: ${widgets.enabledChanged.join(', ') || 'none'}`,
            `- settings the user had that changed: ${widgets.settingsChanged.join(' / ') || 'none'}`,
          ]
        : []),
      ''
    );

    add('### Files the app wrote or changed', '');
    const written = inspection.files.filter((file) => file.state !== 'same');
    for (const file of written) {
      add(`- ${file.state}: \`${file.file}\` (${file.size} bytes)`);
    }
    if (written.length === 0) add('- none');
    add(
      '',
      `Track profiles: ${inspection.trackProfiles.length === 0 ? 'none' : inspection.trackProfiles.map((file) => `${file.name}${file.isNew ? ' (written in this run)' : ''}`).join(', ')}.`,
      `Should not be there: ${inspection.shouldNotBeThere.join('; ') || 'nothing'}.`,
      ''
    );
  }

  add(
    '## What this run cannot see',
    '',
    "It plays a recording: nobody drives, nothing is typed into the game, no real simulator is attached, and the recording is never the player's own session, so the app records no laps, stints or track profile from it. It looks at each widget at a few moments, not continuously, and it does not judge whether a number is right, only whether something is drawn and nothing failed.",
    ''
  );
  return lines.join('\n');
}
