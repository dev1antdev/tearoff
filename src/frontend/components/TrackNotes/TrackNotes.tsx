import { memo, useEffect, useState } from 'react';
import {
  IconContext,
  MapPinIcon,
  NavigationArrowIcon,
  WrenchIcon,
} from '@phosphor-icons/react';
import {
  trackStateSelectors,
  useDashboard,
  useDrivingState,
  useSessionVisibility,
  useTrackProfileSnapshot,
  useTrackStateSelector,
} from '@irdashies/context';
import {
  METRES_TO_FEET,
  isMetricDistance,
} from '@irdashies/domain/units/distance';
import type { TrackNote } from '@irdashies/types';
import { useCurrentNotes } from './hooks/useCurrentNotes';
import { useTrackNotesSettings } from './hooks/useTrackNotesSettings';
import { OVERLAY_ICONS } from '@irdashies/utils/overlayIcons';

const NO_NOTES: readonly TrackNote[] = [];
/** What the pit road line says on a track with no note written for it. */
const PIT_LANE_TEXT = 'Pit lane';
const PIT_LANE_ID = 'pit-lane';

/** A fixed pair for demo mode, which has no track to have notes for. */
const DEMO_NOTES: readonly TrackNote[] = [
  {
    id: 'demo-pace',
    distanceM: 0,
    kind: 'pace',
    text: 'Brake at the 100 board',
    comment: '',
    pit: false,
  },
  {
    id: 'demo-track',
    distanceM: 0,
    kind: 'track',
    text: 'Turn 2',
    comment: '',
    pit: false,
  },
];

/** "240 m", or feet to the ten where the driver reads feet. */
const formatNextDistance = (distanceM: number, metric: boolean): string =>
  metric
    ? `${Math.round(distanceM)} m`
    : `${Math.round((distanceM * METRES_TO_FEET) / 10) * 10} ft`;

/**
 * Whether a note is still on show: it is until it has been up for
 * `seconds`, and again as soon as another takes its place. 0 keeps a note
 * up until the next one, and `hold` keeps it up whatever the time.
 */
const useNoteShown = (
  noteId: string | null,
  seconds: number,
  hold: boolean
): boolean => {
  const [shown, setShown] = useState({ id: noteId, expired: false });
  // Another note: it starts afresh, in the same render it arrives in.
  if (shown.id !== noteId) setShown({ id: noteId, expired: false });

  useEffect(() => {
    if (noteId === null || !(seconds > 0)) return;
    const timer = window.setTimeout(
      () =>
        setShown((current) =>
          current.id === noteId ? { id: noteId, expired: true } : current
        ),
      seconds * 1000
    );
    return () => window.clearTimeout(timer);
  }, [noteId, seconds]);

  if (noteId === null) return false;
  return hold || !(seconds > 0) || shown.id !== noteId || !shown.expired;
};

type LineKind = 'pace' | 'track' | 'pit';

interface NoteLineProps {
  kind: LineKind;
  text: string;
  /** The first, or only, line: drawn large. */
  large: boolean;
  uppercase: boolean;
  /** "240 m" to the next note, or empty for none. */
  nextDistance: string;
}

const LINE_ICONS = {
  pace: NavigationArrowIcon,
  track: MapPinIcon,
  pit: WrenchIcon,
} as const;

// Neutral; sky is rain. A pit-lane note's icon takes its line's caution.
const ICON_CLASS: Record<LineKind, string> = {
  pace: 'text-slate-300',
  track: 'text-slate-400',
  pit: '',
};

/** One note on one line: its icon, its text cut short with an ellipsis. */
const NoteLine = memo(
  ({ kind, text, large, uppercase, nextDistance }: NoteLineProps) => {
    const LineIcon = LINE_ICONS[kind];
    return (
      <div
        className={`flex w-full min-w-0 items-center justify-center gap-1.5 ${
          large
            ? 'text-lg font-bold leading-tight'
            : 'text-sm leading-tight text-slate-300'
        } ${kind === 'pit' ? 'text-amber-400' : ''}`}
        data-testid={`track-notes-${kind}`}
      >
        {/* Filled: an outline is lost at this size. Sized by the line's text,
            so it follows the Font size. */}
        <LineIcon weight="fill" className={`flex-none ${ICON_CLASS[kind]}`} />
        <span className={`min-w-0 truncate ${uppercase ? 'uppercase' : ''}`}>
          {text}
        </span>
        {nextDistance !== '' && (
          <span className="flex-none pl-1 text-xs font-normal tabular-nums text-slate-400">
            {nextDistance}
          </span>
        )}
      </div>
    );
  }
);
NoteLine.displayName = 'NoteLine';

/**
 * The driver's own notes for the track, shown where each was written for.
 *
 * Up to two lines. A pace note says what is coming, and can be shown a set
 * distance and a set time early; a track note says where the car is. Each
 * stays up until the next of its kind is reached, so the last note of the
 * lap carries over the line. On pit road the notes marked for the pits take
 * their place, or "Pit lane" where there is none.
 *
 * About the track, not about one car: while a car is being watched the
 * notes are for where that car is.
 */
export const TrackNotes = () => {
  const settings = useTrackNotesSettings();
  const { isDemoMode } = useDashboard();
  const { isDriving, isWatching } = useDrivingState();
  const isSessionVisible = useSessionVisibility(settings.sessionVisibility);
  const visible =
    isSessionVisible &&
    !(settings.showOnlyWhenOnTrack && !(isDriving || isWatching));

  const profile = useTrackProfileSnapshot(visible);
  const displayUnits = useTrackStateSelector(trackStateSelectors.displayUnits, {
    enabled: visible,
  });
  const stored = profile?.notes ?? NO_NOTES;
  const notes = stored.length === 0 && isDemoMode ? DEMO_NOTES : stored;

  const current = useCurrentNotes(notes, {
    trackLengthM: profile?.trackLengthM ?? 0,
    paceLeadMeters: settings.paceLeadMeters,
    paceLeadSeconds: settings.paceLeadSeconds,
    showPitNotes: settings.showPitNotes,
    followFocusCar: isWatching && !isDriving,
    withNextDistance: settings.showNextDistance,
    enabled: visible && notes.length > 0,
  });

  // On pit road with nothing written for it, the one line says so.
  const pitLane =
    current.pit && current.pace === null && current.track === null;
  const pace = settings.showPaceNotes && !pitLane ? current.pace : null;
  const track = settings.showTrackNotes && !pitLane ? current.track : null;
  const paceId = pace && pace.text !== '' ? pace.id : null;
  const trackId = pitLane
    ? PIT_LANE_ID
    : track && track.text !== ''
      ? track.id
      : null;
  // In the garage the notes stay up however long they have been.
  const paceShown = useNoteShown(
    paceId,
    settings.displaySeconds,
    current.inGarage
  );
  const trackShown = useNoteShown(
    trackId,
    settings.displaySeconds,
    current.inGarage
  );

  if (!visible) return <></>;

  const container = (children: React.ReactNode) => (
    <div
      className="flex h-full w-full flex-col items-center justify-center gap-0.5 overflow-hidden overlay-panel p-2 text-center text-white"
      style={{
        ['--bg-opacity' as string]: `${settings.background.opacity}%`,
      }}
    >
      <IconContext.Provider value={OVERLAY_ICONS}>
        {children}
      </IconContext.Provider>
    </div>
  );

  if (notes.length === 0) {
    return settings.hideWhenNoNotes ? (
      <></>
    ) : (
      container(
        <span className="text-xs text-slate-400">No notes for this track</span>
      )
    );
  }

  const metric = isMetricDistance('auto', displayUnits);
  const showPace = paceShown && pace !== null;
  const showTrack = trackShown && (pitLane || track !== null);
  // The first line shown carries the comment and the distance to the next.
  const first = showPace ? pace : showTrack && !pitLane ? track : null;
  const firstNextM = showPace ? current.paceNextM : current.trackNextM;
  const nextDistance =
    settings.showNextDistance && first !== null && firstNextM !== null
      ? formatNextDistance(firstNextM, metric)
      : '';
  const lineKind = (kind: 'pace' | 'track'): LineKind =>
    current.pit ? 'pit' : kind;

  // Under the line it belongs to, which is the first one shown.
  const comment = settings.showComment && first && first.comment !== '' && (
    <div
      className="line-clamp-3 w-full whitespace-pre-line text-xs leading-snug text-slate-400"
      data-testid="track-notes-comment"
    >
      {first.comment}
    </div>
  );

  return container(
    <>
      {showPace && pace && (
        <NoteLine
          kind={lineKind('pace')}
          text={pace.text}
          large
          uppercase={settings.uppercase}
          nextDistance={nextDistance}
        />
      )}
      {showPace && comment}
      {showTrack && (
        <NoteLine
          kind={lineKind('track')}
          text={pitLane ? PIT_LANE_TEXT : (track?.text ?? '')}
          large={!showPace}
          uppercase={settings.uppercase}
          nextDistance={showPace ? '' : nextDistance}
        />
      )}
      {!showPace && comment}
    </>
  );
};
