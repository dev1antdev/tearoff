import type { SessionProfileMap } from '@irdashies/types';
import { readData, writeData, writeDataAsync } from './storage';

const CYCLE_PROFILES_KEY = 'cycleProfiles';
const SHOW_PROFILE_BANNER_KEY = 'showProfileBanner';
const SESSION_PROFILE_MAP_KEY = 'sessionProfileMap';
const GARAGE61_LAST_FOLDER_KEY = 'garage61LastFolder';
const IBT_LAST_FOLDER_KEY = 'ibtLastFolder';
const HIDE_OVERLAY_WHEN_PAUSED_KEY = 'hideOverlayWhenPaused';
const LMU_GAME_FOLDER_KEY = 'lmuGameFolder';
const LMU_SETUP_AUTO_INSTALL_KEY = 'lmuSetupAutoInstall';

/**
 * Whether a paused game takes the overlay off the screen. On unless it has
 * been turned off: a pause menu is not something to read lap times over.
 */
export const getHideOverlayWhenPaused = (): boolean => {
  return readData<boolean>(HIDE_OVERLAY_WHEN_PAUSED_KEY) ?? true;
};

export const setHideOverlayWhenPaused = (enabled: boolean): void => {
  writeData(HIDE_OVERLAY_WHEN_PAUSED_KEY, enabled);
};

export const getCycleProfiles = (): boolean => {
  return readData<boolean>(CYCLE_PROFILES_KEY) ?? false;
};

export const setCycleProfiles = (enabled: boolean): void => {
  writeData(CYCLE_PROFILES_KEY, enabled);
};

export const getShowProfileBanner = (): boolean => {
  return readData<boolean>(SHOW_PROFILE_BANNER_KEY) ?? true;
};

export const setShowProfileBanner = (enabled: boolean): void => {
  writeData(SHOW_PROFILE_BANNER_KEY, enabled);
};

/**
 * Which profile to switch to for each session type, plus one for spotting.
 * A key with no profile means "leave the profile alone" for that trigger, and
 * an unconfigured install has no key set at all.
 *
 * Nothing is seeded here. An earlier version pointed every session type at the
 * profile in use on first run so the settings page would show what the mapping
 * was for, described as behaviourally a no-op — and it is, but only while the
 * seeded profile stays active. Seed profile A, manually switch to B without
 * ever opening this feature, and the next session transition drags you back to
 * A: an automatic profile switch for someone who never asked for one, against
 * this feature's own documented default. Discoverability is a settings-page
 * problem and is solved there, with rows reading "Don't switch" and a one-click
 * "Use current profile for all".
 */
export const getSessionProfileMap = (): SessionProfileMap => {
  return readData<SessionProfileMap>(SESSION_PROFILE_MAP_KEY) ?? {};
};

export const setSessionProfileMap = (map: SessionProfileMap): void => {
  writeData(SESSION_PROFILE_MAP_KEY, map);
};

/** Directory the Garage 61 CSV picker last opened a file from, so it reopens there. */
export const getGarage61LastFolder = (): string | undefined => {
  return readData<string>(GARAGE61_LAST_FOLDER_KEY);
};

export const setGarage61LastFolder = (folderPath: string): void => {
  writeData(GARAGE61_LAST_FOLDER_KEY, folderPath);
};

/** Directory the .ibt picker last opened a file from, so it reopens there. */
export const getIbtLastFolder = (): string | undefined => {
  return readData<string>(IBT_LAST_FOLDER_KEY);
};

export const setIbtLastFolder = (folderPath: string): void => {
  writeData(IBT_LAST_FOLDER_KEY, folderPath);
};

/**
 * The Le Mans Ultimate folder the person chose, if they did. A stored value
 * is not trusted: it is only used while it still is a game folder.
 */
export const getLmuGameFolder = (): string | undefined => {
  const stored = readData<string>(LMU_GAME_FOLDER_KEY);
  return typeof stored === 'string' && stored !== '' ? stored : undefined;
};

export const setLmuGameFolder = (folder: string): Promise<void> =>
  writeDataAsync(LMU_GAME_FOLDER_KEY, folder);

/**
 * Whether the setups of the track being driven are copied into the game
 * while LMU runs. On unless it has been turned off: the library starts
 * empty, so an untouched install copies nothing.
 */
export const getLmuSetupAutoInstall = (): boolean =>
  readData<boolean>(LMU_SETUP_AUTO_INSTALL_KEY) !== false;

export const setLmuSetupAutoInstall = (enabled: boolean): Promise<void> =>
  writeDataAsync(LMU_SETUP_AUTO_INSTALL_KEY, enabled);
