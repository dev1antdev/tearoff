import { memo, useMemo } from 'react';
import { MinusCircleIcon, WrenchIcon } from '@phosphor-icons/react';
import {
  useDrivingState,
  useSessionVisibility,
  useWeekendInfoNumCarClasses,
} from '@irdashies/context';
import {
  limitClassFields,
  useClassFields,
} from '@irdashies/domain/standings/classFields';
import { useHighlightColor } from '@irdashies/domain/standings/useHighlightColor';
import { ClassLabel } from '../shared/ClassLabel/ClassLabel';
import { useClassFieldsSettings } from './hooks/useClassFieldsSettings';

interface ClassFieldChipProps {
  name: string;
  color: number;
  highlightColor: number;
  isMultiClass: boolean;
  /** Cars entered in the class. */
  total: number;
  /** Cars still running. */
  active: number;
  /** Running cars in the pit lane or stopped at their box. */
  inPitLane: number;
  /** Outlined: the class of the focus car. */
  outlined: boolean;
  showTotal: boolean;
  showInactive: boolean;
  showInPitLane: boolean;
  /**
   * In a column the chips share one grid, so every class label is as wide as
   * the widest and the counts line up under each other.
   */
  inColumn: boolean;
}

/**
 * One class of the field: its name on the class colour, as the standings'
 * class header draws it, and the cars still running of the cars entered.
 */
const ClassFieldChip = memo(
  ({
    name,
    color,
    highlightColor,
    isMultiClass,
    total,
    active,
    inPitLane,
    outlined,
    showTotal,
    showInactive,
    showInPitLane,
    inColumn,
  }: ClassFieldChipProps) => {
    const inactive = total - active;
    return (
      <div
        data-testid="class-field"
        data-class={name}
        data-focus={outlined ? 'true' : undefined}
        className={[
          'min-w-0 overflow-hidden rounded-sm',
          inColumn
            ? 'col-span-2 grid grid-cols-subgrid'
            : 'flex flex-auto items-stretch',
          outlined ? 'ring-1 ring-white/60' : '',
        ].join(' ')}
      >
        <ClassLabel
          name={name}
          color={color}
          highlightColor={highlightColor}
          isMultiClass={isMultiClass}
          // The shadow keeps white readable on the lighter class colours.
          className="flex shrink-0 items-center px-2 text-sm [text-shadow:1px_1px_1px_rgb(0_0_0/0.2)]"
        />
        <div className="flex min-w-0 flex-auto items-center gap-1.5 bg-slate-900/70 px-2 py-0.5 leading-none whitespace-nowrap tabular-nums">
          <span className="flex items-baseline">
            <span
              data-testid="class-field-active"
              className="min-w-[2ch] text-right text-base font-semibold"
            >
              {active}
            </span>
            {showTotal && (
              <span
                data-testid="class-field-total"
                className="text-xs text-white/60"
              >
                /{total}
              </span>
            )}
          </span>
          {showInactive && inactive > 0 && (
            <span
              data-testid="class-field-inactive"
              className="flex items-center gap-0.5 text-xs text-amber-300"
            >
              <MinusCircleIcon
                aria-label="Out of the running"
                size={12}
                weight="fill"
              />
              {inactive}
            </span>
          )}
          {showInPitLane && inPitLane > 0 && (
            <span
              data-testid="class-field-pit"
              className="flex items-center gap-0.5 text-xs text-white/60"
            >
              <WrenchIcon aria-label="In the pit lane" size={12} />
              {inPitLane}
            </span>
          )}
        </div>
      </div>
    );
  }
);
ClassFieldChip.displayName = 'ClassFieldChip';

/**
 * The field at a glance: one chip per class with the cars still running and
 * the cars entered, the classes ordered by the overall place of their
 * leaders, so the strip reads as a legend of the race.
 *
 * It is about the focus car: the player's own, or the car being watched
 * while a team-mate drives, whose class is the one outlined.
 *
 * Everything comes from `standings.snapshot` and the session's driver list
 * through `useClassFields`; the widget keeps nothing of its own.
 */
export const ClassFields = () => {
  const settings = useClassFieldsSettings();
  const { isDriving, isWatching } = useDrivingState();
  const isSessionVisible = useSessionVisibility(settings.sessionVisibility);
  const isMultiClass = (useWeekendInfoNumCarClasses() ?? 0) > 1;
  const highlightColor = useHighlightColor();

  // On track is driving, or watching a car that is out of its garage: the
  // summary is the focus car's, which is then the car being watched.
  const isShown =
    isSessionVisible &&
    (!settings.showOnlyWhenOnTrack || isDriving || isWatching);

  const fields = useClassFields(settings.order, isShown);
  const shown = useMemo(
    () => limitClassFields(fields, settings.maxClasses),
    [fields, settings.maxClasses]
  );

  if (!isShown) return <></>;
  // No session, or a session with no drivers yet: nothing to count.
  if (shown.length === 0) return <></>;

  const inColumn = settings.orientation === 'vertical';
  // One class has nothing to be told apart from.
  const outlineFocus = settings.highlightOwnClass && shown.length > 1;

  return (
    <div
      data-testid="class-fields"
      className={[
        'w-full rounded-sm bg-slate-800/(--bg-opacity) p-2 text-white',
        inColumn
          ? 'grid grid-cols-[max-content_minmax(0,1fr)] gap-y-1'
          : 'flex h-full gap-2',
      ].join(' ')}
      style={{
        ['--bg-opacity' as string]: `${settings.background.opacity}%`,
      }}
    >
      {shown.map((field) => (
        <ClassFieldChip
          key={field.classId}
          name={field.name}
          color={field.color}
          highlightColor={highlightColor}
          isMultiClass={isMultiClass}
          total={field.total}
          active={field.active}
          inPitLane={field.inPitLane}
          outlined={outlineFocus && field.isFocusClass}
          showTotal={settings.showTotal}
          showInactive={settings.showInactive}
          showInPitLane={settings.showInPitLane}
          inColumn={inColumn}
        />
      ))}
    </div>
  );
};
