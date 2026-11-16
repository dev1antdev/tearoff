import { usePitLapStoreUpdater } from '@irdashies/context';
import { useStandingsSettings, useRelativeSettings } from '@irdashies/domain';

export const PitLapUpdater = () => {
  const standingsSettings = useStandingsSettings();
  const relativeSettings = useRelativeSettings();

  const enabled = !!(
    standingsSettings?.pitStatus?.enabled ||
    relativeSettings?.pitStatus?.enabled
  );

  usePitLapStoreUpdater(enabled);
  return null;
};
