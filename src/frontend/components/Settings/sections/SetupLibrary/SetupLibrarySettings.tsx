import { useMemo, useState } from 'react';
import type {
  SetupFileProblem,
  SetupFileStatus,
  SetupLibraryBridge,
  SetupLibraryState,
  SetupLibraryTrack,
} from '@irdashies/types';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { SettingToggleRow } from '../../components/SettingToggleRow';
import { SettingsSection } from '../../components/SettingSection';
import { useSetupLibrary } from './useSetupLibrary';

interface SetupLibrarySettingsProps {
  /** For stories and specs; the app uses the preload bridge. */
  bridge?: SetupLibraryBridge;
}

const PROBLEM_TEXT: Record<SetupFileProblem, string> = {
  empty: 'the file is empty',
  'too-large': 'larger than 256 KB',
  'no-vehicle-class': 'no VehicleClassSetting line',
  unreadable: 'could not be read',
};

const statusText = (status: SetupFileStatus): string => {
  switch (status.kind) {
    case 'installed':
      return 'In the game';
    case 'ready':
      return 'Not in the game yet';
    case 'pending':
      return 'Being written';
    case 'conflict':
      return status.reason === 'changed-in-game'
        ? 'Changed in the game'
        : 'Another file has this name';
    case 'invalid':
      return `Not a setup file: ${PROBLEM_TEXT[status.problem]}`;
    case 'error':
      return `Could not copy (${status.code})`;
  }
};

const statusTone = (status: SetupFileStatus): string => {
  switch (status.kind) {
    case 'conflict':
      return 'text-amber-300';
    case 'invalid':
    case 'error':
      return 'text-red-300';
    case 'pending':
      return 'text-slate-400';
    default:
      return 'text-slate-300';
  }
};

const equalsName = (a: string, b: string): boolean =>
  a.toLowerCase() === b.toLowerCase();

const sessionLine = (state: SetupLibraryState): string => {
  if (!state.lmuConnected) return 'Le Mans Ultimate is not running.';
  if (!state.autoInstall) return 'Automatic install is off.';
  if (state.restReachable === false) {
    return 'Le Mans Ultimate is running, but its REST API did not answer.';
  }
  if (state.sessionTrackFolder) {
    return `Le Mans Ultimate is running. Track folder: ${state.sessionTrackFolder}.`;
  }
  return 'Le Mans Ultimate is running, but it reported no track folder.';
};

interface TrackSectionProps {
  track: SetupLibraryTrack;
  state: SetupLibraryState;
  onInstall: (folder: string) => void;
  onReplace: (folder: string, fileName: string) => void;
}

const TrackSection = ({
  track,
  state,
  onInstall,
  onReplace,
}: TrackSectionProps) => {
  const isSession = useMemo(
    () =>
      Boolean(
        state.sessionTrackFolder &&
        equalsName(state.sessionTrackFolder, track.folder)
      ),
    [state.sessionTrackFolder, track.folder]
  );
  const installDisabled =
    state.gameFolder === null || track.gameFolder === null;
  const disabledReason =
    state.gameFolder === null
      ? 'Choose the Le Mans Ultimate folder above to install setups.'
      : track.gameFolder === null
        ? 'The game has no track folder with this name.'
        : null;

  return (
    <SettingsSection
      title={`${track.folder}${isSession ? ' (this session)' : ''}`}
    >
      {track.gameFolder !== null && (
        <p className="text-sm text-slate-400">
          In the game: {track.gameFolder}
        </p>
      )}
      {track.files.length === 0 ? (
        <p className="text-sm text-slate-500">No setups in this folder.</p>
      ) : (
        <ul className="divide-y divide-slate-700/60">
          {track.files.map((entry) => (
            <li
              key={entry.fileName}
              className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-1.5"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-slate-200">
                  {entry.fileName}
                </span>
                <span className="block truncate text-xs text-slate-500">
                  {entry.vehicleClass ?? '-'}
                </span>
              </span>
              <span className={`text-sm ${statusTone(entry.status)}`}>
                {statusText(entry.status)}
              </span>
              {entry.status.kind === 'conflict' && (
                <button
                  type="button"
                  className="settings-button flex-none"
                  onClick={() => onReplace(track.folder, entry.fileName)}
                >
                  Replace
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="settings-button-primary"
          disabled={installDisabled}
          onClick={() => onInstall(track.folder)}
        >
          Install to game
        </button>
        {disabledReason && (
          <span className="text-sm text-slate-400">{disabledReason}</span>
        )}
      </div>
    </SettingsSection>
  );
};

/**
 * The setup library: the folder Tearoff reads setups from, the game folder
 * it copies them into, and what stands between the two.
 */
export const SetupLibrarySettings = ({ bridge }: SetupLibrarySettingsProps) => {
  const library = useSetupLibrary(bridge ?? window.setupLibraryBridge);
  const [pendingReplace, setPendingReplace] = useState<{
    folder: string;
    fileName: string;
  } | null>(null);
  const [folderProblem, setFolderProblem] = useState<string | null>(null);

  if (!library.available) {
    return (
      <div className="h-full overflow-y-auto">
        <div className="border-b border-slate-700 pb-5 pt-1">
          <h2 className="mb-1 text-xl font-semibold tracking-tight text-white">
            Setups
          </h2>
          <p className="text-slate-400">
            Setups are available in the desktop app.
          </p>
        </div>
      </div>
    );
  }

  const state = library.state;

  const chooseFolder = async () => {
    const result = await library.chooseGameFolder();
    setFolderProblem(
      result === 'not-lmu-folder'
        ? 'That folder is not a Le Mans Ultimate installation.'
        : null
    );
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-none flex-wrap items-start justify-between gap-3 border-b border-slate-700 px-1 pb-5 pt-1">
        <div>
          <h2 className="mb-1 text-xl font-semibold tracking-tight text-white">
            Setups
          </h2>
          <p className="text-slate-400">
            Le Mans Ultimate setups that Tearoff puts into the game for the
            track you are driving.
          </p>
        </div>
        <button
          type="button"
          className="settings-button"
          disabled={library.loading}
          onClick={() => void library.refresh()}
        >
          Refresh
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1 pt-5 [scrollbar-gutter:stable]">
        {library.error && (
          <div
            role="alert"
            className="rounded-md border border-red-500/50 bg-red-950/60 p-3 text-sm text-red-100"
          >
            {library.error}
          </div>
        )}
        {library.loading || !state ? (
          <p className="px-1 text-slate-400">Loading...</p>
        ) : (
          <>
            <SettingsSection title="Library">
              <p className="text-sm text-slate-400">
                Put each setup in a folder named after the track&apos;s folder
                in the game, for example Spa\My setup.svm. Tearoff never changes
                these files.
              </p>
              <p className="break-all font-mono text-sm text-slate-300">
                {state.libraryFolder}
              </p>
              {!state.libraryExists && (
                <p className="text-sm text-slate-400">
                  The folder does not exist yet. Open folder creates it.
                </p>
              )}
              <div>
                <button
                  type="button"
                  className="settings-button"
                  onClick={() => void library.openLibraryFolder()}
                >
                  Open folder
                </button>
              </div>
            </SettingsSection>

            <SettingsSection title="Game">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm text-slate-400">
                    Le Mans Ultimate folder
                  </p>
                  <p className="break-all font-mono text-sm text-slate-300">
                    {state.gameFolder ?? 'Not found'}
                  </p>
                  {state.gameFolderSource && (
                    <p className="text-xs text-slate-500">
                      {state.gameFolderSource === 'steam'
                        ? 'Found through Steam'
                        : 'Chosen'}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  className="settings-button flex-none"
                  onClick={() => void chooseFolder()}
                >
                  Choose folder...
                </button>
              </div>
              {folderProblem && (
                <p role="alert" className="text-sm text-red-300">
                  {folderProblem}
                </p>
              )}
              <SettingToggleRow
                title="Install setups automatically"
                description="When you join a session, the setups for its track are copied into the game. Load them in the garage. Nothing is deleted, and a setup you changed in the game is never replaced without asking."
                enabled={state.autoInstall}
                onToggle={(enabled) => void library.setAutoInstall(enabled)}
              />
              <p className="text-sm text-slate-400">{sessionLine(state)}</p>
              {state.gameTrackFolders.length > 0 && (
                <p className="text-xs text-slate-500">
                  Track folders in the game: {state.gameTrackFolders.join(', ')}
                </p>
              )}
            </SettingsSection>

            {state.tracks.length === 0 && state.unplacedFiles.length === 0 && (
              <div className="rounded-lg border border-slate-700 bg-slate-800/50 px-4 py-8 text-center text-slate-400">
                No setups yet. Put .svm files into a track folder inside the
                library folder.
              </div>
            )}

            {state.tracks.map((track) => (
              <TrackSection
                key={track.folder}
                track={track}
                state={state}
                onInstall={(folder) => void library.installTrack(folder)}
                onReplace={(folder, fileName) =>
                  setPendingReplace({ folder, fileName })
                }
              />
            ))}

            {state.unplacedFiles.length > 0 && (
              <SettingsSection title="Not in a track folder">
                <p className="text-sm text-amber-300">
                  These files are not in a track folder, so they are not
                  installed:
                </p>
                <ul className="space-y-0.5 font-mono text-sm text-slate-300">
                  {state.unplacedFiles.map((fileName) => (
                    <li key={fileName} className="break-all">
                      {fileName}
                    </li>
                  ))}
                </ul>
              </SettingsSection>
            )}

            {state.truncated && (
              <p className="px-1 text-sm text-slate-400">
                Only part of the library is shown: it holds more than 200
                folders or files per folder.
              </p>
            )}
          </>
        )}
      </div>

      <ConfirmDialog
        isOpen={pendingReplace !== null}
        title="Replace the setup in the game?"
        message={
          'The copy in the game will be replaced by the library file. The version that is there now is kept beside it, with "kept" and the date in its name, so nothing is lost.'
        }
        confirmText="Replace"
        variant="danger"
        onConfirm={() => {
          const target = pendingReplace;
          setPendingReplace(null);
          if (target) void library.replaceSetup(target.folder, target.fileName);
        }}
        onCancel={() => setPendingReplace(null)}
      />
    </div>
  );
};
