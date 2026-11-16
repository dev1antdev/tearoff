import type { Meta, StoryObj } from '@storybook/react-vite';
import { DashboardProvider } from '@irdashies/context';
import { mockDashboardBridge } from '@irdashies/storybook';
import { TimingTowerSettings } from './TimingTowerSettings';

const meta = {
  title: 'components/Settings/TimingTowerSettings',
  component: TimingTowerSettings,
  decorators: [
    (Story) => (
      <DashboardProvider bridge={mockDashboardBridge}>
        <div className="h-[1500px] w-[880px] bg-slate-900 p-6 text-white">
          <Story />
        </div>
      </DashboardProvider>
    ),
  ],
  parameters: { layout: 'centered' },
} satisfies Meta<typeof TimingTowerSettings>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Every column of the tower with what it shows, in the order drawn. */
export const Columns: Story = {
  decorators: [
    (Story) => {
      localStorage.setItem('timingTowerTab', 'display');
      return <Story />;
    },
  ],
};

/**
 * What the two switches of the tower's header start from, each with what
 * it means, and the background.
 */
export const Options: Story = {
  decorators: [
    (Story) => {
      localStorage.setItem('timingTowerTab', 'options');
      return <Story />;
    },
  ],
};

/** The sessions the tower shows in, and whether it hides off track. */
export const Visibility: Story = {
  decorators: [
    (Story) => {
      localStorage.setItem('timingTowerTab', 'visibility');
      return <Story />;
    },
  ],
};
