import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  useDamageSnapshot,
  useDashboard,
  useDrivingState,
  useSessionVisibility,
} from '@irdashies/context';
import type {
  DamageConfig,
  DamageSnapshot,
  DamageWheel,
} from '@irdashies/types';
import { Damage } from './Damage';

vi.mock('@irdashies/context', () => ({
  useDashboard: vi.fn(),
  useDamageSnapshot: vi.fn(),
  useDrivingState: vi.fn(),
  useSessionVisibility: vi.fn(),
}));

const wheel = (values: Partial<DamageWheel> = {}): DamageWheel => ({
  detached: false,
  punctured: false,
  suspensionDamage: 0,
  ...values,
});

/** A sound car with the sim's REST API answering. */
const snapshot = (values: Partial<DamageSnapshot> = {}): DamageSnapshot => ({
  available: true,
  body: [0, 0, 0, 0, 0, 0, 0, 0],
  wheels: [wheel(), wheel(), wheel(), wheel()],
  bodyIntegrity: 1,
  aeroIntegrity: 1,
  suspensionIntegrity: 1,
  tyreIntegrity: 0.98,
  overheating: false,
  impactBearingRad: null,
  repairSeconds: 0,
  repairChoice: null,
  sessionNum: 0,
  version: 1,
  ...values,
});

/** The recorded car from 240.7 s on. */
const frontDent = (values: Partial<DamageSnapshot> = {}): DamageSnapshot =>
  snapshot({
    body: [1, 0, 0, 0, 0, 0, 0, 0],
    bodyIntegrity: 0.94,
    aeroIntegrity: 0.97,
    repairChoice: 'Do Not Repair',
    ...values,
  });

interface Scene {
  /** As saved: a config from an older build may lack whole groups. */
  config?: Partial<{
    [K in keyof DamageConfig]: Partial<DamageConfig[K]>;
  }>;
  isDriving?: boolean;
  sessionVisible?: boolean;
}

const show = (
  damage: DamageSnapshot | undefined,
  { config = {}, isDriving = true, sessionVisible = true }: Scene = {}
) => {
  vi.mocked(useDashboard).mockReturnValue({
    currentDashboard: { widgets: [{ id: 'damage', config }] },
  } as unknown as ReturnType<typeof useDashboard>);
  vi.mocked(useDamageSnapshot).mockReturnValue(damage);
  vi.mocked(useDrivingState).mockReturnValue({
    isDriving,
    isWatching: false,
    isWatchingOwnCar: false,
    isWatchingOtherCar: false,
  });
  vi.mocked(useSessionVisibility).mockReturnValue(sessionVisible);
  return render(<Damage />);
};

const zoneLevels = () =>
  Array.from(
    { length: 8 },
    (_, zone) => screen.getByTestId(`damage-zone-${zone}`).dataset.level
  );

const wheelStates = () =>
  Array.from(
    { length: 4 },
    (_, index) => screen.getByTestId(`damage-wheel-${index}`).dataset.state
  );

const classOf = (testId: string) =>
  screen.getByTestId(testId).getAttribute('class') ?? '';

const stat = (name: string) => {
  const figure = screen.getByTestId(`damage-stat-${name}`);
  return { text: figure.textContent, tone: figure.dataset.tone };
};

const isDrawn = () => screen.queryByTestId('damage') !== null;

describe('Damage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('a sound car', () => {
    it('draws eight clean zones and four healthy wheels', () => {
      show(snapshot());

      expect(zoneLevels()).toEqual(['0', '0', '0', '0', '0', '0', '0', '0']);
      expect(wheelStates()).toEqual([
        'healthy',
        'healthy',
        'healthy',
        'healthy',
      ]);
      expect(classOf('damage-zone-0')).toContain('stroke-slate-500');
      expect(classOf('damage-wheel-0')).toContain('fill-slate-600');
    });

    it('reads 100% in the car and beside it, with no repair line', () => {
      show(snapshot());

      expect(screen.getByTestId('damage-reading')).toHaveTextContent('100%');
      expect(stat('aero')).toEqual({ text: '100%', tone: 'normal' });
      expect(stat('body').text).toBe('100%');
      expect(stat('suspension').text).toBe('100%');
      expect(stat('tyre').text).toBe('98%');
      expect(screen.queryByTestId('damage-repair')).toBeNull();
      expect(screen.queryByTestId('damage-impact')).toBeNull();
      expect(screen.queryByTestId('damage-overheating')).toBeNull();
    });
  });

  describe('the recorded dent', () => {
    it('turns the front zone amber and leaves the other seven', () => {
      show(frontDent());

      expect(zoneLevels()).toEqual(['1', '0', '0', '0', '0', '0', '0', '0']);
      expect(classOf('damage-zone-0')).toContain('stroke-amber-400');
      expect(classOf('damage-zone-1')).toContain('stroke-slate-500');
    });

    it('reads the aero figure in the car and the two beside it', () => {
      show(frontDent());

      expect(screen.getByTestId('damage-reading')).toHaveTextContent('97%');
      expect(stat('aero').text).toBe('97%');
      expect(stat('body').text).toBe('94%');
    });

    it('names the repair on offer, with no time while it is not chosen', () => {
      show(frontDent());

      expect(screen.getByTestId('damage-repair')).toHaveTextContent(
        'RepairDo Not Repair'
      );
      expect(screen.queryByTestId('damage-repair-time')).toBeNull();
    });

    it('points the wedge at the impact, in whole degrees', () => {
      // 13 degrees right of the nose, as recorded.
      show(frontDent({ impactBearingRad: 0.23 }));

      expect(
        screen.getByTestId('damage-impact').getAttribute('transform')
      ).toBe('rotate(13 31 40)');
    });
  });

  describe('heavy damage', () => {
    const wreck = () =>
      snapshot({
        body: [1, 2, 2, 2, 3, 1, 0, 0],
        wheels: [
          wheel({ suspensionDamage: 0.04 }),
          wheel({ punctured: true, suspensionDamage: 0.22 }),
          wheel({ suspensionDamage: 0.47 }),
          wheel({ detached: true, suspensionDamage: 1 }),
        ],
        bodyIntegrity: 0.31,
        aeroIntegrity: 0.38,
        suspensionIntegrity: 0,
        tyreIntegrity: 0.61,
        overheating: true,
        impactBearingRad: 1.92,
        repairSeconds: 95,
        repairChoice: 'Repair All',
      });

    it('colours each zone by its level', () => {
      show(wreck());

      expect(zoneLevels()).toEqual(['1', '2', '2', '2', '3', '1', '0', '0']);
      expect(classOf('damage-zone-1')).toContain('stroke-red-500');
      expect(classOf('damage-zone-4')).toContain('stroke-dasharray');
      expect(classOf('damage-zone-4')).toContain('stroke-red-500');
    });

    it('draws each wheel in its own state', () => {
      show(wreck());

      expect(wheelStates()).toEqual([
        'light',
        'punctured',
        'heavy',
        'detached',
      ]);
      expect(classOf('damage-wheel-0')).toContain('fill-amber-400');
      // A flat tyre is an empty red rim.
      expect(classOf('damage-wheel-1')).toContain('fill-none');
      expect(classOf('damage-wheel-1')).toContain('stroke-red-500');
      expect(classOf('damage-wheel-2')).toContain('fill-red-500');
      expect(classOf('damage-wheel-3')).toContain('fill-none');
    });

    it('pulses what has come off, and nothing else', () => {
      show(wreck());

      expect(classOf('damage-zone-4')).toContain('animate-pulse');
      expect(classOf('damage-wheel-3')).toContain('animate-pulse');
      expect(classOf('damage-zone-1')).not.toContain('animate-pulse');
      expect(classOf('damage-wheel-1')).not.toContain('animate-pulse');
    });

    it('holds still with the pulse switched off', () => {
      show(wreck(), { config: { flashDetached: false } });

      expect(classOf('damage-zone-4')).not.toContain('animate-pulse');
      expect(classOf('damage-wheel-3')).not.toContain('animate-pulse');
    });

    it('turns the figures at or under their warnings red', () => {
      show(wreck());

      expect(stat('aero')).toEqual({ text: '38%', tone: 'warn' });
      expect(stat('body')).toEqual({ text: '31%', tone: 'warn' });
      expect(stat('suspension')).toEqual({ text: '0%', tone: 'warn' });
      // 61 % of the tread is far from the 20 % it warns at.
      expect(stat('tyre')).toEqual({ text: '61%', tone: 'normal' });
      expect(screen.getByTestId('damage-reading').dataset.tone).toBe('warn');
    });

    it('shows the overheating warning and the repair with its time', () => {
      show(wreck());

      expect(screen.getByTestId('damage-overheating')).toBeInTheDocument();
      expect(screen.getByTestId('damage-repair-time')).toHaveTextContent(
        '1:35'
      );
      expect(screen.getByTestId('damage-repair-choice')).toHaveTextContent(
        'Repair All'
      );
    });
  });

  describe('settings', () => {
    it('leaves the wedge out when the impact is switched off', () => {
      show(frontDent({ impactBearingRad: 0.23 }), {
        config: { impact: { enabled: false } },
      });

      expect(screen.queryByTestId('damage-impact')).toBeNull();
    });

    it('leaves the overheating warning out when it is switched off', () => {
      show(snapshot({ overheating: true }), {
        config: { overheating: { enabled: false } },
      });

      expect(screen.queryByTestId('damage-overheating')).toBeNull();
    });

    it('leaves the repair line out when it is switched off', () => {
      show(frontDent({ repairSeconds: 35, repairChoice: 'Repair Body' }), {
        config: { repair: { enabled: false } },
      });

      expect(screen.queryByTestId('damage-repair')).toBeNull();
    });

    it('draws the figures alone, or the car alone', () => {
      const { unmount } = show(frontDent(), {
        config: { diagram: { enabled: false } },
      });
      expect(screen.queryByTestId('damage-diagram')).toBeNull();
      expect(stat('aero').text).toBe('97%');
      unmount();

      show(frontDent(), { config: { stats: { enabled: false } } });
      expect(screen.getByTestId('damage-diagram')).toBeInTheDocument();
      expect(screen.queryByTestId('damage-stat-aero')).toBeNull();
    });

    it('shows the body in the car, or nothing, when asked to', () => {
      const { unmount } = show(frontDent(), {
        config: { diagram: { reading: 'body' } },
      });
      expect(screen.getByTestId('damage-reading')).toHaveTextContent('94%');
      unmount();

      show(frontDent(), { config: { diagram: { reading: 'none' } } });
      expect(screen.queryByTestId('damage-reading')).toBeNull();
    });

    it('counts damage in the car, and integrity beside it', () => {
      show(frontDent(), { config: { diagram: { showDamage: true } } });

      expect(screen.getByTestId('damage-reading')).toHaveTextContent('3%');
      expect(stat('aero').text).toBe('97%');
    });

    it('warns where the settings say', () => {
      show(frontDent(), { config: { stats: { aeroWarn: 98 } } });

      expect(stat('aero').tone).toBe('warn');
      expect(stat('body').tone).toBe('normal');
    });

    it('fills in a config saved without its newer groups', () => {
      show(frontDent({ impactBearingRad: 0.23 }), {
        config: { background: { opacity: 40 } },
      });

      expect(
        screen.getByTestId('damage').style.getPropertyValue('--bg-opacity')
      ).toBe('40%');
      expect(screen.getByTestId('damage-impact')).toBeInTheDocument();
      expect(stat('tyre').text).toBe('98%');
    });
  });

  describe('before the sim has answered', () => {
    it('draws the wheels as unknown and the body figure in the car', () => {
      const unknown = wheel({ suspensionDamage: null });
      show(
        snapshot({
          wheels: [unknown, unknown, unknown, unknown],
          aeroIntegrity: null,
          suspensionIntegrity: null,
          repairSeconds: null,
        })
      );

      expect(wheelStates()).toEqual([
        'unknown',
        'unknown',
        'unknown',
        'unknown',
      ]);
      expect(classOf('damage-wheel-0')).toContain('fill-slate-800');
      expect(screen.getByTestId('damage-reading')).toHaveTextContent('100%');
      expect(stat('aero')).toEqual({ text: '--', tone: 'none' });
      expect(stat('suspension').text).toBe('--');
    });
  });

  describe('without a car', () => {
    const noCar = () =>
      frontDent({
        available: false,
        impactBearingRad: 0.23,
        overheating: true,
        repairSeconds: 30,
      });

    it('keeps its shape, in grey, with dashes for figures', () => {
      show(noCar());

      expect(isDrawn()).toBe(true);
      for (let zone = 0; zone < 8; zone += 1) {
        expect(classOf(`damage-zone-${zone}`)).toContain('stroke-slate-600');
      }
      expect(wheelStates()).toEqual([
        'unknown',
        'unknown',
        'unknown',
        'unknown',
      ]);
      expect(screen.getByTestId('damage-reading')).toHaveTextContent('--');
      expect(stat('aero')).toEqual({ text: '--', tone: 'none' });
      expect(stat('body').text).toBe('--');
      expect(stat('tyre').text).toBe('--');
    });

    it('draws nothing of a car that is not there', () => {
      show(noCar());

      expect(screen.queryByTestId('damage-impact')).toBeNull();
      expect(screen.queryByTestId('damage-overheating')).toBeNull();
      expect(screen.queryByTestId('damage-repair')).toBeNull();
    });

    it('keeps its shape before any snapshot has arrived', () => {
      show(undefined);

      expect(isDrawn()).toBe(true);
      expect(screen.getByTestId('damage-reading')).toHaveTextContent('--');
    });
  });

  describe('visibility', () => {
    it('is drawn in and out of the car by default', () => {
      show(snapshot(), { isDriving: false });

      expect(isDrawn()).toBe(true);
    });

    it('hides off track when set to show only on track', () => {
      const config = { showOnlyWhenOnTrack: true };
      const { unmount } = show(frontDent(), { config, isDriving: false });
      expect(isDrawn()).toBe(false);
      unmount();

      show(frontDent(), { config, isDriving: true });
      expect(isDrawn()).toBe(true);
    });

    it('hides in a session it is switched off for', () => {
      show(frontDent(), { sessionVisible: false });

      expect(isDrawn()).toBe(false);
    });

    it('hides a sound car when set to show only when damaged', () => {
      const config = { hideWhenUndamaged: true };
      const { unmount } = show(snapshot(), { config });
      expect(isDrawn()).toBe(false);
      unmount();

      show(frontDent(), { config });
      expect(isDrawn()).toBe(true);
    });

    it('comes up for an impact that left no mark, while it is fresh', () => {
      show(snapshot({ impactBearingRad: 0.46 }), {
        config: { hideWhenUndamaged: true },
      });

      expect(isDrawn()).toBe(true);
    });

    it('stays hidden without a car when set to show only when damaged', () => {
      show(undefined, { config: { hideWhenUndamaged: true } });

      expect(isDrawn()).toBe(false);
    });
  });
});
