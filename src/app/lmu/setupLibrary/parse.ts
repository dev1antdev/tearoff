/**
 * The text side of the setup library: what a `.svm` is, how LMU names a
 * track folder, and how Steam's library files are read.
 *
 * Pure text in and out, so every rule here is testable without a disk.
 */

/** The largest library file Tearoff reads, in bytes. */
export const SETUP_FILE_MAX_BYTES = 256 * 1024;

/** How far into a file the car's line is looked for. */
export const SETUP_VEHICLE_CLASS_SCAN_CHARS = 4096;

const SVM_NAME = /\.svm$/i;
// eslint-disable-next-line no-control-regex -- Windows refuses these in a name
const ILLEGAL_FOLDER_CHAR = /[<>:"/\\|?*\u0000-\u001f]/;
const VEHICLE_CLASS =
  /^[ \t]*VehicleClassSetting[ \t]*=[ \t]*"([^"\r\n]{1,200})"/m;

export const isSvmFileName = (name: string): boolean =>
  typeof name === 'string' && name.length <= 255 && SVM_NAME.test(name);

/**
 * Whether a name is one path segment a track folder may have: no separators,
 * no characters Windows refuses, no `..` and nothing ending in a dot or a
 * space (Windows would silently drop it).
 */
export const isTrackFolderName = (name: string): boolean => {
  if (typeof name !== 'string') return false;
  if (name.length < 1 || name.length > 128) return false;
  if (name === '.' || name === '..') return false;
  if (ILLEGAL_FOLDER_CHAR.test(name)) return false;
  return !/[. ]$/.test(name);
};

/**
 * The car a setup names, or null. LMU writes it on the first line as
 * `VehicleClassSetting="GT3 Porsche_911_GT3_R_LMGT3 WEC2025"`; only the
 * first few kilobytes are searched, since the line belongs at the top.
 */
export const readVehicleClassSetting = (text: string): string | null => {
  const body = text.startsWith('\uFEFF') ? text.slice(1) : text;
  const head = body.slice(0, SETUP_VEHICLE_CLASS_SCAN_CHARS);
  const match = VEHICLE_CLASS.exec(head);
  const value = match?.[1]?.trim();
  return value ? value : null;
};

export type SetupBytesCheck =
  | { ok: true; vehicleClass: string }
  | {
      ok: false;
      problem: 'empty' | 'too-large' | 'no-vehicle-class';
    };

/** What a library file's bytes are: a setup, or why they are not. */
export const classifySetupBytes = (bytes: Uint8Array): SetupBytesCheck => {
  if (bytes.length === 0) return { ok: false, problem: 'empty' };
  if (bytes.length > SETUP_FILE_MAX_BYTES) {
    return { ok: false, problem: 'too-large' };
  }
  const vehicleClass = readVehicleClassSetting(
    Buffer.from(bytes).toString('utf8')
  );
  return vehicleClass
    ? { ok: true, vehicleClass }
    : { ok: false, problem: 'no-vehicle-class' };
};

/**
 * The track folder LMU reports for the session, or null. The summary's
 * `currentTrackFolder` may be a bare folder name or a path; either way only
 * a single safe segment is accepted.
 */
export const trackFolderFromSummary = (body: string): string | null => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return null;
  }
  const raw = (parsed as { currentTrackFolder?: unknown }).currentTrackFolder;
  if (typeof raw !== 'string') return null;
  // A path may end with a separator; the folder is the last named segment.
  const path_ = raw.replace(/[\\/]+$/, '');
  const cut = Math.max(path_.lastIndexOf('/'), path_.lastIndexOf('\\'));
  const name = (cut >= 0 ? path_.slice(cut + 1) : path_).trim();
  return isTrackFolderName(name) ? name : null;
};

/** Every library path a Steam `libraryfolders.vdf` names. */
export const parseSteamLibraryPaths = (vdf: string): string[] => {
  const paths: string[] = [];
  const pattern = /"path"\s+"([^"]+)"/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(vdf)) !== null) {
    paths.push(match[1].replace(/\\\\/g, '\\'));
  }
  return paths;
};

/** The folder a Steam app manifest says the game is installed in. */
export const parseAppManifestInstallDir = (acf: string): string | null => {
  const match = /"installdir"\s+"([^"]+)"/.exec(acf);
  const value = match?.[1];
  return value && isTrackFolderName(value) ? value : null;
};
