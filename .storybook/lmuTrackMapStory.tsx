import { useLayoutEffect, type ComponentType } from 'react';
import {
  DashboardProvider,
  useSectorTimingStore,
  useSessionStore,
  type SectorColor,
} from '@irdashies/context';
import {
  EMPTY_FLAG_STATE,
  type DashboardBridge,
  type LmuTrackMap,
  type Session,
  type TrackProfileSnapshot,
  type TrackStateSnapshot,
} from '@irdashies/types';
import lmuTrackMaps from '../src/app/lmu/lmu-track-maps.json';
import { ChannelSnapshotDecorator } from './channelSnapshotDecorator';
import {
  LMU_STORY_CARS,
  LMU_STORY_CLASSES,
  LMU_STORY_PLAYER,
  buildStoryGrid,
  type StoryGridCar,
} from './lmuEnduranceGrid';
import { createMockBridgeWithConfig } from './telemetryDecorator';
import { emptyTrackProfileStorySnapshot } from './trackProfileSnapshot';
import { trackStateStorySnapshot } from './trackStateSnapshot';

/**
 * The two maps of the whole circuit as Le Mans Ultimate feeds them, for
 * stories: the made-up endurance grid on the map of Le Mans that ships with
 * the app, with everything the widgets read under that sim set by hand.
 *
 * Nothing here is recorded. Where the cars are, who is in the pits, which
 * sector is under yellow and where the sectors start are all staged, so that
 * each story shows one state of the widget.
 */

/** The circuit the staged grid races at, and its length as the sim states it. */
const CIRCUIT = 'Circuit de la Sarthe';
const CIRCUIT_LENGTH_M = 13626;
/** LMU's track id is a number made from the name; any one will do here. */
const TRACK_ID = 1_000_000 + 24;

/**
 * Where the three sectors of the staged circuit start. Made up: no lap of Le
 * Mans has been recorded, and the sim publishes no such figure.
 */
export const LMU_MAP_STORY_SECTOR_STARTS: readonly number[] = [0, 0.237, 0.612];

const IN_PIT_STALL = 1;
const ON_TRACK = 3;

/** The staged grid with every car out on the circuit. */
export const LMU_STORY_CARS_ALL_ON_TRACK: readonly StoryGridCar[] =
  LMU_STORY_CARS.map((car) => ({
    ...car,
    inPits: false,
    inGarage: false,
    retired: false,
  }));

export interface LmuTrackMapStoryOptions {
  /** The widget the story is of, whose settings `config` changes. */
  widget: 'map' | 'flatmap';
  config?: Record<string, unknown>;
  cars?: readonly StoryGridCar[];
  /** False for a circuit the session has no outline of yet. */
  outline?: boolean;
  /** False while no clean lap has shown where the sectors start. */
  sectorsLearned?: boolean;
  /** Local yellow per sector, in driving order. */
  yellowSectors?: readonly boolean[];
  /** The player's sectors against the session's bests, for Sector Colors. */
  sectorColors?: SectorColor[];
  currentSectorIdx?: number;
  trackState?: Partial<TrackStateSnapshot>;
  /** The widget's box; the overlay gives each widget one. */
  box?: { width: number; height: number };
}

/**
 * The loaders-free parts of a story: decorators that set the session, the
 * dashboard, the channels and the sector timing the widget reads.
 */
export const lmuTrackMapStory = ({
  widget,
  config = {},
  cars = LMU_STORY_CARS_ALL_ON_TRACK,
  outline = true,
  sectorsLearned = true,
  yellowSectors = [false, false, false],
  sectorColors = [],
  currentSectorIdx = 0,
  trackState = {},
  box = { width: 800, height: 450 },
}: LmuTrackMapStoryOptions) => {
  const grid = buildStoryGrid(LMU_STORY_CLASSES, cars, {
    player: LMU_STORY_PLAYER,
  });
  const map = (lmuTrackMaps as unknown as Record<string, LmuTrackMap>)[CIRCUIT];
  const session = {
    ...grid.session,
    WeekendInfo: {
      ...grid.session.WeekendInfo,
      TrackID: TRACK_ID,
      TrackName: CIRCUIT,
      TrackLength: `${CIRCUIT_LENGTH_M} m`,
    },
    // As LMU's session carries them: three sectors at even thirds.
    SplitTimeInfo: {
      Sectors: [0, 1 / 3, 2 / 3].map((SectorStartPct, SectorNum) => ({
        SectorNum,
        SectorStartPct,
      })),
    },
    ...(outline ? { LmuTrackMap: map } : {}),
  } as Session;

  const stopped = (car: StoryGridCar) => !!(car.inPits || car.inGarage);
  const classPosition = new Map(
    grid.session.SessionInfo.Sessions[0].ResultsPositions?.map((result) => [
      result.CarIdx,
      result.ClassPosition + 1,
    ])
  );
  const trackStateSnapshot: TrackStateSnapshot = {
    ...trackStateStorySnapshot,
    focusCarIdx: grid.slotOf(LMU_STORY_PLAYER),
    carIdxLapDistPct: cars.map((car) => car.progress % 1),
    carIdxOnPitRoad: cars.map(stopped),
    carIdxTrackSurface: cars.map((car) =>
      stopped(car) ? IN_PIT_STALL : ON_TRACK
    ),
    carIdxClassPosition: cars.map((_, slot) => classPosition.get(slot) ?? 0),
    ...trackState,
  };
  const trackProfile: TrackProfileSnapshot = {
    ...emptyTrackProfileStorySnapshot,
    trackKey: `lmu:${TRACK_ID}`,
    trackLengthM: CIRCUIT_LENGTH_M,
    sectorStartPct: sectorsLearned
      ? LMU_MAP_STORY_SECTOR_STARTS
      : [0, 1 / 3, 2 / 3],
    sectorSource: sectorsLearned ? 'learned' : 'nominal',
  };
  const bridge: DashboardBridge = {
    ...createMockBridgeWithConfig({ [widget]: config }),
    getActiveSimulator: async () => 'lmu',
  };

  const Staged = ({ Story }: { Story: ComponentType }) => {
    // In a layout effect, so the story before this one has let go of the
    // stores before they are set, and has not done so after.
    useLayoutEffect(() => {
      useSessionStore.setState({ session });
      useSectorTimingStore.setState({ sectorColors, currentSectorIdx });
      return () => {
        useSectorTimingStore.getState().reset();
        // Left alone where the next story has already put its own in.
        if (useSessionStore.getState().session === session) {
          useSessionStore.setState({ session: null });
        }
      };
    }, []);
    return <Story />;
  };

  return {
    decorators: [
      (Story: ComponentType) => (
        <DashboardProvider bridge={bridge}>
          {/* A mid-grey box stands in for the sim behind the widget. */}
          <div style={{ ...box, background: '#475569' }}>
            <Staged Story={Story} />
          </div>
        </DashboardProvider>
      ),
      ChannelSnapshotDecorator({
        'track-state.snapshot': trackStateSnapshot,
        'standings.snapshot': grid.standings,
        'track-profile.snapshot': trackProfile,
        'flag-state.snapshot': {
          ...EMPTY_FLAG_STATE,
          kind: yellowSectors.includes(true) ? 'yellow' : 'green',
          detail: yellowSectors.includes(true)
            ? 'yellowElsewhere'
            : 'trackClear',
          yellowSectors,
          playerSector: 1,
          sessionNum: 0,
          version: 1,
        },
      }),
    ],
  };
};
