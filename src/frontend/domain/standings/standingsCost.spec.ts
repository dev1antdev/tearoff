import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import logger from '@irdashies/utils/logger';
import { measureStandingsRebuild, resetStandingsCost } from './standingsCost';

vi.mock('@irdashies/utils/logger', () => ({
  default: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

const warn = vi.mocked(logger.warn);

/**
 * The instrument reads `performance.now()` around the build and `Date.now()`
 * for its throttle. Both are the spec's own here: a build "takes" exactly
 * what it is told to, and one that takes nothing can never be found slow.
 * On the real clock a pause of the machine inside a build that does nothing
 * read as a slow rebuild, and the spec failed on a busy runner.
 */
let elapsed = 0;
let wallClock = 0;

/** A build that takes this long by the instrument's clock. */
const taking = (ms: number) => () => {
  elapsed += ms;
  return null;
};

const instant = () => null;

beforeEach(() => {
  resetStandingsCost();
  warn.mockClear();
  elapsed = 0;
  wallClock = 1_000_000;
  vi.spyOn(performance, 'now').mockImplementation(() => elapsed);
  vi.spyOn(Date, 'now').mockImplementation(() => wallClock);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('measureStandingsRebuild', () => {
  it('returns what the build returned', () => {
    expect(measureStandingsRebuild('standings', 20, () => 'rows')).toBe('rows');
  });

  it('says nothing about a fast rebuild', () => {
    measureStandingsRebuild('standings', 20, instant);
    measureStandingsRebuild('standings', 20, taking(7.9));
    expect(warn).not.toHaveBeenCalled();
  });

  it('reports a slow one, with the grid size', () => {
    measureStandingsRebuild('standings', 22, taking(12));
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('22 drivers');
    expect(warn.mock.calls[0][0]).toContain('worst 12.0ms');
  });

  it('reports the worst, not the latest', () => {
    // Throttled after the first line: the next covers what came after it.
    measureStandingsRebuild('standings', 20, taking(9));
    measureStandingsRebuild('standings', 20, taking(14));
    measureStandingsRebuild('standings', 20, taking(10));
    wallClock += 10_000;
    measureStandingsRebuild('standings', 20, instant);
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls[1][0]).toContain('worst 14.0ms');
  });

  it('throttles, so one slow rebuild does not bury the log', () => {
    // A rebuild slow once is slow every time, and this runs twice a second.
    for (let i = 0; i < 5; i += 1) {
      measureStandingsRebuild('standings', 20, taking(10));
      wallClock += 500;
    }
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('speaks again once the interval has passed', () => {
    measureStandingsRebuild('standings', 20, taking(10));
    wallClock += 9_999;
    measureStandingsRebuild('standings', 20, taking(10));
    expect(warn).toHaveBeenCalledTimes(1);
    wallClock += 1;
    measureStandingsRebuild('standings', 20, taking(10));
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('keeps the two tables apart, and labels which was slow', () => {
    // Two widgets, two rebuilds, one name. Reading one path's silence as
    // covering both is how the last attempt went wrong.
    measureStandingsRebuild('relative', 20, taking(10));
    measureStandingsRebuild('standings', 20, instant);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('[relative]');

    measureStandingsRebuild('standings', 20, taking(10));
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls[1][0]).toContain('[standings]');
  });

  it('counts the rebuilds it stayed quiet for', () => {
    measureStandingsRebuild('standings', 20, instant);
    measureStandingsRebuild('standings', 20, instant);
    measureStandingsRebuild('standings', 20, taking(10));
    expect(warn.mock.calls[0][0]).toContain('over 3 rebuilds');
  });
});
