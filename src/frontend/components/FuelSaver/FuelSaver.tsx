import { memo } from 'react';
import { GasPumpIcon, LightningIcon } from '@phosphor-icons/react';
import {
  useDrivingState,
  useFuelProjectionSnapshot,
  usePitStopSnapshot,
  usePlayerStintSnapshot,
  useSessionVisibility,
} from '@irdashies/context';
import {
  computeSaverTable,
  LITRES_PER_GALLON,
  saverPerLap,
  savingTone,
  STOP_TARGET_MAX_SHARE,
  type SavingTone,
} from '@irdashies/domain/fuel/saverTable';
import { useFuelSaverSettings } from './hooks/useFuelSaverSettings';

const NO_READING = '--';

const TONE_CLASS: Record<SavingTone, string> = {
  inside: 'text-green-400',
  reachable: 'text-amber-300',
  outOfReach: 'text-slate-500',
};

const figure = (value: number): string => value.toFixed(2);

const signed = (value: number): string =>
  `${value > 0 ? '+' : value < 0 ? '-' : ''}${Math.abs(value).toFixed(2)}`;

interface SaverColumnProps {
  /** The stint length the column stands for: "19", or "2/19" for the centre. */
  caption: string;
  /** The consumption per lap that makes it last; empty for a dash. */
  target: string;
  /** How far above the target the car is, signed; empty for a dash. */
  saving: string;
  tone: SavingTone;
  isCurrent: boolean;
}

/** One target: the laps it buys, the consumption for it, the saving. */
const SaverColumnCell = memo(
  ({ caption, target, saving, tone, isCurrent }: SaverColumnProps) => (
    <div
      data-testid="fuel-saver-column"
      data-current={isCurrent}
      data-tone={saving ? tone : 'none'}
      className={`flex min-w-0 flex-1 flex-col items-center gap-1 rounded px-1 py-1 ${
        isCurrent ? 'rounded-md bg-slate-800/60' : ''
      }`}
    >
      <span className="text-[0.7em] leading-none text-slate-400">
        {caption}
      </span>
      <span
        className={`text-lg font-bold leading-none ${
          target ? '' : 'text-slate-500'
        }`}
      >
        {target || NO_READING}
      </span>
      <span
        className={`text-xs font-semibold leading-none ${
          saving ? TONE_CLASS[tone] : 'text-slate-500'
        }`}
      >
        {saving || NO_READING}
      </span>
    </div>
  )
);
SaverColumnCell.displayName = 'SaverColumnCell';

/**
 * What a lap may cost for the fuel or the energy to last longer: a column
 * for the laps it lasts now and one for each lap more, each with the
 * consumption that makes it and how far above it the car is running, and
 * under them what it would take to make one stop fewer.
 *
 * Virtual energy in percent for a car that runs on it, litres or gallons
 * otherwise, as the fuel calculator counts them: both read
 * `fuel.projection`. A saving the car is already inside is green, one
 * within reach amber, and one no driving style reaches grey.
 *
 * About the user's own entry: it stays up while a team-mate drives the car,
 * for as long as the sim goes on publishing its budget, and goes when the
 * camera is on another car.
 */
export const FuelSaver = () => {
  const settings = useFuelSaverSettings();
  const fuel = useFuelProjectionSnapshot();
  const stint = usePlayerStintSnapshot();
  // Only for the pit entry, and only when the allowance is asked for.
  const pitStop = usePitStopSnapshot(settings.pitEntryAllowance);
  const { isDriving, isWatchingOwnCar, isWatchingOtherCar } = useDrivingState();
  const isSessionVisible = useSessionVisibility(settings.sessionVisibility);

  if (!isSessionVisible) return <></>;
  if (isWatchingOtherCar) return <></>;
  if (settings.showOnlyWhenOnTrack && !(isDriving || isWatchingOwnCar)) {
    return <></>;
  }

  const onEnergy = fuel?.budget === 'virtualEnergy';
  // Everything in the unit shown, so the reserve is in it too.
  const scale =
    !onEnergy && settings.fuelUnits === 'gal' ? LITRES_PER_GALLON : 1;
  const unit = onEnergy ? '%' : settings.fuelUnits === 'gal' ? 'gal' : 'L';

  const perLap = fuel
    ? saverPerLap(fuel, settings.basis, settings.averageLaps) / scale
    : 0;
  const lastLap = fuel && fuel.lastLapUsage > 0 ? fuel.lastLapUsage / scale : 0;
  const lapsLeftInRace =
    fuel?.hasValidRaceEstimate && fuel.estimatedLapsRemaining > 0
      ? fuel.estimatedLapsRemaining
      : null;
  const level = fuel ? fuel.fuelLevel / scale : 0;
  // The stint's last lap ends at pit entry, not at the line -- unless what
  // is aboard already reaches the finish, where it ends at the flag.
  const entryPct = settings.pitEntryAllowance
    ? (pitStop?.lane.entryPct ?? null)
    : null;
  const stopsAgain = lapsLeftInRace === null || lapsLeftInRace * perLap > level;
  const pitEntryShare = entryPct !== null && stopsAgain ? 1 - entryPct : 0;
  const stintLaps = stint?.available ? (stint.stint?.laps ?? null) : null;

  const table = computeSaverTable({
    level,
    usedThisLap: fuel ? fuel.currentLapUsage / scale : 0,
    perLap,
    reserve: settings.reserve,
    pitEntryShare,
    stintLapsDone: stintLaps ?? 0,
    fewerLaps: settings.fewerLaps,
    moreLaps: settings.moreLaps,
    lapsLeftInRace,
    capacity:
      fuel?.fuelTankCapacity !== undefined && fuel.fuelTankCapacity > 0
        ? fuel.fuelTankCapacity / scale
        : null,
  });

  const stop = settings.showStopTarget ? table.stopTarget : null;
  // No driving style saves half of what the car uses.
  const showStop = stop !== null && stop.savingShare <= STOP_TARGET_MAX_SHARE;
  const BudgetIcon = onEnergy ? LightningIcon : GasPumpIcon;
  const placeholders = settings.fewerLaps + 1 + settings.moreLaps;

  return (
    <div
      data-testid="fuel-saver"
      className="flex h-full w-full flex-col gap-1.5 overflow-hidden overlay-panel p-2 leading-none text-white tabular-nums"
      style={{
        ['--bg-opacity' as string]: `${settings.background.opacity}%`,
      }}
    >
      <div className="flex flex-none items-center justify-between gap-2 text-[0.7em] font-semibold uppercase leading-none tracking-wider text-slate-400">
        <span className="flex items-center gap-1">
          <BudgetIcon
            size="1.3em"
            weight="fill"
            aria-label={onEnergy ? 'Virtual energy' : 'Fuel'}
          />
          <span>Use</span>
          <span
            data-testid="fuel-saver-use"
            className={`text-[1.2em] font-bold normal-case ${
              perLap > 0 ? 'text-white' : 'text-slate-500'
            }`}
          >
            {perLap > 0 ? figure(perLap) : NO_READING}
          </span>
          <span className="normal-case">{unit}/lap</span>
        </span>
        {settings.showLast && (
          <span className="flex items-center gap-1">
            <span>Last</span>
            <span
              data-testid="fuel-saver-last"
              className={`text-[1.2em] font-bold ${
                lastLap > 0 ? 'text-slate-200' : 'text-slate-500'
              }`}
            >
              {lastLap > 0 ? figure(lastLap) : NO_READING}
            </span>
          </span>
        )}
      </div>

      <div className="flex min-h-0 flex-1 items-stretch gap-1">
        {table.columns.length > 0
          ? table.columns.map((column) => (
              <SaverColumnCell
                key={column.laps}
                caption={
                  stintLaps === null
                    ? String(column.laps)
                    : column.isCurrent
                      ? `${stintLaps}/${column.stintLaps}`
                      : String(column.stintLaps)
                }
                target={figure(column.target)}
                saving={signed(column.saving)}
                tone={savingTone(column.saving, perLap, settings.reachShare)}
                isCurrent={column.isCurrent}
              />
            ))
          : Array.from({ length: placeholders }, (_, index) => (
              <SaverColumnCell
                key={index}
                caption={NO_READING}
                target=""
                saving=""
                tone="inside"
                isCurrent={index === settings.fewerLaps}
              />
            ))}
      </div>

      {showStop && stop && (
        <div
          data-testid="fuel-saver-stop"
          data-tone={savingTone(stop.saving, perLap, settings.reachShare)}
          className="flex flex-none items-center justify-between gap-2 border-t overlay-divider px-2 pt-1 text-xs"
        >
          <span className="text-[0.85em] font-semibold uppercase tracking-wider text-slate-400">
            1 stop fewer
          </span>
          <span className="font-bold">{figure(stop.target)}</span>
          <span
            className={`font-semibold ${
              TONE_CLASS[savingTone(stop.saving, perLap, settings.reachShare)]
            }`}
          >
            {signed(stop.saving)} ({Math.round(stop.savingShare * 100)}%)
          </span>
        </div>
      )}
    </div>
  );
};
