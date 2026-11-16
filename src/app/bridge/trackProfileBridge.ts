import { randomUUID } from 'node:crypto';
import { BrowserWindow, ipcMain } from 'electron';
import type {
  TrackNote,
  TrackNoteKind,
  TrackProfile,
  TrackProfileDetails,
  TrackProfileKey,
  TrackSunTimes,
} from '../../types';
import {
  TRACK_NOTE_COMMENT_LENGTH,
  TRACK_NOTE_FILE_LENGTH,
  TRACK_NOTE_LIMIT,
  TRACK_NOTE_TEXT_LENGTH,
  parseTrackProfileKey,
  trackProfileKeyOf,
  trackSunMinutesOf,
} from '../../types';
import type { TrackProfileStore } from '../storage/trackProfiles';
import { defineRendererSubscriptionBridge } from './defineBridge';

/**
 * What the settings window may ask of the track profiles, over IPC: the
 * notes editor, the elevation widget's "record again", and the sunrise and
 * sunset the in-game clock counts down to.
 *
 * Nothing a renderer sends is taken as it comes. A track is named by its
 * key and by nothing else: the name, the length and the bucket count the
 * store files a track under are the store's own, or the running session's,
 * never the renderer's. No path crosses in either direction: a notes file
 * arrives as text and leaves as text. A change is announced only to the
 * windows that asked to hear of it.
 */

const CHANNELS = [
  'trackProfile:listTracks',
  'trackProfile:getProfile',
  'trackProfile:saveNotes',
  'trackProfile:importNotes',
  'trackProfile:exportNotes',
  'trackProfile:clearElevation',
  'trackProfile:saveSunTimes',
] as const;

const MAX_ID_LENGTH = 64;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const trackOrThrow = (
  value: unknown,
  channel: string
): { simulator: string; trackId: number } => {
  const track = parseTrackProfileKey(value);
  if (!track) throw new TypeError(`Invalid track for ${channel}`);
  return track;
};

const kindOrThrow = (value: unknown, channel: string): TrackNoteKind => {
  if (value !== 'track' && value !== 'pace') {
    throw new TypeError(`Invalid kind of note for ${channel}`);
  }
  return value;
};

/**
 * The notes a renderer sent, each rebuilt from the fields a note has and
 * nothing else. One without an id is new and is given one here. Anything
 * that is not a list of notes is refused whole: a table that lost a row to
 * a malformed value would lose the note with it.
 */
const notesOrThrow = (
  value: unknown,
  newId: () => string
): Record<keyof TrackNote, unknown>[] => {
  if (!Array.isArray(value) || value.length > TRACK_NOTE_LIMIT) {
    throw new TypeError('Invalid notes for trackProfile:saveNotes');
  }
  return value.map((entry: unknown) => {
    if (!isObject(entry)) {
      throw new TypeError('Invalid note for trackProfile:saveNotes');
    }
    const { id, distanceM, kind, text, comment, pit } = entry;
    if (
      (id !== undefined && typeof id !== 'string') ||
      (typeof id === 'string' && id.length > MAX_ID_LENGTH) ||
      typeof distanceM !== 'number' ||
      !Number.isFinite(distanceM) ||
      distanceM < 0 ||
      (kind !== 'track' && kind !== 'pace') ||
      typeof text !== 'string' ||
      (comment !== undefined && typeof comment !== 'string') ||
      (pit !== undefined && typeof pit !== 'boolean')
    ) {
      throw new TypeError('Invalid note for trackProfile:saveNotes');
    }
    return {
      id: typeof id === 'string' && id !== '' ? id : newId(),
      distanceM,
      kind,
      text: text.slice(0, TRACK_NOTE_TEXT_LENGTH),
      comment: (comment ?? '').slice(0, TRACK_NOTE_COMMENT_LENGTH),
      pit: pit === true,
    };
  });
};

/**
 * A sunrise or a sunset a renderer sent: a whole minute of the day, or null
 * to clear it. Anything else is refused, not rounded or clamped into one.
 */
const sunMinutesOrThrow = (value: unknown): number | null => {
  if (value === null) return null;
  const minutes = trackSunMinutesOf(value);
  if (minutes === null) {
    throw new TypeError('Invalid time for trackProfile:saveSunTimes');
  }
  return minutes;
};

/** Rebuilt from the two fields there are, whatever else was sent along. */
const sunTimesOrThrow = (value: unknown): TrackSunTimes => {
  if (!isObject(value)) {
    throw new TypeError('Invalid times for trackProfile:saveSunTimes');
  }
  return {
    sunriseMinutes: sunMinutesOrThrow(value.sunriseMinutes),
    sunsetMinutes: sunMinutesOrThrow(value.sunsetMinutes),
  };
};

const detailsOf = (profile: TrackProfile): TrackProfileDetails => ({
  trackKey: trackProfileKeyOf(profile.simulator, profile.trackId),
  simulator: profile.simulator,
  trackId: profile.trackId,
  trackName: profile.trackName,
  trackLengthM: profile.trackLengthM,
  elevationSource: profile.elevationSource,
  elevationLaps: profile.elevationLaps,
  sectorSource: profile.sectorSource,
  notes: profile.notes,
  updatedAt: profile.updatedAt,
});

const emptyDetailsOf = (key: TrackProfileKey): TrackProfileDetails => ({
  trackKey: trackProfileKeyOf(key.simulator, key.trackId),
  simulator: key.simulator,
  trackId: key.trackId,
  trackName: key.trackName,
  trackLengthM: key.trackLengthM,
  elevationSource: null,
  elevationLaps: 0,
  sectorSource: 'nominal',
  notes: [],
  updatedAt: 0,
});

export interface TrackProfileBridgeOptions {
  store: Pick<
    TrackProfileStore,
    | 'whenLoaded'
    | 'list'
    | 'saveNotes'
    | 'importNotes'
    | 'exportNotes'
    | 'clearElevation'
    | 'saveSunTimes'
    | 'onChanged'
  >;
  /**
   * The track of the running session as the recorder files it, or null with
   * none: what a track with nothing stored yet is created from.
   */
  getSessionTrackKey: () => TrackProfileKey | null;
  /** A new note's id. */
  newId?: () => string;
}

export function setupTrackProfileBridge({
  store,
  getSessionTrackKey,
  newId = randomUUID,
}: TrackProfileBridgeOptions) {
  const subscriptions = defineRendererSubscriptionBridge({
    name: 'trackProfile',
    isValidKey: (value: unknown): value is 'changed' => value === 'changed',
  });

  /** The running session's track, when it is the one named. */
  const sessionKeyFor = (track: {
    simulator: string;
    trackId: number;
  }): TrackProfileKey | null => {
    const key = getSessionTrackKey();
    return key?.simulator === track.simulator && key.trackId === track.trackId
      ? key
      : null;
  };

  /**
   * What the store files a named track under: the stored profile's own
   * particulars, or the running session's for a track with nothing stored.
   * Null for a track that is neither, which nothing can be written to.
   */
  const keyFor = async (track: {
    simulator: string;
    trackId: number;
  }): Promise<TrackProfileKey | null> => {
    const stored = await store.whenLoaded(track.simulator, track.trackId);
    return stored
      ? {
          simulator: stored.simulator,
          trackId: stored.trackId,
          trackName: stored.trackName,
          trackLengthM: stored.trackLengthM,
          pointsCount: stored.pointsCount,
        }
      : sessionKeyFor(track);
  };

  ipcMain.handle('trackProfile:listTracks', () => store.list());

  ipcMain.handle(
    'trackProfile:getProfile',
    async (_event, trackKey: unknown) => {
      const track = trackOrThrow(trackKey, 'trackProfile:getProfile');
      const stored = await store.whenLoaded(track.simulator, track.trackId);
      if (stored) return detailsOf(stored);
      const sessionKey = sessionKeyFor(track);
      return sessionKey ? emptyDetailsOf(sessionKey) : null;
    }
  );

  ipcMain.handle(
    'trackProfile:saveNotes',
    async (_event, trackKey: unknown, notes: unknown) => {
      const track = trackOrThrow(trackKey, 'trackProfile:saveNotes');
      const checked = notesOrThrow(notes, newId);
      const key = await keyFor(track);
      return key ? store.saveNotes(key, checked) : null;
    }
  );

  ipcMain.handle(
    'trackProfile:importNotes',
    async (_event, trackKey: unknown, kind: unknown, fileText: unknown) => {
      const track = trackOrThrow(trackKey, 'trackProfile:importNotes');
      const fallbackKind = kindOrThrow(kind, 'trackProfile:importNotes');
      if (
        typeof fileText !== 'string' ||
        fileText.length > TRACK_NOTE_FILE_LENGTH
      ) {
        throw new TypeError('Invalid file for trackProfile:importNotes');
      }
      const key = await keyFor(track);
      return key ? store.importNotes(key, fallbackKind, fileText) : null;
    }
  );

  ipcMain.handle(
    'trackProfile:exportNotes',
    (_event, trackKey: unknown, kind: unknown) => {
      const track = trackOrThrow(trackKey, 'trackProfile:exportNotes');
      return store.exportNotes(
        track.simulator,
        track.trackId,
        kindOrThrow(kind, 'trackProfile:exportNotes')
      );
    }
  );

  ipcMain.handle('trackProfile:clearElevation', (_event, trackKey: unknown) => {
    const track = trackOrThrow(trackKey, 'trackProfile:clearElevation');
    return store.clearElevation(track.simulator, track.trackId);
  });

  ipcMain.handle(
    'trackProfile:saveSunTimes',
    async (_event, trackKey: unknown, times: unknown) => {
      const track = trackOrThrow(trackKey, 'trackProfile:saveSunTimes');
      const checked = sunTimesOrThrow(times);
      const key = await keyFor(track);
      return key ? store.saveSunTimes(key, checked) : false;
    }
  );

  const unsubscribe = store.onChanged(() => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (
        !window.isDestroyed() &&
        subscriptions.registry.has(window.webContents.id, 'changed')
      ) {
        window.webContents.send('trackProfile:changed');
      }
    }
  });

  return () => {
    unsubscribe();
    subscriptions.dispose();
    for (const channel of CHANNELS) ipcMain.removeHandler(channel);
  };
}
