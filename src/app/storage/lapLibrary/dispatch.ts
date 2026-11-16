import type {
  LapInput,
  LapLibraryLap,
  LapLibrarySession,
  LapLibraryStats,
  LapLibraryStatus,
  LapLibraryStint,
  LapSessionInput,
  StintInput,
  StoredReferenceLap,
} from '../../../types/lapLibrary';
import type {
  RaceDriverChange,
  RaceLap,
  RaceRecords,
  RaceStint,
  RaceWriteBatch,
  RaceWriteResult,
  StoredRace,
  StoredRaceState,
} from '../../../types/raceHistory';
import type { RaceEvent } from '../../../types/raceLog';
import type { LapLibraryDatabase, RecordedLap } from './LapLibraryDatabase';

/** How the library's file opened, as the main process is told it. */
export interface LapLibraryOpenReport extends LapLibraryStatus {
  /** What went wrong, for the log. Null while the library is available. */
  message: string | null;
  /** The schema the file is at; null when it could not be opened. */
  schemaVersion: number | null;
  /** The schema an older file was found at and upgraded from. */
  upgradedFrom: number | null;
  /** The name of the copy kept of that older file, beside it. */
  backupName: string | null;
}

/**
 * Everything that can be asked of the lap library's database from another
 * thread, as one typed table. The worker and its client both go by it, so a
 * call cannot be spelled one way on one side and another on the other.
 */
export interface LapLibraryMethods {
  /** Answered even when the file could not be opened: it says why. */
  status(): LapLibraryOpenReport;
  recordLap(session: LapSessionInput, lap: LapInput): RecordedLap;
  upsertStint(session: LapSessionInput, stint: StintInput): number | null;
  listSessions(limit?: number, offset?: number): LapLibrarySession[];
  listLaps(sessionId: number): LapLibraryLap[];
  listStints(sessionId: number): LapLibraryStint[];
  recentLedgerLaps(
    simulator: string,
    trackId: number,
    carKey: string,
    limit: number,
    withoutFlags?: number
  ): LapLibraryLap[];
  deleteLap(lapId: number): boolean;
  deleteSession(sessionId: number): boolean;
  pinReference(lapId: number): boolean;
  unpinReference(lapId: number): boolean;
  referenceLap(
    simulator: string,
    trackId: number,
    carKey: string,
    pointsCount?: number
  ): StoredReferenceLap | null;
  stats(): LapLibraryStats;
  prune(maxLaps: number): number;
  /** The history of races: see RaceHistoryTables for each of these. */
  raceWrite(batch: RaceWriteBatch): RaceWriteResult;
  raceList(limit?: number): StoredRace[];
  raceCandidates(
    simulator: string,
    trackId: number,
    sessionType: string | null,
    limit?: number
  ): StoredRaceState[];
  raceLoad(raceId: number): RaceRecords | null;
  raceCarLaps(raceId: number, carIdx: number): RaceLap[];
  raceCarStints(raceId: number, carIdx: number): RaceStint[];
  raceDriverChanges(raceId: number): RaceDriverChange[];
  raceEvents(raceId: number, before?: number, limit?: number): RaceEvent[];
}

export type LapLibraryMethod = keyof LapLibraryMethods;

/** Calls a method across the thread boundary and waits for its answer. */
export interface LapLibraryCaller {
  call<M extends LapLibraryMethod>(
    method: M,
    ...args: Parameters<LapLibraryMethods[M]>
  ): Promise<ReturnType<LapLibraryMethods[M]>>;
}

/**
 * Runs one request against the database.
 *
 * The method name arrives as data from another thread. It is matched against
 * the list here rather than used to index the database object, so nothing
 * that is not on the list can be reached by naming it.
 */
export const dispatch = (
  db: LapLibraryDatabase,
  method: string,
  args: readonly unknown[]
): unknown => {
  switch (method as LapLibraryMethod) {
    case 'status':
      return {
        available: true,
        reason: null,
        message: null,
        ...db.opened,
      } satisfies LapLibraryOpenReport;
    case 'recordLap':
      return db.recordLap(args[0] as LapSessionInput, args[1] as LapInput);
    case 'upsertStint':
      return db.upsertStint(args[0] as LapSessionInput, args[1] as StintInput);
    case 'listSessions':
      return db.listSessions(
        args[0] as number | undefined,
        args[1] as number | undefined
      );
    case 'listLaps':
      return db.listLaps(args[0] as number);
    case 'listStints':
      return db.listStints(args[0] as number);
    case 'recentLedgerLaps':
      return db.recentLedgerLaps(
        args[0] as string,
        args[1] as number,
        args[2] as string,
        args[3] as number,
        args[4] as number | undefined
      );
    case 'deleteLap':
      return db.deleteLap(args[0] as number);
    case 'deleteSession':
      return db.deleteSession(args[0] as number);
    case 'pinReference':
      return db.pinReference(args[0] as number);
    case 'unpinReference':
      return db.unpinReference(args[0] as number);
    case 'referenceLap':
      return db.referenceLap(
        args[0] as string,
        args[1] as number,
        args[2] as string,
        args[3] as number | undefined
      );
    case 'stats':
      return db.stats();
    case 'prune':
      return db.prune(args[0] as number);
    case 'raceWrite':
      return db.races.write(args[0] as RaceWriteBatch);
    case 'raceList':
      return db.races.list(args[0] as number | undefined);
    case 'raceCandidates':
      return db.races.candidates(
        args[0] as string,
        args[1] as number,
        args[2] as string | null,
        args[3] as number | undefined
      );
    case 'raceLoad':
      return db.races.load(args[0] as number);
    case 'raceCarLaps':
      return db.races.carLaps(args[0] as number, args[1] as number);
    case 'raceCarStints':
      return db.races.carStints(args[0] as number, args[1] as number);
    case 'raceDriverChanges':
      return db.races.driverChanges(args[0] as number);
    case 'raceEvents':
      return db.races.events(
        args[0] as number,
        args[1] as number | undefined,
        args[2] as number | undefined
      );
    default:
      throw new Error(`Unknown lap library method: ${method}`);
  }
};
