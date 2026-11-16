import type { Meta, StoryObj } from '@storybook/react-vite';
import { DashboardProvider } from '@irdashies/context';
import { mockDashboardBridge } from '@irdashies/storybook';
import { CarLapsSettings } from './CarLapsSettings';

const meta = {
  title: 'components/Settings/CarLapsSettings',
  component: CarLapsSettings,
  decorators: [
    (Story) => (
      <DashboardProvider bridge={mockDashboardBridge}>
        <div className="h-[1000px] w-[880px] bg-slate-900 p-6 text-white">
          <Story />
        </div>
      </DashboardProvider>
    ),
  ],
  parameters: { layout: 'centered' },
} satisfies Meta<typeof CarLapsSettings>;
export default meta;
type Story = StoryObj<typeof meta>;

/** The page from the top: what it is, and what it draws. */
export const Options: Story = {
  decorators: [
    (Story) => {
      localStorage.setItem('carLapsTab', 'options');
      return <Story />;
    },
  ],
};

/** The sessions it shows in, and off track or not. */
export const Visibility: Story = {
  decorators: [
    (Story) => {
      localStorage.setItem('carLapsTab', 'visibility');
      return <Story />;
    },
  ],
};
