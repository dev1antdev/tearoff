import type { Ref } from 'react';
import {
  ArrowsClockwiseIcon,
  CornersInIcon,
  CornersOutIcon,
  EyeIcon,
  GearIcon,
  PencilSimpleIcon,
} from '@phosphor-icons/react';
import { useFitLevel } from '@irdashies/domain/widgetPresentation/useFitLevel';
import {
  PIT_WALL_LAYOUT_CHOICE_LIST,
  type PitWallLayoutChoice,
} from '@irdashies/types';
import logo from '../../../../assets/icons/logo.svg';
import type { PitWallHeaderData } from '../../hooks/usePitWallHeader';
import type { FlagTone } from '../../pitWallHeaderFormat';

export interface PitWallHeaderProps {
  data: PitWallHeaderData;
  layout: PitWallLayoutChoice;
  /** Chooses a layout. Left out, the strip offers no choice of one. */
  onLayoutChange?: (layout: PitWallLayoutChoice) => void;
  /**
   * Begins arranging the layout shown. Left out, the strip has no such
   * button: it is there only for the layout the user arranges, and only
   * where the page may be arranged.
   */
  onEditLayout?: () => void;
  /** The Edit layout button, for the page to hand the keyboard back to. */
  editLayoutRef?: Ref<HTMLButtonElement>;
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
  /**
   * Hangs that mark from the positioned element around the strip instead of
   * from the strip. The page does, with its tab bar inside the same
   * element, so that the mark is under the bar and on none of the tabs.
   */
  markHangsOutside?: boolean;
  /**
   * The page is as narrow as a phone: the strip is two short rows, the
   * clock and the flag over our car, its place and who drives it, with
   * none of the words around them.
   */
  phone?: boolean;
}

/**
 * What the strip gives up, a step at a time and in this order, to keep to
 * one line in a window too narrow for all of it. Before any of these the
 * session's name is cut short, down to the width of the clock under it,
 * which the page's own layout does. What is left out is kept for a screen
 * reader.
 */
export const PIT_WALL_HEADER_SQUEEZE = {
  /** Less room between its items. */
  gaps: 1,
  /** The dot alone for "Le Mans Ultimate connected". */
  simulator: 2,
  /** No "Pit Wall" beside the wordmark: the window's title carries it. */
  title: 3,
  /** An eye for "You are watching". */
  watching: 4,
  /** Still less room between its items, and in the layout switch. */
  tightGaps: 5,
  /** No "At the wheel" over the driver's name, which may be cut short. */
  driver: 6,
} as const;

const SQUEEZE_STEPS = 7;

/**
 * The narrowest strip that is held to one line, by its own width in CSS
 * pixels: on the layouts made for a monitor, and on the one for a tablet,
 * which has less to hold. A narrower one wraps.
 */
export const ONE_LINE_FROM_PX = { wide: 1280, tall: 1100 } as const;

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
 *
 * From 1280 pixels wide (1100 on the layout made for a tablet) it is one
 * line whatever it holds: see `PIT_WALL_HEADER_SQUEEZE`. In the last resort
 * what is between the wordmark and the controls is cut at its end, and the
 * controls stay. A narrower window wraps it, and a phone has it in two
 * rows.
 */
export const PitWallHeader = ({
  data,
  layout,
  onLayoutChange,
  onEditLayout,
  editLayoutRef,
  fullscreen,
  onToggleFullscreen,
  onOpenSettings,
  reconnecting = false,
  markHangsOutside = false,
  phone = false,
}: PitWallHeaderProps) => {
  const { car } = data;
  // Touch-sized targets on the layout made for a tablet.
  const tall = layout === 'compact';
  const simulatorText = reconnecting
    ? `${data.simulator}, as last heard`
    : `${data.simulator} connected`;

  // How far the strip is squeezed to keep to its line: found on the page,
  // from the strip's own width, for everything it has to write.
  const fit = useFitLevel({
    levels: phone ? 1 : SQUEEZE_STEPS,
    content: [
      layout,
      data.simulator,
      data.session,
      // The clock's figures are all one width: only their number counts.
      data.timeLeft.length,
      data.timeOfDay?.length,
      data.flag?.label,
      car?.number,
      car?.place.position,
      car?.place.field,
      car?.place.overall,
      car?.driver,
      data.watching,
      Boolean(onLayoutChange),
      Boolean(onEditLayout),
      Boolean(onOpenSettings),
    ].join('|'),
  });
  const squeezed = (step: number) => fit.level >= step;
  // One line from the width a monitor has, and wrapped under it. Asked of
  // the strip's own width and not of the window's: a page drawn at 125 %
  // has a strip a fifth narrower than its window.
  const oneLine =
    !phone &&
    fit.width >= (tall ? ONE_LINE_FROM_PX.tall : ONE_LINE_FROM_PX.wide);
  // A phone has no room for a word that is not a figure.
  const bare = {
    simulator: tall || phone || squeezed(PIT_WALL_HEADER_SQUEEZE.simulator),
    title: tall || phone || squeezed(PIT_WALL_HEADER_SQUEEZE.title),
    watching: phone || squeezed(PIT_WALL_HEADER_SQUEEZE.watching),
  };
  const gap =
    phone || squeezed(PIT_WALL_HEADER_SQUEEZE.tightGaps)
      ? 'gap-x-3'
      : squeezed(PIT_WALL_HEADER_SQUEEZE.gaps)
        ? tall
          ? 'gap-x-4'
          : 'gap-x-5'
        : tall
          ? 'gap-x-5'
          : 'gap-x-7';
  const driverBare = phone || squeezed(PIT_WALL_HEADER_SQUEEZE.driver);

  return (
    <header
      ref={fit.frame}
      data-squeeze={fit.level}
      // Positioned, for the mark that hangs from it while reconnecting,
      // unless the mark is to hang from what is around it.
      className={`settings-shell flex shrink-0 items-center border-b border-slate-700 bg-slate-950 text-slate-200 tabular-nums ${
        markHangsOutside ? '' : 'relative'
      } ${gap} ${oneLine ? 'flex-nowrap' : 'flex-wrap'} ${
        phone ? 'px-3 py-1.5' : 'gap-y-2 px-4 py-2'
      }`}
    >
      <div className="flex shrink-0 items-center gap-3">
        <img src={logo} alt="" className="size-7 shrink-0" />
        <span
          className={
            phone
              ? 'sr-only'
              : 'text-lg font-semibold tracking-[-0.04em] text-white'
          }
        >
          Tear<span className="text-red-600">off</span>
        </span>
        {/* The small layout has no room for the page's name beside the
            wordmark: the window's title bar carries it. */}
        {!bare.title && (
          <span aria-hidden="true" className="h-5 w-px bg-slate-700" />
        )}
        <h1
          className={
            bare.title
              ? 'sr-only'
              : 'text-xs font-bold tracking-[0.1em] text-slate-400 uppercase'
          }
        >
          Pit Wall
        </h1>
      </div>

      {/* What the strip is about, between the wordmark and the controls.
          On one line it is a box of its own, which is what is cut at its
          end when nothing else gives; wrapped, it is no box at all, and
          its items wrap among the strip's as they always did. */}
      <div
        ref={fit.target}
        className={
          oneLine
            ? `flex min-w-0 flex-1 items-center overflow-hidden ${gap}`
            : 'contents'
        }
      >
        {data.simulator && (
          <div
            data-item="simulator"
            // The simulator's connection is to the app, and the page's is to
            // the app as well. While the page has lost the app it cannot say
            // the simulator is connected: that is the last it heard, and
            // "connected" beside "Reconnecting" read as two answers to one
            // question. The item is dimmed and says what it is.
            className={`flex shrink-0 items-center gap-2 text-sm whitespace-nowrap ${
              reconnecting ? 'text-slate-500' : 'text-slate-300'
            }`}
            title={simulatorText}
          >
            <span
              className={`size-2 shrink-0 rounded-full ${
                reconnecting ? 'bg-slate-600' : 'bg-emerald-400'
              }`}
              aria-hidden="true"
            />
            {/* Short of room the strip keeps the dot and says the rest to
                a reader. */}
            <span className={bare.simulator ? 'sr-only' : undefined}>
              {simulatorText}
            </span>
          </div>
        )}

        {data.inSession && (
          <div
            // The first to give way on one line, and no narrower than the
            // clock: the name over it is all of it that can be cut. On the
            // small layout it is as wide as the clock to begin with.
            className={`flex flex-col ${
              phone ? 'min-w-0 flex-1' : tall ? 'shrink-0' : 'shrink-[1000]'
            }`}
            data-item="session"
          >
            {data.session && (
              // On the small layout a long track name is cut at the width
              // of the clock under it, so the strip keeps to its line. On
              // the others it is whole while there is room, and cut where
              // the strip would otherwise wrap: a name that may break
              // anywhere and is held to one line is as narrow as it has
              // to be, and ends in an ellipsis.
              <span
                className={`${labelClass} ${
                  phone
                    ? 'sr-only'
                    : tall
                      ? 'w-0 min-w-full truncate'
                      : 'line-clamp-1 break-all'
                }`}
                title={data.session}
              >
                {data.session}
              </span>
            )}
            <span
              className={`text-xl leading-tight font-bold text-white ${
                phone
                  ? 'flex min-w-0 items-baseline gap-x-1'
                  : 'whitespace-nowrap'
              }`}
            >
              {data.timeLeft}{' '}
              <span
                className={`text-xs font-normal text-slate-400 ${
                  // On a phone the words after the figures are there whole
                  // or not at all: a row of one line that may wrap, with
                  // nothing before them on it, so that words too long for
                  // what the flag leaves go onto a second line, out of
                  // sight.
                  phone
                    ? 'flex h-4 min-w-0 flex-1 flex-wrap overflow-hidden leading-4 whitespace-nowrap'
                    : ''
                }`}
              >
                {phone && <span aria-hidden="true">&nbsp;</span>}
                <span>
                  left
                  {data.timeOfDay && ` · ${data.timeOfDay} in game`}
                </span>
              </span>
            </span>
          </div>
        )}

        {data.flag && (
          <div
            data-item="flag"
            className={`shrink-0 rounded-md border px-3.5 py-1.5 text-sm font-bold tracking-[0.08em] whitespace-nowrap ${FLAG_TONE_CLASS[data.flag.tone]}`}
          >
            {data.flag.label}
          </div>
        )}

        {/* A phone's second row begins here. */}
        {phone && <span aria-hidden="true" className="h-1.5 basis-full" />}

        {car && (
          <div
            className="flex shrink-0 items-center gap-2.5 whitespace-nowrap"
            data-item="car"
          >
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
          <div
            // Whole until everything before it has given way; on a phone it
            // has what its row leaves.
            className={`flex min-w-0 flex-col ${
              phone ? 'flex-1' : driverBare ? '' : 'shrink-0'
            }`}
            data-item="driver"
          >
            <span
              className={
                driverBare ? 'sr-only' : `${labelClass} whitespace-nowrap`
              }
            >
              At the wheel
            </span>
            <span
              className="truncate text-sm font-bold text-amber-300"
              // Whole for whoever points at a name that has been cut.
              title={car.driver}
            >
              {car.driver}
            </span>
          </div>
        )}

        {data.watching && (
          <div
            data-item="watching"
            title={bare.watching ? 'You are watching' : undefined}
            className="flex shrink-0 items-center rounded-md border border-slate-700 bg-slate-800 px-2.5 py-1 text-sm whitespace-nowrap text-slate-300"
          >
            {bare.watching && <EyeIcon size={18} aria-hidden="true" />}
            <span className={bare.watching ? 'sr-only' : undefined}>
              You are watching
            </span>
          </div>
        )}
      </div>

      {/* Pushed to the right of whichever line the strip wraps them onto. */}
      <div className="ml-auto flex shrink-0 items-center gap-x-5">
        {/* Said to a reader from a region that is always there, so that the
            words are heard when they appear. It takes no room in the strip. */}
        <span role="status" className="sr-only">
          {reconnecting ? 'Reconnecting to Tearoff' : ''}
        </span>
        <nav
          aria-label="Layout"
          hidden={!onLayoutChange}
          className="flex overflow-hidden rounded-md border border-slate-700"
        >
          {PIT_WALL_LAYOUT_CHOICE_LIST.map((option) => (
            <button
              key={option.id}
              type="button"
              title={option.description}
              aria-pressed={option.id === layout}
              onClick={() => onLayoutChange?.(option.id)}
              className={[
                'text-sm transition-colors',
                squeezed(PIT_WALL_HEADER_SQUEEZE.tightGaps)
                  ? 'px-2.5'
                  : 'px-3.5',
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
          {onEditLayout && (
            // First of the page's own buttons, next to the switch whose
            // layout it arranges.
            <button
              ref={editLayoutRef}
              type="button"
              className={`flex items-center gap-2 rounded-md border border-slate-700 bg-slate-800 px-[10px] text-sm text-slate-300 transition-colors hover:bg-slate-700 hover:text-white ${
                tall ? 'min-h-11' : 'min-h-10'
              }`}
              title="Edit layout: move, size, add and remove the panels"
              onClick={onEditLayout}
            >
              <PencilSimpleIcon size={18} />
              {/* In a window narrower than a monitor the words would take
                  the controls onto a second line, and the page down by one:
                  there the pencil stands alone, as square as the buttons
                  beside it, with the words left for a reader and for the
                  tooltip. Asked of the window and not of the strip: a strip
                  made a container to be asked would, in the browsers that
                  hold a container to its layout, become what the
                  Reconnecting mark hangs from, and the mark belongs under
                  the tab bar. */}
              <span className="max-[1800px]:sr-only">Edit layout</span>
            </button>
          )}
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
