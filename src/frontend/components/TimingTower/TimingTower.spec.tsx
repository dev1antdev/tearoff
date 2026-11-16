import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getWidgetDefaultConfig,
  type ChannelBridge,
  type ChannelPayloads,
  type Session,
  type TimingTowerConfig,
} from '@irdashies/types';
import { useLapTimesStore, useSessionStore } from '@irdashies/context';
import { singleClassGrid } from '../../../../.storybook/lmuEnduranceGrid';
import {
  timingTowerGrid,
  timingTowerRace,
} from '../../../../.storybook/timingTowerStage';
import { trackStateStorySnapshot } from '../../../../.storybook/trackStateSnapshot';

/**
 * The timing tower as it is drawn: the widget, its rows and cells, the
 * Standings' own rows and gaps, the lap-time store, the pace and sector
 * rules are all the real ones, fed over a stub channel bridge.
 *
 * What it is fed is staged: the eight-hour race of the tower's stories
 * (`.storybook/timingTowerStage.ts`), twenty-two cars in three classes with
 * our #77 fourth in LMGT3. Nothing here is a recording.
 */
const scene = vi.hoisted(() => ({
  config: undefined as unknown,
  snapshots: {} as Record<string, unknown>,
  subscribed: [] as string[],
  /** The width the list measures itself at; 0 is not measured yet. */
  width: 0,
  /** How many times the list was asked to show our own row. */
  shown: 0,
}));

vi.mock('@irdashies/context', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@irdashies/context')>()),
  useDashboard: () => ({
    currentDashboard: {
      widgets: [{ id: 'timingtower', enabled: true, config: scene.config }],
    },
  }),
  // jsdom lays nothing out, so the list has no width of its own.
  useElementSize: () => ({ width: scene.width, height: 0 }),
}));

// The arithmetic of it has a spec of its own; jsdom has no layout to do it
// on, so here it is only counted.
vi.mock('./towerScroll', () => ({
  showOwnRow: () => {
    scene.shown += 1;
  },
}));

import { TimingTower } from './TimingTower';

const DEFAULTS = getWidgetDefaultConfig('timingtower');

const configure = (overrides: Partial<TimingTowerConfig> = {}) => {
  scene.config = { ...DEFAULTS, ...overrides };
};

const stage = (session: Session, snapshots: Partial<ChannelPayloads>): void => {
  useSessionStore.setState({ session });
  scene.snapshots = snapshots;
};

const rows = (container: HTMLElement) =>
  Array.from(container.querySelectorAll<HTMLElement>('tbody tr'));
const cell = (row: HTMLElement | undefined, column: string) =>
  row?.querySelector<HTMLElement>(`[data-column="${column}"]`) ?? null;
const text = (row: HTMLElement | undefined, column: string) =>
  cell(row, column)?.textContent ?? null;
const column = (container: HTMLElement, id: string) =>
  rows(container).map((row) => text(row, id));
const numbers = (container: HTMLElement) =>
  column(container, 'carNumber').map((number) => number?.replace('#', ''));
const rowOf = (container: HTMLElement, number: string) =>
  rows(container).find(
    (row) => text(row, 'carNumber') === `#${number}`
  ) as HTMLElement;
const headers = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('thead th')).map((th) =>
    th.getAttribute('data-column')
  );
const tag = (row: HTMLElement) =>
  row.querySelector('[data-testid="tower-tag"]')?.textContent ?? null;
const marks = (row: HTMLElement) =>
  Array.from(row.querySelectorAll<HTMLElement>('[data-sector]')).map(
    (mark) => mark.dataset.tone
  );
const press = (name: string) =>
  fireEvent.click(screen.getByRole('button', { name }));
const pressed = (name: string) =>
  screen.getByRole('button', { name }).getAttribute('aria-pressed');

const LMGT3 = [
  '33',
  '46',
  '91',
  '77',
  '54',
  '23',
  '85',
  '31',
  '60',
  '27',
  '92',
  '10',
  '61',
  '88',
];
const HYPERCAR = ['7', '12', '50', '94'];
const LMP2 = ['22', '37', '28', '65'];

beforeEach(() => {
  scene.subscribed = [];
  scene.width = 0;
  scene.shown = 0;
  configure();
  stage(timingTowerRace.session, timingTowerRace.snapshots);
  // A bridge of its own for every test: the snapshot stores are kept for
  // each bridge, and would hand a test the snapshots of the one before.
  window.channelBridge = {
    subscribe: (channel: string, callback: (payload: unknown) => void) => {
      scene.subscribed.push(channel);
      const snapshot = scene.snapshots[channel];
      if (snapshot !== undefined) callback(snapshot);
      return () => undefined;
    },
  } as unknown as ChannelBridge;
});

afterEach(() => {
  cleanup();
  useLapTimesStore.getState().reset();
  useSessionStore.setState({ session: null });
  Reflect.deleteProperty(window, 'channelBridge');
});

describe('the list it opens on', () => {
  it('is the class of our own car, in class order, with places in class', () => {
    const { container } = render(<TimingTower />);

    expect(numbers(container)).toEqual(LMGT3);
    expect(column(container, 'position')).toEqual(
      LMGT3.map((_, index) => `${index + 1}`)
    );
    expect(pressed('LMGT3')).toBe('true');
    expect(pressed('All')).toBe('false');
    expect(screen.getByTestId('tower-count').textContent).toBe('14 cars');
  });

  it('marks our own car, which is the session’s and not the camera’s', () => {
    // The camera is on the class leader.
    stage(timingTowerRace.session, {
      ...timingTowerRace.snapshots,
      'standings.snapshot': {
        ...(timingTowerRace.snapshots[
          'standings.snapshot'
        ] as ChannelPayloads['standings.snapshot']),
        focusCarIdx: timingTowerRace.slotOf('33'),
      },
    });

    const { container } = render(<TimingTower />);

    const own = rows(container).filter((row) => row.dataset.own === 'true');
    expect(own).toHaveLength(1);
    expect(text(own[0], 'carNumber')).toBe('#77');
    expect(own[0].className).toContain('text-amber-300');
    expect(rowOf(container, '33').className).not.toContain('text-amber-300');
  });

  it('names every column in the header row, in order', () => {
    const { container } = render(<TimingTower />);

    expect(headers(container)).toEqual([
      'position',
      'carNumber',
      'driver',
      'gap',
      'interval',
      'lastTime',
      'bestTime',
      'avgLast5',
      'avgLast10',
      'stintPace',
      'sectors',
      'pitStops',
      'stintLaps',
      'energy',
      'tyres',
    ]);
    expect(
      Array.from(container.querySelectorAll('thead th')).map(
        (th) => th.textContent
      )
    ).toEqual([
      'P',
      '#',
      'Driver',
      'Gap',
      'Int',
      'Last',
      'Best',
      'Avg 5',
      'Avg 10',
      'vs stint',
      'Sect',
      'Stops',
      'Stint',
      'Energy',
      'Tyres',
    ]);
  });
});

describe('the tabs', () => {
  it('are one a class, in the Standings’ order, and one for all', () => {
    render(<TimingTower />);

    const group = screen.getByRole('group', { name: 'Class' });
    expect(
      Array.from(group.querySelectorAll('button')).map(
        (button) => button.textContent
      )
    ).toEqual(['Hypercar', 'LMP2', 'LMGT3', 'All']);
  });

  it('show another class in its own order, with places and gaps in class', () => {
    const { container } = render(<TimingTower />);

    press('Hypercar');

    expect(numbers(container)).toEqual(HYPERCAR);
    expect(column(container, 'position')).toEqual(['1', '2', '3', '4']);
    expect(column(container, 'gap')).toEqual([
      'Leader',
      '14.2',
      '52.8',
      '1:17',
    ]);
    expect(pressed('Hypercar')).toBe('true');
    expect(pressed('LMGT3')).toBe('false');
    expect(screen.getByTestId('tower-count').textContent).toBe('4 cars');
    // Our car is not of this class.
    expect(container.querySelector('tr[data-own="true"]')).toBeNull();
  });

  it('show the whole field in overall order, with places and gaps overall', () => {
    const { container } = render(<TimingTower />);

    press('All');

    expect(numbers(container)).toEqual([...HYPERCAR, ...LMP2, ...LMGT3]);
    expect(column(container, 'position')).toEqual(
      Array.from({ length: 22 }, (_, index) => `${index + 1}`)
    );
    // The leader of LMGT3 is ninth overall and six laps down on the race.
    const leader = rowOf(container, '33');
    expect(text(leader, 'position')).toBe('9');
    expect(text(leader, 'gap')).toBe('-6L');
    // Its interval is to the last LMP2, three laps up the road.
    expect(text(leader, 'interval')).toBe('-3L');
    // The second LMGT3 is still 8.5 s behind it.
    expect(text(rowOf(container, '46'), 'interval')).toBe('8.5');
    expect(text(rowOf(container, '7'), 'gap')).toBe('Leader');
    expect(screen.getByTestId('tower-count').textContent).toBe('22 cars');
    expect(text(rowOf(container, '77'), 'position')).toBe('12');
  });

  it('go back to a class with its own places', () => {
    const { container } = render(<TimingTower />);

    press('All');
    press('LMP2');

    expect(numbers(container)).toEqual(LMP2);
    expect(column(container, 'position')).toEqual(['1', '2', '3', '4']);
    // More than a lap behind the class leader.
    expect(text(rowOf(container, '65'), 'gap')).toBe('-1L');
  });

  it('are not drawn in a session of one class', () => {
    stage(singleClassGrid.session, {
      'standings.snapshot': singleClassGrid.standings,
      'track-state.snapshot': trackStateStorySnapshot,
    });

    const { container } = render(<TimingTower />);

    expect(screen.queryByRole('group', { name: 'Class' })).toBeNull();
    expect(rows(container)).toHaveLength(24);
    expect(screen.getByTestId('tower-count').textContent).toBe('24 cars');
    // The two switches are still there.
    expect(screen.getByRole('group', { name: 'Averages over' })).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Pace against' })).toBeTruthy();
  });
});

describe('what a row says of its car', () => {
  it('gives the driver in the format set, with the team under', () => {
    const { container } = render(<TimingTower />);
    const own = rowOf(container, '77');

    expect(own.querySelector('[data-testid="tower-name"]')?.textContent).toBe(
      'M. Ivanov'
    );
    expect(own.querySelector('[data-testid="tower-team"]')?.textContent).toBe(
      'Tearoff Endurance'
    );
  });

  it('leaves the team out when set to, and writes the name as set', () => {
    configure({
      driver: {
        enabled: true,
        nameFormat: 'name-surname',
        team: false,
        status: true,
      },
    });

    const { container } = render(<TimingTower />);
    const own = rowOf(container, '77');

    expect(own.querySelector('[data-testid="tower-name"]')?.textContent).toBe(
      'Maxim Ivanov'
    );
    expect(own.querySelector('[data-testid="tower-team"]')).toBeNull();
  });

  it('tags a car in the pit lane, on its out-lap and in its garage', () => {
    const { container } = render(<TimingTower />);

    expect(tag(rowOf(container, '23'))).toBe('PIT');
    expect(tag(rowOf(container, '88'))).toBe('GAR');
    expect(tag(rowOf(container, '77'))).toBeNull();

    press('Hypercar');
    expect(tag(rowOf(container, '94'))).toBe('OUT');
    expect(tag(rowOf(container, '7'))).toBeNull();
  });

  it('has no tags with the status switched off', () => {
    configure({ driver: { ...DEFAULTS.driver, status: false } });

    const { container } = render(<TimingTower />);

    expect(container.querySelector('[data-testid="tower-tag"]')).toBeNull();
  });

  it('prints the last and best lap, with the class’s best in purple', () => {
    const { container } = render(<TimingTower />);

    // #46 holds the best lap of LMGT3 and has just driven it.
    const quickest = rowOf(container, '46');
    expect(text(quickest, 'lastTime')).toBe('3:56.705');
    expect(text(quickest, 'fastestTime')).toBe('3:56.705');
    expect(cell(quickest, 'lastTime')?.className).toContain('text-purple-400');
    expect(cell(quickest, 'fastestTime')?.className).toContain(
      'text-purple-400'
    );
    // #77's last lap is its own best, and not the class's.
    const own = rowOf(container, '77');
    expect(cell(own, 'lastTime')?.className).toContain('text-green-400');
    expect(cell(own, 'fastestTime')?.className).not.toContain(
      'text-purple-400'
    );
  });

  it('marks a last lap the sim gave no time', () => {
    const { container } = render(<TimingTower />);

    expect(cell(rowOf(container, '54'), 'lastTime')?.dataset.invalid).toBe(
      'true'
    );
    expect(
      cell(rowOf(container, '33'), 'lastTime')?.dataset.invalid
    ).toBeUndefined();
  });

  it('gives the stops made and the laps since the last', () => {
    const { container } = render(<TimingTower />);

    expect(text(rowOf(container, '77'), 'pitStops')).toBe('4');
    expect(text(rowOf(container, '77'), 'stintLaps')).toBe('17');
    expect(text(rowOf(container, '23'), 'pitStops')).toBe('5');
    expect(text(rowOf(container, '23'), 'stintLaps')).toBe('0');
  });

  it('gives what the car has left, marking fuel apart from virtual energy', () => {
    const { container } = render(<TimingTower />);

    expect(text(rowOf(container, '77'), 'lmuVirtualEnergy')).toBe('45%');
    expect(
      cell(rowOf(container, '77'), 'lmuVirtualEnergy')?.querySelector('svg')
    ).toBeNull();

    press('LMP2');
    const fuelled = cell(rowOf(container, '22'), 'lmuVirtualEnergy');
    expect(fuelled?.textContent).toBe('42%');
    expect(fuelled?.querySelector('svg')?.getAttribute('aria-label')).toBe(
      'Fuel'
    );
  });

  it('draws three sector marks a car, by the bests of its class', () => {
    const { container } = render(<TimingTower />);

    const tones = rows(container).map(marks);
    expect(tones.every((row) => row.length === 3)).toBe(true);
    // Every sector's best of the class is somebody's most recent time or
    // it is not; no row of a car with laps is without a time.
    expect(tones.flat()).not.toContain('none');
    expect(tones.flat()).toContain('ownBest');
    expect(tones.flat()).toContain('slower');
    for (const tone of tones.flat()) {
      expect(['classBest', 'ownBest', 'slower']).toContain(tone);
    }
  });
});

describe('the pace columns', () => {
  it('average the clean laps as it opens, and all laps at a press', () => {
    const { container } = render(<TimingTower />);
    expect(pressed('Clean laps')).toBe('true');

    press('Hypercar');
    // #50 stopped three laps ago; #7 has not stopped in the laps watched.
    const stoppedClean = text(rowOf(container, '50'), 'avgLast5');
    const steadyClean = text(rowOf(container, '7'), 'avgLast5');
    expect(stoppedClean).toMatch(/^3:\d\d\.\d{3}$/);

    press('All laps');

    expect(pressed('All laps')).toBe('true');
    expect(pressed('Clean laps')).toBe('false');
    // The stop is in the one car's average now, and it is slower for it.
    const stoppedAll = text(rowOf(container, '50'), 'avgLast5');
    expect(stoppedAll).not.toBe(stoppedClean);
    // Both are of the form 3:29.585, which sorts as text as it does as time.
    expect(`${stoppedAll}` > `${stoppedClean}`).toBe(true);
    expect(text(rowOf(container, '7'), 'avgLast5')).toBe(steadyClean);

    press('Clean laps');
    expect(text(rowOf(container, '50'), 'avgLast5')).toBe(stoppedClean);
  });

  it('hold a stint against the one before as it opens', () => {
    const { container } = render(<TimingTower />);

    expect(pressed('Previous stint')).toBe('true');
    const own = cell(rowOf(container, '77'), 'stintPace');
    expect(own?.textContent).toBe('-0.38');
    expect(own?.dataset.tone).toBe('faster');
    const slower = cell(rowOf(container, '60'), 'stintPace');
    expect(slower?.textContent).toBe('+0.74');
    expect(slower?.dataset.tone).toBe('slower');
  });

  it('wait for three clean laps in the stint, and for a stint before it', () => {
    const { container } = render(<TimingTower />);

    // In the pit lane, and in the garage with no stint before.
    expect(text(rowOf(container, '23'), 'stintPace')).toBe('--');
    expect(text(rowOf(container, '88'), 'stintPace')).toBe('--');
    // Four laps since its stop: three of them clean.
    expect(text(rowOf(container, '92'), 'stintPace')).toBe('-0.29');

    press('Hypercar');
    // Three laps since its stop: two clean.
    expect(text(rowOf(container, '50'), 'stintPace')).toBe('--');
    expect(text(rowOf(container, '94'), 'stintPace')).toBe('--');
  });

  it('hold it against the previous driver at a press, which after a double stint is another figure', () => {
    const { container } = render(<TimingTower />);

    press('Previous driver');

    expect(pressed('Previous driver')).toBe('true');
    expect(pressed('Previous stint')).toBe('false');
    // #77 is quicker than its own first half and slower than the team-mate.
    const own = cell(rowOf(container, '77'), 'stintPace');
    expect(own?.textContent).toBe('+0.21');
    expect(own?.dataset.tone).toBe('slower');
    // #33's stint before was already another driver's: the same figure.
    expect(text(rowOf(container, '33'), 'stintPace')).toBe('-0.17');
    // #27 has had one driver all race.
    expect(text(rowOf(container, '27'), 'stintPace')).toBe('--');

    press('Previous stint');
    expect(text(rowOf(container, '77'), 'stintPace')).toBe('-0.38');
    expect(text(rowOf(container, '27'), 'stintPace')).toBe('+0.18');
  });

  it('start both switches from the saved settings', () => {
    configure({ averagesOver: 'all', paceAgainst: 'driver' });

    const { container } = render(<TimingTower />);

    expect(pressed('All laps')).toBe('true');
    expect(pressed('Previous driver')).toBe('true');
    expect(text(rowOf(container, '77'), 'stintPace')).toBe('+0.21');
  });

  it('follow a saved setting that is changed while on screen, past what was pressed', () => {
    const { container, rerender } = render(<TimingTower />);
    press('Previous driver');
    expect(text(rowOf(container, '77'), 'stintPace')).toBe('+0.21');

    // Saved as it already was: what was pressed stands.
    configure({ averagesOver: 'clean' });
    rerender(<TimingTower />);
    expect(pressed('Previous driver')).toBe('true');

    configure({ paceAgainst: 'driver', averagesOver: 'all' });
    rerender(<TimingTower />);
    expect(pressed('All laps')).toBe('true');
    expect(pressed('Previous driver')).toBe('true');

    configure({ paceAgainst: 'stint', averagesOver: 'all' });
    rerender(<TimingTower />);
    expect(pressed('Previous stint')).toBe('true');
    expect(text(rowOf(container, '77'), 'stintPace')).toBe('-0.38');
  });

  it('take a stored value that is neither as the default', () => {
    configure({
      averagesOver: 'everything',
      paceAgainst: 'anybody',
    } as unknown as Partial<TimingTowerConfig>);

    render(<TimingTower />);

    expect(pressed('Clean laps')).toBe('true');
    expect(pressed('Previous stint')).toBe('true');
  });
});

describe('before anybody has completed a lap', () => {
  it('lists the field with nothing made up', () => {
    stage(timingTowerGrid.session, timingTowerGrid.snapshots);

    const { container } = render(<TimingTower />);

    expect(rows(container)).toHaveLength(14);
    for (const id of [
      'lastTime',
      'fastestTime',
      'avgLast5',
      'avgLast10',
      'stintPace',
    ]) {
      expect(new Set(column(container, id)), id).toEqual(new Set(['--']));
    }
    expect(new Set(rows(container).flatMap(marks))).toEqual(new Set(['none']));
    expect(new Set(column(container, 'pitStops'))).toEqual(new Set(['0']));
    expect(container.querySelector('[data-testid="tower-tag"]')).toBeNull();
    expect(container.querySelector('[data-invalid="true"]')).toBeNull();
  });
});

describe('where the sim has less to give', () => {
  it('leaves the sector marks and the energy out under iRacing', () => {
    const standings = timingTowerRace.snapshots[
      'standings.snapshot'
    ] as ChannelPayloads['standings.snapshot'];
    stage(timingTowerRace.session, {
      ...timingTowerRace.snapshots,
      // As iRacing's frames leave them: no budget for any car, and a sector
      // channel that says it has nothing.
      'standings.snapshot': {
        ...standings,
        carIdxEnergyRemaining: [],
        carIdxEnergyIsVirtual: [],
        carIdxWheelCompounds: [],
      },
      'car-sectors.snapshot': {
        available: false,
        current: [],
        last: [],
        best: [],
        classIds: [],
        classBest: [],
        sessionNum: 0,
        version: 1,
      },
    });

    const { container } = render(<TimingTower />);

    expect(headers(container)).toEqual([
      'position',
      'carNumber',
      'driver',
      'gap',
      'interval',
      'lastTime',
      'bestTime',
      'avgLast5',
      'avgLast10',
      'stintPace',
      'pitStops',
      'stintLaps',
      'tyres',
    ]);
    expect(container.querySelector('[data-column="sectors"]')).toBeNull();
    expect(
      container.querySelector('[data-column="lmuVirtualEnergy"]')
    ).toBeNull();
    // The rest is as under Le Mans Ultimate.
    expect(numbers(container)).toEqual(LMGT3);
    expect(text(rowOf(container, '77'), 'stintPace')).toBe('-0.38');
  });

  it('reads -- for stops and stint where the pit tracker has nothing yet', () => {
    const { 'car-pit.snapshot': _carPit, ...rest } = timingTowerRace.snapshots;
    void _carPit;
    stage(timingTowerRace.session, rest);

    const { container } = render(<TimingTower />);

    expect(new Set(column(container, 'pitStops'))).toEqual(new Set(['--']));
    expect(new Set(column(container, 'stintLaps'))).toEqual(new Set(['--']));
  });

  it('draws nothing without a session', () => {
    stage(null as unknown as Session, {});

    const { container } = render(<TimingTower />);

    expect(container.querySelector('[data-testid="timing-tower"]')).toBeNull();
  });
});

describe('the columns that are switched off', () => {
  it('are not drawn, header or cell', () => {
    configure({
      interval: { enabled: false },
      bestTime: { enabled: false },
      tyres: { enabled: false },
    });

    const { container } = render(<TimingTower />);

    expect(headers(container)).toEqual([
      'position',
      'carNumber',
      'driver',
      'gap',
      'lastTime',
      'avgLast5',
      'avgLast10',
      'stintPace',
      'sectors',
      'pitStops',
      'stintLaps',
      'energy',
    ]);
    expect(container.querySelector('td[data-column="interval"]')).toBeNull();
    expect(container.querySelector('td[data-column="fastestTime"]')).toBeNull();
    expect(container.querySelector('td[data-column="tyres"]')).toBeNull();
  });

  it('take their switch out of the header with them', () => {
    configure({
      avgLast5: { enabled: false },
      avgLast10: { enabled: false },
      stintPace: { enabled: false },
    });

    render(<TimingTower />);

    expect(screen.queryByRole('group', { name: 'Averages over' })).toBeNull();
    expect(screen.queryByRole('group', { name: 'Pace against' })).toBeNull();
    expect(screen.getByRole('group', { name: 'Class' })).toBeTruthy();
  });

  it('keep the averages switch while one of the two columns is on', () => {
    configure({ avgLast5: { enabled: false } });

    render(<TimingTower />);

    expect(screen.getByRole('group', { name: 'Averages over' })).toBeTruthy();
  });
});

describe('keeping our own car in view', () => {
  /** The session as it stands, with two cars' places exchanged. */
  const withPlacesExchanged = (a: string, b: string): Session => {
    const session = structuredClone(
      useSessionStore.getState().session as Session
    );
    const results = session.SessionInfo.Sessions[0].ResultsPositions ?? [];
    const first = results.find(
      (row) => row.CarIdx === timingTowerRace.slotOf(a)
    );
    const second = results.find(
      (row) => row.CarIdx === timingTowerRace.slotOf(b)
    );
    if (!first || !second) throw new Error('No such cars in the results');
    [first.CarIdx, second.CarIdx] = [second.CarIdx, first.CarIdx];
    return session;
  };
  const reorder = (a: string, b: string) =>
    act(() => {
      useSessionStore.setState({ session: withPlacesExchanged(a, b) });
    });

  /**
   * Renders the tower and forgets how often our row was shown while it
   * opened: once for the field as the session lists it, and again when
   * the order arrives and puts our car in another row.
   */
  const open = () => {
    const view = render(<TimingTower />);
    expect(scene.shown).toBeGreaterThan(0);
    scene.shown = 0;
    return view;
  };

  it('shows our row when the tower opens and at every change of tab', () => {
    open();

    press('All');
    expect(scene.shown).toBe(1);

    // A list our car is not in is shown from its top by the same call.
    press('Hypercar');
    expect(scene.shown).toBe(2);
  });

  it('shows it again when our car changes place, and not when another does', () => {
    const { container } = open();

    reorder('77', '54');
    expect(numbers(container).indexOf('77')).toBe(4);
    expect(scene.shown).toBe(1);

    reorder('33', '46');
    expect(numbers(container).slice(0, 2)).toEqual(['46', '33']);
    expect(scene.shown).toBe(1);
  });

  it('leaves the list to whoever scrolls it, until they change tab', () => {
    open();

    fireEvent.wheel(screen.getByTestId('tower-scroller'));
    reorder('77', '54');
    expect(scene.shown).toBe(0);

    press('All');
    expect(scene.shown).toBe(1);
    reorder('77', '85');
    expect(scene.shown).toBe(2);
  });

  it.each([
    ['a finger', (list: HTMLElement) => fireEvent.touchMove(list)],
    ['the scrollbar', (list: HTMLElement) => fireEvent.pointerDown(list)],
    ['a key', (list: HTMLElement) => fireEvent.keyDown(list)],
  ])('counts %s as scrolling it', (_how, scroll) => {
    open();

    scroll(screen.getByTestId('tower-scroller'));
    reorder('77', '54');

    expect(scene.shown).toBe(0);
  });
});

describe('on a panel too narrow for every column', () => {
  it('leaves the least important out, header and cell, and keeps the pace', () => {
    // What a Pit Wall panel 560 wide leaves the table.
    scene.width = 524;

    const { container } = render(<TimingTower />);

    expect(headers(container)).toEqual([
      'position',
      'carNumber',
      'driver',
      'gap',
      'lastTime',
      'avgLast5',
      'avgLast10',
      'stintPace',
    ]);
    expect(container.querySelector('td[data-column="sectors"]')).toBeNull();
    expect(container.querySelector('td[data-column="pitStops"]')).toBeNull();
    expect(text(rowOf(container, '77'), 'stintPace')).toBe('-0.38');
    // The switches of the columns that stay are still there.
    expect(screen.getByRole('group', { name: 'Pace against' })).toBeTruthy();
  });

  it('draws every column again on one wide enough', () => {
    scene.width = 524;
    const { container, rerender } = render(<TimingTower />);
    expect(headers(container)).toHaveLength(8);

    scene.width = 900;
    rerender(<TimingTower />);

    expect(headers(container)).toHaveLength(15);
  });
});

describe('what it reads', () => {
  it('is every channel of its columns, with all of them on', () => {
    render(<TimingTower />);

    expect(new Set(scene.subscribed)).toEqual(
      new Set([
        'standings.snapshot',
        'lap-times.snapshot',
        'car-pit.snapshot',
        'car-sectors.snapshot',
        'race-history.summary',
        'track-state.snapshot',
        'radio.snapshot',
      ])
    );
  });

  it('is not the race history with the pace column off, so that no race is recorded for it', () => {
    configure({ stintPace: { enabled: false } });

    render(<TimingTower />);

    expect(scene.subscribed).not.toContain('race-history.summary');
    expect(scene.subscribed).toContain('standings.snapshot');
  });

  it('is not the sectors, the pit tracker or the lap times with their columns off', () => {
    configure({
      sectors: { enabled: false },
      pitStops: { enabled: false },
      stintLaps: { enabled: false },
      avgLast5: { enabled: false },
      avgLast10: { enabled: false },
    });

    render(<TimingTower />);

    expect(scene.subscribed).not.toContain('car-sectors.snapshot');
    expect(scene.subscribed).not.toContain('car-pit.snapshot');
    expect(scene.subscribed).not.toContain('lap-times.snapshot');
    expect(scene.subscribed).toContain('race-history.summary');
  });

  it('keeps the pit tracker for either of its two columns', () => {
    configure({ pitStops: { enabled: false } });

    render(<TimingTower />);

    expect(scene.subscribed).toContain('car-pit.snapshot');
  });

  it('is nothing but where the user is while hidden off track', () => {
    configure({ showOnlyWhenOnTrack: true });
    stage(timingTowerRace.session, {
      ...timingTowerRace.snapshots,
      // Out of the car, at the monitor, watching nobody.
      'track-state.snapshot': {
        ...trackStateStorySnapshot,
        isOnTrack: false,
        outOfCar: true,
      },
    });

    const { container } = render(<TimingTower />);

    expect(container.querySelector('[data-testid="timing-tower"]')).toBeNull();
    expect(new Set(scene.subscribed)).toEqual(
      new Set(['track-state.snapshot'])
    );
  });

  it('is shown off track with that switch off, as on the Pit Wall', () => {
    stage(timingTowerRace.session, {
      ...timingTowerRace.snapshots,
      'track-state.snapshot': {
        ...trackStateStorySnapshot,
        isOnTrack: false,
        outOfCar: true,
      },
    });

    const { container } = render(<TimingTower />);

    expect(rows(container)).toHaveLength(14);
  });
});
