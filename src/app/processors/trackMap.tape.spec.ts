import { beforeAll, describe, expect, it } from 'vitest';
import { lmuTapeAvailable } from '../../testing/lmuTape';
import {
  playLmuTapeTrackMap,
  type LmuTapeMapCar,
  type LmuTapeTrackMap,
} from '../../testing/lmuTapeTrackMap';

/**
 * The Track Map on a recorded Le Mans Ultimate race: four minutes from the
 * green flag at Laguna Seca, 38 cars in three classes, the player in slot 0.
 * Nobody stops and no yellow comes out.
 *
 * The map has no processor of its own. It is drawn in the renderer from the
 * outline the session carries and the lap fractions of `track-state.snapshot`
 * by pure functions; the tape harness plays the recording through the real
 * mapping and the real track-state processor, twenty-five times a second as
 * the widget reads it, and places every car with those functions. The
 * outline is the one bundled for the circuit, which is what the session
 * carries for a circuit nothing has been stored for.
 *
 * Distances are in the drawing's own units: the outline is laid out in a
 * 1920 by 1080 box, and one unit of this circuit is 0.86 m.
 *
 * Windows only, like the other tape specs.
 */

const CARS = 38;
const PLAYER = 0;
/** Samples a bundled outline holds: one every 512th of a lap. */
const SAMPLES = 512;

interface Point {
  x: number;
  y: number;
}

/** One replay for both halves of the spec: it takes eight seconds. */
let replay: Promise<LmuTapeTrackMap> | undefined;
const playOnce = (): Promise<LmuTapeTrackMap> =>
  (replay ??= playLmuTapeTrackMap());

const median = (values: readonly number[]): number =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

/** How far a point is from the stretch between two others. */
const distanceToSegment = (point: Point, from: Point, to: Point): number => {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = dx * dx + dy * dy;
  const share =
    length > 0
      ? Math.min(
          Math.max(
            ((point.x - from.x) * dx + (point.y - from.y) * dy) / length,
            0
          ),
          1
        )
      : 0;
  return Math.hypot(
    point.x - from.x - share * dx,
    point.y - from.y - share * dy
  );
};

/**
 * Where on a closed line a point is, found from the point alone: the
 * distance along the line to the place on it nearest the point, and how far
 * from the line the point is.
 */
const locate = (
  line: readonly Point[],
  point: Point
): { along: number; off: number } => {
  let best = { along: 0, off: Number.POSITIVE_INFINITY };
  let travelled = 0;
  for (let index = 0; index < line.length; index += 1) {
    const from = line[index];
    const to = line[(index + 1) % line.length];
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.hypot(dx, dy);
    const share =
      length > 0
        ? Math.min(
            Math.max(
              ((point.x - from.x) * dx + (point.y - from.y) * dy) /
                (length * length),
              0
            ),
            1
          )
        : 0;
    const off = Math.hypot(
      point.x - from.x - share * dx,
      point.y - from.y - share * dy
    );
    if (off < best.off) best = { along: travelled + share * length, off };
    travelled += length;
  }
  return best;
};

const lengthOf = (line: readonly Point[]): number =>
  line.reduce(
    (total, from, index) =>
      total +
      Math.hypot(
        line[(index + 1) % line.length].x - from.x,
        line[(index + 1) % line.length].y - from.y
      ),
    0
  );

describe.skipIf(!lmuTapeAvailable())(
  'the Track Map on a recorded LMU race at Laguna Seca',
  () => {
    let tape: LmuTapeTrackMap;
    /** The outline's own samples, without the one that closes it. */
    let outline: Point[];
    let outlineLength: number;

    beforeAll(async () => {
      tape = await playOnce();
      const points = tape.drawing?.active.trackPathPoints;
      if (!points) throw new Error('No outline for the recorded circuit');
      outline = points.slice(0, -1);
      outlineLength = lengthOf(outline);
    }, 120_000);

    it('draws from the outline bundled for the circuit', () => {
      const drawing = tape.drawing;

      expect(tape.frames).toBeGreaterThan(14_000);
      expect(tape.trackName).toMatch(/Laguna Seca/);
      // The 512 samples and the first again, which closes the lap.
      expect(drawing?.active.trackPathPoints).toHaveLength(SAMPLES + 1);
      expect(drawing?.active.trackPathPoints?.[SAMPLES]).toEqual(outline[0]);
      expect(drawing?.active.totalLength).toBe(SAMPLES);
      // The line and the direction are the outline's own.
      expect(drawing?.startFinish.point).toEqual({ ...outline[0], length: 0 });
      expect(drawing?.startFinish.direction).toBe('anticlockwise');
    });

    it('places all 38 cars on every update, twenty-five times a second', () => {
      // Four minutes of the channel.
      expect(tape.ticks.length).toBeGreaterThan(5900);
      for (const tick of tape.ticks) {
        expect(tick.entered).toBe(CARS);
        expect(tick.cars).toHaveLength(CARS);
        for (const car of tick.cars) {
          expect(car.progress).toBeGreaterThanOrEqual(0);
          expect(car.progress).toBeLessThanOrEqual(1);
        }
      }
    });

    it('puts every car on the outline, between the two samples its lap fraction falls between', () => {
      let worst = 0;
      for (const tick of tape.ticks) {
        for (const car of tick.cars) {
          expect(Number.isFinite(car.x) && Number.isFinite(car.y)).toBe(true);
          // Sample i is i / 512 of the way round; a whole lap is the line.
          const sample = Math.floor((car.progress % 1) * SAMPLES);
          worst = Math.max(
            worst,
            distanceToSegment(
              car,
              outline[sample],
              outline[(sample + 1) % SAMPLES]
            )
          );
        }
      }
      // To rounding: nothing is drawn beside the road.
      expect(worst).toBeLessThan(1e-6);
    });

    it('keeps the cars in the order of their lap fractions round the outline', () => {
      let checked = 0;
      let furthest = 0;
      // Five times a second is every pass on the recording.
      for (let index = 0; index < tape.ticks.length; index += 5) {
        const byFraction = [...tape.ticks[index].cars].sort(
          (a, b) => (a.progress % 1) - (b.progress % 1)
        );
        let previous = -1;
        for (const car of byFraction) {
          // Found from where the car was drawn, not from its fraction.
          const { along, off } = locate(outline, car);
          expect(off).toBeLessThan(1e-6);
          // A car on the last hair of the closing stretch may be found at
          // the very start of the line instead: the same place.
          const place = outlineLength - along < 1e-6 ? 0 : along;
          expect(place).toBeGreaterThanOrEqual(previous - 1e-6);
          previous = place;
          const apart = Math.abs(place / outlineLength - (car.progress % 1));
          furthest = Math.max(furthest, Math.min(apart, 1 - apart));
          checked += 1;
        }
      }

      expect(checked).toBeGreaterThan(40_000);
      // And each is as far round the drawing as it is round the lap. The
      // outline is stored as samples evenly spaced along a line that stops
      // three spacings short of where it began; read as one part in 512
      // like the others, that closing stretch had cars up to 0.4 % of a
      // lap from here. The reader gives it the share of the lap it is of
      // the line, and what is left is a corner cut between two samples.
      expect(furthest).toBeLessThan(0.0005);
    });

    it('moves no car further than a car can go between two updates, the line included', () => {
      const before = new Map<number, LmuTapeMapCar>();
      let longest = 0;
      let crossings = 0;
      for (const tick of tape.ticks) {
        for (const car of tick.cars) {
          const last = before.get(car.carIdx);
          if (last) {
            longest = Math.max(
              longest,
              Math.hypot(car.x - last.x, car.y - last.y)
            );
            if (last.progress > 0.9 && car.progress < 0.1) crossings += 1;
          }
          before.set(car.carIdx, car);
        }
      }

      // Every car crosses the line on the recording, most of them twice.
      expect(crossings).toBeGreaterThan(CARS);
      // The longest step is the stretch that closes the outline, 26 units,
      // taken in one update by a car whose fraction rounds up to a whole
      // lap. One percent of the outline is 42.
      expect(longest).toBeLessThan(outlineLength * 0.01);
    });

    it("marks the player's own car, and finds nobody in the pit lane", () => {
      for (const tick of tape.ticks) {
        const marked = tick.cars.filter((car) => car.isFocus);
        expect(marked).toHaveLength(1);
        expect(marked[0].carIdx).toBe(PLAYER);
        // Nobody stops on the recording, so nobody is greyed.
        expect(tick.cars.some((car) => car.onPitRoad)).toBe(false);
      }
    });

    describe('against the lap the player drove', () => {
      /** The recorded lap's samples, the first among them. */
      let driven: Point[];
      let bundled: Point[];

      beforeAll(() => {
        const recorded = tape.recorded?.active.trackPathPoints;
        const points = tape.bundled?.active.trackPathPoints;
        if (!recorded || !points) throw new Error('No lap was recorded');
        // The map the app records for a circuit with none bundled. It is
        // made of the second lap, the first the car begins at the line: the
        // lap from the green flag begins on the grid, 139 m short of it,
        // and the recorder takes nothing of that one.
        driven = recorded;
        bundled = points;
      });

      it('begins at the line, not where the car stood on the grid', () => {
        // The grid slot is 160 units back down the straight. Recorded as
        // the lap's first sample it drew a spur from the line to the slot
        // and put the start and finish mark there.
        const start = driven[0];
        const line = bundled[0];
        expect(Math.hypot(start.x - line.x, start.y - line.y)).toBeLessThan(10);
        expect(locate(bundled, start).off).toBeLessThan(5);
        const mark = tape.recorded?.startFinish.point;
        expect(mark).toMatchObject({ x: start.x, y: start.y });
      });

      it('is the same road: the driven line lies on the bundled outline', () => {
        const off = driven.map((point) => locate(bundled, point).off);

        // A couple of metres, which is a car's place across the road, and
        // nowhere more than the width of it and its run-off.
        expect(median(off)).toBeLessThan(5);
        expect(Math.max(...off)).toBeLessThan(20);
      });

      it('is the same way up and the same way round, from the same line', () => {
        const apart = (other: (index: number) => Point) =>
          median(
            driven.map((point, index) => {
              const match = other(index);
              return Math.hypot(match.x - point.x, match.y - point.y);
            })
          );

        // Sample for sample the lap is on the outline the cars are drawn
        // on, to a spacing at the median: what is left is the difference
        // between the line the car took and the one the outline was made
        // from. The stored samples, read as 512 equal parts of a lap, were
        // twice as far off, and 18 units out by the last of them.
        expect(apart((index) => outline[index])).toBeLessThan(10);
        expect(apart((index) => bundled[index])).toBeGreaterThan(14);
        const last = SAMPLES - 1;
        expect(
          Math.hypot(
            driven[last].x - outline[last].x,
            driven[last].y - outline[last].y
          )
        ).toBeLessThan(3);
        // Flipped left to right or top to bottom, turned half round, or
        // driven the other way, the bundled outline is hundreds of units
        // from the lap: none of those is what the game drives.
        const mirrored = (index: number) => ({
          x: 1920 - bundled[index].x,
          y: bundled[index].y,
        });
        const upsideDown = (index: number) => ({
          x: bundled[index].x,
          y: 1080 - bundled[index].y,
        });
        const turned = (index: number) => ({
          x: 1920 - bundled[index].x,
          y: 1080 - bundled[index].y,
        });
        const backwards = (index: number) =>
          bundled[(SAMPLES - index) % SAMPLES];
        for (const other of [mirrored, upsideDown, turned, backwards]) {
          expect(apart(other)).toBeGreaterThan(400);
        }
      });
    });
  }
);

describe.skipIf(!lmuTapeAvailable())(
  'the sectors the Track Map draws on a recorded LMU race at Laguna Seca',
  () => {
    let tape: LmuTapeTrackMap;

    beforeAll(async () => {
      tape = await playOnce();
    }, 120_000);

    it('draws none until a clean lap has shown where they start', () => {
      // The lap from the rolling start is not one driven from the line; the
      // next is, and is kept as the player crosses the line at 319.5 s.
      const learnedAt = tape.ticks.find((tick) => tick.sectorStarts !== null);

      expect(learnedAt?.sessionTime).toBeGreaterThan(319.4);
      expect(learnedAt?.sessionTime).toBeLessThan(319.7);
      // Three minutes of the map without a tick or a coloured sector.
      const before = tape.ticks.filter(
        (tick) => tick.sessionTime < 319.4
      ).length;
      expect(before).toBeGreaterThan(4400);
    });

    it('then draws them 39.0 % and 79.2 % of the way round, not at thirds', () => {
      const starts = tape.ticks.at(-1)?.sectorStarts;

      expect(starts).toHaveLength(3);
      expect(starts?.[0]).toBe(0);
      expect(starts?.[1]).toBeCloseTo(0.39, 2);
      expect(starts?.[2]).toBeCloseTo(0.792, 2);
      // Thirds would be 200 m and 450 m out at this circuit.
      expect(Math.abs((starts?.[1] ?? 0) - 1 / 3)).toBeGreaterThan(0.05);
      expect(Math.abs((starts?.[2] ?? 0) - 2 / 3)).toBeGreaterThan(0.12);
    });

    it('places them where every crossing on the recording agrees, to a metre', () => {
      const starts = tape.ticks.at(-1)?.sectorStarts ?? [];
      const second = tape.sectorEntries.filter(
        (entry) => entry.sectorIdx === 1
      );
      const third = tape.sectorEntries.filter((entry) => entry.sectorIdx === 2);

      // Three laps reach the second sector and two the third.
      expect(second).toHaveLength(3);
      expect(third).toHaveLength(2);
      for (const entry of tape.sectorEntries) {
        // 0.0003 of this lap is 1.1 m.
        expect(
          Math.abs(entry.crossedAt - starts[entry.sectorIdx])
        ).toBeLessThan(0.0003);
      }
    });

    it('takes out what the sim reporting the crossing late would add', () => {
      // The index moves in the scoring update after the crossing, up to a
      // fifth of a second later: read where the car is on that frame, the
      // start would be drawn up to 11 m too far round.
      const late = tape.sectorEntries.map(
        (entry) => entry.reportedAt - entry.crossedAt
      );

      for (const entry of tape.sectorEntries) {
        expect(entry.lagSeconds).toBeGreaterThan(0);
        expect(entry.lagSeconds).toBeLessThanOrEqual(0.2);
      }
      expect(Math.min(...late)).toBeGreaterThan(0);
      expect(Math.max(...late)).toBeGreaterThan(0.002);
      expect(Math.max(...late)).toBeLessThan(0.0035);
    });
  }
);
