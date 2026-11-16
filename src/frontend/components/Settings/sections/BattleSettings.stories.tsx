import type { Meta, StoryObj } from '@storybook/react-vite';
import { DashboardProvider } from '@irdashies/context';
import { mockDashboardBridge } from '@irdashies/storybook';
import { BattleSettings } from './BattleSettings';

const meta = {
  title: 'components/Settings/BattleSettings',
  component: BattleSettings,
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
} satisfies Meta<typeof BattleSettings>;
export default meta;
type Story = StoryObj<typeof meta>;

/** The columns of a rival's row, each with what it shows, in their order. */
export const Columns: Story = {
  decorators: [
    (Story) => {
      localStorage.setItem('battleTab', 'display');
      return <Story />;
    },
  ],
};

/** The column labels, the background and whether it hides off track. */
export const Options: Story = {
  decorators: [
    (Story) => {
      localStorage.setItem('battleTab', 'options');
      return <Story />;
    },
  ],
};
