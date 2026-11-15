import type { ComponentType } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import {
  ChannelSnapshotDecorator,
  LMU_STORY_CARS,
  LMU_STORY_CLASSES,
  LMU_STORY_PLAYER,
  buildStoryGrid,
  createMockBridgeWithConfig,
  lmuEnduranceGrid,
  singleClassGrid,
  trackStateStorySnapshot,
  type StoryGrid,
} from '@irdashies/storybook';
import { DashboardProvider, useSessionStore } from '@irdashies/context';
import type {
  ClassFieldsConfig,
  DashboardBridge,
  TrackStateSnapshot,
} from '@irdashies/types';
import { ClassFields } from './ClassFields';

/** The widget's default box: stories show what the driver gets. */
const BOX = { width: 330, height: 44 };

interface StoryOptions {
  config?: Partial<ClassFieldsConfig>;
  trackState?: Partial<TrackStateSnapshot>;
  box?: { width: number; height: number };
}

const story = (
  grid: StoryGrid,
  { config = {}, trackState = {}, box = BOX }: StoryOptions = {}
) => {
  const bridge: DashboardBridge = {
    ...createMockBridgeWithConfig({ classfields: config }),
    getActiveSimulator: async () => 'lmu',
  };
  return {
    // The classes, their names and colours and the cars entered.
    loaders: [
      async () => {
        useSessionStore.setState({ session: grid.session });
      },
    ],
    decorators: [
      (Story: ComponentType) => (
        <DashboardProvider bridge={bridge}>
          {/* The overlay clips each widget to its own box, as here. */}
          <div style={{ ...box, contain: 'layout style paint' }}>
            <Story />
          </div>
        </DashboardProvider>
      ),
      ChannelSnapshotDecorator({
        'standings.snapshot': grid.standings,
        'track-state.snapshot': { ...trackStateStorySnapshot, ...trackState },
      }),
    ],
  };
};

const meta: Meta<typeof ClassFields> = {
  component: ClassFields,
  title: 'widgets/ClassFields',
};

export default meta;

type Story = StoryObj<typeof ClassFields>;

/**
 * A three-class endurance race, two hours in: every Hypercar and LMP2 still
 * running, one LMGT3 retired. The player's class is outlined.
 */
export const ThreeClasses: Story = { ...story(lmuEnduranceGrid) };

/** With the cars out of the running and the cars in the pit lane shown. */
export const CarsOutAndInThePits: Story = {
  ...story(lmuEnduranceGrid, {
    config: { showInactive: true, showInPitLane: true },
    box: { width: 400, height: 44 },
  }),
};

/** The cars running alone, without the cars entered. */
export const RunningOnly: Story = {
  ...story(lmuEnduranceGrid, {
    config: { showTotal: false },
    box: { width: 270, height: 44 },
  }),
};

/** One class under another, the labels on one grid so the counts line up. */
export const Column: Story = {
  ...story(lmuEnduranceGrid, {
    config: { orientation: 'vertical', showInactive: true },
    box: { width: 170, height: 104 },
  }),
};

/** Only two chips fit: the player's class takes the last place shown. */
export const TwoClassesShown: Story = {
  ...story(lmuEnduranceGrid, {
    config: { maxClasses: 2 },
    box: { width: 230, height: 44 },
  }),
};

/**
 * Watching a Hypercar while a team-mate drives: the summary stays on screen
 * with "show only when on track" set, and outlines the watched car's class.
 */
export const WatchingAnotherClass: Story = {
  ...story(
    buildStoryGrid(LMU_STORY_CLASSES, LMU_STORY_CARS, {
      player: LMU_STORY_PLAYER,
      watching: '8',
    }),
    {
      config: { showOnlyWhenOnTrack: true },
      trackState: { isOnTrack: false, outOfCar: true, watching: true },
    }
  ),
};

/** The order the Standings list the classes in: fastest class first. */
export const ByClassSpeed: Story = {
  ...story(
    // An LMP2 leads overall while the Hypercars are a lap down after a stop.
    buildStoryGrid(
      LMU_STORY_CLASSES,
      LMU_STORY_CARS.map((car) =>
        car.carClass === 'Hypercar'
          ? { ...car, progress: car.progress - 2 }
          : car
      ),
      { player: LMU_STORY_PLAYER }
    ),
    { config: { order: 'classSpeed' } }
  ),
};

/** The same race ordered by the leaders' places: the LMP2 class first. */
export const ByLeaderPlace: Story = {
  ...story(
    buildStoryGrid(
      LMU_STORY_CLASSES,
      LMU_STORY_CARS.map((car) =>
        car.carClass === 'Hypercar'
          ? { ...car, progress: car.progress - 2 }
          : car
      ),
      { player: LMU_STORY_PLAYER }
    )
  ),
};

/** A single-class race: one chip, in the highlight colour, nothing outlined. */
export const SingleClass: Story = {
  ...story(singleClassGrid, {
    config: { showInactive: true, showInPitLane: true },
    box: { width: 190, height: 44 },
  }),
};
