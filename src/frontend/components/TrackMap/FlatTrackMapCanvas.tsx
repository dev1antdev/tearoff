import { useWidgetScale } from '@irdashies/domain/widgetPresentation/WidgetScale';
import { useEffect, useMemo, useRef, useState } from 'react';
import { TrackDriver, TrackDrawing } from './TrackCanvas';
import { getColor } from '@irdashies/utils/colors';
import { useCanvasTheme } from '@irdashies/domain/widgetPresentation/canvasTheme';
import { useCarIdxOffTrack, usePaintingPaused } from '@irdashies/context';
import {
  progressToFlatX,
  useProgressAnimation,
} from '@irdashies/domain/track/useProgressAnimation';
import {
  drawDrivers,
  mapInk,
  markerColors,
} from './trackDrawingUtils';
import type { LapSpan } from '@irdashies/domain/track';

const NO_SPANS: readonly LapSpan[] = [];

export interface FlatTrackMapCanvasProps {
  /**
   * Not drawn from: the lap is a straight line whatever the circuit. A
   * caller with a drawing may pass it; one whose track has none need not.
   */
  trackDrawing?: TrackDrawing;
  drivers: TrackDriver[];
  highlightColor?: number;
  invertLeaderColor?: boolean;
  showCarNumbers?: boolean;
  displayMode?: 'carNumber' | 'sessionPosition' | 'livePosition';
  driverCircleSize?: number;
  playerCircleSize?: number;
  trackmapFontSize?: number;
  trackLineWidth?: number;
  trackOutlineWidth?: number;
  invertTrackColors?: boolean;
  driverLivePositions?: Record<number, number>;
  carIdxIsOnPitRoad?: readonly boolean[];
  /** Stretches of the lap under a yellow flag, as lap fractions. */
  yellowSpans?: readonly LapSpan[];
  /** Caps redraws, e.g. for a map docked in the Gantry. */
  maxFps?: number;
}

const HORIZONTAL_PADDING = 40; // Fixed padding on each side

export const FlatTrackMapCanvas = ({
  drivers,
  highlightColor,
  invertLeaderColor = false,
  showCarNumbers = true,
  displayMode = 'carNumber',
  driverCircleSize = 40,
  playerCircleSize = 40,
  trackmapFontSize = 100,
  trackLineWidth = 20,
  trackOutlineWidth = 40,
  invertTrackColors = false,
  driverLivePositions = [0, 0],
  carIdxIsOnPitRoad = [],
  yellowSpans = NO_SPANS,
  maxFps,
}: FlatTrackMapCanvasProps) => {
  const widgetScale = useWidgetScale();
  const paintingPaused = usePaintingPaused();
  const canvasInvalidatedRef = useRef(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const theme = useCanvasTheme(canvasRef);
  const ink = useMemo(
    () => mapInk(theme, invertTrackColors),
    [theme, invertTrackColors]
  );
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const driversOffTrack = useCarIdxOffTrack();
  const debounceResizeRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined
  );

  const driverColors = useMemo(
    () => markerColors(drivers, highlightColor),
    [drivers, highlightColor]
  );

  const orderedDrivers = useMemo(
    () =>
      drivers
        .map((entry, interpolationIndex) => ({
          ...entry,
          interpolationIndex,
          textMetricsCache: { font: '', text: '', visualOffset: 0 },
        }))
        .sort((a, b) => Number(a.isPlayer) - Number(b.isPlayer)),
    [drivers]
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resize = () => {
      const dpr = (window.devicePixelRatio || 1) * widgetScale;
      const { clientWidth: width, clientHeight: height } = canvas;
      canvasInvalidatedRef.current = true;
      canvas.width = width * dpr;
      canvas.height = height * dpr;

      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.scale(dpr, dpr);
      }
      setCanvasSize({ width, height });
    };

    // Initial resize
    resize();

    const handleResize = () => {
      if (debounceResizeRef.current) {
        clearTimeout(debounceResizeRef.current);
      }
      debounceResizeRef.current = setTimeout(() => {
        resize();
      }, 50);
    };

    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(canvas);
    // Also observe the parent container
    if (canvas.parentElement) {
      resizeObserver.observe(canvas.parentElement);
    }
    window.addEventListener('resize', handleResize);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', handleResize);
      if (debounceResizeRef.current) {
        clearTimeout(debounceResizeRef.current);
      }
    };
  }, [widgetScale]);

  const drawFrame = (progressValues: Float64Array, count: number) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || canvasSize.width === 0) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const centerY = canvasSize.height / 2;
    const usableWidth = canvasSize.width - HORIZONTAL_PADDING * 2;
    const trackStartX = HORIZONTAL_PADDING;
    const trackEndX = canvasSize.width - HORIZONTAL_PADDING;

    // Draw horizontal track line with outline (matching curved track map)
    const circleScale = 0.25; // Scale factor to match curved map coordinate space
    const scaledTrackLineWidth = trackLineWidth * circleScale;
    const scaledOutlineWidth = trackOutlineWidth * circleScale;

    // First draw outline
    ctx.strokeStyle = ink.edge;
    ctx.lineWidth = scaledOutlineWidth;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(trackStartX, centerY);
    ctx.lineTo(trackEndX, centerY);
    ctx.stroke();

    // Then draw track on top
    ctx.strokeStyle = ink.road;
    ctx.lineWidth = scaledTrackLineWidth;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(trackStartX, centerY);
    ctx.lineTo(trackEndX, centerY);
    ctx.stroke();

    // A stretch under a yellow flag, over the whole width of the line and
    // its outline, cut square where the stretch ends.
    if (yellowSpans.length > 0) {
      ctx.strokeStyle = getColor('yellow', 400);
      ctx.lineWidth = Math.max(scaledTrackLineWidth, scaledOutlineWidth);
      ctx.lineCap = 'butt';
      for (const span of yellowSpans) {
        ctx.beginPath();
        ctx.moveTo(
          progressToFlatX(span.from, HORIZONTAL_PADDING, usableWidth),
          centerY
        );
        ctx.lineTo(
          progressToFlatX(span.to, HORIZONTAL_PADDING, usableWidth),
          centerY
        );
        ctx.stroke();
      }
    }

    // Draw start/finish line
    ctx.strokeStyle = getColor('red');
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(HORIZONTAL_PADDING, centerY - 10);
    ctx.lineTo(HORIZONTAL_PADDING, centerY + 10);
    ctx.stroke();

    // Draw checkered flag above the line
    const flagSize = 8;
    const flagY = centerY - 25;
    const flagX = HORIZONTAL_PADDING - flagSize;

    // Draw 2x2 checkered pattern
    for (let row = 0; row < 2; row++) {
      for (let col = 0; col < 2; col++) {
        const isBlack = (row + col) % 2 === 0;
        ctx.fillStyle = isBlack ? 'black' : 'white';
        ctx.fillRect(
          flagX + col * flagSize,
          flagY + row * flagSize,
          flagSize,
          flagSize
        );
      }
    }

    // Add border around flag
    ctx.strokeStyle = 'black';
    ctx.lineWidth = 1;
    ctx.strokeRect(flagX, flagY, flagSize * 2, flagSize * 2);

    // Draw drivers: the Track Map's markers, on the straight.
    const positionedDrivers = orderedDrivers
      .filter(({ interpolationIndex }) => interpolationIndex < count)
      .map((orderedDriver) => ({
        ...orderedDriver,
        position: {
          x: progressToFlatX(
            progressValues[orderedDriver.interpolationIndex],
            HORIZONTAL_PADDING,
            usableWidth
          ),
          y: centerY,
        },
        sessionPosition: orderedDriver.classPosition,
      }));

    drawDrivers(
      ctx,
      positionedDrivers,
      driverColors,
      invertLeaderColor,
      driversOffTrack,
      driverCircleSize * circleScale,
      playerCircleSize * circleScale,
      trackmapFontSize,
      showCarNumbers,
      displayMode,
      driverLivePositions,
      carIdxIsOnPitRoad,
      false,
      ink
    );
  };
  useProgressAnimation(
    drivers,
    drawFrame,
    maxFps,
    canvasInvalidatedRef,
    paintingPaused
  );

  return (
    <div className="w-full h-full">
      <canvas ref={canvasRef} className="w-full h-full" />
    </div>
  );
};
