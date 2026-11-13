import { describe, expect, it } from 'vitest';
import type { LovelyTrackSection, ReferenceLap } from '@irdashies/types';
import type { TrackCorner } from '../corners/trackCorners';
import type { CornerFigures } from './cornerPassTracker';
import {
  NO_CORNER_READING,
  cornerResultFrom,
  cornerSpanOf,
  readAgainstLap,
  readAgainstPass,
  timeableCorners,
} from './cornerReadings';

const TRACK_M = 4000;
const POINTS = 400;

/**
 * A lap driven at one speed, sampled the way the recorder samples: one point
 * per ten-metre bucket, somewhere inside it.
 */
const steadyLap = (
  speedKph: number,
  options: { withSpeeds?: boolean } = {}
): ReferenceLap => {
  const lapTime = TRACK_M / (speedKph / 3.6);
  const pointPos = new Float32Array(POINTS);
  const times = new Float32Array(POINTS);
  const tangents = new Float32Array(POINTS).fill(lapTime);
  const speedsKph = new Float32Array(POINTS).fill(speedKph);
  for (let index = 0; index < POINTS; index += 1) {
    const pct = (index + 0.3) / POINTS;
    pointPos[index] = pct;
    times[index] = pct * lapTime;
  }
  return {
    pointPos,
    times,
    tangents,
    interval: 1 / POINTS,
    pointsCount: POINTS,
    startTime: 500,
    finishTime: 500 + lapTime,
    lastTrackedPct: 0.999,
    isCleanLap: true,
    ...(options.withSpeeds === false ? {} : { speedsKph }),
  };
};

const corner = (overrides: Partial<TrackCorner> = {}): TrackCorner =>
  ({
    section_id: 'turn-1',
    name: 'Turn 1',
    corner_number: 'T1',
    type: 'corner',
    start_pct: 0.2,
    end_pct: 0.25,
    length_pct: 0.05,
    label: 'T1',
    ...overrides,
  }) as LovelyTrackSection & { label: string };

/** Two hundred metres at 50 m/s, in at 50 and out at 55. */
const pass: CornerFigures = {
  timeSec: 4,
  entrySpeedMs: 50,
  exitSpeedMs: 55,
};

describe('readAgainstLap', () => {
  it('sets the corner against the same stretch of the recorded lap', () => {
    // 144 km/h is 40 m/s: the lap took five seconds over these 200 m.
    const reading = readAgainstLap(
      pass,
      cornerSpanOf(corner()),
      steadyLap(144)
    );

    expect(reading.timeDeltaSec).toBeCloseTo(-1, 2);
    // 180 km/h in against 144, 198 out against 144.
    expect(reading.entrySpeedDeltaKph).toBeCloseTo(36, 3);
    expect(reading.exitSpeedDeltaKph).toBeCloseTo(54, 3);
  });

  it('reads a corner across the line from the end and the start of the lap', () => {
    // 0.98 to 0.02: 160 m, four seconds at 40 m/s.
    const span = cornerSpanOf(corner({ start_pct: 0.98, end_pct: 0.02 }));
    const reading = readAgainstLap(
      { ...pass, timeSec: 3.5 },
      span,
      steadyLap(144)
    );

    expect(reading.timeDeltaSec).toBeCloseTo(-0.5, 2);
  });

  it('has nothing to say without a lap', () => {
    expect(readAgainstLap(pass, cornerSpanOf(corner()), null)).toBe(
      NO_CORNER_READING
    );
  });

  it('gives the time alone against a lap recorded without speeds', () => {
    const reading = readAgainstLap(
      pass,
      cornerSpanOf(corner()),
      steadyLap(144, { withSpeeds: false })
    );

    expect(reading.timeDeltaSec).toBeCloseTo(-1, 2);
    expect(reading.entrySpeedDeltaKph).toBeNull();
    expect(reading.exitSpeedDeltaKph).toBeNull();
  });

  it('leaves each speed out where the lap has none at that end', () => {
    const lap = steadyLap(144);
    // The lap was already under way when its speeds began to be recorded.
    (lap.speedsKph as Float32Array).fill(0, 0, 90);
    const reading = readAgainstLap(pass, cornerSpanOf(corner()), lap);

    expect(reading.entrySpeedDeltaKph).toBeNull();
    expect(reading.exitSpeedDeltaKph).toBeCloseTo(54, 3);
    expect(reading.timeDeltaSec).toBeCloseTo(-1, 2);
  });

  it('gives no time against a lap that was never finished', () => {
    const lap = { ...steadyLap(144), finishTime: -1 };
    const reading = readAgainstLap(pass, cornerSpanOf(corner()), lap);

    expect(reading.timeDeltaSec).toBeNull();
    // The speeds were recorded all the same.
    expect(reading.entrySpeedDeltaKph).toBeCloseTo(36, 3);
  });

  it('blanks a time more than ten seconds out and keeps the speeds', () => {
    const reading = readAgainstLap(
      { ...pass, timeSec: 16 },
      cornerSpanOf(corner()),
      steadyLap(144)
    );

    expect(reading.timeDeltaSec).toBeNull();
    expect(reading.entrySpeedDeltaKph).toBeCloseTo(36, 3);
  });
});

describe('readAgainstPass', () => {
  it('sets the corner against the last time it was driven', () => {
    const reading = readAgainstPass(pass, {
      timeSec: 4.25,
      entrySpeedMs: 49,
      exitSpeedMs: 56,
    });

    expect(reading.timeDeltaSec).toBeCloseTo(-0.25, 9);
    expect(reading.entrySpeedDeltaKph).toBeCloseTo(3.6, 9);
    expect(reading.exitSpeedDeltaKph).toBeCloseTo(-3.6, 9);
  });

  it('has nothing to say the first time through', () => {
    expect(readAgainstPass(pass, null)).toBe(NO_CORNER_READING);
  });

  it('blanks a time more than ten seconds out', () => {
    const reading = readAgainstPass(pass, { ...pass, timeSec: 15 });

    expect(reading.timeDeltaSec).toBeNull();
    expect(reading.entrySpeedDeltaKph).toBe(0);
  });
});

describe('timeableCorners', () => {
  it('keeps a corner of a sensible length, and one across the line', () => {
    const corners = [
      corner(),
      corner({ section_id: 'last', start_pct: 0.98, end_pct: 0.02 }),
    ];

    expect(timeableCorners(corners, TRACK_M)).toEqual(corners);
  });

  it('leaves out what is not a corner to time', () => {
    const corners = [
      // Eight metres.
      corner({ section_id: 'noise', start_pct: 0.5, end_pct: 0.502 }),
      corner({ section_id: 'half-the-lap', start_pct: 0.1, end_pct: 0.7 }),
      corner({ section_id: 'no-length', start_pct: 0.3, end_pct: 0.3 }),
      corner({ section_id: 'not-a-number', start_pct: Number.NaN }),
    ];

    expect(timeableCorners(corners, TRACK_M)).toEqual([]);
  });

  it('skips the ten-metre test where the track length is not known', () => {
    const short = corner({ start_pct: 0.5, end_pct: 0.502 });

    expect(timeableCorners([short], Number.NaN)).toEqual([short]);
    expect(timeableCorners([short], 0)).toEqual([short]);
  });
});

describe('cornerResultFrom', () => {
  it('carries what was driven and a reading against every reference', () => {
    const result = cornerResultFrom(
      {
        ...pass,
        cornerIndex: 0,
        previous: { timeSec: 4.1, entrySpeedMs: 50, exitSpeedMs: 54 },
      },
      corner({ label: 'Turn One' }),
      { sessionBest: steadyLap(144), allTime: null },
      7
    );

    expect(result.serial).toBe(7);
    expect(result.sectionId).toBe('turn-1');
    expect(result.label).toBe('Turn One');
    expect(result.timeSec).toBe(4);
    expect(result.entrySpeedKph).toBeCloseTo(180, 9);
    expect(result.exitSpeedKph).toBeCloseTo(198, 9);
    expect(result.readings.sessionBest.timeDeltaSec).toBeCloseTo(-1, 2);
    // No all-time lap: dashes, not the session best in its place.
    expect(result.readings.allTime).toBe(NO_CORNER_READING);
    expect(result.readings.lastLap.timeDeltaSec).toBeCloseTo(-0.1, 9);
    expect(result.readings.lastLap.exitSpeedDeltaKph).toBeCloseTo(3.6, 9);
  });
});
