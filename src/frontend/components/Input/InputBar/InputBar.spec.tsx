import { render } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { InputBar } from './InputBar';

// The theme's colours are CSS variables, which jsdom does not have: name
// them, so that a bar's colour can be read back.
vi.mock('@irdashies/utils/colors', () => ({
  getColor: (name: string) => name,
}));

const colourOf = (element: HTMLElement) => element.style.backgroundColor;

const settings = {
  includeBrake: true,
  includeThrottle: true,
  includeClutch: true,
  includeAbs: true,
};

const scaleOf = (element: Element | null) =>
  (element as HTMLElement | null)?.style.transform;

describe('InputBar', () => {
  it('renders without crashing', () => {
    const { container } = render(
      <InputBar brake={0.5} throttle={0.7} clutch={0.8} settings={settings} />
    );
    expect(container).toBeInTheDocument();
  });

  it('renders a container div', () => {
    const { container } = render(
      <InputBar brake={0.5} throttle={0.7} clutch={0.8} settings={settings} />
    );
    const containerDiv = container.firstChild as HTMLElement;
    expect(containerDiv).toBeInTheDocument();
  });

  it('renders the correct number of bars', () => {
    const { container } = render(
      <InputBar brake={0.5} throttle={0.7} clutch={0.8} settings={settings} />
    );
    const barContainers = Array.from(
      container.querySelectorAll('[data-testid^="input-bar-"]')
    ).filter(
      (el) => !(el as HTMLElement).getAttribute('data-testid')?.includes('fill')
    );
    expect(barContainers.length).toBe(3);
  });

  it('renders text with correct values', () => {
    const { container } = render(
      <InputBar brake={0.5} throttle={0.7} clutch={0.8} settings={settings} />
    );
    const textElements = Array.from(container.querySelectorAll('div')).filter(
      (el) => el.textContent && /^\d+$/.test(el.textContent.trim())
    );
    expect(textElements.length).toBeGreaterThanOrEqual(3);
    const values = textElements
      .map((el) => el.textContent?.trim())
      .filter(Boolean);
    expect(values).toContain('80'); // clutch
    expect(values).toContain('50'); // brake
    expect(values).toContain('70'); // throttle
  });

  it('renders the throttle and brake bars when includeThrottle and includeBrake are true', () => {
    const { container } = render(
      <InputBar
        brake={0.5}
        throttle={0.7}
        clutch={0.8}
        settings={{
          includeBrake: true,
          includeThrottle: true,
          includeClutch: false,
          includeAbs: false,
        }}
      />
    );
    const barContainers = Array.from(
      container.querySelectorAll('[data-testid^="input-bar-"]')
    ).filter(
      (el) => !(el as HTMLElement).getAttribute('data-testid')?.includes('fill')
    );
    expect(barContainers.length).toBe(2);
  });
});

describe('InputBar assist marks', () => {
  it('marks the brake while ABS works and the throttle while traction control cuts', () => {
    const { getByTestId, getByText, queryByText, rerender } = render(
      <InputBar brake={0.8} throttle={0.4} settings={settings} />
    );
    expect(queryByText('ABS')).toBeNull();
    expect(queryByText('TC')).toBeNull();
    expect(colourOf(getByTestId('input-bar-fill-throttle'))).toBe('green');
    expect(colourOf(getByTestId('input-bar-fill-brake'))).toBe('red');

    rerender(
      <InputBar brake={0.8} throttle={0.4} tcActive settings={settings} />
    );
    // On the throttle bar, in the colour ABS gives the brake, and the brake
    // is left alone.
    expect(getByTestId('input-bar-throttle')).toContainElement(getByText('TC'));
    expect(colourOf(getByTestId('input-bar-fill-throttle'))).toBe('yellow');
    expect(queryByText('ABS')).toBeNull();
    expect(colourOf(getByTestId('input-bar-fill-brake'))).toBe('red');

    rerender(
      <InputBar
        brake={0.8}
        throttle={0.4}
        brakeAbsActive
        tcActive
        settings={settings}
      />
    );
    // Both at once, each on its own pedal.
    expect(getByTestId('input-bar-brake')).toContainElement(getByText('ABS'));
    expect(getByTestId('input-bar-throttle')).toContainElement(getByText('TC'));
    expect(colourOf(getByTestId('input-bar-fill-brake'))).toBe('yellow');
    expect(colourOf(getByTestId('input-bar-fill-throttle'))).toBe('yellow');

    rerender(<InputBar brake={0.8} throttle={0.4} settings={settings} />);
    expect(colourOf(getByTestId('input-bar-fill-throttle'))).toBe('green');
  });

  it('leaves the throttle unmarked when the traction control mark is off', () => {
    const { getByTestId, queryByText } = render(
      <InputBar
        throttle={0.4}
        tcActive
        settings={{ ...settings, includeTc: false }}
      />
    );

    expect(queryByText('TC')).toBeNull();
    expect(colourOf(getByTestId('input-bar-fill-throttle'))).toBe('green');
  });
});

describe('InputBar pedal travel', () => {
  const dual = { ...settings, dual: true };

  it('draws one strip per pedal unless both readings are given', () => {
    const { queryByTestId, getByTestId } = render(
      <InputBar throttle={0.4} throttlePedal={1} settings={dual} />
    );

    expect(queryByTestId('input-bar-fill-throttle-pedal')).toBeNull();
    expect(scaleOf(getByTestId('input-bar-fill-throttle'))).toBe('scaleY(0.4)');
  });

  it('draws the pedal beside what the car received, and reads the larger', () => {
    const { getByTestId } = render(
      <InputBar
        throttle={0.4}
        throttlePedal={1}
        throttleCar={0.4}
        settings={dual}
      />
    );

    expect(scaleOf(getByTestId('input-bar-fill-throttle-pedal'))).toBe(
      'scaleY(1)'
    );
    expect(scaleOf(getByTestId('input-bar-fill-throttle'))).toBe('scaleY(0.4)');
    expect(getByTestId('input-bar-throttle').textContent).toBe('100');
    expect(getByTestId('input-cap-throttle').dataset.lit).toBe('true');
  });

  it('ignores the second reading with the side-by-side bars off', () => {
    const { queryByTestId, getByTestId } = render(
      <InputBar
        throttle={0.4}
        throttlePedal={1}
        throttleCar={0.4}
        settings={settings}
      />
    );

    expect(queryByTestId('input-bar-fill-throttle-pedal')).toBeNull();
    expect(getByTestId('input-bar-throttle').textContent).toBe('40');
  });

  it('marks the car strip, not the pedal strip, while an assist works', () => {
    const { getByTestId } = render(
      <InputBar
        throttle={0.4}
        throttlePedal={1}
        throttleCar={0.4}
        tcActive
        settings={dual}
      />
    );

    expect(colourOf(getByTestId('input-bar-fill-throttle'))).toBe('yellow');
    expect(colourOf(getByTestId('input-bar-fill-throttle-pedal'))).toBe(
      'green'
    );
    // The marker is the pedal's too.
    expect(colourOf(getByTestId('input-cap-throttle'))).toBe('green');
  });

  it('lights the full-travel marker on the pedal, whatever the bar shows', () => {
    const { getByTestId, rerender } = render(
      <InputBar throttle={0.4} throttlePedal={1} settings={settings} />
    );
    // The Car source during a cut: the bar is at 40 and the pedal is flat.
    expect(getByTestId('input-bar-throttle').textContent).toBe('40');
    expect(getByTestId('input-cap-throttle').dataset.lit).toBe('true');

    rerender(
      <InputBar throttle={0.4} throttlePedal={0.97} settings={settings} />
    );
    expect(getByTestId('input-cap-throttle').dataset.lit).toBe('false');

    rerender(
      <InputBar throttle={0.4} throttlePedal={0.999} settings={settings} />
    );
    expect(getByTestId('input-cap-throttle').dataset.lit).toBe('true');
  });

  it('goes by the value shown when no pedal travel is given', () => {
    const { getByTestId } = render(
      <InputBar brake={1} throttle={0.98} settings={settings} />
    );

    expect(getByTestId('input-cap-brake').dataset.lit).toBe('true');
    expect(getByTestId('input-cap-throttle').dataset.lit).toBe('false');
  });

  it('draws no marker when it is switched off', () => {
    const { queryByTestId } = render(
      <InputBar throttle={1} settings={{ ...settings, showMaxMarker: false }} />
    );

    expect(queryByTestId('input-cap-throttle')).toBeNull();
  });
});

describe('InputBar force feedback', () => {
  const withFfb = { ...settings, includeFfb: true };

  it('draws a fourth bar with the size of the force', () => {
    const { getByTestId } = render(<InputBar ffb={0.5} settings={withFfb} />);
    const fill = getByTestId('input-bar-fill-ffb');

    expect(scaleOf(fill)).toBe('scaleY(0.5)');
    expect(fill.dataset.clipping).toBe('false');
    expect(fill.className).toContain('bg-slate-400');
    // An icon where the pedals have their number.
    expect(getByTestId('input-bar-ffb').querySelector('svg')).not.toBeNull();
  });

  it('fills the bar and turns it amber while the force clips, either way', () => {
    const { getByTestId } = render(<InputBar ffb={-1.02} settings={withFfb} />);
    const fill = getByTestId('input-bar-fill-ffb');

    expect(scaleOf(fill)).toBe('scaleY(1)');
    expect(fill.dataset.clipping).toBe('true');
    expect(fill.className).toContain('bg-amber-400');
  });

  it('draws no bar without a reading, or with the bar off', () => {
    const { queryByTestId, rerender } = render(<InputBar settings={withFfb} />);
    expect(queryByTestId('input-bar-ffb')).toBeNull();

    rerender(<InputBar ffb={0.5} settings={settings} />);
    expect(queryByTestId('input-bar-ffb')).toBeNull();
  });
});
