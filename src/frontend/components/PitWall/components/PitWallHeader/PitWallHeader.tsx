import {
  ArrowsClockwiseIcon,
  CornersInIcon,
  CornersOutIcon,
  GearIcon,
} from '@phosphor-icons/react';
import { PIT_WALL_LAYOUT_LIST, type PitWallLayoutId } from '@irdashies/types';
import logo from '../../../../assets/icons/logo.svg';
import type { PitWallHeaderData } from '../../hooks/usePitWallHeader';
import type { FlagTone } from '../../pitWallHeaderFormat';

export interface PitWallHeaderProps {
  data: PitWallHeaderData;
  layout: PitWallLayoutId;
  onLayoutChange: (layout: PitWallLayoutId) => void;
  fullscreen: boolean;
  onToggleFullscreen: () => void;
  /** Opens the Pit Wall's settings. Left out, the strip has no gear. */
  onOpenSettings?: () => void;
  /**
   * The page has lost its connection to the app and is trying to get it
   * back: what it shows is what it last had. Only a page in a browser can
   * be in that state.
   */
  reconnecting?: boolean;
}

const FLAG_TONE_CLASS: Record<FlagTone, string> = {
  green: 'border-green-400 bg-green-900 text-green-200',
  yellow: 'border-yellow-400 bg-yellow-900 text-yellow-100',
  blue: 'border-blue-400 bg-blue-900 text-blue-100',
  red: 'border-red-400 bg-red-900 text-red-100',
  white: 'border-white bg-slate-100 text-slate-950',
  orange: 'border-orange-400 bg-orange-900 text-orange-100',
  neutral: 'border-slate-600 bg-slate-800 text-slate-200',
};

const labelClass =
  'text-[11px] leading-tight font-semibold tracking-[0.08em] text-slate-400 uppercase';

const iconButtonClass =
  'flex size-10 items-center justify-center rounded-md border border-slate-700 bg-slate-800 text-slate-300 transition-colors hover:bg-slate-700 hover:text-white';

/**
 * The strip across the top of the Pit Wall: what is running, how long is
 * left, the flag, where our car is and who is in it, and the page's own
 * controls. Every item is left out or shown as "--" while its source has
 * nothing, so the strip never states a figure nobody measured.
 */
export const PitWallHeader = ({
  data,
  layout,
  onLayoutChange,
  fullscreen,
  onToggleFullscreen,
  onOpenSettings,
  reconnecting = false,
}: PitWallHeaderProps) => {
  const { car } = data;
  // Touch-sized targets on the layout made for a tablet.
  const tall = layout === 'compact';

  return (
    <header
      // Positioned, for the mark that hangs from it while reconnecting.
      className={`settings-shell relative flex shrink-0 flex-wrap items-center gap-y-2 border-b border-slate-700 bg-slate-950 px-4 py-2 text-slate-200 tabular-nums ${
        tall ? 'gap-x-5' : 'gap-x-7'
      }`}
    >
      <div className="flex items-center gap-3">
        <img src={logo} alt="" className="size-7 shrink-0" />
        <span className="text-lg font-semibold tracking-[-0.04em] text-white">
          Tear<span className="text-red-600">off</span>
        </span>
        {/* The small layout has no room for the page's name beside the
            wordmark: the window's title bar carries it. */}
        {!tall && <span aria-hidden="true" className="h-5 w-px bg-slate-700" />}
        <h1
          className={
            tall
              ? 'sr-only'
              : 'text-xs font-bold tracking-[0.1em] text-slate-400 uppercase'
          }
        >
          Pit Wall
        </h1>
      </div>

      {data.simulator && (
        <div
          className="flex items-center gap-2 text-sm text-slate-300"
          title={`${data.simulator} connected`}
        >
          <span
            className="size-2 shrink-0 rounded-full bg-emerald-400"
            aria-hidden="true"
          />
          {/* The small layout keeps the dot and says the rest to a reader. */}
          <span className={tall ? 'sr-only' : undefined}>
            {data.simulator} connected
          </span>
        </div>
      )}

      {data.inSession && (
        <div className="flex min-w-0 flex-col" data-item="session">
          {data.session && (
            <span className={`${labelClass} truncate`}>{data.session}</span>
          )}
          <span className="text-xl leading-tight font-bold text-white">
            {data.timeLeft}{' '}
            <span className="text-xs font-normal text-slate-400">
              left
              {data.timeOfDay && ` · ${data.timeOfDay} in game`}
            </span>
          </span>
        </div>
      )}

      {data.flag && (
        <div
          data-item="flag"
          className={`rounded-md border px-3.5 py-1.5 text-sm font-bold tracking-[0.08em] ${FLAG_TONE_CLASS[data.flag.tone]}`}
        >
          {data.flag.label}
        </div>
      )}

      {car && (
        <div className="flex items-center gap-2.5" data-item="car">
          <div
            className="rounded border-l-4 border-slate-500 bg-slate-800 px-2.5 py-1 text-lg leading-tight font-black text-white"
            style={
              car.classColor
                ? {
                    borderLeftColor: car.classColor,
                    backgroundColor: `color-mix(in srgb, ${car.classColor} 22%, transparent)`,
                  }
                : undefined
            }
          >
            #{car.number}
          </div>
          <div className="flex flex-col">
            <span className="text-base leading-tight font-bold text-white">
              {car.place.position}
              {car.place.field && (
                <span className="font-normal text-slate-400">
                  {' '}
                  {car.place.field}
                </span>
              )}
            </span>
            {car.place.overall && (
              <span className="text-xs text-slate-400">
                {car.place.overall}
              </span>
            )}
          </div>
        </div>
      )}

      {car?.driver && (
        <div className="flex min-w-0 flex-col" data-item="driver">
          <span className={labelClass}>At the wheel</span>
          <span className="truncate text-sm font-bold text-amber-300">
            {car.driver}
          </span>
        </div>
      )}

      {data.watching && (
        <div
          data-item="watching"
          className="rounded-md border border-slate-700 bg-slate-800 px-2.5 py-1 text-sm text-slate-300"
        >
          You are watching
        </div>
      )}

      {/* Pushed to the right of whichever line the strip wraps them onto. */}
      <div className="ml-auto flex items-center gap-x-5">
        {/* Said to a reader from a region that is always there, so that the
            words are heard when they appear. It takes no room in the strip. */}
        <span role="status" className="sr-only">
          {reconnecting ? 'Reconnecting to Tearoff' : ''}
        </span>
        <nav
          aria-label="Layout"
          className="flex overflow-hidden rounded-md border border-slate-700"
        >
          {PIT_WALL_LAYOUT_LIST.map((option) => (
            <button
              key={option.id}
              type="button"
              title={option.description}
              aria-pressed={option.id === layout}
              onClick={() => onLayoutChange(option.id)}
              className={[
                'px-3.5 text-sm transition-colors',
                tall ? 'min-h-11' : 'min-h-10',
                option.id === layout
                  ? 'bg-accent-500 font-bold text-white'
                  : 'bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white',
              ].join(' ')}
            >
              {option.label}
            </button>
          ))}
        </nav>

        <div className="flex gap-1.5">
          <button
            type="button"
            className={`${iconButtonClass} ${tall ? 'size-11' : ''}`}
            title={fullscreen ? 'Leave full screen (F11)' : 'Full screen (F11)'}
            aria-label={fullscreen ? 'Leave full screen' : 'Full screen'}
            aria-pressed={fullscreen}
            onClick={onToggleFullscreen}
          >
            {fullscreen ? (
              <CornersInIcon size={18} />
            ) : (
              <CornersOutIcon size={18} />
            )}
          </button>
          {onOpenSettings && (
            <button
              type="button"
              className={`${iconButtonClass} ${tall ? 'size-11' : ''}`}
              title="Pit Wall settings"
              aria-label="Pit Wall settings"
              onClick={onOpenSettings}
            >
              <GearIcon size={18} />
            </button>
          )}
        </div>
      </div>

      {/* Hung from the strip's lower right corner and not set into it. The
          strip is full on a tablet: a mark that took room in it pushed the
          controls onto a second line and the whole page down with them,
          and back up when the connection returned. Out of the flow it
          moves nothing, at any width, and covers none of the strip. */}
      {reconnecting && (
        <div
          aria-hidden="true"
          data-item="reconnecting"
          className="absolute top-full right-4 z-20 mt-1.5 flex items-center gap-2 rounded-md border border-amber-400/70 bg-amber-950 px-2.5 py-1.5 text-sm font-semibold text-amber-200 shadow-lg shadow-black/50"
          title="This page has lost its connection to Tearoff. It shows what it last had until the connection is back."
        >
          <ArrowsClockwiseIcon
            size={16}
            weight="bold"
            className="animate-spin [animation-duration:2s] motion-reduce:animate-none"
          />
          Reconnecting
        </div>
      )}
    </header>
  );
};
PitWallHeader.displayName = 'PitWallHeader';
