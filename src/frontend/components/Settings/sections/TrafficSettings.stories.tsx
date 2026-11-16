import type { Meta, StoryObj } from '@storybook/react-vite';
import { DashboardProvider } from '@irdashies/context';
import { mockDashboardBridge } from '@irdashies/storybook';
import { TrafficSettings } from './TrafficSettings';

const meta = {
  title: 'components/Settings/TrafficSettings',
  component: TrafficSettings,
  decorators: [
    (Story) => (
      <DashboardProvider bridge={mockDashboardBridge}>
        <div className="h-[1900px] w-[880px] bg-slate-900 p-6 text-white">
          <Story />
        </div>
      </DashboardProvider>
    ),
  ],
  parameters: { layout: 'centered' },
} satisfies Meta<typeof TrafficSettings>;
export default meta;
type Story = StoryObj<typeof meta>;

/** The cars behind, the forecast, the table of laps and the pit exit. */
export const Options: Story = {
  decorators: [
    (Story) => {
      localStorage.setItem('trafficTab', 'options');
      return <Story />;
    },
  ],
};

/** The sessions it shows in, and whether it hides off track. */
export const Visibility: Story = {
  decorators: [
    (Story) => {
      localStorage.setItem('trafficTab', 'visibility');
      return <Story />;
    },
  ],
};
