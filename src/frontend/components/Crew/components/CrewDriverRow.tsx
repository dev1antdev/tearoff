import { memo } from 'react';
import {
  driverFillClass,
  driverTextClass,
  driverTintClass,
} from '../../shared/DriverColour/driverColours';

/** The columns of the drivers' table, shared by its captions and its rows. */
export const CREW_DRIVER_GRID =
  'grid grid-cols-[minmax(6rem,1fr)_3rem_3.5rem_4.5rem_4.75rem] items-center gap-x-2 px-3';

/** How what a driver still owes, or has left, is written. */
export type DriveTimeTone = 'owed' | 'over' | 'quiet';

const TONE_CLASS: Record<DriveTimeTone, string> = {
  owed: 'text-amber-300',
  over: 'text-red-400',
  quiet: 'text-slate-400',
};

export interface CrewDriverRowProps {
  name: string;
  /** Their colour: see `driverColour`. */
  colour: number;
  /** At the wheel now. */
  driving: boolean;
  stints: number;
  drive: string;
  avg: string;
  best: string;
  /**
   * Share of the maximum drive time driven, 0..1. Left out, no bar is
   * drawn: the limits are switched off.
   */
  fill?: number;
  /** Where the minimum is along the bar, 0..1; null with no minimum. */
  minAt?: number | null;
  /** What the driver still owes, or has left: "needs 1:30". */
  status?: string;
  statusTone?: DriveTimeTone;
}

/**
 * One driver of the car. Every prop is a string, a number or a flag, so a
 * row whose figures have not moved is not drawn again when the record is.
 */
export const CrewDriverRow = memo(
  ({
    name,
    colour,
    driving,
    stints,
    drive,
    avg,
    best,
    fill,
    minAt = null,
    status = '',
    statusTone = 'quiet',
  }: CrewDriverRowProps) => (
    <div
      data-testid="crew-driver"
      data-driving={driving}
      className={`py-1 ${driving ? driverTintClass(colour) : ''}`}
    >
      <div className={CREW_DRIVER_GRID}>
        <span
          data-testid="crew-driver-name"
          className={`truncate font-bold ${driverTextClass(colour)}`}
        >
          {name}
        </span>
        <span className="text-right">{stints}</span>
        <span data-testid="crew-driver-time" className="text-right">
          {drive}
        </span>
        <span className="text-right">{avg}</span>
        <span className="text-right">{best}</span>
      </div>
      {fill !== undefined && (
        <div className="mt-1 flex items-center gap-x-2 px-3">
          <div
            data-testid="crew-driver-bar"
            className="relative h-2 min-w-0 flex-1 rounded-full bg-slate-600/60"
          >
            <div
              className={`h-full rounded-full ${
                statusTone === 'over' ? 'bg-red-400' : driverFillClass(colour)
              }`}
              style={{ width: `${fill * 100}%` }}
            />
            {minAt !== null && (
              <div
                data-testid="crew-driver-minimum"
                className="absolute -top-0.5 -bottom-0.5 w-0.5 bg-slate-100"
                style={{ left: `${minAt * 100}%` }}
              />
            )}
          </div>
          <span
            data-testid="crew-driver-status"
            data-tone={statusTone}
            className={`w-32 flex-none text-right text-[0.6875rem] leading-none ${TONE_CLASS[statusTone]}`}
          >
            {status}
          </span>
        </div>
      )}
    </div>
  )
);
CrewDriverRow.displayName = 'CrewDriverRow';

/** The captions over the drivers. */
export const CrewDriverCaptions = memo(() => (
  <div
    className={`${CREW_DRIVER_GRID} py-1.5 text-[0.6875rem] leading-none font-medium tracking-wide text-slate-400 uppercase`}
  >
    <span>Driver</span>
    <span className="text-right">Stints</span>
    <span className="text-right">Drive</span>
    <span className="text-right">Avg</span>
    <span className="text-right">Best</span>
  </div>
));
CrewDriverCaptions.displayName = 'CrewDriverCaptions';
