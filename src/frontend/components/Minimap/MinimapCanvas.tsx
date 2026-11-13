import { useEffect, useMemo, useRef, useState } from 'react';
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

const buildTrackPath = (geometry: TrackGeometry): Path2D => {
  const path = new Path2D();
  path.moveTo(geometry.xs[0], geometry.ys[0]);
  for (let index = 1; index < geometry.count; index += 1) {
    path.lineTo(geometry.xs[index], geometry.ys[index]);
  }
  path.closePath();
  return path;
};

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
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resize = () => {
      const dpr = (window.devicePixelRatio || 1) * widgetScale;
      const { clientWidth: width, clientHeight: height } = canvas;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      setSize({ width, height });
    };
    resize();

    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [widgetScale]);

  const trackPath = useMemo(
    () => (geometry ? buildTrackPath(geometry) : null),
    [geometry]
  );

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

    if (!geometry || !trackPath || focusIndex < 0 || focusIndex >= shown) {
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
        const half = (trackWidth / 2 + TRACK_EDGE) * unitsPerMeter;
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

  useProgressAnimation(cars, draw);

  return <canvas ref={canvasRef} className="h-full w-full" />;
};
