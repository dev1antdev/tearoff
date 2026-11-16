import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  useDashboard,
  useDrivingState,
  useSessionVisibility,
  useTrackProfileSnapshot,
  useTrackStateSelector,
} from '@irdashies/context';
import type {
  TrackNote,
  TrackNotesConfig,
  TrackProfileSnapshot,
  TrackStateSnapshot,
} from '@irdashies/types';
import { TrackNotes } from './TrackNotes';

vi.mock('@irdashies/context', () => ({
  trackStateSelectors: {
    displayUnits: (snapshot: TrackStateSnapshot) => snapshot.displayUnits,
  },
  useDashboard: vi.fn(),
  useDrivingState: vi.fn(),
  useSessionVisibility: vi.fn(),
  useTrackProfileSnapshot: vi.fn(),
  useTrackStateSelector: vi.fn(),
}));

const TRACK_LENGTH_M = 3590;

const note = (
  distanceM: number,
  text: string,
  extra: Partial<TrackNote> = {}
): TrackNote => ({
  id: `${extra.kind ?? 'track'}-${distanceM}${extra.pit ? '-pit' : ''}`,
  distanceM,
  kind: 'track',
  text,
  comment: '',
  pit: false,
  ...extra,
});

const NOTES: TrackNote[] = [
  note(60, 'Pit exit: stay right', { pit: true }),
  note(100, 'Turn 1'),
  note(700, 'Brake at the bridge', {
    kind: 'pace',
    comment: 'Blind crest\nTrail the brake in',
  }),
  note(900, 'Turn 2', { comment: 'Late apex' }),
  note(2800, 'Flat over the crest', { kind: 'pace' }),
  note(3000, 'Turn 3'),
];

const profile = (
  extra: Partial<TrackProfileSnapshot> = {}
): TrackProfileSnapshot => ({
  trackKey: 'lmu:694510461',
  trackLengthM: TRACK_LENGTH_M,
  elevationM: [],
  lineElevationM: 0,
  elevationRangeM: 0,
  elevationSource: null,
  recordingProgress: null,
  sectorStartPct: [],
  notes: NOTES,
  sessionNum: 0,
  version: 1,
  ...extra,
});

interface Car {
  /** Metres into the lap. */
  at: number;
  speed?: number;
  onPitRoad?: boolean;
  isInGarage?: boolean;
  displayUnits?: number;
  /** The car the camera is on, and where it is. */
  focusAt?: number;
  focusOnPitRoad?: boolean;
  watchingOwnCar?: boolean;
}

const trackState = ({
  at,
  speed = 50,
  onPitRoad = false,
  isInGarage = false,
  displayUnits = 1,
  focusAt,
  focusOnPitRoad = false,
  watchingOwnCar = false,
}: Car): TrackStateSnapshot =>
  ({
    focusCarIdx: 1,
    carIdxLapDistPct: [at / TRACK_LENGTH_M, (focusAt ?? at) / TRACK_LENGTH_M],
    carIdxOnPitRoad: [onPitRoad, focusOnPitRoad],
    lapDistPct: at / TRACK_LENGTH_M,
    speed,
    onPitRoad,
    isInGarage,
    displayUnits,
    watchingOwnCar,
  }) as unknown as TrackStateSnapshot;

interface Scene {
  config?: Partial<TrackNotesConfig>;
  /** What the profile channel holds; null before it has answered. */
  snapshot?: TrackProfileSnapshot | null;
  isDriving?: boolean;
  isWatching?: boolean;
  sessionVisible?: boolean;
  isDemoMode?: boolean;
}

describe('TrackNotes', () => {
  /** Where the car is: read by the widget's own selector, as the store would. */
  let car: TrackStateSnapshot;

  const show = (
    at: Car,
    {
      config = {},
      snapshot = profile(),
      isDriving = true,
      isWatching = false,
      sessionVisible = true,
      isDemoMode = false,
    }: Scene = {}
  ) => {
    car = trackState(at);
    vi.mocked(useDashboard).mockReturnValue({
      currentDashboard: { widgets: [{ id: 'tracknotes', config }] },
      isDemoMode,
    } as unknown as ReturnType<typeof useDashboard>);
    vi.mocked(useDrivingState).mockReturnValue({
      isDriving,
      isWatching,
      isWatchingOwnCar: false,
      isWatchingOtherCar: isWatching,
    });
    vi.mocked(useSessionVisibility).mockReturnValue(sessionVisible);
    vi.mocked(useTrackProfileSnapshot).mockReturnValue(snapshot ?? undefined);
    vi.mocked(useTrackStateSelector).mockImplementation(((
      selector: (snapshot: TrackStateSnapshot) => unknown,
      options?: { enabled?: boolean }
    ) => (options?.enabled === false ? undefined : selector(car))) as never);
    return render(<TrackNotes />);
  };

  /** Moves the car and draws the widget again, as a new selection would. */
  const move = (rerender: (ui: React.ReactElement) => void, at: Car): void => {
    car = trackState(at);
    rerender(<TrackNotes />);
  };

  const line = (kind: 'pace' | 'track' | 'pit') =>
    screen.queryByTestId(`track-notes-${kind}`);
  const lines = (kind: 'pace' | 'track' | 'pit') =>
    screen
      .queryAllByTestId(`track-notes-${kind}`)
      .map((element) => element.textContent);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('on track', () => {
    it('shows the pace note and the track note for where the car is', () => {
      show({ at: 950 });

      expect(line('pace')).toHaveTextContent('Brake at the bridge');
      expect(line('track')).toHaveTextContent('Turn 2');
      // The pace note is the large line, the track note the small one.
      expect(line('pace')?.className).toContain('text-lg');
      expect(line('track')?.className).toContain('text-sm');
    });

    it('carries the last note of the lap over the line', () => {
      show({ at: 40 });

      expect(line('track')).toHaveTextContent('Turn 3');
      expect(line('pace')).toHaveTextContent('Flat over the crest');
    });

    it('changes note when the car reaches the next one', () => {
      const { rerender } = show({ at: 899 });
      expect(line('track')).toHaveTextContent('Turn 1');

      move(rerender, { at: 901 });
      expect(line('track')).toHaveTextContent('Turn 2');
    });

    it('shows pace notes early by the lead in metres and in seconds', () => {
      // 2,601 m, with 100 m and two seconds at 50 m/s: 2,801 m.
      show(
        { at: 2601, speed: 50 },
        { config: { paceLeadMeters: 100, paceLeadSeconds: 2 } }
      );

      expect(line('pace')).toHaveTextContent('Flat over the crest');
      // The track note is for where the car is.
      expect(line('track')).toHaveTextContent('Turn 2');
    });

    it('gives the track note the large line when it is the only one', () => {
      show({ at: 950 }, { config: { showPaceNotes: false } });

      expect(line('pace')).toBeNull();
      expect(line('track')?.className).toContain('text-lg');
    });

    it('leaves the track notes out when switched off', () => {
      show({ at: 950 }, { config: { showTrackNotes: false } });

      expect(line('track')).toBeNull();
      expect(line('pace')).toHaveTextContent('Brake at the bridge');
    });

    it('draws no line for a kind with no notes', () => {
      show(
        { at: 950 },
        { snapshot: profile({ notes: [note(100, 'Turn 1')] }) }
      );

      expect(line('pace')).toBeNull();
      expect(line('track')).toHaveTextContent('Turn 1');
    });

    it('draws no line for a note with nothing written in it', () => {
      show(
        { at: 950 },
        {
          snapshot: profile({
            notes: [note(100, ''), note(700, 'Brake', { kind: 'pace' })],
          }),
        }
      );

      expect(line('track')).toBeNull();
      expect(line('pace')).toHaveTextContent('Brake');
    });

    it('draws the text in capitals when set to', () => {
      show({ at: 950 }, { config: { uppercase: true } });

      expect(line('pace')?.querySelector('span')?.className).toContain(
        'uppercase'
      );
    });
  });

  describe('the comment and the distance to the next note', () => {
    it('are left out by default', () => {
      show({ at: 950 });

      expect(screen.queryByTestId('track-notes-comment')).toBeNull();
      expect(line('pace')).toHaveTextContent(/^Brake at the bridge$/);
    });

    it('shows the comment of the first line, with its line breaks', () => {
      show({ at: 950 }, { config: { showComment: true } });

      const comment = screen.getByTestId('track-notes-comment');
      expect(comment.textContent).toBe('Blind crest\nTrail the brake in');
      expect(comment.className).toContain('whitespace-pre-line');
      expect(comment.className).toContain('line-clamp-3');
    });

    it('shows the comment of the track note when it is the first line', () => {
      show(
        { at: 950 },
        { config: { showComment: true, showPaceNotes: false } }
      );

      expect(screen.getByTestId('track-notes-comment')).toHaveTextContent(
        'Late apex'
      );
    });

    it('counts down to the next note of the first line, in tens of metres', () => {
      const { rerender } = show(
        { at: 954 },
        { config: { showNextDistance: true } }
      );
      // The next pace note is at 2,800 m: 1,846 m on.
      expect(line('pace')).toHaveTextContent('Brake at the bridge1850 m');
      expect(line('track')).toHaveTextContent(/^Turn 2$/);

      move(rerender, { at: 2562 });
      expect(line('pace')).toHaveTextContent('Brake at the bridge240 m');
    });

    it('counts in feet where the driver reads feet', () => {
      show(
        { at: 2560, displayUnits: 0 },
        { config: { showNextDistance: true } }
      );

      // 240 m.
      expect(line('pace')).toHaveTextContent('Brake at the bridge790 ft');
    });

    it('has nothing to count down to with one note of a kind', () => {
      show(
        { at: 950 },
        {
          config: { showNextDistance: true },
          snapshot: profile({ notes: [note(100, 'Turn 1')] }),
        }
      );

      expect(line('track')).toHaveTextContent(/^Turn 1$/);
    });
  });

  describe('on pit road', () => {
    it('swaps to the notes written for the pits', () => {
      const { rerender } = show({ at: 80 });
      expect(lines('track')).toEqual(['Turn 3']);

      move(rerender, { at: 80, onPitRoad: true });
      expect(lines('pit')).toEqual(['Pit exit: stay right']);
      expect(line('track')).toBeNull();
      expect(line('pace')).toBeNull();
      expect(line('pit')?.className).toContain('text-amber-300');
    });

    it('says "Pit lane" on a track with no note for them', () => {
      show(
        { at: 80, onPitRoad: true },
        { snapshot: profile({ notes: [note(100, 'Turn 1')] }) }
      );

      expect(lines('pit')).toEqual(['Pit lane']);
      expect(line('track')).toBeNull();
    });

    it('keeps to the on-track notes when pit notes are switched off', () => {
      show({ at: 80, onPitRoad: true }, { config: { showPitNotes: false } });

      expect(line('pit')).toBeNull();
      expect(line('track')).toHaveTextContent('Turn 3');
    });

    it('goes back to the on-track notes at the pit exit', () => {
      const { rerender } = show({ at: 80, onPitRoad: true });
      expect(lines('pit')).toEqual(['Pit exit: stay right']);

      move(rerender, { at: 120 });
      expect(line('pit')).toBeNull();
      expect(line('track')).toHaveTextContent('Turn 1');
    });
  });

  describe('for a set time', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    it('hides a note three seconds after it appeared, and shows the next', () => {
      const { rerender } = show(
        { at: 950 },
        { config: { displaySeconds: 3, showPaceNotes: false } }
      );
      expect(line('track')).toHaveTextContent('Turn 2');

      act(() => vi.advanceTimersByTime(2900));
      expect(line('track')).toHaveTextContent('Turn 2');
      act(() => vi.advanceTimersByTime(100));
      expect(line('track')).toBeNull();

      // Still gone further round the lap, until the next note is reached.
      move(rerender, { at: 2000 });
      expect(line('track')).toBeNull();
      move(rerender, { at: 3001 });
      expect(line('track')).toHaveTextContent('Turn 3');

      act(() => vi.advanceTimersByTime(3000));
      expect(line('track')).toBeNull();
    });

    it('times each line by its own note', () => {
      const { rerender } = show({ at: 750 }, { config: { displaySeconds: 3 } });
      expect(line('pace')).toHaveTextContent('Brake at the bridge');
      expect(line('track')).toHaveTextContent('Turn 1');
      act(() => vi.advanceTimersByTime(2000));

      // A new track note with a second of the pace note's time left.
      move(rerender, { at: 950 });
      act(() => vi.advanceTimersByTime(1000));
      expect(line('pace')).toBeNull();
      // Its own three seconds are not up: it takes the large line.
      expect(line('track')).toHaveTextContent('Turn 2');
      expect(line('track')?.className).toContain('text-lg');

      act(() => vi.advanceTimersByTime(2000));
      expect(line('track')).toBeNull();
    });

    it('shows a note again when the car comes back to it', () => {
      const { rerender } = show(
        { at: 950 },
        { config: { displaySeconds: 3, showPaceNotes: false } }
      );
      act(() => vi.advanceTimersByTime(3000));
      expect(line('track')).toBeNull();

      move(rerender, { at: 3001 });
      move(rerender, { at: 101 });
      move(rerender, { at: 901 });
      expect(line('track')).toHaveTextContent('Turn 2');
    });

    it('keeps the notes up in the garage however long they have been', () => {
      show(
        { at: 950, isInGarage: true },
        { config: { displaySeconds: 3, showOnlyWhenOnTrack: false } }
      );
      act(() => vi.advanceTimersByTime(60_000));

      expect(line('track')).toHaveTextContent('Turn 2');
      expect(line('pace')).toHaveTextContent('Brake at the bridge');
    });

    it('keeps a note up until the next one when the time is 0', () => {
      show({ at: 950 });
      act(() => vi.advanceTimersByTime(600_000));

      expect(line('track')).toHaveTextContent('Turn 2');
    });
  });

  describe('while a car is being watched', () => {
    it('shows the notes for where that car is', () => {
      show({ at: 950, focusAt: 3100 }, { isDriving: false, isWatching: true });

      expect(line('track')).toHaveTextContent('Turn 3');
      expect(line('pace')).toHaveTextContent('Flat over the crest');
    });

    it('shows the pit notes when that car is on pit road', () => {
      show(
        { at: 950, focusAt: 80, focusOnPitRoad: true },
        { isDriving: false, isWatching: true }
      );

      expect(lines('pit')).toEqual(['Pit exit: stay right']);
    });

    it('adds no lead in seconds for a car whose speed is not known', () => {
      // 2,705 m and two seconds at the user's own 50 m/s would be 2,805 m.
      show(
        { at: 950, focusAt: 2705, speed: 50 },
        {
          isDriving: false,
          isWatching: true,
          config: { paceLeadSeconds: 2 },
        }
      );

      expect(line('pace')).toHaveTextContent('Brake at the bridge');
    });

    it('adds it for the own car with a team-mate at the wheel', () => {
      show(
        { at: 2705, focusAt: 2705, speed: 50, watchingOwnCar: true },
        {
          isDriving: false,
          isWatching: true,
          config: { paceLeadSeconds: 2 },
        }
      );

      expect(line('pace')).toHaveTextContent('Flat over the crest');
    });
  });

  describe('on a track with no notes', () => {
    it('hides', () => {
      const { container } = show(
        { at: 950 },
        { snapshot: profile({ notes: [] }) }
      );

      expect(container).toBeEmptyDOMElement();
    });

    it('says so when set not to hide', () => {
      show(
        { at: 950 },
        {
          snapshot: profile({ notes: [] }),
          config: { hideWhenNoNotes: false },
        }
      );

      expect(screen.getByText('No notes for this track')).toBeInTheDocument();
    });

    it('hides before the channel has answered', () => {
      const { container } = show({ at: 950 }, { snapshot: null });

      expect(container).toBeEmptyDOMElement();
    });

    it('shows a fixed pair in demo mode', () => {
      show(
        { at: 950 },
        { snapshot: profile({ notes: [], trackLengthM: 0 }), isDemoMode: true }
      );

      expect(line('pace')).toHaveTextContent('Brake at the 100 board');
      expect(line('track')).toHaveTextContent('Turn 2');
    });
  });

  describe('visibility', () => {
    it('hides while the player is neither driving nor watching', () => {
      const { container } = show({ at: 950 }, { isDriving: false });

      expect(container).toBeEmptyDOMElement();
      expect(vi.mocked(useTrackProfileSnapshot)).toHaveBeenCalledWith(false);
    });

    it('stays out of the car when set to', () => {
      const { container } = show(
        { at: 950 },
        { config: { showOnlyWhenOnTrack: false }, isDriving: false }
      );

      expect(container).not.toBeEmptyDOMElement();
    });

    it('hides in a session it is switched off for', () => {
      const { container } = show({ at: 950 }, { sessionVisible: false });

      expect(container).toBeEmptyDOMElement();
    });
  });
});
