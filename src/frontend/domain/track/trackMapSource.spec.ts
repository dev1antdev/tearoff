import { describe, expect, it } from 'vitest';
import { resolveTrackMapSource } from './trackMapSource';
import type { TrackDrawing } from './trackDrawing';

const outline: TrackDrawing = {
  active: { inside: 'M0,0 L1,0 L1,1 Z', outside: 'M0,0 L1,0 L1,1 Z' },
  startFinish: { point: { x: 0, y: 0, length: 0 }, direction: 'anticlockwise' },
};

describe('resolveTrackMapSource', () => {
  it('draws an iRacing track from the drawing shipped for its id', () => {
    expect(resolveTrackMapSource('iracing', null)).toEqual({
      kind: 'drawing',
    });
  });

  it('does the same while no simulator is known: demo mode, Storybook', () => {
    expect(resolveTrackMapSource(null, null)).toEqual({ kind: 'drawing' });
    expect(resolveTrackMapSource(undefined, null)).toEqual({
      kind: 'drawing',
    });
  });

  it("draws a Le Mans Ultimate circuit from the session's own outline", () => {
    expect(resolveTrackMapSource('lmu', outline)).toEqual({
      kind: 'outline',
      drawing: outline,
    });
  });

  it('never looks a Le Mans Ultimate circuit up among the drawings', () => {
    // Its track id is a hash of its name, which names no drawing: without
    // an outline there is nothing to draw, and the widget says so.
    expect(resolveTrackMapSource('lmu', null)).toEqual({ kind: 'noOutline' });
  });

  it('takes an outline as settling it before the simulator is known', () => {
    // Only a Le Mans Ultimate session carries one, and the session can
    // arrive before the main process has said which sim is running.
    expect(resolveTrackMapSource(null, outline).kind).toBe('outline');
    expect(resolveTrackMapSource('iracing', outline).kind).toBe('outline');
  });

  it('hands back the same object for the same answer', () => {
    // A new object each render would remount whatever is keyed on it.
    expect(resolveTrackMapSource('iracing', null)).toBe(
      resolveTrackMapSource(null, null)
    );
    expect(resolveTrackMapSource('lmu', null)).toBe(
      resolveTrackMapSource('lmu', null)
    );
  });
});
