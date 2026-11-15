import { afterEach, describe, expect, it } from 'vitest';
import {
  livePlayerStintSource,
  setLivePlayerStintSource,
} from './livePlayerStint';

afterEach(() => setLivePlayerStintSource(undefined));

describe('the player’s stint as the running ledger has it', () => {
  it('is no stint while there is no ledger', () => {
    expect(livePlayerStintSource.stintId()).toBe('');
    expect(livePlayerStintSource.stintOrdinal()).toBe(0);
  });

  it('follows the ledger that is named, as its stints move on', () => {
    let ordinal = 1;
    setLivePlayerStintSource({
      stintId: () => `tape:${ordinal}`,
      stintOrdinal: () => ordinal,
    });
    expect(livePlayerStintSource.stintId()).toBe('tape:1');
    expect(livePlayerStintSource.stintOrdinal()).toBe(1);

    ordinal = 2;
    expect(livePlayerStintSource.stintId()).toBe('tape:2');
    expect(livePlayerStintSource.stintOrdinal()).toBe(2);
  });

  it('follows the next ledger when another simulator takes over', () => {
    setLivePlayerStintSource({
      stintId: () => 'lmu:3',
      stintOrdinal: () => 3,
    });
    setLivePlayerStintSource({
      stintId: () => 'iracing:1',
      stintOrdinal: () => 1,
    });

    expect(livePlayerStintSource.stintId()).toBe('iracing:1');
  });

  it('is no stint again once the ledger is let go', () => {
    setLivePlayerStintSource({ stintId: () => 'lmu:3', stintOrdinal: () => 3 });

    setLivePlayerStintSource(undefined);

    expect(livePlayerStintSource.stintId()).toBe('');
    expect(livePlayerStintSource.stintOrdinal()).toBe(0);
  });
});
