import { useCallback, useEffect, useState } from 'react';
import type {
  ChooseGameFolderResult,
  SetupLibraryBridge,
  SetupLibraryState,
} from '@irdashies/types';
import logger from '@irdashies/utils/logger';

/**
 * The setup library as the settings page sees it. Everything is reloaded
 * after an action, so what the page shows is what the main process has,
 * never a guess. Nothing polls: the page is opened, refreshed by hand, or
 * reloaded by its own actions.
 */

export interface SetupLibraryView {
  /** False where the app has no setup library, as in the browser preview. */
  available: boolean;
  state: SetupLibraryState | null;
  loading: boolean;
  /** A short sentence for the page, or null. */
  error: string | null;
  refresh: () => Promise<void>;
  openLibraryFolder: () => Promise<void>;
  chooseGameFolder: () => Promise<ChooseGameFolderResult | null>;
  setAutoInstall: (enabled: boolean) => Promise<void>;
  installTrack: (folder: string) => Promise<void>;
  replaceSetup: (folder: string, fileName: string) => Promise<void>;
}

const READ_FAILED = 'The setup library could not be read.';
const CHANGE_FAILED = 'That change could not be made.';
const OPEN_FAILED = 'The folder could not be opened.';
const CHOOSE_FAILED = 'The folder could not be chosen.';

export const useSetupLibrary = (
  bridge: SetupLibraryBridge | undefined = window.setupLibraryBridge
): SetupLibraryView => {
  const [state, setState] = useState<SetupLibraryState | null>(null);
  const [loading, setLoading] = useState(Boolean(bridge));
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!bridge) return;
    try {
      const next = await bridge.getState();
      setState(next);
      setError(null);
    } catch (e) {
      logger.error('[Setups] Could not read the setup library', e);
      setError(READ_FAILED);
    } finally {
      setLoading(false);
    }
  }, [bridge]);

  useEffect(() => {
    void load();
  }, [load]);

  const apply = useCallback(
    async (action: () => Promise<SetupLibraryState>) => {
      if (!bridge) return;
      try {
        setState(await action());
        setError(null);
      } catch (e) {
        logger.error('[Setups] Could not change the setup library', e);
        setError(CHANGE_FAILED);
      }
    },
    [bridge]
  );

  const openLibraryFolder = useCallback(async () => {
    if (!bridge) return;
    try {
      await bridge.openLibraryFolder();
      setError(null);
    } catch (e) {
      logger.error('[Setups] Could not open the library folder', e);
      setError(OPEN_FAILED);
    }
  }, [bridge]);

  const chooseGameFolder = useCallback(async () => {
    if (!bridge) return null;
    try {
      const result = await bridge.chooseGameFolder();
      setError(null);
      if (result !== 'cancelled') await load();
      return result;
    } catch (e) {
      logger.error('[Setups] Could not choose the game folder', e);
      setError(CHOOSE_FAILED);
      return null;
    }
  }, [bridge, load]);

  const setAutoInstall = useCallback(
    async (enabled: boolean) => {
      if (!bridge) return;
      setState((previous) =>
        previous ? { ...previous, autoInstall: enabled } : previous
      );
      try {
        await bridge.setAutoInstall(enabled);
        setError(null);
      } catch (e) {
        logger.error('[Setups] Could not change automatic install', e);
        setError(CHANGE_FAILED);
        await load();
      }
    },
    [bridge, load]
  );

  return {
    available: Boolean(bridge),
    state,
    loading,
    error,
    refresh: load,
    openLibraryFolder,
    chooseGameFolder,
    setAutoInstall,
    installTrack: (folder) =>
      bridge ? apply(() => bridge.installTrack(folder)) : Promise.resolve(),
    replaceSetup: (folder, fileName) =>
      bridge
        ? apply(() => bridge.replaceSetup(folder, fileName))
        : Promise.resolve(),
  };
};
