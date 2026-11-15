import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_FLAG_TUNING, type DashboardLayout } from '@irdashies/types';

vi.mock('./dashboards', () => ({
  getCurrentProfileId: vi.fn(),
  getDashboard: vi.fn(),
}));

import { flagTuningOf } from './flagTuning';

const withYellow = (yellow: unknown, id = 'flagpanel') =>
  ({
    widgets: [{ id, config: { yellow } }],
  }) as unknown as DashboardLayout;

describe('flagTuningOf', () => {
  it('takes the ranges and the sector switch of the flag panel', () => {
    expect(
      flagTuningOf(
        withYellow({ rangeAhead: 800, rangeBehind: 20, nameSector: true })
      )
    ).toEqual({
      yellowRangeAheadM: 800,
      yellowRangeBehindM: 20,
      yellowInOwnSector: true,
    });
  });

  it('keeps a range of nothing, which switches that side off', () => {
    expect(
      flagTuningOf(withYellow({ rangeAhead: 300, rangeBehind: 0 }))
        .yellowRangeBehindM
    ).toBe(0);
  });

  it('falls back to defaults for values that are not a sane distance', () => {
    expect(
      flagTuningOf(
        withYellow({
          rangeAhead: Number.NaN,
          rangeBehind: -5,
          nameSector: 'yes',
        })
      )
    ).toEqual(DEFAULT_FLAG_TUNING);
    expect(
      flagTuningOf(withYellow({ rangeAhead: '500', rangeBehind: 99_999 }))
    ).toEqual(DEFAULT_FLAG_TUNING);
  });

  it('uses the defaults without a flag panel, a dashboard or a yellow group', () => {
    expect(flagTuningOf(null)).toEqual(DEFAULT_FLAG_TUNING);
    expect(flagTuningOf(withYellow(null))).toEqual(DEFAULT_FLAG_TUNING);
    expect(flagTuningOf(withYellow({ rangeAhead: 900 }, 'flag'))).toEqual(
      DEFAULT_FLAG_TUNING
    );
  });

  it('returns its own object each time, never the shared defaults', () => {
    expect(flagTuningOf(null)).not.toBe(DEFAULT_FLAG_TUNING);
  });
});
