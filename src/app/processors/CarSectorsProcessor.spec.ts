import { describe, expect, it } from 'vitest';
import type { Session, Telemetry } from '@irdashies/types';
import { CarSectorsProcessor } from './CarSectorsProcessor';

/**
 * The sector channel's own rules, on staged frames in the shape the Le Mans
 * Ultimate mapping writes them. What the sim really publishes, and when, is
 * in CarSectorsProcessor.tape.spec.ts.
 */

type Times = readonly (number | null)[];
const NONE: Times = [null, null, null];

/** One car on one frame. Everything left out is a car with no time yet. */
interface CarInput {
  current?: Times;
  last?: Times;
  /** As the mapping writes the sim's bests: see the processor's comment. */
  simBest?: Times;
}

interface FrameInput {
  time: number;
  cars: readonly CarInput[];
  sessionNum?: number;
  /** False writes a frame without the three keys, as iRacing's are. */
  lmu?: boolean;
}

const frame = ({
  time,
  cars,
  sessionNum = 0,
  lmu = true,
}: FrameInput): Telemetry => {
  const out: Record<string, { value: unknown[] }> = {
    SessionTime: { value: [time] },
    SessionNum: { value: [sessionNum] },
  };
  if (lmu) {
    out.LmuCarIdxCurrentSectorTimes = {
      value: cars.flatMap((car) => [...(car.current ?? NONE)]),
    };
    out.LmuCarIdxLastSectorTimes = {
      value: cars.flatMap((car) => [...(car.last ?? NONE)]),
    };
    out.LmuCarIdxBestSectorTimes = {
      value: cars.flatMap((car) => [...(car.simBest ?? NONE)]),
    };
  }
  return out as unknown as Telemetry;
};

interface Entry {
  classId: number;
  number?: string;
  paceCar?: boolean;
  spectator?: boolean;
}

/** A session listing one entry a slot; `null` leaves the slot out. */
const session = (entries: readonly (Entry | null)[]): Session =>
  ({
    DriverInfo: {
      Drivers: entries.flatMap((entry, carIdx) =>
        entry
          ? [
              {
                CarIdx: carIdx,
                CarClassID: entry.classId,
                CarPath: 'car',
                CarNumber: entry.number ?? `${carIdx + 1}`,
                CarIsPaceCar: entry.paceCar ? 1 : 0,
                IsSpectator: entry.spectator ? 1 : 0,
              },
            ]
          : []
      ),
    },
  }) as unknown as Session;

/** Three cars: two of class 7, one of class 9. */
const FIELD = [{ classId: 7 }, { classId: 7 }, { classId: 9 }];

const started = (entries: readonly (Entry | null)[] = FIELD) => {
  const processor = new CarSectorsProcessor();
  processor.onLifecycle({ type: 'enter', replay: false });
  processor.init(session(entries));
  return processor;
};

/** A class's three bests, by its id. */
const classBest = (processor: CarSectorsProcessor, classId: number) => {
  const { classIds, classBest: bests } = processor.snapshot();
  const slot = classIds.indexOf(classId);
  return slot < 0 ? undefined : bests.slice(slot * 3, slot * 3 + 3);
};

describe('a frame without sector times for the field', () => {
  it('says the sim gives none, and carries nothing', () => {
    const processor = started();
    const before = processor.snapshot().version;

    processor.onFrame(frame({ time: 10, cars: [{}, {}, {}], lmu: false }));

    expect(processor.snapshot()).toMatchObject({
      available: false,
      current: [],
      last: [],
      best: [],
      classIds: [],
      classBest: [],
      sessionNum: 0,
    });
    // Said once, with the session it is about, and not again.
    const version = processor.snapshot().version;
    expect(version).toBeGreaterThan(before);
    processor.onFrame(frame({ time: 10.5, cars: [{}, {}, {}], lmu: false }));
    expect(processor.snapshot().version).toBe(version);
  });
});

describe('the sector times of every car', () => {
  it('are the lap under way and the last lap, to the millisecond', () => {
    const processor = started();

    processor.onFrame(
      frame({
        time: 100,
        cars: [
          {
            current: [29.39355, null, null],
            last: [36.0293426, 31.5898437, 17.3326568],
          },
          { current: [30.1, 31.2, null] },
          {},
        ],
      })
    );

    const snapshot = processor.snapshot();
    expect(snapshot.available).toBe(true);
    expect(snapshot.current).toEqual([
      29.394,
      null,
      null,
      30.1,
      31.2,
      null,
      null,
      null,
      null,
    ]);
    expect(snapshot.last).toEqual([
      36.029,
      31.59,
      17.333,
      null,
      null,
      null,
      null,
      null,
      null,
    ]);
  });

  it('read a zero, a negative figure and nonsense as no time', () => {
    const processor = started();

    processor.onFrame(
      frame({
        time: 100,
        cars: [
          { last: [0, -1, Number.NaN] },
          {
            last: [Number.POSITIVE_INFINITY, 31.2, 17.3],
            current: ['29.4' as unknown as number, null, null],
          },
          {},
        ],
      })
    );

    expect(processor.snapshot().last.slice(0, 6)).toEqual([
      null,
      null,
      null,
      null,
      31.2,
      17.3,
    ]);
    expect(processor.snapshot().current.slice(3, 6)).toEqual(NONE);
    expect(processor.snapshot().best.slice(0, 6)).toEqual([
      null,
      null,
      null,
      null,
      31.2,
      17.3,
    ]);
  });
});

describe('the best of each sector', () => {
  it('is the quickest time seen, from the lap under way as from a finished one', () => {
    const processor = started();

    // The first lap, finished.
    processor.onFrame(
      frame({ time: 100, cars: [{ last: [36.0, 31.6, 17.4] }, {}, {}] })
    );
    expect(processor.snapshot().best.slice(0, 3)).toEqual([36.0, 31.6, 17.4]);

    // A quicker first sector on the lap after: the best at once.
    processor.onFrame(
      frame({
        time: 130,
        cars: [
          { last: [36.0, 31.6, 17.4], current: [29.4, null, null] },
          {},
          {},
        ],
      })
    );
    expect(processor.snapshot().best.slice(0, 3)).toEqual([29.4, 31.6, 17.4]);

    // That lap finished: a slower second sector and a quicker third.
    processor.onFrame(
      frame({ time: 180, cars: [{ last: [29.4, 31.9, 17.2] }, {}, {}] })
    );
    expect(processor.snapshot().best.slice(0, 3)).toEqual([29.4, 31.6, 17.2]);

    // A slower lap moves nothing.
    const version = processor.snapshot().version;
    processor.onFrame(
      frame({ time: 260, cars: [{ last: [29.9, 31.7, 17.5] }, {}, {}] })
    );
    expect(processor.snapshot().best.slice(0, 3)).toEqual([29.4, 31.6, 17.2]);
    expect(processor.snapshot().last.slice(0, 3)).toEqual([29.9, 31.7, 17.5]);
    expect(processor.snapshot().version).toBeGreaterThan(version);
  });

  it('takes the first sector the sim calls best, and not what the mapping makes of its second and third', () => {
    const processor = started();

    // Two laps were driven before anything read the channel. The sim's best
    // first sector is the first lap's; its best time to the end of the
    // second is the second lap's. Taken apart they give a "second sector"
    // of 30.0 that nobody drove, and a third likewise.
    processor.onFrame(
      frame({
        time: 300,
        cars: [
          {
            last: [29.9, 30.5, 17.5],
            simBest: [29.4, 30.0, 17.0],
          },
          {},
          {},
        ],
      })
    );

    expect(processor.snapshot().best.slice(0, 3)).toEqual([29.4, 30.5, 17.5]);
  });

  it('is kept for each class as the quickest of its cars', () => {
    const processor = started();

    processor.onFrame(frame({ time: 90, cars: [{}, {}, {}] }));
    // Both classes are listed before either has a time.
    expect([...processor.snapshot().classIds].sort()).toEqual([7, 9]);
    expect(classBest(processor, 7)).toEqual(NONE);
    expect(classBest(processor, 9)).toEqual(NONE);

    processor.onFrame(
      frame({
        time: 100,
        cars: [
          { last: [29.4, 30.5, 17.5] },
          { last: [29.6, 30.2, 17.6] },
          { current: [33.1, null, null] },
        ],
      })
    );

    // The quickest of each sector, which need not be one car's.
    expect(classBest(processor, 7)).toEqual([29.4, 30.2, 17.5]);
    expect(classBest(processor, 9)).toEqual([33.1, null, null]);
  });

  it('counts no pace car and no spectator among a class', () => {
    const processor = started([
      { classId: 7 },
      { classId: 7, paceCar: true },
      { classId: 11, spectator: true },
    ]);

    processor.onFrame(
      frame({
        time: 100,
        cars: [
          { last: [29.4, 30.5, 17.5] },
          { last: [20, 20, 20] },
          { last: [21, 21, 21] },
        ],
      })
    );

    expect(processor.snapshot().classIds).toEqual([7]);
    expect(classBest(processor, 7)).toEqual([29.4, 30.5, 17.5]);
  });

  it('follows a car into another class', () => {
    const processor = started();
    processor.onFrame(
      frame({
        time: 100,
        cars: [
          { last: [29.4, 30.5, 17.5] },
          { last: [29.6, 30.2, 17.6] },
          { last: [33.1, 35.2, 19.4] },
        ],
      })
    );
    const version = processor.snapshot().version;

    // The same three cars, the second now listed in the other class.
    processor.init(session([{ classId: 7 }, { classId: 9 }, { classId: 9 }]));

    expect(classBest(processor, 7)).toEqual([29.4, 30.5, 17.5]);
    expect(classBest(processor, 9)).toEqual([29.6, 30.2, 17.6]);
    expect(processor.snapshot().version).toBeGreaterThan(version);
  });
});

describe('what is published', () => {
  it('is one object with the same arrays, and moves only when a figure does', () => {
    const processor = started();
    const cars = [
      { last: [29.4, 30.5, 17.5], current: [29.5, null, null] },
      { last: [29.6, 30.2, 17.6] },
      {},
    ];
    processor.onFrame(frame({ time: 100, cars }));

    const first = processor.snapshot();
    const arrays = [
      first.current,
      first.last,
      first.best,
      first.classIds,
      first.classBest,
    ];
    const version = first.version;

    // The clock moves on and no car ends a sector.
    for (let tick = 1; tick <= 20; tick += 1) {
      processor.onFrame(frame({ time: 100 + tick * 0.5, cars }));
    }

    const later = processor.snapshot();
    expect(later).toBe(first);
    expect(later.version).toBe(version);
    [
      later.current,
      later.last,
      later.best,
      later.classIds,
      later.classBest,
    ].forEach((array, index) => expect(array).toBe(arrays[index]));

    // One car ends a sector: one more version.
    processor.onFrame(
      frame({
        time: 111,
        cars: [cars[0], { ...cars[1], current: [29.7, null, null] }, {}],
      })
    );
    expect(processor.snapshot().version).toBe(version + 1);
  });
});

describe('what is forgotten', () => {
  const lap = { last: [29.4, 30.5, 17.5] as Times };
  const slow = { last: [31.4, 32.5, 18.5] as Times };
  const warm = () => {
    const processor = started();
    processor.onFrame(frame({ time: 100, cars: [lap, lap, lap] }));
    expect(processor.snapshot().best.slice(0, 3)).toEqual([29.4, 30.5, 17.5]);
    return processor;
  };

  it('is everything, when the frames are of another session', () => {
    const processor = warm();

    processor.onFrame(
      frame({ time: 5, sessionNum: 1, cars: [slow, slow, slow] })
    );

    expect(processor.snapshot().sessionNum).toBe(1);
    // The slower laps are the bests of the new session.
    expect(processor.snapshot().best.slice(0, 3)).toEqual([31.4, 32.5, 18.5]);
    expect(classBest(processor, 7)).toEqual([31.4, 32.5, 18.5]);
  });

  it('is everything, when the session clock runs backwards', () => {
    const processor = warm();

    processor.onFrame(frame({ time: 20, cars: [slow, slow, slow] }));

    expect(processor.snapshot().best.slice(0, 3)).toEqual([31.4, 32.5, 18.5]);
  });

  it.each(['sessionNumChange', 'disconnect'] as const)(
    'is everything, on %s',
    (type) => {
      const processor = warm();
      const version = processor.snapshot().version;

      processor.onLifecycle({ type });

      expect(processor.snapshot()).toMatchObject({
        available: false,
        current: [],
        last: [],
        best: [],
        classIds: [],
        classBest: [],
        sessionNum: null,
      });
      expect(processor.snapshot().version).toBeGreaterThan(version);
    }
  );

  it('is nothing, on entering a session', () => {
    const processor = warm();
    const version = processor.snapshot().version;

    processor.onLifecycle({ type: 'enter', replay: false });

    expect(processor.snapshot().best.slice(0, 3)).toEqual([29.4, 30.5, 17.5]);
    expect(processor.snapshot().version).toBe(version);
  });

  it('is the bests of a slot that another car takes, and what the class had from them', () => {
    const processor = started();
    processor.onFrame(
      frame({
        time: 100,
        cars: [
          { last: [29.4, 30.5, 17.5] },
          { last: [29.6, 30.2, 17.6] },
          { last: [33.1, 35.2, 19.4] },
        ],
      })
    );
    expect(classBest(processor, 7)).toEqual([29.4, 30.2, 17.5]);

    // Another car in the first slot. A driver change is not one: the car
    // and its number stay.
    processor.init(
      session([{ classId: 7, number: '99' }, { classId: 7 }, { classId: 9 }])
    );

    expect(processor.snapshot().best.slice(0, 3)).toEqual(NONE);
    expect(processor.snapshot().best.slice(3, 6)).toEqual([29.6, 30.2, 17.6]);
    expect(classBest(processor, 7)).toEqual([29.6, 30.2, 17.6]);
    expect(classBest(processor, 9)).toEqual([33.1, 35.2, 19.4]);
  });

  it('is not the bests of a car the session lists again unchanged', () => {
    const processor = warm();
    const version = processor.snapshot().version;

    processor.init(session(FIELD));

    expect(processor.snapshot().best.slice(0, 3)).toEqual([29.4, 30.5, 17.5]);
    expect(processor.snapshot().version).toBe(version);
  });
});
