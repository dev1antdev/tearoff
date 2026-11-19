import {
  trackStateSelectors,
  useDrivingState,
  useGeneralSettings,
  useSessionVisibility,
  useTrackStateSelector,
} from '@irdashies/context';
import type { DeltaSpeedConfig } from '@irdashies/types';
import { resolveSpeedUnit } from '@irdashies/utils/units';
import { DeltaSpeedBox } from './components/DeltaSpeedBox';

export const DeltaSpeedDisplay = ({
  background,
  unit = 'km/h',
  scaleKph = 15,
  scaleMph = 10,
  capKph = 30,
  capMph = 20,
  updateThresholdKph = 0.3,
  updateThresholdMph = 0.2,
  showNumber = true,
  showOnlyWhenOnTrack,
  sessionVisibility,
  deltaKph,
}: DeltaSpeedConfig & { deltaKph: number | null }) => {
  const isOnTrack = useTrackStateSelector(trackStateSelectors.isOnTrack);
  const { isWatchingOwnCar } = useDrivingState();
  // 0 = imperial, 1 = metric
  const displayUnits = useTrackStateSelector(trackStateSelectors.displayUnits);
  const isVisibleInSession = useSessionVisibility(sessionVisibility);
  const generalSettings = useGeneralSettings();

  // Same density ladder the InformationBar and SessionBar use, so this widget
  // thins out alongside them instead of staying its own fixed size.
  const compactMode = generalSettings?.compactMode;
  const density =
    compactMode === 'ultra'
      ? 'ultra'
      : compactMode === 'compact'
        ? 'compact'
        : 'normal';

  if (!isVisibleInSession) return null;
  // At the wheel, or watching the user's own car with a team-mate in it:
  // its speed against the user's own reference lap.
  if (showOnlyWhenOnTrack && !(isOnTrack || isWatchingOwnCar)) return null;

  const resolvedUnit = resolveSpeedUnit(unit, displayUnits);
  const isMph = resolvedUnit === 'mph';

  return (
    <div
      className={`h-full w-full overlay-panel ${
        density === 'normal' ? 'p-2' : ''
      }`}
      style={{
        ['--bg-opacity' as string]: `${background?.opacity ?? 80}%`,
      }}
    >
      {deltaKph === null ? (
        // No clean lap yet, or no usable reference at this point on track.
        // An earlier version rendered nothing at all here, matching
        // benOfficial2's Delta Bar, but a widget that silently occupies no
        // space is indistinguishable from one that is broken or misconfigured.
        <div className="flex h-full w-full items-center justify-center">
          <span className="text-sm text-white/40">No clean lap</span>
        </div>
      ) : (
        <DeltaSpeedBox
          deltaKph={deltaKph}
          scale={isMph ? scaleMph : scaleKph}
          cap={isMph ? capMph : capKph}
          updateThreshold={isMph ? updateThresholdMph : updateThresholdKph}
          unit={resolvedUnit}
          showNumber={showNumber}
          density={density}
        />
      )}
    </div>
  );
};
