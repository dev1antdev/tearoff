import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useDashboard, useSessionStore } from '@irdashies/context';
import type {
  ChannelBridge,
  ChannelName,
  ChannelPayloads,
  ClassRivalsConfig,
} from '@irdashies/types';
import {
  strategySlotOf,
  strategyStage,
  type StrategyStage,
} from '../../../../.storybook/strategyStage';
import { ClassRivals } from './ClassRivals';

vi.mock('@irdashies/context', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@irdashies/context')>()),
  useDashboard: vi.fn(),
}));

/**
 * Class Rivals' wording over a stub channel bridge, on the STAGED
 * eight-hour race the stories are told with: fourteen LMGT3s, ours fourth.
 * The channel carries what the real forecast processor makes of the staged
 * cars; nothing here was recorded, because no recording has a stop.
 */

const ALL_SESSIONS = {
  race: true,
  loneQualify: true,
  openQualify: true,
  practice: true,
  offlineTesting: true,
};

/** The channels the widget asked for since it was last shown. */
let subscribed: string[] = [];

/** A bridge that answers each subscription once, with the staged snapshot. */
const stubBridge = (snapshots: Partial<ChannelPayloads>): ChannelBridge => ({
  subscribe: <K extends ChannelName>(
    channel: K,
    callback: (payload: ChannelPayloads[K]) => void
  ) => {
    subscribed.push(channel);
    const snapshot = snapshots[channel];
    if (snapshot !== undefined) callback(snapshot as ChannelPayloads[K]);
    return () => undefined;
  },
});

const show = (
  stage: StrategyStage = {},
  config: Partial<ClassRivalsConfig> = {},
  snapshots: Partial<ChannelPayloads> = {}
) => {
  const staged = strategyStage(stage);
  subscribed = [];
  window.channelBridge = stubBridge({ ...staged.snapshots, ...snapshots });
  useSessionStore.setState({ session: staged.session });
  vi.mocked(useDashboard).mockReturnValue({
    currentDashboard: { widgets: [{ id: 'classrivals', config }] },
  } as unknown as ReturnType<typeof useDashboard>);
  return render(<ClassRivals />);
};

const rows = () => screen.getAllByTestId('class-rival');

/** The row of a car, by its number. */
const rowOf = (carNumber: string): HTMLElement => {
  const slot = String(strategySlotOf(carNumber));
  const row = rows().find((entry) => entry.dataset.car === slot);
  if (!row) throw new Error(`no row for #${carNumber}`);
  return row;
};

/** A cell of a row, as written. */
const cell = (row: HTMLElement, name: string): string =>
  within(row).getByTestId(`class-rival-${name}`).textContent ?? '';

/** What a row says of its tyres: the laps on the set, and the tread. */
const tyres = (carNumber: string) => {
  const row = within(rowOf(carNumber));
  return {
    laps: row.getByTestId('class-rival-tyre-laps').textContent,
    tread: row.queryByTestId('class-rival-tyre-tread')?.textContent ?? null,
    compound:
      row.getByTestId('class-rival-tyres').querySelector('svg, span span') !==
      null,
  };
};

/** What a row says, cell by cell. */
const cells = (carNumber: string) => {
  const row = rowOf(carNumber);
  return {
    gap: cell(row, 'gap'),
    stops: cell(row, 'stops'),
    lastStop: cell(row, 'last-stop'),
    since: cell(row, 'since'),
    next: cell(row, 'next'),
    netGap: cell(row, 'net-gap'),
    pace: cell(row, 'pace'),
  };
};

describe('ClassRivals (staged)', () => {
  beforeEach(() => {
    vi.mocked(useDashboard).mockReset();
  });

  it('lists the whole class in the order of its places, ours among them', () => {
    show();
    expect(screen.getByTestId('class-rivals')).toHaveAttribute(
      'data-valid',
      'true'
    );
    expect(rows()).toHaveLength(14);
    expect(
      rows().map((row) => within(row).getByTestId('class-label').textContent)
    ).toEqual([
      '#33',
      '#46',
      '#91',
      '#77',
      '#54',
      '#23',
      '#85',
      '#31',
      '#60',
      '#27',
      '#92',
      '#10',
      '#61',
      '#88',
    ]);
    expect(rows().filter((row) => row.dataset.own === 'true')).toHaveLength(1);
    expect(rowOf('77')).toHaveAttribute('data-own', 'true');
    expect(rowOf('77')).toHaveTextContent('M. Ivanov');
    expect(rowOf('33')).toHaveTextContent('L. Hartmann');
  });

  it('names the columns', () => {
    show();
    expect(screen.getByTestId('class-rivals-captions')).toHaveTextContent(
      'P#DriverGapStopsLast stopSinceTyresNextNet gapPace 5'
    );
  });

  it('writes a rival ahead that we are slower than, and stay behind', () => {
    show();
    expect(cells('33')).toEqual({
      gap: '-34.3',
      stops: '4',
      lastStop: 'lap 128 · 70 s',
      since: '12',
      next: '~lap 160',
      netGap: '-25.3',
      pace: '-0.28',
    });
    const row = rowOf('33');
    expect(within(row).getByTestId('class-rival-net-gap')).toHaveAttribute(
      'data-tone',
      'bad'
    );
    expect(within(row).getByTestId('class-rival-pace')).toHaveAttribute(
      'data-tone',
      'bad'
    );
  });

  it('writes a rival that owes a stop more, and ends behind us', () => {
    show();
    expect(cells('91')).toMatchObject({
      gap: '-12.4',
      next: '~lap 159',
      netGap: '+13.6',
      pace: '+0.31',
    });
    const row = rowOf('91');
    expect(within(row).getByTestId('class-rival-net-gap')).toHaveAttribute(
      'data-tone',
      'good'
    );
    expect(within(row).getByTestId('class-rival-pace')).toHaveAttribute(
      'data-tone',
      'good'
    );
  });

  it('writes our own row: us, our pit window and our own mean of five', () => {
    show();
    expect(cells('77')).toEqual({
      gap: 'us',
      stops: '4',
      lastStop: 'lap 123 · 58 s',
      since: '17',
      next: 'laps 154–157',
      netGap: 'us',
      pace: '1:54.402',
    });
  });

  it('says a car is in the pits now', () => {
    show();
    expect(cells('23')).toMatchObject({
      gap: '+23.9',
      stops: '5',
      lastStop: 'in the pits now',
      since: '0',
    });
  });

  it('writes a gap of a minute and more in minutes', () => {
    show();
    expect(cells('92').gap).toBe('+2:11');
    expect(cells('88').netGap).toBe('+5:50');
  });

  it('explains its two forecast columns, and the marks in Tyres', () => {
    show();
    expect(screen.getByTestId('class-rivals-legend')).toHaveTextContent(
      'Net gap: the gap once both cars have made the stops they still owe, with no extra time added to a stop. Pace 5: their mean of five clean laps against ours; green means we are faster. Tyres: laps on the set (? told from the length of a stop, + at least that many) and the tread left, from our own wear. ~ marks an estimate.'
    );
  });

  describe('the tyres of each car', () => {
    it('are the compound, the laps on the set and an estimate of the tread', () => {
      show();
      // Seen to go on twelve laps ago: 0.8 % a lap of our own wear.
      expect(tyres('33')).toEqual({
        laps: '12',
        tread: '~90%',
        compound: true,
      });
    });

    it('mark laps told from the length of a stop, and laps that are a floor', () => {
      show();
      expect(tyres('46')).toMatchObject({ laps: '13?', tread: '~90%' });
      // Through a stop on the same set: its stint and the one before.
      expect(tyres('54')).toMatchObject({ laps: '47?', tread: '~62%' });
      // At least fifteen laps, so no more than about 88 %.
      expect(tyres('85')).toMatchObject({ laps: '15+', tread: '<88%' });
      // In its box now: what goes on is not known yet.
      expect(tyres('23')).toMatchObject({ laps: '0+', tread: '<100%' });
    });

    it('read -- for a compound our own car has not run', () => {
      show();
      expect(tyres('91')).toMatchObject({ laps: '9', tread: '--' });
      // Mediums at the front and softs at the rear.
      expect(tyres('10')).toMatchObject({ laps: '18+', tread: '--' });
    });

    it('are our own car’s real tread, without a mark', () => {
      show();
      // The mean of 84.2, 85.1, 88.4 and 89.
      expect(tyres('77')).toMatchObject({ laps: '17', tread: '87%' });
    });

    it('say what each figure is to whoever points at it', () => {
      show();
      expect(
        within(rowOf('85')).getByTestId('class-rival-tyres')
      ).toHaveAttribute(
        'title',
        'At least 15 laps on this set: what it was given before that was not seen; no more than about 88% of the tread left, at what a lap costs our own car.'
      );
    });

    it('are an estimate for our own car too, while a team-mate drives it unread', () => {
      show({ teamMate: 'Andrei Petrov' });
      expect(tyres('77')).toMatchObject({ laps: '17', tread: '~86%' });
    });
  });

  describe('a row whose stops are assumed', () => {
    it('is drawn fainter where it forecasts, with a ~ on its net gap', () => {
      show({ rivals: 'assumed' });
      const row = rowOf('54');
      expect(row).toHaveAttribute('data-assumed', 'true');
      expect(cell(row, 'net-gap')).toBe('~+13.5');
      expect(within(row).getByTestId('class-rival-net-gap')).toHaveClass(
        'opacity-60'
      );
      expect(within(row).getByTestId('class-rival-next')).toHaveClass(
        'opacity-60'
      );
      // A car whose stint was seen is not.
      expect(rowOf('33')).toHaveAttribute('data-assumed', 'false');
      expect(cell(rowOf('33'), 'net-gap')).toBe('-25.3');
    });
  });

  describe('while the own car’s stops are not known', () => {
    it('reads -- for every net gap, and for our next stop', () => {
      // A team-mate in a car on fuel: nothing of its tank is sent.
      show({ teamMate: 'Andrei Petrov', fuelCar: true });
      expect(cells('77')).toMatchObject({ next: '--', netGap: 'us' });
      expect(cells('33')).toMatchObject({
        gap: '-34.3',
        next: '~lap 160',
        netGap: '--',
        pace: '-0.28',
      });
      // The driver the session names is the one at the wheel.
      expect(rowOf('77')).toHaveTextContent('A. Petrov');
    });
  });

  describe('under iRacing', () => {
    it('names each next stop from the stints the car has been seen to drive', () => {
      show({ iracing: true });
      expect(cells('33')).toMatchObject({ next: '~lap 160', netGap: '-25.3' });
      expect(rowOf('33')).toHaveAttribute('data-assumed', 'false');
    });

    it('shows the laps on the set and leaves the tread out', () => {
      show({ iracing: true });
      // No tread is read that a figure could be made from, for any car.
      expect(tyres('33')).toEqual({ laps: '12', tread: null, compound: true });
      // No rates to hold a stop against: at least the laps since it.
      expect(tyres('46')).toMatchObject({ laps: '13+', tread: null });
      expect(tyres('77')).toMatchObject({ laps: '17', tread: null });
      expect(screen.getByTestId('class-rivals-legend')).toHaveTextContent(
        /at least that many\)\. ~ marks an estimate\.$/
      );
    });
  });

  describe('its settings', () => {
    it('cuts the list to a number of cars each side', () => {
      show({}, { carsAhead: 2, carsBehind: 1 });
      expect(
        rows().map((row) => within(row).getByTestId('class-label').textContent)
      ).toEqual(['#46', '#91', '#77', '#54']);
    });

    it('takes a count it was never offered as the nearest it has', () => {
      show({}, {
        carsAhead: 1.4,
        carsBehind: 99,
      } as Partial<ClassRivalsConfig>);
      expect(rows()[0]).toBe(rowOf('91'));
      // Ten behind is the most; the class has ten behind us.
      expect(rows()).toHaveLength(12);
    });

    it('leaves out the columns that are switched off, and the legend', () => {
      show(
        {},
        {
          showStops: false,
          showTyres: false,
          showNextStop: false,
          showNetGap: false,
          showPace: false,
          showLegend: false,
        }
      );
      expect(screen.getByTestId('class-rivals-captions')).toHaveTextContent(
        /^P#DriverGap$/
      );
      const row = rowOf('33');
      for (const name of [
        'stops',
        'last-stop',
        'since',
        'tyres',
        'next',
        'net-gap',
      ]) {
        expect(within(row).queryByTestId(`class-rival-${name}`)).toBeNull();
      }
      expect(within(row).queryByTestId('class-rival-pace')).toBeNull();
      expect(cell(row, 'gap')).toBe('-34.3');
      expect(screen.queryByTestId('class-rivals-legend')).toBeNull();
    });

    it('explains only the columns it shows', () => {
      show({}, { showPace: false, showTyres: false });
      expect(screen.getByTestId('class-rivals-legend')).toHaveTextContent(
        /^Net gap: the gap once both cars have made the stops they still owe, with no extra time added to a stop\. ~ marks an estimate\.$/
      );
    });

    it('reads the tyres only while their column is on, so that no race is recorded for it', () => {
      show();
      expect(subscribed).toContain('class-tyres.snapshot');

      show({}, { showTyres: false });
      expect(subscribed).not.toContain('class-tyres.snapshot');
      expect(subscribed).toContain('race-forecast.snapshot');
    });

    it('shows the tyres to a profile saved before there was such a column', () => {
      // No `showTyres` in the saved config: on, as a new one has it.
      show({}, { showStops: true, showLegend: false });
      expect(screen.getByTestId('class-rivals-captions')).toHaveTextContent(
        'Tyres'
      );
      expect(tyres('33').laps).toBe('12');
    });

    it('hides in a session it is not set to show in', () => {
      const { container } = show({ session: 'practice' });
      expect(container).toBeEmptyDOMElement();
    });

    it('hides off track when asked to', () => {
      const staged = strategyStage();
      const trackState = staged.snapshots['track-state.snapshot'];
      if (!trackState) throw new Error('the stage has no track state');
      const { container } = show(
        {},
        { showOnlyWhenOnTrack: true },
        { 'track-state.snapshot': { ...trackState, isInGarage: true } }
      );
      expect(container).toBeEmptyDOMElement();
    });
  });

  describe('when there is nothing to forecast', () => {
    it('says it is waiting for the green flag', () => {
      show({ session: 'grid' });
      expect(screen.getByTestId('class-rivals')).toHaveAttribute(
        'data-valid',
        'false'
      );
      expect(screen.getByTestId('class-rivals-reason')).toHaveTextContent(
        'Waiting for the green flag.'
      );
      expect(screen.queryByTestId('class-rivals-captions')).toBeNull();
    });

    it('says the session is not a race, where it is set to show in one', () => {
      show({ session: 'practice' }, { sessionVisibility: ALL_SESSIONS });
      expect(screen.getByTestId('class-rivals-reason')).toHaveTextContent(
        'A forecast needs a race: this session is not one.'
      );
    });
  });
});
