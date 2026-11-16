import { LITRES_PER_GALLON } from '@irdashies/shared';
import type {
  DamageSnapshot,
  FinishInvalidReason,
  RaceForecastCar,
  RaceForecastPlace,
  RaceForecastRejoin,
  RaceForecastSnapshot,
  RaceForecastStint,
  WearSnapshot,
} from '@irdashies/types';
import { formatTime } from '@irdashies/utils/time';
import { formatRepairTime, wheelState } from '../damage/damageDisplay';

/**
 * How the strategy panels write what `race-forecast.snapshot` gives them:
 * Our Car, Class Rivals and the Stint Timeline. Nothing here is arithmetic
 * of the race; that is in `src/shared/finishProjection/` and
 * `src/shared/raceForecast/`, behind the channel.
 *
 * One rule runs through it: a figure that is not known reads `--`, and a
 * figure that is an estimate carries a `~`.
 */

/** What stands in for a figure there is no source for. */
export const NO_FIGURE = '--';
/** Marks a figure that is an estimate. */
export const ESTIMATE = '~';

const isNumber = (value: number | null | undefined): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const REASON_TEXT: Record<FinishInvalidReason, string> = {
  notRace: 'A forecast needs a race: this session is not one.',
  notStarted: 'Waiting for the green flag.',
  finished: 'The race is over.',
  noCar: 'You have no car in this race.',
  otherCar: 'The camera is on another car. The forecast is for your own.',
  noPace: 'Waiting for a lap time to forecast from.',
};

/** The one line a panel shows in place of its figures. */
export const forecastReasonText = (
  reason: FinishInvalidReason | null | undefined
): string => (reason ? REASON_TEXT[reason] : 'Waiting for the session.');

/** A lap time to the thousandth: "1:54.402". */
export const formatLapTime = (seconds: number | null | undefined): string =>
  isNumber(seconds) && seconds > 0 ? formatTime(seconds, 'full') : NO_FIGURE;

const signed = (value: number, decimals: number): string => {
  const text = Math.abs(value).toFixed(decimals);
  // A figure that rounds to nothing has no side to be on.
  if (Number(text) === 0) return text;
  return `${value < 0 ? '-' : '+'}${text}`;
};

/**
 * A gap to the own car to a tenth, minutes from a minute up: "-12.4",
 * "+1:14". Negative is a car ahead.
 */
export const formatGap = (seconds: number | null | undefined): string => {
  if (!isNumber(seconds)) return NO_FIGURE;
  const size = Math.abs(seconds);
  if (size < 59.95) return signed(seconds, 1);
  const whole = Math.round(size);
  return `${seconds < 0 ? '-' : '+'}${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
};

/** Seconds without a sign, whole from ten up: "4.1 s", "58 s". */
export const formatSeconds = (seconds: number | null | undefined): string => {
  if (!isNumber(seconds)) return NO_FIGURE;
  const size = Math.abs(seconds);
  return `${size < 9.95 ? size.toFixed(1) : Math.round(size)} s`;
};

/** How a figure is coloured: in the own car's favour, against it, or neither. */
export type ForecastTone = 'good' | 'bad' | 'plain' | 'quiet';

/**
 * A rival's mean of five laps less the own car's, to the hundredth: positive
 * when the rival is the slower, which is the own car's good.
 */
export const paceDelta = (
  rivalAvgS: number | null | undefined,
  ownAvgS: number | null | undefined
): { text: string; tone: ForecastTone } => {
  if (!isNumber(rivalAvgS) || !isNumber(ownAvgS)) {
    return { text: NO_FIGURE, tone: 'quiet' };
  }
  const delta = rivalAvgS - ownAvgS;
  const text = signed(delta, 2);
  return {
    text,
    tone: Number(text) === 0 ? 'plain' : delta > 0 ? 'good' : 'bad',
  };
};

/** Within this of level a gap after the stops is neither ahead nor behind, s. */
const LEVEL_GAP_S = 1;

/** The gap once both cars have made their stops, and whose good it is. */
export const netGap = (
  seconds: number | null | undefined
): { text: string; tone: ForecastTone } => {
  if (!isNumber(seconds)) return { text: NO_FIGURE, tone: 'quiet' };
  return {
    text: formatGap(seconds),
    tone:
      Math.abs(seconds) <= LEVEL_GAP_S ? 'plain' : seconds > 0 ? 'good' : 'bad',
  };
};

/** "lap 153", or "laps 153-155" where the window is more than one lap. */
export const formatLapWindow = (
  window: { openLap: number; closeLap: number } | null | undefined
): string => {
  if (!window) return NO_FIGURE;
  return window.openLap >= window.closeLap
    ? `lap ${window.closeLap}`
    : `laps ${window.openLap}–${window.closeLap}`;
};

/** "1 lap", "14 laps". */
export const formatLapCount = (laps: number): string =>
  laps === 1 ? '1 lap' : `${laps} laps`;

/** The unit an amount aboard is written in. */
export type BudgetUnit = '%' | 'L' | 'gal';

export interface BudgetFigure {
  /** What is counted: the budget that ends the car's stints. */
  label: 'Virtual energy' | 'Fuel';
  /** "45", "33.9". */
  value: string;
  unit: BudgetUnit;
  /** Share of the capacity, 0..1; null where the capacity is not known. */
  fill: number | null;
  /** What a lap costs, in the same unit: "2.4 % a lap". */
  perLap: string;
}

/** What the car has aboard, as the top of Our Car writes it. */
export const budgetFigure = (
  stint: RaceForecastStint,
  fuelUnits: 'L' | 'gal'
): BudgetFigure => {
  const unit: BudgetUnit = stint.isVirtualEnergy ? '%' : fuelUnits;
  const scale = unit === 'gal' ? LITRES_PER_GALLON : 1;
  const amount = stint.aboard / scale;
  return {
    label: stint.isVirtualEnergy ? 'Virtual energy' : 'Fuel',
    value: stint.isVirtualEnergy ? amount.toFixed(0) : amount.toFixed(1),
    unit,
    fill:
      stint.capacity !== null && stint.capacity > 0
        ? Math.min(1, Math.max(0, stint.aboard / stint.capacity))
        : null,
    perLap: `${(stint.perLap / scale).toFixed(stint.isVirtualEnergy ? 1 : 2)} ${unit} a lap`,
  };
};

/** Whole minutes a number of laps takes at a pace; null without either. */
export const stintMinutes = (
  laps: number | null | undefined,
  paceS: number | null | undefined
): number | null =>
  isNumber(laps) && isNumber(paceS) && paceS > 0
    ? Math.floor((laps * paceS) / 60)
    : null;

/** What ends the stint: one of the car's budgets, or its tyres. */
export type StintEnd = 'energy' | 'fuel' | 'tyres';

/**
 * The fewest laps of tread left on a wheel, where `wear.snapshot` has a
 * forecast for all four. Null without a car, under iRacing, and while any
 * wheel has none: three wheels do not say when the set is finished.
 */
export const tyreLapsLeft = (wear: WearSnapshot | undefined): number | null => {
  if (!wear?.available || wear.wheels.length === 0) return null;
  let fewest = Number.POSITIVE_INFINITY;
  for (const wheel of wear.wheels) {
    if (!isNumber(wheel.treadLapsLeft)) return null;
    fewest = Math.min(fewest, wheel.treadLapsLeft);
  }
  return Number.isFinite(fewest) ? fewest : null;
};

/**
 * What ends the stint first, and after how many laps: the budget the
 * forecast names, or the tyres where they are worn out before it.
 */
export const stintEnd = (
  stint: RaceForecastStint,
  tyreLaps: number | null
): { by: StintEnd; laps: number } =>
  tyreLaps !== null && tyreLaps < stint.lapsLeft
    ? { by: 'tyres', laps: tyreLaps }
    : { by: stint.limit, laps: stint.lapsLeft };

const STINT_END_TEXT: Record<StintEnd, string> = {
  energy: 'energy runs out first',
  fuel: 'fuel runs out first',
  tyres: 'tyres run out first',
};

export const stintEndText = (by: StintEnd): string => STINT_END_TEXT[by];

export interface PlaceFigure {
  /** "P3 in class", "~P3 in class". */
  text: string;
  /** Better than the place now, worse, or the same. */
  tone: ForecastTone;
  /** Drawn quieter: the forecast rests on less than a reading. */
  uncertain: boolean;
  /** What stands under it: how it has moved, or how near the next place is. */
  note: string;
}

/**
 * The forecast finishing place. Under it, how the forecast stood some laps
 * ago once that is remembered; before then, how far the next place is at
 * the flag.
 */
export const placeFigure = (
  place: RaceForecastPlace | null | undefined
): PlaceFigure | null => {
  if (!place) return null;
  const beside = place.ahead
    ? `P${place.finish - 1} is ${formatSeconds(place.ahead.gapS)} ahead at the flag`
    : place.behind
      ? `P${place.finish + 1} is ${formatSeconds(place.behind.gapS)} behind at the flag`
      : '';
  return {
    text: `${place.uncertain ? ESTIMATE : ''}P${place.finish} in class`,
    tone:
      !(place.now > 0) || place.finish === place.now
        ? 'plain'
        : place.finish < place.now
          ? 'good'
          : 'bad',
    uncertain: place.uncertain,
    note: place.was
      ? `was P${place.was.finish} ${formatLapCount(place.was.lapsAgo)} ago`
      : beside,
  };
};

export interface RejoinFigure {
  /** "P6, behind #23", or "P1" with nobody ahead. */
  text: string;
  /** "4.1 s clear of #85", or what else there is to say. */
  note: string;
  /** A car rejoins within the margin: drawn as an estimate. */
  closeCall: boolean;
}

/** Where the stop puts the car, with the two cars it comes out between. */
export const rejoinFigure = (
  rejoin: RaceForecastRejoin | null | undefined,
  numberOf: (carIdx: number) => string
): RejoinFigure | null => {
  if (!rejoin) return null;
  const place = `${rejoin.closeCall ? ESTIMATE : ''}P${rejoin.position}`;
  const inPits =
    rejoin.inPits > 0
      ? `${rejoin.inPits} ${rejoin.inPits === 1 ? 'car' : 'cars'} in the pits not counted`
      : '';
  return {
    text: rejoin.ahead
      ? `${place}, behind #${numberOf(rejoin.ahead.carIdx)}`
      : place,
    note: rejoin.behind
      ? `${formatSeconds(rejoin.behind.gapS)} clear of #${numberOf(rejoin.behind.carIdx)}`
      : inPits || 'nobody close behind',
    closeCall: rejoin.closeCall,
  };
};

/** The class cars directly ahead of and behind the own one, as placed now. */
export const forecastNeighbours = (
  cars: readonly RaceForecastCar[]
): { ahead: RaceForecastCar | null; behind: RaceForecastCar | null } => {
  const index = cars.findIndex((car) => car.own);
  return {
    ahead: index > 0 ? cars[index - 1] : null,
    behind: index >= 0 && index < cars.length - 1 ? cars[index + 1] : null,
  };
};

/** Under this a difference in pace is no closing at all, s a lap. */
const STEADY_PACE_S = 0.05;

/**
 * How fast the gap to a neighbour is moving, from the two cars' means of
 * five clean laps: an estimate of the trend, not a measured change of the
 * gap. "closing 0.2 s a lap" is the own car's good ahead of it and its bad
 * behind it.
 */
export const closingRate = (
  side: 'ahead' | 'behind',
  rivalAvgS: number | null | undefined,
  ownAvgS: number | null | undefined
): { text: string; tone: ForecastTone } => {
  if (!isNumber(rivalAvgS) || !isNumber(ownAvgS)) {
    return { text: NO_FIGURE, tone: 'quiet' };
  }
  // Positive when the own car is the quicker of the two.
  const gain = rivalAvgS - ownAvgS;
  if (Math.abs(gain) < STEADY_PACE_S) {
    return { text: 'holding station', tone: 'plain' };
  }
  const rate = `${Math.abs(gain).toFixed(1)} s a lap`;
  if (side === 'ahead') {
    return gain > 0
      ? { text: `closing ${rate}`, tone: 'good' }
      : { text: `losing ${rate}`, tone: 'bad' };
  }
  return gain > 0
    ? { text: `pulling away ${rate}`, tone: 'good' }
    : { text: `losing ${rate}`, tone: 'bad' };
};

export interface TyresLine {
  /** Tread on each wheel, LF RF LR RR: "84 · 85 · 88 · 89 %". */
  tread: string;
  /** "good for 61 more laps", or empty without a forecast. */
  note: string;
  /** Index into the session's tyre list; -1 unknown. */
  compound: number;
}

/**
 * The tyres as `wear.snapshot` has them. Null without a reading for any
 * wheel: iRacing, and a car somebody else is driving.
 */
export const tyresLine = (wear: WearSnapshot | undefined): TyresLine | null => {
  if (!wear?.available) return null;
  const tread = wear.wheels.map((wheel) => wheel.treadPct);
  if (!tread.some(isNumber)) return null;
  const laps = tyreLapsLeft(wear);
  return {
    tread: `${tread
      .map((value) => (isNumber(value) ? value.toFixed(0) : NO_FIGURE))
      .join(' · ')} %`,
    note: laps === null ? '' : `good for ${formatLapCount(laps)} more`,
    compound: wear.wheels[0]?.compound ?? -1,
  };
};

export interface DamageLine {
  /** "None", or what is damaged. */
  text: string;
  damaged: boolean;
  /** The repair the next stop makes: "no repair time", "repairs 12s". */
  note: string;
}

const percent = (share: number): number => Math.round(share * 100);

/**
 * The car's damage in a line. Null without a reading: iRacing, and with no
 * car.
 */
export const damageLine = (
  damage: DamageSnapshot | undefined
): DamageLine | null => {
  if (!damage?.available) return null;
  const parts: string[] = [];
  const wheels = damage.wheels.map(wheelState);
  if (wheels.includes('detached')) parts.push('wheel off');
  else if (wheels.includes('punctured')) parts.push('puncture');
  if (isNumber(damage.aeroIntegrity) && percent(damage.aeroIntegrity) < 100) {
    parts.push(`aero ${percent(damage.aeroIntegrity)} %`);
  }
  if (percent(damage.bodyIntegrity) < 100) {
    parts.push(`body ${percent(damage.bodyIntegrity)} %`);
  }
  if (
    isNumber(damage.suspensionIntegrity) &&
    percent(damage.suspensionIntegrity) < 100
  ) {
    parts.push(`suspension ${percent(damage.suspensionIntegrity)} %`);
  }
  const repair = formatRepairTime(damage.repairSeconds);
  const text = parts.join(', ');
  return {
    text: text ? text.charAt(0).toUpperCase() + text.slice(1) : 'None',
    damaged: parts.length > 0,
    note:
      repair !== null
        ? `repairs ${repair} at the stop`
        : damage.repairSeconds === null
          ? ''
          : 'no repair time',
  };
};

export interface ClassRivalRow {
  car: RaceForecastCar;
  /** "us" on the own row. */
  gap: string;
  stops: string;
  /** "lap 129 · 61 s", "lap 129", "in the pits now", or the placeholder. */
  lastStop: string;
  since: string;
  /** "~lap 160"; the own row's pit window; "none" where no stop is owed. */
  nextStop: string;
  /** The stops it owes are assumed, not read or seen. */
  assumed: boolean;
  netGap: { text: string; tone: ForecastTone };
  /** The rival's mean of five against the own car's; the own row's mean. */
  pace: { text: string; tone: ForecastTone };
}

const lastStopText = (car: RaceForecastCar): string => {
  if (car.inPit) return 'in the pits now';
  if (car.lastStopLap === null) return NO_FIGURE;
  return car.lastStopLaneS === null
    ? `lap ${car.lastStopLap}`
    : `lap ${car.lastStopLap} · ${Math.round(car.lastStopLaneS)} s`;
};

const nextStopText = (
  car: RaceForecastCar,
  window: RaceForecastStint['window'] | undefined
): string => {
  if (car.stopsOwed === null) return NO_FIGURE;
  if (car.stopsOwed === 0) return 'none';
  if (car.own) return window ? formatLapWindow(window) : NO_FIGURE;
  return car.nextStopLap === null
    ? NO_FIGURE
    : `${ESTIMATE}lap ${car.nextStopLap}`;
};

export interface ClassRivalOptions {
  /** Cars each side of the own one; 0 lists the whole class. */
  carsAhead: number;
  carsBehind: number;
}

/**
 * The rows of Class Rivals: the class in the order of its places, cut to a
 * number of cars each side of the own one where that is asked for.
 */
export const classRivalRows = (
  snapshot: Pick<RaceForecastSnapshot, 'cars' | 'stint'> | undefined,
  { carsAhead, carsBehind }: ClassRivalOptions
): ClassRivalRow[] => {
  const cars = snapshot?.cars ?? [];
  const ownIndex = cars.findIndex((car) => car.own);
  const own = ownIndex >= 0 ? cars[ownIndex] : null;
  const from =
    ownIndex >= 0 && carsAhead > 0 ? Math.max(0, ownIndex - carsAhead) : 0;
  const to =
    ownIndex >= 0 && carsBehind > 0
      ? Math.min(cars.length, ownIndex + carsBehind + 1)
      : cars.length;
  return cars.slice(from, to).map((car) => ({
    car,
    gap: car.own ? 'us' : formatGap(car.gapS),
    stops: String(car.stops),
    lastStop: lastStopText(car),
    since: car.sinceStopLaps === null ? NO_FIGURE : String(car.sinceStopLaps),
    nextStop: nextStopText(car, snapshot?.stint?.window),
    assumed: car.basis === 'assumed',
    netGap: car.own ? { text: 'us', tone: 'quiet' } : netGap(car.netGapS),
    pace: car.own
      ? { text: formatLapTime(car.avg5S), tone: 'plain' }
      : paceDelta(car.avg5S, own?.avg5S),
  }));
};
