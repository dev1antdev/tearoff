import { describe, expect, it } from 'vitest';
import { TrackLocation } from '@irdashies/types';
import type { CarClassEntry } from './carClass';
import {
  TRAFFIC_QUEUE_GAP_S,
  TRAFFIC_SEARCH_M,
  TrafficQueue,
  isOnRacingSurface,
  relativeTimeGap,
  speedOf,
  trafficRelationOf,
  type TrafficField,
} from './trafficRules';

/** A five-kilometre lap, so a metre is 0.0002 of it. */
const TRACK_M = 5000;
const PLAYER = 0;
const PLAYER_PCT = 0.5;
const PLAYER_LAPS = 10;

const GT3: CarClassEntry = { classId: 3, relSpeed: 1, estLapTime: 0 };
const LMP2: CarClassEntry = { classId: 2, relSpeed: 4, estLapTime: 0 };

interface Car {
  /** Metres behind the player on the road; negative is ahead. */
  behind: number;
  laps?: number;
  /** m/s; 50 unless stated. */
  speed?: number;
  carClass?: CarClassEntry;
  inPitLane?: boolean;
  surface?: number;
  /** A lap fraction to use as it stands, for a car LMU holds at the line. */
  pct?: number;
}

const field = (
  cars: readonly Car[],
  options: { raceRule?: boolean; isLmu?: boolean; playerSpeed?: number } = {}
): TrafficField => {
  const all: Car[] = [{ behind: 0, speed: options.playerSpeed }, ...cars];
  return {
    pcts: all.map((car) => car.pct ?? PLAYER_PCT - car.behind / TRACK_M),
    laps: all.map((car) => car.laps ?? PLAYER_LAPS),
    surfaces: all.map((car) => car.surface ?? TrackLocation.OnTrack),
    onPitRoad: all.map((car) => car.inPitLane === true),
    speedsKmh: all.map((car) => (car.speed ?? 50) * 3.6),
    player: PLAYER,
    playerPct: PLAYER_PCT,
    trackLength: TRACK_M,
    raceRule: options.raceRule ?? true,
    isLmu: options.isLmu ?? false,
    classes: all.map((car) => car.carClass ?? GT3),
    excluded: new Set<number>(),
  };
};

describe('how a car behind stands to the player', () => {
  const car = {
    raceRule: true,
    lapsAhead: 0,
    fasterClass: false,
    sameClass: true,
    closing: false,
  };

  it('in a race goes by laps first, then by class', () => {
    expect(trafficRelationOf({ ...car, lapsAhead: 1 })).toBe('lapping');
    // A leader of the player's own class lapping them is lapping too.
    expect(trafficRelationOf({ ...car, lapsAhead: 2, sameClass: true })).toBe(
      'lapping'
    );
    expect(
      trafficRelationOf({ ...car, fasterClass: true, sameClass: false })
    ).toBe('fasterClass');
    expect(trafficRelationOf(car)).toBe('position');
    expect(trafficRelationOf({ ...car, lapsAhead: -1 })).toBe('lapped');
    // A slower class on the same lap is neither traffic nor a rival.
    expect(trafficRelationOf({ ...car, sameClass: false })).toBe('behind');
  });

  it('outside a race goes by whether the car is closing', () => {
    const practice = { ...car, raceRule: false };
    expect(trafficRelationOf(practice)).toBe('behind');
    expect(trafficRelationOf({ ...practice, closing: true })).toBe('closing');
    expect(
      trafficRelationOf({ ...practice, closing: true, fasterClass: true })
    ).toBe('fasterClass');
    // A faster class that is not closing is on a slow lap of its own.
    expect(trafficRelationOf({ ...practice, fasterClass: true })).toBe(
      'behind'
    );
  });
});

describe('the cars behind', () => {
  it('are the cars on the track, behind on the road, within 500 m', () => {
    const queue = new TrafficQueue();
    queue.scan(
      field([
        { behind: 60, laps: PLAYER_LAPS + 1 },
        { behind: -40 },
        { behind: TRAFFIC_SEARCH_M + 1, laps: PLAYER_LAPS + 1 },
        { behind: 80, inPitLane: true },
        { behind: 90, surface: TrackLocation.InPitStall },
        { behind: 100, surface: TrackLocation.NotInWorld },
        { behind: 120 },
      ])
    );

    expect(queue.candidates).toEqual([1, 7]);
    expect(queue.listed).toEqual([1]);
    expect(queue.distOf[1]).toBeCloseTo(60, 6);
    expect(queue.lapsOf[1]).toBe(1);
    expect(queue.relationOf[1]).toBe('lapping');
    expect(queue.relationOf[7]).toBe('position');
    expect(queue.playerSpeed).toBeCloseTo(50, 6);
  });

  it('leave out a car LMU still holds at the line', () => {
    const queue = new TrafficQueue();
    const cars = [{ behind: 0, pct: 0, laps: PLAYER_LAPS + 1 }];
    queue.scan(field(cars, { isLmu: true }));
    expect(queue.candidates).toEqual([]);
    // Under iRacing a fraction of exactly 0 is a place like any other.
    queue.scan({ ...field(cars), playerPct: 0.05 });
    expect(queue.candidates).toEqual([1]);
  });

  it('list a faster class on the same lap, and outside a race a closing car', () => {
    const queue = new TrafficQueue();
    queue.scan(
      field([
        { behind: 50, carClass: LMP2 },
        { behind: 70, laps: PLAYER_LAPS - 1 },
      ])
    );
    expect(queue.listed).toEqual([1]);
    expect(queue.fasterOf[1]).toBe(true);
    expect(queue.relationOf[2]).toBe('lapped');
    expect(queue.lapsOf[2]).toBe(-1);

    queue.scan(
      field(
        [
          { behind: 50, speed: 51 },
          { behind: 70, speed: 53 },
        ],
        { raceRule: false }
      )
    );
    expect(queue.candidates).toEqual([1, 2]);
    expect(queue.listed).toEqual([2]);
    expect(queue.lapsOf[2]).toBe(0);
  });
});

describe('the head of the queue', () => {
  const lapping = (behind: number, speed = 50): Car => ({
    behind,
    laps: PLAYER_LAPS + 1,
    speed,
  });

  it('is the nearest, and stays until another is ten metres nearer', () => {
    const queue = new TrafficQueue();
    queue.scan(field([lapping(60), lapping(120)]));
    expect(queue.settle(queue.listed)).toBe(1);

    // The other one draws up to five metres nearer: no change.
    queue.scan(field([lapping(60), lapping(55)]));
    expect(queue.settle(queue.listed)).toBe(1);
    // Eleven metres nearer: it takes over.
    queue.scan(field([lapping(60), lapping(49)]));
    expect(queue.settle(queue.listed)).toBe(2);
    expect(queue.holder).toBe(2);
  });

  it('stays the head while it draws level, until it is five metres ahead', () => {
    const queue = new TrafficQueue();
    queue.scan(field([lapping(20), lapping(120)]));
    expect(queue.settle(queue.listed)).toBe(1);

    queue.scan(field([lapping(-3), lapping(110)]));
    expect(queue.settle(queue.listed)).toBe(1);
    expect(queue.distOf[1]).toBe(0);

    queue.scan(field([lapping(-6), lapping(100)]));
    expect(queue.settle(queue.listed)).toBe(2);
  });

  it('is nobody for an empty pool, and forgets who it was', () => {
    const queue = new TrafficQueue();
    queue.scan(field([lapping(20)]));
    queue.settle(queue.listed);
    queue.scan(field([]));
    expect(queue.settle(queue.listed)).toBe(-1);
    expect(queue.holder).toBe(-1);
  });

  it('orders equal distances by laps ahead, then by slot', () => {
    const queue = new TrafficQueue();
    queue.scan(
      field([lapping(80), { behind: 80, laps: PLAYER_LAPS + 2 }, lapping(80)])
    );
    queue.settle(queue.listed);
    expect(queue.listed).toEqual([2, 1, 3]);
  });

  it('counts the rest of the queue inside eight seconds', () => {
    const queue = new TrafficQueue();
    // At 50 m/s eight seconds is 400 m.
    const cars = field([lapping(40), lapping(120), lapping(300), lapping(450)]);
    queue.scan(cars);
    const head = queue.settle(queue.listed);
    expect(head).toBe(1);
    expect(queue.queuedBehind(cars, head)).toBe(2);
    expect(queue.isInsideGap(cars, 4)).toBe(false);
    expect(450 / 50).toBeGreaterThan(TRAFFIC_QUEUE_GAP_S);
  });
});

describe('the helpers', () => {
  it('turn a smoothed speed into metres per second', () => {
    expect(speedOf([180], 0)).toBeCloseTo(50, 10);
    expect(speedOf([], 3)).toBeUndefined();
    expect(speedOf([Number.NaN], 0)).toBeUndefined();
  });

  it('give the gap as the metres over the higher of the two speeds', () => {
    expect(relativeTimeGap(120, 60, 40)).toBe(2);
    expect(relativeTimeGap(120, 30, 40)).toBe(3);
    expect(relativeTimeGap(120, undefined, 40)).toBe(3);
    expect(relativeTimeGap(120, 0.5, 0.2)).toBeNull();
    expect(relativeTimeGap(120, undefined, undefined)).toBeNull();
  });

  it('know a car on the racing surface from one in the pits', () => {
    const none = new Set<number>();
    expect(isOnRacingSurface(0, [TrackLocation.OnTrack], [false], none)).toBe(
      true
    );
    expect(isOnRacingSurface(0, [TrackLocation.OffTrack], [false], none)).toBe(
      true
    );
    expect(isOnRacingSurface(0, [TrackLocation.OnTrack], [true], none)).toBe(
      false
    );
    expect(
      isOnRacingSurface(0, [TrackLocation.ApproachingPits], [false], none)
    ).toBe(false);
    expect(
      isOnRacingSurface(0, [TrackLocation.OnTrack], [false], new Set([0]))
    ).toBe(false);
  });
});
