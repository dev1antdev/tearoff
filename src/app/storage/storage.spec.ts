import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const { testDir, logger } = vi.hoisted(() => ({
  testDir: `./tmp-data/storage-spec-${process.pid}`,
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../logger', () => ({ default: logger }));

vi.mock('electron', () => ({
  app: { getPath: vi.fn().mockReturnValue(testDir) },
}));

import {
  flushStorageWritesOnShutdown,
  readData,
  writeData,
  writeDataAsync,
} from './storage';

let fileNumber = 0;
/** A file of its own for each case: the module caches what it has read. */
const nextFile = (): string => {
  fileNumber += 1;
  return path.join(testDir, `config-${fileNumber}.json`);
};

describe('storage', () => {
  beforeEach(() => {
    fs.mkdirSync(testDir, { recursive: true });
    logger.info.mockReset();
    logger.warn.mockReset();
  });

  afterAll(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  describe('a file that is not there yet', () => {
    it('reads as empty with one info line, however often it is read', () => {
      const file = nextFile();
      for (let read = 0; read < 5; read += 1) {
        expect(readData('dashboards', file)).toBeUndefined();
      }

      expect(logger.warn).not.toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledTimes(1);
      // The name alone: no path, no error, no stack.
      expect(logger.info).toHaveBeenCalledWith(
        `No ${path.basename(file)} yet: starting from the defaults`
      );
    });

    it('is created by the first write without a warning', () => {
      const file = nextFile();
      writeData('key', 1, file);

      expect(readData('key', file)).toBe(1);
      expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({ key: 1 });
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it('is created by the first async write without a warning', async () => {
      const file = nextFile();
      await writeDataAsync('key', 2, file);
      await flushStorageWritesOnShutdown();

      expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({ key: 2 });
      expect(logger.warn).not.toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledTimes(1);
    });

    it('says so once for each file', () => {
      const first = nextFile();
      const second = nextFile();
      readData('key', first);
      readData('key', second);
      readData('key', first);

      expect(logger.info).toHaveBeenCalledTimes(2);
    });
  });

  describe('a file that is there and cannot be used', () => {
    it('warns with the error when it does not parse', () => {
      const file = nextFile();
      fs.writeFileSync(file, '{"dashboards": ');

      expect(readData('dashboards', file)).toBeUndefined();
      expect(logger.warn).toHaveBeenCalledWith(
        'Failed to read config file',
        expect.any(SyntaxError)
      );
      expect(logger.warn).toHaveBeenCalledWith('Creating new config file');
      expect(logger.info).not.toHaveBeenCalled();
    });

    it('warns with the error when it cannot be read', () => {
      // A folder where the file should be: the read fails, and not with
      // "no such file".
      const file = nextFile();
      fs.mkdirSync(file);

      expect(readData('dashboards', file)).toBeUndefined();
      expect(logger.warn).toHaveBeenCalledWith(
        'Failed to read config file',
        expect.objectContaining({ code: expect.not.stringMatching('ENOENT') })
      );
      expect(logger.info).not.toHaveBeenCalled();
    });

    it('warns on the async path too', async () => {
      const file = nextFile();
      fs.writeFileSync(file, 'not json');
      await writeDataAsync('key', 3, file);

      expect(logger.warn).toHaveBeenCalledWith(
        'Failed to read config file',
        expect.any(SyntaxError)
      );
    });

    it('warns when it holds something other than an object', () => {
      const file = nextFile();
      fs.writeFileSync(file, '[1, 2]');

      expect(readData('key', file)).toBeUndefined();
      expect(logger.warn).toHaveBeenCalledWith(
        'Config file does not contain an object'
      );
    });
  });
});
