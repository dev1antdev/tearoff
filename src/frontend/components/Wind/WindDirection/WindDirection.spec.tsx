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

  it('turns the drawing inside the svg, where the turn cannot reach past the square', () => {
    const { container } = render(<WindDirection speedMs={5} direction={1} />);
    const arrow = container.querySelector('svg');

    // A rotated svg element is a rotated box: its corners reach past the
    // square it fills, which the smoke run reads as content larger than the
    // box. A rotated group repaints only, so the box stays the square.
    expect(arrow?.getAttribute('style') ?? '').not.toContain('rotate');
    const turn = arrow?.querySelector('g');
    expect(turn?.getAttribute('style')).toContain('rotate');
  });
});
