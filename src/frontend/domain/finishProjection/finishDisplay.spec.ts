import { describe, expect, it } from 'vitest';
import type { FinishCar, FinishRival } from '@irdashies/types';
import {
  finishColumnKey,
  finishColumnLabel,
  finishReasonText,
  finishRivalRows,
  formatLapFraction,
  formatLapsToGo,
  formatLeaderMargin,
  formatRaceClock,
  formatRivalGap,
  normalizeFinishScenarios,
  raceLengthText,
  refuelCell,
  refuelUnit,
} from './finishDisplay';

const car = (progress: number): FinishCar => ({
  carIdx: 0,
  paceS: 90,
  progress,
  lastStopLossS: 0,
});

const rival = (
  carIdx: number,
  gapS: number,
  values: Partial<FinishRival> = {}
): FinishRival => ({
  carIdx,
  classPosition: carIdx,
  ahead: gapS < 0,
  gapS,
  lapsLeft: 20,
  stopsOwed: 1,
  stopLossS: 40,
  basis: 'energy',
  projectedGapS: gapS,
  paceDeltaS: 0,
  inPit: false,
  ...values,
});

describe('normalizeFinishScenarios', () => {
  const FALLBACK = [30, 40, 50, 60];

  it('keeps a list of stop lengths as it was set', () => {
    expect(normalizeFinishScenarios([45, 20, 20], FALLBACK)).toEqual([
      45, 20, 20,
    ]);
    expect(normalizeFinishScenarios([], FALLBACK)).toEqual([]);
  });

  it('makes each a whole number of seconds from 0 to 300', () => {
    expect(normalizeFinishScenarios([-5, 32.6, 900], FALLBACK)).toEqual([
      0, 33, 300,
    ]);
  });

  it('takes six at most, and drops what is not a number', () => {
    expect(
      normalizeFinishScenarios([10, 20, 30, 40, 50, 60, 70], FALLBACK)
    ).toEqual([10, 20, 30, 40, 50, 60]);
    expect(
      normalizeFinishScenarios([10, '20', null, Number.NaN, 30], FALLBACK)
    ).toEqual([10, 30]);
  });

  it('falls back on the defaults for anything that is not a list', () => {
    expect(normalizeFinishScenarios(undefined, FALLBACK)).toEqual(FALLBACK);
    expect(normalizeFinishScenarios('30,40', FALLBACK)).toEqual(FALLBACK);
    expect(normalizeFinishScenarios({ 0: 30 }, FALLBACK)).toEqual(FALLBACK);
    // A copy: the defaults are not handed out to be changed.
    expect(normalizeFinishScenarios(undefined, FALLBACK)).not.toBe(FALLBACK);
  });
});

describe('the captions of the columns', () => {
  it('names each kind, and a stop length by its seconds', () => {
    expect(finishColumnLabel({ kind: 'now', scenarioS: null })).toBe('NOW');
    expect(finishColumnLabel({ kind: 'scenario', scenarioS: 30 })).toBe('30s');
    expect(finishColumnLabel({ kind: 'planned', scenarioS: null })).toBe(
      'PLAN'
    );
    expect(finishColumnLabel({ kind: 'toFinish', scenarioS: null })).toBe(
      'FIN'
    );
    expect(finishColumnLabel({ kind: 'last', scenarioS: null })).toBe('LAST');
  });

  it('keys two columns of the same stop length apart', () => {
    expect(finishColumnKey({ kind: 'scenario', scenarioS: 30 }, 1)).not.toBe(
      finishColumnKey({ kind: 'scenario', scenarioS: 30 }, 2)
    );
    expect(finishColumnKey({ kind: 'now', scenarioS: null }, 0)).toBe('now');
  });
});

describe('the figures of the table', () => {
  it('writes the leader’s margin in whole seconds after the clock', () => {
    expect(formatLeaderMargin(7.5)).toBe('+8s');
    expect(formatLeaderMargin(0.2)).toBe('+0s');
    expect(formatLeaderMargin(null)).toBe('--');
  });

  it('writes laps to go to a tenth', () => {
    expect(formatLapsToGo(6.2)).toBe('6.2');
    expect(formatLapsToGo(26.62)).toBe('26.6');
    expect(formatLapsToGo(null)).toBe('--');
  });

  it('writes a lap fraction to two decimals', () => {
    expect(formatLapFraction(0.9167)).toBe('0.92');
    expect(formatLapFraction(null)).toBe('--');
  });
});

describe('refuelCell', () => {
  it('writes what is missing with its sign', () => {
    expect(refuelCell(14.26, 5.26, 'toAdd', '%', false)).toEqual({
      text: '+5.3',
      tone: 'needed',
    });
  });

  it('writes a plain 0 once what is aboard covers the laps', () => {
    expect(refuelCell(14.26, -15.74, 'toAdd', '%', false)).toEqual({
      text: '0',
      tone: 'enough',
    });
    // What would be written "+0.0" is nothing to add.
    expect(refuelCell(9.04, 0.04, 'toAdd', '%', false).text).toBe('0');
    expect(refuelCell(9.06, 0.06, 'toAdd', '%', false).text).toBe('+0.1');
  });

  it('writes the whole amount when asked for the total', () => {
    expect(refuelCell(14.26, 5.26, 'total', '%', false)).toEqual({
      text: '14.3',
      tone: 'needed',
    });
    expect(refuelCell(14.26, -15.74, 'total', '%', false)).toEqual({
      text: '14.3',
      tone: 'enough',
    });
  });

  it('marks an amount the car cannot hold', () => {
    expect(refuelCell(121, 82.6, 'toAdd', '%', true).tone).toBe('over');
    expect(refuelCell(121, 82.6, 'total', '%', true).tone).toBe('over');
  });

  it('converts litres to gallons, and leaves percent alone', () => {
    expect(refuelCell(40, 20, 'toAdd', 'gal', false).text).toBe('+5.3');
    expect(refuelCell(40, 20, 'total', 'gal', false).text).toBe('10.6');
    expect(refuelCell(40, 20, 'toAdd', 'L', false).text).toBe('+20.0');
    expect(refuelUnit(true, 'gal')).toBe('%');
    expect(refuelUnit(false, 'gal')).toBe('gal');
    expect(refuelUnit(false, 'L')).toBe('L');
  });

  it('is a dash without a usage to count with', () => {
    expect(refuelCell(null, null, 'toAdd', '%', false)).toEqual({
      text: '--',
      tone: 'none',
    });
  });
});

describe('the header', () => {
  it('writes a clock in minutes, and hours when there are any', () => {
    expect(formatRaceClock(895.4)).toBe('14:55');
    expect(formatRaceClock(59)).toBe('0:59');
    expect(formatRaceClock(3727)).toBe('1:02:07');
    expect(formatRaceClock(-3)).toBe('0:00');
  });

  it('gives the clock of a timed race', () => {
    expect(
      raceLengthText({
        raceType: 'time',
        timeLeftS: 895,
        lapLimit: null,
        leader: car(10.25),
        player: car(9.8),
      })
    ).toEqual({ label: 'Time', value: '14:55' });
  });

  it('gives the leader’s laps to the distance of a lap race', () => {
    expect(
      raceLengthText({
        raceType: 'laps',
        timeLeftS: null,
        lapLimit: 30,
        leader: car(20.5),
        player: car(19.9),
      })
    ).toEqual({ label: 'Laps', value: '9.5 left' });
    // Leading: the player's own.
    expect(
      raceLengthText({
        raceType: 'laps',
        timeLeftS: null,
        lapLimit: 30,
        leader: null,
        player: car(19.9),
      }).value
    ).toBe('10.1 left');
  });

  it('gives both for a race run to laps and time', () => {
    expect(
      raceLengthText({
        raceType: 'lapsAndTime',
        timeLeftS: 700,
        lapLimit: 30,
        leader: car(20.5),
        player: car(19.9),
      })
    ).toEqual({ label: 'Laps + time', value: '9.5 left / 11:40' });
  });

  it('says why there is no table', () => {
    expect(finishReasonText('notRace')).toBe('Race only');
    expect(finishReasonText('notStarted')).toBe('Waiting for the green flag');
    expect(finishReasonText('finished')).toBe('Race finished');
    expect(finishReasonText('noCar')).toBe('No car in the race');
    expect(finishReasonText('otherCar')).toBe('Camera on another car');
    expect(finishReasonText('noPace')).toBe('Waiting for a lap time');
    expect(finishReasonText(null)).toBe('Waiting for the session');
    expect(finishReasonText(undefined)).toBe('Waiting for the session');
  });
});

describe('formatRivalGap', () => {
  it('signs a gap: behind the player is plus, ahead is minus', () => {
    expect(formatRivalGap(5.12)).toBe('+5.1');
    expect(formatRivalGap(-14.2)).toBe('-14.2');
    expect(formatRivalGap(0)).toBe('+0.0');
  });

  it('goes to minutes from a minute up', () => {
    expect(formatRivalGap(59.94)).toBe('+59.9');
    expect(formatRivalGap(59.96)).toBe('+1:00');
    expect(formatRivalGap(-82.5)).toBe('-1:23');
    expect(formatRivalGap(119.5)).toBe('+2:00');
  });

  it('is a dash where the gap is not known', () => {
    expect(formatRivalGap(null)).toBe('--');
  });
});

describe('finishRivalRows', () => {
  const OPTIONS = {
    rivalsAhead: 2,
    rivalsBehind: 2,
    extraTimeS: 0,
    includePace: false,
  };
  /** As the channel lists them: each side nearest first. */
  const RIVALS = [
    rival(4, -3.4),
    rival(3, -14.2),
    rival(2, -31.9),
    rival(6, 5.1),
    rival(7, 11.8),
    rival(8, 48.3),
  ];
  const snapshot = (rivals = RIVALS, playerStopsOwed: number | null = 0) => ({
    rivals,
    playerStopsOwed,
  });

  it('takes the nearest on each side and puts them in class order', () => {
    const rows = finishRivalRows(snapshot(), OPTIONS);
    expect(rows.ahead.map((row) => row.rival.carIdx)).toEqual([3, 4]);
    expect(rows.behind.map((row) => row.rival.carIdx)).toEqual([6, 7]);

    const all = finishRivalRows(snapshot(), {
      ...OPTIONS,
      rivalsAhead: 3,
      rivalsBehind: 3,
    });
    expect(all.ahead.map((row) => row.rival.carIdx)).toEqual([2, 3, 4]);
    expect(all.behind.map((row) => row.rival.carIdx)).toEqual([6, 7, 8]);

    const none = finishRivalRows(snapshot(), {
      ...OPTIONS,
      rivalsAhead: 0,
      rivalsBehind: 1,
    });
    expect(none.ahead).toEqual([]);
    expect(none.behind.map((row) => row.rival.carIdx)).toEqual([6]);
  });

  it('says where the player ends against each', () => {
    const rows = finishRivalRows(
      snapshot([
        rival(4, -3.4, { projectedGapS: 2.2 }),
        rival(3, -14.2, { projectedGapS: -12.7 }),
        rival(6, 5.1, { projectedGapS: 0.8 }),
        rival(7, 11.8, { projectedGapS: null }),
      ]),
      OPTIONS
    );
    expect(
      [...rows.ahead, ...rows.behind].map((row) => [
        row.rival.carIdx,
        row.projectedS,
        row.outcome,
      ])
    ).toEqual([
      [3, -12.7, 'behind'],
      [4, 2.2, 'ahead'],
      // Inside a second either way is level.
      [6, 0.8, 'level'],
      [7, null, 'unknown'],
    ]);
  });

  it('gives each stop the player owes its extra time', () => {
    const rows = finishRivalRows(
      snapshot([rival(4, -3.4, { projectedGapS: 2.2 })], 2),
      { ...OPTIONS, extraTimeS: 2 }
    );
    expect(rows.ahead[0].projectedS).toBeCloseTo(-1.8, 9);
    expect(rows.ahead[0].outcome).toBe('behind');
  });

  it('ends nowhere against a rival while the stops the player owes are not known', () => {
    // Whatever the snapshot carries for the rival: a gap made with the
    // player's stops counted as none would set the rival that far behind.
    const rows = finishRivalRows(
      snapshot([rival(4, -3.4, { projectedGapS: 2.2, paceDeltaS: 6.3 })], null),
      { ...OPTIONS, includePace: true }
    );
    expect(rows.ahead[0].projectedS).toBeNull();
    expect(rows.ahead[0].outcome).toBe('unknown');
  });

  it('adds the pace over the laps left when asked', () => {
    const rivals = [rival(4, -3.4, { projectedGapS: -2, paceDeltaS: 6.3 })];
    expect(finishRivalRows(snapshot(rivals), OPTIONS).ahead[0].outcome).toBe(
      'behind'
    );
    const paced = finishRivalRows(snapshot(rivals), {
      ...OPTIONS,
      includePace: true,
    });
    expect(paced.ahead[0].projectedS).toBeCloseTo(4.3, 9);
    expect(paced.ahead[0].outcome).toBe('ahead');
  });

  it('has no rows without a snapshot', () => {
    expect(finishRivalRows(undefined, OPTIONS)).toEqual({
      ahead: [],
      behind: [],
    });
  });
});
