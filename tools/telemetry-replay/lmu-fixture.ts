/**
 * Cuts a replay fixture out of a Le Mans Ultimate tape.
 *
 * A tape is hundreds of megabytes and needs the native replay addon; a fixture
 * is a few hundred kilobytes of JSON any spec can import, including the
 * renderer specs that run in jsdom. The frames are what the app itself would
 * have published: the tape goes through the same session and telemetry
 * mapping the LMU bridge runs, with the same state carried between frames.
 *
 *   npm run lmu:replay:fixture -- --input test-data/telemetry/lmu-session.lmudt \
 *     --output test-data/fixtures/lmu-race-laguna-seca.json \
 *     --name "LMU race, Laguna Seca" --from 200 --to 320 --hz 1
 *
 * `--from` and `--to` are session seconds. Windows only, like the addon.
 *
 * Run through tools/run-lmu-fixture.mjs rather than tsx: the LMU mapping
 * imports the types barrel, which needs Vite's module loader.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Session, Telemetry } from '@irdashies/types';
import { playLmuTape } from '../../src/testing/lmuTape';
import type { ReplayFixture } from '../../src/testing/replayFixture';

const round = (value: unknown): unknown =>
  typeof value === 'number' && Number.isFinite(value)
    ? Math.round(value * 1e5) / 1e5
    : value;

/** One telemetry frame as a fixture stores it: bare values, floats rounded. */
const fixtureFrame = (
  telemetry: Telemetry,
  keep: ReadonlySet<string> | null
): ReplayFixture['frames'][number] => {
  const frame: Record<string, unknown> = {};
  for (const [name, entry] of Object.entries(telemetry)) {
    if (keep && !keep.has(name)) continue;
    const value = (entry as { value?: unknown[] } | undefined)?.value;
    if (!Array.isArray(value)) continue;
    // An empty array says nothing a missing key does not.
    if (value.length === 0) continue;
    // A single value is stored bare and wrapped again on the way back in.
    frame[name] = value.length === 1 ? round(value[0]) : value.map(round);
  }
  return frame as ReplayFixture['frames'][number];
};

const argument = (
  args: readonly string[],
  name: string
): string | undefined => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
};

export const main = async (args: readonly string[]): Promise<number> => {
  const input = argument(args, 'input');
  const output = argument(args, 'output');
  if (!input || !output) {
    process.stderr.write(
      'usage: lmu-fixture --input <tape> --output <json> [--name <text>] ' +
        '[--from <s>] [--to <s>] [--hz <n>] [--keys <A,B,...>] [--as-session <n>]\n'
    );
    return 1;
  }
  const from = Number(argument(args, 'from') ?? Number.NEGATIVE_INFINITY);
  const to = Number(argument(args, 'to') ?? Number.POSITIVE_INFINITY);
  const hz = Number(argument(args, 'hz') ?? 1);
  const name = argument(args, 'name') ?? path.basename(output, '.json');
  const keys = argument(args, 'keys');
  const keep = keys ? new Set(keys.split(',').map((key) => key.trim())) : null;
  // LMU's session number is its type: 1 to 4 practice, 5 to 8 qualifying,
  // 10 and up a race. Replaying a race as another type shows what the same
  // cars and laps look like through that session's rules.
  const asSession = argument(args, 'as-session');

  const frames: ReplayFixture['frames'] = [];
  let session: Session | null = null;
  let nextAt = Number.NEGATIVE_INFINITY;
  let firstTime = Number.NaN;
  let lastTime = Number.NaN;
  const played = await playLmuTape({
    tapePath: input,
    transformRaw:
      asSession === undefined
        ? undefined
        : (raw) => ({ ...raw, session: Number(asSession) }),
    onFrame: (frame) => {
      if (frame.sessionTime > to) return false;
      if (frame.sessionTime < from) return;
      // The session at the end of the window is the one the fixture carries.
      session = frame.session;
      if (frame.sessionTime < nextAt) return;
      nextAt = frame.sessionTime + 1 / hz;
      if (Number.isNaN(firstTime)) firstTime = frame.sessionTime;
      lastTime = frame.sessionTime;
      frames.push(fixtureFrame(frame.telemetry, keep));
    },
  });
  if (!session || frames.length === 0) {
    process.stderr.write(
      `no frames between ${from} and ${to} (tape frames read: ${played.frames})\n`
    );
    return 1;
  }
  const mapped = session as Session;
  const fixture: ReplayFixture = {
    meta: {
      name,
      sessionNum: mapped.SessionInfo?.Sessions?.[0]?.SessionNum ?? 0,
      from: Math.round(firstTime * 1000) / 1000,
      to: Math.round(lastTime * 1000) / 1000,
      hz,
      frames: frames.length,
      // Only as anonymous as the tape it was cut from.
      anonymised: true,
    },
    weekend: {},
    sessions: [],
    drivers: [],
    session: mapped,
    frames,
  };
  const target = path.resolve(output);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(fixture)}\n`);
  process.stdout.write(
    `${output}: ${frames.length} frames, ${firstTime.toFixed(1)}s to ` +
      `${lastTime.toFixed(1)}s, ` +
      `${mapped.DriverInfo?.Drivers?.length ?? 0} drivers, ` +
      `${(fs.statSync(target).size / 1024).toFixed(0)} KB\n`
  );
  return 0;
};
