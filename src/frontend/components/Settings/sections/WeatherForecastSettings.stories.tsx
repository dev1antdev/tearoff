import type { Meta, StoryObj } from '@storybook/react-vite';
import { DashboardProvider } from '@irdashies/context';
import { mockDashboardBridge } from '@irdashies/storybook';
import { WeatherForecastSettings } from './WeatherForecastSettings';

const meta = {
  title: 'components/Settings/WeatherForecastSettings',
  component: WeatherForecastSettings,
  decorators: [
    (Story) => (
      <DashboardProvider bridge={mockDashboardBridge}>
        <div className="h-[1240px] w-[880px] bg-slate-900 p-6 text-white">
          <Story />
        </div>
      </DashboardProvider>
    ),
  ],
  parameters: { layout: 'centered' },
} satisfies Meta<typeof WeatherForecastSettings>;
export default meta;
type Story = StoryObj<typeof meta>;

/**
 * The columns, how a point's start is written and what is assumed about it,
 * and the rows of a column.
 */
export const Options: Story = {
  decorators: [
    (Story) => {
      localStorage.setItem('weatherForecastTab', 'options');
      return <Story />;
    },
  ],
};

/** The sessions the forecast shows in, and when it hides. */
export const Visibility: Story = {
  decorators: [
    (Story) => {
      localStorage.setItem('weatherForecastTab', 'visibility');
      return <Story />;
    },
  ],
};
