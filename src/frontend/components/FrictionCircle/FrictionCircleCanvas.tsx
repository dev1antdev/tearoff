import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { getChannelSnapshotStore, usePaintingPaused } from '@irdashies/context';
import { useWidgetScale } from '@irdashies/domain/widgetPresentation/WidgetScale';
import { perfMetrics } from '@irdashies/utils/perfMetrics';
import type { GForceSnapshot } from '@irdashies/types';
import {
  GTrail,
  placeReading,
  trailOpacity,
  wholeGRings,
  type CirclePoint,
  type FrictionCircleOrientation,
} from './frictionCircleGeometry';

export interface FrictionCircleCanvasProps {
  /** The g at the rim. */
  scaleG: number;
  orientation: FrictionCircleOrientation;
  showTrace: boolean;
  traceSeconds: number;
  showRings: boolean;
  showSustainedRing: boolean;
}

/** What the channel is asked for: see widgetRuntimeDefinition.ts. */
const G_FORCE_RATE_HZ = 30;
/**
 * The most the circle is redrawn in a second. Readings arrive thirty times a
 * second, and between them only the fade of the trail moves.
 */
const MAX_FPS = 30;
const FRAME_INTERVAL_MS = 1000 / MAX_FPS;
const TAU = Math.PI * 2;

/** The dot is 10 px across. */
const DOT_RADIUS = 5;
const TRAIL_WIDTH = 2;
/** Opacity of the trail where it meets the dot. */
const TRAIL_NEWEST_OPACITY = 0.6;
/**
 * Steps the trail's fade is drawn in. Each step is one stroke, so the round
 * joins inside it do not show through the transparency.
 */
const TRAIL_BANDS = 16;

// Tailwind's palette, for a canvas that cannot take a class.
const RING_COLOR = 'rgb(148 163 184 / 0.4)'; // slate-400
const RIM_COLOR = 'rgb(148 163 184 / 0.7)';
// A neutral under the trail: purple means the session's fastest lap.
const SUSTAINED_COLOR = '#94a3b8'; // slate-400
const TRAIL_COLOR = '#ffffff';
const DOT_COLOR = '#ffffff';
const DOT_CLAMPED_COLOR = '#fcd34d'; // amber-300
const DOT_IDLE_COLOR = '#64748b'; // slate-500
const DOT_OUTLINE_COLOR = '#0f172a'; // slate-900
const SUSTAINED_DASH = [5, 4];
const NO_DASH: number[] = [];

interface Reading {
  available: boolean;
  latG: number;
  longG: number;
  sustainedLatG: number;
  sessionNum: number | null;
}

const seconds = (): number => performance.now() / 1000;

/**
 * Draws the circle: rings at each whole g, the fading trail, the ring of the
 * sustained lateral grip and the dot.
 *
 * It reads the channel itself rather than through React, so thirty readings
 * a second re-render nothing: each one is put on the trail and a frame is
 * asked for. Frames stop while the overlay cannot be seen, with the trail
 * still being filled, and one is drawn when it comes back. With the car
 * standing still frames also stop, once the trail has faded out.
 */
export const FrictionCircleCanvas = memo(
  ({
    scaleG,
    orientation,
    showTrace,
    traceSeconds,
    showRings,
    showSustainedRing,
  }: FrictionCircleCanvasProps) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const widgetScale = useWidgetScale();
    const paintingPaused = usePaintingPaused();

    // Local to the component, and gone with it: no store.
    const [trail] = useState(() => new GTrail());
    const readingRef = useRef<Reading>({
      available: false,
      latG: 0,
      longG: 0,
      sustainedLatG: 0,
      sessionNum: null,
    });
    const sizeRef = useRef({ width: 0, height: 0 });
    // Scratch points, so a frame allocates nothing.
    const scratchRef = useRef<{ from: CirclePoint; to: CirclePoint }>({
      from: { x: 0, y: 0, clamped: false },
      to: { x: 0, y: 0, clamped: false },
    });

    const pausedRef = useRef(paintingPaused);
    const frameRef = useRef(0);
    const lastPaintRef = useRef(Number.NEGATIVE_INFINITY);
    const paintRef = useRef<() => boolean>(() => false);
    const requestRef = useRef<() => void>(() => undefined);

    // The frame loop. Built once: it reads everything through refs.
    useEffect(() => {
      const frame = (timestamp: number) => {
        frameRef.current = 0;
        if (pausedRef.current) return;
        if (timestamp - lastPaintRef.current < FRAME_INTERVAL_MS - 1) {
          // Too soon after the last one: wait for the next refresh.
          frameRef.current = requestAnimationFrame(frame);
          return;
        }
        lastPaintRef.current = timestamp;
        const fading = perfMetrics.measure('frictionCircleFrame', () =>
          paintRef.current()
        );
        // A trail that is still fading needs drawing again though no new
        // reading comes; one that has gone needs nothing.
        if (fading) request();
      };
      const request = () => {
        if (pausedRef.current || frameRef.current !== 0) return;
        frameRef.current = requestAnimationFrame(frame);
      };
      requestRef.current = request;
      return () => {
        requestRef.current = () => undefined;
        if (frameRef.current !== 0) cancelAnimationFrame(frameRef.current);
        frameRef.current = 0;
      };
    }, []);

    // No drawing while nothing drawn can be seen; one frame when it can.
    useEffect(() => {
      pausedRef.current = paintingPaused;
      if (paintingPaused) {
        if (frameRef.current !== 0) cancelAnimationFrame(frameRef.current);
        frameRef.current = 0;
      } else {
        requestRef.current();
      }
    }, [paintingPaused]);

    // What a frame draws, from the settings as they stand.
    useEffect(() => {
      const rings = wholeGRings(scaleG);
      paintRef.current = () => {
        const canvas = canvasRef.current;
        const context = canvas?.getContext('2d');
        const { width, height } = sizeRef.current;
        if (!canvas || !context || width === 0 || height === 0) return false;

        const ratio = (window.devicePixelRatio || 1) * widgetScale;
        context.setTransform(ratio, 0, 0, ratio, 0, 0);
        context.clearRect(0, 0, width, height);

        const centreX = width / 2;
        const centreY = height / 2;
        // Room for the dot to sit on the rim without being cut off.
        const radius = Math.max(0, Math.min(centreX, centreY) - DOT_RADIUS - 1);
        const reading = readingRef.current;
        const { from, to } = scratchRef.current;

        context.lineWidth = 1;
        if (showRings) {
          context.strokeStyle = RING_COLOR;
          context.beginPath();
          for (const g of rings) {
            const ring = (g / scaleG) * radius;
            context.moveTo(centreX + ring, centreY);
            context.arc(centreX, centreY, ring, 0, TAU);
          }
          context.moveTo(centreX - radius, centreY);
          context.lineTo(centreX + radius, centreY);
          context.moveTo(centreX, centreY - radius);
          context.lineTo(centreX, centreY + radius);
          context.stroke();
        }
        context.strokeStyle = RIM_COLOR;
        context.beginPath();
        context.arc(centreX, centreY, radius, 0, TAU);
        context.stroke();

        if (
          showSustainedRing &&
          reading.available &&
          reading.sustainedLatG > 0 &&
          reading.sustainedLatG <= scaleG
        ) {
          context.strokeStyle = SUSTAINED_COLOR;
          context.lineWidth = 2;
          context.setLineDash(SUSTAINED_DASH);
          context.beginPath();
          context.arc(
            centreX,
            centreY,
            (reading.sustainedLatG / scaleG) * radius,
            0,
            TAU
          );
          context.stroke();
          context.setLineDash(NO_DASH);
        }

        const now = seconds();
        trail.prune(now, traceSeconds);
        if (showTrace && trail.size > 1) {
          context.strokeStyle = TRAIL_COLOR;
          context.lineWidth = TRAIL_WIDTH;
          context.lineJoin = 'round';
          context.lineCap = 'round';
          // Oldest first, a stroke for each step of the fade.
          let band = -1;
          placeReading(
            trail.latAt(0),
            trail.longAt(0),
            scaleG,
            radius,
            orientation,
            from
          );
          for (let index = 1; index < trail.size; index += 1) {
            placeReading(
              trail.latAt(index),
              trail.longAt(index),
              scaleG,
              radius,
              orientation,
              to
            );
            const opacity = trailOpacity(
              now - trail.timeAt(index),
              traceSeconds,
              TRAIL_NEWEST_OPACITY
            );
            const next = Math.ceil(
              (opacity / TRAIL_NEWEST_OPACITY) * TRAIL_BANDS
            );
            if (next !== band) {
              if (band > 0) context.stroke();
              band = next;
              context.globalAlpha = (band / TRAIL_BANDS) * TRAIL_NEWEST_OPACITY;
              context.beginPath();
              context.moveTo(centreX + from.x, centreY + from.y);
            }
            context.lineTo(centreX + to.x, centreY + to.y);
            from.x = to.x;
            from.y = to.y;
          }
          if (band > 0) context.stroke();
          context.globalAlpha = 1;
        }

        if (reading.available) {
          placeReading(
            reading.latG,
            reading.longG,
            scaleG,
            radius,
            orientation,
            to
          );
          context.fillStyle = to.clamped ? DOT_CLAMPED_COLOR : DOT_COLOR;
        } else {
          to.x = 0;
          to.y = 0;
          context.fillStyle = DOT_IDLE_COLOR;
        }
        context.beginPath();
        context.arc(centreX + to.x, centreY + to.y, DOT_RADIUS, 0, TAU);
        context.fill();
        context.lineWidth = 1;
        context.strokeStyle = DOT_OUTLINE_COLOR;
        context.stroke();

        // Fewer than two samples draw no line, and one that is left is
        // dropped by the frame the next reading asks for.
        return showTrace && trail.size > 1;
      };
      requestRef.current();
    }, [
      orientation,
      scaleG,
      showRings,
      showSustainedRing,
      showTrace,
      traceSeconds,
      trail,
      widgetScale,
    ]);

    // The canvas follows the size of its box.
    useLayoutEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const resize = (width: number, height: number) => {
        const ratio = (window.devicePixelRatio || 1) * widgetScale;
        sizeRef.current = { width, height };
        const nextWidth = Math.max(0, Math.round(width * ratio));
        const nextHeight = Math.max(0, Math.round(height * ratio));
        if (canvas.width === nextWidth && canvas.height === nextHeight) return;
        canvas.width = nextWidth;
        canvas.height = nextHeight;
        // Resizing clears it: draw now, not a refresh later, or it blinks.
        if (!pausedRef.current) {
          perfMetrics.measure('frictionCircleFrame', () => paintRef.current());
        }
      };
      const observer = new ResizeObserver(([entry]) =>
        resize(entry.contentRect.width, entry.contentRect.height)
      );
      observer.observe(canvas);
      resize(canvas.clientWidth, canvas.clientHeight);
      return () => observer.disconnect();
    }, [widgetScale]);

    // The readings, straight from the channel.
    useEffect(() => {
      const bridge = window.channelBridge;
      if (!bridge) return;
      const store = getChannelSnapshotStore('g-force.snapshot', bridge);
      const selection = store.createSelection(
        (snapshot: GForceSnapshot) => snapshot,
        Object.is,
        G_FORCE_RATE_HZ
      );
      const reading = readingRef.current;
      const take = () => {
        const snapshot = selection.getSnapshot();
        if (!snapshot) return;
        // A trail is of one stint in one session: it does not run on from
        // before the driver got out, or from the session before.
        if (!snapshot.available || snapshot.sessionNum !== reading.sessionNum) {
          trail.clear();
        }
        reading.available = snapshot.available;
        reading.latG = snapshot.latG;
        reading.longG = snapshot.longG;
        reading.sustainedLatG = snapshot.sustainedLatG;
        reading.sessionNum = snapshot.sessionNum;
        if (snapshot.available) {
          trail.push(snapshot.latG, snapshot.longG, seconds());
        }
        requestRef.current();
      };
      const unsubscribe = selection.subscribe(take);
      // The store may already hold a snapshot from another reader.
      take();
      return () => {
        unsubscribe();
        trail.clear();
      };
    }, [trail]);

    return (
      <canvas
        ref={canvasRef}
        className="block h-full w-full min-h-0 min-w-0"
        aria-hidden="true"
      />
    );
  }
);
FrictionCircleCanvas.displayName = 'FrictionCircleCanvas';
