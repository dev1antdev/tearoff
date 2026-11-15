import type { TelemetryVariable, TelemetryVarList } from '../app/irsdk/types';

export type Telemetry = {
  [K in keyof TelemetryVarList]: Pick<TelemetryVarList[K], 'value'>;
} & {
  LmuCurrentSectorTimes?: TelemetryVar<(number | null)[]>;
  LmuLastSectorTimes?: TelemetryVar<(number | null)[]>;
  LmuBestSectorTimes?: TelemetryVar<(number | null)[]>;
  LmuSectorIdx?: TelemetryVar<number[]>;
  /**
   * mGamePhase as the sim states it: 0 before the session, 1 reconnaissance
   * laps, 2 grid walk-through, 3 formation lap, 4 starting-light countdown,
   * 5 green flag, 6 full-course yellow, 7 session stopped, 8 session over,
   * 9 a heartbeat while paused. SessionState folds these onto iRacing's
   * states; the flag processor reads the phase itself, and its presence is
   * what tells it the frame is LMU's.
   */
  LmuGamePhase?: TelemetryVar<number[]>;
  /**
   * mYellowFlagState, the sub-phase of a full-course yellow: 0 none, 1
   * pending, 2 pits closed, 3 pit lead lap, 4 pits open, 5 last lap, 6
   * resume. Whether LMU uses the sub-phases at all is not confirmed.
   */
  LmuYellowFlagState?: TelemetryVar<number[]>;
  /**
   * Whether each sector is under a local yellow, in driving order: S1, S2,
   * S3. The sim's own order is not that, and a clear sector does not read 0
   * there; see LMU_SECTOR_FLAG_ORDER in the mapper.
   */
  LmuSectorYellow?: TelemetryVar<boolean[]>;
  /**
   * The step of the start-light sequence and the count of red lights in it.
   * Absent from an addon built before they were exported.
   */
  LmuStartLight?: TelemetryVar<number[]>;
  LmuNumRedLights?: TelemetryVar<number[]>;
  /**
   * mLapInvalidated — the sim has voided the lap in progress. A bare flag:
   * LMU gives no reason with it, so nothing downstream should infer one.
   * Stands in for PlayerCarMyIncidentCount, which LMU does not publish.
   */
  LmuLapInvalidated?: TelemetryVar<boolean[]>;
  /**
   * Whether each car's last lap did not count: the sim gave it no time
   * (mLastLapTime not above 0) and CarIdxLastLapTime carries the lap timed
   * from its two starts instead. False before a car's first lap. Wider than
   * "voided": an out-lap in practice is untimed too.
   */
  LmuCarIdxLastLapInvalid?: TelemetryVar<boolean[]>;
  LmuCarIdxRelativeAvailable?: TelemetryVar<boolean[]>;
  LmuCarIdxRelativeLateral?: TelemetryVar<number[]>;
  LmuCarIdxRelativeLongitudinal?: TelemetryVar<number[]>;
  LmuCarIdxRelativeHeading?: TelemetryVar<number[]>;
  /**
   * Compound index per wheel, for every car: four entries per slot at
   * `carIdx * 4 + wheel`, in the sim's wheel order (FL, FR, RL, RR).
   *
   * Flat rather than nested because it rides the 60 Hz telemetry path, where
   * one array costs one allocation and an array of arrays costs one per car.
   * -1 means the car reported no telemetry that frame; 0 is a real compound.
   *
   * CarIdxTireCompound carries the front-left of each car, which is the one
   * value iRacing's shape has room for. This is here for the rest of it:
   * a car can be on four different compounds, and the standings say so.
   */
  LmuCarIdxWheelCompounds?: TelemetryVar<number[]>;
  /**
   * LMU's track-limits penalty points per car, in points rather than the
   * sim's own infringement steps. -1 where a car has no reading, or the
   * session has not stated the scale -- a clean car reads 0, and the two must
   * not look alike.
   */
  LmuCarIdxTrackLimitsPoints?: TelemetryVar<number[]>;
  /**
   * What each car has left to run on, 0..1, or -1 where neither budget reads.
   *
   * Virtual energy for a car that runs on it, fuel for one that does not --
   * the two are not comparable quantities, but only one of them limits any
   * given car, so one column can carry both. -1 is "no reading", which an
   * empty tank is not.
   */
  /**
   * Outstanding penalties per car. A count; scoring has no field for which
   * penalty it is.
   */
  LmuCarIdxPenalties?: TelemetryVar<number[]>;
  /**
   * Which penalty each car is serving, as an LMU_PENALTY_CODE.
   *
   * From LMU's UI websocket rather than shared memory or REST -- the only
   * source that names a kind, and the only one that names it for a car other
   * than the player. Empty when that socket is not answering, which is what
   * sends the player's badge back to the estimate-derived fallback and leaves
   * every other car without one. See app/lmu/liveStandings/.
   */
  LmuCarIdxPenaltyKind?: TelemetryVar<number[]>;
  /**
   * Each car's `mFinishStatus`: 0 none, 1 finished, 2 DNF, 3 DQ, as
   * LMU_FINISH_STATUS. From scoring, so it is there for every car.
   */
  LmuCarIdxFinishStatus?: TelemetryVar<number[]>;
  /**
   * Seconds a time penalty will add to each car's race time. 0 for a clean
   * car and for the two kinds that are served on track rather than paid in
   * time. From the same websocket as the kind above.
   */
  LmuCarIdxPenaltySeconds?: TelemetryVar<number[]>;
  /**
   * Seconds the player's next stop spends serving penalties, from the pit-stop
   * estimate. The only thing that tells a drive-through from a stop-go, since
   * the first costs no stationary time. See types/lmu/penalty.ts.
   */
  LmuPenaltySeconds?: TelemetryVar<number[]>;
  LmuCarIdxEnergyRemaining?: TelemetryVar<number[]>;
  /**
   * Which budget LmuCarIdxEnergyRemaining holds for each car: true for virtual
   * energy, false for fuel (or for no reading).
   *
   * A car is remembered as an energy car once it has read above 0, so one that
   * has run its energy out reads 0 here rather than its fuel.
   */
  LmuCarIdxEnergyIsVirtual?: TelemetryVar<boolean[]>;
  /**
   * True when the sim has stopped writing shared memory, so this frame is the
   * last one it wrote rather than a current reading.
   *
   * Its own channel rather than being folded into the state fields it affects.
   * Gating those one at a time was wrong twice over: IsOnTrack went false but
   * the pit flags did not, and isDriving ORs the three together -- so a player
   * whose session ended in the pits stayed "driving". Falsifying IsInGarage
   * made it worse, because that is the term isDriving negates.
   */
  LmuDataStale?: TelemetryVar<boolean[]>;
  /**
   * True while LMU's GetGameState answers `{"status":"unavailable"}` or 404:
   * the sim is running and in no session, or in no game at all. Widgets read
   * it as Offline Testing for their session visibility, so only those allowed
   * there stay on screen. False whenever the game state is anything else or
   * unknown.
   */
  LmuNotInSession?: TelemetryVar<boolean[]>;
  /**
   * True while LMU's GetGameState says the player is not in the car: at the
   * monitor, or out of any session or game. The driving gate reads it before
   * the pit terms, which stay true for a car left in the pit lane or stall
   * while the player sits at the monitor. False whenever the game state is
   * unknown, so shared memory decides then.
   */
  LmuOutOfCar?: TelemetryVar<boolean[]>;
  /**
   * True while the user is in a session, not at the wheel, and the car the
   * overlays are about (CamCarIdx) is out of its garage on a live frame: a
   * team-mate's stint, or any car the camera is on. IsOnTrack is false for
   * as long as this is true; nothing watched ever counts as driving. False
   * whenever the game state is unknown.
   */
  LmuWatching?: TelemetryVar<boolean[]>;
  /**
   * True while LMU's GetGameState says PAUSED: the player is in the car with
   * a menu open. The widgets keep their state through it, which is why the
   * in-car channels above still read as driving; this is for the one thing
   * that does want to know, taking the overlay off the screen while the menu
   * is up. False whenever the game state is anything else or unknown.
   */
  LmuGamePaused?: TelemetryVar<boolean[]>;
  /**
   * The points a drive-through is served at, 0 when the session has not said.
   *
   * A session constant, carried beside the per-car figure because neither is
   * readable without the other: 0.25 means nothing until it is 0.25 of three.
   */
  LmuTrackLimitsPointsMax?: TelemetryVar<number[]>;
  /** Fore(+)/aft(-) metres of the nearest car alongside; null when clear. */
  LmuBlindSpotLeftLongitudinal?: TelemetryVar<(number | null)[]>;
  LmuBlindSpotRightLongitudinal?: TelemetryVar<(number | null)[]>;
  /**
   * From LMU's local REST API rather than shared memory, so present only when
   * that API answers. Seconds.
   */
  LmuPitStopTime?: TelemetryVar<number[]>;
  LmuRepairTime?: TelemetryVar<number[]>;
  /**
   * What the next stop is made of, REST: eight values in seconds, in the
   * order fuel, virtual energy, tyres, damage, driver swap, brakes, brake
   * ducts, penalties. Not a sum: on a recording the stop time equals the fuel
   * part, with the energy going in alongside it.
   */
  LmuPitStopParts?: TelemetryVar<number[]>;
  /**
   * What the next pit stop will add. Litres, or a virtual-energy percentage --
   * the companion flag says which, and nothing downstream should guess.
   */
  LmuRefuelTarget?: TelemetryVar<number[]>;
  LmuRefuelTargetIsVirtualEnergy?: TelemetryVar<boolean[]>;
  /**
   * Litres of fuel per percent of virtual energy, as the pit menu is set to
   * add them. REST.
   */
  LmuRefuelRatio?: TelemetryVar<number[]>;
  /**
   * What the pit menu is set to repair, in the sim's own words ("Do Not
   * Repair", "Repair Body"). REST. Absent while there is nothing to repair.
   * The one frame key that holds text.
   */
  LmuRepairChoice?: { value: string[] };
  /**
   * Brake disc thickness per wheel, millimetres, REST. LF, RF, LR, RR. The
   * thickness of a new disc is LmuRest.brakeDiscNewMm on the session.
   */
  LmuBrakeThickness?: TelemetryVar<number[]>;
  /**
   * Moves each time a REST answer carried a brake thickness, the same
   * thickness included, and stands still when none arrives: what tells a disc
   * that has stopped wearing from an answer that has stopped coming. Only ever
   * rises; compare it with the frame before rather than read it as a count.
   */
  LmuRestWearablesSeq?: TelemetryVar<number[]>;
  /**
   * Damage, REST: 0 is none. The suspension's four values are LF, RF, LR, RR.
   */
  LmuSuspensionDamage?: TelemetryVar<number[]>;
  LmuAeroDamage?: TelemetryVar<number[]>;
  /**
   * The steering wheel's range as the garage setup states it, degrees. REST.
   * SteeringWheelAngle and SteeringWheelAngleMax are scaled by it when the
   * sim states no range for the driver's own wheel.
   */
  LmuSteerLockDeg?: TelemetryVar<number[]>;
  /**
   * The mean angle of the two front road wheels, degrees, signed like
   * SteeringWheelAngle: positive to the left. Averaging the pair cancels the
   * static toe. iRacing publishes no live toe.
   */
  LmuFrontWheelAngle?: TelemetryVar<number[]>;
  /**
   * From shared memory, not REST. Virtual energy remaining; the budget it
   * counts down from is LmuRest.maxVirtualEnergy on the session.
   */
  LmuVirtualEnergy?: TelemetryVar<number[]>;
  LmuStateOfCharge?: TelemetryVar<number[]>;
  LmuRegen?: TelemetryVar<number[]>;
  /**
   * Whether traction control is cutting power on this frame. iRacing has no
   * such flag; the brake's counterpart is BrakeABSactive, under both sims.
   */
  LmuTcActive?: TelemetryVar<boolean[]>;
  /**
   * The player's dials that have no iRacing channel of their own, as the
   * position the sim states: traction control's slip target and power cut,
   * brake migration, and the motor or engine map. The traction control level
   * is dcTractionControl. Each is absent on a car that does not have the dial,
   * which is one whose scale tops out at 0.
   */
  LmuTcSlip?: TelemetryVar<number[]>;
  LmuTcCut?: TelemetryVar<number[]>;
  LmuBrakeMigration?: TelemetryVar<number[]>;
  LmuMotorMap?: TelemetryVar<number[]>;
  /**
   * The top of each dial's scale, in the order of LMU_DIAL_KEYS: ABS, TC, TC
   * slip, TC cut, brake migration, map, front and rear anti-roll bar. 0 for a
   * dial the car does not have. The same cell from frame to frame until a
   * maximum changes, which is once per car.
   */
  LmuDialMax?: TelemetryVar<number[]>;
  /**
   * The wiper state: 0 off, 1 auto, 2 slow, 3 fast by TinyPedal's reading,
   * which no recording confirms.
   */
  LmuWiper?: TelemetryVar<number[]>;
  /**
   * The player's tyres and brakes, Celsius. Wheels are LF, RF, LR, RR.
   *
   * The two zone arrays hold `wheel * 3 + zone` with the zones ordered outer
   * shoulder, middle, inner shoulder -- already swapped for the side of the
   * car, which the sim's own left/centre/right is not. Present only while the
   * player has a car; see app/lmu/tyreState.ts for the units.
   */
  LmuTyreSurfaceTemp?: TelemetryVar<number[]>;
  LmuTyreInnerLayerTemp?: TelemetryVar<number[]>;
  LmuTyreCarcassTemp?: TelemetryVar<number[]>;
  /** The compound's working temperature, as the sim states it. */
  LmuTyreOptimalTemp?: TelemetryVar<number[]>;
  LmuBrakeTemp?: TelemetryVar<number[]>;
};
/**
 * What SessionLapsRemain and SessionLapsTotal carry when the session has no
 * lap limit -- a timed practice, qualifying or endurance race.
 *
 * iRacing's own value: its captured frames read 32767 for both in a timed
 * session. Shared here because it is a contract between whoever produces a
 * telemetry frame and whoever reads it, and a producer that invents its own
 * "no limit" number is read as a real lap count.
 */
export const TIMED_SESSION_LAPS = 32767;

export type TelemetryVar<T extends (number | boolean | null)[]> = Pick<
  TelemetryVariable<T>,
  'value'
>;
