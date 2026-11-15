import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { InputSteer } from './InputSteer';

const radians = (degrees: number) => (degrees * Math.PI) / 180;

describe('InputSteer', () => {
  it('draws the wheel alone by default: no readout, arc or wheel numbers', () => {
    const { container, queryByTestId } = render(
      <InputSteer angleRad={radians(119)} />
    );

    expect(container.querySelectorAll('svg')).toHaveLength(1);
    expect(queryByTestId('input-steer-arc')).toBeNull();
    expect(queryByTestId('input-steer-wheel-angle')).toBeNull();
    expect(screen.queryByText(/°/)).toBeNull();
  });

  it('turns the wheel image by the angle it is given', () => {
    const { container } = render(<InputSteer angleRad={radians(119)} />);
    const wheel = container.querySelector<HTMLElement>('div[style]');

    // Positive is to the left, which is anticlockwise on screen.
    expect(wheel?.style.getPropertyValue('--wheel-rotation')).toBe(
      `${-radians(119)}rad`
    );
  });

  it('shows the angle at 10 degrees when the readout is always on', () => {
    render(<InputSteer angleRad={radians(-10)} angleReadout="always" />);

    expect(screen.getByText('10°')).toBeInTheDocument();
  });

  describe('the rotation arc', () => {
    it('sweeps by the steering angle, to the side the wheel is turned', () => {
      const { getByTestId, rerender } = render(
        <InputSteer angleRad={radians(-90)} rotationArc="always" />
      );
      // A quarter turn to the right: clockwise from the top to 3 o'clock.
      expect(getByTestId('input-steer-arc').dataset.sweep).toBe('90');
      expect(
        getByTestId('input-steer-arc').querySelector('path')
      ).toHaveAttribute('d', 'M 50 2 A 48 48 0 0 1 98.00 50.00');

      rerender(<InputSteer angleRad={radians(200)} rotationArc="always" />);
      // Past half a turn to the left: the long way round, anticlockwise.
      expect(getByTestId('input-steer-arc').dataset.sweep).toBe('-200');
      expect(
        getByTestId('input-steer-arc').querySelector('path')?.getAttribute('d')
      ).toMatch(/^M 50 2 A 48 48 0 1 0 /);
    });

    it('is a full circle from one turn on, and nothing at centre', () => {
      const { getByTestId, rerender } = render(
        <InputSteer angleRad={radians(450)} rotationArc="always" />
      );
      expect(
        getByTestId('input-steer-arc').querySelector('circle')
      ).not.toBeNull();

      rerender(<InputSteer angleRad={0} rotationArc="always" />);
      expect(getByTestId('input-steer-arc').children).toHaveLength(0);
    });

    it('is drawn only at a standstill when set to stationary', () => {
      const { queryByTestId, rerender } = render(
        <InputSteer angleRad={radians(90)} rotationArc="stationary" />
      );
      expect(queryByTestId('input-steer-arc')).toBeNull();

      rerender(
        <InputSteer
          angleRad={radians(90)}
          rotationArc="stationary"
          stationary
        />
      );
      expect(queryByTestId('input-steer-arc')).not.toBeNull();

      rerender(
        <InputSteer angleRad={radians(90)} rotationArc="never" stationary />
      );
      expect(queryByTestId('input-steer-arc')).toBeNull();
    });
  });

  describe('the front wheel angle', () => {
    it('shows the wheel angle and the steering ratio under the wheel', () => {
      // The recorded LMGT3 in a corner: 119 degrees at the wheel, 8.6 at
      // the road.
      const { getByTestId } = render(
        <InputSteer angleRad={radians(119)} frontWheelAngleDeg={8.6} />
      );

      expect(getByTestId('input-steer-wheel-angle').textContent).toBe(
        '8.6°13.8:1'
      );
    });

    it('shows the size of the angle, whichever way the wheels point', () => {
      const { getByTestId } = render(
        <InputSteer angleRad={radians(-59.5)} frontWheelAngleDeg={-4.3} />
      );

      expect(getByTestId('input-steer-wheel-angle').textContent).toBe(
        '4.3°13.8:1'
      );
    });

    it('gives no ratio with the wheels all but straight', () => {
      const { getByTestId } = render(
        <InputSteer angleRad={radians(6)} frontWheelAngleDeg={0.4} />
      );

      expect(getByTestId('input-steer-wheel-angle').textContent).toBe('0.4°–');
    });

    it('draws nothing under a sim that has no wheel angle', () => {
      // iRacing publishes no live toe, so the reading is absent.
      const { queryByTestId } = render(<InputSteer angleRad={radians(119)} />);

      expect(queryByTestId('input-steer-wheel-angle')).toBeNull();
    });
  });

  it('leaves the ring as it is: no readout, arc or wheel numbers', () => {
    const { queryByTestId } = render(
      <InputSteer
        angleRad={radians(119)}
        wheelStyle="ring"
        angleReadout="always"
        rotationArc="always"
        frontWheelAngleDeg={8.6}
      />
    );

    expect(queryByTestId('input-steer-arc')).toBeNull();
    expect(queryByTestId('input-steer-wheel-angle')).toBeNull();
    expect(screen.queryByText('-119°')).toBeNull();
  });
});
