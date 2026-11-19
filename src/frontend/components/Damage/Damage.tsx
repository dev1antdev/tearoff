import { memo } from 'react';
import { IconContext, WrenchIcon } from '@phosphor-icons/react';
import { OVERLAY_ICONS } from '@irdashies/utils/overlayIcons';
import {
  useDamageSnapshot,
  useDrivingState,
  useSessionVisibility,
} from '@irdashies/context';
import {
  damageStats,
  diagramReading,
  hasDamageToShow,
  repairRow,
  wheelState,
  type IntegrityTone,
} from '@irdashies/domain/damage/damageDisplay';
import { CarDiagram } from './components/CarDiagram';
import { useDamageSettings } from './hooks/useDamageSettings';

const DEGREES_PER_RADIAN = 180 / Math.PI;

/** White until a figure reaches its warning. */
const TONE_CLASS: Record<IntegrityTone, string> = {
  none: 'text-slate-500',
  normal: 'text-white',
  warn: 'text-red-400',
};

interface StatProps {
  name: string;
  label: string;
  value: string;
  tone: IntegrityTone;
}

/** One figure beside the car: what it is, and how much of it is left. */
const Stat = memo(({ name, label, value, tone }: StatProps) => (
  <>
    <dt className="overlay-label leading-none">{label}</dt>
    <dd
      data-testid={`damage-stat-${name}`}
      data-tone={tone}
      className={`text-right text-sm font-semibold leading-none tabular-nums ${TONE_CLASS[tone]}`}
    >
      {value}
    </dd>
  </>
));
Stat.displayName = 'Stat';

/**
 * The player's car from above: where the body is dented, what has come off
 * or gone flat, where it was last hit, how much of it is left in four
 * figures, and what the next stop spends on repairs.
 *
 * Le Mans Ultimate only. It describes the car the user drives, so out of the
 * car the sim publishes nothing and the widget keeps its shape with
 * placeholders, to be placed in edit mode.
 */
export const Damage = () => {
  const settings = useDamageSettings();
  const snapshot = useDamageSnapshot();
  const { isDriving } = useDrivingState();
  const isSessionVisible = useSessionVisibility(settings.sessionVisibility);

  if (!isSessionVisible) return <></>;
  if (settings.showOnlyWhenOnTrack && !isDriving) return <></>;
  if (settings.hideWhenUndamaged && !hasDamageToShow(snapshot, settings)) {
    return <></>;
  }

  const car = snapshot?.available ? snapshot : undefined;
  const reading = diagramReading(snapshot, settings.diagram, settings.stats);
  const repair = settings.repair.enabled ? repairRow(snapshot) : null;
  const overheating = settings.overheating.enabled && car?.overheating === true;
  const impact =
    settings.impact.enabled && typeof car?.impactBearingRad === 'number'
      ? Math.round(car.impactBearingRad * DEGREES_PER_RADIAN)
      : null;

  return (
    <IconContext.Provider value={OVERLAY_ICONS}>
      <div
        data-testid="damage"
        className="flex h-full w-full flex-col gap-1.5 overflow-hidden overlay-panel p-2 leading-none text-white"
        style={{
          ['--bg-opacity' as string]: `${settings.background.opacity}%`,
        }}
      >
        <div className="flex min-h-0 flex-1 items-stretch justify-center gap-3">
          {settings.diagram.enabled && (
            <div className="h-full flex-none">
              <CarDiagram
                available={car !== undefined}
                zones={car ? car.body.join('') : ''}
                leftFront={wheelState(car?.wheels[0])}
                rightFront={wheelState(car?.wheels[1])}
                leftRear={wheelState(car?.wheels[2])}
                rightRear={wheelState(car?.wheels[3])}
                impactDegrees={impact}
                readingValue={reading ? reading.value : null}
                readingLabel={reading ? reading.label : ''}
                readingTone={reading ? reading.tone : 'none'}
                overheating={overheating}
                flash={settings.flashDetached}
              />
            </div>
          )}

          {settings.stats.enabled && (
            <dl className="grid min-w-0 flex-1 grid-cols-[auto_1fr] content-center items-baseline gap-x-3 gap-y-1.5 px-2 py-1">
              {damageStats(snapshot, settings.stats).map((stat) => (
                <Stat
                  key={stat.key}
                  name={stat.key}
                  label={stat.label}
                  value={stat.value}
                  tone={stat.tone}
                />
              ))}
            </dl>
          )}
        </div>

        {repair && (
          <div
            data-testid="damage-repair"
            className="@container flex flex-none items-center gap-1.5 px-2 py-1 shadow-[inset_0_1px_0_rgb(255_255_255/0.05)]"
          >
            <WrenchIcon
              size={14}
              className="flex-none text-slate-400"
              aria-hidden
            />
            {/* The sim's choices all say "Repair" themselves, so in a narrow
              window the word gives way to them; the wrench still says it. */}
            <span className="hidden text-xs leading-none text-slate-400 @[10rem]:inline">
              Repair
            </span>
            {repair.time && (
              <span
                data-testid="damage-repair-time"
                className="text-sm font-semibold leading-none tabular-nums text-amber-400"
              >
                {repair.time}
              </span>
            )}
            {repair.choice && (
              <span
                data-testid="damage-repair-choice"
                className="min-w-0 flex-1 truncate text-right text-xs leading-4 text-slate-400"
              >
                {repair.choice}
              </span>
            )}
          </div>
        )}
      </div>
    </IconContext.Provider>
  );
};
