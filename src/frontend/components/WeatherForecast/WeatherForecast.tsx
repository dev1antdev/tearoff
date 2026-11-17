import { memo } from 'react';
import {
  CaretDownIcon,
  CaretUpIcon,
  CloudIcon,
  CloudLightningIcon,
  CloudRainIcon,
  CloudSunIcon,
  CloudWarningIcon,
  DropIcon,
  SunIcon,
  type Icon,
} from '@phosphor-icons/react';
import {
  sessionBarSelectors,
  useDrivingState,
  useSessionBarSelector,
  useSessionVisibility,
  useWeatherForecastSnapshot,
} from '@irdashies/context';
import type { WeatherTrend } from '@irdashies/types';
import { IRACING_UNITS_METRIC } from '@irdashies/utils/units';
import { WindArrow } from '../shared/WindArrow';
import { useWeatherForecastSettings } from './hooks/useWeatherForecastSettings';
import {
  NO_READING,
  forecastTimeLabel,
  formatForecastPercent,
  formatForecastTemperature,
  formatForecastWind,
  isWetSky,
  rainBarWidth,
  skyAppearance,
  type SkyGlyph,
} from './forecastDisplay';

const SKY_ICONS: Record<SkyGlyph, Icon> = {
  sun: SunIcon,
  cloudSun: CloudSunIcon,
  cloud: CloudIcon,
  cloudRain: CloudRainIcon,
  cloudLightning: CloudLightningIcon,
  unknown: CloudWarningIcon,
};

/** The sim publishes eleven sky types; this is none of them. */
const NO_SKY = -1;

interface TrendArrowProps {
  trend: WeatherTrend;
  risingClass: string;
  fallingClass: string;
  label: string;
}

/** A small caret while a reading is on the move; nothing while it is steady. */
const TrendArrow = ({
  trend,
  risingClass,
  fallingClass,
  label,
}: TrendArrowProps) => {
  if (trend === 0) return null;
  const Caret = trend > 0 ? CaretUpIcon : CaretDownIcon;
  return (
    <Caret
      size={10}
      weight="fill"
      className={`flex-none ${trend > 0 ? risingClass : fallingClass}`}
      aria-label={`${label} ${trend > 0 ? 'rising' : 'falling'}`}
    />
  );
};

interface ColumnProps {
  /** "Now", "~12m", "~15:40", or a dash. */
  heading: string;
  /** The live column: a lighter card, and the one that carries trends. */
  live: boolean;
  /** An empty slot: dashes, to hold the row's width. */
  empty: boolean;
  skyType: number;
  /** Already formatted; empty when the row is switched off. */
  temperature: string;
  temperatureTrend: WeatherTrend;
  showRain: boolean;
  /** 0..1: how hard it is raining now, or the chance of rain at a point. */
  rain: number | null;
  /** Already formatted; empty when the figure is switched off. */
  rainValue: string;
  rainTrend: WeatherTrend;
  /** Already formatted; empty when the row is switched off. */
  humidity: string;
  /** Already formatted; empty when the row is switched off. */
  windSpeed: string;
  /** Compass radians the wind blows from, or null for no arrow. */
  windDirection: number | null;
}

/**
 * One column: when, the sky, the temperature and the rain, top to bottom.
 *
 * Takes strings and numbers rather than a forecast point so that a snapshot
 * whose shown values did not move re-renders nothing.
 */
const Column = memo(
  ({
    heading,
    live,
    empty,
    skyType,
    temperature,
    temperatureTrend,
    showRain,
    rain,
    rainValue,
    rainTrend,
    humidity,
    windSpeed,
    windDirection,
  }: ColumnProps) => {
    const sky = skyAppearance(skyType);
    const SkyIcon = SKY_ICONS[sky.glyph];
    const wet = !empty && !live && isWetSky(skyType);

    return (
      <div
        className={[
          'flex min-w-0 flex-col items-center gap-0.5 rounded-sm px-1 py-1',
          live ? 'bg-slate-700/70' : 'bg-slate-800/70',
          wet ? 'ring-1 ring-sky-400/60' : '',
          empty ? 'opacity-50' : '',
        ].join(' ')}
      >
        <div className="max-w-full truncate text-xs leading-4 tabular-nums text-white/60">
          {heading}
        </div>
        {empty ? (
          <div className="flex h-6 items-center text-sm text-white/40">
            {NO_READING}
          </div>
        ) : (
          <SkyIcon
            size={24}
            weight={sky.weight}
            className={`flex-none ${sky.className}`}
            aria-label={sky.label}
          />
        )}
        {temperature && (
          <div className="flex items-center gap-0.5 text-sm font-semibold leading-5 tabular-nums">
            <span>{temperature}</span>
            <TrendArrow
              trend={temperatureTrend}
              risingClass="text-white/60"
              fallingClass="text-white/60"
              label="Temperature"
            />
          </div>
        )}
        {showRain && (
          <div className="flex w-full items-center gap-1">
            <div
              className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-slate-900/70"
              role="img"
              aria-label={live ? 'Rain' : 'Chance of rain'}
            >
              <div
                className="h-full rounded-full bg-sky-400"
                style={{ width: empty ? '0%' : rainBarWidth(rain) }}
              />
            </div>
            {rainValue && (
              <span className="flex-none text-[10px] leading-none tabular-nums text-white/70">
                {rainValue}
              </span>
            )}
            <TrendArrow
              trend={rainTrend}
              risingClass="text-amber-300"
              fallingClass="text-green-400"
              label="Rain"
            />
          </div>
        )}
        {humidity && (
          <div className="flex items-center gap-0.5 text-[10px] leading-3 tabular-nums text-white/70">
            <DropIcon size={10} className="flex-none text-white/50" />
            <span>{humidity}</span>
          </div>
        )}
        {windSpeed && (
          <div className="flex items-center gap-1 text-[10px] leading-3 tabular-nums text-white/70">
            {windDirection !== null && (
              <WindArrow
                direction={windDirection}
                className="h-2.5 w-2 flex-none"
              />
            )}
            <span>{windSpeed}</span>
          </div>
        )}
      </div>
    );
  }
);
Column.displayName = 'WeatherForecastColumn';

/**
 * The weather now and the points of Le Mans Ultimate's forecast still to
 * come, side by side: when, the sky, the temperature and the rain.
 *
 * The sim publishes what each point holds and not when it applies. The times
 * are worked out from where the points sit in the session, a fifth of its
 * length apart, which one recording has shown for a race and nothing has for
 * the rest, and carry a "~" for it.
 *
 * Le Mans Ultimate only: iRacing publishes no forecast.
 */
export const WeatherForecast = () => {
  const settings = useWeatherForecastSettings();
  const snapshot = useWeatherForecastSnapshot();
  const displayUnits = useSessionBarSelector(sessionBarSelectors.displayUnits);
  const { isDriving, isWatching } = useDrivingState();
  const isSessionVisible = useSessionVisibility(settings.sessionVisibility);

  if (!isSessionVisible) return <></>;
  // A forecast is the session's, and as true from the pit wall as from the
  // seat: shown while driving and while watching a car on track.
  if (settings.showOnlyWhenOnTrack && !(isDriving || isWatching)) return <></>;

  const metric =
    settings.units === 'auto'
      ? displayUnits === undefined || displayUnits === IRACING_UNITS_METRIC
      : settings.units === 'Metric';
  const wanted = Math.min(Math.max(Math.round(settings.nodes), 1), 4);
  const nodes = (snapshot?.available ? snapshot.nodes : []).slice(0, wanted);
  const showTemperature = settings.temperature.enabled;
  const showRain = settings.rainChance.enabled;
  const showRainValue = showRain && settings.rainChance.showValue;
  const showTrend = settings.trend.enabled;

  const columns: (ColumnProps & { key: string })[] = [];
  if (settings.showNow) {
    const now = snapshot?.now;
    columns.push({
      key: 'now',
      heading: 'Now',
      live: true,
      empty: false,
      skyType: now?.skyType ?? NO_SKY,
      temperature: showTemperature
        ? formatForecastTemperature(now?.airTempC, metric)
        : '',
      temperatureTrend: showTrend ? (now?.airTempTrend ?? 0) : 0,
      showRain,
      rain: now?.rain ?? null,
      rainValue: showRainValue ? formatForecastPercent(now?.rain) : '',
      rainTrend: showTrend ? (now?.rainTrend ?? 0) : 0,
      // The sim states a humidity and a wind for the forecast only.
      humidity: settings.humidity.enabled ? NO_READING : '',
      windSpeed: settings.wind.enabled ? NO_READING : '',
      windDirection: null,
    });
  }
  for (const node of nodes) {
    columns.push({
      key: `node-${node.index}`,
      heading: forecastTimeLabel(
        settings.timeLabel,
        node.startsInMinutes,
        node.startsAtTimeOfDay
      ),
      live: false,
      empty: false,
      skyType: node.skyType,
      temperature: showTemperature
        ? formatForecastTemperature(node.airTempC, metric)
        : '',
      temperatureTrend: 0,
      showRain,
      rain: node.rainChance,
      rainValue: showRainValue ? formatForecastPercent(node.rainChance) : '',
      rainTrend: 0,
      humidity: settings.humidity.enabled
        ? formatForecastPercent(node.humidity)
        : '',
      windSpeed: settings.wind.enabled
        ? formatForecastWind(node.windSpeedMs, metric)
        : '',
      windDirection: settings.wind.enabled ? node.windDirectionRad : null,
    });
  }
  if (!settings.hideEmptyColumns) {
    for (let slot = nodes.length; slot < wanted; slot += 1) {
      columns.push({
        key: `empty-${slot}`,
        heading: NO_READING,
        live: false,
        empty: true,
        skyType: NO_SKY,
        temperature: showTemperature ? NO_READING : '',
        temperatureTrend: 0,
        showRain,
        rain: null,
        rainValue: '',
        rainTrend: 0,
        humidity: settings.humidity.enabled ? NO_READING : '',
        windSpeed: settings.wind.enabled ? NO_READING : '',
        windDirection: null,
      });
    }
  }

  // Every column keeps the width it has in a full row, so "Now" does not
  // stretch as the points pass and the row gets shorter.
  const slots = wanted + (settings.showNow ? 1 : 0);
  const ordered = settings.reverse ? [...columns].reverse() : columns;
  const lead = settings.reverse ? slots - columns.length : 0;

  return (
    <div
      // What it holds is centred by its own margins and not by this box:
      // in a box too short for it, margins leave it at the top, from where
      // a panel can scroll down it. Centred by the box it would be cut at
      // both ends, with its top above where any scrolling reaches. The
      // room above and below it is those margins and no padding of the
      // box, which would push it out of a box it only just fits.
      className="flex h-full w-full flex-col rounded bg-slate-800/(--bg-opacity) px-2 text-white"
      style={{
        ['--bg-opacity' as string]: `${settings.background.opacity}%`,
      }}
    >
      {columns.length === 0 ? (
        <div className="my-auto text-center text-xs text-white/60">
          {snapshot?.available ? 'No further forecast' : 'No forecast'}
        </div>
      ) : (
        <div
          data-testid="weather-forecast-columns"
          className="my-auto grid gap-1"
          style={{
            gridTemplateColumns: `repeat(${slots}, minmax(0, 1fr))`,
          }}
        >
          {Array.from({ length: lead }, (_, index) => (
            <div key={`lead-${index}`} aria-hidden="true" />
          ))}
          {ordered.map(({ key, ...column }) => (
            <Column key={key} {...column} />
          ))}
        </div>
      )}
    </div>
  );
};
