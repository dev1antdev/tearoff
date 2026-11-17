import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PitWallHeader } from './PitWallHeader';
import type { PitWallHeaderData } from '../../hooks/usePitWallHeader';

const data: PitWallHeaderData = {
  simulator: 'Le Mans Ultimate',
  inSession: true,
  session: 'Race · Circuit de la Sarthe',
  timeLeft: '3:26:56',
  flag: { label: 'GREEN', tone: 'green' },
  car: null,
  watching: false,
};

const header = (reconnecting: boolean) =>
  render(
    <PitWallHeader
      data={data}
      layout="race"
      fullscreen={false}
      onToggleFullscreen={() => undefined}
      reconnecting={reconnecting}
    />
  );

const simulator = () => document.querySelector('[data-item="simulator"]');

describe('the simulator item of the Pit Wall header', () => {
  it('says the simulator is connected while the page hears from the app', () => {
    header(false);

    expect(simulator()).toHaveTextContent('Le Mans Ultimate connected');
    expect(simulator()).toHaveAttribute('title', 'Le Mans Ultimate connected');
    expect(simulator()?.className).toContain('text-slate-300');
  });

  it('does not say connected beside Reconnecting', () => {
    // A page in a browser that has lost the app: what it shows of the
    // simulator is the last it heard. It read "Le Mans Ultimate connected"
    // beside "Reconnecting".
    header(true);

    expect(simulator()).toHaveTextContent('Le Mans Ultimate, as last heard');
    expect(simulator()).not.toHaveTextContent('connected');
    expect(simulator()).toHaveAttribute(
      'title',
      'Le Mans Ultimate, as last heard'
    );
    // Dimmed, and its dot no longer green.
    expect(simulator()?.className).toContain('text-slate-500');
    expect(simulator()?.querySelector('span')?.className).not.toContain(
      'bg-emerald-400'
    );
    expect(
      document.querySelector('[data-item="reconnecting"]')
    ).toHaveTextContent('Reconnecting');
  });
});
