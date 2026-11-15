import { useEffect, useState } from 'react';
import type { ChargeBand } from '../hybridDisplay';

/** How many times the warning colour goes out before it stays. */
export const FLASH_PULSES = 10;
/** Each pulse: the colour lit this long, then out this long. */
export const FLASH_LIT_MS = 400;
export const FLASH_DARK_MS = 200;

/**
 * Whether the charge's warning colour is showing right now.
 *
 * On entering a warning band the colour pulses ten times, lit 0.4 s and out
 * 0.2 s, then holds for as long as the charge stays in the band. Moving to
 * another band starts the sequence again. With the flash switched off the
 * colour simply holds.
 */
export const useChargeFlash = (band: ChargeBand, enabled: boolean): boolean => {
  // The band the colour is currently out for. Kept by band rather than as a
  // flag, so that a change of band shows the new colour at once without
  // anything to reset.
  const [darkFor, setDarkFor] = useState<ChargeBand | null>(null);

  useEffect(() => {
    if (!enabled || band === 'normal') return;
    let pulses = 0;
    let timer: ReturnType<typeof setTimeout>;
    const goDark = () => {
      setDarkFor(band);
      timer = setTimeout(goLit, FLASH_DARK_MS);
    };
    const goLit = () => {
      setDarkFor(null);
      pulses += 1;
      if (pulses < FLASH_PULSES) timer = setTimeout(goDark, FLASH_LIT_MS);
    };
    timer = setTimeout(goDark, FLASH_LIT_MS);
    return () => clearTimeout(timer);
  }, [band, enabled]);

  return band !== 'normal' && !(enabled && darkFor === band);
};
