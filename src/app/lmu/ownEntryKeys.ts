import { lmuHasLapLimit } from './mapSession';
import { lapTimeOrAbsent } from './sentinels';
import { lmuSectorIdx, mapLmuSectorTimes } from './sectorTimes';
import { lmuCarCompound } from './tireCompound';

/**
 * The keys that describe one car, for the user's own entry while somebody
 * else drives it.
 *
 * iRacing keeps its single-car keys on the team car through a team-mate's
 * stint. LMU names no player vehicle then, and the mapper, which fills those
 * keys from the player's slot and the player's telemetry block, publishes
 * them empty: lap 0, no lap times, no place on the track. The car goes on
 * lapping in its slot all the same, and scoring goes on writing it into the
 * per-car arrays, so the keys that have a source there are filled from the
 * own entry's slot here. `PlayerCarIdx` names that slot, as the session's
 * `DriverInfo.DriverCarIdx` does, and every one of these keys describes that
 * car and no other: never the car the camera is on.
 *
 * Three kinds of key are left as the mapper wrote them:
 *
 * - `IsOnTrack`, `IsInGarage`, `IsGarageVisible`, `LmuGamePaused` and the
 *   blind-spot channels, which are about the user being in a car. `IsOnTrack`
 *   false is what keeps a lap driven by a team-mate from being stored as the
 *   user's own, and nothing here sets it.
 * - Everything the sim writes only into the player's telemetry block: the
 *   pedals, gear, revs, fuel, tyres, brakes and dials. Nothing exports those
 *   for another car yet.
 * - The lap delta to the best lap and the lap's void flag, from the same
 *   block.
 *
 * Three of the keys come from the copy of the car's telemetry block that the
 * per-car arrays carry: the speed, the virtual energy and the clock the
 * current lap is timed by. Whether LMU sends a block for the team car while
 * a team-mate drives it online is not known. Where it has none, the speed
 * and the energy are left out rather than published as 0, and the current
 * lap is timed by scoring's clock.
 */

type Raw = import('./native').LmuRawTelemetry;
type Frame = Record<string, { value: unknown[] }>;

const num = (value: number) => ({ value: [value] });
const bool = (value: boolean) => ({ value: [value] });

const numberAt = (
  frame: Frame,
  key: string,
  carIdx: number
): number | undefined => {
  const value = frame[key]?.value[carIdx];
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
};

/**
 * The slot the single-car keys describe when the sim names no player
 * vehicle: the own entry the bridge resolved, while that slot holds a car.
 * -1 when the player has a vehicle, which the mapper's own keys describe,
 * and when there is no own entry.
 *
 * The slot is checked against this frame because it was resolved on a
 * session snapshot, up to half a second ago, and an entry can leave the grid
 * in between.
 */
export const lmuWatchedOwnEntryIdx = (
  raw: Raw,
  playerIdx: number,
  ownEntrySlot: number
): number => {
  if (playerIdx >= 0 || !Number.isInteger(ownEntrySlot) || ownEntrySlot < 0) {
    return -1;
  }
  return (raw.vehLapDistPct?.[ownEntrySlot] ?? -1) >= 0 ? ownEntrySlot : -1;
};

/**
 * Writes the own entry's keys onto a frame the mapper has finished, when the
 * sim names no player vehicle and the own entry is known. Otherwise the
 * frame is left exactly as it was.
 *
 * Called last, so that it reads the per-car channels as they go out -- the
 * refined lap fraction, the lap counts that go with it, the timed last laps
 * -- and so that a key the mapper comes to build some other way is still
 * described by the own entry afterwards.
 */
export function writeLmuOwnEntryKeys(
  frame: Frame,
  raw: Raw,
  playerIdx: number,
  ownEntrySlot: number
): void {
  const own = lmuWatchedOwnEntryIdx(raw, playerIdx, ownEntrySlot);
  if (own < 0) return;

  frame.PlayerCarIdx = num(own);
  frame.PlayerCarPosition = num(raw.vehPlaces[own] ?? 0);
  frame.PlayerCarClass = num(raw.vehClass[own] ?? 0);
  frame.PlayerTireCompound = num(lmuCarCompound(raw.vehWheelCompounds, own));
  const surface = numberAt(frame, 'CarIdxTrackSurface', own);
  if (surface !== undefined) frame.PlayerTrackSurface = num(surface);
  frame.PlayerCarInPitStall = bool(
    Boolean(raw.vehInGarageStall[own]) || raw.vehPitState[own] === 3
  );
  frame.OnPitRoad = bool(raw.vehInPits[own] === 1);
  // The pit flags above now describe a car the user is not in, and the tests
  // for "driving" OR them with IsOnTrack. With no vehicle the user is out of
  // the car whatever the game state says: it is polled once a second and
  // goes on saying "driving" for about that long after a driver change, and
  // when LMU's REST API is not answering it says nothing at all.
  frame.LmuOutOfCar = bool(true);

  // The lap and the place on it, as published for the slot: the fraction the
  // per-car integrator lifted to the poll rate, and the lap counts that moved
  // in the same frame as it wrapped.
  const completed = numberAt(frame, 'CarIdxLapCompleted', own);
  const lap = numberAt(frame, 'CarIdxLap', own);
  const lapDistPct = numberAt(frame, 'CarIdxLapDistPct', own);
  if (completed !== undefined) frame.LapCompleted = num(completed);
  if (lap !== undefined) frame.Lap = num(lap);
  if (lapDistPct !== undefined) frame.LapDistPct = num(lapDistPct);
  if (lmuHasLapLimit(raw.session, raw.maxLaps)) {
    frame.SessionLapsRemain = num(
      Math.max(0, raw.maxLaps - (raw.vehTotalLaps[own] ?? 0))
    );
  }

  frame.LapBestLapTime = num(lapTimeOrAbsent(raw.vehBestLapTime[own]));
  frame.LapLastLapTime = num(
    lapTimeOrAbsent(numberAt(frame, 'CarIdxLastLapTime', own))
  );
  frame.LmuCurrentSectorTimes = {
    value: mapLmuSectorTimes(
      raw.vehCurSector1?.[own],
      raw.vehCurSector2?.[own]
    ),
  };
  frame.LmuLastSectorTimes = {
    value: mapLmuSectorTimes(
      raw.vehLastSector1?.[own],
      raw.vehLastSector2?.[own],
      raw.vehLastLapTime?.[own]
    ),
  };
  frame.LmuBestSectorTimes = {
    value: mapLmuSectorTimes(
      raw.vehBestSector1?.[own],
      raw.vehBestSector2?.[own],
      raw.vehBestLapTime?.[own]
    ),
  };
  frame.LmuSectorIdx = num(lmuSectorIdx(raw.vehSector?.[own]));

  // From the car's telemetry block, where the sim sent one for it.
  const hasBlock = raw.vehTelemetryAvailable?.[own] === 1;
  const speed = hasBlock ? raw.vehSpeed?.[own] : undefined;
  if (typeof speed === 'number' && Number.isFinite(speed)) {
    frame.Speed = num(speed);
  } else {
    delete frame.Speed;
  }
  // -1 is the addon's own word for a car with no block this frame.
  const energy = hasBlock ? raw.vehVirtualEnergy?.[own] : undefined;
  if (typeof energy === 'number' && Number.isFinite(energy) && energy >= 0) {
    frame.LmuVirtualEnergy = num(energy);
  }
  // The block's clock where there is one, as for the player; scoring's
  // otherwise, which is the same clock five times a second.
  const blockClock = hasBlock ? raw.vehElapsedTime?.[own] : undefined;
  const clock =
    typeof blockClock === 'number' && Number.isFinite(blockClock)
      ? blockClock
      : raw.currentET;
  const lapStartET = raw.vehLapStartET?.[own];
  frame.LapCurrentLapTime = num(
    typeof lapStartET === 'number' && Number.isFinite(lapStartET)
      ? Math.max(0, clock - lapStartET)
      : 0
  );
}
