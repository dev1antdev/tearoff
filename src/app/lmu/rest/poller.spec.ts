import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createLmuRestPoller,
  type LmuRestResponse,
  type LmuRestTransport,
} from './poller';
import { createLmuRestData, type LmuRestData } from './state';
import { LMU_REST_TASKS, type LmuRestTask } from './tasks';
import {
  REST_MAX_INTERVAL_MS,
  REST_RETRY_DELAY_MS,
  REST_RETRY_LIMIT,
} from './constants';

const BASE_MS = 1000;

/** A repeating task whose parser we can watch, to prove parsing is skipped. */
const parseSpy = vi.fn((payload: unknown) =>
  typeof payload === 'object' && payload !== null
    ? (payload as { total?: number }).total
    : undefined
);
const applySpy = vi.fn((data: LmuRestData, value: unknown) => {
  data.cells.pitStopTime = { value: [value as number] };
});

const repeatTask: LmuRestTask = {
  id: 'repeat',
  path: '/rest/strategy/pitstop-estimate',
  mode: 'repeat',
  baseIntervalMs: BASE_MS,
  outputs: [
    {
      id: 'pitStopTime',
      target: 'telemetry',
      parse: parseSpy,
      apply: applySpy,
    },
  ],
};

const sessionTask: LmuRestTask = {
  id: 'once',
  path: '/rest/sessions',
  mode: 'once',
  baseIntervalMs: BASE_MS,
  outputs: [
    {
      id: 'timeScale',
      target: 'session',
      parse: (payload) =>
        typeof payload === 'object' && payload !== null
          ? (payload as { scale?: number }).scale
          : undefined,
      apply: (data, value) => {
        data.session.timeScale = value as number;
      },
    },
  ],
};

const ok = (body: string): LmuRestResponse => ({ ok: true, body });
const fail = (reason: 'refused' | 'timeout' | 'status'): LmuRestResponse => ({
  ok: false,
  reason,
});

/** Lets each test queue what the next request returns, per path. */
const makeTransport = (
  responder: (path: string) => LmuRestResponse
): { transport: LmuRestTransport; calls: string[] } => {
  const calls: string[] = [];
  return {
    calls,
    transport: (path) => {
      calls.push(path);
      return Promise.resolve(responder(path));
    },
  };
};

/**
 * Flushes the microtasks an awaited transport resolves through.
 *
 * Not enough on its own to start the first request: activation schedules it
 * with setTimeout(0), so a timer tick is needed too -- hence `advance(0)` after
 * setActive/beginSession rather than a bare settle.
 */
const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

const advance = async (ms: number) => {
  await vi.advanceTimersByTimeAsync(ms);
  await settle();
};

describe('createLmuRestPoller', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    parseSpy.mockClear();
    applySpy.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does nothing until activated', async () => {
    const { transport, calls } = makeTransport(() => ok('{"total":30}'));
    createLmuRestPoller({
      data: createLmuRestData(),
      transport,
      tasks: [repeatTask],
    });

    await advance(10_000);

    expect(calls).toEqual([]);
  });

  it('requests immediately on activation rather than after an interval', async () => {
    const data = createLmuRestData();
    const { transport, calls } = makeTransport(() => ok('{"total":30}'));
    const poller = createLmuRestPoller({
      data,
      transport,
      tasks: [repeatTask],
    });

    poller.setActive(true);
    await advance(0);

    expect(calls).toEqual(['/rest/strategy/pitstop-estimate']);
    expect(data.cells.pitStopTime?.value[0]).toBe(30);
  });

  it('skips parsing entirely when the body is unchanged', async () => {
    // The whole point of the hash compare: an unchanged payload must cost one
    // hash pass, not a JSON.parse and a run through every parser.
    const { transport } = makeTransport(() => ok('{"total":30}'));
    const poller = createLmuRestPoller({
      data: createLmuRestData(),
      transport,
      tasks: [repeatTask],
    });

    poller.setActive(true);
    await advance(0);
    expect(parseSpy).toHaveBeenCalledTimes(1);

    await advance(BASE_MS * 20);

    // Many more requests happened, but no further parsing.
    expect(parseSpy).toHaveBeenCalledTimes(1);
  });

  it('backs off geometrically while the body is unchanged, up to the cap', async () => {
    const { transport, calls } = makeTransport(() => ok('{"total":30}'));
    const poller = createLmuRestPoller({
      data: createLmuRestData(),
      transport,
      tasks: [repeatTask],
    });

    poller.setActive(true);
    await advance(0);
    expect(calls).toHaveLength(1);

    // 1000 -> 1500 -> 2250 -> 3375 -> 5000 (capped)
    await advance(1000);
    expect(calls).toHaveLength(2);
    await advance(1499);
    expect(calls).toHaveLength(2); // not due yet
    await advance(1);
    expect(calls).toHaveLength(3);
    await advance(2250);
    expect(calls).toHaveLength(4);
    await advance(3375);
    expect(calls).toHaveLength(5);

    // From here every further request is one cap-interval apart.
    await advance(REST_MAX_INTERVAL_MS);
    expect(calls).toHaveLength(6);
    await advance(REST_MAX_INTERVAL_MS - 1);
    expect(calls).toHaveLength(6);
  });

  it('returns to the base interval the moment the body changes', async () => {
    let total = 30;
    const { transport, calls } = makeTransport(() => ok(`{"total":${total}}`));
    const poller = createLmuRestPoller({
      data: createLmuRestData(),
      transport,
      tasks: [repeatTask],
    });

    poller.setActive(true);
    await advance(0);
    // Let it back off well past the base interval.
    await advance(1000);
    await advance(1500);
    await advance(2250);
    const backedOff = calls.length;

    total = 45;
    await advance(3375);
    expect(calls).toHaveLength(backedOff + 1);

    // Base interval again, not the backed-off one.
    await advance(BASE_MS);
    expect(calls).toHaveLength(backedOff + 2);
  });

  it('runs a one-shot task exactly once per session', async () => {
    const data = createLmuRestData();
    const { transport, calls } = makeTransport(() => ok('{"scale":6}'));
    const poller = createLmuRestPoller({
      data,
      transport,
      tasks: [sessionTask],
    });

    poller.setActive(true);
    await advance(0);
    await advance(60_000);

    expect(calls).toEqual(['/rest/sessions']);
    expect(data.session.timeScale).toBe(6);
  });

  it('bumps the revision for a session value but not a telemetry one', async () => {
    // This is what the bridge watches to force a session republish, so a
    // telemetry-only change must not trigger a full session rebuild.
    const data = createLmuRestData();
    const { transport } = makeTransport((path) =>
      path === '/rest/sessions' ? ok('{"scale":6}') : ok('{"total":30}')
    );
    const poller = createLmuRestPoller({
      data,
      transport,
      tasks: [repeatTask],
    });

    poller.setActive(true);
    await advance(0);
    expect(data.cells.pitStopTime?.value[0]).toBe(30);
    expect(data.revision).toBe(0);

    poller.stop();

    const sessionData = createLmuRestData();
    const sessionPoller = createLmuRestPoller({
      data: sessionData,
      transport,
      tasks: [sessionTask],
    });
    sessionPoller.setActive(true);
    await advance(0);

    expect(sessionData.revision).toBe(1);
  });

  it('retries a failing task, then gives up and logs once', async () => {
    const logger = { info: vi.fn(), warn: vi.fn() };
    // Timeout rather than refused: a refusal on a first request means the whole
    // API is absent, which is a different path.
    const { transport, calls } = makeTransport(() => fail('timeout'));
    const poller = createLmuRestPoller({
      data: createLmuRestData(),
      transport,
      logger,
      tasks: [repeatTask],
    });

    poller.setActive(true);
    await advance(0);
    for (let i = 0; i < REST_RETRY_LIMIT; i++) {
      await advance(REST_RETRY_DELAY_MS);
    }
    const afterGivingUp = calls.length;

    expect(afterGivingUp).toBe(REST_RETRY_LIMIT);
    expect(logger.warn).toHaveBeenCalledTimes(1);

    // Latched off: no further requests however long we wait.
    await advance(60_000);
    expect(calls).toHaveLength(afterGivingUp);
  });

  it('keeps asking a path that has answered, and only asks less often', async () => {
    // The refuel target and the pit estimate, mid-stint: three bad requests
    // used to lose them until the next session. A path that has answered is
    // there, so it is asked again, backed off, until it answers.
    const logger = { info: vi.fn(), warn: vi.fn() };
    let failing = false;
    let total = 30;
    const { transport, calls } = makeTransport(() =>
      failing ? fail('timeout') : ok(JSON.stringify({ total: (total += 1) }))
    );
    const data = createLmuRestData();
    const poller = createLmuRestPoller({
      data,
      transport,
      logger,
      tasks: [repeatTask],
    });

    poller.setActive(true);
    await advance(0);
    expect(data.cells.pitStopTime).toBeDefined();

    failing = true;
    const before = calls.length;
    await advance(10 * 60_000);
    const during = calls.length - before;
    // Never given up on, and never hammered: within ten minutes it is down
    // to one request per ceiling.
    expect(logger.warn).not.toHaveBeenCalled();
    expect(during).toBeGreaterThan(REST_RETRY_LIMIT);
    expect(during).toBeLessThan((10 * 60_000) / REST_MAX_INTERVAL_MS + 12);
    // What it last said stands through the gap.
    expect(data.cells.pitStopTime).toBeDefined();
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('is not answering (timeout)')
    );

    failing = false;
    await advance(REST_MAX_INTERVAL_MS);
    expect(logger.info).toHaveBeenCalledWith(
      '[lmuRest] /rest/strategy/pitstop-estimate is answering'
    );
  });

  it('still gives up on a path that stops answering in a new session', async () => {
    // Answered last session, never in this one: the menus, or a build
    // without it. A session's first three failures are still the limit.
    const logger = { info: vi.fn(), warn: vi.fn() };
    let failing = false;
    const { transport, calls } = makeTransport(() =>
      failing ? fail('timeout') : ok('{"total":30}')
    );
    const poller = createLmuRestPoller({
      data: createLmuRestData(),
      transport,
      logger,
      tasks: [repeatTask],
    });
    poller.setActive(true);
    await advance(0);

    failing = true;
    poller.beginSession();
    const before = calls.length;
    await advance(0);
    await advance(60_000);
    expect(calls.length - before).toBe(REST_RETRY_LIMIT);
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it('logs what an output reports, once per changed response', async () => {
    // A parser's report goes through the poller's logger, so parsers stay
    // free of IO; and only a body that changed is parsed at all, so an
    // answer repeated every poll is reported once.
    const logger = { info: vi.fn(), warn: vi.fn() };
    const reportingTask: LmuRestTask = {
      ...repeatTask,
      outputs: [
        {
          ...repeatTask.outputs[0],
          report: (value) => `total is ${String(value)}`,
        },
      ],
    };
    const { transport } = makeTransport(() => ok('{"total":7}'));
    const poller = createLmuRestPoller({
      data: createLmuRestData(),
      transport,
      logger,
      tasks: [reportingTask],
    });

    poller.setActive(true);
    await advance(0);
    await advance(REST_MAX_INTERVAL_MS * 3);

    expect(logger.info).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith('total is 7');
  });

  it('treats a refusal on the first request as the API being absent', async () => {
    // An older LMU has no REST API. That must cost one failed connect for the
    // whole poller, not three per task.
    const logger = { info: vi.fn(), warn: vi.fn() };
    const { transport, calls } = makeTransport(() => fail('refused'));
    const poller = createLmuRestPoller({
      data: createLmuRestData(),
      transport,
      logger,
      tasks: [repeatTask, sessionTask],
    });

    poller.setActive(true);
    await advance(0);
    const firstPass = calls.length;
    // Before the retry falls due, nothing more is attempted.
    await advance(20_000);

    expect(firstPass).toBeLessThanOrEqual(2);
    expect(calls).toHaveLength(firstPass);
    expect(logger.info).toHaveBeenCalledTimes(1);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('probes again a while after the API looked absent', async () => {
    // The latch used to hold for the life of the process, on the reasoning
    // that a build without a REST API will not grow one. But the API is a
    // server inside the sim, and its port need not be open at the moment the
    // app first reaches shared memory -- so one refusal during that window
    // turned every REST value off for the whole run.
    let refuse = true;
    const { transport, calls } = makeTransport(() =>
      refuse ? fail('refused') : ok('{"total":30}')
    );
    const data = createLmuRestData();
    const poller = createLmuRestPoller({
      data,
      transport,
      tasks: [repeatTask],
    });

    poller.setActive(true);
    await advance(0);
    const afterGivingUp = calls.length;

    refuse = false;
    // The latch lifts at 30s and the tasks then schedule at their own
    // interval, so the request lands just after the boundary.
    await advance(31_000);

    expect(calls.length).toBeGreaterThan(afterGivingUp);
    expect(data.cells.pitStopTime?.value[0]).toBe(30);
  });

  it('backs the retry off rather than probing a missing API forever', async () => {
    // An installation that really has no REST API should settle at the
    // occasional failed connect, not a steady drip.
    const { transport, calls } = makeTransport(() => fail('refused'));
    const poller = createLmuRestPoller({
      data: createLmuRestData(),
      transport,
      tasks: [repeatTask],
    });

    poller.setActive(true);
    await advance(0);
    await advance(31_000);
    const afterFirstRetry = calls.length;
    expect(afterFirstRetry).toBeGreaterThan(0);
    // The second wait is 60s, so a 30s window adds nothing.
    await advance(30_000);
    expect(calls).toHaveLength(afterFirstRetry);

    await advance(31_000);
    expect(calls.length).toBeGreaterThan(afterFirstRetry);
  });

  it('starts a fresh short probe on the next activation', async () => {
    const { transport, calls } = makeTransport(() => fail('refused'));
    const poller = createLmuRestPoller({
      data: createLmuRestData(),
      transport,
      tasks: [repeatTask],
    });

    poller.setActive(true);
    await advance(0);
    const probes = calls.length;

    poller.setActive(false);
    poller.setActive(true);
    await advance(0);

    expect(calls.length).toBeGreaterThan(probes);
  });

  it('discards a response that arrives after a reset', async () => {
    // Deactivating and reactivating while a request is outstanding used to
    // pass the stopped/active check, so the previous session's body was
    // applied into data that had just been cleared.
    let release: ((value: LmuRestResponse) => void) | undefined;
    const data = createLmuRestData();
    const poller = createLmuRestPoller({
      data,
      transport: () =>
        new Promise<LmuRestResponse>((resolve) => {
          release = resolve;
        }),
      tasks: [repeatTask],
    });

    poller.setActive(true);
    await advance(0);
    expect(release).toBeDefined();

    poller.setActive(false);
    poller.setActive(true);
    release?.(ok('{"total":30}'));
    await advance(0);

    expect(data.cells.pitStopTime?.value[0] ?? 0).toBe(0);
  });

  it('keeps polling after discarding a response from before a reset', async () => {
    // Discarding the stale response was only half of it. The reactivation
    // tried to start this task, found inFlight still true from the request
    // that was yet to settle, and scheduled nothing -- so the task then
    // polled nothing at all for the rest of the session.
    let release: ((value: LmuRestResponse) => void) | undefined;
    let served = 0;
    const data = createLmuRestData();
    const poller = createLmuRestPoller({
      data,
      transport: () => {
        served += 1;
        if (served === 1) {
          return new Promise<LmuRestResponse>((resolve) => {
            release = resolve;
          });
        }
        return Promise.resolve(ok('{"total":42}'));
      },
      tasks: [repeatTask],
    });

    poller.setActive(true);
    await advance(0);
    poller.setActive(false);
    poller.setActive(true);

    // The first request settles late. Its body is thrown away -- the test
    // above covers that -- and what matters here is that the task goes on to
    // poll again rather than falling silent.
    release?.(ok('{"total":30}'));
    await advance(1000);

    expect(served).toBeGreaterThan(1);
    expect(data.cells.pitStopTime?.value[0]).toBe(42);
  });

  it('clears the data and publishes the clear when deactivated', async () => {
    const data = createLmuRestData();
    const { transport } = makeTransport((path) =>
      path === '/rest/sessions' ? ok('{"scale":6}') : ok('{"total":30}')
    );
    const poller = createLmuRestPoller({
      data,
      transport,
      tasks: [repeatTask, sessionTask],
    });

    poller.setActive(true);
    await advance(0);
    expect(data.cells.pitStopTime).toBeDefined();
    const revisionWhenPopulated = data.revision;

    poller.setActive(false);

    expect(data.cells).toEqual({});
    expect(data.session).toEqual({});
    // A stale estimate left on screen reads as current, so the clear has to
    // reach the renderer too.
    expect(data.revision).toBeGreaterThan(revisionWhenPopulated);
  });

  it('stops requesting after stop()', async () => {
    const { transport, calls } = makeTransport(() => ok('{"total":30}'));
    const poller = createLmuRestPoller({
      data: createLmuRestData(),
      transport,
      tasks: [repeatTask],
    });

    poller.setActive(true);
    await advance(0);
    const before = calls.length;

    poller.stop();
    await advance(60_000);

    expect(calls).toHaveLength(before);
  });

  it('survives a transport that rejects instead of resolving', async () => {
    // The contract says resolve, but an unhandled rejection here would kill the
    // chain silently.
    const calls: string[] = [];
    const transport: LmuRestTransport = (path) => {
      calls.push(path);
      return Promise.reject(new Error('boom'));
    };
    const poller = createLmuRestPoller({
      data: createLmuRestData(),
      transport,
      tasks: [repeatTask],
    });

    poller.setActive(true);
    await advance(0);
    await advance(REST_RETRY_DELAY_MS);

    expect(calls.length).toBeGreaterThan(0);
    expect(() => poller.stop()).not.toThrow();
  });

  it('keeps a non-JSON body from being re-parsed every interval', async () => {
    const { transport } = makeTransport(() => ok('<html>nope</html>'));
    const poller = createLmuRestPoller({
      data: createLmuRestData(),
      transport,
      tasks: [repeatTask],
    });

    poller.setActive(true);
    await advance(0);
    await advance(BASE_MS * 10);

    // Never parsed successfully, so never applied -- and the hash is retained,
    // so the body is not decoded again.
    expect(applySpy).not.toHaveBeenCalled();
  });
});

describe('createLmuRestPoller with a pending source', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    parseSpy.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps retrying a pending path without spending a retry', async () => {
    // What a tape does early in playback: the path is real, the record has
    // simply not gone by yet. Three of these must not latch the task off.
    const { transport, calls } = makeTransport(() => ({
      ok: false,
      reason: 'pending' as const,
    }));
    const poller = createLmuRestPoller({
      data: createLmuRestData(),
      transport,
      tasks: [repeatTask],
    });

    poller.setActive(true);
    await advance(0);
    for (let i = 0; i < 10; i++) await advance(BASE_MS);

    // Still asking, well past the retry limit.
    expect(calls.length).toBeGreaterThan(REST_RETRY_LIMIT + 5);
  });

  it('retries a pending path at the base interval, not a backed-off one', async () => {
    const { transport, calls } = makeTransport(() => ({
      ok: false,
      reason: 'pending' as const,
    }));
    const poller = createLmuRestPoller({
      data: createLmuRestData(),
      transport,
      tasks: [repeatTask],
    });

    poller.setActive(true);
    await advance(0);
    const first = calls.length;

    await advance(BASE_MS);
    expect(calls).toHaveLength(first + 1);
    await advance(BASE_MS);
    expect(calls).toHaveLength(first + 2);
  });

  it('starts serving as soon as the tape produces a body', async () => {
    let body: string | null = null;
    const { transport } = makeTransport(() =>
      body === null
        ? { ok: false, reason: 'pending' as const }
        : { ok: true, body }
    );
    const data = createLmuRestData();
    const poller = createLmuRestPoller({
      data,
      transport,
      tasks: [repeatTask],
    });

    poller.setActive(true);
    await advance(0);
    expect(data.cells.pitStopTime).toBeUndefined();

    body = '{"total":41}';
    await advance(BASE_MS);

    expect(data.cells.pitStopTime?.value[0]).toBe(41);
  });

  it('does not make a task with a long interval wait it out for a tape', async () => {
    // The forecast is asked for twice a minute. Its first poll of a replay
    // goes out before the tape has reached the record, a few milliseconds
    // in, and waiting a base interval for the next left the replay without
    // a forecast for half a minute.
    let body: string | null = null;
    const { transport, calls } = makeTransport(() =>
      body === null
        ? { ok: false, reason: 'pending' as const }
        : { ok: true, body }
    );
    const data = createLmuRestData();
    const poller = createLmuRestPoller({
      data,
      transport,
      tasks: [{ ...repeatTask, baseIntervalMs: 30_000, maxIntervalMs: 60_000 }],
    });

    poller.setActive(true);
    await advance(0);
    expect(calls).toHaveLength(1);
    await advance(REST_RETRY_DELAY_MS);
    expect(calls).toHaveLength(2);

    body = '{"total":41}';
    await advance(REST_RETRY_DELAY_MS);
    expect(data.cells.pitStopTime?.value[0]).toBe(41);
    expect(calls).toHaveLength(3);

    // Once it has answered it keeps its own pace: the base interval after a
    // new body, then out to its own ceiling, which is above the shared one.
    await advance(29_999);
    expect(calls).toHaveLength(3);
    await advance(1);
    expect(calls).toHaveLength(4);
    await advance(45_000);
    expect(calls).toHaveLength(5);
    await advance(59_999);
    expect(calls).toHaveLength(5);
    await advance(1);
    expect(calls).toHaveLength(6);
    await advance(60_000);
    expect(calls).toHaveLength(7);
  });
});

/**
 * A path LMU answers only in some states -- the spectator camera, which is
 * not readable from the main menu.
 */
const OPTIONAL_MAX_MS = 2000;
const optionalTask: LmuRestTask = {
  id: 'optional',
  path: '/rest/watch/focus',
  mode: 'repeat',
  baseIntervalMs: BASE_MS,
  maxIntervalMs: OPTIONAL_MAX_MS,
  optional: true,
  outputs: [
    {
      id: 'focusCarIdx',
      target: 'telemetry',
      parse: (payload) => (typeof payload === 'number' ? payload : undefined),
      apply: (data, value) => {
        data.cells.focusCarIdx = { value: [value as number] };
      },
      clear: (data) => {
        delete data.cells.focusCarIdx;
      },
    },
  ],
};

describe('createLmuRestPoller with an optional task', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('never gives up on it, however long it has been failing', async () => {
    // The bug this exists for: the app activates the moment LMU is running,
    // which is the main menu, so three failures latched the spectator camera
    // off seconds after launch and it never polled again -- the feature was
    // dead by the time anyone opened the spectator view.
    const logger = { info: vi.fn(), warn: vi.fn() };
    const { transport, calls } = makeTransport(() => fail('status'));
    const poller = createLmuRestPoller({
      data: createLmuRestData(),
      transport,
      logger,
      tasks: [optionalTask],
    });

    poller.setActive(true);
    await advance(0);
    await advance(600_000);

    expect(calls.length).toBeGreaterThan(REST_RETRY_LIMIT);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('says so once, not once per probe', async () => {
    const logger = { info: vi.fn(), warn: vi.fn() };
    const { transport } = makeTransport(() => fail('status'));
    const poller = createLmuRestPoller({
      data: createLmuRestData(),
      transport,
      logger,
      tasks: [optionalTask],
    });

    poller.setActive(true);
    await advance(0);
    await advance(600_000);

    expect(logger.info).toHaveBeenCalledTimes(1);
  });

  it('picks it up the moment it starts answering', async () => {
    const logger = { info: vi.fn(), warn: vi.fn() };
    const data = createLmuRestData();
    let serving = false;
    const { transport } = makeTransport(() =>
      serving ? ok('8') : fail('status')
    );
    const poller = createLmuRestPoller({
      data,
      transport,
      logger,
      tasks: [optionalTask],
    });

    poller.setActive(true);
    await advance(0);
    await advance(600_000);
    expect(data.cells.focusCarIdx).toBeUndefined();

    // The viewer opens the spectator view.
    serving = true;
    await advance(OPTIONAL_MAX_MS * 2);

    expect(data.cells.focusCarIdx?.value[0]).toBe(8);
    // One line for the absence, one for the recovery.
    expect(logger.info).toHaveBeenCalledTimes(2);
  });

  it('backs off to its own ceiling, not the shared one', async () => {
    // Taking five seconds to follow the camera would read as not following
    // it, so this task's backoff stops sooner.
    const { transport, calls } = makeTransport(() => ok('8'));
    const poller = createLmuRestPoller({
      data: createLmuRestData(),
      transport,
      tasks: [optionalTask],
    });

    poller.setActive(true);
    await advance(0);
    // Long enough for an unchanged body to have backed off as far as it goes.
    await advance(REST_MAX_INTERVAL_MS * 10);
    const settled = calls.length;

    await advance(OPTIONAL_MAX_MS);
    expect(calls.length).toBeGreaterThan(settled);
  });

  it('still follows the camera after a spell of failures', async () => {
    const data = createLmuRestData();
    let slot: number | null = null;
    const { transport } = makeTransport(() =>
      slot === null ? fail('status') : ok(String(slot))
    );
    const poller = createLmuRestPoller({
      data,
      transport,
      tasks: [optionalTask],
    });

    poller.setActive(true);
    await advance(600_000);

    for (const watched of [8, 10, 13]) {
      slot = watched;
      await advance(OPTIONAL_MAX_MS * 2);
      expect(data.cells.focusCarIdx?.value[0]).toBe(watched);
    }
  });

  it('drops the last answer once it stops answering', async () => {
    // The viewer spectates car 7, then takes their own car: the path stops
    // answering, and car 7 must not stay focused while they drive.
    const data = createLmuRestData();
    let serving = true;
    const { transport } = makeTransport(() =>
      serving ? ok('7') : fail('status')
    );
    const poller = createLmuRestPoller({
      data,
      transport,
      tasks: [optionalTask],
    });

    poller.setActive(true);
    await advance(0);
    expect(data.cells.focusCarIdx?.value[0]).toBe(7);

    serving = false;
    await advance(OPTIONAL_MAX_MS * 2);
    expect(data.cells.focusCarIdx).toBeUndefined();

    // The same body as before it went quiet is still news.
    serving = true;
    await advance(OPTIONAL_MAX_MS * 2);
    expect(data.cells.focusCarIdx?.value[0]).toBe(7);
  });
});

/**
 * A session-targeted task whose body differs on every poll, as
 * `/rest/watch/standings` does -- it carries live positions.
 */
const movingBodyTask: LmuRestTask = {
  id: 'moving',
  path: '/rest/watch/standings',
  mode: 'repeat',
  baseIntervalMs: BASE_MS,
  outputs: [
    {
      id: 'teamNames',
      target: 'session',
      parse: (payload) =>
        typeof payload === 'object' && payload !== null
          ? (payload as { team?: string }).team
          : undefined,
      unchanged: (data, value) => data.session.teamNames?.[0] === value,
      apply: (data, value) => {
        data.session.teamNames = { 0: value as string };
      },
    },
  ],
};

describe('createLmuRestPoller and an output that reports no change', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not bump the revision when the value is unchanged', async () => {
    // The revision forces a full snapshot rebuild and a whole-object
    // broadcast. A body that moves every poll for reasons this output does
    // not read must not cost one each time.
    const data = createLmuRestData();
    let tick = 0;
    const { transport } = makeTransport(() =>
      // Same team, different body each time -- a position moving.
      ok(JSON.stringify({ team: 'Proton', position: (tick += 1) }))
    );
    const poller = createLmuRestPoller({
      data,
      transport,
      tasks: [movingBodyTask],
    });

    poller.setActive(true);
    await advance(0);
    const afterFirst = data.revision;
    expect(data.session.teamNames).toEqual({ 0: 'Proton' });

    await advance(BASE_MS * 10);
    expect(data.revision).toBe(afterFirst);
  });

  it('still bumps it when the value does change', async () => {
    const data = createLmuRestData();
    let team = 'Proton';
    const { transport } = makeTransport(() => ok(JSON.stringify({ team })));
    const poller = createLmuRestPoller({
      data,
      transport,
      tasks: [movingBodyTask],
    });

    poller.setActive(true);
    await advance(0);
    const afterFirst = data.revision;

    team = 'Vista AF Corse';
    await advance(BASE_MS * 2);

    expect(data.revision).toBeGreaterThan(afterFirst);
    expect(data.session.teamNames).toEqual({ 0: 'Vista AF Corse' });
  });

  it('leaves an output with no predicate counting as a change', async () => {
    // Every existing output has none, and must behave exactly as before.
    const data = createLmuRestData();
    let scale = 1;
    const { transport } = makeTransport(() =>
      ok(JSON.stringify({ scale: (scale += 1) }))
    );
    const poller = createLmuRestPoller({
      data,
      transport,
      tasks: [{ ...sessionTask, mode: 'repeat' }],
    });

    poller.setActive(true);
    await advance(0);
    const afterFirst = data.revision;

    await advance(BASE_MS * 2);
    expect(data.revision).toBeGreaterThan(afterFirst);
  });
});

/**
 * The teams payload, polled only in bursts the bridge starts: two seconds
 * apart, for at most sixteen.
 */
const BURST_INTERVAL_MS = 2000;
const BURST_MS = 16_000;
const burstTask: LmuRestTask = {
  id: 'burst',
  path: '/rest/multiplayer/teams',
  mode: 'burst',
  baseIntervalMs: BURST_INTERVAL_MS,
  burstMs: BURST_MS,
  outputs: [
    {
      id: 'nationalities',
      target: 'session',
      parse: (payload) =>
        typeof payload === 'object' && payload !== null
          ? (payload as { codes?: Record<string, string> }).codes
          : undefined,
      apply: (data, value) => {
        data.session.nationalities = value as Record<string, string>;
      },
    },
  ],
};

describe('createLmuRestPoller with a burst task', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const setup = (responder: (path: string) => LmuRestResponse) => {
    const logger = { info: vi.fn(), warn: vi.fn() };
    const { transport, calls } = makeTransport(responder);
    const data = createLmuRestData();
    const poller = createLmuRestPoller({
      data,
      transport,
      logger,
      tasks: [burstTask],
    });
    return { poller, calls, data, logger };
  };

  it('never polls on its own, only after a burst is asked for', async () => {
    const { poller, calls } = setup(() => ok('{"codes":{"A":"FR"}}'));

    poller.setActive(true);
    await advance(60_000);

    expect(calls).toEqual([]);
  });

  it('waits the delay, then polls until the check passes', async () => {
    let body = '{"codes":{"A":"FR"}}';
    const { poller, calls, data, logger } = setup(() => ok(body));
    poller.setActive(true);
    await advance(0);

    poller.burst('burst', {
      delayMs: 1000,
      isComplete: () => data.session.nationalities?.B !== undefined,
    });
    await advance(999);
    expect(calls).toHaveLength(0);
    await advance(1);
    expect(calls).toHaveLength(1);

    await advance(BURST_INTERVAL_MS);
    expect(calls).toHaveLength(2);

    body = '{"codes":{"A":"FR","B":"DE"}}';
    await advance(BURST_INTERVAL_MS);
    expect(calls).toHaveLength(3);
    expect(data.session.nationalities).toEqual({ A: 'FR', B: 'DE' });

    await advance(BURST_MS);
    expect(calls).toHaveLength(3);
    expect(logger.info).toHaveBeenCalledWith(
      '[lmuRest] /rest/multiplayer/teams: complete after 3 polls, 4.0s'
    );
  });

  it('gives up once the burst has run its length', async () => {
    const { poller, calls, logger } = setup(() => ok('{"codes":{"A":"FR"}}'));
    poller.setActive(true);
    await advance(0);

    poller.burst('burst', { delayMs: 1000, isComplete: () => false });
    await advance(1000 + BURST_MS + 60_000);

    // A poll at 0, 2, ... 16 s after the first: none past the end.
    expect(calls).toHaveLength(BURST_MS / BURST_INTERVAL_MS + 1);
    expect(logger.info).toHaveBeenCalledWith(
      '[lmuRest] /rest/multiplayer/teams: stopped incomplete after 9 polls, 16.0s'
    );
  });

  it('starts over, delay and length, when asked again', async () => {
    const { poller, calls } = setup(() => ok('{"codes":{"A":"FR"}}'));
    poller.setActive(true);
    await advance(0);

    poller.burst('burst', { delayMs: 1000, isComplete: () => false });
    await advance(500);
    // A second driver arriving before the first poll pushes it back.
    poller.burst('burst', { delayMs: 1000, isComplete: () => false });
    await advance(999);
    expect(calls).toHaveLength(0);
    await advance(1);
    expect(calls).toHaveLength(1);

    // Twelve seconds in, another arrival buys a fresh sixteen.
    await advance(12_000);
    poller.burst('burst', { delayMs: 1000, isComplete: () => false });
    const before = calls.length;
    await advance(1000 + BURST_MS + 60_000);

    expect(calls.length - before).toBe(BURST_MS / BURST_INTERVAL_MS + 1);
  });

  it('rides out failures inside a burst without latching the task off', async () => {
    let answer: LmuRestResponse = fail('status');
    const { poller, calls, data, logger } = setup(() => answer);
    poller.setActive(true);
    await advance(0);

    poller.burst('burst', { delayMs: 0, isComplete: () => false });
    await advance(BURST_MS + 60_000);
    expect(calls.length).toBeGreaterThan(REST_RETRY_LIMIT);
    expect(logger.warn).not.toHaveBeenCalled();

    // The next burst still runs.
    answer = ok('{"codes":{"A":"FR"}}');
    poller.burst('burst', {
      delayMs: 0,
      isComplete: () => data.session.nationalities?.A !== undefined,
    });
    await advance(0);
    expect(data.session.nationalities).toEqual({ A: 'FR' });
  });

  it('waits on a pending source, then gives the burst its full length', async () => {
    // A tape whose first teams record comes late. Spending the window on the
    // wait ended the burst before the record it was started for.
    let pending = true;
    const { poller, calls, logger } = setup(() =>
      pending ? { ok: false, reason: 'pending' } : ok('{"codes":{"A":"FR"}}')
    );
    poller.setActive(true);
    await advance(0);

    poller.burst('burst', { delayMs: 0, isComplete: () => false });
    await advance(40_000);
    const waited = calls.length;
    expect(waited).toBe(40_000 / BURST_INTERVAL_MS + 1);

    pending = false;
    await advance(BURST_MS + 60_000);

    expect(calls.length - waited).toBe(BURST_MS / BURST_INTERVAL_MS + 1);
    expect(logger.info).toHaveBeenCalledWith(
      '[lmuRest] /rest/multiplayer/teams: stopped incomplete after 9 polls, 16.0s'
    );
  });

  it('drops a burst when deactivated', async () => {
    const { poller, calls } = setup(() => ok('{"codes":{"A":"FR"}}'));
    poller.setActive(true);
    await advance(0);
    poller.burst('burst', { delayMs: 1000, isComplete: () => false });

    poller.setActive(false);
    poller.setActive(true);
    await advance(60_000);

    expect(calls).toEqual([]);
  });

  it('ignores a burst asked of a task that is not one', async () => {
    const { transport, calls } = makeTransport(() => ok('{"total":30}'));
    const poller = createLmuRestPoller({
      data: createLmuRestData(),
      transport,
      tasks: [sessionTask],
    });
    poller.setActive(true);
    await advance(0);
    const afterActivation = calls.length;

    poller.burst('once', { delayMs: 0, isComplete: () => false });
    await advance(60_000);

    expect(calls.length).toBe(afterActivation);
  });
});

describe('createLmuRestPoller and a report that compares', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('hands a report what its output parsed last', async () => {
    const report = vi.fn<
      (value: unknown, previous: unknown) => string | undefined
    >(() => undefined);
    const comparingTask: LmuRestTask = {
      ...repeatTask,
      outputs: [{ ...repeatTask.outputs[0], report }],
    };
    let total = 7;
    const { transport } = makeTransport(() => ok(`{"total":${total}}`));
    const poller = createLmuRestPoller({
      data: createLmuRestData(),
      transport,
      tasks: [comparingTask],
    });

    poller.setActive(true);
    await advance(0);
    total = 8;
    await advance(BASE_MS);

    expect(report.mock.calls).toEqual([
      [7, undefined],
      [8, 7],
    ]);

    // A new activation starts the history over.
    poller.setActive(false);
    poller.setActive(true);
    await advance(0);
    expect(report).toHaveBeenLastCalledWith(8, undefined);
  });
});

describe('createLmuRestPoller and a failure that is an answer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** GetGameState: a 404 says "not in a game", and polling goes on. */
  const stateTask: LmuRestTask = {
    id: 'state',
    path: '/rest/sessions/GetGameState',
    mode: 'repeat',
    baseIntervalMs: BASE_MS,
    maxIntervalMs: BASE_MS,
    optional: true,
    answerFailure: (data, failure) => {
      if (failure.status !== 404) return false;
      data.gameState = 'notInGame';
      return true;
    },
    outputs: [
      {
        id: 'gameState',
        target: 'telemetry',
        parse: (payload) =>
          typeof payload === 'object' && payload !== null
            ? (payload as { MultiStintState?: string }).MultiStintState ===
              'DRIVING'
              ? 'driving'
              : undefined
            : undefined,
        apply: (data, value) => {
          data.gameState = value as 'driving';
        },
        clear: (data) => {
          data.gameState = undefined;
        },
      },
    ],
  };

  it('reads it, keeps polling at the base rate, and reports nothing absent', async () => {
    let answer: LmuRestResponse = ok('{"MultiStintState":"DRIVING"}');
    const logger = { info: vi.fn(), warn: vi.fn() };
    const { transport, calls } = makeTransport(() => answer);
    const data = createLmuRestData();
    const poller = createLmuRestPoller({
      data,
      transport,
      logger,
      tasks: [stateTask],
    });

    poller.setActive(true);
    await advance(0);
    expect(data.gameState).toBe('driving');

    answer = { ok: false, reason: 'status', status: 404, body: '' };
    await advance(BASE_MS);
    expect(data.gameState).toBe('notInGame');

    const before = calls.length;
    await advance(BASE_MS * 10);
    expect(calls.length - before).toBe(10);
    expect(logger.info).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('reads the same body again once the failure has passed', async () => {
    // The hash would otherwise skip it as unchanged, leaving the failure's
    // reading in place after the sim was back in the car.
    let answer: LmuRestResponse = ok('{"MultiStintState":"DRIVING"}');
    const { transport } = makeTransport(() => answer);
    const data = createLmuRestData();
    const poller = createLmuRestPoller({
      data,
      transport,
      tasks: [stateTask],
    });

    poller.setActive(true);
    await advance(0);
    answer = { ok: false, reason: 'status', status: 404 };
    await advance(BASE_MS);
    expect(data.gameState).toBe('notInGame');

    answer = ok('{"MultiStintState":"DRIVING"}');
    await advance(BASE_MS);
    expect(data.gameState).toBe('driving');
  });

  it('falls back to clearing on a failure that is not an answer', async () => {
    let answer: LmuRestResponse = ok('{"MultiStintState":"DRIVING"}');
    const { transport } = makeTransport(() => answer);
    const data = createLmuRestData();
    const poller = createLmuRestPoller({
      data,
      transport,
      tasks: [stateTask],
    });

    poller.setActive(true);
    await advance(0);
    answer = fail('timeout');
    await advance(BASE_MS);

    expect(data.gameState).toBeUndefined();
  });

  it('does not take a refusal after an answer for an absent API', async () => {
    // The 404 drops the task's hash so the next body is read afresh. Read off
    // that hash, one reset socket -- which the transport reports as refused
    // -- latched every task off as if there were no API at all.
    let answer: LmuRestResponse = {
      ok: false,
      reason: 'status',
      status: 404,
      body: '',
    };
    const logger = { info: vi.fn(), warn: vi.fn() };
    const { transport, calls } = makeTransport((path) =>
      path === stateTask.path ? answer : ok('{"total":30}')
    );
    const data = createLmuRestData();
    const poller = createLmuRestPoller({
      data,
      transport,
      logger,
      tasks: [stateTask, repeatTask],
    });

    poller.setActive(true);
    await advance(0);
    expect(data.gameState).toBe('notInGame');

    answer = fail('refused');
    await advance(BASE_MS);
    const estimates = calls.filter((path) => path === repeatTask.path).length;
    await advance(BASE_MS * 10);

    expect(logger.info).not.toHaveBeenCalledWith(
      expect.stringContaining('No REST API')
    );
    // The other task polls on, and the state goes through the optional path.
    expect(
      calls.filter((path) => path === repeatTask.path).length
    ).toBeGreaterThan(estimates);
    expect(data.gameState).toBeUndefined();
  });

  it('holds the last answer through the misses it is allowed', async () => {
    let answer: LmuRestResponse = ok('{"MultiStintState":"DRIVING"}');
    const logger = { info: vi.fn(), warn: vi.fn() };
    const { transport } = makeTransport(() => answer);
    const data = createLmuRestData();
    const poller = createLmuRestPoller({
      data,
      transport,
      logger,
      tasks: [{ ...stateTask, clearAfterFailures: 3 }],
    });

    poller.setActive(true);
    await advance(0);
    answer = fail('timeout');
    await advance(BASE_MS);
    await advance(BASE_MS);
    expect(data.gameState).toBe('driving');
    expect(logger.info).not.toHaveBeenCalled();

    await advance(BASE_MS);
    expect(data.gameState).toBeUndefined();
    expect(logger.info).toHaveBeenCalledTimes(1);

    // An answer starts the count over.
    answer = ok('{"MultiStintState":"DRIVING"}');
    await advance(BASE_MS);
    answer = fail('timeout');
    await advance(BASE_MS);
    expect(data.gameState).toBe('driving');
  });

  it('hands the outputs a body that is not JSON, as nothing', async () => {
    // So GetGameState drops the last state rather than holding it through an
    // answer it cannot read.
    const gameState = LMU_REST_TASKS.find((task) => task.id === 'game-state');
    if (!gameState) throw new Error('no game-state task');
    let answer: LmuRestResponse = ok('{"MultiStintState":"DRIVING"}');
    const logger = { info: vi.fn(), warn: vi.fn() };
    const { transport } = makeTransport(() => answer);
    const data = createLmuRestData();
    const poller = createLmuRestPoller({
      data,
      transport,
      logger,
      tasks: [gameState],
    });

    poller.setActive(true);
    await advance(0);
    expect(data.gameState).toBe('driving');

    answer = ok('<html>loading</html>');
    await advance(BASE_MS);
    expect(data.gameState).toBeUndefined();
    expect(logger.info).toHaveBeenCalledWith(
      '[lmuRest] Unrecognised GetGameState answer that is not JSON; ' +
        'reading in-car and in-session from shared memory'
    );
  });
});

const HOUR_MS = 3_600_000;

/**
 * LMU stays open across sessions for hours, so the activation is not the
 * session: the bridge says when one begins and when the player arrives in it.
 */
describe('createLmuRestPoller across sessions', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    parseSpy.mockClear();
    applySpy.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const estimates = (calls: string[]) =>
    calls.filter((path) => path === repeatTask.path);
  const sessions = (calls: string[]) =>
    calls.filter((path) => path === sessionTask.path);

  it('asks a path that gave up in the menus again when a session begins', async () => {
    // The bug this exists for. The pit-stop estimate fails while the player
    // is in the menus, three failures latched it off, and the latch held
    // until LMU closed -- so the practice, the qualifying and the eight-hour
    // race that followed never saw an estimate.
    const logger = { info: vi.fn(), warn: vi.fn() };
    const data = createLmuRestData();
    let inSession = false;
    const { transport, calls } = makeTransport(() =>
      inSession ? ok('{"total":30}') : fail('status')
    );
    const poller = createLmuRestPoller({
      data,
      transport,
      logger,
      tasks: [repeatTask],
    });

    poller.setActive(true);
    await advance(HOUR_MS);
    expect(calls).toHaveLength(REST_RETRY_LIMIT);
    expect(logger.warn).toHaveBeenCalledWith(
      '[lmuRest] Giving up on /rest/strategy/pitstop-estimate after 3 failures (status); ' +
        'asking again when a session begins'
    );

    inSession = true;
    poller.beginSession();
    await advance(0);

    expect(calls).toHaveLength(REST_RETRY_LIMIT + 1);
    expect(data.cells.pitStopTime?.value[0]).toBe(30);
    // So the log says it came back, not only that it went.
    expect(logger.info).toHaveBeenCalledWith(
      '[lmuRest] /rest/strategy/pitstop-estimate is answering'
    );

    // And it is polling again, not answered once.
    await advance(BASE_MS);
    expect(calls).toHaveLength(REST_RETRY_LIMIT + 2);
  });

  it('asks it again when the player arrives in a session, and touches nothing else', async () => {
    // A session change can come while the session is still loading, and the
    // retries it hands back are then spent on the same loading screen. The
    // player arriving is the second chance -- and only that: the session may
    // be the one the values on screen already describe.
    const data = createLmuRestData();
    let loading = true;
    const { transport, calls } = makeTransport((path) => {
      if (path === sessionTask.path) return ok('{"scale":6}');
      return loading ? fail('timeout') : ok('{"total":30}');
    });
    const poller = createLmuRestPoller({
      data,
      transport,
      tasks: [repeatTask, sessionTask],
    });

    poller.setActive(true);
    await advance(HOUR_MS);
    expect(estimates(calls)).toHaveLength(REST_RETRY_LIMIT);
    const revision = data.revision;

    loading = false;
    poller.retryGivenUp();
    await advance(0);

    expect(estimates(calls)).toHaveLength(REST_RETRY_LIMIT + 1);
    expect(data.cells.pitStopTime?.value[0]).toBe(30);
    // The task that had not given up is not asked again, and what it said is
    // still there.
    expect(sessions(calls)).toHaveLength(1);
    expect(data.session.timeScale).toBe(6);
    expect(data.revision).toBe(revision);
  });

  it('still gives up for good inside one session on a path that keeps failing', async () => {
    // What giving up is for: an endpoint this build of LMU does not have. A
    // new session, or the player arriving in one, buys it three more requests
    // -- not a poll that never stops.
    const logger = { info: vi.fn(), warn: vi.fn() };
    const { transport, calls } = makeTransport(() => fail('status'));
    const poller = createLmuRestPoller({
      data: createLmuRestData(),
      transport,
      logger,
      tasks: [repeatTask],
    });

    poller.setActive(true);
    await advance(HOUR_MS);
    expect(calls).toHaveLength(REST_RETRY_LIMIT);

    poller.beginSession();
    await advance(8 * HOUR_MS);
    expect(calls).toHaveLength(REST_RETRY_LIMIT * 2);

    poller.retryGivenUp();
    await advance(8 * HOUR_MS);
    expect(calls).toHaveLength(REST_RETRY_LIMIT * 3);

    expect(logger.warn).toHaveBeenCalledTimes(3);
    expect(logger.info).not.toHaveBeenCalled();
  });

  it('asks nothing of anyone when no task has given up', async () => {
    const data = createLmuRestData();
    const { transport, calls } = makeTransport(() => ok('{"total":30}'));
    const poller = createLmuRestPoller({
      data,
      transport,
      tasks: [repeatTask],
    });

    poller.setActive(true);
    await advance(0);
    expect(calls).toHaveLength(1);

    poller.retryGivenUp();
    await advance(BASE_MS - 1);

    // Not due until its own interval, and what it said is untouched.
    expect(calls).toHaveLength(1);
    expect(data.cells.pitStopTime?.value[0]).toBe(30);
  });

  it('forgets what the last session said when a session begins', async () => {
    // A parser that finds nothing leaves the value it would have written
    // alone, so a value the next session's answers do not carry outlived the
    // session it described: the tank of the car before, published as this
    // one's.
    const data = createLmuRestData();
    let estimate = '{"total":30}';
    let settings = '{"scale":6}';
    const { transport } = makeTransport((path) =>
      path === sessionTask.path ? ok(settings) : ok(estimate)
    );
    const poller = createLmuRestPoller({
      data,
      transport,
      tasks: [repeatTask, sessionTask],
    });

    poller.setActive(true);
    await advance(0);
    expect(data.cells.pitStopTime?.value[0]).toBe(30);
    expect(data.session.timeScale).toBe(6);
    const revision = data.revision;
    const lastCells = data.cells;
    const lastSession = data.session;

    estimate = '{}';
    settings = '{}';
    poller.beginSession();

    // At once, not when the next answer lands.
    expect(data.cells.pitStopTime).toBeUndefined();
    expect(data.session.timeScale).toBeUndefined();
    // The clear has to reach the renderer too.
    expect(data.revision).toBeGreaterThan(revision);
    // Replaced, never emptied: a frame built from the old cells keeps them.
    expect(lastCells.pitStopTime?.value[0]).toBe(30);
    expect(lastSession.timeScale).toBe(6);

    await advance(BASE_MS * 5);
    expect(data.cells.pitStopTime).toBeUndefined();
    expect(data.session.timeScale).toBeUndefined();
  });

  it('does not leave them standing when the path fails in the new session', async () => {
    // The other way a value outlived its session: nothing answered to
    // replace it. The estimate from a practice was still on screen in the
    // race, in a different car.
    const data = createLmuRestData();
    let answering = true;
    const { transport, calls } = makeTransport(() =>
      answering ? ok('{"total":30}') : fail('timeout')
    );
    const poller = createLmuRestPoller({
      data,
      transport,
      tasks: [repeatTask],
    });

    poller.setActive(true);
    await advance(0);
    expect(data.cells.pitStopTime?.value[0]).toBe(30);

    answering = false;
    poller.beginSession();
    await advance(HOUR_MS);

    expect(data.cells.pitStopTime).toBeUndefined();
    expect(calls).toHaveLength(1 + REST_RETRY_LIMIT);
  });

  it('reads an answer again when it is identical to the one before', async () => {
    // The hash would skip it as unchanged, and the value forgotten with the
    // session would never come back.
    const data = createLmuRestData();
    const { transport } = makeTransport(() => ok('{"total":30}'));
    const poller = createLmuRestPoller({
      data,
      transport,
      tasks: [repeatTask],
    });

    poller.setActive(true);
    await advance(0);

    poller.beginSession();
    expect(data.cells.pitStopTime).toBeUndefined();
    await advance(0);

    expect(data.cells.pitStopTime?.value[0]).toBe(30);
  });

  it('throws away an answer that was on its way when the session changed', async () => {
    // Sent before the change, so it may describe the car before -- and the
    // new session's own answer need not carry anything to replace it.
    let release: ((value: LmuRestResponse) => void) | undefined;
    let served = 0;
    const data = createLmuRestData();
    const poller = createLmuRestPoller({
      data,
      transport: () => {
        served += 1;
        if (served === 1) {
          return new Promise<LmuRestResponse>((resolve) => {
            release = resolve;
          });
        }
        return Promise.resolve(ok('{}'));
      },
      tasks: [repeatTask],
    });

    poller.setActive(true);
    await advance(0);
    expect(release).toBeDefined();

    poller.beginSession();
    release?.(ok('{"total":30}'));
    await advance(BASE_MS - 1);

    expect(data.cells.pitStopTime).toBeUndefined();
    // Asked again at once rather than a full interval later.
    expect(served).toBe(2);
  });

  it('runs the one-shot tasks again, once', async () => {
    const { transport, calls } = makeTransport((path) =>
      path === sessionTask.path ? ok('{"scale":6}') : ok('{"total":30}')
    );
    const poller = createLmuRestPoller({
      data: createLmuRestData(),
      transport,
      tasks: [sessionTask, repeatTask],
    });

    poller.setActive(true);
    await advance(0);
    expect(sessions(calls)).toHaveLength(1);

    poller.beginSession();
    await advance(60_000);

    expect(sessions(calls)).toHaveLength(2);
  });

  it('returns a backed-off task to its base rate', async () => {
    // A new session's pit menu is one somebody is about to touch.
    const { transport, calls } = makeTransport(() => ok('{"total":30}'));
    const poller = createLmuRestPoller({
      data: createLmuRestData(),
      transport,
      tasks: [repeatTask],
    });

    poller.setActive(true);
    await advance(REST_MAX_INTERVAL_MS * 10);
    const settled = calls.length;

    poller.beginSession();
    await advance(0);
    expect(calls).toHaveLength(settled + 1);
    await advance(BASE_MS);
    expect(calls).toHaveLength(settled + 2);
  });

  it('costs the first session nothing', async () => {
    // The bridge sees a session begin on its first frame, straight after
    // activating: no republish for a clear of nothing, and no second request.
    const data = createLmuRestData();
    const { transport, calls } = makeTransport((path) =>
      path === sessionTask.path ? ok('{"scale":6}') : ok('{"total":30}')
    );
    const poller = createLmuRestPoller({
      data,
      transport,
      tasks: [repeatTask, sessionTask],
    });

    poller.setActive(true);
    poller.beginSession();
    expect(data.revision).toBe(0);
    await advance(0);

    expect(calls).toEqual([repeatTask.path, sessionTask.path]);
  });

  it('does nothing while LMU is away', async () => {
    const data = createLmuRestData();
    const { transport, calls } = makeTransport(() => ok('{"total":30}'));
    const poller = createLmuRestPoller({
      data,
      transport,
      tasks: [repeatTask],
    });

    poller.beginSession();
    poller.retryGivenUp();
    await advance(60_000);

    expect(calls).toEqual([]);
    expect(data.revision).toBe(0);
  });

  it('keeps what does not belong to a session: the game state, the camera, the flags', async () => {
    // The game state is read every frame and the camera is a live reading,
    // so dropping either would flicker the player out of the car. The flags
    // are asked for only when a driver arrives, and a grid carried from
    // practice into qualifying has no arrivals to ask for them again.
    const data = createLmuRestData();
    const { transport } = makeTransport(() => fail('status'));
    const poller = createLmuRestPoller({ data, transport, tasks: [] });
    poller.setActive(true);
    data.gameState = 'monitor';
    data.cells = {
      focusCarIdx: { value: [7] },
      pitStopTime: { value: [30] },
      refuelTarget: { value: [45] },
    };
    data.session = {
      nationalities: { 'A Driver': 'FR' },
      teamNames: { 0: 'Proton Competition' },
      maxVirtualEnergy: 100,
    };

    poller.beginSession();

    expect(data.gameState).toBe('monitor');
    expect(data.cells).toEqual({ focusCarIdx: { value: [7] } });
    expect(data.session).toEqual({ nationalities: { 'A Driver': 'FR' } });
  });

  it('leaves a burst to the bridge that started it', async () => {
    const { transport, calls } = makeTransport(() =>
      ok('{"codes":{"A":"FR"}}')
    );
    const poller = createLmuRestPoller({
      data: createLmuRestData(),
      transport,
      tasks: [burstTask],
    });
    poller.setActive(true);

    // No burst asked for, so none is started.
    poller.beginSession();
    await advance(60_000);
    expect(calls).toEqual([]);

    // One that is waiting out its delay still waits it out.
    poller.burst('burst', { delayMs: 1000, isComplete: () => false });
    await advance(500);
    poller.beginSession();
    await advance(499);
    expect(calls).toHaveLength(0);
    await advance(1);
    expect(calls).toHaveLength(1);
  });
});

/**
 * A reading that barely moves, as a brake disc's thickness does: most
 * answers repeat the one before, and what has to be told apart is the sim
 * saying the same thing again from the sim not answering.
 */
const wearParseSpy = vi.fn((payload: unknown) =>
  typeof payload === 'object' && payload !== null
    ? (payload as { mm?: number }).mm
    : undefined
);
const wearApplySpy = vi.fn((data: LmuRestData, value: unknown) => {
  data.cells.brakeThickness = { value: [value as number] };
});

const wearTask: LmuRestTask = {
  id: 'wear',
  path: '/rest/garage/UIScreen/RepairAndRefuel',
  mode: 'repeat',
  baseIntervalMs: BASE_MS,
  outputs: [
    {
      id: 'brakeThickness',
      target: 'telemetry',
      parse: wearParseSpy,
      apply: wearApplySpy,
      refreshed: (data, count) => {
        data.cells.wearablesSeq = { value: [count] };
      },
    },
    {
      // Beside it in the same body, and asking for no mark.
      id: 'aeroDamage',
      target: 'telemetry',
      parse: (payload) =>
        typeof payload === 'object' && payload !== null
          ? (payload as { aero?: number }).aero
          : undefined,
      apply: (data, value) => {
        data.cells.aeroDamage = { value: [value as number] };
      },
    },
  ],
};

describe('createLmuRestPoller and an output that marks its answers', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    wearParseSpy.mockClear();
    wearApplySpy.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const seq = (data: LmuRestData) => data.cells.wearablesSeq?.value[0];

  const setup = (responder: () => LmuRestResponse) => {
    const { transport, calls } = makeTransport(responder);
    const data = createLmuRestData();
    const poller = createLmuRestPoller({ data, transport, tasks: [wearTask] });
    return { poller, data, calls };
  };

  it('marks an answer identical to the last, which is never parsed', async () => {
    // The disc has not worn and nothing else in the body moved. The cell is
    // the same object it was; only the mark says the sim answered again.
    const { poller, data, calls } = setup(() => ok('{"mm":36}'));

    poller.setActive(true);
    await advance(0);
    const thickness = data.cells.brakeThickness;
    expect(seq(data)).toBe(1);

    // 1000, then 1500: three answers in all.
    await advance(1000);
    await advance(1500);

    expect(calls).toHaveLength(3);
    expect(seq(data)).toBe(3);
    expect(wearParseSpy).toHaveBeenCalledTimes(1);
    expect(data.cells.brakeThickness).toBe(thickness);
  });

  it('marks an answer whose body moved around the same reading', async () => {
    // What a running car sends: the fuel aboard and the clock move on every
    // poll, the thickness on few of them.
    let clock = 0;
    const { poller, data } = setup(() =>
      ok(JSON.stringify({ mm: 36, clock: (clock += 1) }))
    );

    poller.setActive(true);
    await advance(0);
    await advance(BASE_MS * 4);

    expect(seq(data)).toBe(5);
    expect(data.cells.brakeThickness?.value).toEqual([36]);
  });

  it('replaces the mark rather than writing into it', async () => {
    const { poller, data } = setup(() => ok('{"mm":36}'));

    poller.setActive(true);
    await advance(0);
    const first = data.cells.wearablesSeq;
    await advance(BASE_MS);

    // A frame holding the first mark keeps the count it was built with.
    expect(first?.value).toEqual([1]);
    expect(data.cells.wearablesSeq).not.toBe(first);
  });

  it('stands still while the path does not answer', async () => {
    // The case the mark exists for. The thickness reads as it did, as it
    // would for a disc that had stopped wearing, and the mark does not move.
    let answering = true;
    const { poller, data } = setup(() =>
      answering ? ok('{"mm":36}') : fail('timeout')
    );

    poller.setActive(true);
    await advance(0);
    await advance(BASE_MS);
    expect(seq(data)).toBe(2);

    answering = false;
    await advance(60_000);
    expect(seq(data)).toBe(2);
    expect(data.cells.brakeThickness?.value).toEqual([36]);

    // The same body as before the gap is still an answer.
    answering = true;
    await advance(REST_MAX_INTERVAL_MS);
    expect(seq(data)).toBe(3);
  });

  it('does not mark an answer that left the value out', async () => {
    // The path answers, and the other value in the body lands, but nothing
    // vouches for a thickness this answer did not carry.
    let body = '{"mm":36,"aero":0}';
    const { poller, data } = setup(() => ok(body));

    poller.setActive(true);
    await advance(0);
    expect(seq(data)).toBe(1);

    body = '{"aero":0.2}';
    await advance(BASE_MS);
    expect(data.cells.aeroDamage?.value).toEqual([0.2]);
    expect(seq(data)).toBe(1);

    // Nor a repeat of that body, which is not parsed at all.
    await advance(BASE_MS);
    await advance(BASE_MS * 1.5);
    expect(seq(data)).toBe(1);

    // The next poll, 2.25 s on, carries one again.
    body = '{"mm":36,"aero":0.2}';
    await advance(BASE_MS * 2.25);
    expect(seq(data)).toBe(2);
  });

  it('does not mark a body that is not JSON', async () => {
    const { poller, data } = setup(() => ok('<html>loading</html>'));

    poller.setActive(true);
    await advance(0);
    await advance(BASE_MS * 5);

    expect(seq(data)).toBeUndefined();
  });

  it('marks a value its output recognised and did not write again', async () => {
    // A comparator spares the write, not the mark: the answer still carried
    // the value.
    let clock = 0;
    const { transport } = makeTransport(() =>
      ok(JSON.stringify({ mm: 36, clock: (clock += 1) }))
    );
    const data = createLmuRestData();
    const poller = createLmuRestPoller({
      data,
      transport,
      tasks: [
        {
          ...wearTask,
          outputs: [
            {
              ...wearTask.outputs[0],
              unchanged: (held, value) =>
                held.cells.brakeThickness?.value[0] === value,
            },
          ],
        },
      ],
    });

    poller.setActive(true);
    await advance(0);
    await advance(BASE_MS * 3);

    expect(wearApplySpy).toHaveBeenCalledTimes(1);
    expect(seq(data)).toBe(4);
  });

  it('goes on from where it was when a session begins', async () => {
    // The mark is dropped with the other cells and comes back with the next
    // answer. Not from one: a reader comparing it with the last it saw must
    // never meet the same number for a different answer.
    const { poller, data } = setup(() => ok('{"mm":36}'));

    poller.setActive(true);
    await advance(0);
    await advance(BASE_MS);
    expect(seq(data)).toBe(2);

    poller.beginSession();
    expect(data.cells.wearablesSeq).toBeUndefined();
    await advance(0);

    expect(seq(data)).toBe(3);
    expect(data.cells.brakeThickness?.value).toEqual([36]);
  });

  it('goes on from where it was when LMU goes away and comes back', async () => {
    const { poller, data } = setup(() => ok('{"mm":36}'));

    poller.setActive(true);
    await advance(0);
    await advance(BASE_MS);
    expect(seq(data)).toBe(2);

    poller.setActive(false);
    expect(data.cells.wearablesSeq).toBeUndefined();
    poller.setActive(true);
    await advance(0);

    expect(seq(data)).toBe(3);
  });

  it('does not mark an answer that arrived for the session before', async () => {
    let release: ((value: LmuRestResponse) => void) | undefined;
    let served = 0;
    const data = createLmuRestData();
    const poller = createLmuRestPoller({
      data,
      transport: () => {
        served += 1;
        if (served === 1) {
          return new Promise<LmuRestResponse>((resolve) => {
            release = resolve;
          });
        }
        return Promise.resolve(fail('timeout'));
      },
      tasks: [wearTask],
    });

    poller.setActive(true);
    await advance(0);
    poller.beginSession();
    release?.(ok('{"mm":36}'));
    await advance(BASE_MS - 1);

    expect(served).toBe(2);
    expect(seq(data)).toBeUndefined();
    expect(data.cells.brakeThickness).toBeUndefined();
  });

  it('wires the mark to the brake thickness of the real repair screen', async () => {
    // Through LMU_REST_TASKS rather than a stand-in: two polls of a car
    // whose discs did not wear between them.
    const repair = LMU_REST_TASKS.find(
      (task) => task.id === 'repair-and-refuel'
    );
    if (!repair) throw new Error('no repair-and-refuel task');
    let fuel = 44.9;
    const { transport } = makeTransport(() =>
      ok(
        JSON.stringify({
          fuelInfo: { currentFuel: (fuel -= 0.01) },
          wearables: { brakes: [0.036, 0.036, 0.032, 0.032] },
        })
      )
    );
    const data = createLmuRestData();
    const poller = createLmuRestPoller({ data, transport, tasks: [repair] });

    poller.setActive(true);
    await advance(0);
    const first = seq(data);
    await advance(repair.baseIntervalMs);

    expect(first).toBe(1);
    expect(seq(data)).toBe(2);
    expect(data.cells.brakeThickness?.value).toEqual([36, 36, 32, 32]);
  });
});
