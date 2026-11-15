import { useSessionStore } from '@irdashies/context';

/**
 * The regeneration level as Le Mans Ultimate's garage states it, or undefined
 * for a car that has no such setting, under iRacing, and while the sim's REST
 * API is not answering.
 *
 * From the session rather than the car-systems snapshot: shared memory has no
 * dial for it, only the setup screen does. The text is selected on its own so
 * the subscription compares a string, as `usePlayerCarPath` does.
 */
export const useGarageRegenLevel = (): string | undefined =>
  useSessionStore((state) => state.session?.LmuRest?.garage?.regenLevel?.text);
