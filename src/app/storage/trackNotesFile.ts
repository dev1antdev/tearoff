import type { TrackNoteKind } from '@irdashies/types';
import { TRACK_NOTE_FILE_LENGTH } from '@irdashies/types';

/**
 * Track notes and pace notes as a file a driver can keep and pass on.
 *
 * The layout is the one TinyPedal reads and writes (`.tptn` and `.tppn`), so
 * notes written for it come in as they are: comma-separated text, with
 *
 * - an optional first line naming the file kind and version,
 * - optional `TITLE`, `AUTHOR`, `DATE` and `DESCRIPTION` lines,
 * - a header line beginning `distance`, whose second column says which kind
 *   of note the file holds (`track note` or `pace note`),
 * - one row per note: metres into the lap, the text, a comment, tags.
 *
 * In a comment the two characters `\n` stand for a line break. The one tag
 * with a meaning is `#pit`: the note is shown on pit road only.
 *
 * Pure text in and out. Reading the file is the caller's, and so is where
 * the notes go.
 */

/** A note as a file states it: no id yet, and nothing checked against a track. */
export interface TrackNoteRow {
  distanceM: number;
  text: string;
  comment: string;
  pit: boolean;
}

export interface TrackNotesFile {
  /** What the header says the notes are, or null when it does not say. */
  kind: TrackNoteKind | null;
  rows: TrackNoteRow[];
}

const PIT_TAG = '#pit';
const BYTE_ORDER_MARK = 0xfeff;

const HEADER_KINDS: Readonly<Record<TrackNoteKind, string>> = {
  track: 'track note',
  pace: 'pace note',
};

const FILE_TITLES: Readonly<Record<TrackNoteKind, string>> = {
  track: 'TINYPEDAL TRACK NOTES FILE VERSION',
  pace: 'TINYPEDAL PACE NOTES FILE VERSION',
};

/** The fields of one line: quoted ones may hold commas and doubled quotes. */
const splitRow = (line: string): string[] => {
  const fields: string[] = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quoted) {
      if (char !== '"') field += char;
      else if (line[index + 1] === '"') {
        field += '"';
        index += 1;
      } else quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === ',') {
      fields.push(field);
      field = '';
    } else field += char;
  }
  fields.push(field);
  return fields;
};

/**
 * Reads a notes file. Null when it is not one: longer than a notes file may
 * be, or with no header line beginning `distance`.
 *
 * Everything before the header is skipped. A row whose distance is not a
 * number is dropped, and so are tags other than `#pit`, with the note kept.
 */
export const parseTrackNotesFile = (text: unknown): TrackNotesFile | null => {
  if (typeof text !== 'string' || text.length > TRACK_NOTE_FILE_LENGTH) {
    return null;
  }
  // A byte order mark, which a file saved by an editor may begin with.
  const body = text.charCodeAt(0) === BYTE_ORDER_MARK ? text.slice(1) : text;
  const lines = body.split(/\r\n|\r|\n/);
  const headerAt = lines.findIndex((line) =>
    line.trimStart().toLowerCase().startsWith('distance')
  );
  if (headerAt < 0) return null;

  const named = splitRow(lines[headerAt])[1]?.trim().toLowerCase();
  const kind =
    named === HEADER_KINDS.pace
      ? 'pace'
      : named === HEADER_KINDS.track
        ? 'track'
        : null;

  const rows: TrackNoteRow[] = [];
  for (const line of lines.slice(headerAt + 1)) {
    if (line.trim() === '') continue;
    const [distance, note = '', comment = '', tags = ''] = splitRow(line);
    const distanceM = distance.trim() === '' ? Number.NaN : Number(distance);
    if (!Number.isFinite(distanceM)) continue;
    rows.push({
      distanceM,
      text: note.trim(),
      comment: comment.replaceAll('\\n', '\n'),
      pit: tags.toLowerCase().includes(PIT_TAG),
    });
  }
  return { kind, rows };
};

const quote = (value: string): string => `"${value.replaceAll('"', '""')}"`;

/** Up to four decimals, without trailing zeros. */
const metres = (value: number): string => String(Number(value.toFixed(4)));

/**
 * Writes the notes of one kind as a notes file, in the order given. What
 * `parseTrackNotesFile` makes of the result is the same notes.
 */
export const serializeTrackNotesFile = (
  kind: TrackNoteKind,
  rows: readonly TrackNoteRow[]
): string =>
  [
    `${FILE_TITLES[kind]},2`,
    `distance,${HEADER_KINDS[kind]},comment,tags`,
    ...rows.map((row) =>
      [
        metres(row.distanceM),
        // A line break inside a field would end the row for a reader that
        // takes the file a line at a time.
        quote(row.text.replace(/[\r\n]+/g, ' ')),
        quote(row.comment.replace(/\r\n|\r|\n/g, '\\n')),
        row.pit ? quote(PIT_TAG) : '',
      ].join(',')
    ),
    '',
  ].join('\n');
