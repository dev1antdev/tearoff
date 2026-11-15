import type { LmuRestSession } from '@irdashies/types';
import type { LmuGameState } from '../gameState';

/**
 * What the REST poller has learned, in the shape the mappers want it.
 *
 * Owned by the bridge and read synchronously by the telemetry loop, so the loop
 * never awaits an HTTP request. Same create/reset lifecycle as
 * `createLmuLapDistanceState` in ../lapDistance.ts, which is the house pattern
 * for bridge-scoped mutable state.
 *
 * `cells` holds **pre-built telemetry cells** rather than raw numbers so a
 * mapper call is a reference assignment per channel and a frame allocates
 * nothing.
 *
 * The invariant that makes that safe: the poller **replaces** a cell object
 * when its value changes and never mutates `cell.value` in place. A frame
 * already handed to a processor therefore stays internally consistent. The
 * `readonly` below is there to make an in-place mutation a type error, because
 * that is the one edit that would corrupt a published frame.
 */
export interface LmuRestCell<T> {
  readonly value: readonly T[];
}

export interface LmuRestCells {
  pitStopTime?: LmuRestCell<number>;
  repairTime?: LmuRestCell<number>;
  refuelTarget?: LmuRestCell<number>;
  refuelTargetIsVirtualEnergy?: LmuRestCell<boolean>;
  /**
   * Seconds the next stop spends serving penalties. See types/lmu/penalty.ts.
   */
  penaltySeconds?: LmuRestCell<number>;
  /**
   * The slot the spectator camera is on, or -1 for none.
   *
   * Becomes CamCarIdx, which is what every processor derives its focus car
   * from. The only source: shared memory has no camera field. See the
   * `watch-focus` task.
   */
  focusCarIdx?: LmuRestCell<number>;
  brakeWear?: LmuRestCell<number>;
  suspensionDamage?: LmuRestCell<number>;
  aeroDamage?: LmuRestCell<number>;
}

export interface LmuRestData {
  /**
   * Bumped only when something destined for the Session snapshot changes.
   *
   * The bridge watches this to force a session republish, because
   * `lmuSessionSignature` only sees shared memory and would otherwise never
   * notice a REST-sourced field arriving. Deliberately *not* bumped by the
   * telemetry cells: those reach widgets on the ungated telemetry path, and
   * bumping here would force a full session rebuild and a whole-object IPC
   * broadcast every time a wear figure twitched.
   */
  revision: number;
  cells: LmuRestCells;
  session: LmuRestSession;
  /**
   * Where the player is, from `/rest/sessions/GetGameState`. Read by the
   * bridge on every frame to decide in-car and in-session; undefined until the
   * endpoint has answered and whenever it stops, which is when the bridge falls
   * back to reading those from shared memory. See ../gameState.ts.
   */
  gameState?: LmuGameState;
}

export const createLmuRestData = (): LmuRestData => ({
  revision: 0,
  cells: {},
  session: {},
});

/**
 * Forgets everything, and bumps `revision` so the cleared state publishes.
 *
 * Called when LMU goes away. Publishing the clear matters as much as publishing
 * the data: a stale pit-stop estimate left on screen after the session ended
 * reads as current.
 */
export const resetLmuRestData = (data: LmuRestData): void => {
  data.cells = {};
  data.session = {};
  data.gameState = undefined;
  data.revision += 1;
};

/**
 * Forgets what was learned about one session, for when another begins.
 *
 * `resetLmuRestData` runs when LMU goes away, and LMU stays open across
 * sessions for hours. The refuel target, the pit-stop estimate, the wear and
 * damage figures and the tank and energy capacities all describe one car in
 * one session, and nothing else ever takes them down: a parser that finds
 * nothing in the next session's answer leaves the value standing, and so does
 * a path that is not answering at all. A race was shown the values of a
 * practice run hours earlier in a different car.
 *
 * Everything goes except what is not the session's to forget:
 *
 * - `gameState`, which says where the player is now and is read every frame;
 * - the spectator camera's slot, a live reading too, which its own task drops
 *   when the path stops answering;
 * - the nationalities. They are keyed by driver name, which does not go stale
 *   with the session, and they are asked for only when a driver arrives on the
 *   grid (see ../nationalityWatch.ts). A grid carried from practice into
 *   qualifying has no arrivals, so flags dropped here would not come back.
 *
 * `cells` and `session` are replaced rather than emptied, as everywhere else,
 * so a frame already handed out keeps what it was built from. `revision` moves
 * only if a session value was dropped: it costs a full snapshot rebuild, and
 * the first session after launch has nothing to forget.
 */
export const forgetLmuRestSession = (data: LmuRestData): void => {
  const { focusCarIdx } = data.cells;
  data.cells = focusCarIdx ? { focusCarIdx } : {};

  const { nationalities, ...ofTheSession } = data.session;
  data.session = nationalities ? { nationalities } : {};
  if (Object.keys(ofTheSession).length > 0) data.revision += 1;
};
