import { describe, expect, it } from 'vitest';
import type {
  PitLaneModel,
  PitRejoinRival,
  PitStopParts,
  PitStopSnapshot,
} from '@irdashies/types';
import {
  isPitDriveMeasured,
  laneTimerS,
  pitDriveTimeS,
  pitLossS,
  projectRejoin,
  remainingPitLossS,
  standingSoFarS,
  standingToGoS,
  timeInPitsS,
} from './pitStopPlan';

const lane = (values: Partial<PitLaneModel> = {}): PitLaneModel => ({
  entryPct: 0.95,
  exitPct: 0.03,
  lengthM: 287.2,
  speedLimitMs: 16.67,
  speedLimitSource: 'assumed',
  driveAtLimitS: 17.2,
  driveMeasuredS: null,
  trackTimeS: 6.9,
  ...values,
});

const parts = (values: Partial<PitStopParts> = {}): PitStopParts => ({
  fuel: 0,
  energy: 0,
  tyres: 0,
  damage: 0,
  driverSwap: 0,
  brakes: 0,
  brakeDucts: 0,
  penalties: 0,
  ...values,
});

const rival = (
  carIdx: number,
  gapS: number,
  values: Partial<PitRejoinRival> = {}
): PitRejoinRival => ({
  carIdx,
  gapS,
  sameClass: true,
  inPit: false,
  ...values,
});

const snapshot = (values: Partial<PitStopSnapshot> = {}): PitStopSnapshot => ({
  phase: 'planning',
  requested: false,
  lane: lane(),
  estimate: {
    source: 'sim',
    standingS: 14.2,
    parts: parts({ fuel: 14.2 }),
    optionalRepairS: null,
    samples: 0,
    penalty: null,
  },
  planned: null,
  timer: { enteredAt: null, stoppedAt: null, standingS: 0, exitedAt: null },
  last: null,
  refuel: null,
  rejoin: null,
  sessionNum: 0,
  version: 1,
  ...values,
});

describe('what a stop costs', () => {
  it('drives a stop that stands at the measured time, where there is one', () => {
    const measured = lane({ driveMeasuredS: 24 });
    expect(pitDriveTimeS(measured, 14.2)).toBe(24);
    expect(isPitDriveMeasured(measured, 14.2)).toBe(true);
    // Before any stop has been timed: the lane at the limit.
    expect(pitDriveTimeS(lane(), 14.2)).toBe(17.2);
    expect(isPitDriveMeasured(lane(), 14.2)).toBe(false);
  });

  it('drives a visit with nothing to stand for at the limit', () => {
    const measured = lane({ driveMeasuredS: 24 });
    expect(pitDriveTimeS(measured, 0)).toBe(17.2);
    expect(pitDriveTimeS(measured, null)).toBe(17.2);
    expect(isPitDriveMeasured(measured, 0)).toBe(false);
  });

  it('adds the extra time to a stop that stands, and to no other', () => {
    expect(timeInPitsS(lane({ driveMeasuredS: 24 }), 14.2, 2)).toBeCloseTo(
      40.2,
      6
    );
    expect(timeInPitsS(lane(), 0, 2)).toBe(17.2);
    expect(timeInPitsS(lane({ driveAtLimitS: null }), 14.2, 2)).toBeNull();
  });

  it('takes off what the same stretch costs on the racing line', () => {
    // 24 + 14.2 + 2 in the pits, 6.9 on the track.
    expect(pitLossS(lane({ driveMeasuredS: 24 }), 14.2, 2)).toBeCloseTo(
      33.3,
      6
    );
    // A drive-through: 17.2 down the lane against 6.9.
    expect(pitLossS(lane(), 0, 2)).toBeCloseTo(10.3, 6);
  });

  it('is never below zero and has no figure without a lane or a pace', () => {
    expect(pitLossS(lane({ trackTimeS: 60 }), 0, 0)).toBe(0);
    expect(pitLossS(lane({ trackTimeS: null }), 14.2, 2)).toBeNull();
    expect(pitLossS(lane({ driveAtLimitS: null }), 14.2, 2)).toBeNull();
  });
});

describe('where the car rejoins', () => {
  const rejoin = (ladder: PitRejoinRival[]) => ({
    position: 9,
    classPosition: 5,
    ladder,
    driveToExitS: null,
    passes: [],
  });
  const inClass = [
    rival(1, -6),
    rival(2, 5),
    rival(3, 20),
    rival(4, 38),
    rival(5, 70),
  ];

  it('loses a place to every car behind that is closer than the loss', () => {
    expect(projectRejoin(rejoin(inClass), 38.4, 'class')).toEqual({
      positionNow: 5,
      positionAfter: 8,
      ahead: { carIdx: 4, gapS: expect.closeTo(0.4, 6) },
      behind: { carIdx: 5, gapS: expect.closeTo(31.6, 6) },
      inPits: 0,
      // The last car through is 0.4 s up the road.
      closeCall: true,
    });
  });

  it('keeps the car ahead when nobody gets past', () => {
    expect(projectRejoin(rejoin(inClass), 4, 'class')).toEqual({
      positionNow: 5,
      positionAfter: 5,
      ahead: { carIdx: 1, gapS: 10 },
      behind: { carIdx: 2, gapS: 1 },
      inPits: 0,
      closeCall: true,
    });
    expect(projectRejoin(rejoin(inClass), 1, 'class')).toMatchObject({
      positionAfter: 5,
      behind: { carIdx: 2, gapS: 4 },
      closeCall: false,
    });
  });

  it('does not count a car that is in the pits itself, and says how many', () => {
    const ladder = [
      rival(1, -6),
      rival(2, 5, { inPit: true }),
      rival(3, 20),
      rival(4, 38, { inPit: true }),
      rival(5, 70, { inPit: true }),
    ];
    expect(projectRejoin(rejoin(ladder), 38.4, 'class')).toEqual({
      positionNow: 5,
      positionAfter: 6,
      ahead: { carIdx: 3, gapS: expect.closeTo(18.4, 6) },
      behind: null,
      // The car 70 s back is beyond the loss either way.
      inPits: 2,
      closeCall: false,
    });
  });

  it('counts other classes only when asked for the whole field', () => {
    const ladder = [
      rival(1, -6),
      rival(6, -2, { sameClass: false }),
      rival(2, 5),
      rival(7, 12, { sameClass: false }),
      rival(3, 20),
      rival(8, 30, { sameClass: false }),
      rival(4, 38),
      rival(5, 70),
    ];
    expect(projectRejoin(rejoin(ladder), 38.4, 'class')).toMatchObject({
      positionNow: 5,
      positionAfter: 8,
    });
    expect(projectRejoin(rejoin(ladder), 38.4, 'overall')).toMatchObject({
      positionNow: 9,
      positionAfter: 14,
      ahead: { carIdx: 4 },
      behind: { carIdx: 5 },
    });
    // With nobody getting past, the car ahead is the nearest of any class.
    expect(projectRejoin(rejoin(ladder), 1, 'overall')?.ahead).toEqual({
      carIdx: 6,
      gapS: 3,
    });
  });

  it('calls a rejoin a close call by the margin it is given', () => {
    expect(projectRejoin(rejoin(inClass), 35, 'class', 2)).toMatchObject({
      behind: { carIdx: 4, gapS: 3 },
      closeCall: false,
    });
    expect(projectRejoin(rejoin(inClass), 35, 'class', 4)?.closeCall).toBe(
      true
    );
  });

  it('has nothing to say outside a race, without a loss or without a place', () => {
    expect(projectRejoin(rejoin([]), 38.4, 'class')).toBeNull();
    expect(projectRejoin(rejoin(inClass), null, 'class')).toBeNull();
    expect(projectRejoin(null, 38.4, 'class')).toBeNull();
    expect(
      projectRejoin({ ...rejoin(inClass), classPosition: 0 }, 38.4, 'class')
    ).toBeNull();
  });
});

describe('the timer', () => {
  const visit = snapshot({
    phase: 'service',
    planned: { standingS: 14.2, driveS: 24 },
    timer: { enteredAt: 100, stoppedAt: 112, standingS: 0, exitedAt: null },
  });

  it('counts the planned standing time down, and on past it', () => {
    expect(standingSoFarS(visit.timer, 118)).toBe(6);
    expect(standingToGoS(visit, 118)).toBeCloseTo(8.2, 6);
    expect(standingToGoS(visit, 130)).toBeCloseTo(-3.8, 6);
  });

  it('holds the time to go while the car is moving', () => {
    const rolling = snapshot({
      phase: 'lane',
      planned: { standingS: 14.2, driveS: 24 },
      timer: { enteredAt: 100, stoppedAt: null, standingS: 9, exitedAt: null },
    });
    expect(standingToGoS(rolling, 140)).toBeCloseTo(5.2, 6);
    expect(standingToGoS(snapshot(), 140)).toBeNull();
  });

  it('times the lane from the entry line and holds it at the exit', () => {
    expect(laneTimerS(visit.timer, 118)).toBe(18);
    expect(laneTimerS({ ...visit.timer, exitedAt: 142 }, 200)).toBe(42);
    expect(laneTimerS(snapshot().timer, 118)).toBeNull();
  });

  it('says what is still to lose from where the car is in the lane', () => {
    const rejoin = {
      position: 9,
      classPosition: 5,
      ladder: [],
      // Half the lane still to drive.
      driveToExitS: 8.6,
      passes: [],
    };
    // 8.2 s to stand and 8.6 s to drive, less half of 6.9 s on the track.
    expect(remainingPitLossS({ ...visit, rejoin }, 118, 2)).toBeCloseTo(
      13.35,
      6
    );
    // Not yet at rest: the whole stop and its extra are still to come.
    const arriving = snapshot({
      phase: 'lane',
      planned: { standingS: 14.2, driveS: 24 },
      timer: { enteredAt: 100, stoppedAt: null, standingS: 0, exitedAt: null },
      rejoin: { ...rejoin, driveToExitS: 17.2 },
    });
    expect(remainingPitLossS(arriving, 101, 2)).toBeCloseTo(26.5, 6);
    expect(remainingPitLossS(visit, 118, 2)).toBeNull();
  });
});
