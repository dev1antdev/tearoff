import { useMemo, useState } from 'react';
import { useChannelSelector, useSessionDrivers } from '@irdashies/context';
import { useOwnCar } from '@irdashies/domain/ownCar/useOwnCar';
import {
  parseCarNumbers,
  rivalLines,
  rivalsAround,
  rivalsChosen,
  type ChartRivalRole,
  type ForecastPlace,
} from '@irdashies/domain/raceHistory';
import type { RaceChartsOthers, RaceForecastSnapshot } from '@irdashies/types';

/** A car of a chart, as the session names it. */
export interface ChartCar {
  carIdx: number;
  number: string;
}

/** A car drawn beside our own. */
export interface ChartRivalCar extends ChartCar {
  role: ChartRivalRole;
  /** Which of the three other lines it is drawn with. */
  line: number;
}

export interface ChartCars {
  /** Our own car; null while the session has none of ours. */
  own: ChartCar | null;
  rivals: ChartRivalCar[];
  /** Every car drawn, our own first: what is asked of the race history. */
  carIdxs: readonly number[];
}

/**
 * The order of our class as one string. The forecast comes again whenever a
 * gap moves by a tenth, and the places a few times a race.
 */
const selectPlaces = (snapshot: RaceForecastSnapshot): string =>
  snapshot.cars
    .map((car) => `${car.carIdx}:${car.own ? 1 : 0}:${car.classPosition}`)
    .join(',');

const placesOf = (text: string | undefined): ForecastPlace[] =>
  text
    ? text.split(',').map((part) => {
        const [carIdx, own, classPosition] = part.split(':').map(Number);
        return { carIdx, own: own === 1, classPosition };
      })
    : [];

const NO_LINES: ReadonlyMap<number, number> = new Map<number, number>();

/**
 * Our own car and the cars drawn beside it.
 *
 * Ours is the entry the user drives or shares, by the rule the Pit Wall's
 * header finds it with. The others are the cars around it in class, in the
 * order the race forecast has the class in, or the ones named by number;
 * the forecast is read for the first of those only.
 */
export const useChartCars = (
  others: RaceChartsOthers,
  carNumbers: string
): ChartCars => {
  const { carIdx: ownCarIdx } = useOwnCar();
  const drivers = useSessionDrivers();
  const places = useChannelSelector('race-forecast.snapshot', selectPlaces, {
    enabled: others === 'around',
  });

  const rivals = useMemo(
    () =>
      others === 'around'
        ? rivalsAround(placesOf(places))
        : rivalsChosen(parseCarNumbers(carNumbers), drivers, ownCarIdx),
    [others, places, carNumbers, drivers, ownCarIdx]
  );

  // A car keeps its line while it is drawn. Worked out from the lines
  // before, so it is state, moved on here while rendering as React has a
  // value that follows another kept.
  const [lines, setLines] = useState(NO_LINES);
  const nextLines = rivalLines(
    lines,
    rivals.map((rival) => rival.carIdx)
  );
  if (nextLines !== lines) setLines(nextLines);

  return useMemo(() => {
    const numberOf = (carIdx: number): string =>
      `${drivers?.find((driver) => driver?.CarIdx === carIdx)?.CarNumber ?? ''}`;
    const own =
      ownCarIdx === null
        ? null
        : { carIdx: ownCarIdx, number: numberOf(ownCarIdx) };
    const drawn = rivals
      .filter((rival) => rival.carIdx !== ownCarIdx)
      .map((rival) => ({
        ...rival,
        number: numberOf(rival.carIdx),
        line: nextLines.get(rival.carIdx) ?? 0,
      }));
    return {
      own,
      rivals: drawn,
      carIdxs: own ? [own.carIdx, ...drawn.map((rival) => rival.carIdx)] : [],
    };
  }, [ownCarIdx, drivers, rivals, nextLines]);
};
