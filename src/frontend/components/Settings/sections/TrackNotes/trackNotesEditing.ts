import type {
  TrackNote,
  TrackNoteDraft,
  TrackNoteKind,
  TrackProfileSummary,
} from '@irdashies/types';
import {
  TRACK_NOTE_TEXT_LENGTH,
  SIMULATOR_LABELS,
  isActiveSimulator,
} from '@irdashies/types';
import type { TrackCorner } from '@irdashies/domain/corners/trackCorners';
import { wrapDistance } from '@irdashies/shared';

/**
 * What the notes editor does to a track's notes before it hands them to the
 * bridge. Pure: the page keeps nothing the store has not confirmed.
 */

/** Distances are edited and kept to the tenth of a metre. */
export const roundDistance = (distanceM: number): number =>
  Math.round(distanceM * 10) / 10;

/**
 * The last distance a note may lie at: the greatest tenth of a metre short
 * of the end of the lap, which is the start of the next.
 */
export const lastDistanceOf = (trackLengthM: number): number => {
  let last = Math.floor(trackLengthM * 10) / 10;
  while (last >= trackLengthM && last > 0) last = roundDistance(last - 0.1);
  return Math.max(last, 0);
};

/**
 * A distance typed into the table, held to the lap: a number at or past the
 * end of the lap, or below 0, is brought onto it. Null for what is not a
 * number.
 */
export const parseDistance = (
  text: string,
  trackLengthM: number
): number | null => {
  const value = Number(text.trim().replace(',', '.'));
  if (text.trim() === '' || !Number.isFinite(value)) return null;
  return Math.min(
    roundDistance(Math.max(value, 0)),
    lastDistanceOf(trackLengthM)
  );
};

/** Every note moved along the lap by so many metres, round the line. */
export const shiftNotes = (
  notes: readonly TrackNote[],
  shiftM: number,
  trackLengthM: number
): TrackNote[] =>
  notes
    .map((note) => {
      const moved = roundDistance(
        wrapDistance(note.distanceM + shiftM, trackLengthM)
      );
      // Rounded up onto the line, it is at the start of the lap.
      return { ...note, distanceM: moved >= trackLengthM ? 0 : moved };
    })
    .sort((a, b) => a.distanceM - b.distanceM);

/**
 * One track note for each corner of the bundled corner data that the track
 * has no note for yet, where the corner starts, named as the corner is.
 */
export const notesFromCorners = (
  corners: readonly TrackCorner[],
  existing: readonly TrackNote[],
  trackLengthM: number
): TrackNoteDraft[] => {
  const taken = new Set(
    existing
      .filter((note) => note.kind === 'track' && !note.pit)
      .map((note) => note.text.trim().toLowerCase())
  );
  const drafts: TrackNoteDraft[] = [];
  for (const corner of corners) {
    const text = corner.label.trim().slice(0, TRACK_NOTE_TEXT_LENGTH);
    const key = text.toLowerCase();
    if (text === '' || taken.has(key)) continue;
    taken.add(key);
    const distanceM = roundDistance(
      wrapDistance(corner.start_pct * trackLengthM, trackLengthM)
    );
    drafts.push({
      distanceM: distanceM >= trackLengthM ? 0 : distanceM,
      kind: 'track',
      text,
      comment: '',
      pit: false,
    });
  }
  return drafts;
};

/** Which kind a notes file holds when its header does not say: by its name. */
export const kindOfFileName = (fileName: string): TrackNoteKind =>
  fileName.trim().toLowerCase().endsWith('.tppn') ? 'pace' : 'track';

const EXTENSIONS: Record<TrackNoteKind, string> = {
  track: 'tptn',
  pace: 'tppn',
};

/** The file a track's notes of one kind are saved as, safe for any disk. */
export const exportFileName = (
  trackName: string,
  kind: TrackNoteKind
): string => {
  const base = trackName
    .replace(/[<>:"/\\|?*]/g, ' ')
    // Control characters, which no file name may hold.
    .replace(/\p{Cc}/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '');
  return `${base || 'track'}.${EXTENSIONS[kind]}`;
};

/** A stored track as the track list names it. */
export const trackOptionLabel = (track: {
  simulator: string;
  trackName: string;
  trackId: number;
}): string => {
  const name = track.trackName || `Track ${track.trackId}`;
  const simulator = isActiveSimulator(track.simulator)
    ? SIMULATOR_LABELS[track.simulator]
    : track.simulator;
  return `${name} (${simulator})`;
};

/** "3,590 m", for the line under the track's name. */
export const formatTrackLength = (trackLengthM: number): string =>
  `${Math.round(trackLengthM).toLocaleString('en-US')} m`;

/** "12 notes" */
export const noteCountLabel = (count: number): string =>
  `${count} ${count === 1 ? 'note' : 'notes'}`;

/** Tracks to choose from: stored ones, each once, the given one first. */
export const trackChoices = (
  tracks: readonly TrackProfileSummary[],
  first: { trackKey: string; label: string } | null
): { trackKey: string; label: string }[] => {
  const choices = first ? [first] : [];
  for (const track of tracks) {
    const trackKey = `${track.simulator}:${track.trackId}`;
    if (choices.some((choice) => choice.trackKey === trackKey)) continue;
    choices.push({ trackKey, label: trackOptionLabel(track) });
  }
  return choices;
};
