import { memo, useMemo } from 'react';
import {
  useActiveSimulator,
  useCarSystemsSnapshot,
  useDrivingState,
  useSessionVisibility,
  useGeneralSettings,
} from '@irdashies/context';
import {
  CAR_SYSTEM_ADJUSTMENTS,
  carSystemSupportsSim,
  resolveCarSystemDefinition,
  type CarSystemAdjustment,
  type CarSystemDefinition,
} from '@irdashies/types';
import { useCarSystemsSettings } from './hooks/useCarSystemsSettings';
import { useDialChange } from './hooks/useDialChange';
import { useGarageRegenLevel } from './hooks/useGarageRegenLevel';
import { usePlayerCarPath } from './hooks/usePlayerCarPath';

/** Shown for a column the current car does not have. */
const BLANK = '--';

/** The garage's regeneration level, which no telemetry channel carries. */
const REGEN_LEVEL = 'LmuRegenLevel';

const formatValue = (
  adjustment: CarSystemAdjustment,
  definition: CarSystemDefinition
): string => {
  // A mode is read by its name, not by its position on the dial.
  const name = definition.valueLabels?.[adjustment.value];
  if (name !== undefined) return name;
  const value = adjustment.value.toFixed(adjustment.precision);
  return adjustment.unit ? `${value}${adjustment.unit}` : value;
};

/**
 * The brake bias against its pit baseline: signed, to the quarter point Le
 * Mans Ultimate steps the bias in, without a zero that says nothing ("+0.5",
 * "-0.25", "0.0").
 */
const formatDelta = (delta: number): string => {
  const text = Math.abs(delta)
    .toFixed(2)
    .replace(/(\.\d)0$/, '$1');
  if (Number(text) === 0) return text;
  return `${delta > 0 ? '+' : '-'}${text}`;
};

/**
 * What the garage calls the setting, without the note some values carry
 * after it ("9 (Understeer)"). Kept as the sim words it, unit included.
 */
const garageFigure = (text: string): string => text.trim().split(/\s/)[0];

interface SystemColumnProps {
  short: string;
  chip: string;
  /** What the column reads. Absent for a system the car does not have. */
  text?: string;
  /** The top of the dial's scale, drawn small after the value. */
  scale?: string;
  /** Drawn small under the value: the brake bias against its baseline. */
  delta?: string;
  isOff: boolean;
  /** The system is intervening right now. */
  active: boolean;
  /** The driver has just moved this dial. */
  flash: boolean;
  isCompact: boolean;
}

export const SystemColumn = memo(
  ({
    short,
    chip,
    text,
    scale,
    delta,
    isOff,
    active,
    flash,
    isCompact,
  }: SystemColumnProps) => {
    const unsupported = text === undefined;
    // Off and unsupported look alike on purpose - both are "nothing to read
    // here" - and the value below tells them apart: a number the driver set to
    // zero, or a blank for a system the car does not have.
    const subdued = unsupported || isOff;
    // The colour the input bar gives the brake while ABS works.
    const chipColour =
      active && !unsupported
        ? 'bg-yellow-500 text-slate-900'
        : subdued
          ? 'bg-slate-600/60 text-white/60'
          : `${chip} text-white`;
    // Lit at once and let go slowly: the transition is only on the resting
    // state, so it runs on the way back and not on the way in.
    const valueColour = flash
      ? 'bg-amber-400 text-slate-900'
      : `transition-colors duration-300 ${
          subdued ? 'text-white/40' : 'text-white'
        }`;

    // flex-auto rather than flex-1: equal-width columns size to the widest
    // possible content, so a percentage like 53.5% got the same room as a
    // single digit and crowded its neighbours. Sizing from content lets the
    // brake bias column take the width it actually needs.
    return (
      <div className="flex flex-auto min-w-0 flex-col items-center gap-0.5">
        {/* px-1 rather than the Pitlane Helper's px-2: its chips are standalone
            status pills, these are packed side by side, and the wider padding
            truncated a three-letter label once the column count got high. */}
        <div
          className={`w-full text-center text-xs font-bold py-1 px-1 rounded truncate ${chipColour}`}
        >
          {short}
        </div>
        {/* The value carries the glance, so it outweighs its own label - the
            same balance the Pitlane Helper strikes between its big readouts
            and their small captions. */}
        <div
          className={`${isCompact ? 'text-base' : 'text-[1.35em] py-0.5'} px-2 text-center font-semibold tabular-nums whitespace-nowrap leading-none rounded ${valueColour}`}
        >
          {text ?? BLANK}
          {scale !== undefined && (
            <span
              className={`text-xs font-medium ${
                flash ? 'text-slate-900/60' : 'text-white/50'
              }`}
            >
              /{scale}
            </span>
          )}
        </div>
        {delta !== undefined && (
          <div className="text-xs leading-none tabular-nums text-white/60">
            {delta}
          </div>
        )}
      </div>
    );
  }
);
SystemColumn.displayName = 'SystemColumn';

export const CarSystems = () => {
  const settings = useCarSystemsSettings();
  const generalSettings = useGeneralSettings();
  const snapshot = useCarSystemsSnapshot();
  const carPath = usePlayerCarPath();
  const regenLevel = useGarageRegenLevel();
  const isLmu = useActiveSimulator() === 'lmu';
  const { isDriving } = useDrivingState();
  const isSessionVisible = useSessionVisibility(settings?.sessionVisibility);
  const { flashKey, presence } = useDialChange(
    snapshot?.lastChange,
    snapshot !== undefined,
    settings.changeHoldSeconds
  );

  const isCompact =
    generalSettings?.compactMode === 'compact' ||
    generalSettings?.compactMode === 'ultra';

  // One column per telemetry key. No key folds into another: dcPeakBrakeBias
  // used to be folded into brake bias on the theory that the two never
  // coexisted, and the W13 publishes both - a live 52% bias and a migration
  // dial reading 3 - so the fold overwrote the real bias with the migration
  // setting and showed it as a percentage.
  const byColumn = useMemo(() => {
    const map = new Map<string, CarSystemAdjustment>();
    for (const adjustment of snapshot?.adjustments ?? []) {
      map.set(adjustment.key, adjustment);
    }
    return map;
  }, [snapshot?.adjustments]);

  const columns = useMemo(() => {
    // Each sim has a list of its own, and a column is only ever drawn under
    // a sim its catalogue entry is marked for: an iRacing driver gets no
    // blank LMU columns and the reverse. With no sim detected the lists are
    // iRacing's, as they were before there was a second one.
    const simulator = isLmu ? 'lmu' : 'iracing';
    const configured = (isLmu ? settings?.lmuRows : settings?.rows) ?? [];
    return (
      configured
        .map((key) => {
          const catalogue = CAR_SYSTEM_ADJUSTMENTS.find((d) => d.key === key);
          if (!catalogue || !carSystemSupportsSim(catalogue, simulator)) {
            return undefined;
          }
          // Renamed per car where the car wires that channel to a different
          // control. The key is unchanged, so the saved row selection and the
          // snapshot both still match on it.
          //
          // Not under LMU. There CarPath is the car's file name, and the
          // override table is keyed by iRacing's car paths: an LMU dial is
          // what the sim says it is on every car, so its name is the
          // catalogue's and nothing is looked up.
          const definition = resolveCarSystemDefinition(
            catalogue,
            isLmu ? undefined : carPath
          );
          const column = {
            key,
            short: definition.short,
            chip: definition.chip,
            text: undefined as string | undefined,
            scale: undefined as string | undefined,
            delta: undefined as string | undefined,
            isOff: false,
            active: false,
          };
          if (key === REGEN_LEVEL) {
            // The garage's own figure, from the session. Off when it says
            // zero, whatever unit it says it in.
            if (regenLevel === undefined) return column;
            const figure = garageFigure(regenLevel);
            column.text = figure;
            column.isOff = Number.parseFloat(figure) === 0;
            return column;
          }
          const adjustment = byColumn.get(key);
          if (!adjustment) return column;
          column.text = formatValue(adjustment, definition);
          column.isOff = adjustment.isOff;
          column.active =
            settings.highlightActive && adjustment.active === true;
          if (settings.showScale && adjustment.max !== undefined) {
            column.scale = String(adjustment.max);
          }
          if (
            settings.showBrakeBiasDelta &&
            adjustment.baselineDelta !== undefined
          ) {
            column.delta = formatDelta(adjustment.baselineDelta);
          }
          return column;
        })
        .filter(
          (column): column is NonNullable<typeof column> => column !== undefined
        )
        .filter(
          (column) => settings?.showUnsupportedRows || column.text !== undefined
        )
        // A system the driver switched off is hidden separately from one the car
        // never had: the GR86 shows a blank TC2 because it has no second traction
        // control at all, while a GT3 car shows a greyed 0 because the driver
        // turned its traction control off. Someone who wants a strip of live
        // readings only wants both gone, but they are different facts.
        .filter((column) => settings?.showOffRows || !column.isOff)
    );
  }, [
    settings?.rows,
    settings?.lmuRows,
    settings?.showUnsupportedRows,
    settings?.showOffRows,
    settings.highlightActive,
    settings.showScale,
    settings.showBrakeBiasDelta,
    byColumn,
    carPath,
    regenLevel,
    isLmu,
  ]);

  // Session visibility and the on-track rule come first, in either mode.
  if (!isSessionVisible) return <></>;
  if (settings?.showOnlyWhenOnTrack && !isDriving) return <></>;
  if (columns.length === 0) return <></>;

  // Drawn only for a while after a dial moves, and only in the car. The whole
  // strip comes and goes rather than the one column, so the eye finds each
  // dial where it always is.
  const onChange = settings.displayMode === 'onChange';
  if (onChange && (!isDriving || presence === 'hidden')) return <></>;
  const fade = !onChange
    ? ''
    : presence === 'leaving'
      ? 'transition-opacity duration-300 opacity-0'
      : 'transition-opacity duration-150 starting:opacity-0';

  return (
    <div
      className={`w-full overlay-panel text-white font-medium ${isCompact ? 'p-1' : 'p-2'} ${fade}`}
      style={{
        ['--bg-opacity' as string]: `${settings?.background?.opacity ?? 80}%`,
      }}
    >
      <div className={`flex w-full ${isCompact ? 'gap-1' : 'gap-2'}`}>
        {columns.map((column) => (
          <SystemColumn
            key={column.key}
            short={column.short}
            chip={column.chip}
            text={column.text}
            scale={column.scale}
            delta={column.delta}
            isOff={column.isOff}
            active={column.active}
            flash={settings.flashOnChange && flashKey === column.key}
            isCompact={isCompact}
          />
        ))}
      </div>
    </div>
  );
};
