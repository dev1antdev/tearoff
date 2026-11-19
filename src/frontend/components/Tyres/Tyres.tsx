import { memo } from 'react';
import { DiscIcon } from '@phosphor-icons/react';
import {
  useDrivingState,
  useSessionVisibility,
  useTyreStateSnapshot,
  useWatchingOwnCarTelemetry,
  useWheelDynamicsSnapshot,
} from '@irdashies/context';
import type {
  TyresConfig,
  TyreWheelState,
  WheelDynamicsSnapshot,
} from '@irdashies/types';
import { Compound } from '../shared/Compound/Compound';
import { useTyresSettings } from './hooks/useTyresSettings';
import {
  BRAKE_FADE_C,
  NO_READING,
  PRESSURE_UNIT_LABELS,
  TEMPERATURE_UNIT_LABELS,
  TYRE_FADE_C,
  formatDeflection,
  formatLoadShare,
  formatPressure,
  formatPressureDeviation,
  formatTemperature,
  formatTread,
  isLoadLow,
  isPressureCold,
  isWheelLifted,
  loadBarFill,
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
  cold: 'text-sky-400',
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
  /** Offset from the highest pressure. Empty when it is not shown. */
  pressureDeviation: string;
  /** Empty when tread is not shown. */
  tread: string;
  /** Empty when deflection is not shown. */
  deflection: string;
  /** The wheel is off the ground, or all but. */
  lifted: boolean;
  /** Share of the car's load. Empty when the bar is not drawn. */
  load: string;
  /** How much of the load bar is filled, 0..1. */
  loadFill: number;
  loadLow: boolean;
  /** On the left of the car, so its load bar grows to the left. */
  isLeft: boolean;
}

/**
 * One tyre: pressure above, the tyre itself filled with its temperature across
 * the tread, and optionally the tread left, how far the tyre is squashed and
 * its share of the car's load below.
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
    pressureDeviation,
    tread,
    deflection,
    lifted,
    load,
    loadFill,
    loadLow,
    isLeft,
  }: TyreProps) => (
    <div className="flex min-w-0 flex-1 flex-col items-center gap-1">
      <div
        data-testid="tyre-pressure"
        className={`flex items-baseline gap-1 font-bold tabular-nums leading-none ${pressureToneClass}`}
      >
        <span>{pressure}</span>
        <span className="text-[0.55em] font-semibold text-slate-300">
          {pressureUnit}
        </span>
      </div>
      {pressureDeviation && (
        <div
          data-testid="tyre-pressure-deviation"
          className="-mt-0.5 text-[0.7em] leading-none tabular-nums text-slate-300"
        >
          {pressureDeviation}
        </div>
      )}
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
      {(tread || deflection) && (
        <div className="flex items-baseline gap-[0.6em] whitespace-nowrap text-[0.75em] leading-none tabular-nums text-slate-300">
          {tread && <span>{tread}</span>}
          {deflection && (
            <span
              data-testid="tyre-deflection"
              className={lifted ? 'text-red-400' : ''}
            >
              {deflection}
            </span>
          )}
        </div>
      )}
      {load && (
        <div
          data-testid="tyre-load"
          className={`flex w-full max-w-[5.5em] items-center gap-[0.3em] ${isLeft ? '' : 'flex-row-reverse'}`}
        >
          <span
            className={`w-[2.6em] flex-none text-[0.75em] leading-none tabular-nums ${isLeft ? 'text-left' : 'text-right'} ${loadLow ? 'text-red-400' : ''}`}
          >
            {load}
          </span>
          {/*
            Grows outwards from the car's centreline. A low load turns the
            whole track red, not just the fill: a wheel carrying next to
            nothing has no fill left to colour.
          */}
          <div
            className={`flex h-[0.4em] min-w-0 flex-1 overflow-hidden rounded-sm ${loadLow ? 'bg-red-500' : 'bg-slate-900/70'} ${isLeft ? 'justify-end' : 'justify-start'}`}
          >
            <div
              data-testid="tyre-load-fill"
              className={`h-full ${loadLow ? 'bg-red-500' : 'bg-slate-100'}`}
              style={{ width: `${Math.round(loadFill * 100)}%` }}
            />
          </div>
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
  /** Index of the axle's left wheel in LF, RF, LR, RR; the right is next. */
  leftIndex: number;
  wheels: readonly TyreWheelState[] | undefined;
  /**
   * The wheel channel while it has readings, and undefined out of the car:
   * the load and deflection rows then keep their place with placeholders.
   */
  dynamics: WheelDynamicsSnapshot | undefined;
  pressureTarget: number;
  settings: TyresConfig;
}

const Axle = ({
  title,
  leftIndex,
  wheels,
  dynamics,
  pressureTarget,
  settings,
}: AxleProps) => {
  const leftWheel = wheels?.[leftIndex];
  const rightWheel = wheels?.[leftIndex + 1];

  const tyre = (index: number) => {
    const wheel = wheels?.[index];
    const isLeft = index === leftIndex;
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

    const deflectionMm = dynamics?.tyreDeflectionMm?.[index];
    // Out of the car the bar keeps its place, empty. In the car, a sim that
    // publishes neither tyre load nor suspension force gets no bar at all.
    const share = dynamics?.loadShare?.[index];
    const showLoad =
      settings.showLoad && (!dynamics || typeof share === 'number');

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
              settings.pressureTarget.enabled,
              isPressureCold(wheel?.carcassTempC, settings.pressureColdBelow)
            )
          ]
        }
        pressureDeviation={
          settings.showPressureDeviation
            ? formatPressureDeviation(
                wheel?.pressureDeviationKpa,
                settings.pressureUnit
              )
            : ''
        }
        tread={settings.showWear ? formatTread(wheel?.treadRemaining) : ''}
        deflection={
          settings.showDeflection ? formatDeflection(deflectionMm) : ''
        }
        lifted={
          typeof deflectionMm === 'number' &&
          isWheelLifted(deflectionMm, settings.liftOffThreshold)
        }
        load={showLoad ? formatLoadShare(share) : ''}
        loadFill={typeof share === 'number' ? loadBarFill(share) : 0}
        loadLow={
          typeof share === 'number' &&
          isLoadLow(share, settings.lowLoadThreshold)
        }
        isLeft={isLeft}
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
        {tyre(leftIndex)}
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
        {tyre(leftIndex + 1)}
      </div>
    </section>
  );
};

/**
 * Tyre and brake temperatures, pressures and tread for the player's car, one
 * axle per block, with each wheel's share of the load and how far its tyre
 * is squashed where asked for.
 *
 * Le Mans Ultimate only. Out of the car the sim publishes no wheel data and
 * the widget keeps its shape with placeholders, so it can still be placed in
 * edit mode.
 *
 * Through a team-mate's stint in the user's own car the sim goes on writing
 * the brake temperatures and the compound, and the tread for a car it
 * simulates on this machine. Those are shown. The tyre temperatures and the
 * pressures, which it writes only for a car the user is in, keep their
 * placeholders, and so do the rows worked out from the user's own wheels:
 * the pressure offsets, the deflection and the load, whose bar stays empty.
 * With the camera on another car the readings on hand are still the own
 * car's, and every tile is a placeholder.
 */
export const Tyres = () => {
  const settings = useTyresSettings();
  const snapshot = useTyreStateSnapshot();
  const { isDriving, isWatchingOtherCar } = useDrivingState();
  const isWatchingOwnCarTelemetry = useWatchingOwnCarTelemetry();
  const isSessionVisible = useSessionVisibility(settings.sessionVisibility);
  // On track is at the wheel, or watching the own car where the sim sends
  // its telemetry block: the brakes are read from it then.
  const visible =
    isSessionVisible &&
    (!settings.showOnlyWhenOnTrack || isDriving || isWatchingOwnCarTelemetry);
  // Only while the widget is drawn and one of its two rows is on, so the
  // processor behind it rests otherwise.
  const wheelDynamics = useWheelDynamicsSnapshot(
    visible && (settings.showLoad || settings.showDeflection)
  );

  if (!visible) return <></>;

  const wheels =
    snapshot?.available && !isWatchingOtherCar ? snapshot.wheels : undefined;
  const dynamics =
    wheelDynamics?.available && !isWatchingOtherCar ? wheelDynamics : undefined;

  return (
    <div
      className="flex h-full w-full flex-col gap-2 overlay-panel p-2 font-medium text-white"
      style={{
        ['--bg-opacity' as string]: `${settings.background.opacity}%`,
      }}
    >
      <Axle
        title="Front"
        leftIndex={0}
        wheels={wheels}
        dynamics={dynamics}
        pressureTarget={settings.pressureTarget.front}
        settings={settings}
      />
      <Axle
        title="Rear"
        leftIndex={2}
        wheels={wheels}
        dynamics={dynamics}
        pressureTarget={settings.pressureTarget.rear}
        settings={settings}
      />
    </div>
  );
};
