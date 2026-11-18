import type { Meta, StoryObj } from '@storybook/react-vite';
import { DashboardProvider } from '@irdashies/context';
import { mockDashboardBridge } from '@irdashies/storybook';
import { TachometerSettings } from './TachometerSettings';
import { dashboardBridgeWith, ShowSection } from './settingsStory';

const meta = {
  title: 'components/Settings/TachometerSettings',
  component: TachometerSettings,
  decorators: [
    (Story) => (
      <DashboardProvider bridge={mockDashboardBridge}>
        <div className="h-[760px] w-[880px] overflow-y-auto bg-slate-900 p-6 text-white">
          <Story />
        </div>
      </DashboardProvider>
    ),
  ],
  parameters: { layout: 'centered' },
} satisfies Meta<typeof TachometerSettings>;
export default meta;
type Story = StoryObj<typeof meta>;

/** A car whose LED thresholds were set by hand. */
export const LedThresholds: Story = {
  decorators: [
    (Story) => {
      localStorage.setItem('tachometerTab', 'options');
      return (
        <ShowSection title="LED Thresholds">
          <Story />
        </ShowSection>
      );
    },
  ],
  render: () => (
    <DashboardProvider
      bridge={dashboardBridgeWith('tachometer', {
        ledRpmOverrides: {
          'Ferrari 296 LMGT3': {
            carName: 'Ferrari 296 LMGT3',
            firstRpm: 6000,
            fullRpm: 7000,
            blinkRpm: 7200,
          },
        },
      })}
    >
      <TachometerSettings />
    </DashboardProvider>
  ),
};
