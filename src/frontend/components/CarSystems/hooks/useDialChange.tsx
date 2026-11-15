import { useEffect, useRef, useState } from 'react';
import type { CarSystemChange } from '@irdashies/types';

/** How long the value of a dial that moved stays lit. */
export const DIAL_FLASH_MS = 600;
/** How long the strip takes to fade out in the show-on-change mode. */
export const STRIP_FADE_OUT_MS = 300;

/**
 * Where the strip is in the show-on-change mode: off screen, on it, or on
 * its way off.
 */
export type StripPresence = 'hidden' | 'shown' | 'leaving';

export interface DialChangeState {
  /** The column whose value is lit, or null. */
  flashKey: string | null;
  presence: StripPresence;
}

/** The setting's own limits, in seconds, and what it is when left alone. */
const HOLD_MIN_S = 1;
const HOLD_MAX_S = 15;
const HOLD_DEFAULT_S = 4;

/**
 * The hold in milliseconds. The setting comes from a saved file, so a value
 * that is not a number, or is outside the slider's range, is put back inside
 * it rather than handed to a timer.
 */
const holdMsOf = (seconds: number): number =>
  (Number.isFinite(seconds)
    ? Math.min(HOLD_MAX_S, Math.max(HOLD_MIN_S, seconds))
    : HOLD_DEFAULT_S) * 1000;

/**
 * Turns the snapshot's `lastChange` into what the widget draws for it: which
 * column is lit, and whether the strip is on screen in the show-on-change
 * mode.
 *
 * The timers are the renderer's own and restart on every new change, so a
 * dial turned three clicks keeps the strip up from the last click.
 *
 * The first snapshot this window sees is where it came in, not a movement:
 * a change the driver made ten minutes ago is still on the snapshot when an
 * overlay is reloaded, and must not light up again.
 */
export const useDialChange = (
  lastChange: CarSystemChange | null | undefined,
  hasSnapshot: boolean,
  holdSeconds: number
): DialChangeState => {
  const [flashKey, setFlashKey] = useState<string | null>(null);
  const [presence, setPresence] = useState<StripPresence>('hidden');
  const seen = useRef<string | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  // Read when a change arrives, so moving the setting does not restart or
  // strand a hold that is already running.
  const holdMs = useRef(holdMsOf(holdSeconds));
  useEffect(() => {
    holdMs.current = holdMsOf(holdSeconds);
  }, [holdSeconds]);

  useEffect(
    () => () => {
      for (const timer of timers.current) clearTimeout(timer);
      timers.current = [];
    },
    []
  );

  const key = lastChange?.key;
  // The sequence number alone tells two changes apart; the rest is there for
  // a processor that started again from 1 without this window seeing the
  // snapshot in between.
  const signature = lastChange
    ? `${lastChange.seq}:${lastChange.key}:${lastChange.from}:${lastChange.to}`
    : '';

  useEffect(() => {
    if (!hasSnapshot) return;
    const previous = seen.current;
    seen.current = signature;
    if (previous === null || previous === signature || key === undefined) {
      return;
    }

    for (const timer of timers.current) clearTimeout(timer);
    setFlashKey(key);
    setPresence('shown');
    timers.current = [
      setTimeout(() => setFlashKey(null), DIAL_FLASH_MS),
      setTimeout(() => {
        setPresence('leaving');
        timers.current.push(
          setTimeout(() => setPresence('hidden'), STRIP_FADE_OUT_MS)
        );
      }, holdMs.current),
    ];
  }, [hasSnapshot, signature, key]);

  return { flashKey, presence };
};
