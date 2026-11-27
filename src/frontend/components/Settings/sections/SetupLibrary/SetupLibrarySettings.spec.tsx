import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SetupLibrarySettings } from './SetupLibrarySettings';
import { SAMPLE_STATE, createMockSetupLibrary } from './mockSetupLibraryBridge';

vi.mock('@irdashies/utils/logger', () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const renderPage = (
  overrides: Parameters<typeof createMockSetupLibrary>[0] = {}
) => {
  const bridge = createMockSetupLibrary(overrides);
  render(<SetupLibrarySettings bridge={bridge} />);
  return bridge;
};

describe('SetupLibrarySettings', () => {
  it('lists the tracks, their files and every status', async () => {
    renderPage();

    await screen.findByText('Spa (this session)');
    expect(screen.getByText('Spa Race.svm')).toBeInTheDocument();
    expect(screen.getByText('In the game')).toBeInTheDocument();
    expect(screen.getAllByText('Not in the game yet').length).toBeGreaterThan(
      0
    );
    expect(screen.getByText('Being written')).toBeInTheDocument();
    expect(screen.getByText('Changed in the game')).toBeInTheDocument();
    expect(screen.getByText('Another file has this name')).toBeInTheDocument();
    expect(
      screen.getByText('Not a setup file: no VehicleClassSetting line')
    ).toBeInTheDocument();
    expect(screen.getByText('Could not copy (EBUSY)')).toBeInTheDocument();
    expect(
      screen.getByText('GT3 Porsche_911_GT3_R_LMGT3 WEC2025')
    ).toBeInTheDocument();
  });

  it('says which track folder the game has no place for', async () => {
    renderPage();
    await screen.findByText('Sebring');
    expect(
      screen.getByText('The game has no track folder with this name.')
    ).toBeInTheDocument();
  });

  it('disables installing when the game folder is unknown, with the reason', async () => {
    renderPage({
      gameFolder: null,
      gameFolderSource: null,
      gameTrackFolders: [],
      sessionTrackFolder: null,
    });
    const buttons = await screen.findAllByRole('button', {
      name: 'Install to game',
    });
    for (const button of buttons) expect(button).toBeDisabled();
    expect(
      screen.getAllByText(
        'Choose the Le Mans Ultimate folder above to install setups.'
      ).length
    ).toBeGreaterThan(0);
  });

  it('installs a track when asked', async () => {
    const bridge = renderPage();
    const install = vi.spyOn(bridge, 'installTrack');
    const buttons = await screen.findAllByRole('button', {
      name: 'Install to game',
    });
    fireEvent.click(buttons[0]);
    await waitFor(() => expect(install).toHaveBeenCalledWith('Spa'));
  });

  it('replaces a setup only after the confirmation', async () => {
    const bridge = renderPage();
    const replace = vi.spyOn(bridge, 'replaceSetup');
    await screen.findByText('Spa Wet.svm');

    fireEvent.click(screen.getAllByRole('button', { name: 'Replace' })[0]);
    const dialog = screen.getByRole('dialog', {
      name: 'Replace the setup in the game?',
    });

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(replace).not.toHaveBeenCalled();

    fireEvent.click(screen.getAllByRole('button', { name: 'Replace' })[0]);
    fireEvent.click(
      within(
        screen.getByRole('dialog', {
          name: 'Replace the setup in the game?',
        })
      ).getByRole('button', { name: 'Replace' })
    );
    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith('Spa', 'Spa Wet.svm')
    );
  });

  it('turns automatic install off from the switch', async () => {
    const bridge = renderPage();
    const setAutoInstall = vi.spyOn(bridge, 'setAutoInstall');
    await screen.findByRole('switch', {
      name: 'Install setups automatically',
    });
    fireEvent.click(
      screen.getByRole('switch', { name: 'Install setups automatically' })
    );
    await waitFor(() => expect(setAutoInstall).toHaveBeenCalledWith(false));
  });

  it('says when LMU is not running', async () => {
    renderPage({
      lmuConnected: false,
      sessionTrackFolder: null,
      restReachable: null,
    });
    await screen.findByText('Le Mans Ultimate is not running.');
  });

  it('says when the REST API did not answer', async () => {
    renderPage({ sessionTrackFolder: null, restReachable: false });
    await screen.findByText(
      'Le Mans Ultimate is running, but its REST API did not answer.'
    );
  });

  it('names the session’s track folder', async () => {
    renderPage();
    await screen.findByText('Le Mans Ultimate is running. Track folder: Spa.');
  });

  it('warns about files that are not in a track folder', async () => {
    renderPage();
    await screen.findByText('Not in a track folder');
    expect(screen.getByText('Loose setup.svm')).toBeInTheDocument();
  });

  it('invites the person to add setups when the library is empty', async () => {
    renderPage({
      libraryExists: false,
      tracks: [],
      unplacedFiles: [],
      sessionTrackFolder: null,
    });
    await screen.findByText(/No setups yet/);
    expect(
      screen.getByText('The folder does not exist yet. Open folder creates it.')
    ).toBeInTheDocument();
  });

  it('shows the library and game folders', async () => {
    renderPage();
    await screen.findByText(SAMPLE_STATE.libraryFolder);
    expect(screen.getByText(SAMPLE_STATE.gameFolder ?? '')).toBeInTheDocument();
    expect(screen.getByText('Found through Steam')).toBeInTheDocument();
  });

  it('says the feature lives in the desktop app without a bridge', async () => {
    render(<SetupLibrarySettings />);
    await screen.findByText('Setups are available in the desktop app.');
  });

  it('reports a folder that is not an LMU install', async () => {
    const bridge = createMockSetupLibrary();
    vi.spyOn(bridge, 'chooseGameFolder').mockResolvedValue('not-lmu-folder');
    render(<SetupLibrarySettings bridge={bridge} />);
    await screen.findByRole('button', { name: 'Choose folder...' });
    fireEvent.click(screen.getByRole('button', { name: 'Choose folder...' }));
    await screen.findByText(
      'That folder is not a Le Mans Ultimate installation.'
    );
  });
});
