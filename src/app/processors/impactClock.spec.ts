import { describe, expect, it } from 'vitest';
import type { Telemetry } from '@irdashies/types';
import { ImpactClock } from './impactClock';

const frame = (values: Record<string, number>): Telemetry =>
  Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key, { value: [value] }])
  ) as unknown as Telemetry;

describe('ImpactClock', () => {
  it('reports no impact on a frame that states nothing', () => {
    const clock = new ImpactClock();

    expect(clock.observe(frame({}), 10)).toBe(false);
    expect(clock.lastImpactAt).toBe(Number.NEGATIVE_INFINITY);
  });

  describe('under Le Mans Ultimate', () => {
    it('reads zero as no impact yet, even at the start of the clock', () => {
      const clock = new ImpactClock();

      expect(clock.observe(frame({ LmuLastImpactTime: 0 }), 0.5)).toBe(false);
    });

    it('counts two seconds from the time the sim states', () => {
      const clock = new ImpactClock();

      expect(clock.observe(frame({ LmuLastImpactTime: 240.72 }), 240.73)).toBe(
        true
      );
      expect(clock.observe(frame({ LmuLastImpactTime: 240.72 }), 242.7)).toBe(
        true
      );
      expect(clock.observe(frame({ LmuLastImpactTime: 240.72 }), 242.75)).toBe(
        false
      );
      expect(clock.lastImpactAt).toBe(240.72);
    });

    it('starts again from a later impact', () => {
      const clock = new ImpactClock();
      clock.observe(frame({ LmuLastImpactTime: 284.98 }), 284.99);

      expect(clock.observe(frame({ LmuLastImpactTime: 285.0 }), 286.99)).toBe(
        true
      );
    });

    it('ignores an impact stamped ahead of a clock that went back', () => {
      const clock = new ImpactClock();

      expect(clock.observe(frame({ LmuLastImpactTime: 240.72 }), 12)).toBe(
        false
      );
    });
  });

  describe('under iRacing', () => {
    it('takes the frame in which the incident count rises', () => {
      const clock = new ImpactClock();

      expect(clock.observe(frame({ PlayerCarMyIncidentCount: 3 }), 100)).toBe(
        false
      );
      expect(clock.observe(frame({ PlayerCarMyIncidentCount: 4 }), 101)).toBe(
        true
      );
      expect(clock.observe(frame({ PlayerCarMyIncidentCount: 4 }), 103)).toBe(
        true
      );
      expect(clock.observe(frame({ PlayerCarMyIncidentCount: 4 }), 103.1)).toBe(
        false
      );
    });

    it('does not take the first count it sees for an incident', () => {
      const clock = new ImpactClock();

      expect(clock.observe(frame({ PlayerCarMyIncidentCount: 12 }), 50)).toBe(
        false
      );
    });

    it('does not take a count that fell for an incident', () => {
      const clock = new ImpactClock();
      clock.observe(frame({ PlayerCarMyIncidentCount: 12 }), 50);

      expect(clock.observe(frame({ PlayerCarMyIncidentCount: 0 }), 51)).toBe(
        false
      );
      expect(clock.observe(frame({ PlayerCarMyIncidentCount: 1 }), 52)).toBe(
        true
      );
    });
  });

  it('uses the later of the two when a frame carries both', () => {
    const clock = new ImpactClock();
    clock.observe(
      frame({ PlayerCarMyIncidentCount: 0, LmuLastImpactTime: 147.2 }),
      200
    );

    expect(
      clock.observe(
        frame({ PlayerCarMyIncidentCount: 1, LmuLastImpactTime: 147.2 }),
        201
      )
    ).toBe(true);
    expect(clock.lastImpactAt).toBe(201);
  });

  it('forgets the impact and the count on reset', () => {
    const clock = new ImpactClock();
    clock.observe(frame({ PlayerCarMyIncidentCount: 3 }), 100);
    clock.observe(frame({ PlayerCarMyIncidentCount: 4 }), 101);

    clock.reset();

    // The count is where counting starts from again, not a rise from 4.
    expect(clock.observe(frame({ PlayerCarMyIncidentCount: 6 }), 101.5)).toBe(
      false
    );
  });
});
