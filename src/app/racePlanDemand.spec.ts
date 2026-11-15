import { describe, expect, it } from 'vitest';
import type { SimWidgetSupportConfig } from '@irdashies/types';
import { DEFAULT_SIM_WIDGET_SUPPORT } from '@irdashies/types';
import { canSimulatorShowRacePlan } from './racePlanDemand';

const support = DEFAULT_SIM_WIDGET_SUPPORT;

describe('canSimulatorShowRacePlan', () => {
  it('is true under iRacing, which the plans are written for', () => {
    expect(canSimulatorShowRacePlan('iracing', support)).toBe(true);
  });

  it('is false under Le Mans Ultimate, where both widgets are hidden', () => {
    expect(canSimulatorShowRacePlan('lmu', support)).toBe(false);
  });

  it('is true while no simulator is known', () => {
    expect(canSimulatorShowRacePlan(undefined, support)).toBe(true);
    expect(canSimulatorShowRacePlan(null, support)).toBe(true);
  });

  it('follows a support file that lets one of the widgets run under LMU', () => {
    const edited: SimWidgetSupportConfig = {
      ...support,
      disabledWidgets: {
        ...support.disabledWidgets,
        lmu: support.disabledWidgets.lmu.filter((id) => id !== 'stintplan'),
      },
    };
    expect(canSimulatorShowRacePlan('lmu', edited)).toBe(true);
  });
});
