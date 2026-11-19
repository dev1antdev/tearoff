import { memo } from 'react';
import { BatteryChargingIcon, LightningIcon } from '@phosphor-icons/react';
import {
  useDrivingState,
  useHybridSnapshot,
  useSessionVisibility,
} from '@irdashies/context';
import type { HybridMotorState } from '@irdashies/types';
import { useHybridSettings } from './hooks/useHybridSettings';
import { useChargeFlash } from './hooks/useChargeFlash';
import {
  CHARGE_BAR_CLASS,
  CHARGE_TEXT_CLASS,
  NO_READING,
  chargeBand,
  formatCharge,
  formatPower,
  formatSeconds,
  formatSigned,
  formatSignedPower,
  formatTemperature,
  formatWhole,
  lapUse,
  netToneClass,
  temperatureToneClass,
} from './hybridDisplay';

interface StateChipProps {
  state: HybridMotorState;
}

/**
 * What the motor is doing, in the chip idiom of Car Systems and in the two
 * colours it gives the deploy and regeneration dials.
 */
const StateChip = memo(({ state }: StateChipProps) => {
  const base =
    'flex flex-none items-center gap-1 rounded px-1 py-0.5 text-xs font-bold leading-none';
  if (state === 2) {
    return (
      <div className={`${base} bg-orange-600 text-white`}>
        <LightningIcon size={14} weight="fill" aria-hidden="true" />
        DEPLOY
      </div>
    );
  }
  if (state === 3) {
    return (
      <div className={`${base} bg-emerald-600 text-white`}>
        <BatteryChargingIcon size={14} weight="fill" aria-hidden="true" />
        REGEN
      </div>
    );
  }
  return (
    <div className={`${base} bg-slate-600/60 py-1 text-white/60`}>
      {state === 1 ? 'IDLE' : NO_READING}
    </div>
  );
});
StateChip.displayName = 'StateChip';

interface CellProps {
  caption: string;
  value: string;
  /** Drawn small after the value. */
  unit?: string;
  toneClass: string;
}

/**
 * A caption over a figure. Takes text and a class rather than the snapshot,
 * so a cell whose figure did not move re-renders nothing.
 */
const Cell = memo(({ caption, value, unit, toneClass }: CellProps) => (
  <div className="flex min-w-0 flex-auto flex-col items-center">
    {/* Cut short rather than run into its neighbour in a box too narrow. */}
    <span className="max-w-full truncate text-2xs uppercase leading-tight text-white/50">
      {caption}
    </span>
    <span
      className={`whitespace-nowrap text-sm font-medium leading-tight tabular-nums ${
        value === NO_READING ? 'text-white/40' : toneClass
      }`}
    >
      {value}
      {unit !== undefined && value !== NO_READING && (
        <span className="ml-0.5 text-2xs font-normal text-white/50">
          {unit}
        </span>
      )}
    </span>
  </div>
));
Cell.displayName = 'Cell';

/**
 * The hybrid battery of the player's car: its charge, what the motor is
 * doing, what this lap has used and recovered and is on course to net, and
 * optionally the motor's own readings.
 *
 * Le Mans Ultimate only. A car that has shown no hybrid system, which is
 * every car outside the Hypercar class and some inside it, draws nothing.
 */
export const Hybrid = () => {
  const settings = useHybridSettings();
  const snapshot = useHybridSnapshot();
  const { isDriving } = useDrivingState();
  const isSessionVisible = useSessionVisibility(settings.sessionVisibility);

  const available = snapshot?.available === true;
  const band = available
    ? chargeBand(
        snapshot.chargePct,
        settings.lowChargePct,
        settings.highChargePct
      )
    : 'normal';
  const lit = useChargeFlash(band, settings.warningFlash);

  if (!isSessionVisible) return <></>;
  // The driver's own battery: nothing to show for a car that is watched.
  if (settings.showOnlyWhenOnTrack && !isDriving) return <></>;
  if (!available) return <></>;

  const { decimals, temperatureUnit, powerUnit } = settings;
  const use = lapUse(snapshot, settings.freezeSeconds);
  const { motor } = snapshot;
  const hasLapRow =
    settings.showLapUse || settings.showNetEstimate || settings.showDeployTimer;
  const hasMotorRow =
    settings.showMotor &&
    (settings.motor.showTemps ||
      settings.motor.showRpm ||
      settings.motor.showTorque ||
      settings.motor.showPower ||
      settings.motor.showRegen);

  return (
    <div
      className="flex h-full w-full flex-col justify-center gap-1.5 overlay-panel p-2 font-medium text-white"
      style={{
        ['--bg-opacity' as string]: `${settings.background.opacity}%`,
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-baseline gap-0.5 leading-none">
          <span
            data-testid="hybrid-charge"
            className={`text-2xl font-semibold leading-none tabular-nums ${
              CHARGE_TEXT_CLASS[lit ? band : 'normal']
            }`}
          >
            {formatCharge(snapshot.chargePct, decimals)}
          </span>
          <span className="text-xs text-white/50">%</span>
        </div>
        <StateChip state={snapshot.motorState} />
      </div>

      <div className="h-1.5 w-full flex-none overflow-hidden rounded-full bg-slate-700">
        <div
          data-testid="hybrid-bar"
          className={`h-full w-(--charge) rounded-full ${CHARGE_BAR_CLASS[band]}`}
          style={{
            ['--charge' as string]: `${Math.min(100, Math.max(0, snapshot.chargePct ?? 0))}%`,
          }}
        />
      </div>

      {hasLapRow && (
        <div className="flex justify-between gap-2">
          {settings.showLapUse && (
            <>
              <Cell
                caption={use.frozen ? 'Last' : 'Used'}
                value={formatSigned(-use.used, decimals)}
                toneClass="text-orange-300"
              />
              <Cell
                caption={use.frozen ? 'Last' : 'Regen'}
                value={formatSigned(use.regen, decimals)}
                toneClass="text-emerald-300"
              />
            </>
          )}
          {settings.showNetEstimate && (
            <Cell
              caption="Net"
              value={formatSigned(snapshot.netLapEstimatePct, decimals)}
              toneClass={netToneClass(snapshot.netLapEstimatePct)}
            />
          )}
          {settings.showDeployTimer && (
            <Cell
              caption="Deploy"
              value={formatSeconds(snapshot.deployTimeLapS)}
              unit="s"
              toneClass="text-white"
            />
          )}
        </div>
      )}

      {hasMotorRow && (
        <div className="flex justify-between gap-1">
          {settings.motor.showTemps && (
            <>
              <Cell
                caption="Motor"
                value={formatTemperature(motor.motorTempC, temperatureUnit)}
                unit="°"
                toneClass={temperatureToneClass(
                  motor.motorTempC,
                  settings.motorTempWarnC
                )}
              />
              <Cell
                caption="Coolant"
                value={formatTemperature(motor.coolantTempC, temperatureUnit)}
                unit="°"
                toneClass={temperatureToneClass(
                  motor.coolantTempC,
                  settings.coolantTempWarnC
                )}
              />
            </>
          )}
          {settings.motor.showRpm && (
            <Cell
              caption="RPM"
              value={formatWhole(motor.rpm)}
              toneClass="text-white"
            />
          )}
          {settings.motor.showTorque && (
            <Cell
              caption="Torque"
              value={formatWhole(motor.torqueNm)}
              toneClass="text-white"
            />
          )}
          {settings.motor.showPower && (
            <Cell
              caption="Power"
              value={formatPower(motor.powerKw, powerUnit)}
              toneClass="text-white"
            />
          )}
          {settings.motor.showRegen && (
            <Cell
              caption="Regen"
              value={formatSignedPower(motor.regenKw, powerUnit)}
              toneClass="text-emerald-300"
            />
          )}
        </div>
      )}
    </div>
  );
};
