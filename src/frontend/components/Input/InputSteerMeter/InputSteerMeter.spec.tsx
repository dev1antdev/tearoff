import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { InputSteerMeter, steerMeterMarks } from './InputSteerMeter';

const radians = (degrees: number) => (degrees * Math.PI) / 180;

describe('steerMeterMarks', () => {
  it('puts a mark every 90 degrees of a 476 degree wheel: two each side', () => {
    const marks = steerMeterMarks(476, 90);

    expect(marks).toHaveLength(2);
    expect(marks[0]).toBeCloseTo(90 / 238);
    expect(marks[1]).toBeCloseTo(180 / 238);
  });

  it('leaves out a mark that would sit on the lock itself', () => {
    // 360 lock to lock: 90 is half way out, 180 is the edge.
    expect(steerMeterMarks(360, 90)).toEqual([0.5]);
    expect(steerMeterMarks(540, 90)).toHaveLength(2);
  });

  it('has no marks when the spacing is wider than the lock', () => {
    expect(steerMeterMarks(476, 180)).toHaveLength(1);
    expect(steerMeterMarks(300, 180)).toEqual([]);
  });

  it('bounds the marks for a spacing or a range that is out of bounds', () => {
    expect(steerMeterMarks(1440, 0)).toHaveLength(36);
    expect(steerMeterMarks(1440, -5)).toHaveLength(36);
    expect(steerMeterMarks(100_000, 30)).toHaveLength(36);
  });
});

describe('InputSteerMeter', () => {
  const fillOf = (container: HTMLElement) => {
    const fill = container.querySelector<HTMLElement>(
      '[data-testid="input-steer-meter-fill"]'
    );
    if (!fill) throw new Error('Expected the meter fill');
    return fill;
  };
  /** The fill's width as a percentage of the whole bar. */
  const widthOf = (container: HTMLElement) =>
    Number.parseFloat(fillOf(container).style.width);
  const angleOf = (container: HTMLElement) =>
    container.querySelector<HTMLElement>(
      '[data-testid="input-steer-meter-angle"]'
    );
  const marksOf = (container: HTMLElement) =>
    container.querySelectorAll('[data-testid="input-steer-meter-mark"]');

  it('fills half of the steered side at half the lock', () => {
    // 119 of the 238 degrees a 476 degree wheel turns either way.
    const { container } = render(
      <InputSteerMeter angleRad={radians(119)} rangeDeg={476} />
    );
    const fill = fillOf(container);

    // Half of one half of the bar, growing leftwards from the centre.
    expect(widthOf(container)).toBeCloseTo(25);
    expect(fill.style.right).toBe('50%');
    expect(fill.style.left).toBe('');
    expect(fill.dataset.side).toBe('left');
  });

  it('fills toward the right for a wheel turned right', () => {
    const { container } = render(
      <InputSteerMeter angleRad={radians(-59.5)} rangeDeg={476} />
    );
    const fill = fillOf(container);

    expect(widthOf(container)).toBeCloseTo(12.5);
    expect(fill.style.left).toBe('50%');
    expect(fill.style.right).toBe('');
  });

  it('is full at the lock and stays full beyond it', () => {
    const { container, rerender } = render(
      <InputSteerMeter angleRad={radians(238)} rangeDeg={476} />
    );
    expect(widthOf(container)).toBeCloseTo(50);

    rerender(<InputSteerMeter angleRad={radians(400)} rangeDeg={476} />);
    expect(widthOf(container)).toBeCloseTo(50);
  });

  it('draws two marks each side for a 476 degree wheel marked every 90', () => {
    const { container } = render(
      <InputSteerMeter angleRad={0} rangeDeg={476} markDeg={90} />
    );

    expect(marksOf(container)).toHaveLength(4);
  });

  it('shows whole degrees over the steered end, and over the centre at zero', () => {
    const { container, rerender } = render(
      <InputSteerMeter angleRad={radians(118.6)} rangeDeg={476} />
    );
    expect(angleOf(container)?.textContent).toBe('119');
    expect(angleOf(container)?.dataset.side).toBe('left');

    rerender(<InputSteerMeter angleRad={radians(-42.2)} rangeDeg={476} />);
    expect(angleOf(container)?.textContent).toBe('42');
    expect(angleOf(container)?.dataset.side).toBe('right');

    rerender(<InputSteerMeter angleRad={radians(-0.3)} rangeDeg={476} />);
    expect(angleOf(container)?.textContent).toBe('0');
    expect(angleOf(container)?.dataset.side).toBe('center');
  });

  it('leaves the number out when asked', () => {
    const { container } = render(
      <InputSteerMeter
        angleRad={radians(119)}
        rangeDeg={476}
        showAngle={false}
      />
    );

    expect(angleOf(container)).toBeNull();
  });

  it.each([undefined, 0, -476, Number.NaN])(
    'is full at half a turn when the range is %s',
    (rangeDeg) => {
      const { container } = render(
        <InputSteerMeter angleRad={radians(90)} rangeDeg={rangeDeg} />
      );

      expect(widthOf(container)).toBeCloseTo(25);
    }
  );
});
