import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_WEAR_TUNING, type DashboardLayout } from '@irdashies/types';

const store = vi.hoisted(() => ({
  values: new Map<string, unknown>(),
}));

vi.mock('./dashboards', () => ({
  getCurrentProfileId: vi.fn(),
  getDashboard: vi.fn(),
}));
vi.mock('./trackCarStore', () => ({
  getTrackCarStore: () => ({
    get: (namespace: string, key: string) =>
      store.values.get(`${namespace}/${key}`),
    set: (namespace: string, key: string, value: unknown) =>
      void store.values.set(`${namespace}/${key}`, value),
  }),
}));

import { brakeLimitStore, wearTuningOf } from './wearForecast';

const withWear = (config: unknown, id = 'wear', type?: string) =>
  ({
    widgets: [{ id, ...(type ? { type } : {}), config }],
  }) as unknown as DashboardLayout;

describe('wearTuningOf', () => {
  it('takes the tread floor and the failure thicknesses of the wear widget', () => {
    expect(
      wearTuningOf(
        withWear({
          tyres: { floorPct: 20 },
          brakes: { failureFrontMm: 27.5, failureRearMm: 29 },
        })
      )
    ).toEqual({ floorPct: 20, failureFrontMm: 27.5, failureRearMm: 29 });
  });

  it('finds a second wear widget by its type', () => {
    expect(
      wearTuningOf(withWear({ tyres: { floorPct: 15 } }, 'wear-2', 'wear'))
        .floorPct
    ).toBe(15);
  });

  it('keeps 0, which leaves a failure thickness to the car', () => {
    expect(
      wearTuningOf(withWear({ brakes: { failureFrontMm: 0 } })).failureFrontMm
    ).toBe(0);
  });

  it('falls back to the defaults for values that are not a sane figure', () => {
    expect(
      wearTuningOf(
        withWear({
          tyres: { floorPct: 95 },
          brakes: { failureFrontMm: -1, failureRearMm: '30' },
        })
      )
    ).toEqual(DEFAULT_WEAR_TUNING);
    expect(
      wearTuningOf(withWear({ tyres: { floorPct: Number.NaN }, brakes: 7 }))
    ).toEqual(DEFAULT_WEAR_TUNING);
  });

  it('uses the defaults without a wear widget, a dashboard or a config', () => {
    expect(wearTuningOf(null)).toEqual(DEFAULT_WEAR_TUNING);
    expect(wearTuningOf(withWear(null))).toEqual(DEFAULT_WEAR_TUNING);
    expect(
      wearTuningOf(withWear({ tyres: { floorPct: 20 } }, 'tyres'))
    ).toEqual(DEFAULT_WEAR_TUNING);
  });

  it('returns its own object each time, never the shared defaults', () => {
    expect(wearTuningOf(null)).not.toBe(DEFAULT_WEAR_TUNING);
  });
});

describe('brakeLimitStore', () => {
  beforeEach(() => store.values.clear());

  it('keeps a learned thickness among the brake limits', () => {
    brakeLimitStore.set('lmu|Oreca 07|front', 25.4);

    expect(store.values.get('brakeLimits/lmu|Oreca 07|front')).toBe(25.4);
    expect(brakeLimitStore.get('lmu|Oreca 07|front')).toBe(25.4);
    expect(brakeLimitStore.get('lmu|Oreca 07|rear')).toBeUndefined();
  });

  it('reads nothing from a value that is not a thickness', () => {
    store.values.set('brakeLimits/lmu|Oreca 07|front', '25.4');
    store.values.set('brakeLimits/lmu|Oreca 07|rear', Number.NaN);

    expect(brakeLimitStore.get('lmu|Oreca 07|front')).toBeUndefined();
    expect(brakeLimitStore.get('lmu|Oreca 07|rear')).toBeUndefined();
  });
});
