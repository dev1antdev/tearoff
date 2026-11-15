import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import type { TrackStateSnapshot } from '@irdashies/types';
import { GarageCover } from './GarageCover';

let trackState: Partial<TrackStateSnapshot> | undefined;

vi.mock('@irdashies/context', () => ({
  useTrackStateSelector: <T,>(selector: (snapshot: TrackStateSnapshot) => T) =>
    trackState === undefined
      ? undefined
      : selector(trackState as TrackStateSnapshot),
}));
vi.mock('./hooks/useGarageCoverSettings', () => ({
  useGarageCoverSettings: () => ({ imageFilename: '' }),
}));
vi.mock('./hooks/useGarageCoverImage', () => ({
  useGarageCoverImage: () => null,
}));

const inGarage: Partial<TrackStateSnapshot> = {
  isInGarage: true,
  isGarageVisible: true,
  isOnTrack: false,
  notInSession: false,
  dataStale: false,
};

const show = (state: Partial<TrackStateSnapshot> | undefined) => {
  trackState = state;
  const view = render(<GarageCover />);
  act(() => {
    vi.runAllTimers();
  });
  return view;
};

describe('GarageCover', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    trackState = undefined;
  });

  it('covers the garage screen', () => {
    show(inGarage);
    expect(screen.getByAltText('Garage Cover')).toBeTruthy();
  });

  it('is not there while driving', () => {
    show({ ...inGarage, isInGarage: false, isGarageVisible: false });
    expect(screen.queryByAltText('Garage Cover')).toBeNull();
    show({ ...inGarage, isOnTrack: true });
    expect(screen.queryByAltText('Garage Cover')).toBeNull();
  });

  it('comes down when Le Mans Ultimate leaves the session', () => {
    // A session left from the garage: the sim's last frame still says the
    // car is in its stall, over the main menu, until another session starts.
    show({ ...inGarage, notInSession: true });
    expect(screen.queryByAltText('Garage Cover')).toBeNull();
  });

  it('comes down when the sim has stopped writing the frame', () => {
    show({ ...inGarage, dataStale: true });
    expect(screen.queryByAltText('Garage Cover')).toBeNull();
  });

  it('is not there before any track state has arrived', () => {
    show(undefined);
    expect(screen.queryByAltText('Garage Cover')).toBeNull();
  });
});
