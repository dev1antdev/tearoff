import { ipcRenderer } from 'electron';
import type { SetupLibraryBridge } from '../../types/setupLibrary';
import { defineBridge } from './defineBridge';

/**
 * The preload side of the setup library. Only names and booleans go over;
 * the paths live in the main process.
 */
export const exposeSetupLibraryBridge = () => {
  return defineBridge<SetupLibraryBridge>('setupLibraryBridge', {
    getState: () => ipcRenderer.invoke('setupLibrary:getState'),
    openLibraryFolder: () =>
      ipcRenderer.invoke('setupLibrary:openLibraryFolder'),
    chooseGameFolder: () => ipcRenderer.invoke('setupLibrary:chooseGameFolder'),
    setAutoInstall: (enabled) =>
      ipcRenderer.invoke('setupLibrary:setAutoInstall', enabled),
    installTrack: (folder) =>
      ipcRenderer.invoke('setupLibrary:installTrack', folder),
    replaceSetup: (folder, fileName) =>
      ipcRenderer.invoke('setupLibrary:replaceSetup', folder, fileName),
  });
};
