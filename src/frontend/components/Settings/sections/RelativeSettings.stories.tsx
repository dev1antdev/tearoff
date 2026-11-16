import type { Meta, StoryObj } from '@storybook/react-vite';
import { DashboardProvider, useDashboard } from '@irdashies/context';
import { ScrollToText, createMockBridgeWithConfig } from '@irdashies/storybook';
import { RelativeSettings } from './RelativeSettings';

/**
 * The page reads its settings once, when it mounts, so it is mounted when the
 * dashboard is there: as in the app, where a page opens on a loaded one.
 */
const Loaded = () => {
  const { currentDashboard } = useDashboard();
  return currentDashboard ? <RelativeSettings /> : null;
};

/**
 * The Relative settings page with both lap average columns switched on,
 * opened on a tab and scrolled to the row the story is about.
 */
const page = (tab: 'display' | 'options', scrollTo: string) => {
  const bridge = createMockBridgeWithConfig({
    relative: {
      avgLast5: { enabled: true, timeFormat: 'full' },
      avgLast10: { enabled: true, timeFormat: 'full' },
    },
  });
  const Page = () => {
    localStorage.setItem('relativeTab', tab);
    return (
      <DashboardProvider bridge={bridge}>
        <div className="h-[720px] w-[880px] bg-slate-900 p-6 text-white">
          <ScrollToText text={scrollTo}>
            <Loaded />
          </ScrollToText>
        </div>
      </DashboardProvider>
    );
  };
  return Page;
};

const meta = {
  title: 'components/Settings/RelativeSettings',
  component: RelativeSettings,
  parameters: { layout: 'centered' },
} satisfies Meta<typeof RelativeSettings>;
export default meta;
type Story = StoryObj<typeof meta>;

/** The column list with Avg 5 and Avg 10 on, as on the Standings page. */
export const LapAverageColumns: Story = {
  render: page('display', 'Average Lap Time'),
};

/** Options, with "Averages over" under the relative time's own setting. */
export const LapAverageOptions: Story = {
  render: page('options', 'Relative Time'),
};
