import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useDrivingState, useSessionVisibility } from '@irdashies/context';
import { CornerNameOverlay } from './CornerNameOverlay';
import { useCurrentSection } from './hooks/useCurrentSection';

vi.mock('@irdashies/context', () => ({
  useDrivingState: vi.fn(),
  useSessionVisibility: vi.fn(),
}));

vi.mock('./hooks/useCurrentSection', () => ({
  useCurrentSection: vi.fn(),
}));

/** Where the user is, as useDrivingState says it; nowhere unless told. */
const where = (
  state: Partial<ReturnType<typeof useDrivingState>> = {}
): ReturnType<typeof useDrivingState> => ({
  isDriving: false,
  isWatching: false,
  isWatchingOwnCar: false,
  isWatchingOtherCar: false,
  ...state,
});

describe('CornerNameOverlay', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useSessionVisibility).mockReturnValue(true);
    vi.mocked(useDrivingState).mockReturnValue(where({ isDriving: true }));
    // The corner the user's own car is in, whoever is driving it.
    vi.mocked(useCurrentSection).mockReturnValue({
      section: {
        name: 'Piratella',
        corner_number: '9',
      } as ReturnType<typeof useCurrentSection>['section'],
      progress: 0.4,
      lapDistPct: 0.52,
    });
  });

  it('names the corner the car is in', () => {
    const { container } = render(<CornerNameOverlay />);

    expect(container.textContent).toContain('Piratella');
    expect(container.textContent).toContain('52%');
  });

  it('names it through a team-mate’s stint in the user’s own car', () => {
    vi.mocked(useDrivingState).mockReturnValue(
      where({ isWatching: true, isWatchingOwnCar: true })
    );

    expect(render(<CornerNameOverlay />).container.textContent).toContain(
      'Piratella'
    );
  });

  it('is not shown with the camera on another car', () => {
    // The corner is still the team car's, which is not the car on screen.
    vi.mocked(useDrivingState).mockReturnValue(
      where({ isWatching: true, isWatchingOtherCar: true })
    );

    expect(render(<CornerNameOverlay />).container.firstChild).toBeNull();
  });

  it('is shown out of the car as it was, with nothing being watched', () => {
    vi.mocked(useDrivingState).mockReturnValue(where());

    expect(render(<CornerNameOverlay />).container.textContent).toContain(
      'Piratella'
    );
  });

  it('is not shown in a session it is switched off for', () => {
    vi.mocked(useSessionVisibility).mockReturnValue(false);

    expect(render(<CornerNameOverlay />).container.firstChild).toBeNull();
  });
});
