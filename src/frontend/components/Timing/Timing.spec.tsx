import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  useDashboard,
  useDrivingState,
  useSectorTimingStore,
  useSessionStore,
  useSessionVisibility,
} from '@irdashies/context';
import {
  getWidgetDefaultConfig,
  type ChannelBridge,
  type ChannelName,
  type ChannelPayloads,
  type LapDeltaSnapshot,
  type LapLogSnapshot,
  type SectorTimingResultSnapshot,
  type SectorTimingSnapshot,
  type Session,
  type SessionTimingSnapshot,
  type TimingConfig,
} from '@irdashies/types';
import type { SectorTile } from '@irdashies/domain/lapTiming/sectorTiles';
import { Timing, TimingView } from './Timing';
import { resolveTimingSettings } from './hooks/useTimingSettings';
import { NO_TIMING_READINGS, type TimingReadings } from './timingReadings';

vi.mock('@irdashies/utils/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// The channels, the session store and the sector store are the real ones;
// only what places the widget on screen is stubbed.
vi.mock('@irdashies/context', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@irdashies/context')>()),
  useDashboard: vi.fn(),
  useDrivingState: vi.fn(),
  useSessionVisibility: vi.fn(),
}));

const defaults = getWidgetDefaultConfig('timing');

/** Where the user is, as useDrivingState says it; nowhere unless told. */
const where = (
  state: Partial<ReturnType<typeof useDrivingState>> = {}
): ReturnType<typeof useDrivingState> => ({
  isDriving: false,
  isWatching: false,
  isWatchingOwnCar: false,
  isWatchingOtherCar: false,
  ...state,
});

type ConfigOverrides = Omit<Partial<TimingConfig>, 'tiles'> & {
  tiles?: Partial<TimingConfig['tiles']>;
};

const settings = (overrides: ConfigOverrides = {}): TimingConfig => ({
  ...defaults,
  ...overrides,
  tiles: { ...defaults.tiles, ...overrides.tiles },
});

const sector = (
  index: number,
  overrides: Partial<SectorTile> = {}
): SectorTile => ({
  index,
  label: `S${index + 1}`,
  time: null,
  state: 'none',
  color: 'default',
  unclean: false,
  ...overrides,
});

/** The fourth lap: one sector of it done, a little down on the reference. */
const midLap: TimingReadings = {
  lap: 4,
  delta: 0.084,
  referenceLapTime: 104.054,
  lapVoid: false,
  lastLapTime: 104.53,
  lastLapInvalid: false,
  bestLapTime: 104.054,
  sessionBestLapTime: 103.611,
  allTimeBestLapTime: 103.87,
  stintBestLapTime: 104.054,
  paceLapTime: 104.41,
  currentLapTime: 52.3,
  sectors: [
    sector(0, { time: 31.204, state: 'fresh', color: 'purple' }),
    sector(1, { time: 40.312, state: 'stale', color: 'green' }),
    sector(2, { time: 32.738, state: 'stale', color: 'red' }),
  ],
  dimmed: false,
};

const view = (
  readings: Partial<TimingReadings> = {},
  overrides: ConfigOverrides = {}
) =>
  render(
    <TimingView
      settings={settings(overrides)}
      readings={{ ...midLap, ...readings }}
    />
  ).container;

const tile = (container: HTMLElement, name: string) =>
  container.querySelector(`[data-testid="timing-${name}"]`) as HTMLElement;
const value = (container: HTMLElement, name: string) =>
  container.querySelector(
    `[data-testid="timing-${name}-value"]`
  ) as HTMLElement;
const label = (container: HTMLElement, name: string) =>
  container.querySelector(
    `[data-testid="timing-${name}-label"]`
  ) as HTMLElement;
/** The classes that colour a figure sit on the element around it. */
const tone = (container: HTMLElement, name: string) =>
  value(container, name).parentElement?.className ?? '';
const marked = (container: HTMLElement, name: string) =>
  tile(container, name).querySelector('[aria-label="Did not count"]') !== null;
const tileNames = (container: HTMLElement) =>
  [...container.querySelectorAll('[data-testid$="-label"]')].map(
    (element) => element.textContent
  );

describe('TimingView', () => {
  it('shows the lap, the delta, the last and best laps and the sectors', () => {
    const container = view();

    expect(value(container, 'lap').textContent).toBe('4');
    expect(value(container, 'delta').textContent).toBe('+0.084');
    expect(value(container, 'last-lap').textContent).toBe('1:44.530');
    expect(value(container, 'best-lap').textContent).toBe('1:44.054');
    expect(value(container, 'sector-1').textContent).toBe('31.204');
    expect(value(container, 'sector-2').textContent).toBe('40.312');
    expect(value(container, 'sector-3').textContent).toBe('32.738');
    expect(tileNames(container)).toEqual([
      'Lap',
      'Delta',
      'Last Lap',
      'Best Lap',
      'S1',
      'S2',
      'S3',
    ]);
  });

  it('keeps its shape with placeholders when there is nothing to show', () => {
    const container = render(
      <TimingView settings={settings()} readings={NO_TIMING_READINGS} />
    ).container;

    expect(value(container, 'lap').textContent).toBe('--');
    expect(value(container, 'delta').textContent).toBe('-.---');
    expect(tone(container, 'delta')).toContain('text-slate-500');
    expect(value(container, 'last-lap').textContent).toBe('-:--.---');
    expect(value(container, 'best-lap').textContent).toBe('-:--.---');
    for (const name of ['sector-1', 'sector-2', 'sector-3']) {
      expect(value(container, name).textContent).toBe('--');
      expect(tile(container, name).className).toContain('border-slate-700');
    }
  });

  it('tints the lap tile blue and the best lap tile purple', () => {
    const container = view();

    expect(tile(container, 'lap').className).toContain('bg-sky-500/20');
    expect(tile(container, 'best-lap').className).toContain('bg-purple-500/20');
    expect(tone(container, 'best-lap')).toContain('text-purple-300');
  });

  it('colours the delta green ahead, red behind and white level', () => {
    expect(tone(view({ delta: -0.342 }), 'delta')).toContain('text-green-400');
    expect(tone(view({ delta: 0.084 }), 'delta')).toContain('text-red-400');
    const level = view({ delta: 0.0002 });
    expect(value(level, 'delta').textContent).toBe('0.000');
    expect(tone(level, 'delta')).toContain('text-white');
  });

  describe('the last lap', () => {
    it('is greyed and marked when it did not count', () => {
      const container = view({ lastLapTime: 106.912, lastLapInvalid: true });

      expect(value(container, 'last-lap').textContent).toBe('1:46.912');
      expect(tone(container, 'last-lap')).toContain('text-slate-400');
      expect(marked(container, 'last-lap')).toBe(true);
    });

    it('is not marked when it counted', () => {
      const container = view();

      expect(tone(container, 'last-lap')).toContain('text-white');
      expect(marked(container, 'last-lap')).toBe(false);
    });

    it('is purple when it is the session best in scope', () => {
      const container = view({
        lastLapTime: 103.611,
        bestLapTime: 103.611,
        sessionBestLapTime: 103.611,
      });

      expect(tone(container, 'last-lap')).toContain('text-purple-400');
    });

    it('is green when it is only the driver’s own best', () => {
      const container = view({ lastLapTime: 104.054 });

      expect(tone(container, 'last-lap')).toContain('text-green-400');
    });

    it('stays grey when a lap that did not count was also the quickest', () => {
      const container = view({
        lastLapTime: 103.2,
        lastLapInvalid: true,
        sessionBestLapTime: 103.2,
      });

      expect(tone(container, 'last-lap')).toContain('text-slate-400');
    });
  });

  describe('the best lap', () => {
    const crowned = (container: HTMLElement) =>
      tile(container, 'best-lap').querySelector(
        '[aria-label="Session best"]'
      ) !== null;

    it('deepens and wears a crown when it is also the session best', () => {
      const container = view({
        bestLapTime: 103.611,
        sessionBestLapTime: 103.611,
      });

      expect(crowned(container)).toBe(true);
      // The full-strength ring, not the faint one of the plain tile.
      expect(tile(container, 'best-lap').className).toMatch(
        /ring-purple-400(\s|$)/
      );
    });

    it('is plain when someone else holds the session best', () => {
      const container = view();

      expect(crowned(container)).toBe(false);
      expect(tile(container, 'best-lap').className).toContain(
        'ring-purple-400/30'
      );
      // Its own purple, never the session-best purple of a lap time.
      expect(tone(container, 'best-lap')).not.toContain('text-purple-400');
    });

    it('is not crowned before the session has a best in scope', () => {
      expect(crowned(view({ sessionBestLapTime: null }))).toBe(false);
    });
  });

  describe('a void lap in progress', () => {
    it('greys the delta and says why in its label', () => {
      const container = view({ delta: -0.214, lapVoid: true });

      expect(label(container, 'delta').textContent).toBe('Delta · Invalid');
      expect(label(container, 'delta').className).toContain('text-amber-300');
      expect(value(container, 'delta').textContent).toBe('-0.214');
      expect(tone(container, 'delta')).toContain('text-slate-400');
      expect(tone(container, 'delta')).not.toContain('text-green-400');
    });

    it('leaves the label alone on a lap that stands', () => {
      const container = view({ delta: -0.214 });

      expect(label(container, 'delta').textContent).toBe('Delta');
      expect(label(container, 'delta').className).not.toContain(
        'text-amber-300'
      );
    });
  });

  describe('sector tiles', () => {
    it('draw a fresh time at full strength and a previous lap’s dimmed', () => {
      const container = view();

      // A best: purple figure, purple accent.
      expect(tone(container, 'sector-1')).toContain('text-purple-300');
      expect(tile(container, 'sector-1').className).toContain(
        'border-purple-400'
      );
      // The previous lap's: the figure steps back, the accent stays.
      expect(tone(container, 'sector-2')).toContain('text-slate-400');
      expect(tile(container, 'sector-2').className).toContain(
        'border-green-400'
      );
      expect(tile(container, 'sector-3').className).toContain('border-red-500');
    });

    it('draw a fresh time that is no best in white', () => {
      const container = view({
        sectors: [
          sector(0, { time: 31.6, state: 'fresh', color: 'yellow' }),
          sector(1),
          sector(2),
        ],
      });

      expect(tone(container, 'sector-1')).toContain('text-white');
      expect(tile(container, 'sector-1').className).toContain(
        'border-yellow-400'
      );
    });

    it('mark a sector with an incident in it', () => {
      const container = view({
        sectors: [
          sector(0, { time: 31.204, state: 'fresh', color: 'green' }),
          sector(1, {
            time: 42.262,
            state: 'fresh',
            color: 'red',
            unclean: true,
          }),
          sector(2),
        ],
      });

      expect(marked(container, 'sector-1')).toBe(false);
      expect(marked(container, 'sector-2')).toBe(true);
    });

    it('draw one tile per sector the selector hands over', () => {
      const container = view({
        sectors: Array.from({ length: 6 }, (_, index) =>
          sector(index + 1, {
            time: 12 + index,
            state: 'fresh',
            color: 'green',
            unclean: index === 2,
          })
        ),
      });

      expect(
        tileNames(container).filter((name) => name?.startsWith('S'))
      ).toEqual(['S2', 'S3', 'S4', 'S5', 'S6', 'S7']);
      // Still marked, where the narrow tile has room for it.
      expect(marked(container, 'sector-4')).toBe(true);
    });

    it('write a sector of a minute or more with its minutes', () => {
      const container = view({
        sectors: [
          sector(0, { time: 72.48, state: 'fresh', color: 'green' }),
          sector(1),
          sector(2),
        ],
      });

      expect(value(container, 'sector-1').textContent).toBe('1:12.480');
    });
  });

  describe('the optional rows', () => {
    it('are left out by default', () => {
      const container = view();

      for (const name of [
        'current-lap',
        'predicted-lap',
        'session-best',
        'all-time-best',
        'stint-best',
        'pace',
      ]) {
        expect(tile(container, name)).toBeNull();
      }
    });

    it('follow the default rows in a fixed order when switched on', () => {
      const container = view(
        {},
        {
          tiles: {
            currentLap: true,
            predictedLap: true,
            sessionBest: true,
            allTimeBest: true,
            stintBest: true,
            pace: true,
          },
        }
      );

      expect(tileNames(container).slice(7)).toEqual([
        'Current',
        'Predicted',
        'Session Best',
        'All-Time',
        'Stint Best',
        'Pace',
      ]);
      // One decimal on the running clock.
      expect(value(container, 'current-lap').textContent).toBe('0:52.3');
      // The reference lap plus the delta.
      expect(value(container, 'predicted-lap').textContent).toBe('1:44.138');
      expect(value(container, 'session-best').textContent).toBe('1:43.611');
      expect(tone(container, 'session-best')).toContain('text-purple-400');
      expect(value(container, 'all-time-best').textContent).toBe('1:43.870');
      expect(tone(container, 'all-time-best')).toContain('text-white');
      // The stint best here is the driver's best of the session: green.
      expect(value(container, 'stint-best').textContent).toBe('1:44.054');
      expect(tone(container, 'stint-best')).toContain('text-green-400');
      expect(value(container, 'pace').textContent).toBe('1:44.410');
    });

    it('show a row for one tile of a pair', () => {
      const container = view({}, { tiles: { pace: true } });

      expect(tile(container, 'pace')).not.toBeNull();
      expect(tile(container, 'stint-best')).toBeNull();
    });

    it('show dashes without their figures', () => {
      const container = render(
        <TimingView
          settings={settings({
            tiles: {
              currentLap: true,
              predictedLap: true,
              sessionBest: true,
              allTimeBest: true,
              stintBest: true,
              pace: true,
            },
          })}
          readings={NO_TIMING_READINGS}
        />
      ).container;

      expect(value(container, 'current-lap').textContent).toBe('-:--.-');
      for (const name of [
        'predicted-lap',
        'session-best',
        'all-time-best',
        'stint-best',
        'pace',
      ]) {
        expect(value(container, name).textContent).toBe('-:--.---');
      }
    });

    it('have no predicted lap without a delta', () => {
      const container = view(
        { delta: null },
        { tiles: { predictedLap: true } }
      );

      expect(value(container, 'predicted-lap').textContent).toBe('-:--.---');
    });
  });

  it('leaves out the tiles and rows the settings switch off', () => {
    const container = view(
      {},
      { tiles: { lap: false, lastLap: false, bestLap: false, sectors: false } }
    );

    expect(tileNames(container)).toEqual(['Delta']);
  });

  it('follows the precision settings', () => {
    const container = view(
      {},
      { deltaDecimals: 2, lapTimeDecimals: 2, sectorDecimals: 1 }
    );

    expect(value(container, 'delta').textContent).toBe('+0.08');
    expect(value(container, 'last-lap').textContent).toBe('1:44.53');
    expect(value(container, 'best-lap').textContent).toBe('1:44.05');
    expect(value(container, 'sector-1').textContent).toBe('31.2');
  });

  it('dims the figures it is holding from the last time the car was driven', () => {
    const container = view({ dimmed: true, delta: null, currentLapTime: null });

    for (const name of ['lap', 'last-lap', 'best-lap', 'sector-1']) {
      expect(tone(container, name)).toContain('opacity-60');
    }
    expect(value(container, 'delta').textContent).toBe('-.---');
  });

  it('sizes its text from the scale setting', () => {
    const root = (container: HTMLElement) =>
      container.querySelector('[data-testid="timing"]') as HTMLElement;

    expect(root(view()).style.fontSize).toBe('14px');
    expect(root(view({}, { scale: 150 })).style.fontSize).toBe('21px');
  });
});

describe('resolveTimingSettings', () => {
  it('is the defaults for a dashboard with no entry or a broken one', () => {
    expect(resolveTimingSettings(undefined)).toEqual(defaults);
    expect(resolveTimingSettings('timing')).toEqual(defaults);
    expect(resolveTimingSettings([])).toEqual(defaults);
  });

  it('fills in what an older config does not have', () => {
    const resolved = resolveTimingSettings({
      tiles: { pace: true },
      background: {},
    });

    expect(resolved.tiles).toEqual({ ...defaults.tiles, pace: true });
    expect(resolved.background.opacity).toBe(80);
    expect(resolved.sectorSource).toBe('live');
  });

  it('falls back from values it does not know', () => {
    const resolved = resolveTimingSettings({
      deltaReference: 'lifetime',
      deltaDecimals: 7,
      lapTimeDecimals: '3',
      sectorDecimals: 0,
      sectorSource: 'ghost',
      sectorIncidents: true,
      sessionBestScope: 'team',
      tiles: { lap: 'yes', delta: null },
      sectorTilesMax: 'six',
      scale: Number.NaN,
    });

    expect(resolved).toMatchObject({
      deltaReference: 'sessionBest',
      deltaDecimals: 3,
      lapTimeDecimals: 3,
      sectorDecimals: 3,
      sectorSource: 'live',
      sectorIncidents: 'mark',
      sessionBestScope: 'class',
      sectorTilesMax: 6,
      scale: 100,
    });
    expect(resolved.tiles).toEqual(defaults.tiles);
  });

  it('holds numbers inside their limits', () => {
    const resolved = resolveTimingSettings({
      sectorTilesMax: 40,
      scale: 5,
      background: { opacity: 250 },
    });

    expect(resolved.sectorTilesMax).toBe(8);
    expect(resolved.scale).toBe(50);
    expect(resolved.background.opacity).toBe(100);
  });

  it('keeps a reference the delta channel does not carry yet', () => {
    // Saved by a build that offers it: not swapped for another lap.
    expect(
      resolveTimingSettings({ deltaReference: 'stintBest' }).deltaReference
    ).toBe('stintBest');
    expect(
      resolveTimingSettings({ deltaReference: 'lastLap' }).deltaReference
    ).toBe('lastLap');
  });
});

describe('Timing', () => {
  // Cars 0 and 1 are prototypes; the player's car 3 shares a class with 2
  // and 4.
  const PLAYER = 3;
  const session = {
    DriverInfo: {
      DriverCarIdx: PLAYER,
      Drivers: [
        { CarIdx: 0, CarClassID: 10 },
        { CarIdx: 1, CarClassID: 10 },
        { CarIdx: 2, CarClassID: 20 },
        { CarIdx: PLAYER, CarClassID: 20 },
        { CarIdx: 4, CarClassID: 20 },
      ],
    },
  } as unknown as Session;

  const sessionTiming = (currentLap: number): SessionTimingSnapshot => ({
    sessionType: 'Race',
    state: 4,
    currentLap,
    totalLaps: 0,
    time: 600,
    timeTotal: 3600,
    timeRemaining: 3000,
    greenFlagTimestamp: 0,
    isFixedLapRace: false,
    totalRaceLaps: 0,
    totalRaceTime: 0,
    adjustedRaceTime: 0,
    sessionNum: 0,
    version: 1,
  });

  const lapLog = (overrides: Partial<LapLogSnapshot> = {}): LapLogSnapshot => ({
    lapCompleted: 3,
    currentLapTime: 52.34,
    lastLapTime: 104.53,
    bestLapTime: 104.054,
    ownBestLapTime: 104.054,
    // A rival in class is quicker; the prototypes quicker still.
    carIdxBestLapTime: [93.2, 93.6, 104.3, 104.054, 103.611],
    sessionNum: 0,
    sessionTime: 600,
    playerTrackSurface: 3,
    incidentCount: 0,
    lapDistPct: 0.5,
    deltaToSessionLastLap: 0,
    deltaToSessionLastLapOk: false,
    deltaToSessionBestLap: 0,
    deltaToSessionBestLapOk: false,
    lapInvalidated: false,
    lastLapInvalid: false,
    lastLapUnderCaution: false,
    version: 1,
    ...overrides,
  });

  const lapDelta: LapDeltaSnapshot = {
    sessionBest: { lapTime: 104.054, delta: 0.0841, trend: 0.02 },
    allTime: { lapTime: 103.87, delta: 0.268, trend: 0.02 },
    sessionNum: 0,
    version: 1,
  };

  const sectorResult = (
    overrides: Partial<SectorTimingResultSnapshot> = {}
  ): SectorTimingResultSnapshot => ({
    currentLapSectorTimes: [31.204, null, null],
    previousLapSectorTimes: [31.48, 40.312, 32.738],
    currentLapSectorUnclean: [false, false, false],
    previousLapSectorUnclean: [false, false, false],
    sessionBestSectorTimes: [31.204, 40.112, 32.738],
    previousSessionBestSectorTimes: [31.48, 40.312, 32.738],
    ...overrides,
  });

  const sectorTiming = (
    overrides: Partial<SectorTimingSnapshot> = {}
  ): SectorTimingSnapshot => ({
    sectors: [
      { SectorNum: 0, SectorStartPct: 0 },
      { SectorNum: 1, SectorStartPct: 0.39 },
      { SectorNum: 2, SectorStartPct: 0.792 },
    ],
    currentSectorIdx: 1,
    sectorEntryTime: 579.2,
    sectorEntryValid: true,
    inclusive: sectorResult(),
    clean: sectorResult(),
    sessionNum: 0,
    version: 1,
    ...overrides,
  });

  const midLapChannels: Partial<ChannelPayloads> = {
    'session-timing.snapshot': sessionTiming(4),
    'lap-log.snapshot': lapLog(),
    'lap-delta.snapshot': lapDelta,
    'sector-timing.snapshot': sectorTiming(),
    'lap-times.snapshot': {
      lapTimes: [93.5, 93.9, 104.6, 104.41, 103.9],
      lapTimeHistory: [],
      sessionNum: 0,
      version: 1,
    },
  };

  /** A channel bridge that answers each subscription with one snapshot. */
  const withChannels = (snapshots: Partial<ChannelPayloads>) => {
    const subscribed: ChannelName[] = [];
    const bridge: ChannelBridge = {
      subscribe: <K extends ChannelName>(
        channel: K,
        callback: (payload: ChannelPayloads[K]) => void
      ) => {
        subscribed.push(channel);
        const snapshot = snapshots[channel];
        if (snapshot !== undefined) callback(snapshot as ChannelPayloads[K]);
        return () => undefined;
      },
    };
    window.channelBridge = bridge;
    return subscribed;
  };

  const withConfig = (config: unknown, isDemoMode = false) =>
    vi.mocked(useDashboard).mockReturnValue({
      isDemoMode,
      currentDashboard: {
        widgets: config === undefined ? [] : [{ id: 'timing', config }],
      },
    } as never);

  beforeEach(() => {
    vi.clearAllMocks();
    withConfig({});
    withChannels(midLapChannels);
    vi.mocked(useDrivingState).mockReturnValue(where({ isDriving: true }));
    vi.mocked(useSessionVisibility).mockReturnValue(true);
    useSessionStore.setState({ session });
    useSectorTimingStore.getState().setThresholds(0.005, 0.01);
  });

  it('reads the lap, the delta, the laps and the sectors from their channels', () => {
    const { container } = render(<Timing />);

    expect(value(container, 'lap').textContent).toBe('4');
    expect(value(container, 'delta').textContent).toBe('+0.084');
    expect(value(container, 'last-lap').textContent).toBe('1:44.530');
    expect(value(container, 'best-lap').textContent).toBe('1:44.054');
    // This lap's first sector, and the previous lap's other two, dimmed.
    expect(value(container, 'sector-1').textContent).toBe('31.204');
    expect(tone(container, 'sector-1')).toContain('text-purple-300');
    expect(value(container, 'sector-2').textContent).toBe('40.312');
    expect(tone(container, 'sector-2')).toContain('text-slate-400');
    expect(tile(container, 'sector-2').className).toContain('border-green-400');
    expect(value(container, 'sector-3').textContent).toBe('32.738');
  });

  it('shows placeholders before any channel has answered', () => {
    withChannels({});

    const { container } = render(<Timing />);

    expect(value(container, 'lap').textContent).toBe('--');
    expect(value(container, 'delta').textContent).toBe('-.---');
    expect(value(container, 'last-lap').textContent).toBe('-:--.---');
    expect(value(container, 'best-lap').textContent).toBe('-:--.---');
    expect(value(container, 'sector-1').textContent).toBe('--');
    expect(value(container, 'sector-3').textContent).toBe('--');
  });

  it('shows no lap number until the sim counts one', () => {
    withChannels({
      ...midLapChannels,
      'session-timing.snapshot': sessionTiming(0),
    });

    const { container } = render(<Timing />);

    expect(value(container, 'lap').textContent).toBe('--');
  });

  it('measures against the all-time best when set to', () => {
    withConfig({ deltaReference: 'allTime', tiles: { predictedLap: true } });

    const { container } = render(<Timing />);

    expect(value(container, 'delta').textContent).toBe('+0.268');
    expect(value(container, 'predicted-lap').textContent).toBe('1:44.138');
  });

  it.each(['stintBest', 'lastLap'])(
    'shows dashes for the stored reference %s, which the channel does not carry',
    (deltaReference) => {
      withConfig({ deltaReference, tiles: { predictedLap: true } });

      const { container } = render(<Timing />);

      expect(value(container, 'delta').textContent).toBe('-.---');
      expect(value(container, 'predicted-lap').textContent).toBe('-:--.---');
      // The rest of the panel carries on.
      expect(value(container, 'last-lap').textContent).toBe('1:44.530');
    }
  );

  it('does not fall back to the other reference when the chosen one is missing', () => {
    withChannels({
      ...midLapChannels,
      'lap-delta.snapshot': {
        ...lapDelta,
        sessionBest: { lapTime: null, delta: null, trend: null },
      },
    });

    const { container } = render(<Timing />);

    expect(value(container, 'delta').textContent).toBe('-.---');
  });

  it('marks a last lap the sim gave no time', () => {
    withChannels({
      ...midLapChannels,
      'lap-log.snapshot': lapLog({
        lastLapTime: 106.912,
        lastLapInvalid: true,
      }),
    });

    const { container } = render(<Timing />);

    expect(value(container, 'last-lap').textContent).toBe('1:46.912');
    expect(tone(container, 'last-lap')).toContain('text-slate-400');
    expect(marked(container, 'last-lap')).toBe(true);
  });

  it("reads LMU's no-time last lap as no lap, not as a negative time", () => {
    withChannels({
      ...midLapChannels,
      'lap-log.snapshot': lapLog({ lastLapTime: -1, bestLapTime: -1 }),
    });

    const { container } = render(<Timing />);

    expect(value(container, 'last-lap').textContent).toBe('-:--.---');
    expect(value(container, 'best-lap').textContent).toBe('-:--.---');
  });

  describe('the session best in scope', () => {
    const playerHoldsClassBest = {
      ...midLapChannels,
      'lap-log.snapshot': lapLog({
        lastLapTime: 103.498,
        bestLapTime: 103.498,
        carIdxBestLapTime: [93.2, 93.6, 104.3, 103.498, 103.611],
      }),
    };
    const crowned = (container: HTMLElement) =>
      tile(container, 'best-lap').querySelector(
        '[aria-label="Session best"]'
      ) !== null;

    it("is the player's class by default", () => {
      withChannels(playerHoldsClassBest);

      const { container } = render(<Timing />);

      // Quickest of the class, though the prototypes are quicker.
      expect(crowned(container)).toBe(true);
      expect(tone(container, 'last-lap')).toContain('text-purple-400');
    });

    it('is every car when set to overall', () => {
      withChannels(playerHoldsClassBest);
      withConfig({
        sessionBestScope: 'overall',
        tiles: { sessionBest: true },
      });

      const { container } = render(<Timing />);

      expect(crowned(container)).toBe(false);
      // The player's own best, then: green.
      expect(tone(container, 'last-lap')).toContain('text-green-400');
      expect(value(container, 'session-best').textContent).toBe('1:33.200');
    });

    it('shows the class rival’s lap in the session best tile', () => {
      withConfig({ tiles: { sessionBest: true } });

      const { container } = render(<Timing />);

      expect(value(container, 'session-best').textContent).toBe('1:43.611');
      expect(crowned(container)).toBe(false);
    });
  });

  describe('a void lap in progress', () => {
    it('greys the delta once the lap is far enough from the line', () => {
      withChannels({
        ...midLapChannels,
        'lap-log.snapshot': lapLog({ lapInvalidated: true, lapDistPct: 0.4 }),
      });

      const { container } = render(<Timing />);

      expect(label(container, 'delta').textContent).toBe('Delta · Invalid');
      expect(tone(container, 'delta')).toContain('text-slate-400');
    });

    it('ignores the flag in the first twentieth of the lap', () => {
      // There it may still be the previous lap's.
      withChannels({
        ...midLapChannels,
        'lap-log.snapshot': lapLog({ lapInvalidated: true, lapDistPct: 0.03 }),
      });

      const { container } = render(<Timing />);

      expect(label(container, 'delta').textContent).toBe('Delta');
      expect(tone(container, 'delta')).toContain('text-red-400');
    });
  });

  describe('the sector tiles', () => {
    const justOverTheLine = (sessionTime: number) => ({
      ...midLapChannels,
      'lap-log.snapshot': lapLog({ sessionTime, lapDistPct: 0.02 }),
      'sector-timing.snapshot': sectorTiming({
        currentSectorIdx: 0,
        sectorEntryTime: 600,
        inclusive: sectorResult({ currentLapSectorTimes: [null, null, null] }),
      }),
    });

    it('hold the finished lap at full strength for five seconds', () => {
      withChannels(justOverTheLine(603));

      const { container } = render(<Timing />);

      expect(value(container, 'sector-3').textContent).toBe('32.738');
      for (const name of ['sector-1', 'sector-2', 'sector-3']) {
        expect(tone(container, name)).not.toContain('text-slate-400');
      }
    });

    it('dim it once the hold is over', () => {
      withChannels(justOverTheLine(606));

      const { container } = render(<Timing />);

      for (const name of ['sector-1', 'sector-2', 'sector-3']) {
        expect(tone(container, name)).toContain('text-slate-400');
      }
    });

    it('return to dashes after the hold when set to this lap only', () => {
      withChannels(justOverTheLine(606));
      withConfig({ sectorSource: 'liveOnly' });

      const { container } = render(<Timing />);

      for (const name of ['sector-1', 'sector-2', 'sector-3']) {
        expect(value(container, name).textContent).toBe('--');
      }
    });

    it('show the bests when set to', () => {
      withConfig({ sectorSource: 'best' });

      const { container } = render(<Timing />);

      expect(value(container, 'sector-2').textContent).toBe('40.112');
      expect(tone(container, 'sector-2')).toContain('text-purple-300');
    });

    it('take the clean view when sectors with an incident are left out', () => {
      const channels = {
        ...midLapChannels,
        'sector-timing.snapshot': sectorTiming({
          inclusive: sectorResult({
            previousLapSectorTimes: [31.48, 44.9, 32.738],
            previousLapSectorUnclean: [false, true, false],
          }),
        }),
      };
      withChannels(channels);
      const marking = render(<Timing />).container;
      expect(value(marking, 'sector-2').textContent).toBe('44.900');
      expect(marked(marking, 'sector-2')).toBe(true);

      withChannels(channels);
      withConfig({ sectorIncidents: 'drop' });
      const dropping = render(<Timing />).container;
      expect(value(dropping, 'sector-2').textContent).toBe('40.312');
      expect(marked(dropping, 'sector-2')).toBe(false);
    });

    it('show a window of an eight-sector lap', () => {
      const times = [12.4, 14.0, 11.9, 13.4, 12.9, 15.2, 11.7, 12.9];
      const eight = sectorResult({
        currentLapSectorTimes: times.map((time, i) => (i < 6 ? time : null)),
        previousLapSectorTimes: times,
        currentLapSectorUnclean: times.map(() => false),
        previousLapSectorUnclean: times.map(() => false),
        sessionBestSectorTimes: times,
        previousSessionBestSectorTimes: times,
      });
      withChannels({
        ...midLapChannels,
        'sector-timing.snapshot': sectorTiming({
          sectors: times.map((_, index) => ({
            SectorNum: index,
            SectorStartPct: index / times.length,
          })),
          currentSectorIdx: 6,
          inclusive: eight,
          clean: eight,
        }),
      });

      const { container } = render(<Timing />);

      // Six tiles, the sector being driven last.
      expect(
        tileNames(container).filter((name) => name?.startsWith('S'))
      ).toEqual(['S2', 'S3', 'S4', 'S5', 'S6', 'S7']);
    });
  });

  it('subscribes only to the channels its tiles need', () => {
    const subscribed = withChannels(midLapChannels);
    withConfig({ tiles: { lap: false, delta: false, sectors: false } });

    render(<Timing />);

    expect(subscribed).toEqual(['lap-log.snapshot']);
  });

  it('subscribes to the pace channel only while the pace tile is on', () => {
    const without = withChannels(midLapChannels);
    render(<Timing />);
    expect(without).not.toContain('lap-times.snapshot');

    const withPace = withChannels(midLapChannels);
    withConfig({ tiles: { pace: true } });
    const { container } = render(<Timing />);
    expect(withPace).toContain('lap-times.snapshot');
    expect(value(container, 'pace').textContent).toBe('1:44.410');
  });

  it('hides while not driving, unless told to stay', () => {
    vi.mocked(useDrivingState).mockReturnValue(where());

    expect(render(<Timing />).container.firstChild).toBeNull();
  });

  it('times a team-mate’s lap in the user’s own car, and holds the sectors', () => {
    vi.mocked(useDrivingState).mockReturnValue(
      where({ isWatching: true, isWatchingOwnCar: true })
    );
    withConfig({ tiles: { currentLap: true } });

    const { container } = render(<Timing />);

    // The lap, the delta and the lap times are the team car's, live.
    expect(value(container, 'lap').textContent).toBe('4');
    expect(value(container, 'delta').textContent).toBe('+0.084');
    expect(value(container, 'current-lap').textContent).toBe('0:52.3');
    expect(value(container, 'last-lap').textContent).toBe('1:44.530');
    expect(tone(container, 'last-lap')).not.toContain('opacity-60');
    // The sector timer follows the user's own driving alone: its times are
    // from their last lap at the wheel, and step back.
    expect(value(container, 'sector-1').textContent).toBe('31.204');
    expect(tone(container, 'sector-1')).toContain('opacity-60');
    expect(tone(container, 'sector-2')).toContain('opacity-60');
  });

  it('stays hidden while the camera is on another car', () => {
    // The figures are still the team car's, which is not the car on screen.
    vi.mocked(useDrivingState).mockReturnValue(
      where({ isWatching: true, isWatchingOtherCar: true })
    );

    expect(render(<Timing />).container.firstChild).toBeNull();
  });

  it('holds its last figures over another car when told to stay on screen', () => {
    vi.mocked(useDrivingState).mockReturnValue(
      where({ isWatching: true, isWatchingOtherCar: true })
    );
    withConfig({ showOnlyWhenOnTrack: false, tiles: { currentLap: true } });

    const { container } = render(<Timing />);

    expect(tone(container, 'last-lap')).toContain('opacity-60');
    expect(value(container, 'delta').textContent).toBe('-.---');
    expect(value(container, 'current-lap').textContent).toBe('-:--.-');
  });

  it('holds its last figures, dimmed, when told to stay out of the car', () => {
    vi.mocked(useDrivingState).mockReturnValue(where());
    withConfig({ showOnlyWhenOnTrack: false, tiles: { currentLap: true } });

    const { container } = render(<Timing />);

    expect(value(container, 'last-lap').textContent).toBe('1:44.530');
    expect(tone(container, 'last-lap')).toContain('opacity-60');
    expect(tone(container, 'sector-1')).toContain('opacity-60');
    // Nothing is being driven against the reference.
    expect(value(container, 'delta').textContent).toBe('-.---');
    expect(value(container, 'current-lap').textContent).toBe('-:--.-');
  });

  it('hides in a session it is switched off for', () => {
    vi.mocked(useSessionVisibility).mockReturnValue(false);

    expect(render(<Timing />).container.firstChild).toBeNull();
  });

  it('shows a fixed sample in demo mode, whatever the session', () => {
    withConfig({}, true);
    withChannels({});
    vi.mocked(useDrivingState).mockReturnValue(where());

    const { container } = render(<Timing />);

    expect(value(container, 'lap').textContent).toBe('4');
    expect(value(container, 'delta').textContent).toBe('+0.084');
    expect(value(container, 'last-lap').textContent).toBe('1:44.530');
    expect(value(container, 'best-lap').textContent).toBe('1:44.054');
    expect(value(container, 'sector-1').textContent).toBe('31.204');
    expect(value(container, 'sector-3').textContent).toBe('32.738');
  });

  it('uses the defaults when the dashboard has no entry for it', () => {
    withConfig(undefined);

    const { container } = render(<Timing />);

    expect(value(container, 'delta').textContent).toBe('+0.084');
  });

  it('survives a saved config that names nothing it knows', () => {
    withConfig({
      deltaReference: 'lifetime',
      deltaDecimals: 9,
      sectorSource: 'ghost',
      tiles: 'all',
      sectorTilesMax: null,
    });

    const { container } = render(<Timing />);

    expect(value(container, 'delta').textContent).toBe('+0.084');
    expect(value(container, 'sector-1').textContent).toBe('31.204');
  });
});
