import { describe, expect, it } from 'vitest';
import {
  metresToPitExit,
  selectRejoinTraffic,
  type RejoinInput,
} from './pitExitTraffic';

/** A 5 km lap with the pit lane from 95 % round to 5 % round. */
const TRACK_M = 5000;
/** 60 km/h. */
const LIMIT_MS = 60 / 3.6;

const input = (overrides: Partial<RejoinInput> = {}): RejoinInput => ({
  mode: 'exit',
  arriving: [],
  inPitLane: true,
  // 333.3 m short of the exit line: 20 s at the limit.
  playerPct: 0.05 - (20 * LIMIT_MS) / TRACK_M,
  playerSpeedMs: LIMIT_MS,
  pitEntryPct: 0.95,
  pitExitPct: 0.05,
  trackLengthM: TRACK_M,
  pitLimitMs: LIMIT_MS,
  aheadWindow: 10,
  behindWindow: 15,
  behindCount: 2,
  careGap: 2,
  dangerGap: 1,
  ...overrides,
});

/**
 * A car that crosses the exit line `atS` seconds from now: it covers the
 * stretch from the player to the line in 5 s, so it reaches the player's
 * place 5 s before that.
 */
const crossing = (carIdx: number, atS: number) => ({
  carIdx,
  gapS: atS - 5,
  speedMs: (20 * LIMIT_MS) / 5,
});

describe('the cars at the pit exit', () => {
  it('lists the car that goes by just before and the ones arriving after', () => {
    const traffic = selectRejoinTraffic(
      input({
        arriving: [
          crossing(1, 15),
          crossing(2, 21.4),
          crossing(3, 26),
          crossing(4, 58),
        ],
      })
    );

    expect(traffic.atExit).toBe(true);
    expect(traffic.toExitS).toBe(20);
    // 5 s before the player gets there: the player comes out behind it.
    expect(traffic.ahead).toEqual({ carIdx: 1, offsetS: -5 });
    // 1.4 s and 6 s after; the one 38 s after is outside the window.
    expect(traffic.behind).toEqual([
      { carIdx: 2, offsetS: 1.4 },
      { carIdx: 3, offsetS: 6 },
    ]);
    expect(traffic.state).toBe('caution');
  });

  it('is a danger inside the danger gap and clear with nobody near', () => {
    expect(
      selectRejoinTraffic(input({ arriving: [crossing(1, 20.8)] })).state
    ).toBe('danger');
    expect(
      selectRejoinTraffic(input({ arriving: [crossing(1, 22)] })).state
    ).toBe('clear');
    const empty = selectRejoinTraffic(input());
    expect(empty.state).toBe('clear');
    expect(empty.ahead).toBeNull();
    expect(empty.behind).toEqual([]);
  });

  it('keeps the nearest of the cars ahead and as many behind as asked', () => {
    const traffic = selectRejoinTraffic(
      input({
        behindCount: 1,
        arriving: [
          crossing(1, 11),
          crossing(2, 17),
          crossing(3, 9),
          crossing(4, 24),
          crossing(5, 23),
        ],
      })
    );
    // 9 s and 11 s are 11 s and 9 s ahead; only the second is in the
    // window, and 17 s is nearer still.
    expect(traffic.ahead).toEqual({ carIdx: 2, offsetS: -3 });
    expect(traffic.behind).toEqual([{ carIdx: 5, offsetS: 3 }]);
  });

  it('standing in the box, counts as if the car left now', () => {
    const traffic = selectRejoinTraffic(
      input({ playerSpeedMs: 0, arriving: [crossing(1, 23.4)] })
    );
    // 20 s at the limit and two for getting away.
    expect(traffic.toExitS).toBe(22);
    expect(traffic.behind).toEqual([{ carIdx: 1, offsetS: 1.4 }]);
    // With no limit from the session, 60 km/h.
    expect(
      selectRejoinTraffic(input({ playerSpeedMs: 0, pitLimitMs: null })).toExitS
    ).toBe(22);
  });

  it('rolling slower than the limit, takes longer to get there', () => {
    const traffic = selectRejoinTraffic(
      input({ playerSpeedMs: LIMIT_MS / 2, arriving: [crossing(1, 21.4)] })
    );
    expect(traffic.toExitS).toBe(40);
    // The car that would have arrived just behind is long gone.
    expect(traffic.ahead).toBeNull();
    expect(traffic.behind).toEqual([]);
  });

  it('falls back to the gaps behind until the pit exit has been seen', () => {
    const traffic = selectRejoinTraffic(
      input({
        pitExitPct: null,
        arriving: [
          { carIdx: 1, gapS: 1.4, speedMs: 60 },
          { carIdx: 2, gapS: 9, speedMs: 60 },
          { carIdx: 3, gapS: 14, speedMs: 60 },
          { carIdx: 4, gapS: 30, speedMs: 60 },
        ],
      })
    );
    expect(traffic.atExit).toBe(false);
    expect(traffic.toExitS).toBeNull();
    expect(traffic.ahead).toBeNull();
    expect(traffic.behind).toEqual([
      { carIdx: 1, offsetS: 1.4 },
      { carIdx: 2, offsetS: 9 },
    ]);
    expect(traffic.state).toBe('caution');
  });

  it('does the same out of the lane, and for a rejoin lists one car', () => {
    const arriving = [
      { carIdx: 1, gapS: 0.8, speedMs: 60 },
      { carIdx: 2, gapS: 3, speedMs: 60 },
    ];
    const justOut = selectRejoinTraffic(input({ inPitLane: false, arriving }));
    expect(justOut.atExit).toBe(false);
    expect(justOut.behind).toHaveLength(2);
    expect(justOut.state).toBe('danger');

    const slow = selectRejoinTraffic(
      input({ mode: 'rejoin', inPitLane: false, arriving })
    );
    expect(slow.mode).toBe('rejoin');
    expect(slow.behind).toEqual([{ carIdx: 1, offsetS: 0.8 }]);
  });
});

describe('the metres to the pit exit', () => {
  const lane = {
    pitEntryPct: 0.95,
    pitExitPct: 0.05,
    trackLengthM: TRACK_M,
  };

  it('are counted along the lane, across the line', () => {
    expect(metresToPitExit({ ...lane, playerPct: 0.99 })).toBeCloseTo(300, 6);
    expect(metresToPitExit({ ...lane, playerPct: 0.03 })).toBeCloseTo(100, 6);
  });

  it('are unknown outside the lane, and before the exit has been seen', () => {
    // A garage stall the sim places half way round the lap.
    expect(metresToPitExit({ ...lane, playerPct: 0.5 })).toBeNull();
    // Past the exit line.
    expect(metresToPitExit({ ...lane, playerPct: 0.06 })).toBeNull();
    expect(
      metresToPitExit({ ...lane, pitExitPct: null, playerPct: 0.99 })
    ).toBeNull();
    expect(
      metresToPitExit({ ...lane, trackLengthM: 0, playerPct: 0.99 })
    ).toBeNull();
  });

  it('with no entry on record take anything up to half a lap', () => {
    const noEntry = { ...lane, pitEntryPct: null };
    expect(metresToPitExit({ ...noEntry, playerPct: 0.8 })).toBeCloseTo(
      1250,
      6
    );
    expect(metresToPitExit({ ...noEntry, playerPct: 0.3 })).toBeNull();
  });
});
