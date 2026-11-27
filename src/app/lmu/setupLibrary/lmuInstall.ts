import fsp from 'node:fs/promises';
import path from 'node:path';
import logger from '../../logger';
import { parseAppManifestInstallDir, parseSteamLibraryPaths } from './parse';

/**
 * Where Le Mans Ultimate is installed.
 *
 * LMU is Steam app 2399420. Its library is read from Steam's own
 * `libraryfolders.vdf`, and the game's folder from the app manifest, with the
 * conventional folder name as a fallback. Nothing here needs the game to run;
 * that is why it is preferred over the path LMU's shared memory carries,
 * which is only there while it does.
 */

export const LMU_STEAM_APP_ID = '2399420';
const LMU_FOLDER_NAME = 'Le Mans Ultimate';

const errorCode = (error: unknown): string =>
  (error as NodeJS.ErrnoException)?.code ?? 'UNKNOWN';

const isDirectory = async (dir: string): Promise<boolean> => {
  try {
    return (await fsp.stat(dir)).isDirectory();
  } catch {
    return false;
  }
};

/** Whether a folder is an LMU install: it has `UserData/player`. */
export const isLmuInstall = async (root: string): Promise<boolean> => {
  if (typeof root !== 'string' || root === '') return false;
  return isDirectory(path.join(root, 'UserData', 'player'));
};

const readText = async (filePath: string): Promise<string | null> => {
  try {
    return await fsp.readFile(filePath, 'utf8');
  } catch (error) {
    const code = errorCode(error);
    if (code !== 'ENOENT') {
      // The file's own name only: a full path carries the account name.
      logger.warn('[Setups] Failed to read', path.basename(filePath), code);
    }
    return null;
  }
};

const pushUnique = (list: string[], value: string): void => {
  if (!list.includes(value)) list.push(value);
};

/** The places Steam itself is usually installed, in the order to try. */
const steamRoots = (env: NodeJS.ProcessEnv): string[] => {
  const roots: string[] = [];
  const x86 = env['ProgramFiles(x86)'];
  const native = env.ProgramFiles;
  if (x86) pushUnique(roots, path.join(x86, 'Steam'));
  if (native) pushUnique(roots, path.join(native, 'Steam'));
  pushUnique(roots, 'C:\\Program Files (x86)\\Steam');
  return roots;
};

/**
 * The first LMU install found through Steam, or null. Windows only: the
 * layout it reads is Steam's own.
 */
export const detectLmuInstall = async (
  options: {
    platform?: NodeJS.Platform;
    env?: NodeJS.ProcessEnv;
  } = {}
): Promise<string | null> => {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  if (platform !== 'win32') return null;

  const libraries: string[] = [];
  for (const root of steamRoots(env)) {
    const vdf = await readText(
      path.join(root, 'steamapps', 'libraryfolders.vdf')
    );
    if (!vdf) continue;
    for (const library of parseSteamLibraryPaths(vdf)) {
      pushUnique(libraries, library);
    }
    pushUnique(libraries, root);
  }

  for (const library of libraries) {
    const steamapps = path.join(library, 'steamapps');
    const manifest = await readText(
      path.join(steamapps, `appmanifest_${LMU_STEAM_APP_ID}.acf`)
    );
    const installDir = manifest ? parseAppManifestInstallDir(manifest) : null;
    const candidates: string[] = [];
    if (installDir)
      pushUnique(candidates, path.join(steamapps, 'common', installDir));
    pushUnique(candidates, path.join(steamapps, 'common', LMU_FOLDER_NAME));
    for (const candidate of candidates) {
      if (await isLmuInstall(candidate)) return candidate;
    }
  }
  return null;
};
