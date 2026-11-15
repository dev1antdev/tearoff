import type { TrackNote, TrackNoteKind } from '@irdashies/types';

/**
 * Which of a track's notes is the one for where the car is.
 *
 * A note is written for a point on the lap and stays current until the next
 * one is reached, so the last note of the lap carries over the line. Track
 * notes go by where the car is; pace notes by where it will be, a set
 * distance and a set time ahead. Notes marked for the pits are a list of
 * their own, read while the car is on pit road.
 *
 * Here, where both sides can read it, because a recorded race can only be
 * played in the main process, and the spec that checks when a note comes up
 * on one has to pick it as the widget does.
 *
 * The widget picks from `track-state.snapshot`. At the wheel that is
 * the player's own lap fraction as the frame has it, read twenty-five times
 * a second, so a note is up within one update of the car reaching it. A
 * watched car's fraction is carried to three decimals, so its notes can be
 * half a thousandth of a lap early or late on top of that: 1.8 m at Laguna
 * Seca, 6.8 m at Le Mans.
 */

/**
 * The index of the note current at `positionM` in a list sorted by
 * distance: the last one at or before the position, the last of the list
 * before the first note of the lap, -1 for an empty list.
 */
export const selectNote = (
  notes: readonly { distanceM: number }[],
  positionM: number
): number => {
  if (notes.length === 0) return -1;
  // The first note beyond the position, by halving.
  let low = 0;
  let high = notes.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (notes[middle].distanceM <= positionM) low = middle + 1;
    else high = middle;
  }
  return low === 0 ? notes.length - 1 : low - 1;
};

/** A distance brought into 0 <= d < trackLengthM. */
export const wrapDistance = (
  distanceM: number,
  trackLengthM: number
): number =>
  trackLengthM > 0
    ? ((distanceM % trackLengthM) + trackLengthM) % trackLengthM
    : Math.max(distanceM, 0);

/**
 * Where a pace note is looked up: ahead of the car by the lead in metres and
 * by the lead in seconds at the speed it is doing, wrapped into the lap.
 */
export const paceNotePosition = (
  positionM: number,
  speedMs: number,
  leadMeters: number,
  leadSeconds: number,
  trackLengthM: number
): number =>
  wrapDistance(
    positionM + leadMeters + Math.max(speedMs, 0) * leadSeconds,
    trackLengthM
  );

/** A track's notes as the widget reads them: by kind, and by where shown. */
export interface NoteLists {
  /** Shown on track. */
  track: readonly TrackNote[];
  pace: readonly TrackNote[];
  /** Shown on pit road. */
  pitTrack: readonly TrackNote[];
  pitPace: readonly TrackNote[];
}

export const EMPTY_NOTE_LISTS: NoteLists = {
  track: [],
  pace: [],
  pitTrack: [],
  pitPace: [],
};

/** Splits a track's notes, sorted by distance, into the four lists. */
export const splitNotes = (notes: readonly TrackNote[]): NoteLists => {
  const of = (kind: TrackNoteKind, pit: boolean) =>
    notes.filter((note) => note.kind === kind && note.pit === pit);
  return {
    track: of('track', false),
    pace: of('pace', false),
    pitTrack: of('track', true),
    pitPace: of('pace', true),
  };
};

export interface NoteSelectionInput {
  /** Where the car is, as a lap fraction 0..1. */
  lapFraction: number;
  /** Metres per second; what the lead time is turned into metres by. */
  speedMs: number;
  onPitRoad: boolean;
}

export interface NoteSelectionOptions {
  trackLengthM: number;
  paceLeadMeters: number;
  paceLeadSeconds: number;
  /** On pit road, read the pit lists rather than the on-track ones. */
  showPitNotes: boolean;
}

export interface NoteSelection {
  /** The pit lists are the ones read. */
  pit: boolean;
  /** Index into the pace list read, -1 when it is empty. */
  paceIndex: number;
  /** Index into the track list read, -1 when it is empty. */
  trackIndex: number;
  /** Metres from the car to the next pace note, or null with fewer than two. */
  paceNextM: number | null;
  /** The same for the track notes. */
  trackNextM: number | null;
}

/**
 * Metres from `positionM` on to the note after the current one, round the
 * lap if need be. Null for a list with no other note to come.
 */
const distanceToNext = (
  notes: readonly { distanceM: number }[],
  currentIndex: number,
  positionM: number,
  trackLengthM: number
): number | null => {
  if (notes.length < 2 || currentIndex < 0) return null;
  const next = notes[(currentIndex + 1) % notes.length];
  return wrapDistance(next.distanceM - positionM, trackLengthM);
};

/** The notes current for a car at a point of the lap. */
export const selectCurrentNotes = (
  lists: NoteLists,
  { lapFraction, speedMs, onPitRoad }: NoteSelectionInput,
  {
    trackLengthM,
    paceLeadMeters,
    paceLeadSeconds,
    showPitNotes,
  }: NoteSelectionOptions
): NoteSelection => {
  const pit = onPitRoad && showPitNotes;
  const trackNotes = pit ? lists.pitTrack : lists.track;
  const paceNotes = pit ? lists.pitPace : lists.pace;
  const positionM = lapFraction * trackLengthM;
  const pacePositionM = paceNotePosition(
    positionM,
    speedMs,
    paceLeadMeters,
    paceLeadSeconds,
    trackLengthM
  );
  const trackIndex = selectNote(trackNotes, positionM);
  const paceIndex = selectNote(paceNotes, pacePositionM);
  return {
    pit,
    paceIndex,
    trackIndex,
    paceNextM: distanceToNext(
      paceNotes,
      paceIndex,
      pacePositionM,
      trackLengthM
    ),
    trackNextM: distanceToNext(trackNotes, trackIndex, positionM, trackLengthM),
  };
};
