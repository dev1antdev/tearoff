import { describe, expect, it } from 'vitest';
import {
  forecastDeciders,
  forecastOrder,
  pitWindow,
  PlaceMemory,
  stopDueLap,
  type ForecastEntrant,
} from './raceForecast';

const entrant = (
  carIdx: number,
  classPosition: number,
  finishGapS: number
): ForecastEntrant => ({ carIdx, classPosition, finishGapS });

describe('stopDueLap', () => {
  it('is the last lap what is in hand completes', () => {
    // On lap 141 with 14.4 laps in hand: lap 155 is completed, 156 is not.
    expect(stopDueLap(140.8, 14.4)).toBe(155);
    expect(stopDueLap(140.2, 14.4)).toBe(154);
  });

  it('counts a car exactly on a line as on that lap', () => {
    expect(stopDueLap(140, 15)).toBe(155);
    // A sum that lands a rounding error short of the line is on it.
    expect(stopDueLap(140.1, 14.9)).toBe(155);
  });

  it('is never before the lap under way', () => {
    // Not enough for the rest of this lap: the first line it can stop at.
    expect(stopDueLap(140.5, 0.2)).toBe(141);
    expect(stopDueLap(140.5, 0)).toBe(141);
    expect(stopDueLap(140.5, -3)).toBe(141);
  });
});

describe('pitWindow', () => {
  it('opens where the stops owed still cover the distance and closes on the last lap in hand', () => {
    // Lap 141 of a race that ends 110.6 laps on, with 14.4 laps aboard and
    // stints of 31: four stops. Only a stop before the end of lap 127 would
    // leave more than four stints to drive, so any lap from here will do.
    expect(
      pitWindow({
        progress: 140.4,
        lapsLeft: 110.6,
        lapsInHand: 14.4,
        stintLaps: 31,
        stopsOwed: 4,
      })
    ).toEqual({ openLap: 141, closeLap: 154 });

    // With 135.9 laps to drive the four stints after the stop reach back
    // only to lap 153: the window is the last two laps of this stint.
    expect(
      pitWindow({
        progress: 140.4,
        lapsLeft: 135.9,
        lapsInHand: 14.4,
        stintLaps: 31,
        stopsOwed: 4,
      })
    ).toEqual({ openLap: 153, closeLap: 154 });
  });

  it('opens at the next line when any lap will do', () => {
    expect(
      pitWindow({
        progress: 12.3,
        lapsLeft: 30,
        lapsInHand: 20,
        stintLaps: 31,
        stopsOwed: 1,
      })
    ).toEqual({ openLap: 13, closeLap: 32 });
  });

  it('never opens after it closes', () => {
    // Stops owed that fall short of the distance on these figures: the
    // window is the one lap left, not an empty range.
    expect(
      pitWindow({
        progress: 10.5,
        lapsLeft: 100,
        lapsInHand: 2,
        stintLaps: 30,
        stopsOwed: 3,
      })
    ).toEqual({ openLap: 12, closeLap: 12 });
  });

  it('has no window with no stop owed, or no stint length', () => {
    const base = {
      progress: 10.5,
      lapsLeft: 12,
      lapsInHand: 14,
      stintLaps: 30,
      stopsOwed: 0,
    };
    expect(pitWindow(base)).toBeNull();
    expect(pitWindow({ ...base, stopsOwed: 1, stintLaps: 0 })).toBeNull();
  });
});

describe('forecastOrder', () => {
  it('orders by the gap each car ends at', () => {
    const order = forecastOrder([
      entrant(0, 3, 0),
      entrant(1, 1, -20),
      entrant(2, 2, 14),
      entrant(3, 4, -3),
    ]);
    expect(order.map((car) => car.carIdx)).toEqual([1, 3, 0, 2]);
  });

  it('keeps cars that end level in the order they are in now', () => {
    const order = forecastOrder([
      entrant(5, 4, 12.02),
      entrant(6, 2, 12),
      entrant(7, 3, 12.04),
      entrant(0, 1, 0),
    ]);
    expect(order.map((car) => car.carIdx)).toEqual([0, 6, 7, 5]);
  });

  it('puts a car with no place behind one that has, level with it', () => {
    const order = forecastOrder([
      entrant(4, 0, 5),
      entrant(3, 6, 5),
      entrant(2, 0, 5),
    ]);
    expect(order.map((car) => car.carIdx)).toEqual([3, 2, 4]);
  });

  it('leaves what it was given as it was', () => {
    const cars = [entrant(0, 2, 0), entrant(1, 1, -5)];
    forecastOrder(cars);
    expect(cars.map((car) => car.carIdx)).toEqual([0, 1]);
  });
});

describe('forecastDeciders', () => {
  // Places now: 1, 2, 3 (own), 4, 5. Car 4 comes past and car 2 falls back.
  const now: Record<number, number> = { 10: 1, 11: 2, 0: 3, 12: 4, 13: 5 };
  const aheadNow = (car: ForecastEntrant): boolean => now[car.carIdx] < 3;

  it('names the two cars the own one finishes between', () => {
    const order = forecastOrder([
      entrant(10, 1, -40),
      entrant(11, 2, -10),
      entrant(0, 3, 0),
      entrant(12, 4, 8),
      entrant(13, 5, 60),
    ]);
    expect(
      forecastDeciders(order, 0, aheadNow).map((car) => car.carIdx)
    ).toEqual([11, 12]);
  });

  it('names every car that changes places with it on the way', () => {
    const order = forecastOrder([
      entrant(10, 1, -40),
      // Ahead now, behind at the flag, with a car between.
      entrant(11, 2, 30),
      entrant(0, 3, 0),
      // Behind now, ahead at the flag, with a car between.
      entrant(12, 4, -20),
      entrant(13, 5, 5),
      entrant(14, 6, -6),
    ]);
    const nowWith14 = (car: ForecastEntrant): boolean =>
      car.carIdx === 14 ? false : aheadNow(car);
    expect(
      forecastDeciders(order, 0, nowWith14)
        .map((car) => car.carIdx)
        .sort((a, b) => a - b)
    ).toEqual([11, 12, 13, 14]);
  });

  it('names nobody for a car that is not in the order', () => {
    expect(forecastDeciders([entrant(1, 1, 0)], 0, () => true)).toEqual([]);
  });
});

describe('PlaceMemory', () => {
  const memory = () => new PlaceMemory(10, 5);

  it('has nothing to say until it reaches far enough back', () => {
    const places = memory();
    for (let lap = 20; lap < 25; lap += 1) {
      places.note(lap, 4);
      expect(places.was(lap)).toBeNull();
    }
    places.note(25, 3);
    // Five laps back: the forecast noted at lap 20.
    expect(places.was(25)).toEqual({ finish: 4, lapsAgo: 5 });
  });

  it('answers with the forecast ten laps ago once it holds one', () => {
    const places = memory();
    for (let lap = 20; lap <= 34; lap += 1) places.note(lap, lap);
    expect(places.was(34)).toEqual({ finish: 24, lapsAgo: 10 });
  });

  it('keeps the forecast as it stood when the lap was completed', () => {
    const places = memory();
    places.note(20, 4);
    // Later the same lap the forecast moves: the lap's entry stands.
    places.note(20, 2);
    for (let lap = 21; lap <= 26; lap += 1) places.note(lap, 2);
    expect(places.was(26)).toEqual({ finish: 4, lapsAgo: 6 });
  });

  it('goes back no further than its span when laps were missed', () => {
    const places = memory();
    places.note(3, 7);
    // Nothing was noted for laps 4 to 19.
    places.note(20, 5);
    expect(places.was(20)).toBeNull();
  });

  it('starts again when the lap count goes backwards, and when cleared', () => {
    const places = memory();
    for (let lap = 20; lap <= 30; lap += 1) places.note(lap, 4);
    places.note(2, 6);
    expect(places.was(2)).toBeNull();
    places.note(7, 6);
    expect(places.was(7)).toEqual({ finish: 6, lapsAgo: 5 });

    places.clear();
    places.note(8, 6);
    expect(places.was(8)).toBeNull();
  });
});
