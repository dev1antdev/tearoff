import type { Meta, StoryObj } from '@storybook/react-vite';
import { DashboardProvider } from '@irdashies/context';
import { mockDashboardBridge } from '@irdashies/storybook';
import type { DashboardBridge } from '@irdashies/types';
import { SectorDeltaSettings } from './SectorDeltaSettings';
import { dashboardBridgeWith, ShowSection } from './settingsStory';

const page = (bridge: DashboardBridge, section?: string) => () => (
  <DashboardProvider bridge={bridge}>
    <div className="h-[740px] w-[880px] bg-slate-900 p-6 text-white">
      {section ? (
        <ShowSection title={section}>
          <SectorDeltaSettings />
        </ShowSection>
      ) : (
        <SectorDeltaSettings />
      )}
    </div>
  </DashboardProvider>
);

const meta = {
  title: 'components/Settings/SectorDeltaSettings',
  component: SectorDeltaSettings,
  parameters: { layout: 'centered' },
} satisfies Meta<typeof SectorDeltaSettings>;
export default meta;
type Story = StoryObj<typeof meta>;

const onTab =
  (tab: 'options' | 'visibility') => (Story: React.ComponentType) => {
    localStorage.setItem('sectorDeltaTab', tab);
    return <Story />;
  };

/** What the sectors are compared with, and how they are drawn. */
export const Options: Story = {
  decorators: [onTab('options')],
  render: page(mockDashboardBridge),
};

/**
 * The target lap switched on, against the all-time best sectors: the row
 * above the sectors, and how long the gap is held after each of them.
 */
export const TargetLap: Story = {
  decorators: [onTab('options')],
  render: page(
    dashboardBridgeWith('sectordelta', {
      ghostComparison: 'all-time-best',
      showTargetLap: true,
    }),
    'Target Lap'
  ),
};

/** The sessions the widget shows in, and whether it hides off track. */
export const Visibility: Story = {
  decorators: [onTab('visibility')],
  render: page(mockDashboardBridge),
};
