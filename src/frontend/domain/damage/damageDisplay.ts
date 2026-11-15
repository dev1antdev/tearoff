import type {
  DamageConfig,
  DamageSnapshot,
  DamageWheel,
} from '@irdashies/types';

/**
 * Pure display logic for the damage widget: what state a wheel is in, what
 * each figure reads and when it warns, and how a repair is worded. Kept apart
 * from the component so each rule can be tested without rendering anything.
 */

/** Shown where the sim has given no reading. */
export const NO_READING = '--';

/**
 * Suspension damage, 0 to 1, from which a wheel is drawn one step worse.
 * TinyPedal's steps: the scale has not been seen above 0 on a recording.
 */
export const SUSPENSION_STEPS = {
  light: 0.02,
  medium: 0.15,
  heavy: 0.4,
  destroyed: 0.8,
} as const;

export type SuspensionState =
  'unknown' | 'healthy' | 'light' | 'medium' | 'heavy' | 'destroyed';

/** Unknown until the sim's REST API has answered. */
export const suspensionState = (
  damage: number | null | undefined
): SuspensionState => {
  if (typeof damage !== 'number') return 'unknown';
  if (damage >= SUSPENSION_STEPS.destroyed) return 'destroyed';
  if (damage >= SUSPENSION_STEPS.heavy) return 'heavy';
  if (damage >= SUSPENSION_STEPS.medium) return 'medium';
  if (damage >= SUSPENSION_STEPS.light) return 'light';
  return 'healthy';
};

export type WheelState = SuspensionState | 'detached' | 'punctured';

/**
 * How one wheel is drawn. A wheel that has come off outranks a flat tyre,
 * and either outranks the suspension behind it.
 */
export const wheelState = (wheel: DamageWheel | undefined): WheelState => {
  if (!wheel) return 'unknown';
  if (wheel.detached) return 'detached';
  if (wheel.punctured) return 'punctured';
  return suspensionState(wheel.suspensionDamage);
};

/** A share from 0 to 1 as a whole per cent, or the placeholder. */
export const formatPercent = (share: number | null | undefined): string =>
  typeof share === 'number' ? `${Math.round(share * 100)}%` : NO_READING;

export type IntegrityTone = 'none' | 'normal' | 'warn';

/**
 * Whether a figure is at or below its warning, judged on the whole per cent
 * that is drawn, so a figure never warns while reading above its threshold.
 */
export const integrityTone = (
  integrity: number | null | undefined,
  warnPercent: number
): IntegrityTone => {
  if (typeof integrity !== 'number') return 'none';
  return Math.round(integrity * 100) <= warnPercent ? 'warn' : 'normal';
};

export type DamageStatKey = 'aero' | 'body' | 'suspension' | 'tyre';

export interface DamageStat {
  key: DamageStatKey;
  label: string;
  value: string;
  tone: IntegrityTone;
}

/** The four figures beside the car. All placeholders without a car. */
export const damageStats = (
  snapshot: DamageSnapshot | undefined,
  stats: DamageConfig['stats']
): DamageStat[] => {
  const car = snapshot?.available ? snapshot : undefined;
  const stat = (
    key: DamageStatKey,
    label: string,
    integrity: number | null | undefined,
    warnPercent: number
  ): DamageStat => ({
    key,
    label,
    value: formatPercent(integrity),
    tone: integrityTone(integrity, warnPercent),
  });
  return [
    stat('aero', 'Aero', car?.aeroIntegrity, stats.aeroWarn),
    stat('body', 'Body', car?.bodyIntegrity, stats.bodyWarn),
    stat('suspension', 'Susp', car?.suspensionIntegrity, stats.suspensionWarn),
    stat('tyre', 'Tyre', car?.tyreIntegrity, stats.tyreWarn),
  ];
};

export interface DiagramReading {
  /** Which figure it is: aero falls back to the body until REST answers. */
  label: 'Aero' | 'Body';
  value: string;
  tone: IntegrityTone;
}

/**
 * The figure in the middle of the car, or null when it is switched off.
 *
 * It warns where the same figure beside the car does, whichever way it is
 * counted: 30 % integrity and 70 % damage are the same car.
 */
export const diagramReading = (
  snapshot: DamageSnapshot | undefined,
  diagram: DamageConfig['diagram'],
  stats: DamageConfig['stats']
): DiagramReading | null => {
  if (diagram.reading === 'none') return null;
  const car = snapshot?.available ? snapshot : undefined;
  // Aero when that is asked for and the sim has given it. Without a car the
  // label follows the setting, so the widget keeps its shape while placed.
  const aero =
    diagram.reading === 'aero' &&
    (car === undefined || car.aeroIntegrity !== null);
  const label = aero ? 'Aero' : 'Body';
  const integrity = aero ? car?.aeroIntegrity : car?.bodyIntegrity;
  if (typeof integrity !== 'number') {
    return { label, value: NO_READING, tone: 'none' };
  }
  return {
    label,
    value: formatPercent(diagram.showDamage ? 1 - integrity : integrity),
    tone: integrityTone(integrity, aero ? stats.aeroWarn : stats.bodyWarn),
  };
};

/**
 * Repair time as the driver reads it: whole seconds below a minute ("35s"),
 * minutes and seconds from there ("1:35"). Null for no repair.
 */
export const formatRepairTime = (
  seconds: number | null | undefined
): string | null => {
  if (typeof seconds !== 'number') return null;
  const whole = Math.round(seconds);
  if (whole <= 0) return null;
  if (whole < 60) return `${whole}s`;
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
};

export interface RepairRow {
  /** Null while the stop spends no time on repairs. */
  time: string | null;
  /** The pit menu's choice as the sim words it, or null. */
  choice: string | null;
}

/**
 * The repair line, or null when there is nothing to say: no time and no
 * choice. A damaged car whose menu sits on "Do Not Repair" has a choice and
 * no time.
 */
export const repairRow = (
  snapshot: DamageSnapshot | undefined
): RepairRow | null => {
  if (!snapshot?.available) return null;
  const time = formatRepairTime(snapshot.repairSeconds);
  const choice = snapshot.repairChoice;
  return time === null && choice === null ? null : { time, choice };
};

/**
 * Whether there is anything on the car to look at, for a widget set to show
 * only when damaged: a dent, something off or flat, suspension or aero
 * damage, a repair to choose, or a fresh impact or an overheating warning
 * where those are drawn. Tyre wear is not damage, and never brings it up.
 */
export const hasDamageToShow = (
  snapshot: DamageSnapshot | undefined,
  settings: Pick<DamageConfig, 'impact' | 'overheating'>
): boolean => {
  if (!snapshot?.available) return false;
  if (snapshot.body.some((level) => level > 0)) return true;
  if (
    snapshot.wheels.some((wheel) => {
      const state = wheelState(wheel);
      return state !== 'healthy' && state !== 'unknown';
    })
  ) {
    return true;
  }
  if (snapshot.aeroIntegrity !== null && snapshot.aeroIntegrity < 1) {
    return true;
  }
  if (settings.impact.enabled && snapshot.impactBearingRad !== null) {
    return true;
  }
  if (settings.overheating.enabled && snapshot.overheating) return true;
  return repairRow(snapshot) !== null;
};
