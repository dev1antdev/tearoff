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

/** A bridge that answers each subscription once, with the staged snapshot. */
const stubBridge = (snapshots: Partial<ChannelPayloads>): ChannelBridge => ({
  subscribe: <K extends ChannelName>(
    channel: K,
    callback: (payload: ChannelPayloads[K]) => void
  ) => {
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
      'P#DriverGapStopsLast stopSinceNextNet gapPace 5'
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

  it('explains its two forecast columns', () => {
    show();
    expect(screen.getByTestId('class-rivals-legend')).toHaveTextContent(
      'Net gap: the gap once both cars have made the stops they still owe. Pace 5: their mean of five clean laps against ours; green means we are faster. ~ marks an estimate.'
    );
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
      for (const name of ['stops', 'last-stop', 'since', 'next', 'net-gap']) {
        expect(within(row).queryByTestId(`class-rival-${name}`)).toBeNull();
      }
      expect(within(row).queryByTestId('class-rival-pace')).toBeNull();
      expect(cell(row, 'gap')).toBe('-34.3');
      expect(screen.queryByTestId('class-rivals-legend')).toBeNull();
    });

    it('explains only the columns it shows', () => {
      show({}, { showPace: false });
      expect(screen.getByTestId('class-rivals-legend')).toHaveTextContent(
        /^Net gap: the gap once both cars have made the stops they still owe\. ~ marks an estimate\.$/
      );
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
