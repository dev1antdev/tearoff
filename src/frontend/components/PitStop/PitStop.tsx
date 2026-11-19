import { memo } from 'react';
import {
  CaretDownIcon,
  CaretRightIcon,
  CaretUpIcon,
  GasPumpIcon,
  LightningIcon,
  TimerIcon,
} from '@phosphor-icons/react';
import type { PitStopSnapshot, TrackStateSnapshot } from '@irdashies/types';
import {
  useActiveSimulator,
  useCarPitSnapshot,
  useDrivingState,
  usePitStopSnapshot,
  useSessionDrivers,
  useSessionVisibility,
  useTrackStateSelector,
  useWeekendInfoNumCarClasses,
} from '@irdashies/context';
import {
  formatPitGap,
  formatPitSeconds,
  isPitDriveMeasured,
  pitDriveTimeS,
  pitLossS,
  pitStopChips,
  pitStopMode,
  plannedStandingS,
  projectRejoin,
  REJOIN_MARGIN_MEASURED_S,
  REJOIN_MARGIN_RECKONED_S,
  remainingPitLossS,
  STOP_ON_PLAN_S,
  type RejoinCar,
} from '@irdashies/domain/pitStop';
import { colorNumToHex } from '@irdashies/utils/colors';
import { PitStopChip } from './components/PitStopChips';
import { PitStopCountdown } from './components/PitStopCountdown';
import { PitStopFigure } from './components/PitStopFigure';
import { usePitStopSettings } from './hooks/usePitStopSettings';

/** The session clock in whole seconds: enough to end a result hold on. */
const selectSeconds = (snapshot: TrackStateSnapshot): number =>
  Math.floor(snapshot.sessionTime);

const amount = (value: number): string =>
  Math.abs(value) >= 100 ? value.toFixed(0) : value.toFixed(1);

interface RejoinCarProps {
  side: 'ahead' | 'behind';
  number: string;
  color: string | undefined;
  /** Seconds between the two cars after the stop. */
  gapS: number;
  /** Inside the margin: this is the car the position turns on. */
  close: boolean;
}

/** One of the two cars the stop puts the player between. */
const RejoinCarCell = memo(
  ({ side, number, color, gapS, close }: RejoinCarProps) => {
    const Caret = side === 'ahead' ? CaretUpIcon : CaretDownIcon;
    return (
      <span
        data-testid={`pit-stop-rejoin-${side}`}
        data-close={close}
        className="flex items-center gap-1"
      >
        <Caret
          size="0.9em"
          weight="fill"
          className="text-slate-400"
          aria-label={side === 'ahead' ? 'Car ahead' : 'Car behind'}
        />
        <span className="font-bold" style={color ? { color } : undefined}>
          #{number}
        </span>
        <span className={close ? 'text-amber-300' : 'text-slate-200'}>
          {formatPitGap(side === 'ahead' ? -gapS : gapS)}
        </span>
      </span>
    );
  }
);
RejoinCarCell.displayName = 'RejoinCarCell';

/**
 * The next pit stop: what the visit costs against staying out, how long it
 * stands and what that is made of, what goes in the tank, where the car
 * rejoins, and a countdown once it is in the pit lane.
 *
 * Every figure comes from `pit-stop.snapshot`; what depends on a setting is
 * worked out by `@irdashies/domain/pitStop`. A figure that is reckoned, not
 * measured or stated by the sim, is written with a "~": a lane that has not
 * been timed yet, a standing time learned from earlier stops, a rejoin
 * position that turns on a car within the margin.
 *
 * It is about the user's own entry, so it stays up while a team-mate
 * drives the car and goes when the camera is on another one.
 */
export const PitStop = () => {
  const settings = usePitStopSettings();
  const snapshot = usePitStopSnapshot();
  const carPit = useCarPitSnapshot(settings.showOccupancy);
  const now = useTrackStateSelector(selectSeconds) ?? 0;
  const { isDriving, isWatchingOwnCar, isWatchingOtherCar } = useDrivingState();
  const isSessionVisible = useSessionVisibility(settings.sessionVisibility);
  const drivers = useSessionDrivers();
  const isMultiClass = (useWeekendInfoNumCarClasses() ?? 0) > 1;
  const isLmu = useActiveSimulator() === 'lmu';

  if (!isSessionVisible) return <></>;
  // The figures are the own entry's whatever the camera is on, and with the
  // camera on a rival they are not what is on screen.
  if (isWatchingOtherCar) return <></>;
  const onTrack = isDriving || isWatchingOwnCar;
  if (settings.showOnlyWhenOnTrack && !onTrack) return <></>;

  const mode = snapshot
    ? pitStopMode(snapshot, now, settings.resultHold)
    : 'idle';
  if (
    settings.showMode === 'whenPitting' &&
    !(snapshot?.requested || mode === 'inPits' || mode === 'result')
  ) {
    return <></>;
  }

  const lane = snapshot?.lane;
  const estimate = snapshot?.estimate;
  const standing = estimate ? plannedStandingS(estimate) : null;
  const learned = estimate?.source === 'learned';
  const driveMeasured = lane ? isPitDriveMeasured(lane, standing) : false;
  const drive = lane ? pitDriveTimeS(lane, standing) : null;
  const loss = lane ? pitLossS(lane, standing, settings.extraTime) : null;
  // What the visit still costs once it is under way, so the rejoin keeps
  // counting against the stop as it runs down.
  const lossNow =
    snapshot && mode === 'inPits'
      ? (remainingPitLossS(snapshot, now, settings.extraTime) ?? loss)
      : loss;

  // Without a standing time the loss is that of a pass with no stop, which
  // is the least a stop can cost: a figure worth showing as what it is, and
  // not one to hang a position on. And once the stop is done the car is
  // where it is: the next stop's rejoin beside "stop done" would read as
  // this one's.
  const projects =
    mode === 'inPits' || (mode !== 'result' && standing !== null);
  // How near a car may rejoin before the position is called a close call:
  // wider while the lane or the stop is only reckoned.
  const margin =
    driveMeasured && !learned
      ? REJOIN_MARGIN_MEASURED_S
      : REJOIN_MARGIN_RECKONED_S;
  const projection =
    settings.showRejoin && snapshot && projects
      ? projectRejoin(snapshot.rejoin, lossNow, settings.rejoinScope, margin)
      : null;
  // Le Mans Ultimate's race gaps are worked out class by class, so a place
  // counted across classes is rougher than one inside a class.
  const positionReckoned =
    projection !== null &&
    (projection.closeCall ||
      (settings.rejoinScope === 'overall' && isMultiClass && isLmu));

  // The estimate and the refuel are the next stop's. Once this one is done
  // they describe a stop a stint away, and beside "stop done" they would
  // read as this one's; in the lane the refuel has nothing left to decide.
  const chips =
    settings.showBreakdown && estimate && mode !== 'result'
      ? pitStopChips(estimate)
      : [];
  const refuel =
    settings.showRefuel && (mode === 'planning' || mode === 'idle')
      ? (snapshot?.refuel ?? null)
      : null;
  const counts = settings.showOccupancy ? carPit?.counts : undefined;
  const hasRequests = (carPit?.requested.length ?? 0) > 0;
  const last = snapshot?.last ?? null;

  const carOf = (car: RejoinCar | null) => {
    if (!car) return null;
    const driver = drivers?.find((entry) => entry.CarIdx === car.carIdx);
    return {
      number: String(driver?.CarNumber ?? car.carIdx),
      color: colorNumToHex(driver?.CarClassColor),
    };
  };
  const ahead = carOf(projection?.ahead ?? null);
  const behind = carOf(projection?.behind ?? null);

  return (
    <div
      data-testid="pit-stop"
      data-mode={mode}
      className={`flex h-full w-full flex-col gap-2 overflow-hidden overlay-panel p-2 leading-none text-white tabular-nums ${
        mode === 'idle' ? 'opacity-60' : ''
      }`}
      style={{
        ['--bg-opacity' as string]: `${settings.background.opacity}%`,
      }}
    >
      <div className="flex flex-none items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1 text-xs font-medium uppercase tracking-wide text-slate-400">
          <TimerIcon size="1.2em" aria-hidden />
          <span className="truncate">
            {mode === 'result' ? 'Stop done' : 'Pit stop'}
          </span>
          {snapshot?.requested && (
            <span
              data-testid="pit-stop-requested"
              className="rounded bg-amber-500/20 px-1 py-0.5 text-2xs font-bold text-amber-300"
            >
              Requested
            </span>
          )}
        </div>
        {projection && (
          <div
            data-testid="pit-stop-position"
            data-reckoned={positionReckoned}
            className={`flex flex-none items-center gap-0.5 text-lg font-bold ${
              projection.positionAfter > projection.positionNow
                ? 'text-amber-300'
                : 'text-green-400'
            }`}
          >
            <span className="text-slate-300">P{projection.positionNow}</span>
            <CaretRightIcon
              size="0.8em"
              weight="bold"
              className="text-slate-500"
              aria-label="rejoins"
            />
            <span>
              {positionReckoned && (
                <span className="font-medium text-slate-400">~</span>
              )}
              P{projection.positionAfter}
            </span>
          </div>
        )}
      </div>

      {mode === 'inPits' && snapshot ? (
        <PitStopCountdown
          enteredAt={snapshot.timer.enteredAt}
          stoppedAt={snapshot.timer.stoppedAt}
          standingS={snapshot.timer.standingS}
          plannedStandingS={snapshot.planned?.standingS ?? null}
        />
      ) : mode === 'result' && last ? (
        <div className="flex flex-none items-end gap-4">
          <PitStopFigure
            name="main"
            label="Stop"
            value={formatPitSeconds(last.standingS)}
            unit="s"
            tone={
              last.plannedStandingS === null
                ? 'normal'
                : Math.abs(last.standingS - last.plannedStandingS) <=
                    STOP_ON_PLAN_S
                  ? 'good'
                  : 'caution'
            }
            large
          />
          <PitStopFigure
            name="planned"
            label="Planned"
            value={formatPitSeconds(last.plannedStandingS)}
          />
          <PitStopFigure
            name="lane"
            label="Lane"
            value={formatPitSeconds(last.laneS)}
          />
        </div>
      ) : (
        <div className="flex flex-none items-end gap-4">
          {loss !== null ? (
            <PitStopFigure
              name="main"
              label={standing === null ? 'Loss, no stop' : 'Loss'}
              value={formatPitSeconds(loss)}
              unit="s"
              approximate={!driveMeasured || learned}
              large
            />
          ) : (
            // No lane to drive yet: the stop alone, and why.
            <PitStopFigure
              name="main"
              label="Stop"
              value={formatPitSeconds(standing)}
              unit="s"
              approximate={learned}
              tone={
                standing !== null && standing >= settings.longStopThreshold
                  ? 'bad'
                  : 'normal'
              }
              large
            />
          )}
          {loss !== null ? (
            <>
              <PitStopFigure
                name="stop"
                label="Stop"
                value={
                  estimate?.penalty === 'DT' ? 'DT' : formatPitSeconds(standing)
                }
                approximate={learned}
                tone={
                  standing !== null && standing >= settings.longStopThreshold
                    ? 'bad'
                    : 'normal'
                }
              />
              <PitStopFigure
                name="lane"
                label="Lane"
                value={formatPitSeconds(drive)}
                approximate={!driveMeasured}
              />
            </>
          ) : (
            lane && (
              <span
                data-testid="pit-stop-no-lane"
                className="pb-0.5 text-xs leading-tight text-slate-400"
              >
                {lane.driveAtLimitS === null
                  ? 'lane not measured yet'
                  : 'no lap time yet'}
              </span>
            )
          )}
        </div>
      )}

      {chips.length > 0 && (
        <div
          data-testid="pit-stop-chips"
          className="flex flex-none flex-wrap gap-1"
        >
          {chips.map((chip) => (
            <PitStopChip
              key={chip.kind}
              kind={chip.kind}
              seconds={chip.seconds}
              tone={chip.tone}
            />
          ))}
        </div>
      )}

      {refuel && <RefuelLine refuel={refuel} run={settings.showRunLength} />}

      {projection && (ahead || behind || projection.inPits > 0) && (
        <div
          data-testid="pit-stop-rejoin"
          className="flex flex-none items-center gap-3 text-xs"
        >
          {ahead && projection.ahead && (
            <RejoinCarCell
              side="ahead"
              number={ahead.number}
              color={ahead.color}
              gapS={projection.ahead.gapS}
              close={
                projection.positionAfter > projection.positionNow &&
                projection.ahead.gapS < margin
              }
            />
          )}
          {behind && projection.behind && (
            <RejoinCarCell
              side="behind"
              number={behind.number}
              color={behind.color}
              gapS={projection.behind.gapS}
              close={projection.behind.gapS < margin}
            />
          )}
          {projection.inPits > 0 && (
            <span
              data-testid="pit-stop-rejoin-in-pits"
              className="text-slate-400"
            >
              +{projection.inPits} in pits
            </span>
          )}
        </div>
      )}

      {counts && (
        <div
          data-testid="pit-stop-occupancy"
          className="flex-none text-xs text-slate-400"
        >
          Pits {counts.standingInLane}/{counts.inLane}
          {hasRequests && `, requests ${counts.requested}`}
        </div>
      )}
    </div>
  );
};

interface RefuelLineProps {
  refuel: NonNullable<PitStopSnapshot['refuel']>;
  /** Whether to say how far the level set goes. */
  run: boolean;
}

/**
 * What the stop adds, how far the level it fills to goes, and what the race
 * still needs when that level falls short of it.
 */
const RefuelLine = ({ refuel, run }: RefuelLineProps) => {
  const unit = refuel.isVirtualEnergy ? '%' : 'L';
  const FuelIcon = refuel.isVirtualEnergy ? LightningIcon : GasPumpIcon;
  const short =
    refuel.toFinish !== null &&
    refuel.toFinish > 0 &&
    refuel.toFinish > (refuel.toAdd ?? 0);
  const hasRun = run && refuel.runLaps !== null;
  if (refuel.toAdd === null && !hasRun && !short) return null;

  return (
    <div
      data-testid="pit-stop-refuel"
      className="flex flex-none items-center gap-2 text-xs"
    >
      <span className="flex items-center gap-1 font-bold">
        <FuelIcon
          size="1.1em"
          weight="fill"
          className="text-slate-400"
          aria-label={refuel.isVirtualEnergy ? 'Virtual energy' : 'Fuel'}
        />
        {refuel.toAdd === null ? '--' : `+${amount(refuel.toAdd)} ${unit}`}
      </span>
      {hasRun && refuel.runLaps !== null && (
        <span data-testid="pit-stop-run" className="text-slate-300">
          {refuel.runLaps.toFixed(1)} laps
          {refuel.runMinutes !== null &&
            ` / ${Math.round(refuel.runMinutes)} min`}
        </span>
      )}
      {short && refuel.toFinish !== null && (
        <span data-testid="pit-stop-needs" className="text-amber-300">
          needs +{amount(refuel.toFinish)} {unit}
        </span>
      )}
    </div>
  );
};
