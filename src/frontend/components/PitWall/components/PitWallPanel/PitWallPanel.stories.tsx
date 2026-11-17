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

const noop = () => undefined;
const arranging = {
  held: false,
  describedBy: undefined,
  onMoveStart: noop,
  onSizeStart: noop,
  onKeyDown: noop,
  onRemove: noop,
};

/**
 * While the page is arranged: the title bar is the handle the panel is
 * moved by, with its size beside the name and a cross that takes it off the
 * page; the corner is the handle it is sized by; and the body shows the
 * name and the size in place of the widget, which is still there, unseen.
 */
export const Arranging: Story = {
  args: {
    ...Titled.args,
    onOpenSettings: undefined,
    cells: { x: 0, y: 0, w: 6, h: 5 },
    edit: arranging,
  },
};

/** Held by the pointer: dimmed, where it was, until it is let go of. */
export const ArrangingHeld: Story = {
  args: { ...Arranging.args, edit: { ...arranging, held: true } },
};

/** A panel the running sim cannot show is there to be moved, and says why it is not seen. */
export const ArrangingUnsupported: Story = {
  args: {
    ...Arranging.args,
    title: 'Weather Forecast',
    edit: { ...arranging, note: 'Not shown under iRacing' },
  },
};

/** At its least size the title is cut short and the handles keep their place. */
export const ArrangingSmall: Story = {
  args: {
    ...Arranging.args,
    title: 'Crew and Stints',
    cells: { x: 0, y: 0, w: 4, h: 4 },
  },
  decorators: [
    (Story) => (
      <div className="grid h-[150px] w-[190px]">
        <Story />
      </div>
    ),
  ],
};
