import { describe, expect, it } from 'vitest';
import {
  TrackLocation,
  type FlagStateSnapshot,
  type Session,
  type Telemetry,
} from '@irdashies/types';
import type { LmuRawTelemetry } from '../lmu/native';
import {
  LMU_CURATED_TAPE_PATH,
  lmuTapeAvailable,
  playLmuTape,
} from '../../testing/lmuTape';
import { CarSpeedsProcessor } from './CarSpeedsProcessor';
import { BLUE_SEARCH_M, FlagStateProcessor } from './FlagStateProcessor';
import { parseTrackLength } from './RadarProcessor';
import { wrapDelta } from './radarMath';

/** Both processors tick ten times a second. */
const TICK_S = 0.1;

type RawTransform = <T extends LmuRawTelemetry>(raw: T) => T;

interface Tick {
  snapshot: FlagStateSnapshot;
  telemetry: Telemetry;
  raw: LmuRawTelemetry;
  session: Session;
  sessionTime: number;
}

/**
 * Plays the curated tape through the car speeds and the flag processor, the
 * second reading the first as it does in the app, and hands every tick to
 * `onTick`.
 */
const playFlags = async (
  onTick: (tick: Tick) => void,
  transformRaw?: RawTransform
): Promise<number> => {
  const speeds = new CarSpeedsProcessor();
  const flags = new FlagStateProcessor({
    carSpeeds: () => speeds.snapshot().carSpeeds,
  });
  let started = false;
  let lastTick = Number.NEGATIVE_INFINITY;
  let ticks = 0;
  await playLmuTape({
    tapePath: LMU_CURATED_TAPE_PATH,
    speed: 20,
    transformRaw,
    onFrame: ({ raw, telemetry, session, sessionTime }) => {
      if (!started) {
        started = true;
        speeds.init(session);
        flags.init(session);
        speeds.onLifecycle({ type: 'enter', replay: false });
        flags.onLifecycle({ type: 'enter', replay: false });
      }
      if (sessionTime - lastTick < TICK_S) return;
      lastTick = sessionTime;
      speeds.onFrame(telemetry);
      flags.onFrame(telemetry);
      ticks += 1;
      onTick({
        snapshot: flags.snapshot(),
        telemetry,
        raw,
        session,
        sessionTime,
      });
    },
  });
  return ticks;
};

const values = <T>(telemetry: Telemetry, key: string): readonly T[] =>
  (telemetry as unknown as Record<string, { value: T[] } | undefined>)[key]
    ?.value ?? [];

/** A copy of a per-car array with one car's value replaced. */
const withCar = (
  source: ArrayLike<number> | undefined,
  carIdx: number,
  value: number
): number[] => {
  const copy = Array.from(source ?? []);
  copy[carIdx] = value;
  return copy;
};

/**
 * The flag state on the recorded Le Mans Ultimate race: four minutes under
 * green, with no yellow, no blue and no penalty in it.
 *
 * So only the first case is the recording as it stands. The other two are
 * staged: the snapshots are changed before they are mapped, to put a blue
 * and a yellow onto real cars at their real positions. They test the
 * arithmetic, not what the sim does when it raises those flags.
 *
 * Windows only, like the other tape specs.
 */
describe.skipIf(!lmuTapeAvailable())(
  'the flag state on a recorded LMU race',
  () => {
    it('is green with a clear track from start to end', async () => {
      const seen = new Set<string>();
      const rawSectorFlags = new Set<number>();
      const startLights = new Set<number>();
      const redLights = new Set<number>();
      let first = Number.POSITIVE_INFINITY;
      let last = 0;
      const ticks = await playFlags(({ snapshot, raw, sessionTime }) => {
        first = Math.min(first, sessionTime);
        last = sessionTime;
        seen.add(`${snapshot.kind}/${snapshot.detail}`);
        for (const flag of Array.from(raw.sectorFlags))
          rawSectorFlags.add(flag);
        if (raw.startLight !== undefined) startLights.add(raw.startLight);
        if (raw.numRedLights !== undefined) redLights.add(raw.numRedLights);
        expect(snapshot.yellowSectors).toEqual([false, false, false]);
        expect(snapshot.blue).toBeNull();
        expect(snapshot.penalty).toBeNull();
        expect(snapshot.incidentDistM).toBeNull();
        expect(snapshot.startLights).toBeNull();
        expect(snapshot.pitLaneClosed).toBe(false);
      });

      // The whole recording: 139.9 s to 379.9 s on the session clock.
      expect(ticks).toBeGreaterThan(2_000);
      expect(first).toBeLessThan(141);
      expect(last).toBeGreaterThan(378);
      expect([...seen]).toEqual(['green/trackClear']);
      // A clear sector reads 11 there, not 0: "not zero" is no test for a
      // yellow, and the mapper's `=== 1` is what keeps these green.
      expect([...rawSectorFlags]).toEqual([11]);
      // The resting values at phase 5, where the addon exports them: three
      // red lights in the sequence, and the light past the last red for the
      // first seconds after the rolling start, then none.
      if (redLights.size > 0) {
        expect([...redLights]).toEqual([3]);
        expect([...startLights].sort()).toEqual([0, 4]);
      }
    }, 120_000);

    it('names the nearest car of a staged blue and counts the queue behind it', async () => {
      // Staged: the player's own flag is set to blue and every other car is
      // given one more lap, so each car behind on the road is a lap ahead.
      // With 38 cars on a short lap that is a long queue.
      const stageBlue: RawTransform = (raw) => {
        if (!raw.vehFlag || !raw.vehTotalLaps) return raw;
        const player = raw.playerVehicleIdx;
        return {
          ...raw,
          vehFlag: withCar(raw.vehFlag, player, 6),
          vehTotalLaps: Array.from(raw.vehTotalLaps, (laps, carIdx) =>
            carIdx === player ? laps : laps + 1
          ),
        };
      };

      let since: number | null = null;
      let named = 0;
      let handOvers = 0;
      let swaps = 0;
      let mostQueued = 0;
      let previousHolder = -1;
      const holders = new Set<number>();
      await playFlags(({ snapshot, telemetry, raw, session }) => {
        const player = raw.playerVehicleIdx;
        const trackLength = parseTrackLength(session.WeekendInfo.TrackLength);
        const pcts = values<number>(telemetry, 'CarIdxLapDistPct');
        const inPitLane = values<boolean>(telemetry, 'CarIdxOnPitRoad');
        const surfaces = values<number>(telemetry, 'CarIdxTrackSurface');
        /** Metres a car is behind the player on the road; negative ahead. */
        const behind = (carIdx: number) =>
          -wrapDelta(pcts[carIdx], pcts[player]) * trackLength;

        expect(snapshot.kind).toBe('blue');
        expect(snapshot.detail).toBe('blueLapping');
        // One blue from the first frame to the last, whoever it is for.
        since ??= snapshot.since;
        expect(snapshot.since).toBe(since);

        const holder = snapshot.blue?.carIdx ?? -1;
        if (previousHolder >= 0 && holder !== previousHolder) {
          const was = behind(previousHolder);
          const stillListed =
            was > -5 &&
            was <= BLUE_SEARCH_M &&
            pcts[previousHolder] > 0 &&
            !inPitLane[previousHolder];
          if (!stillListed) {
            // It went by or dropped out, and the next car has the plate in
            // the same tick.
            if (holder >= 0) handOvers += 1;
          } else if (holder >= 0) {
            // It is still there: another car took the plate by being at
            // least ten metres nearer.
            swaps += 1;
            expect(Math.max(0, was) - behind(holder)).toBeGreaterThan(9.99);
          }
        }
        previousHolder = holder;
        const blue = snapshot.blue;
        if (!blue) return;
        named += 1;
        holders.add(blue.carIdx);
        mostQueued = Math.max(mostQueued, blue.othersCount);

        expect(blue.carIdx).not.toBe(player);
        expect(blue.confirmed).toBe(true);
        expect(blue.lapsAhead).toBe(1);
        expect(inPitLane[blue.carIdx]).toBe(false);
        expect(surfaces[blue.carIdx]).toBe(TrackLocation.OnTrack);
        // The distance is the lap-fraction difference over the track length,
        // and reads 0 while the car is level or just ahead.
        const metres = behind(blue.carIdx);
        expect(metres).toBeGreaterThan(-5);
        expect(blue.distanceM).toBe(Math.round(Math.max(0, metres)));
        expect(blue.distanceM).toBeLessThanOrEqual(BLUE_SEARCH_M);

        // No other car on the track is more than ten metres nearer, and the
        // count is never more than the cars that are behind within range.
        let nearest = Number.POSITIVE_INFINITY;
        let inRange = 0;
        for (let carIdx = 0; carIdx < pcts.length; carIdx += 1) {
          if (carIdx === player || carIdx === blue.carIdx) continue;
          if (pcts[carIdx] <= 0 || inPitLane[carIdx]) continue;
          if (surfaces[carIdx] !== TrackLocation.OnTrack) continue;
          const distance = behind(carIdx);
          if (distance <= 0 || distance > BLUE_SEARCH_M) continue;
          inRange += 1;
          nearest = Math.min(nearest, distance);
        }
        expect(blue.distanceM).toBeLessThan(nearest + 10.5);
        expect(blue.othersCount).toBeLessThanOrEqual(inRange);
      }, stageBlue);

      // Named for nearly all of it: nothing can be until the player first
      // reaches the line, where LMU starts counting the lap fraction.
      expect(named).toBeGreaterThan(2_000);
      expect(holders.size).toBeGreaterThan(3);
      // The plate changes hands as the player overtakes: a car just passed is
      // at once the nearest behind. Nobody overtakes the player while holding
      // the plate on this recording, so the hand-over to the next car as the
      // holder goes by is left to the unit spec.
      expect(swaps).toBeGreaterThan(2);
      expect(handOvers).toBe(0);
      expect(mostQueued).toBeGreaterThan(5);
    }, 120_000);

    it('measures the metres to a staged incident as the player comes up to it', async () => {
      // Staged: sector 1 is flagged yellow for the whole recording, and one
      // car is held still at six tenths of the lap with no speed, as if it
      // had stopped on the track there. The player drives past it twice.
      const STOPPED = 37;
      const STOPPED_PCT = 0.6;
      const stageYellow: RawTransform = (raw) => {
        if (!raw.sectorFlags || !raw.vehLapDistPct) return raw;
        return {
          ...raw,
          // The sim's index 1 is the first sector.
          sectorFlags: new Uint8Array([11, 1, 11]),
          vehLapDistPct: withCar(raw.vehLapDistPct, STOPPED, STOPPED_PCT),
          vehSpeed: withCar(raw.vehSpeed, STOPPED, 0),
          vehInPits: withCar(raw.vehInPits, STOPPED, 0),
          vehInGarageStall: withCar(raw.vehInGarageStall, STOPPED, 0),
          vehPitState: withCar(raw.vehPitState, STOPPED, 0),
          // Scoring's position as it stands, not advanced between updates.
          vehTelemetryAvailable: withCar(raw.vehTelemetryAvailable, STOPPED, 0),
        };
      };

      const details: string[] = [];
      let ahead = 0;
      await playFlags(({ snapshot, telemetry, raw, session, sessionTime }) => {
        expect(snapshot.kind).toBe('yellow');
        expect(snapshot.yellowSectors).toEqual([true, false, false]);
        if (details.at(-1) !== snapshot.detail) details.push(snapshot.detail);
        // The first seconds are the rolling start, before the player has
        // reached the line and before any speed has been measured.
        if (sessionTime < 150) return;

        const trackLength = parseTrackLength(session.WeekendInfo.TrackLength);
        const pcts = values<number>(telemetry, 'CarIdxLapDistPct');
        const metres =
          wrapDelta(STOPPED_PCT, pcts[raw.playerVehicleIdx]) * trackLength;
        if (metres >= 0 && metres <= 500) {
          ahead += 1;
          expect(snapshot.detail).toBe('yellowAhead');
          expect(snapshot.incidentCarIdx).toBe(STOPPED);
          expect(snapshot.incidentDistM).toBe(Math.round(metres));
        } else if (metres < 0 && metres >= -50) {
          // Within half a metre the rounded distance is 0, which reads as
          // ahead; either side of it the sign says which.
          const rounded = -Math.round(-metres) || 0;
          expect(snapshot.detail).toBe(
            rounded === 0 ? 'yellowAhead' : 'yellowBehind'
          );
          expect(snapshot.incidentCarIdx).toBe(STOPPED);
          expect(snapshot.incidentDistM).toBe(rounded);
        } else {
          expect(snapshot.detail).toBe('yellowElsewhere');
          expect(snapshot.incidentDistM).toBeNull();
        }
      }, stageYellow);

      // Three approaches of about ten seconds each.
      expect(ahead).toBeGreaterThan(250);
      // Elsewhere, in range ahead, just behind, and elsewhere again: once
      // for each time the player comes round.
      expect(details).toEqual([
        'yellowElsewhere',
        'yellowAhead',
        'yellowBehind',
        'yellowElsewhere',
        'yellowAhead',
        'yellowBehind',
        'yellowElsewhere',
        'yellowAhead',
        'yellowBehind',
        'yellowElsewhere',
      ]);
    }, 120_000);
  }
);
