import type { Meta, StoryObj } from '@storybook/react-vite';
import { SetupLibrarySettings } from './SetupLibrarySettings';
import { createMockSetupLibrary } from './mockSetupLibraryBridge';

const meta: Meta<typeof SetupLibrarySettings> = {
  component: SetupLibrarySettings,
  title: 'components/Settings/Setups',
  decorators: [
    // The settings window's content pane: dark, padded, a fixed height so
    // the list scrolls inside it as it does in the app.
    (Story) => (
      <div className="h-[720px] w-[860px] bg-slate-900 p-5 text-slate-200">
        <Story />
      </div>
    ),
  ],
};

export default meta;

type Story = StoryObj<typeof SetupLibrarySettings>;

/** The library as it opens mid-session: every status the page can show. */
export const MixedStatuses: Story = {
  render: () => <SetupLibrarySettings bridge={createMockSetupLibrary()} />,
};

/** Before any setup was put into the library. */
export const Empty: Story = {
  render: () => (
    <SetupLibrarySettings
      bridge={createMockSetupLibrary({
        libraryExists: false,
        tracks: [],
        unplacedFiles: [],
        sessionTrackFolder: null,
      })}
    />
  ),
};

/** LMU is not installed through Steam, so no game folder is known. */
export const NoGameFolder: Story = {
  render: () => (
    <SetupLibrarySettings
      bridge={createMockSetupLibrary({
        gameFolder: null,
        gameFolderSource: null,
        gameTrackFolders: [],
        sessionTrackFolder: null,
      })}
    />
  ),
};

/** Tearoff is open while LMU is not running. */
export const NotRunning: Story = {
  render: () => (
    <SetupLibrarySettings
      bridge={createMockSetupLibrary({
        lmuConnected: false,
        sessionTrackFolder: null,
        restReachable: null,
      })}
    />
  ),
};

/** LMU runs, but its REST API did not answer, so no track is known. */
export const RestUnreachable: Story = {
  render: () => (
    <SetupLibrarySettings
      bridge={createMockSetupLibrary({
        sessionTrackFolder: null,
        restReachable: false,
      })}
    />
  ),
};

/** The browser preview: no preload bridge, so the page says where it lives. */
export const BrowserPreview: Story = {
  render: () => <SetupLibrarySettings />,
};
