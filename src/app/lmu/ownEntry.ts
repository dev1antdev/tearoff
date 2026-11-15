import { lmuPlayerSlot } from './aiControl';

/**
 * The car the user is entered in, whoever is driving it, and the car the
 * overlays are about.
 *
 * LMU names the player's vehicle only while the player is in it. In a team
 * race the car goes on lapping with a team-mate at the wheel, and for those
 * two hours shared memory says the player has no vehicle at all: the slot
 * index is -1 and every widget that follows "the player's car" has nothing
 * to follow. iRacing states the entry outright (`PlayerCarIdx` stays on the
 * team car); here it has to be remembered.
 *
 * The identity is the entry name, `mVehicleName`: "Team X #77:LMGT3". It
 * belongs to the car, carries its number, and does not change when the
 * driver does, which the driver name in the same slot does. The slot is only
 * where the entry was last seen: slots can be handed out again.
 *
 * Three sources, in the order they are trusted:
 *
 * 1. the telemetry block's player slot, which is the sim's own word while
 *    the player has a vehicle;
 * 2. the entry remembered from then, found again by name;
 * 3. scoring's `mIsPlayer`, when nothing is remembered or the remembered
 *    entry is not on the grid. Not confirmed on a recording: it may stay on
 *    the team car through a team-mate's stint, or it may not be set at all.
 *    It is never remembered, so a wrong reading cannot outlive the snapshot
 *    it came from.
 *
 * Pure, with its state owned by the caller, like the other bridge-scoped
 * state in this folder. The caller forgets it when LMU goes away and when
 * the track changes; a session change keeps it, because practice, qualifying
 * and the race of one event are the same entry, and it is checked against
 * the grid by name on every observation anyway.
 */

/** How the own entry was found. */
export type LmuOwnEntrySource =
  /** The telemetry block names the player's vehicle. */
  | 'player'
  /** No player vehicle; the remembered entry is where it was last seen. */
  | 'remembered'
  /** No player vehicle; the remembered entry was found in another slot. */
  | 'moved'
  /** Nothing to go on but scoring's player flag. */
  | 'scoring'
  /** No entry can be told to be the user's. */
  | 'none';

export interface LmuOwnEntry {
  /** The slot the entry holds now, which is this app's CarIdx; -1 for none. */
  readonly slot: number;
  /** The entry's name, empty for none. */
  readonly name: string;
  readonly source: LmuOwnEntrySource;
}

export interface LmuOwnEntryState {
  /** The slot the entry was last seen in, -1 before it has been seen. */
  rememberedSlot: number;
  /** The entry's name while the player had it, empty before then. */
  rememberedName: string;
  /** What the last observation resolved to. */
  current: LmuOwnEntry;
}

/** The parts of a session snapshot the own entry is read from. */
export interface LmuOwnEntryGrid {
  readonly playerHasVehicle?: boolean;
  readonly playerVehicleIdx?: number;
  readonly drivers: readonly {
    readonly id: number;
    readonly name?: string;
    readonly vehicleName: string;
    readonly isPlayer?: boolean;
    readonly control?: number;
  }[];
}

const NO_ENTRY: LmuOwnEntry = { slot: -1, name: '', source: 'none' };

export const createLmuOwnEntryState = (): LmuOwnEntryState => ({
  rememberedSlot: -1,
  rememberedName: '',
  current: NO_ENTRY,
});

/** Forgets the entry: LMU has gone away, or this is another event. */
export const resetLmuOwnEntryState = (state: LmuOwnEntryState): void => {
  state.rememberedSlot = -1;
  state.rememberedName = '';
  state.current = NO_ENTRY;
};

/** The slot of the own entry as last resolved, -1 for none. */
export const lmuOwnEntrySlot = (state: LmuOwnEntryState): number =>
  state.current.slot;

const sameEntry = (a: LmuOwnEntry, b: LmuOwnEntry): boolean =>
  a.slot === b.slot && a.name === b.name && a.source === b.source;

const resolveLmuOwnEntry = (
  state: LmuOwnEntryState,
  grid: LmuOwnEntryGrid
): LmuOwnEntry => {
  const playerSlot = lmuPlayerSlot(grid);
  if (playerSlot >= 0) {
    // The slot is the player's whatever the grid says, but only an entry
    // with a name can be found again once the player has left it. A grid
    // that does not list the slot yet -- it fills in a driver at a time --
    // keeps what was remembered before.
    const name =
      grid.drivers.find((driver) => driver.id === playerSlot)?.vehicleName ??
      '';
    if (name) {
      state.rememberedSlot = playerSlot;
      state.rememberedName = name;
    }
    return { slot: playerSlot, name, source: 'player' };
  }

  const name = state.rememberedName;
  if (name) {
    const holders = grid.drivers.filter(
      (driver) => driver.vehicleName === name
    );
    if (holders.some((driver) => driver.id === state.rememberedSlot)) {
      // Still 'moved' for as long as it stays where it was found, so one
      // move is one change and not two.
      const stillMoved =
        state.current.source === 'moved' &&
        state.current.slot === state.rememberedSlot;
      return {
        slot: state.rememberedSlot,
        name,
        source: stillMoved ? 'moved' : 'remembered',
      };
    }
    // Only when one entry carries the name. Against the AI every car of a
    // model has the same one, and a guess between them would put the
    // overlays on a stranger's car.
    if (holders.length === 1) {
      state.rememberedSlot = holders[0].id;
      return { slot: holders[0].id, name, source: 'moved' };
    }
  }

  const flagged = grid.drivers.filter((driver) => driver.isPlayer === true);
  if (flagged.length === 1) {
    return {
      slot: flagged[0].id,
      name: flagged[0].vehicleName,
      source: 'scoring',
    };
  }
  return NO_ENTRY;
};

/**
 * Resolves the own entry from one session snapshot, remembering it while the
 * player has a vehicle.
 *
 * Called on every session poll rather than every frame: only the session
 * snapshot carries entry names. Returns the same object for as long as
 * nothing has changed.
 */
export const observeLmuOwnEntry = (
  state: LmuOwnEntryState,
  grid: LmuOwnEntryGrid
): LmuOwnEntry => {
  const resolved = resolveLmuOwnEntry(state, grid);
  if (!sameEntry(resolved, state.current)) state.current = resolved;
  return state.current;
};

const SOURCE_DESCRIPTIONS: Record<LmuOwnEntrySource, string> = {
  player: "the player's vehicle",
  remembered: 'remembered, same slot',
  moved: 'remembered, found in another slot',
  scoring: "scoring's player flag",
  none: 'none',
};

/**
 * One line for the log about the own entry: the slot, the entry name, how it
 * was found, who scoring says is driving it, and what scoring's `mIsPlayer`
 * and `mControl` say about it.
 *
 * The last three are there because nothing else records them, and they are
 * what is not known about a team-mate's stint: whether the sim keeps the
 * player flag on the team car, what control it reports, and what changes in
 * the driver name. The caller logs the line when it changes.
 */
export const describeLmuOwnEntry = (
  entry: LmuOwnEntry,
  grid: LmuOwnEntryGrid,
  rememberedName = ''
): string => {
  if (entry.slot < 0) {
    return rememberedName
      ? `Own entry: none; "${rememberedName}" is not on the grid`
      : 'Own entry: none';
  }
  const driver = grid.drivers.find((candidate) => candidate.id === entry.slot);
  const scoring = driver
    ? `driver "${driver.name ?? ''}"; scoring isPlayer=${String(
        driver.isPlayer ?? 'unknown'
      )} control=${String(driver.control ?? 'unknown')}`
    : 'not in scoring';
  return (
    `Own entry: slot ${entry.slot} "${entry.name}" ` +
    `(${SOURCE_DESCRIPTIONS[entry.source]}); ${scoring}`
  );
};

/** Where the watched car came from. */
export type LmuWatchedSource =
  /** LMU's `/rest/watch/focus` names a car. */
  | 'focus'
  /** Nothing focused; the player's own slot. */
  | 'player'
  /** Nothing focused and no player vehicle; the remembered own entry. */
  | 'ownEntry'
  | 'none';

/**
 * The slot the overlays are about, which becomes `CamCarIdx`: the car LMU's
 * camera is on when its REST API names one, else the player's own, else the
 * own entry as remembered.
 *
 * A focus of -1 is the sim saying nothing is focused, and no answer at all is
 * `undefined`; both fall through. The last step is what keeps the Standings
 * and the Relative on the team car while a team-mate drives it: the player
 * has no slot then, and the sim's focus may well be nothing.
 */
export const lmuWatchedSlot = (
  restFocus: number | undefined,
  playerSlot: number,
  ownEntrySlot: number
): number => {
  if (typeof restFocus === 'number' && restFocus >= 0) return restFocus;
  if (playerSlot >= 0) return playerSlot;
  return ownEntrySlot >= 0 ? ownEntrySlot : -1;
};

/** Which of the three `lmuWatchedSlot` took its answer from. */
export const lmuWatchedSource = (
  restFocus: number | undefined,
  playerSlot: number,
  ownEntrySlot: number
): LmuWatchedSource => {
  if (typeof restFocus === 'number' && restFocus >= 0) return 'focus';
  if (playerSlot >= 0) return 'player';
  return ownEntrySlot >= 0 ? 'ownEntry' : 'none';
};

const WATCHED_DESCRIPTIONS: Record<LmuWatchedSource, string> = {
  focus: 'REST focus',
  player: "the player's slot",
  ownEntry: 'own entry',
  none: 'none',
};

/**
 * One line for the log about the watched car: its slot, where that came
 * from, and what LMU's focus endpoint itself said, which is not known for
 * any state yet. The caller logs the line when one of the three changes.
 */
export const describeLmuWatchedCar = (
  slot: number,
  source: LmuWatchedSource,
  restFocus: number | undefined
): string => {
  if (source === 'focus') return `Watched car: slot ${slot} (REST focus)`;
  const focus =
    restFocus === undefined
      ? 'REST focus not answering'
      : `REST focus says ${restFocus}`;
  return source === 'none'
    ? `Watched car: none (${focus}; no player vehicle, no own entry)`
    : `Watched car: slot ${slot} (${WATCHED_DESCRIPTIONS[source]}; ${focus})`;
};
