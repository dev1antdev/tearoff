import type { Meta, StoryObj } from '@storybook/react-vite';
import { DashboardProvider } from '@irdashies/context';
import { createMockBridgeWithConfig } from '@irdashies/storybook';
import { StandingsSettings } from './StandingsSettings';

/** The Standings settings page with both lap average columns switched on. */
const page = (averagesOver: 'clean' | 'all', tab: 'display' | 'options') => {
  const bridge = createMockBridgeWithConfig({
    standings: {
      avgLast5: { enabled: true, timeFormat: 'full' },
      avgLast10: { enabled: true, timeFormat: 'mixed' },
      averagesOver,
    },
  });
  const Page = () => {
    localStorage.setItem('standingsTab', tab);
    return (
      <DashboardProvider bridge={bridge}>
        <div className="h-[2000px] w-[880px] bg-slate-900 p-6 text-white">
          <StandingsSettings />
        </div>
      </DashboardProvider>
    );
  };
  return Page;
};

const meta = {
  title: 'components/Settings/StandingsSettings',
  component: StandingsSettings,
  parameters: { layout: 'centered' },
} satisfies Meta<typeof StandingsSettings>;
export default meta;
type Story = StoryObj<typeof meta>;

/**
 * The column list with Avg 5 and Avg 10 on: each with its own time format
 * and a line saying what it waits for and where the choice of laps is.
 */
export const LapAverageColumns: Story = {
  render: page('clean', 'display'),
};

/** The same rows once every lap counts: they wait for timed laps. */
export const LapAverageColumnsAllLaps: Story = {
  render: page('all', 'display'),
};

/** Options, with "Averages over" and what a clean lap is here. */
export const LapAverageOptions: Story = {
  render: page('clean', 'options'),
};
