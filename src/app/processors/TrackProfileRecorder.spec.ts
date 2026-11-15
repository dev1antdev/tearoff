import { describe, expect, it } from 'vitest';
import type {
  Session,
  Telemetry,
  TrackProfileDemand,
  TrackProfileKey,
  TrackProfileLap,
} from '@irdashies/types';
import {
  TRACK_PROFILE_MAX_POINTS,
  TRACK_PROFILE_SPACING_M,
} from '@irdashies/types';
import { pointsCountFor } from './lapTiming';
import {
  TrackProfileRecorder,
  trackProfileLapSource,
  verticalSpeed,
} from './TrackProfileRecorder';

/** Laguna Seca as Le Mans Ultimate measures it: 360 buckets. */
const TRACK_LENGTH_M = 3590.35;
const TRACK_ID = 694510461;
const POINTS = 360;
/** Where LMU's second and third sectors start on that lap. */
const SECOND_SECTOR_PCT = 0.39;
const THIRD_SECTOR_PCT = 0.792;
/** Scoring, which the sector index comes from, is written five times a second. */
const SCORING_SECONDS = 0.2;

const session = ({
  trackId = TRACK_ID,
  trackLengthM = TRACK_LENGTH_M,
  playerCarIdx = 0,
  sectors = [0, 1 / 3, 2 / 3],
}: {
  trackId?: number;
  trackLengthM?: number;
  playerCarIdx?: number;
  sectors?: number[];
} = {}): Session =>
  ({
    WeekendInfo: {
      TrackID: trackId,
      TrackDisplayName: 'WeatherTech Raceway Laguna Seca',
      TrackLength: `${trackLengthM} m`,
    },
    DriverInfo: { DriverCarIdx: playerCarIdx },
    SplitTimeInfo: {
      Sectors: sectors.map((SectorStartPct, SectorNum) => ({
        SectorNum,
        SectorStartPct,
      })),
    },
  }) as unknown as Session;

/** Where the car is on one frame, for a case to change before it is sent. */
interface Moment {
  /** Seconds on the session clock. */
  time: number;
  /** Laps begun at the line so far: 0 before the first crossing. */
  lap: number;
  pct: number;
  /** Seconds since the car crossed the line. */
  lapClock: number;
}

/** The frame fields a case may want to change, by frame key. */
type Fields = Record<string, unknown>;

interface DriveOptions {
  /** m/s along the road. */
  speed?: number;
  hz?: number;
  /** Where the drive starts, as a lap fraction. */
  from?: number;
  /** Stop once this many line crossings have been made. */
  crossings: number;
  /** The height of the road, metres, at a lap fraction. */
  height?: (pct: number) => number;
  /** Changes a frame before it is sent; null drops the frame. */
  change?: (fields: Fields, moment: Moment) => Fields | null;
}

/** A sink that keeps what it is handed and wants what it is told to. */
const createSink = (demand: TrackProfileDemand = 'first') => {
  const laps: { key: TrackProfileKey; lap: TrackProfileLap }[] = [];
  const state = { demand };
  return {
    laps,
    state,
    wants: () => state.demand,
    recordLap: (key: TrackProfileKey, lap: TrackProfileLap) => {
      laps.push({ key, lap });
    },
  };
};

const sine = (pct: number): number => 10 * Math.sin(2 * Math.PI * pct);

/** A frame with one of its keys missing, as when the sim does not state it. */
const without = (fields: Fields, key: string): Fields =>
  Object.fromEntries(Object.entries(fields).filter(([name]) => name !== key));

const toTelemetry = (fields: Fields): Telemetry =>
  Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [
      key,
      { value: Array.isArray(value) ? value : [value] },
    ])
  ) as unknown as Telemetry;

/**
 * Drives the car round at a steady speed, a frame at a time, and returns
 * the clock it stopped on. The sector index and the sim's sector times move
 * only at scoring updates, as LMU's do, so the index trails the car.
 */
const driveLmu = (
  recorder: TrackProfileRecorder,
  {
    speed = 60,
    hz = 100,
    from = 0.97,
    crossings,
    height = sine,
    change,
  }: DriveOptions,
  startTime = 100
): number => {
  const step = speed / hz / TRACK_LENGTH_M;
  let time = startTime;
  let pct = from;
  let lap = 0;
  let lineAt = time;
  let crossed = 0;
  let scoredAt = Number.NEGATIVE_INFINITY;
  let sectorIdx =
    pct >= THIRD_SECTOR_PCT ? 2 : pct >= SECOND_SECTOR_PCT ? 1 : 0;
  let sectorTimes: (number | null)[] = [null, null];
  while (crossed < crossings) {
    time += 1 / hz;
    pct += step;
    if (pct >= 1) {
      pct -= 1;
      lap += 1;
      crossed += 1;
      // The car covers the two sides of the line at one speed.
      lineAt = time - (pct * TRACK_LENGTH_M) / speed;
    }
    const lapClock = time - lineAt;
    if (time - scoredAt >= SCORING_SECONDS - 1e-9) {
      scoredAt = time;
      const lapTime = TRACK_LENGTH_M / speed;
      sectorIdx =
        pct >= THIRD_SECTOR_PCT ? 2 : pct >= SECOND_SECTOR_PCT ? 1 : 0;
      sectorTimes = [
        sectorIdx >= 1 ? SECOND_SECTOR_PCT * lapTime : null,
        sectorIdx >= 2
          ? (THIRD_SECTOR_PCT - SECOND_SECTOR_PCT) * lapTime
          : null,
      ];
    }
    const angle = 2 * Math.PI * pct;
    const fields: Fields = {
      SessionTime: time,
      SessionNum: 0,
      CarIdxLapDistPct: [pct],
      CarIdxOnPitRoad: [false],
      IsOnTrack: true,
      LmuLapInvalidated: false,
      LmuPlayerWorldPos: [
        400 * Math.cos(angle),
        height(pct),
        400 * Math.sin(angle),
      ],
      LmuSectorIdx: sectorIdx,
      LapCurrentLapTime: lapClock,
      LmuCurrentSectorTimes: sectorTimes,
    };
    const sent = change ? change(fields, { time, lap, pct, lapClock }) : fields;
    if (sent) recorder.onFrame(toTelemetry(sent));
  }
  return time;
};

const startLmu = (demand: TrackProfileDemand = 'first') => {
  const sink = createSink(demand);
  const recorder = new TrackProfileRecorder(sink, { simulator: 'lmu' });
  recorder.onSession(session());
  recorder.onEnter();
  return { recorder, sink };
};

describe('TrackProfileRecorder', () => {
  it('buckets a lap as the lap curves are bucketed', () => {
    for (const length of [402.3, 3590.35, 6413.5, 13626, 25378]) {
      expect(pointsCountFor(length)).toBe(
        Math.ceil(length / TRACK_PROFILE_SPACING_M)
      );
    }
    expect(pointsCountFor(TRACK_LENGTH_M)).toBe(POINTS);
  });

  it('reads heights where the sim states a position and adds them up elsewhere', () => {
    expect(trackProfileLapSource('lmu')).toBe('recorded');
    expect(trackProfileLapSource('iracing')).toBe('integrated');
  });

  describe('under Le Mans Ultimate', () => {
    it('takes nothing before a lap has been driven from line to line', () => {
      const { recorder, sink } = startLmu();
      // Out of the pits half way round, and over the line once.
      driveLmu(recorder, { from: 0.5, crossings: 1 });

      expect(sink.laps).toHaveLength(0);
      expect(recorder.trackKey()).toEqual({
        simulator: 'lmu',
        trackId: TRACK_ID,
        trackName: 'WeatherTech Raceway Laguna Seca',
        trackLengthM: TRACK_LENGTH_M,
        pointsCount: POINTS,
      });
    });

    it('samples a clean lap into every bucket', () => {
      const { recorder, sink } = startLmu();
      driveLmu(recorder, { crossings: 2 });

      expect(sink.laps).toHaveLength(1);
      const { key, lap } = sink.laps[0];
      expect(key.pointsCount).toBe(POINTS);
      expect(lap.source).toBe('recorded');
      expect(lap.elevationM).toHaveLength(POINTS);
      expect(lap.xM).toHaveLength(POINTS);
      expect(lap.zM).toHaveLength(POINTS);
      for (let bucket = 0; bucket < POINTS; bucket += 1) {
        // The frame that first lands in a bucket is under a metre into it.
        const pct = bucket / POINTS;
        const angle = 2 * Math.PI * pct;
        expect(Math.abs(lap.elevationM[bucket] - sine(pct))).toBeLessThan(0.05);
        expect(
          Math.abs((lap.xM as Float32Array)[bucket] - 400 * Math.cos(angle))
        ).toBeLessThan(1);
        expect(
          Math.abs((lap.zM as Float32Array)[bucket] - 400 * Math.sin(angle))
        ).toBeLessThan(1);
      }
      // It ends where it began.
      expect(lap.closureM).toBeLessThan(0.05);
    });

    it('hands over every clean lap while one is wanted', () => {
      const { recorder, sink } = startLmu();
      driveLmu(recorder, { crossings: 4 });

      expect(sink.laps).toHaveLength(3);
    });

    it('reports a lap that does not come back to its own height', () => {
      const { recorder, sink } = startLmu();
      // A car two metres higher each time it comes round, which no road
      // does: the sim moved it, or the reading is not the road's.
      driveLmu(recorder, {
        crossings: 2,
        change: (fields, { lap, pct }) => {
          const [x, y, z] = fields.LmuPlayerWorldPos as number[];
          return { ...fields, LmuPlayerWorldPos: [x, y + 2 * (lap + pct), z] };
        },
      });

      expect(sink.laps).toHaveLength(1);
      expect(sink.laps[0].lap.closureM).toBeCloseTo(2, 1);
    });

    describe('a lap that cannot become part of a profile', () => {
      /** Spoils the first whole lap between two lap fractions. */
      const spoiled = (
        change: (fields: Fields) => Fields | null,
        from = 0.4,
        to = 0.41
      ) => {
        const { recorder, sink } = startLmu();
        driveLmu(recorder, {
          crossings: 3,
          change: (fields, { lap, pct }) =>
            lap === 1 && pct >= from && pct < to ? change(fields) : fields,
        });
        return { recorder, sink };
      };

      it('is dropped for touching pit road, and the next one kept', () => {
        const { sink } = spoiled((fields) => ({
          ...fields,
          CarIdxOnPitRoad: [true],
        }));

        // The second lap, and only it.
        expect(sink.laps).toHaveLength(1);
      });

      it('is dropped when the sim voids it', () => {
        const { sink } = spoiled((fields) => ({
          ...fields,
          LmuLapInvalidated: true,
        }));

        expect(sink.laps).toHaveLength(1);
      });

      it('is kept when the void flag is only the lap before, just past the line', () => {
        const { sink } = spoiled(
          (fields) => ({ ...fields, LmuLapInvalidated: true }),
          0,
          0.04
        );

        expect(sink.laps).toHaveLength(2);
      });

      it('is dropped when the player was not driving', () => {
        const { sink } = spoiled((fields) => ({ ...fields, IsOnTrack: false }));

        expect(sink.laps).toHaveLength(1);
      });

      it('is dropped when the sim gives no position', () => {
        const { sink } = spoiled((fields) =>
          without(fields, 'LmuPlayerWorldPos')
        );

        expect(sink.laps).toHaveLength(1);
      });

      it('is dropped for a jump back of sixty metres', () => {
        const { recorder, sink } = startLmu();
        let jumped = false;
        driveLmu(recorder, {
          crossings: 3,
          change: (fields, { lap, pct }) => {
            if (lap !== 1 || pct < 0.5 || jumped) return fields;
            jumped = true;
            return {
              ...fields,
              CarIdxLapDistPct: [pct - 60 / TRACK_LENGTH_M],
            };
          },
        });

        expect(sink.laps).toHaveLength(1);
      });

      it('is dropped for a jump forward of a third of a lap', () => {
        const { recorder, sink } = startLmu();
        let jumped = false;
        driveLmu(recorder, {
          crossings: 3,
          change: (fields, { lap, pct }) => {
            if (lap !== 1 || pct < 0.3 || jumped) return fields;
            jumped = true;
            return { ...fields, CarIdxLapDistPct: [pct + 0.33] };
          },
        });

        expect(sink.laps).toHaveLength(1);
      });

      it('is dropped when a stretch of it went by unsampled', () => {
        // Half a second of frames lost: thirty metres, three buckets.
        const { sink } = spoiled(() => null, 0.4, 0.4084);

        expect(sink.laps).toHaveLength(1);
      });

      it('is dropped when the clock runs backwards', () => {
        const { recorder, sink } = startLmu();
        let rewound = false;
        driveLmu(recorder, {
          crossings: 3,
          change: (fields, { lap, pct, time }) => {
            if (lap !== 1 || pct < 0.6 || rewound) return fields;
            rewound = true;
            return { ...fields, SessionTime: time - 30 };
          },
        });

        expect(sink.laps).toHaveLength(1);
      });

      it('is dropped when the session changes under it', () => {
        const { recorder, sink } = startLmu();
        driveLmu(recorder, {
          crossings: 2,
          change: (fields, { lap, pct }) =>
            lap === 1 && pct >= 0.5 ? { ...fields, SessionNum: 1 } : fields,
        });

        expect(sink.laps).toHaveLength(0);
      });
    });

    it('drops the lap under way when recording is switched off', () => {
      const { recorder, sink } = startLmu();
      const time = driveLmu(recorder, { crossings: 1 });
      recorder.setEnabled(false);
      recorder.setEnabled(true);
      driveLmu(recorder, { from: 0.0002, crossings: 1 }, time);
      expect(sink.laps).toHaveLength(0);

      driveLmu(recorder, { from: 0.0002, crossings: 1 }, time + 100);
      expect(sink.laps).toHaveLength(1);
    });

    it('drops the lap under way on a disconnect and when the track changes', () => {
      const { recorder, sink } = startLmu();
      const time = driveLmu(recorder, { crossings: 1 });
      recorder.onDisconnect();
      driveLmu(recorder, { from: 0.0002, crossings: 1 }, time);
      expect(sink.laps).toHaveLength(0);

      // Half way round the next one the session names another track.
      driveLmu(recorder, {
        from: 0.0002,
        crossings: 1,
        change: (fields, { pct }) => {
          if (pct > 0.5 && recorder.trackKey()?.trackId === TRACK_ID) {
            recorder.onSession(session({ trackId: 42 }));
          }
          return fields;
        },
      });
      expect(sink.laps).toHaveLength(0);
      expect(recorder.trackKey()?.trackId).toBe(42);
    });

    it('records nothing while the sim names no car for the player', () => {
      const sink = createSink();
      const recorder = new TrackProfileRecorder(sink, { simulator: 'lmu' });
      recorder.onSession(session({ playerCarIdx: -1 }));
      driveLmu(recorder, { crossings: 3 });

      expect(sink.laps).toHaveLength(0);
    });

    it('records nothing on a track longer than a profile may be', () => {
      const sink = createSink();
      const recorder = new TrackProfileRecorder(sink, { simulator: 'lmu' });
      recorder.onSession(
        session({ trackLengthM: (TRACK_PROFILE_MAX_POINTS + 1) * 10 })
      );

      expect(recorder.trackKey()).toBeNull();
    });

    describe('what the track still wants', () => {
      it('samples nothing for a track whose profile is settled', () => {
        const { recorder, sink } = startLmu('none');
        driveLmu(recorder, { crossings: 3 });

        expect(sink.laps).toHaveLength(0);
        expect(recorder.progress()).toBeNull();
      });

      it('asks again at every line, so a cleared profile is recorded anew', () => {
        const { recorder, sink } = startLmu('none');
        const time = driveLmu(recorder, { crossings: 2 });
        sink.state.demand = 'first';
        // The lap under way was not being sampled: the next one is.
        driveLmu(recorder, { from: 0.0002, crossings: 2 }, time);

        expect(sink.laps).toHaveLength(1);
      });

      it('says how far round a first lap is, and nothing for any other', () => {
        const { recorder, sink } = startLmu('first');
        expect(recorder.progress()).toBeNull();
        let seen = -1;
        driveLmu(recorder, {
          crossings: 2,
          change: (fields, { lap, pct }) => {
            if (lap === 1 && pct > 0.5 && seen < 0) {
              seen = recorder.progress() ?? -1;
            }
            return fields;
          },
        });
        expect(seen).toBeGreaterThan(0.49);
        expect(seen).toBeLessThan(0.51);

        sink.state.demand = 'more';
        driveLmu(recorder, { from: 0.0002, crossings: 1 }, 1000);
        expect(recorder.progress()).toBeNull();
      });

      it('stops reporting progress on a lap it has dropped', () => {
        const { recorder } = startLmu('first');
        driveLmu(recorder, {
          crossings: 1,
          from: 0.97,
        });
        driveLmu(
          recorder,
          {
            from: 0.0002,
            crossings: 0,
          },
          500
        );
        // One more frame, on pit road.
        recorder.onFrame(
          toTelemetry({
            SessionTime: 600,
            SessionNum: 0,
            CarIdxLapDistPct: [0.3],
            CarIdxOnPitRoad: [true],
            IsOnTrack: true,
            LmuPlayerWorldPos: [0, 0, 0],
          })
        );

        expect(recorder.progress()).toBeNull();
      });
    });

    describe('sector starts', () => {
      it('places them where the car crossed, not where the index caught up', () => {
        const { recorder, sink } = startLmu();
        driveLmu(recorder, { crossings: 2 });

        const { lap } = sink.laps[0];
        expect(lap.sectorSource).toBe('learned');
        expect(lap.sectorStartPct).toHaveLength(3);
        const [line, second, third] = lap.sectorStartPct as number[];
        expect(line).toBe(0);
        // A fifth of a second at 60 m/s is twelve metres, 0.0033 of this
        // lap: that is how far out the index alone would put them.
        expect(Math.abs(second - SECOND_SECTOR_PCT)).toBeLessThan(0.0003);
        expect(Math.abs(third - THIRD_SECTOR_PCT)).toBeLessThan(0.0003);
      });

      it('takes the position on the frame where the sim gives no sector times', () => {
        const { recorder, sink } = startLmu();
        driveLmu(recorder, {
          crossings: 2,
          change: (fields) => ({ ...fields, LmuCurrentSectorTimes: [] }),
        });

        const [, second, third] = sink.laps[0].lap.sectorStartPct as number[];
        // Late by up to a scoring update, and never early.
        expect(second).toBeGreaterThanOrEqual(SECOND_SECTOR_PCT);
        expect(second - SECOND_SECTOR_PCT).toBeLessThan(0.004);
        expect(third).toBeGreaterThanOrEqual(THIRD_SECTOR_PCT);
        expect(third - THIRD_SECTOR_PCT).toBeLessThan(0.004);
      });

      it('gives none when the index did not move through the sectors in turn', () => {
        const { recorder, sink } = startLmu();
        driveLmu(recorder, {
          crossings: 2,
          // Straight from the first sector to the third.
          change: (fields) =>
            fields.LmuSectorIdx === 1 ? { ...fields, LmuSectorIdx: 0 } : fields,
        });

        expect(sink.laps).toHaveLength(1);
        expect(sink.laps[0].lap.sectorStartPct).toBeNull();
        expect(sink.laps[0].lap.sectorSource).toBeNull();
        // The elevation is no worse for it.
        expect(sink.laps[0].lap.elevationM).toHaveLength(POINTS);
      });

      it('gives none where the sim names no sector', () => {
        const { recorder, sink } = startLmu();
        driveLmu(recorder, {
          crossings: 2,
          change: (fields) => without(fields, 'LmuSectorIdx'),
        });

        expect(sink.laps[0].lap.sectorStartPct).toBeNull();
      });
    });
  });

  describe('the vertical speed of an iRacing car', () => {
    const CLIMB = Math.atan(0.02);

    it('is positive nose-up, which iRacing states as a negative pitch', () => {
      expect(verticalSpeed(50, 0, 0, -CLIMB, 0)).toBeCloseTo(
        50 * Math.sin(CLIMB),
        9
      );
      expect(verticalSpeed(50, 0, 0, CLIMB, 0)).toBeCloseTo(
        -50 * Math.sin(CLIMB),
        9
      );
    });

    it('takes the car rising on its springs as rising', () => {
      expect(verticalSpeed(50, 0, 0.4, 0, 0)).toBeCloseTo(0.4, 9);
    });

    it('takes a slide to the left on a rolled car as part of it', () => {
      expect(verticalSpeed(0, 2, 0, 0, 0.1)).toBeCloseTo(2 * Math.sin(0.1), 9);
      expect(verticalSpeed(0, 2, 0, 0, 0)).toBe(0);
    });
  });

  describe('under iRacing', () => {
    const CLIMB = Math.atan(0.02);
    const SPEED = 50;
    /** What half a lap of a 2 % climb gains. */
    const PEAK_M = (TRACK_LENGTH_M / 2) * Math.sin(CLIMB);

    interface IracingDrive {
      crossings: number;
      from?: number;
      /** m/s added to the car's upward velocity on every frame. */
      bias?: number;
      change?: (fields: Fields, moment: Moment) => Fields | null;
    }

    /** Up a 2 % hill for the first half of the lap and down it again. */
    const driveIracing = (
      recorder: TrackProfileRecorder,
      { crossings, from = 0.97, bias = 0, change }: IracingDrive,
      startTime = 100
    ): number => {
      const hz = 60;
      const step = SPEED / hz / TRACK_LENGTH_M;
      let time = startTime;
      let pct = from;
      let lap = 0;
      let crossed = 0;
      while (crossed < crossings) {
        time += 1 / hz;
        pct += step;
        if (pct >= 1) {
          pct -= 1;
          lap += 1;
          crossed += 1;
        }
        const fields: Fields = {
          SessionTime: time,
          SessionNum: 0,
          CarIdxLapDistPct: [pct],
          CarIdxOnPitRoad: [false],
          IsOnTrack: true,
          VelocityX: SPEED,
          VelocityY: 0,
          VelocityZ: bias,
          Pitch: pct < 0.5 ? -CLIMB : CLIMB,
          Roll: 0,
        };
        const sent = change
          ? change(fields, { time, lap, pct, lapClock: 0 })
          : fields;
        if (sent) recorder.onFrame(toTelemetry(sent));
      }
      return time;
    };

    const startIracing = (sectors?: number[]) => {
      const sink = createSink();
      const recorder = new TrackProfileRecorder(sink, {
        simulator: 'iracing',
      });
      recorder.onSession(session({ trackId: 18, sectors }));
      recorder.onEnter();
      return { recorder, sink };
    };

    it('adds the vertical speed up into a profile that closes', () => {
      const { recorder, sink } = startIracing();
      driveIracing(recorder, { crossings: 2 });

      expect(sink.laps).toHaveLength(1);
      const { lap } = sink.laps[0];
      expect(lap.source).toBe('integrated');
      expect(lap.xM).toBeNull();
      expect(lap.zM).toBeNull();
      expect(lap.elevationM).toHaveLength(POINTS);
      const peak = Math.max(...lap.elevationM);
      expect(Math.abs(peak - PEAK_M) / PEAK_M).toBeLessThan(0.01);
      // Zero at the line, and back to it.
      expect(Math.abs(lap.elevationM[0])).toBeLessThan(0.1);
      expect(Math.abs(lap.elevationM[POINTS - 1])).toBeLessThan(0.3);
      expect(lap.closureM).toBeLessThan(0.1);
    });

    it('takes what the sum is out by back out along the lap', () => {
      const { recorder, sink } = startIracing();
      // A car that reads 5 cm/s of climb it is not doing: 3.6 m by the
      // end of a 72 s lap.
      driveIracing(recorder, { crossings: 2, bias: 0.05 });

      const { lap } = sink.laps[0];
      expect(lap.closureM).toBeCloseTo((0.05 * TRACK_LENGTH_M) / SPEED, 1);
      const peak = Math.max(...lap.elevationM);
      expect(Math.abs(peak - PEAK_M) / PEAK_M).toBeLessThan(0.01);
      expect(Math.abs(lap.elevationM[POINTS - 1])).toBeLessThan(0.3);
    });

    it('reports how far out a lap was, for the store to refuse it', () => {
      const { recorder, sink } = startIracing();
      driveIracing(recorder, {
        crossings: 2,
        bias: (6 * SPEED) / TRACK_LENGTH_M,
      });

      expect(sink.laps[0].lap.closureM).toBeCloseTo(6, 1);
    });

    it('passes on the sector starts the session states', () => {
      const { recorder, sink } = startIracing([0, 0.31, 0.68, 0.9]);
      driveIracing(recorder, { crossings: 2 });

      expect(sink.laps[0].lap.sectorStartPct).toEqual([0, 0.31, 0.68, 0.9]);
      expect(sink.laps[0].lap.sectorSource).toBe('session');
    });

    it('passes on none when the session states none that begin at the line', () => {
      const { recorder, sink } = startIracing([0.1, 0.5]);
      driveIracing(recorder, { crossings: 2 });

      expect(sink.laps[0].lap.sectorStartPct).toBeNull();
      expect(sink.laps[0].lap.sectorSource).toBeNull();
    });

    it('drops a lap with a frame that states no pitch', () => {
      const { recorder, sink } = startIracing();
      driveIracing(recorder, {
        crossings: 3,
        change: (fields, { lap, pct }) => {
          if (lap !== 1 || pct < 0.4 || pct >= 0.41) return fields;
          return without(fields, 'Pitch');
        },
      });

      expect(sink.laps).toHaveLength(1);
    });

    it('drops a lap with a gap too long to add up across', () => {
      const { recorder, sink } = startIracing();
      driveIracing(recorder, {
        crossings: 3,
        // The sim paused for a second on the first lap: the clock is a
        // second on from there, and the car where it was.
        change: (fields, { lap, pct, time }) =>
          lap > 1 || (lap === 1 && pct >= 0.4)
            ? { ...fields, SessionTime: time + 1 }
            : fields,
      });

      // The second lap, and only it.
      expect(sink.laps).toHaveLength(1);
      expect(sink.laps[0].lap.closureM).toBeLessThan(0.1);
    });
  });
});
