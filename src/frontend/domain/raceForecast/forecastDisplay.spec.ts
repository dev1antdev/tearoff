import { describe, expect, it } from 'vitest';
import type {
  DamageSnapshot,
  RaceForecastCar,
  RaceForecastPlace,
  RaceForecastRejoin,
  RaceForecastStint,
  WearSnapshot,
  WearWheelSnapshot,
} from '@irdashies/types';
import { EMPTY_WEAR } from '@irdashies/types';
import {
  NO_FIGURE,
  budgetFigure,
  classNeighbours,
  classRivalRows,
  closingRate,
  damageLine,
  forecastReasonText,
  formatGap,
  formatLapCount,
  formatLapTime,
  formatLapWindow,
  formatSeconds,
  netGap,
  paceDelta,
  placeFigure,
  rejoinFigure,
  stintEnd,
  stintEndText,
  stintMinutes,
  tyreLapsLeft,
  tyresLine,
} from './forecastDisplay';

const car = (
  carIdx: number,
  classPosition: number,
  values: Partial<RaceForecastCar> = {}
): RaceForecastCar => ({
  carIdx,
  own: false,
  classPosition,
  gapS: 0,
  inPit: false,
  paceS: 114.4,
  progress: 140.4,
  lapsLeft: 109.6,
  stopsOwed: 3,
  basis: 'energy',
  nextStopLap: 160,
  stintLaps: 32,
  stopLossS: 58,
  netGapS: 0,
  finishGapS: 0,
  finishPosition: classPosition,
  stops: 4,
  lastStopLap: 128,
  lastStopLaneS: 61.4,
  sinceStopLaps: 12,
  avg5S: 114.4,
  ...values,
});

const stint = (values: Partial<RaceForecastStint> = {}): RaceForecastStint => ({
  isVirtualEnergy: true,
  aboard: 52,
  capacity: 100,
  perLap: 3.125,
  lapsLeft: 16.6,
  limit: 'energy',
  tankLapsLeft: 18.5,
  window: { openLap: 154, closeLap: 157 },
  ...values,
});

const wheel = (treadPct: number | null, lapsLeft: number | null) =>
  ({
    ...EMPTY_WEAR.wheels[0],
    treadPct,
    treadLapsLeft: lapsLeft,
    compound: 1,
  }) satisfies WearWheelSnapshot;

const wear = (
  wheels: [number | null, number | null][],
  available = true
): WearSnapshot => ({
  ...EMPTY_WEAR,
  available,
  wheels: wheels.map(([tread, laps]) => wheel(tread, laps)),
});

const damage = (values: Partial<DamageSnapshot> = {}): DamageSnapshot => ({
  available: true,
  body: [0, 0, 0, 0, 0, 0, 0, 0],
  wheels: [0, 1, 2, 3].map(() => ({
    detached: false,
    punctured: false,
    suspensionDamage: 0,
  })),
  bodyIntegrity: 1,
  aeroIntegrity: 1,
  suspensionIntegrity: 1,
  tyreIntegrity: 1,
  overheating: false,
  impactBearingRad: null,
  repairSeconds: 0,
  repairChoice: null,
  sessionNum: 0,
  version: 1,
  ...values,
});

const place = (values: Partial<RaceForecastPlace> = {}): RaceForecastPlace => ({
  now: 4,
  finish: 3,
  uncertain: false,
  was: null,
  ahead: { carIdx: 2, gapS: 44.8 },
  behind: { carIdx: 5, gapS: 26.6 },
  ...values,
});

describe('writing a figure', () => {
  it('says why a panel is empty', () => {
    expect(forecastReasonText('notRace')).toBe(
      'A forecast needs a race: this session is not one.'
    );
    expect(forecastReasonText('notStarted')).toBe(
      'Waiting for the green flag.'
    );
    expect(forecastReasonText('finished')).toBe('The race is over.');
    expect(forecastReasonText('noCar')).toBe('You have no car in this race.');
    expect(forecastReasonText('otherCar')).toBe(
      'The camera is on another car. The forecast is for your own.'
    );
    expect(forecastReasonText('noPace')).toBe(
      'Waiting for a lap time to forecast from.'
    );
    expect(forecastReasonText(null)).toBe('Waiting for the session.');
    expect(forecastReasonText(undefined)).toBe('Waiting for the session.');
  });

  it('writes a lap time to the thousandth, and nothing for no time', () => {
    expect(formatLapTime(114.402)).toBe('1:54.402');
    expect(formatLapTime(58.9)).toBe('0:58.900');
    expect(formatLapTime(0)).toBe(NO_FIGURE);
    expect(formatLapTime(-1)).toBe(NO_FIGURE);
    expect(formatLapTime(null)).toBe(NO_FIGURE);
    expect(formatLapTime(undefined)).toBe(NO_FIGURE);
  });

  it('writes a gap with its sign, in minutes from a minute up', () => {
    expect(formatGap(-34.3)).toBe('-34.3');
    expect(formatGap(7.5)).toBe('+7.5');
    expect(formatGap(0)).toBe('0.0');
    // Nothing is not on either side.
    expect(formatGap(-0.04)).toBe('0.0');
    expect(formatGap(59.94)).toBe('+59.9');
    expect(formatGap(59.96)).toBe('+1:00');
    expect(formatGap(-131.2)).toBe('-2:11');
    expect(formatGap(null)).toBe(NO_FIGURE);
    expect(formatGap(Number.NaN)).toBe(NO_FIGURE);
  });

  it('writes seconds to a tenth under ten and whole above', () => {
    expect(formatSeconds(4.14)).toBe('4.1 s');
    expect(formatSeconds(9.96)).toBe('10 s');
    expect(formatSeconds(58.04)).toBe('58 s');
    expect(formatSeconds(-2.8)).toBe('2.8 s');
    expect(formatSeconds(null)).toBe(NO_FIGURE);
  });

  it('writes a window as its laps, and as one lap where it is one', () => {
    expect(formatLapWindow({ openLap: 153, closeLap: 155 })).toBe(
      'laps 153–155'
    );
    expect(formatLapWindow({ openLap: 155, closeLap: 155 })).toBe('lap 155');
    expect(formatLapWindow(null)).toBe(NO_FIGURE);
    expect(formatLapWindow(undefined)).toBe(NO_FIGURE);
  });

  it('counts laps in words', () => {
    expect(formatLapCount(1)).toBe('1 lap');
    expect(formatLapCount(14)).toBe('14 laps');
    expect(formatLapCount(0)).toBe('0 laps');
  });
});

describe('paceDelta', () => {
  it('is the rival’s mean less ours, green when we are the faster', () => {
    expect(paceDelta(114.712, 114.402)).toEqual({
      text: '+0.31',
      tone: 'good',
    });
    expect(paceDelta(114.122, 114.402)).toEqual({ text: '-0.28', tone: 'bad' });
  });

  it('is neither’s where the two are level to the hundredth', () => {
    expect(paceDelta(114.404, 114.402)).toEqual({
      text: '0.00',
      tone: 'plain',
    });
  });

  it('is not known until both cars have five clean laps', () => {
    expect(paceDelta(null, 114.4)).toEqual({ text: NO_FIGURE, tone: 'quiet' });
    expect(paceDelta(114.4, undefined)).toEqual({
      text: NO_FIGURE,
      tone: 'quiet',
    });
  });
});

describe('netGap', () => {
  it('is green where we end ahead and red where behind', () => {
    expect(netGap(13.6)).toEqual({ text: '+13.6', tone: 'good' });
    expect(netGap(-25.3)).toEqual({ text: '-25.3', tone: 'bad' });
  });

  it('is neither within a second of level', () => {
    expect(netGap(0.8)).toEqual({ text: '+0.8', tone: 'plain' });
    expect(netGap(-1)).toEqual({ text: '-1.0', tone: 'plain' });
  });

  it('reads -- where a stop cannot be costed', () => {
    expect(netGap(null)).toEqual({ text: NO_FIGURE, tone: 'quiet' });
  });
});

describe('budgetFigure', () => {
  it('writes virtual energy in percent, whatever the fuel unit', () => {
    expect(budgetFigure(stint(), 'gal')).toEqual({
      label: 'Virtual energy',
      value: '52',
      unit: '%',
      fill: 0.52,
      perLap: '3.1 % a lap',
    });
  });

  it('writes fuel in litres or gallons', () => {
    const fuel = stint({ isVirtualEnergy: false, aboard: 52, perLap: 3.125 });
    expect(budgetFigure(fuel, 'L')).toMatchObject({
      label: 'Fuel',
      value: '52.0',
      unit: 'L',
      perLap: '3.13 L a lap',
    });
    expect(budgetFigure(fuel, 'gal')).toMatchObject({
      value: '13.7',
      unit: 'gal',
      fill: 0.52,
      perLap: '0.83 gal a lap',
    });
  });

  it('has no bar to fill without a capacity, and never overfills one', () => {
    expect(budgetFigure(stint({ capacity: null }), 'L').fill).toBeNull();
    expect(budgetFigure(stint({ aboard: 104 }), 'L').fill).toBe(1);
  });
});

describe('what ends the stint', () => {
  it('turns laps into whole minutes at a pace', () => {
    expect(stintMinutes(14.2, 114.4)).toBe(27);
    expect(stintMinutes(null, 114.4)).toBeNull();
    expect(stintMinutes(14.2, 0)).toBeNull();
    expect(stintMinutes(14.2, undefined)).toBeNull();
  });

  it('takes the fewest laps of tread left over the four wheels', () => {
    expect(
      tyreLapsLeft(
        wear([
          [84, 61],
          [85, 63],
          [88, 70],
          [89, 72],
        ])
      )
    ).toBe(61);
  });

  it('has no tyre forecast without a car, under iRacing, or short of four wheels', () => {
    expect(tyreLapsLeft(undefined)).toBeNull();
    expect(tyreLapsLeft(EMPTY_WEAR)).toBeNull();
    expect(
      tyreLapsLeft(
        wear([
          [84, 61],
          [85, null],
          [88, 70],
          [89, 72],
        ])
      )
    ).toBeNull();
  });

  it('is the budget the forecast names, or the tyres where they go first', () => {
    expect(stintEnd(stint(), 61)).toEqual({ by: 'energy', laps: 16.6 });
    expect(stintEnd(stint({ limit: 'fuel', lapsLeft: 15.8 }), null)).toEqual({
      by: 'fuel',
      laps: 15.8,
    });
    expect(stintEnd(stint(), 9)).toEqual({ by: 'tyres', laps: 9 });
    // Level is not first.
    expect(stintEnd(stint({ lapsLeft: 9 }), 9).by).toBe('energy');
  });

  it('says which in words', () => {
    expect(stintEndText('energy')).toBe('energy runs out first');
    expect(stintEndText('fuel')).toBe('fuel runs out first');
    expect(stintEndText('tyres')).toBe('tyres run out first');
  });
});

describe('placeFigure', () => {
  it('is green for a place gained and red for one lost', () => {
    expect(placeFigure(place())).toMatchObject({
      text: 'P3 in class',
      tone: 'good',
      uncertain: false,
    });
    expect(placeFigure(place({ finish: 6 }))).toMatchObject({
      text: 'P6 in class',
      tone: 'bad',
    });
    expect(placeFigure(place({ finish: 4 }))?.tone).toBe('plain');
  });

  it('marks a forecast that rests on less than a reading', () => {
    expect(placeFigure(place({ uncertain: true }))).toMatchObject({
      text: '~P3 in class',
      uncertain: true,
    });
  });

  it('says how the forecast stood some laps ago, once that is remembered', () => {
    expect(placeFigure(place({ was: { finish: 4, lapsAgo: 10 } }))?.note).toBe(
      'was P4 10 laps ago'
    );
    expect(placeFigure(place({ was: { finish: 3, lapsAgo: 5 } }))?.note).toBe(
      'was P3 5 laps ago'
    );
  });

  it('says how near the next place is at the flag, before then', () => {
    expect(placeFigure(place())?.note).toBe('P2 is 45 s ahead at the flag');
    // Leading: the car behind is the one to watch.
    expect(placeFigure(place({ now: 1, finish: 1, ahead: null }))?.note).toBe(
      'P2 is 27 s behind at the flag'
    );
    expect(placeFigure(place({ ahead: null, behind: null }))?.note).toBe('');
  });

  it('has no tone to give a car the sim has not placed', () => {
    expect(placeFigure(place({ now: 0 }))?.tone).toBe('plain');
  });

  it('is nothing while there is no place to forecast', () => {
    expect(placeFigure(null)).toBeNull();
    expect(placeFigure(undefined)).toBeNull();
  });
});

describe('rejoinFigure', () => {
  const rejoin = (
    values: Partial<RaceForecastRejoin> = {}
  ): RaceForecastRejoin => ({
    position: 6,
    ahead: { carIdx: 23, gapS: 12.9 },
    behind: { carIdx: 85, gapS: 4.1 },
    inPits: 0,
    closeCall: false,
    ...values,
  });
  const numberOf = (carIdx: number) => String(carIdx);

  it('names the car ahead and how far clear of the car behind', () => {
    expect(rejoinFigure(rejoin(), numberOf)).toEqual({
      text: 'P6, behind #23',
      note: '4.1 s clear of #85',
      closeCall: false,
    });
  });

  it('marks a place that hangs on a car within the margin', () => {
    expect(rejoinFigure(rejoin({ closeCall: true }), numberOf)).toMatchObject({
      text: '~P6, behind #23',
      closeCall: true,
    });
  });

  it('says so when nobody is close behind, or the cars behind are in the pits', () => {
    expect(rejoinFigure(rejoin({ behind: null }), numberOf)?.note).toBe(
      'nobody close behind'
    );
    expect(
      rejoinFigure(rejoin({ behind: null, inPits: 1 }), numberOf)?.note
    ).toBe('1 car in the pits not counted');
    expect(
      rejoinFigure(rejoin({ behind: null, inPits: 2 }), numberOf)?.note
    ).toBe('2 cars in the pits not counted');
  });

  it('is a place alone with nobody ahead', () => {
    expect(
      rejoinFigure(rejoin({ position: 1, ahead: null }), numberOf)?.text
    ).toBe('P1');
  });

  it('is nothing without a rejoin to project', () => {
    expect(rejoinFigure(null, numberOf)).toBeNull();
  });
});

describe('the cars either side', () => {
  const cars = [
    car(10, 1, { gapS: -20 }),
    car(11, 2, { gapS: -9.8, avg5S: 114.6 }),
    car(0, 3, { own: true }),
    car(12, 4, { gapS: 4.2, avg5S: 114.3 }),
  ];

  it('are the class cars one place ahead and one behind', () => {
    expect(classNeighbours(cars)).toEqual({ ahead: cars[1], behind: cars[3] });
  });

  it('are missing at the ends of the class, and without the own car', () => {
    expect(classNeighbours(cars.slice(2))).toEqual({
      ahead: null,
      behind: cars[3],
    });
    expect(classNeighbours(cars.slice(0, 3))).toEqual({
      ahead: cars[1],
      behind: null,
    });
    expect(classNeighbours([cars[0]])).toEqual({ ahead: null, behind: null });
  });

  it('close on a slower car ahead, and lose to a faster one', () => {
    expect(closingRate('ahead', 114.6, 114.4)).toEqual({
      text: 'closing 0.2 s a lap',
      tone: 'good',
    });
    expect(closingRate('ahead', 114.1, 114.4)).toEqual({
      text: 'losing 0.3 s a lap',
      tone: 'bad',
    });
  });

  it('pull away from a slower car behind, and lose to a faster one', () => {
    expect(closingRate('behind', 114.7, 114.4)).toEqual({
      text: 'pulling away 0.3 s a lap',
      tone: 'good',
    });
    expect(closingRate('behind', 114.3, 114.4)).toEqual({
      text: 'losing 0.1 s a lap',
      tone: 'bad',
    });
  });

  it('hold station where the paces are level, and say nothing without both', () => {
    expect(closingRate('ahead', 114.43, 114.4)).toEqual({
      text: 'holding station',
      tone: 'plain',
    });
    expect(closingRate('behind', null, 114.4)).toEqual({
      text: NO_FIGURE,
      tone: 'quiet',
    });
  });
});

describe('tyresLine', () => {
  it('writes the tread of each wheel and the laps the set lasts', () => {
    expect(
      tyresLine(
        wear([
          [84.2, 61],
          [85.1, 63],
          [88.4, 70],
          [89, 72],
        ])
      )
    ).toEqual({
      tread: '84 · 85 · 88 · 89 %',
      note: 'good for 61 laps more',
      compound: 1,
    });
  });

  it('keeps a wheel with no reading as --, and gives no forecast for the set', () => {
    expect(
      tyresLine(
        wear([
          [84.2, 61],
          [null, null],
          [88.4, 70],
          [89, 72],
        ])
      )
    ).toMatchObject({
      tread: '84 · -- · 88 · 89 %',
      note: '',
    });
  });

  it('is nothing without a reading: iRacing, and a car somebody else drives', () => {
    expect(tyresLine(undefined)).toBeNull();
    expect(tyresLine(EMPTY_WEAR)).toBeNull();
    expect(
      tyresLine(
        wear([
          [null, null],
          [null, null],
          [null, null],
          [null, null],
        ])
      )
    ).toBeNull();
  });
});

describe('damageLine', () => {
  it('says None for a sound car with no repair set', () => {
    expect(damageLine(damage())).toEqual({
      text: 'None',
      damaged: false,
      note: 'no repair time',
    });
  });

  it('names what is damaged, and the repair of the next stop', () => {
    expect(
      damageLine(
        damage({ aeroIntegrity: 0.93, bodyIntegrity: 0.88, repairSeconds: 34 })
      )
    ).toEqual({
      text: 'Aero 93 %, body 88 %',
      damaged: true,
      note: 'repairs 34s at the stop',
    });
    expect(damageLine(damage({ suspensionIntegrity: 0.6 }))?.text).toBe(
      'Suspension 60 %'
    );
  });

  it('puts a wheel that is off or flat first', () => {
    const wheels = damage().wheels.map((entry, index) =>
      index === 1 ? { ...entry, punctured: true } : entry
    );
    expect(damageLine(damage({ wheels }))).toMatchObject({
      text: 'Puncture',
      damaged: true,
    });
    const off = wheels.map((entry, index) =>
      index === 2 ? { ...entry, detached: true } : entry
    );
    expect(damageLine(damage({ wheels: off }))?.text).toBe('Wheel off');
  });

  it('says nothing of a repair the sim has not answered about', () => {
    expect(damageLine(damage({ repairSeconds: null }))?.note).toBe('');
  });

  it('is nothing without a reading', () => {
    expect(damageLine(undefined)).toBeNull();
    expect(damageLine(damage({ available: false }))).toBeNull();
  });
});

describe('classRivalRows', () => {
  const cars = [
    car(33, 1, { gapS: -34.3, netGapS: -25.3, avg5S: 114.122 }),
    car(46, 2, { gapS: -25.9, netGapS: -22.9, avg5S: 114.202 }),
    car(91, 3, {
      gapS: -12.4,
      netGapS: 13.6,
      avg5S: 114.712,
      stopsOwed: 4,
      nextStopLap: 159,
      lastStopLap: 131,
      lastStopLaneS: 59.4,
      sinceStopLaps: 9,
    }),
    car(77, 4, {
      own: true,
      avg5S: 114.402,
      lastStopLap: 123,
      lastStopLaneS: 58,
      sinceStopLaps: 17,
    }),
    car(54, 5, { gapS: 7.5, netGapS: 13.5, avg5S: 114.522 }),
    car(23, 6, {
      gapS: 23.9,
      netGapS: 2.3,
      inPit: true,
      stops: 5,
      sinceStopLaps: 0,
      lastStopLaneS: null,
      avg5S: null,
    }),
    car(85, 7, { gapS: 31.7, netGapS: null, basis: 'assumed' }),
  ];
  const snapshot = { cars, stint: stint() };
  const all = { carsAhead: 0, carsBehind: 0 };
  const rowOf = (carIdx: number, options = all) => {
    const row = classRivalRows(snapshot, options).find(
      (entry) => entry.car.carIdx === carIdx
    );
    if (!row) throw new Error(`no row for car ${carIdx}`);
    return row;
  };

  it('lists the whole class in the order of its places', () => {
    expect(classRivalRows(snapshot, all).map((row) => row.car.carIdx)).toEqual([
      33, 46, 91, 77, 54, 23, 85,
    ]);
  });

  it('cuts the list to a number of cars each side of the own one', () => {
    expect(
      classRivalRows(snapshot, { carsAhead: 1, carsBehind: 2 }).map(
        (row) => row.car.carIdx
      )
    ).toEqual([91, 77, 54, 23]);
    // More than there are is all there are.
    expect(
      classRivalRows(snapshot, { carsAhead: 10, carsBehind: 1 }).map(
        (row) => row.car.carIdx
      )
    ).toEqual([33, 46, 91, 77, 54]);
  });

  it('writes a rival: its gap, its stops, its next stop, the net gap and its pace against ours', () => {
    expect(rowOf(91)).toMatchObject({
      gap: '-12.4',
      stops: '4',
      lastStop: 'lap 131 · 59 s',
      since: '9',
      nextStop: '~lap 159',
      assumed: false,
      netGap: { text: '+13.6', tone: 'good' },
      pace: { text: '+0.31', tone: 'good' },
    });
    expect(rowOf(33)).toMatchObject({
      netGap: { text: '-25.3', tone: 'bad' },
      pace: { text: '-0.28', tone: 'bad' },
    });
  });

  it('writes the own row: us, its pit window and its own mean', () => {
    expect(rowOf(77)).toMatchObject({
      gap: 'us',
      lastStop: 'lap 123 · 58 s',
      since: '17',
      nextStop: 'laps 154–157',
      netGap: { text: 'us', tone: 'quiet' },
      pace: { text: '1:54.402', tone: 'plain' },
    });
  });

  it('says a car is in the pits now, in place of its last stop', () => {
    expect(rowOf(23)).toMatchObject({
      lastStop: 'in the pits now',
      since: '0',
      pace: { text: NO_FIGURE, tone: 'quiet' },
    });
  });

  it('marks a row whose stops are assumed, and reads -- where the gap cannot be costed', () => {
    expect(rowOf(85)).toMatchObject({
      assumed: true,
      netGap: { text: NO_FIGURE, tone: 'quiet' },
    });
  });

  it('reads -- for what was not seen, and none for a car that owes no stop', () => {
    const unseen = classRivalRows(
      {
        cars: [
          car(77, 1, { own: true, stopsOwed: 0, nextStopLap: null }),
          car(5, 2, {
            lastStopLap: null,
            lastStopLaneS: null,
            sinceStopLaps: null,
            nextStopLap: null,
          }),
          car(6, 3, { lastStopLaneS: null }),
          car(7, 4, { stopsOwed: 0, nextStopLap: null }),
        ],
        stint: stint({ window: null }),
      },
      all
    );
    expect(unseen[0].nextStop).toBe('none');
    expect(unseen[1]).toMatchObject({
      lastStop: NO_FIGURE,
      since: NO_FIGURE,
      nextStop: NO_FIGURE,
    });
    // The lap of a stop whose lane time a later visit replaced.
    expect(unseen[2].lastStop).toBe('lap 128');
    expect(unseen[3].nextStop).toBe('none');
  });

  it('reads -- for the own row while its stops are not known', () => {
    const rows = classRivalRows(
      {
        cars: [
          car(77, 1, {
            own: true,
            stopsOwed: null,
            basis: null,
            nextStopLap: null,
            avg5S: null,
          }),
          car(5, 2, { netGapS: null }),
        ],
        stint: null,
      },
      all
    );
    expect(rows[0]).toMatchObject({
      nextStop: NO_FIGURE,
      pace: { text: NO_FIGURE },
    });
    expect(rows[1]).toMatchObject({
      netGap: { text: NO_FIGURE },
      pace: { text: NO_FIGURE },
    });
  });

  it('is empty without a forecast', () => {
    expect(classRivalRows(undefined, all)).toEqual([]);
  });
});
