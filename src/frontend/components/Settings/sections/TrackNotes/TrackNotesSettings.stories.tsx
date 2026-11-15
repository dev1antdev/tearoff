import { useEffect } from 'react';
import type { Decorator, Meta, StoryObj } from '@storybook/react-vite';
import { DashboardProvider } from '@irdashies/context';
import {
  ChannelSnapshotDecorator,
  mockDashboardBridge,
  trackProfileStorySnapshot,
  trackStateStorySnapshot,
} from '@irdashies/storybook';
import { TrackNotesSettings } from './TrackNotesSettings';
import {
  createMockTrackProfileBridge,
  lagunaSecaProfile,
  spaProfile,
} from './mockTrackProfileBridge';

const tab =
  (name: string): Decorator =>
  (Story) => {
    localStorage.setItem('trackNotesTab', name);
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

/** A session at Laguna Seca under Le Mans Ultimate, the car at 1,795 m. */
const atLagunaSeca = ChannelSnapshotDecorator({
  'track-profile.snapshot': trackProfileStorySnapshot,
  'track-state.snapshot': { ...trackStateStorySnapshot, lapDistPct: 0.5 },
});

// One store for each story, made once: a story drawn again keeps its notes.
const stored = createMockTrackProfileBridge();
const withoutNotes = createMockTrackProfileBridge([
  { ...lagunaSecaProfile, notes: [] },
  spaProfile,
]);
const nothingStored = createMockTrackProfileBridge([]);

const meta = {
  title: 'components/Settings/TrackNotesSettings',
  component: TrackNotesSettings,
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
  render: () => <TrackNotesSettings bridge={stored} />,
} satisfies Meta<typeof TrackNotesSettings>;
export default meta;
type Story = StoryObj<typeof meta>;

/**
 * The notes editor on the track of the running session: twelve notes of
 * both kinds, one with a comment over two lines, one for the pits.
 */
export const Notes: Story = {
  decorators: [tab('notes'), atLagunaSeca],
};

/** The same track before a note has been written for it. */
export const NoNotesYet: Story = {
  decorators: [tab('notes'), atLagunaSeca],
  render: () => <TrackNotesSettings bridge={withoutNotes} />,
};

/**
 * No session running: the editor opens on the track changed last, and a
 * note cannot be placed where the car is.
 */
export const NoSession: Story = {
  decorators: [tab('notes'), ChannelSnapshotDecorator({})],
};

/** Nothing stored and no session: nothing to write notes for yet. */
export const NoTracks: Story = {
  decorators: [tab('notes'), ChannelSnapshotDecorator({})],
  render: () => <TrackNotesSettings bridge={nothingStored} />,
};

/** What the widget draws, how early pace notes appear and for how long. */
export const Options: Story = {
  decorators: [tab('options'), atLagunaSeca],
};

/** The end of the same tab: the leads, the time on show, pits and empty tracks. */
export const Timing: Story = {
  decorators: [showSection('Timing'), tab('options'), atLagunaSeca],
};

/** The sessions the widget shows in, and whether it hides off track. */
export const Visibility: Story = {
  decorators: [tab('visibility'), atLagunaSeca],
};
