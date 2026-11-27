/**
 * The Le Mans Ultimate setup library as the settings window sees it.
 *
 * A library file is a `.svm` the person (or an outside producer) puts into
 * `<Documents>/Tearoff/Setups/LMU/<track folder>/`. Tearoff copies the
 * setups of the track being driven into the game's own setup folder; nothing
 * here can make it edit a setup, load one into the car, or delete one.
 */

/** Why a library file cannot be installed. */
export type SetupFileProblem =
  'empty' | 'too-large' | 'no-vehicle-class' | 'unreadable';

/** Where a valid library file stands against the game's copy. */
export type SetupFileStatus =
  | { kind: 'installed' }
  | { kind: 'ready' }
  | { kind: 'pending' }
  | { kind: 'conflict'; reason: 'changed-in-game' | 'not-from-tearoff' }
  | { kind: 'invalid'; problem: SetupFileProblem }
  | { kind: 'error'; code: string };

export interface SetupLibraryFile {
  fileName: string;
  /** The file's VehicleClassSetting, or null when it is not known. */
  vehicleClass: string | null;
  status: SetupFileStatus;
}

export interface SetupLibraryTrack {
  /** The folder's name in the library. */
  folder: string;
  /**
   * The game's own name for this track folder: a matching folder in the
   * game's Settings, or the session's track folder. Null when neither.
   */
  gameFolder: string | null;
  files: SetupLibraryFile[];
}

export interface SetupLibraryListing {
  libraryFolder: string;
  libraryExists: boolean;
  gameFolder: string | null;
  gameFolderSource: 'chosen' | 'steam' | null;
  /** Track folders found in the game's Settings folder, sorted. */
  gameTrackFolders: string[];
  tracks: SetupLibraryTrack[];
  /** `.svm` files lying in the library folder itself. */
  unplacedFiles: string[];
  /** True when a listing cap was reached. */
  truncated: boolean;
}

export interface SetupLibraryState extends SetupLibraryListing {
  autoInstall: boolean;
  lmuConnected: boolean;
  /** The track folder LMU reported, while connected and auto-install runs. */
  sessionTrackFolder: string | null;
  /** False once LMU's REST API failed to answer during this connection. */
  restReachable: boolean | null;
}

export type ChooseGameFolderResult = 'chosen' | 'cancelled' | 'not-lmu-folder';

/**
 * What the settings window can ask of the setup library.
 *
 * Only a library folder name, a file name or a boolean ever crosses in; no
 * path does in either direction.
 */
export interface SetupLibraryBridge {
  getState: () => Promise<SetupLibraryState>;
  openLibraryFolder: () => Promise<void>;
  chooseGameFolder: () => Promise<ChooseGameFolderResult>;
  setAutoInstall: (enabled: boolean) => Promise<void>;
  installTrack: (folder: string) => Promise<SetupLibraryState>;
  replaceSetup: (
    folder: string,
    fileName: string
  ) => Promise<SetupLibraryState>;
}
