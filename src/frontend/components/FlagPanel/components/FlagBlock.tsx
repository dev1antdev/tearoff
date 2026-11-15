import { memo } from 'react';
import { TrafficSignalIcon } from '@phosphor-icons/react';
import type { FlagKind } from '@irdashies/types';
import { flagColor } from '@irdashies/domain/flags';

/** The fill of the block for each flag. */
const BLOCK_FILL: Record<FlagKind, string> = {
  none: 'bg-gray-400',
  green: 'bg-green-500',
  yellow: 'bg-yellow-400',
  fullCourseYellow: 'bg-yellow-400',
  // Yellow and red stripes: the slippery-surface flag.
  debris:
    'bg-[repeating-linear-gradient(90deg,var(--color-yellow-400)_0_12.5%,var(--color-red-500)_12.5%_25%)]',
  blue: 'bg-blue-500',
  white: 'bg-white',
  // Eight squares by six, white and slate.
  chequered:
    'bg-[repeating-conic-gradient(#fff_0_25%,var(--color-slate-800)_0_50%)] bg-size-[25%_33.34%]',
  red: 'bg-red-500',
  penalty: 'border border-slate-400 bg-black',
  meatball: 'bg-black',
  disqualified: 'bg-black',
  start: 'bg-slate-700',
};

export interface FlagBlockProps {
  kind: FlagKind;
  /** The car number under a blue with a car to name; empty otherwise. */
  plate: string;
  /** DT, SG or +10 under a penalty the sim has named; empty otherwise. */
  badge: string;
  /** Red lights lit, and in the sequence; 0 of 0 outside the countdown. */
  lit: number;
  lights: number;
  glow: boolean;
  /** `steady` keeps pulsing; `once` pulses a single time when mounted. */
  pulse: 'none' | 'steady' | 'once';
}

/**
 * The colour block: the flag itself, at 4:3. Under a blue with a car to name
 * it doubles as that car's number plate.
 *
 * Takes strings and numbers so a snapshot that changed only a distance
 * re-renders nothing here.
 */
export const FlagBlock = memo(
  ({ kind, plate, badge, lit, lights, glow, pulse }: FlagBlockProps) => (
    <div
      data-testid="flag-block"
      data-flag={kind}
      className={[
        'relative flex aspect-[4/3] h-full flex-none items-center justify-center overflow-hidden rounded-md',
        BLOCK_FILL[kind],
        pulse === 'steady' ? 'animate-pulse motion-reduce:animate-none' : '',
        pulse === 'once'
          ? 'animate-[pulse_0.5s_ease-in-out_1] motion-reduce:animate-none'
          : '',
      ].join(' ')}
      style={
        // The start block is a dark tile and no flag is no flag: neither has
        // anything to glow.
        glow && kind !== 'start' && kind !== 'none'
          ? { boxShadow: `0 0 16px ${flagColor(kind)}` }
          : undefined
      }
    >
      {kind === 'blue' && plate && (
        <span
          data-testid="flag-plate"
          className={`font-extrabold leading-none tabular-nums text-blue-950 ${
            plate.length > 2 ? 'text-[1.9em]' : 'text-[2.6em]'
          }`}
        >
          {plate}
        </span>
      )}
      {kind === 'fullCourseYellow' && (
        <span className="text-[1.7em] font-extrabold leading-none tracking-wide text-black">
          FCY
        </span>
      )}
      {kind === 'penalty' && badge && (
        <span className="text-[1.9em] font-extrabold leading-none tabular-nums text-white">
          {badge}
        </span>
      )}
      {kind === 'meatball' && (
        <span className="aspect-square h-[62%] rounded-full bg-orange-500" />
      )}
      {kind === 'disqualified' && (
        <>
          <span className="absolute h-[13%] w-[130%] rotate-[36.87deg] bg-white" />
          <span className="absolute h-[13%] w-[130%] -rotate-[36.87deg] bg-white" />
        </>
      )}
      {kind === 'start' &&
        (lights > 0 ? (
          <span
            data-testid="flag-lights"
            className="flex w-full items-center justify-center gap-[5%] px-[8%]"
          >
            {Array.from({ length: lights }, (_, index) => (
              <span
                key={index}
                data-lit={index < lit}
                className={`aspect-square min-w-0 flex-1 rounded-full ${
                  index < lit
                    ? 'bg-red-500 shadow-[0_0_6px_var(--color-red-500)]'
                    : 'bg-slate-900'
                }`}
              />
            ))}
          </span>
        ) : (
          <TrafficSignalIcon
            size="2.6em"
            weight="fill"
            className="text-slate-400"
            aria-hidden="true"
          />
        ))}
    </div>
  )
);
FlagBlock.displayName = 'FlagBlock';
