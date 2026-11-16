import { describe, expect, it } from 'vitest';
import { isTapeReplaySource } from './tapeReplaySource';

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
