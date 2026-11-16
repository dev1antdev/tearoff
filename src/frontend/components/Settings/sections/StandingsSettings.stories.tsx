import type { Meta, StoryObj } from '@storybook/react-vite';
import { DashboardProvider } from '@irdashies/context';
import { ScrollToText, createMockBridgeWithConfig } from '@irdashies/storybook';
import { StandingsSettings } from './StandingsSettings';

/**
 * The Standings settings page with both lap average columns switched on,
 * and the vs stint column where the story asks for it, opened on a tab and
 * scrolled to the row the story is about.
 */
const page = (
  averagesOver: 'clean' | 'all',
  tab: 'display' | 'options',
  scrollTo: string,
  stintPace = false
) => {
  const bridge = createMockBridgeWithConfig({
    standings: {
      avgLast5: { enabled: true, timeFormat: 'full' },
      avgLast10: { enabled: true, timeFormat: 'mixed' },
      averagesOver,
      stintPace: { enabled: stintPace },
    },
  });
  const Page = () => {
    localStorage.setItem('standingsTab', tab);
    return (
      <DashboardProvider bridge={bridge}>
        <div className="h-[720px] w-[880px] bg-slate-900 p-6 text-white">
          <ScrollToText text={scrollTo}>
            <StandingsSettings />
          </ScrollToText>
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
  render: page('clean', 'display', 'Average Lap Time'),
};

/** The same rows once every lap counts: they wait for timed laps. */
export const LapAverageColumnsAllLaps: Story = {
  render: page('all', 'display', 'Average Lap Time'),
};

/** Options, with "Averages over" and what a clean lap is here. */
export const LapAverageOptions: Story = {
  render: page('clean', 'options', 'Use Live Position Standings'),
};

/**
 * The column list with vs stint on: a line saying what it waits for, where
 * the choice of the stint it is held against is, and that it has the race
 * recorded.
 */
export const StintPaceColumn: Story = {
  render: page('clean', 'display', 'Avg 5 (Last 5 Laps)', true),
};

/** Options, with "Pace against" and what the column compares. */
export const StintPaceOptions: Story = {
  render: page('clean', 'options', 'Lap Averages', true),
};
