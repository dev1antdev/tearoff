import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  useBrakingSnapshot,
  useDashboard,
  useDrivingState,
  useSessionVisibility,
  useTrackStateSelector,
} from '@irdashies/context';
import type {
  BrakePerformanceConfig,
  BrakingSnapshot,
  BrakingZone,
} from '@irdashies/types';
import { BrakePerformance } from './BrakePerformance';

vi.mock('@irdashies/context', () => ({
  trackStateSelectors: { displayUnits: () => undefined },
  useBrakingSnapshot: vi.fn(),
  useDashboard: vi.fn(),
  useDrivingState: vi.fn(),
  useSessionVisibility: vi.fn(),
  useTrackStateSelector: vi.fn(),
}));

const zone = (extra: Partial<BrakingZone> = {}): BrakingZone => ({
  peakG: 2.39,
  averageG: 1.48,
  distanceM: 81,
  durationS: 1.88,
  entrySpeed: 59.5,
  exitSpeed: 32.3,
  absS: 0.5,
  deltaG: 0.1,
  endedAt: 267.69,
  ...extra,
});

const braking = (extra: Partial<BrakingSnapshot> = {}): BrakingSnapshot => ({
  available: true,
  live: null,
  last: zone(),
  referenceG: 2.39,
  sessionBestG: 2.5,
  zoneCount: 15,
  lockS: [0, 0],
  sessionNum: 0,
  version: 1,
  ...extra,
});

interface Scene {
  /** As saved: a config from an older build may lack whole groups. */
  config?: Partial<BrakePerformanceConfig>;
  isDriving?: boolean;
  sessionVisible?: boolean;
  /** The sim's DisplayUnits: 1 metric, 0 imperial. */
  displayUnits?: number;
}

const show = (
  snapshot: BrakingSnapshot | undefined,
  {
    config = {},
    isDriving = true,
    sessionVisible = true,
    displayUnits = 1,
  }: Scene = {}
) => {
  vi.mocked(useDashboard).mockReturnValue({
    currentDashboard: { widgets: [{ id: 'brakeperformance', config }] },
  } as unknown as ReturnType<typeof useDashboard>);
  vi.mocked(useBrakingSnapshot).mockReturnValue(snapshot);
  vi.mocked(useTrackStateSelector).mockReturnValue(displayUnits);
  vi.mocked(useDrivingState).mockReturnValue({
    isDriving,
    isWatching: false,
  });
  vi.mocked(useSessionVisibility).mockReturnValue(sessionVisible);
  return render(<BrakePerformance />);
};

/** The text of the widget with runs of white space as one space. */
const textOf = (container: HTMLElement): string =>
  (container.textContent ?? '').replace(/\s+/g, ' ').trim();

describe('BrakePerformance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('after a stop', () => {
    it('prints the peak, the share of the best and the rolling best', () => {
      const { container } = show(braking());

      expect(textOf(container)).toContain('2.39g');
      expect(container.querySelector('.bg-green-500\\/20')?.textContent).toBe(
        '+4%'
      );
      expect(textOf(container)).toContain('Best2.39g');
    });

    it('prints the speeds, the distance, the time, the average and the ABS', () => {
      const { container } = show(braking());

      expect(textOf(container)).toContain(
        '214116km/h81 m1.88 savg 1.48 gABS 0.5 s'
      );
    });

    it('leaves the ABS out when it did not work', () => {
      const { container } = show(braking({ last: zone({ absS: 0 }) }));

      expect(textOf(container)).not.toContain('ABS');
      expect(textOf(container)).toContain('avg 1.48 g');
    });

    it('draws a softer stop in amber', () => {
      const { container } = show(
        braking({
          last: zone({ peakG: 1.76, deltaG: -0.53 }),
          referenceG: 2.29,
        })
      );

      expect(container.querySelector('.bg-amber-500\\/20')?.textContent).toBe(
        '-23%'
      );
      expect(container.querySelector('.bg-green-500\\/20')).toBeNull();
    });

    it('prints the difference in g when asked', () => {
      const { container } = show(braking(), { config: { deltaUnit: 'g' } });

      expect(container.querySelector('.bg-green-500\\/20')?.textContent).toBe(
        '+0.10 g'
      );
    });

    it('measures against the best of the session when asked', () => {
      const { container } = show(braking(), {
        config: { reference: 'session' },
      });

      // 2.39 against 2.50.
      expect(container.querySelector('.bg-amber-500\\/20')?.textContent).toBe(
        '-4%'
      );
      expect(textOf(container)).toContain('Best2.50g');
    });

    it('has no colour and no share for the first stop of a stint', () => {
      const { container } = show(
        braking({
          last: zone({ peakG: 1.6, deltaG: 1.6 }),
          referenceG: 1.6,
        })
      );

      expect(container.querySelector('.bg-slate-500\\/20')?.textContent).toBe(
        '--'
      );
    });
  });

  describe('during a stop', () => {
    const live = braking({
      live: { peakG: 2.14, distanceM: 46, durationS: 0.9, entrySpeed: 59.5 },
      last: zone({ peakG: 1.72, deltaG: -0.63 }),
      referenceG: 2.29,
    });

    it('prints the peak so far and hides the comparison', () => {
      const { container } = show(live);

      expect(textOf(container)).toContain('2.14g');
      expect(textOf(container)).not.toContain('1.72');
      expect(textOf(container)).not.toContain('%');
      expect(textOf(container)).toContain('Best2.29g');
    });

    it('prints the entry speed with the distance and time running', () => {
      const { container } = show(live);

      expect(textOf(container)).toContain('214km/h46 m0.9 s');
      expect(textOf(container)).not.toContain('avg');
      expect(textOf(container)).not.toContain('ABS');
    });
  });

  describe('units', () => {
    it('follows the sim into mph and feet', () => {
      const { container } = show(braking(), { displayUnits: 0 });

      expect(textOf(container)).toContain('13372mph266 ft');
    });

    it('prints mph and feet when set to, whatever the sim says', () => {
      const { container } = show(braking(), {
        config: { speedUnit: 'mph' },
        displayUnits: 1,
      });

      expect(textOf(container)).toContain('13372mph266 ft');
    });

    it('prints km/h and metres when set to, whatever the sim says', () => {
      const { container } = show(braking(), {
        config: { speedUnit: 'km/h' },
        displayUnits: 0,
      });

      expect(textOf(container)).toContain('214116km/h81 m');
    });
  });

  describe('the lock times', () => {
    it('are slate at zero', () => {
      const { container } = show(braking());

      expect(textOf(container)).toContain('LockF 0.0 sR 0.0 s');
      expect(container.querySelectorAll('.text-slate-400')).toHaveLength(2);
    });

    it('are amber above zero and red from a second', () => {
      const { container } = show(braking({ lockS: [0.4, 1.3] }));

      expect(container.querySelector('.text-amber-300')?.textContent).toBe(
        'F 0.4 s'
      );
      expect(container.querySelector('.text-red-400')?.textContent).toBe(
        'R 1.3 s'
      );
    });

    it('are not drawn when the sim gives none', () => {
      const { container } = show(braking({ lockS: null }));

      expect(textOf(container)).not.toContain('Lock');
    });

    it('are not drawn when switched off', () => {
      const { container } = show(braking({ lockS: [0.4, 1.3] }), {
        config: { showLockTime: false },
      });

      expect(textOf(container)).not.toContain('Lock');
    });
  });

  it('leaves the zone detail out when switched off', () => {
    const { container } = show(braking(), {
      config: { showZoneDetail: false },
    });

    expect(textOf(container)).not.toContain('km/h');
    expect(textOf(container)).toContain('2.39g');
  });

  describe('with nothing to show', () => {
    it('keeps its shape with dashes before the first stop', () => {
      const { container } = show(
        braking({ last: null, referenceG: 0, sessionBestG: 0, zoneCount: 0 })
      );

      expect(textOf(container)).toBe(
        '--gBest--g----km/h-- m-- savg -- gLockF 0.0 sR 0.0 s'
      );
    });

    it('prints dashes out of the car, last stop or not', () => {
      const { container } = show(braking({ available: false }), {
        config: { showOnlyWhenOnTrack: false },
        isDriving: false,
      });

      expect(textOf(container)).toBe('--gBest--g----km/h-- m-- savg -- g');
    });

    it('prints dashes before the channel has answered', () => {
      const { container } = show(undefined);

      expect(textOf(container)).toBe('--gBest--g----km/h-- m-- savg -- g');
    });
  });

  describe('visibility', () => {
    it('hides while the player is not driving', () => {
      const { container } = show(braking(), { isDriving: false });

      expect(container).toBeEmptyDOMElement();
    });

    it('stays when set to show off track as well', () => {
      const { container } = show(braking(), {
        config: { showOnlyWhenOnTrack: false },
        isDriving: false,
      });

      expect(container).not.toBeEmptyDOMElement();
    });

    it('hides in a session it is switched off for', () => {
      const { container } = show(braking(), { sessionVisible: false });

      expect(container).toBeEmptyDOMElement();
    });
  });

  it('survives a config saved without its groups', () => {
    const { container } = show(braking(), {
      config: { background: undefined, sessionVisibility: undefined },
    });

    expect(textOf(container)).toContain('2.39g');
  });
});
