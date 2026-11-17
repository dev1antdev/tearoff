import { describe, expect, it } from 'vitest';
import {
  carRecordNotice,
  driverOrder,
  isDrivenStint,
  lapEnergyUse,
  lapsAroundStop,
  lapsByStint,
  stopSeen,
} from './carRecord';
import { lapOf, stintOf, stoppedStint } from './recordFixture';

describe('isDrivenStint', () => {
  it('counts a stint with a lap, and the one under way', () => {
    expect(isDrivenStint(stintOf(1, { laps: 3, closedBy: 'stop' }))).toBe(true);
    expect(isDrivenStint(stintOf(2, { laps: 0 }))).toBe(true);
  });

  it('does not count the stint a car parked in its garage has open', () => {
    // The record opens it when the car goes in; a car that never comes
    // back out has it open for the rest of the race.
    const parked = stintOf(3, { openedBy: 'garage', laps: 0 });
    expect(isDrivenStint(parked)).toBe(false);
    expect(isDrivenStint({ ...parked, laps: 1 })).toBe(true);
  });
});

describe('driverOrder', () => {
  it('lists the drivers in the order they first drove, each once', () => {
    expect(
      driverOrder([
        stoppedStint(1, 1, 10, { driver: 'Ada' }),
        stoppedStint(2, 11, 20, { driver: 'Ada' }),
        stoppedStint(3, 21, 30, { driver: 'Ben' }),
        stoppedStint(4, 31, 40, { driver: 'Ada' }),
        stintOf(5, { driver: 'Cy' }),
      ])
    ).toEqual(['Ada', 'Ben', 'Cy']);
  });

  it('counts the stints nobody was named for as one driver', () => {
    expect(
      driverOrder([
        stoppedStint(1, 1, 10, { driver: '' }),
        stoppedStint(2, 11, 20, { driver: 'Ben' }),
        stintOf(3, { driver: '' }),
      ])
    ).toEqual(['', 'Ben']);
  });

  it('leaves out who is named for a stint the car has not driven', () => {
    expect(
      driverOrder([
        stoppedStint(1, 1, 10, { driver: 'Ada' }),
        // In its garage, with another driver named for when it comes out.
        stintOf(2, { driver: 'Ben', openedBy: 'garage' }),
      ])
    ).toEqual(['Ada']);
    expect(driverOrder([])).toEqual([]);
  });
});

describe('lapEnergyUse', () => {
  const at = (lap: number, energy: number | null, virtual = true) =>
    lapOf(lap, { energy, energyIsVirtual: virtual });

  it('is what the car had at the line before, less what it has at this one', () => {
    const use = lapEnergyUse(at(8, 0.6), at(7, 0.625));
    expect(use.used).toBeCloseTo(0.025);
    expect(use.refilled).toBe(false);
  });

  it('is a refill, with no figure, where the car ended the lap with more', () => {
    expect(lapEnergyUse(at(8, 0.98), at(7, 0.2))).toEqual({
      used: null,
      refilled: true,
    });
  });

  it('is not told without the lap before, or across a lap that is not held', () => {
    expect(lapEnergyUse(at(8, 0.6), undefined).used).toBeNull();
    expect(lapEnergyUse(at(8, 0.6), at(6, 0.65)).used).toBeNull();
  });

  it('is not told without a reading at both lines, or across two budgets', () => {
    expect(lapEnergyUse(at(8, null), at(7, 0.6)).used).toBeNull();
    expect(lapEnergyUse(at(8, 0.6), at(7, null)).used).toBeNull();
    expect(lapEnergyUse(at(8, 0.6, false), at(7, 0.65, true))).toEqual({
      used: null,
      refilled: false,
    });
  });
});

describe('lapsByStint', () => {
  it('gives each stint the laps from its first to its last', () => {
    const laps = [1, 2, 3, 4, 5, 6].map((lap) => lapOf(lap));
    const stints = [
      stoppedStint(1, 1, 2),
      stoppedStint(2, 3, 5),
      stintOf(3, { firstLap: 6, lastLap: 6, laps: 1 }),
    ];
    expect(
      lapsByStint(stints, laps).map((own) => own.map((lap) => lap.lap))
    ).toEqual([[1, 2], [3, 4, 5], [6]]);
  });

  it('gives a stint without a lap none, and skips laps that are not held', () => {
    const laps = [1, 2, 5, 6].map((lap) => lapOf(lap));
    const stints = [
      stoppedStint(1, 1, 4),
      stintOf(2, { firstLap: 5, lastLap: 6, laps: 2 }),
      stintOf(3),
    ];
    expect(
      lapsByStint(stints, laps).map((own) => own.map((lap) => lap.lap))
    ).toEqual([[1, 2], [5, 6], []]);
  });
});

describe('what a stop is seen to have done', () => {
  const stint = stoppedStint(1, 1, 10);
  const next = stintOf(2, { firstLap: 11, lastLap: 14, laps: 4 });
  const before = lapOf(10, { energy: 0.2, energyIsVirtual: true });
  const after = lapOf(11, { energy: 0.98, energyIsVirtual: true });

  it('is nothing for a stint no stop ended', () => {
    expect(stopSeen(stintOf(1), undefined, before, after)).toBeNull();
    expect(
      stopSeen(stintOf(1, { closedBy: 'garage' }), next, before, after)
    ).toBeNull();
  });

  it('gives the standing time, and nothing more where nothing shows', () => {
    const plain = lapOf(10);
    expect(stopSeen(stint, next, plain, lapOf(11))).toEqual({
      standingS: 40,
      inPits: false,
      refilled: null,
      tyres: false,
      driver: false,
    });
  });

  it('says energy when the car had more at the line after than before', () => {
    expect(stopSeen(stint, next, before, after)?.refilled).toBe('energy');
  });

  it('says fuel for a car that runs on fuel', () => {
    expect(
      stopSeen(
        stint,
        next,
        lapOf(10, { energy: 0.2 }),
        lapOf(11, { energy: 0.9 })
      )?.refilled
    ).toBe('fuel');
  });

  it('does not say it for a top-up smaller than the lap used', () => {
    // 20 % before, a little added, 19 % at the line after: not to be seen.
    expect(
      stopSeen(
        stint,
        next,
        before,
        lapOf(11, { energy: 0.19, energyIsVirtual: true })
      )?.refilled
    ).toBeNull();
  });

  it('does not say it where either reading is missing, or of another kind', () => {
    expect(stopSeen(stint, next, lapOf(10), after)?.refilled).toBeNull();
    expect(
      stopSeen(stint, next, before, lapOf(11, { energy: 0.9 }))?.refilled
    ).toBeNull();
  });

  it('says tyres when a wheel carries another compound afterwards', () => {
    expect(
      stopSeen(stint, next, lapOf(10), lapOf(11, { compounds: [1, 1, 2, 2] }))
        ?.tyres
    ).toBe(true);
    // The same compound all round: a new set of it cannot be seen.
    expect(stopSeen(stint, next, lapOf(10), lapOf(11))?.tyres).toBe(false);
    // An unknown compound is not another compound.
    expect(
      stopSeen(
        stint,
        next,
        lapOf(10, { compounds: [-1, -1, -1, -1] }),
        lapOf(11, { compounds: [2, 2, 2, 2] })
      )?.tyres
    ).toBe(false);
  });

  it('says driver where the record does, or names somebody else afterwards', () => {
    const flagged = stoppedStint(1, 1, 10, {
      stop: { laneTime: 60, standingTime: 40, driverChanged: true },
    });
    expect(stopSeen(flagged, next, undefined, undefined)?.driver).toBe(true);
    expect(
      stopSeen(stint, { ...next, driver: 'Grace' }, undefined, undefined)
        ?.driver
    ).toBe(true);
    // A stint nobody is named for is not somebody else's.
    expect(
      stopSeen(stint, { ...next, driver: '' }, undefined, undefined)?.driver
    ).toBe(false);
  });

  it('claims nothing of the car where a lap either side is not held', () => {
    expect(stopSeen(stint, next, before, undefined)).toMatchObject({
      refilled: null,
      tyres: false,
    });
    expect(stopSeen(stint, next, undefined, after)).toMatchObject({
      refilled: null,
      tyres: false,
    });
  });

  it('says the car is still in the pits until it is seen to leave', () => {
    const standing = stoppedStint(1, 1, 10, {
      endTime: 1200,
      stop: { laneTime: null, standingTime: 3, driverChanged: false },
    });
    // As the record keeps it: the stint the stop opened starts where the
    // one before it ended, until the car is out of the lane.
    expect(
      stopSeen(standing, stintOf(2, { startTime: 1200 }), before, undefined)
        ?.inPits
    ).toBe(true);
    // A visit whose entry was not seen never gets a lane time. It is over
    // when the car leaves, a lap or two before it has lapped on.
    expect(
      stopSeen(standing, stintOf(2, { startTime: 1215 }), before, undefined)
        ?.inPits
    ).toBe(false);
    expect(
      stopSeen(
        standing,
        stintOf(2, { startTime: 1215, laps: 2 }),
        before,
        after
      )?.inPits
    ).toBe(false);
    expect(stopSeen(stint, stintOf(2), before, undefined)?.inPits).toBe(false);
  });
});

describe('lapsAroundStop', () => {
  it('gives the stint’s last lap and the one after it', () => {
    const stint = stoppedStint(1, 1, 3);
    const [last, after] = lapsAroundStop(
      stint,
      [lapOf(2), lapOf(3)],
      [lapOf(4), lapOf(5)]
    );
    expect(last?.lap).toBe(3);
    expect(after?.lap).toBe(4);
  });

  it('gives neither under another number: a lap that is not held', () => {
    const stint = stoppedStint(1, 1, 3);
    expect(lapsAroundStop(stint, [lapOf(2)], [lapOf(5)])).toEqual([
      undefined,
      undefined,
    ]);
    expect(lapsAroundStop(stint, [], [])).toEqual([undefined, undefined]);
  });
});

describe('carRecordNotice', () => {
  it('says the history is not available where it cannot be read', () => {
    expect(
      carRecordNotice({ readable: false, recording: true, read: true })
    ).toBe('The race history is not available on this page.');
  });

  it('says what it is waiting for, and nothing once it has the record', () => {
    expect(
      carRecordNotice({ readable: true, recording: false, read: false })
    ).toBe('Waiting for a session to record.');
    expect(
      carRecordNotice({ readable: true, recording: true, read: false })
    ).toBe('Reading the race history.');
    expect(
      carRecordNotice({ readable: true, recording: true, read: true })
    ).toBeNull();
  });
});
