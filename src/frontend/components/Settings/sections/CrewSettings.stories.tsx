import type { Meta, StoryObj } from '@storybook/react-vite';
import { DashboardProvider } from '@irdashies/context';
import { mockDashboardBridge } from '@irdashies/storybook';
import { defaultDashboard } from '@irdashies/types';
import { CrewSettings } from './CrewSettings';

const meta = {
  title: 'components/Settings/CrewSettings',
  component: CrewSettings,
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
} satisfies Meta<typeof CrewSettings>;
export default meta;
type Story = StoryObj<typeof meta>;

/** The page from the top: what it is, and what it draws. */
export const Options: Story = {
  decorators: [
    (Story) => {
      localStorage.setItem('crewTab', 'options');
      return <Story />;
    },
  ],
};

/** The sessions it shows in, and off track or not. */
export const Visibility: Story = {
  decorators: [
    (Story) => {
      localStorage.setItem('crewTab', 'visibility');
      return <Story />;
    },
  ],
};

/** A dashboard on which the drive-time limits are switched on. */
const limitsBridge = {
  ...mockDashboardBridge,
  dashboardUpdated: (
    callback: Parameters<typeof mockDashboardBridge.dashboardUpdated>[0]
  ) => {
    callback(
      {
        ...defaultDashboard,
        widgets: defaultDashboard.widgets.map((widget) =>
          widget.id === 'crew'
            ? {
                ...widget,
                config: {
                  ...widget.config,
                  driveTime: { enabled: true, maxMinutes: 240, minMinutes: 90 },
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

/** With the drive-time limits on: the two limits can be entered. */
export const DriveTimeLimits: Story = {
  decorators: [
    (Story) => {
      localStorage.setItem('crewTab', 'options');
      return (
        <DashboardProvider bridge={limitsBridge}>
          <Story />
        </DashboardProvider>
      );
    },
  ],
};
