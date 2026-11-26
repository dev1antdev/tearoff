import type { IrSdkSourceBridge, Session, Telemetry } from '@irdashies/types';
import { GlobalFlags, SessionState } from '@irdashies/types';
import mockSessionInfo from '../../../irsdk/node/utils/mock-data/session.json';
import mockTelemetry from '../../../irsdk/node/utils/mock-data/telemetry.json';

/** How far round the lap every demo car moves in one tick at 60 Hz. */
const LAP_DISTANCE_INC = 0.0007;

/**
 * Where the demo's pit lane is, as a share of the lap, and how slowly a car
 * goes through it: the AI cars stop there now and then, so the tables and the
 * traffic widgets have stops to show.
 */
const PIT_WINDOW: readonly [number, number] = [0.02, 0.09];
const PIT_PACE = 0.3;

/** A car in the pit lane of this demo lap. */
const inPitWindow = (pct: number) =>
  pct >= PIT_WINDOW[0] && pct < PIT_WINDOW[1];

/**
 * The demo's session flags at a given session time: green, then a full-course
 * caution every few minutes and green again after it, so the flag widgets and
 * the Race Log have something to show.
 */
const DEMO_FLAG_CYCLE_SECONDS = 240;
const DEMO_CAUTION_START_SECONDS = 200;
const DEMO_CAUTION_END_SECONDS = 225;
const demoSessionFlags = (sessionTime: number): GlobalFlags => {
  const intoCycle = sessionTime % DEMO_FLAG_CYCLE_SECONDS;
  return intoCycle >= DEMO_CAUTION_START_SECONDS &&
    intoCycle < DEMO_CAUTION_END_SECONDS
    ? GlobalFlags.Yellow | GlobalFlags.Caution
    : GlobalFlags.Green;
};

const MOCK_TEAM_NAMES = [
  'Apex Racing',
  'Northstar Motorsport',
  'Pacific Coast Endurance Racing',
  'Cornerstone Esports',
  'Velocity Works',
  'Blue Flag Racing',
  'Redline Motorsport',
  'Silver Arrow Racing',
  'Gridline Engineering',
  'Summit Racing',
];

export async function generateMockDataFromPath(
  path?: string
): Promise<IrSdkSourceBridge> {
  if (!path) {
    return generateMockData();
  }

  const telemetry = (await import(/* @vite-ignore */ `${path}/telemetry.json`))
    .default;
  const sessionInfo = (await import(/* @vite-ignore */ `${path}/session.json`))
    .default;

  return generateMockData({
    telemetry,
    sessionInfo,
  });
}

export function generateMockData(sessionData?: {
  telemetry: Telemetry | Telemetry[];
  sessionInfo: Session | Session[];
}): IrSdkSourceBridge {
  let telemetryInterval: NodeJS.Timeout | null = null;
  let sessionInfoInterval: NodeJS.Timeout | null = null;
  let runningStateInterval: NodeJS.Timeout | null = null;

  const telemetry = sessionData?.telemetry;
  const sessionInfo = sessionData?.sessionInfo;

  let telemetryIdx = 0;
  let sessionIdx = 0;

  let prevTelemetry = mockTelemetry as unknown as Telemetry;

  const mockState = {
    fuelLevel: 45.0, // FUEL_START
    lapDistPct: 0.1, // Start a bit into the lap
    currentLap: 3,
    sessionTime: 600.0, // Start 10 mins in
    sessionLaps: 15,
    sessionLapsRemain: 12,
  };

  // Animate all cars around the track — seed initial positions from mock telemetry
  const PLAYER_CAR_IDX = 4; // DriverInfo.DriverCarIdx from mock session
  const carLapDistPcts = [
    ...(prevTelemetry.CarIdxLapDistPct.value as number[]),
  ];
  // Per-car speed multipliers: 1-3% variation so gaps are realistic
  const carSpeedMultipliers = carLapDistPcts.map((pct, idx) => {
    if (pct < 0) return 0; // not on track
    return 1 + (((idx * 7) % 7) - 3) / 100; // -3% to +3% variation
  });

  // Sector boundaries from the mock session (mirrors session.json SplitTimeInfo).
  // Used to pick a per-sector speed multiplier for the player so sector times
  // vary by up to ±1% each lap, producing realistic delta variance in the widget.
  const MOCK_SECTOR_STARTS = [
    0, 0.184456, 0.337214, 0.504637, 0.734279, 0.829332,
  ];

  /** Return the sector index (0-based) for a given lapDistPct. */
  function getPlayerSectorIdx(lapDistPct: number): number {
    let idx = 0;
    for (let i = MOCK_SECTOR_STARTS.length - 1; i >= 0; i--) {
      if (lapDistPct >= MOCK_SECTOR_STARTS[i]) {
        idx = i;
        break;
      }
    }
    return idx;
  }

  /** Generate a fresh set of per-sector multipliers, each ±1% of baseline. */
  function newSectorMultipliers(): number[] {
    return MOCK_SECTOR_STARTS.map(() => 0.99 + Math.random() * 0.02);
  }

  let playerSectorMultipliers = newSectorMultipliers();
  let playerCurrentSectorIdx = getPlayerSectorIdx(mockState.lapDistPct);

  // Lap timing of the demo, per car: how many laps each has done, when its
  // current lap began and the last laps it has set, all carried tick to tick
  // so that lap times in the demo move instead of standing at the recording's.
  const carLaps = [
    ...((prevTelemetry.CarIdxLapCompleted?.value as number[]) ?? []),
  ];
  const carLastLap = [
    ...((prevTelemetry.CarIdxLastLapTime?.value as number[]) ?? []),
  ];
  const carBestLap = [
    ...((prevTelemetry.CarIdxBestLapTime?.value as number[]) ?? []),
  ];
  /** Seconds for one lap at a car's own pace in the demo. */
  const demoLapSeconds = (multiplier: number) =>
    1 / (LAP_DISTANCE_INC * (multiplier || 1) * 60);
  /** When each car's current lap began, by the mock's session clock. */
  const carLapStart = carLapDistPcts.map((pct, idx) =>
    pct < 0
      ? mockState.sessionTime
      : mockState.sessionTime - pct * demoLapSeconds(carSpeedMultipliers[idx])
  );
  carLaps[PLAYER_CAR_IDX] = mockState.currentLap;
  // The air and the track as the recording left them: the demo drifts from
  // these, so the weather widgets are not one still frame.
  const reading = (key: keyof Telemetry) => {
    const value = (prevTelemetry[key] as { value?: unknown[] } | undefined)
      ?.value?.[0];
    return typeof value === 'number' ? value : 0;
  };
  const demoWeather = {
    airTemp: reading('AirTemp'),
    trackTemp: reading('TrackTemp'),
    crewTemp: reading('TrackTempCrew'),
    humidity: reading('RelativeHumidity'),
    windSpeed: reading('WindVel'),
    windDirection: reading('WindDir'),
  };

  /** Each car's class, from the recording: only cars in a class are placed. */
  const carClasses = [
    ...((prevTelemetry.CarIdxClass?.value as number[]) ?? []),
  ];

  // P2P demo: carIdx 1-4 are overridden to Dallara IR18 (CarID 99) in demo session
  const P2P_DEMO_CAR_IDXS = [1, 2, 3, 4];
  const P2P_IR18_CAR_ID = 99;

  // P2P demo telemetry state
  const p2pDemo = {
    frame: 0,
    activeCount: 100, // carIdx 2: slowly decreasing while active
  };
  // Cycle lengths for carIdx 4 (cooldown demo car): 5s active → transition → 5s inactive → repeat
  const P2P_CYCLE_FRAMES = 60 * 20; // 20s full cycle
  const P2P_ACTIVE_FRAMES = 60 * 5; // 5s active phase

  // Demo mode: Simulate RPM and gear changes for Mazda MX-5
  let demoRpm = 2000;
  let demoGear = 1;
  let holdAtRedlineCounter = 0; // Counter to hold at redline
  const shiftRpm = 7400; // BMW M4 GT4 shift point
  const minRpm = 2000;
  const rpmStep = 15; // RPM change per update
  const holdAtRedlineTicks = 15; // Hold for 1.5 seconds (15 ticks * 100ms)

  // Use Sets to support multiple subscribers
  const telemetryCallbacks = new Set<(value: Telemetry) => void>();
  const sessionCallbacks = new Set<(value: Session) => void>();
  const runningStateCallbacks = new Set<(value: boolean) => void>();

  return {
    onTelemetry: (callback: (value: Telemetry) => void) => {
      telemetryCallbacks.add(callback);

      // Start interval only once
      if (!telemetryInterval) {
        telemetryInterval = setInterval(() => {
          let t = Array.isArray(telemetry)
            ? telemetry[telemetryIdx % telemetry.length]
            : telemetry;
          if (!t) {
            const throttleValue = prevTelemetry.Throttle.value[0];
            const brakeValue = prevTelemetry.Brake.value[0];
            const jitteredBrakeValue = jitterValue(brakeValue);

            // Simulate RPM and gear changes for demo mode
            // Check if we're at or above shift RPM
            if (demoRpm >= shiftRpm) {
              // Hold at redline for a moment
              if (holdAtRedlineCounter < holdAtRedlineTicks) {
                holdAtRedlineCounter++;
                demoRpm = shiftRpm; // Keep at exactly shift RPM
              } else {
                // Shift up after holding
                demoGear = Math.min(6, demoGear + 1);
                demoRpm = minRpm + 1000; // Drop RPM after shift
                holdAtRedlineCounter = 0; // Reset counter
                // After reaching 6th gear, loop back to 1st
                if (demoGear > 6) {
                  demoGear = 1;
                }
              }
            } else {
              // Normal RPM increase
              demoRpm += rpmStep;
            }

            // --- Fuel Calculator Mock Logic Start ---
            // Constants for simulation
            const FUEL_TANK_MAX = 60.0;
            const FUEL_PER_LAP = 2.2;
            const SESSION_TIME_INC = 1 / 60; // Seconds per tick

            // Update Lap Distance — apply this sector's speed multiplier so
            // sector times vary by ±1% of baseline, changing each lap.
            const newSectorIdx = getPlayerSectorIdx(mockState.lapDistPct);
            if (newSectorIdx !== playerCurrentSectorIdx) {
              playerCurrentSectorIdx = newSectorIdx;
            }
            mockState.lapDistPct +=
              LAP_DISTANCE_INC *
              playerSectorMultipliers[playerCurrentSectorIdx];

            // Handle Lap Completion
            if (mockState.lapDistPct >= 1.0) {
              mockState.lapDistPct = 0.0;
              mockState.currentLap += 1;
              mockState.sessionLapsRemain = Math.max(
                0,
                mockState.sessionLapsRemain - 1
              );
              // Pick new per-sector multipliers for the next lap
              playerSectorMultipliers = newSectorMultipliers();
              playerCurrentSectorIdx = 0;
            }

            // Update Fuel (consume based on distance)
            // Fuel consumed = (Fuel Per Lap) * (Distance Fraction traveled this tick)
            // Since we increment dist by LAP_DISTANCE_INC, we consume that fraction of a lap's fuel
            const fuelConsumedThisTick = FUEL_PER_LAP * LAP_DISTANCE_INC;
            mockState.fuelLevel = Math.max(
              0,
              mockState.fuelLevel - fuelConsumedThisTick
            );

            // Update Session Time
            mockState.sessionTime += SESSION_TIME_INC;

            // --- Fuel Calculator Mock Logic End ---

            // Animate all on-track cars forward; sync player car with mockState
            const pctBeforeTick = [...carLapDistPcts];
            for (let i = 0; i < carLapDistPcts.length; i++) {
              if (carLapDistPcts[i] < 0) continue; // not on track
              if (i === PLAYER_CAR_IDX) {
                carLapDistPcts[i] = mockState.lapDistPct;
              } else {
                const pace = inPitWindow(carLapDistPcts[i]) ? PIT_PACE : 1;
                carLapDistPcts[i] =
                  (carLapDistPcts[i] +
                    LAP_DISTANCE_INC * carSpeedMultipliers[i] * pace) %
                  1;
              }
            }

            const state = mockState;

            // A car whose distance fell back has crossed the line: it sets a
            // lap time, keeps it as its best if it is, and starts the next.
            for (let i = 0; i < carLapDistPcts.length; i++) {
              if (carLapDistPcts[i] < 0 || pctBeforeTick[i] < 0) continue;
              if (carLapDistPcts[i] >= pctBeforeTick[i]) continue;
              const lap = state.sessionTime - carLapStart[i];
              carLapStart[i] = state.sessionTime;
              carLastLap[i] = lap;
              carBestLap[i] =
                carBestLap[i] > 0 ? Math.min(carBestLap[i], lap) : lap;
              carLaps[i] = Math.max(0, carLaps[i]) + 1;
            }

            // Where each car stands in the field, and how long it has to go
            // to the line: from the distances the demo moves, so the order
            // and the gaps follow the cars instead of the recording's.
            const placement = carLapDistPcts.map((pct, idx) => ({
              idx,
              pct,
              distance: pct < 0 || carLaps[idx] < 0 ? -1 : carLaps[idx] + pct,
              lapSeconds: demoLapSeconds(carSpeedMultipliers[idx]),
            }));
            // A car is in the pit lane while the demo has it there; the
            // player drives through, so it is never the player.
            const carIdxOnPitRoad = carLapDistPcts.map(
              (pct, idx) =>
                idx !== PLAYER_CAR_IDX && pct >= 0 && inPitWindow(pct)
            );
            const sessionFlags = demoSessionFlags(state.sessionTime);
            const incidents =
              Number(
                (
                  prevTelemetry.PlayerCarMyIncidentCount?.value as number[]
                )?.[0] ?? 0
              ) +
              2 * Math.floor(state.sessionTime / 90);

            const onTrack = placement
              .filter(({ distance }) => distance >= 0)
              .sort((a, b) => b.distance - a.distance);
            const carIdxPosition = new Array(carLapDistPcts.length).fill(0);
            const carIdxClassPosition = new Array(carLapDistPcts.length).fill(
              0
            );
            const carIdxEstTime = [...carLapDistPcts].map((pct, idx) =>
              pct < 0 ? 0 : (1 - pct) * demoLapSeconds(carSpeedMultipliers[idx])
            );
            const classCounts = new Map<number, number>();
            onTrack.forEach(({ idx }, place) => {
              carIdxPosition[idx] = place + 1;
              const classId = carClasses[idx] ?? 0;
              const inClass = (classCounts.get(classId) ?? 0) + 1;
              classCounts.set(classId, inClass);
              carIdxClassPosition[idx] = inClass;
            });

            // The air and the track drift through the session at their own
            // paces, as a real afternoon's do: a few degrees of air, more of
            // track, the wind veering and easing.
            const drift = (
              baseline: number,
              amplitude: number,
              periodSeconds: number
            ) =>
              baseline +
              amplitude *
                Math.sin((2 * Math.PI * state.sessionTime) / periodSeconds);
            const weather = {
              airTemp: drift(demoWeather.airTemp, 3, 300),
              trackTemp: drift(demoWeather.trackTemp, 5, 240),
              crewTemp: drift(demoWeather.crewTemp, 4, 240),
              humidity: Math.min(
                0.95,
                Math.max(0.1, drift(demoWeather.humidity, 0.08, 400))
              ),
              windSpeed: Math.max(0, drift(demoWeather.windSpeed, 1.5, 120)),
              windDirection:
                demoWeather.windDirection +
                (2 * Math.PI * state.sessionTime) / 600,
            };

            // Enable ABS when brake force is above 80% in demo mode
            const absActive = jitteredBrakeValue > 0.8;
            const prevAbs =
              prevTelemetry.BrakeABSactive ?? ({ value: [false] } as const);

            // P2P demo: advance frame counter and update state
            p2pDemo.frame++;
            // carIdx 2 (active): count decreases 1/s, resets to 100 when exhausted
            if (p2pDemo.frame % 60 === 0) {
              p2pDemo.activeCount =
                p2pDemo.activeCount > 0 ? p2pDemo.activeCount - 1 : 100;
            }
            // carIdx 4 (cooldown cycle): active for 5s, then transitions to inactive
            const cycleFrame = p2pDemo.frame % P2P_CYCLE_FRAMES;
            const cooldownCarActive = cycleFrame < P2P_ACTIVE_FRAMES;

            const demoP2PStatus = [
              ...prevTelemetry.CarIdxP2P_Status.value,
            ] as boolean[];
            const demoP2PCount = [
              ...prevTelemetry.CarIdxP2P_Count.value,
            ] as number[];
            demoP2PStatus[1] = false; // inactive
            demoP2PCount[1] = 150;
            demoP2PStatus[2] = true; // active
            demoP2PCount[2] = p2pDemo.activeCount;
            demoP2PStatus[3] = false; // exhausted
            demoP2PCount[3] = 0;
            demoP2PStatus[4] = cooldownCarActive; // cycling for cooldown demo
            demoP2PCount[4] = 80;

            t = {
              ...prevTelemetry,
              // All demo hosts simulate an active race. Recorded input above
              // retains its original state, including checkered/replay frames.
              SessionState: {
                ...prevTelemetry.SessionState,
                value: [SessionState.Racing],
              },
              SessionFlags: {
                ...prevTelemetry.SessionFlags,
                value: [sessionFlags],
              },
              Brake: {
                ...prevTelemetry.Brake,
                value: [jitteredBrakeValue],
              },
              Throttle: {
                ...prevTelemetry.Throttle,
                value: [jitterValue(throttleValue)],
              },
              Gear: {
                ...prevTelemetry.Gear,
                value: [demoGear],
              },
              Speed: {
                ...prevTelemetry.Speed,
                value: [44 + demoGear * 10],
              },
              RPM: {
                ...prevTelemetry.RPM,
                value: [demoRpm],
              },
              // Inject Fuel Calculator Mock Values
              FuelLevel: {
                ...prevTelemetry.FuelLevel,
                value: [state.fuelLevel],
              },
              FuelLevelPct: {
                ...prevTelemetry.FuelLevelPct,
                value: [state.fuelLevel / FUEL_TANK_MAX],
              },
              Lap: {
                ...prevTelemetry.Lap,
                value: [state.currentLap],
              },
              LapCompleted: {
                ...prevTelemetry.LapCompleted,
                value: [carLaps[PLAYER_CAR_IDX]],
              },
              LapCurrentLapTime: {
                ...prevTelemetry.LapCurrentLapTime,
                value: [state.sessionTime - carLapStart[PLAYER_CAR_IDX]],
              },
              LapLastLapTime: {
                ...prevTelemetry.LapLastLapTime,
                value: [
                  carLastLap[PLAYER_CAR_IDX] > 0
                    ? carLastLap[PLAYER_CAR_IDX]
                    : prevTelemetry.LapLastLapTime?.value?.[0],
                ],
              },
              LapBestLapTime: {
                ...prevTelemetry.LapBestLapTime,
                value: [
                  carBestLap[PLAYER_CAR_IDX] > 0
                    ? carBestLap[PLAYER_CAR_IDX]
                    : prevTelemetry.LapBestLapTime?.value?.[0],
                ],
              },
              CarIdxLapCompleted: {
                ...prevTelemetry.CarIdxLapCompleted,
                value: [...carLaps],
              },
              CarIdxLap: {
                ...prevTelemetry.CarIdxLap,
                value: carLaps.map((laps) => (laps < 0 ? laps : laps + 1)),
              },
              CarIdxLastLapTime: {
                ...prevTelemetry.CarIdxLastLapTime,
                value: [...carLastLap],
              },
              CarIdxBestLapTime: {
                ...prevTelemetry.CarIdxBestLapTime,
                value: [...carBestLap],
              },
              CarIdxOnPitRoad: {
                ...prevTelemetry.CarIdxOnPitRoad,
                value: carIdxOnPitRoad,
              },
              PlayerCarMyIncidentCount: {
                ...prevTelemetry.PlayerCarMyIncidentCount,
                value: [incidents],
              },
              PlayerCarDriverIncidentCount: {
                ...prevTelemetry.PlayerCarDriverIncidentCount,
                value: [incidents],
              },
              AirTemp: { ...prevTelemetry.AirTemp, value: [weather.airTemp] },
              TrackTemp: {
                ...prevTelemetry.TrackTemp,
                value: [weather.trackTemp],
              },
              TrackTempCrew: {
                ...prevTelemetry.TrackTempCrew,
                value: [weather.crewTemp],
              },
              RelativeHumidity: {
                ...prevTelemetry.RelativeHumidity,
                value: [weather.humidity],
              },
              WindVel: { ...prevTelemetry.WindVel, value: [weather.windSpeed] },
              WindDir: {
                ...prevTelemetry.WindDir,
                value: [weather.windDirection],
              },
              CarIdxPosition: {
                ...prevTelemetry.CarIdxPosition,
                value: carIdxPosition,
              },
              CarIdxClassPosition: {
                ...prevTelemetry.CarIdxClassPosition,
                value: carIdxClassPosition,
              },
              CarIdxEstTime: {
                ...prevTelemetry.CarIdxEstTime,
                value: carIdxEstTime,
              },
              PlayerCarPosition: {
                ...prevTelemetry.PlayerCarPosition,
                value: [carIdxPosition[PLAYER_CAR_IDX]],
              },
              PlayerCarClassPosition: {
                ...prevTelemetry.PlayerCarClassPosition,
                value: [carIdxClassPosition[PLAYER_CAR_IDX]],
              },
              LapDistPct: {
                ...prevTelemetry.LapDistPct,
                value: [state.lapDistPct],
              },
              CarIdxLapDistPct: {
                ...prevTelemetry.CarIdxLapDistPct,
                value: [...carLapDistPcts],
              },
              SessionTime: {
                ...prevTelemetry.SessionTime,
                value: [state.sessionTime],
              },
              // Advance with SessionTime at iRacing's 60 ticks per second: the
              // processor host rate-limits on SessionTick, so a frozen tick
              // would run every processor on every frame.
              SessionTick: {
                ...prevTelemetry.SessionTick,
                value: [Math.round(state.sessionTime * 60)],
              },
              SessionLapsRemain: {
                ...prevTelemetry.SessionLapsRemain,
                value: [state.sessionLapsRemain],
              },
              SessionLapsRemainEx: {
                ...prevTelemetry.SessionLapsRemainEx,
                value: [state.sessionLapsRemain],
              },
              SessionTimeRemain: {
                ...prevTelemetry.SessionTimeRemain,
                value: [state.sessionLapsRemain * 90], // Roughly 1.5 min laps
              },
              IsOnTrack: {
                ...prevTelemetry.IsOnTrack,
                value: [true],
              },
              OnPitRoad: {
                ...prevTelemetry.OnPitRoad,
                value: [false],
              },
              BrakeABSactive: {
                ...prevAbs,
                value: [absActive],
              },
              CarIdxP2P_Status: {
                ...prevTelemetry.CarIdxP2P_Status,
                value: demoP2PStatus,
              },
              CarIdxP2P_Count: {
                ...prevTelemetry.CarIdxP2P_Count,
                value: demoP2PCount,
              },
            } as unknown as Telemetry;
            prevTelemetry = t;
          }

          telemetryIdx = telemetryIdx + 1;
          const data = t;

          // Call all registered callbacks
          telemetryCallbacks.forEach((cb) => cb(data));
        }, 1000 / 60); // Update at 60Hz for smooth telemetry simulation
      }

      // Return unsubscribe function
      return () => {
        telemetryCallbacks.delete(callback);
        // Stop interval if no more callbacks
        if (telemetryCallbacks.size === 0 && telemetryInterval) {
          clearInterval(telemetryInterval);
          telemetryInterval = null;
        }
      };
    },
    onSessionData: (callback: (value: Session) => void) => {
      sessionCallbacks.add(callback);

      const updateSessionData = () => {
        let s = Array.isArray(sessionInfo)
          ? sessionInfo[sessionIdx % sessionInfo.length]
          : sessionInfo;

        if (!s) {
          const base = mockSessionInfo as unknown as Session;
          // Demo mode: override CarID for P2P demo drivers
          s = {
            ...base,
            WeekendInfo: {
              ...base.WeekendInfo,
              TeamRacing: 1,
              MinDrivers: 1,
              MaxDrivers: 4,
            },
            DriverInfo: {
              ...base.DriverInfo,
              Drivers: base.DriverInfo.Drivers.map((driver) => {
                if (driver.CarIsPaceCar) return driver;

                const teamIndex = (driver.CarIdx - 1) % MOCK_TEAM_NAMES.length;
                return {
                  ...driver,
                  TeamID: teamIndex + 1,
                  TeamName: MOCK_TEAM_NAMES[teamIndex],
                  CarID: P2P_DEMO_CAR_IDXS.includes(driver.CarIdx)
                    ? P2P_IR18_CAR_ID
                    : driver.CarID,
                };
              }),
            },
          };
        }
        sessionIdx = sessionIdx + 1;

        // Call all registered callbacks
        if (s) sessionCallbacks.forEach((cb) => cb(s));
      };

      // Send initial data immediately
      updateSessionData();

      // Start interval only once
      if (!sessionInfoInterval) {
        sessionInfoInterval = setInterval(updateSessionData, 2000);
      }

      // Return unsubscribe function
      return () => {
        sessionCallbacks.delete(callback);
        // Stop interval if no more callbacks
        if (sessionCallbacks.size === 0 && sessionInfoInterval) {
          clearInterval(sessionInfoInterval);
          sessionInfoInterval = null;
        }
      };
    },
    onRunningState: (callback: (value: boolean) => void) => {
      runningStateCallbacks.add(callback);

      // Send initial state immediately
      callback(true);

      // Start interval only once
      if (!runningStateInterval) {
        runningStateInterval = setInterval(() => {
          runningStateCallbacks.forEach((cb) => cb(true));
        }, 1000);
      }

      // Return unsubscribe function
      return () => {
        runningStateCallbacks.delete(callback);
        // Stop interval if no more callbacks
        if (runningStateCallbacks.size === 0 && runningStateInterval) {
          clearInterval(runningStateInterval);
          runningStateInterval = null;
        }
      };
    },
    stop: () => {
      if (telemetryInterval) clearInterval(telemetryInterval);
      if (sessionInfoInterval) clearInterval(sessionInfoInterval);
      if (runningStateInterval) clearInterval(runningStateInterval);
      // Null the handles like the per-subscriber unsubscribe paths do —
      // the "start the interval only once" guards check truthiness, so a
      // cleared-but-set handle would permanently block re-subscription
      // after stop().
      telemetryInterval = null;
      sessionInfoInterval = null;
      runningStateInterval = null;
      telemetryCallbacks.clear();
      sessionCallbacks.clear();
      runningStateCallbacks.clear();
    },
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    changeCameraNumber: () => {},
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    changeReplayPosition: () => {},
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    triggerReplaySessionSearch: () => {},
  };
}

const jitterValue = (value: number): number => {
  return Math.max(0, Math.min(1, value + Math.random() * 0.1 - 0.05));
};
