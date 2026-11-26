import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  GlobalFlags,
  SessionState,
  type Session,
  type Telemetry,
} from '@irdashies/types';
import recordedTelemetry from '../../../irsdk/node/utils/mock-data/telemetry.json';
import recordedSession from '../../../irsdk/node/utils/mock-data/session.json';
import { generateMockData } from './generateMockData';

describe('generateMockData', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('supplies the same active race fields to every demo consumer without changing the recording', () => {
    const bridge = generateMockData();
    const frames: Telemetry[] = [];
    const originalState = recordedTelemetry.SessionState.value[0];
    bridge.onTelemetry((frame) => frames.push(frame));
    vi.advanceTimersByTime(100);
    expect(frames.length).toBeGreaterThan(0);
    for (const frame of frames) {
      expect(frame.SessionState.value[0]).toBe(SessionState.Racing);
      expect(frame.SessionFlags.value[0]).toBe(GlobalFlags.Green);
      expect(frame.SessionLapsRemainEx.value).toEqual(
        frame.SessionLapsRemain.value
      );
    }
    expect(recordedTelemetry.SessionState.value[0]).toBe(originalState);
    bridge.stop();
  });

  it('preserves explicit recording state instead of applying demo defaults', () => {
    const telemetry = structuredClone(
      recordedTelemetry
    ) as unknown as Telemetry;
    telemetry.SessionState.value[0] = SessionState.Checkered;
    const bridge = generateMockData({
      telemetry,
      sessionInfo: recordedSession as unknown as Session,
    });
    const receive = vi.fn();
    bridge.onTelemetry(receive);
    vi.advanceTimersByTime(100);
    expect(receive).toHaveBeenCalled();
    expect(receive.mock.calls[0][0].SessionState.value[0]).toBe(
      SessionState.Checkered
    );
    bridge.stop();
  });

  it('resumes telemetry for subscribers added after stop()', () => {
    // Regression: stop() cleared the intervals but left the handles truthy,
    // so the "start the interval only once" guards blocked any restart — a
    // stop()ed instance delivered nothing to later subscribers, silently.
    const bridge = generateMockData();

    const before = vi.fn();
    bridge.onTelemetry(before);
    vi.advanceTimersByTime(100);
    expect(before).toHaveBeenCalled();

    bridge.stop();

    const after = vi.fn();
    bridge.onTelemetry(after);
    vi.advanceTimersByTime(100);
    expect(after).toHaveBeenCalled();

    bridge.stop();
  });

  it('drives laps, so the lap times a widget shows move', () => {
    const bridge = generateMockData();
    const frames: Telemetry[] = [];
    bridge.onTelemetry((frame) => frames.push(frame));
    // Two demo laps: a lap is 1 / (0.0007 * 60) seconds long, about 24 s.
    vi.advanceTimersByTime(50_000);
    expect(frames.length).toBeGreaterThan(2_000);

    const first = frames[0];
    const last = frames[frames.length - 1];
    const lapsDone = last.LapCompleted.value[0] - first.LapCompleted.value[0];
    expect(lapsDone).toBeGreaterThanOrEqual(1);

    // The player's own lap time is the time it actually took, not the
    // recording's figure, and the car's best follows it.
    expect(last.LapLastLapTime.value[0]).toBeGreaterThan(20);
    expect(last.LapLastLapTime.value[0]).toBeLessThan(30);
    expect(last.CarIdxLastLapTime.value[4]).toBeCloseTo(
      last.LapLastLapTime.value[0],
      6
    );
    expect(last.LapBestLapTime.value[0]).toBeGreaterThan(0);
    expect(last.LapBestLapTime.value[0]).toBeLessThanOrEqual(
      last.LapLastLapTime.value[0] + 0.001
    );
    // The lap under way is timed from the last crossing, so it is shorter
    // than a whole lap.
    expect(last.LapCurrentLapTime.value[0]).toBeGreaterThan(0);
    expect(last.LapCurrentLapTime.value[0]).toBeLessThan(30);

    // Cars other than the player set laps too, and their count follows.
    const others = (last.CarIdxLapCompleted.value as number[])
      .map((laps, idx) => ({ laps, idx }))
      .filter(({ idx, laps }) => idx !== 4 && laps >= 0);
    expect(others.length).toBeGreaterThan(5);
    expect(
      others.some(
        ({ idx }) => (last.CarIdxLastLapTime.value[idx] as number) > 0
      )
    ).toBe(true);
    expect(last.CarIdxLap.value[4]).toBe(last.LapCompleted.value[0] + 1);

    bridge.stop();
  });

  it('emits a team racing session with distinct team names for the running mock app', () => {
    const bridge = generateMockData();
    const onSession = vi.fn();

    bridge.onSessionData(onSession);

    const session = onSession.mock.calls[0][0] as Session;
    const drivers = session.DriverInfo.Drivers.filter(
      (driver) => !driver.CarIsPaceCar
    );
    expect(session.WeekendInfo.TeamRacing).toBe(1);
    expect(drivers.every((driver) => driver.TeamID > 0)).toBe(true);
    expect(drivers.every((driver) => driver.TeamName !== driver.UserName)).toBe(
      true
    );
    expect(
      new Set(drivers.map((driver) => driver.TeamName)).size
    ).toBeGreaterThan(1);

    bridge.stop();
  });
});
