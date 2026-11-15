import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  TrackNote,
  TrackNoteDraft,
  TrackNoteKind,
  TrackProfileBridge,
  TrackProfileDetails,
  TrackProfileSummary,
} from '@irdashies/types';
import logger from '@irdashies/utils/logger';

export interface TrackNotesEditorState {
  /** False where the app has no track profiles, as in the browser preview. */
  available: boolean;
  /** Every track with something stored, most recently changed first. */
  tracks: TrackProfileSummary[];
  /** The chosen track, or null while it is loading or when there is none. */
  profile: TrackProfileDetails | null;
  loading: boolean;
  /**
   * Replaces the chosen track's notes. Resolves with the notes as kept, or
   * null when they were refused.
   */
  saveNotes: (notes: readonly TrackNoteDraft[]) => Promise<TrackNote[] | null>;
  /** Adds the notes of a notes file. Null when it was refused. */
  importNotes: (
    kind: TrackNoteKind,
    fileText: string
  ) => Promise<TrackNote[] | null>;
  /** The chosen track's notes of one kind as the text of a notes file. */
  exportNotes: (kind: TrackNoteKind) => Promise<string | null>;
}

/**
 * The track profiles as the notes editor sees them: the list of tracks to
 * choose from, and the notes of the one chosen.
 *
 * Nothing is kept here that the store has not confirmed. A change is sent,
 * and what comes back replaces what the page shows; a change made elsewhere
 * (a lap recorded, a file imported) arrives the same way, through the
 * bridge's change notice.
 */
export const useTrackNotesEditor = (
  bridge: TrackProfileBridge | undefined,
  trackKey: string | null
): TrackNotesEditorState => {
  const [tracks, setTracks] = useState<TrackProfileSummary[]>([]);
  const [profile, setProfile] = useState<TrackProfileDetails | null>(null);
  const [loading, setLoading] = useState(Boolean(bridge));
  /** The track asked for last: an answer for another one is out of date. */
  const wanted = useRef(trackKey);
  wanted.current = trackKey;

  const reload = useCallback(async () => {
    if (!bridge) return;
    const key = wanted.current;
    try {
      const [nextTracks, nextProfile] = await Promise.all([
        bridge.listTracks(),
        key === null ? Promise.resolve(null) : bridge.getProfile(key),
      ]);
      setTracks(nextTracks);
      if (wanted.current === key) setProfile(nextProfile);
    } catch (error) {
      logger.warn('Could not read the track profiles', error);
    } finally {
      setLoading(false);
    }
  }, [bridge]);

  useEffect(() => {
    if (!bridge) return;
    void reload();
    return bridge.onChanged(() => void reload());
  }, [bridge, reload, trackKey]);

  // Another track was chosen: the notes on show are not its own.
  const [shownKey, setShownKey] = useState(trackKey);
  if (shownKey !== trackKey) {
    setShownKey(trackKey);
    setProfile(null);
    setLoading(Boolean(bridge) && trackKey !== null);
  }

  /** Sends a change and shows the notes that come back. */
  const change = useCallback(
    async (
      operation: (
        target: TrackProfileBridge,
        key: string
      ) => Promise<TrackNote[] | null>
    ): Promise<TrackNote[] | null> => {
      const key = wanted.current;
      if (!bridge || key === null) return null;
      try {
        const notes = await operation(bridge, key);
        if (notes && wanted.current === key) {
          setProfile((current) =>
            current?.trackKey === key ? { ...current, notes } : current
          );
        }
        return notes;
      } catch (error) {
        logger.warn('The track profiles refused a change', error);
        return null;
      }
    },
    [bridge]
  );

  return {
    available: Boolean(bridge),
    tracks,
    profile: profile?.trackKey === trackKey ? profile : null,
    loading,
    saveNotes: useCallback(
      (notes: readonly TrackNoteDraft[]) =>
        change((target, key) => target.saveNotes(key, notes)),
      [change]
    ),
    importNotes: useCallback(
      (kind: TrackNoteKind, fileText: string) =>
        change((target, key) => target.importNotes(key, kind, fileText)),
      [change]
    ),
    exportNotes: useCallback(
      async (kind: TrackNoteKind) => {
        const key = wanted.current;
        if (!bridge || key === null) return null;
        try {
          return await bridge.exportNotes(key, kind);
        } catch (error) {
          logger.warn('Could not export the track notes', error);
          return null;
        }
      },
      [bridge]
    ),
  };
};
