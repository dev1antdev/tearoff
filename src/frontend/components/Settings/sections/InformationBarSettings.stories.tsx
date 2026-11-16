import type { ReactNode } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { DashboardProvider, useDashboard } from '@irdashies/context';
import { createMockBridgeWithConfig } from '@irdashies/storybook';
import { InformationBarSettings } from './InformationBarSettings';

const meta = {
  title: 'components/Settings/InformationBarSettings',
  component: InformationBarSettings,
  parameters: { layout: 'centered' },
} satisfies Meta<typeof InformationBarSettings>;
export default meta;
type Story = StoryObj<typeof meta>;

/**
 * The page takes its settings from the dashboard as it mounts, as it does in
 * the app, where the dashboard is there first. Here the dashboard arrives a
 * moment after the provider, so the page waits for it.
 */
const OnceTheDashboardIsLoaded = ({ children }: { children: ReactNode }) =>
  useDashboard().currentDashboard ? <>{children}</> : null;

const lapsAndPositionBridge = createMockBridgeWithConfig({
  infobar: {
    sessionLaps: {
      enabled: true,
      mode: 'Elapsed',
      format: 'progress',
      showExtraLaps: true,
    },
    position: { enabled: true },
    classRank: { enabled: true },
    positionChange: { enabled: true, scope: 'class' },
    trackLimits: { enabled: true },
    // The items in question first, so they are on one screen.
    displayOrder: [
      'sessionLaps',
      'position',
      'classRank',
      'positionChange',
      'trackLimits',
      'sessionName',
      'sessionTime',
      'incidentCount',
      'localTime',
    ],
  },
});

/**
 * The bar's items with the laps and position ones switched on: the laps in
 * their progress format with the laps the flag adds, the overall place, and
 * the places gained since the grid with the grid they are measured on.
 */
export const LapsAndPosition: Story = {
  decorators: [
    (Story) => {
      localStorage.setItem('infobarTab', 'display');
      return (
        <DashboardProvider bridge={lapsAndPositionBridge}>
          <div className="h-[1100px] w-[880px] bg-slate-900 p-6 text-white">
            <OnceTheDashboardIsLoaded>
              <Story />
            </OnceTheDashboardIsLoaded>
          </div>
        </DashboardProvider>
      );
    },
  ],
};
