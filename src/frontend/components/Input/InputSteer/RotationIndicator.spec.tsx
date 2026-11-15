import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { RotationIndicator } from './RotationIndicator';

const radians = (degrees: number) => degrees * (Math.PI / 180);

describe('RotationIndicator', () => {
  it('should not render when angle is within normal range', () => {
    const { container } = render(<RotationIndicator currentAngleRad={0} />);

    expect(container.firstChild).toBeNull();
  });

  it('should not render when angle is at threshold', () => {
    const { container } = render(
      <RotationIndicator currentAngleRad={radians(270)} />
    );

    expect(container.firstChild).toBeNull();
  });

  it('should render when angle exceeds threshold clockwise', () => {
    render(<RotationIndicator currentAngleRad={radians(280)} />);

    expect(screen.getByText('-280°')).toBeInTheDocument();
  });

  it('should render when angle exceeds threshold counterclockwise', () => {
    render(<RotationIndicator currentAngleRad={radians(-280)} />);

    expect(screen.getByText('280°')).toBeInTheDocument();
  });

  it('should render with extreme angle', () => {
    render(<RotationIndicator currentAngleRad={radians(350)} />);

    expect(screen.getByText('-350°')).toBeInTheDocument();
  });
});

describe('RotationIndicator angle readout', () => {
  it('shows the angle at any size when set to always, without the arrow', () => {
    const { container } = render(
      <RotationIndicator currentAngleRad={radians(-10)} readout="always" />
    );

    expect(screen.getByText('10°')).toBeInTheDocument();
    expect(container.querySelector('svg')).toBeNull();
  });

  it('shows it only past 270 degrees by default', () => {
    const { container, rerender } = render(
      <RotationIndicator currentAngleRad={radians(-10)} readout="beyond270" />
    );
    expect(container.firstChild).toBeNull();

    rerender(
      <RotationIndicator currentAngleRad={radians(-271)} readout="beyond270" />
    );
    expect(screen.getByText('271°')).toBeInTheDocument();
  });

  it('keeps the arrow past 270 degrees and drops the number when set to never', () => {
    const { container, rerender } = render(
      <RotationIndicator currentAngleRad={radians(-280)} readout="never" />
    );
    expect(screen.queryByText('280°')).toBeNull();
    expect(container.querySelector('svg')).not.toBeNull();

    rerender(
      <RotationIndicator currentAngleRad={radians(-10)} readout="never" />
    );
    expect(container.firstChild).toBeNull();
  });

  it('reads a wheel a hair off centre as 0, on either side', () => {
    const { rerender } = render(
      <RotationIndicator currentAngleRad={radians(0.3)} readout="always" />
    );
    expect(screen.getByText('0°')).toBeInTheDocument();

    rerender(
      <RotationIndicator currentAngleRad={radians(-0.3)} readout="always" />
    );
    expect(screen.getByText('0°')).toBeInTheDocument();
  });
});
