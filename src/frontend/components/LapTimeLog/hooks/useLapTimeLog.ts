import { useState, useEffect, useMemo, useRef } from 'react';
import {
  useLapLogSnapshot,
  usePersonalBestStore,
  usePlayerLedgerSnapshot,
  usePlayerStintSnapshot,
  useSessionStore,
  useDriverCarIdx,
} from '@irdashies/context';
import { LEDGER_LAP_INCIDENT, LEDGER_LAP_VOIDED } from '@irdashies/types';
import {
  lapEntries,
  listedStintId,
  liveLapEntry,
} from '@irdashies/domain/ledger';
import { useLapTimeLogSettings } from './useLapTimeLogSettings';

const FREEZE_TIME = 5;
/** The lap under way no longer counts: the sim voided it, or an incident. */
const DIRTY_LAP_FLAGS = LEDGER_LAP_VOIDED | LEDGER_LAP_INCIDENT;

export const useLapTimeLog = () => {
  // Get settings
  const settings = useLapTimeLogSettings();

  // Get session data for personal best tracking
  const session = useSessionStore((state) => state.session);
  const trackId = session?.WeekendInfo?.TrackID?.toString() ?? 0;
  const drivers = useMemo(
    () => session?.DriverInfo?.Drivers ?? [],
    [session?.DriverInfo?.Drivers]
  );
  const playerCarIdx = useDriverCarIdx();
  const playerCarName = useMemo(() => {
    if (playerCarIdx === null || playerCarIdx === undefined) return 'unknown';
    const driver = drivers[playerCarIdx];
    // Personal bests are kept per car. Under LMU CarPath is the livery's .VEH
    // file, so a second livery of the same car would start a new record;
    // CarModel names the car itself there. iRacing sets no CarModel, so its
    // records stay keyed by CarPath as before.
    return driver?.CarModel ?? driver?.CarPath ?? 'unknown';
  }, [playerCarIdx, drivers]);

  // States
  const [displayTime, setDisplayTime] = useState<number | undefined>(0);
  const [savedDelta, setSavedDelta] = useState<number>(0);

  // Telemetry
  const snapshot = useLapLogSnapshot();
  const lapCompleted = snapshot?.lapCompleted ?? 0;
  const currentLapTime = snapshot?.currentLapTime ?? 0;
  const lastLapTime = snapshot?.lastLapTime ?? 0;
  const bestLapTime = snapshot?.bestLapTime ?? 0;
  const ownBestLapTime = snapshot?.ownBestLapTime ?? 0;
  const carIdxBestLapTime = snapshot?.carIdxBestLapTime;
  const sessionNum = snapshot?.sessionNum ?? 0;
  const sessionTime = snapshot?.sessionTime ?? 0;
  const lapDistPct = snapshot?.lapDistPct ?? 0;

  // The player's ledger: every lap driven and what it cost, kept in the main
  // process whether or not this widget was on screen. The history is read
  // from it, so it survives a reload and has the laps driven while hidden.
  const historyEnabled = settings?.history?.enabled ?? true;
  const ledger = usePlayerLedgerSnapshot(historyEnabled);
  const stint = usePlayerStintSnapshot();

  // Refs
  const lastLoggedLap = useRef<number>(lapCompleted);
  const lastLoggedTime = useRef<number>(0);
  const prevSessionNum = useRef<number>(sessionNum);
  const prevSessionTime = useRef<number>(sessionTime);
  const lastDeltaUpdate = useRef<number>(0);
  const prevLapDistPct = useRef<number>(0);
  const isTransitioning = useRef<boolean>(false);

  // Get personal best store and load data
  const currentPersonalBest = usePersonalBestStore((state) =>
    !trackId || !playerCarName || playerCarName === 'unknown'
      ? undefined
      : state.getPersonalBest(trackId, playerCarName)
  );
  const setPersonalBest = usePersonalBestStore(
    (state) => state.setPersonalBest
  );
  const pbMetaData = useRef({ trackId, playerCarName, currentPersonalBest });
  useEffect(() => {
    pbMetaData.current = { trackId, playerCarName, currentPersonalBest };
  }, [trackId, playerCarName, currentPersonalBest]);

  // Get overall best
  const sessionBestOverall = useMemo(() => {
    if (!carIdxBestLapTime?.length) return undefined;
    const validLaps = carIdxBestLapTime.filter((lap) => lap > 0);
    return validLaps.length === 0 ? undefined : Math.min(...validLaps);
  }, [carIdxBestLapTime]);

  // Calculate predicted lap time
  const deltaMethod = settings?.delta?.method ?? 'bestlap';
  const referenceTime = deltaMethod === 'lastlap' ? lastLapTime : bestLapTime;

  const liveDelta =
    (deltaMethod === 'lastlap'
      ? snapshot?.deltaToSessionLastLap
      : snapshot?.deltaToSessionBestLap) ?? 0;
  const deltaCheck =
    (deltaMethod === 'lastlap'
      ? snapshot?.deltaToSessionLastLapOk
      : snapshot?.deltaToSessionBestLapOk) ?? false;

  // 1. handles resets/restarts
  useEffect(() => {
    const sessionChanged = sessionNum !== prevSessionNum.current;
    const sessionRestarted = sessionTime < prevSessionTime.current - 5;
    if (sessionChanged || sessionRestarted) {
      lastLoggedLap.current = lapCompleted;
      lastLoggedTime.current = lastLapTime;
      lastDeltaUpdate.current = 0;
      isTransitioning.current = false;
      setSavedDelta(0);
      setDisplayTime(undefined);
    }
    prevSessionNum.current = sessionNum;
    prevSessionTime.current = sessionTime;
  }, [sessionNum, sessionTime, lapCompleted, lastLapTime]);

  // 2. check for new lap (use dist method instead of delayed lapCompleted)
  useEffect(() => {
    const crossedLineDist = prevLapDistPct.current > 0.95 && lapDistPct < 0.05;
    // trigger transition
    if (crossedLineDist) {
      isTransitioning.current = true;
    } else if (lapDistPct > 0.05) {
      isTransitioning.current = false; // force reset
    }
    prevLapDistPct.current = lapDistPct;
  }, [lapDistPct]);

  // 3. live tracking during the lap
  useEffect(() => {
    // 3a. get valid time for current lap
    const newDisplayTime = isTransitioning.current ? undefined : currentLapTime;
    setDisplayTime(newDisplayTime);
    // 3b. prediction Logic (throttle to 100ms)
    const now = Date.now();
    if (now - lastDeltaUpdate.current >= 100) {
      setSavedDelta((prev) => {
        const currentDelta = liveDelta ?? 0;
        if (
          deltaCheck &&
          currentLapTime > FREEZE_TIME &&
          !isTransitioning.current
        ) {
          lastDeltaUpdate.current = now;
          return currentDelta;
        }
        return prev;
      });
    }
  }, [currentLapTime, liveDelta, deltaCheck, referenceTime, lapDistPct]);

  // 4. a lap was scored: the prediction starts over for the new one
  useEffect(() => {
    // wait for new last lap time
    const isNewLapScored =
      lapCompleted > 0 && lapCompleted !== lastLoggedLap.current;
    const isValidTime =
      lastLapTime > 0 && lastLapTime !== lastLoggedTime.current;
    if (!isNewLapScored || !isValidTime) return;
    lastLoggedLap.current = lapCompleted;
    lastLoggedTime.current = lastLapTime;
    isTransitioning.current = false;
    setSavedDelta(0);
  }, [lapCompleted, lastLapTime]);

  // 5. check personal best
  //
  // From the best lap the user drove themselves, not the session's best for
  // the car. Under Le Mans Ultimate those differ after a team-mate's stint:
  // the car's best may be a lap they set, and it stays the car's best once
  // the user is back in. See LapLogSnapshot.ownBestLapTime.
  useEffect(() => {
    const isValidTime = ownBestLapTime > 0;
    if (!isValidTime) return;
    const {
      trackId: currentTrackId,
      playerCarName: currentCar,
      currentPersonalBest: savedPB,
    } = pbMetaData.current;
    const hasPersonalBestKey =
      Boolean(currentTrackId) && currentCar !== 'unknown';
    const isBetter =
      savedPB === undefined || savedPB === null || ownBestLapTime < savedPB;
    if (hasPersonalBestKey && isBetter) {
      setPersonalBest(currentTrackId, currentCar, ownBestLapTime);
    }
  }, [ownBestLapTime, setPersonalBest]);

  // 6. the history, from the ledger's rows of this session
  const wearMode = settings?.history?.wearMode ?? 'average';
  const ledgerLaps = ledger?.laps;
  const ledgerSessionNum = ledger?.sessionNum ?? null;
  // Named before the rows are built, so that the stint under way moving
  // five times a second does not rebuild them.
  const onlyStintId =
    settings?.history?.thisStintOnly && ledgerLaps
      ? listedStintId(ledgerLaps, stint, ledgerSessionNum)
      : undefined;
  const history = useMemo(
    () =>
      ledgerLaps
        ? lapEntries(ledgerLaps, {
            sessionNum: ledgerSessionNum,
            deltaMethod,
            wearMode,
            stintId: onlyStintId,
          })
        : [],
    [ledgerLaps, ledgerSessionNum, deltaMethod, wearMode, onlyStintId]
  );

  // 7. the lap under way, as the ledger has it so far
  const currentRow = useMemo(
    () => (stint?.available ? liveLapEntry(stint, wearMode) : undefined),
    [stint, wearMode]
  );
  const isDirty = ((stint?.lap.flags ?? 0) & DIRTY_LAP_FLAGS) !== 0;

  return {
    current: displayTime,
    lastlap: lastLapTime,
    bestlap: bestLapTime,
    alltimelap: currentPersonalBest,
    reference: referenceTime,
    delta: savedDelta,
    overall: sessionBestOverall,
    dirty: isDirty,
    history: history,
    currentRow: currentRow,
    settings: settings,
  };
};
