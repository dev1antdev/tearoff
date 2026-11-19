import { resolveSpeedUnit } from '@irdashies/utils/units';
import {
  useDrivingState,
  useSessionVisibility,
  useGeneralSettings,
  useWeekendInfoNumCarClasses,
  useCarIdxSpeed,
  useTrackStateSelector,
  trackStateSelectors,
} from '@irdashies/context';
import { useClassRivals, useHighlightColor } from '@irdashies/domain';
import { useBattleSettings } from './hooks/useBattleSettings';
import { resolveBattleColumns } from './battleColumns';
import { RivalRow } from './components/RivalRow';
import { RivalsHeader } from './components/RivalsHeader';

/**
 * The rivals box: the class car one place ahead of the focus car, the focus
 * car, and the class car one place behind.
 *
 * Each rival's row says what decides the fight with it: the gap as the race
 * counts it (laps once more than a lap apart, never the short way round the
 * track), the gap over the line last lap, how the gap has moved a lap over
 * the recent laps, and about how many laps until it is gone; then the stint
 * it is on, the stops it has made, what it has left, and whether it is in
 * the pits. The focus car's own row carries the same figures to read them
 * against.
 *
 * The focus car is the car being driven, and while watching, the car the
 * camera is on.
 */
export const Battle = () => {
  const settings = useBattleSettings();
  const generalSettings = useGeneralSettings();
  const { isDriving, isWatching } = useDrivingState();
  const isSessionVisible = useSessionVisibility(settings?.sessionVisibility);
  const highlightColor = useHighlightColor();
  const numCarClasses = useWeekendInfoNumCarClasses();
  const isMultiClass = (numCarClasses ?? 0) > 1;

  const gapEnabled = settings?.gap?.enabled ?? true;
  const forecastEnabled = settings?.forecast?.enabled ?? true;
  const rivals = useClassRivals({
    decimalPlaces: settings?.gap?.decimalPlaces ?? 2,
    // The line gaps feed the gap's second and third cells and the forecast.
    history: gapEnabled || forecastEnabled,
  });

  // Speed: derived from CarIdxLapDistPct movement, in km/h.
  const carSpeeds = useCarIdxSpeed(settings?.speed?.enabled ?? false);
  // The one field, not the snapshot: that is republished 25 times a second
  // with every car's position in it, and would render the widget as often.
  const displayUnits = useTrackStateSelector(trackStateSelectors.displayUnits);
  const speedUnit = resolveSpeedUnit(settings?.speed?.unit, displayUnits);

  const isCompact =
    generalSettings?.compactMode === 'compact' ||
    generalSettings?.compactMode === 'ultra';
  const tableBorderSpacing = isCompact
    ? 'border-spacing-y-0'
    : 'border-spacing-y-0.5';

  if (!isSessionVisible) return <></>;
  // On track is driving, or watching a car that is out of its garage: the
  // rivals are the focus car's, which is then the car being watched.
  if (settings?.showOnlyWhenOnTrack && !(isDriving || isWatching)) {
    return <></>;
  }

  const columns = resolveBattleColumns(settings, rivals);
  const rowProps = {
    columns,
    settings,
    highlightColor,
    isMultiClass,
    trackLimitsPointsMax: rivals.trackLimitsPointsMax,
    speedUnit,
  };
  const speedOf = (carIdx: number | undefined) =>
    carIdx === undefined ? undefined : carSpeeds[carIdx];

  return (
    <div
      className={`w-full overlay-panel ${!isCompact ? 'p-2' : ''} overflow-hidden text-white`}
      style={{
        ['--bg-opacity' as string]: `${settings?.background?.opacity ?? 80}%`,
      }}
    >
      <table
        className={`w-full table-auto text-sm border-separate ${tableBorderSpacing}`}
      >
        {(settings?.header?.enabled ?? true) && (
          <RivalsHeader columns={columns} speedUnit={speedUnit} />
        )}
        <tbody>
          <RivalRow
            {...rowProps}
            side="ahead"
            car={rivals.ahead}
            rival={rivals.ahead}
            speedKph={speedOf(rivals.ahead?.carIdx)}
            rowIndex={0}
          />
          <RivalRow
            {...rowProps}
            side="focus"
            car={rivals.focus}
            speedKph={speedOf(rivals.focus?.carIdx)}
            rowIndex={1}
          />
          <RivalRow
            {...rowProps}
            side="behind"
            car={rivals.behind}
            rival={rivals.behind}
            speedKph={speedOf(rivals.behind?.carIdx)}
            rowIndex={2}
          />
        </tbody>
      </table>
    </div>
  );
};
