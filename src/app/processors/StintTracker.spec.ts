import { describe, expect, it } from 'vitest';
import type { LedgerStint } from '@irdashies/types';
import {
  LEDGER_LAP_IN_LAP,
  LEDGER_LAP_VOIDED,
  LEDGER_LAP_YELLOW,
} from '@irdashies/types';
import { createMeterReading, LapCostMeter } from './LapCostMeter';
import {
  createStintFrame,
  Standstill,
  StintTracker,
  type StintFrame,
} from './StintTracker';

/**
 * The stint rule on its own: frames handed straight to the tracker, half a
 * second apart, with a meter beside it for the levels.
 */
const setup = () => {
  const meter = new LapCostMeter({ liveTread: true });
  const reading = createMeterReading();
  reading.fuel = 60;
  reading.tread = [1, 1, 1, 1];
  const opened: LedgerStint[] = [];
  const closed: LedgerStint[] = [];
  const discarded: LedgerStint[] = [];
  let token = 'run:1';
  const tracker = new StintTracker(
    meter,
    {
      onStintOpened: (stint) => opened.push(stint),
      onStintClosed: (stint) => closed.push(stint),
      onStintDiscarded: (stint) => discarded.push(stint),
    },
    {
      sessionToken: () => token,
      compoundNames: () => ['Soft', 'Soft', 'Soft', 'Soft'],
    }
  );
  const frame = createStintFrame();
  frame.hasCar = true;
  frame.atWheel = true;
  frame.speed = 50;
  frame.driver = 'A';
  frame.sessionNum = 0;
  /** Applies a change, moves the clock on, and feeds meter and tracker. */
  const feed = (change: Partial<StintFrame> = {}, fuel?: number) => {
    Object.assign(frame, change);
    frame.sessionTime += 0.5;
    if (fuel !== undefined) reading.fuel = fuel;
    reading.sessionTime = frame.sessionTime;
    reading.speed = frame.speed;
    reading.inPits = frame.onPitRoad || frame.inGarage;
    if (frame.hasCar) meter.update(reading);
    tracker.update(frame);
  };
  const run = (frames: number, change: Partial<StintFrame> = {}) => {
    for (let index = 0; index < frames; index += 1) feed(change);
  };
  return {
    tracker,
    frame,
    feed,
    run,
    opened,
    closed,
    discarded,
    setToken: (next: string) => {
      token = next;
    },
  };
};

const IN_BOX = { onPitRoad: true, speed: 0 } as const;
const ON_TRACK = { onPitRoad: false, inGarage: false, speed: 50 } as const;

describe('StintTracker', () => {
  it('names a stint after the session it opened in, and counts from one', () => {
    const { tracker, feed, opened, setToken } = setup();
    feed();
    tracker.noteCrossing();
    feed({ inGarage: true });
    feed({ ...ON_TRACK });
    setToken('run:2');
    tracker.noteCrossing();
    feed({ inGarage: true });
    feed({ ...ON_TRACK });

    expect(opened.map((stint) => stint.id)).toEqual([
      'run:1:1',
      'run:1:2',
      'run:2:1',
    ]);
    expect(opened.map((stint) => stint.openedBy)).toEqual([
      'joined',
      'pitExit',
      'pitExit',
    ]);
    expect(opened[0].compounds).toEqual(['Soft', 'Soft', 'Soft', 'Soft']);
  });

  describe('the start of a race', () => {
    it('opens at the green flag for a car on the grid', () => {
      const { tracker, run, feed, opened } = setup();
      run(10, { beforeGreen: true });
      expect(tracker.state()).toBe('idle');
      expect(opened).toHaveLength(0);

      feed({ beforeGreen: false });

      expect(opened[0]).toMatchObject({ openedBy: 'green', startTime: 5.5 });
    });

    it('opens at the pit exit for a car that starts from the pit lane', () => {
      const { run, feed, opened } = setup();
      run(10, { beforeGreen: true, onPitRoad: true, speed: 0 });
      run(4, { beforeGreen: false });
      expect(opened).toHaveLength(0);

      feed({ ...ON_TRACK });

      expect(opened[0].openedBy).toBe('pitExit');
    });

    it('keeps a stint open through a session that stops being green', () => {
      const { tracker, run, closed } = setup();
      run(4);
      run(4, { beforeGreen: true });

      expect(tracker.state()).toBe('running');
      expect(closed).toHaveLength(0);
    });
  });

  describe('a visit to the pit lane', () => {
    it('ends the stint at pit entry when fuel went in', () => {
      const { tracker, run, feed, closed, opened } = setup();
      run(4);
      tracker.noteCrossing();
      feed({ onPitRoad: true, speed: 20, simEstimate: 31.5 }, 12);
      run(3, { ...IN_BOX });
      for (let step = 1; step <= 20; step += 1) feed({}, 12 + step * 2);
      run(2, { speed: 20, simEstimate: 4 });
      feed({ ...ON_TRACK });

      expect(closed).toHaveLength(1);
      expect(closed[0]).toMatchObject({
        closedBy: 'service',
        endTime: 2.5,
        endFuel: 12,
        laps: 1,
      });
      expect(closed[0].stop).toMatchObject({
        fuelAdded: 40,
        // From the first frame at rest to the first one moving again.
        stationaryTime: 11.5,
        pitLaneTime: 13,
        tyresChanged: 0,
        driverChanged: false,
        // The estimate as it stood on the way in, not as it stands after.
        simEstimate: 31.5,
      });
      expect(opened[1]).toMatchObject({
        openedBy: 'pitExit',
        ordinal: 2,
        startFuel: 52,
        startTime: 15.5,
      });
    });

    it('notes a visit that serviced nothing as a pass, and keeps the latest ten', () => {
      const { tracker, run, feed, closed } = setup();
      feed();
      for (let visit = 0; visit < 12; visit += 1) {
        feed({ onPitRoad: true, speed: 20 });
        run(visit, { ...IN_BOX });
        feed({ speed: 20 });
        feed({ ...ON_TRACK });
      }

      expect(closed).toHaveLength(0);
      const passes = tracker.record()?.passes ?? [];
      expect(passes).toHaveLength(10);
      // The first two, which stood for nought and half a second, are gone.
      expect(passes[0].stationaryTime).toBeCloseTo(1, 9);
      expect(passes[9].stationaryTime).toBeCloseTo(5.5, 9);
    });

    it('ends the stint when the count of drivers goes up in the box', () => {
      const { tracker, run, feed, closed } = setup();
      feed({ driversSoFar: 1 });
      tracker.noteCrossing();
      feed({ ...IN_BOX });
      run(4, { driversSoFar: 2, atWheel: false });
      feed({ ...ON_TRACK });

      expect(closed[0].stop).toMatchObject({ driverChanged: true });
      expect(closed[0].own).toBe(true);
      expect(tracker.record()).toMatchObject({ own: false, ordinal: 2 });
    });
  });

  describe('a car the sim stops naming', () => {
    it('waits out a moment without one', () => {
      const { tracker, run, closed } = setup();
      run(4);
      run(4, { hasCar: false });
      run(4, { hasCar: true });

      expect(closed).toHaveLength(0);
      expect(tracker.state()).toBe('running');
    });

    it('ends the stint as a return to the garage when it was out on the track', () => {
      const { tracker, run, feed, closed } = setup();
      run(4);
      tracker.noteCrossing();
      feed({}, 55);
      run(10, { hasCar: false });

      expect(closed[0]).toMatchObject({
        closedBy: 'garage',
        endFuel: 55,
        endTime: 2.5,
        stop: null,
      });
      expect(tracker.state()).toBe('idle');
    });

    it('ends it as a handover when it was standing at its box', () => {
      const { tracker, run, feed, closed } = setup();
      run(4);
      tracker.noteCrossing();
      feed({ ...IN_BOX }, 20);
      run(6);
      run(10, { hasCar: false });

      expect(closed[0]).toMatchObject({ closedBy: 'service', endFuel: 20 });
      expect(closed[0].stop).toMatchObject({
        driverChanged: true,
        pitLaneTime: null,
        fuelAdded: 0,
      });
    });
  });

  it('ends a stint when another driver is named out on the track', () => {
    const { tracker, run, feed, closed, opened } = setup();
    run(4);
    tracker.noteCrossing();
    feed({ driver: 'B' });

    expect(closed[0]).toMatchObject({ closedBy: 'driver', driver: 'A' });
    expect(opened[1]).toMatchObject({ openedBy: 'joined', driver: 'B' });
  });

  describe('a session clock that goes back', () => {
    it('ends the stint with the levels of the frame before, and opens the next', () => {
      const { tracker, frame, run, feed, closed, opened } = setup();
      run(10);
      tracker.noteCrossing();
      feed({}, 55);
      // The session starts again under the same number: its clock near
      // zero, the tank full.
      frame.sessionTime = 0;
      feed({}, 60);
      run(3);

      expect(closed).toHaveLength(1);
      expect(closed[0]).toMatchObject({
        closedBy: 'session',
        startTime: 0.5,
        endTime: 5.5,
        startFuel: 60,
        endFuel: 55,
        laps: 1,
      });
      expect(opened[1]).toMatchObject({
        openedBy: 'joined',
        startTime: 0.5,
        startFuel: 60,
      });
      expect(tracker.state()).toBe('running');
    });

    it('takes a step back of two seconds or less for the same session', () => {
      const { tracker, frame, run, feed, closed, opened } = setup();
      run(8);
      tracker.noteCrossing();
      // One clock source trailing another: back 2 s, less the half second
      // the next frame moves on.
      frame.sessionTime -= 2;
      feed({}, 58);
      run(3);

      expect(closed).toHaveLength(0);
      expect(opened).toHaveLength(1);
      expect(tracker.state()).toBe('running');
    });
  });

  it('works out the pace of a stint from its clean laps', () => {
    const { tracker, feed } = setup();
    feed();
    expect(tracker.noteLap(0, 91)).toEqual({ stintId: 'run:1:1', stintLap: 1 });
    tracker.noteLap(LEDGER_LAP_VOIDED, 80);
    tracker.noteLap(LEDGER_LAP_YELLOW, 90);
    tracker.noteLap(LEDGER_LAP_IN_LAP, 120);
    tracker.noteLap(0, 92);

    expect(tracker.record()).toMatchObject({
      laps: 5,
      cleanLaps: 3,
      bestLap: 90,
      avgLap: 91,
    });
    // The mean of the other two is 91.5.
    expect(tracker.record()?.paceDelta).toBeCloseTo(1.5, 9);
    expect(tracker.record()?.consistency).toBeCloseTo(90 / 91.5, 9);
  });

  it('files a lap driven with no stint open under none', () => {
    const { tracker } = setup();

    expect(tracker.noteLap(0, 90)).toEqual({ stintId: '', stintLap: 0 });
  });

  it('measures a standstill from below half a metre a second until above one', () => {
    const standstill = new Standstill();
    const speeds = [5, 0.8, 0.4, 0, 0.9, 0, 1.5, 3, 0.7, 0.2, 2];
    speeds.forEach((speed, index) => standstill.update(speed, index));

    // From the third reading to the seventh, and from the tenth to the last.
    expect(standstill.seconds).toBe(5);
  });
});
