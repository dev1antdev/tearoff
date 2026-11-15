import { memo, useEffect, useLayoutEffect, useRef } from 'react';
import { usePaintingPaused } from '@irdashies/context';
import { useWidgetScale } from '@irdashies/domain/widgetPresentation/WidgetScale';
import { perfMetrics } from '@irdashies/utils/perfMetrics';
import {
  InputTraceDrawing,
  type InputTraceInput,
  type InputTraceSettings,
} from './inputTraceDrawing';

export interface InputTraceProps {
  input: InputTraceInput;
  settings?: Partial<InputTraceSettings>;
}

/** Canvas trace sampled on input updates and painted on animation frames. */
export const InputTrace = memo(({ input, settings }: InputTraceProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef<InputTraceDrawing | null>(null);
  const widgetScale = useWidgetScale();
  // No painting while the trace cannot be seen: the overlay hidden, or its
  // window. Sampling goes on, so the history has no hole in it when the
  // trace is back on screen.
  const paintingPaused = usePaintingPaused();
  const pausedRef = useRef(paintingPaused);
  const wasPausedRef = useRef(paintingPaused);
  /** The frame asked for and not yet painted or cancelled; 0 for none. */
  const pendingFrameRef = useRef(0);

  useLayoutEffect(() => {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    drawingRef.current = new InputTraceDrawing(ctx);
    return () => {
      drawingRef.current = null;
    };
  }, []);

  // Before the effects that read the ref, so that none of them acts on the
  // value of the render before. A frame already asked for is dropped: the
  // paint that ends the pause draws what it would have.
  useLayoutEffect(() => {
    pausedRef.current = paintingPaused;
    if (paintingPaused && pendingFrameRef.current !== 0) {
      cancelAnimationFrame(pendingFrameRef.current);
      pendingFrameRef.current = 0;
    }
  }, [paintingPaused]);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let width = canvas.clientWidth;
    let height = canvas.clientHeight;
    const resize = () => {
      const ratio = (window.devicePixelRatio || 1) * widgetScale;
      const nextWidth = Math.max(0, Math.round(width * ratio));
      const nextHeight = Math.max(0, Math.round(height * ratio));
      if (canvas.width === nextWidth && canvas.height === nextHeight) return;
      canvas.width = nextWidth;
      canvas.height = nextHeight;
      // The buffer keeps its size up to date while paused, and the paint
      // that ends the pause fills it.
      if (pausedRef.current) return;
      const drawing = drawingRef.current;
      if (drawing) perfMetrics.measure('inputTraceFrame', drawing.paint);
    };
    const observer = new ResizeObserver(([entry]) => {
      width = entry.contentRect.width;
      height = entry.contentRect.height;
      resize();
    });
    observer.observe(canvas);
    window.addEventListener('resize', resize);
    resize();
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', resize);
    };
  }, [widgetScale]);

  // The pause is read from a ref and is not a dependency: a change of it is
  // not a new sample, and recording one would put the same input in twice.
  useEffect(() => {
    const drawing = drawingRef.current;
    if (!drawing) return;
    drawing.configure(settings);
    drawing.sample(input);
    if (pausedRef.current) return;
    const handle = requestAnimationFrame(() => {
      pendingFrameRef.current = 0;
      perfMetrics.measure('inputTraceFrame', drawing.paint);
    });
    pendingFrameRef.current = handle;
    return () => {
      cancelAnimationFrame(handle);
      if (pendingFrameRef.current === handle) pendingFrameRef.current = 0;
    };
  }, [input, settings]);

  // One paint when the pause ends, of everything sampled during it. After
  // the sampling effect: a sample that arrives with the end of the pause has
  // asked for its own frame, and that frame is the one paint.
  useEffect(() => {
    const resumed = wasPausedRef.current && !paintingPaused;
    wasPausedRef.current = paintingPaused;
    const drawing = drawingRef.current;
    if (resumed && drawing && pendingFrameRef.current === 0) {
      perfMetrics.measure('inputTraceFrame', drawing.paint);
    }
  }, [paintingPaused]);

  return (
    <canvas ref={canvasRef} className="block w-full h-full min-w-0 min-h-0" />
  );
});
InputTrace.displayName = 'InputTrace';
