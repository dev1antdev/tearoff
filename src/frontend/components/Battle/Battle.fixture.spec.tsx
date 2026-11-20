import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  defaultDashboard,
  type BattleConfig,
  type ChannelBridge,
  type DashboardLayout,
} from '@irdashies/types';
import { useSessionStore } from '@irdashies/context';
import { mountFixture } from '../../../testing/renderWithFixture';
import type { ReplayFixture } from '../../../testing/replayFixture';
import lmuRace from '../../../../test-data/fixtures/lmu-race-laguna-seca.json';
import { Battle } from './Battle';

/**
 * The rivals box on a recorded Le Mans Ultimate race, cut from the curated
 * tape: Laguna Seca, the player's LMGT3 second in class early in the third
 * lap, the class leader a third of a second ahead and the third car two and
 * a half seconds back. The frames go through the real processors and the
 * widget is the real one, with its default settings.
 *
 * Nobody is lapped, in the pits or watched on the recording: those rows are
 * STAGED on its frames, and say so.
 */
const race = lmuRace as unknown as ReplayFixture;

const AHEAD = 16;
const CARS = 38;

type Frame = ReplayFixture['frames'][number];

const staged = (
  fixture: ReplayFixture,
  change: (frame: Frame) => Frame
): ReplayFixture => ({ ...fixture, frames: fixture.frames.map(change) });

const numbers = (frame: Frame, key: string): number[] => frame[key] as number[];

const dashboardWith = (config: Partial<BattleConfig>): DashboardLayout => ({
  ...(defaultDashboard as DashboardLayout),
  widgets: (defaultDashboard as DashboardLayout).widgets.map((widget) =>
    widget.id === 'battle'
      ? { ...widget, config: { ...widget.config, ...config } }
      : widget
  ),
});

describe('Battle on a recorded LMU race', () => {
  const previousBridge = window.channelBridge;

  beforeEach(() => {
    useSessionStore.getState().resetSession();
  });
  afterEach(() => {
    // Unmount first: the widget reads the bridge and the session it is
    // about to lose.
    cleanup();
    if (previousBridge === undefined) {
      Reflect.deleteProperty(window, 'channelBridge');
    } else {
      window.channelBridge = previousBridge as ChannelBridge;
    }
    useSessionStore.getState().resetSession();
  });

  const battle = (
    fixture: ReplayFixture,
    config: Partial<BattleConfig> = {}
  ) => {
    const harness = mountFixture(fixture, {
      dashboard: dashboardWith(config),
    });
    const { container } = render(<Battle />, { wrapper: harness.wrapper });
    const cell = (row: string, column: string) =>
      container.querySelector(`[data-row="${row}"] [data-column="${column}"]`);
    return {
      container,
      cell,
      text: (row: string, column: string) =>
        cell(row, column)?.textContent ?? null,
    };
  };

  it('draws the class leader, the player and the car behind', () => {
    const { text } = battle(race);

    expect(text('ahead', 'position')).toBe('1');
    expect(text('ahead', 'carNumber')).toBe('#33');
    expect(text('ahead', 'driverName')).toBe('Graham Hill');
    expect(text('focus', 'position')).toBe('2');
    expect(text('focus', 'driverName')).toBe('Valtteri Bottas');
    expect(text('behind', 'position')).toBe('3');
    expect(text('behind', 'driverName')).toBe('Alberto Ascari');
  });

  it('draws its rows as the standings do: no stripes, the player tinted, numbers grey', () => {
    const { container, cell } = battle(race);
    const row = (side: string) =>
      container.querySelector(`[data-row="${side}"]`)?.className ?? '';

    expect(row('ahead')).not.toContain('bg-slate');
    expect(row('behind')).not.toContain('bg-slate');
    // A hairline over the row behind, inside its cells; none on the first.
    expect(row('behind')).toContain('shadow-[inset');
    expect(row('ahead')).not.toContain('shadow-[inset');
    expect(row('focus')).toContain('bg-amber-500/20');
    // The focus car's place in its amber, not on its class colour.
    expect(cell('focus', 'position')?.className).not.toMatch(/\bbg-/);
    expect(cell('ahead', 'carNumber')?.className).toContain('text-slate-400');
    expect(cell('ahead', 'carNumber')?.className).toContain('border-l-4');
  });

  it('prints each rival’s gap, and none for the player’s own row', () => {
    const { text } = battle(race);

    // A third of a second ahead, two and a half behind.
    expect(Number(text('ahead', 'gap'))).toBeGreaterThan(0.1);
    expect(Number(text('ahead', 'gap'))).toBeLessThan(0.7);
    expect(Number(text('behind', 'gap'))).toBeGreaterThan(2.1);
    expect(Number(text('behind', 'gap'))).toBeLessThan(2.9);
    expect(text('ahead', 'gap')).toMatch(/^\d\.\d\d$/);
    expect(text('focus', 'gap')).toBe('');
  });

  it('withholds the forecast and the trend: no line is crossed in the window', () => {
    const { text } = battle(race);

    for (const row of ['ahead', 'behind']) {
      expect(text(row, 'forecast')).toBe('—');
      expect(text(row, 'lineGap')).toBe('—');
      expect(text(row, 'trend')).toBe('');
    }
    expect(text('focus', 'forecast')).toBe('');
  });

  it('prints the laps, the stint and what each car has left', () => {
    const { text, cell } = battle(race);

    expect(text('focus', 'lastTime')).toBe('1:26.6');
    expect(text('ahead', 'lastTime')).toBe('1:26.9');
    expect(text('behind', 'lastTime')).toBe('1:28.6');
    // Nobody has stopped: two laps into the race, two into the stint, and
    // no lap completed in the window to measure a lap's usage from.
    expect(text('ahead', 'stint')).toBe('2');
    expect(text('focus', 'stint')).toBe('2');
    // Virtual energy, as LMGT3 runs on: no fuel pump beside the figure.
    expect(text('focus', 'lmuVirtualEnergy')).toBe('39%');
    expect(text('ahead', 'lmuVirtualEnergy')).toBe('30%');
    expect(text('behind', 'lmuVirtualEnergy')).toBe('31%');
    expect(cell('ahead', 'lmuVirtualEnergy')?.querySelector('svg')).toBeNull();
    // The class leader's 30 % is at the amber threshold.
    expect(
      cell('ahead', 'lmuVirtualEnergy')?.querySelector('span')?.className
    ).toContain('text-amber-300');
  });

  it('has no stops column where the fixture carries no count, and one once it does (staged)', () => {
    expect(battle(race).cell('ahead', 'pitStops')).toBeNull();
    cleanup();

    // STAGED: the sim's stop count as the mapper now publishes it, one
    // stop for the class leader and none for anyone else.
    const counted = staged(race, (frame) => ({
      ...frame,
      LmuCarIdxPitStops: Array.from({ length: CARS }, (_, carIdx) =>
        carIdx === AHEAD ? 1 : 0
      ),
    }));
    const { text } = battle(counted);

    expect(text('ahead', 'pitStops')).toBe('1');
    expect(text('focus', 'pitStops')).toBe('—');
  });

  it('shows the grid change when asked for: up five, up one, level', () => {
    const { cell } = battle(race, { positionChange: { enabled: true } });
    const change = (row: string) => {
      const span = cell(row, 'positionChange')?.querySelector('span');
      return `${span?.className.includes('text-green-400') ? '+' : ''}${span?.textContent}`;
    };

    expect(change('focus')).toBe('+5');
    expect(change('ahead')).toBe('+1');
    expect(change('behind')).toBe('');
  });

  it('reads a rival two laps down as 2L, with nothing else in its gap (staged)', () => {
    // STAGED: two laps taken off every LMGT3 behind the player.
    const classOf = new Map(
      (race.session?.DriverInfo?.Drivers ?? []).map((driver) => [
        driver.CarIdx,
        driver.CarClassID,
      ])
    );
    const lapped = staged(race, (frame) => {
      const places = numbers(frame, 'CarIdxClassPosition');
      const down = (laps: number, carIdx: number) =>
        classOf.get(carIdx) === classOf.get(0) && places[carIdx] > places[0]
          ? laps - 2
          : laps;
      return {
        ...frame,
        CarIdxLap: numbers(frame, 'CarIdxLap').map(down),
        CarIdxLapCompleted: numbers(frame, 'CarIdxLapCompleted').map(down),
      };
    });
    const { text } = battle(lapped);

    expect(text('behind', 'driverName')).toBe('Alberto Ascari');
    expect(text('behind', 'gap')).toBe('2L');
    expect(text('behind', 'lineGap')).toBe('');
    expect(text('behind', 'trend')).toBe('');
    expect(text('behind', 'forecast')).toBe('—');
  });

  it('badges a rival in the pit lane with its time there (staged)', () => {
    // STAGED: the class leader driving down the pit lane for the last
    // twelve seconds of the recording.
    const from = race.frames.length - 6;
    const pitting = staged(race, (frame) => {
      const inLane = race.frames.indexOf(frame) >= from;
      return {
        ...frame,
        CarIdxOnPitRoad: (frame.CarIdxOnPitRoad as boolean[]).map(
          (flag, carIdx) => (carIdx === AHEAD ? inLane : flag)
        ),
        CarIdxTrackSurface: numbers(frame, 'CarIdxTrackSurface').map(
          (surface, carIdx) => (carIdx === AHEAD && inLane ? 2 : surface)
        ),
      };
    });
    const { text, container } = battle(pitting);

    expect(text('ahead', 'status')).toMatch(/^PIT 1\d\.\d$/);
    expect(text('focus', 'status')).toBe('');
    expect(text('behind', 'status')).toBe('');
    // In the pits, the row is dimmed.
    expect(container.querySelector('[data-row="ahead"]')?.className).toContain(
      'text-white/60'
    );

    cleanup();
    const noTime = battle(pitting, {
      status: { enabled: true, showPitTime: false },
    });
    expect(noTime.text('ahead', 'status')).toBe('PIT');
  });

  it('follows the camera: the class leader’s rivals, with nobody ahead (staged)', () => {
    // STAGED: the camera on the class leader, as while watching it.
    const watching = staged(race, (frame) => ({ ...frame, CamCarIdx: AHEAD }));
    const { text } = battle(watching);

    expect(text('focus', 'driverName')).toBe('Graham Hill');
    // Nobody ahead: the row stays, in dashes.
    expect(text('ahead', 'driverName')).toBe('—');
    expect(text('ahead', 'gap')).toBe('—');
    expect(text('behind', 'driverName')).toBe('Valtteri Bottas');
  });
});
