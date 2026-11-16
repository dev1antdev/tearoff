import type { Meta, StoryObj } from '@storybook/react-vite';
import {
  BrowserAccessDecorator,
  storyAccessOpen,
  storyAccessThisPcOnly,
} from '@irdashies/storybook';
import { PitWallBrowserAccess } from './PitWallBrowserAccess';

const meta = {
  title: 'components/Settings/PitWallBrowserAccess',
  component: PitWallBrowserAccess,
  parameters: { layout: 'centered' },
} satisfies Meta<typeof PitWallBrowserAccess>;
export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Network access off, as a new install has it: the link for this PC, and a
 * line that says where the switch for other devices is.
 */
export const NetworkAccessOff: Story = {
  decorators: [
    BrowserAccessDecorator(storyAccessThisPcOnly, {
      enableNetworkAccess: false,
    }),
  ],
};

/**
 * Network access on: the link for other devices with its key drawn as dots,
 * how many are connected, and the button that makes a new key.
 */
export const NetworkAccessOn: Story = {
  decorators: [
    BrowserAccessDecorator(storyAccessOpen, { enableNetworkAccess: true }),
  ],
};

/** The switch was turned on and Tearoff has not been restarted since. */
export const RestartPending: Story = {
  decorators: [
    BrowserAccessDecorator(storyAccessThisPcOnly, {
      enableNetworkAccess: true,
    }),
  ],
};

/** Network access on, on a PC that is on no network. */
export const NoNetworkAddress: Story = {
  decorators: [
    BrowserAccessDecorator(
      { ...storyAccessOpen, host: null, devices: 0 },
      { enableNetworkAccess: true }
    ),
  ],
};

/** The built-in web server is switched off: there is no page to link to. */
export const WebServerOff: Story = {
  decorators: [
    BrowserAccessDecorator(
      { ...storyAccessThisPcOnly, listening: false },
      { enableWebServer: false }
    ),
  ],
};
