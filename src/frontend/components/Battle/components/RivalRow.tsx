import { useMemo } from 'react';
import { CaretDownIcon, CaretUpIcon } from '@phosphor-icons/react';
import type { BattleConfig } from '@irdashies/types';
import type { Rival, RivalCar } from '@irdashies/domain';
import { getTailwindStyle } from '@irdashies/utils/colors';
import { formatGap, formatTime } from '@irdashies/utils/time';
import { speedFromKph, type SpeedUnit } from '@irdashies/utils/units';
import { Compound } from '../../shared/Compound/Compound';
import { DriverStatusBadges } from '../../shared/DriverStatusBadges/DriverStatusBadges';
import { LastTimeCell } from '../../shared/LastTimeCell/LastTimeCell';
import { RatingChange } from '../../shared/RatingChange/RatingChange';
import { TrackLimitsCell } from '../../shared/TrackLimitsCell/TrackLimitsCell';
import { VirtualEnergyCell } from '../../shared/VirtualEnergyCell/VirtualEnergyCell';
import type { BattleColumnKey } from '../battleColumns';
import {
  DASH,
  energyUseText,
  forecastDisplay,
  pitStopsText,
  pitTimeText,
  stintText,
  toneClass,
  trendDisplay,
  type RivalSide,
} from '../battleDisplay';

export interface RivalRowProps {
  /** The car of the row; undefined keeps the row, with dashes. */
  car: RivalCar | undefined;
  /** The fight with it, for the rows either side of the focus car. */
  rival?: Rival;
  side: RivalSide | 'focus';
  columns: readonly BattleColumnKey[];
  settings: BattleConfig | undefined;
  highlightColor: number | undefined;
  isMultiClass: boolean;
  trackLimitsPointsMax: number;
  speedKph: number | undefined;
  speedUnit: SpeedUnit;
  rowIndex: number;
}

const MUTED = 'text-white/55';
const FIGURE = 'whitespace-nowrap tabular-nums';

/**
 * One row of the rivals box. The focus car's own row carries the figures
 * the rivals are read against; a rival's row adds the gap to it, how that
 * gap has moved, and when it will be gone.
 *
 * Not memoised: its car is rebuilt with every standings snapshot, and three
 * rows five times a second cost less than comparing them would save.
 */
export const RivalRow = ({
  car,
  rival,
  side,
  columns,
  settings,
  highlightColor,
  isMultiClass,
  trackLimitsPointsMax,
  speedKph,
  speedUnit,
  rowIndex,
}: RivalRowProps) => {
  const isFocus = side === 'focus';
  const outOfIt = !!car && (!car.inWorld || car.inPitLane || car.inGarage);
  const tailwindStyles = useMemo(
    () => getTailwindStyle(car?.classColor, highlightColor, isMultiClass),
    [car?.classColor, highlightColor, isMultiClass]
  );
  const rowClasses = [
    outOfIt ? 'text-white/60' : '',
    isFocus ? 'text-amber-300 bg-amber-500/20' : '',
    !isFocus
      ? rowIndex % 2 === 0
        ? 'bg-slate-800/70'
        : 'bg-slate-900/70'
      : '',
  ]
    .filter(Boolean)
    .join(' ');
  const decimalPlaces = settings?.gap?.decimalPlaces ?? 2;

  const cells: React.JSX.Element[] = [];
  for (const key of columns) {
    switch (key) {
      case 'position': {
        // As the standings draw it: a plain number, the class colour behind
        // the focus car's, yellow for a car off the track.
        const background = car?.offTrack
          ? 'bg-yellow-400 text-yellow-900'
          : isFocus
            ? `${tailwindStyles.classHeader} text-white`
            : 'text-white';
        cells.push(
          <td
            key={key}
            data-column="position"
            className={`w-0 text-center px-2 ${FIGURE} ${background}`}
          >
            {car?.classPosition ?? DASH}
          </td>
        );
        break;
      }
      case 'positionChange':
        cells.push(
          <td key={key} data-column="positionChange" className="w-0 px-1">
            {car && <RatingChange value={car.positionChange} justify="start" />}
          </td>
        );
        break;
      case 'carNumber':
        cells.push(
          <td
            key={key}
            data-column="carNumber"
            className={`w-0 ${car ? `${tailwindStyles.driverIcon} border-l-4` : ''} text-white text-right px-1 whitespace-nowrap`}
          >
            {car ? `#${car.carNumber}` : ''}
          </td>
        );
        break;
      case 'driverName':
        cells.push(
          <td
            key={key}
            data-column="driverName"
            className="px-1 py-0.5 w-full truncate max-w-0"
          >
            {car?.name || DASH}
          </td>
        );
        break;
      case 'status':
        cells.push(
          <td
            key={key}
            data-column="status"
            className="w-0 px-1 text-center align-middle whitespace-nowrap"
          >
            {car && (
              <DriverStatusBadges
                pit={car.inPitLane}
                out={car.onOutLap}
                garage={car.inGarage}
                pitTime={
                  (settings?.status?.showPitTime ?? true)
                    ? pitTimeText(car)
                    : undefined
                }
                penaltyKind={car.penaltyKind}
                penaltySeconds={car.penaltySeconds}
                finishState={car.finishState}
              />
            )}
          </td>
        );
        break;
      case 'compound':
        cells.push(
          <td
            key={key}
            data-column="compound"
            className="w-0 px-1 text-center whitespace-nowrap"
          >
            <div className="flex items-center justify-center">
              {car && (
                <Compound
                  tireCompound={car.tireCompound}
                  wheelCompounds={car.wheelCompounds}
                />
              )}
            </div>
          </td>
        );
        break;
      case 'stint':
        cells.push(
          <td
            key={key}
            data-column="stint"
            className={`w-0 px-2 text-center ${FIGURE} ${MUTED}`}
          >
            {car ? stintText(car, settings?.stint?.showEstimate ?? true) : DASH}
          </td>
        );
        break;
      case 'pitStops':
        // Green while the car has asked for a stop: it turns in this lap.
        cells.push(
          <td
            key={key}
            data-column="pitStops"
            data-requested={car?.pitRequested ? 'true' : undefined}
            className={`w-0 px-1 text-center ${FIGURE}`}
          >
            <span
              className={
                car?.pitRequested
                  ? 'inline-block min-w-5 px-1 rounded-sm bg-green-600 text-white'
                  : MUTED
              }
            >
              {car ? pitStopsText(car) : DASH}
            </span>
          </td>
        );
        break;
      case 'energy':
        cells.push(
          <VirtualEnergyCell
            key={key}
            remaining={car?.energyRemaining}
            isVirtual={car?.energyIsVirtual}
          />
        );
        break;
      case 'energyUse':
        cells.push(
          <td
            key={key}
            data-column="energyUse"
            className={`w-0 px-1 text-right ${FIGURE} ${MUTED}`}
          >
            {car ? energyUseText(car) : DASH}
          </td>
        );
        break;
      case 'bestTime': {
        const hasBest = !!car && car.bestTime > 0;
        cells.push(
          <td
            key={key}
            data-column="bestTime"
            className={`w-0 px-2 ${FIGURE} ${hasBest && car.bestIsClassBest ? 'text-purple-400' : ''}`}
          >
            {hasBest
              ? formatTime(car.bestTime, settings?.bestTime?.timeFormat)
              : DASH}
          </td>
        );
        break;
      }
      case 'lastTime': {
        const hasLast = !!car && car.lastTime > 0;
        cells.push(
          <LastTimeCell
            key={key}
            lastTimeString={
              hasLast
                ? formatTime(car.lastTime, settings?.lastTime?.timeFormat)
                : DASH
            }
            lastTimeState={car?.lastTimeState}
            invalid={
              hasLast &&
              car.lastLapInvalid === true &&
              (settings?.lastTime?.markInvalid ?? true)
            }
          />
        );
        break;
      }
      case 'speed': {
        const speed =
          speedKph !== undefined && speedKph > 0
            ? Math.round(speedFromKph(speedKph, speedUnit))
            : undefined;
        cells.push(
          <td
            key={key}
            data-column="speed"
            className={`w-0 px-1.5 text-right ${FIGURE} ${MUTED}`}
          >
            {speed ?? DASH}
          </td>
        );
        break;
      }
      case 'trackLimits':
        cells.push(
          <TrackLimitsCell
            key={key}
            points={car?.trackLimitsPoints}
            max={trackLimitsPointsMax}
          />
        );
        break;
      case 'gap': {
        // The focus car has no gap to itself: its three cells stay empty and
        // keep the columns.
        const inLaps = rival?.gap.source === 'laps';
        const trend =
          rival && side !== 'focus'
            ? trendDisplay(rival.trend, side, decimalPlaces)
            : undefined;
        cells.push(
          <td
            key="gap"
            data-column="gap"
            className={`w-0 px-1.5 text-right border-l border-white/10 ${FIGURE} text-white/85`}
          >
            {isFocus ? '' : rival?.gap.text || DASH}
          </td>,
          <td
            key="lineGap"
            data-column="lineGap"
            className={`w-0 px-1.5 text-right ${FIGURE} text-white/40`}
          >
            {!rival || inLaps
              ? ''
              : rival.previousLineGap === null
                ? DASH
                : formatGap(Math.abs(rival.previousLineGap), decimalPlaces)}
          </td>,
          <td
            key="trend"
            data-column="trend"
            data-direction={trend?.direction}
            className={`w-0 pl-1 pr-2 text-right ${FIGURE} ${trend ? toneClass(trend.tone) : ''}`}
          >
            {trend && (
              <span className="inline-flex items-center justify-end gap-0.5">
                {trend.direction === 'closing' && (
                  <CaretDownIcon size={10} weight="fill" aria-label="Closing" />
                )}
                {trend.direction === 'opening' && (
                  <CaretUpIcon size={10} weight="fill" aria-label="Opening" />
                )}
                {trend.text}
              </span>
            )}
          </td>
        );
        break;
      }
      case 'forecast': {
        const forecast =
          rival && side !== 'focus' ? forecastDisplay(rival, side) : undefined;
        cells.push(
          <td
            key={key}
            data-column="forecast"
            title={forecast?.title}
            className={`w-0 pl-1 pr-2 text-right font-semibold ${FIGURE} ${forecast ? toneClass(forecast.tone) : ''}`}
          >
            {forecast?.text ?? ''}
          </td>
        );
        break;
      }
    }
  }

  return (
    <tr data-row={side} className={rowClasses}>
      {cells}
    </tr>
  );
};
RivalRow.displayName = 'RivalRow';
