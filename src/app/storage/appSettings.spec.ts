import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getLmuGameFolder,
  getLmuSetupAutoInstall,
  getSessionProfileMap,
  setLmuGameFolder,
  setLmuSetupAutoInstall,
  setSessionProfileMap,
} from './appSettings';

const mockReadData = vi.hoisted(() => vi.fn());
const mockWriteData = vi.hoisted(() => vi.fn());
const mockWriteDataAsync = vi.hoisted(() => vi.fn());

vi.mock('./storage', () => ({
  readData: mockReadData,
  writeData: mockWriteData,
  writeDataAsync: mockWriteDataAsync,
}));

const KEY = 'sessionProfileMap';

describe('session profile map', () => {
  beforeEach(() => {
    mockReadData.mockReset();
    mockWriteData.mockReset();
    mockWriteDataAsync.mockReset();
  });

  /**
   * Reading must never write. An earlier version seeded every session type with
   * the profile in use on first run, which is only a no-op while that profile
   * stays active: pick another by hand without ever opening the feature and the
   * next session transition drags you back. Nothing here may map a trigger the
   * user has not mapped themselves.
   */
  describe('an install that has never configured the feature', () => {
    it('maps nothing, so no session transition switches a profile', () => {
      mockReadData.mockReturnValue(undefined);

      expect(getSessionProfileMap()).toEqual({});
    });

    it('does not write anything on being read', () => {
      mockReadData.mockReturnValue(undefined);

      getSessionProfileMap();

      expect(mockWriteData).not.toHaveBeenCalled();
    });
  });

  describe('get and set', () => {
    it('reads back what was stored', () => {
      mockReadData.mockReturnValue({ race: 'race-layout' });
      expect(getSessionProfileMap()).toEqual({ race: 'race-layout' });
    });

    it('reports an unconfigured map as empty', () => {
      mockReadData.mockReturnValue(undefined);
      expect(getSessionProfileMap()).toEqual({});
    });

    it('persists a map under the settings key', () => {
      setSessionProfileMap({ practice: 'a', spotting: 'b' });
      expect(mockWriteData).toHaveBeenCalledWith(KEY, {
        practice: 'a',
        spotting: 'b',
      });
    });
  });
});

describe('Le Mans Ultimate setup settings', () => {
  beforeEach(() => {
    mockReadData.mockReset();
    mockWriteData.mockReset();
    mockWriteDataAsync.mockReset();
  });

  it('has no chosen game folder until one is set', () => {
    mockReadData.mockReturnValue(undefined);
    expect(getLmuGameFolder()).toBeUndefined();
    mockReadData.mockReturnValue('');
    expect(getLmuGameFolder()).toBeUndefined();
  });

  it('persists the chosen game folder asynchronously', () => {
    setLmuGameFolder('C:\\Games\\LMU');
    expect(mockWriteDataAsync).toHaveBeenCalledWith(
      'lmuGameFolder',
      'C:\\Games\\LMU'
    );
    expect(mockWriteData).not.toHaveBeenCalled();
  });

  it('installs automatically unless that was turned off', () => {
    mockReadData.mockReturnValue(undefined);
    expect(getLmuSetupAutoInstall()).toBe(true);
    mockReadData.mockReturnValue(true);
    expect(getLmuSetupAutoInstall()).toBe(true);
    mockReadData.mockReturnValue(false);
    expect(getLmuSetupAutoInstall()).toBe(false);
  });

  it('persists the automatic install choice asynchronously', () => {
    setLmuSetupAutoInstall(false);
    expect(mockWriteDataAsync).toHaveBeenCalledWith(
      'lmuSetupAutoInstall',
      false
    );
    expect(mockWriteData).not.toHaveBeenCalled();
  });
});
