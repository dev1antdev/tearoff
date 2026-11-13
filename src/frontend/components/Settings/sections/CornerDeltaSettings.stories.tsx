import type { Meta, StoryObj } from '@storybook/react-vite';
import { DashboardProvider } from '@irdashies/context';
import { mockDashboardBridge } from '@irdashies/storybook';
import { CornerDeltaSettings } from './CornerDeltaSettings';

const meta = {
  title: 'components/Settings/CornerDeltaSettings',
  component: CornerDeltaSettings,
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
} satisfies Meta<typeof CornerDeltaSettings>;
export default meta;
type Story = StoryObj<typeof meta>;

/** What to compare with, how a corner is drawn, and the two speeds. */
export const Options: Story = {
  decorators: [
    (Story) => {
      localStorage.setItem('cornerDeltaTab', 'options');
      return <Story />;
    },
  ],
};

/** The sessions the widget shows in, and whether it hides off track. */
export const Visibility: Story = {
  decorators: [
    (Story) => {
      localStorage.setItem('cornerDeltaTab', 'visibility');
      return <Story />;
    },
  ],
};
