import { memo } from 'react';
import { CaretDoubleUpIcon, ProhibitIcon } from '@phosphor-icons/react';
import {
  trackStateSelectors,
  useActiveSimulator,
  useCurrentSessionType,
  useDrivingState,
  useFlagStateSnapshot,
  useSessionDrivers,
  useSessionVisibility,
  useTrackStateSelector,
  useWeekendInfoNumCarClasses,
} from '@irdashies/context';
import { useHighlightColor } from '@irdashies/domain/standings/useHighlightColor';
import {
  flagColor,
  flagExplanation,
  flagTitle,
  formatFlagDistance,
  resolveFlagState,
} from '@irdashies/domain/flags';
import {
  EMPTY_FLAG_STATE,
  lmuPenaltyBadgeText,
  lmuPenaltyKindFromCode,
  type FlagDetail,
} from '@irdashies/types';
import { resolveDistanceUnit } from '@irdashies/utils/units';
import { ClassLabel } from '../shared/ClassLabel/ClassLabel';
import { DriverName, extractDriverName } from '../shared/DriverName/DriverName';
import { FlagBlock } from './components/FlagBlock';
import { flagPanelTint } from './flagPanelTint';
import { useFlagPanelSettings } from './hooks/useFlagPanelSettings';

/** A blue closer than this is urgent, as Faster Cars From Behind draws it. */
const URGENT_DISTANCE_M = 50;
/** A car this much quicker than the player is marked as closing, m/s. */
const CLOSING_MS = 2;
/** A yellow whose incident is this close pulses. */
const PULSE_INCIDENT_M = 200;
const NO_READING = '--';

/** Explanations that already say the pit lane is closed. */
const SAYS_PIT_CLOSED: ReadonlySet<FlagDetail> = new Set([
  'beforeSession',
  'fcyPitsClosed',
]);

interface FlagPairProps {
  /** The small line: a class label or a caption; empty for a dash. */
  caption: string;
  /** `class` draws the caption as the standings' class label. */
  captionStyle: 'class' | 'incident' | 'none';
  classColor: number | undefined;
  highlightColor: number;
  isMultiClass: boolean;
  /** Further cars queued behind the one named. */
  othersCount: number;
  /** The large line: a distance with its unit; empty for a dash. */
  distance: string;
  urgent: boolean;
  closing: boolean;
}

/**
 * The right-hand pair: the class of the car a blue is for over the metres it
 * is behind, or the word INCIDENT over the metres to it under a yellow.
 */
const FlagPair = memo(
  ({
    caption,
    captionStyle,
    classColor,
    highlightColor,
    isMultiClass,
    othersCount,
    distance,
    urgent,
    closing,
  }: FlagPairProps) => {
    const [value, unit] = distance.split(' ');
    return (
      <div
        data-testid="flag-pair"
        className="flex flex-none flex-col items-end justify-center gap-1.5 tabular-nums"
      >
        <div className="flex h-[1.5em] items-center gap-1 text-xs leading-none">
          {othersCount > 0 && (
            <span
              data-testid="flag-queue"
              className="rounded bg-white/15 px-1 py-0.5 font-bold"
            >
              +{othersCount}
            </span>
          )}
          {captionStyle === 'class' && caption && (
            <ClassLabel
              name={caption}
              color={classColor}
              highlightColor={highlightColor}
              isMultiClass={isMultiClass}
              // The shadow keeps white readable on the lighter class colours.
              className="rounded-sm px-1.5 py-0.5 [text-shadow:0_1px_2px_rgb(0_0_0/0.7)]"
            />
          )}
          {captionStyle === 'incident' && (
            <span className="font-bold tracking-wide text-yellow-300">
              {caption}
            </span>
          )}
          {captionStyle === 'none' && (
            <span className="text-slate-500">{NO_READING}</span>
          )}
        </div>
        <div
          data-testid="flag-distance"
          className={`flex items-center gap-1 text-2xl font-bold leading-none ${
            distance ? (urgent ? 'text-red-300' : '') : 'text-slate-500'
          }`}
        >
          {closing && (
            <CaretDoubleUpIcon
              data-testid="flag-closing"
              size="0.7em"
              weight="bold"
              aria-label="Closing"
            />
          )}
          {distance ? (
            <span>
              {value}
              <span className="text-[0.6em] font-semibold"> {unit}</span>
            </span>
          ) : (
            NO_READING
          )}
        </div>
      </div>
    );
  }
);
FlagPair.displayName = 'FlagPair';

/**
 * A wide card that names the flag that applies to the player now and explains
 * it in one line.
 *
 * Under a blue flag it is the plate of the car coming to lap the player: its
 * number in the colour block, the driver or team under the title, its class
 * and the metres it is behind on the right, and a count of further cars
 * queued behind it. The card takes a tint in the states that need attention.
 *
 * Everything comes resolved from `flag-state.snapshot`; the number, name and
 * class of the car are looked up in the session by its slot.
 */
export const FlagPanel = () => {
  const settings = useFlagPanelSettings();
  const snapshot = useFlagStateSnapshot() ?? EMPTY_FLAG_STATE;
  const { isDriving } = useDrivingState();
  const isSessionVisible = useSessionVisibility(settings.sessionVisibility);
  const displayUnits = useTrackStateSelector(trackStateSelectors.displayUnits);
  const isRace = useCurrentSessionType() === 'Race';
  const drivers = useSessionDrivers();
  const isMultiClass = (useWeekendInfoNumCarClasses() ?? 0) > 1;
  const highlightColor = useHighlightColor();
  const isIRacing = useActiveSimulator() === 'iracing';

  if (!isSessionVisible) return <></>;
  if (settings.showOnlyWhenOnTrack && !isDriving) return <></>;

  const { kind, detail } = resolveFlagState(snapshot, {
    showStart: settings.showStartLights,
    showPenalty: settings.showPenalty,
    showLastLap: settings.showLastLap,
    showBlue: !settings.blue.raceOnly || isRace,
    showYellow: !settings.yellow.raceOnly || isRace,
  });

  const isClear =
    kind === 'none' || (kind === 'green' && detail === 'trackClear');
  if (isClear && settings.whenClear === 'hide') return <></>;

  const unit = resolveDistanceUnit(settings.distanceUnit, displayUnits);
  const blue = kind === 'blue' ? snapshot.blue : null;
  const blueDriver = blue
    ? drivers?.find((driver) => driver.CarIdx === blue.carIdx)
    : undefined;

  // Under a blue with a car the second line is who it is, not what to do.
  let name = '';
  if (blue && blueDriver) {
    const driverName = DriverName(
      extractDriverName(blueDriver.UserName),
      settings.driverNameFormat
    );
    name =
      settings.blueName === 'team'
        ? String(blueDriver.TeamName ?? '').trim() || driverName
        : driverName;
  }
  const explanation = flagExplanation(detail, snapshot, {
    distanceUnit: unit,
    nameSector: settings.yellow.nameSector,
  });
  const showPitClosed = snapshot.pitLaneClosed && !SAYS_PIT_CLOSED.has(detail);

  const incident =
    kind === 'yellow' &&
    (detail === 'yellowAhead' || detail === 'yellowBehind') &&
    snapshot.incidentDistM !== null
      ? snapshot.incidentDistM
      : null;

  const penaltyKind =
    kind === 'penalty' && snapshot.penalty
      ? lmuPenaltyKindFromCode(snapshot.penalty.kind)
      : undefined;
  const lights = kind === 'start' ? snapshot.startLights : null;

  const tint = flagPanelTint(kind, detail, settings.tintCard);
  const opacity = settings.background.opacity;
  const pulse = !settings.animate
    ? 'none'
    : incident !== null && Math.abs(incident) <= PULSE_INCIDENT_M
      ? 'steady'
      : blue
        ? 'once'
        : 'none';

  return (
    <div
      data-testid="flag-panel"
      data-flag={kind}
      data-detail={detail}
      className="relative isolate flex h-full w-full items-center gap-3 rounded bg-slate-800/(--bg-opacity) p-2 font-medium text-white"
      style={{
        ['--bg-opacity' as string]: `${opacity}%`,
        ['--tint-opacity' as string]: `${(tint?.opacity ?? 0) * opacity}%`,
      }}
    >
      {tint && (
        <div
          data-testid="flag-tint"
          aria-hidden="true"
          className={`absolute inset-0 -z-10 rounded ring-1 ring-inset ${tint.background} ${tint.ring}`}
        />
      )}
      {tint && settings.enableGlow && (
        // Inside the card: the overlay clips each widget to its own box, so a
        // glow around the card would never be seen.
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 -z-10 rounded"
          style={{
            boxShadow: `inset 0 0 20px color-mix(in srgb, ${flagColor(kind)} 35%, transparent)`,
          }}
        />
      )}

      <FlagBlock
        // A new car on the plate is a new block, which is what makes it
        // pulse once as the blue is handed from one car to the next.
        key={blue ? blue.carIdx : kind}
        kind={kind}
        plate={blue && blueDriver ? String(blueDriver.CarNumber ?? '') : ''}
        badge={
          lmuPenaltyBadgeText(
            penaltyKind,
            snapshot.penalty?.seconds ?? undefined
          ) ?? ''
        }
        lit={lights?.lit ?? 0}
        lights={detail === 'lights' ? (lights?.total ?? 0) : 0}
        glow={settings.enableGlow}
        pulse={pulse}
      />

      <div className="flex min-w-0 flex-1 flex-col justify-center gap-1.5">
        <div
          data-testid="flag-title"
          className="truncate text-xl font-extrabold uppercase leading-none tracking-wide"
        >
          {flagTitle(kind, detail, { caution: isIRacing })}
        </div>
        {name ? (
          <div
            data-testid="flag-name"
            className={`truncate text-sm leading-tight ${
              blue?.confirmed ? 'text-slate-200' : 'text-slate-400'
            }`}
            title={name}
          >
            {name}
          </div>
        ) : (
          (settings.showExplanation || kind === 'blue') &&
          (explanation || showPitClosed) && (
            <div
              // A shade lighter on a tinted card, where slate-400 sinks in.
              className={`flex min-w-0 items-center gap-2 text-sm leading-tight ${
                tint ? 'text-slate-300' : 'text-slate-400'
              }`}
            >
              {explanation && (
                <span data-testid="flag-explanation" className="truncate">
                  {explanation}
                </span>
              )}
              {showPitClosed && (
                <span
                  data-testid="flag-pit-closed"
                  className="flex flex-none items-center gap-0.5 rounded bg-red-500/20 px-1 py-0.5 text-xs font-bold uppercase leading-none text-red-300"
                >
                  <ProhibitIcon weight="bold" aria-hidden="true" />
                  Pit closed
                </span>
              )}
            </div>
          )
        )}
      </div>

      {blue && blueDriver ? (
        <FlagPair
          caption={String(blueDriver.CarClassShortName ?? '')}
          captionStyle="class"
          classColor={blueDriver.CarClassColor}
          highlightColor={highlightColor}
          isMultiClass={isMultiClass}
          othersCount={blue.othersCount}
          distance={formatFlagDistance(blue.distanceM, unit)}
          urgent={blue.distanceM < URGENT_DISTANCE_M}
          closing={blue.closingMs !== null && blue.closingMs >= CLOSING_MS}
        />
      ) : incident !== null ? (
        <FlagPair
          caption="INCIDENT"
          captionStyle="incident"
          classColor={undefined}
          highlightColor={highlightColor}
          isMultiClass={isMultiClass}
          othersCount={0}
          distance={formatFlagDistance(incident, unit)}
          urgent={false}
          closing={false}
        />
      ) : (
        settings.bluePair === 'dashes' && (
          <FlagPair
            caption=""
            captionStyle="none"
            classColor={undefined}
            highlightColor={highlightColor}
            isMultiClass={isMultiClass}
            othersCount={0}
            distance=""
            urgent={false}
            closing={false}
          />
        )
      )}
    </div>
  );
};
