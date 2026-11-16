import { useEffect, type ReactNode } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { DashboardProvider, useDashboard } from '@irdashies/context';
import {
  ChannelSnapshotDecorator,
  createMockBridgeWithConfig,
  trackProfileStorySnapshot,
} from '@irdashies/storybook';
import type { TrackProfileSnapshot } from '@irdashies/types';
import { InformationBarSettings } from './InformationBarSettings';
import { createMockTrackProfileBridge } from './TrackNotes/mockTrackProfileBridge';

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

/** The in-game clock first in the list, so its options are on one screen. */
const clockPage = (
  clock: Record<string, unknown>,
  profile?: TrackProfileSnapshot
): Story => {
  const bridge = createMockBridgeWithConfig({
    infobar: {
      sessionClockTime: { enabled: true, format: '24h', ...clock },
      displayOrder: [
        'sessionClockTime',
        'sessionName',
        'sessionTime',
        'incidentCount',
        'localTime',
      ],
    },
  });
  const profiles = createMockTrackProfileBridge();
  return {
    decorators: [
      (Story) => {
        localStorage.setItem('infobarTab', 'display');
        // What the page talks to in the app, for as long as the story is up.
        useEffect(() => {
          const previous = window.trackProfileBridge;
          window.trackProfileBridge = profiles;
          return () => {
            window.trackProfileBridge = previous;
          };
        }, []);
        return (
          <DashboardProvider bridge={bridge}>
            <div className="h-[760px] w-[880px] bg-slate-900 p-6 text-white">
              <OnceTheDashboardIsLoaded>
                <Story />
              </OnceTheDashboardIsLoaded>
            </div>
          </DashboardProvider>
        );
      },
      ChannelSnapshotDecorator(
        profile ? { 'track-profile.snapshot': profile } : {}
      ),
    ],
  };
};

/** The clock's options as they come: its format and the time scale. */
export const ClockOptions: Story = clockPage({});

/**
 * The countdown to the next of sunrise, midday, sunset and midnight switched
 * on, with the two times entered for the track of the running session.
 */
export const ClockSunCountdown: Story = clockPage(
  { sunPhase: true },
  { ...trackProfileStorySnapshot, sunriseMinutes: 372, sunsetMinutes: 1231 }
);

/** The same for a track that has no times yet. */
export const ClockSunCountdownNoTimes: Story = clockPage(
  { sunPhase: true, sunPhaseInGameTime: true },
  trackProfileStorySnapshot
);

/** The same with no session running: no track to keep the times for. */
export const ClockSunCountdownNoSession: Story = clockPage({ sunPhase: true });
