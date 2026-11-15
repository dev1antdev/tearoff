import type { Meta, StoryObj } from '@storybook/react-vite';
import { DashboardProvider } from '@irdashies/context';
import { mockDashboardBridge } from '@irdashies/storybook';
import { getWidgetDefaultConfig } from '@irdashies/types';
import { TimingSettings } from './TimingSettings';
import { dashboardBridgeWith, ShowSection } from './settingsStory';

const meta = {
  title: 'components/Settings/TimingSettings',
  component: TimingSettings,
  decorators: [
    (Story) => (
      <DashboardProvider bridge={mockDashboardBridge}>
        <div className="h-[760px] w-[880px] bg-slate-900 p-6 text-white">
          <Story />
        </div>
      </DashboardProvider>
    ),
  ],
  parameters: { layout: 'centered' },
} satisfies Meta<typeof TimingSettings>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Which tiles are drawn, what they are measured against and how they read. */
export const Options: Story = {
  decorators: [
    (Story) => {
      localStorage.setItem('timingTab', 'options');
      return <Story />;
    },
  ],
};

/**
 * Further down the page: the stint best among the optional tiles, and the
 * stint best chosen as the lap the delta is measured against.
 */
export const StintBest: Story = {
  decorators: [
    (Story) => {
      localStorage.setItem('timingTab', 'options');
      return (
        <ShowSection title="More Tiles">
          <Story />
        </ShowSection>
      );
    },
  ],
  render: () => (
    <DashboardProvider
      bridge={dashboardBridgeWith('timing', {
        deltaReference: 'stintBest',
        tiles: {
          ...getWidgetDefaultConfig('timing').tiles,
          stintBest: true,
        },
      })}
    >
      <TimingSettings />
    </DashboardProvider>
  ),
};

/** The sessions the widget shows in, and whether it hides off track. */
export const Visibility: Story = {
  decorators: [
    (Story) => {
      localStorage.setItem('timingTab', 'visibility');
      return <Story />;
    },
  ],
};
