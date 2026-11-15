import type { Telemetry } from '@irdashies/types';

/**
 * When the player's car last took a knock, for the displays that must not
 * take one for driving: a kerb strike or a nudge reads as several g for a
 * frame or two, and would otherwise stand as the best braking of the stint
 * or the edge of the friction circle.
 *
 * Le Mans Ultimate states the time of the last impact (`LmuLastImpactTime`,
 * 0 until the first). iRacing states none, so the frame in which the
 * incident count rises stands in. That count also rises for an off-track,
 * which only makes the gate more cautious.
 */

/** Seconds after an impact during which a reading is not trusted. */
export const IMPACT_WINDOW_S = 2;

type Frame = Record<string, { value?: unknown[] } | undefined>;

const number = (frame: Frame, key: string): number | undefined => {
  const value = frame[key]?.value?.[0];
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
};

export class ImpactClock {
  private incidentCount: number | undefined;
  private incidentAt = Number.NEGATIVE_INFINITY;
  private impactAt = Number.NEGATIVE_INFINITY;

  /**
   * Reads a frame at time `t` and says whether the car was hit within the
   * last two seconds. An impact stamped ahead of `t` belongs to a clock that
   * has since gone back, and does not count.
   */
  observe(telemetry: Telemetry, t: number): boolean {
    const frame = telemetry as unknown as Frame;

    const count = number(frame, 'PlayerCarMyIncidentCount');
    if (count !== undefined) {
      // The first count seen, and one that fell (a new session), are where
      // the counting starts from, not incidents.
      if (this.incidentCount !== undefined && count > this.incidentCount) {
        this.incidentAt = t;
      }
      this.incidentCount = count;
    }

    const stated = number(frame, 'LmuLastImpactTime');
    this.impactAt =
      stated !== undefined && stated > 0
        ? Math.max(stated, this.incidentAt)
        : this.incidentAt;

    const since = t - this.impactAt;
    return since >= 0 && since <= IMPACT_WINDOW_S;
  }

  /** Time of the last impact; -Infinity when there has been none. */
  get lastImpactAt(): number {
    return this.impactAt;
  }

  reset(): void {
    this.incidentCount = undefined;
    this.incidentAt = Number.NEGATIVE_INFINITY;
    this.impactAt = Number.NEGATIVE_INFINITY;
  }
}
