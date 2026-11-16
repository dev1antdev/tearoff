import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useTrackProfileSnapshot } from '@irdashies/context';
import type {
  TrackProfileBridge,
  TrackProfileSnapshot,
} from '@irdashies/types';
import { TrackSunTimesFields } from './TrackSunTimes';

vi.mock('@irdashies/context', () => ({
  useTrackProfileSnapshot: vi.fn(),
}));

const TRACK_KEY = 'lmu:694510461';

const withProfile = (profile: Partial<TrackProfileSnapshot> | undefined) => {
  vi.mocked(useTrackProfileSnapshot).mockReturnValue(
    profile as TrackProfileSnapshot | undefined
  );
};

const createBridge = () => {
  const saveSunTimes = vi.fn<TrackProfileBridge['saveSunTimes']>(
    async () => true
  );
  // The fields ask the bridge for nothing but this.
  return {
    saveSunTimes,
    bridge: { saveSunTimes } as unknown as TrackProfileBridge,
  };
};

const sunrise = () =>
  screen.getByLabelText("Sunrise at this session's track") as HTMLInputElement;
const sunset = () =>
  screen.getByLabelText("Sunset at this session's track") as HTMLInputElement;

describe('TrackSunTimesFields', () => {
  beforeEach(() => {
    vi.mocked(useTrackProfileSnapshot).mockReset();
  });

  it('shows the times kept for the track of the running session', () => {
    withProfile({
      trackKey: TRACK_KEY,
      sunriseMinutes: 372,
      sunsetMinutes: 1231,
    });
    render(<TrackSunTimesFields bridge={createBridge().bridge} />);

    expect(sunrise()).toHaveValue('06:12');
    expect(sunset()).toHaveValue('20:31');
    expect(sunrise()).toBeEnabled();
    expect(sunrise()).toHaveAttribute('type', 'time');
  });

  it('is empty for a track with none, and says what they are for', () => {
    withProfile({ trackKey: TRACK_KEY });
    render(<TrackSunTimesFields bridge={createBridge().bridge} />);

    expect(sunrise()).toHaveValue('');
    expect(sunset()).toHaveValue('');
    expect(
      screen.getByText(/The countdown appears once both are set/)
    ).toBeInTheDocument();
  });

  it('saves a time as soon as the field holds one, under the track’s key', () => {
    withProfile({ trackKey: TRACK_KEY });
    const { bridge, saveSunTimes } = createBridge();
    render(<TrackSunTimesFields bridge={bridge} />);

    fireEvent.change(sunrise(), { target: { value: '06:12' } });
    expect(saveSunTimes).toHaveBeenLastCalledWith(TRACK_KEY, {
      sunriseMinutes: 372,
      sunsetMinutes: null,
    });

    fireEvent.change(sunset(), { target: { value: '20:31' } });
    expect(saveSunTimes).toHaveBeenLastCalledWith(TRACK_KEY, {
      sunriseMinutes: 372,
      sunsetMinutes: 1231,
    });
    expect(saveSunTimes).toHaveBeenCalledTimes(2);
  });

  it('clears a time when its field is left empty, and not while it is being typed', () => {
    withProfile({
      trackKey: TRACK_KEY,
      sunriseMinutes: 372,
      sunsetMinutes: 1231,
    });
    const { bridge, saveSunTimes } = createBridge();
    render(<TrackSunTimesFields bridge={bridge} />);

    // A time field reads as empty while one of its parts is missing.
    fireEvent.change(sunrise(), { target: { value: '' } });
    expect(saveSunTimes).not.toHaveBeenCalled();
    // The other field saved meanwhile keeps the sunrise as it was entered.
    fireEvent.change(sunset(), { target: { value: '20:45' } });
    expect(saveSunTimes).toHaveBeenLastCalledWith(TRACK_KEY, {
      sunriseMinutes: 372,
      sunsetMinutes: 1245,
    });

    fireEvent.blur(sunrise());
    expect(saveSunTimes).toHaveBeenLastCalledWith(TRACK_KEY, {
      sunriseMinutes: null,
      sunsetMinutes: 1245,
    });
  });

  it('saves nothing for a time that is the one already kept', () => {
    withProfile({
      trackKey: TRACK_KEY,
      sunriseMinutes: 372,
      sunsetMinutes: 1231,
    });
    const { bridge, saveSunTimes } = createBridge();
    render(<TrackSunTimesFields bridge={bridge} />);

    fireEvent.change(sunrise(), { target: { value: '06:12' } });
    fireEvent.blur(sunrise());
    fireEvent.blur(sunset());

    expect(saveSunTimes).not.toHaveBeenCalled();
  });

  it('follows what is kept: another track, or a time changed elsewhere', () => {
    withProfile({ trackKey: TRACK_KEY, sunriseMinutes: 372 });
    const { bridge } = createBridge();
    const view = render(<TrackSunTimesFields bridge={bridge} />);
    expect(sunrise()).toHaveValue('06:12');

    withProfile({
      trackKey: 'iracing:163',
      sunriseMinutes: 400,
      sunsetMinutes: 1300,
    });
    view.rerender(<TrackSunTimesFields bridge={bridge} />);

    expect(sunrise()).toHaveValue('06:40');
    expect(sunset()).toHaveValue('21:40');
  });

  it.each([
    ['no session running', { trackKey: null }],
    ['nothing published yet', undefined],
  ])('is off with %s, and says why', (_, profile) => {
    withProfile(profile);
    const { bridge, saveSunTimes } = createBridge();
    render(<TrackSunTimesFields bridge={bridge} />);

    expect(sunrise()).toBeDisabled();
    expect(sunset()).toBeDisabled();
    expect(
      screen.getByText(
        'Join a session to set the sunrise and sunset of its track.'
      )
    ).toBeInTheDocument();
    fireEvent.change(sunrise(), { target: { value: '06:12' } });
    expect(saveSunTimes).not.toHaveBeenCalled();
  });

  it('is off where there is no bridge to save through', () => {
    withProfile({ trackKey: TRACK_KEY });
    render(<TrackSunTimesFields />);

    expect(sunrise()).toBeDisabled();
  });
});
