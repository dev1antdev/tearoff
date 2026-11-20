import { useWidgetScale } from '@irdashies/domain/widgetPresentation/WidgetScale';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Driver } from '@irdashies/types';
import {
  useTrackDrawing,
  type LapSpan,
  type TrackDrawing,
} from '@irdashies/domain/track';
export type { TrackDrawing } from '@irdashies/domain/track';
import { getColor } from '@irdashies/utils/colors';
import { useCanvasTheme } from '@irdashies/domain/widgetPresentation/canvasTheme';
import { validateImageDataUrl } from '@irdashies/utils/imageDataUrl';
import { shouldShowTrack } from '@irdashies/domain/track/tracks/brokenTracks';
import { TrackDebug } from './TrackDebug';
import { useStartFinishLine } from './hooks/useStartFinishLine';
import {
  setupCanvasContext,
  drawTrack,
  drawStartFinishLine,
  drawTurnNames,
  drawDrivers,
  drawSectorColors,
  drawSectorDividers,
  drawLapSpans,
  compareDriverDrawOrder,
  mapInk,
  markerColors,
  type PositionedTrackDriver,
} from './trackDrawingUtils';
import {
  progressToTrackPoint,
  useProgressAnimation,
} from '@irdashies/domain/track/useProgressAnimation';

const EMPTY_PIT_STATE: readonly boolean[] = [];
import type { SectorColor } from '@irdashies/context';
import type { Sector } from '@irdashies/types';
import {
  useTrackStateSnapshot,
  useCarIdxOffTrack,
  usePaintingPaused,
} from '@irdashies/context';

export interface DriverIdentity {
  driver: Driver;
  isPlayer: boolean;
  classPosition?: number;
}

export interface TrackProps {
  trackId: number;
  /**
   * The drawing, from a caller that already holds it: a session that carries
   * its own outline. Left out, the one shipped for `trackId` is loaded.
   */
  trackDrawing?: TrackDrawing | null;
  drivers: TrackDriver[];
  driverIdentities?: DriverIdentity[];
  turnLabels?: {
    enabled: boolean;
    labelType: 'names' | 'numbers' | 'both';
    highContrast: boolean;
    labelFontSize: number;
  };
  showCarNumbers?: boolean;
  displayMode?: 'carNumber' | 'sessionPosition' | 'livePosition';
  invertTrackColors?: boolean;
  driverCircleSize?: number;
  playerCircleSize?: number;
  trackmapFontSize?: number;
  trackLineWidth?: number;
  trackOutlineWidth?: number;
  highlightColor?: number;
  invertLeaderColor?: boolean;
  debug?: boolean;
  isMinimalTrack?: boolean;
  isMinimalCar?: boolean;
  sectors?: Sector[];
  sectorColors?: SectorColor[];
  currentSectorIdx?: number;
  /**
   * Stretches of the lap under a yellow flag, as lap fractions. Drawn over
   * the road at its full width, whatever `sectors` is set to.
   */
  yellowSpans?: readonly LapSpan[];
  playerIconDataUrl?: string | null;
  driverLivePositions?: Record<number, number>;
  /** Caps redraws, e.g. for a map docked in the Gantry. */
  maxFps?: number;
}

export interface TrackDriver {
  driver: Driver;
  progress: number;
  isPlayer: boolean;
  classPosition?: number;
}

export interface TurnLabels {
  enabled: boolean;
  labelType: 'names' | 'numbers' | 'both';
  highContrast: boolean;
  labelFontSize: number;
}

const TRACK_DRAWING_WIDTH = 1920;
const TRACK_DRAWING_HEIGHT = 1080;
const DEFAULT_TURN_LABELS: TurnLabels = {
  enabled: false,
  labelType: 'both',
  highContrast: true,
  labelFontSize: 100,
};

/** Mount canvas effects only once the requested drawing is available. */
export const TrackCanvas = (props: TrackProps) => {
  // Nothing is loaded for a caller that brought its own.
  const loaded = useTrackDrawing(
    props.trackDrawing ? undefined : props.trackId
  );
  const drawing = props.trackDrawing ?? loaded;
  return drawing ? (
    <LoadedTrackCanvas key={props.trackId} {...props} trackDrawing={drawing} />
  ) : null;
};

const LoadedTrackCanvas = ({
  trackId,
  drivers,
  driverIdentities,
  turnLabels = DEFAULT_TURN_LABELS,
  showCarNumbers = true,
  displayMode = 'carNumber',
  invertTrackColors = false,
  driverCircleSize = 40,
  playerCircleSize = 40,
  trackmapFontSize = 100,
  trackLineWidth = 20,
  trackOutlineWidth = 40,
  highlightColor,
  invertLeaderColor = false,
  debug,
  isMinimalTrack = false,
  isMinimalCar = true,
  sectors,
  sectorColors,
  currentSectorIdx,
  yellowSpans,
  playerIconDataUrl: rawPlayerIconDataUrl = null,
  driverLivePositions = {},
  maxFps,
  trackDrawing,
}: TrackProps & { trackDrawing: TrackDrawing }) => {
  const playerIconDataUrl = useMemo(
    () => validateImageDataUrl(rawPlayerIconDataUrl),
    [rawPlayerIconDataUrl]
  );
  const widgetScale = useWidgetScale();
  const paintingPaused = usePaintingPaused();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const theme = useCanvasTheme(canvasRef);
  const ink = useMemo(
    () => mapInk(theme, invertTrackColors),
    [theme, invertTrackColors]
  );
  const canvasInvalidatedRef = useRef(false);
  const cacheCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const debounceResizeRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined
  );
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const playerIconElRef = useRef<HTMLImageElement>(null);
  const playerPitBadgeRef = useRef<HTMLDivElement>(null);

  const shouldShow = shouldShowTrack(trackId, trackDrawing);

  const driversOffTrack = useCarIdxOffTrack();
  const carIdxIsOnPitRoad =
    useTrackStateSnapshot()?.carIdxOnPitRoad ?? EMPTY_PIT_STATE;

  // Memoize Path2D objects to avoid re-creating them on every render
  const insidePath = trackDrawing?.active?.inside;
  const startFinishLinePath = trackDrawing?.startFinish?.line;
  // Stable refs for sector color drawing (only change when track changes)
  const trackPathPoints = trackDrawing?.active?.trackPathPoints;
  const totalLength = trackDrawing?.active?.totalLength;
  const sfDirection = trackDrawing?.startFinish?.direction;
  const sfIntersectionLength = trackDrawing?.startFinish?.point?.length;
  const path2DObjects = useMemo(() => {
    if (!insidePath || !startFinishLinePath) return null;

    return {
      inside: new Path2D(insidePath),
      startFinish: new Path2D(startFinishLinePath),
    };
  }, [insidePath, startFinishLinePath]);

  // Fall back to deriving identities from drivers when not provided (e.g. stories)
  const resolvedIdentities = driverIdentities ?? drivers;

  // Memoized on stable identities, so this only recomputes when the driver
  // roster actually changes.
  const driverColors = useMemo(
    () => markerColors(resolvedIdentities, highlightColor),
    [resolvedIdentities, highlightColor]
  );

  // Get start/finish line calculations
  const startFinishLine = useStartFinishLine({
    startFinishPoint: trackDrawing?.startFinish?.point,
    trackPathPoints: trackDrawing?.active?.trackPathPoints,
  });

  // Snapshot-level collection setup. RAF frames mutate only position/progress.
  const positionedDrivers = useMemo<
    (PositionedTrackDriver & { interpolationIndex: number })[]
  >(() => {
    return drivers
      .map(
        (
          { driver, progress, isPlayer, classPosition },
          interpolationIndex
        ) => ({
          driver,
          progress,
          isPlayer,
          classPosition,
          sessionPosition: classPosition,
          position: { x: 0, y: 0 },
          textMetricsCache: { font: '', text: '', visualOffset: 0 },
          interpolationIndex,
        })
      )
      .sort((a, b) => compareDriverDrawOrder(a, b, carIdxIsOnPitRoad));
  }, [drivers, carIdxIsOnPitRoad]);

  // Canvas setup and resize handling
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resize = () => {
      if (!canvas) return;

      // Get device pixel ratio for high-DPI displays
      const dpr = (window.devicePixelRatio || 1) * widgetScale;
      const { clientWidth: width, clientHeight: height } = canvas;

      // Set the actual canvas size in memory (scaled up for high-DPI)
      canvasInvalidatedRef.current = true;
      canvas.width = width * dpr;
      canvas.height = height * dpr;

      // Apply device pixel ratio scaling to the context
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.setTransform(1, 0, 0, 1, 0, 0); // Reset transform
        ctx.scale(dpr, dpr); // Apply DPR scaling
      }
      // Update state to trigger redraw
      setCanvasSize({ width, height });
    };

    // Initial resize
    resize();

    // Use ResizeObserver to watch the canvas container
    const resizeObserver = new ResizeObserver(() => {
      // Clear existing timeout
      if (debounceResizeRef.current) {
        clearTimeout(debounceResizeRef.current);
      }

      // Set new timeout
      debounceResizeRef.current = setTimeout(() => {
        resize();
      }, 50);
    });

    // Observe the canvas element itself
    resizeObserver.observe(canvas);

    // Add window resize listener as fallback
    const handleWindowResize = () => {
      if (debounceResizeRef.current) {
        clearTimeout(debounceResizeRef.current);
      }
      debounceResizeRef.current = setTimeout(() => {
        resize();
      }, 50);
    };

    window.addEventListener('resize', handleWindowResize);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', handleWindowResize);
      if (debounceResizeRef.current) {
        clearTimeout(debounceResizeRef.current);
      }
      cacheCanvasRef.current = null;
    };
  }, [trackId, widgetScale]);

  // Static layer — redraws only when track settings, size, or appearance change
  useLayoutEffect(() => {
    // Not while nobody can see it: sector colours change it several times a
    // lap. The pause ending runs this again, with whatever is current by then.
    if (paintingPaused) return;
    const canvas = canvasRef.current;
    if (!canvas || !path2DObjects) return;
    if (canvasSize.width === 0 || canvasSize.height === 0) return;

    if (!cacheCanvasRef.current) {
      cacheCanvasRef.current = document.createElement('canvas');
    }
    const cacheCanvas = cacheCanvasRef.current;
    const cacheCtx = cacheCanvas.getContext('2d');
    if (!cacheCtx) return;

    cacheCanvas.width = canvas.width;
    cacheCanvas.height = canvas.height;

    const maxCircleSize = Math.max(driverCircleSize, playerCircleSize);
    const scaleX = canvasSize.width / (TRACK_DRAWING_WIDTH + 2 * maxCircleSize);
    const scaleY =
      canvasSize.height / (TRACK_DRAWING_HEIGHT + 2 * maxCircleSize);
    const scale = Math.min(scaleX, scaleY);
    const offsetX = (canvasSize.width - TRACK_DRAWING_WIDTH * scale) / 2;
    const offsetY = (canvasSize.height - TRACK_DRAWING_HEIGHT * scale) / 2;

    const dpr = (window.devicePixelRatio || 1) * widgetScale;
    cacheCtx.setTransform(1, 0, 0, 1, 0, 0);
    cacheCtx.scale(dpr, dpr);

    setupCanvasContext(cacheCtx, scale, offsetX, offsetY, isMinimalTrack);
    drawTrack(
      cacheCtx,
      path2DObjects,
      ink,
      trackLineWidth,
      trackOutlineWidth,
      isMinimalTrack
    );

    if (
      trackPathPoints &&
      totalLength &&
      sfIntersectionLength !== undefined &&
      sfDirection
    ) {
      if (sectors && sectorColors) {
        drawSectorColors(
          cacheCtx,
          trackPathPoints,
          totalLength,
          sfIntersectionLength,
          sfDirection,
          sectors,
          sectorColors,
          trackLineWidth,
          currentSectorIdx,
          ink.pit
        );
      }
      if (yellowSpans && yellowSpans.length > 0) {
        // The whole width of the road, outline included, so a sector under
        // a flag cannot be taken for one coloured yellow for its pace: that
        // is the line alone, inside a dark edge. Under the dividers, which
        // would otherwise be half covered where a flagged sector ends.
        drawLapSpans(
          cacheCtx,
          trackPathPoints,
          totalLength,
          sfIntersectionLength,
          sfDirection,
          yellowSpans,
          getColor('yellow', 400),
          Math.max(trackLineWidth, trackOutlineWidth)
        );
      }
      if (sectors) {
        drawSectorDividers(
          cacheCtx,
          trackPathPoints,
          totalLength,
          sfIntersectionLength,
          sfDirection,
          sectors,
          trackLineWidth
        );
      }
    }

    drawStartFinishLine(cacheCtx, startFinishLine);
    drawTurnNames(cacheCtx, trackDrawing.turns, turnLabels, ink);

    cacheCtx.restore();

    // The static blit clears cars too; restore the dynamic layer this commit.
    canvasInvalidatedRef.current = true;
    // Blit to main canvas so static-only changes are visible immediately
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(cacheCanvas, 0, 0);
      ctx.restore();
    }
  }, [
    path2DObjects,
    trackDrawing?.turns,
    turnLabels,
    canvasSize,
    widgetScale,
    ink,
    trackLineWidth,
    trackOutlineWidth,
    trackmapFontSize,
    startFinishLine,
    driverCircleSize,
    playerCircleSize,
    isMinimalTrack,
    sectors,
    sectorColors,
    currentSectorIdx,
    yellowSpans,
    trackPathPoints,
    totalLength,
    sfDirection,
    sfIntersectionLength,
    paintingPaused,
  ]);

  // Dynamic layer — interpolates and paints imperatively between 25 Hz snapshots.
  useProgressAnimation(
    drivers,
    (progressValues, count) => {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (!canvas || !ctx || !cacheCanvasRef.current) return;
      if (canvasSize.width === 0 || canvasSize.height === 0) return;
      if (
        !trackPathPoints ||
        !totalLength ||
        sfIntersectionLength === undefined
      )
        return;

      for (const entry of positionedDrivers) {
        if (entry.interpolationIndex >= count) continue;
        const progress = progressValues[entry.interpolationIndex];
        entry.progress = progress;
        progressToTrackPoint(
          progress,
          trackPathPoints,
          totalLength,
          sfIntersectionLength,
          sfDirection,
          entry.position
        );
      }

      // Blit static cache (identity transform to avoid double DPR scaling)
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(cacheCanvasRef.current, 0, 0);
      ctx.restore();

      // Draw drivers
      const maxCircleSize = Math.max(driverCircleSize, playerCircleSize);
      const scaleX =
        canvasSize.width / (TRACK_DRAWING_WIDTH + 2 * maxCircleSize);
      const scaleY =
        canvasSize.height / (TRACK_DRAWING_HEIGHT + 2 * maxCircleSize);
      const scale = Math.min(scaleX, scaleY);
      const offsetX = (canvasSize.width - TRACK_DRAWING_WIDTH * scale) / 2;
      const offsetY = (canvasSize.height - TRACK_DRAWING_HEIGHT * scale) / 2;

      setupCanvasContext(ctx, scale, offsetX, offsetY, isMinimalCar);
      const hasIconOverlay = !!playerIconDataUrl;
      drawDrivers(
        ctx,
        positionedDrivers,
        driverColors,
        invertLeaderColor,
        driversOffTrack,
        driverCircleSize,
        playerCircleSize,
        trackmapFontSize,
        showCarNumbers,
        displayMode,
        driverLivePositions,
        carIdxIsOnPitRoad,
        hasIconOverlay,
        ink
      );
      ctx.restore();

      // Position the icon overlay imperatively — mutating transform/dimensions
      // directly avoids a React render on every position tick.
      const iconEl = playerIconElRef.current;
      const pitEl = playerPitBadgeRef.current;
      if (!hasIconOverlay) {
        if (iconEl) iconEl.style.display = 'none';
        if (pitEl) pitEl.style.display = 'none';
        return;
      }
      let playerEntry: PositionedTrackDriver | undefined;
      for (const entry of positionedDrivers) {
        if (entry.isPlayer) {
          playerEntry = entry;
          break;
        }
      }
      if (!playerEntry) {
        if (iconEl) iconEl.style.display = 'none';
        if (pitEl) pitEl.style.display = 'none';
        return;
      }
      const radius = playerCircleSize * scale;
      const screenX = playerEntry.position.x * scale + offsetX - radius;
      const screenY = playerEntry.position.y * scale + offsetY - radius;
      const size = radius * 2;
      if (iconEl) {
        iconEl.style.transform = `translate(${screenX}px, ${screenY}px)`;
        iconEl.style.width = `${size}px`;
        iconEl.style.height = `${size}px`;
        iconEl.style.display = '';
      }
      const onPitRoad = !!carIdxIsOnPitRoad?.[playerEntry.driver.CarIdx];
      if (pitEl) {
        if (onPitRoad) {
          pitEl.style.transform = `translate(${screenX}px, ${screenY}px)`;
          pitEl.style.width = `${size}px`;
          pitEl.style.height = `${size}px`;
          pitEl.style.fontSize = `${size * 0.6}px`;
          pitEl.style.display = '';
        } else {
          pitEl.style.display = 'none';
        }
      }
    },
    maxFps,
    canvasInvalidatedRef,
    paintingPaused
  );

  const renderIconOverlay = () =>
    playerIconDataUrl ? (
      <>
        <img
          ref={playerIconElRef}
          src={playerIconDataUrl}
          alt=""
          className="absolute top-0 left-0 pointer-events-none origin-top-left will-change-transform"
          style={{ display: 'none' }}
        />
        <div
          ref={playerPitBadgeRef}
          className="absolute top-0 left-0 pointer-events-none flex items-center justify-center rounded-full bg-slate-950/60 font-bold text-white origin-top-left will-change-transform"
          style={{ display: 'none' }}
        >
          P
        </div>
      </>
    ) : null;

  // Development/Storybook mode - show debug info and canvas
  if (debug) {
    return (
      <div className="overflow-hidden w-full h-full relative">
        <TrackDebug trackId={trackId} trackDrawing={trackDrawing} />
        <canvas
          className="will-change-transform w-full h-full"
          ref={canvasRef}
        ></canvas>
        {renderIconOverlay()}
      </div>
    );
  }

  // Hide broken tracks in production
  if (!shouldShow) return null;

  return (
    <div className="overflow-hidden w-full h-full relative">
      <canvas
        className="will-change-transform w-full h-full"
        ref={canvasRef}
      ></canvas>
      {renderIconOverlay()}
    </div>
  );
};
