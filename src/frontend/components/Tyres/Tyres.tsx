import { memo } from 'react';
import { DiscIcon } from '@phosphor-icons/react';
import {
  useDrivingState,
  useSessionVisibility,
  useTyreStateSnapshot,
} from '@irdashies/context';
import type { TyresConfig, TyreWheelState } from '@irdashies/types';
import { Compound } from '../shared/Compound/Compound';
import { useTyresSettings } from './hooks/useTyresSettings';
import {
  BRAKE_FADE_C,
  NO_READING,
  PRESSURE_UNIT_LABELS,
  TEMPERATURE_UNIT_LABELS,
  TYRE_FADE_C,
  formatPressure,
  formatTemperature,
  formatTread,
  mean,
  orderedWindow,
  pressureTone,
  temperatureColor,
  tyreWindow,
  tyreZones,
  type PressureTone,
} from './tyreDisplay';

const PRESSURE_TONE_CLASS: Record<PressureTone, string> = {
  plain: 'text-white',
  onTarget: 'text-green-400',
  low: 'text-sky-400',
  high: 'text-red-400',
};

interface TyreProps {
  /** Three colours across the tyre, left to right as drawn. */
  left: string;
  middle: string;
  right: string;
  temperature: string;
  pressure: string;
  pressureUnit: string;
  pressureToneClass: string;
  /** Empty when tread is not shown. */
  tread: string;
}

/**
 * One tyre: pressure above, the tyre itself filled with its temperature across
 * the tread, and optionally the tread left below.
 *
 * Takes strings and colours rather than the wheel object so that a snapshot
 * whose rounded values did not move re-renders nothing.
 */
const Tyre = memo(
  ({
    left,
    middle,
    right,
    temperature,
    pressure,
    pressureUnit,
    pressureToneClass,
    tread,
  }: TyreProps) => (
    <div className="flex min-w-0 flex-1 flex-col items-center gap-1">
      <div
        className={`flex items-baseline gap-1 font-bold tabular-nums leading-none ${pressureToneClass}`}
      >
        <span>{pressure}</span>
        <span className="text-[0.55em] font-semibold text-slate-300">
          {pressureUnit}
        </span>
      </div>
      <div
        className="flex min-h-[3.25em] w-full max-w-[5.5em] flex-1 items-center justify-center rounded-[1.1em] border border-black/50"
        style={{
          background: `linear-gradient(to right, ${left}, ${middle}, ${right})`,
        }}
      >
        <span className="text-[1.7em] font-bold leading-none tabular-nums text-white [text-shadow:0_1px_3px_rgb(0_0_0/0.85)]">
          {temperature}
        </span>
      </div>
      {tread && (
        <div className="text-[0.75em] leading-none tabular-nums text-slate-300">
          {tread}
        </div>
      )}
    </div>
  )
);
Tyre.displayName = 'Tyre';

interface BrakeProps {
  color: string;
  temperature: string;
  unit: string;
}

/** The axle's brake temperature, between its two tyres. */
const Brake = memo(({ color, temperature, unit }: BrakeProps) => (
  <div className="flex flex-none flex-col items-center justify-center gap-0.5 self-center">
    <DiscIcon size="1.9em" weight="bold" style={{ color }} aria-hidden="true" />
    <div className="flex items-baseline gap-0.5 text-[0.85em] font-semibold leading-none tabular-nums">
      <span>{temperature}</span>
      <span className="text-[0.7em] text-slate-300">{unit}</span>
    </div>
  </div>
));
Brake.displayName = 'Brake';

interface AxleProps {
  title: string;
  leftWheel: TyreWheelState | undefined;
  rightWheel: TyreWheelState | undefined;
  pressureTarget: number;
  settings: TyresConfig;
}

const Axle = ({
  title,
  leftWheel,
  rightWheel,
  pressureTarget,
  settings,
}: AxleProps) => {
  const tyre = (wheel: TyreWheelState | undefined, isLeft: boolean) => {
    const window = tyreWindow(settings.tyreWindow, wheel?.optimalTempC);
    const zones = tyreZones(wheel, settings.temperatureSource);
    const color = (zone: number) =>
      temperatureColor(zones?.[zone], window, TYRE_FADE_C);
    // Zones run outer shoulder to inner. The outer shoulder is the edge of
    // the car, so it is drawn on the left of a left tyre and on the right of
    // a right one.
    const [outer, middle, inner] = [color(0), color(1), color(2)];
    const temperature = formatTemperature(
      mean(zones),
      settings.temperatureUnit
    );
    return (
      <Tyre
        left={isLeft ? outer : inner}
        middle={middle}
        right={isLeft ? inner : outer}
        // A degree sign after the placeholder would read as a value.
        temperature={
          temperature === NO_READING ? temperature : `${temperature}°`
        }
        pressure={formatPressure(wheel?.pressureKpa, settings.pressureUnit)}
        pressureUnit={PRESSURE_UNIT_LABELS[settings.pressureUnit]}
        pressureToneClass={
          PRESSURE_TONE_CLASS[
            pressureTone(
              wheel?.pressureKpa,
              pressureTarget,
              settings.pressureTarget.tolerance,
              settings.pressureTarget.enabled
            )
          ]
        }
        tread={settings.showWear ? formatTread(wheel?.treadRemaining) : ''}
      />
    );
  };

  // One figure for the axle, as the two discs run close together. Coloured by
  // the hotter of the two, so one disc overheating is not averaged away.
  const brakeTemps = [leftWheel?.brakeTempC, rightWheel?.brakeTempC].filter(
    (value): value is number => typeof value === 'number'
  );
  const brakeMean = mean(brakeTemps);
  const brakeHottest = brakeTemps.length > 0 ? Math.max(...brakeTemps) : null;
  // Both wheels of an axle share a compound; -1 hides the glyph.
  const compound = leftWheel?.compound ?? -1;

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-1.5">
      <header className="flex items-center justify-center gap-2 rounded bg-slate-900/70 py-1 text-[0.85em] font-semibold leading-none">
        <span>{title}</span>
        {settings.showCompound && compound >= 0 && (
          <Compound tireCompound={compound} />
        )}
      </header>
      <div className="flex min-h-0 flex-1 items-stretch justify-between gap-2 px-1">
        {tyre(leftWheel, true)}
        {settings.showBrakes && (
          <Brake
            color={temperatureColor(
              brakeHottest,
              orderedWindow(settings.brakeWindow),
              BRAKE_FADE_C
            )}
            temperature={formatTemperature(brakeMean, settings.temperatureUnit)}
            unit={TEMPERATURE_UNIT_LABELS[settings.temperatureUnit]}
          />
        )}
        {tyre(rightWheel, false)}
      </div>
    </section>
  );
};

/**
 * Tyre and brake temperatures, pressures and tread for the player's car, one
 * axle per block.
 *
 * Le Mans Ultimate only. Out of the car the sim publishes no wheel data and
 * the widget keeps its shape with placeholders, so it can still be placed in
 * edit mode.
 */
export const Tyres = () => {
  const settings = useTyresSettings();
  const snapshot = useTyreStateSnapshot();
  const { isDriving } = useDrivingState();
  const isSessionVisible = useSessionVisibility(settings.sessionVisibility);

  if (!isSessionVisible) return <></>;
  if (settings.showOnlyWhenOnTrack && !isDriving) return <></>;

  const wheels = snapshot?.available ? snapshot.wheels : undefined;

  return (
    <div
      className="flex h-full w-full flex-col gap-2 rounded bg-slate-800/(--bg-opacity) p-2 font-medium text-white"
      style={{
        ['--bg-opacity' as string]: `${settings.background.opacity}%`,
      }}
    >
      <Axle
        title="Front"
        leftWheel={wheels?.[0]}
        rightWheel={wheels?.[1]}
        pressureTarget={settings.pressureTarget.front}
        settings={settings}
      />
      <Axle
        title="Rear"
        leftWheel={wheels?.[2]}
        rightWheel={wheels?.[3]}
        pressureTarget={settings.pressureTarget.rear}
        settings={settings}
      />
    </div>
  );
};
