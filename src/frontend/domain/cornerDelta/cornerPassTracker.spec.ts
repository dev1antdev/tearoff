import { describe, expect, it } from 'vitest';
import {
  CornerPassTracker,
  type CornerPass,
  type CornerSample,
  type CornerSpan,
} from './cornerPassTracker';

const TRACK_M = 4000;

/** A corner from 800 m to 1000 m: two hundred metres. */
const TURN_ONE: CornerSpan = { startPct: 0.2, endPct: 0.25 };

interface Drive {
  tracker: CornerPassTracker;
  /** Where the car is, as a lap fraction; moved on by every frame. */
  pct: number;
  /** The session clock. */
  time: number;
  passes: CornerPass[];
}

const start = (
  corners: CornerSpan[],
  atPct: number,
  options = { trackLengthM: TRACK_M }
): Drive => ({
  tracker: new CornerPassTracker(corners, options),
  pct: atPct,
  time: 100,
  passes: [],
});

const push = (drive: Drive, sample: Partial<CornerSample> = {}) => {
  drive.passes.push(
    ...drive.tracker.push({
      sessionTime: drive.time,
      lapDistPct: drive.pct,
      speedMs: 50,
      driving: true,
      ...sample,
    })
  );
};

/**
 * Drives on by a distance at a speed, a frame at a time. The speed may change
 * along the way: it is asked for at the start of every frame.
 */
const go = (
  drive: Drive,
  metres: number,
  speedAt: number | ((drivenM: number) => number) = 50,
  hz = 60
) => {
  let driven = 0;
  while (driven < metres) {
    const speedMs = typeof speedAt === 'number' ? speedAt : speedAt(driven);
    const step = speedMs / hz;
    driven += step;
    drive.time += 1 / hz;
    drive.pct = (drive.pct + step / TRACK_M) % 1;
    const next = typeof speedAt === 'number' ? speedAt : speedAt(driven);
    push(drive, { speedMs: next });
  }
};

describe('CornerPassTracker', () => {
  it('times a corner from its start to its end', () => {
    // Started off the frame grid, so neither end of the corner falls on a
    // frame: at 50 m/s a frame is 0.83 m and the corner 200 m.
    const drive = start([TURN_ONE], 0.1873);
    push(drive);
    go(drive, 400);

    expect(drive.passes).toHaveLength(1);
    const [pass] = drive.passes;
    expect(pass.cornerIndex).toBe(0);
    // 200 m at 50 m/s, to well inside a frame's 16.7 ms.
    expect(pass.timeSec).toBeCloseTo(4, 6);
    expect(pass.entrySpeedMs).toBeCloseTo(50, 6);
    expect(pass.exitSpeedMs).toBeCloseTo(50, 6);
    expect(pass.previous).toBeNull();
  });

  it('reads the speeds at the two ends, not at the frames after them', () => {
    // Braking from 80 m/s at 0.2 m/s per metre: about 16 m/s every second,
    // so a frame late would be a quarter of a metre per second out.
    const drive = start([TURN_ONE], 0.19);
    const speedAt = (driven: number) => 80 - 0.2 * driven;
    push(drive, { speedMs: speedAt(0) });
    go(drive, 280, speedAt);

    expect(drive.passes).toHaveLength(1);
    // The corner starts 40 m on and ends 240 m on.
    expect(drive.passes[0].entrySpeedMs).toBeCloseTo(72, 1);
    expect(drive.passes[0].exitSpeedMs).toBeCloseTo(32, 1);
  });

  it('reports nothing for a corner it did not see the start of', () => {
    const drive = start([TURN_ONE], 0.22);
    push(drive);
    go(drive, 400);

    expect(drive.passes).toHaveLength(0);
  });

  it('hands back how the corner was driven the time before', () => {
    const drive = start([TURN_ONE], 0.15);
    push(drive);
    go(drive, 600, 50);
    // Round the rest of the lap and through it again, quicker.
    go(drive, TRACK_M, 62.5);

    expect(drive.passes).toHaveLength(2);
    const [first, second] = drive.passes;
    expect(second.timeSec).toBeCloseTo(3.2, 6);
    expect(second.previous).toEqual({
      timeSec: first.timeSec,
      entrySpeedMs: first.entrySpeedMs,
      exitSpeedMs: first.exitSpeedMs,
    });
  });

  it('times a corner that straddles the start/finish line', () => {
    const drive = start([{ startPct: 0.98, endPct: 0.02 }], 0.95);
    push(drive);
    go(drive, 400);

    expect(drive.passes).toHaveLength(1);
    // 160 m at 50 m/s.
    expect(drive.passes[0].timeSec).toBeCloseTo(3.2, 6);
  });

  it('enters a corner at the very point the one before it ended', () => {
    const corners = [
      { startPct: 0.2, endPct: 0.25 },
      { startPct: 0.25, endPct: 0.3 },
    ];
    const drive = start(corners, 0.18);
    push(drive);
    go(drive, 600);

    expect(drive.passes.map((pass) => pass.cornerIndex)).toEqual([0, 1]);
    // No time between the two: together they are the 400 m they cover.
    expect(drive.passes[0].timeSec + drive.passes[1].timeSec).toBeCloseTo(8, 6);
    expect(drive.passes[1].timeSec).toBeCloseTo(4, 6);
  });

  it('finds both ends of a short corner inside one slow frame', () => {
    // Twelve metres of corner and sixteen metres to a frame, as when the
    // stream is delivered at five frames a second.
    const drive = start([{ startPct: 0.2, endPct: 0.203 }], 0.19);
    push(drive, { speedMs: 80 });
    go(drive, 100, 80, 5);

    expect(drive.passes).toHaveLength(1);
    expect(drive.passes[0].timeSec).toBeCloseTo(12 / 80, 6);
  });

  it('drops a corner left through the pit lane', () => {
    const drive = start([TURN_ONE], 0.19);
    push(drive);
    go(drive, 100);
    // Into the pit lane with the corner half done.
    drive.pct += 0.001;
    push(drive, { driving: false });
    go(drive, 300);

    expect(drive.passes).toHaveLength(0);
  });

  it('keeps how a corner was last driven through a pit stop', () => {
    const drive = start([TURN_ONE], 0.19);
    push(drive);
    go(drive, 300);
    push(drive, { driving: false });
    go(drive, TRACK_M);

    expect(drive.passes).toHaveLength(2);
    expect(drive.passes[1].previous?.timeSec).toBeCloseTo(
      drive.passes[0].timeSec,
      9
    );
  });

  it('drops a corner the car was moved back in', () => {
    // A long corner, 400 m, so the car can be put back and still be in it.
    const drive = start([{ startPct: 0.2, endPct: 0.3 }], 0.19);
    push(drive);
    go(drive, 400);
    // Reset two hundred metres back: past any slide, and still mid-corner.
    drive.pct -= 200 / TRACK_M;
    drive.time += 1 / 60;
    push(drive);
    go(drive, 300);

    // Reaching the corner's end from there is not a pass through it.
    expect(drive.passes).toHaveLength(0);
  });

  it('times the corner afresh after a tow back to the pits', () => {
    const drive = start([TURN_ONE], 0.19);
    push(drive);
    go(drive, 100);
    // Back to the pit box, a third of a lap behind, and round again.
    drive.pct = 0.9;
    drive.time += 1 / 60;
    push(drive);
    go(drive, TRACK_M * 0.36);

    // One pass, and it is the whole corner: not from the first entry.
    expect(drive.passes).toHaveLength(1);
    expect(drive.passes[0].timeSec).toBeCloseTo(4, 6);
  });

  it('drops a corner the car jumped forward out of', () => {
    const drive = start([TURN_ONE], 0.19);
    push(drive);
    go(drive, 100);
    drive.pct = 0.4;
    drive.time += 1 / 60;
    push(drive);
    go(drive, 100);

    expect(drive.passes).toHaveLength(0);
  });

  it('rides out the small steps back Le Mans Ultimate makes', () => {
    const drive = start([TURN_ONE], 0.19);
    push(drive);
    go(drive, 100);
    // Half a metre back, as when the sim corrects the lap fraction.
    drive.pct -= 0.5 / TRACK_M;
    drive.time += 1 / 60;
    push(drive);
    go(drive, 300);

    expect(drive.passes).toHaveLength(1);
    // A frame and half a metre longer than a clean run, not a corner lost.
    expect(drive.passes[0].timeSec).toBeGreaterThan(4);
    expect(drive.passes[0].timeSec).toBeLessThan(4.05);
  });

  it('drops a corner the stream stalled in', () => {
    const drive = start([TURN_ONE], 0.19);
    push(drive);
    go(drive, 100);
    // Nothing for a second, then the car a little further on.
    drive.time += 1;
    drive.pct += 0.005;
    push(drive);
    go(drive, 300);

    expect(drive.passes).toHaveLength(0);
  });

  it('does not report a corner the car came to a stop in', () => {
    const drive = start([TURN_ONE], 0.19);
    push(drive);
    go(drive, 100);
    // Spun to a halt, sat there, then drove on.
    for (let frame = 0; frame < 120; frame += 1) {
      drive.time += 1 / 60;
      push(drive, { speedMs: 0 });
    }
    go(drive, 300);
    expect(drive.passes).toHaveLength(0);

    // And it is not what the next pass is measured against.
    go(drive, TRACK_M);
    expect(drive.passes).toHaveLength(1);
    expect(drive.passes[0].previous).toBeNull();
  });

  it('takes a lap fraction of exactly 0 as no position', () => {
    // Le Mans Ultimate holds a car at 0 until it first reaches the line.
    const drive = start([{ startPct: 0.001, endPct: 0.05 }], 0);
    for (let frame = 0; frame < 10; frame += 1) {
      drive.time += 1 / 60;
      push(drive, { lapDistPct: 0 });
    }
    drive.pct = 0.0005;
    go(drive, 300);

    // Seen from 0.0005 on, so the corner's start was crossed while driving.
    expect(drive.passes).toHaveLength(1);
    expect(drive.passes[0].timeSec).toBeCloseTo(196 / 50, 1);
  });

  it('forgets what was driven when the session clock runs backwards', () => {
    const drive = start([TURN_ONE], 0.19);
    push(drive);
    go(drive, 300);
    expect(drive.passes).toHaveLength(1);

    // The session was restarted.
    drive.time = 5;
    drive.pct = 0.19;
    push(drive);
    go(drive, 300);

    expect(drive.passes).toHaveLength(2);
    expect(drive.passes[1].previous).toBeNull();
  });

  it('forgets everything on a reset', () => {
    const drive = start([TURN_ONE], 0.19);
    push(drive);
    go(drive, 300);

    drive.tracker.reset();
    go(drive, TRACK_M);

    expect(drive.passes).toHaveLength(2);
    expect(drive.passes[1].previous).toBeNull();
  });

  it('judges a step back by the lap fraction when the length is unknown', () => {
    const drive = start([TURN_ONE], 0.19, { trackLengthM: 0 });
    push(drive);
    go(drive, 100);
    // Sixty metres back: a tow on a track of known length, inside the two
    // percent allowed where it is not.
    drive.pct -= 60 / TRACK_M;
    drive.time += 1 / 60;
    push(drive);
    go(drive, 400);

    expect(drive.passes).toHaveLength(1);
  });

  it('ignores a corner of no length', () => {
    const drive = start([{ startPct: 0.2, endPct: 0.2 }], 0.19);
    push(drive);
    go(drive, TRACK_M);

    expect(drive.passes).toHaveLength(0);
  });
});
