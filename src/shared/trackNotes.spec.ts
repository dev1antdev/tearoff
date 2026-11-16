import { describe, expect, it } from 'vitest';
import type { TrackNote } from '@irdashies/types';
import {
  paceNotePosition,
  selectCurrentNotes,
  selectNote,
  splitNotes,
  wrapDistance,
  type NoteSelectionOptions,
} from './trackNotes';

const note = (
  distanceM: number,
  extra: Partial<TrackNote> = {}
): TrackNote => ({
  id: `n${distanceM}${extra.kind ?? 'track'}${extra.pit ? 'p' : ''}`,
  distanceM,
  kind: 'track',
  text: `Note at ${distanceM}`,
  comment: '',
  pit: false,
  ...extra,
});

const three = [note(100), note(900), note(3000)];

const options = (
  extra: Partial<NoteSelectionOptions> = {}
): NoteSelectionOptions => ({
  trackLengthM: 3590,
  paceLeadMeters: 0,
  paceLeadSeconds: 0,
  showPitNotes: true,
  ...extra,
});

describe('selectNote', () => {
  it('is the last note at or before the position', () => {
    expect(selectNote(three, 100)).toBe(0);
    expect(selectNote(three, 899.9)).toBe(0);
    expect(selectNote(three, 900)).toBe(1);
    expect(selectNote(three, 3500)).toBe(2);
  });

  it('carries the last note of the lap over the line', () => {
    expect(selectNote(three, 50)).toBe(2);
    expect(selectNote(three, 0)).toBe(2);
  });

  it('is -1 for a track with no notes', () => {
    expect(selectNote([], 50)).toBe(-1);
  });

  it('keeps a single note current everywhere', () => {
    const one = [note(1500)];
    expect(selectNote(one, 0)).toBe(0);
    expect(selectNote(one, 1499.9)).toBe(0);
    expect(selectNote(one, 1500)).toBe(0);
    expect(selectNote(one, 3589)).toBe(0);
  });

  it('finds the note in a long list as it would in a short one', () => {
    const many = Array.from({ length: 500 }, (_, index) => note(index * 7));
    for (const position of [0, 6.9, 7, 1234.5, 3492.9, 3493, 3589]) {
      const expected = Math.min(Math.floor(position / 7), 499);
      expect(selectNote(many, position)).toBe(expected);
    }
  });
});

describe('paceNotePosition', () => {
  it('looks a set distance ahead', () => {
    expect(paceNotePosition(820, 0, 100, 0, 3590)).toBe(920);
    expect(selectNote(three, paceNotePosition(820, 0, 100, 0, 3590))).toBe(1);
  });

  it('looks a set time ahead at the speed of the car, round the line', () => {
    // 3,480 m and two seconds at 60 m/s is 3,600 m: 10 m into the next lap,
    // where the 3,000 m note still stands.
    const position = paceNotePosition(3480, 60, 0, 2, 3590);
    expect(position).toBeCloseTo(10, 6);
    expect(selectNote(three, position)).toBe(2);
  });

  it('adds the time to the distance', () => {
    expect(paceNotePosition(1000, 50, 100, 1.5, 3590)).toBe(1175);
  });

  it('shows a note late for a negative lead', () => {
    expect(paceNotePosition(950, 0, -100, 0, 3590)).toBe(850);
    expect(paceNotePosition(40, 0, -100, 0, 3590)).toBe(3530);
  });

  it('takes a car rolling backwards as standing still', () => {
    expect(paceNotePosition(1000, -5, 0, 2, 3590)).toBe(1000);
  });
});

describe('wrapDistance', () => {
  it('brings a distance into the lap', () => {
    expect(wrapDistance(3600, 3590)).toBe(10);
    expect(wrapDistance(-10, 3590)).toBe(3580);
    expect(wrapDistance(3590, 3590)).toBe(0);
  });

  it('leaves a distance alone on a track of no stated length', () => {
    expect(wrapDistance(120, 0)).toBe(120);
    expect(wrapDistance(-5, 0)).toBe(0);
  });
});

describe('splitNotes', () => {
  it('sorts notes into on-track and pit lists of each kind', () => {
    const lists = splitNotes([
      note(50, { pit: true }),
      note(100),
      note(120, { kind: 'pace' }),
      note(200, { kind: 'pace', pit: true }),
      note(900),
    ]);

    expect(lists.track.map((each) => each.distanceM)).toEqual([100, 900]);
    expect(lists.pace.map((each) => each.distanceM)).toEqual([120]);
    expect(lists.pitTrack.map((each) => each.distanceM)).toEqual([50]);
    expect(lists.pitPace.map((each) => each.distanceM)).toEqual([200]);
  });
});

describe('selectCurrentNotes', () => {
  const lists = splitNotes([
    note(60, { pit: true }),
    note(100),
    note(400, { kind: 'pace' }),
    note(900),
    note(2000, { kind: 'pace' }),
    note(3000),
  ]);

  it('picks the track note for where the car is and the pace note ahead', () => {
    const selection = selectCurrentNotes(
      lists,
      { lapFraction: 950 / 3590, speedMs: 50, onPitRoad: false },
      options({ paceLeadMeters: 100, paceLeadSeconds: 1 })
    );

    expect(selection.pit).toBe(false);
    expect(lists.track[selection.trackIndex].distanceM).toBe(900);
    // 950 + 100 + 50 = 1,100 m: past the 400 m pace note, short of 2,000.
    expect(lists.pace[selection.paceIndex].distanceM).toBe(400);
    expect(selection.trackNextM).toBeCloseTo(2050, 6);
    expect(selection.paceNextM).toBeCloseTo(900, 6);
  });

  it('measures the way to the next note round the line', () => {
    const selection = selectCurrentNotes(
      lists,
      { lapFraction: 3500 / 3590, speedMs: 0, onPitRoad: false },
      options()
    );

    expect(lists.track[selection.trackIndex].distanceM).toBe(3000);
    // 90 m to the line and 100 m beyond it.
    expect(selection.trackNextM).toBeCloseTo(190, 6);
  });

  it('reads the pit lists on pit road', () => {
    const selection = selectCurrentNotes(
      lists,
      { lapFraction: 80 / 3590, speedMs: 20, onPitRoad: true },
      options()
    );

    expect(selection.pit).toBe(true);
    expect(lists.pitTrack[selection.trackIndex].distanceM).toBe(60);
    // No pace note is written for the pits.
    expect(selection.paceIndex).toBe(-1);
    // One note: there is no next one to count down to.
    expect(selection.trackNextM).toBeNull();
    expect(selection.paceNextM).toBeNull();
  });

  it('keeps to the on-track notes on pit road when pit notes are off', () => {
    const selection = selectCurrentNotes(
      lists,
      { lapFraction: 950 / 3590, speedMs: 20, onPitRoad: true },
      options({ showPitNotes: false })
    );

    expect(selection.pit).toBe(false);
    expect(lists.track[selection.trackIndex].distanceM).toBe(900);
  });

  it('has nothing current on a track with no notes', () => {
    const selection = selectCurrentNotes(
      splitNotes([]),
      { lapFraction: 0.5, speedMs: 50, onPitRoad: false },
      options()
    );

    expect(selection).toEqual({
      pit: false,
      paceIndex: -1,
      trackIndex: -1,
      paceNextM: null,
      trackNextM: null,
    });
  });
});
