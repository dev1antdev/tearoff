import { memo, useId } from 'react';
import { driverStrokeClass } from '../../shared/DriverColour/driverColours';
import { OWN_LINE_PX, RIVAL_LINE_PX, rivalLook } from '../chartLook';
import type { LegendEntry } from '../chartModel';

interface LineKeyProps {
  /** A line of our own car, in a driver's colour. */
  own: boolean;
  /** The driver's colour: see `driverColour`. */
  colour: number;
  /** Which of the three other lines, for a car that is not ours. */
  line: number;
}

/** A short stretch of a car's line, as it is drawn on the chart. */
export const LineKey = memo(({ own, colour, line }: LineKeyProps) => {
  const look = rivalLook(line);
  return (
    <svg width={16} height={8} aria-hidden className="flex-none">
      <line
        x1={1.5}
        x2={14.5}
        y1={4}
        y2={4}
        strokeLinecap="round"
        strokeWidth={own ? OWN_LINE_PX : RIVAL_LINE_PX}
        strokeDasharray={own ? undefined : look.dash}
        className={own ? driverStrokeClass(colour) : look.stroke}
      />
    </svg>
  );
});
LineKey.displayName = 'LineKey';

/** A patch of a band, or a mark, as the chart draws it. */
const PatchKey = ({ kind }: { kind: 'stop' | 'missing' | 'mark' }) => {
  const hatch = useId();
  if (kind === 'mark') {
    return (
      <svg width={10} height={8} aria-hidden className="flex-none">
        <path d="M1.5 7L8.5 7L5 1Z" className="fill-slate-300" />
      </svg>
    );
  }
  return (
    <svg width={10} height={10} aria-hidden className="flex-none">
      {kind === 'missing' && (
        <defs>
          <pattern
            id={hatch}
            width={6}
            height={6}
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <line
              x1={0}
              y1={0}
              x2={0}
              y2={6}
              className="stroke-slate-500/60"
              strokeWidth={2}
            />
          </pattern>
        </defs>
      )}
      <rect
        width={10}
        height={10}
        fill={kind === 'missing' ? `url(#${hatch})` : undefined}
        className={kind === 'stop' ? 'fill-slate-500/40' : undefined}
      />
    </svg>
  );
};

interface ChartLegendProps {
  entries: readonly LegendEntry[];
}

/**
 * What each line of a chart is: a driver of ours in their colour, another
 * car with its number and who drives it, and what a band or a mark stands
 * for. The words are plain, and the key beside them carries the colour.
 */
export const ChartLegend = memo(({ entries }: ChartLegendProps) => (
  <ul
    data-testid="race-charts-legend"
    className="flex flex-none flex-wrap gap-x-3.5 gap-y-0.5 px-2 pb-1.5 text-[11px] leading-4 text-slate-300"
  >
    {entries.map((entry) => (
      <li
        key={entry.key}
        data-kind={entry.kind}
        className="flex items-center gap-1.5 whitespace-nowrap"
      >
        {entry.kind === 'driver' ? (
          <LineKey own colour={entry.colour} line={0} />
        ) : entry.kind === 'car' ? (
          <LineKey own={false} colour={0} line={entry.line} />
        ) : (
          <PatchKey kind={entry.kind} />
        )}
        <span
          className={
            entry.kind === 'driver' || entry.kind === 'car'
              ? undefined
              : 'text-slate-400'
          }
        >
          {entry.text}
        </span>
        {entry.kind === 'car' && entry.role && (
          <span className="text-slate-500">{entry.role}</span>
        )}
      </li>
    ))}
  </ul>
));
ChartLegend.displayName = 'ChartLegend';
