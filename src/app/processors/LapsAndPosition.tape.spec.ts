import { describe, expect, it } from 'vitest';
import type {
  Session,
  SessionBarSnapshot,
  SessionTimingSnapshot,
  StandingsSnapshot,
} from '@irdashies/types';
import type { LmuRawTelemetry } from '../lmu/native';
import {
  LMU_CURATED_TAPE_PATH,
  lmuTapeAvailable,
  playLmuTape,
} from '../../testing/lmuTape';
import {
  classGridChange,
  overallGridChange,
} from '../../testing/lmuTapeRivals';
import { LapTimesProcessor } from './LapTimesProcessor';
import { SessionBarProcessor } from './SessionBarProcessor';
import { SessionTimingProcessor } from './SessionTimingProcessor';
import { StandingsProcessor } from './StandingsProcessor';

/**
 * What the session bar's laps and position items read, on a recorded Le
 * Mans Ultimate race: a fifteen-minute timed race at Laguna Seca, joined a
 * few seconds after the green flag and followed for four minutes. The
 * player (slot 0) starts 31st of 38 and seventh of fourteen LMGT3s, and is
 * 26th and second when the recording ends, 0.72 of the way round his third
 * lap with 655 s on the clock.
 *
 * The laps come from the session timing, paced by the lap times as the app
 * wires them; the place from the standings; the grid from the session; the
 * track limits from the session bar. The recording stops ten minutes before
 * the flag, so the end of a timed race (the clock at zero, the leader's
 * last lap, the extra lap settling) is not on it.
 *
 * Windows only, like the other tape specs.
 */

const PLAYER = 0;
const CARS = 38;
/** The overall leader throughout: an LMP2. */
const LEADER = 8;
const TICK_SECONDS = 0.2;

interface Tick {
  sessionTime: number;
  timing: SessionTimingSnapshot;
  standings: StandingsSnapshot;
  sessionBar: SessionBarSnapshot;
  session: Session;
  raw: LmuRawTelemetry;
  /** The pace the projection was given, by car. */
  pace: readonly number[];
}

const play = async (
  onTick: (tick: Tick) => void
): Promise<{ frames: number; last: Tick | null }> => {
  const lapTimes = new LapTimesProcessor();
  // As the registry wires it: paced by the lap-times channel.
  const timing = new SessionTimingProcessor(() => lapTimes.snapshot().lapTimes);
  const standings = new StandingsProcessor();
  const sessionBar = new SessionBarProcessor();
  for (const processor of [lapTimes, timing, standings, sessionBar]) {
    processor.onLifecycle({ type: 'enter', replay: false });
  }

  let session: Session | null = null;
  let frames = 0;
  let lastTick = Number.NEGATIVE_INFINITY;
  let last: Tick | null = null;
  await playLmuTape({
    tapePath: LMU_CURATED_TAPE_PATH,
    speed: 20,
    onFrame: (frame) => {
      frames += 1;
      if (frame.sessionChanged) {
        session = frame.session;
        lapTimes.init?.(session);
        timing.init(session);
        standings.init(session);
        sessionBar.init(session);
      }
      lapTimes.onFrame(frame.telemetry);
      timing.onFrame(frame.telemetry);
      standings.onFrame(frame.telemetry);
      sessionBar.onFrame(frame.telemetry);
      if (!session || frame.sessionTime - lastTick < TICK_SECONDS) return;
      lastTick = frame.sessionTime;
      last = {
        sessionTime: frame.sessionTime,
        timing: timing.snapshot(),
        standings: standings.snapshot(),
        sessionBar: sessionBar.snapshot(),
        session,
        raw: frame.raw,
        pace: lapTimes.snapshot().lapTimes,
      };
      onTick(last);
    },
  });
  return { frames, last };
};

describe.skipIf(!lmuTapeAvailable())(
  'laps and position on a recorded LMU race',
  () => {
    it('counts the player’s laps and the share of the one under way', async () => {
      const completed: number[] = [];
      let worstFraction = 0;
      let backwards = 0;
      let outOfRange = 0;
      let lastDone = Number.NEGATIVE_INFINITY;
      const { frames, last } = await play(({ timing, raw }) => {
        const laps = timing.lapsCompleted ?? -1;
        const share = timing.lapProgress ?? -1;
        if (laps !== completed.at(-1)) completed.push(laps);
        if (share < 0 || share > 0.99) outOfRange += 1;
        // Against the sim's own lap fraction for the car: the share is that
        // rounded down to hundredths, a tick old at most. Measured round the
        // lap, so the tick that straddles the line is not a whole lap out.
        const apart = Math.abs(share - raw.vehLapDistPct[PLAYER]);
        worstFraction = Math.max(worstFraction, Math.min(apart, 1 - apart));
        // Laps done never goes backwards: the count and the share move in
        // the same frame at the line.
        const done = laps + share;
        if (done < lastDone - 1e-9) backwards += 1;
        lastDone = done;
      });

      expect(frames).toBeGreaterThan(14_000);
      expect(completed).toEqual([0, 1, 2]);
      expect(outOfRange).toBe(0);
      expect(backwards).toBe(0);
      expect(worstFraction).toBeLessThan(0.03);

      expect(last?.sessionTime).toBeGreaterThan(379.5);
      expect(last?.timing).toMatchObject({
        sessionType: 'Race',
        lapsCompleted: 2,
        lapProgress: 0.72,
        isFixedLapRace: false,
      });
    }, 120_000);

    it('projects the player’s own distance at the flag, and the lap the leader adds', async () => {
      let firstPaced: Tick | null = null;
      let unpacedTicks = 0;
      let exactTicks = 0;
      const { last } = await play((tick) => {
        if (tick.timing.projectedLapsExact) exactTicks += 1;
        if (!((tick.pace[PLAYER] ?? 0) > 0)) unpacedTicks += 1;
        else firstPaced ??= { ...tick };
      });

      // A race on the clock: never the scheduled distance.
      expect(exactTicks).toBe(0);
      // Through his first lap the player has no pace of his own, and the
      // projection stands on the sim's one estimate for the class. His own
      // arrives as he ends that lap, a minute and a half into the
      // recording; the sim's lap time and its lap count come a tick apart,
      // either first.
      expect(unpacedTicks).toBeGreaterThan(300);
      const paced = firstPaced as Tick | null;
      expect(paced?.sessionTime).toBeGreaterThan(225);
      expect(paced?.sessionTime).toBeLessThan(240);
      expect(paced?.timing.lapsCompleted).toBeLessThanOrEqual(1);

      // The end of the recording: 2.72 laps done and 655 s left. His two
      // laps were 97.8 s, from the rolling start, and 86.7 s: a pace of
      // 92.24 s, so 7.1 more laps, 9.83 in all. (The median is slow this
      // early; 10.3 is nearer the truth.)
      const timing = last?.timing;
      expect(last?.pace[PLAYER]).toBeCloseTo(92.24, 1);
      expect(timing?.timeRemaining).toBeGreaterThan(655);
      expect(timing?.timeRemaining).toBeLessThan(656);
      expect(timing?.projectedLaps).toBeCloseTo(9.83, 1);
      expect(timing?.projectedLapsExact).toBe(false);
      // The leader, at 76.56 s a lap, is 0.72 of the way round his twelfth
      // lap when the clock stops and needs another 21.8 s to finish it.
      // That carries the player from eight laps to finish to nine.
      expect(last?.pace[LEADER]).toBeCloseTo(76.56, 1);
      expect(last?.standings.carIdxPosition[LEADER]).toBe(1);
      expect(timing?.extraLaps).toBe(1);
      // The laps item's other format still reads the leader's distance.
      expect(timing?.totalRaceLaps).toBeCloseTo(11.71, 1);
    }, 120_000);

    it('places the player 26th of 38 and second of 14, up five on both grids', async () => {
      const places: number[] = [];
      const { last } = await play(({ standings }) => {
        const place = standings.carIdxPosition[PLAYER];
        if (place !== places.at(-1)) places.push(place);
      });
      if (!last) throw new Error('the recording gave no frame');
      const { standings, session, sessionBar } = last;

      // Up from 31st, a place at a time.
      expect(places[0]).toBeGreaterThanOrEqual(30);
      expect(places.at(-1)).toBe(26);
      expect(standings.focusCarIdx).toBe(PLAYER);
      expect(standings.carIdxPosition[PLAYER]).toBe(26);
      expect(standings.carIdxClassPosition[PLAYER]).toBe(2);
      // The field the place is out of: every car of the session.
      const racing = (session.DriverInfo?.Drivers ?? []).filter(
        (driver) => !driver.CarIsPaceCar && !driver.IsSpectator
      );
      expect(racing).toHaveLength(CARS);
      expect(sessionBar.competitorCarIds).toHaveLength(CARS);
      expect(sessionBar).toMatchObject({
        playerOverallPosition: 26,
        playerClassPosition: 2,
        playerClassSize: 14,
      });

      // The grid: 31st overall, seventh in class.
      const grid = session.QualifyResultsInfo?.Results ?? undefined;
      expect(grid).toHaveLength(CARS);
      const own = grid?.find((entry) => entry.CarIdx === PLAYER);
      expect(own?.Position).toBe(31);
      expect(own?.ClassPosition).toBe(6);
      expect(classGridChange(grid, PLAYER, 2)).toBe(5);
      expect(overallGridChange(grid, PLAYER, 26)).toBe(5);
      // The overall leader started on pole and is still there.
      expect(overallGridChange(grid, LEADER, 1)).toBe(0);
    }, 120_000);

    it('has the player clean on track limits: 0 of 5 points', async () => {
      let dirty = 0;
      const { last } = await play(({ sessionBar }) => {
        if ((sessionBar.trackLimitsPoints ?? 0) > 0) dirty += 1;
      });

      expect(dirty).toBe(0);
      expect(last?.sessionBar.trackLimitsPoints).toBe(0);
      expect(last?.sessionBar.trackLimitsPointsMax).toBe(5);
    }, 120_000);
  }
);
