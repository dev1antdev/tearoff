import { describe, expect, it } from 'vitest';
import { HybridLapAccount, type HybridLapSample } from './hybridLap';

/**
 * The account on its own, as the per-lap ledger would drive it. The rules a
 * driver sees are pinned through the processor in HybridProcessor.spec.ts;
 * these are the ones only a second caller would meet. All of it on invented
 * samples: no recording holds a hybrid car.
 */

const TRACK_M = 1000;

/** Feeds an account samples a tenth of a second apart. */
class Feed {
  readonly account = new HybridLapAccount();
  time = 50;
  lap = 0;

  constructor(trackLengthM = TRACK_M) {
    this.account.setTrackLength(trackLengthM);
  }

  sample(
    chargePct: number,
    lapDistM: number,
    extra: Partial<HybridLapSample> = {}
  ) {
    this.time += 0.1;
    this.account.step({
      sessionTime: this.time,
      chargePct,
      simState: 1,
      lapCompleted: this.lap,
      lapDistM,
      onPitRoad: false,
      ...extra,
    });
    return this.account;
  }

  /** A lap from the line, a sample every `everyM`, at the charge given. */
  driveLap(chargeAt: (metres: number) => number, everyM = 10, untilM = 990) {
    this.lap += 1;
    for (let metres = 0; metres <= untilM; metres += everyM) {
      this.sample(chargeAt(metres), metres);
    }
    return this.account;
  }
}

/** Falls by 10 over the lap, evenly. */
const steadyDrain = (from: number) => (metres: number) =>
  from - (metres / TRACK_M) * 10;

describe('HybridLapAccount', () => {
  it('starts with nothing', () => {
    const account = new HybridLapAccount();

    expect(account).toMatchObject({
      drainLapPct: 0,
      regenLapPct: 0,
      drainLastLapPct: null,
      regenLastLapPct: null,
      netLapEstimatePct: null,
      deployTimeLapS: 0,
      sinceDeployS: null,
      motorState: 0,
      lapStartTime: null,
    });
  });

  it('takes the first sample as a baseline, not a step', () => {
    const feed = new Feed();
    const account = feed.sample(64, 500);

    expect(account.drainLapPct).toBe(0);
    expect(account.regenLapPct).toBe(0);
    expect(account.motorState).toBe(1);
  });

  it('takes the sample after an interruption as a baseline too', () => {
    const feed = new Feed();
    feed.sample(64, 500);
    feed.sample(63, 510);
    feed.account.interrupt();
    // The charge moved while nobody was looking.
    feed.sample(50, 520);

    expect(feed.account.drainLapPct).toBeCloseTo(1, 9);
    expect(feed.sample(49.5, 530).drainLapPct).toBeCloseTo(1.5, 9);
  });

  it('adds nothing for the same moment given twice', () => {
    const feed = new Feed();
    feed.sample(64, 500, { simState: 2 });
    feed.sample(63, 510, { simState: 2 });
    feed.time -= 0.1;
    const account = feed.sample(60, 520, { simState: 2 });

    expect(account.drainLapPct).toBeCloseTo(1, 9);
    expect(account.deployTimeLapS).toBeCloseTo(0.1, 9);
  });

  it('measures a lap against the one before, between its points', () => {
    const feed = new Feed();
    feed.sample(60, 980);
    feed.sample(60, 990);
    // A lap that uses 10, a point every 10 m, then one sampled between them.
    feed.driveLap(steadyDrain(60));
    feed.lap += 1;
    feed.sample(50.1, 0);
    feed.sample(50.1, 4);
    feed.sample(50.1, 8);
    feed.sample(50.1, 12);
    const account = feed.sample(47.1, 255);

    // The lap before ended on -9.9 and was at -2.55 here; this one is at -3.
    expect(account.drainLapPct).toBeCloseTo(3, 6);
    expect(account.netLapEstimatePct).toBeCloseTo(-9.9 + (-3 + 2.55), 4);
  });

  it('holds the estimate at the reference lap’s end beyond its last point', () => {
    const feed = new Feed();
    feed.sample(60, 990);
    feed.driveLap(steadyDrain(60), 10, 900);
    feed.lap += 1;
    feed.sample(51, 0);
    feed.sample(51, 100);
    feed.sample(51, 300);
    feed.sample(51, 500);
    // Further round than the lap before was ever sampled.
    const account = feed.sample(41, 960);

    // That lap was at -9 where its trace ends, which is its total.
    expect(account.netLapEstimatePct).toBeCloseTo(-9 + (-10 + 9), 4);
  });

  it('forgets the lap it measured against when the track changes', () => {
    const feed = new Feed();
    feed.sample(60, 990);
    feed.driveLap(steadyDrain(60));
    feed.driveLap(steadyDrain(50.1), 10, 300);
    expect(feed.account.netLapEstimatePct).not.toBeNull();

    feed.account.setTrackLength(5400);
    expect(feed.account.netLapEstimatePct).toBeNull();
    // The totals are the battery's, not the track's, and stand.
    expect(feed.account.drainLastLapPct).toBeCloseTo(9.9, 6);
  });

  it('keeps the lap it measured against when the same track is set again', () => {
    const feed = new Feed();
    feed.sample(60, 990);
    feed.driveLap(steadyDrain(60));
    feed.driveLap(steadyDrain(50.1), 10, 300);
    const before = feed.account.netLapEstimatePct;

    feed.account.setTrackLength(TRACK_M);
    expect(feed.account.netLapEstimatePct).toBe(before);
  });

  it('does not measure against a lap longer than its trace has room for', () => {
    // A 50 m "track" has room for 74 points; this lap runs 1000 m without
    // the count moving, as a car lost on a layout the session misdescribes.
    const feed = new Feed(50);
    feed.sample(60, 40);
    feed.driveLap(steadyDrain(60), 5);
    feed.driveLap(steadyDrain(50), 5, 300);

    expect(feed.account.drainLastLapPct).toBeCloseTo(9.9, 6);
    expect(feed.account.netLapEstimatePct).toBeNull();
  });

  it('does not take a lap count that goes back for a lap', () => {
    const feed = new Feed();
    feed.sample(60, 990);
    feed.driveLap(steadyDrain(60), 10, 500);
    feed.lap -= 1;
    feed.sample(54, 510);

    // Nothing turned over: the lap's total runs on.
    expect(feed.account.drainLapPct).toBeCloseTo(6, 6);
    expect(feed.account.drainLastLapPct).toBe(0);
    // Nor is the lap it happened on one to measure against.
    feed.lap += 2;
    feed.sample(54, 0);
    feed.sample(53, 100);
    expect(feed.account.netLapEstimatePct).toBeNull();
  });

  it('goes back to nothing on a reset, and keeps the track', () => {
    const feed = new Feed();
    feed.sample(60, 990);
    feed.driveLap(steadyDrain(60));
    feed.driveLap(steadyDrain(50.1), 10, 300);
    feed.account.reset();

    expect(feed.account).toMatchObject({
      drainLapPct: 0,
      drainLastLapPct: null,
      netLapEstimatePct: null,
      motorState: 0,
      lapStartTime: null,
    });

    // Two laps on, there is a lap to measure against again.
    feed.sample(47, 990);
    feed.driveLap(steadyDrain(47));
    feed.driveLap(steadyDrain(37.1), 10, 300);
    expect(feed.account.netLapEstimatePct).toBeCloseTo(-9.9, 4);
  });
});
