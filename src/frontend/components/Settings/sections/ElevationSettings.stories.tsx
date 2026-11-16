import { useEffect } from 'react';
import type { Decorator, Meta, StoryObj } from '@storybook/react-vite';
import { DashboardProvider } from '@irdashies/context';
import {
  ChannelSnapshotDecorator,
  emptyTrackProfileStorySnapshot,
  mockDashboardBridge,
  trackProfileStorySnapshot,
} from '@irdashies/storybook';
import { ElevationSettings } from './ElevationSettings';
import { createMockTrackProfileBridge } from './TrackNotes/mockTrackProfileBridge';

const tab =
  (name: string): Decorator =>
  (Story) => {
    localStorage.setItem('elevationTab', name);
    return <Story />;
  };

/**
 * Brings the section with this heading into view, as scrolling to it would.
 * The page waits for its dashboard, so the heading is looked for until it
 * turns up.
 */
const showSection =
  (title: string): Decorator =>
  (Story) => {
    useEffect(() => {
      const timer = window.setInterval(() => {
        const heading = [...document.querySelectorAll('h3')].find(
          (element) => element.textContent === title
        );
        if (!heading) return;
        window.clearInterval(timer);
        heading.scrollIntoView({ block: 'start' });
      }, 50);
      return () => window.clearInterval(timer);
    }, []);
    return <Story />;
  };

const profiles = createMockTrackProfileBridge();

const meta = {
  title: 'components/Settings/ElevationSettings',
  component: ElevationSettings,
  decorators: [
    (Story) => (
      <DashboardProvider bridge={mockDashboardBridge}>
        <div className="h-[860px] w-[880px] bg-slate-900 p-6 text-white">
          <Story />
        </div>
      </DashboardProvider>
    ),
  ],
  parameters: { layout: 'centered' },
  render: () => <ElevationSettings bridge={profiles} />,
} satisfies Meta<typeof ElevationSettings>;
export default meta;
type Story = StoryObj<typeof meta>;

/**
 * What is drawn and in which units, with the profile of the running
 * session's track recorded and the means to record it again.
 */
export const Options: Story = {
  decorators: [
    tab('options'),
    ChannelSnapshotDecorator({
      'track-profile.snapshot': trackProfileStorySnapshot,
    }),
  ],
};

/**
 * The end of the same page: where the profile on screen came from, and the
 * button that drops it so the next clean lap records it again.
 */
export const RecordedProfile: Story = {
  decorators: [
    showSection('Recorded Profile'),
    tab('options'),
    ChannelSnapshotDecorator({
      'track-profile.snapshot': trackProfileStorySnapshot,
    }),
  ],
};

/** The same while the lap that records the profile is being driven. */
export const Recording: Story = {
  decorators: [
    showSection('Recorded Profile'),
    tab('options'),
    ChannelSnapshotDecorator({
      'track-profile.snapshot': {
        ...emptyTrackProfileStorySnapshot,
        recordingProgress: 0.35,
      },
    }),
  ],
};

/** With no session running: nothing to record again. */
export const NoSession: Story = {
  decorators: [tab('options'), ChannelSnapshotDecorator({})],
};

/** The sessions the widget shows in, and whether it hides off track. */
export const Visibility: Story = {
  decorators: [tab('visibility'), ChannelSnapshotDecorator({})],
};
