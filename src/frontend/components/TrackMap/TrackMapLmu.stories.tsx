import type { Meta, StoryObj } from '@storybook/react-vite';
import { LMU_STORY_CARS, lmuTrackMapStory } from '@irdashies/storybook';
import { TrackMapWidget } from './MapWidgets';

/**
 * The Track Map under Le Mans Ultimate: the made-up endurance grid of six
 * Hypercars, five LMP2 and eight LMGT3 on the map of Le Mans that ships with
 * the app, the player in LMGT3 number 77.
 *
 * The widget is mounted as the overlay mounts it, so each story goes through
 * the choice of which sim's map to draw. Everything it reads is staged.
 */
const meta: Meta<typeof TrackMapWidget> = {
  component: TrackMapWidget,
  title: 'widgets/TrackMap/Le Mans Ultimate',
};

export default meta;

type Story = StoryObj<typeof TrackMapWidget>;

/** Under green: every car on the circuit, coloured by class, the player's amber. */
export const Green: Story = {
  ...lmuTrackMapStory({ widget: 'map' }),
};

/**
 * A local yellow in the second sector, painted over the whole width of the
 * road between the places the car was seen entering and leaving that sector.
 */
export const YellowSector: Story = {
  ...lmuTrackMapStory({
    widget: 'map',
    yellowSectors: [false, true, false],
  }),
};

/**
 * One LMP2 stopped at its box and one LMGT3 back in its garage: both grey,
 * lettered P, and drawn under the cars that are racing.
 */
export const CarInThePits: Story = {
  ...lmuTrackMapStory({ widget: 'map', cars: LMU_STORY_CARS }),
};

/**
 * A circuit with no bundled map, before a lap of it has been driven: the
 * widget says why its box is empty.
 */
export const NoOutlineYet: Story = {
  ...lmuTrackMapStory({ widget: 'map', outline: false }),
};

/**
 * Sector Colors switched on at a circuit whose sectors have been learned: the
 * first sector a session best, the second being driven, the third off the
 * pace, with a tick where each begins.
 */
export const SectorColors: Story = {
  ...lmuTrackMapStory({
    widget: 'map',
    config: { sectorColoring: { enabled: true } },
    sectorColors: ['purple', 'default', 'red'],
    currentSectorIdx: 1,
  }),
};

/**
 * The same settings and a yellow in the second sector, at a circuit no clean
 * lap has been driven on yet. Where the sectors start is not known, so no
 * tick, no colour and no yellow stretch is drawn: the sim's even thirds would
 * put all three in the wrong place.
 */
export const SectorsNotLearnedYet: Story = {
  ...lmuTrackMapStory({
    widget: 'map',
    config: { sectorColoring: { enabled: true } },
    sectorsLearned: false,
    yellowSectors: [false, true, false],
    sectorColors: ['purple', 'default', 'red'],
    currentSectorIdx: 1,
  }),
};

/** Corner numbers and names, which the bundled map of Le Mans carries. */
export const TurnLabels: Story = {
  ...lmuTrackMapStory({
    widget: 'map',
    config: {
      turnLabels: {
        enabled: true,
        labelType: 'numbers',
        highContrast: true,
        labelFontSize: 100,
      },
    },
  }),
};
