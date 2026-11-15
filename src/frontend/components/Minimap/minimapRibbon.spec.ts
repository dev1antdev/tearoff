import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildTrackGeometry,
  pointAtProgress,
  type TrackGeometry,
} from '@irdashies/domain/track/trackGeometry';
import { MinimapRibbon } from './minimapRibbon';

type Segment = [fromX: number, fromY: number, toX: number, toY: number];

/** Stands in for Path2D, which jsdom lacks, and remembers what it was given. */
class RecordedPath {
  segments: Segment[] = [];
  runs = 0;
  closed = false;
  private x = 0;
  private y = 0;
  moveTo(x: number, y: number) {
    this.runs += 1;
    this.x = x;
    this.y = y;
  }
  lineTo(x: number, y: number) {
    this.segments.push([this.x, this.y, x, y]);
    this.x = x;
    this.y = y;
  }
  closePath() {
    this.closed = true;
  }
}
const recorded = (path: Path2D) => path as unknown as RecordedPath;

/**
 * A lap of two long straights 60 units apart joined by half circles, so that
 * the far straight is in reach from the near one: 3 km, 1500 samples.
 */
const stadium = (): TrackGeometry => {
  const points: { x: number; y: number }[] = [];
  const straight = 600;
  const radius = 30;
  for (let step = 0; step <= 300; step += 1) {
    points.push({ x: (step / 300) * straight, y: 0 });
  }
  for (let step = 1; step <= 60; step += 1) {
    const angle = -Math.PI / 2 + (step / 60) * Math.PI;
    points.push({
      x: straight + radius * Math.cos(angle),
      y: radius + radius * Math.sin(angle),
    });
  }
  for (let step = 1; step <= 300; step += 1) {
    points.push({ x: straight - (step / 300) * straight, y: radius * 2 });
  }
  for (let step = 1; step <= 60; step += 1) {
    const angle = Math.PI / 2 + (step / 60) * Math.PI;
    points.push({
      x: radius * Math.cos(angle),
      y: radius + radius * Math.sin(angle),
    });
  }
  const geometry = buildTrackGeometry(
    {
      trackPathPoints: points,
      totalLength: points.length - 1,
      startFinishLength: 0,
      direction: 'anticlockwise',
    },
    3000
  );
  if (!geometry) throw new Error('No geometry for the test lap');
  return geometry;
};

const distanceToSegment = (
  x: number,
  y: number,
  [fromX, fromY, toX, toY]: Segment
): number => {
  const alongX = toX - fromX;
  const alongY = toY - fromY;
  const lengthSquared = alongX * alongX + alongY * alongY;
  const along =
    lengthSquared > 0
      ? Math.min(
          1,
          Math.max(
            0,
            ((x - fromX) * alongX + (y - fromY) * alongY) / lengthSquared
          )
        )
      : 0;
  return Math.hypot(x - fromX - alongX * along, y - fromY - alongY * along);
};

/** Every segment of the lap, the closing one included. */
const lapSegments = (geometry: TrackGeometry): Segment[] =>
  Array.from({ length: geometry.count }, (_, index) => {
    const next = (index + 1) % geometry.count;
    return [
      geometry.xs[index],
      geometry.ys[index],
      geometry.xs[next],
      geometry.ys[next],
    ];
  });

const key = (segment: Segment) => segment.join(',');

/** The segments of the lap within `reach` of a point that `path` lacks. */
const missing = (
  geometry: TrackGeometry,
  path: Path2D,
  x: number,
  y: number,
  reach: number
): Segment[] => {
  const held = new Set(recorded(path).segments.map(key));
  return lapSegments(geometry).filter(
    (segment) =>
      distanceToSegment(x, y, segment) <= reach && !held.has(key(segment))
  );
};

describe('MinimapRibbon', () => {
  let geometry: TrackGeometry;
  const at = (progress: number) =>
    pointAtProgress(geometry, progress, { x: 0, y: 0 });

  beforeEach(() => {
    vi.stubGlobal('Path2D', RecordedPath);
    geometry = stadium();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('holds every segment in reach of the car, and little of the lap besides', () => {
    const ribbon = new MinimapRibbon();
    // Half way down the first straight, reaching across to the second.
    const centre = at(0.2);
    const path = ribbon.pathFor(geometry, centre.x, centre.y, 80);

    expect(missing(geometry, path, centre.x, centre.y, 80)).toEqual([]);
    // Two runs: this straight, and the stretch of the other one beside it.
    expect(recorded(path).runs).toBe(2);
    expect(recorded(path).closed).toBe(false);
    expect(recorded(path).segments.length).toBeLessThan(geometry.count / 3);
    // Nothing from the far end of the lap, well out of reach.
    for (const segment of recorded(path).segments) {
      expect(
        distanceToSegment(centre.x, centre.y, segment)
      ).toBeLessThanOrEqual(80 * 1.25 + 1e-9);
    }
  });

  it('is built once and reused while the car stays inside it, wherever the map turns', () => {
    const ribbon = new MinimapRibbon();
    const start = at(0.2);
    const path = ribbon.pathFor(geometry, start.x, start.y, 80);

    // 0.25 of the reach is the travel it allows: 20 units, about 30 m here.
    for (let metres = 1; metres <= 30; metres += 1) {
      const centre = at(0.2 + metres / 3000);
      const again = ribbon.pathFor(geometry, centre.x, centre.y, 80);
      expect(again).toBe(path);
      // Still whole round where the car is now.
      expect(missing(geometry, again, centre.x, centre.y, 80)).toEqual([]);
    }
  });

  it('is built again once the car has driven out of it', () => {
    const ribbon = new MinimapRibbon();
    const start = at(0.2);
    const path = ribbon.pathFor(geometry, start.x, start.y, 80);
    const further = at(0.2 + 60 / 3000);
    const next = ribbon.pathFor(geometry, further.x, further.y, 80);

    expect(next).not.toBe(path);
    expect(missing(geometry, next, further.x, further.y, 80)).toEqual([]);
    // And that one is kept in turn.
    expect(ribbon.pathFor(geometry, further.x, further.y, 80)).toBe(next);
  });

  it('is built again for another range or track width, and for another track', () => {
    const ribbon = new MinimapRibbon();
    const centre = at(0.2);
    const path = ribbon.pathFor(geometry, centre.x, centre.y, 80);

    const wider = ribbon.pathFor(geometry, centre.x, centre.y, 120);
    expect(wider).not.toBe(path);
    expect(missing(geometry, wider, centre.x, centre.y, 120)).toEqual([]);

    const narrower = ribbon.pathFor(geometry, centre.x, centre.y, 60);
    expect(narrower).not.toBe(wider);
    expect(recorded(narrower).segments.length).toBeLessThan(
      recorded(wider).segments.length
    );

    const otherTrack = stadium();
    expect(ribbon.pathFor(otherTrack, centre.x, centre.y, 60)).not.toBe(
      narrower
    );
  });

  it('draws a run through the start/finish line in one piece', () => {
    const ribbon = new MinimapRibbon();
    const line = at(0);
    // Short of the other straight, so this is the only run.
    const path = ribbon.pathFor(geometry, line.x, line.y, 40);

    expect(recorded(path).runs).toBe(1);
    expect(missing(geometry, path, line.x, line.y, 40)).toEqual([]);
    const closing = lapSegments(geometry)[geometry.count - 1];
    expect(recorded(path).segments.map(key)).toContain(key(closing));
  });

  it('is the whole lap, closed, when all of it is in reach', () => {
    const ribbon = new MinimapRibbon();
    const centre = at(0.2);
    const path = ribbon.pathFor(geometry, centre.x, centre.y, 2000);

    expect(recorded(path).closed).toBe(true);
    expect(recorded(path).runs).toBe(1);
    // The closing segment is the path's own: one fewer line than samples.
    expect(recorded(path).segments).toHaveLength(geometry.count - 1);
  });

  it('is empty when the car is nowhere near the track', () => {
    const ribbon = new MinimapRibbon();
    const path = ribbon.pathFor(geometry, 5000, 5000, 80);

    expect(recorded(path).segments).toEqual([]);
  });
});
