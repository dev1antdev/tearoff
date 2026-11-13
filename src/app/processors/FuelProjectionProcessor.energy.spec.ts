import { describe, expect, it } from 'vitest';
import type { Session, Telemetry } from '@irdashies/types';
import { FuelProjectionProcessor } from './FuelProjectionProcessor';

/**
 * A Le Mans Ultimate frame as the mapper writes one: laps counted from zero,
 * and the player's budget on the two per-car channels. The player is car 0.
 */
const lmuFrame = ({
  energy,
  isVirtual = energy !== undefined,
  fuel,
  lap,
  pct,
  time,
  extra = {},
}: {
  /** Virtual energy as a fraction, or undefined for a car without it. */
  energy?: number;
  isVirtual?: boolean;
  /** Litres in the tank, or undefined at the monitor. */
  fuel?: number;
  /** Laps completed, which is what LMU puts on both lap channels. */
  lap: number;
  pct: number;
  time: number;
  extra?: Record<string, unknown>;
}): Telemetry =>
  ({
    ...(fuel === undefined ? {} : { FuelLevel: { value: [fuel] } }),
    FuelLevelPct: { value: [fuel === undefined ? 0 : fuel / 120] },
    LmuCarIdxEnergyRemaining: { value: [energy ?? -1] },
    LmuCarIdxEnergyIsVirtual: { value: [isVirtual] },
    Lap: { value: [lap] },
    LapCompleted: { value: [lap] },
    LapDistPct: { value: [pct] },
    OnPitRoad: { value: [false] },
    PlayerCarTowTime: { value: [0] },
    SessionFlags: { value: [0] },
    SessionNum: { value: [0] },
    SessionTime: { value: [time] },
    ...extra,
  }) as unknown as Telemetry;

/**
 * The session as the LMU mapper builds it: CarPath is the livery file, and
 * CarModel is only there while the car has a telemetry block.
 */
const session = (
  /** Null for an entry the sim is not naming the model of. */
  carModel: string | null = 'Ferrari 296 LMGT3 Evo',
  carPath = '74_26_KESS40986092'
): Session =>
  ({
    WeekendInfo: { TrackName: 'Laguna Seca', TrackID: 1 },
    DriverInfo: {
      DriverCarIdx: 0,
      DriverCarFuelMaxLtr: 120,
      DriverCarMaxFuelPct: 1,
      Drivers: [
        {
          CarIdx: 0,
          CarPath: carPath,
          ...(carModel === null ? {} : { CarModel: carModel }),
        },
      ],
    },
  }) as unknown as Session;

/** Two laps from the line: 45 % and 44.9 L down to 40.4 % and 40.3 L. */
const driveTwoLaps = (processor: FuelProjectionProcessor) => {
  const frames = [
    { energy: 0.45, fuel: 44.9, lap: 0, pct: 0.01, time: 100 },
    { energy: 0.44, fuel: 43.9, lap: 0, pct: 0.5, time: 145 },
    { energy: 0.4275, fuel: 42.6, lap: 1, pct: 0.01, time: 190 },
    { energy: 0.415, fuel: 41.4, lap: 1, pct: 0.5, time: 235 },
    { energy: 0.4045, fuel: 40.3, lap: 2, pct: 0.01, time: 280 },
  ];
  for (const each of frames) processor.onFrame(lmuFrame(each));
};

describe('FuelProjectionProcessor on virtual energy', () => {
  it('counts an energy car in percent of its energy', () => {
    const processor = new FuelProjectionProcessor();
    processor.init(session());

    processor.onFrame(
      lmuFrame({ energy: 0.45, fuel: 44.9, lap: 0, pct: 0.01, time: 100 })
    );

    const snapshot = processor.snapshot();
    expect(snapshot.budget).toBe('virtualEnergy');
    expect(snapshot.fuelLevel).toBeCloseTo(45, 9);
    expect(snapshot.fuelLevelPct).toBe(0.45);
    // A budget in percent is full at 100, whatever the tank holds.
    expect(snapshot.fuelTankCapacity).toBe(100);
    expect(snapshot.tank).toEqual({ level: 44.9, perLap: 0 });
  });

  it('records laps in percent, numbered from one, and the tank beside them', () => {
    const processor = new FuelProjectionProcessor();
    processor.init(session());

    driveTwoLaps(processor);

    const snapshot = processor.snapshot();
    // LMU's lap channel read 2: two laps done, the third under way.
    expect(snapshot.currentLap).toBe(3);
    expect(snapshot.completedLaps.map((lap) => lap.lapNumber)).toEqual([2, 1]);
    expect(snapshot.completedLaps[0].fuelUsed).toBeCloseTo(2.3, 6);
    expect(snapshot.completedLaps[1].fuelUsed).toBeCloseTo(2.25, 6);
    expect(snapshot.lastLapUsage).toBeCloseTo(2.3, 6);
    expect(snapshot.completedLaps[0].lapTime).toBe(90);
    // The same two laps in litres, averaged: 2.3 and 2.3.
    expect(snapshot.tank?.level).toBe(40.3);
    expect(snapshot.tank?.perLap).toBeCloseTo(2.3, 6);
  });

  it('keeps the energy laps under a key of their own, by car model', () => {
    const processor = new FuelProjectionProcessor();
    processor.init(session());

    processor.onFrame(
      lmuFrame({ energy: 0.45, fuel: 44.9, lap: 0, pct: 0.01, time: 100 })
    );

    // The model, not the livery file LMU puts in CarPath, and not the key
    // the same car's litres would be kept under.
    expect(processor.snapshot().carName).toBe(
      'Ferrari 296 LMGT3 Evo (virtual energy)'
    );
    expect(processor.snapshot().trackId).toBe('Laguna Seca');
  });

  it('keeps the laps and their key while the sim stops naming the model', () => {
    const processor = new FuelProjectionProcessor();
    processor.init(session());
    driveTwoLaps(processor);

    // Out of the car: the entry has no telemetry block, so no model.
    processor.init(session(null));
    processor.onFrame(lmuFrame({ lap: 2, pct: 0.01, time: 300 }));

    expect(processor.snapshot().completedLaps).toHaveLength(2);
    expect(processor.snapshot().budget).toBe('virtualEnergy');
    expect(processor.snapshot().carName).toBe(
      'Ferrari 296 LMGT3 Evo (virtual energy)'
    );
  });

  it('falls back to the entry until the model has been named', () => {
    const processor = new FuelProjectionProcessor();
    processor.init(session(null));
    processor.onFrame(lmuFrame({ fuel: 44.9, lap: 0, pct: 0.01, time: 100 }));
    expect(processor.snapshot().carName).toBe('74_26_KESS40986092');

    // The same entry, now named: not a different car, so nothing is reset.
    processor.init(session());
    processor.onFrame(lmuFrame({ fuel: 44.8, lap: 0, pct: 0.05, time: 104 }));
    expect(processor.snapshot().carName).toBe('Ferrari 296 LMGT3 Evo');
    expect(processor.snapshot().engine.lapStartFuel).toBe(44.9);
  });

  it('leaves a fuel-limited car in litres', () => {
    const processor = new FuelProjectionProcessor();
    processor.init(session('Oreca 07', '22_26_UNITED'));

    // An LMP2: no virtual energy, so the per-car channel carries its fuel
    // fraction and says it is not energy.
    processor.onFrame(
      lmuFrame({
        energy: 0.5,
        isVirtual: false,
        fuel: 37.5,
        lap: 0,
        pct: 0.01,
        time: 100,
      })
    );

    const snapshot = processor.snapshot();
    expect(snapshot.budget).toBeUndefined();
    expect(snapshot.tank).toBeUndefined();
    expect(snapshot.fuelLevel).toBe(37.5);
    expect(snapshot.fuelTankCapacity).toBe(120);
    expect(snapshot.carName).toBe('Oreca 07');
  });

  it('starts over when the energy is first seen', () => {
    const processor = new FuelProjectionProcessor();
    processor.init(session());

    // Counted as a tank until the sim has said otherwise: two laps in litres.
    const litres = [
      { fuel: 44.9, lap: 0, pct: 0.01, time: 100 },
      { fuel: 42.6, lap: 1, pct: 0.01, time: 190 },
      { fuel: 40.3, lap: 2, pct: 0.01, time: 280 },
    ];
    for (const each of litres) processor.onFrame(lmuFrame(each));
    expect(processor.snapshot().completedLaps).toHaveLength(2);
    expect(processor.snapshot().budget).toBeUndefined();

    processor.onFrame(
      lmuFrame({ energy: 0.4, fuel: 40.1, lap: 2, pct: 0.1, time: 290 })
    );

    // Laps in litres are no use to a sum in percent.
    expect(processor.snapshot().budget).toBe('virtualEnergy');
    expect(processor.snapshot().completedLaps).toHaveLength(0);
    expect(processor.snapshot().fuelLevel).toBeCloseTo(40, 9);
  });

  it('holds the last reading through a frame without one', () => {
    const processor = new FuelProjectionProcessor();
    processor.init(session());
    processor.onFrame(
      lmuFrame({ energy: 0.45, fuel: 44.9, lap: 0, pct: 0.2, time: 100 })
    );

    // At the monitor: no fuel written, and no energy reading for the car.
    processor.onFrame(lmuFrame({ lap: 0, pct: 0.2, time: 101 }));

    const snapshot = processor.snapshot();
    expect(snapshot.budget).toBe('virtualEnergy');
    expect(snapshot.fuelLevel).toBeCloseTo(45, 9);
    expect(snapshot.tank?.level).toBe(44.9);
    // Nothing was burned, and nothing is read as a refuel on the way back.
    processor.onFrame(
      lmuFrame({ energy: 0.45, fuel: 44.9, lap: 0, pct: 0.2, time: 110 })
    );
    expect(processor.snapshot().engine.accumulatedRefuel).toBe(0);
  });

  it('keeps the budget and the laps through a change of session', () => {
    const processor = new FuelProjectionProcessor();
    processor.init(session());
    driveTwoLaps(processor);

    processor.onLifecycle({ type: 'sessionNumChange' });

    // Before the next frame arrives: still energy, so the renderer does not
    // swap the car's history for its litres and back.
    expect(processor.snapshot().budget).toBe('virtualEnergy');
    expect(processor.snapshot().completedLaps).toHaveLength(2);
  });

  it('goes back to fuel when the session is left or the car changes', () => {
    const processor = new FuelProjectionProcessor();
    processor.init(session());
    driveTwoLaps(processor);

    processor.init(session('Oreca 07', '22_26_UNITED'));
    expect(processor.snapshot().budget).toBeUndefined();
    expect(processor.snapshot().completedLaps).toHaveLength(0);

    processor.init(session());
    driveTwoLaps(processor);
    expect(processor.snapshot().budget).toBe('virtualEnergy');
    processor.onLifecycle({ type: 'enter', replay: false });
    expect(processor.snapshot().budget).toBeUndefined();
    expect(processor.snapshot().completedLaps).toHaveLength(0);
  });
});

describe('FuelProjectionProcessor lap numbering', () => {
  it('reads the lap being driven from either convention', () => {
    const iracing = new FuelProjectionProcessor();
    // Laps started: on lap 3 with two complete.
    iracing.onFrame({
      FuelLevel: { value: [20] },
      Lap: { value: [3] },
      LapCompleted: { value: [2] },
      LapDistPct: { value: [0.5] },
      SessionTime: { value: [30] },
    } as unknown as Telemetry);
    expect(iracing.snapshot().currentLap).toBe(3);

    const lmu = new FuelProjectionProcessor();
    // Laps completed on both channels: the same moment reads 2 and 2.
    lmu.onFrame({
      FuelLevel: { value: [20] },
      Lap: { value: [2] },
      LapCompleted: { value: [2] },
      LapDistPct: { value: [0.5] },
      SessionTime: { value: [30] },
    } as unknown as Telemetry);
    expect(lmu.snapshot().currentLap).toBe(3);
  });

  it('measures a fixed-length race from laps completed', () => {
    const processor = new FuelProjectionProcessor();
    processor.init({
      DriverInfo: { DriverCarIdx: 0, Drivers: [{ CarIdx: 0 }] },
      SessionInfo: {
        Sessions: [{ SessionNum: 0, SessionType: 'Race', SessionLaps: '20' }],
      },
    } as unknown as Session);

    // Two laps done and a quarter of the third: 17.75 to go, not 18.75.
    processor.onFrame({
      SessionNum: { value: [0] },
      SessionState: { value: [4] },
      SessionTimeRemain: { value: [604800] },
      Lap: { value: [2] },
      LapCompleted: { value: [2] },
      LapDistPct: { value: [0.25] },
      CamCarIdx: { value: [0] },
      CarIdxLap: { value: [2] },
      CarIdxLapCompleted: { value: [2] },
      CarIdxLapDistPct: { value: [0.25] },
      CarIdxPosition: { value: [1] },
    } as unknown as Telemetry);

    expect(processor.snapshot()).toMatchObject({
      calculatedTotalRaceLaps: 20,
      estimatedLapsRemaining: 17.75,
      hasValidRaceEstimate: true,
    });
  });
});
