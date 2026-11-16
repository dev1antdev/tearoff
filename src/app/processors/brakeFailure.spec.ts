import { describe, expect, it } from 'vitest';
import {
  BrakeFailureWatch,
  classBrakeFailureMm,
  isPlausibleFailure,
  resolveBrakeFailure,
} from './brakeFailure';

describe('the failure thickness of a class', () => {
  it('is 25 mm for a Hypercar and an LMP2, 30 mm for a GT car', () => {
    expect(classBrakeFailureMm('Hypercar')).toBe(25);
    expect(classBrakeFailureMm('LMP2')).toBe(25);
    expect(classBrakeFailureMm('LMGT3')).toBe(30);
    expect(classBrakeFailureMm('LMGTE')).toBe(30);
  });

  it('takes the names as the sim spells them', () => {
    expect(classBrakeFailureMm('Hyper')).toBe(25);
    expect(classBrakeFailureMm('LMP2_ELMS')).toBe(25);
    expect(classBrakeFailureMm('GT3')).toBe(30);
    expect(classBrakeFailureMm('LM GT3')).toBe(30);
  });

  it('has none for a class without a figure, or for no class', () => {
    expect(classBrakeFailureMm('LMP3')).toBeNull();
    // Two classes begin like this, and one of them has no figure.
    expect(classBrakeFailureMm('LMP')).toBeNull();
    expect(classBrakeFailureMm('')).toBeNull();
    expect(classBrakeFailureMm(null)).toBeNull();
    expect(classBrakeFailureMm(undefined)).toBeNull();
  });
});

describe('the failure thickness in use', () => {
  it('is the setting, then what was learned, then the class figure', () => {
    expect(resolveBrakeFailure(28, 26.4, 30)).toEqual({
      mm: 28,
      source: 'setting',
    });
    expect(resolveBrakeFailure(0, 26.4, 30)).toEqual({
      mm: 26.4,
      source: 'learned',
    });
    expect(resolveBrakeFailure(0, null, 30)).toEqual({
      mm: 30,
      source: 'class',
    });
    expect(resolveBrakeFailure(0, undefined, null)).toEqual({
      mm: null,
      source: null,
    });
  });

  it('passes over a learned thickness that was forgotten or is not one', () => {
    expect(resolveBrakeFailure(0, 0, 30).source).toBe('class');
    expect(resolveBrakeFailure(0, 3, 30).source).toBe('class');
    expect(resolveBrakeFailure(0, Number.NaN, null).source).toBeNull();
  });

  it('passes over a figure that is not below a new disc', () => {
    // A car whose new rear discs are 28 mm cannot have failed at 30.
    expect(resolveBrakeFailure(0, null, 30, 28)).toEqual({
      mm: null,
      source: null,
    });
    expect(resolveBrakeFailure(0, 29, 25, 28)).toEqual({
      mm: 25,
      source: 'class',
    });
    // The setting is the driver's word, and stands.
    expect(resolveBrakeFailure(30, null, 25, 28)).toEqual({
      mm: 30,
      source: 'setting',
    });
  });
});

describe('a thickness a disc stopped wearing at', () => {
  it('is a failure when the disc is worn and still a disc', () => {
    expect(isPlausibleFailure(25.2, 36)).toBe(true);
    // A twentieth of it gone is the least that counts as worn.
    expect(isPlausibleFailure(34.1, 36)).toBe(true);
    expect(isPlausibleFailure(34.3, 36)).toBe(false);
  });

  it('is not one on a disc that is all but new', () => {
    // 35.9 mm of a 36.0 mm disc: more than 95 percent of it is there.
    expect(isPlausibleFailure(35.9, 36)).toBe(false);
  });

  it('is not one below 5 mm, or with no new thickness to hold it against', () => {
    expect(isPlausibleFailure(4.9, 36)).toBe(false);
    expect(isPlausibleFailure(25, null)).toBe(false);
  });
});

describe('BrakeFailureWatch', () => {
  const DISCS = [26, 26, 31, 31];
  /** Four answers of the REST API, the last 3.1 s after the first. */
  const FOUR_ANSWERS = [100.1, 101.1, 102.1, 103.2];

  /**
   * Feeds frames a tenth of a second apart, braking, with the REST answer
   * counter moving at each of the given times.
   */
  const brake = (
    watch: BrakeFailureWatch,
    {
      from = 100,
      seconds,
      answersAt,
      discs = () => DISCS,
      braking = true,
      seq = 10,
    }: {
      from?: number;
      seconds: number;
      answersAt: number[];
      discs?: (time: number) => (number | null)[];
      braking?: boolean;
      seq?: number;
    }
  ) => {
    let fired = 0;
    let counter = seq;
    for (let step = 0; step <= Math.round(seconds * 10); step += 1) {
      const time = from + step / 10;
      if (answersAt.some((at) => Math.abs(at - time) < 1e-6)) counter += 1;
      fired |= watch.update(time, discs(time), counter, braking);
    }
    return { fired, seq: counter };
  };

  it('fails a disc braked for three seconds unchanged across four answers', () => {
    const watch = new BrakeFailureWatch();
    watch.update(99.9, DISCS, 10, false);

    const { fired } = brake(watch, {
      seconds: 3.5,
      answersAt: FOUR_ANSWERS,
    });

    expect(fired).toBe(0b1111);
    expect(watch.stoppedAt(0)).toBe(26);
    expect(watch.stoppedAt(2)).toBe(31);
  });

  it('counts from the first answer, not from the brake going on', () => {
    const watch = new BrakeFailureWatch();
    watch.update(99.9, DISCS, 10, false);

    // Answers at 1.0 and 3.5 s into the braking: two and a half apart.
    const early = brake(watch, { seconds: 3.6, answersAt: [101, 103.5] });
    expect(early.fired).toBe(0);
    // One more, three seconds after the first, does it.
    const { fired } = brake(watch, {
      from: 103.7,
      seconds: 0.5,
      answersAt: [104],
      seq: early.seq,
    });
    expect(fired).toBe(0b1111);
  });

  it('fails nothing when no answer arrived in that time', () => {
    const watch = new BrakeFailureWatch();
    watch.update(99.9, DISCS, 10, false);

    // Ten seconds on the brakes with a reading nobody refreshed.
    expect(brake(watch, { seconds: 10, answersAt: [] }).fired).toBe(0);
    // Nor on one answer: it takes two to say the disc stood still between.
    expect(
      brake(watch, { from: 111, seconds: 10, answersAt: [112] }).fired
    ).toBe(0);
    expect(watch.stoppedAt(0)).toBeNull();
  });

  it('fails nothing on frames that carry no answer counter', () => {
    const watch = new BrakeFailureWatch();
    let fired = 0;
    for (let step = 0; step < 100; step += 1) {
      fired |= watch.update(100 + step / 10, DISCS, null, true);
    }
    expect(fired).toBe(0);
  });

  it('starts over whenever a reading moves', () => {
    const watch = new BrakeFailureWatch();
    watch.update(99.9, DISCS, 10, false);

    // The left front goes on wearing; the other three stand still.
    const { fired } = brake(watch, {
      seconds: 3.5,
      answersAt: FOUR_ANSWERS,
      discs: (time) => [26 - (time - 100) * 0.001, 26, 31, 31],
    });

    expect(fired).toBe(0b1110);
    expect(watch.stoppedAt(0)).toBeNull();
  });

  it('starts over when the brake is let go', () => {
    const watch = new BrakeFailureWatch();
    watch.update(99.9, DISCS, 10, false);

    const first = brake(watch, { seconds: 2, answersAt: [100.2, 101.2] });
    watch.update(102.1, DISCS, first.seq, false);
    const second = brake(watch, {
      from: 102.2,
      seconds: 2,
      answersAt: [102.4, 103.4],
      seq: first.seq,
    });

    expect(first.fired | second.fired).toBe(0);
  });

  it('takes a failure back when the disc is seen to wear again', () => {
    const watch = new BrakeFailureWatch();
    watch.update(99.9, DISCS, 10, false);
    const { seq } = brake(watch, {
      seconds: 3.5,
      answersAt: FOUR_ANSWERS,
    });
    expect(watch.stoppedAt(1)).toBe(26);

    watch.update(104, [26, 25.99, 31, 31], seq + 1, true);

    expect(watch.stoppedAt(1)).toBeNull();
    expect(watch.stoppedAt(0)).toBe(26);
  });

  it('lets go of a wheel, and of everything', () => {
    const watch = new BrakeFailureWatch();
    watch.update(99.9, DISCS, 10, false);
    brake(watch, { seconds: 3.5, answersAt: FOUR_ANSWERS });

    watch.clearWheel(0);
    expect(watch.stoppedAt(0)).toBeNull();
    expect(watch.stoppedAt(1)).toBe(26);

    watch.reset();
    expect(watch.stoppedAt(1)).toBeNull();
  });
});
