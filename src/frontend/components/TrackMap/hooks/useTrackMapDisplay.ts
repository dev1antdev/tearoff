import { useMemo } from 'react';
import { useDriverLivePositions } from '@irdashies/domain';
import type { TrackMapWidgetSettings } from '@irdashies/types';
import type { TurnLabels } from '../TrackCanvas';
import { usePlayerIconImage } from './usePlayerIconImage';

/**
 * What the Track Map's canvas is given that depends on the settings alone,
 * for whichever sim's track is being drawn: the turn label options, the
 * player's own icon and the live positions.
 */
export const useTrackMapDisplay = (
  settings: TrackMapWidgetSettings['config'] | undefined
) => {
  // A new object each render would redraw the static track layer every update.
  const turnLabels = useMemo<TurnLabels>(
    () => ({
      enabled: settings?.turnLabels?.enabled ?? false,
      labelType: settings?.turnLabels?.labelType ?? 'both',
      highContrast: settings?.turnLabels?.highContrast ?? true,
      labelFontSize: settings?.turnLabels?.labelFontSize ?? 100,
    }),
    [
      settings?.turnLabels?.enabled,
      settings?.turnLabels?.labelType,
      settings?.turnLabels?.highContrast,
      settings?.turnLabels?.labelFontSize,
    ]
  );
  const playerIconEnabled = settings?.playerIcon?.enabled ?? false;
  const playerIconDataUrl = usePlayerIconImage(
    playerIconEnabled ? settings?.playerIcon?.fileName : undefined
  );
  const driverLivePositions = useDriverLivePositions({
    enabled: settings?.displayMode === 'livePosition',
  });

  return { turnLabels, playerIconDataUrl, driverLivePositions };
};
