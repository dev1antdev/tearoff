import type { Meta, StoryObj } from '@storybook/react-vite';
import { DashboardProvider } from '@irdashies/context';
import { mockDashboardBridge } from '@irdashies/storybook';
import { RaceLogSettings } from './RaceLogSettings';

const meta = {
  title: 'components/Settings/RaceLogSettings',
  component: RaceLogSettings,
  decorators: [
    (Story) => (
      <DashboardProvider bridge={mockDashboardBridge}>
        <div className="h-[1250px] w-[880px] bg-slate-900 p-6 text-white">
          <Story />
        </div>
      </DashboardProvider>
    ),
  ],
  parameters: { layout: 'centered' },
} satisfies Meta<typeof RaceLogSettings>;
export default meta;
type Story = StoryObj<typeof meta>;

/** The page from the top: what the log is, and what the list opens with. */
export const Options: Story = {
  decorators: [
    (Story) => {
      localStorage.setItem('raceLogTab', 'options');
      return <Story />;
    },
  ],
};

/** The sessions it shows in, and off track or not. */
export const Visibility: Story = {
  decorators: [
    (Story) => {
      localStorage.setItem('raceLogTab', 'visibility');
      return <Story />;
    },
  ],
};
