import { describe, expect, it } from 'vitest';
import {
  createLmuOwnEntryState,
  describeLmuOwnEntry,
  describeLmuWatchedCar,
  lmuOwnEntrySlot,
  lmuWatchedSlot,
  lmuWatchedSource,
  observeLmuOwnEntry,
  resetLmuOwnEntryState,
  type LmuOwnEntryGrid,
} from './ownEntry';

const TEAM_CAR = 'Iron Coast Racing #77:LMGT3';
const RIVAL = 'Northstar Motorsport #8:WEC';
const OTHER = 'United Nordic #22:ELMS26';

type Entry = LmuOwnEntryGrid['drivers'][number];

const entry = (
  id: number,
  vehicleName: string,
  overrides: Partial<Entry> = {}
): Entry => ({
  id,
  vehicleName,
  name: `Driver ${id}`,
  isPlayer: false,
  control: 2,
  ...overrides,
});

/** A grid with the user in the team car, in slot 4. */
const driving = (drivers?: Entry[]): LmuOwnEntryGrid => ({
  playerHasVehicle: true,
  playerVehicleIdx: 4,
  drivers: drivers ?? [
    entry(2, RIVAL),
    entry(4, TEAM_CAR, { name: 'Alex Mercer', isPlayer: true, control: 0 }),
    entry(7, OTHER),
  ],
});

/** The same grid as the sim gives it with nobody of ours at the wheel. */
const watching = (drivers: Entry[]): LmuOwnEntryGrid => ({
  playerHasVehicle: false,
  playerVehicleIdx: -1,
  drivers,
});

const teamMateDriving = [
  entry(2, RIVAL),
  entry(4, TEAM_CAR, { name: 'Jonas Lindqvist' }),
  entry(7, OTHER),
];

describe('the own entry under Le Mans Ultimate', () => {
  it('is the slot of the player’s vehicle while driving', () => {
    const state = createLmuOwnEntryState();

    expect(observeLmuOwnEntry(state, driving())).toEqual({
      slot: 4,
      name: TEAM_CAR,
      source: 'player',
    });
    expect(lmuOwnEntrySlot(state)).toBe(4);
  });

  it('is nothing before the player has had a vehicle', () => {
    const state = createLmuOwnEntryState();

    expect(observeLmuOwnEntry(state, watching(teamMateDriving)).slot).toBe(-1);
    expect(lmuOwnEntrySlot(state)).toBe(-1);
  });

  it('is remembered when the sim stops naming a player vehicle', () => {
    const state = createLmuOwnEntryState();
    observeLmuOwnEntry(state, driving());

    // The driver name in the slot is the team-mate's now; the entry name is
    // the car's and has not moved.
    expect(observeLmuOwnEntry(state, watching(teamMateDriving))).toEqual({
      slot: 4,
      name: TEAM_CAR,
      source: 'remembered',
    });
  });

  it('follows the entry name to another slot', () => {
    const state = createLmuOwnEntryState();
    observeLmuOwnEntry(state, driving());

    const moved = watching([entry(2, RIVAL), entry(9, TEAM_CAR)]);
    expect(observeLmuOwnEntry(state, moved)).toEqual({
      slot: 9,
      name: TEAM_CAR,
      source: 'moved',
    });
    // And stays there, as one change rather than two.
    expect(observeLmuOwnEntry(state, moved)).toEqual({
      slot: 9,
      name: TEAM_CAR,
      source: 'moved',
    });
  });

  it('does not mistake a different entry in the old slot for it', () => {
    const state = createLmuOwnEntryState();
    observeLmuOwnEntry(state, driving());

    const replaced = watching([entry(2, RIVAL), entry(4, OTHER)]);
    expect(observeLmuOwnEntry(state, replaced)).toEqual({
      slot: -1,
      name: '',
      source: 'none',
    });
  });

  it('is none while the entry is off the grid, and comes back with it', () => {
    const state = createLmuOwnEntryState();
    observeLmuOwnEntry(state, driving());

    expect(observeLmuOwnEntry(state, watching([entry(2, RIVAL)])).slot).toBe(
      -1
    );
    // A grid filling in again after a session change, or a reconnect.
    expect(observeLmuOwnEntry(state, watching([])).slot).toBe(-1);
    expect(observeLmuOwnEntry(state, watching(teamMateDriving))).toEqual({
      slot: 4,
      name: TEAM_CAR,
      source: 'remembered',
    });
  });

  it('is kept across a session change, where nothing resets it', () => {
    // Practice, qualifying and the race of one event are the same entry. The
    // caller resets nothing at a session change, so the next session's grid
    // is simply the next observation, with the cars in new slots.
    const state = createLmuOwnEntryState();
    observeLmuOwnEntry(state, driving());

    const nextSession = watching([
      entry(0, TEAM_CAR, { name: 'Jonas Lindqvist' }),
      entry(1, RIVAL),
    ]);
    expect(observeLmuOwnEntry(state, nextSession).slot).toBe(0);
  });

  it('is forgotten on a reset: another track, or LMU gone', () => {
    const state = createLmuOwnEntryState();
    observeLmuOwnEntry(state, driving());

    resetLmuOwnEntryState(state);

    expect(lmuOwnEntrySlot(state)).toBe(-1);
    expect(observeLmuOwnEntry(state, watching(teamMateDriving)).slot).toBe(-1);
  });

  it('takes the entry the player is in now over the one remembered', () => {
    const state = createLmuOwnEntryState();
    observeLmuOwnEntry(state, driving());

    const otherCar: LmuOwnEntryGrid = {
      playerHasVehicle: true,
      playerVehicleIdx: 7,
      drivers: [entry(4, TEAM_CAR), entry(7, OTHER, { isPlayer: true })],
    };
    expect(observeLmuOwnEntry(state, otherCar).slot).toBe(7);
    expect(
      observeLmuOwnEntry(state, watching([entry(4, TEAM_CAR), entry(7, OTHER)]))
    ).toEqual({ slot: 7, name: OTHER, source: 'remembered' });
  });

  it('does not guess between entries that share a name', () => {
    // Against the AI every car of a model is named after the model.
    const state = createLmuOwnEntryState();
    observeLmuOwnEntry(
      state,
      driving([entry(4, 'Ferrari 296 GT3'), entry(5, 'Ferrari 296 GT3')])
    );

    // Where it was last seen is still an answer.
    expect(
      observeLmuOwnEntry(
        state,
        watching([entry(4, 'Ferrari 296 GT3'), entry(5, 'Ferrari 296 GT3')])
      ).slot
    ).toBe(4);
    // Elsewhere, with two candidates, there is none.
    expect(
      observeLmuOwnEntry(
        state,
        watching([entry(5, 'Ferrari 296 GT3'), entry(6, 'Ferrari 296 GT3')])
      ).slot
    ).toBe(-1);
  });

  it('keeps the slot the sim names before the grid lists it', () => {
    const state = createLmuOwnEntryState();

    expect(observeLmuOwnEntry(state, driving([entry(2, RIVAL)]))).toEqual({
      slot: 4,
      name: '',
      source: 'player',
    });
    // Nothing to find it again by, so nothing is remembered.
    expect(observeLmuOwnEntry(state, watching(teamMateDriving)).slot).toBe(-1);
  });

  describe('with only scoring’s player flag to go on', () => {
    const flagged = watching([
      entry(2, RIVAL),
      entry(4, TEAM_CAR, { isPlayer: true }),
    ]);

    it('uses it when nothing is remembered', () => {
      // The app started while a team-mate was already driving.
      const state = createLmuOwnEntryState();

      expect(observeLmuOwnEntry(state, flagged)).toEqual({
        slot: 4,
        name: TEAM_CAR,
        source: 'scoring',
      });
    });

    it('does not remember it', () => {
      const state = createLmuOwnEntryState();
      observeLmuOwnEntry(state, flagged);

      expect(observeLmuOwnEntry(state, watching(teamMateDriving)).slot).toBe(
        -1
      );
    });

    it('trusts the remembered entry over it', () => {
      const state = createLmuOwnEntryState();
      observeLmuOwnEntry(state, driving());

      const flagElsewhere = watching([
        entry(2, RIVAL, { isPlayer: true }),
        entry(4, TEAM_CAR),
      ]);
      expect(observeLmuOwnEntry(state, flagElsewhere)).toEqual({
        slot: 4,
        name: TEAM_CAR,
        source: 'remembered',
      });
    });

    it('does not choose between two flagged entries', () => {
      const state = createLmuOwnEntryState();
      const both = watching([
        entry(2, RIVAL, { isPlayer: true }),
        entry(4, TEAM_CAR, { isPlayer: true }),
      ]);

      expect(observeLmuOwnEntry(state, both).slot).toBe(-1);
    });
  });

  it('returns the same object while nothing has changed', () => {
    const state = createLmuOwnEntryState();
    const first = observeLmuOwnEntry(state, driving());

    expect(observeLmuOwnEntry(state, driving())).toBe(first);
    expect(observeLmuOwnEntry(state, watching(teamMateDriving))).not.toBe(
      first
    );
  });
});

describe('the log line for the own entry', () => {
  it('names the slot, the entry, how it was found and what scoring says', () => {
    const state = createLmuOwnEntryState();
    const grid = driving();

    expect(describeLmuOwnEntry(observeLmuOwnEntry(state, grid), grid)).toBe(
      'Own entry: slot 4 "Iron Coast Racing #77:LMGT3" ' +
        '(the player\'s vehicle); driver "Alex Mercer"; ' +
        'scoring isPlayer=true control=0'
    );

    const handedOver = watching(teamMateDriving);
    expect(
      describeLmuOwnEntry(observeLmuOwnEntry(state, handedOver), handedOver)
    ).toBe(
      'Own entry: slot 4 "Iron Coast Racing #77:LMGT3" ' +
        '(remembered, same slot); driver "Jonas Lindqvist"; ' +
        'scoring isPlayer=false control=2'
    );
  });

  it('says what the sim left out', () => {
    const grid = watching([{ id: 4, vehicleName: TEAM_CAR }]);

    expect(
      describeLmuOwnEntry({ slot: 4, name: TEAM_CAR, source: 'moved' }, grid)
    ).toBe(
      'Own entry: slot 4 "Iron Coast Racing #77:LMGT3" ' +
        '(remembered, found in another slot); driver ""; ' +
        'scoring isPlayer=unknown control=unknown'
    );
    expect(
      describeLmuOwnEntry({ slot: 4, name: '', source: 'player' }, watching([]))
    ).toBe('Own entry: slot 4 "" (the player\'s vehicle); not in scoring');
  });

  it('says which entry is missing when there is none', () => {
    const none = { slot: -1, name: '', source: 'none' } as const;

    expect(describeLmuOwnEntry(none, watching([]))).toBe('Own entry: none');
    expect(describeLmuOwnEntry(none, watching([]), TEAM_CAR)).toBe(
      'Own entry: none; "Iron Coast Racing #77:LMGT3" is not on the grid'
    );
  });
});

describe('the watched car under Le Mans Ultimate', () => {
  it('is the car the sim’s camera is on when it names one', () => {
    expect(lmuWatchedSlot(5, 4, 4)).toBe(5);
    expect(lmuWatchedSlot(0, -1, -1)).toBe(0);
    expect(lmuWatchedSource(5, 4, 4)).toBe('focus');
  });

  it('is the player’s own car when nothing is focused', () => {
    expect(lmuWatchedSlot(-1, 4, 9)).toBe(4);
    expect(lmuWatchedSlot(undefined, 4, 9)).toBe(4);
    expect(lmuWatchedSource(-1, 4, 9)).toBe('player');
  });

  it('is the own entry when the player has no vehicle either', () => {
    expect(lmuWatchedSlot(-1, -1, 9)).toBe(9);
    expect(lmuWatchedSlot(undefined, -1, 9)).toBe(9);
    expect(lmuWatchedSource(undefined, -1, 9)).toBe('ownEntry');
  });

  it('is nothing with none of the three', () => {
    expect(lmuWatchedSlot(-1, -1, -1)).toBe(-1);
    expect(lmuWatchedSlot(undefined, -1, -1)).toBe(-1);
    expect(lmuWatchedSource(undefined, -1, -1)).toBe('none');
  });

  it('is described with what the focus endpoint itself said', () => {
    expect(describeLmuWatchedCar(5, 'focus', 5)).toBe(
      'Watched car: slot 5 (REST focus)'
    );
    expect(describeLmuWatchedCar(4, 'player', -1)).toBe(
      "Watched car: slot 4 (the player's slot; REST focus says -1)"
    );
    expect(describeLmuWatchedCar(9, 'ownEntry', undefined)).toBe(
      'Watched car: slot 9 (own entry; REST focus not answering)'
    );
    expect(describeLmuWatchedCar(-1, 'none', -1)).toBe(
      'Watched car: none (REST focus says -1; no player vehicle, no own entry)'
    );
  });
});
