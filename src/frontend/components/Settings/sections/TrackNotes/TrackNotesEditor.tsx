import { memo, useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowsHorizontalIcon,
  DownloadSimpleIcon,
  MapPinIcon,
  MapPinPlusIcon,
  PlusIcon,
  SignpostIcon,
  TrashIcon,
  UploadSimpleIcon,
} from '@phosphor-icons/react';
import {
  TRACK_NOTE_COMMENT_LENGTH,
  TRACK_NOTE_FILE_LENGTH,
  TRACK_NOTE_LIMIT,
  TRACK_NOTE_TEXT_LENGTH,
  type TrackNote,
  type TrackNoteDraft,
  type TrackNoteKind,
  type TrackProfileBridge,
} from '@irdashies/types';
import type { TrackCorner } from '@irdashies/domain/corners/trackCorners';
import {
  exportFileName,
  formatTrackLength,
  kindOfFileName,
  noteCountLabel,
  notesFromCorners,
  parseDistance,
  roundDistance,
  shiftNotes,
  trackChoices,
} from './trackNotesEditing';
import { useTrackNotesEditor } from './useTrackNotesEditor';

const KINDS: readonly TrackNoteKind[] = ['track', 'pace'];
const KIND_LABELS: Record<TrackNoteKind, string> = {
  track: 'Track',
  pace: 'Pace',
};

/** A comment as it is typed on one line: a line break is the two characters. */
const commentToField = (comment: string): string =>
  comment.replaceAll('\n', '\\n');
const fieldToComment = (field: string): string => field.replaceAll('\\n', '\n');

interface NoteRowProps {
  note: TrackNote;
  trackLengthM: number;
  /** Put the cursor in this row's text when it appears. */
  autoFocus: boolean;
  onChange: (id: string, patch: Partial<TrackNoteDraft>) => void;
  onDelete: (id: string) => void;
}

interface RowFields {
  distance: string;
  text: string;
  comment: string;
}

const fieldsOf = (note: TrackNote): RowFields => ({
  distance: note.distanceM.toFixed(1),
  text: note.text,
  comment: commentToField(note.comment),
});

/**
 * One note. What is typed is held here until the field is left or Enter is
 * pressed, and saved then; the kind and the pit mark are saved as they are
 * changed.
 */
const NoteRow = memo(
  ({ note, trackLengthM, autoFocus, onChange, onDelete }: NoteRowProps) => {
    const [fields, setFields] = useState(() => fieldsOf(note));
    // What is stored changed under the row: an import, a shift, another
    // window. What was typed and not yet saved gives way to it.
    const [shown, setShown] = useState(note);
    if (
      shown.distanceM !== note.distanceM ||
      shown.text !== note.text ||
      shown.comment !== note.comment
    ) {
      setShown(note);
      setFields(fieldsOf(note));
    }
    const textRef = useRef<HTMLInputElement>(null);
    useEffect(() => {
      if (autoFocus) textRef.current?.focus();
    }, [autoFocus]);

    const commitDistance = () => {
      const distanceM = parseDistance(fields.distance, trackLengthM);
      if (distanceM === null || distanceM === note.distanceM) {
        setFields((current) => ({
          ...current,
          distance: note.distanceM.toFixed(1),
        }));
        return;
      }
      onChange(note.id, { distanceM });
    };
    const commitText = () => {
      if (fields.text !== note.text) onChange(note.id, { text: fields.text });
    };
    const commitComment = () => {
      const comment = fieldToComment(fields.comment);
      if (comment !== note.comment) onChange(note.id, { comment });
    };
    const onEnter =
      (commit: () => void) =>
      (event: React.KeyboardEvent<HTMLInputElement>) => {
        if (event.key === 'Enter') commit();
      };
    const name = note.text || `the note at ${note.distanceM.toFixed(1)} m`;

    return (
      <tr className="border-t border-slate-700/60 align-middle">
        <td className="py-1.5 pl-3 pr-2">
          <input
            type="text"
            inputMode="decimal"
            className="settings-field w-24 text-right tabular-nums"
            aria-label={`Distance of ${name}, metres`}
            value={fields.distance}
            onChange={(event) =>
              setFields((current) => ({
                ...current,
                distance: event.target.value,
              }))
            }
            onBlur={commitDistance}
            onKeyDown={onEnter(commitDistance)}
          />
        </td>
        <td className="py-1.5 pr-2">
          <select
            className="settings-field w-24"
            aria-label={`Kind of ${name}`}
            value={note.kind}
            onChange={(event) =>
              onChange(note.id, {
                kind: event.target.value === 'pace' ? 'pace' : 'track',
              })
            }
          >
            {KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {KIND_LABELS[kind]}
              </option>
            ))}
          </select>
        </td>
        <td className="w-[38%] py-1.5 pr-2">
          <input
            ref={textRef}
            type="text"
            className="settings-field w-full"
            aria-label={`Text of ${name}`}
            placeholder="What to show"
            maxLength={TRACK_NOTE_TEXT_LENGTH}
            value={fields.text}
            onChange={(event) =>
              setFields((current) => ({ ...current, text: event.target.value }))
            }
            onBlur={commitText}
            onKeyDown={onEnter(commitText)}
          />
        </td>
        <td className="py-1.5 pr-2">
          <input
            type="text"
            className="settings-field w-full"
            aria-label={`Comment of ${name}`}
            placeholder="Optional"
            maxLength={TRACK_NOTE_COMMENT_LENGTH}
            value={fields.comment}
            onChange={(event) =>
              setFields((current) => ({
                ...current,
                comment: event.target.value,
              }))
            }
            onBlur={commitComment}
            onKeyDown={onEnter(commitComment)}
          />
        </td>
        <td className="py-1.5 pr-2 text-center">
          <input
            type="checkbox"
            className="h-4 w-4 accent-accent-500"
            aria-label={`Show ${name} on pit road only`}
            checked={note.pit}
            onChange={(event) =>
              onChange(note.id, { pit: event.target.checked })
            }
          />
        </td>
        <td className="py-1.5 pr-3 text-right">
          <button
            type="button"
            className="settings-button-danger"
            title="Delete this note"
            aria-label={`Delete ${name}`}
            onClick={() => onDelete(note.id)}
          >
            <TrashIcon size={14} />
          </button>
        </td>
      </tr>
    );
  }
);
NoteRow.displayName = 'NoteRow';

export interface TrackNotesEditorProps {
  /** For stories and specs; the page hands in the preload bridge. */
  bridge: TrackProfileBridge | undefined;
  /** The track of the running session, or null with none. */
  sessionTrackKey: string | null;
  /** What the session calls its track. */
  sessionTrackName?: string;
  /**
   * Where the car is on the session's track now, metres into the lap; null
   * when that is not known. Asked when the button is pressed.
   */
  getSessionPositionM: () => number | null;
  /** The corners of the session's track, where the bundled data has them. */
  corners: readonly TrackCorner[];
}

/**
 * The notes of one track as a table: every note with where it lies, its
 * kind, its text and comment and whether it is for the pits, with the means
 * to add, change and delete them, to move them all along the lap, to start
 * from the corners of the track and to bring in and write out TinyPedal's
 * notes files.
 *
 * Every change goes to the store at once and the table shows what the store
 * kept, so the overlay and the page never disagree.
 */
export const TrackNotesEditor = ({
  bridge,
  sessionTrackKey,
  sessionTrackName,
  getSessionPositionM,
  corners,
}: TrackNotesEditorProps) => {
  const [chosen, setChosen] = useState<string | null>(null);
  const trackKey = chosen ?? sessionTrackKey;
  const editor = useTrackNotesEditor(bridge, trackKey);
  const { profile, saveNotes, importNotes, exportNotes } = editor;
  const [message, setMessage] = useState<string | null>(null);
  const [shift, setShift] = useState('');
  const [focusId, setFocusId] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // With no session running, the page opens on the track changed last.
  if (trackKey === null && editor.tracks.length > 0) {
    const [first] = editor.tracks;
    setChosen(`${first.simulator}:${first.trackId}`);
  }

  const notes = profile?.notes;
  const trackLengthM = profile?.trackLengthM ?? 0;
  const isSessionTrack = trackKey !== null && trackKey === sessionTrackKey;

  /** The notes as the store last confirmed them, for changes made in a row. */
  const confirmed = useRef<readonly TrackNote[]>([]);
  confirmed.current = notes ?? [];
  /** Changes are sent one after another, each made to what the last left. */
  const queue = useRef<Promise<unknown>>(Promise.resolve());

  const apply = useCallback(
    (
      operation: (
        current: readonly TrackNote[]
      ) => readonly TrackNoteDraft[] | null
    ): Promise<TrackNote[] | null> => {
      const run = queue.current.then(async () => {
        const next = operation(confirmed.current);
        if (next === null) return null;
        if (next.length > TRACK_NOTE_LIMIT) {
          setMessage(`A track holds at most ${TRACK_NOTE_LIMIT} notes.`);
          return null;
        }
        const kept = await saveNotes(next);
        if (kept) confirmed.current = kept;
        else setMessage('The notes could not be saved.');
        return kept;
      });
      queue.current = run.catch(() => undefined);
      return run;
    },
    [saveNotes]
  );

  const changeNote = useCallback(
    (id: string, patch: Partial<TrackNoteDraft>) => {
      setMessage(null);
      void apply((current) =>
        current.map((note) => (note.id === id ? { ...note, ...patch } : note))
      );
    },
    [apply]
  );

  const deleteNote = useCallback(
    (id: string) => {
      setMessage(null);
      void apply((current) => current.filter((note) => note.id !== id));
    },
    [apply]
  );

  const addNote = (distanceM: number) => {
    setMessage(null);
    let before = new Set<string>();
    void apply((current) => {
      before = new Set(current.map((note) => note.id));
      return [
        ...current,
        { distanceM, kind: 'track', text: '', comment: '', pit: false },
      ];
    }).then((kept) => {
      const added = kept?.find((note) => !before.has(note.id));
      if (added) setFocusId(added.id);
    });
  };

  const addAtPosition = () => {
    const positionM = getSessionPositionM();
    if (positionM === null || !(trackLengthM > 0)) {
      setMessage('Where the car is on the lap is not known yet.');
      return;
    }
    const distanceM = parseDistance(String(positionM), trackLengthM);
    if (distanceM !== null) addNote(distanceM);
  };

  const createFromCorners = () => {
    let added = 0;
    void apply((current) => {
      const drafts = notesFromCorners(corners, current, trackLengthM);
      added = drafts.length;
      return drafts.length > 0 ? [...current, ...drafts] : null;
    }).then((kept) =>
      setMessage(
        added === 0
          ? 'Every corner of this track already has a note.'
          : kept
            ? `Added ${noteCountLabel(added)} from the corners of the track.`
            : 'The notes could not be saved.'
      )
    );
  };

  const shiftAll = () => {
    const shiftM = Number(shift.trim().replace(',', '.'));
    if (shift.trim() === '' || !Number.isFinite(shiftM) || shiftM === 0) {
      setMessage('Enter how many metres to move the notes by.');
      return;
    }
    void apply((current) => shiftNotes(current, shiftM, trackLengthM)).then(
      (kept) => {
        if (!kept) return;
        setShift('');
        setMessage(
          `Moved ${noteCountLabel(kept.length)} by ${roundDistance(shiftM)} m.`
        );
      }
    );
  };

  const importFile = (file: File) => {
    file
      .text()
      .then((text) => {
        if (text.length > TRACK_NOTE_FILE_LENGTH) {
          setMessage('That file is too large to be a notes file.');
          return;
        }
        const previous = confirmed.current.length;
        const run = queue.current.then(async () => {
          const kept = await importNotes(kindOfFileName(file.name), text);
          if (kept) confirmed.current = kept;
          setMessage(
            kept
              ? `Imported ${noteCountLabel(kept.length - previous)}.`
              : `That file is not a TinyPedal notes file, or it would take the track past ${TRACK_NOTE_LIMIT} notes.`
          );
        });
        queue.current = run.catch(() => undefined);
        return run;
      })
      .catch(() => setMessage('That file could not be read.'));
  };

  const exportAll = () => {
    if (!profile) return;
    const kinds = KINDS.filter((kind) =>
      profile.notes.some((note) => note.kind === kind)
    );
    void Promise.all(
      kinds.map(async (kind) => {
        const text = await exportNotes(kind);
        if (text === null) return false;
        const url = URL.createObjectURL(
          new Blob([text], { type: 'text/csv;charset=utf-8' })
        );
        const link = document.createElement('a');
        link.href = url;
        link.download = exportFileName(profile.trackName, kind);
        link.click();
        URL.revokeObjectURL(url);
        return true;
      })
    ).then((saved) =>
      setMessage(
        saved.every(Boolean)
          ? `Exported ${saved.length === 1 ? 'one file' : `${saved.length} files, one for each kind of note`}.`
          : 'The notes could not be exported.'
      )
    );
  };

  if (!editor.available) {
    return (
      <p className="text-sm text-slate-400">
        Track notes are not available in this window.
      </p>
    );
  }

  // What the session calls its track, or what was stored of it before.
  const sessionName =
    sessionTrackName ||
    editor.tracks.find(
      (track) => `${track.simulator}:${track.trackId}` === sessionTrackKey
    )?.trackName;
  const choices = trackChoices(
    editor.tracks,
    sessionTrackKey
      ? {
          trackKey: sessionTrackKey,
          label: sessionName
            ? `${sessionName} (this session)`
            : 'The track of this session',
        }
      : null
  );

  if (choices.length === 0) {
    return (
      <div className="rounded-lg border border-slate-700 bg-slate-800/50 px-4 py-8 text-center text-sm text-slate-400">
        {editor.loading
          ? 'Loading...'
          : 'No track to write notes for yet. Join a session in iRacing or Le Mans Ultimate and its track appears here.'}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <label className="flex min-w-0 flex-1 basis-72 items-center gap-3">
          <span className="flex-none text-sm text-slate-300">Track</span>
          <select
            className="settings-field min-w-0 flex-1"
            value={trackKey ?? ''}
            onChange={(event) => {
              setMessage(null);
              setChosen(event.target.value);
            }}
          >
            {choices.map((choice) => (
              <option key={choice.trackKey} value={choice.trackKey}>
                {choice.label}
              </option>
            ))}
          </select>
        </label>
        {profile && (
          <span className="text-sm tabular-nums text-slate-400">
            {formatTrackLength(profile.trackLengthM)} ·{' '}
            {noteCountLabel(profile.notes.length)}
          </span>
        )}
      </div>

      {!profile ? (
        <p className="text-sm text-slate-400">
          {editor.loading
            ? 'Loading...'
            : 'Nothing is stored for this track any more.'}
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="settings-button-primary"
              onClick={() => addNote(0)}
            >
              <PlusIcon size={16} />
              Add note
            </button>
            <button
              type="button"
              className="settings-button"
              disabled={!isSessionTrack}
              title={
                isSessionTrack
                  ? 'A note where the car is now'
                  : 'Only on the track of the running session'
              }
              onClick={addAtPosition}
            >
              <MapPinPlusIcon size={16} />
              Add at current position
            </button>
            <button
              type="button"
              className="settings-button"
              disabled={!isSessionTrack || corners.length === 0}
              title={
                !isSessionTrack
                  ? 'Only on the track of the running session'
                  : corners.length === 0
                    ? 'There is no corner data for this track'
                    : 'One track note for each corner, where it starts'
              }
              onClick={createFromCorners}
            >
              <SignpostIcon size={16} />
              Create from corners
            </button>
            <button
              type="button"
              className="settings-button"
              onClick={() => fileInput.current?.click()}
            >
              <UploadSimpleIcon size={16} />
              Import TinyPedal file
            </button>
            <button
              type="button"
              className="settings-button"
              disabled={profile.notes.length === 0}
              onClick={exportAll}
            >
              <DownloadSimpleIcon size={16} />
              Export
            </button>
            <input
              ref={fileInput}
              type="file"
              accept=".tptn,.tppn,.csv,text/csv,text/plain"
              aria-label="TinyPedal notes file"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (file) importFile(file);
              }}
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <ArrowsHorizontalIcon size={16} className="text-slate-400" />
              Shift all by
              <input
                type="text"
                inputMode="decimal"
                className="settings-field w-24 text-right tabular-nums"
                placeholder="0"
                value={shift}
                onChange={(event) => setShift(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') shiftAll();
                }}
              />
              m
            </label>
            <button
              type="button"
              className="settings-button"
              disabled={profile.notes.length === 0}
              onClick={shiftAll}
            >
              Shift
            </button>
            {message && (
              <span role="status" className="text-sm text-slate-400">
                {message}
              </span>
            )}
          </div>

          {profile.notes.length === 0 ? (
            <div className="rounded-lg border border-slate-700 bg-slate-800/50 px-4 py-8 text-center text-sm text-slate-400">
              <MapPinIcon size={22} className="mx-auto mb-2 text-slate-500" />
              No notes for this track yet. Add one, start from the corners of
              the track, or import a TinyPedal notes file.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-slate-700 bg-slate-800/50">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                    <th className="py-2 pl-3 pr-2 font-medium">Distance, m</th>
                    <th className="py-2 pr-2 font-medium">Kind</th>
                    <th className="py-2 pr-2 font-medium">Note</th>
                    <th className="py-2 pr-2 font-medium">Comment</th>
                    <th className="py-2 pr-2 text-center font-medium">Pit</th>
                    <th className="py-2 pr-3" />
                  </tr>
                </thead>
                <tbody>
                  {profile.notes.map((note) => (
                    <NoteRow
                      key={note.id}
                      note={note}
                      trackLengthM={trackLengthM}
                      autoFocus={note.id === focusId}
                      onChange={changeNote}
                      onDelete={deleteNote}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
};
