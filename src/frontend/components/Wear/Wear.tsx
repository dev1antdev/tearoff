import { memo } from 'react';
import {
  DiscIcon,
  IconContext,
  TireIcon,
  WarningIcon,
} from '@phosphor-icons/react';
import { OVERLAY_ICONS } from '@irdashies/utils/overlayIcons';
import {
  useDrivingState,
  useSessionVisibility,
  useWearSnapshot,
} from '@irdashies/context';
import type { WearConfig, WearSnapshot } from '@irdashies/types';
import { Compound } from '../shared/Compound/Compound';
import { useWearSettings } from './hooks/useWearSettings';
import {
  NO_READING,
  TONE_CLASS,
  areLapsFew,
  formatFigure,
  formatLaps,
  formatMinutes,
  formatPerLap,
  isBrakeEstimate,
  isTreadEstimate,
  isWearHigh,
  levelTone,
  minutesLeft,
} from './wearDisplay';

/** A line of small figures under a large one. Empty figures are left out. */
const SMALL_LINE =
  'flex flex-wrap items-baseline justify-center gap-x-[0.5em] gap-y-[0.15em] text-[0.75em] leading-none';

interface TyreCellProps {
  /** Tread left in percent, the placeholder, or FLAT. */
  tread: string;
  toneClass: string;
  /** A percent sign follows the figure. */
  hasUnit: boolean;
  /**
   * Wear per lap; empty when it is not shown. Under a flat tyre, the tread
   * it still has.
   */
  perLap: string;
  perLapHigh: boolean;
  laps: string;
  lapsFew: boolean;
  minutes: string;
  /** Tread at the end of the stint; empty when it is not shown. */
  end: string;
  endToneClass: string;
  /** The rate rests on no lap of this tyre: drawn as an estimate. */
  estimate: boolean;
}

/**
 * One tyre: the tread left, and under it how fast it is going and how long
 * that makes.
 *
 * Takes strings rather than the wheel object, so that a snapshot whose
 * rounded figures did not move re-renders nothing.
 */
const TyreCell = memo(
  ({
    tread,
    toneClass,
    hasUnit,
    perLap,
    perLapHigh,
    laps,
    lapsFew,
    minutes,
    end,
    endToneClass,
    estimate,
  }: TyreCellProps) => (
    <div className="flex min-w-0 flex-1 flex-col items-center gap-[0.15em]">
      <div
        data-testid="wear-tread"
        className={`flex items-baseline gap-[0.1em] text-[1.5em] font-bold leading-none ${toneClass}`}
      >
        <span>{tread}</span>
        {hasUnit && (
          <span className="text-[0.5em] font-semibold text-slate-400">%</span>
        )}
      </div>
      {(perLap || laps || minutes) && (
        <div
          data-testid="wear-tread-forecast"
          className={`${SMALL_LINE} ${estimate ? 'italic text-slate-400' : 'text-slate-300'}`}
        >
          {perLap && (
            <span className={perLapHigh ? 'text-amber-400' : ''}>{perLap}</span>
          )}
          {laps && (
            <span className={lapsFew ? 'text-red-400' : ''}>{laps}</span>
          )}
          {minutes && <span>{minutes}</span>}
        </div>
      )}
      {end && (
        <div
          data-testid="wear-tread-end"
          className={`${SMALL_LINE} ${endToneClass} ${estimate ? 'italic' : ''}`}
        >
          <span className="text-[0.85em] font-semibold tracking-wide">END</span>
          <span>{end}</span>
        </div>
      )}
    </div>
  )
);
TyreCell.displayName = 'TyreCell';

interface BrakeCellProps {
  /** Thickness or life, the placeholder, or FAIL. */
  figure: string;
  /** Follows the figure: mm or %. Empty beside a placeholder or FAIL. */
  unit: string;
  toneClass: string;
  /** The one of thickness and life that is not the large figure. */
  other: string;
  perLap: string;
  laps: string;
  lapsFew: boolean;
  minutes: string;
  estimate: boolean;
}

/** One brake disc: how thick it is, and under it how long it will last. */
const BrakeCell = memo(
  ({
    figure,
    unit,
    toneClass,
    other,
    perLap,
    laps,
    lapsFew,
    minutes,
    estimate,
  }: BrakeCellProps) => (
    <div className="flex min-w-0 flex-1 flex-col items-center gap-[0.15em]">
      <div
        data-testid="wear-brake"
        className={`flex items-baseline gap-[0.15em] text-[1.5em] font-bold leading-none ${toneClass}`}
      >
        <span>{figure}</span>
        {unit && (
          <span className="text-[0.5em] font-semibold text-slate-400">
            {unit}
          </span>
        )}
      </div>
      {(other || perLap || laps || minutes) && (
        <div
          data-testid="wear-brake-forecast"
          className={`${SMALL_LINE} text-slate-300`}
        >
          {other && <span>{other}</span>}
          {perLap && (
            <span className={estimate ? 'italic text-slate-400' : ''}>
              {perLap}
            </span>
          )}
          {laps && (
            <span
              className={
                lapsFew
                  ? 'text-red-400'
                  : estimate
                    ? 'italic text-slate-400'
                    : ''
              }
            >
              {laps}
            </span>
          )}
          {minutes && (
            <span className={estimate ? 'italic text-slate-400' : ''}>
              {minutes}
            </span>
          )}
        </div>
      )}
    </div>
  )
);
BrakeCell.displayName = 'BrakeCell';

/** The narrow column between the two wheels of an axle. */
const CENTRE = 'flex w-[1.5em] flex-none items-center justify-center';

interface SectionProps {
  /** The snapshot while there is a car to read; undefined out of it. */
  wear: WearSnapshot | undefined;
  settings: WearConfig;
}

/** Index of each axle's left wheel in LF, RF, LR, RR; the right is next. */
const AXLES = [0, 2] as const;

const TyreSection = ({ wear, settings }: SectionProps) => {
  const { tyres } = settings;

  const cell = (index: number) => {
    const wheel = wear?.wheels[index];
    const perLap =
      tyres.perLapSource === 'thisLap'
        ? (wheel?.treadProjectedPct ?? wheel?.treadPerLapPct)
        : wheel?.treadPerLapPct;
    const laps = wheel?.treadLapsLeft;
    const hasTread = typeof wheel?.treadPct === 'number';
    const flat = wheel?.flat === true;
    const tread = formatFigure(wheel?.treadPct, 1);
    if (flat) {
      // A flat tyre has no forecast: the tread it still has, and that is all.
      return (
        <TyreCell
          tread="FLAT"
          toneClass={TONE_CLASS.bad}
          hasUnit={false}
          perLap={hasTread ? `${tread}%` : ''}
          perLapHigh={false}
          laps=""
          lapsFew={false}
          minutes=""
          end=""
          endToneClass=""
          estimate={false}
        />
      );
    }
    const end = wheel?.treadEndOfStintPct;
    const endTone = levelTone(end, tyres.warnPct);
    return (
      <TyreCell
        tread={tread}
        toneClass={TONE_CLASS[levelTone(wheel?.treadPct, tyres.warnPct)]}
        hasUnit={hasTread}
        // Without a reading there is nothing to forecast; with one, a rate
        // that is not known yet keeps its place as a placeholder.
        perLap={tyres.showPerLap && hasTread ? formatPerLap(perLap, 2) : ''}
        perLapHigh={isWearHigh(perLap, tyres.warnPerLapPct)}
        laps={tyres.showLapsLeft ? formatLaps(laps) : ''}
        lapsFew={areLapsFew(laps, tyres.warnLaps)}
        minutes={
          tyres.showMinutesLeft
            ? formatMinutes(minutesLeft(laps, wear?.paceLapTime))
            : ''
        }
        end={
          tyres.showEndOfStint && typeof end === 'number'
            ? formatFigure(end, 1)
            : ''
        }
        endToneClass={
          endTone === 'plain' ? 'text-slate-400' : TONE_CLASS[endTone]
        }
        estimate={isTreadEstimate(wheel?.treadRateSource ?? null)}
      />
    );
  };

  return (
    <section
      data-testid="wear-tyres"
      className="flex flex-auto flex-col justify-around gap-[0.3em]"
    >
      {AXLES.map((left) => {
        // Both wheels of an axle share a compound; -1 hides the glyph.
        const compound = wear?.wheels[left]?.compound ?? -1;
        return (
          <div key={left} className="flex items-center gap-1">
            {cell(left)}
            <div className={CENTRE}>
              {settings.showCompound && compound >= 0 ? (
                <Compound tireCompound={compound} />
              ) : (
                // Says which half is the tyres where no compound does.
                <TireIcon
                  size="1.25em"
                  className="text-slate-400"
                  aria-hidden="true"
                />
              )}
            </div>
            {cell(left + 1)}
          </div>
        );
      })}
    </section>
  );
};

const BrakeSection = ({ wear, settings }: SectionProps) => {
  const { brakes } = settings;
  const stale = wear?.brakeStale === true;

  const cell = (index: number) => {
    const wheel = wear?.wheels[index];
    const hasDisc = typeof wheel?.brakeMm === 'number';
    const failed = wheel?.brakeFailed === true;
    const hasLife = typeof wheel?.brakeLifePct === 'number';
    const life = hasLife ? `${formatFigure(wheel?.brakeLifePct, 1)}%` : '';
    const thickness = hasDisc ? `${formatFigure(wheel?.brakeMm, 2)} mm` : '';
    // Life as the large figure needs a failure thickness to be a share of:
    // without one the thickness stands in.
    const showLife = brakes.primary === 'life' && hasLife;
    const laps = wheel?.brakeLapsLeft;
    // Left out at the cap, where a GT car's discs always are.
    const lapsText = formatLaps(laps);
    const belowCap = lapsText !== '' && !lapsText.endsWith('+');
    return (
      <BrakeCell
        figure={
          failed
            ? 'FAIL'
            : showLife
              ? formatFigure(wheel?.brakeLifePct, 1)
              : formatFigure(wheel?.brakeMm, 2)
        }
        unit={failed || !hasDisc ? '' : showLife ? '%' : 'mm'}
        toneClass={
          failed
            ? TONE_CLASS.bad
            : TONE_CLASS[levelTone(wheel?.brakeLifePct, brakes.warnLifePct)]
        }
        other={failed || showLife ? thickness : life}
        // A failed brake has no forecast: what it stopped at says it all.
        perLap={
          brakes.showPerLap && hasDisc && !failed
            ? formatPerLap(wheel?.brakePerLapMm, 3)
            : ''
        }
        laps={brakes.showLapsLeft && belowCap && !failed ? lapsText : ''}
        lapsFew={areLapsFew(laps, brakes.warnLaps)}
        minutes={
          brakes.showMinutesLeft && belowCap && !failed
            ? formatMinutes(minutesLeft(laps, wear?.paceLapTime))
            : ''
        }
        estimate={isBrakeEstimate(wheel?.brakeRateSource ?? null)}
      />
    );
  };

  return (
    <section
      data-testid="wear-brakes"
      className="flex flex-auto flex-col justify-around gap-[0.3em]"
    >
      {AXLES.map((left) => (
        <div key={left} className="flex items-center gap-1">
          {cell(left)}
          <div className={CENTRE}>
            <DiscIcon
              size="1.25em"
              className={stale ? 'text-amber-400' : 'text-slate-400'}
              aria-hidden="true"
            />
          </div>
          {cell(left + 1)}
        </div>
      ))}
      {stale && (
        <div
          data-testid="wear-brakes-stale"
          className="flex items-center justify-center gap-[0.4em] text-[0.7em] leading-none text-amber-400"
        >
          <WarningIcon size="1.1em" weight="fill" aria-hidden="true" />
          <span>No answer from the sim</span>
        </div>
      )}
    </section>
  );
};

/**
 * How long the tyres and the brake discs of the player's car will last: the
 * four wheels as the car has them, the front axle above the rear, with the
 * tread left and under it the wear per lap and the laps that makes, and the
 * same for the discs below.
 *
 * Le Mans Ultimate only. Out of the car the sim publishes no wheel data and
 * the widget keeps its shape with placeholders, so it can still be placed in
 * edit mode; while a team-mate drives there is no wheel data either.
 */
export const Wear = () => {
  const settings = useWearSettings();
  const { isDriving } = useDrivingState();
  const isSessionVisible = useSessionVisibility(settings.sessionVisibility);
  const visible =
    isSessionVisible && (!settings.showOnlyWhenOnTrack || isDriving);
  // Only while the widget is drawn, so that the forecast behind it rests
  // otherwise.
  const snapshot = useWearSnapshot(visible);

  if (!visible) return <></>;

  const wear = snapshot?.available ? snapshot : undefined;
  const both = settings.tyres.show && settings.brakes.show;

  return (
    <IconContext.Provider value={OVERLAY_ICONS}>
      <div
        className="flex h-full w-full flex-col gap-[0.3em] overflow-hidden overlay-panel p-2 font-medium tabular-nums text-white"
        style={{
          ['--bg-opacity' as string]: `${settings.background.opacity}%`,
        }}
      >
        {settings.tyres.show && <TyreSection wear={wear} settings={settings} />}
        {both && <div className="flex-none border-t overlay-divider" />}
        {settings.brakes.show && (
          <BrakeSection wear={wear} settings={settings} />
        )}
        {!settings.tyres.show && !settings.brakes.show && (
          <div className="flex flex-1 items-center justify-center text-[0.75em] text-slate-400">
            {NO_READING}
          </div>
        )}
      </div>
    </IconContext.Provider>
  );
};
