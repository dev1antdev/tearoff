import { describe, expect, it } from 'vitest';
import type {
  SectorTimingResultSnapshot,
  SectorTimingSnapshot,
} from '@irdashies/types';
import {
  sectorHoldActive,
  sectorTiles,
  type SectorTileOptions,
} from './sectorTiles';

const result = (
  overrides: Partial<SectorTimingResultSnapshot> = {},
  count = 3
): SectorTimingResultSnapshot => ({
  currentLapSectorTimes: Array<number | null>(count).fill(null),
  previousLapSectorTimes: Array<number | null>(count).fill(null),
  currentLapSectorUnclean: Array<boolean>(count).fill(false),
  previousLapSectorUnclean: Array<boolean>(count).fill(false),
  sessionBestSectorTimes: Array<number | null>(count).fill(null),
  previousSessionBestSectorTimes: Array<number | null>(count).fill(null),
  sessionBestLapSectorTimes: Array<number | null>(count).fill(null),
  finishedLapSectorTimes: Array<number | null>(count).fill(null),
  ...overrides,
});

const snapshot = (
  overrides: Partial<SectorTimingSnapshot> = {},
  count = 3
): SectorTimingSnapshot => ({
  sectors: Array.from({ length: count }, (_, index) => ({
    SectorNum: index,
    SectorStartPct: index / count,
  })),
  currentSectorIdx: 0,
  sectorEntryTime: 100,
  sectorEntryValid: true,
  inclusive: result({}, count),
  clean: result({}, count),
  allTime: null,
  sessionNum: 0,
  version: 1,
  ...overrides,
});

const options = (
  overrides: Partial<SectorTileOptions> = {}
): SectorTileOptions => ({
  source: 'live',
  incidents: 'mark',
  max: 6,
  holding: false,
  ...overrides,
});

/** The second lap of a stint: one sector done, the lap before it complete. */
const midLap = snapshot({
  currentSectorIdx: 1,
  inclusive: result({
    currentLapSectorTimes: [31.2, null, null],
    previousLapSectorTimes: [31.5, 40.1, 29.9],
    sessionBestSectorTimes: [31.2, 40.1, 29.9],
  }),
});

/** Just over the line: the lap is finished and the new one has no sector. */
const atTheLine = snapshot({
  currentSectorIdx: 0,
  sectorEntryTime: 500,
  inclusive: result({
    previousLapSectorTimes: [31.5, 40.1, 29.9],
    sessionBestSectorTimes: [31.2, 40.1, 29.9],
  }),
});

const shown = (tiles: ReturnType<typeof sectorTiles>) =>
  tiles.map(({ label, time, state }) => [label, time, state]);

describe('sectorHoldActive', () => {
  it('holds the finished lap for five seconds after the line', () => {
    expect(sectorHoldActive(atTheLine, 503)).toBe(true);
    expect(sectorHoldActive(atTheLine, 504.99)).toBe(true);
    expect(sectorHoldActive(atTheLine, 505)).toBe(false);
    expect(sectorHoldActive(atTheLine, 506)).toBe(false);
  });

  it('only holds in the first sector', () => {
    expect(sectorHoldActive(midLap, 101)).toBe(false);
  });

  it('does not hold for a car put in the first sector, not driven into it', () => {
    // A reset to the pits dates the sector entry too, but no lap just ended.
    expect(
      sectorHoldActive({ ...atTheLine, sectorEntryValid: false }, 503)
    ).toBe(false);
  });

  it('does not hold on a clock that is behind the entry, or with no data', () => {
    expect(sectorHoldActive(atTheLine, 499)).toBe(false);
    expect(sectorHoldActive(undefined, 503)).toBe(false);
  });
});

describe('sectorTiles, live', () => {
  it("shows this lap's sector once done and the previous lap's until then", () => {
    expect(shown(sectorTiles(midLap, options()))).toEqual([
      ['S1', 31.2, 'fresh'],
      ['S2', 40.1, 'stale'],
      ['S3', 29.9, 'stale'],
    ]);
  });

  it('shows the lap just finished at full strength while it is held', () => {
    // Three seconds after the line.
    const tiles = sectorTiles(
      atTheLine,
      options({ holding: sectorHoldActive(atTheLine, 503) })
    );

    expect(shown(tiles)).toEqual([
      ['S1', 31.5, 'fresh'],
      ['S2', 40.1, 'fresh'],
      ['S3', 29.9, 'fresh'],
    ]);
  });

  it('dims the finished lap once the hold is over', () => {
    // Six seconds after the line.
    const tiles = sectorTiles(
      atTheLine,
      options({ holding: sectorHoldActive(atTheLine, 506) })
    );

    expect(shown(tiles)).toEqual([
      ['S1', 31.5, 'stale'],
      ['S2', 40.1, 'stale'],
      ['S3', 29.9, 'stale'],
    ]);
  });

  it('leaves a sector that was never timed empty', () => {
    // The sector a stint starts in is not recorded.
    const tiles = sectorTiles(
      snapshot({
        currentSectorIdx: 2,
        inclusive: result({
          currentLapSectorTimes: [null, 40.4, null],
          previousLapSectorTimes: [null, 40.4, null],
          sessionBestSectorTimes: [null, 40.4, null],
        }),
      }),
      options()
    );

    expect(shown(tiles)).toEqual([
      ['S1', null, 'none'],
      ['S2', 40.4, 'fresh'],
      ['S3', null, 'none'],
    ]);
    expect(tiles[0].color).toBe('default');
  });

  it('holds a lap the sim did not time without a third sector', () => {
    // Over the line with no lap time from the sim: the lap just finished has
    // its first two sectors, and what is published as the previous lap is
    // that lap, with nothing of the one before it where S3 would be.
    const untimed = snapshot({
      currentSectorIdx: 0,
      sectorEntryTime: 500,
      inclusive: result({
        previousLapSectorTimes: [31.5, 40.1, null],
        finishedLapSectorTimes: [31.5, 40.1, null],
        sessionBestSectorTimes: [31.2, 40.1, 29.9],
      }),
    });
    const held = sectorTiles(
      untimed,
      options({ holding: sectorHoldActive(untimed, 503) })
    );

    expect(shown(held)).toEqual([
      ['S1', 31.5, 'fresh'],
      ['S2', 40.1, 'fresh'],
      ['S3', null, 'none'],
    ]);
    // Nor does one turn up, dimmed, once the hold is over.
    expect(
      shown(
        sectorTiles(
          untimed,
          options({ holding: sectorHoldActive(untimed, 506) })
        )
      )[2]
    ).toEqual(['S3', null, 'none']);
  });

  it("keeps an abandoned sector's previous time, dimmed", () => {
    // Reset to the pits in sector two: its time this lap is gone.
    const tiles = sectorTiles(
      { ...midLap, sectorEntryValid: false },
      options()
    );

    expect(tiles[1]).toMatchObject({ time: 40.1, state: 'stale' });
  });
});

describe('sectorTiles, liveOnly', () => {
  it('returns to dashes once the hold is over', () => {
    const tiles = sectorTiles(
      atTheLine,
      options({
        source: 'liveOnly',
        holding: sectorHoldActive(atTheLine, 506),
      })
    );

    expect(shown(tiles)).toEqual([
      ['S1', null, 'none'],
      ['S2', null, 'none'],
      ['S3', null, 'none'],
    ]);
  });

  it('still holds the finished lap for its five seconds', () => {
    const tiles = sectorTiles(
      atTheLine,
      options({
        source: 'liveOnly',
        holding: sectorHoldActive(atTheLine, 503),
      })
    );

    expect(tiles.map((tile) => tile.time)).toEqual([31.5, 40.1, 29.9]);
    expect(tiles.every((tile) => tile.state === 'fresh')).toBe(true);
  });

  it('fills as the lap goes', () => {
    expect(shown(sectorTiles(midLap, options({ source: 'liveOnly' })))).toEqual(
      [
        ['S1', 31.2, 'fresh'],
        ['S2', null, 'none'],
        ['S3', null, 'none'],
      ]
    );
  });
});

describe('sectorTiles, best', () => {
  it("shows the player's best for each sector, purple", () => {
    const tiles = sectorTiles(midLap, options({ source: 'best' }));

    expect(shown(tiles)).toEqual([
      ['S1', 31.2, 'best'],
      ['S2', 40.1, 'best'],
      ['S3', 29.9, 'best'],
    ]);
    expect(tiles.map((tile) => tile.color)).toEqual([
      'purple',
      'purple',
      'purple',
    ]);
  });

  it('leaves a sector with no best empty', () => {
    const tiles = sectorTiles(
      snapshot({
        inclusive: result({ sessionBestSectorTimes: [31.2, null, 29.9] }),
      }),
      options({ source: 'best' })
    );

    expect(tiles[1]).toMatchObject({ time: null, state: 'none' });
    expect(tiles[1].color).toBe('default');
  });
});

describe('sectorTiles, colour', () => {
  const colourOf = (time: number) =>
    sectorTiles(
      snapshot({
        currentSectorIdx: 1,
        inclusive: result({
          currentLapSectorTimes: [time, null, null],
          sessionBestSectorTimes: [30, null, null],
        }),
      }),
      options()
    )[0].color;

  it("is measured against the player's best for the sector", () => {
    expect(colourOf(30)).toBe('purple');
    expect(colourOf(30.1)).toBe('green');
    expect(colourOf(30.25)).toBe('yellow');
    expect(colourOf(30.6)).toBe('red');
  });

  it('follows the thresholds it is given', () => {
    const tiles = sectorTiles(
      snapshot({
        currentSectorIdx: 1,
        inclusive: result({
          currentLapSectorTimes: [30.6, null, null],
          sessionBestSectorTimes: [30, null, null],
        }),
      }),
      options({ greenThreshold: 0.03, yellowThreshold: 0.05 })
    );

    expect(tiles[0].color).toBe('green');
  });

  it("colours a previous lap's time as well, so the accent stays", () => {
    expect(sectorTiles(midLap, options())[1]).toMatchObject({
      state: 'stale',
      color: 'purple',
    });
  });
});

describe('sectorTiles, incidents', () => {
  const withIncident = snapshot({
    currentSectorIdx: 2,
    inclusive: result({
      currentLapSectorTimes: [31.2, 44.8, null],
      currentLapSectorUnclean: [false, true, false],
      previousLapSectorTimes: [31.5, 44.8, 29.9],
      previousLapSectorUnclean: [false, true, true],
      sessionBestSectorTimes: [31.2, 40.1, 29.9],
    }),
    clean: result({
      currentLapSectorTimes: [31.2, null, null],
      previousLapSectorTimes: [31.5, 40.1, 29.6],
      sessionBestSectorTimes: [31.2, 40.1, 29.6],
    }),
  });

  it('marks a sector with an incident and keeps its time', () => {
    const tiles = sectorTiles(withIncident, options({ incidents: 'mark' }));

    expect(tiles.map((tile) => tile.time)).toEqual([31.2, 44.8, 29.9]);
    expect(tiles.map((tile) => tile.unclean)).toEqual([false, true, true]);
  });

  it("drops it for the clean view's times", () => {
    const tiles = sectorTiles(withIncident, options({ incidents: 'drop' }));

    // Sector two this lap is left out, so the last clean one stands in.
    expect(shown(tiles)).toEqual([
      ['S1', 31.2, 'fresh'],
      ['S2', 40.1, 'stale'],
      ['S3', 29.6, 'stale'],
    ]);
    expect(tiles.some((tile) => tile.unclean)).toBe(false);
  });
});

describe('sectorTiles, more sectors than tiles', () => {
  const nine = (currentSectorIdx: number) => snapshot({ currentSectorIdx }, 9);

  const labels = (tiles: ReturnType<typeof sectorTiles>) =>
    tiles.map((tile) => tile.label);

  it('keeps the sector just completed second from the right', () => {
    // In the seventh sector: the sixth is the one just completed.
    const tiles = sectorTiles(nine(6), options({ max: 6 }));

    expect(labels(tiles)).toEqual(['S2', 'S3', 'S4', 'S5', 'S6', 'S7']);
    expect(tiles.at(-2)?.index).toBe(5);
  });

  it('starts at the first sector and ends at the last', () => {
    expect(labels(sectorTiles(nine(0), options({ max: 6 })))).toEqual([
      'S1',
      'S2',
      'S3',
      'S4',
      'S5',
      'S6',
    ]);
    expect(labels(sectorTiles(nine(2), options({ max: 6 })))[0]).toBe('S1');
    expect(labels(sectorTiles(nine(8), options({ max: 6 })))).toEqual([
      'S4',
      'S5',
      'S6',
      'S7',
      'S8',
      'S9',
    ]);
  });

  it('shows the end of the finished lap while it is held', () => {
    const tiles = sectorTiles(nine(0), options({ max: 6, holding: true }));

    expect(labels(tiles).at(-1)).toBe('S9');
  });

  it('shows every sector when they fit', () => {
    expect(sectorTiles(nine(4), options({ max: 9 }))).toHaveLength(9);
    expect(sectorTiles(snapshot({}, 5), options({ max: 6 }))).toHaveLength(5);
  });

  it('survives a limit that is not a number', () => {
    expect(sectorTiles(nine(4), options({ max: Number.NaN }))).toHaveLength(9);
    expect(sectorTiles(nine(4), options({ max: 0 }))).toHaveLength(1);
  });
});

describe('sectorTiles, no data', () => {
  it('keeps three empty tiles so the widget holds its shape', () => {
    const empty = [
      ['S1', null, 'none'],
      ['S2', null, 'none'],
      ['S3', null, 'none'],
    ];

    expect(shown(sectorTiles(undefined, options()))).toEqual(empty);
    // A session that names no sectors.
    expect(shown(sectorTiles(snapshot({}, 0), options()))).toEqual(empty);
  });
});
