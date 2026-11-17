import type { Meta, StoryObj } from '@storybook/react-vite';
import { PressButtons } from '@irdashies/storybook';
import { PitWallEditBar, type PitWallAddable } from './PitWallEditBar';

const ADDABLE: PitWallAddable[] = [
  {
    widget: 'stinttimeline',
    title: 'Stint Timeline',
    kind: 'panel',
    size: { w: 4, h: 3 },
    hasRoom: true,
  },
  {
    widget: 'carlaps',
    title: 'Car Laps',
    kind: 'panel',
    size: { w: 4, h: 3 },
    hasRoom: true,
  },
  {
    widget: 'weatherforecast',
    title: 'Weather Forecast',
    kind: 'panel',
    size: { w: 3, h: 2 },
    hasRoom: true,
    note: 'not under iRacing',
  },
  {
    widget: 'standings',
    title: 'Standings',
    kind: 'overlay',
    size: { w: 6, h: 3 },
    hasRoom: false,
  },
  {
    widget: 'fuel',
    title: 'Fuel Calculator',
    kind: 'overlay',
    size: { w: 3, h: 3 },
    hasRoom: true,
  },
  {
    widget: 'weather',
    title: 'Weather',
    kind: 'overlay',
    size: { w: 2, h: 3 },
    hasRoom: true,
  },
];

const meta: Meta<typeof PitWallEditBar> = {
  component: PitWallEditBar,
  title: 'widgets/PitWall/PitWallEditBar',
  parameters: { layout: 'fullscreen' },
  args: {
    addable: ADDABLE,
    message: '',
    hintId: 'pit-wall-edit-hint',
    onAdd: () => true,
    onReset: () => undefined,
    onCancel: () => undefined,
    onDone: () => undefined,
  },
  decorators: [
    (Story) => (
      // Room under the bar for the list it hangs out.
      <div className="h-[460px] w-[1280px] bg-settings-page">
        <Story />
      </div>
    ),
  ],
};
export default meta;
type Story = StoryObj<typeof PitWallEditBar>;

/** The bar as an edit begins: how it is done, and the four things to do. */
export const Idle: Story = {};

/**
 * The Add panel list: the panels of the fixed layouts, then the widgets of
 * the overlay, each with the size it is added at, a note where the running
 * sim cannot show it, and "no room" where the page has no place for it.
 */
export const AddPanelList: Story = {
  render: (args) => (
    <PressButtons labels={['Add panel']}>
      <PitWallEditBar {...args} />
    </PressButtons>
  ),
};

/** Everything the page can host is on it: the list says so. */
export const NothingToAdd: Story = {
  args: { addable: [] },
  render: (args) => (
    <PressButtons labels={['Add panel']}>
      <PitWallEditBar {...args} />
    </PressButtons>
  ),
};

/** What the last thing asked for could not be given, where the words on how an edit is done were. */
export const WithMessage: Story = {
  args: {
    message:
      'No room for Standings: it needs 6 by 3 free cells. Move, size or remove a panel to make room.',
  },
};

/** Reset asks before it brings back the copy of Race. */
export const AskingToReset: Story = {
  render: (args) => (
    <PressButtons labels={['Reset']}>
      <PitWallEditBar {...args} />
    </PressButtons>
  ),
};

/** At the least width the window has, 900: the bar wraps onto two lines. */
export const Narrow: Story = {
  decorators: [
    (Story) => (
      <div className="w-[900px]">
        <Story />
      </div>
    ),
  ],
};
