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

  describe('through a team-mate’s stint under Le Mans Ultimate', () => {
    const OWN = 1;
    const RIVAL = 0;
    const setup = () => {
      const processor = new SessionBarProcessor();
      processor.init({
        DriverInfo: {
          DriverCarIdx: OWN,
          Drivers: [
            { CarIdx: RIVAL, CarID: 1, CarClassID: 2 },
            { CarIdx: OWN, CarID: 2, CarClassID: 2 },
          ],
        },
        SessionInfo: {
          Sessions: [
            { SessionNum: 0, SessionName: 'Race', SessionType: 'Race' },
          ],
        },
      } as unknown as Session);
      return processor;
    };
    /** The team car's figures, as the mapper goes on publishing them. */
    const frame = (sessionTime: number, camCarIdx: number, lap = 12) =>
      ({
        SessionTime: { value: [sessionTime] },
        SessionNum: { value: [0] },
        IsOnTrack: { value: [false] },
        LmuWatching: { value: [true] },
        PlayerCarIdx: { value: [OWN] },
        CamCarIdx: { value: [camCarIdx] },
        Lap: { value: [lap] },
        Speed: { value: [72] },
        LapLastLapTime: { value: [104.5] },
        LapBestLapTime: { value: [103.9] },
        CarIdxPosition: { value: [3, 5] },
        CarIdxClassPosition: { value: [2, 4] },
        CarIdxBestLapTime: { value: [102.2, 103.9] },
        LmuCarIdxEnergyRemaining: { value: [0.8, 0.452] },
        LmuCarIdxEnergyIsVirtual: { value: [true, true] },
        LmuCarIdxTrackLimitsPoints: { value: [0, 0.25] },
        LmuTrackLimitsPointsMax: { value: [3] },
      }) as unknown as Telemetry;

    it('shows the team car’s figures while the camera is on it', () => {
      const processor = setup();
      processor.onFrame(frame(1, OWN, 12));
      // A lap on, so its top speed is a lap's.
      processor.onFrame(frame(2, OWN, 13));

      expect(processor.snapshot()).toMatchObject({
        lastLapTime: 104.5,
        bestLapTime: 103.9,
        virtualEnergy: 0.452,
        trackLimitsPoints: 0.25,
        playerOverallPosition: 5,
        playerClassPosition: 4,
        lastLapTopSpeed: 72,
        sessionBestTopSpeed: 72,
      });
    });

    it('withholds them while the camera is on a rival', () => {
      const processor = setup();
      processor.onFrame(frame(1, OWN, 12));
      processor.onFrame(frame(2, OWN, 13));
      processor.onFrame(frame(3, RIVAL, 13));

      const snapshot = processor.snapshot();
      // Still the team car's and still true, but not the car on screen.
      expect(snapshot.lastLapTime).toBeUndefined();
      expect(snapshot.bestLapTime).toBeUndefined();
      expect(snapshot.virtualEnergy).toBeUndefined();
      expect(snapshot.trackLimitsPoints).toBeUndefined();
      expect(snapshot.playerOverallPosition).toBe(0);
      expect(snapshot.playerClassPosition).toBe(0);
      expect(snapshot.lastLapTopSpeed).toBeNull();
      expect(snapshot.sessionBestTopSpeed).toBeNull();
      // What is the session's stays.
      expect(snapshot.sessionBestLap).toBe(102.2);
      expect(snapshot.trackLimitsPointsMax).toBe(3);
      expect(snapshot.playerCarIdx).toBe(OWN);
    });

    it('brings them back with the camera, top speeds included', () => {
      const processor = setup();
      processor.onFrame(frame(1, OWN, 12));
      processor.onFrame(frame(2, OWN, 13));
      processor.onFrame(frame(3, RIVAL, 13));
      processor.onFrame(frame(4, OWN, 13));

      expect(processor.snapshot()).toMatchObject({
        lastLapTime: 104.5,
        virtualEnergy: 0.452,
        playerOverallPosition: 5,
        lastLapTopSpeed: 72,
        sessionBestTopSpeed: 72,
      });
    });

    it('does not show a lap’s top speed that ended while the camera was away', () => {
      const processor = setup();
      processor.onFrame(frame(1, RIVAL, 12));
      processor.onFrame(frame(2, RIVAL, 13));

      expect(processor.snapshot().lastLapTopSpeed).toBeNull();

      // It was measured all the same, and is there once the camera returns.
      processor.onFrame(frame(3, OWN, 13));
      expect(processor.snapshot().lastLapTopSpeed).toBe(72);
    });
  });

  it('shows the player’s figures under iRacing whatever the camera is on', () => {
    // No word on watching in an iRacing frame: nothing is withheld.
    const processor = new SessionBarProcessor();
    processor.init({
      DriverInfo: {
        DriverCarIdx: 1,
        Drivers: [
          { CarIdx: 0, CarID: 1, CarClassID: 2 },
          { CarIdx: 1, CarID: 2, CarClassID: 2 },
        ],
      },
    } as unknown as Session);
    processor.onFrame({
      SessionTime: { value: [1] },
      SessionNum: { value: [0] },
      IsOnTrack: { value: [false] },
      PlayerCarIdx: { value: [1] },
      CamCarIdx: { value: [0] },
      LapLastLapTime: { value: [104.5] },
      CarIdxPosition: { value: [3, 5] },
    } as unknown as Telemetry);

    expect(processor.snapshot()).toMatchObject({
      lastLapTime: 104.5,
      playerOverallPosition: 5,
    });
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

  describe('the in-game clock', () => {
    const clockFrame = (
      sessionTime: number,
      timeOfDay: number | undefined,
      extra: Record<string, unknown> = {}
    ): Telemetry =>
      ({
        SessionTime: { value: [sessionTime] },
        SessionNum: { value: [0] },
        ...(timeOfDay === undefined
          ? {}
          : { SessionTimeOfDay: { value: [timeOfDay] } }),
        ...extra,
      }) as unknown as Telemetry;

    /** Every 0.2 s from `from` to `to`, with the day running at `scale`. */
    const drive = (
      processor: SessionBarProcessor,
      from: number,
      to: number,
      scale: number,
      startOfDay = 54_600
    ) => {
      const steps = Math.round((to - from) / 0.2);
      for (let step = 0; step <= steps; step += 1) {
        const time = from + step * 0.2;
        processor.onFrame(
          clockFrame(time, (startOfDay + time * scale) % 86_400)
        );
      }
    };

    it('measures the time scale once five seconds have passed', () => {
      const processor = new SessionBarProcessor();
      processor.init({} as Session);

      drive(processor, 0, 5, 2);
      expect(processor.snapshot().timeScale).toBeUndefined();
      expect(processor.snapshot().sessionTimeOfDay).toBe(54_610);

      drive(processor, 5.2, 12, 2);
      expect(processor.snapshot().timeScale).toBe(2);
    });

    it('reads a day at the pace of the session clock as 1 and a still one as 0', () => {
      const real = new SessionBarProcessor();
      real.init({} as Session);
      drive(real, 100, 106, 1);
      expect(real.snapshot().timeScale).toBe(1);

      const still = new SessionBarProcessor();
      still.init({} as Session);
      drive(still, 100, 106, 0);
      expect(still.snapshot().timeScale).toBe(0);
    });

    it('keeps the scale across midnight', () => {
      const processor = new SessionBarProcessor();
      processor.init({} as Session);
      // Starts 10 s before midnight.
      drive(processor, 0, 30, 1, 86_390);
      expect(processor.snapshot().timeScale).toBe(1);
      expect(processor.snapshot().sessionTimeOfDay).toBeCloseTo(20, 6);
    });

    it('shows what iRacing states until the scale has been measured', () => {
      const processor = new SessionBarProcessor();
      processor.init({
        WeekendInfo: { WeekendOptions: { EarthRotationSpeedupFactor: 4 } },
      } as unknown as Session);

      processor.onFrame(clockFrame(0, 30_000));
      expect(processor.snapshot().timeScale).toBe(4);

      // The measurement wins once there is one.
      drive(processor, 0.2, 6, 2, 30_000);
      expect(processor.snapshot().timeScale).toBe(2);
    });

    it('states nothing under Le Mans Ultimate before measuring', () => {
      const processor = new SessionBarProcessor();
      // The LMU mapper leaves the factor at 0, and the REST race setting is
      // deliberately not a stand-in.
      processor.init({
        WeekendInfo: { WeekendOptions: { EarthRotationSpeedupFactor: 0 } },
        LmuRest: { timeScale: 2 },
      } as unknown as Session);

      processor.onFrame(clockFrame(0, 30_000));
      expect(processor.snapshot().timeScale).toBeUndefined();
    });

    it('leaves the scale alone without a time of day', () => {
      const processor = new SessionBarProcessor();
      processor.init({} as Session);
      for (let time = 0; time <= 8; time += 0.2) {
        processor.onFrame(clockFrame(time, undefined));
      }
      expect(processor.snapshot().timeScale).toBeUndefined();
      expect(processor.snapshot().sessionTimeOfDay).toBeUndefined();
    });

    it('starts measuring again in a new session and after a disconnect', () => {
      const processor = new SessionBarProcessor();
      processor.init({} as Session);
      drive(processor, 0, 6, 2);
      expect(processor.snapshot().timeScale).toBe(2);

      processor.onFrame({
        ...clockFrame(0, 30_000),
        SessionNum: { value: [1] },
      } as unknown as Telemetry);
      expect(processor.snapshot().timeScale).toBeUndefined();

      drive(processor, 0, 6, 2);
      processor.onLifecycle({ type: 'disconnect' });
      expect(processor.snapshot().timeScale).toBeUndefined();
    });

    it('says whether the sun is up where the sim publishes its altitude', () => {
      const processor = new SessionBarProcessor();
      processor.init({} as Session);

      processor.onFrame(clockFrame(0, 30_000));
      expect(processor.snapshot().isDaylight).toBeUndefined();

      processor.onFrame(
        clockFrame(1, 30_001, { SolarAltitude: { value: [0.4] } })
      );
      expect(processor.snapshot().isDaylight).toBe(true);

      processor.onFrame(
        clockFrame(2, 30_002, { SolarAltitude: { value: [-0.1] } })
      );
      expect(processor.snapshot().isDaylight).toBe(false);
    });
  });
});
