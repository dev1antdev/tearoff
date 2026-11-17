import type { Meta, StoryObj } from '@storybook/react-vite';
import { DashboardProvider } from '@irdashies/context';
import { mockDashboardBridge } from '@irdashies/storybook';
import { defaultDashboard } from '@irdashies/types';
import { RaceChartsSettings } from './RaceChartsSettings';

const meta = {
  title: 'components/Settings/RaceChartsSettings',
  component: RaceChartsSettings,
  decorators: [
    (Story) => (
      <DashboardProvider bridge={mockDashboardBridge}>
        <div className="h-[1200px] w-[880px] bg-slate-900 p-6 text-white">
          <Story />
        </div>
      </DashboardProvider>
    ),
  ],
  parameters: { layout: 'centered' },
} satisfies Meta<typeof RaceChartsSettings>;
export default meta;
type Story = StoryObj<typeof meta>;

/** The page from the top: what it is, and what it draws. */
export const Options: Story = {
  decorators: [
    (Story) => {
      localStorage.setItem('raceChartsTab', 'options');
      return <Story />;
    },
  ],
};

/** The sessions it shows in, and off track or not. */
export const Visibility: Story = {
  decorators: [
    (Story) => {
      localStorage.setItem('raceChartsTab', 'visibility');
      return <Story />;
    },
  ],
};

/** A dashboard whose Race Charts draw cars chosen by number. */
const chosenBridge = {
  ...mockDashboardBridge,
  dashboardUpdated: (
    callback: Parameters<typeof mockDashboardBridge.dashboardUpdated>[0]
  ) => {
    callback(
      {
        ...defaultDashboard,
        widgets: defaultDashboard.widgets.map((widget) =>
          widget.id === 'racecharts'
            ? {
                ...widget,
                config: {
                  ...widget.config,
                  others: 'chosen',
                  carNumbers: '46, #91 33',
                },
              }
            : widget
        ),
      },
      undefined
    );
    return () => undefined;
  },
};

/** Other cars chosen by number: the field for them, and how it is read. */
export const ChosenCars: Story = {
  decorators: [
    (Story) => {
      localStorage.setItem('raceChartsTab', 'options');
      return (
        <DashboardProvider bridge={chosenBridge}>
          <Story />
        </DashboardProvider>
      );
    },
  ],
};
