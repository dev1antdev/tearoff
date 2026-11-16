import type {
  RaceCarLaps,
  RaceDriverChange,
  RaceEvent,
  RaceInfo,
  RaceLap,
  RaceRecords,
  RaceStint,
  Session,
  StoredRace,
  StoredRaceState,
  Telemetry,
} from '@irdashies/types';
import type { ChannelBus } from '../bridge/channelBus';
import type { SessionLifecycle } from '../sessionLifecycle';
import type { PerformanceSections } from './lapHistoryRuntime';
import {
  RaceHistoryRecorder,
  type RaceHistoryListener,
  type RaceStart,
} from './RaceHistoryRecorder';
import { RaceLogRecorder } from './RaceLogRecorder';
import { isSameRace } from './raceResume';

/**
 * The history of the race being driven: every lap of every car, kept
 * whether or not a window is looking, stored as it is made, and carried on
 * when the app is started again in the middle of the race.
 *
 * Hosted outside the ProcessorHost like the pit stops and the player's
 * ledger, and for their reason: a processor runs only while a window wants
 * its channel, and a record of a 24-hour race with a hole for every minute
 * nobody was looking would be no record. The rules are the recorder's,
 * which is pure; this hands it the session and the frames, and does what
 * needs the world: the file, the channel, and the question of whether a
 * race found in the file is this one.
 *
 * The race's log is kept here too (`RaceLogRecorder`): what happened, one
 * event at a time, made of what the recorder says and of the frames at its
 * slow tick. It is recorded, stored and let go of with the rest of the
 * race, under the same switches, and published on a channel of its own.
 *
 * Three switches, each from outside:
 *
 * - enabled: something wants the record, the Pit Wall or a subscriber.
 *   While off no frame is read. Laps driven meanwhile are missing, and said
 *   to be.
 * - paused: an iRacing replay file is loaded. Scrubbing is not racing.
 * - persisting: the source is the player's own racing. Off for a recording
 *   played back, a replay source and demo mode: everything is still
 *   recorded and can be read, and nothing reaches the file.
 *
 * Only a race is stored. A practice or a qualifying session is recorded
 * like one and read like one, for as long as the app runs: the file keeps
 * a fixed number of races, and a weekend's other sessions are not to cost
 * it one.
 */

/** Where a race's rows are kept: the lap library's file, on its worker. */
export interface RaceHistoryPersistence {
  queueLap(race: RaceStart, lap: RaceLap): void;
  queueStint(race: RaceStart, stint: RaceStint): void;
  queueDriverChange(race: RaceStart, change: RaceDriverChange): void;
  /** An event of the race's log: a new one, or one that has changed. */
  queueEvent(race: RaceStart, event: RaceEvent): void;
  /** Events that went at the log's cap are to go from the file, by `seq`. */
  queueEventsRemoved(race: RaceStart, seqs: readonly number[]): void;
  /** The race's own row is to be brought up to date. */
  queueInfo(race: RaceStart): void;
  /** What the file holds for a slot is to go: another car is in it. */
  queueCarReplaced(race: RaceStart, carIdx: number): void;
  /** Writes what is waiting now. Never rejects. */
  flush(): Promise<void>;
  /** Calls back with a race's row once a batch of it is in the file. */
  onStored(callback: (token: string, raceId: number) => void): () => void;
  /** The most recent races of a simulator, track and kind of session. */
  findCandidates(
    simulator: string,
    trackId: number,
    sessionType: string | null
  ): Promise<StoredRaceState[]>;
  /** Everything kept of a race; null when there is no such race. */
  load(raceId: number): Promise<RaceRecords | null>;
  listRaces(): Promise<StoredRace[]>;
  carLaps(raceId: number, carIdx: number): Promise<RaceLap[]>;
  carStints(raceId: number, carIdx: number): Promise<RaceStint[]>;
  driverChanges(raceId: number): Promise<RaceDriverChange[]>;
  /** Events of a race's log numbered below `before`, oldest first. */
  events(raceId: number, before?: number): Promise<RaceEvent[]>;
}

export interface RaceHistoryRuntimeOptions {
  /** 'iracing' or 'lmu', as known when a race begins; '' while unknown. */
  simulator: () => string;
  /** Whether that simulator's session id names one event and no other. */
  sessionIdsAreUnique: () => boolean;
  /** Wall-clock time in Unix milliseconds. */
  now: () => number;
  /** Distinguishes one run of the app from the next. */
  bootId: string;
  log?: (message: string) => void;
  logError?: (message: string, error: unknown) => void;
}

const CHANNEL = 'race-history.summary';
const LOG_CHANNEL = 'race-log.snapshot';
/**
 * The summary and the log each go out at most this often, and only when
 * they have changed.
 */
const SUMMARY_INTERVAL_MS = 1000;
/** The session type of the one kind of session that is stored. */
const STORED_SESSION_TYPE = 'Race';

/**
 * What a race has to be written, while it is not yet known whether the
 * race is one the file already has. Written under the wrong row, laps of a
 * race carried on would be laps of a second race.
 */
interface Held {
  laps: Set<RaceLap>;
  stints: Set<RaceStint>;
  changes: Set<RaceDriverChange>;
  events: Set<RaceEvent>;
  /** Events the file holds that went at the log's cap, by `seq`. */
  removedEvents: Set<number>;
  replacedCars: Set<number>;
  info: boolean;
}

const copyOfLap = (lap: RaceLap): RaceLap => ({
  ...lap,
  sectors: [...lap.sectors],
  compounds: [...lap.compounds],
});

const copyOfStint = (stint: RaceStint): RaceStint => ({
  ...stint,
  stop: stint.stop ? { ...stint.stop } : null,
});

/** Lap numbers up to the last one kept that are not among those kept. */
const gapsIn = (laps: readonly RaceLap[]): number[] => {
  const missing: number[] = [];
  let expected = 1;
  for (const lap of laps) {
    for (; expected < lap.lap; expected += 1) missing.push(expected);
    expected = lap.lap + 1;
  }
  return missing;
};

export class RaceHistoryRuntime implements RaceHistoryListener {
  private readonly recorder: RaceHistoryRecorder;
  private readonly log: RaceLogRecorder;
  private readonly disconnects: (() => void)[];

  private enabled = true;
  private paused = false;
  private persisting = true;

  private race: RaceStart | null = null;
  private held: Held | null = null;

  private subscribers = 0;
  private publishedVersion = -1;
  private publishedAt = Number.NEGATIVE_INFINITY;

  private logSubscribers = 0;
  private logPublishedVersion = -1;
  private logPublishedAt = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly bus: ChannelBus,
    lifecycle: Pick<SessionLifecycle, 'onEnter' | 'onDisconnect'>,
    private readonly metrics: PerformanceSections,
    private readonly persistence: RaceHistoryPersistence,
    private readonly options: RaceHistoryRuntimeOptions
  ) {
    this.recorder = new RaceHistoryRecorder(this, {
      simulator: options.simulator,
      sessionIdsAreUnique: options.sessionIdsAreUnique,
      now: options.now,
      bootId: options.bootId,
    });
    this.log = new RaceLogRecorder({
      onEvent: (event) => this.onLogEvent(event),
      onEventsRemoved: (events) => this.onLogEventsRemoved(events),
    });
    this.disconnects = [
      // A connection that was never seen to end still ended.
      lifecycle.onEnter(() => this.letGo()),
      lifecycle.onDisconnect(() => this.letGo()),
      persistence.onStored((token, raceId) => {
        if (this.race?.token === token) this.recorder.noteStored(raceId);
      }),
      bus.onSubscriberCountChanged((channel, count) => {
        // The bus drops what it holds when the last window leaves, and
        // neither channel says anything again until something changes: a
        // window that arrives is sent what there is.
        if (channel === CHANNEL) {
          const gained = count > 0 && this.subscribers === 0;
          this.subscribers = count;
          if (gained) this.publish(true);
        } else if (channel === LOG_CHANNEL) {
          const gained = count > 0 && this.logSubscribers === 0;
          this.logSubscribers = count;
          if (gained) this.publishLog(true);
        }
      }),
    ];
  }

  onSession(session: Session): void {
    this.recorder.onSession(session);
    this.log.onSession(session);
  }

  onFrame(frame: Telemetry): void {
    if (!this.enabled || this.paused) return;
    this.metrics.markStart('raceHistoryProcessing');
    const tickedAt = this.recorder.lastTickAt();
    this.recorder.onFrame(frame);
    // The log reads the frames the recorder's slow tick does, after it:
    // what the recorder says of a stop on a tick is in hand when the log
    // sees the car leave on the same one.
    const ticked = this.recorder.lastTickAt();
    if (ticked !== tickedAt) {
      this.log.onTick(frame, this.recorder.pitState(), ticked);
    }
    this.metrics.markEnd('raceHistoryProcessing');
    this.publish(false);
    this.publishLog(false);
  }

  /**
   * Whether anything wants the record. Off, no frame is read; back on, the
   * race in hand is carried on from where the cars are now.
   */
  updateEnabled(enabled: boolean): void {
    if (enabled === this.enabled) return;
    this.enabled = enabled;
    if (enabled && !this.paused) this.rebaseline();
  }

  /** Stops everything while an iRacing replay file is loaded. */
  setPaused(paused: boolean): void {
    if (paused === this.paused) return;
    this.paused = paused;
    if (!paused && this.enabled) this.rebaseline();
  }

  /**
   * Whether the race is stored. Off for a recording, a replay source and
   * demo mode: everything is still recorded and published, nothing written.
   */
  setPersisting(persisting: boolean): void {
    this.persisting = persisting;
  }

  /** The laps of one car, in the order driven, and which are missing. */
  async getCarLaps(carIdx: number, raceId?: number): Promise<RaceCarLaps> {
    if (this.isCurrent(raceId)) {
      return {
        laps: this.recorder.carLaps(carIdx).map(copyOfLap),
        missingLaps: this.recorder.missingLaps(carIdx),
        revision: this.recorder.carRevision(carIdx),
      };
    }
    const laps = await this.persistence.carLaps(raceId as number, carIdx);
    // Of a race that is over, only the laps between the ones kept can be
    // said to be missing: how far the car went after the last is not known.
    return { laps, missingLaps: gapsIn(laps), revision: 0 };
  }

  /** The stints of one car, oldest first. */
  async getCarStints(carIdx: number, raceId?: number): Promise<RaceStint[]> {
    if (this.isCurrent(raceId)) {
      return this.recorder.carStints(carIdx).map(copyOfStint);
    }
    return this.persistence.carStints(raceId as number, carIdx);
  }

  /** Every driver change of the race, oldest first. */
  async getDriverChanges(raceId?: number): Promise<RaceDriverChange[]> {
    if (this.isCurrent(raceId)) {
      return this.recorder.driverChanges().map((change) => ({ ...change }));
    }
    return this.persistence.driverChanges(raceId as number);
  }

  /** The races kept in the file, most recent first. */
  listRaces(): Promise<StoredRace[]> {
    return this.persistence.listRaces();
  }

  /**
   * Events of a race's log numbered below `before`, oldest first; the most
   * recent with it left out.
   */
  async getEvents(raceId?: number, before?: number): Promise<RaceEvent[]> {
    if (this.isCurrent(raceId)) return this.log.page(before);
    return this.persistence.events(raceId as number, before);
  }

  /** What the race being recorded is; null between two. */
  currentRace(): RaceInfo | null {
    return this.race?.info ?? null;
  }

  /**
   * What is held of the race in hand, for a reader in this process that
   * works something out from it as it grows: the recorder's own lists, not
   * copies, and not to be changed.
   */
  readonly records = {
    /** Frames are being read: the records are being added to. */
    recording: (): boolean => this.enabled && !this.paused,
    /** Names the race; '' between two. */
    raceToken: (): string => this.race?.token ?? '',
    revision: (carIdx: number): number => this.recorder.carRevision(carIdx),
    laps: (carIdx: number): readonly RaceLap[] => this.recorder.carLaps(carIdx),
    stints: (carIdx: number): readonly RaceStint[] =>
      this.recorder.carStints(carIdx),
  };

  /**
   * Lets go of everything, storing what is still in hand first. Called when
   * the app quits. Nothing is said to have ended: the race may be picked up
   * again, and a stint left open is then carried on.
   */
  dispose(): void {
    this.recorder.handOnOpenLaps();
    if (this.held) this.release(this.held);
    void this.persistence.flush();
    this.disconnects.forEach((disconnect) => disconnect());
    this.disconnects.length = 0;
  }

  // --- What the recorder says -----------------------------------------

  onRaceStarted(start: RaceStart): void {
    this.race = start;
    this.held = null;
    this.log.onRaceStarted(start);
    const { info } = start;
    this.options.log?.(
      `[RaceHistory] Recording ${info.sessionType ?? 'a session'} at ` +
        `${info.trackName}: ${info.entries.length} cars` +
        (this.shouldStore() ? '' : ', not stored')
    );
    if (!this.shouldStore()) return;

    // Until the file has answered, nothing of this race is written.
    const held: Held = {
      laps: new Set(),
      stints: new Set(),
      changes: new Set(),
      events: new Set(),
      removedEvents: new Set(),
      replacedCars: new Set(),
      info: false,
    };
    this.held = held;
    this.persistence
      .findCandidates(info.simulator, info.trackId, info.sessionType)
      .then((candidates) => {
        if (this.held !== held) return null;
        const live = {
          info,
          lapsCompleted: start.lapsCompleted,
          sessionTime: start.sessionTime,
          now: this.options.now(),
        };
        for (const candidate of candidates) {
          const raceId = candidate.info.id;
          if (raceId === null) continue;
          const verdict = isSameRace(candidate, live);
          if (verdict.same) {
            return this.persistence
              .load(raceId)
              .then((records) => (records ? { candidate, records } : null));
          }
          this.options.log?.(
            `[RaceHistory] Race ${raceId} in the file is not this one: ${verdict.reason}`
          );
        }
        return null;
      })
      .then((found) => {
        if (this.held !== held) return;
        if (found) {
          const { candidate, records } = found;
          this.recorder.restore(records);
          // While the rows are still held: what was logged since the race
          // was picked up is numbered on from the file's before any of it
          // is written.
          this.log.restore(records.events ?? []);
          info.startedAt = candidate.info.startedAt;
          this.recorder.noteStored(candidate.info.id);
          this.options.log?.(
            `[RaceHistory] Carrying on race ${candidate.info.id} from the file: ` +
              `${records.laps.length} laps kept`
          );
        }
        this.release(held);
      })
      .catch((error: unknown) => {
        this.options.logError?.(
          '[RaceHistory] Could not look for the race in the file:',
          error
        );
        if (this.held === held) this.release(held);
      });
  }

  onLap(lap: RaceLap, settled: boolean): void {
    this.log.onLap(lap);
    // A lap just completed is stored once it has its time, or has waited
    // long enough for one.
    if (!settled || !this.race || !this.shouldStore()) return;
    if (this.held) this.held.laps.add(lap);
    else this.persistence.queueLap(this.race, lap);
  }

  onStint(stint: RaceStint): void {
    this.log.onStint(stint);
    if (!this.race || !this.shouldStore()) return;
    if (this.held) this.held.stints.add(stint);
    else this.persistence.queueStint(this.race, stint);
  }

  onDriverChange(change: RaceDriverChange): void {
    this.log.onDriverChange(change);
    if (!this.race || !this.shouldStore()) return;
    if (this.held) this.held.changes.add(change);
    else this.persistence.queueDriverChange(this.race, change);
  }

  onRaceInfoChanged(): void {
    if (!this.race || !this.shouldStore()) return;
    if (this.held) this.held.info = true;
    else this.persistence.queueInfo(this.race);
  }

  onCarReplaced(carIdx: number): void {
    // What the log held of the car that left goes with its laps: from the
    // file by the same request, and from what waits just below.
    this.log.onCarReplaced(carIdx);
    if (!this.race || !this.shouldStore()) return;
    const held = this.held;
    if (!held) {
      this.persistence.queueCarReplaced(this.race, carIdx);
      return;
    }
    // What was waiting for the slot was the car's that left.
    for (const list of [held.laps, held.stints, held.changes]) {
      for (const row of list) {
        if (row.carIdx === carIdx) (list as Set<unknown>).delete(row);
      }
    }
    for (const event of held.events) {
      if (event.carIdx === carIdx) held.events.delete(event);
    }
    held.replacedCars.add(carIdx);
  }

  onRaceEnded(): void {
    // The file never answered in time: the race goes in as a new one.
    if (this.held) this.release(this.held);
    this.race = null;
    this.log.onRaceEnded();
    void this.persistence.flush();
  }

  // --- What the log says ----------------------------------------------

  private onLogEvent(event: RaceEvent): void {
    if (!this.race || !this.shouldStore()) return;
    if (this.held) this.held.events.add(event);
    else this.persistence.queueEvent(this.race, event);
  }

  private onLogEventsRemoved(events: readonly RaceEvent[]): void {
    if (!this.race || !this.shouldStore()) return;
    const held = this.held;
    if (!held) {
      this.persistence.queueEventsRemoved(
        this.race,
        events.map((event) => event.seq)
      );
      return;
    }
    for (const event of events) {
      // One that was waiting was never written and has nothing to take out
      // of the file. Its number may be one the file uses for another event,
      // so the file must not be asked to.
      if (!held.events.delete(event)) held.removedEvents.add(event.seq);
    }
  }

  // --------------------------------------------------------------------

  /** The sim went away, or another connection began. */
  private letGo(): void {
    this.recorder.onDisconnect();
    this.publish(true);
    this.publishLog(true);
  }

  /** Frames resume after a gap: where every car was is not where it is. */
  private rebaseline(): void {
    this.recorder.rebaseline();
    this.log.rebaseline();
  }

  private shouldStore(): boolean {
    return (
      this.persisting && this.race?.info.sessionType === STORED_SESSION_TYPE
    );
  }

  /** Whether a request is about the race being recorded now. */
  private isCurrent(raceId: number | undefined): boolean {
    return (
      raceId === undefined ||
      (this.race !== null && this.race.info.id === raceId)
    );
  }

  /** Hands what was held to the file, now that its row is known. */
  private release(held: Held): void {
    if (this.held === held) this.held = null;
    const race = this.race;
    if (!race || !this.shouldStore()) return;
    for (const carIdx of held.replacedCars) {
      this.persistence.queueCarReplaced(race, carIdx);
    }
    for (const lap of held.laps) this.persistence.queueLap(race, lap);
    for (const stint of held.stints) this.persistence.queueStint(race, stint);
    for (const change of held.changes) {
      this.persistence.queueDriverChange(race, change);
    }
    if (held.removedEvents.size > 0) {
      this.persistence.queueEventsRemoved(race, [...held.removedEvents]);
    }
    for (const event of held.events) this.persistence.queueEvent(race, event);
    if (held.info) this.persistence.queueInfo(race);
  }

  private publish(force: boolean): void {
    // Put together only while a window reads it; the record is kept all
    // the same.
    if (this.subscribers === 0) return;
    const version = this.recorder.currentVersion();
    if (!force) {
      if (version === this.publishedVersion) return;
      if (this.options.now() - this.publishedAt < SUMMARY_INTERVAL_MS) return;
    }
    this.publishedVersion = version;
    this.publishedAt = this.options.now();
    this.metrics.markStart('raceHistoryPublication');
    this.bus.publish(CHANNEL, this.recorder.summary());
    this.metrics.markEnd('raceHistoryPublication');
  }

  private publishLog(force: boolean): void {
    // Put together only while a window reads it; the log is kept all the
    // same.
    if (this.logSubscribers === 0) return;
    const version = this.log.currentVersion();
    if (!force) {
      if (version === this.logPublishedVersion) return;
      if (this.options.now() - this.logPublishedAt < SUMMARY_INTERVAL_MS) {
        return;
      }
    }
    this.logPublishedVersion = version;
    this.logPublishedAt = this.options.now();
    this.metrics.markStart('raceHistoryPublication');
    this.bus.publish(LOG_CHANNEL, this.log.snapshot());
    this.metrics.markEnd('raceHistoryPublication');
  }
}
