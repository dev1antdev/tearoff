import type { Meta, StoryObj } from '@storybook/react-vite';
import { LMU_STORY_CARS, lmuTrackMapStory } from '@irdashies/storybook';
import { FlatTrackMapWidget } from './MapWidgets';

/**
 * The Flat Track Map under Le Mans Ultimate: the made-up endurance grid laid
 * out along one lap of Le Mans, the player in LMGT3 number 77.
 *
 * The widget is mounted as the overlay mounts it, so each story goes through
 * the choice of which sim's map to draw. Everything it reads is staged.
 */
const meta: Meta<typeof FlatTrackMapWidget> = {
  component: FlatTrackMapWidget,
  title: 'widgets/FlatTrackMap/Le Mans Ultimate',
};

export default meta;

type Story = StoryObj<typeof FlatTrackMapWidget>;

/** The widget's own box, as the default dashboard places it. */
const BOX = { width: 800, height: 150 };

/** Under green: every car by its place on the lap, coloured by class. */
export const Green: Story = {
  ...lmuTrackMapStory({ widget: 'flatmap', box: BOX }),
};

/** A local yellow in the second sector, between where that sector starts and ends. */
export const YellowSector: Story = {
  ...lmuTrackMapStory({
    widget: 'flatmap',
    box: BOX,
    yellowSectors: [false, true, false],
  }),
};

/** One LMP2 at its box and one LMGT3 in its garage: both grey and lettered P. */
export const CarInThePits: Story = {
  ...lmuTrackMapStory({ widget: 'flatmap', box: BOX, cars: LMU_STORY_CARS }),
};

/**
 * A circuit the session has no outline of yet. The lap is a straight line
 * whatever the circuit, so this map is drawn all the same.
 */
export const NoOutlineYet: Story = {
  ...lmuTrackMapStory({ widget: 'flatmap', box: BOX, outline: false }),
};

/**
 * A yellow in the second sector at a circuit no clean lap has been driven on
 * yet: where that sector lies is not known, so no stretch is painted.
 */
export const SectorsNotLearnedYet: Story = {
  ...lmuTrackMapStory({
    widget: 'flatmap',
    box: BOX,
    sectorsLearned: false,
    yellowSectors: [false, true, false],
  }),
};
