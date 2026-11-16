import type { Session, Telemetry } from '@irdashies/types';
import type { ChannelBus } from '../bridge/channelBus';
import type { SessionLifecycle } from '../sessionLifecycle';
import { ClassTyresTracker, type ClassTyresSources } from './ClassTyresTracker';
import type { PerformanceSections } from './lapHistoryRuntime';

/**
 * Publishes how long each car of our class has run on its tyres and what
 * is left of them, on `class-tyres.snapshot`.
 *
 * Hosted beside the race history and not under the ProcessorHost, for one
 * reason: a set of tyres seen to go on while no window was looking is
 * still a set of tyres. The figures themselves are worked out from the
 * race history's records, so nothing here needs storing; this only keeps
 * watching the wear for as long as the race is recorded, and hands the
 * tracker's figures to whoever reads them.
 *
 * It follows the race history: while that records, the cars are looked at
 * once a second; while it does not, no frame is read. The reasons for not
 * recording are the race history's own (nothing wants the record, or a
 * replay file is loaded) and are not decided a second time here.
 */

const CHANNEL = 'class-tyres.snapshot';
/** The figures go out at most this often, and only when one has moved. */
const PUBLISH_INTERVAL_MS = 1000;

export interface ClassTyresRuntimeSources extends ClassTyresSources {
  /** The race history is reading frames: there are records to work from. */
  recording: () => boolean;
}

export interface ClassTyresRuntimeOptions {
  /** Wall-clock time in Unix milliseconds. */
  now: () => number;
}

export class ClassTyresRuntime {
  private readonly tracker: ClassTyresTracker;
  private readonly disconnects: (() => void)[];

  private watching = false;
  private subscribers = 0;
  private publishedVersion = -1;
  private publishedAt = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly bus: ChannelBus,
    lifecycle: Pick<SessionLifecycle, 'onEnter' | 'onDisconnect'>,
    private readonly metrics: PerformanceSections,
    private readonly sources: ClassTyresRuntimeSources,
    private readonly options: ClassTyresRuntimeOptions
  ) {
    this.tracker = new ClassTyresTracker(sources);
    this.disconnects = [
      // A connection that was never seen to end still ended.
      lifecycle.onEnter(() => this.letGo()),
      lifecycle.onDisconnect(() => this.letGo()),
      bus.onSubscriberCountChanged((channel, count) => {
        if (channel !== CHANNEL) return;
        const gained = count > 0 && this.subscribers === 0;
        this.subscribers = count;
        // The bus drops what it holds when the last window leaves: a
        // window that arrives is sent what there is.
        if (gained) this.publish(true);
      }),
    ];
  }

  onSession(session: Session): void {
    this.tracker.onSession(session);
  }

  onFrame(frame: Telemetry): void {
    if (!this.sources.recording()) {
      if (this.watching) {
        // What goes on a car from here on is not seen.
        this.watching = false;
        this.tracker.loseSight();
      }
      return;
    }
    this.watching = true;
    this.metrics.markStart('classTyresProcessing');
    this.tracker.onFrame(frame);
    this.metrics.markEnd('classTyresProcessing');
    this.publish(false);
  }

  /** Lets go of everything. Called when the app quits. */
  dispose(): void {
    this.disconnects.forEach((disconnect) => disconnect());
    this.disconnects.length = 0;
  }

  /** The sim went away, or another connection began. */
  private letGo(): void {
    this.watching = false;
    this.tracker.reset();
    this.publish(true);
  }

  private publish(force: boolean): void {
    if (this.subscribers === 0) return;
    const snapshot = this.tracker.snapshot();
    if (!force) {
      if (snapshot.version === this.publishedVersion) return;
      if (this.options.now() - this.publishedAt < PUBLISH_INTERVAL_MS) return;
    }
    this.publishedVersion = snapshot.version;
    this.publishedAt = this.options.now();
    this.bus.publish(CHANNEL, snapshot);
  }
}
