import type {
  SetupLibraryBridge,
  SetupLibraryFile,
  SetupLibraryState,
} from '@irdashies/types';

/**
 * The setup library as the page sees it, for stories and specs: the state
 * itself, with actions that change it the way the real library would.
 */

const file = (
  fileName: string,
  vehicleClass: string | null,
  status: SetupLibraryFile['status']
): SetupLibraryFile => ({ fileName, vehicleClass, status });

export const SAMPLE_STATE: SetupLibraryState = {
  libraryFolder: 'C:\\Users\\driver\\Documents\\Tearoff\\Setups\\LMU',
  libraryExists: true,
  gameFolder: 'D:\\SteamLibrary\\steamapps\\common\\Le Mans Ultimate',
  gameFolderSource: 'steam',
  gameTrackFolders: ['Lemans', 'Spa', 'Sebring'],
  tracks: [
    {
      folder: 'Spa',
      gameFolder: 'Spa',
      files: [
        file('Spa Race.svm', 'GT3 Porsche_911_GT3_R_LMGT3 WEC2025', {
          kind: 'installed',
        }),
        file('Spa Quali.svm', 'GT3 Ferrari_296_LMGT3_Evo', { kind: 'ready' }),
        file('Spa Wet.svm', 'GT3 BMW_M4_LMGT3', {
          kind: 'conflict',
          reason: 'changed-in-game',
        }),
        file('Spa Old.svm', 'GT3 McLaren_720S_LMGT3_Evo', {
          kind: 'conflict',
          reason: 'not-from-tearoff',
        }),
        file('Spa Draft.svm', 'GT3 Aston_Martin_Vantage_AMR', {
          kind: 'pending',
        }),
        file('Spa Broken.svm', null, {
          kind: 'invalid',
          problem: 'no-vehicle-class',
        }),
        file('Spa Locked.svm', 'GT3 Corvette_Z06_LMGT3', {
          kind: 'error',
          code: 'EBUSY',
        }),
      ],
    },
    {
      folder: 'Sebring',
      gameFolder: null,
      files: [file('Sebring Race.svm', 'LMP2 Oreca_07', { kind: 'ready' })],
    },
  ],
  unplacedFiles: ['Loose setup.svm'],
  truncated: false,
  autoInstall: true,
  lmuConnected: true,
  sessionTrackFolder: 'Spa',
  restReachable: true,
};

export const createMockSetupLibrary = (
  overrides: Partial<SetupLibraryState> = {}
): SetupLibraryBridge => {
  const state: SetupLibraryState = { ...SAMPLE_STATE, ...overrides };

  return {
    getState: async () => state,
    openLibraryFolder: async () => undefined,
    chooseGameFolder: async () => 'cancelled',
    setAutoInstall: async (enabled) => {
      state.autoInstall = enabled;
    },
    installTrack: async () => state,
    replaceSetup: async (folder, fileName) => {
      const track = state.tracks.find((entry) => entry.folder === folder);
      const target = track?.files.find((entry) => entry.fileName === fileName);
      if (target) target.status = { kind: 'installed' };
      return state;
    },
  };
};
