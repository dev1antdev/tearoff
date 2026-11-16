import { describe, expect, it } from 'vitest';
import type { Driver } from '@irdashies/types';
import {
  classIdsByCar,
  classNeighbourhood,
  classNeighbours,
  classPositionsByCar,
} from './classNeighbours';

/**
 * `classNeighbours` itself is held to its cases in the rivals box's spec
 * (`src/frontend/domain/standings/classRivals.spec.ts`), which reads it
 * through the renderer's own module. These are the cases of the wider
 * neighbourhood, and that the two agree on who is next door.
 */

const GT = 1;
const PROTOTYPE = 2;

/** Six GTs in slots 0 to 5 and two prototypes in slots 6 and 7. */
const CLASSES = [GT, GT, GT, GT, GT, GT, PROTOTYPE, PROTOTYPE];
/** The class order of the GTs is their slot order; the prototypes lead. */
const PLACES = [1, 2, 3, 4, 5, 6, 1, 2];

describe('classNeighbourhood', () => {
  it('gives the cars of the class each way, the nearest place first', () => {
    expect(
      classNeighbourhood(3, CLASSES, PLACES, { ahead: 3, behind: 3 })
    ).toEqual({ ahead: [2, 1, 0], behind: [4, 5] });
  });

  it('takes no more than it is asked for on either side', () => {
    expect(
      classNeighbourhood(3, CLASSES, PLACES, { ahead: 1, behind: 1 })
    ).toEqual({ ahead: [2], behind: [4] });
    expect(
      classNeighbourhood(3, CLASSES, PLACES, { ahead: 0, behind: 2 })
    ).toEqual({ ahead: [], behind: [4, 5] });
  });

  it('never takes a car of another class, whatever its place', () => {
    const around = classNeighbourhood(0, CLASSES, PLACES, {
      ahead: 3,
      behind: 3,
    });
    expect(around).toEqual({ ahead: [], behind: [1, 2, 3] });
    expect(
      classNeighbourhood(6, CLASSES, PLACES, { ahead: 3, behind: 3 })
    ).toEqual({ ahead: [], behind: [7] });
  });

  it('goes by place, not by slot', () => {
    // The GTs in the order 4, 0, 5, 2, 1, 3.
    const places = [2, 5, 4, 6, 1, 3, 1, 2];
    expect(
      classNeighbourhood(2, CLASSES, places, { ahead: 3, behind: 3 })
    ).toEqual({ ahead: [5, 0, 4], behind: [1, 3] });
  });

  it('passes over a car that is not running, and the next one takes its row', () => {
    const retired = new Set([2, 4]);
    expect(
      classNeighbourhood(3, CLASSES, PLACES, {
        ahead: 2,
        behind: 2,
        isRunning: (carIdx) => !retired.has(carIdx),
      })
    ).toEqual({ ahead: [1, 0], behind: [5] });
  });

  it('leaves out a car with no place, and has nothing for a focus car without one', () => {
    const places = [1, 0, 3, 4, undefined, 6, 1, 2];
    expect(
      classNeighbourhood(3, CLASSES, places, { ahead: 3, behind: 3 })
    ).toEqual({ ahead: [2, 0], behind: [5] });
    expect(
      classNeighbourhood(1, CLASSES, places, { ahead: 3, behind: 3 })
    ).toEqual({ ahead: [], behind: [] });
    // A slot that is not racing has no class.
    expect(
      classNeighbourhood(9, CLASSES, PLACES, { ahead: 3, behind: 3 })
    ).toEqual({ ahead: [], behind: [] });
  });

  it('names next door the cars `classNeighbours` names', () => {
    for (let focus = 0; focus < CLASSES.length; focus += 1) {
      const next = classNeighbours(focus, CLASSES, PLACES);
      const around = classNeighbourhood(focus, CLASSES, PLACES, {
        ahead: 1,
        behind: 1,
      });
      expect(around.ahead[0] ?? -1, `car ${focus}`).toBe(next.ahead);
      expect(around.behind[0] ?? -1, `car ${focus}`).toBe(next.behind);
    }
  });
});

describe('the inputs of the neighbour rule', () => {
  it('reads each car’s class from the grid, without the pace car or a spectator', () => {
    const drivers = [
      { CarIdx: 0, CarClassID: GT },
      { CarIdx: 2, CarClassID: PROTOTYPE },
      { CarIdx: 3, CarClassID: 9, CarIsPaceCar: 1 },
      { CarIdx: 4, CarClassID: GT, IsSpectator: 1 },
    ] as unknown as Driver[];
    expect(classIdsByCar(drivers)).toEqual([GT, undefined, PROTOTYPE]);
    expect(classIdsByCar(undefined)).toEqual([]);
  });

  it('takes the live class place where there is one, else the sim’s', () => {
    expect(
      classPositionsByCar({
        liveClassPosition: [2, undefined, 1],
        carIdxClassPosition: [1, 3, 2, 4],
      })
    ).toEqual([2, 3, 1, 4]);
  });
});
