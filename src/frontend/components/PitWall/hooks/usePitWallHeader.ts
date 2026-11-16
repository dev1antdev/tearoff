import { useMemo } from 'react';
import { shallow } from 'zustand/shallow';
import {
  trackStateSelectors,
  useActiveSimulator,
  useChannelSelector,
  useDriverCarIdx,
  useDrivingState,
  useRunningState,
  useSessionBarSelector,
  useSessionDrivers,
  useSessionTimeTiming,
  useTrackStateSelector,
} from '@irdashies/context';
import { sessionClock } from '@irdashies/domain/sessionClock/sessionClock';
import { formatTrackClock } from '@irdashies/domain/trackClock/trackClock';
import {
  simulatorDisplayName,
  type FlagStateSnapshot,
  type SessionBarSnapshot,
} from '@irdashies/types';
import { colorNumToHex } from '@irdashies/utils/colors';
import {
  carPlace,
  flagPill,
  formatTimeLeft,
  sessionLabel,
  type CarPlace,
  type FlagPill,
} from '../pitWallHeaderFormat';

/**
 * What the header reads of the session bar. The snapshot moves five times a
 * second; these change a few times a race, and the clock once a minute.
 */
const selectSessionBar = (snapshot: SessionBarSnapshot) =>
  [
    snapshot.sessionName,
    snapshot.trackDisplayName,
    snapshot.sessionTimeOfDay === undefined
      ? undefined
      : Math.floor(snapshot.sessionTimeOfDay / 60) * 60,
    snapshot.playerCarIdx,
    snapshot.playerClassified,
    snapshot.playerOverallPosition,
    snapshot.playerClassPosition,
    snapshot.playerClassSize,
  ] as const;

const NO_SESSION_BAR = [
  undefined,
  undefined,
  undefined,
  null,
  false,
  0,
  0,
  0,
] as const;

const selectFlag = (snapshot: FlagStateSnapshot) =>
  [snapshot.kind, snapshot.detail] as const;

const NO_FLAG = [undefined, undefined] as const;

export interface PitWallOwnCar {
  number: string;
  /** The class colour as a CSS colour; undefined when the session gives none. */
  classColor?: string;
  place: CarPlace;
  /** Who is driving it now, as the sim names them. */
  driver?: string;
  team?: string;
}

export interface PitWallHeaderData {
  /** The sim feeding the page, or null while none is. */
  simulator: string | null;
  /** In a session: the sim is running and has one to describe. */
  inSession: boolean;
  /** The session and the track; empty when the sim has named neither. */
  session: string;
  timeLeft: string;
  /** The in-game clock, or undefined where the sim has none. */
  timeOfDay?: string;
  flag: FlagPill | null;
  /** Our own entry, which stays ours while a team-mate drives it. */
  car: PitWallOwnCar | null;
  /** The user is in the session and not at the wheel. */
  watching: boolean;
}

/**
 * Whether a sim is running and whether it is in a session, for the empty
 * states. Under Le Mans Ultimate the sim says when it is in none; under both
 * a session with no cars in it yet is not one to show.
 */
export const usePitWallSessionState = () => {
  const { running } = useRunningState();
  const notInSession =
    useTrackStateSelector(trackStateSelectors.notInSession) ?? false;
  const hasDrivers = (useSessionDrivers()?.length ?? 0) > 0;
  return { running, inSession: running && hasDrivers && !notInSession };
};

/**
 * Everything the header prints, from what the app already knows.
 *
 * "Our car" is the player's own entry (`DriverCarIdx`), the one the session
 * bar's class rank and the fuel and stint widgets are about, not the car the
 * camera is on: it is still ours while a team-mate drives and while the user
 * looks at somebody else.
 */
export const usePitWallHeader = (): PitWallHeaderData => {
  const { running, inSession } = usePitWallSessionState();
  const simulator = useActiveSimulator();
  const [
    sessionName,
    trackName,
    timeOfDay,
    barCarIdx,
    classified,
    overallPosition,
    classPosition,
    classSize,
  ] =
    useSessionBarSelector(selectSessionBar, { equality: shallow }) ??
    NO_SESSION_BAR;
  const timing = useSessionTimeTiming();
  const [flagKind, flagDetail] =
    useChannelSelector('flag-state.snapshot', selectFlag, {
      equality: shallow,
    }) ?? NO_FLAG;
  const sessionCarIdx = useDriverCarIdx();
  const drivers = useSessionDrivers();
  const { isDriving } = useDrivingState();

  const carIdx = barCarIdx ?? sessionCarIdx;
  const entry = useMemo(
    () =>
      carIdx === undefined || carIdx === null || carIdx < 0
        ? undefined
        : drivers?.find((driver) => driver.CarIdx === carIdx),
    [drivers, carIdx]
  );

  const car = useMemo<PitWallOwnCar | null>(() => {
    if (!inSession || !entry) return null;
    return {
      number: entry.CarNumber,
      classColor: colorNumToHex(entry.CarClassColor),
      place: carPlace({
        classified,
        classPosition,
        classSize,
        overallPosition,
        className: entry.CarClassShortName,
      }),
      driver: entry.UserName || undefined,
      team: entry.TeamName || undefined,
    };
  }, [inSession, entry, classified, classPosition, classSize, overallPosition]);

  // Whole seconds: the clock is printed to the second.
  const remaining = inSession
    ? Math.floor(sessionClock(timing).remaining)
    : undefined;

  return {
    simulator: running ? simulatorDisplayName(simulator) : null,
    inSession,
    session: inSession
      ? sessionLabel({
          sessionName,
          sessionType: timing.sessionType,
          trackName,
        })
      : '',
    timeLeft: formatTimeLeft(remaining),
    timeOfDay:
      inSession && timeOfDay !== undefined
        ? formatTrackClock(timeOfDay, '24h')
        : undefined,
    flag: inSession
      ? flagPill(flagKind, flagDetail, simulator === 'iracing')
      : null,
    car,
    watching: inSession && !isDriving,
  };
};
