import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type {
  ChannelBridge,
  ChannelName,
  ChannelPayloads,
  FuelCalculatorBridge,
  FuelProjectionSnapshot,
} from '@irdashies/types';
import { defaultFuelCalculatorSettings } from './defaults';
import { useFuelCalculation } from './useFuelCalculation';
import { useFuelStore } from './FuelStore';

const projection: FuelProjectionSnapshot = {
  isReplay: false,
  fuelLevel: 41.750274658203125,
  fuelLevelPct: 0.4,
  currentLap: 3,
  lapDistPct: 0.00005058342503616586,
  currentLapUsage: 0,
  projectedLapUsage: 3.77,
  lastLapUsage: 3.6420249938964844,
  sessionLapsRemain: 14,
  sessionTimeRemain: 1200,
  sessionTimeTotal: 1800,
  sessionFlags: 268697600,
  sessionState: 4,
  sessionNum: 0,
  sessionLaps: 16,
  calculatedTotalRaceLaps: 16,
  estimatedLapsRemaining: 0,
  hasValidRaceEstimate: false,
  isFixedLapRace: true,
  sessionType: 'Race',
  isOnTrack: true,
  fuelTankCapacity: 104,
  completedLaps: [
    {
      lapNumber: 2,
      fuelUsed: 3.6420249938964844,
      lapTime: 131.3166666665473,
      isGreenFlag: true,
      isValidForCalc: true,
      isOutLap: false,
      isInLap: false,
      wasTowed: false,
      timestamp: 340270,
      sessionNum: 0,
    },
    {
      lapNumber: 1,
      fuelUsed: 3.565399169921875,
      lapTime: 139.73333333336973,
      isGreenFlag: true,
      isValidForCalc: true,
      isOutLap: false,
      isInLap: false,
      wasTowed: false,
      timestamp: 208971,
      sessionNum: 0,
    },
  ],
  engine: {
    accumulatedRefuel: 0,
    isLapDistPctReset: false,
    lapCrossingTime: 431.2000005085652,
    lapStartFuel: 41.750274658203125,
    lastLap: 3,
    lastLapDistPct: 0.00005058342503616586,
    lastSessionFlags: 268697600,
    wasOnPitRoad: false,
  },
};

const bridge: ChannelBridge = {
  subscribe: <K extends ChannelName>(
    _channel: K,
    callback: (payload: ChannelPayloads[K]) => void
  ) => {
    callback(projection as ChannelPayloads[K]);
    return () => undefined;
  },
};

describe('useFuelCalculation channel parity', () => {
  beforeEach(() => {
    useFuelStore.getState().clearAllData();
    window.channelBridge = bridge;
  });

  it('uses the completed lap from the current snapshot at a lap crossing', async () => {
    const { result } = renderHook(() =>
      useFuelCalculation(defaultFuelCalculatorSettings.safetyMargin, {
        ...defaultFuelCalculatorSettings,
        enableStorage: false,
        enableLogging: false,
      })
    );

    await waitFor(() => expect(result.current).not.toBeNull());
    expect(result.current?.lastLapUsage).toBeCloseTo(3.6420249938964844);
    expect(result.current?.avgLaps).toBeCloseTo(3.6037120819091797);
    expect(result.current?.currentLap).toBe(3);
  });

  it.each([32767, 30])(
    'uses the validated timed-race distance with raw remaining laps %s',
    async (rawLaps) => {
      window.channelBridge = {
        subscribe: <K extends ChannelName>(
          _channel: K,
          callback: (payload: ChannelPayloads[K]) => void
        ) => {
          callback({
            ...projection,
            currentLap: 8,
            lapDistPct: 0.8,
            sessionLaps: 'unlimited',
            sessionNum: 2,
            sessionLapsRemain: rawLaps,
            calculatedTotalRaceLaps: 20.1,
            estimatedLapsRemaining: 9.2,
            hasValidRaceEstimate: true,
            isFixedLapRace: false,
          } as ChannelPayloads[K]);
          return () => undefined;
        },
      };

      const { result } = renderHook(() =>
        useFuelCalculation(defaultFuelCalculatorSettings.safetyMargin, {
          ...defaultFuelCalculatorSettings,
          enableStorage: false,
          enableLogging: false,
        })
      );

      await waitFor(() => expect(result.current).not.toBeNull());
      expect(result.current?.lapsRemaining).toBe(9.2);
      expect(result.current?.lapsRemaining).not.toBeCloseTo(12.2);
      expect(result.current?.fuelToFinish).toBeCloseTo(
        9.2 * (result.current?.avgLaps ?? 0) +
          (defaultFuelCalculatorSettings.safetyMargin + 0.25) * 1.3
      );
    }
  );

  it.each([32767, 30])(
    'uses the active heat distance instead of raw remaining laps (%s)',
    async (rawLaps) => {
      window.channelBridge = {
        subscribe: <K extends ChannelName>(
          _channel: K,
          callback: (payload: ChannelPayloads[K]) => void
        ) => {
          callback({
            ...projection,
            sessionNum: 2,
            currentLap: 3,
            lapDistPct: 0.25,
            sessionLaps: 8,
            sessionLapsRemain: rawLaps,
            sessionTimeRemain: 604800,
            calculatedTotalRaceLaps: 8,
            estimatedLapsRemaining: 5.75,
            hasValidRaceEstimate: true,
            isFixedLapRace: true,
          } as ChannelPayloads[K]);
          return () => undefined;
        },
      };
      const { result } = renderHook(() =>
        useFuelCalculation(0.3, {
          ...defaultFuelCalculatorSettings,
          enableStorage: false,
          enableLogging: false,
        })
      );
      await waitFor(() => expect(result.current?.totalLaps).toBe(8));
      expect(result.current?.lapsRemaining).toBe(5.75);
      expect(result.current?.fuelToFinish).toBeCloseTo(
        5.75 * (result.current?.avgLaps ?? 0) + (0.3 + 0.25) * 1.3
      );
    }
  );

  it('accepts a validated zero-lap timed-race estimate', async () => {
    window.channelBridge = {
      subscribe: <K extends ChannelName>(
        _channel: K,
        callback: (payload: ChannelPayloads[K]) => void
      ) => {
        callback({
          ...projection,
          currentLap: 8,
          lapDistPct: 0.8,
          sessionLaps: 'unlimited',
          sessionLapsRemain: 32767,
          calculatedTotalRaceLaps: 8,
          estimatedLapsRemaining: 0,
          hasValidRaceEstimate: true,
          isFixedLapRace: false,
        } as ChannelPayloads[K]);
        return () => undefined;
      },
    };

    const { result } = renderHook(() =>
      useFuelCalculation(defaultFuelCalculatorSettings.safetyMargin, {
        ...defaultFuelCalculatorSettings,
        enableStorage: false,
        enableLogging: false,
      })
    );

    await waitFor(() => expect(result.current).not.toBeNull());
    expect(result.current?.lapsRemaining).toBe(0);
  });

  it('does not load or save live history for recorded replay', async () => {
    const getHistoricalLaps = vi.fn(async () => []);
    const saveLap = vi.fn(async () => undefined);
    window.fuelCalculatorBridge = {
      getHistoricalLaps,
      saveLap,
      clearHistory: vi.fn(async () => undefined),
      clearAllHistory: vi.fn(async () => undefined),
      getQualifyMax: vi.fn(async () => null),
      saveQualifyMax: vi.fn(async () => undefined),
      startNewLog: vi.fn(async () => undefined),
      logData: vi.fn(async () => undefined),
    } satisfies FuelCalculatorBridge;
    window.channelBridge = {
      subscribe: <K extends ChannelName>(
        _channel: K,
        callback: (payload: ChannelPayloads[K]) => void
      ) => {
        callback({
          ...projection,
          isReplay: true,
          trackId: 'roadamerica full',
          carName: 'bmwm4gt3',
        } as unknown as ChannelPayloads[K]);
        return () => undefined;
      },
    };

    const { result } = renderHook(() =>
      useFuelCalculation(defaultFuelCalculatorSettings.safetyMargin, {
        ...defaultFuelCalculatorSettings,
        enableStorage: true,
      })
    );

    await waitFor(() => expect(result.current).not.toBeNull());
    expect(getHistoricalLaps).not.toHaveBeenCalled();
    expect(saveLap).not.toHaveBeenCalled();
  });

  it('persists completed laps under the projection context', async () => {
    const saveLap = vi.fn(async () => undefined);
    window.fuelCalculatorBridge = {
      getHistoricalLaps: vi.fn(async () => []),
      saveLap,
      clearHistory: vi.fn(async () => undefined),
      clearAllHistory: vi.fn(async () => undefined),
      getQualifyMax: vi.fn(async () => null),
      saveQualifyMax: vi.fn(async () => undefined),
      startNewLog: vi.fn(async () => undefined),
      logData: vi.fn(async () => undefined),
    } satisfies FuelCalculatorBridge;
    useFuelStore.setState({ trackId: 'old-track', carName: 'old-car' });
    window.channelBridge = {
      subscribe: <K extends ChannelName>(
        _channel: K,
        callback: (payload: ChannelPayloads[K]) => void
      ) => {
        callback({
          ...projection,
          trackId: 'new-track',
          carName: 'new-car',
          completedLaps: projection.completedLaps.slice(0, 1),
        } as unknown as ChannelPayloads[K]);
        return () => undefined;
      },
    };

    renderHook(() =>
      useFuelCalculation(defaultFuelCalculatorSettings.safetyMargin, {
        ...defaultFuelCalculatorSettings,
        enableStorage: true,
      })
    );

    await waitFor(() => expect(saveLap).toHaveBeenCalledOnce());
    expect(saveLap).toHaveBeenCalledWith(
      'new-track',
      'new-car',
      projection.completedLaps[0]
    );
  });

  it('does not save a lap a team-mate drove, and still counts it', async () => {
    const saveLap = vi.fn(async () => undefined);
    const saveQualifyMax = vi.fn(async () => undefined);
    window.fuelCalculatorBridge = {
      getHistoricalLaps: vi.fn(async () => []),
      saveLap,
      clearHistory: vi.fn(async () => undefined),
      clearAllHistory: vi.fn(async () => undefined),
      getQualifyMax: vi.fn(async () => null),
      saveQualifyMax,
      startNewLog: vi.fn(async () => undefined),
      logData: vi.fn(async () => undefined),
    } satisfies FuelCalculatorBridge;
    useFuelStore.setState({ trackId: 'old-track', carName: 'old-car' });
    // The newer lap is the team-mate's, the older the user's own.
    const [latest, own] = projection.completedLaps;
    const teamMates = { ...latest, fuelUsed: 4.5, wasWatched: true };
    window.channelBridge = {
      subscribe: <K extends ChannelName>(
        _channel: K,
        callback: (payload: ChannelPayloads[K]) => void
      ) => {
        callback({
          ...projection,
          trackId: 'new-track',
          carName: 'new-car',
          lastLapUsage: teamMates.fuelUsed,
          completedLaps: [teamMates, own],
        } as unknown as ChannelPayloads[K]);
        return () => undefined;
      },
    };

    const { result } = renderHook(() =>
      useFuelCalculation(defaultFuelCalculatorSettings.safetyMargin, {
        ...defaultFuelCalculatorSettings,
        enableStorage: true,
      })
    );

    await waitFor(() => expect(saveLap).toHaveBeenCalledOnce());
    expect(saveLap).toHaveBeenCalledWith('new-track', 'new-car', own);
    // It is what the car used last lap, and is in the session's figures.
    await waitFor(() => expect(result.current).not.toBeNull());
    expect(result.current?.lastLapUsage).toBe(4.5);
    expect(result.current?.maxLapUsage).toBe(4.5);
  });

  it('never writes to disk when embedded', async () => {
    const getHistoricalLaps = vi.fn(async () => []);
    const saveLap = vi.fn(async () => undefined);
    const saveQualifyMax = vi.fn(async () => undefined);
    const startNewLog = vi.fn(async () => undefined);
    const logData = vi.fn(async () => undefined);
    window.fuelCalculatorBridge = {
      getHistoricalLaps,
      saveLap,
      clearHistory: vi.fn(async () => undefined),
      clearAllHistory: vi.fn(async () => undefined),
      getQualifyMax: vi.fn(async () => null),
      saveQualifyMax,
      startNewLog,
      logData,
    } satisfies FuelCalculatorBridge;
    window.channelBridge = {
      subscribe: <K extends ChannelName>(
        _channel: K,
        callback: (payload: ChannelPayloads[K]) => void
      ) => {
        callback({
          ...projection,
          sessionType: 'Open Qualify',
          trackId: 'new-track',
          carName: 'new-car',
        } as unknown as ChannelPayloads[K]);
        return () => undefined;
      },
    };

    const { result } = renderHook(() =>
      useFuelCalculation(
        defaultFuelCalculatorSettings.safetyMargin,
        {
          ...defaultFuelCalculatorSettings,
          enableStorage: true,
          enableLogging: true,
        },
        true
      )
    );

    // Reads still run. The same effects that would write have now fired.
    await waitFor(() => expect(getHistoricalLaps).toHaveBeenCalled());
    await waitFor(() =>
      expect(useFuelStore.getState().qualifyConsumption).not.toBeNull()
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current).not.toBeNull();
    expect(saveLap).not.toHaveBeenCalled();
    expect(saveQualifyMax).not.toHaveBeenCalled();
    expect(startNewLog).not.toHaveBeenCalled();
    expect(logData).not.toHaveBeenCalled();
  });

  it('retries lap persistence after a failed save', async () => {
    const saveLap = vi
      .fn<FuelCalculatorBridge['saveLap']>()
      .mockRejectedValueOnce(new Error('write failed'))
      .mockResolvedValue(undefined);
    window.fuelCalculatorBridge = {
      getHistoricalLaps: vi.fn(async () => []),
      saveLap,
      clearHistory: vi.fn(async () => undefined),
      clearAllHistory: vi.fn(async () => undefined),
      getQualifyMax: vi.fn(async () => null),
      saveQualifyMax: vi.fn(async () => undefined),
      startNewLog: vi.fn(async () => undefined),
      logData: vi.fn(async () => undefined),
    } satisfies FuelCalculatorBridge;
    const subscribers = new Set<(snapshot: FuelProjectionSnapshot) => void>();
    const liveProjection = {
      ...projection,
      trackId: 'new-track',
      carName: 'new-car',
      completedLaps: projection.completedLaps.slice(0, 1),
    };
    window.channelBridge = {
      subscribe: <K extends ChannelName>(
        _channel: K,
        callback: (payload: ChannelPayloads[K]) => void
      ) => {
        const typedCallback = callback as (
          snapshot: FuelProjectionSnapshot
        ) => void;
        subscribers.add(typedCallback);
        typedCallback(liveProjection);
        return () => subscribers.delete(typedCallback);
      },
    };

    renderHook(() =>
      useFuelCalculation(defaultFuelCalculatorSettings.safetyMargin, {
        ...defaultFuelCalculatorSettings,
        enableStorage: true,
      })
    );
    await waitFor(() => expect(saveLap).toHaveBeenCalledOnce());
    await act(async () => {
      await Promise.resolve();
      subscribers.forEach((subscriber) =>
        subscriber({
          ...liveProjection,
          completedLaps: [...liveProjection.completedLaps],
        })
      );
    });

    await waitFor(() => expect(saveLap).toHaveBeenCalledTimes(2));
  });
});

describe('useFuelCalculation tank capacity', () => {
  /** A snapshot with no completed laps, as every session has until lap one. */
  const withoutLaps = (
    overrides: Partial<FuelProjectionSnapshot> = {}
  ): FuelProjectionSnapshot => ({
    ...projection,
    completedLaps: [],
    currentLap: 1,
    ...overrides,
  });

  const renderWith = (snapshot: FuelProjectionSnapshot) => {
    window.channelBridge = {
      subscribe: <K extends ChannelName>(
        _channel: K,
        callback: (payload: ChannelPayloads[K]) => void
      ) => {
        callback(snapshot as ChannelPayloads[K]);
        return () => undefined;
      },
    };
    return renderHook(() =>
      useFuelCalculation(defaultFuelCalculatorSettings.safetyMargin, {
        ...defaultFuelCalculatorSettings,
        enableStorage: false,
        enableLogging: false,
      })
    );
  };

  it("reports the session's capacity before any lap is complete", async () => {
    // The early return used to carry a hardcoded 60, so an LMP2 that had
    // already reported a 100 L tank was shown as 60 until its first lap.
    const { result } = renderWith(withoutLaps({ fuelTankCapacity: 100 }));

    await waitFor(() => expect(result.current).not.toBeNull());
    expect(result.current?.fuelTankCapacity).toBe(100);
  });

  it('falls back to the default when the session reports none', async () => {
    const { result } = renderWith(withoutLaps({ fuelTankCapacity: 0 }));

    await waitFor(() => expect(result.current).not.toBeNull());
    expect(result.current?.fuelTankCapacity).toBe(60);
  });

  it('keeps reporting it once laps exist', async () => {
    const { result } = renderWith({ ...projection, fuelTankCapacity: 100 });

    await waitFor(() => expect(result.current).not.toBeNull());
    expect(result.current?.fuelTankCapacity).toBe(100);
  });
});

describe('useFuelCalculation in a session run to the clock', () => {
  const renderWith = (snapshot: FuelProjectionSnapshot) => {
    window.channelBridge = {
      subscribe: <K extends ChannelName>(
        _channel: K,
        callback: (payload: ChannelPayloads[K]) => void
      ) => {
        callback(snapshot as ChannelPayloads[K]);
        return () => undefined;
      },
    };
    return renderHook(() =>
      useFuelCalculation(defaultFuelCalculatorSettings.safetyMargin, {
        ...defaultFuelCalculatorSettings,
        enableStorage: false,
        enableLogging: false,
      })
    );
  };

  beforeEach(() => {
    useFuelStore.getState().clearAllData();
  });

  it.each([
    ['rFactor 2 as text', '2147483647'],
    ['rFactor 2', 2147483647],
    ['iRacing in telemetry', 32767],
    ['iRacing in the session', 'unlimited'],
  ])(
    'has no lap total before the first lap: %s',
    async (_from, sessionLaps) => {
      // No lap complete yet, so nothing has replaced what the session says,
      // and what Le Mans Ultimate said was shown: "Race L1 / 2147483647".
      const { result } = renderWith({
        ...projection,
        completedLaps: [],
        currentLap: 1,
        sessionLaps,
        sessionLapsRemain: 32767,
        isFixedLapRace: false,
      });

      await waitFor(() => expect(result.current).not.toBeNull());
      expect(result.current?.totalLaps).toBe(0);
      // Nor 32767 laps to go, which is what a timed session reports.
      expect(result.current?.lapsRemaining).toBe(0);
    }
  );

  it('keeps the lap total of a race that has one', async () => {
    const { result } = renderWith({
      ...projection,
      completedLaps: [],
      currentLap: 1,
      sessionLaps: '16',
      sessionLapsRemain: 15,
    });

    await waitFor(() => expect(result.current).not.toBeNull());
    expect(result.current?.totalLaps).toBe(16);
    expect(result.current?.lapsRemaining).toBe(15);
  });
});

describe('useFuelCalculation lap order', () => {
  const lap = (
    lapNumber: number,
    fuelUsed: number,
    timestamp: number,
    sessionNum: number
  ) => ({
    lapNumber,
    fuelUsed,
    lapTime: 90,
    isGreenFlag: true,
    isValidForCalc: true,
    isOutLap: false,
    isInLap: false,
    wasTowed: false,
    timestamp,
    sessionNum,
  });
  const storage = (
    stored: FuelProjectionSnapshot['completedLaps'] = [],
    saveLap = vi.fn<FuelCalculatorBridge['saveLap']>(async () => undefined)
  ) => {
    window.fuelCalculatorBridge = {
      getHistoricalLaps: vi.fn(async () =>
        stored.map((each) => ({ ...each, isHistorical: true }))
      ),
      saveLap,
      clearHistory: vi.fn(async () => undefined),
      clearAllHistory: vi.fn(async () => undefined),
      getQualifyMax: vi.fn(async () => null),
      saveQualifyMax: vi.fn(async () => undefined),
      startNewLog: vi.fn(async () => undefined),
      logData: vi.fn(async () => undefined),
    } satisfies FuelCalculatorBridge;
    return saveLap;
  };
  const renderWith = (snapshot: FuelProjectionSnapshot) => {
    window.channelBridge = {
      subscribe: <K extends ChannelName>(
        _channel: K,
        callback: (payload: ChannelPayloads[K]) => void
      ) => {
        callback(snapshot as ChannelPayloads[K]);
        return () => undefined;
      },
    };
    return renderHook(() =>
      useFuelCalculation(defaultFuelCalculatorSettings.safetyMargin, {
        ...defaultFuelCalculatorSettings,
        avgLapsCount: 3,
        enableStorage: true,
        enableLogging: false,
      })
    );
  };

  beforeEach(() => {
    useFuelStore.getState().clearAllData();
    useFuelStore.setState({ trackId: undefined, carName: undefined });
  });

  it('counts the laps just driven ahead of stored ones', async () => {
    // Stored from the end of an earlier 45-minute race, so by the session
    // clock they finished later than anything in a race two laps old, and
    // sorted by it they were the last three laps: 3.00 a lap, where the car
    // is now doing 2.00.
    storage([
      lap(30, 3, 2_700_000, 0),
      lap(29, 3, 2_610_000, 0),
      lap(28, 3, 2_520_000, 0),
    ]);
    const { result } = renderWith({
      ...projection,
      trackId: 'spa up',
      carName: 'bmwm4gt3',
      lastLapUsage: 2,
      completedLaps: [lap(2, 2, 190_000, 0), lap(1, 2, 100_000, 0)],
    });

    await waitFor(() =>
      expect(useFuelStore.getState().storedLaps).toHaveLength(3)
    );
    // The two laps of this race, then the most recent stored one.
    await waitFor(() => expect(result.current?.avgLaps).toBeCloseTo(7 / 3, 9));
    expect(result.current?.lastFinishedLap).toBe(2);
    // The extremes are of this session alone, as they were.
    expect(result.current?.maxLapUsage).toBe(2);
  });

  it('keeps stored laps in the order they were saved', async () => {
    // Storage hands back the most recently saved first, whatever the clock
    // read. Yesterday's qualifying was saved after yesterday's practice,
    // though its laps ended earlier in a session of their own.
    storage([
      lap(3, 2.9, 400_000, 1),
      lap(2, 2.8, 310_000, 1),
      lap(40, 3.6, 3_600_000, 0),
      lap(39, 3.5, 3_510_000, 0),
    ]);
    const { result } = renderWith({
      ...projection,
      trackId: 'spa up',
      carName: 'bmwm4gt3',
      lastLapUsage: 3,
      completedLaps: [lap(1, 3, 100_000, 0)],
    });

    await waitFor(() =>
      expect(useFuelStore.getState().storedLaps).toHaveLength(4)
    );
    await waitFor(() =>
      expect(result.current?.avgLaps).toBeCloseTo((3 + 2.9 + 2.8) / 3, 9)
    );
  });

  it('keeps the laps of a weekend in the order they were driven', async () => {
    // Practice, qualifying and now the race, all still held by the
    // processor, newest first. Each session's clock starts again, so the
    // race's first lap ended "before" every lap of the hour of practice.
    storage();
    const { result } = renderWith({
      ...projection,
      trackId: 'spa up',
      carName: 'bmwm4gt3',
      sessionNum: 2,
      lastLapUsage: 2,
      completedLaps: [
        lap(1, 2, 100_000, 2),
        lap(3, 2.6, 600_000, 1),
        lap(2, 2.6, 510_000, 1),
        lap(20, 4, 3_500_000, 0),
        lap(19, 4, 3_410_000, 0),
        lap(18, 4, 3_320_000, 0),
      ],
    });

    await waitFor(() =>
      expect(result.current?.avgLaps).toBeCloseTo((2 + 2.6 + 2.6) / 3, 9)
    );
    expect(result.current?.lastFinishedLap).toBe(1);
  });

  it('saves waiting laps oldest first, as storage orders them', async () => {
    // Shown in mid-race with two laps already recorded. Storage puts each
    // lap it is given in front of the last, so the newer goes in second.
    const saveLap = storage();
    const first = lap(1, 2, 100_000, 0);
    const second = lap(2, 2, 190_000, 0);
    renderWith({
      ...projection,
      trackId: 'spa up',
      carName: 'bmwm4gt3',
      completedLaps: [second, first],
    });

    await waitFor(() => expect(saveLap).toHaveBeenCalledTimes(2));
    expect(saveLap.mock.calls.map(([, , saved]) => saved)).toEqual([
      first,
      second,
    ]);
  });
});
