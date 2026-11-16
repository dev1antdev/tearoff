import type {
  Sector,
  SectorAllTimeBestsSnapshot,
  SectorTimingResultSnapshot,
  SectorTimingSnapshot,
  Session,
  SessionLifecycleEvent,
  Telemetry,
} from '@irdashies/types';
import { isCleanSector } from '../../shared/lapValidity';
import {
  emptySectorBests,
  isQuickerLap,
  offerSectorTime,
  parseSectorBests,
  sectorBestsKey,
  sectorLayoutKey,
  SIM_SECTOR_LAYOUT,
  type SectorBests,
} from '../../shared/sectorBests';
import type { TelemetryProcessor } from './TelemetryProcessor';
import { isHeldAtLine } from './lapTiming';
import {
  indexLag,
  PositionHistory,
  simSectorStartedAt,
  simTimeAt,
} from './sectorIndexLag';

/**
 * Where the player's best sectors are kept between sessions: the store of
 * small values per simulator, track and car.
 */
export interface SectorBestsStore {
  /**
   * What is kept under a key, as it was stored. Undefined while the store
   * cannot say yet -- its file is still being read -- and null when it
   * holds nothing.
   */
  load(key: string): unknown;
  /** Replaces what is kept under a key. Returns at once. */
  save(key: string, bests: SectorBests): void;
  /** Moves whenever `load` may answer differently. */
  revision(): number;
}

export interface SectorBestsOptions {
  store: SectorBestsStore;
  /** 'iracing' or 'lmu': bests of one simulator are not another's. */
  simulator: string;
}

const MIN_PROGRESS = 0.00005;
/**
 * How long after Le Mans Ultimate lets a car go from the line a crossing of
 * it is still the start of the race and not a lap begun at speed.
 */
const HELD_RELEASE_SECONDS = 2;
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

const noTimes = (count: number): (number | null)[] =>
  Array<number | null>(count).fill(null);

const emptyResult = (count: number): SectorTimingResultSnapshot => ({
  currentLapSectorTimes: noTimes(count),
  previousLapSectorTimes: noTimes(count),
  currentLapSectorUnclean: Array<boolean>(count).fill(false),
  previousLapSectorUnclean: Array<boolean>(count).fill(false),
  sessionBestSectorTimes: noTimes(count),
  previousSessionBestSectorTimes: noTimes(count),
  sessionBestLapSectorTimes: noTimes(count),
  finishedLapSectorTimes: noTimes(count),
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
  // Replaced whole when they change, never written into.
  sessionBestLapSectorTimes: result.sessionBestLapSectorTimes,
  finishedLapSectorTimes: result.finishedLapSectorTimes,
});

const sameTimes = (
  a: readonly (number | null)[],
  b: readonly (number | null)[]
): boolean =>
  a.length === b.length && a.every((time, index) => time === b[index]);

const sameAllTime = (
  a: SectorAllTimeBestsSnapshot | null,
  b: SectorAllTimeBestsSnapshot | null
): boolean =>
  a === null || b === null
    ? a === b
    : sameTimes(a.bestSectorTimes, b.bestSectorTimes) &&
      sameTimes(a.previousBestSectorTimes, b.previousBestSectorTimes) &&
      sameTimes(a.bestLapSectorTimes, b.bestLapSectorTimes);

/**
 * The player's sector times, for the Sector Delta widget and the track map.
 *
 * Under iRacing the session says where the sectors start and the timing is
 * done here, by watching the car's position cross those points. Le Mans
 * Ultimate is the other way round: it times its own three sectors and says
 * which one the car is in, but not where they start. There the times are the
 * sim's, so they are the ones on its own timing screen, and the boundaries
 * are learned from where the car is when the sim moves it to the next sector.
 *
 * Beside the session's bests it keeps the player's all-time ones for the
 * simulator, track and car, through the store it is handed: the quickest
 * time of each sector, whose sum is the theoretical best lap, and the
 * sectors of the quickest whole lap. Those are fed more strictly than the
 * session's: only by a sector entered at a crossing that was seen, driven
 * without leaving the track, not voided, and not on pit road.
 *
 * Only the user's own driving is timed. With a team-mate at the wheel the
 * user is out of the car, nothing is recorded, and no best of any kind is
 * theirs.
 */
export class SectorTimingProcessor implements TelemetryProcessor<SectorTimingSnapshot> {
  readonly channel = 'sector-timing.snapshot';
  readonly tickRateHz = 'event';

  private lastLapDistPct = -1;
  private lastSessionTime = -1;
  /** The car left the track, or the player the car, during the sector. */
  private sectorOffTrack = false;
  /** The sim had voided the lap by this point of the sector. */
  private sectorVoided = false;
  /** The car was on pit road during the sector, and is on this frame. */
  private sectorOnPitRoad = false;
  private onPitRoad = false;
  /** The lap under way touched pit road. */
  private lapOnPitRoad = false;
  /**
   * Every sector of the lap under way was entered at a crossing that was
   * seen, from the line on. Only such a lap is a lap of sector times.
   */
  private lapWhole = false;
  /** The lap under way began with the car let go from the line. */
  private lapFromStart = false;
  /** When the sim last held the car at the line, on the session clock. */
  private lastHeldAt: number | null = null;
  private playerCarIdx = -1;
  private trackId = -1;
  private carKey = '';
  /** What the all-time bests are kept under; '' with nowhere to keep them. */
  private bestsKey = '';
  /** The store's revision when it was last read. */
  private bestsRevision = -1;
  /** Whether the store has answered for this key. */
  private bestsLoaded = false;
  /** The all-time bests: what the store held and what was driven since. */
  private bests: SectorBests = emptySectorBests(0);
  private previousBests: (number | null)[] = [];
  /** The sectors of the lap under way that were fit to be all-time bests. */
  private lapCleanSectors: (number | null)[] = [];
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
  /** Where the car was on the last frames, to place a late-reported entry. */
  private readonly history = new PositionHistory();
  private latest: SectorTimingSnapshot = this.emptySnapshot();

  /**
   * @param sectorBests Where the all-time bests are kept and which
   *   simulator they are filed under. Without it there are none.
   */
  constructor(private readonly sectorBests?: SectorBestsOptions) {}

  init(session: Session): void {
    const playerCarIdx = session.DriverInfo?.DriverCarIdx ?? -1;
    const player = session.DriverInfo?.Drivers?.find(
      (driver) => driver?.CarIdx === playerCarIdx
    );
    // The lap library's key for a car: LMU's CarPath is the livery file, so
    // it names the model separately. iRacing's CarPath is the model.
    const carKey = player?.CarModel ?? player?.CarPath ?? '';
    const trackId = session.WeekendInfo?.TrackID ?? -1;
    // A session that for a moment names no player, car or track -- a roster
    // being rebuilt -- says nothing new: what was known stands until another
    // is named, or the sim goes away.
    if (playerCarIdx >= 0) this.playerCarIdx = playerCarIdx;
    if (trackId > 0) this.trackId = trackId;
    if (carKey !== '') this.carKey = carKey;

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
    if (unchanged) {
      // The same sectors on another track or in another car are not the
      // same bests.
      if (this.refreshBests()) this.publishEvent(this.latest.sessionNum);
      return;
    }
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
    // The store has finished reading its file, or its values were changed
    // from outside.
    if (this.syncBests()) this.publishEvent(this.latest.sessionNum);
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
      this.sectorOffTrack = true;
    }
    if (!isOnTrack) {
      this.wasOnTrack = false;
      return;
    }
    // The pit lane is not the track. The session's own bests take a sector
    // driven through it as they always have; the all-time ones and a best
    // lap do not.
    this.onPitRoad =
      frame.OnPitRoad?.value?.[0] === true ||
      (this.playerCarIdx >= 0 &&
        frame.CarIdxOnPitRoad?.value?.[this.playerCarIdx] === true);
    if (this.onPitRoad) {
      this.sectorOnPitRoad = true;
      this.lapOnPitRoad = true;
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
      this.clearSectorFacts();
      this.lapWhole = false;
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
      this.sectorVoided = true;
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
      // A replay is not driven: nothing of it is timed, and the all-time
      // bests are neither read nor written.
      if (!this.enabled) this.resetState(this.startingSectors(), null);
      else if (this.refreshBests()) this.publishEvent(this.latest.sessionNum);
      return;
    }
    if (event.type === 'disconnect') {
      // Whatever connects next says for itself what it is and what its
      // sectors are, and which track and car its bests belong to.
      this.sessionSectors = [];
      this.simTimed = false;
      this.playerCarIdx = -1;
      this.trackId = -1;
      this.carKey = '';
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
    // Held at the line on the grid, or rolling up to the start: the lap
    // that follows begins by the car being let go, not at speed.
    if (isHeldAtLine(lapDistPct)) {
      this.lapFromStart = true;
      this.lastHeldAt = sessionTime;
    }

    if (firstFrame) {
      this.history.clear();
      this.history.remember(sessionTime, lapDistPct);
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
      this.history.clear();
      this.history.remember(sessionTime, lapDistPct);
      this.abandonSector(sectorIdx, sessionTime, sessionNum);
      return;
    }
    this.history.remember(sessionTime, lapDistPct);
    if (sectorIdx === previousIdx) return;

    const current = frame.LmuCurrentSectorTimes?.value;
    let sectorTime: number | null;
    if (previousIdx === 0) {
      sectorTime = simTimeAt(current, 0);
    } else if (previousIdx === 1) {
      sectorTime = simTimeAt(current, 1);
    } else {
      // The last-lap times are this lap's only once the sim has rewritten
      // them, which it does in the update that moves the index. A lap time
      // that did not move with it is still the lap before's.
      sectorTime =
        lastLapTime !== null && lastLapTime !== previousLastLapTime
          ? simTimeAt(frame.LmuLastSectorTimes?.value, 2)
          : null;
    }

    const entryTime =
      sessionTime -
      indexLag(
        numericValue(frame, 'LapCurrentLapTime'),
        simSectorStartedAt(current, sectorIdx)
      );
    this.placeSectorStart(
      sectorIdx,
      this.history.positionAt(entryTime) ?? lapDistPct
    );
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
    this.clearSectorFacts();
    // Whatever is driven from here to the line is not a lap.
    this.lapWhole = false;
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
    const entered = this.latest.sectorEntryValid;
    const timed = entered ? sectorTime : null;
    const unclean = this.sectorOffTrack || this.sectorVoided;
    // At the line, whether what has just ended is a lap to keep the sectors
    // of: driven from the line through every boundary in turn, never on pit
    // road, and not begun on the grid.
    const lapCounts =
      resetLap && this.lapWhole && !this.lapOnPitRoad && !this.lapFromStart;
    const inclusive = this.advance(
      this.latest.inclusive,
      completedIdx,
      timed,
      unclean,
      resetLap,
      lapCounts
    );
    const clean = this.advance(
      this.latest.clean,
      completedIdx,
      unclean ? null : timed,
      false,
      resetLap,
      lapCounts
    );
    // The all-time bests take less than the session's clean view does: no
    // sector on pit road, and not the one a race starts in.
    const fitForAllTime =
      timed !== null &&
      isCleanSector({
        enteredAtCrossing: entered,
        offTrack: this.sectorOffTrack,
        voided: this.sectorVoided,
        onPitRoad: this.sectorOnPitRoad,
      }) &&
      !(completedIdx === 0 && this.lapFromStart);
    const allTimeMoved = this.offerAllTime(
      completedIdx,
      fitForAllTime ? timed : null,
      resetLap,
      lapCounts
    );
    this.latest = {
      ...this.latest,
      inclusive,
      clean,
      currentSectorIdx: nextSectorIdx,
      sectorEntryTime: crossingTime,
      sectorEntryValid: true,
    };
    if (allTimeMoved) this.applyAllTime();
    this.clearSectorFacts();
    if (resetLap) {
      this.lapWhole = true;
      this.lapOnPitRoad = this.onPitRoad;
      this.lapFromStart =
        this.lastHeldAt !== null &&
        Math.abs(crossingTime - this.lastHeldAt) <= HELD_RELEASE_SECONDS;
    }
  }

  /**
   * One view after a sector has ended: its time recorded where it has one,
   * and at the line the lap closed.
   */
  private advance(
    source: SectorTimingResultSnapshot,
    sectorIdx: number,
    sectorTime: number | null,
    unclean: boolean,
    resetLap: boolean,
    lapCounts: boolean
  ): SectorTimingResultSnapshot {
    if (sectorTime === null && !resetLap) return source;
    const result = cloneResult(source);
    if (sectorTime !== null) {
      const bests = result.sessionBestSectorTimes as (number | null)[];
      const previousBests = result.previousSessionBestSectorTimes as (
        number | null
      )[];
      const oldBest = bests[sectorIdx];
      if (oldBest === null || sectorTime < oldBest) {
        previousBests[sectorIdx] = oldBest;
        bests[sectorIdx] = sectorTime;
      }
      (result.previousLapSectorTimes as (number | null)[])[sectorIdx] =
        sectorTime;
      (result.previousLapSectorUnclean as boolean[])[sectorIdx] = unclean;
    }
    if (!resetLap) {
      (result.currentLapSectorTimes as (number | null)[])[sectorIdx] =
        sectorTime;
      (result.currentLapSectorUnclean as boolean[])[sectorIdx] = unclean;
      return result;
    }
    // The lap that has just ended, as this view holds it.
    const lap = [...source.currentLapSectorTimes];
    lap[sectorIdx] = sectorTime;
    result.finishedLapSectorTimes = lap;
    if (lapCounts && isQuickerLap(lap, result.sessionBestLapSectorTimes)) {
      result.sessionBestLapSectorTimes = lap;
    }
    const count = this.latest.sectors.length;
    result.currentLapSectorTimes = noTimes(count);
    result.currentLapSectorUnclean = Array<boolean>(count).fill(false);
    return result;
  }

  /**
   * Offers a sector that has just ended, and at the line the lap, to the
   * all-time bests. Returns whether what is published has moved.
   */
  private offerAllTime(
    sectorIdx: number,
    sectorTime: number | null,
    resetLap: boolean,
    lapCounts: boolean
  ): boolean {
    if (this.bestsKey === '') return false;
    let improved = false;
    if (sectorTime !== null) {
      const before = this.bests.bestSectorTimes[sectorIdx] ?? null;
      if (offerSectorTime(this.bests.bestSectorTimes, sectorIdx, sectorTime)) {
        this.previousBests[sectorIdx] = before;
        improved = true;
      }
      this.lapCleanSectors[sectorIdx] = sectorTime;
    }
    if (resetLap) {
      if (
        lapCounts &&
        isQuickerLap(this.lapCleanSectors, this.bests.bestLapSectorTimes)
      ) {
        this.bests.bestLapSectorTimes = [...this.lapCleanSectors];
        improved = true;
      }
      this.lapCleanSectors.fill(null);
    }
    // Until the store has answered, what it holds is not known: what is
    // driven meanwhile is kept here and set against it when it does.
    if (!improved || !this.bestsLoaded) return false;
    this.saveBests();
    return true;
  }

  private saveBests(): void {
    const store = this.sectorBests?.store;
    if (!store) return;
    store.save(this.bestsKey, {
      bestSectorTimes: [...this.bests.bestSectorTimes],
      bestLapSectorTimes: [...this.bests.bestLapSectorTimes],
    });
    // What was just written here is not news from the store.
    this.bestsRevision = store.revision();
  }

  /**
   * Reads the store again where it may answer differently. Returns whether
   * what is published has moved.
   */
  private syncBests(): boolean {
    const store = this.sectorBests?.store;
    if (!store || this.bestsKey === '') return false;
    const revision = store.revision();
    if (revision === this.bestsRevision) return false;
    this.bestsRevision = revision;
    const stored = store.load(this.bestsKey);
    if (stored === undefined) return false;
    const count = this.latest.sectors.length;
    const held = parseSectorBests(stored, count) ?? emptySectorBests(count);

    if (this.bestsLoaded) {
      // From its first answer on the store is the truth: what differs from
      // it now was changed from outside, and is taken as it stands.
      if (
        sameTimes(held.bestSectorTimes, this.bests.bestSectorTimes) &&
        sameTimes(held.bestLapSectorTimes, this.bests.bestLapSectorTimes)
      ) {
        return false;
      }
      this.bests = held;
      this.previousBests = noTimes(count);
      return this.applyAllTime();
    }

    // The first answer: what was driven while waiting for it is set
    // against what was kept, sector by sector.
    this.bestsLoaded = true;
    const driven = this.bests;
    let improved = false;
    for (let index = 0; index < count; index += 1) {
      const kept = held.bestSectorTimes[index];
      const time = driven.bestSectorTimes[index];
      if (time !== null && offerSectorTime(held.bestSectorTimes, index, time)) {
        const before = this.previousBests[index];
        this.previousBests[index] =
          before === null || kept === null
            ? (before ?? kept)
            : Math.min(before, kept);
        improved = true;
      } else {
        this.previousBests[index] = null;
      }
    }
    if (isQuickerLap(driven.bestLapSectorTimes, held.bestLapSectorTimes)) {
      held.bestLapSectorTimes = driven.bestLapSectorTimes;
      improved = true;
    }
    this.bests = held;
    if (improved) this.saveBests();
    this.applyAllTime();
    return true;
  }

  /**
   * Settles which key the all-time bests are kept under -- the simulator,
   * the track, the car and the sector layout -- and reads them. Returns
   * whether what is published has moved.
   */
  private refreshBests(): boolean {
    const count = this.latest.sectors.length;
    const options = this.sectorBests;
    const key =
      options &&
      this.enabled &&
      count > 0 &&
      this.trackId > 0 &&
      this.carKey !== ''
        ? sectorBestsKey(
            options.simulator,
            this.trackId,
            this.carKey,
            // The sim's own three sectors start where the sim says, which is
            // not where a session's thirds do.
            this.simTimed
              ? SIM_SECTOR_LAYOUT
              : sectorLayoutKey(
                  this.sessionSectors.map((sector) => sector.SectorStartPct)
                )
          )
        : '';
    if (key !== this.bestsKey || this.bests.bestSectorTimes.length !== count) {
      this.bestsKey = key;
      this.bestsLoaded = false;
      this.bestsRevision = -1;
      this.bests = emptySectorBests(count);
      this.previousBests = noTimes(count);
      this.lapCleanSectors = noTimes(count);
    }
    const synced = this.syncBests();
    return this.applyAllTime() || synced;
  }

  /** Puts the all-time bests as they stand into the snapshot. */
  private applyAllTime(): boolean {
    const next: SectorAllTimeBestsSnapshot | null =
      this.bestsKey !== '' && this.bestsLoaded
        ? {
            bestSectorTimes: [...this.bests.bestSectorTimes],
            previousBestSectorTimes: [...this.previousBests],
            bestLapSectorTimes: [...this.bests.bestLapSectorTimes],
          }
        : null;
    if (sameAllTime(this.latest.allTime, next)) return false;
    this.latest = { ...this.latest, allTime: next };
    return true;
  }

  /** A new sector starts with nothing against it but the pit lane. */
  private clearSectorFacts(): void {
    this.sectorOffTrack = false;
    this.sectorVoided = false;
    this.sectorOnPitRoad = this.onPitRoad;
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
    this.onPitRoad = false;
    this.clearSectorFacts();
    this.lapOnPitRoad = false;
    this.lapWhole = false;
    this.lapFromStart = false;
    this.lastHeldAt = null;
    this.wasOnTrack = false;
    this.sectorStartSeen.fill(false, 1);
    this.simLastLapTime = null;
    this.history.clear();
    this.latest = this.emptySnapshot(
      sectors,
      sessionNum,
      this.latest.version + 1
    );
    // The session's bests go; the all-time ones are the same as before
    // unless the track, the car or the sector layout is another.
    this.refreshBests();
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
      allTime: null,
      sessionNum,
      version,
    };
  }
}
