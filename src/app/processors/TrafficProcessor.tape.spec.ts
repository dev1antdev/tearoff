import { describe, expect, it } from 'vitest';
import {
  TrackLocation,
  type Session,
  type Telemetry,
  type TrafficSnapshot,
} from '@irdashies/types';
import { placeOfCatch, type LapPlace } from '@irdashies/shared';
import type { LmuRawTelemetry } from '../lmu/native';
import {
  LMU_CURATED_TAPE_PATH,
  lmuTapeAvailable,
  playLmuTape,
} from '../../testing/lmuTape';
import { CarSpeedsProcessor } from './CarSpeedsProcessor';
import { LapTimesProcessor } from './LapTimesProcessor';
import { TrafficProcessor } from './TrafficProcessor';
import { wrapDelta } from './radarMath';

/** The speeds tick ten times a second, the traffic five. */
const SPEEDS_TICK_S = 0.1;
const TRAFFIC_TICK_S = 0.2;

/** The player's Ferrari is slot 0; the GT3 field is slots 15 to 27. */
const PLAYER = 0;
const FIRST_GT3 = 15;
const LAST_GT3 = 27;
/** The LMP2 that leads the race from start to end of the recording. */
const LEADER = 8;

/**
 * Laguna Seca's corners as the bundled track data lists them (the renderer
 * reads them from `tracks-bundle.json`, which this layer may not import).
 */
const LAGUNA_SECA: LapPlace[] = [
  { startPct: 0.045, endPct: 0.08, label: 'Turn 1' },
  { startPct: 0.1, endPct: 0.173, label: 'Andretti Hairpin' },
  { startPct: 0.191, endPct: 0.245, label: 'Turn 3' },
  { startPct: 0.265, endPct: 0.321, label: 'Turn 4' },
  { startPct: 0.4, endPct: 0.465, label: 'Turn 5' },
  { startPct: 0.52, endPct: 0.575, label: 'Turn 6' },
  { startPct: 0.661, endPct: 0.72, label: 'The Corkscrew' },
  { startPct: 0.725, endPct: 0.79, label: 'Turn 9' },
  { startPct: 0.805, endPct: 0.855, label: 'Turn 10' },
  { startPct: 0.89, endPct: 0.94, label: 'Turn 11' },
];

type RawTransform = <T extends LmuRawTelemetry>(raw: T) => T;
type RawFields = Record<string, ArrayLike<number> | undefined> & {
  elapsedTime?: number;
  playerVehicleIdx?: number;
};

interface Tick {
  snapshot: TrafficSnapshot;
  telemetry: Telemetry;
  session: Session;
  sessionTime: number;
}

/**
 * Plays the curated tape through the car speeds, the lap times and the
 * traffic processor, the last reading the other two as it does in the app,
 * and hands every tick of the traffic to `onTick`.
 */
const playTraffic = async (
  onTick: (tick: Tick) => void,
  transformRaw?: RawTransform
): Promise<number> => {
  const speeds = new CarSpeedsProcessor();
  const lapTimes = new LapTimesProcessor();
  const traffic = new TrafficProcessor({
    carSpeeds: () => speeds.snapshot().carSpeeds,
    lapTimes: () => lapTimes.snapshot().lapTimes,
  });
  let started = false;
  let lastSpeeds = Number.NEGATIVE_INFINITY;
  let lastTraffic = Number.NEGATIVE_INFINITY;
  let ticks = 0;
  await playLmuTape({
    tapePath: LMU_CURATED_TAPE_PATH,
    speed: 20,
    transformRaw,
    onFrame: ({ telemetry, session, sessionTime }) => {
      if (!started) {
        started = true;
        for (const processor of [speeds, lapTimes, traffic]) {
          processor.init(session);
          processor.onLifecycle({ type: 'enter', replay: false });
        }
      }
      lapTimes.onFrame(telemetry);
      if (sessionTime - lastSpeeds >= SPEEDS_TICK_S) {
        lastSpeeds = sessionTime;
        speeds.onFrame(telemetry);
      }
      if (sessionTime - lastTraffic < TRAFFIC_TICK_S) return;
      lastTraffic = sessionTime;
      traffic.onFrame(telemetry);
      ticks += 1;
      onTick({ snapshot: traffic.snapshot(), telemetry, session, sessionTime });
    },
  });
  return ticks;
};

const values = <T>(telemetry: Telemetry, key: string): readonly T[] =>
  (telemetry as unknown as Record<string, { value: T[] } | undefined>)[key]
    ?.value ?? [];

/** What scoring and telemetry say about where one car is and how fast. */
const PLACE_FIELDS = [
  'vehLapDistPct',
  'vehTotalLaps',
  'vehSpeed',
  'vehLapNumber',
  'vehElapsedTime',
  'vehTimeIntoLap',
  'vehLapStartET',
  'vehPosX',
  'vehPosZ',
  'vehOriX',
  'vehOriZ',
  'vehTelemetryAvailable',
] as const;

/**
 * Staged: one car is shown where it was `delayS` seconds earlier, a lap up.
 *
 * On the recording the prototypes start ahead of the GT3 field and drive
 * away from it; none comes up behind the player. Played late, the leading
 * LMP2 drives the same lap at the same speeds in the same places, only
 * behind the player instead of ahead, and with one more lap to its name it
 * is a car coming to lap them. It is a ghost: nobody on the recording
 * reacts to it.
 */
const stageLappingCar = (slot: number, delayS: number): RawTransform => {
  const history: { clock: number; place: number[] }[] = [];
  let cursor = 0;
  return (raw) => {
    const source = raw as unknown as RawFields;
    if (!source.vehLapDistPct || typeof source.elapsedTime !== 'number') {
      return raw;
    }
    const clock = source.elapsedTime;
    history.push({
      clock,
      place: PLACE_FIELDS.map((field) => source[field]?.[slot] ?? 0),
    });
    while (
      cursor + 1 < history.length &&
      history[cursor + 1].clock <= clock - delayS
    ) {
      cursor += 1;
    }
    const then = history[cursor];
    const staged: Record<string, unknown> = {
      ...(raw as unknown as Record<string, unknown>),
    };
    PLACE_FIELDS.forEach((field, index) => {
      const recorded = source[field];
      if (!recorded) return;
      const copy = Array.from(recorded);
      const lapUp = field === 'vehTotalLaps' || field === 'vehLapNumber';
      copy[slot] = then.place[index] + (lapUp ? 1 : 0);
      staged[field] = copy;
    });
    return staged as typeof raw;
  };
};

/**
 * Staged: scoring says the player's car is in the pit lane between two
 * session times. The car goes on lapping at speed, which a car in the pit
 * lane does not; what is tested is what the processor does with the flag.
 */
const stagePitVisit = (fromS: number, toS: number): RawTransform => {
  return (raw) => {
    const source = raw as unknown as RawFields;
    const clock = source.elapsedTime;
    if (!source.vehInPits || typeof clock !== 'number') return raw;
    if (clock < fromS || clock >= toS) return raw;
    const inPits = Array.from(source.vehInPits);
    inPits[source.playerVehicleIdx ?? PLAYER] = 1;
    return {
      ...(raw as unknown as Record<string, unknown>),
      vehInPits: inPits,
    } as unknown as typeof raw;
  };
};

const mean = (numbers: readonly number[]): number =>
  numbers.reduce((sum, value) => sum + value, 0) / numbers.length;

/**
 * Traffic on the recorded Le Mans Ultimate race: four minutes from a
 * rolling start at Laguna Seca, the player twelfth of the fourteen GT3
 * cars at the back of a field of 38.
 *
 * Only the first case is the recording as it stands, and it is a quiet
 * one for this widget: the prototypes start ahead and drive away, nobody
 * pits, and the only cars near the player are GT3 cars racing them. The
 * other two are staged, which each says where it does it.
 *
 * Windows only, like the other tape specs.
 */
describe.skipIf(!lmuTapeAvailable())('traffic on a recorded LMU race', () => {
  it('as recorded: rivals in the mirror, the leader four laps off, no forecast', async () => {
    const heads: number[] = [];
    const leaderGaps: { time: number; gapS: number; laps: number | null }[] =
      [];
    const catching = new Set<number>();
    const caughtBy = new Set<number>();
    let first = Number.POSITIVE_INFINITY;
    let last = 0;
    let withMirror = 0;
    const ticks = await playTraffic(({ snapshot, telemetry, sessionTime }) => {
      first = Math.min(first, sessionTime);
      last = sessionTime;
      const inPitLane = values<boolean>(telemetry, 'CarIdxOnPitRoad');
      const surfaces = values<number>(telemetry, 'CarIdxTrackSurface');

      // Nobody is catching the player: there is never a forecast.
      expect(snapshot.forecast).toBeNull();
      // Nobody pits and the player is never slow.
      expect(snapshot.inPitLane).toBe(false);
      expect(snapshot.exitedAt).toBeNull();
      expect(snapshot.slowAt).toBeNull();
      expect(snapshot.arriving).toEqual([]);

      // The mirror holds one car at most: the GT3 right behind, racing the
      // player for position, never one of traffic.
      expect(snapshot.behind.length).toBeLessThanOrEqual(1);
      expect(snapshot.moreBehind).toBe(0);
      const head = snapshot.behind[0];
      if (head) {
        withMirror += 1;
        expect(head.relation).toBe('position');
        expect(head.carIdx).toBeGreaterThanOrEqual(FIRST_GT3);
        expect(head.carIdx).toBeLessThanOrEqual(LAST_GT3);
        expect(head.lapsAhead).toBe(0);
        expect(head.gapS).not.toBeNull();
        expect(head.gapS ?? 0).toBeLessThanOrEqual(3);
        if (heads.at(-1) !== head.carIdx) heads.push(head.carIdx);
      }

      for (const pick of [
        snapshot.slowerAhead,
        snapshot.leader,
        snapshot.fasterBehind,
      ]) {
        if (!pick) continue;
        expect(pick.carIdx).not.toBe(PLAYER);
        expect(inPitLane[pick.carIdx]).toBe(false);
        expect(surfaces[pick.carIdx]).toBe(TrackLocation.OnTrack);
        expect(pick.gapS).toBeGreaterThanOrEqual(0);
        if (pick.laps !== null) expect(pick.laps).toBeGreaterThan(0);
      }
      if (snapshot.slowerAhead) catching.add(snapshot.slowerAhead.carIdx);
      if (snapshot.fasterBehind && sessionTime > 170) {
        caughtBy.add(snapshot.fasterBehind.carIdx);
      }
      if (snapshot.leader) {
        // The same LMP2 leads throughout.
        expect(snapshot.leader.carIdx).toBe(LEADER);
        leaderGaps.push({
          time: sessionTime,
          gapS: snapshot.leader.gapS,
          laps: snapshot.leader.laps,
        });
      }
    });

    // The whole recording: 139.9 s to 379.9 s on the session clock.
    expect(ticks).toBeGreaterThan(1_000);
    expect(first).toBeLessThan(141);
    expect(last).toBeGreaterThan(378);

    // A rival is in the mirror nearly all the time, and it changes as the
    // player works through the back of the GT3 field: six passes.
    expect(withMirror).toBeGreaterThan(ticks * 0.9);
    expect(heads.length).toBeGreaterThanOrEqual(6);
    for (const passed of [18, 19, 15, 17]) expect(heads).toContain(passed);

    // The cars the player catches are GT3 cars; the cars that catch the
    // player, once the rates have settled, are LMP2s from the front.
    for (const carIdx of catching) {
      expect(carIdx).toBeGreaterThanOrEqual(FIRST_GT3);
    }
    expect(caughtBy.has(LEADER)).toBe(true);
    for (const carIdx of caughtBy) expect(carIdx).toBeLessThan(FIRST_GT3);

    // The leader starts 0.05 of a lap up the road, so nearly a lap behind,
    // and comes round: 86 s behind falls to 48 s over the recording.
    const at = (time: number) =>
      leaderGaps.find((entry) => entry.time >= time) ?? leaderGaps[0];
    expect(at(160).gapS).toBeGreaterThan(80);
    expect(at(377).gapS).toBeLessThan(50);
    for (let time = 180; time <= 330; time += 30) {
      expect(at(time + 30).gapS).toBeLessThan(at(time).gapS);
    }
    // From the second lap on it is between four and five laps from
    // lapping the player. It does not fall by a lap a lap, because the
    // player's own second lap is eleven seconds quicker than their first.
    const settled = leaderGaps.filter((entry) => entry.time > 250);
    for (const entry of settled) {
      expect(entry.laps).not.toBeNull();
      expect(entry.laps ?? 0).toBeGreaterThan(3.5);
      expect(entry.laps ?? 0).toBeLessThan(5.5);
    }
  }, 120_000);

  it('staged: a lapping prototype is forecast to the corner it arrives at', async () => {
    // Staged: the leading LMP2, shown where it was 20 s earlier and a lap
    // up. It starts 14 s behind the player and catches them in a lap.
    const forecasts: {
      time: number;
      etaS: number;
      lowS: number;
      highS: number;
      steady: boolean;
      meetPct: number | null;
      place: string | null;
    }[] = [];
    let previousAhead = Number.NaN;
    let caughtAt = Number.NaN;
    let caughtPct = Number.NaN;
    let inMirror = 0;
    let ticksOnApproach = 0;
    let forecastsOnApproach = 0;
    let afterTicks = 0;
    await playTraffic(
      ({ snapshot, telemetry, sessionTime }) => {
        const pcts = values<number>(telemetry, 'CarIdxLapDistPct');
        // Where the staged car really is: fraction of a lap ahead of the
        // player, negative while it is behind.
        const ahead = wrapDelta(pcts[LEADER], pcts[PLAYER]);
        if (
          Number.isNaN(caughtAt) &&
          previousAhead < 0 &&
          previousAhead > -0.1 &&
          ahead >= 0
        ) {
          caughtAt = sessionTime;
          caughtPct = pcts[PLAYER];
        }
        previousAhead =
          pcts[LEADER] > 0 && pcts[PLAYER] > 0 ? ahead : Number.NaN;

        const row = snapshot.behind.find((car) => car.carIdx === LEADER);
        if (!Number.isNaN(caughtAt)) {
          // Once it has gone by it is neither listed nor forecast.
          if (sessionTime > caughtAt + 1) {
            afterTicks += 1;
            expect(row).toBeUndefined();
            expect(snapshot.forecast).toBeNull();
          }
          return;
        }
        if (row) {
          inMirror += 1;
          expect(row.relation).toBe('lapping');
          expect(row.lapsAhead).toBe(1);
        }
        const forecast = snapshot.forecast;
        if (sessionTime >= 200) {
          ticksOnApproach += 1;
          if (forecast?.carIdx === LEADER) forecastsOnApproach += 1;
        }
        if (forecast?.carIdx !== LEADER) return;
        forecasts.push({
          time: sessionTime,
          etaS: forecast.etaS,
          lowS: forecast.lowS,
          highS: forecast.highS,
          steady: forecast.steady,
          meetPct: forecast.meetPct,
          place: placeOfCatch(forecast, LAGUNA_SECA)?.label ?? null,
        });
      },
      stageLappingCar(LEADER, 20)
    );

    // The two really meet 116 s into the recording, a quarter of the way
    // round the player's second lap: on the run from Turn 3 to Turn 4.
    expect(caughtAt).toBeGreaterThan(253);
    expect(caughtAt).toBeLessThan(259);
    expect(caughtPct).toBeGreaterThan(0.245);
    expect(caughtPct).toBeLessThan(0.265);
    expect(afterTicks).toBeGreaterThan(100);

    // It is in the mirror for the last minute of that, and forecast from
    // more than a minute out without a gap worth the name.
    expect(inMirror).toBeGreaterThan(250);
    expect(forecasts[0].time).toBeLessThan(190);
    expect(forecastsOnApproach).toBeGreaterThan(ticksOnApproach * 0.95);

    const offBy = (entry: { time: number; etaS: number }) =>
      Math.abs(entry.etaS - (caughtAt - entry.time));
    const within = (fromS: number, toS: number) =>
      forecasts.filter((entry) => {
        const truth = caughtAt - entry.time;
        return truth > fromS && truth <= toS;
      });
    const placeOffBy = (meetPct: number) =>
      Math.abs(wrapDelta(meetPct, caughtPct));

    // The last ten seconds: within a second on average, and always inside
    // the range it gave. The place is the stretch the cars meet on.
    const closeIn = within(0, 10);
    expect(closeIn.length).toBeGreaterThan(40);
    expect(mean(closeIn.map(offBy))).toBeLessThan(2);
    for (const entry of closeIn) {
      expect(offBy(entry)).toBeLessThan(5);
      expect(entry.steady).toBe(true);
      expect(entry.meetPct).not.toBeNull();
      expect(placeOffBy(entry.meetPct ?? 0)).toBeLessThan(0.06);
    }
    // In the last eight seconds every forecast that names a place names
    // Turn 4, the corner they are on the run to when they meet.
    const lastEight = within(0, 8).filter((entry) => entry.place !== null);
    expect(lastEight.length).toBeGreaterThan(30);
    for (const entry of lastEight) expect(entry.place).toBe('Turn 4');

    // Ten to twenty seconds out: two and a half seconds off on average,
    // and the place it names is that corner or one next to it.
    const further = within(10, 20);
    expect(further.length).toBeGreaterThan(40);
    expect(mean(further.map(offBy))).toBeLessThan(4);
    const placed = further.filter((entry) => entry.meetPct !== null);
    expect(placed.length).toBeGreaterThan(further.length * 0.7);
    expect(
      mean(placed.map((entry) => placeOffBy(entry.meetPct ?? 0)))
    ).toBeLessThan(0.05);
    for (const entry of further) {
      expect(offBy(entry)).toBeLessThan(11);
      if (entry.meetPct !== null) {
        expect(placeOffBy(entry.meetPct)).toBeLessThan(0.1);
      }
      if (entry.place !== null) {
        expect(['Turn 3', 'Turn 4', 'Turn 5']).toContain(entry.place);
      }
    }

    // Further out than it has measured for it does not pretend: no place,
    // and a range rather than a figure. It is as well: thirty-five to sixty
    // seconds out the figure is a third too early, because the stretch it
    // measured on is where a prototype gains most.
    const farOut = within(35, 60);
    expect(farOut.length).toBeGreaterThan(100);
    expect(mean(farOut.map(offBy))).toBeGreaterThan(8);
    for (const entry of farOut) {
      expect(entry.meetPct).toBeNull();
      expect(entry.place).toBeNull();
      expect(entry.steady).toBe(false);
    }
  }, 120_000);

  it('staged: lists who is coming through a pit visit and for 30 s after', async () => {
    // Staged: scoring has the player in the pit lane from 300 s to 320 s.
    const IN_S = 300;
    const OUT_S = 320;
    let inLane = 0;
    let exitedAt: number | null = null;
    let lastArriving = 0;
    let catchingAgainAt = Number.NaN;
    await playTraffic(
      ({ snapshot, telemetry, sessionTime }) => {
        const pcts = values<number>(telemetry, 'CarIdxLapDistPct');
        if (sessionTime < IN_S) {
          expect(snapshot.inPitLane).toBe(false);
          expect(snapshot.arriving).toEqual([]);
          return;
        }
        if (snapshot.arriving.length > 0) lastArriving = sessionTime;

        if (snapshot.inPitLane) {
          inLane += 1;
          // From the pit lane nothing is listed in the mirror, forecast or
          // put in the table: only who is coming.
          expect(snapshot.behind).toEqual([]);
          expect(snapshot.forecast).toBeNull();
          expect(snapshot.slowerAhead).toBeNull();
          expect(snapshot.fasterBehind).toBeNull();
          expect(snapshot.leader).toBeNull();
          expect(snapshot.exitedAt).toBeNull();

          // The GT3 cars the player has just passed, nearest first, each
          // behind on the road and within a minute.
          expect(snapshot.arriving.length).toBeGreaterThan(2);
          expect(snapshot.nearestBehind).toEqual({
            carIdx: snapshot.arriving[0].carIdx,
            gapS: snapshot.arriving[0].gapS,
          });
          let previous = 0;
          for (const car of snapshot.arriving) {
            expect(car.carIdx).not.toBe(PLAYER);
            expect(wrapDelta(pcts[car.carIdx], pcts[PLAYER])).toBeLessThan(0);
            expect(car.gapS).toBeGreaterThanOrEqual(previous);
            expect(car.gapS).toBeLessThanOrEqual(60);
            expect(car.speedMs).toBeGreaterThan(1);
            previous = car.gapS;
          }
          return;
        }

        // Out of the lane: the moment is kept, and the rates start again.
        exitedAt ??= snapshot.exitedAt;
        expect(snapshot.exitedAt).toBe(exitedAt);
        if (Number.isNaN(catchingAgainAt) && snapshot.slowerAhead) {
          catchingAgainAt = sessionTime;
        }
      },
      stagePitVisit(IN_S, OUT_S)
    );

    // Twenty seconds at five ticks a second.
    expect(inLane).toBeGreaterThan(90);
    expect(exitedAt).not.toBeNull();
    expect(exitedAt ?? 0).toBeGreaterThanOrEqual(OUT_S);
    expect(exitedAt ?? 0).toBeLessThan(OUT_S + 0.5);
    // Listed for 30 s after the exit, and no longer.
    expect(lastArriving).toBeGreaterThan(OUT_S + 29);
    expect(lastArriving).toBeLessThan(OUT_S + 31);
    // Ten seconds of closing are measured afresh before a car is named.
    expect(catchingAgainAt).toBeGreaterThan(OUT_S + 9);
    expect(catchingAgainAt).toBeLessThan(OUT_S + 15);
  }, 120_000);
});
