import {
  LITRES_PER_GALLON,
  rivalProjectedGapS,
  type FinishColumn,
  type FinishColumnKind,
} from '@irdashies/shared';
import {
  FINISH_SCENARIO_MAX_S,
  FINISH_SCENARIOS_MAX,
  type FinishInvalidReason,
  type FinishProjectionSnapshot,
  type FinishRival,
} from '@irdashies/types';

/**
 * How the finish projection widget writes what `projectFinish` and the
 * channel give it: the caption of a column, a margin, an amount to put in,
 * the header line and the rivals' rows. Nothing here is arithmetic of the
 * race; that is in `src/shared/finishProjection/`.
 */

/** What stands in for a figure there is no source for. */
export const NO_FIGURE = '--';

/**
 * The stop lengths as a saved config gives them, made fit to use: whole
 * seconds from 0 to FINISH_SCENARIO_MAX_S, at most FINISH_SCENARIOS_MAX of
 * them, in the order they were set. A config is a file a user can edit, so
 * anything that is not a list of numbers gives the fallback.
 */
export const normalizeFinishScenarios = (
  value: unknown,
  fallback: readonly number[]
): number[] => {
  if (!Array.isArray(value)) return [...fallback];
  return value
    .filter(
      (entry): entry is number =>
        typeof entry === 'number' && Number.isFinite(entry)
    )
    .map((entry) =>
      Math.min(Math.max(Math.round(entry), 0), FINISH_SCENARIO_MAX_S)
    )
    .slice(0, FINISH_SCENARIOS_MAX);
};

/** Under this an amount to add is nothing: it would be written "0.0". */
const NOTHING_TO_ADD = 0.05;
/** Within this of level a projected gap is neither ahead nor behind, s. */
export const RIVAL_LEVEL_S = 1;

const COLUMN_LABELS: Record<Exclude<FinishColumnKind, 'scenario'>, string> = {
  now: 'NOW',
  planned: 'PLAN',
  toFinish: 'FIN',
  last: 'LAST',
};

/**
 * The caption over a column, in the case it is drawn in: "NOW", "30s",
 * "PLAN", "FIN", "LAST".
 */
export const finishColumnLabel = (
  column: Pick<FinishColumn, 'kind' | 'scenarioS'>
): string =>
  column.kind === 'scenario'
    ? `${Math.round(column.scenarioS ?? 0)}s`
    : COLUMN_LABELS[column.kind];

/** A stable key for a column of the table. */
export const finishColumnKey = (
  column: Pick<FinishColumn, 'kind' | 'scenarioS'>,
  index: number
): string =>
  column.kind === 'scenario' ? `${index}:${column.scenarioS}` : column.kind;

/** How long after the clock the leader takes the flag: "+12s". */
export const formatLeaderMargin = (seconds: number | null): string =>
  seconds === null || !Number.isFinite(seconds)
    ? NO_FIGURE
    : `+${Math.max(0, Math.round(seconds))}s`;

/** Laps to go, to a tenth. */
export const formatLapsToGo = (laps: number | null): string =>
  laps === null || !Number.isFinite(laps) ? NO_FIGURE : laps.toFixed(1);

/** A lap fraction as TinyPedal writes it: two decimals. */
export const formatLapFraction = (fraction: number | null): string =>
  fraction === null || !Number.isFinite(fraction)
    ? NO_FIGURE
    : fraction.toFixed(2);

export type RefuelTone = 'none' | 'enough' | 'needed' | 'over';

export interface RefuelCell {
  text: string;
  tone: RefuelTone;
}

const NO_REFUEL: RefuelCell = { text: NO_FIGURE, tone: 'none' };

/** The unit an amount is written in. */
export type RefuelUnit = '%' | 'L' | 'gal';

export const refuelUnit = (
  isVirtualEnergy: boolean,
  fuelUnits: 'L' | 'gal'
): RefuelUnit => (isVirtualEnergy ? '%' : fuelUnits);

/**
 * One cell of a refuel row. `toAdd` writes what is missing with its sign,
 * and a plain 0 once what is aboard covers the laps; `total` writes the
 * whole amount the laps need. An amount the car cannot hold is `over`.
 */
export const refuelCell = (
  needed: number | null,
  toAdd: number | null,
  display: 'toAdd' | 'total',
  unit: RefuelUnit,
  overCapacity: boolean
): RefuelCell => {
  if (needed === null || toAdd === null) return NO_REFUEL;
  const scale = unit === 'gal' ? LITRES_PER_GALLON : 1;
  if (display === 'total') {
    return {
      text: (needed / scale).toFixed(1),
      tone: overCapacity
        ? 'over'
        : toAdd < NOTHING_TO_ADD
          ? 'enough'
          : 'needed',
    };
  }
  const amount = toAdd / scale;
  if (amount < NOTHING_TO_ADD) return { text: '0', tone: 'enough' };
  return {
    text: `+${amount.toFixed(1)}`,
    tone: overCapacity ? 'over' : 'needed',
  };
};

/** A clock as the header writes it: "14:55", "1:02:07". */
export const formatRaceClock = (seconds: number): string => {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = String(total % 60).padStart(2, '0');
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}`
    : `${minutes}:${rest}`;
};

type RaceLength = Pick<
  FinishProjectionSnapshot,
  'raceType' | 'timeLeftS' | 'lapLimit' | 'leader' | 'player'
>;

/**
 * How the race is counted and what is left of it: the clock of a timed
 * race, the leader's laps to the distance of a lap race, both where the
 * race is run to both.
 */
export const raceLengthText = (
  snapshot: RaceLength
): { label: string; value: string } => {
  const front = snapshot.leader ?? snapshot.player;
  const lapsLeft =
    snapshot.lapLimit !== null && front
      ? `${Math.max(0, snapshot.lapLimit - front.progress).toFixed(1)} left`
      : NO_FIGURE;
  const clock =
    snapshot.timeLeftS === null
      ? NO_FIGURE
      : formatRaceClock(snapshot.timeLeftS);
  if (snapshot.raceType === 'laps') return { label: 'Laps', value: lapsLeft };
  if (snapshot.raceType === 'lapsAndTime') {
    return { label: 'Laps + time', value: `${lapsLeft} / ${clock}` };
  }
  return { label: 'Time', value: clock };
};

const REASON_TEXT: Record<FinishInvalidReason, string> = {
  notRace: 'Race only',
  notStarted: 'Waiting for the green flag',
  finished: 'Race finished',
  noCar: 'No car in the race',
  otherCar: 'Camera on another car',
  noPace: 'Waiting for a lap time',
};

/** The one line the widget shows in place of its table. */
export const finishReasonText = (
  reason: FinishInvalidReason | null | undefined
): string => (reason ? REASON_TEXT[reason] : 'Waiting for the session');

/** A signed gap to a tenth, minutes from a minute up: "+5.1", "-1:12". */
export const formatRivalGap = (seconds: number | null): string => {
  if (seconds === null || !Number.isFinite(seconds)) return NO_FIGURE;
  const sign = seconds < 0 ? '-' : '+';
  const size = Math.abs(seconds);
  if (size < 59.95) return `${sign}${size.toFixed(1)}`;
  const whole = Math.round(size);
  return `${sign}${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
};

/**
 * Where the player ends against a rival: `ahead` of it, `behind` it,
 * `level` within a second, or `unknown` where a stop could not be costed.
 */
export type RivalOutcome = 'ahead' | 'behind' | 'level' | 'unknown';

export interface FinishRivalRow {
  rival: FinishRival;
  /** The gap once both have made their stops, s; null where not known. */
  projectedS: number | null;
  outcome: RivalOutcome;
}

export interface FinishRivalRows {
  /** In class order: the furthest ahead first. */
  ahead: FinishRivalRow[];
  /** In class order: the nearest behind first. */
  behind: FinishRivalRow[];
}

export interface FinishRivalOptions {
  rivalsAhead: number;
  rivalsBehind: number;
  extraTimeS: number;
  includePace: boolean;
}

/**
 * The rows of the rivals section: the nearest few on each side, with the
 * gap each ends at as the settings have it.
 */
export const finishRivalRows = (
  snapshot:
    Pick<FinishProjectionSnapshot, 'rivals' | 'playerStopsOwed'> | undefined,
  { rivalsAhead, rivalsBehind, extraTimeS, includePace }: FinishRivalOptions
): FinishRivalRows => {
  const row = (rival: FinishRival): FinishRivalRow => {
    const playerStopsOwed = snapshot?.playerStopsOwed ?? null;
    // A rival's gap is published as unknown while the player's stops are;
    // held here too, for a snapshot that says otherwise.
    const projectedS =
      playerStopsOwed === null
        ? null
        : rivalProjectedGapS(rival, playerStopsOwed, extraTimeS, includePace);
    return {
      rival,
      projectedS,
      outcome:
        projectedS === null
          ? 'unknown'
          : Math.abs(projectedS) <= RIVAL_LEVEL_S
            ? 'level'
            : projectedS > 0
              ? 'ahead'
              : 'behind',
    };
  };
  // The channel lists each side nearest first.
  const rivals = snapshot?.rivals ?? [];
  const ahead = rivals
    .filter((rival) => rival.ahead)
    .slice(0, Math.max(0, rivalsAhead));
  const behind = rivals
    .filter((rival) => !rival.ahead)
    .slice(0, Math.max(0, rivalsBehind));
  return { ahead: ahead.reverse().map(row), behind: behind.map(row) };
};
