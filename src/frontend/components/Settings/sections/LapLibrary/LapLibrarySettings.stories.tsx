import type { Meta, StoryObj } from '@storybook/react-vite';
import { LapLibrarySettings } from './LapLibrarySettings';
import { createMockLapLibrary } from './mockLapLibrary';

const meta: Meta<typeof LapLibrarySettings> = {
  component: LapLibrarySettings,
  title: 'components/Settings/Laps',
  decorators: [
    // The settings window's content pane: dark, padded, a fixed height so
    // the list scrolls inside it as it does in the app.
    (Story) => (
      <div className="h-[640px] w-[820px] bg-slate-900 p-5 text-slate-200">
        <Story />
      </div>
    ),
  ],
};

export default meta;

type Story = StoryObj<typeof LapLibrarySettings>;

/** Three sessions across both sims, all closed, as the page opens. */
export const Sessions: Story = {
  render: () => <LapLibrarySettings bridge={createMockLapLibrary()} />,
};

/**
 * A Le Mans Ultimate race opened: the reference lap starred, a voided lap
 * that was quicker but does not count, a pit lap, and a lap with no trace.
 */
export const SessionOpen: Story = {
  render: () => (
    <LapLibrarySettings
      bridge={createMockLapLibrary()}
      initiallyExpanded={[3]}
    />
  ),
};

/** An iRacing race: fuel instead of virtual energy, and incident points. */
export const IncidentsAndFuel: Story = {
  render: () => (
    <LapLibrarySettings
      bridge={createMockLapLibrary()}
      initiallyExpanded={[1]}
    />
  ),
};

/** Before any lap has been driven. */
export const Empty: Story = {
  render: () => <LapLibrarySettings bridge={createMockLapLibrary([], [])} />,
};
