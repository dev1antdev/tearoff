import type {
  CarSectorsSnapshot,
  Session,
  SessionLifecycleEvent,
  Telemetry,
} from '@irdashies/types';
import { CAR_SECTORS_PER_LAP } from '@irdashies/types';
import { isSectorTime } from '../../shared/sectorBests';
import type { TelemetryProcessor } from './TelemetryProcessor';

type Frame = Record<string, { value?: unknown[] } | undefined>;

const arrayOf = (
  frame: Telemetry,
  key: string
): readonly unknown[] | undefined => {
  const value = (frame as unknown as Frame)[key]?.value;
  return Array.isArray(value) ? value : undefined;
};

const scalarOf = (frame: Telemetry, key: string): number | null => {
  const value = (frame as unknown as Frame)[key]?.value?.[0];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
};

/** Lap times are read to the millisecond, and so are these. */
const TIME_SCALE = 1000;

/** A sector time to the millisecond, or null for anything that is not one. */
const timeOf = (value: unknown): number | null =>
  isSectorTime(value) ? Math.round(value * TIME_SCALE) / TIME_SCALE : null;

/** Writes one entry of a published array; true when it moved. */
const put = <T>(target: T[], index: number, value: T): boolean => {
  if (target[index] === value) return false;
  target[index] = value;
  return true;
};

/** Brings a published array to a length; true when it was another. */
const resize = <T>(target: T[], length: number, fill: T): boolean => {
  if (target.length === length) return false;
  const from = target.length;
  target.length = length;
  for (let index = from; index < length; index += 1) target[index] = fill;
  return true;
};

/**
 * Every car's sector times, with the bests they are coloured against: each
 * car's own, and the quickest of its class.
 *
 * Le Mans Ultimate only. It reads the three per-car keys the LMU mapping
 * writes (`src/app/lmu/sectorTimes.ts`) and adds nothing to them but the
 * bests. A frame without those keys is iRacing's, which times no sectors
 * for other cars: the channel then says so and stays empty.
 *
 * The bests are the quickest times seen, not the sim's. Its best figures
 * are a best first sector and a best time to the end of the second, which
 * need not be of one lap, so what the mapping makes of them for the second
 * and third sectors is no sector anybody drove. Only the first is a sector
 * best as it stands, and it is taken as well: it reaches back to laps
 * driven before anything read this channel.
 *
 * A sector time moves when a car ends a sector, and then stands until it
 * ends the same one a lap later, so reading twice a second misses none. On
 * the recorded race the three of a finished lap arrive on one frame.
 *
 * Everything is forgotten when the session changes or its clock runs
 * backwards, and a slot that changes hands loses the bests of the car that
 * left. Arrays are written in place: a tick on which no car ended a sector
 * allocates nothing and leaves the version where it was.
 */
export class CarSectorsProcessor implements TelemetryProcessor<
  CarSectorsSnapshot,
  'car-sectors.snapshot'
> {
  readonly channel = 'car-sectors.snapshot';
  readonly tickRateHz = 2;

  private lastTime: number | null = null;
  /** What the session names each slot's entry, to see a slot change hands. */
  private readonly entries = new Map<number, string>();
  /** The session's class id for each slot; undefined for a slot it omits. */
  private readonly classOf: (number | undefined)[] = [];
  /** The class bests have to be worked out again. */
  private classesStale = false;

  private readonly current: (number | null)[] = [];
  private readonly last: (number | null)[] = [];
  private readonly best: (number | null)[] = [];
  private readonly classIds: number[] = [];
  private readonly classBest: (number | null)[] = [];
  private readonly latest: CarSectorsSnapshot = {
    available: false,
    current: this.current,
    last: this.last,
    best: this.best,
    classIds: this.classIds,
    classBest: this.classBest,
    sessionNum: null,
    version: 0,
  };

  /**
   * Reads which class each slot is of, and who holds it. A slot whose entry
   * is another one than before was reused: the bests kept for it are the
   * car's that left.
   */
  init(session: Session): void {
    const seen = new Set<number>();
    let changed = false;
    this.classOf.length = 0;
    for (const driver of session?.DriverInfo?.Drivers ?? []) {
      const carIdx = driver?.CarIdx;
      if (typeof carIdx !== 'number' || carIdx < 0) continue;
      if (driver.CarIsPaceCar === 1 || driver.IsSpectator === 1) continue;
      seen.add(carIdx);
      if (typeof driver.CarClassID === 'number') {
        this.classOf[carIdx] = driver.CarClassID;
      }
      // The car and not the driver: a team's car keeps both through a
      // driver change, and its bests with them.
      const entry = `${driver.CarPath ?? ''}|${driver.CarNumber ?? ''}`;
      const previous = this.entries.get(carIdx);
      if (previous !== undefined && previous !== entry) {
        changed = this.forgetBests(carIdx) || changed;
      }
      this.entries.set(carIdx, entry);
    }
    for (const carIdx of this.entries.keys()) {
      if (!seen.has(carIdx)) this.entries.delete(carIdx);
    }
    // The class of a slot may be another one now, or a class may be new.
    this.classesStale = true;
    changed = this.updateClassBests() || changed;
    if (changed) this.latest.version += 1;
  }

  onFrame(frame: Telemetry): void {
    let changed = false;

    const sessionNum = scalarOf(frame, 'SessionNum');
    if (sessionNum !== null && sessionNum !== this.latest.sessionNum) {
      if (this.latest.sessionNum !== null) this.forgetTimes();
      this.latest.sessionNum = sessionNum;
      changed = true;
    }
    // A clock that ran backwards is a session started again.
    const now = scalarOf(frame, 'SessionTime');
    if (now !== null) {
      if (this.lastTime !== null && now < this.lastTime) {
        this.forgetTimes();
        changed = true;
      }
      this.lastTime = now;
    }

    const last = arrayOf(frame, 'LmuCarIdxLastSectorTimes');
    const current = arrayOf(frame, 'LmuCarIdxCurrentSectorTimes');
    const simBest = arrayOf(frame, 'LmuCarIdxBestSectorTimes');
    const available = last !== undefined || current !== undefined;
    if (available !== this.latest.available) {
      this.latest.available = available;
      this.classesStale = true;
      changed = true;
    }

    const length = last?.length ?? current?.length ?? 0;
    changed = resize(this.current, length, null) || changed;
    changed = resize(this.last, length, null) || changed;
    changed = resize(this.best, length, null) || changed;

    let bestMoved = false;
    for (let index = 0; index < length; index += 1) {
      const lastTime = timeOf(last?.[index]);
      const currentTime = timeOf(current?.[index]);
      changed = put(this.last, index, lastTime) || changed;
      changed = put(this.current, index, currentTime) || changed;
      bestMoved = this.offer(index, lastTime) || bestMoved;
      bestMoved = this.offer(index, currentTime) || bestMoved;
      // Of the sim's own bests only the first sector's is a sector time.
      if (index % CAR_SECTORS_PER_LAP === 0) {
        bestMoved = this.offer(index, timeOf(simBest?.[index])) || bestMoved;
      }
    }
    if (bestMoved) {
      this.classesStale = true;
      changed = true;
    }
    changed = this.updateClassBests() || changed;

    if (changed) this.latest.version += 1;
  }

  /**
   * Forgets everything on anything but entering a session, so a new session
   * never opens with the bests of the one before.
   */
  onLifecycle(event: SessionLifecycleEvent): void {
    if (event.type === 'enter') return;
    if (event.type === 'disconnect') {
      this.entries.clear();
      this.classOf.length = 0;
    }
    this.forgetTimes();
    this.latest.available = false;
    this.latest.sessionNum = null;
    this.lastTime = null;
    this.latest.version += 1;
  }

  snapshot(): CarSectorsSnapshot {
    return this.latest;
  }

  /** Takes a time as the best of its place if it is one; true if it was. */
  private offer(index: number, time: number | null): boolean {
    if (time === null) return false;
    const best = this.best[index];
    if (best !== null && best !== undefined && time >= best) return false;
    this.best[index] = time;
    return true;
  }

  /**
   * Works the class bests out again where a best or a class has moved; true
   * when a published figure did.
   */
  private updateClassBests(): boolean {
    if (!this.classesStale) return false;
    this.classesStale = false;
    let changed = false;

    // The classes, in the order their first car's slot comes in. None
    // while the sim gives no sector times: there is nothing to be best of.
    let classCount = 0;
    if (this.latest.available) {
      for (const classId of this.classOf) {
        if (classId === undefined) continue;
        let listed = false;
        for (let slot = 0; slot < classCount && !listed; slot += 1) {
          listed = this.classIds[slot] === classId;
        }
        if (listed) continue;
        changed = put(this.classIds, classCount, classId) || changed;
        classCount += 1;
      }
    }
    changed = resize(this.classIds, classCount, -1) || changed;
    changed =
      resize(this.classBest, classCount * CAR_SECTORS_PER_LAP, null) || changed;

    for (let slot = 0; slot < classCount; slot += 1) {
      const classId = this.classIds[slot];
      for (let sector = 0; sector < CAR_SECTORS_PER_LAP; sector += 1) {
        let quickest: number | null = null;
        for (let carIdx = 0; carIdx < this.classOf.length; carIdx += 1) {
          if (this.classOf[carIdx] !== classId) continue;
          const time = this.best[carIdx * CAR_SECTORS_PER_LAP + sector];
          if (time === null || time === undefined) continue;
          if (quickest === null || time < quickest) quickest = time;
        }
        changed =
          put(this.classBest, slot * CAR_SECTORS_PER_LAP + sector, quickest) ||
          changed;
      }
    }
    return changed;
  }

  /** Drops the bests of one slot; true when it had any. */
  private forgetBests(carIdx: number): boolean {
    let changed = false;
    const base = carIdx * CAR_SECTORS_PER_LAP;
    for (let sector = 0; sector < CAR_SECTORS_PER_LAP; sector += 1) {
      if (base + sector >= this.best.length) break;
      changed = put(this.best, base + sector, null) || changed;
    }
    if (changed) this.classesStale = true;
    return changed;
  }

  /** Forgets every time, keeping who the session says holds each slot. */
  private forgetTimes(): void {
    this.current.length = 0;
    this.last.length = 0;
    this.best.length = 0;
    this.classIds.length = 0;
    this.classBest.length = 0;
    this.classesStale = true;
  }
}
