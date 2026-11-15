import { memo } from 'react';
import {
  useChannelSelector,
  useDrivingState,
  useSessionVisibility,
} from '@irdashies/context';
import type { GForceSnapshot } from '@irdashies/types';
import { FrictionCircleCanvas } from './FrictionCircleCanvas';
import { useFrictionCircleSettings } from './hooks/useFrictionCircleSettings';
import { NO_READING, formatG } from './frictionCircleGeometry';

/**
 * How often the four figures are read. The dot moves thirty times a second;
 * a number that changed that often could not be read.
 */
const FIGURES_RATE_HZ = 10;
const SEPARATOR = '|';
const NO_FIGURES = [NO_READING, NO_READING, NO_READING, NO_READING].join(
  SEPARATOR
);

/**
 * The four figures as one string, so that a snapshot whose printed values did
 * not move re-renders nothing: lateral, longitudinal, and the maximum of each.
 */
const selectFigures = (snapshot: GForceSnapshot): string =>
  snapshot.available
    ? [
        formatG(snapshot.latG),
        formatG(snapshot.longG),
        formatG(snapshot.maxLatG),
        formatG(snapshot.maxLongG),
      ].join(SEPARATOR)
    : NO_FIGURES;

interface FigureProps {
  label: string;
  value: string;
  /** Which corner of the square it sits in. */
  corner: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
}

const CORNER_CLASS: Record<FigureProps['corner'], string> = {
  'top-left': 'left-0 top-0 items-start',
  'top-right': 'right-0 top-0 items-end',
  'bottom-left': 'bottom-0 left-0 flex-col-reverse items-start',
  'bottom-right': 'bottom-0 right-0 flex-col-reverse items-end',
};

/** One corner: a small label against the edge and the figure inside it. */
const Figure = memo(({ label, value, corner }: FigureProps) => {
  const current = corner.startsWith('top');
  return (
    <div
      className={`pointer-events-none absolute flex flex-col gap-[0.15em] leading-none tabular-nums ${
        current ? 'text-sm font-bold text-white' : 'text-xs text-slate-300'
      } ${CORNER_CLASS[corner]}`}
    >
      <span className="text-[0.6em] font-semibold uppercase text-slate-300">
        {label}
      </span>
      <span>{value}</span>
    </div>
  );
});
Figure.displayName = 'Figure';

/** The current readings in the top corners, their maxima in the bottom ones. */
const Figures = () => {
  const figures =
    useChannelSelector('g-force.snapshot', selectFigures, {
      rateHz: FIGURES_RATE_HZ,
    }) ?? NO_FIGURES;
  const [lat, long, maxLat, maxLong] = figures.split(SEPARATOR);

  return (
    <>
      <Figure label="Lat" value={lat} corner="top-left" />
      <Figure label="Lon" value={long} corner="top-right" />
      <Figure label="Max" value={maxLat} corner="bottom-left" />
      <Figure label="Max" value={maxLong} corner="bottom-right" />
    </>
  );
};

/**
 * The friction circle: lateral g against longitudinal g for the player's car,
 * as a dot with a fading trail, rings at each whole g, a ring at the lateral
 * grip the car has sustained lately, and the maxima of the last five seconds.
 *
 * Both sims. Out of the car the widget keeps its shape, with the dot at rest
 * in the centre and dashes in the corners, so that it can still be placed in
 * edit mode.
 */
export const FrictionCircle = () => {
  const settings = useFrictionCircleSettings();
  const { isDriving } = useDrivingState();
  const isSessionVisible = useSessionVisibility(settings.sessionVisibility);

  if (!isSessionVisible) return <></>;
  // The car's own g: nothing to show for a car that is being watched.
  if (settings.showOnlyWhenOnTrack && !isDriving) return <></>;

  return (
    <div
      className="flex h-full w-full items-center justify-center rounded bg-slate-800/(--bg-opacity) p-2 font-medium text-white [container-type:size]"
      style={{
        ['--bg-opacity' as string]: `${settings.background.opacity}%`,
      }}
    >
      {/* The largest square the box holds: the circle fills it. */}
      <div className="relative h-[100cqmin] w-[100cqmin]">
        <FrictionCircleCanvas
          scaleG={settings.scaleG}
          orientation={settings.orientation}
          showTrace={settings.showTrace}
          traceSeconds={settings.traceSeconds}
          showRings={settings.showRings}
          showSustainedRing={settings.showSustainedRing}
        />
        {settings.showReadings && <Figures />}
      </div>
    </div>
  );
};
