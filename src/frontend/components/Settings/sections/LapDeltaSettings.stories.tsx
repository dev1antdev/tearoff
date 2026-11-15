import type { Meta, StoryObj } from '@storybook/react-vite';
import { DashboardProvider } from '@irdashies/context';
import { mockDashboardBridge } from '@irdashies/storybook';
import type { DashboardBridge } from '@irdashies/types';
import { LapDeltaSettings } from './LapDeltaSettings';
import { dashboardBridgeWith } from './settingsStory';

const page = (bridge: DashboardBridge) => () => (
  <DashboardProvider bridge={bridge}>
    <div className="h-[740px] w-[880px] bg-slate-900 p-6 text-white">
      <LapDeltaSettings />
    </div>
  </DashboardProvider>
);

const meta = {
  title: 'components/Settings/LapDeltaSettings',
  component: LapDeltaSettings,
  parameters: { layout: 'centered' },
} satisfies Meta<typeof LapDeltaSettings>;
export default meta;
type Story = StoryObj<typeof meta>;

const onTab =
  (tab: 'options' | 'visibility') => (Story: React.ComponentType) => {
    localStorage.setItem('lapDeltaTab', tab);
    return <Story />;
  };

/**
 * The lap the delta is measured against, how long the result of a lap is
 * held after the line, and the other laps shown beside it.
 */
export const Options: Story = {
  decorators: [onTab('options')],
  render: page(mockDashboardBridge),
};

/**
 * Against the stint best, with the session best and the last lap in the
 * strip: the stint best has no switch of its own, as it is never repeated.
 */
export const AgainstStintBest: Story = {
  decorators: [onTab('options')],
  render: page(
    dashboardBridgeWith('lapdelta', {
      reference: 'stintBest',
      secondary: {
        sessionBest: true,
        allTime: false,
        stintBest: false,
        lastLap: true,
      },
    })
  ),
};

/** The sessions the widget shows in, and whether it hides off track. */
export const Visibility: Story = {
  decorators: [onTab('visibility')],
  render: page(mockDashboardBridge),
};
