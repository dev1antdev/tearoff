import type { Meta, StoryObj } from '@storybook/react-vite';
import { STORY_DEVICE_KEY as STORY_KEY } from '@irdashies/storybook';
import { BrowserLinkField } from './BrowserLinkField';

const meta: Meta<typeof BrowserLinkField> = {
  component: BrowserLinkField,
  title: 'components/BrowserLinkField',
  decorators: [
    (Story) => (
      <div className="settings-shell w-[720px] bg-slate-900 p-6 text-white">
        <Story />
      </div>
    ),
  ],
  parameters: { layout: 'centered' },
};

export default meta;
type Story = StoryObj<typeof meta>;

/** A link for this PC: nothing in it to hide. */
export const ForThisPC: Story = {
  args: {
    label: 'Pit Wall link for this PC',
    url: 'http://localhost:3000/pitwall',
  },
};

/**
 * A link for another device. The key in it is drawn as dots until Show key
 * is pressed; Copy takes the whole link either way.
 */
export const ForOtherDevices: Story = {
  args: {
    label: 'Pit Wall link for other devices',
    url: `http://192.168.1.50:3000/pitwall?key=${STORY_KEY}`,
    secret: STORY_KEY,
    primary: true,
  },
};

/** With its own word on the button, as the Profiles page uses it. */
export const CopyForObs: Story = {
  args: {
    label: "Browser source URL by this PC's network address",
    url: `http://192.168.1.50:3000/dashboard?profile=default&key=${STORY_KEY}`,
    secret: STORY_KEY,
    copyLabel: 'Copy for OBS',
    primary: true,
  },
};
