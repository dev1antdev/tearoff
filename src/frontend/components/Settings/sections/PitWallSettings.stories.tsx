import type { Meta, StoryObj } from '@storybook/react-vite';
import {
  BrowserAccessDecorator,
  storyAccessOpen,
  storyAccessThisPcOnly,
} from '@irdashies/storybook';
import { PitWallSettings } from './PitWallSettings';

const meta = {
  title: 'components/Settings/PitWallSettings',
  component: PitWallSettings,
  decorators: [
    (Story) => {
      // No window can be opened from a story: the button answers as it does
      // while the widget is switched off, which shows its hint.
      window.pitWallBridge = { showWindow: async () => false };
      return <Story />;
    },
  ],
  parameters: { layout: 'centered' },
} satisfies Meta<typeof PitWallSettings>;
export default meta;
type Story = StoryObj<typeof meta>;

/**
 * The window, the layout, the page's scale, the page in a browser, and what
 * this stage is. Network access is off, as on a new install: the browser
 * rows show the link for this PC and say where the switch is.
 */
export const Options: Story = {
  decorators: [
    BrowserAccessDecorator(
      storyAccessThisPcOnly,
      { enableNetworkAccess: false },
      'h-[1500px] w-[880px]'
    ),
  ],
};

/**
 * Network access on: the browser rows add the link for other devices, with
 * its key drawn as dots, the devices connected and the new key button.
 */
export const NetworkAccessOn: Story = {
  decorators: [
    BrowserAccessDecorator(
      storyAccessOpen,
      { enableNetworkAccess: true },
      'h-[1500px] w-[880px]'
    ),
  ],
};
