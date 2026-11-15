import { useEffect, useRef, useState } from 'react';
import { usePaintingPaused } from '@irdashies/context';
import { useWidgetScale } from '@irdashies/domain/widgetPresentation/WidgetScale';
import {
  pointAtProgress,
  tangentAtProgress,
  type TrackGeometry,
} from '@irdashies/domain/track';
import { useProgressAnimation } from '@irdashies/domain/track/useProgressAnimation';
import type { MinimapConfig } from '@irdashies/types';
import {
  createView,
  headingRotation,
  insideDisc,
  labelFontSize,
  project,
  updateView,
} from './minimapModel';
import { MinimapRibbon } from './minimapRibbon';

/** One car on the map, in the order its progress is animated. */
export interface MinimapCar {
  /** Lap fraction, 0..1. */
  progress: number;
  driver: { CarIdx: number };
  fill: string;
  textColor: string;
  label: string;
  isFocus: boolean;
  inPits: boolean;
}

export interface MinimapCanvasProps {
  geometry: TrackGeometry | null;
  cars: readonly MinimapCar[];
  range: number;
  orientation: MinimapConfig['orientation'];
  markerSize: number;
  trackWidth: number;
  showStartFinish: boolean;
  dimCarsInPits: boolean;
  /** 0..100. */
  backgroundOpacity: number;
  /** Ring round the focus car, as a CSS colour. */
  focusColor: string;
  /** Shown in place of the track when there is no line to draw. */
  emptyMessage: string;
}

const TRACK_COLOR = '#ffffff';
const TRACK_EDGE_COLOR = 'rgb(2 6 23 / 0.6)';
/** Metres of dark edge either side of the track ribbon. */
const TRACK_EDGE = 2;
const START_FINISH_COLOR = '#ef4444';
const DISC_RGB = '15 23 42';
const RING_COLOR = 'rgb(255 255 255 / 0.3)';
const PIT_ALPHA = 0.4;
/** The focus marker is drawn a little larger than the rest. */
const FOCUS_SCALE = 1.15;
const TAU = Math.PI * 2;
/**
 * The most the map is redrawn in a second, as the radar is.
 *
 * Positions arrive 25 times a second and are eased between, so every refresh
 * of the display has something new to draw: uncapped, a 144 or 240 Hz monitor
 * redraws the map that often. Sixty looks the same on a 60 Hz display and
 * stays smooth with the map turning under the car.
 */
const MAX_FPS = 60;
/**
 * Pixels past the edge of the disc the track is still drawn for, so the soft
 * edge of a stroke just outside it is not cut short.
 */
const RIBBON_GUARD = 2;

/**
 * Draws the close-range map: a disc centred on the focus car, the track around
 * it, and every car in range.
 *
 * The track is drawn through the canvas transform so it scales and turns as
 * one path; the markers are projected by hand so they stay the same size and
 * upright whatever the zoom or rotation.
 */
export const MinimapCanvas = ({
  geometry,
  cars,
  range,
  orientation,
  markerSize,
  trackWidth,
  showStartFinish,
  dimCarsInPits,
  backgroundOpacity,
  focusColor,
  emptyMessage,
}: MinimapCanvasProps) => {
  const widgetScale = useWidgetScale();
  const paintingPaused = usePaintingPaused();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Set when a resize clears the canvas, so the next commit repaints at once
  // even if new positions arrive with it; otherwise the disc blinks.
  const canvasInvalidatedRef = useRef(false);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resize = () => {
      const dpr = (window.devicePixelRatio || 1) * widgetScale;
      const { clientWidth: width, clientHeight: height } = canvas;
      canvasInvalidatedRef.current = true;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      setSize({ width, height });
    };
    resize();

    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [widgetScale]);

  // The stretch of track round the car, rebuilt when the car drives out of it.
  const [ribbon] = useState(() => new MinimapRibbon());

  // Scratch objects reused by every frame, so drawing allocates nothing.
  const scratch = useRef({
    view: createView(),
    centre: { x: 0, y: 0 },
    tangent: { x: 0, y: 0 },
    point: { x: 0, y: 0 },
    screen: { x: 0, y: 0 },
  });

  const draw = (progress: Float64Array, count: number) => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context || size.width === 0 || size.height === 0) return;

    const dpr = (window.devicePixelRatio || 1) * widgetScale;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, size.width, size.height);

    const originX = size.width / 2;
    const originY = size.height / 2;
    // A pixel in, so the ring is not cut by the edge of the canvas.
    const radius = Math.max(0, Math.min(originX, originY) - 1);

    context.save();
    context.beginPath();
    context.arc(originX, originY, radius, 0, TAU);
    context.fillStyle = `rgb(${DISC_RGB} / ${backgroundOpacity / 100})`;
    context.fill();
    context.clip();

    const focusIndex = cars.findIndex((car) => car.isFocus);
    const shown = Math.min(count, cars.length);

    if (!geometry || focusIndex < 0 || focusIndex >= shown) {
      context.fillStyle = 'rgb(226 232 240 / 0.85)';
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.font = `600 ${Math.max(10, radius * 0.11)}px Lato, sans-serif`;
      context.fillText(geometry ? '' : emptyMessage, originX, originY);
      context.restore();
    } else {
      const { view, centre, tangent, point, screen } = scratch.current;
      const { unitsPerMeter } = geometry;
      const focusProgress = progress[focusIndex];
      pointAtProgress(geometry, focusProgress, centre);
      let rotation = 0;
      if (orientation === 'heading') {
        tangentAtProgress(geometry, focusProgress, tangent);
        rotation = headingRotation(tangent.x, tangent.y);
      }
      updateView(
        view,
        centre,
        rotation,
        radius,
        range,
        unitsPerMeter,
        originX,
        originY
      );

      // Half the width of the wider of the two strokes, in drawing units.
      const half = (trackWidth / 2 + TRACK_EDGE) * unitsPerMeter;
      // Only the track that can reach the disc, not the whole lap.
      const trackPath = ribbon.pathFor(
        geometry,
        centre.x,
        centre.y,
        (radius + RIBBON_GUARD) / view.scale + half
      );

      context.save();
      context.translate(originX, originY);
      context.rotate(rotation);
      context.scale(view.scale, view.scale);
      context.translate(-centre.x, -centre.y);
      context.lineJoin = 'round';
      context.lineCap = 'round';
      context.strokeStyle = TRACK_EDGE_COLOR;
      context.lineWidth = (trackWidth + TRACK_EDGE * 2) * unitsPerMeter;
      context.stroke(trackPath);
      context.strokeStyle = TRACK_COLOR;
      context.lineWidth = trackWidth * unitsPerMeter;
      context.stroke(trackPath);

      if (showStartFinish) {
        pointAtProgress(geometry, 0, point);
        tangentAtProgress(geometry, 0, tangent);
        // Across the track: the tangent turned a quarter.
        context.beginPath();
        context.moveTo(point.x - tangent.y * half, point.y + tangent.x * half);
        context.lineTo(point.x + tangent.y * half, point.y - tangent.x * half);
        context.lineCap = 'butt';
        context.strokeStyle = START_FINISH_COLOR;
        context.lineWidth = Math.max(2, trackWidth * 0.3) * unitsPerMeter;
        context.stroke();
      }
      context.restore();

      context.textAlign = 'center';
      context.textBaseline = 'middle';
      const markerRadius = markerSize / 2;

      const drawMarker = (index: number) => {
        const car = cars[index];
        pointAtProgress(geometry, progress[index], point);
        project(view, point.x, point.y, screen);
        const markerR = car.isFocus ? markerRadius * FOCUS_SCALE : markerRadius;
        if (!insideDisc(view, screen, radius, markerR)) return;

        context.globalAlpha = dimCarsInPits && car.inPits ? PIT_ALPHA : 1;
        context.beginPath();
        context.arc(screen.x, screen.y, markerR, 0, TAU);
        context.fillStyle = car.fill;
        context.fill();
        context.lineWidth = car.isFocus ? Math.max(2, markerR * 0.28) : 1;
        context.strokeStyle = car.isFocus ? focusColor : 'rgb(2 6 23 / 0.8)';
        context.stroke();

        if (car.label) {
          context.fillStyle = car.textColor;
          context.font = `700 ${labelFontSize(markerR, car.label)}px Lato, sans-serif`;
          // A hair low: digits have no descenders, so the visual middle of
          // the text sits above its em box middle.
          context.fillText(car.label, screen.x, screen.y + markerR * 0.06);
        }
        context.globalAlpha = 1;
      };

      for (let index = 0; index < shown; index += 1) {
        if (index !== focusIndex) drawMarker(index);
      }
      // Last, so nothing covers the car the map is about.
      drawMarker(focusIndex);
      context.restore();
    }

    context.beginPath();
    context.arc(originX, originY, radius, 0, TAU);
    context.strokeStyle = RING_COLOR;
    context.lineWidth = 2;
    context.stroke();
  };

  useProgressAnimation(
    cars,
    draw,
    MAX_FPS,
    canvasInvalidatedRef,
    paintingPaused
  );

  return <canvas ref={canvasRef} className="h-full w-full" />;
};
