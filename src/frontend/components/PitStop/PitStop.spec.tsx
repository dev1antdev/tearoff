import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  useActiveSimulator,
  useCarPitSnapshot,
  useDashboard,
  useDrivingState,
  usePitStopSnapshot,
  useSessionDrivers,
  useSessionVisibility,
  useTrackStateSelector,
  useWeekendInfoNumCarClasses,
} from '@irdashies/context';
import type {
  ActiveSimulator,
  CarPitSnapshot,
  PitLaneModel,
  PitRejoinRival,
  PitStopConfig,
  PitStopParts,
  PitStopSnapshot,
  TrackStateSnapshot,
} from '@irdashies/types';
import { PitStop } from './PitStop';

vi.mock('@irdashies/context', () => ({
  useActiveSimulator: vi.fn(),
  useCarPitSnapshot: vi.fn(),
  useDashboard: vi.fn(),
  useDrivingState: vi.fn(),
  usePitStopSnapshot: vi.fn(),
  useSessionDrivers: vi.fn(),
  useSessionVisibility: vi.fn(),
  useTrackStateSelector: vi.fn(),
  useWeekendInfoNumCarClasses: vi.fn(),
}));

const lane = (values: Partial<PitLaneModel> = {}): PitLaneModel => ({
  entryPct: 0.95,
  exitPct: 0.03,
  lengthM: 287.2,
  speedLimitMs: 16.6,
  speedLimitSource: 'measured',
  driveAtLimitS: 17.3,
  driveMeasuredS: 24.1,
  trackTimeS: 6.9,
  ...values,
});

const parts = (values: Partial<PitStopParts> = {}): PitStopParts => ({
  fuel: 0,
  energy: 0,
  tyres: 0,
  damage: 0,
  driverSwap: 0,
  brakes: 0,
  brakeDucts: 0,
  penalties: 0,
  ...values,
});

const rival = (
  carIdx: number,
  gapS: number,
  values: Partial<PitRejoinRival> = {}
): PitRejoinRival => ({
  carIdx,
  gapS,
  sameClass: true,
  inPit: false,
  ...values,
});

type Estimate = PitStopSnapshot['estimate'];

const estimate = (values: Partial<Estimate> = {}): Estimate => ({
  source: 'sim',
  standingS: 14.2,
  parts: parts({ fuel: 14.2, energy: 9.6 }),
  optionalRepairS: null,
  samples: 0,
  penalty: null,
  ...values,
});

/** Fifth in class in a race, out on the circuit, with stops behind it here. */
const pitStop = (values: Partial<PitStopSnapshot> = {}): PitStopSnapshot => ({
  phase: 'planning',
  requested: false,
  lane: lane(),
  estimate: estimate(),
  planned: null,
  timer: { enteredAt: null, stoppedAt: null, standingS: 0, exitedAt: null },
  last: null,
  refuel: {
    isVirtualEnergy: true,
    target: 85,
    aboard: 21.4,
    toAdd: 63.6,
    toFinish: 41.3,
    runLaps: 36.5,
    runMinutes: 52.7,
  },
  rejoin: {
    position: 19,
    classPosition: 5,
    ladder: [
      rival(1, -6.2),
      rival(5, -1.8, { sameClass: false }),
      rival(2, 5.1),
      rival(6, 11.4, { sameClass: false }),
      rival(3, 19.6),
      rival(4, 44.8),
    ],
    driveToExitS: 52.4,
    passes: [],
  },
  sessionNum: 0,
  version: 1,
  ...values,
});

/** Only what the widget reads of the channel: the counts and who asked. */
const carPit = (requested: boolean[] = [false]): CarPitSnapshot =>
  ({
    requested,
    counts: {
      onTrack: 33,
      inLane: 5,
      standingInLane: 2,
      requested: 3,
      inGarage: 0,
    },
  }) as unknown as CarPitSnapshot;

interface Scene {
  config?: Partial<PitStopConfig>;
  sessionTime?: number;
  isDriving?: boolean;
  isWatchingOwnCar?: boolean;
  isWatchingOtherCar?: boolean;
  sessionVisible?: boolean;
  simulator?: ActiveSimulator;
  pits?: CarPitSnapshot;
}

const show = (
  snapshot: PitStopSnapshot | undefined,
  {
    config = {},
    sessionTime = 50,
    isDriving = true,
    isWatchingOwnCar = false,
    isWatchingOtherCar = false,
    sessionVisible = true,
    simulator = 'lmu',
    pits = carPit(),
  }: Scene = {}
) => {
  vi.mocked(useDashboard).mockReturnValue({
    currentDashboard: { widgets: [{ id: 'pitstop', config }] },
  } as unknown as ReturnType<typeof useDashboard>);
  vi.mocked(usePitStopSnapshot).mockReturnValue(snapshot);
  vi.mocked(useCarPitSnapshot).mockImplementation((enabled = true) =>
    enabled ? pits : undefined
  );
  vi.mocked(useTrackStateSelector).mockImplementation((selector) =>
    selector({ sessionTime } as TrackStateSnapshot)
  );
  vi.mocked(useDrivingState).mockReturnValue({
    isDriving,
    isWatching: isWatchingOwnCar || isWatchingOtherCar,
    isWatchingOwnCar,
    isWatchingOtherCar,
  });
  vi.mocked(useSessionVisibility).mockReturnValue(sessionVisible);
  vi.mocked(useSessionDrivers).mockReturnValue([
    { CarIdx: 1, CarNumber: '51', CarClassColor: 0x00ff6a },
    { CarIdx: 2, CarNumber: '92', CarClassColor: 0x00ff6a },
    { CarIdx: 3, CarNumber: '46', CarClassColor: 0x00ff6a },
    { CarIdx: 4, CarNumber: '27', CarClassColor: 0x00ff6a },
    { CarIdx: 5, CarNumber: '8', CarClassColor: 0xff000a },
    { CarIdx: 6, CarNumber: '22', CarClassColor: 0x0690ff },
  ] as unknown as ReturnType<typeof useSessionDrivers>);
  vi.mocked(useWeekendInfoNumCarClasses).mockReturnValue(3);
  vi.mocked(useActiveSimulator).mockReturnValue(simulator);
  return render(<PitStop />);
};

const figure = (name: string) => {
  const element = screen.getByTestId(`pit-stop-${name}`);
  return {
    text: element.textContent,
    tone: element.dataset.tone,
    approximate: element.dataset.approximate === 'true',
  };
};

const text = (testId: string) => screen.getByTestId(testId).textContent;
const isDrawn = () => screen.queryByTestId('pit-stop') !== null;

describe('PitStop', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('the plan, out on the circuit', () => {
    it('shows the loss large, with the stop and the lane it is made of', () => {
      show(pitStop());
      // 24.1 down the lane, 14.2 at rest and 2 extra, less 6.9 on the track.
      expect(figure('main')).toEqual({
        text: 'Loss33.4 s',
        tone: 'normal',
        approximate: false,
      });
      expect(figure('stop').text).toBe('Stop14.2');
      expect(figure('lane')).toMatchObject({
        text: 'Lane24.1',
        approximate: false,
      });
      expect(screen.getByTestId('pit-stop').dataset.mode).toBe('planning');
    });

    it('marks the loss and the lane as reckoned until a stop has been timed', () => {
      show(
        pitStop({
          lane: lane({ driveMeasuredS: null, speedLimitSource: 'assumed' }),
        })
      );
      expect(figure('main')).toMatchObject({
        text: 'Loss~26.6 s',
        approximate: true,
      });
      expect(figure('lane')).toMatchObject({
        text: 'Lane~17.3',
        approximate: true,
      });
      // The sim's own estimate is not a guess.
      expect(figure('stop').approximate).toBe(false);
    });

    it('marks a standing time learned from earlier stops', () => {
      show(
        pitStop({
          estimate: estimate({ source: 'learned', standingS: 33, samples: 3 }),
        }),
        { simulator: 'iracing' }
      );
      expect(figure('stop')).toMatchObject({
        text: 'Stop~33.0',
        approximate: true,
      });
      expect(figure('main').approximate).toBe(true);
    });

    it('turns a long stop red at the threshold set', () => {
      show(pitStop({ estimate: estimate({ standingS: 61.4 }) }));
      expect(figure('stop').tone).toBe('bad');

      show(pitStop({ estimate: estimate({ standingS: 61.4 }) }), {
        config: { longStopThreshold: 90 },
      });
      expect(screen.getAllByTestId('pit-stop-stop')[1].dataset.tone).toBe(
        'normal'
      );
    });

    it('takes the extra time from the settings', () => {
      show(pitStop(), { config: { extraTime: 5 } });
      expect(figure('main').text).toBe('Loss36.4 s');
    });

    it('shows the stop in place of the loss while the lane is not known', () => {
      show(
        pitStop({
          lane: lane({
            entryPct: null,
            exitPct: null,
            lengthM: null,
            driveAtLimitS: null,
            driveMeasuredS: null,
            trackTimeS: null,
          }),
        })
      );
      expect(figure('main').text).toBe('Stop14.2 s');
      expect(text('pit-stop-no-lane')).toBe('lane not measured yet');
      expect(screen.queryByTestId('pit-stop-lane')).toBeNull();
      // Without a loss there is no position to project.
      expect(screen.queryByTestId('pit-stop-position')).toBeNull();
    });

    it('shows dashes while the sim has not answered', () => {
      show(
        pitStop({
          estimate: estimate({ source: null, standingS: null, parts: null }),
          refuel: null,
        })
      );
      expect(figure('stop')).toMatchObject({ text: 'Stop--', tone: 'none' });
      // All that can be said is what a pass with no stop costs, and it is
      // labelled as that. It is the least a stop can cost, so no position
      // is hung on it.
      expect(figure('main').text).toBe('Loss, no stop~10.4 s');
      expect(screen.queryByTestId('pit-stop-position')).toBeNull();
      expect(screen.queryByTestId('pit-stop-rejoin')).toBeNull();
      expect(screen.queryByTestId('pit-stop-chips')).toBeNull();
      expect(screen.queryByTestId('pit-stop-refuel')).toBeNull();
    });

    it('keeps its shape before the first snapshot', () => {
      show(undefined, { config: { showOnlyWhenOnTrack: false } });
      expect(figure('main')).toMatchObject({ text: 'Stop--', tone: 'none' });
      expect(screen.getByTestId('pit-stop').dataset.mode).toBe('idle');
      // Nothing is known of the lane either way.
      expect(screen.queryByTestId('pit-stop-no-lane')).toBeNull();
    });
  });

  describe('what the stop is made of', () => {
    it('draws a chip for each part, the longest in blue', () => {
      show(
        pitStop({
          estimate: estimate({
            standingS: 61.4,
            parts: parts({
              fuel: 19.4,
              energy: 14.1,
              tyres: 12,
              damage: 30,
              driverSwap: 25,
            }),
          }),
        })
      );
      const chip = (kind: string) => {
        const element = screen.getByTestId(`pit-stop-chip-${kind}`);
        return { text: element.textContent, tone: element.dataset.tone };
      };
      expect(chip('fuel')).toEqual({ text: '19.4', tone: 'part' });
      expect(chip('energy')).toEqual({ text: '14.1', tone: 'part' });
      expect(chip('tyres')).toEqual({ text: '12.0', tone: 'part' });
      expect(chip('repair')).toEqual({ text: '30.0', tone: 'main' });
      expect(chip('driver')).toEqual({ text: '25.0', tone: 'part' });
    });

    it('draws a drive-through alone, and the loss of a pass with no stop', () => {
      show(
        pitStop({
          estimate: estimate({ penalty: 'DT', parts: parts({ fuel: 4.3 }) }),
        })
      );
      expect(text('pit-stop-chips')).toBe('DT');
      expect(figure('stop').text).toBe('StopDT');
      // 17.3 down the lane at the limit, less 6.9 on the track.
      expect(figure('main').text).toBe('Loss~10.4 s');
    });

    it('leaves the chips out when switched off', () => {
      show(pitStop(), { config: { showBreakdown: false } });
      expect(screen.queryByTestId('pit-stop-chips')).toBeNull();
    });
  });

  describe('the refuel', () => {
    it('says what goes in, how far it goes, and what the race still needs', () => {
      show(
        pitStop({
          refuel: {
            isVirtualEnergy: true,
            target: 45,
            aboard: 38.7,
            toAdd: 6.3,
            toFinish: 63.2,
            runLaps: 19.3,
            runMinutes: 27.9,
          },
        })
      );
      expect(text('pit-stop-refuel')).toBe(
        '+6.3 %19.3 laps / 28 minneeds +63.2 %'
      );
    });

    it('says nothing more when the level set reaches the finish', () => {
      show(pitStop());
      expect(screen.queryByTestId('pit-stop-needs')).toBeNull();
      expect(text('pit-stop-run')).toBe('36.5 laps / 53 min');
    });

    it('counts a car on fuel in litres', () => {
      show(
        pitStop({
          refuel: {
            isVirtualEnergy: false,
            target: 60,
            aboard: 7.4,
            toAdd: 52.6,
            toFinish: 71.9,
            runLaps: 21.4,
            runMinutes: 34.2,
          },
        })
      );
      expect(text('pit-stop-refuel')).toBe(
        '+52.6 L21.4 laps / 34 minneeds +71.9 L'
      );
    });

    it('can be shown without the run length, or not at all', () => {
      show(pitStop(), { config: { showRunLength: false } });
      expect(screen.queryByTestId('pit-stop-run')).toBeNull();
      expect(text('pit-stop-refuel')).toBe('+63.6 %');

      show(pitStop(), { config: { showRefuel: false } });
      expect(screen.getAllByTestId('pit-stop-refuel')).toHaveLength(1);
    });
  });

  describe('the rejoin', () => {
    it('shows the position after the stop and the two cars either side', () => {
      show(pitStop());
      // 33.4 s lost: the cars 5.1 and 19.6 s behind get past.
      expect(text('pit-stop-position')).toBe('P5P7');
      expect(text('pit-stop-rejoin-ahead')).toBe('#46-13.8');
      expect(text('pit-stop-rejoin-behind')).toBe('#27+11.4');
      expect(screen.getByTestId('pit-stop-position').dataset.reckoned).toBe(
        'false'
      );
    });

    it('counts the whole field when asked, and marks that as rougher under LMU', () => {
      show(pitStop(), { config: { rejoinScope: 'overall' } });
      expect(text('pit-stop-position')).toBe('P19~P22');

      // iRacing's race gaps are one clock for every class.
      show(pitStop(), {
        config: { rejoinScope: 'overall' },
        simulator: 'iracing',
      });
      expect(screen.getAllByTestId('pit-stop-position')[1].textContent).toBe(
        'P19P22'
      );
    });

    it('marks a position that turns on a car inside the margin', () => {
      show(
        pitStop({
          rejoin: {
            position: 19,
            classPosition: 5,
            ladder: [rival(1, -6.2), rival(2, 5.1), rival(3, 34.6)],
            driveToExitS: 52.4,
            passes: [],
          },
        })
      );
      expect(text('pit-stop-position')).toBe('P5~P6');
      expect(screen.getByTestId('pit-stop-rejoin-behind').dataset.close).toBe(
        'true'
      );
    });

    it('says how many cars within the loss are in the pits themselves', () => {
      show(
        pitStop({
          rejoin: {
            position: 19,
            classPosition: 5,
            ladder: [
              rival(1, -6.2),
              rival(2, 5.1, { inPit: true }),
              rival(3, 19.6),
            ],
            driveToExitS: 52.4,
            passes: [],
          },
        })
      );
      expect(text('pit-stop-position')).toBe('P5P6');
      expect(text('pit-stop-rejoin-in-pits')).toBe('+1 in pits');
    });

    it('is left out outside a race and when switched off', () => {
      show(
        pitStop({
          rejoin: {
            position: 19,
            classPosition: 5,
            ladder: [],
            driveToExitS: 52.4,
            passes: [],
          },
        })
      );
      expect(screen.queryByTestId('pit-stop-position')).toBeNull();
      expect(screen.queryByTestId('pit-stop-rejoin')).toBeNull();

      show(pitStop(), { config: { showRejoin: false } });
      expect(screen.queryByTestId('pit-stop-position')).toBeNull();
    });
  });

  describe('the pit lane', () => {
    it('counts the cars standing in it over those in it, and the stops asked for', () => {
      show(pitStop());
      expect(text('pit-stop-occupancy')).toBe('Pits 2/5, requests 3');
    });

    it('has no requests to count under iRacing', () => {
      show(pitStop(), { simulator: 'iracing', pits: carPit([]) });
      expect(text('pit-stop-occupancy')).toBe('Pits 2/5');
    });

    it('is left out, and its channel not asked for, when switched off', () => {
      show(pitStop(), { config: { showOccupancy: false } });
      expect(screen.queryByTestId('pit-stop-occupancy')).toBeNull();
      expect(useCarPitSnapshot).toHaveBeenCalledWith(false);
    });

    it('says when the sim has a stop requested', () => {
      show(pitStop({ requested: true }));
      expect(text('pit-stop-requested')).toBe('Requested');
    });
  });

  describe('in the pit lane', () => {
    const visit = (values: Partial<PitStopSnapshot> = {}) =>
      pitStop({
        phase: 'service',
        planned: { standingS: 14.2, driveS: 24.1 },
        timer: { enteredAt: 100, stoppedAt: 112, standingS: 0, exitedAt: null },
        ...values,
      });

    it('counts the standing time down against the plan', () => {
      show(visit(), { sessionTime: 119.3 });
      expect(screen.getByTestId('pit-stop').dataset.mode).toBe('inPits');
      expect(figure('main')).toMatchObject({
        text: 'To go6.9 s',
        tone: 'normal',
      });
      expect(figure('lane-timer').text).toBe('In lane19.3');
      expect(figure('planned').text).toBe('Plan14.2');
      const bar = screen.getByTestId('pit-stop-progress');
      expect(bar.dataset.over).toBe('false');
      expect((bar.firstElementChild as HTMLElement).style.width).toBe('51%');
    });

    it('goes on below zero, in red, once the stop has overrun', () => {
      show(visit(), { sessionTime: 130.1 });
      expect(figure('main')).toMatchObject({
        text: 'To go-3.9 s',
        tone: 'bad',
      });
      const bar = screen.getByTestId('pit-stop-progress');
      expect(bar.dataset.over).toBe('true');
      expect((bar.firstElementChild as HTMLElement).style.width).toBe('100%');
    });

    it('holds the whole stop to go while the car rolls down the lane', () => {
      show(
        visit({
          phase: 'lane',
          timer: {
            enteredAt: 100,
            stoppedAt: null,
            standingS: 0,
            exitedAt: null,
          },
        }),
        { sessionTime: 106.4 }
      );
      expect(figure('main').text).toBe('To go14.2 s');
      expect(figure('lane-timer').text).toBe('In lane6.4');
    });

    it('has nothing to time a visit by that began without an entry line', () => {
      show(pitStop({ phase: 'lane' }), { sessionTime: 106.4 });
      expect(figure('main')).toMatchObject({ text: 'To go--', tone: 'none' });
      expect(figure('lane-timer').text).toBe('In lane--');
    });

    it('measures the rejoin against what is still to lose', () => {
      // By the whole second the widget follows the clock at: 7.2 s to stand
      // and 8.65 s to drive, less half the lane on the track. 12.4 s to
      // lose, so only the car 5.1 s back gets past.
      show(
        visit({
          rejoin: {
            position: 19,
            classPosition: 5,
            ladder: [rival(1, -6.2), rival(2, 5.1), rival(3, 19.6)],
            driveToExitS: 8.65,
            passes: [],
          },
        }),
        { sessionTime: 119.3 }
      );
      expect(text('pit-stop-position')).toBe('P5P6');
    });
  });

  describe('after the exit', () => {
    const finished = (standingS: number) =>
      pitStop({
        timer: { enteredAt: 100, stoppedAt: null, standingS, exitedAt: 139 },
        last: { laneS: 39.1, standingS, plannedStandingS: 14.2, lap: 21 },
      });

    it('holds the finished stop, green within a second of its plan', () => {
      show(finished(14.6), { sessionTime: 143 });
      expect(screen.getByTestId('pit-stop').dataset.mode).toBe('result');
      expect(figure('main')).toMatchObject({
        text: 'Stop14.6 s',
        tone: 'good',
      });
      expect(figure('planned').text).toBe('Planned14.2');
      expect(figure('lane').text).toBe('Lane39.1');
      // The plan beside it would be the next stop's: its parts, its refuel
      // and its rejoin wait until the result has gone.
      expect(screen.queryByTestId('pit-stop-position')).toBeNull();
      expect(screen.queryByTestId('pit-stop-chips')).toBeNull();
      expect(screen.queryByTestId('pit-stop-refuel')).toBeNull();
    });

    it('draws it amber beyond that', () => {
      show(finished(18.4), { sessionTime: 143 });
      expect(figure('main').tone).toBe('caution');
    });

    it('goes back to the plan when the hold is over', () => {
      show(finished(14.6), { sessionTime: 150 });
      expect(screen.getByTestId('pit-stop').dataset.mode).toBe('planning');
      expect(figure('main').text).toBe('Loss33.4 s');
    });
  });

  describe('when it shows', () => {
    it('hides outside the sessions it is set to show in', () => {
      show(pitStop(), { sessionVisible: false });
      expect(isDrawn()).toBe(false);
    });

    it('stays up while a team-mate drives the car', () => {
      show(pitStop(), { isDriving: false, isWatchingOwnCar: true });
      expect(isDrawn()).toBe(true);
      expect(figure('main').text).toBe('Loss33.4 s');
    });

    it('hides with the camera on a rival, whatever the settings', () => {
      show(pitStop(), {
        isDriving: false,
        isWatchingOtherCar: true,
        config: { showOnlyWhenOnTrack: false },
      });
      expect(isDrawn()).toBe(false);
    });

    it('hides out of the car, or stays dimmed when set to', () => {
      show(pitStop({ phase: 'idle' }), { isDriving: false });
      expect(isDrawn()).toBe(false);

      show(pitStop({ phase: 'idle' }), {
        isDriving: false,
        config: { showOnlyWhenOnTrack: false },
      });
      expect(isDrawn()).toBe(true);
      expect(screen.getByTestId('pit-stop').className).toContain('opacity-60');
    });

    it('can be kept for the stop itself', () => {
      const config = { showMode: 'whenPitting' } as const;
      show(pitStop(), { config });
      expect(isDrawn()).toBe(false);

      // A stop asked for, the pit lane, and the result all bring it up.
      show(pitStop({ requested: true }), { config });
      expect(isDrawn()).toBe(true);
    });

    it('comes up in the pit lane and for the result when kept for the stop', () => {
      const config = { showMode: 'whenPitting' } as const;
      show(pitStop({ phase: 'lane' }), { config });
      expect(screen.getByTestId('pit-stop').dataset.mode).toBe('inPits');
    });
  });
});
