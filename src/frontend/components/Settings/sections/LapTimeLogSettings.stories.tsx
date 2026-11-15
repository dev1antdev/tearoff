import { useEffect } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { DashboardProvider, useDashboard } from '@irdashies/context';
import {
  createMockBridgeWithConfig,
  mockDashboardBridge,
} from '@irdashies/storybook';
import { getWidgetDefaultConfig } from '@irdashies/types';
import { LapTimeLogSettings } from './LapTimeLogSettings';

const meta = {
  title: 'components/Settings/LapTimeLogSettings',
  component: LapTimeLogSettings,
  parameters: { layout: 'centered' },
} satisfies Meta<typeof LapTimeLogSettings>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Scrolls the page to the section under a heading, once it is there. */
const useScrollToSection = (title: string) => {
  useEffect(() => {
    // The page waits for its dashboard, so the section is not there at mount.
    const timer = window.setInterval(() => {
      const heading = [...document.querySelectorAll('h2, h3')].find(
        (element) => element.textContent === title
      );
      if (!heading) return;
      window.clearInterval(timer);
      heading.scrollIntoView({ block: 'start' });
    }, 50);
    return () => window.clearInterval(timer);
  }, [title]);
};

/**
 * The page reads its saved settings once, as it mounts, so it is mounted
 * when the dashboard is there, as it is from the settings menu.
 */
const WhenLoaded = ({ children }: { children: React.ReactNode }) => {
  const { currentDashboard } = useDashboard();
  return currentDashboard ? <>{children}</> : null;
};

const page = (bridge = mockDashboardBridge) => ({
  decorators: [
    (Story: React.ComponentType) => {
      localStorage.setItem('lapTimeTab', 'display');
      useScrollToSection('Lap History Columns');
      return (
        <DashboardProvider bridge={bridge}>
          <div className="h-[860px] w-[880px] overflow-y-auto bg-slate-900 p-6 text-white">
            <WhenLoaded>
              <Story />
            </WhenLoaded>
          </div>
        </DashboardProvider>
      );
    },
  ],
});

/** The columns of the lap history as a saved dashboard has them. */
export const HistoryColumns: Story = { ...page() };

const defaults = getWidgetDefaultConfig('laptimelog');

/** Every column on, which brings up the fuel unit and the wear choice. */
export const HistoryColumnsAllOn: Story = {
  ...page(
    createMockBridgeWithConfig({
      laptimelog: {
        history: {
          ...defaults.history,
          showStintLap: true,
          showFuel: true,
          showWear: true,
          showCurrentRow: true,
        },
      },
    })
  ),
};
