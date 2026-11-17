import { describe, expect, it } from 'vitest';
import {
  isRecordedSource,
  isTapeReplaySource,
  keepsPlayerRecords,
} from './tapeReplaySource';

describe('isTapeReplaySource', () => {
  it('is false with no tape in the environment', () => {
    expect(isTapeReplaySource({})).toBe(false);
    expect(isTapeReplaySource({ IRDASHIES_TELEMETRY_REPLAY: '' })).toBe(false);
  });

  it.each(['IRDASHIES_TELEMETRY_REPLAY', 'IRDASHIES_LMU_REPLAY'])(
    'is true when %s names a tape',
    (name) => {
      expect(isTapeReplaySource({ [name]: 'session.tape' })).toBe(true);
    }
  );

  it('does not take an isolated SDK replay for a tape', () => {
    expect(isTapeReplaySource({ IRDASHIES_IRSDK_REPLAY: '1' })).toBe(false);
  });
});

describe('isRecordedSource', () => {
  it('is false for a simulator being driven', () => {
    expect(isRecordedSource({})).toBe(false);
    expect(isRecordedSource({ IRDASHIES_IRSDK_REPLAY: '0' })).toBe(false);
    expect(isRecordedSource({ IRDASHIES_TELEMETRY_REPLAY: '' })).toBe(false);
  });

  it.each(['IRDASHIES_TELEMETRY_REPLAY', 'IRDASHIES_LMU_REPLAY'])(
    'is true for a tape named by %s',
    (name) => {
      expect(isRecordedSource({ [name]: 'session.tape' })).toBe(true);
    }
  );

  it('is true for a capture played through the isolated SDK addon', () => {
    expect(isRecordedSource({ IRDASHIES_IRSDK_REPLAY: '1' })).toBe(true);
  });
});

describe('keepsPlayerRecords', () => {
  const driving = { replaySource: false, demoMode: false };

  it('keeps what the player drives', () => {
    expect(keepsPlayerRecords(driving, {})).toBe(true);
  });

  // The lap library went by the tapes alone, so a capture played through the
  // isolated SDK addon wrote its laps into the player's library.
  it.each([
    ['a telemetry tape', { IRDASHIES_TELEMETRY_REPLAY: 'session.tape' }],
    ['a Le Mans Ultimate tape', { IRDASHIES_LMU_REPLAY: 'session.tape' }],
    [
      'a capture through the isolated SDK addon',
      { IRDASHIES_IRSDK_REPLAY: '1' },
    ],
  ])('keeps nothing of %s', (_what, env) => {
    expect(keepsPlayerRecords(driving, env)).toBe(false);
  });

  it('keeps nothing of a replay source or of demo mode', () => {
    expect(keepsPlayerRecords({ ...driving, replaySource: true }, {})).toBe(
      false
    );
    expect(keepsPlayerRecords({ ...driving, demoMode: true }, {})).toBe(false);
  });
});
