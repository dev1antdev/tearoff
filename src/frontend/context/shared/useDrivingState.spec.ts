import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useDrivingState, useWatchingOwnCarTelemetry } from './useDrivingState';
import { useTelemetryValue } from '../TelemetryStore/TelemetryStore';

// Mock the telemetry store
vi.mock('../TelemetryStore/TelemetryStore', () => ({
  useTelemetryValue: vi.fn(),
}));

// Whether the car being watched is the user's own entry. Not a frame key:
// the track state works it out from the watched car and the own entry.
const trackState = vi.hoisted(() => ({
  watchingOwnCar: false,
  /** And whether the sim is writing that car's pedals and revs. */
  watchingOwnCarTelemetry: false,
}));

vi.mock('../ChannelStore', () => ({
  trackStateSelectors: {
    watching: (snapshot: { watching?: boolean }) => snapshot.watching,
    watchingOwnCar: (snapshot: { watchingOwnCar?: boolean }) =>
      snapshot.watchingOwnCar,
    watchingOwnCarTelemetry: (snapshot: {
      watchingOwnCarTelemetry?: boolean;
    }) => snapshot.watchingOwnCarTelemetry === true,
  },
  useTrackStateSelector: vi.fn((selector) =>
    selector({
      isOnTrack: useTelemetryValue('IsOnTrack'),
      playerCarInPitStall: useTelemetryValue('PlayerCarInPitStall'),
      focusCarIdx: 0,
      carIdxOnPitRoad: [useTelemetryValue('CarIdxOnPitRoad')],
      isInGarage: useTelemetryValue('IsInGarage'),
      isGarageVisible: useTelemetryValue('IsGarageVisible'),
      isReplayPlaying: useTelemetryValue('IsReplayPlaying'),
      dataStale: useTelemetryValue('LmuDataStale'),
      outOfCar: useTelemetryValue('LmuOutOfCar'),
      watching: useTelemetryValue('LmuWatching'),
      watchingOwnCar: trackState.watchingOwnCar,
      // Left out of the snapshot until it holds.
      ...(trackState.watchingOwnCarTelemetry
        ? { watchingOwnCarTelemetry: true }
        : {}),
    })
  ),
}));

// The General setting "Keep Widgets On Screen While Watching", as the
// dashboard holds it. The hook that reads it, and what it makes of a
// dashboard without one, is covered with the dashboard context.
const general = vi.hoisted(() => ({ showWhileWatching: true }));
vi.mock('../DashboardContext/DashboardContext', () => ({
  useShowWhileWatching: () => general.showWhileWatching,
}));

describe('useDrivingState', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('actively driving scenarios', () => {
    it('should return true when on track and not in replay', () => {
      vi.mocked(useTelemetryValue).mockImplementation((key: string) => {
        switch (key) {
          case 'IsOnTrack':
            return true;
          case 'PlayerCarInPitStall':
            return false;
          case 'CarIdxOnPitRoad':
            return false;
          case 'IsInGarage':
            return false;
          case 'IsGarageVisible':
            return false;
          case 'IsReplayPlaying':
            return false;
          default:
            return undefined;
        }
      });

      const { result } = renderHook(() => useDrivingState());

      expect(result.current.isDriving).toBe(true);
      expect(useTelemetryValue).toHaveBeenCalledWith('IsOnTrack');
      expect(useTelemetryValue).toHaveBeenCalledWith('PlayerCarInPitStall');
      expect(useTelemetryValue).toHaveBeenCalledWith('CarIdxOnPitRoad');
      expect(useTelemetryValue).toHaveBeenCalledWith('IsInGarage');
      expect(useTelemetryValue).toHaveBeenCalledWith('IsGarageVisible');
      expect(useTelemetryValue).toHaveBeenCalledWith('IsReplayPlaying');
    });

    it('should return true when in pit stall and not in garage/replay', () => {
      vi.mocked(useTelemetryValue).mockImplementation((key: string) => {
        switch (key) {
          case 'IsOnTrack':
            return false;
          case 'PlayerCarInPitStall':
            return true;
          case 'CarIdxOnPitRoad':
            return false;
          case 'IsInGarage':
            return false;
          case 'IsGarageVisible':
            return false;
          case 'IsReplayPlaying':
            return false;
          default:
            return undefined;
        }
      });

      const { result } = renderHook(() => useDrivingState());

      expect(result.current.isDriving).toBe(true);
    });

    it('should return true when on pit road and not in garage/replay', () => {
      vi.mocked(useTelemetryValue).mockImplementation((key: string) => {
        switch (key) {
          case 'IsOnTrack':
            return false;
          case 'PlayerCarInPitStall':
            return false;
          case 'CarIdxOnPitRoad':
            return true;
          case 'IsInGarage':
            return false;
          case 'IsGarageVisible':
            return false;
          case 'IsReplayPlaying':
            return false;
          default:
            return undefined;
        }
      });

      const { result } = renderHook(() => useDrivingState());

      expect(result.current.isDriving).toBe(true);
    });

    it('should return true when on track and in pit stall simultaneously', () => {
      vi.mocked(useTelemetryValue).mockImplementation((key: string) => {
        switch (key) {
          case 'IsOnTrack':
            return true;
          case 'PlayerCarInPitStall':
            return true;
          case 'CarIdxOnPitRoad':
            return false;
          case 'IsInGarage':
            return false;
          case 'IsGarageVisible':
            return false;
          case 'IsReplayPlaying':
            return false;
          default:
            return undefined;
        }
      });

      const { result } = renderHook(() => useDrivingState());

      expect(result.current.isDriving).toBe(true);
    });
  });

  describe('non-driving scenarios', () => {
    it('should return false when in garage', () => {
      vi.mocked(useTelemetryValue).mockImplementation((key: string) => {
        switch (key) {
          case 'IsOnTrack':
            return true;
          case 'PlayerCarInPitStall':
            return false;
          case 'CarIdxOnPitRoad':
            return false;
          case 'IsInGarage':
            return true;
          case 'IsGarageVisible':
            return false;
          case 'IsReplayPlaying':
            return false;
          default:
            return undefined;
        }
      });

      const { result } = renderHook(() => useDrivingState());

      expect(result.current.isDriving).toBe(false);
    });

    it('should return false when watching replay', () => {
      vi.mocked(useTelemetryValue).mockImplementation((key: string) => {
        switch (key) {
          case 'IsOnTrack':
            return true;
          case 'PlayerCarInPitStall':
            return false;
          case 'CarIdxOnPitRoad':
            return false;
          case 'IsInGarage':
            return false;
          case 'IsGarageVisible':
            return false;
          case 'IsReplayPlaying':
            return true; // Watching replay
          default:
            return undefined;
        }
      });

      const { result } = renderHook(() => useDrivingState());

      expect(result.current.isDriving).toBe(false);
    });

    it('should return false when not on track, not in pit, not on pit road', () => {
      vi.mocked(useTelemetryValue).mockImplementation((key: string) => {
        switch (key) {
          case 'IsOnTrack':
            return false;
          case 'PlayerCarInPitStall':
            return false;
          case 'CarIdxOnPitRoad':
            return false;
          case 'IsInGarage':
            return false;
          case 'IsGarageVisible':
            return false;
          case 'IsReplayPlaying':
            return false;
          default:
            return undefined;
        }
      });

      const { result } = renderHook(() => useDrivingState());

      expect(result.current.isDriving).toBe(false);
    });

    it('should return false when all telemetry values are undefined', () => {
      vi.mocked(useTelemetryValue).mockReturnValue(undefined);

      const { result } = renderHook(() => useDrivingState());

      expect(result.current.isDriving).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('should return false when in garage even if also in pit stall', () => {
      vi.mocked(useTelemetryValue).mockImplementation((key: string) => {
        switch (key) {
          case 'IsOnTrack':
            return false;
          case 'PlayerCarInPitStall':
            return true;
          case 'CarIdxOnPitRoad':
            return false;
          case 'IsInGarage':
            return true; // In garage overrides pit stall
          case 'IsGarageVisible':
            return false;
          case 'IsReplayPlaying':
            return false;
          default:
            return undefined;
        }
      });

      const { result } = renderHook(() => useDrivingState());

      expect(result.current.isDriving).toBe(false);
    });

    it('should return false when watching replay even if on track', () => {
      vi.mocked(useTelemetryValue).mockImplementation((key: string) => {
        switch (key) {
          case 'IsOnTrack':
            return true;
          case 'PlayerCarInPitStall':
            return false;
          case 'CarIdxOnPitRoad':
            return false;
          case 'IsInGarage':
            return false;
          case 'IsGarageVisible':
            return false;
          case 'IsReplayPlaying':
            return true; // Replay overrides on track
          default:
            return undefined;
        }
      });

      const { result } = renderHook(() => useDrivingState());

      expect(result.current.isDriving).toBe(false);
    });

    it('should handle mixed boolean and undefined values correctly', () => {
      vi.mocked(useTelemetryValue).mockImplementation((key: string) => {
        switch (key) {
          case 'IsOnTrack':
            return undefined;
          case 'PlayerCarInPitStall':
            return true;
          case 'CarIdxOnPitRoad':
            return undefined;
          case 'IsInGarage':
            return false;
          case 'IsGarageVisible':
            return false;
          case 'IsReplayPlaying':
            return false;
          default:
            return undefined;
        }
      });

      const { result } = renderHook(() => useDrivingState());

      expect(result.current.isDriving).toBe(true);
    });
  });

  describe('telemetry calls', () => {
    it('should call useTelemetryValue with correct keys', () => {
      vi.mocked(useTelemetryValue).mockReturnValue(false);

      renderHook(() => useDrivingState());

      expect(useTelemetryValue).toHaveBeenCalledWith('IsOnTrack');
      expect(useTelemetryValue).toHaveBeenCalledWith('PlayerCarInPitStall');
      expect(useTelemetryValue).toHaveBeenCalledWith('CarIdxOnPitRoad');
      expect(useTelemetryValue).toHaveBeenCalledWith('IsInGarage');
      expect(useTelemetryValue).toHaveBeenCalledWith('IsGarageVisible');
      expect(useTelemetryValue).toHaveBeenCalledWith('IsReplayPlaying');
      // Nine, not six: the frame also carries whether the sim has stopped
      // writing it and whether LMU says the player is out of the car, both
      // checked before anything else, and whether the user is watching a
      // car. The snapshot is selected from four times -- driving, watching,
      // watching the own car and watching another -- and this mock builds
      // it afresh each time.
      expect(useTelemetryValue).toHaveBeenCalledWith('LmuDataStale');
      expect(useTelemetryValue).toHaveBeenCalledWith('LmuOutOfCar');
      expect(useTelemetryValue).toHaveBeenCalledWith('LmuWatching');
      expect(useTelemetryValue).toHaveBeenCalledTimes(36);
    });
  });
});

describe('useDrivingState while watching a car', () => {
  const state = (
    overrides: Record<string, boolean>,
    watchingOwnCar = false
  ) => {
    vi.mocked(useTelemetryValue).mockImplementation(
      (key: string) => overrides[key] ?? false
    );
    trackState.watchingOwnCar = watchingOwnCar;
    return renderHook(() => useDrivingState()).result.current;
  };

  /** Out of the car with a car to watch: the team car, or a rival. */
  const watching = { LmuWatching: true, LmuOutOfCar: true };
  /** A team-mate's stint, the camera left on the team car. */
  const teamMateDriving = () => state(watching, true);
  /** The same stint with the camera moved to a rival. */
  const cameraOnRival = () => state(watching, false);

  beforeEach(() => {
    general.showWhileWatching = true;
  });

  it('is watching the own car, and not driving, through a team-mate’s stint', () => {
    expect(teamMateDriving()).toEqual({
      isDriving: false,
      isWatching: true,
      isWatchingOwnCar: true,
      isWatchingOtherCar: false,
    });
  });

  it('is watching another car, and not the own one, with the camera on a rival', () => {
    expect(cameraOnRival()).toEqual({
      isDriving: false,
      isWatching: true,
      isWatchingOwnCar: false,
      isWatchingOtherCar: true,
    });
  });

  it('is not watching with the setting switched off', () => {
    general.showWhileWatching = false;

    expect(teamMateDriving()).toEqual({
      isDriving: false,
      isWatching: false,
      isWatchingOwnCar: false,
      isWatchingOtherCar: false,
    });
  });

  it('still says the camera is on another car with the setting switched off', () => {
    // The setting decides what stays on screen. That the own car's figures
    // are not the ones on screen is the sim's fact, whatever it says.
    general.showWhileWatching = false;

    expect(cameraOnRival()).toEqual({
      isDriving: false,
      isWatching: false,
      isWatchingOwnCar: false,
      isWatchingOtherCar: true,
    });
  });

  it('is driving, and not watching, at the wheel', () => {
    expect(state({ IsOnTrack: true })).toEqual({
      isDriving: true,
      isWatching: false,
      isWatchingOwnCar: false,
      isWatchingOtherCar: false,
    });
  });

  it('is neither at the monitor with nothing to watch', () => {
    expect(state({ LmuOutOfCar: true })).toEqual({
      isDriving: false,
      isWatching: false,
      isWatchingOwnCar: false,
      isWatchingOtherCar: false,
    });
  });

  it('does not count watching as driving, whatever the pit flags say', () => {
    // The watched car in the pit lane: the pit term of the driving gate is
    // true for the focus car, and the user is still not at the wheel.
    expect(state({ ...watching, CarIdxOnPitRoad: true }, true).isDriving).toBe(
      false
    );
  });

  it('leaves driving as it was with the setting switched off', () => {
    general.showWhileWatching = false;

    expect(state({ IsOnTrack: true }).isDriving).toBe(true);
    expect(state({ CarIdxOnPitRoad: true }).isDriving).toBe(true);
    expect(state({ IsOnTrack: true, IsInGarage: true }).isDriving).toBe(false);
  });
});

describe('useWatchingOwnCarTelemetry', () => {
  const watching = (telemetry: boolean) => {
    vi.mocked(useTelemetryValue).mockImplementation(
      (key: string) => key === 'LmuWatching' || key === 'LmuOutOfCar'
    );
    trackState.watchingOwnCar = true;
    trackState.watchingOwnCarTelemetry = telemetry;
    return renderHook(() => useWatchingOwnCarTelemetry()).result.current;
  };

  beforeEach(() => {
    general.showWhileWatching = true;
    trackState.watchingOwnCarTelemetry = false;
  });

  it('holds while the own car is watched and the sim writes its pedals and revs', () => {
    expect(watching(true)).toBe(true);
  });

  it('does not hold where the sim sends no block for the car', () => {
    // Watching the own car all the same, which is what the lap widgets ask.
    expect(watching(false)).toBe(false);
    expect(renderHook(() => useDrivingState()).result.current).toMatchObject({
      isWatchingOwnCar: true,
    });
  });

  it('does not hold with the setting switched off', () => {
    general.showWhileWatching = false;

    expect(watching(true)).toBe(false);
  });

  it('does not hold before the track state has said anything', () => {
    vi.mocked(useTelemetryValue).mockReturnValue(undefined);
    trackState.watchingOwnCar = false;
    trackState.watchingOwnCarTelemetry = false;

    expect(renderHook(() => useWatchingOwnCarTelemetry()).result.current).toBe(
      false
    );
  });
});

describe('useDrivingState with a frame the sim has stopped writing', () => {
  const frame = (overrides: Record<string, boolean>) => {
    vi.mocked(useTelemetryValue).mockImplementation(
      (key: string) => overrides[key] ?? false
    );
    return renderHook(() => useDrivingState()).result.current.isDriving;
  };

  it('is not driving once the data is stale, whatever the frame holds', () => {
    // The live case: a practice session ends with the player in the pits. The
    // last frame the sim wrote has CarIdxOnPitRoad true, and the three terms
    // are ORed -- so that alone kept every widget gated on this on screen
    // after the session was over, even with IsOnTrack already false.
    expect(frame({ CarIdxOnPitRoad: true, LmuDataStale: true })).toBe(false);
    expect(frame({ PlayerCarInPitStall: true, LmuDataStale: true })).toBe(
      false
    );
    expect(frame({ IsOnTrack: true, LmuDataStale: true })).toBe(false);
  });

  it('is driving on the same frame while the data is live', () => {
    // So the stale flag is doing the work, not the rest of the condition.
    expect(frame({ CarIdxOnPitRoad: true })).toBe(true);
    expect(frame({ IsOnTrack: true })).toBe(true);
  });

  it('is not driving while LMU says the player is out of the car', () => {
    // At the monitor with the car left in the pit lane or its stall: the data
    // is live and the pit terms are true, but the player is not in the car.
    expect(frame({ CarIdxOnPitRoad: true, LmuOutOfCar: true })).toBe(false);
    expect(frame({ PlayerCarInPitStall: true, LmuOutOfCar: true })).toBe(false);
  });

  it('is not driving in the garage, stale or not', () => {
    expect(frame({ IsOnTrack: true, IsInGarage: true })).toBe(false);
    expect(
      frame({ IsOnTrack: true, IsInGarage: true, LmuDataStale: true })
    ).toBe(false);
  });
});
