import { describe, expect, it } from 'vitest';
import type {
  PlayerLedgerSnapshot,
  PlayerStintSnapshot,
} from '@irdashies/types';
import { getWidgetDefaultConfig } from '@irdashies/types';
import { formatTime } from '@irdashies/utils/time';
import recorded from '../../../../test-data/fixtures/lmu-session-ledger.json';
import { lapEntries, liveLapEntry, visibleLapEntries } from './lapEntries';
import { formatFigure, formatShare } from './ledgerFigures';
import { stintRows } from './stintRows';

/**
 * What the lap timer's history and the stint history show for the recorded
 * Le Mans Ultimate race: four minutes at Laguna Seca in a Ferrari 296 LMGT3,
 * which runs on virtual energy, joined as the field rolls up to the start.
 * The car completes two laps and never stops.
 *
 * The two snapshots are the ones the real ledger runtime publishes at the
 * end of the recording, kept as a fixture. `recordedLedger.tape.spec.ts` in
 * the main process plays the recording and holds the fixture to it; this
 * holds the widgets' selectors to what they make of it. Between them, the
 * whole path from the sim's frames to the figures on screen, short of the
 * pixels.
 */
const race = recorded as unknown as {
  ledger: PlayerLedgerSnapshot;
  stint: PlayerStintSnapshot;
};

describe('the lap history of the recorded race', () => {
  const entriesBy = (
    deltaMethod: 'lastlap' | 'bestlap',
    wearMode: 'average' | 'highest' = 'average'
  ) =>
    visibleLapEntries(
      lapEntries(race.ledger.laps, {
        sessionNum: race.ledger.sessionNum,
        deltaMethod,
        wearMode,
      }),
      getWidgetDefaultConfig('laptimelog').history
    );

  it('lists both laps with the times the sim gave them', () => {
    const entries = entriesBy('lastlap');

    expect(
      entries.map((entry) => [`LAP ${entry.lap}`, formatTime(entry.time)])
    ).toEqual([
      ['LAP 2', '1:26.660'],
      // From the rolling start: the sim times it from the green flag, eight
      // seconds before the car is let go at the line. Line to line by the
      // app's clock it took 1:29.830, which is not what a driver saw.
      ['LAP 1', '1:37.823'],
    ]);
    expect(entries.map((entry) => entry.stintLap)).toEqual([2, 1]);
    // One stint, so no line is drawn between them.
    expect(entries[0].stintId).toBe(entries[1].stintId);
  });

  it('measures the second lap against the first, or against no best', () => {
    expect(entriesBy('lastlap')[0].delta).toBeCloseTo(-11.163, 3);
    expect(entriesBy('lastlap')[1].delta).toBe(0);
    // The lap from the start is never a best to be measured by.
    expect(entriesBy('bestlap').map((entry) => entry.delta)).toEqual([0, 0]);
  });

  it('gives what each lap used of the virtual energy, in percent', () => {
    const entries = entriesBy('lastlap');

    expect(entries.map((entry) => formatShare(entry.energyUsed, 2))).toEqual([
      '2.33',
      '2.24',
    ]);
    // The litres are there too, for a car that is counted in them.
    expect(entries.map((entry) => formatFigure(entry.fuelUsed, 2))).toEqual([
      '2.30',
      '2.21',
    ]);
  });

  it('gives the tread each lap wore, as the mean of the wheels or the worst', () => {
    expect(
      entriesBy('lastlap').map((entry) => formatShare(entry.wear, 1))
    ).toEqual(['0.5', '0.4']);
    // The rears took the rolling start: the worst wheel of the first lap
    // wore more than any did on the second.
    expect(
      entriesBy('lastlap', 'highest').map((entry) => formatShare(entry.wear, 2))
    ).toEqual(['0.53', '0.60']);
  });

  it('marks the first lap as begun at the start, and nothing else', () => {
    const none = {
      dirty: false,
      pitted: false,
      caution: false,
      yellow: false,
      wet: false,
      fromStart: false,
    };

    // Green all the way, dry, no stop and no lap voided.
    expect(entriesBy('lastlap')).toMatchObject([
      none,
      { ...none, fromStart: true },
    ]);
  });

  it('has the third lap under way as its first row', () => {
    // Two thirds of the way round when the recording ends.
    const live = liveLapEntry(race.stint);

    expect(live).toMatchObject({
      lap: 3,
      stintLap: 3,
      dirty: false,
      pitted: false,
      fromStart: false,
    });
    expect(formatShare(live.energyUsed, 2)).toBe('1.69');
    expect(formatShare(live.wear, 2)).toBe('0.35');
  });
});

describe('the stint history of the recorded race', () => {
  const [row, ...others] = stintRows(
    race.ledger,
    race.stint,
    getWidgetDefaultConfig('stinthistory')
  );

  it('has the one stint, under way, and nothing finished', () => {
    expect(others).toEqual([]);
    expect(row).toMatchObject({
      current: true,
      ordinal: '1',
      laps: '2',
      budget: 'virtualEnergy',
      end: null,
      stopTime: '',
      added: '',
    });
  });

  it('times it from where the app joined to the end of the recording', () => {
    // 139.9 s to 379.9 s on the session clock, in whole seconds.
    expect(row.time).toBe('3:59');
  });

  it('counts the energy the car used, level against level', () => {
    // 45.00 % at the start and 38.75 % at the end: more than the two laps'
    // 4.6 %, as the stretch before the first and after the second count.
    expect(row.used).toBe('6.2');
    // A lap, from the one clean lap the stint has.
    expect(row.usedPerLap).toBe('2.33');
  });

  it('shows the four mediums and what they wore', () => {
    expect(row.compounds).toEqual(['Medium', 'Medium', 'Medium', 'Medium']);
    expect(row.wear).toBe('1.2');
    expect(row.wearTone).toBe('none');
    // No disc reading without the sim's REST answers.
    expect(row.brakes).toBe('--');
  });

  it('has the second lap as its best, and as the best of the session', () => {
    // The lap from the start is no best lap, though the sim timed it.
    expect(row).toMatchObject({
      best: '1:26.660',
      sessionBest: true,
      // One clean lap: nothing to be consistent with yet.
      consistency: '--',
    });
  });
});
