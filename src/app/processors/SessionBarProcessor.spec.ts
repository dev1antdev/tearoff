import { describe, expect, it } from 'vitest';
import type { Session, Telemetry } from '@irdashies/types';
import { SessionBarProcessor } from './SessionBarProcessor';

describe('SessionBarProcessor', () => {
  it('refreshes incidents after a clock rewind and keeps the 5 Hz cadence', () => {
    const processor = new SessionBarProcessor();
    processor.init({} as Session);
    const frame = (time: number, incidents: number): Telemetry =>
      ({
        SessionTime: { value: [time] },
        SessionNum: { value: [2] },
        PlayerCarTeamIncidentCount: { value: [incidents] },
      }) as unknown as Telemetry;

    processor.onFrame(frame(600, 4));
    expect(processor.snapshot().incidents).toBe(4);
    const version = processor.snapshotVersion();
    processor.onFrame(frame(600.1, 5));
    expect(processor.snapshotVersion()).toBe(version);

    processor.onFrame(frame(0, 0));
    expect(processor.snapshot()).toMatchObject({ sessionNum: 2, incidents: 0 });
    const restartVersion = processor.snapshotVersion();
    expect(restartVersion).toBeGreaterThan(version);

    processor.onFrame(frame(0.1, 1));
    expect(processor.snapshot().incidents).toBe(0);
    expect(processor.snapshotVersion()).toBe(restartVersion);
    processor.onFrame(frame(0.2, 1));
    expect(processor.snapshot().incidents).toBe(1);
    expect(processor.snapshotVersion()).toBeGreaterThan(restartVersion);
    processor.onFrame(frame(30, 2));
    expect(processor.snapshot().incidents).toBe(2);
  });

  it('returns snapshots detached from reusable processor buffers', () => {
    const processor = new SessionBarProcessor();
    processor.init({
      DriverInfo: {
        DriverCarIdx: 0,
        Drivers: [{ CarIdx: 0, CarID: 67, CarClassID: 1 }],
      },
    } as unknown as Session);
    processor.onFrame({
      SessionTime: { value: [1] },
      SessionNum: { value: [1] },
      CarIdxPosition: { value: [1] },
    } as unknown as Telemetry);
    const published = processor.snapshot();
    processor.onFrame({
      SessionTime: { value: [1.2] },
      SessionNum: { value: [1] },
      CarIdxPosition: { value: [2] },
    } as unknown as Telemetry);
    expect(published.competitorPositions).toEqual([1]);
    expect(processor.snapshot().competitorPositions).toEqual([2]);
  });

  it('projects the auxiliary session bar state and resets with lifecycle', () => {
    const processor = new SessionBarProcessor();
    processor.init({
      WeekendInfo: {
        TrackDisplayName: 'Okayama',
        WeekendOptions: { IncidentLimit: 17 },
      },
      DriverInfo: {
        DriverCarIdx: 0,
        Drivers: [{ CarIdx: 0, CarID: 67, CarClassID: 1 }],
      },
      SessionInfo: {
        Sessions: [{ SessionNum: 1, SessionName: 'Race', SessionType: 'Race' }],
      },
    } as unknown as Session);
    processor.onFrame({
      SessionTime: { value: [1] },
      SessionNum: { value: [1] },
      DisplayUnits: { value: [1] },
      FuelLevel: { value: [30] },
      PlayerCarTeamIncidentCount: { value: [2] },
      CarIdxPosition: { value: [1] },
      CarIdxClassPosition: { value: [1] },
      CarIdxBestLapTime: { value: [90] },
      Lap: { value: [2] },
      Speed: { value: [50] },
    } as unknown as Telemetry);
    expect(processor.snapshot()).toMatchObject({
      sessionName: 'Race',
      trackDisplayName: 'Okayama',
      fuelLevel: 30,
      incidents: 2,
      playerClassPosition: 1,
      playerClassSize: 1,
      sessionBestLap: 90,
    });
    processor.onFrame({
      SessionTime: { value: [1.05] },
      SessionNum: { value: [1] },
      Lap: { value: [2] },
      Speed: { value: [70] },
    } as unknown as Telemetry);
    processor.onFrame({
      SessionTime: { value: [1.2] },
      SessionNum: { value: [1] },
      Lap: { value: [3] },
      Speed: { value: [40] },
    } as unknown as Telemetry);
    expect(processor.snapshot()).toMatchObject({
      lastLapTopSpeed: 70,
      sessionBestTopSpeed: 70,
    });
    processor.onLifecycle({ type: 'disconnect' });
    expect(processor.snapshot()).toMatchObject({
      sessionNum: null,
      incidents: 0,
    });
  });

  it('reports virtual energy only for a player car that runs on it', () => {
    const processor = new SessionBarProcessor();
    processor.init({
      DriverInfo: {
        DriverCarIdx: 1,
        Drivers: [
          { CarIdx: 0, CarID: 1, CarClassID: 1 },
          { CarIdx: 1, CarID: 2, CarClassID: 2 },
        ],
      },
      SessionInfo: {
        Sessions: [{ SessionNum: 0, SessionName: 'Race', SessionType: 'Race' }],
      },
    } as unknown as Session);
    const frame = (
      remaining: number[],
      isVirtual: boolean[],
      sessionTime: number
    ) =>
      ({
        SessionTime: { value: [sessionTime] },
        SessionNum: { value: [0] },
        FuelLevel: { value: [44.9] },
        LmuCarIdxEnergyRemaining: { value: remaining },
        LmuCarIdxEnergyIsVirtual: { value: isVirtual },
      }) as unknown as Telemetry;

    // The player's car, slot 1, runs on energy.
    processor.onFrame(frame([0.8, 0.452], [false, true], 1));
    expect(processor.snapshot()).toMatchObject({
      fuelLevel: 44.9,
      virtualEnergy: 0.452,
    });

    // Drained: 0 is a reading, and the one the item exists to show.
    processor.onFrame(frame([0.8, 0], [false, true], 2));
    expect(processor.snapshot().virtualEnergy).toBe(0);

    // A fuel-limited car carries a fraction in the same channel. It is fuel,
    // and must not be shown as energy.
    processor.onFrame(frame([0.8, 0.37], [true, false], 3));
    expect(processor.snapshot().virtualEnergy).toBeUndefined();
    expect(processor.snapshot().fuelLevel).toBe(44.9);
  });

  it('reports no virtual energy under iRacing, and no fuel without a reading', () => {
    const processor = new SessionBarProcessor();
    processor.init({
      DriverInfo: { DriverCarIdx: 0, Drivers: [{ CarIdx: 0, CarID: 1 }] },
      SessionInfo: {
        Sessions: [{ SessionNum: 0, SessionName: 'Race', SessionType: 'Race' }],
      },
    } as unknown as Session);
    processor.onFrame({
      SessionTime: { value: [1] },
      SessionNum: { value: [0] },
    } as unknown as Telemetry);

    expect(processor.snapshot().virtualEnergy).toBeUndefined();
    expect(processor.snapshot().fuelLevel).toBeUndefined();
  });
});
