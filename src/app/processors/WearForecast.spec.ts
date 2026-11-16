import { describe, expect, it } from 'vitest';
import { DEFAULT_WEAR_TUNING, type WearForecastTuning } from '@irdashies/types';
import {
  createMeterReading,
  type MeterReading,
  type WearCurves,
} from './LapCostMeter';
import { EMPTY_LEDGER_RATES, type LedgerRates } from './ledgerRates';
import {
  blendWithLastLap,
  BRAKE_STALE_AFTER_S,
  brakeLifePct,
  createWearFrame,
  lapsLeftAt,
  levelAfter,
  projectFromFraction,
  projectFromReference,
  WearForecast,
  type WearContext,
  type WearFrame,
} from './WearForecast';

describe('what a lap is heading for', () => {
  it('is the reference lap moved by how this one compares at the same point', () => {
    // 0.50 for the reference lap, 0.20 of it by half-way; this lap has
    // worn 0.26 by then, so it is heading for 0.06 more.
    expect(projectFromReference(0.5, 0.2, 0.26)).toBeCloseTo(0.56, 9);
    // A gentler lap is heading for less.
    expect(projectFromReference(0.5, 0.2, 0.15)).toBeCloseTo(0.45, 9);
  });

  it('is never less than what has already gone', () => {
    expect(projectFromReference(0.5, 0.49, 0.7)).toBeCloseTo(0.71, 9);
    expect(projectFromReference(0.1, 0.4, 0.35)).toBe(0.35);
  });

  it('moves from the lap before to this one by the square of the lap done', () => {
    // Half-way round with 0.10 gone against 0.60 last lap.
    expect(blendWithLastLap(0.1, 0.6, 0.5)).toBeCloseTo(0.475, 9);
    expect(blendWithLastLap(0.1, 0.6, 0)).toBe(0.6);
    expect(blendWithLastLap(0.55, 0.6, 1)).toBeCloseTo(0.55, 9);
    // Already past the last lap: its own figure.
    expect(blendWithLastLap(0.7, 0.6, 0.8)).toBe(0.7);
  });

  it('with no lap to go by, is what has gone over the share of the lap done', () => {
    expect(projectFromFraction(0.2, 0.4)).toBeCloseTo(0.5, 9);
    // Not before a quarter of the lap: one corner says nothing of the rest.
    expect(projectFromFraction(0.05, 0.2)).toBeNull();
    expect(projectFromFraction(0.12, 0.25)).toBeCloseTo(0.48, 9);
  });
});

describe('how long it lasts', () => {
  it('is the level above the floor over the wear a lap', () => {
    // Percent, as the widget shows it, and as a share of the tyre.
    expect(lapsLeftAt(62, 0, 0.5)).toBe(124);
    expect(lapsLeftAt(62, 20, 0.5)).toBe(84);
    expect(lapsLeftAt(0.62, 0.2, 0.005)).toBe(84);
    // Whole laps: the one it would not finish is not counted.
    expect(lapsLeftAt(62, 0, 0.7)).toBe(88);
  });

  it('is unknown without a rate, and none at or below the floor', () => {
    expect(lapsLeftAt(62, 0, null)).toBeNull();
    expect(lapsLeftAt(20, 20, 0.5)).toBe(0);
    expect(lapsLeftAt(18, 20, 0.5)).toBe(0);
  });

  it('never exceeds 999', () => {
    expect(lapsLeftAt(97, 0, 0.001)).toBe(999);
    // A lap that wore nothing measurable is no reason to divide by zero.
    expect(lapsLeftAt(97, 0, 0)).toBe(999);
  });

  it('gives what is left when the fuel or energy runs out', () => {
    expect(levelAfter(62, 0.5, 14)).toBe(55);
    expect(levelAfter(3, 0.5, 14)).toBe(0);
    expect(levelAfter(62, null, 14)).toBeNull();
    expect(levelAfter(62, 0.5, null)).toBeNull();
  });

  it('gives the usable disc left between a new one and the failure thickness', () => {
    expect(brakeLifePct(31, 30, 32)).toBe(50);
    expect(lapsLeftAt(31, 30, 0.01)).toBe(100);
    expect(brakeLifePct(36, 30, 36)).toBe(100);
    expect(brakeLifePct(29.5, 30, 32)).toBe(0);
    // Without a failure thickness, or a new one, there is no share to give.
    expect(brakeLifePct(31, null, 32)).toBeNull();
    expect(brakeLifePct(31, 30, null)).toBeNull();
    expect(brakeLifePct(31, 30, 30)).toBeNull();
  });
});

const CAR = 'Ferrari 296 LMGT3 Evo';

const rates = (over: Partial<LedgerRates> = {}): LedgerRates => ({
  ...EMPTY_LEDGER_RATES,
  ...over,
});

/** Clean laps on these tyres and discs: half a percent and 2 or 1 um a lap. */
const MEASURED = rates({
  lapTime: 90,
  tread: [0.005, 0.005, 0.005, 0.005],
  treadSource: ['tyre', 'tyre', 'tyre', 'tyre'],
  brake: [0.002, 0.002, 0.001, 0.001],
  source: 'stint',
});

interface SetupOptions {
  className?: string | null;
  brakeDiscNewMm?: number[] | null;
  carKey?: string;
}

/**
 * A forecast fed by hand: a reading and a frame that are changed and handed
 * over a tenth of a second apart, a meter that says what the test tells it
 * to, and a store that only takes notes.
 */
const setup = ({
  className = 'LMGT3',
  brakeDiscNewMm = [36, 36, 32, 32],
  carKey = CAR,
}: SetupOptions = {}) => {
  const lapTread = new Float64Array(4);
  const lapBrake = new Float64Array(4);
  const meter = {
    curves: null as WearCurves | null,
    lapTreadUsed: () => lapTread,
    lapBrakeUsed: () => lapBrake,
    referenceCurves: () => meter.curves,
  };
  const stored = new Map<string, number>();
  const forecast = new WearForecast(meter, {
    simulator: 'lmu',
    limits: {
      get: (key) => stored.get(key),
      set: (key, mm) => void stored.set(key, mm),
    },
  });
  forecast.setCar({ carKey, className, brakeDiscNewMm });

  const reading = createMeterReading();
  reading.sessionTime = 100;
  reading.speed = 50;
  reading.tread = [0.62, 0.62, 0.7, 0.7];
  reading.brake = [35, 35, 31, 31];
  reading.compound = [0, 0, 0, 0];
  const frame = createWearFrame();
  frame.hasCar = true;
  frame.wearablesSeq = 1;

  /** Applies a change, moves the clock on and hands the frame over. */
  const feed = (
    change: Partial<MeterReading> = {},
    also: Partial<WearFrame> = {},
    dt = 0.1
  ) => {
    Object.assign(reading, change);
    Object.assign(frame, also);
    reading.sessionTime += dt;
    forecast.observe(reading, frame);
  };
  /** The REST API answers: the counter moves, the readings as they are. */
  const answer = (change: Partial<MeterReading> = {}, dt = 0.1) =>
    feed(change, { wearablesSeq: (frame.wearablesSeq ?? 0) + 1 }, dt);
  const snapshot = (context: Partial<WearContext> = {}) =>
    forecast.refresh({
      rates: MEASURED,
      budgetLapsLeft: 14,
      sessionNum: 0,
      tuning: DEFAULT_WEAR_TUNING,
      ...context,
    });
  feed();
  return {
    forecast,
    meter,
    lapTread,
    lapBrake,
    stored,
    reading,
    frame,
    feed,
    answer,
    snapshot,
  };
};

const tuning = (over: Partial<WearForecastTuning>): WearForecastTuning => ({
  ...DEFAULT_WEAR_TUNING,
  ...over,
});

describe('WearForecast', () => {
  describe('tyres', () => {
    it('gives the tread left, the wear a lap and the laps that makes', () => {
      const { snapshot } = setup();

      const wear = snapshot();
      expect(wear.available).toBe(true);
      expect(wear.wheels[0]).toMatchObject({
        treadPct: 62,
        treadPerLapPct: 0.5,
        treadRateSource: 'tyre',
        treadLapsLeft: 124,
        // 14 laps of fuel at half a percent a lap.
        treadEndOfStintPct: 55,
        compound: 0,
        flat: false,
      });
      expect(wear.wheels[2]).toMatchObject({
        treadPct: 70,
        treadLapsLeft: 140,
      });
      // 124 laps at 90 s are the renderer's 186 minutes.
      expect(wear.paceLapTime).toBe(90);
      expect(wear.budgetLapsLeft).toBe(14);
    });

    it('counts the laps down to the tread the driver calls finished', () => {
      const { snapshot } = setup();

      expect(
        snapshot({ tuning: tuning({ floorPct: 20 }) }).wheels[0].treadLapsLeft
      ).toBe(84);
      expect(
        snapshot({ tuning: tuning({ floorPct: 62 }) }).wheels[0].treadLapsLeft
      ).toBe(0);
    });

    it('has no forecast without a rate, and says so with nulls', () => {
      const { snapshot } = setup();

      const [wheel] = snapshot({ rates: rates() }).wheels;
      expect(wheel).toMatchObject({
        treadPct: 62,
        treadPerLapPct: null,
        treadRateSource: null,
        treadLapsLeft: null,
        treadEndOfStintPct: null,
      });
    });

    it('has no end of stint without a budget to end it', () => {
      const { snapshot } = setup();

      const [wheel] = snapshot({ budgetLapsLeft: null }).wheels;
      expect(wheel.treadEndOfStintPct).toBeNull();
      expect(wheel.treadLapsLeft).toBe(124);
    });

    it('says an estimate from earlier sessions is one', () => {
      const { snapshot } = setup();

      const wear = snapshot({
        rates: rates({
          tread: [0.004, 0.004, 0.005, 0.005],
          treadSource: ['baseline', 'baseline', 'tyre', 'tyre'],
        }),
      });
      expect(wear.wheels[0]).toMatchObject({
        treadPerLapPct: 0.4,
        treadRateSource: 'baseline',
        treadLapsLeft: 155,
      });
      expect(wear.wheels[3].treadRateSource).toBe('tyre');
    });

    it('falls back to the lap under way, once a quarter of it is driven', () => {
      const { snapshot, lapTread, feed } = setup();
      lapTread.fill(0.001);

      // A lap under way, a fifth of it done: too little to go by.
      feed({}, { lapOpen: true, lapPct: 0.2 });
      expect(snapshot({ rates: rates() }).wheels[0]).toMatchObject({
        treadLapPct: 0.1,
        treadProjectedPct: null,
        treadPerLapPct: null,
        treadLapsLeft: null,
      });

      // 0.2 percent gone at 40 percent of the lap is heading for 0.5.
      lapTread.fill(0.002);
      feed({}, { lapPct: 0.4 });
      expect(snapshot({ rates: rates() }).wheels[0]).toMatchObject({
        treadLapPct: 0.2,
        treadProjectedPct: 0.5,
        treadPerLapPct: 0.5,
        treadRateSource: 'projected',
        treadLapsLeft: 124,
      });
    });

    it('measures the lap under way against the one before, without a reference', () => {
      const { forecast, snapshot, lapTread, feed } = setup();
      // An out-lap: not a reference, but a finished lap all the same.
      forecast.noteLap([0.006, 0.006, 0.006, 0.006], [0, 0, 0, 0], false);
      lapTread.fill(0.002);
      feed({}, { lapOpen: true, lapPct: 0.5 });

      const [wheel] = snapshot({ rates: rates() }).wheels;
      // 0.20 so far against 0.60 last lap, half-way round: three parts of
      // the last lap to one of this.
      expect(wheel.treadProjectedPct).toBe(0.5);
      expect(wheel.treadRateSource).toBe('projected');
    });

    it('measures it against the reference lap, where there is one', () => {
      const { forecast, meter, snapshot, lapTread, feed } = setup();
      const points = 100;
      meter.curves = {
        points,
        tread: new Float32Array(points * 4),
        brake: new Float32Array(points * 4),
        sampled: new Uint8Array(points).fill(1),
      };
      for (let wheel = 0; wheel < 4; wheel += 1) {
        for (let point = 0; point < points; point += 1) {
          // 0.2 percent in the first half of the lap, 0.3 in the second.
          meter.curves.tread[wheel * points + point] =
            point <= 50
              ? (0.002 * point) / 50
              : 0.002 + (0.003 * (point - 50)) / 50;
        }
      }
      forecast.noteLap([0.005, 0.005, 0.005, 0.005], [0, 0, 0, 0], true);
      lapTread.fill(0.0026);
      feed({ bucket: 50 }, { lapOpen: true, lapPct: 0.5 });

      const wear = snapshot();
      expect(wear.wheels[0].treadProjectedPct).toBe(0.56);
      // The forecast keeps to the measured laps; the projection is beside it.
      expect(wear.wheels[0]).toMatchObject({
        treadPerLapPct: 0.5,
        treadRateSource: 'tyre',
      });
    });

    it('forgets the lap before and the reference of a wheel given another tyre', () => {
      const { forecast, meter, snapshot, lapTread, feed } = setup();
      const points = 10;
      meter.curves = {
        points,
        tread: new Float32Array(points * 4).fill(0.004),
        brake: new Float32Array(points * 4),
        sampled: new Uint8Array(points).fill(1),
      };
      forecast.noteLap([0.005, 0.005, 0.005, 0.005], [0, 0, 0, 0], true);

      // A new left front in the pit lane, late in the next lap. What that
      // corner wore before it was fitted says nothing of the new tyre.
      forecast.noteTyreChange(0b0001);
      lapTread.fill(0.0045);
      feed({ bucket: 9 }, { lapOpen: true, lapPct: 0.95 });
      const pitLap = snapshot({ rates: rates() });
      expect(pitLap.wheels[0]).toMatchObject({
        treadProjectedPct: null,
        treadPerLapPct: null,
      });
      expect(pitLap.wheels[1].treadProjectedPct).toBe(0.55);

      // Nor is the lap it was changed on a lap of the new tyre: on the next
      // one it has nothing to be measured against but itself.
      forecast.noteLap([0.009, 0.005, 0.005, 0.005], [0, 0, 0, 0], false);
      forecast.noteLapOpened();
      lapTread.fill(0.0005);
      feed({ bucket: 1 }, { lapPct: 0.1 });
      const early = snapshot({ rates: rates() });
      expect(early.wheels[0].treadProjectedPct).toBeNull();
      // The right front still has its reference: 0.5 for the lap, 0.4 by here.
      expect(early.wheels[1].treadProjectedPct).toBe(0.15);

      lapTread.fill(0.001);
      feed({ bucket: 5 }, { lapPct: 0.5 });
      const halfWay = snapshot({ rates: rates() });
      expect(halfWay.wheels[0]).toMatchObject({
        treadProjectedPct: 0.2,
        treadRateSource: 'projected',
      });
      expect(halfWay.wheels[1].treadProjectedPct).toBe(0.2);
    });

    it('takes a tyre fitted before a lap began as on the car for all of it', () => {
      const { forecast, snapshot, lapTread, feed } = setup();
      // Changed in the garage, with no lap under way.
      forecast.noteTyreChange(0b1111);
      forecast.noteLapOpened();
      lapTread.fill(0.002);
      feed({}, { lapOpen: true, lapPct: 0.4 });

      expect(snapshot({ rates: rates() }).wheels[0]).toMatchObject({
        treadProjectedPct: 0.5,
        treadRateSource: 'projected',
      });
      // And that lap, once driven, is the lap before the next.
      forecast.noteLap([0.005, 0.005, 0.005, 0.005], [0, 0, 0, 0], false);
      forecast.noteLapOpened();
      lapTread.fill(0);
      feed({}, { lapPct: 0.01 });
      expect(
        snapshot({ rates: rates() }).wheels[0].treadProjectedPct
      ).toBeCloseTo(0.5, 2);
    });

    it('marks a flat tyre', () => {
      const { snapshot, feed } = setup();
      feed({}, { flat: [false, true, false, false] });

      expect(snapshot().wheels.map((wheel) => wheel.flat)).toEqual([
        false,
        true,
        false,
        false,
      ]);
    });

    it('does not move the version for a change in the fourth decimal of tread', () => {
      const { snapshot, feed } = setup();
      const before = snapshot().version;

      feed({ tread: [0.62004, 0.62, 0.7, 0.7] });
      expect(snapshot().version).toBe(before);

      feed({ tread: [0.6188, 0.62, 0.7, 0.7] });
      const after = snapshot();
      expect(after.version).toBe(before + 1);
      expect(after.wheels[0].treadPct).toBe(61.9);
    });
  });

  describe('brakes', () => {
    it('gives the thickness, the usable disc left and the laps that makes', () => {
      const { snapshot } = setup();

      const wear = snapshot();
      // An LMGT3: the class figure of 30 mm under 36 and 32 mm discs.
      expect(wear.brakeNewMm).toEqual([36, 32]);
      expect(wear.brakeFailureMm).toEqual([30, 30]);
      expect(wear.brakeFailureSource).toEqual(['class', 'class']);
      expect(wear.wheels[0]).toMatchObject({
        brakeMm: 35,
        brakeLifePct: 83.3,
        brakePerLapMm: 0.002,
        brakeRateSource: 'stint',
        brakeLapsLeft: 999,
        brakeFailed: false,
      });
      expect(wear.wheels[2]).toMatchObject({
        brakeMm: 31,
        brakeLifePct: 50,
        brakePerLapMm: 0.001,
        brakeLapsLeft: 999,
      });
      expect(
        snapshot({ rates: rates({ ...MEASURED, brake: [0, 0, 0.01, 0.01] }) })
          .wheels[2].brakeLapsLeft
      ).toBe(100);
    });

    it('shows thickness and wear alone where no failure thickness is known', () => {
      const { snapshot } = setup({ className: 'LMP3' });

      const wear = snapshot();
      expect(wear.brakeFailureMm).toEqual([null, null]);
      expect(wear.brakeFailureSource).toEqual([null, null]);
      expect(wear.wheels[0]).toMatchObject({
        brakeMm: 35,
        brakePerLapMm: 0.002,
        brakeLifePct: null,
        brakeLapsLeft: null,
        brakeFailed: false,
      });
    });

    it('takes the setting before what was learned, and that before the class', () => {
      const { snapshot, stored } = setup();
      stored.set(`lmu|${CAR}|front`, 28.5);

      const learned = snapshot();
      expect(learned.brakeFailureMm).toEqual([28.5, 30]);
      expect(learned.brakeFailureSource).toEqual(['learned', 'class']);

      const set = snapshot({
        tuning: tuning({ failureFrontMm: 27, failureRearMm: 29.5 }),
      });
      expect(set.brakeFailureMm).toEqual([27, 29.5]);
      expect(set.brakeFailureSource).toEqual(['setting', 'setting']);
      // 35 mm of a 36 mm disc that is finished at 27.
      expect(set.wheels[0].brakeLifePct).toBe(88.9);
    });

    it('keeps what was learned by car and axle, not by track', () => {
      const { snapshot, stored } = setup({
        carKey: 'Oreca 07',
        className: 'LMP2',
      });
      stored.set(`lmu|${CAR}|front`, 28.5);

      expect(snapshot().brakeFailureMm).toEqual([25, 25]);
    });

    it('reads a disc at or below the failure thickness as failed', () => {
      const { snapshot, answer } = setup();
      answer({ brake: [35, 35, 30, 30.4] });

      const wear = snapshot();
      expect(wear.wheels[2]).toMatchObject({
        brakeFailed: true,
        brakeLifePct: 0,
        brakeLapsLeft: 0,
      });
      expect(wear.wheels[3].brakeFailed).toBe(false);
    });

    it('takes the highest reading as a new disc where the setup states none', () => {
      const { snapshot, answer } = setup({ brakeDiscNewMm: null });

      expect(snapshot().brakeNewMm).toEqual([35, 31]);
      answer({ brake: [34.9, 34.8, 31, 31] });
      const wear = snapshot();
      expect(wear.brakeNewMm).toEqual([35, 31]);
      // 34.8 mm between 30 and the 35 it was first seen at.
      expect(wear.wheels[1].brakeLifePct).toBe(96);
    });

    it('takes a rise of half a millimetre in the pits as new discs on that axle', () => {
      const { snapshot, answer } = setup({ brakeDiscNewMm: null });
      answer({ brake: [33, 33, 31, 31] });
      expect(snapshot().brakeNewMm).toEqual([35, 31]);

      // Thinner discs than the ones that came off.
      answer({ brake: [33.5, 33.5, 31, 31], inPits: true, speed: 0 });

      const wear = snapshot();
      expect(wear.brakeNewMm).toEqual([33.5, 31]);
      expect(wear.wheels[0].brakeLifePct).toBe(100);
    });

    it('does not take a rise on the road for new discs', () => {
      const { snapshot, answer } = setup({ brakeDiscNewMm: null });
      answer({ brake: [33, 33, 31, 31] });

      answer({ brake: [33.5, 33.5, 31, 31] });

      expect(snapshot().brakeNewMm).toEqual([35, 31]);
    });

    it('has dashes for discs the sim gives no thickness for', () => {
      const { snapshot, feed } = setup();
      feed({ brake: [null, null, null, null] }, { wearablesSeq: null });

      const wear = snapshot();
      expect(wear.brakeStale).toBe(false);
      expect(wear.wheels[0]).toMatchObject({
        treadPct: 62,
        brakeMm: null,
        brakeLifePct: null,
        brakePerLapMm: null,
        brakeLapsLeft: null,
        brakeFailed: false,
      });
    });

    it('lets go of a reading the REST API has stopped refreshing', () => {
      const { snapshot, feed, answer } = setup();
      answer();
      // Answers every five seconds, as while nothing in them changes.
      for (let step = 0; step < 4; step += 1) answer({}, 5);
      expect(snapshot()).toMatchObject({ brakeStale: false });
      expect(snapshot().wheels[0].brakeMm).toBe(35);

      // Then none: the cell holds the last thickness for as long as it likes.
      feed({}, {}, BRAKE_STALE_AFTER_S - 1);
      expect(snapshot().brakeStale).toBe(false);
      feed({}, {}, 2);

      const stale = snapshot();
      expect(stale.brakeStale).toBe(true);
      expect(stale.wheels[0]).toMatchObject({
        treadPct: 62,
        brakeMm: null,
        brakeLifePct: null,
        brakeLapsLeft: null,
        brakeFailed: false,
      });

      // And takes it up again with the next answer.
      answer();
      const fresh = snapshot();
      expect(fresh.brakeStale).toBe(false);
      expect(fresh.wheels[0].brakeMm).toBe(35);
    });

    it('trusts readings that come without an answer counter', () => {
      const { snapshot, feed } = setup();
      feed({}, { wearablesSeq: null });
      feed({}, {}, 600);

      expect(snapshot()).toMatchObject({ brakeStale: false });
      expect(snapshot().wheels[0].brakeMm).toBe(35);
    });
  });

  describe('a failed brake', () => {
    /** Three and a half seconds on the brakes at speed, answered four a second. */
    const brakeHard = ({ feed, answer }: ReturnType<typeof setup>) => {
      for (let step = 0; step < 35; step += 1) {
        if (step % 2 === 0) answer({}, 0.1);
        else feed({}, {}, 0.1);
      }
    };

    it('is told by a disc that no longer wears under braking', () => {
      const harness = setup({ className: 'LMP3' });
      harness.answer({ brake: [26.2, 26.2, 30, 30] }, 0.1);
      harness.feed({}, { brakePedal: 0.5 });
      expect(harness.snapshot().wheels[0].brakeFailed).toBe(false);

      brakeHard(harness);

      const wear = harness.snapshot();
      expect(wear.wheels.map((wheel) => wheel.brakeFailed)).toEqual([
        true,
        true,
        true,
        true,
      ]);
      // What they stopped at is now the failure thickness of this car.
      expect(wear.brakeFailureMm).toEqual([26.2, 30]);
      expect(wear.brakeFailureSource).toEqual(['learned', 'learned']);
      expect(wear.wheels[0]).toMatchObject({
        brakeLifePct: 0,
        brakeLapsLeft: 0,
      });
      expect(harness.stored.get(`lmu|${CAR}|front`)).toBe(26.2);
      expect(harness.stored.get(`lmu|${CAR}|rear`)).toBe(30);
    });

    it('is not told from a reading nobody refreshed', () => {
      const harness = setup({ className: 'LMP3' });
      harness.answer({ brake: [26.2, 26.2, 31, 31] });
      // Ten seconds on the brakes and not one answer.
      for (let step = 0; step < 100; step += 1) {
        harness.feed({}, { brakePedal: 0.5 });
      }

      expect(harness.snapshot().wheels.some((wheel) => wheel.brakeFailed)).toBe(
        false
      );
      expect(harness.stored.size).toBe(0);
    });

    it('is not told off the brakes, or at a crawl', () => {
      const coasting = setup({ className: 'LMP3' });
      coasting.answer({ brake: [26.2, 26.2, 31, 31] });
      coasting.feed({}, { brakePedal: 0.1 });
      brakeHard(coasting);
      expect(coasting.stored.size).toBe(0);

      const crawling = setup({ className: 'LMP3' });
      crawling.answer({ brake: [26.2, 26.2, 31, 31], speed: 3 });
      crawling.feed({}, { brakePedal: 0.9 });
      brakeHard(crawling);
      expect(crawling.stored.size).toBe(0);
    });

    it('is not learned from a disc that is all but new', () => {
      // 35.9 mm of a 36.0 mm disc cannot have worn out.
      const harness = setup({ className: 'LMP3' });
      harness.answer({ brake: [35.9, 35.9, 31.9, 31.9] });
      harness.feed({}, { brakePedal: 0.5 });

      brakeHard(harness);

      const wear = harness.snapshot();
      expect(wear.wheels.some((wheel) => wheel.brakeFailed)).toBe(false);
      expect(wear.brakeFailureMm).toEqual([null, null]);
      expect(harness.stored.size).toBe(0);
    });

    it('is forgotten when a disc goes on wearing below where it was learned', () => {
      const harness = setup({ className: 'LMP3' });
      harness.stored.set(`lmu|${CAR}|front`, 30);
      harness.answer({ brake: [30.2, 30.2, 31.5, 31.5] });
      expect(harness.snapshot().brakeFailureSource[0]).toBe('learned');

      // Past it and still wearing: nothing failed at 30.
      harness.answer({ brake: [29.99, 29.99, 31.5, 31.5] });
      expect(harness.snapshot().wheels[0].brakeFailed).toBe(true);
      harness.answer({ brake: [29.9, 29.9, 31.5, 31.5] });

      const wear = harness.snapshot();
      expect(wear.brakeFailureMm[0]).toBeNull();
      expect(wear.wheels[0].brakeFailed).toBe(false);
      expect(harness.stored.get(`lmu|${CAR}|front`)).toBe(0);
    });

    it('goes with the discs when they are changed', () => {
      const harness = setup({ className: 'LMP3' });
      harness.answer({ brake: [26.2, 26.2, 31, 31] });
      harness.feed({}, { brakePedal: 0.5 });
      brakeHard(harness);
      expect(harness.snapshot().wheels[0].brakeFailed).toBe(true);

      harness.answer({ brake: [36, 36, 31, 31], inPits: true, speed: 0 }, 0.1);

      const wear = harness.snapshot();
      expect(wear.wheels[0]).toMatchObject({ brakeMm: 36, brakeFailed: false });
      // The thickness the old ones failed at still stands for the new.
      expect(wear.brakeFailureMm[0]).toBe(26.2);
      expect(wear.wheels[0].brakeLifePct).toBe(100);
    });
  });

  describe('with no car, and after a reset', () => {
    it('says so, with nothing read and nothing forecast', () => {
      const { snapshot, feed } = setup();
      const before = snapshot();

      feed({}, { hasCar: false });

      const wear = snapshot({ sessionNum: 2 });
      expect(wear.available).toBe(false);
      expect(wear.sessionNum).toBe(2);
      expect(wear.version).toBe(before.version + 1);
      expect(wear.wheels).toHaveLength(4);
      expect(wear.wheels[0]).toMatchObject({ treadPct: null, brakeMm: null });
    });

    it('keeps the last frame while the sim has stopped writing', () => {
      const { snapshot, feed } = setup();

      feed({ frozen: true, tread: [0.1, 0.1, 0.1, 0.1] });

      expect(snapshot().wheels[0].treadPct).toBe(62);
    });

    it('forgets the laps, the discs and what it learned here', () => {
      const { forecast, snapshot, feed } = setup({ brakeDiscNewMm: null });
      forecast.noteLap([0.006, 0.006, 0.006, 0.006], [0, 0, 0, 0], false);

      forecast.reset();
      expect(snapshot().available).toBe(false);

      feed({ brake: [33, 33, 30.5, 30.5] }, { lapOpen: true, lapPct: 0.1 });
      const wear = snapshot({ rates: rates() });
      // The highest reading starts again from these.
      expect(wear.brakeNewMm).toEqual([33, 30.5]);
      // And there is no lap before to measure this one against.
      expect(wear.wheels[0].treadProjectedPct).toBeNull();
    });
  });
});
