import {
  useDashboard,
  sessionBarSelectors,
  trackStateSelectors,
  useDrivingState,
  useSessionBarSelector,
  useTrackStateSelector,
  useSessionVisibility,
  useThrottledWeather,
  useActiveSimulator,
} from '@irdashies/context';
import { useTrackTemperature } from './hooks/useTrackTemperature';
import { useWindDemoData } from '../../domain/weather/useWindDemoData';
import { WeatherRow } from './WeatherRow/WeatherRow';
import { WeatherTrackWetness } from './WeatherTrackWetness/WeatherTrackWetness';
import { WeatherTrackRubbered } from './WeatherTrackRubbered/WeatherTrackRubbered';
import { WindDirection } from './WindDirection/WindDirection';
import { useTrackRubberedState } from '@irdashies/domain/weather/useTrackRubberedState';
import { useWeatherSettings } from './hooks/useWeatherSettings';
import { useMemo } from 'react';
import {
  CloudRainIcon,
  DropHalfIcon,
  DropIcon,
  IconContext,
  RoadHorizonIcon,
  ThermometerIcon,
} from '@phosphor-icons/react';
import { OVERLAY_ICONS } from '@irdashies/utils/overlayIcons';

/**
 * A reading of the air, as the weather widget's row shows it: its own figure
 * and, for humidity, the icon its level calls for. A sim that publishes no
 * humidity reads "- %" rather than a dry 0%.
 */
const humidityReading = (humidity: number | undefined | null) => {
  const known = humidity !== undefined && humidity !== null;
  const percent = known ? Math.round(Number(humidity.toFixed(2)) * 100) : 0;
  return {
    icon: percent <= 50 ? DropIcon : DropHalfIcon,
    value: known ? `${percent}%` : '- %',
  };
};

/** iRacing gives precipitation as a fraction of 1. */
const precipitationReading = (
  precipitation: number | undefined | null
): string => {
  const known = precipitation !== undefined && precipitation !== null;
  return known ? `${Math.round(precipitation * 100)}%` : '- %';
};

type WeatherColumnId =
  | 'trackTemp'
  | 'airTemp'
  | 'wind'
  | 'humidity'
  | 'precipitation'
  | 'wetness'
  | 'trackState';

export const Weather = () => {
  const { isDemoMode } = useDashboard();
  const settings = useWeatherSettings();
  const displayUnits = useSessionBarSelector(sessionBarSelectors.displayUnits);
  const isOnTrack = useTrackStateSelector(trackStateSelectors.isOnTrack);
  const { isWatching } = useDrivingState();
  const isSessionVisible = useSessionVisibility(settings?.sessionVisibility);
  // What LMU has no figure for is left out rather than shown empty. It
  // simulates no wind: its wind vector is always zero, so the cell could only
  // ever show 0 with the arrow fixed on a headwind. And it publishes neither
  // the air's humidity nor how rubbered the track is, which read "- %" and
  // "N/A" for the whole session.
  const isLmu = useActiveSimulator() === 'lmu';

  // Determine actual unit to use: auto uses iRacing's DisplayUnits setting
  const unitSetting = settings?.units ?? 'auto';
  const isMetric =
    unitSetting === 'auto' ? displayUnits === 1 : unitSetting === 'Metric';
  const actualUnit = isMetric ? 'Metric' : 'Imperial';

  // Weather telemetry - throttled to ~1 update/sec since weather data
  // changes slowly and doesn't need 60 FPS updates
  const weather = useThrottledWeather();

  const { trackTemp, airTemp } = useTrackTemperature({
    airTempUnit: actualUnit,
    trackTempUnit: actualUnit,
  });
  const trackRubbered = useTrackRubberedState();
  const humidity = humidityReading(weather.humidity);

  // Derived values
  const relativeWindDirection =
    (weather.windDirection ?? 0) - (weather.windYaw ?? 0);
  const demoWind = useWindDemoData(isDemoMode, isMetric);
  const windSpeedMs = demoWind?.speedMs ?? weather.windVelocity;
  const windDirection = demoWind?.direction ?? relativeWindDirection;

  // Column ordering: depends ONLY on settings, NOT on telemetry data.
  // Settings change when the user edits config (very rare during a session).
  const displayOrder = settings?.displayOrder as string[] | undefined;
  const layout = settings?.layout ?? 'vertical';
  const horizontalMode = settings?.horizontalMode ?? 'compact';
  const componentVariant =
    layout === 'vertical'
      ? 'default'
      : horizontalMode === 'compact'
        ? 'compact'
        : 'inline';

  const visibleColumnIds = useMemo(() => {
    const allColumns: { id: WeatherColumnId; enabled: boolean }[] = [
      { id: 'trackTemp', enabled: settings?.trackTemp?.enabled ?? true },
      { id: 'airTemp', enabled: settings?.airTemp?.enabled ?? true },
      { id: 'wind', enabled: !isLmu && (settings?.wind?.enabled ?? true) },
      {
        id: 'humidity',
        enabled: !isLmu && (settings?.humidity?.enabled ?? true),
      },
      {
        id: 'precipitation',
        enabled: settings?.precipitation?.enabled ?? true,
      },
      { id: 'wetness', enabled: settings?.wetness?.enabled ?? true },
      {
        id: 'trackState',
        enabled: !isLmu && (settings?.trackState?.enabled ?? true),
      },
    ];

    const enabledColumns = allColumns.filter((c) => c.enabled);

    if (!displayOrder) {
      return enabledColumns.map((c) => c.id);
    }

    const ordered = displayOrder.filter((id): id is WeatherColumnId =>
      enabledColumns.some((c) => c.id === id)
    );

    const remaining = enabledColumns
      .filter((c) => !displayOrder.includes(c.id))
      .map((c) => c.id);

    return [...ordered, ...remaining];
  }, [
    settings?.trackTemp?.enabled,
    settings?.airTemp?.enabled,
    settings?.wind?.enabled,
    isLmu,
    settings?.humidity?.enabled,
    settings?.precipitation?.enabled,
    settings?.wetness?.enabled,
    settings?.trackState?.enabled,
    displayOrder,
  ]);

  // Maps column ID to its memoized sub-component.
  // Sub-components are wrapped in React.memo(), so they bail out of
  // re-rendering unless their specific primitive props have changed.
  const renderColumn = (id: WeatherColumnId) => {
    switch (id) {
      case 'trackTemp':
        return (
          <WeatherRow
            key={id}
            title="Track"
            value={trackTemp}
            icon={RoadHorizonIcon}
            variant={componentVariant}
          />
        );
      case 'airTemp':
        return (
          <WeatherRow
            key={id}
            title="Air"
            value={airTemp}
            icon={ThermometerIcon}
            variant={componentVariant}
          />
        );
      case 'wind':
        return (
          <WindDirection
            key={id}
            speedMs={windSpeedMs}
            direction={windDirection}
            metric={isMetric}
            variant={componentVariant}
          />
        );
      case 'humidity':
        return (
          <WeatherRow
            key={id}
            title="Humidity"
            value={humidity.value}
            icon={humidity.icon}
            variant={componentVariant}
          />
        );
      case 'precipitation':
        return (
          <WeatherRow
            key={id}
            title="Precipitation"
            value={precipitationReading(weather.precipitation)}
            icon={CloudRainIcon}
            variant={componentVariant}
          />
        );
      case 'wetness':
        return (
          <WeatherTrackWetness
            key={id}
            trackMoisture={weather.trackMoisture}
            variant={componentVariant}
          />
        );
      case 'trackState':
        return (
          <WeatherTrackRubbered
            key={id}
            trackRubbered={trackRubbered}
            variant={componentVariant}
          />
        );
    }
  };

  // Show only when on track: at the wheel, or watching a car that is out of
  // its garage. The weather is the session's and the same either way.
  if (settings?.showOnlyWhenOnTrack && !(isOnTrack || isWatching)) {
    return null;
  }

  if (!isSessionVisible) return <></>;

  return (
    <IconContext.Provider value={OVERLAY_ICONS}>
      <div
        className="@container w-full p-2 overlay-panel"
        style={{
          ['--bg-opacity' as string]: `${settings?.background?.opacity ?? 80}%`,
        }}
      >
        <div
          // A hairline in the middle of each gap, drawn by a pseudo-element so
          // it adds no size: beside each reading in a row, above it in a column.
          className={
            layout === 'horizontal'
              ? 'flex flex-row flex-wrap w-full gap-1 overlay-rules-x [--rule-gap:0.25rem]'
              : 'flex flex-col w-full gap-2 overlay-rules-y [--rule-gap:0.5rem]'
          }
        >
          {visibleColumnIds.map(renderColumn)}
        </div>
      </div>
    </IconContext.Provider>
  );
};
