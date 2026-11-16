import { useState } from 'react';
import type { TrackProfileBridge, TrackSunTimes } from '@irdashies/types';
import { useTrackProfileSnapshot } from '@irdashies/context';
import {
  sunTimeFieldMinutes,
  sunTimeFieldValue,
} from '@irdashies/domain/trackClock/trackClock';
import logger from '@irdashies/utils/logger';

interface TrackSunTimesFieldsProps {
  /** For stories and specs; the app uses the preload bridge. */
  bridge?: TrackProfileBridge;
}

type Field = keyof TrackSunTimes;

const FIELDS: readonly { field: Field; label: string }[] = [
  { field: 'sunriseMinutes', label: 'Sunrise' },
  { field: 'sunsetMinutes', label: 'Sunset' },
];

/** What the two fields show for a pair of times. */
const textOf = (times: TrackSunTimes): Record<Field, string> => ({
  sunriseMinutes: sunTimeFieldValue(times.sunriseMinutes),
  sunsetMinutes: sunTimeFieldValue(times.sunsetMinutes),
});

/**
 * When the sun rises and sets at the track of the running session, for the
 * in-game clock's countdown: two time fields, kept with the track.
 *
 * Neither sim states them and they move with the date a session is run on,
 * so they are the driver's to enter. A time is saved as soon as the field
 * holds one, and cleared when the field is left empty. With no session
 * running there is no track to keep them for, and the fields are off.
 *
 * Laid out as cells of the grid the item's other options sit in.
 */
export const TrackSunTimesFields = ({ bridge }: TrackSunTimesFieldsProps) => {
  const profile = useTrackProfileSnapshot();
  const profileBridge = bridge ?? window.trackProfileBridge;
  const trackKey = profile?.trackKey ?? null;
  const stored: TrackSunTimes = {
    sunriseMinutes: profile?.sunriseMinutes ?? null,
    sunsetMinutes: profile?.sunsetMinutes ?? null,
  };

  // The times as last entered, and what the fields hold while one is being
  // typed. Both follow what is kept for the track whenever that moves:
  // another track, or the store's answer to a save. Set during render, as
  // the widget pages do with their saved settings.
  const storedKey = `${trackKey}|${stored.sunriseMinutes}|${stored.sunsetMinutes}`;
  const [seenKey, setSeenKey] = useState(storedKey);
  const [times, setTimes] = useState(stored);
  const [text, setText] = useState(() => textOf(stored));
  if (storedKey !== seenKey) {
    setSeenKey(storedKey);
    setTimes(stored);
    setText(textOf(stored));
  }

  const disabled = !profileBridge || trackKey === null;

  const save = (field: Field, minutes: number | null) => {
    if (!profileBridge || trackKey === null || times[field] === minutes) return;
    // The other time as it was last entered, not as its field reads: that
    // one may be half typed.
    const next: TrackSunTimes = { ...times, [field]: minutes };
    setTimes(next);
    profileBridge
      .saveSunTimes(trackKey, next)
      .catch((error: unknown) =>
        logger.warn('Could not save the sunrise and sunset', error)
      );
  };

  return (
    <>
      {FIELDS.map(({ field, label }) => (
        <label
          key={field}
          className="flex min-w-0 flex-col gap-1 text-xs text-slate-400"
        >
          <span>{label}</span>
          <input
            type="time"
            aria-label={`${label} at this session's track`}
            className="settings-field w-full disabled:opacity-50"
            disabled={disabled}
            value={text[field]}
            onChange={(event) => {
              const value = event.target.value;
              setText((current) => ({ ...current, [field]: value }));
              // A whole time is kept at once. An empty field may be one
              // still being typed, and is taken as cleared only on leaving.
              const minutes = sunTimeFieldMinutes(value);
              if (minutes !== null) save(field, minutes);
            }}
            onBlur={() => {
              if (text[field] === '') save(field, null);
            }}
          />
        </label>
      ))}
      <p className="col-span-full text-xs text-slate-500">
        {trackKey === null
          ? 'Join a session to set the sunrise and sunset of its track.'
          : "Sunrise and sunset at this session's track, on the in-game clock. Neither sim states them, so they are yours to enter, and they are kept with the track. The countdown appears once both are set; empty a field to clear it."}
      </p>
    </>
  );
};
