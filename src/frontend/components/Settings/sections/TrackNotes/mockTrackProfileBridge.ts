import type {
  TrackNote,
  TrackNoteDraft,
  TrackNoteKind,
  TrackProfileBridge,
  TrackProfileDetails,
  TrackProfileSummary,
  TrackSunTimes,
} from '@irdashies/types';
import { TRACK_NOTE_LIMIT } from '@irdashies/types';

/**
 * Track profiles held in memory, for stories and specs: what the settings
 * window would be talking to in the app, without the app.
 *
 * It keeps notes the way the store does (sorted, each with an id, no more
 * than the limit) but reads a notes file only in its plainest form, one
 * `distance,text` row a line: the real reader lives in the main process.
 */

const note = (
  id: string,
  distanceM: number,
  kind: TrackNoteKind,
  text: string,
  extra: Partial<TrackNote> = {}
): TrackNote => ({
  id,
  distanceM,
  kind,
  text,
  comment: '',
  pit: false,
  ...extra,
});

/** Laguna Seca under Le Mans Ultimate, with notes of every sort. */
export const lagunaSecaProfile: TrackProfileDetails = {
  trackKey: 'lmu:694510461',
  simulator: 'lmu',
  trackId: 694510461,
  trackName: 'WeatherTech Raceway Laguna Seca',
  trackLengthM: 3590.35,
  elevationSource: 'recorded',
  elevationLaps: 1,
  sectorSource: 'learned',
  notes: [
    note('n01', 62, 'track', 'Pit exit: stay right of the line', {
      pit: true,
      comment: 'Blend in after the bridge',
    }),
    note('n02', 180.5, 'pace', 'Brake at the 100 board'),
    note('n03', 285, 'track', 'Andretti Hairpin', {
      comment: 'Double apex\nLate on the power',
    }),
    note('n04', 705.2, 'pace', 'Flat through Turn 3'),
    note('n05', 1010, 'track', 'Turn 4'),
    note('n06', 1480, 'pace', 'Lift, then brake uphill'),
    note('n07', 1540, 'track', 'Turn 5'),
    note('n08', 2150, 'pace', 'Blind crest: brake at the bridge'),
    note('n09', 2390.4, 'track', 'The Corkscrew', {
      comment: 'Aim at the tree',
    }),
    note('n10', 2725, 'track', 'Rainey Curve'),
    note('n11', 3190, 'pace', 'Brake late into Turn 11'),
    note('n12', 3260, 'track', 'Turn 11'),
  ],
  updatedAt: 1_793_000_000_000,
};

/** A circuit driven under iRacing, with an elevation and no notes yet. */
export const spaProfile: TrackProfileDetails = {
  trackKey: 'iracing:163',
  simulator: 'iracing',
  trackId: 163,
  trackName: 'Circuit de Spa-Francorchamps',
  trackLengthM: 6996.3,
  elevationSource: 'integrated',
  elevationLaps: 3,
  sectorSource: 'session',
  notes: [],
  updatedAt: 1_792_000_000_000,
};

const summaryOf = (profile: TrackProfileDetails): TrackProfileSummary => ({
  simulator: profile.simulator,
  trackId: profile.trackId,
  trackName: profile.trackName,
  trackLengthM: profile.trackLengthM,
  elevationSource: profile.elevationSource,
  notes: profile.notes.length,
  updatedAt: profile.updatedAt,
});

export interface MockTrackProfileBridge extends TrackProfileBridge {
  /** The profile held for a track now, for a spec to look at. */
  peek: (trackKey: string) => TrackProfileDetails | undefined;
  /** The sunrise and sunset held for a track now; undefined with none set. */
  peekSunTimes: (trackKey: string) => TrackSunTimes | undefined;
}

export const createMockTrackProfileBridge = (
  initial: readonly TrackProfileDetails[] = [lagunaSecaProfile, spaProfile]
): MockTrackProfileBridge => {
  const profiles = new Map(
    initial.map((profile) => [
      profile.trackKey,
      { ...profile, notes: [...profile.notes] },
    ])
  );
  const sunTimes = new Map<string, TrackSunTimes>();
  const listeners = new Set<() => void>();
  let created = 0;
  let clock = 1_793_100_000_000;

  const changed = () => {
    for (const listener of listeners) listener();
  };

  const keep = (
    profile: TrackProfileDetails,
    drafts: readonly TrackNoteDraft[]
  ): TrackNote[] | null => {
    if (drafts.length > TRACK_NOTE_LIMIT) return null;
    const notes = drafts
      .filter(
        (draft) =>
          Number.isFinite(draft.distanceM) &&
          draft.distanceM >= 0 &&
          draft.distanceM < profile.trackLengthM
      )
      .map((draft) => ({
        id: draft.id || `new${(created += 1)}`,
        distanceM: draft.distanceM,
        kind: draft.kind,
        text: draft.text,
        comment: draft.comment,
        pit: draft.pit,
      }))
      .sort((a, b) => a.distanceM - b.distanceM);
    profile.notes = notes;
    profile.updatedAt = clock += 1000;
    return notes;
  };

  return {
    peek: (trackKey) => profiles.get(trackKey),
    peekSunTimes: (trackKey) => sunTimes.get(trackKey),

    listTracks: async () =>
      [...profiles.values()]
        .map(summaryOf)
        .sort((a, b) => b.updatedAt - a.updatedAt),

    getProfile: async (trackKey) => {
      const profile = profiles.get(trackKey);
      return profile ? { ...profile, notes: [...profile.notes] } : null;
    },

    saveNotes: async (trackKey, notes) => {
      const profile = profiles.get(trackKey);
      if (!profile) return null;
      const kept = keep(profile, notes);
      if (kept) changed();
      return kept && [...kept];
    },

    importNotes: async (trackKey, kind, fileText) => {
      const profile = profiles.get(trackKey);
      const lines = fileText.split(/\r?\n/);
      const headerAt = lines.findIndex((line) =>
        line.toLowerCase().startsWith('distance')
      );
      if (!profile || headerAt < 0) return null;
      const header = lines[headerAt].toLowerCase();
      const fileKind: TrackNoteKind = header.includes('pace note')
        ? 'pace'
        : header.includes('track note')
          ? 'track'
          : kind;
      const added: TrackNoteDraft[] = [];
      for (const line of lines.slice(headerAt + 1)) {
        const [distance, text = ''] = line.split(',');
        const distanceM = Number(distance);
        if (distance.trim() === '' || !Number.isFinite(distanceM)) continue;
        added.push({
          distanceM,
          kind: fileKind,
          text: text.replaceAll('"', '').trim(),
          comment: '',
          pit: line.toLowerCase().includes('#pit'),
        });
      }
      const kept = keep(profile, [...profile.notes, ...added]);
      if (kept) changed();
      return kept && [...kept];
    },

    exportNotes: async (trackKey, kind) =>
      [
        `distance,${kind} note,comment,tags`,
        ...(profiles.get(trackKey)?.notes ?? [])
          .filter((each) => each.kind === kind)
          .map(
            (each) =>
              `${each.distanceM},"${each.text}","${each.comment.replaceAll('\n', '\\n')}",${each.pit ? '"#pit"' : ''}`
          ),
        '',
      ].join('\n'),

    clearElevation: async (trackKey) => {
      const profile = profiles.get(trackKey);
      if (!profile?.elevationSource) return false;
      profile.elevationSource = null;
      profile.elevationLaps = 0;
      changed();
      return true;
    },

    saveSunTimes: async (trackKey, times) => {
      if (!profiles.has(trackKey)) return false;
      const held = sunTimes.get(trackKey);
      if (
        (held?.sunriseMinutes ?? null) === times.sunriseMinutes &&
        (held?.sunsetMinutes ?? null) === times.sunsetMinutes
      ) {
        return false;
      }
      sunTimes.set(trackKey, { ...times });
      changed();
      return true;
    },

    onChanged: (callback) => {
      listeners.add(callback);
      return () => {
        listeners.delete(callback);
      };
    },
  };
};
