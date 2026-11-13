import { describe, expect, it } from 'vitest';
import type {
  LapInput,
  LapSessionInput,
  Session,
  Telemetry,
} from '@irdashies/types';
import { PlayerLapRecorder } from './PlayerLapRecorder';

/** One kilometre of track: a lap is 100 points, a point 1% of it. */
const session = ({
  subSessionId = 48213,
  trackId = 18,
  trackLength = '1 km',
  playerCarIdx = 0,
  car = { CarPath: 'bmwm4gt3', CarScreenName: 'BMW M4 GT3' } as Record<
    string,
    unknown
  >,
} = {}) =>
  ({
    WeekendInfo: {
      SubSessionID: subSessionId,
      TrackID: trackId,
      TrackName: 'roadamerica full',
      TrackDisplayName: 'Road America',
      TrackConfigName: 'Full Course',
      TrackLength: trackLength,
    },
    DriverInfo: {
      DriverCarIdx: playerCarIdx,
      Drivers: [
        { CarIdx: 0, ...car },
        { CarIdx: 1, CarPath: 'porsche992rgt3', CarScreenName: 'Porsche' },
      ],
    },
    SessionInfo: {
      Sessions: [
        { SessionNum: 0, SessionType: 'Practice', SessionName: 'PRACTICE' },
        { SessionNum: 1, SessionType: 'Race', SessionName: 'RACE' },
      ],
    },
  }) as unknown as Session;

interface FrameOptions {
  sessionNum?: number;
  onTrack?: boolean;
  onPitRoad?: boolean;
  voided?: boolean;
  incidents?: number | null;
  fuel?: number | null;
  speed?: number | null;
  lap?: number;
  energy?: number;
  energyIsVirtual?: boolean;
  airTemp?: number;
  trackTemp?: number;
}

const frame = (
  playerPct: number,
  sessionTime: number,
  {
    sessionNum = 1,
    onTrack = true,
    onPitRoad = false,
    voided = false,
    incidents = 0,
    fuel = 50,
    speed = 60,
    lap = 3,
    energy,
    energyIsVirtual,
    airTemp = 21,
    trackTemp = 30,
  }: FrameOptions = {}
) =>
  ({
    SessionTime: { value: [sessionTime] },
    SessionNum: { value: [sessionNum] },
    CarIdxLapDistPct: { value: [playerPct, 0.5] },
    CarIdxOnPitRoad: { value: [onPitRoad, false] },
    IsOnTrack: { value: [onTrack] },
    LmuLapInvalidated: { value: [voided] },
    Lap: { value: [lap] },
    AirTemp: { value: [airTemp] },
    TrackTempCrew: { value: [trackTemp] },
    ...(incidents === null
      ? {}
      : { PlayerCarMyIncidentCount: { value: [incidents] } }),
    ...(fuel === null ? {} : { FuelLevel: { value: [fuel] } }),
    ...(speed === null ? {} : { Speed: { value: [speed] } }),
    ...(energy === undefined
      ? {}
      : {
          LmuCarIdxEnergyRemaining: { value: [energy, 0.5] },
          LmuCarIdxEnergyIsVirtual: { value: [energyIsVirtual ?? true, false] },
        }),
  }) as unknown as Telemetry;

interface Recorded {
  session: LapSessionInput;
  lap: LapInput;
}

/** An LMU entry as it is while the player is in the car. */
const LMU_CAR = {
  CarPath: '74_26_KESS',
  CarModel: 'Ferrari 296 LMGT3 Evo',
  CarScreenName: 'Kessel Racing #74',
};

const setup = (
  simulator = 'iracing',
  // LMU files laps under the car's model, which iRacing does not report.
  start = session(simulator === 'lmu' ? { car: LMU_CAR } : {})
) => {
  const recorded: Recorded[] = [];
  let clock = Date.UTC(2026, 10, 13, 16, 0, 0);
  const recorder = new PlayerLapRecorder(
    {
      record: (lapSession, lap) => recorded.push({ session: lapSession, lap }),
    },
    { simulator, bootId: 'boot', now: () => (clock += 1000) }
  );
  recorder.onEnter();
  recorder.onSession(start);
  return { recorder, recorded };
};

/** Brings the car up to the line and across it at exactly `at`. */
const crossLine = (
  recorder: PlayerLapRecorder,
  at: number,
  options: FrameOptions = {}
) => {
  recorder.onFrame(frame(0.999, at - 0.06, options));
  recorder.onFrame(frame(0.001, at + 0.06, options));
};

/**
 * One lap of `lapTime` seconds at a steady pace, from a crossing at `start`
 * to the crossing that ends it. `options` may vary along the lap.
 */
const driveLap = (
  recorder: PlayerLapRecorder,
  start: number,
  lapTime: number,
  options: (pct: number) => FrameOptions = () => ({})
) => {
  const edge = 0.06 / lapTime;
  for (let point = 0; point < 100; point += 1) {
    const pct = (point + 0.5) / 100;
    recorder.onFrame(frame(pct, start + pct * lapTime, options(pct)));
  }
  recorder.onFrame(frame(1 - edge, start + lapTime - 0.06, options(0.999)));
  recorder.onFrame(frame(edge, start + lapTime + 0.06, options(1)));
};

describe('PlayerLapRecorder', () => {
  it('records a lap driven from line to line', () => {
    const { recorder, recorded } = setup();

    crossLine(recorder, 100);
    driveLap(recorder, 100, 60);

    expect(recorded).toHaveLength(1);
    const { lap } = recorded[0];
    expect(lap.lapTime).toBeCloseTo(60, 6);
    expect(lap).toMatchObject({
      lapNumber: 3,
      complete: true,
      pit: false,
      voided: false,
      own: true,
      incidents: 0,
      airTemp: 21,
      trackTemp: 30,
    });
  });

  it('describes the session the lap was driven in', () => {
    const { recorder, recorded } = setup();

    crossLine(recorder, 100);
    driveLap(recorder, 100, 60);

    expect(recorded[0].session).toMatchObject({
      simulator: 'iracing',
      sessionKey: '48213:1',
      trackId: 18,
      trackName: 'Road America',
      trackConfig: 'Full Course',
      trackLengthM: 1000,
      carKey: 'bmwm4gt3',
      carName: 'BMW M4 GT3',
      sessionType: 'Race',
      sessionName: 'RACE',
    });
  });

  it('keys an LMU car by its model, and trusts no session id there', () => {
    // CarPath is the livery file under LMU, and its session id is derived
    // from the track and session type, which two evenings share.
    const { recorder, recorded } = setup(
      'lmu',
      session({
        car: {
          CarPath: '74_26_KESS',
          CarModel: 'Ferrari 296 LMGT3 Evo',
          CarScreenName: 'Kessel Racing #74',
        },
      })
    );

    crossLine(recorder, 100);
    driveLap(recorder, 100, 60);

    expect(recorded[0].session).toMatchObject({
      simulator: 'lmu',
      sessionKey: '',
      carKey: 'Ferrari 296 LMGT3 Evo',
      carName: 'Kessel Racing #74',
    });
  });

  it('carries a session on through a trip out of the car under LMU', () => {
    // At the monitor LMU names no player car at all, and an entry without a
    // telemetry block has no model. Neither is a different car: a stop in
    // the garage must not split the session in the list.
    const ferrari = {
      CarPath: '74_26_KESS',
      CarModel: 'Ferrari 296 LMGT3 Evo',
      CarScreenName: 'Kessel Racing #74',
    };
    const { recorder, recorded } = setup('lmu', session({ car: ferrari }));
    crossLine(recorder, 100);
    driveLap(recorder, 100, 60);
    // Part of the next lap, then out of the car.
    for (let point = 0; point < 40; point += 1) {
      const pct = (point + 0.5) / 100;
      recorder.onFrame(frame(pct, 160 + pct * 60));
    }

    recorder.onSession(session({ playerCarIdx: -1, car: ferrari }));
    recorder.onFrame(frame(0.9, 230));
    // Back in the garage: the entry is there, the model is not yet.
    recorder.onSession(session({ car: { CarPath: '74_26_KESS' } }));
    recorder.onFrame(frame(0.9, 240));
    recorder.onSession(session({ car: ferrari }));

    crossLine(recorder, 300);
    driveLap(recorder, 300, 61);

    // The interrupted lap is not one; the two whole laps share a session.
    expect(recorded).toHaveLength(2);
    expect(recorded[0].session.token).toBe(recorded[1].session.token);
    expect(recorded[1].session.carKey).toBe('Ferrari 296 LMGT3 Evo');
    expect(recorded[1].session.carName).toBe('Kessel Racing #74');
  });

  it('never files an LMU lap under the livery', () => {
    // Before the model is known there is no car to file a lap under.
    const { recorder, recorded } = setup(
      'lmu',
      session({ car: { CarPath: '74_26_KESS' } })
    );

    crossLine(recorder, 100);
    driveLap(recorder, 100, 60);

    expect(recorded).toHaveLength(0);
  });

  it('carries a session on through spectating under iRacing', () => {
    const { recorder, recorded } = setup();
    crossLine(recorder, 100);
    driveLap(recorder, 100, 60);

    recorder.onSession(session({ playerCarIdx: -1 }));
    recorder.onSession(session());
    crossLine(recorder, 300);
    driveLap(recorder, 300, 61);

    expect(recorded).toHaveLength(2);
    expect(recorded[0].session.token).toBe(recorded[1].session.token);
  });

  it('trusts no session id from an iRacing test session either', () => {
    const { recorder, recorded } = setup(
      'iracing',
      session({ subSessionId: 0 })
    );

    crossLine(recorder, 100);
    driveLap(recorder, 100, 60);

    expect(recorded[0].session.sessionKey).toBe('');
  });

  it('keeps the curve: a point in every ten metres, with time and speed', () => {
    const { recorder, recorded } = setup();

    crossLine(recorder, 100);
    driveLap(recorder, 100, 60, (pct) => ({ speed: 40 + pct * 10 }));

    const curve = recorded[0].lap.curve;
    expect(curve?.pointPos).toHaveLength(100);
    expect(curve?.interval).toBeCloseTo(0.01, 6);
    expect(Array.from(curve?.pointPos ?? []).every((pct) => pct >= 0)).toBe(
      true
    );
    // The frame that revealed the crossing is the lap's first point.
    expect(curve?.pointPos[0]).toBeCloseTo(0.001, 6);
    expect(curve?.times[0]).toBeCloseTo(0.06, 4);
    expect(curve?.times[50]).toBeCloseTo(0.505 * 60, 3);
    // m/s in, km/h stored.
    expect(curve?.speedsKph?.[50]).toBeCloseTo((40 + 5.05) * 3.6, 3);
  });

  it('times the lap between the crossings, wherever the frames fall', () => {
    const { recorder, recorded } = setup();
    crossLine(recorder, 100);
    for (let point = 0; point < 100; point += 1) {
      const pct = (point + 0.5) / 100;
      recorder.onFrame(frame(pct, 100 + pct * 60));
    }

    // 90 ms short of the line, then 30 ms past it.
    recorder.onFrame(frame(0.9985, 159.91));
    recorder.onFrame(frame(0.0005, 160.03));

    expect(recorded[0].lap.lapTime).toBeCloseTo(60, 6);
  });

  it('records every lap, not only the quick ones', () => {
    const { recorder, recorded } = setup();
    crossLine(recorder, 100);

    driveLap(recorder, 100, 60);
    driveLap(recorder, 160, 63);
    driveLap(recorder, 223, 61);

    expect(recorded.map(({ lap }) => Number(lap.lapTime.toFixed(3)))).toEqual([
      60, 63, 61,
    ]);
    // One session: the same token throughout.
    expect(new Set(recorded.map(({ session: s }) => s.token)).size).toBe(1);
  });

  it('does not record the stretch before the first crossing', () => {
    // Leaving the pits, or the app started mid-lap: not a lap.
    const { recorder, recorded } = setup();

    for (let point = 40; point < 100; point += 1) {
      recorder.onFrame(frame((point + 0.5) / 100, 100 + point * 0.6));
    }
    recorder.onFrame(frame(0.999, 159.94));
    recorder.onFrame(frame(0.001, 160.06));
    expect(recorded).toHaveLength(0);

    driveLap(recorder, 160, 60);
    expect(recorded).toHaveLength(1);
  });

  it('does not time a lap from a car held at the line', () => {
    // LMU reports exactly 0 until a car on the grid, or rolling up to the
    // start, reaches the line.
    const { recorder, recorded } = setup('lmu');

    recorder.onFrame(frame(0.99, 69.9));
    for (let tick = 0; tick < 50; tick += 1) {
      recorder.onFrame(frame(0, 70 + tick * 0.5));
    }
    for (let point = 0; point < 100; point += 1) {
      const pct = (point + 0.1) / 100;
      recorder.onFrame(frame(pct, 100 + pct * 60));
    }
    recorder.onFrame(frame(0.999, 159.94));
    recorder.onFrame(frame(0.001, 160.06));
    expect(recorded).toHaveLength(0);

    driveLap(recorder, 160, 60);
    expect(recorded).toHaveLength(1);
  });

  it('marks a lap that touched pit road, and still records it', () => {
    const { recorder, recorded } = setup();
    crossLine(recorder, 100);

    driveLap(recorder, 100, 75, (pct) => ({ onPitRoad: pct > 0.9 }));

    expect(recorded[0].lap).toMatchObject({ pit: true, complete: true });
  });

  it('marks a lap the sim voided', () => {
    const { recorder, recorded } = setup('lmu');
    crossLine(recorder, 100);

    driveLap(recorder, 100, 60, (pct) => ({ voided: pct > 0.3 && pct < 1 }));

    expect(recorded[0].lap.voided).toBe(true);
  });

  it('ignores a void flag left over from the lap before, just after the line', () => {
    const { recorder, recorded } = setup('lmu');
    crossLine(recorder, 100, { voided: true });

    driveLap(recorder, 100, 60, (pct) => ({ voided: pct < 0.03 }));

    expect(recorded[0].lap.voided).toBe(false);
  });

  it('marks a lap the player was not driving throughout', () => {
    const { recorder, recorded } = setup();
    crossLine(recorder, 100);

    driveLap(recorder, 100, 60, (pct) => ({
      onTrack: pct < 0.4 || pct > 0.45,
    }));

    expect(recorded[0].lap.own).toBe(false);
  });

  it('counts the incidents picked up on the lap, not the running total', () => {
    const { recorder, recorded } = setup();
    crossLine(recorder, 100, { incidents: 3 });

    driveLap(recorder, 100, 60, (pct) => ({ incidents: pct < 0.7 ? 3 : 5 }));
    driveLap(recorder, 160, 60, () => ({ incidents: 5 }));

    expect(recorded.map(({ lap }) => lap.incidents)).toEqual([2, 0]);
  });

  it('leaves incidents unknown where the sim counts none', () => {
    const { recorder, recorded } = setup('lmu');
    crossLine(recorder, 100, { incidents: null });

    driveLap(recorder, 100, 60, () => ({ incidents: null }));

    expect(recorded[0].lap.incidents).toBeNull();
  });

  it('measures the fuel burned on the lap', () => {
    const { recorder, recorded } = setup();
    crossLine(recorder, 100, { fuel: 50 });

    driveLap(recorder, 100, 60, (pct) => ({ fuel: 50 - pct * 2.4 }));

    expect(recorded[0].lap.fuelUsed).toBeCloseTo(2.4, 3);
  });

  it('has no fuel figure for a lap with a pit stop in it', () => {
    const { recorder, recorded } = setup();
    crossLine(recorder, 100, { fuel: 10 });

    // More in the tank at the end than at the start.
    driveLap(recorder, 100, 90, (pct) => ({ fuel: pct < 0.95 ? 9 : 60 }));

    expect(recorded[0].lap.fuelUsed).toBeNull();
  });

  it('measures virtual energy for a car that runs on it', () => {
    const { recorder, recorded } = setup('lmu');
    crossLine(recorder, 100, { energy: 0.8 });

    driveLap(recorder, 100, 60, (pct) => ({ energy: 0.8 - pct * 0.021 }));

    expect(recorded[0].lap.energyUsed).toBeCloseTo(0.021, 4);
  });

  it('has no energy figure for a car that runs on fuel', () => {
    // The same channel carries a fuel fraction for such a car.
    const { recorder, recorded } = setup('lmu');
    crossLine(recorder, 100, { energy: 0.8, energyIsVirtual: false });

    driveLap(recorder, 100, 60, (pct) => ({
      energy: 0.8 - pct * 0.02,
      energyIsVirtual: false,
    }));

    expect(recorded[0].lap.energyUsed).toBeNull();
  });

  it('records a lap with a stretch it never sampled, without a curve', () => {
    const { recorder, recorded } = setup();
    crossLine(recorder, 100);

    // Frames 150 ms apart at racing speed skip whole ten-metre stretches.
    for (let point = 0; point < 100; point += 3) {
      const pct = (point + 0.5) / 100;
      recorder.onFrame(frame(pct, 100 + pct * 60));
    }
    recorder.onFrame(frame(0.999, 159.94));
    recorder.onFrame(frame(0.001, 160.06));

    expect(recorded[0].lap.lapTime).toBeCloseTo(60, 6);
    expect(recorded[0].lap.complete).toBe(false);
    expect(recorded[0].lap.curve).toBeNull();
  });

  it('keeps the curve but no speeds when the sim reports no speed', () => {
    const { recorder, recorded } = setup();
    crossLine(recorder, 100, { speed: null });

    driveLap(recorder, 100, 60, () => ({ speed: null }));

    expect(recorded[0].lap.complete).toBe(true);
    expect(recorded[0].lap.curve?.speedsKph).toBeNull();
  });

  it('drops a lap abandoned by a return to the pits', () => {
    const { recorder, recorded } = setup();
    crossLine(recorder, 100);
    for (let point = 0; point < 60; point += 1) {
      const pct = (point + 0.5) / 100;
      recorder.onFrame(frame(pct, 100 + pct * 60));
    }

    // Half a lap backwards in one frame, then round to the line.
    for (let point = 10; point < 100; point += 1) {
      const pct = (point + 0.5) / 100;
      recorder.onFrame(frame(pct, 140 + pct * 60));
    }
    recorder.onFrame(frame(0.999, 199.94));
    recorder.onFrame(frame(0.001, 200.06));

    expect(recorded).toHaveLength(0);
    // The lap after that one is whole.
    driveLap(recorder, 200, 60);
    expect(recorded).toHaveLength(1);
  });

  it('drops a lap when the sim has no position for the player', () => {
    const { recorder, recorded } = setup();
    crossLine(recorder, 100);
    for (let point = 0; point < 50; point += 1) {
      const pct = (point + 0.5) / 100;
      recorder.onFrame(frame(pct, 100 + pct * 60));
    }

    recorder.onFrame(frame(-1, 131));
    for (let point = 50; point < 100; point += 1) {
      const pct = (point + 0.5) / 100;
      recorder.onFrame(frame(pct, 101 + pct * 60));
    }
    recorder.onFrame(frame(0.999, 160.94));
    recorder.onFrame(frame(0.001, 161.06));

    expect(recorded).toHaveLength(0);
  });

  it('lists each part of an event as its own session', () => {
    const { recorder, recorded } = setup();
    crossLine(recorder, 100, { sessionNum: 0 });
    driveLap(recorder, 100, 60, () => ({ sessionNum: 0 }));

    // Practice ends mid-lap; the race starts its own clock.
    recorder.onFrame(frame(0.5, 5, { sessionNum: 1 }));
    crossLine(recorder, 40, { sessionNum: 1 });
    driveLap(recorder, 40, 61, () => ({ sessionNum: 1 }));

    expect(recorded.map(({ session: s }) => s.sessionType)).toEqual([
      'Practice',
      'Race',
    ]);
    expect(recorded.map(({ session: s }) => s.sessionKey)).toEqual([
      '48213:0',
      '48213:1',
    ]);
    expect(recorded[0].session.token).not.toBe(recorded[1].session.token);
  });

  it('starts a new session on a new connection, a new track or a new car', () => {
    const { recorder, recorded } = setup();
    crossLine(recorder, 100);
    driveLap(recorder, 100, 60);

    recorder.onDisconnect();
    recorder.onEnter();
    recorder.onSession(session());
    crossLine(recorder, 100);
    driveLap(recorder, 100, 60);

    recorder.onSession(session({ trackId: 19, subSessionId: 48214 }));
    crossLine(recorder, 300);
    driveLap(recorder, 300, 60);

    recorder.onSession(
      session({
        trackId: 19,
        subSessionId: 48214,
        car: { CarPath: 'ferrari296gt3', CarScreenName: 'Ferrari 296 GT3' },
      })
    );
    crossLine(recorder, 500);
    driveLap(recorder, 500, 60);

    const tokens = recorded.map(({ session: s }) => s.token);
    expect(new Set(tokens).size).toBe(4);
    expect(recorded[3].session.carKey).toBe('ferrari296gt3');
  });

  it('does not start a new session when the same session is announced again', () => {
    // LMU rebuilds the session twice a second.
    const { recorder, recorded } = setup();
    crossLine(recorder, 100);
    for (let point = 0; point < 100; point += 1) {
      const pct = (point + 0.5) / 100;
      recorder.onFrame(frame(pct, 100 + pct * 60));
      if (point % 10 === 0) recorder.onSession(session());
    }
    recorder.onFrame(frame(0.999, 159.94));
    recorder.onFrame(frame(0.001, 160.06));
    driveLap(recorder, 160, 61);

    expect(recorded).toHaveLength(2);
    expect(recorded[0].session.token).toBe(recorded[1].session.token);
  });

  it('records nothing while switched off, and no half lap on resuming', () => {
    const { recorder, recorded } = setup();
    crossLine(recorder, 100);
    for (let point = 0; point < 50; point += 1) {
      const pct = (point + 0.5) / 100;
      recorder.onFrame(frame(pct, 100 + pct * 60));
    }

    recorder.setEnabled(false);
    for (let point = 50; point < 100; point += 1) {
      const pct = (point + 0.5) / 100;
      recorder.onFrame(frame(pct, 100 + pct * 60));
    }
    recorder.onFrame(frame(0.999, 159.94));
    recorder.onFrame(frame(0.001, 160.06));
    recorder.setEnabled(true);
    for (let point = 1; point < 100; point += 1) {
      const pct = (point + 0.5) / 100;
      recorder.onFrame(frame(pct, 160 + pct * 60));
    }
    recorder.onFrame(frame(0.999, 219.94));
    recorder.onFrame(frame(0.001, 220.06));
    expect(recorded).toHaveLength(0);

    driveLap(recorder, 220, 60);
    expect(recorded).toHaveLength(1);
  });

  it('records nothing without a track length or a player car', () => {
    const noLength = setup('iracing', session({ trackLength: '' }));
    crossLine(noLength.recorder, 100);
    driveLap(noLength.recorder, 100, 60);
    expect(noLength.recorded).toHaveLength(0);

    const spectating = setup('iracing', session({ playerCarIdx: -1 }));
    crossLine(spectating.recorder, 100);
    driveLap(spectating.recorder, 100, 60);
    expect(spectating.recorded).toHaveLength(0);
  });

  it('stamps each lap with the wall clock when it finished', () => {
    const { recorder, recorded } = setup();
    crossLine(recorder, 100);

    driveLap(recorder, 100, 60);
    driveLap(recorder, 160, 60);

    expect(recorded[1].lap.completedAt).toBeGreaterThan(
      recorded[0].lap.completedAt
    );
  });

  it('counts laps from one under LMU, which counts the laps completed', () => {
    const { recorder, recorded } = setup('lmu');
    crossLine(recorder, 100, { lap: 0 });

    driveLap(recorder, 100, 60, () => ({ lap: 0 }));
    driveLap(recorder, 160, 60, () => ({ lap: 1 }));

    expect(recorded.map(({ lap }) => lap.lapNumber)).toEqual([1, 2]);
  });

  it('reads the lap number mid-lap, where the sim has settled on it', () => {
    const { recorder, recorded } = setup();
    // At the line the counter still shows the lap just finished.
    crossLine(recorder, 100, { lap: 6 });

    driveLap(recorder, 100, 60, (pct) => ({ lap: pct < 0.02 ? 6 : 7 }));

    expect(recorded[0].lap.lapNumber).toBe(7);
  });
});
