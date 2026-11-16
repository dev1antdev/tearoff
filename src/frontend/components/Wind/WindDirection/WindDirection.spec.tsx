import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WindDirection } from './WindDirection';

describe('WindDirection', () => {
  beforeEach(() => {
    // The dial sizes itself to its box, which jsdom has no layout for.
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {
          return undefined;
        }
        disconnect() {
          return undefined;
        }
      }
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows the wind speed in the middle of the dial', () => {
    render(<WindDirection speedMs={5} direction={0} metric />);
    expect(screen.getByTestId('wind-direction')).toHaveTextContent('18');
  });

  it('lets the arrow point show past the view box its stroke reaches out of', () => {
    const { container } = render(<WindDirection speedMs={5} direction={0} />);
    const arrow = container.querySelector('svg');

    // The point is drawn at y = 1 of a 60-unit box with a 3-unit mitred
    // stroke, which reaches 1.1 units past the edge. An svg clips at its view
    // box unless told otherwise, and the point was cut flat.
    expect(arrow).toHaveAttribute('viewBox', '0 0 60 60');
    expect(arrow?.querySelector('path')?.getAttribute('d')).toContain('30 1l');
    expect(arrow).toHaveClass('overflow-visible');
  });
});
