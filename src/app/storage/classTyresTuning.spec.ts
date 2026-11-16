import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_CLASS_TYRES_TUNING,
  type DashboardLayout,
} from '@irdashies/types';

vi.mock('./dashboards', () => ({
  getCurrentProfileId: vi.fn(),
  getDashboard: vi.fn(),
}));

import { classTyresTuningOf } from './classTyresTuning';

const withTyres = (tyres: unknown, id = 'timingtower') =>
  ({
    widgets: [{ id, config: { tyres } }],
  }) as unknown as DashboardLayout;

describe('classTyresTuningOf', () => {
  it("takes what four tyres take from the Timing Tower's tyres", () => {
    expect(
      classTyresTuningOf(withTyres({ enabled: true, changeSeconds: 18 }))
    ).toEqual({ tyreChangeSeconds: 18 });
  });

  it('keeps 0, which leaves the figure to the sim', () => {
    expect(
      classTyresTuningOf(withTyres({ changeSeconds: 0 })).tyreChangeSeconds
    ).toBe(0);
  });

  it('falls back to the default for what is not a sane number of seconds', () => {
    for (const changeSeconds of [Number.NaN, -3, 99_999, '12', null]) {
      expect(classTyresTuningOf(withTyres({ changeSeconds }))).toEqual(
        DEFAULT_CLASS_TYRES_TUNING
      );
    }
  });

  it('uses the default without a tower, a dashboard or the setting', () => {
    expect(classTyresTuningOf(null)).toEqual(DEFAULT_CLASS_TYRES_TUNING);
    expect(classTyresTuningOf(withTyres(null))).toEqual(
      DEFAULT_CLASS_TYRES_TUNING
    );
    // A tower saved before the setting existed.
    expect(classTyresTuningOf(withTyres({ enabled: true }))).toEqual(
      DEFAULT_CLASS_TYRES_TUNING
    );
    expect(
      classTyresTuningOf(withTyres({ changeSeconds: 18 }, 'classrivals'))
    ).toEqual(DEFAULT_CLASS_TYRES_TUNING);
  });

  it('returns its own object each time, never the shared default', () => {
    expect(classTyresTuningOf(null)).not.toBe(DEFAULT_CLASS_TYRES_TUNING);
  });
});
