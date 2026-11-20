import {
  memo,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { MountainsIcon } from '@phosphor-icons/react';
import {
  getChannelSnapshotStore,
  trackStateSelectors,
  useDashboard,
  useDrivingState,
  usePaintingPaused,
  useSessionVisibility,
  useTrackProfileSnapshot,
  useTrackStateSelector,
} from '@irdashies/context';
import { heightAtFraction, selectCarLapFraction } from '@irdashies/shared';
import {
  METRES_TO_FEET,
  isMetricDistance,
} from '@irdashies/domain/units/distance';
import type { ElevationConfig, TrackStateSnapshot } from '@irdashies/types';
import {
  DEMO_ELEVATION_M,
  elevationPaths,
  elevationScaleOf,
  elevationY,
  formatHeight,
} from './elevationPath';
import { useElevationSettings } from './hooks/useElevationSettings';

/** How often the mark is moved: track-state's own rate. */
const POSITION_RATE_HZ = 25;
const NO_READING = '--.-';
const NO_ELEVATION: readonly number[] = [];
const NO_SECTORS: readonly number[] = [];

interface ElevationProfileProps {
  elevationM: readonly number[];
  sectorStartPct: readonly number[];
  /** 0..1 while the lap that will become the profile is driven; else null. */
  recordingProgress: number | null;
  showProgress: boolean;
  showSectors: boolean;
  showReading: boolean;
  showRange: boolean;
  zero: ElevationConfig['zero'];
  metric: boolean;
  /** Follow the car the camera is on rather than the player's own. */
  followFocusCar: boolean;
  backgroundOpacity: number;
}

/**
 * The profile, drawn once for each profile and size, with the car's mark,
 * the tint of the lap driven and the reading moved outside React: the car
 * moves twenty-five times a second, and none of that is a render.
 */
const ElevationProfile = memo(
  ({
    elevationM,
    sectorStartPct,
    recordingProgress,
    showProgress,
    showSectors,
    showReading,
    showRange,
    zero,
    metric,
    followFocusCar,
    backgroundOpacity,
  }: ElevationProfileProps) => {
    const clipId = useId();
    const paused = usePaintingPaused();
    const boxRef = useRef<HTMLDivElement>(null);
    const clipRef = useRef<SVGRectElement>(null);
    const markRef = useRef<SVGLineElement>(null);
    const dotRef = useRef<SVGCircleElement>(null);
    const readingRef = useRef<HTMLSpanElement>(null);
    const [size, setSize] = useState({ width: 0, height: 0 });

    // The drawing is in the box's own pixels, so it follows the box.
    useLayoutEffect(() => {
      const box = boxRef.current;
      if (!box) return;
      const measure = (width: number, height: number) =>
        setSize((previous) =>
          previous.width === width && previous.height === height
            ? previous
            : { width, height }
        );
      measure(box.clientWidth, box.clientHeight);
      if (typeof ResizeObserver === 'undefined') return;
      const observer = new ResizeObserver(([entry]) =>
        measure(entry.contentRect.width, entry.contentRect.height)
      );
      observer.observe(box);
      return () => observer.disconnect();
    }, []);

    const hasProfile = elevationM.length > 0;
    const scale = useMemo(() => elevationScaleOf(elevationM), [elevationM]);
    const paths = useMemo(
      () => elevationPaths(elevationM, size.width, size.height),
      [elevationM, size.width, size.height]
    );

    /** Where the car was last seen, as a lap fraction. */
    const fraction = useRef(0);
    const pausedRef = useRef(paused);
    pausedRef.current = paused;

    /** Moves the mark, the tint and the reading to where the car is. */
    const place = useRef<() => void>(() => undefined);
    place.current = () => {
      const { width, height } = size;
      const x = fraction.current * width;
      const heightM = heightAtFraction(elevationM, fraction.current);
      const y =
        heightM === null ? height / 2 : elevationY(heightM, scale, height);

      clipRef.current?.setAttribute('width', x.toFixed(1));
      markRef.current?.setAttribute('x1', x.toFixed(1));
      markRef.current?.setAttribute('x2', x.toFixed(1));
      dotRef.current?.setAttribute('cx', x.toFixed(1));
      dotRef.current?.setAttribute('cy', y.toFixed(1));
      if (readingRef.current) {
        const text =
          heightM === null
            ? NO_READING
            : formatHeight(
                heightM - (zero === 'line' ? elevationM[0] : scale.lowest),
                metric,
                zero === 'line'
              );
        if (readingRef.current.textContent !== text) {
          readingRef.current.textContent = text;
        }
      }
    };

    // After every render: a new profile, size or unit moves all three, and
    // so does the overlay coming back from being hidden.
    useLayoutEffect(() => {
      if (!paused) place.current();
    });

    // The car's place, straight from the channel. The write happens inside
    // the channel's own callback, which the perf overlay already times.
    useEffect(() => {
      const bridge = window.channelBridge;
      if (!bridge) return;
      const store = getChannelSnapshotStore('track-state.snapshot', bridge);
      const selection = store.createSelection(
        (snapshot: TrackStateSnapshot) =>
          selectCarLapFraction(snapshot, followFocusCar),
        Object.is,
        POSITION_RATE_HZ
      );
      const take = () => {
        const next = selection.getSnapshot();
        if (next === undefined) return;
        fraction.current = next;
        // Hidden, nothing is drawn; the render that follows repaints.
        if (!pausedRef.current) place.current();
      };
      const unsubscribe = selection.subscribe(take);
      // The store may already hold a snapshot from another reader.
      take();
      return unsubscribe;
    }, [followFocusCar]);

    const { width, height } = size;
    const range = metric ? scale.range : scale.range * METRES_TO_FEET;
    const unit = metric ? 'm' : 'ft';

    return (
      <div
        ref={boxRef}
        className="relative h-full w-full overflow-hidden overlay-panel text-white"
        style={{ ['--bg-opacity' as string]: `${backgroundOpacity}%` }}
      >
        {width > 0 && height > 0 && (
          <svg
            className="absolute inset-0 h-full w-full"
            data-testid="elevation-profile"
            viewBox={`0 0 ${width} ${height}`}
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <defs>
              <clipPath id={clipId}>
                <rect ref={clipRef} x={0} y={0} width={0} height={height} />
              </clipPath>
            </defs>

            <path d={paths.area} className="fill-slate-600/50" />
            {showProgress && hasProfile && (
              <path
                d={paths.area}
                className="fill-slate-300/20"
                clipPath={`url(#${clipId})`}
              />
            )}
            <path
              d={paths.line}
              className="fill-none stroke-slate-300"
              strokeWidth={1.5}
              strokeLinejoin="round"
            />
            {showProgress && hasProfile && (
              <path
                d={paths.line}
                className="fill-none stroke-white"
                strokeWidth={1.5}
                strokeLinejoin="round"
                clipPath={`url(#${clipId})`}
              />
            )}

            {showSectors &&
              hasProfile &&
              sectorStartPct
                // The first sector starts at the line, which is drawn below.
                .filter((start) => start > 0 && start < 1)
                .map((start) => (
                  <line
                    key={start}
                    data-testid="elevation-sector"
                    x1={start * width}
                    x2={start * width}
                    y1={0}
                    y2={height}
                    className="stroke-slate-500"
                    strokeWidth={1}
                    strokeDasharray="3 3"
                  />
                ))}

            {/* Both ends are the start/finish line. */}
            <line
              x1={1}
              x2={1}
              y1={0}
              y2={height}
              className="stroke-white/60"
              strokeWidth={2}
            />
            <line
              x1={width - 1}
              x2={width - 1}
              y1={0}
              y2={height}
              className="stroke-white/60"
              strokeWidth={2}
            />

            {hasProfile && (
              <g className="text-amber-300">
                <line
                  ref={markRef}
                  data-testid="elevation-mark"
                  x1={0}
                  x2={0}
                  y1={0}
                  y2={height}
                  stroke="currentColor"
                  strokeWidth={2}
                />
                <circle
                  ref={dotRef}
                  data-testid="elevation-dot"
                  cx={0}
                  cy={height / 2}
                  r={3}
                  fill="currentColor"
                  className="stroke-slate-900"
                  strokeWidth={1}
                />
              </g>
            )}
          </svg>
        )}

        {showReading && (
          // No shadow: the reading changes every frame.
          <div className="absolute left-2 top-1 flex items-baseline gap-1 text-sm font-bold leading-tight tabular-nums">
            <MountainsIcon
              size={12}
              weight="light"
              className="flex-none self-center text-slate-400"
            />
            <span ref={readingRef} data-testid="elevation-reading">
              {NO_READING}
            </span>
            <span className="text-xs font-normal text-slate-400">{unit}</span>
          </div>
        )}
        {showRange && hasProfile && (
          <div
            data-testid="elevation-range"
            className="absolute right-2 top-1 text-xs leading-tight tabular-nums text-slate-400 [text-shadow:0_1px_2px_rgb(15_23_42)]"
          >
            {Math.round(range)} {unit}
          </div>
        )}

        {!hasProfile && (
          <div className="absolute inset-x-2 bottom-1.5 truncate text-center text-xs text-slate-400">
            Drive one clean lap to record the profile
          </div>
        )}
        {recordingProgress !== null && (
          <div
            className="absolute inset-x-0 bottom-0 h-0.5 bg-slate-900/70"
            role="progressbar"
            aria-label="Recording the elevation profile"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(recordingProgress * 100)}
          >
            <div
              className="h-full bg-slate-300"
              style={{ width: `${recordingProgress * 100}%` }}
            />
          </div>
        )}
      </div>
    );
  }
);
ElevationProfile.displayName = 'ElevationProfile';

/**
 * The height of the track along the lap as a filled profile, with the car's
 * place on it, the part of the lap already driven, the sector starts where
 * they are known and the height where the car is.
 *
 * The profile comes from one clean lap driven on the track and is kept for
 * it; until there is one the widget says so, and shows how far round the lap
 * that is recording it the car has got. The height is read off the profile
 * at the car's position, so the reading and the mark always agree.
 *
 * About the track, not about one car: while a car is being watched the mark
 * is that car's.
 */
export const Elevation = () => {
  const settings = useElevationSettings();
  const { isDemoMode } = useDashboard();
  const { isDriving, isWatching } = useDrivingState();
  const isSessionVisible = useSessionVisibility(settings.sessionVisibility);
  const visible =
    isSessionVisible &&
    !(settings.showOnlyWhenOnTrack && !(isDriving || isWatching));

  const profile = useTrackProfileSnapshot(visible);
  const displayUnits = useTrackStateSelector(trackStateSelectors.displayUnits, {
    enabled: visible,
  });

  if (!visible) return <></>;

  const recorded = profile?.elevationM ?? NO_ELEVATION;
  // The demo is of the widget, and has no track to have driven a lap of.
  const elevationM =
    recorded.length === 0 && isDemoMode ? DEMO_ELEVATION_M : recorded;
  // Nominal starts are a placeholder, not places on the track: Le Mans
  // Ultimate's session carries even thirds until the car has been seen
  // crossing into each sector. A line drawn for one would be a guess shown
  // as a fact, so none is drawn until the starts are real.
  const sectorStartPct =
    profile && profile.sectorSource !== 'nominal'
      ? profile.sectorStartPct
      : NO_SECTORS;

  return (
    <ElevationProfile
      elevationM={elevationM}
      sectorStartPct={sectorStartPct}
      recordingProgress={profile?.recordingProgress ?? null}
      showProgress={settings.showProgress}
      showSectors={settings.showSectors}
      showReading={settings.showReading}
      showRange={settings.showRange}
      zero={settings.zero}
      metric={isMetricDistance(settings.unit, displayUnits)}
      followFocusCar={isWatching && !isDriving}
      backgroundOpacity={settings.background.opacity}
    />
  );
};
