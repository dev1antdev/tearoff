import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type {
  RaceEvent,
  RaceHistoryBridge,
  RaceLogConfig,
  RaceLogSnapshot,
} from '@irdashies/types';
import { RaceLog } from './RaceLog';

const mocks = vi.hoisted(() => ({
  snapshot: undefined as unknown,
  config: {} as Record<string, unknown>,
  /** The session bar's own car, and the session's. */
  barCarIdx: 2 as number | null | undefined,
  sessionCarIdx: undefined as number | undefined,
  isDriving: true,
  isWatchingOwnCar: false,
  sessionVisible: true,
  warn: vi.fn(),
}));

/** Two classes of two; slot 2, #77, is ours. */
const DRIVERS = [
  { CarIdx: 0, CarNumber: '8', CarClassID: 10, CarClassColor: 0xff000a },
  { CarIdx: 1, CarNumber: '51', CarClassID: 10, CarClassColor: 0xff000a },
  { CarIdx: 2, CarNumber: '77', CarClassID: 30, CarClassColor: 0x0690ff },
  { CarIdx: 3, CarNumber: '92', CarClassID: 30, CarClassColor: 0x0690ff },
];

vi.mock('@irdashies/context', () => ({
  useDashboard: () => ({
    currentDashboard: {
      widgets: [{ id: 'racelog', config: mocks.config }],
    },
  }),
  useRaceLogSnapshot: () => mocks.snapshot,
  useSessionBarSelector: () => mocks.barCarIdx,
  useDriverCarIdx: () => mocks.sessionCarIdx,
  useSessionDrivers: () => DRIVERS,
  useDrivingState: () => ({
    isDriving: mocks.isDriving,
    isWatchingOwnCar: mocks.isWatchingOwnCar,
  }),
  useSessionVisibility: () => mocks.sessionVisible,
}));

vi.mock('@irdashies/utils/logger', () => ({
  default: { warn: mocks.warn, info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

/** 18:00 in the sim, an hour into the session, a minute an event. */
const at = (seq: number) => ({
  seq,
  sessionTime: 3600 + seq * 60,
  timeOfDay: 64_800 + seq * 60,
});

/** One of each kind of line, oldest first. */
const RACE: RaceEvent[] = [
  {
    ...at(1),
    carIdx: null,
    kind: 'flag',
    flag: 'green',
    after: 'start',
    durationS: null,
    late: false,
  },
  {
    ...at(2),
    carIdx: 0,
    kind: 'fastest-lap',
    lap: 3,
    lapTime: 113.604,
    driver: 'D. Gessler',
  },
  { ...at(3), carIdx: 2, kind: 'pit-entry', classPosition: 4 },
  {
    ...at(4),
    carIdx: 2,
    kind: 'pit-exit',
    standingTime: 27.2,
    laneTime: 58.4,
    driverFrom: 'A. Petrov',
    driverTo: 'A. Mercer',
  },
  { ...at(5), carIdx: 3, kind: 'drive-through', laneTime: 24.3 },
  {
    ...at(6),
    carIdx: 1,
    kind: 'penalty',
    change: 'given',
    penalty: 'DT',
    seconds: null,
    pending: 1,
  },
  {
    ...at(7),
    carIdx: null,
    kind: 'flag',
    flag: 'caution',
    after: null,
    durationS: null,
    late: false,
  },
  { ...at(8), carIdx: 3, kind: 'pit-entry', classPosition: 1 },
];

const snapshot = (
  events: readonly RaceEvent[],
  rest: Partial<RaceLogSnapshot> = {}
): RaceLogSnapshot => ({
  raceToken: 'run:1',
  events,
  total: events.length,
  sessionNum: 0,
  version: events.length,
  ...rest,
});

const configure = (config: Partial<RaceLogConfig>) => {
  mocks.config = config as Record<string, unknown>;
};

/** Each line as it reads: the time, the car or the mark, and the text. */
const lines = (): string[] =>
  screen.queryAllByTestId('race-log-row').map((row) => {
    const [time, head, text] = [...row.children];
    const mark = head.querySelector('svg')?.getAttribute('aria-label');
    return [time.textContent, mark ?? head.textContent, text.textContent].join(
      ' | '
    );
  });

const seqs = (): number[] =>
  screen
    .queryAllByTestId('race-log-row')
    .map((row) => Number(row.getAttribute('data-seq')));

const press = (name: string) =>
  fireEvent.click(screen.getByRole('button', { name }));

let bridge: RaceHistoryBridge | undefined;

beforeEach(() => {
  mocks.snapshot = snapshot(RACE);
  mocks.config = {};
  mocks.barCarIdx = 2;
  mocks.sessionCarIdx = undefined;
  mocks.isDriving = true;
  mocks.isWatchingOwnCar = false;
  mocks.sessionVisible = true;
  mocks.warn.mockClear();
  bridge = window.raceHistoryBridge;
});

afterEach(() => {
  window.raceHistoryBridge = bridge;
});

describe('RaceLog', () => {
  it('lists the race newest first: when, who, and what happened', () => {
    render(<RaceLog />);

    expect(lines()).toEqual([
      '18:08 | #92 | into the pits from P1',
      '18:07 | Full-course yellow | Full-course yellow',
      '18:06 | #51 | drive-through penalty',
      '18:05 | #92 | through the pit lane without stopping, 24.3 s',
      '18:04 | #77 | out after 58.4 s, stopped 27.2 s, driver A. Petrov to A. Mercer',
      '18:03 | #77 | into the pits from P4',
      '18:02 | #8 | fastest lap of the class, 1:53.604',
      '18:01 | Green flag | Green flag',
    ]);
  });

  it('writes our own car’s lines in amber, and no other’s', () => {
    render(<RaceLog />);

    const own = screen
      .getAllByTestId('race-log-row')
      .filter((row) => row.getAttribute('data-own') === 'true');
    expect(own.map((row) => row.getAttribute('data-seq'))).toEqual(['4', '3']);
    for (const row of own) {
      // Over the shared number's grey.
      expect(row.querySelector('[data-testid="car-number"]')).toHaveClass(
        'text-amber-300!'
      );
      expect(row.querySelector('[data-testid="race-log-text"]')).toHaveClass(
        'text-amber-300'
      );
    }
    // Another car's number is grey after its class bar, as in the standings.
    const other = screen.getAllByTestId('race-log-row')[0];
    expect(other.querySelector('[data-testid="car-number"]')).toHaveClass(
      'text-slate-400'
    );
    expect(
      other.querySelector('[data-testid="race-log-text"]')
    ).not.toHaveClass('text-amber-300');
  });

  it('takes our car from the session where the session bar has none', () => {
    mocks.barCarIdx = null;
    mocks.sessionCarIdx = 3;
    render(<RaceLog />);

    const own = screen
      .getAllByTestId('race-log-row')
      .filter((row) => row.getAttribute('data-own') === 'true');
    expect(own.map((row) => row.getAttribute('data-seq'))).toEqual(['8', '5']);
  });

  it('puts each car’s number on its class colour', () => {
    render(<RaceLog />);

    const badges = screen.getAllByTestId('car-number');
    // #92 and #77 share a class; #8 is of another.
    expect(badges[0].className).toContain('#0690ff');
    expect(badges[3].className).toContain('#0690ff');
    expect(badges[5].className).toContain('#ff000a');
  });

  it('sets the time of a fastest lap apart, in the colour of a class’s best', () => {
    render(<RaceLog />);

    const lap = screen.getByText('1:53.604');
    expect(lap).toHaveClass('text-purple-400');
    expect(lap.parentElement).toHaveTextContent(
      'fastest lap of the class, 1:53.604'
    );
  });

  it('writes the session clock when asked, and where the sim gave no clock', () => {
    configure({ time: 'session' });
    const { unmount } = render(<RaceLog />);
    expect(lines()[0]).toBe('1:08:00 | #92 | into the pits from P1');
    unmount();

    configure({ time: 'timeOfDay' });
    mocks.snapshot = snapshot(
      RACE.map((event) => ({ ...event, timeOfDay: null }))
    );
    render(<RaceLog />);
    expect(lines()[0]).toBe('1:08:00 | #92 | into the pits from P1');
  });

  it('writes a car the session no longer names without a number', () => {
    mocks.snapshot = snapshot([
      { ...at(1), carIdx: 9, kind: 'pit-entry', classPosition: 2 },
    ]);
    render(<RaceLog />);

    expect(lines()).toEqual(['18:01 | #-- | into the pits from P2']);
  });
});

describe('the switches over the list', () => {
  it('open as the settings say', () => {
    configure({
      scope: 'class',
      kinds: {
        pits: true,
        drivers: false,
        fastestLaps: false,
        flags: true,
        status: false,
      },
    });
    render(<RaceLog />);

    expect(screen.getByRole('button', { name: 'Class' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute(
      'aria-pressed',
      'false'
    );
    expect(screen.getByRole('button', { name: 'Pit stops' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(
      screen.getByRole('button', { name: 'Fastest laps' })
    ).toHaveAttribute('aria-pressed', 'false');
    // Our class's pit stops, and the flags, which are everybody's.
    expect(seqs()).toEqual([8, 7, 5, 4, 3, 1]);
  });

  it('keep the list to our class, or to our car', () => {
    render(<RaceLog />);

    press('Class');
    expect(seqs()).toEqual([8, 7, 5, 4, 3, 1]);

    press('Car');
    expect(seqs()).toEqual([7, 4, 3, 1]);

    press('All');
    expect(seqs()).toEqual([8, 7, 6, 5, 4, 3, 2, 1]);
  });

  it('take a kind of event out of the list, and put it back', () => {
    render(<RaceLog />);

    press('Pit stops');
    // The stop at which the driver changed is a driver change as well.
    expect(seqs()).toEqual([7, 6, 4, 2, 1]);

    press('Driver changes');
    expect(seqs()).toEqual([7, 6, 2, 1]);

    press('Flags and forecast');
    press('Fastest laps');
    expect(seqs()).toEqual([6]);

    press('Cars out, penalties, our place');
    expect(seqs()).toEqual([]);
    expect(screen.getByTestId('race-log-empty')).toHaveTextContent(
      'Nothing of the kinds and cars switched on.'
    );

    press('Pit stops');
    expect(seqs()).toEqual([8, 5, 4, 3]);
  });

  it('are left as they were set while the settings do not change', () => {
    const { rerender } = render(<RaceLog />);
    press('Car');
    press('Fastest laps');

    // The dashboard is read again, as it is whenever anything on it moves:
    // a new object that says the same.
    configure({ scope: 'all' });
    mocks.snapshot = snapshot([
      ...RACE,
      { ...at(9), carIdx: 2, kind: 'position', from: 4, to: 3 },
    ]);
    rerender(<RaceLog />);

    expect(seqs()).toEqual([9, 7, 4, 3, 1]);
  });

  it('go back to the settings when those are changed', () => {
    const { rerender } = render(<RaceLog />);
    press('Car');

    configure({ scope: 'class' });
    rerender(<RaceLog />);

    expect(screen.getByRole('button', { name: 'Class' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(seqs()).toEqual([8, 7, 5, 4, 3, 1]);
  });

  it('are left out when the settings say so, and the list is as set', () => {
    configure({ showFilters: false, scope: 'car' });
    render(<RaceLog />);

    expect(screen.queryByTestId('race-log-filters')).toBeNull();
    expect(seqs()).toEqual([7, 4, 3, 1]);
  });
});

describe('what it says when there is nothing to list', () => {
  it('waits for a session while none is being recorded', () => {
    mocks.snapshot = snapshot([], { raceToken: '', sessionNum: null });
    render(<RaceLog />);

    expect(screen.getByTestId('race-log-empty')).toHaveTextContent(
      'Waiting for a session.'
    );
  });

  it('waits the same before the channel has said anything', () => {
    mocks.snapshot = undefined;
    render(<RaceLog />);

    expect(screen.getByTestId('race-log-empty')).toHaveTextContent(
      'Waiting for a session.'
    );
  });

  it('says a race has nothing to report yet', () => {
    mocks.snapshot = snapshot([]);
    render(<RaceLog />);

    expect(screen.getByTestId('race-log-empty')).toHaveTextContent(
      'Nothing to report yet.'
    );
  });
});

describe('when it is on screen', () => {
  it('is hidden in a session it is not set to show in', () => {
    mocks.sessionVisible = false;
    const { container } = render(<RaceLog />);

    expect(container).toBeEmptyDOMElement();
  });

  it('is hidden off track only when set to be, and stays while a team-mate drives', () => {
    mocks.isDriving = false;
    const shown = render(<RaceLog />);
    expect(shown.container).not.toBeEmptyDOMElement();
    shown.unmount();

    configure({ showOnlyWhenOnTrack: true });
    const hidden = render(<RaceLog />);
    expect(hidden.container).toBeEmptyDOMElement();
    hidden.unmount();

    mocks.isWatchingOwnCar = true;
    const watching = render(<RaceLog />);
    expect(watching.container).not.toBeEmptyDOMElement();
  });
});

describe('a log longer than the channel carries', () => {
  const pit = (seq: number): RaceEvent => ({
    ...at(seq),
    carIdx: seq % 4,
    kind: 'pit-entry',
    classPosition: 1,
  });
  const run = (from: number, to: number) =>
    Array.from({ length: to - from + 1 }, (_, index) => pit(from + index));

  const withBridge = (
    getEvents: RaceHistoryBridge['getEvents']
  ): ReturnType<typeof vi.fn<RaceHistoryBridge['getEvents']>> => {
    const asked = vi.fn(getEvents);
    window.raceHistoryBridge = {
      getEvents: asked,
    } as unknown as RaceHistoryBridge;
    return asked;
  };

  it('offers the events before, and asks for the page before the oldest it holds', async () => {
    const asked = withBridge(async () => run(1, 50));
    mocks.snapshot = snapshot(run(51, 250), { total: 250 });
    render(<RaceLog />);
    expect(seqs()).toHaveLength(200);

    await act(async () => {
      fireEvent.click(screen.getByTestId('race-log-earlier'));
    });

    // The race being recorded, before event 51.
    expect(asked).toHaveBeenCalledExactlyOnceWith(undefined, 51);
    expect(seqs()).toHaveLength(250);
    expect(seqs().at(-1)).toBe(1);
    // All of it is held now: nothing more to offer.
    expect(screen.queryByTestId('race-log-earlier')).toBeNull();
  });

  it('offers nothing when the channel carries the whole log', () => {
    withBridge(async () => []);
    mocks.snapshot = snapshot(run(1, 40), { total: 40 });
    render(<RaceLog />);

    expect(screen.queryByTestId('race-log-earlier')).toBeNull();
  });

  it('offers nothing while no kind of event is switched on', () => {
    withBridge(async () => run(1, 50));
    mocks.snapshot = snapshot(run(51, 250), { total: 250 });
    render(<RaceLog />);
    expect(screen.getByTestId('race-log-earlier')).toBeInTheDocument();

    for (const kind of [
      'Pit stops',
      'Driver changes',
      'Fastest laps',
      'Flags and forecast',
      'Cars out, penalties, our place',
    ]) {
      press(kind);
    }

    // An earlier page would add nothing to a list that lists nothing.
    expect(screen.queryByTestId('race-log-earlier')).toBeNull();
    expect(screen.getByTestId('race-log-empty')).toBeInTheDocument();

    press('Pit stops');
    expect(screen.getByTestId('race-log-earlier')).toBeInTheDocument();
  });

  it('offers nothing where there is no bridge to ask', () => {
    window.raceHistoryBridge = undefined;
    mocks.snapshot = snapshot(run(51, 250), { total: 250 });
    render(<RaceLog />);

    expect(seqs()).toHaveLength(200);
    expect(screen.queryByTestId('race-log-earlier')).toBeNull();
  });

  it('stops offering once a page comes back empty', async () => {
    const asked = withBridge(async () => []);
    // The log says it holds more than it turns out to have before these.
    mocks.snapshot = snapshot(run(51, 250), { total: 300 });
    render(<RaceLog />);

    await act(async () => {
      fireEvent.click(screen.getByTestId('race-log-earlier'));
    });

    expect(asked).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('race-log-earlier')).toBeNull();
  });

  it('says so in the log when the page cannot be read, and offers it again', async () => {
    withBridge(async () => {
      throw new Error('the worker exited');
    });
    mocks.snapshot = snapshot(run(51, 250), { total: 250 });
    render(<RaceLog />);

    await act(async () => {
      fireEvent.click(screen.getByTestId('race-log-earlier'));
    });

    expect(mocks.warn).toHaveBeenCalledTimes(1);
    expect(seqs()).toHaveLength(200);
    expect(screen.getByTestId('race-log-earlier')).toBeEnabled();
  });

  it('keeps what has moved out of the channel while it is on screen', () => {
    mocks.snapshot = snapshot(run(1, 200), { total: 200 });
    const { rerender } = render(<RaceLog />);

    // Five more events: the channel now carries 6 to 205.
    mocks.snapshot = snapshot(run(6, 205), { total: 205 });
    rerender(<RaceLog />);

    expect(seqs()).toHaveLength(205);
    expect([seqs()[0], seqs().at(-1)]).toEqual([205, 1]);
  });

  it('drops everything when another race begins', () => {
    mocks.snapshot = snapshot(run(1, 200), { total: 200 });
    const { rerender } = render(<RaceLog />);

    mocks.snapshot = snapshot(run(1, 3), { raceToken: 'run:2', total: 3 });
    rerender(<RaceLog />);

    expect(seqs()).toEqual([3, 2, 1]);
  });
});

describe('a reader who has scrolled down', () => {
  /** jsdom lays nothing out: every list is given a height a line. */
  const LINE_PX = 20;
  beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
      configurable: true,
      get(this: HTMLElement) {
        return (
          this.querySelectorAll('[data-testid="race-log-row"]').length * LINE_PX
        );
      },
    });
  });
  afterEach(() => {
    Reflect.deleteProperty(HTMLElement.prototype, 'scrollHeight');
  });
  const laidOut = () => screen.getByTestId('race-log-list');

  const more = (count: number) => [
    ...RACE,
    ...Array.from({ length: count }, (_, index): RaceEvent => ({
      ...at(9 + index),
      carIdx: 0,
      kind: 'pit-entry',
      classPosition: 2,
    })),
  ];

  it('is left where they were when lines arrive, and told how many', () => {
    const { rerender } = render(<RaceLog />);
    const list = laidOut();
    list.scrollTop = 60;
    fireEvent.scroll(list);

    mocks.snapshot = snapshot(more(3));
    rerender(<RaceLog />);

    // Three lines taller at the top, and three lines further down.
    expect(list.scrollTop).toBe(60 + 3 * LINE_PX);
    expect(screen.getByTestId('race-log-unseen')).toHaveTextContent('3 new');

    mocks.snapshot = snapshot(more(5));
    rerender(<RaceLog />);
    expect(list.scrollTop).toBe(60 + 5 * LINE_PX);
    expect(screen.getByTestId('race-log-unseen')).toHaveTextContent('5 new');
  });

  it('is taken back to the newest line by the count, which then goes', () => {
    const { rerender } = render(<RaceLog />);
    const list = laidOut();
    list.scrollTop = 60;
    mocks.snapshot = snapshot(more(2));
    rerender(<RaceLog />);

    fireEvent.click(screen.getByTestId('race-log-unseen'));

    expect(list.scrollTop).toBe(0);
    expect(screen.queryByTestId('race-log-unseen')).toBeNull();
  });

  it('loses the count by scrolling back to the top themselves', () => {
    const { rerender } = render(<RaceLog />);
    const list = laidOut();
    list.scrollTop = 60;
    mocks.snapshot = snapshot(more(2));
    rerender(<RaceLog />);
    expect(screen.getByTestId('race-log-unseen')).toBeInTheDocument();

    list.scrollTop = 0;
    fireEvent.scroll(list);

    expect(screen.queryByTestId('race-log-unseen')).toBeNull();
  });

  it('at the top simply sees the new lines arrive', () => {
    const { rerender } = render(<RaceLog />);
    const list = laidOut();

    mocks.snapshot = snapshot(more(3));
    rerender(<RaceLog />);

    expect(list.scrollTop).toBe(0);
    expect(screen.queryByTestId('race-log-unseen')).toBeNull();
    expect(seqs()[0]).toBe(11);
  });

  it('starts from the top of another list when a switch is set', () => {
    render(<RaceLog />);
    const list = laidOut();
    list.scrollTop = 60;
    fireEvent.scroll(list);

    press('Class');

    expect(list.scrollTop).toBe(0);
  });
});
