import type { Meta, StoryObj } from '@storybook/react-vite';
import { DashboardProvider } from '@irdashies/context';
import { mockDashboardBridge } from '@irdashies/storybook';
import { FlagPanelSettings } from './FlagPanelSettings';

const meta = {
  title: 'components/Settings/FlagPanelSettings',
  component: FlagPanelSettings,
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
} satisfies Meta<typeof FlagPanelSettings>;
export default meta;
type Story = StoryObj<typeof meta>;

/** The card, the blue flag, the yellow ranges and the states to show. */
export const Options: Story = {
  decorators: [
    (Story) => {
      localStorage.setItem('flagPanelTab', 'options');
      return <Story />;
    },
  ],
};

/** The sessions the panel shows in, and whether it hides off track. */
export const Visibility: Story = {
  decorators: [
    (Story) => {
      localStorage.setItem('flagPanelTab', 'visibility');
      return <Story />;
    },
  ],
};
