import type { Meta, StoryObj } from '@storybook/react-vite';
import { PIT_WALL_GAP_PX } from '@irdashies/types';
import {
  PIT_WALL_CELL_TRACKS,
  PitWallEditCells,
  PitWallEditTarget,
} from './PitWallEditGrid';

const meta: Meta<typeof PitWallEditTarget> = {
  component: PitWallEditTarget,
  title: 'widgets/PitWall/PitWallEditGrid',
  parameters: { layout: 'fullscreen' },
  args: { cells: { x: 14, y: 2, w: 6, h: 5 }, verdict: 'fits' },
  decorators: [
    (Story) => (
      // The page's grid as it is while arranged: every cell a track, the
      // cells drawn behind, and the mark placed by its cells.
      <div
        className="relative grid h-[560px] w-[1100px] bg-settings-page"
        style={{
          ...PIT_WALL_CELL_TRACKS,
          gap: PIT_WALL_GAP_PX,
          padding: PIT_WALL_GAP_PX,
        }}
      >
        <PitWallEditCells />
        <Story />
      </div>
    ),
  ],
};
export default meta;
type Story = StoryObj<typeof PitWallEditTarget>;

/** Where the panel held would land, and may: its cells in green, with its size. */
export const Fits: Story = {};

/** Cells another panel has: red, with a word of why. */
export const Overlap: Story = { args: { verdict: 'overlap' } };

/** A size under the least the widget may have. */
export const TooSmall: Story = {
  args: { cells: { x: 14, y: 2, w: 2, h: 2 }, verdict: 'small' },
};

/** Half off the page: only the part on it is marked. */
export const OffThePage: Story = {
  args: { cells: { x: 21, y: 13, w: 6, h: 5 }, verdict: 'outside' },
};

/** Wholly off the page there is nothing to mark: the cells alone. */
export const NothingToMark: Story = {
  args: { cells: { x: 30, y: 2, w: 6, h: 5 }, verdict: 'outside' },
};
