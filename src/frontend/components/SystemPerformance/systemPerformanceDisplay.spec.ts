import { describe, expect, it } from 'vitest';
import {
  getWidgetDefaultConfig,
  type SystemPerformanceSnapshot,
} from '@irdashies/types';
import {
  NO_READING,
  formatGigabytes,
  formatPercent,
  formatWhole,
  frameRateTone,
  loadTone,
  performanceGroups,
} from './systemPerformanceDisplay';

const defaults = getWidgetDefaultConfig('systemperformance');

const snapshot = (
  values: Partial<SystemPerformanceSnapshot> = {}
): SystemPerformanceSnapshot => ({
  systemCpuPercent: 23.4,
  systemMemoryUsedGb: 15.2,
  systemMemoryTotalGb: 31.8,
  appCpuPercent: 1.2,
  appMemoryMb: 412,
  simFps: 118,
  simCpuPercent: 46,
  simGpuPercent: 71,
  gpuPercent: null,
  version: 1,
  ...values,
});

describe('load colour', () => {
  it('is white below the warning, amber from it and red from 95', () => {
    expect(loadTone(84.9, 85)).toBe('normal');
    expect(loadTone(85, 85)).toBe('caution');
    expect(loadTone(94.9, 85)).toBe('caution');
    expect(loadTone(95, 85)).toBe('critical');
    expect(loadTone(100, 85)).toBe('critical');
  });

  it('follows the warning where it is set', () => {
    expect(loadTone(60, 50)).toBe('caution');
    expect(loadTone(60, 70)).toBe('normal');
  });

  it('is red from 95 even with the warning set above that', () => {
    expect(loadTone(94, 100)).toBe('normal');
    expect(loadTone(96, 100)).toBe('critical');
  });

  it('has no colour without a reading', () => {
    expect(loadTone(null, 85)).toBe('none');
    expect(loadTone(undefined, 85)).toBe('none');
  });
});

describe('frame rate colour', () => {
  it('is white at the warning, amber below it and red below half of it', () => {
    expect(frameRateTone(60, 60)).toBe('normal');
    expect(frameRateTone(59, 60)).toBe('caution');
    expect(frameRateTone(30, 60)).toBe('caution');
    expect(frameRateTone(29, 60)).toBe('critical');
  });

  it('follows the warning where it is set', () => {
    expect(frameRateTone(100, 120)).toBe('caution');
    expect(frameRateTone(59, 120)).toBe('critical');
    expect(frameRateTone(100, 90)).toBe('normal');
  });

  it('has no colour without a reading', () => {
    expect(frameRateTone(null, 60)).toBe('none');
  });
});

describe('figures', () => {
  it('writes a percentage with a decimal below ten and without from there', () => {
    expect(formatPercent(0)).toBe('0.0');
    expect(formatPercent(1.2)).toBe('1.2');
    expect(formatPercent(9.9)).toBe('9.9');
    expect(formatPercent(10)).toBe('10');
    expect(formatPercent(23.4)).toBe('23');
    expect(formatPercent(99.5)).toBe('100');
  });

  it('writes gigabytes to a decimal and megabytes and frames whole', () => {
    expect(formatGigabytes(15.2)).toBe('15.2');
    expect(formatGigabytes(16)).toBe('16.0');
    expect(formatWhole(412)).toBe('412');
    expect(formatWhole(118)).toBe('118');
  });

  it('writes a placeholder where there is no reading', () => {
    expect(formatPercent(null)).toBe(NO_READING);
    expect(formatGigabytes(undefined)).toBe(NO_READING);
    expect(formatWhole(null)).toBe(NO_READING);
  });
});

describe('rows', () => {
  it('draws the machine, Tearoff and the sim under iRacing', () => {
    expect(performanceGroups(snapshot(), defaults)).toEqual([
      {
        key: 'system',
        label: 'System',
        metrics: [
          { kind: 'cpu', value: '23', unit: '%', tone: 'normal' },
          { kind: 'memory', value: '15.2', unit: 'GB', tone: 'normal' },
        ],
      },
      {
        key: 'app',
        label: 'Tearoff',
        metrics: [
          { kind: 'cpu', value: '1.2', unit: '%', tone: 'normal' },
          { kind: 'memory', value: '412', unit: 'MB', tone: 'normal' },
        ],
      },
      {
        key: 'sim',
        label: 'Sim',
        metrics: [
          { kind: 'fps', value: '118', unit: 'fps', tone: 'normal' },
          { kind: 'cpu', value: '46', unit: '%', tone: 'normal' },
          { kind: 'gpu', value: '71', unit: '%', tone: 'normal' },
        ],
      },
    ]);
  });

  it('leaves the sim out where it publishes no meters', () => {
    const groups = performanceGroups(
      snapshot({ simFps: null, simCpuPercent: null, simGpuPercent: null }),
      defaults
    );

    expect(groups.map((group) => group.key)).toEqual(['system', 'app']);
  });

  it('keeps the sim row, with a placeholder, when only one meter is missing', () => {
    const [, , sim] = performanceGroups(
      snapshot({ simGpuPercent: null }),
      defaults
    );

    expect(sim.metrics.map(({ value, tone }) => [value, tone])).toEqual([
      ['118', 'normal'],
      ['46', 'normal'],
      [NO_READING, 'none'],
    ]);
  });

  it('keeps the machine and Tearoff rows, as placeholders, before any reading', () => {
    const groups = performanceGroups(undefined, defaults);

    expect(groups.map((group) => group.key)).toEqual(['system', 'app']);
    for (const group of groups) {
      for (const metric of group.metrics) {
        expect(metric.value).toBe(NO_READING);
        expect(metric.tone).toBe('none');
      }
    }
  });

  it('shows memory before the first CPU figure', () => {
    const [system, app] = performanceGroups(
      snapshot({ systemCpuPercent: null, appCpuPercent: null }),
      defaults
    );

    expect(system.metrics.map(({ value }) => value)).toEqual([
      NO_READING,
      '15.2',
    ]);
    expect(app.metrics.map(({ value }) => value)).toEqual([NO_READING, '412']);
  });

  it('draws only the rows that are switched on', () => {
    expect(
      performanceGroups(snapshot(), {
        ...defaults,
        system: { enabled: false },
        app: { enabled: false },
      }).map((group) => group.key)
    ).toEqual(['sim']);
    expect(
      performanceGroups(snapshot(), {
        ...defaults,
        system: { enabled: false },
        app: { enabled: false },
        sim: { enabled: false },
      })
    ).toEqual([]);
  });

  it('colours every load by the one warning and the frame rate by its own', () => {
    const groups = performanceGroups(
      snapshot({
        systemCpuPercent: 91.3,
        appCpuPercent: 3.8,
        simFps: 27,
        simCpuPercent: 97.2,
        simGpuPercent: 88,
      }),
      defaults
    );
    const tones = Object.fromEntries(
      groups.flatMap((group) =>
        group.metrics.map((metric) => [
          `${group.key}.${metric.kind}`,
          metric.tone,
        ])
      )
    );

    expect(tones).toEqual({
      'system.cpu': 'caution',
      'system.memory': 'normal',
      'app.cpu': 'normal',
      'app.memory': 'normal',
      'sim.fps': 'critical',
      'sim.cpu': 'critical',
      'sim.gpu': 'caution',
    });
  });

  it('never colours memory, however full', () => {
    const [system] = performanceGroups(
      snapshot({ systemMemoryUsedGb: 31.7, systemMemoryTotalGb: 31.8 }),
      defaults
    );

    expect(system.metrics[1]).toMatchObject({ value: '31.7', tone: 'normal' });
  });

  it('uses the warnings as they are set', () => {
    const [system, , sim] = performanceGroups(
      snapshot({ systemCpuPercent: 62, simFps: 100 }),
      { ...defaults, warn: { cpuPercent: 60, fps: 120 } }
    );

    expect(system.metrics[0].tone).toBe('caution');
    expect(sim.metrics[0].tone).toBe('caution');
  });
});
