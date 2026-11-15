import { describe, expect, it } from 'vitest';
import {
  getWidgetDefaultConfig,
  type DamageSnapshot,
  type DamageWheel,
} from '@irdashies/types';
import {
  NO_READING,
  SUSPENSION_STEPS,
  damageStats,
  diagramReading,
  formatPercent,
  formatRepairTime,
  hasDamageToShow,
  integrityTone,
  repairRow,
  suspensionState,
  wheelState,
} from './damageDisplay';

const defaults = getWidgetDefaultConfig('damage');

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

const noCar = (): DamageSnapshot =>
  snapshot({
    available: false,
    aeroIntegrity: null,
    suspensionIntegrity: null,
    tyreIntegrity: null,
    repairSeconds: null,
  });

describe('suspensionState', () => {
  it('steps at 0.02, 0.15, 0.40 and 0.80', () => {
    expect(SUSPENSION_STEPS).toEqual({
      light: 0.02,
      medium: 0.15,
      heavy: 0.4,
      destroyed: 0.8,
    });
    expect(suspensionState(0)).toBe('healthy');
    expect(suspensionState(0.019)).toBe('healthy');
    expect(suspensionState(0.02)).toBe('light');
    expect(suspensionState(0.149)).toBe('light');
    expect(suspensionState(0.15)).toBe('medium');
    expect(suspensionState(0.399)).toBe('medium');
    expect(suspensionState(0.4)).toBe('heavy');
    expect(suspensionState(0.799)).toBe('heavy');
    expect(suspensionState(0.8)).toBe('destroyed');
    expect(suspensionState(1)).toBe('destroyed');
  });

  it('is unknown until the sim has answered', () => {
    expect(suspensionState(null)).toBe('unknown');
    expect(suspensionState(undefined)).toBe('unknown');
  });
});

describe('wheelState', () => {
  it('draws a wheel by its suspension', () => {
    expect(wheelState(wheel())).toBe('healthy');
    expect(wheelState(wheel({ suspensionDamage: 0.2 }))).toBe('medium');
    expect(wheelState(wheel({ suspensionDamage: null }))).toBe('unknown');
  });

  it('puts a flat tyre before the suspension behind it', () => {
    expect(wheelState(wheel({ punctured: true, suspensionDamage: 0.9 }))).toBe(
      'punctured'
    );
  });

  it('puts a wheel that has come off before everything', () => {
    expect(
      wheelState(
        wheel({ detached: true, punctured: true, suspensionDamage: 1 })
      )
    ).toBe('detached');
  });

  it('is unknown without a wheel to read', () => {
    expect(wheelState(undefined)).toBe('unknown');
  });
});

describe('formatPercent', () => {
  it('gives a whole per cent', () => {
    expect(formatPercent(1)).toBe('100%');
    expect(formatPercent(0.974)).toBe('97%');
    expect(formatPercent(0.005)).toBe('1%');
    expect(formatPercent(0)).toBe('0%');
  });

  it('gives the placeholder for no reading', () => {
    expect(formatPercent(null)).toBe(NO_READING);
    expect(formatPercent(undefined)).toBe(NO_READING);
  });
});

describe('integrityTone', () => {
  it('warns at the threshold and below it, not above', () => {
    expect(integrityTone(0.51, 50)).toBe('normal');
    expect(integrityTone(0.5, 50)).toBe('warn');
    expect(integrityTone(0.2, 50)).toBe('warn');
  });

  it('judges the per cent that is drawn', () => {
    // 50.4 % is drawn as 50 %, which is at the threshold.
    expect(integrityTone(0.504, 50)).toBe('warn');
    expect(integrityTone(0.506, 50)).toBe('normal');
  });

  it('has nothing to say about a missing reading', () => {
    expect(integrityTone(null, 50)).toBe('none');
  });
});

describe('damageStats', () => {
  const row = (damage: DamageSnapshot, key: string) =>
    damageStats(damage, defaults.stats).find((stat) => stat.key === key);

  it('lists aero, body, suspension and tyre', () => {
    expect(
      damageStats(snapshot(), defaults.stats).map((stat) => [
        stat.label,
        stat.value,
        stat.tone,
      ])
    ).toEqual([
      ['Aero', '100%', 'normal'],
      ['Body', '100%', 'normal'],
      ['Susp', '100%', 'normal'],
      ['Tyre', '98%', 'normal'],
    ]);
  });

  it('reads the recorded car after its dent', () => {
    const dented = snapshot({ bodyIntegrity: 0.94, aeroIntegrity: 0.97 });

    expect(row(dented, 'aero')?.value).toBe('97%');
    expect(row(dented, 'body')?.value).toBe('94%');
    expect(row(dented, 'aero')?.tone).toBe('normal');
  });

  it('warns on bent suspension at 70 per cent', () => {
    // A worst wheel of 0.35.
    const bent = row(snapshot({ suspensionIntegrity: 0.65 }), 'suspension');

    expect(bent).toMatchObject({ value: '65%', tone: 'warn' });
    expect(
      row(snapshot({ suspensionIntegrity: 0.71 }), 'suspension')?.tone
    ).toBe('normal');
  });

  it('warns on a worn tyre at 20 per cent', () => {
    expect(row(snapshot({ tyreIntegrity: 0.19 }), 'tyre')).toMatchObject({
      value: '19%',
      tone: 'warn',
    });
    expect(row(snapshot({ tyreIntegrity: 0.21 }), 'tyre')?.tone).toBe('normal');
  });

  it('warns on aero and body at 50 per cent', () => {
    const wrecked = snapshot({ aeroIntegrity: 0.5, bodyIntegrity: 0.44 });

    expect(row(wrecked, 'aero')?.tone).toBe('warn');
    expect(row(wrecked, 'body')?.tone).toBe('warn');
    expect(row(snapshot({ aeroIntegrity: 0.88 }), 'aero')).toMatchObject({
      value: '88%',
      tone: 'normal',
    });
  });

  it('follows the thresholds in the settings', () => {
    const stats = { ...defaults.stats, aeroWarn: 90 };

    expect(damageStats(snapshot({ aeroIntegrity: 0.88 }), stats)[0].tone).toBe(
      'warn'
    );
  });

  it('dashes what the sim has not said', () => {
    const waiting = snapshot({
      aeroIntegrity: null,
      suspensionIntegrity: null,
    });

    expect(row(waiting, 'aero')).toMatchObject({
      value: NO_READING,
      tone: 'none',
    });
    expect(row(waiting, 'suspension')?.value).toBe(NO_READING);
    expect(row(waiting, 'body')?.value).toBe('100%');
  });

  it('dashes every figure without a car, and before any snapshot', () => {
    for (const damage of [noCar(), undefined]) {
      expect(
        damageStats(damage, defaults.stats).map((stat) => stat.value)
      ).toEqual([NO_READING, NO_READING, NO_READING, NO_READING]);
    }
  });
});

describe('diagramReading', () => {
  const { diagram, stats } = defaults;

  it('shows aero integrity by default', () => {
    expect(
      diagramReading(snapshot({ aeroIntegrity: 0.97 }), diagram, stats)
    ).toEqual({ label: 'Aero', value: '97%', tone: 'normal' });
  });

  it('falls back to the body until the sim has given the aero figure', () => {
    expect(
      diagramReading(
        snapshot({ aeroIntegrity: null, bodyIntegrity: 0.94 }),
        diagram,
        stats
      )
    ).toEqual({ label: 'Body', value: '94%', tone: 'normal' });
  });

  it('shows the body when asked to', () => {
    expect(
      diagramReading(
        snapshot({ aeroIntegrity: 0.6, bodyIntegrity: 0.81 }),
        { ...diagram, reading: 'body' },
        stats
      )
    ).toEqual({ label: 'Body', value: '81%', tone: 'normal' });
  });

  it('counts damage instead of integrity, and warns on the same car', () => {
    const counted = { ...diagram, showDamage: true };

    expect(
      diagramReading(snapshot({ aeroIntegrity: 0.97 }), counted, stats)
    ).toEqual({ label: 'Aero', value: '3%', tone: 'normal' });
    // 30 % of the aero left reads as 70 % damage, and is as red.
    expect(
      diagramReading(snapshot({ aeroIntegrity: 0.3 }), counted, stats)
    ).toEqual({ label: 'Aero', value: '70%', tone: 'warn' });
    expect(
      diagramReading(snapshot({ aeroIntegrity: 0.3 }), diagram, stats)
    ).toEqual({ label: 'Aero', value: '30%', tone: 'warn' });
  });

  it('warns at the threshold of the figure it shows', () => {
    const body = { ...diagram, reading: 'body' as const };
    const strict = { ...stats, bodyWarn: 80 };

    expect(
      diagramReading(snapshot({ bodyIntegrity: 0.75 }), body, stats)?.tone
    ).toBe('normal');
    expect(
      diagramReading(snapshot({ bodyIntegrity: 0.75 }), body, strict)?.tone
    ).toBe('warn');
  });

  it('is a dash without a car', () => {
    expect(diagramReading(noCar(), diagram, stats)).toEqual({
      label: 'Aero',
      value: NO_READING,
      tone: 'none',
    });
    expect(diagramReading(undefined, diagram, stats)?.value).toBe(NO_READING);
  });

  it('is nothing when switched off', () => {
    expect(
      diagramReading(snapshot(), { ...diagram, reading: 'none' }, stats)
    ).toBeNull();
  });
});

describe('formatRepairTime', () => {
  it('has nothing to show for no repair', () => {
    expect(formatRepairTime(0)).toBeNull();
    expect(formatRepairTime(-1)).toBeNull();
    expect(formatRepairTime(0.4)).toBeNull();
    expect(formatRepairTime(null)).toBeNull();
    expect(formatRepairTime(undefined)).toBeNull();
  });

  it('gives whole seconds below a minute', () => {
    expect(formatRepairTime(35.4)).toBe('35s');
    expect(formatRepairTime(1)).toBe('1s');
    expect(formatRepairTime(59)).toBe('59s');
  });

  it('gives minutes and seconds from a minute on', () => {
    expect(formatRepairTime(60)).toBe('1:00');
    expect(formatRepairTime(95)).toBe('1:35');
    expect(formatRepairTime(605)).toBe('10:05');
  });
});

describe('repairRow', () => {
  it('is hidden on a sound car', () => {
    expect(repairRow(snapshot())).toBeNull();
  });

  it('is hidden while the sim has said nothing', () => {
    expect(repairRow(snapshot({ repairSeconds: null }))).toBeNull();
  });

  it('shows the choice alone while the menu is on leaving the damage', () => {
    // The state the recording ends in.
    expect(repairRow(snapshot({ repairChoice: 'Do Not Repair' }))).toEqual({
      time: null,
      choice: 'Do Not Repair',
    });
  });

  it('shows the time with the repair that costs it', () => {
    expect(
      repairRow(snapshot({ repairSeconds: 35, repairChoice: 'Repair Body' }))
    ).toEqual({ time: '35s', choice: 'Repair Body' });
  });

  it('shows a time the sim states without a choice', () => {
    expect(repairRow(snapshot({ repairSeconds: 95 }))).toEqual({
      time: '1:35',
      choice: null,
    });
  });

  it('is hidden without a car', () => {
    expect(
      repairRow({ ...noCar(), repairSeconds: 30, repairChoice: 'Repair All' })
    ).toBeNull();
    expect(repairRow(undefined)).toBeNull();
  });
});

describe('hasDamageToShow', () => {
  it('has nothing on a sound car, however worn its tyres', () => {
    expect(hasDamageToShow(snapshot(), defaults)).toBe(false);
    expect(hasDamageToShow(snapshot({ tyreIntegrity: 0.1 }), defaults)).toBe(
      false
    );
  });

  it('has nothing without a car', () => {
    expect(hasDamageToShow(noCar(), defaults)).toBe(false);
    expect(hasDamageToShow(undefined, defaults)).toBe(false);
  });

  it('shows a dent', () => {
    expect(
      hasDamageToShow(snapshot({ body: [1, 0, 0, 0, 0, 0, 0, 0] }), defaults)
    ).toBe(true);
  });

  it('shows a wheel that is off, flat or on bent suspension', () => {
    const withWheel = (values: Partial<DamageWheel>) =>
      snapshot({ wheels: [wheel(), wheel(values), wheel(), wheel()] });

    expect(hasDamageToShow(withWheel({ detached: true }), defaults)).toBe(true);
    expect(hasDamageToShow(withWheel({ punctured: true }), defaults)).toBe(
      true
    );
    expect(
      hasDamageToShow(withWheel({ suspensionDamage: 0.02 }), defaults)
    ).toBe(true);
    // Below the first step, and before the sim has answered: nothing.
    expect(
      hasDamageToShow(withWheel({ suspensionDamage: 0.01 }), defaults)
    ).toBe(false);
    expect(
      hasDamageToShow(withWheel({ suspensionDamage: null }), defaults)
    ).toBe(false);
  });

  it('shows aero damage', () => {
    expect(hasDamageToShow(snapshot({ aeroIntegrity: 0.99 }), defaults)).toBe(
      true
    );
    expect(hasDamageToShow(snapshot({ aeroIntegrity: null }), defaults)).toBe(
      false
    );
  });

  it('shows a fresh impact, where the impact is drawn', () => {
    const hit = snapshot({ impactBearingRad: 0.46 });

    expect(hasDamageToShow(hit, defaults)).toBe(true);
    expect(
      hasDamageToShow(hit, { ...defaults, impact: { enabled: false } })
    ).toBe(false);
  });

  it('shows the overheating warning, where it is drawn', () => {
    const hot = snapshot({ overheating: true });

    expect(hasDamageToShow(hot, defaults)).toBe(true);
    expect(
      hasDamageToShow(hot, { ...defaults, overheating: { enabled: false } })
    ).toBe(false);
  });

  it('shows a repair on offer or under way', () => {
    expect(
      hasDamageToShow(snapshot({ repairChoice: 'Do Not Repair' }), defaults)
    ).toBe(true);
    expect(hasDamageToShow(snapshot({ repairSeconds: 30 }), defaults)).toBe(
      true
    );
  });
});
