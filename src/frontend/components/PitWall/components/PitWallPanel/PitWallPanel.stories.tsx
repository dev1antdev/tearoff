import type { Meta, StoryObj } from '@storybook/react-vite';
import { PitWallPanel, PitWallPanelNote } from './PitWallPanel';

const meta: Meta<typeof PitWallPanel> = {
  component: PitWallPanel,
  title: 'widgets/PitWall/PitWallPanel',
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => (
      // A grid, as the page is: the panel takes the size of its cell.
      <div className="grid h-[320px] w-[460px] bg-settings-page p-3">
        <Story />
      </div>
    ),
  ],
};
export default meta;
type Story = StoryObj<typeof PitWallPanel>;

/** A frame around a body in the overlay's look, with a gear for its widget. */
export const Titled: Story = {
  args: {
    title: 'Fuel Calculator',
    onOpenSettings: () => undefined,
    children: (
      <div className="h-full bg-slate-800/80 p-3 text-sm text-white">
        The hosted widget fills the body of the panel.
      </div>
    ),
  },
};

/** Without anything to open, the frame has no button. */
export const WithoutSettings: Story = {
  args: { ...Titled.args, onOpenSettings: undefined },
};

/** A long title is cut short rather than pushing the gear out of the frame. */
export const LongTitle: Story = {
  args: {
    ...Titled.args,
    title: 'A panel with a name far too long for the space it has been given',
  },
  decorators: [
    (Story) => (
      <div className="grid w-[240px]">
        <Story />
      </div>
    ),
  ],
};

/**
 * Stacked, as on a phone: the panels are one under another in a page that
 * scrolls, each at least the height it is given.
 */
export const Stacked: Story = {
  args: { ...Titled.args, basis: 'min(240px, 86%)' },
  decorators: [
    (Story) => (
      <div className="flex h-[480px] w-[390px] flex-col gap-3 overflow-y-auto">
        <Story />
        <Story />
        <Story />
      </div>
    ),
  ],
};

/** What a panel says when the profile has no widget for it. */
export const MissingWidget: Story = {
  args: {
    title: 'Weather',
    onOpenSettings: () => undefined,
    children: (
      <PitWallPanelNote
        message="This profile has no Weather widget."
        action={{ label: 'Open Weather settings', onClick: () => undefined }}
      />
    ),
  },
};
