import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { LMU_STEAM_APP_ID, detectLmuInstall, isLmuInstall } from './lmuInstall';

vi.mock('../../logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

let root: string;

const write = async (filePath: string, text: string): Promise<void> => {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, text);
};

const game = async (install: string): Promise<string> => {
  await fsp.mkdir(path.join(install, 'UserData', 'player'), {
    recursive: true,
  });
  return install;
};

beforeEach(async () => {
  root = await fsp.mkdtemp(path.join(os.tmpdir(), 'tearoff-lmu-install-'));
});

afterEach(async () => {
  // root is the exact mkdtemp result, never a real application profile.
  await fsp.rm(root, { recursive: true, force: true });
});

describe('isLmuInstall', () => {
  it('needs UserData/player to be a directory', async () => {
    const install = await game(path.join(root, 'LMU'));
    expect(await isLmuInstall(install)).toBe(true);

    const empty = path.join(root, 'empty');
    await fsp.mkdir(empty);
    expect(await isLmuInstall(empty)).toBe(false);
    expect(await isLmuInstall('')).toBe(false);
    expect(await isLmuInstall(path.join(root, 'missing'))).toBe(false);
  });
});

describe('detectLmuInstall', () => {
  const steamAt = async (steam: string, libraries: string[]): Promise<void> => {
    await write(
      path.join(steam, 'steamapps', 'libraryfolders.vdf'),
      [
        '"libraryfolders"',
        '{',
        ...libraries.flatMap((library, index) => [
          `  "${index}"`,
          '  {',
          `    "path"    "${library.replaceAll('\\', '\\\\')}"`,
          '  }',
        ]),
        '}',
      ].join('\n')
    );
  };

  it('finds the game through the app manifest', async () => {
    const steam = path.join(root, 'Steam');
    const library = path.join(root, 'Library');
    const install = await game(
      path.join(library, 'steamapps', 'common', 'LMU')
    );
    await steamAt(steam, [library]);
    await write(
      path.join(library, 'steamapps', `appmanifest_${LMU_STEAM_APP_ID}.acf`),
      '"AppState"\n{\n  "installdir"    "LMU"\n}\n'
    );

    expect(
      await detectLmuInstall({
        platform: 'win32',
        env: { ProgramFiles: path.dirname(steam) },
      })
    ).toBe(install);
  });

  it('falls back to the game’s usual folder name', async () => {
    const steam = path.join(root, 'Steam');
    const install = await game(
      path.join(steam, 'steamapps', 'common', 'Le Mans Ultimate')
    );
    await steamAt(steam, []);

    expect(
      await detectLmuInstall({
        platform: 'win32',
        env: { ProgramFiles: path.dirname(steam) },
      })
    ).toBe(install);
  });

  it('returns nothing when nothing is installed', async () => {
    const steam = path.join(root, 'Steam');
    await steamAt(steam, [path.join(root, 'empty-library')]);
    expect(
      await detectLmuInstall({
        platform: 'win32',
        env: { ProgramFiles: path.dirname(steam) },
      })
    ).toBeNull();
  });

  it('returns nothing off Windows', async () => {
    const steam = path.join(root, 'Steam');
    await game(path.join(steam, 'steamapps', 'common', 'Le Mans Ultimate'));
    await steamAt(steam, []);
    expect(
      await detectLmuInstall({
        platform: 'darwin',
        env: { ProgramFiles: path.dirname(steam) },
      })
    ).toBeNull();
  });
});
