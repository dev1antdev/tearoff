import { describe, expect, it } from 'vitest';
import {
  SETUP_FILE_MAX_BYTES,
  classifySetupBytes,
  isSvmFileName,
  isTrackFolderName,
  parseAppManifestInstallDir,
  parseSteamLibraryPaths,
  readVehicleClassSetting,
  trackFolderFromSummary,
} from './parse';

const CLASS = 'GT3 Porsche_911_GT3_R_LMGT3 WEC2025';
const setup = (classLine = `VehicleClassSetting="${CLASS}"`) =>
  `[GENERAL]\n${classLine}\n[REARWING]\nRWSetting=0//6.3 deg\n`;

describe('readVehicleClassSetting', () => {
  it('reads the car from the first line', () => {
    expect(readVehicleClassSetting(`VehicleClassSetting="${CLASS}"\n`)).toBe(
      CLASS
    );
  });

  it('reads it from a later line, with a BOM and CRLF', () => {
    const text = `\uFEFF[GENERAL]\r\n// note\r\n  VehicleClassSetting = "${CLASS}"\r\n`;
    expect(readVehicleClassSetting(text)).toBe(CLASS);
  });

  it('ignores a line beyond the scanned head', () => {
    const text = `${'x'.repeat(4096)}\nVehicleClassSetting="${CLASS}"\n`;
    expect(readVehicleClassSetting(text)).toBeNull();
  });

  it('refuses an empty, missing, long or unterminated value', () => {
    expect(readVehicleClassSetting('VehicleClassSetting=""\n')).toBeNull();
    expect(readVehicleClassSetting('VehicleClassSetting="   "\n')).toBeNull();
    expect(readVehicleClassSetting('[GENERAL]\n')).toBeNull();
    expect(
      readVehicleClassSetting(`VehicleClassSetting="${'a'.repeat(201)}"\n`)
    ).toBeNull();
    expect(readVehicleClassSetting(`VehicleClassSetting="${CLASS}\n`)).toBe(
      null
    );
  });
});

describe('classifySetupBytes', () => {
  it('accepts a setup and names its car', () => {
    expect(classifySetupBytes(Buffer.from(setup()))).toEqual({
      ok: true,
      vehicleClass: CLASS,
    });
  });

  it('reports an empty file', () => {
    expect(classifySetupBytes(Buffer.alloc(0))).toEqual({
      ok: false,
      problem: 'empty',
    });
  });

  it('reports a file past the limit', () => {
    const bytes = Buffer.alloc(SETUP_FILE_MAX_BYTES + 1, 0x41);
    expect(classifySetupBytes(bytes)).toEqual({
      ok: false,
      problem: 'too-large',
    });
  });

  it('reports a file that names no car', () => {
    expect(classifySetupBytes(Buffer.from('[GENERAL]\n'))).toEqual({
      ok: false,
      problem: 'no-vehicle-class',
    });
  });
});

describe('isSvmFileName', () => {
  it('accepts either case and refuses anything else', () => {
    expect(isSvmFileName('My setup.SVM')).toBe(true);
    expect(isSvmFileName('a.svm')).toBe(true);
    expect(isSvmFileName('a.svm.txt')).toBe(false);
    expect(isSvmFileName('svm')).toBe(false);
    expect(isSvmFileName('a.svm ')).toBe(false);
    expect(isSvmFileName(`${'a'.repeat(252)}.svm`)).toBe(false);
  });
});

describe('isTrackFolderName', () => {
  it('accepts the game’s own folder names', () => {
    for (const name of ['Spa', 'Lemans', 'WeatherTech Raceway', 'Spa 24h']) {
      expect(isTrackFolderName(name), name).toBe(true);
    }
  });

  it('refuses traversal and characters Windows rejects', () => {
    for (const name of [
      '',
      '.',
      '..',
      'a/b',
      'a\\b',
      'a:b',
      'a*b',
      'a?',
      'a|b',
      'a<b',
      'a>b',
      'a"b',
      'abc.',
      'abc ',
      'a\u0000b',
      'a\u001fb',
      'a'.repeat(129),
    ]) {
      expect(isTrackFolderName(name), JSON.stringify(name)).toBe(false);
    }
  });
});

describe('trackFolderFromSummary', () => {
  it('reads a bare folder name', () => {
    expect(
      trackFolderFromSummary(JSON.stringify({ currentTrackFolder: 'Spa' }))
    ).toBe('Spa');
  });

  it('takes the last segment of a path, either separator', () => {
    expect(
      trackFolderFromSummary(
        JSON.stringify({
          currentTrackFolder: 'C:\\LMU\\UserData\\player\\Settings\\Spa',
        })
      )
    ).toBe('Spa');
    expect(
      trackFolderFromSummary(
        JSON.stringify({ currentTrackFolder: '/lmu/settings/Lemans/' })
      )
    ).toBe('Lemans');
  });

  it('refuses a missing, empty, unsafe or non-JSON value', () => {
    expect(trackFolderFromSummary('{}')).toBeNull();
    expect(
      trackFolderFromSummary(JSON.stringify({ currentTrackFolder: '' }))
    ).toBeNull();
    expect(
      trackFolderFromSummary(JSON.stringify({ currentTrackFolder: '..' }))
    ).toBeNull();
    expect(
      trackFolderFromSummary(JSON.stringify({ currentTrackFolder: 'a:b' }))
    ).toBeNull();
    expect(
      trackFolderFromSummary(JSON.stringify({ currentTrackFolder: 7 }))
    ).toBeNull();
    expect(trackFolderFromSummary('not json')).toBeNull();
    expect(trackFolderFromSummary('[]')).toBeNull();
    expect(trackFolderFromSummary('null')).toBeNull();
  });
});

describe('parseSteamLibraryPaths', () => {
  it('reads each library path and unescapes backslashes', () => {
    const vdf = [
      '"libraryfolders"',
      '{',
      '  "0"',
      '  {',
      '    "path"    "C:\\\\Program Files (x86)\\\\Steam"',
      '  }',
      '  "1"',
      '  {',
      '    "path"    "D:\\\\SteamLibrary"',
      '  }',
      '}',
    ].join('\n');
    expect(parseSteamLibraryPaths(vdf)).toEqual([
      'C:\\Program Files (x86)\\Steam',
      'D:\\SteamLibrary',
    ]);
  });

  it('reads nothing from a file without paths', () => {
    expect(parseSteamLibraryPaths('"libraryfolders"\n{\n}')).toEqual([]);
  });
});

describe('parseAppManifestInstallDir', () => {
  it('reads the install folder', () => {
    const acf = [
      '"AppState"',
      '{',
      '  "appid"    "2399420"',
      '  "installdir"    "Le Mans Ultimate"',
      '}',
    ].join('\n');
    expect(parseAppManifestInstallDir(acf)).toBe('Le Mans Ultimate');
  });

  it('refuses a missing or multi-segment value', () => {
    expect(parseAppManifestInstallDir('"appid" "1"')).toBeNull();
    expect(
      parseAppManifestInstallDir('"installdir" "C:\\\\Games\\\\LMU"')
    ).toBeNull();
  });
});
