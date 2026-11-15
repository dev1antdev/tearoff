import type {
  Sector,
  SectorTimingResultSnapshot,
  SectorTimingSnapshot,
  Session,
  SessionLifecycleEvent,
  Telemetry,
} from '@irdashies/types';
import type { TelemetryProcessor } from './TelemetryProcessor';

const MIN_PROGRESS = 0.00005;
/** Where a lap is far enough from the line that LMU's void flag is its own. */
const INVALIDATION_START_PCT = 0.05;
const MAX_FORWARD_JUMP = 0.5;
const MAX_LAP_PCT_PER_SECOND = 0.08;
const MAX_SPEED_CHECK_WINDOW = 5;
/**
 * How long the player can be out of the car and come back to the same
 * sector still being timed, as an incident inside it. Past half a minute,
 * where the car is found says nothing about where it was driven.
 */
const MAX_ABSENCE_SECONDS = 30;

/** Le Mans Ultimate times a lap in three sectors, on every track. */
const SIM_SECTOR_COUNT = 3;
/**
 * Where a sim-timed lap's sectors are taken to start until the car has been
 * seen crossing into them. LMU says which sector the car is in and how long
 * each one took, but not where on the lap one becomes the next.
 */
const NOMINAL_SIM_SECTORS: readonly Sector[] = [
  { SectorNum: 0, SectorStartPct: 0 },
  { SectorNum: 1, SectorStartPct: 1 / 3 },
  { SectorNum: 2, SectorStartPct: 2 / 3 },
];
/**
 * The longest the sim's sector index may trail the crossing it reports. LMU
 * writes the index five times a second, so it is a fifth of a second late at
 * most. A lap clock further than this from the sector times beside it is not
 * timing the same lap.
 */
const MAX_INDEX_LAG_SECONDS = 0.5;
/** Frames of position kept to place a crossing the index reported late. */
const POSITION_HISTORY = 128;

const numericValue = (
  frame: Telemetry,
  key: keyof Telemetry
): number | null => {
  const value = frame[key]?.value?.[0];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
};

/**
 * The sector the sim says the player is in, or null where it does not say:
 * under iRacing, which publishes the boundaries and leaves the timing to us.
 */
const simSectorIdxOf = (frame: Telemetry): number | null => {
  const value = frame.LmuSectorIdx?.value?.[0];
  return typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    value < SIM_SECTOR_COUNT
    ? value
    : null;
};

/** One of the sim's sector times, or null where it has not set one. */
const simTimeAt = (
  times: readonly (number | null)[] | undefined,
  index: number
): number | null => {
  const value = times?.[index];
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : null;
};

/**
 * The lap time the sim's last-lap sector times add up to, or null if one of
 * them is not set.
 */
const simLapTimeOf = (
  times: readonly (number | null)[] | undefined
): number | null => {
  const first = simTimeAt(times, 0);
  const second = simTimeAt(times, 1);
  const third = simTimeAt(times, 2);
  return first !== null && second !== null && third !== null
    ? first + second + third
    : null;
};

/**
 * How long before this frame the car crossed into the sector the sim's index
 * has just moved to, in seconds; 0 where that cannot be told.
 *
 * LMU's sector index and sector times come from its scoring block, written
 * five times a second, so the index moves up to a fifth of a second after
 * the car did. The lap clock runs at the telemetry rate, and the sim's own
 * sector times say how far into the lap the sector began: the difference is
 * how late the index was.
 */
const indexLag = (
  lapClock: number | null,
  sectorStartedAt: number | null
): number => {
  if (lapClock === null || sectorStartedAt === null) return 0;
  const lag = lapClock - sectorStartedAt;
  return lag >= 0 && lag <= MAX_INDEX_LAG_SECONDS ? lag : 0;
};

export const getSectorIdx = (
  lapDistPct: number,
  sectors: readonly Sector[]
): number => {
  let index = 0;
  for (let i = 0; i < sectors.length; i += 1) {
    if (lapDistPct >= sectors[i].SectorStartPct) index = i;
  }
  return index;
};

export const interpolateSectorCrossingTime = (
  boundary: number,
  previousPct: number,
  previousTime: number,
  currentPct: number,
  currentTime: number
): number => {
  const distance = currentPct - previousPct;
  if (distance === 0) return currentTime;
  return (
    previousTime +
    ((boundary - previousPct) / distance) * (currentTime - previousTime)
  );
};

const emptyResult = (count: number): SectorTimingResultSnapshot => ({
  currentLapSectorTimes: Array<number | null>(count).fill(null),
  previousLapSectorTimes: Array<number | null>(count).fill(null),
  currentLapSectorUnclean: Array<boolean>(count).fill(false),
  previousLapSectorUnclean: Array<boolean>(count).fill(false),
  sessionBestSectorTimes: Array<number | null>(count).fill(null),
  previousSessionBestSectorTimes: Array<number | null>(count).fill(null),
});

const cloneResult = (
  result: SectorTimingResultSnapshot
): SectorTimingResultSnapshot => ({
  currentLapSectorTimes: [...result.currentLapSectorTimes],
  previousLapSectorTimes: [...result.previousLapSectorTimes],
  currentLapSectorUnclean: [...result.currentLapSectorUnclean],
  previousLapSectorUnclean: [...result.previousLapSectorUnclean],
  sessionBestSectorTimes: [...result.sessionBestSectorTimes],
  previousSessionBestSectorTimes: [...result.previousSessionBestSectorTimes],
});

/**
 * The player's sector times, for the Sector Delta widget and the track map.
 *
 * Under iRacing the session says where the sectors start and the timing is
 * done here, by watching the car's position cross those points. Le Mans
 * Ultimate is the other way round: it times its own three sectors and says
 * which one the car is in, but not where they start. There the times are the
 * sim's, so they are the ones on its own timing screen, and the boundaries
 * are learned from where the car is when the sim moves it to the next sector.
 */
export class SectorTimingProcessor implements TelemetryProcessor<SectorTimingSnapshot> {
  readonly channel = 'sector-timing.snapshot';
  readonly tickRateHz = 'event';

  private lastLapDistPct = -1;
  private lastSessionTime = -1;
  private sectorEntryUnclean = false;
  private wasOnTrack = false;
  private enabled = true;
  /** The sectors the session describes, which the sim's own timing ignores. */
  private sessionSectors: readonly Sector[] = [];
  /** True while frames carry the sim's own sector timing. */
  private simTimed = false;
  /** Which sector starts the car has been seen crossing; the line is known. */
  private readonly sectorStartSeen = [true, false, false];
  /** The sim's last lap time on the previous frame, to see it move. */
  private simLastLapTime: number | null = null;
  /** The clock and position of the last frames, oldest overwritten first. */
  private readonly historyTimes = new Float64Array(POSITION_HISTORY);
  private readonly historyPcts = new Float64Array(POSITION_HISTORY);
  private historyHead = 0;
  private historyCount = 0;
  private latest: SectorTimingSnapshot = this.emptySnapshot();

  init(session: Session): void {
    const sectors = [...(session.SplitTimeInfo?.Sectors ?? [])].sort(
      (a, b) => a.SectorStartPct - b.SectorStartPct
    );
    // Against what the session last said rather than what is published:
    // under LMU the published starts are the learned ones, and a session
    // republished unchanged must not throw them away.
    const unchanged =
      sectors.length === this.sessionSectors.length &&
      sectors.every(
        (sector, index) =>
          sector.SectorNum === this.sessionSectors[index].SectorNum &&
          sector.SectorStartPct === this.sessionSectors[index].SectorStartPct
      );
    if (unchanged) return;
    this.sessionSectors = sectors;
    this.resetState(this.startingSectors(), this.latest.sessionNum);
  }

  onFrame(frame: Telemetry): void {
    if (!this.enabled) return;
    const simSectorIdx = simSectorIdxOf(frame);
    if ((simSectorIdx !== null) !== this.simTimed) {
      this.simTimed = simSectorIdx !== null;
      this.resetState(this.startingSectors(), this.latest.sessionNum);
    }
    if (this.latest.sectors.length === 0) return;
    const lapDistPct = numericValue(frame, 'LapDistPct');
    const sessionTime = numericValue(frame, 'SessionTime');
    const sessionNum = numericValue(frame, 'SessionNum');
    const isOnTrack = frame.IsOnTrack?.value?.[0] === true;
    if (lapDistPct === null || sessionTime === null) return;
    if (
      sessionNum !== null &&
      this.latest.sessionNum !== null &&
      sessionNum !== this.latest.sessionNum
    ) {
      this.resetState(this.startingSectors(), sessionNum);
    }
    if (this.wasOnTrack && !isOnTrack && this.latest.sectorEntryValid) {
      this.sectorEntryUnclean = true;
    }
    if (!isOnTrack) {
      this.wasOnTrack = false;
      return;
    }
    // Back in the car after more than a moment out of it. A brief exit is an
    // incident inside the sector, which stays timed and is marked unclean.
    // A long one is not driving at all: the car was parked, or a team-mate
    // drove it for an hour, and the position it is found at is where they
    // left it. Timed across that, the first boundary crossed would close a
    // sector that began before the player got out, with the whole time away
    // counted into it, and nothing to say it was not a session best.
    if (
      !this.wasOnTrack &&
      this.lastLapDistPct >= 0 &&
      (sessionTime - this.lastSessionTime >= MAX_ABSENCE_SECONDS ||
        sessionTime < this.lastSessionTime)
    ) {
      this.lastLapDistPct = -1;
      this.sectorEntryUnclean = false;
      this.latest = { ...this.latest, sectorEntryValid: false };
    }
    const returning = !this.wasOnTrack;
    this.wasOnTrack = true;
    // LMU voids a lap for a track cut without the car leaving the track, and
    // keeps the flag set for the rest of the lap: the sector in progress is
    // not clean. Ignored just after the line, where the flag may still be the
    // previous lap's. iRacing publishes no such var.
    if (
      frame.LmuLapInvalidated?.value?.[0] === true &&
      lapDistPct >= INVALIDATION_START_PCT &&
      this.latest.sectorEntryValid
    ) {
      this.sectorEntryUnclean = true;
    }
    if (simSectorIdx !== null) {
      this.onSimTimedFrame(
        frame,
        simSectorIdx,
        lapDistPct,
        sessionTime,
        sessionNum,
        returning
      );
      return;
    }
    if (this.lastLapDistPct < 0) {
      this.lastLapDistPct = lapDistPct;
      this.lastSessionTime = sessionTime;
      this.latest = {
        ...this.latest,
        currentSectorIdx: getSectorIdx(lapDistPct, this.latest.sectors),
        sectorEntryTime: sessionTime,
        sessionNum,
        version: this.latest.version + 1,
      };
      return;
    }

    const delta = lapDistPct - this.lastLapDistPct;
    const lastSectorStart =
      this.latest.sectors[this.latest.sectors.length - 1]?.SectorStartPct ?? 0;
    const firstSectorEnd = this.latest.sectors[1]?.SectorStartPct ?? 1;
    const wrapped =
      delta < 0 &&
      this.lastLapDistPct >= lastSectorStart &&
      lapDistPct < firstSectorEnd;
    if (wrapped) {
      const crossingTime = interpolateSectorCrossingTime(
        1,
        this.lastLapDistPct,
        this.lastSessionTime,
        lapDistPct + 1,
        sessionTime
      );
      this.completeSector(
        crossingTime - this.latest.sectorEntryTime,
        crossingTime,
        0,
        true
      );
      this.lastLapDistPct = lapDistPct;
      this.lastSessionTime = sessionTime;
      this.publishEvent(sessionNum);
      return;
    }

    const tickDuration = sessionTime - this.lastSessionTime;
    // -MIN_PROGRESS, not 0: heavy/early braking spends many ticks near zero
    // ground speed, where position-signal noise can read a hair negative.
    // Without this tolerance that noise reads as a teleport and nulls out
    // the current sector's time — matched below by MIN_PROGRESS treating
    // the same-sized *forward* creep as a no-op rather than movement. The
    // genuine lap-wrap case is already handled and returned above, so this
    // negative delta is never a real wrap.
    const teleported =
      delta < -MIN_PROGRESS ||
      delta > MAX_FORWARD_JUMP ||
      (delta > 0 &&
        tickDuration > 0 &&
        tickDuration < MAX_SPEED_CHECK_WINDOW &&
        delta / tickDuration > MAX_LAP_PCT_PER_SECOND);
    if (teleported) {
      this.lastLapDistPct = lapDistPct;
      this.lastSessionTime = sessionTime;
      this.abandonSector(
        getSectorIdx(lapDistPct, this.latest.sectors),
        sessionTime,
        sessionNum
      );
      return;
    }

    const previousPct = this.lastLapDistPct;
    const previousTime = this.lastSessionTime;
    this.lastLapDistPct = lapDistPct;
    this.lastSessionTime = sessionTime;
    if (delta >= MIN_PROGRESS) {
      const nextSectorIdx = getSectorIdx(lapDistPct, this.latest.sectors);
      if (nextSectorIdx !== this.latest.currentSectorIdx) {
        const crossingTime = interpolateSectorCrossingTime(
          this.latest.sectors[nextSectorIdx].SectorStartPct,
          previousPct,
          previousTime,
          lapDistPct,
          sessionTime
        );
        this.completeSector(
          crossingTime - this.latest.sectorEntryTime,
          crossingTime,
          nextSectorIdx,
          false
        );
        this.publishEvent(sessionNum);
      }
    }
  }

  onLifecycle(event: SessionLifecycleEvent): void {
    if (event.type === 'enter') {
      this.enabled = !event.replay;
      if (!this.enabled) this.resetState(this.startingSectors(), null);
      return;
    }
    if (event.type === 'disconnect') {
      // Whatever connects next says for itself what it is and what its
      // sectors are.
      this.sessionSectors = [];
      this.simTimed = false;
    }
    this.resetState(this.startingSectors(), null);
  }

  snapshot(): SectorTimingSnapshot {
    return this.latest;
  }

  /**
   * A frame in the car under Le Mans Ultimate.
   *
   * The sim's index says which sector the car is in, and a sector is over
   * when the index moves on to the next. Its time is the sim's own figure,
   * published in the same scoring update that moves the index: the first
   * two sectors in the current-lap times, the third as what the last-lap
   * times leave of the lap, which the sim rewrites at the line.
   *
   * Only a sector watched from the moment the car entered it is recorded,
   * as under iRacing, so the sector a session or a stint starts in is not.
   */
  private onSimTimedFrame(
    frame: Telemetry,
    sectorIdx: number,
    lapDistPct: number,
    sessionTime: number,
    sessionNum: number | null,
    returning: boolean
  ): void {
    const firstFrame = this.lastLapDistPct < 0;
    const rewound = !firstFrame && sessionTime < this.lastSessionTime;
    const lastLapTime = simLapTimeOf(frame.LmuLastSectorTimes?.value);
    const previousLastLapTime = this.simLastLapTime;
    this.simLastLapTime = lastLapTime;
    this.lastLapDistPct = lapDistPct;
    this.lastSessionTime = sessionTime;

    if (firstFrame) {
      this.historyCount = 0;
      this.rememberPosition(sessionTime, lapDistPct);
      this.latest = {
        ...this.latest,
        currentSectorIdx: sectorIdx,
        sectorEntryTime: sessionTime,
        sessionNum,
        version: this.latest.version + 1,
      };
      return;
    }

    const previousIdx = this.latest.currentSectorIdx;
    const movedOn = sectorIdx === (previousIdx + 1) % SIM_SECTOR_COUNT;
    // Not a sector driven to its end: the clock went back, as for a session
    // started again, or the car is in a sector it did not drive into -- put
    // back in its garage, or moved while the player was out of it.
    if (rewound || (sectorIdx !== previousIdx && (returning || !movedOn))) {
      this.historyCount = 0;
      this.rememberPosition(sessionTime, lapDistPct);
      this.abandonSector(sectorIdx, sessionTime, sessionNum);
      return;
    }
    this.rememberPosition(sessionTime, lapDistPct);
    if (sectorIdx === previousIdx) return;

    const current = frame.LmuCurrentSectorTimes?.value;
    const first = simTimeAt(current, 0);
    const second = simTimeAt(current, 1);
    let sectorTime: number | null;
    // How far into the lap the sector now entered began, by the sim's times.
    let sectorStartedAt: number | null;
    if (previousIdx === 0) {
      sectorTime = first;
      sectorStartedAt = first;
    } else if (previousIdx === 1) {
      sectorTime = second;
      sectorStartedAt =
        first !== null && second !== null ? first + second : null;
    } else {
      // The last-lap times are this lap's only once the sim has rewritten
      // them, which it does in the update that moves the index. A lap time
      // that did not move with it is still the lap before's.
      sectorTime =
        lastLapTime !== null && lastLapTime !== previousLastLapTime
          ? simTimeAt(frame.LmuLastSectorTimes?.value, 2)
          : null;
      sectorStartedAt = 0;
    }

    const entryTime =
      sessionTime -
      indexLag(numericValue(frame, 'LapCurrentLapTime'), sectorStartedAt);
    this.placeSectorStart(sectorIdx, this.positionAt(entryTime) ?? lapDistPct);
    this.completeSector(sectorTime, entryTime, sectorIdx, sectorIdx === 0);
    this.publishEvent(sessionNum);
  }

  /**
   * Moves a sector's start to where the car has just been seen entering it,
   * under the sim's timing. The other start, while it is still a guess, is
   * kept on its own side of this one.
   */
  private placeSectorStart(sectorIdx: number, lapDistPct: number): void {
    if (sectorIdx === 0 || !(lapDistPct > 0 && lapDistPct < 1)) return;
    const otherIdx = sectorIdx === 1 ? 2 : 1;
    const otherPct = this.latest.sectors[otherIdx].SectorStartPct;
    const inOrder =
      sectorIdx === 1 ? lapDistPct < otherPct : lapDistPct > otherPct;
    // Two starts seen in the wrong order: one of them is not a crossing.
    if (!inOrder && this.sectorStartSeen[otherIdx]) return;
    this.sectorStartSeen[sectorIdx] = true;
    if (this.latest.sectors[sectorIdx].SectorStartPct === lapDistPct) return;
    const sectors = this.latest.sectors.map((sector) => ({ ...sector }));
    sectors[sectorIdx].SectorStartPct = lapDistPct;
    if (!inOrder) {
      sectors[otherIdx].SectorStartPct =
        sectorIdx === 1 ? (lapDistPct + 1) / 2 : lapDistPct / 2;
    }
    this.latest = { ...this.latest, sectors };
  }

  private rememberPosition(sessionTime: number, lapDistPct: number): void {
    this.historyTimes[this.historyHead] = sessionTime;
    this.historyPcts[this.historyHead] = lapDistPct;
    this.historyHead = (this.historyHead + 1) % POSITION_HISTORY;
    if (this.historyCount < POSITION_HISTORY) this.historyCount += 1;
  }

  /**
   * Where the car was at a moment within the last few frames, or null when
   * that moment is not between two of them.
   */
  private positionAt(time: number): number | null {
    let newer = (this.historyHead + POSITION_HISTORY - 1) % POSITION_HISTORY;
    for (let step = 1; step < this.historyCount; step += 1) {
      const older = (newer + POSITION_HISTORY - 1) % POSITION_HISTORY;
      const from = this.historyTimes[older];
      const to = this.historyTimes[newer];
      if (time >= from && time <= to) {
        const fromPct = this.historyPcts[older];
        const toPct = this.historyPcts[newer];
        // A step back is the line: no place to read a sector start from.
        if (toPct < fromPct) return null;
        return to > from
          ? fromPct + ((time - from) / (to - from)) * (toPct - fromPct)
          : toPct;
      }
      newer = older;
    }
    return null;
  }

  /**
   * Stops timing the sector in progress: the car is somewhere it did not
   * drive to. Sectors already completed stand.
   */
  private abandonSector(
    currentSectorIdx: number,
    sessionTime: number,
    sessionNum: number | null
  ): void {
    const inclusive = cloneResult(this.latest.inclusive);
    const clean = cloneResult(this.latest.clean);
    (inclusive.currentLapSectorTimes as (number | null)[])[currentSectorIdx] =
      null;
    (clean.currentLapSectorTimes as (number | null)[])[currentSectorIdx] = null;
    this.sectorEntryUnclean = false;
    this.latest = {
      ...this.latest,
      inclusive,
      clean,
      currentSectorIdx,
      sectorEntryTime: sessionTime,
      sectorEntryValid: false,
    };
    this.publishEvent(sessionNum);
  }

  /**
   * Closes the sector in progress and opens the next.
   *
   * `sectorTime` is null where the sector has no time to record: under LMU
   * the time is the sim's to give, and nothing is made up where it gave none.
   */
  private completeSector(
    sectorTime: number | null,
    crossingTime: number,
    nextSectorIdx: number,
    resetLap: boolean
  ): void {
    const completedIdx = this.latest.currentSectorIdx;
    const timed = this.latest.sectorEntryValid ? sectorTime : null;
    const resetCurrentLap = (result: SectorTimingResultSnapshot) => ({
      ...result,
      currentLapSectorTimes: Array<number | null>(
        this.latest.sectors.length
      ).fill(null),
      currentLapSectorUnclean: Array<boolean>(this.latest.sectors.length).fill(
        false
      ),
    });
    const inclusive =
      timed !== null
        ? this.record(this.latest.inclusive, completedIdx, timed, resetLap)
        : resetLap
          ? resetCurrentLap(this.latest.inclusive)
          : this.latest.inclusive;
    const clean =
      timed !== null && !this.sectorEntryUnclean
        ? this.record(this.latest.clean, completedIdx, timed, resetLap)
        : resetLap
          ? resetCurrentLap(this.latest.clean)
          : this.latest.clean;
    this.latest = {
      ...this.latest,
      inclusive,
      clean,
      currentSectorIdx: nextSectorIdx,
      sectorEntryTime: crossingTime,
      sectorEntryValid: true,
    };
    this.sectorEntryUnclean = false;
  }

  private record(
    source: SectorTimingResultSnapshot,
    sectorIdx: number,
    sectorTime: number,
    resetLap: boolean
  ): SectorTimingResultSnapshot {
    const result = cloneResult(source);
    const current = result.currentLapSectorTimes as (number | null)[];
    const previous = result.previousLapSectorTimes as (number | null)[];
    const currentUnclean = result.currentLapSectorUnclean as boolean[];
    const previousUnclean = result.previousLapSectorUnclean as boolean[];
    const bests = result.sessionBestSectorTimes as (number | null)[];
    const previousBests = result.previousSessionBestSectorTimes as (
      number | null
    )[];
    const oldBest = bests[sectorIdx];
    if (oldBest === null || sectorTime < oldBest) {
      previousBests[sectorIdx] = oldBest;
      bests[sectorIdx] = sectorTime;
    }
    previous[sectorIdx] = sectorTime;
    previousUnclean[sectorIdx] = this.sectorEntryUnclean;
    if (resetLap) {
      result.currentLapSectorTimes = Array<number | null>(
        this.latest.sectors.length
      ).fill(null);
      result.currentLapSectorUnclean = Array<boolean>(
        this.latest.sectors.length
      ).fill(false);
    } else {
      current[sectorIdx] = sectorTime;
      currentUnclean[sectorIdx] = this.sectorEntryUnclean;
    }
    return result;
  }

  private publishEvent(sessionNum: number | null): void {
    this.latest = {
      ...this.latest,
      sessionNum,
      version: this.latest.version + 1,
    };
  }

  private resetState(
    sectors: readonly Sector[],
    sessionNum: number | null
  ): void {
    this.lastLapDistPct = -1;
    this.lastSessionTime = -1;
    this.sectorEntryUnclean = false;
    this.wasOnTrack = false;
    this.sectorStartSeen.fill(false, 1);
    this.simLastLapTime = null;
    this.historyCount = 0;
    this.latest = this.emptySnapshot(
      sectors,
      sessionNum,
      this.latest.version + 1
    );
  }

  /**
   * The sectors a fresh state starts from: the session's own, or under the
   * sim's timing three of them, placed by the session if it places three.
   */
  private startingSectors(): readonly Sector[] {
    if (!this.simTimed) return this.sessionSectors;
    return this.sessionSectors.length === SIM_SECTOR_COUNT
      ? this.sessionSectors
      : NOMINAL_SIM_SECTORS;
  }

  private emptySnapshot(
    sectors: readonly Sector[] = [],
    sessionNum: number | null = null,
    version = 0
  ): SectorTimingSnapshot {
    return {
      sectors,
      currentSectorIdx: 0,
      sectorEntryTime: 0,
      sectorEntryValid: false,
      inclusive: emptyResult(sectors.length),
      clean: emptyResult(sectors.length),
      sessionNum,
      version,
    };
  }
}
