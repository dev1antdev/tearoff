import { memo, useId } from 'react';
import { useFitLevel } from '@irdashies/domain/widgetPresentation/useFitLevel';
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

/**
 * How much the legend writes of each line's name. `numbers` leaves out who
 * drives the other cars. `bare` leaves out why they are drawn as well,
 * writes our own number once, before the first of our drivers, and drops
 * the word a key can be read without ("pit stop" for "our pit stop").
 */
export type LegendDetail = 'full' | 'numbers' | 'bare';

export interface LegendLook {
  detail: LegendDetail;
  /** The lines the legend may take. */
  lines: 1 | 2;
}

/**
 * The ways a legend is drawn, the one wanted most first, and never on more
 * than two lines. The last of each is what a legend too long for all of
 * them gets, cut at its second line.
 *
 * In a short panel a second line is taken from the plot, which needs it
 * more: the legend is whole on one line, then has shorter names for as
 * long as that keeps it to one, and only then goes onto two, again with the
 * fullest names that fit. In a panel with height to spare it takes the
 * second line first, and writes less only to stay within two.
 */
export const LEGEND_LOOKS: Readonly<
  Record<'short' | 'roomy', readonly LegendLook[]>
> = {
  short: [
    { detail: 'full', lines: 1 },
    { detail: 'numbers', lines: 1 },
    { detail: 'bare', lines: 1 },
    { detail: 'full', lines: 2 },
    { detail: 'numbers', lines: 2 },
    { detail: 'bare', lines: 2 },
  ],
  roomy: [
    { detail: 'full', lines: 1 },
    { detail: 'full', lines: 2 },
    { detail: 'numbers', lines: 2 },
    { detail: 'bare', lines: 2 },
  ],
};

/** What tells one legend from another, for the room it is fitted to. */
const contentOf = (entries: readonly LegendEntry[]): string =>
  entries
    .map((entry) =>
      entry.kind === 'driver'
        ? `${entry.number} ${entry.name}`
        : entry.kind === 'car'
          ? `${entry.number} ${entry.name} ${entry.role}`
          : `${entry.lead ?? ''} ${entry.text}`
    )
    .join('|');

/** Out of sight and still read out: a legend is cut for the eye only. */
const wordClass = (written: boolean, tone?: string): string | undefined =>
  written ? tone : 'sr-only';

interface ChartLegendProps {
  entries: readonly LegendEntry[];
  /** The panel has the height for a second line of legend. */
  roomy: boolean;
}

/**
 * What each line of a chart is: a driver of ours in their colour, another
 * car with its number and who drives it, and what a band or a mark stands
 * for. The words are plain, and the key beside them carries the colour.
 *
 * It takes one line where it can and never more than two: see
 * `LEGEND_LOOKS`. A word it leaves out is still there for a screen reader.
 */
export const ChartLegend = memo(({ entries, roomy }: ChartLegendProps) => {
  const looks = LEGEND_LOOKS[roomy ? 'roomy' : 'short'];
  const fit = useFitLevel({
    levels: looks.length,
    content: `${roomy ? 'roomy' : 'short'}|${contentOf(entries)}`,
  });
  const { detail, lines } = looks[fit.level];
  const firstDriver = entries.find((entry) => entry.kind === 'driver');

  return (
    // The room around the list is here and not on it: a list cut at its
    // second line would show the top of a third in its own padding.
    <div className="flex-none px-2 pb-1.5 text-xs leading-4 text-slate-300">
      <ul
        ref={fit.target}
        data-testid="race-charts-legend"
        data-detail={detail}
        data-lines={lines}
        // Two lines of four and the half between them make eight and a half.
        className={`flex gap-y-0.5 overflow-hidden ${
          detail === 'bare' ? 'gap-x-3' : 'gap-x-3.5'
        } ${lines === 1 ? 'flex-nowrap' : 'max-h-8.5 flex-wrap'}`}
      >
        {entries.map((entry) => (
          <li
            key={entry.key}
            data-kind={entry.kind}
            className="flex flex-none items-center gap-1.5 whitespace-nowrap"
          >
            {entry.kind === 'driver' ? (
              <>
                <LineKey own colour={entry.colour} line={0} />
                <span>
                  <span
                    className={wordClass(
                      detail !== 'bare' || entry === firstDriver || !entry.name
                    )}
                  >
                    {entry.number}
                  </span>
                  {entry.name && ' '}
                  {entry.name}
                </span>
              </>
            ) : entry.kind === 'car' ? (
              <>
                <LineKey own={false} colour={0} line={entry.line} />
                <span>
                  {entry.number}
                  {entry.name && ' '}
                  <span className={wordClass(detail === 'full')}>
                    {entry.name}
                  </span>
                </span>
                {entry.role && (
                  <span
                    className={wordClass(detail !== 'bare', 'text-slate-500')}
                  >
                    {entry.role}
                  </span>
                )}
              </>
            ) : (
              <>
                <PatchKey kind={entry.kind} />
                <span className="text-slate-400">
                  {entry.lead && (
                    <span className={wordClass(detail !== 'bare')}>
                      {entry.lead}
                    </span>
                  )}
                  {entry.lead && ' '}
                  {entry.text}
                </span>
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
});
ChartLegend.displayName = 'ChartLegend';
