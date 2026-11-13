import { memo, useCallback, useEffect, useState } from 'react';
import {
  CaretDownIcon,
  CaretRightIcon,
  PushPinIcon,
  PushPinSlashIcon,
  StarIcon,
  TrashIcon,
} from '@phosphor-icons/react';
import type {
  LapLibraryBridge,
  LapLibraryLap,
  LapLibrarySession,
} from '@irdashies/types';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import {
  formatConsumption,
  formatGap,
  formatLapTime,
  formatSessionStart,
  lapCountLabel,
  lapFlags,
  simulatorLabel,
  trackLabel,
  type LapFlagTone,
} from './lapLibraryDisplay';
import { useLapLibrary } from './useLapLibrary';

const FLAG_TONE_CLASS: Record<LapFlagTone, string> = {
  neutral: 'bg-slate-700 text-slate-300',
  warning: 'bg-amber-500/20 text-amber-300',
  bad: 'bg-red-500/20 text-red-300',
};

interface LapRowProps {
  lap: LapLibraryLap;
  /** The quickest complete lap of the session, to measure the others by. */
  best: number | null;
  onPin: (lapId: number) => void;
  onUnpin: (lapId: number) => void;
  onDelete: (lap: LapLibraryLap) => void;
}

const LapRow = memo(({ lap, best, onPin, onUnpin, onDelete }: LapRowProps) => {
  const isBest = lap.complete && best !== null && lap.lapTime === best;
  const number = lap.lapNumber ?? '-';
  return (
    <tr className="border-t border-slate-700/60">
      <td className="py-1.5 pl-4 pr-2 text-slate-400 tabular-nums">{number}</td>
      <td
        className={`py-1.5 pr-3 tabular-nums ${isBest ? 'font-semibold text-white' : 'text-slate-200'}`}
      >
        <span className="inline-flex items-center gap-1.5">
          {formatLapTime(lap.lapTime)}
          {lap.isReference && (
            <StarIcon
              weight="fill"
              className="text-amber-300"
              aria-label={
                lap.isPinned
                  ? 'Pinned as the all-time reference'
                  : 'The all-time reference'
              }
            />
          )}
        </span>
      </td>
      <td className="py-1.5 pr-3 text-slate-400 tabular-nums">
        {lap.complete ? formatGap(lap.lapTime, best) : ''}
      </td>
      <td className="py-1.5 pr-3">
        <span className="flex flex-wrap gap-1">
          {lapFlags(lap).map((flag) => (
            <span
              key={flag.label}
              title={flag.hint}
              className={`rounded px-1.5 py-0.5 text-xs ${FLAG_TONE_CLASS[flag.tone]}`}
            >
              {flag.label}
            </span>
          ))}
        </span>
      </td>
      <td className="py-1.5 pr-3 text-right text-slate-400 tabular-nums">
        {formatConsumption(lap)}
      </td>
      <td className="py-1.5 pr-3">
        <span className="flex justify-end gap-1">
          {lap.complete &&
            (lap.isPinned ? (
              <button
                type="button"
                className="settings-button"
                title="Unpin: go back to the quickest clean lap as the reference"
                aria-label={`Unpin lap ${number}`}
                onClick={() => onUnpin(lap.id)}
              >
                <PushPinSlashIcon size={14} />
              </button>
            ) : (
              <button
                type="button"
                className="settings-button"
                title="Pin as the all-time reference for this track and car"
                aria-label={`Pin lap ${number} as the reference`}
                onClick={() => onPin(lap.id)}
              >
                <PushPinIcon size={14} />
              </button>
            ))}
          <button
            type="button"
            className="settings-button-danger"
            title="Delete this lap"
            aria-label={`Delete lap ${number}`}
            onClick={() => onDelete(lap)}
          >
            <TrashIcon size={14} />
          </button>
        </span>
      </td>
    </tr>
  );
});
LapRow.displayName = 'LapRow';

interface SessionCardProps {
  session: LapLibrarySession;
  /** Undefined while closed, and while the laps are still loading. */
  laps: LapLibraryLap[] | undefined;
  expanded: boolean;
  onToggle: (sessionId: number) => void;
  onPin: (lapId: number) => void;
  onUnpin: (lapId: number) => void;
  onDeleteLap: (lap: LapLibraryLap) => void;
  onDeleteSession: (session: LapLibrarySession) => void;
}

const SessionCard = memo(
  ({
    session,
    laps,
    expanded,
    onToggle,
    onPin,
    onUnpin,
    onDeleteLap,
    onDeleteSession,
  }: SessionCardProps) => {
    const Caret = expanded ? CaretDownIcon : CaretRightIcon;
    return (
      <section className="overflow-hidden rounded-lg border border-slate-700 bg-slate-800/50">
        <div className="flex items-center gap-2 px-3 py-2.5">
          <button
            type="button"
            className="flex min-w-0 flex-1 items-center gap-3 text-left"
            aria-expanded={expanded}
            onClick={() => onToggle(session.id)}
          >
            <Caret size={14} className="flex-none text-slate-400" />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium text-white">
                {trackLabel(session)}
              </span>
              <span className="block truncate text-sm text-slate-400">
                {[
                  session.carName || session.carKey,
                  session.sessionType,
                  simulatorLabel(session.simulator),
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </span>
            <span className="flex-none text-right text-sm">
              <span className="block text-slate-300">
                {formatSessionStart(session.startedAt)}
              </span>
              <span className="block text-slate-400 tabular-nums">
                {lapCountLabel(session.lapCount)}
                {session.bestLapTime !== null &&
                  ` · best ${formatLapTime(session.bestLapTime)}`}
              </span>
            </span>
          </button>
          <button
            type="button"
            className="settings-button-danger flex-none"
            title="Delete this session and every lap in it"
            aria-label={`Delete the session at ${trackLabel(session)}`}
            onClick={() => onDeleteSession(session)}
          >
            <TrashIcon size={14} />
          </button>
        </div>
        {expanded &&
          (laps === undefined ? (
            <div className="border-t border-slate-700 px-4 py-3 text-sm text-slate-400">
              Loading laps...
            </div>
          ) : (
            <table className="w-full border-t border-slate-700 text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="py-1.5 pl-4 pr-2 font-medium">Lap</th>
                  <th className="py-1.5 pr-3 font-medium">Time</th>
                  <th className="py-1.5 pr-3 font-medium">Gap</th>
                  <th className="py-1.5 pr-3 font-medium">Notes</th>
                  <th className="py-1.5 pr-3 text-right font-medium">Used</th>
                  <th className="py-1.5 pr-3" />
                </tr>
              </thead>
              <tbody>
                {laps.map((lap) => (
                  <LapRow
                    key={lap.id}
                    lap={lap}
                    best={session.bestLapTime}
                    onPin={onPin}
                    onUnpin={onUnpin}
                    onDelete={onDeleteLap}
                  />
                ))}
              </tbody>
            </table>
          ))}
      </section>
    );
  }
);
SessionCard.displayName = 'SessionCard';

type PendingDelete =
  | { kind: 'lap'; id: number; title: string; message: string }
  | { kind: 'session'; id: number; title: string; message: string };

interface LapLibrarySettingsProps {
  /** For stories and specs; the app uses the preload bridge. */
  bridge?: LapLibraryBridge;
  /** Sessions shown open from the start. The page opens none by itself. */
  initiallyExpanded?: readonly number[];
}

/**
 * The lap library: every lap the player has completed, grouped by session,
 * with the means to delete them and to choose which one the Lap Delta
 * widget measures against.
 */
export const LapLibrarySettings = ({
  bridge,
  initiallyExpanded,
}: LapLibrarySettingsProps) => {
  const library = useLapLibrary(bridge ?? window.lapLibraryBridge);
  // Read once: what is open after the first render is the page's own state.
  const [openAtStart] = useState<readonly number[]>(() => [
    ...(initiallyExpanded ?? []),
  ]);
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(
    () => new Set(openAtStart)
  );
  const [pending, setPending] = useState<PendingDelete | null>(null);
  const { openSession, closeSession } = library;

  useEffect(() => {
    for (const sessionId of openAtStart) openSession(sessionId);
  }, [openAtStart, openSession]);

  const toggle = useCallback(
    (sessionId: number) => {
      setExpanded((previous) => {
        const next = new Set(previous);
        if (next.has(sessionId)) {
          next.delete(sessionId);
          closeSession(sessionId);
        } else {
          next.add(sessionId);
          openSession(sessionId);
        }
        return next;
      });
    },
    [openSession, closeSession]
  );

  const askDeleteLap = useCallback((lap: LapLibraryLap) => {
    setPending({
      kind: 'lap',
      id: lap.id,
      title: 'Delete Lap',
      message: `Delete the ${formatLapTime(lap.lapTime)} lap? This cannot be undone.${
        lap.isReference
          ? ' It is the all-time reference for this track and car; the next quickest clean lap will take its place.'
          : ''
      }`,
    });
  }, []);

  const askDeleteSession = useCallback((session: LapLibrarySession) => {
    setPending({
      kind: 'session',
      id: session.id,
      title: 'Delete Session',
      message: `Delete the session at ${trackLabel(session)} from ${formatSessionStart(session.startedAt)}, with its ${lapCountLabel(session.lapCount)}? This cannot be undone.`,
    });
  }, []);

  const confirmDelete = () => {
    if (!pending) return;
    if (pending.kind === 'lap') void library.deleteLap(pending.id);
    else void library.deleteSession(pending.id);
    setPending(null);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex-none border-b border-slate-700 px-1 pb-5 pt-1">
        <h2 className="mb-1 text-xl font-semibold tracking-tight text-white">
          Laps
        </h2>
        <p className="text-slate-400">
          Every lap you complete, grouped by the session it was driven in. The
          Lap Delta widget measures against the lap marked with a star: the
          quickest clean lap for the track and car, unless you pin another.
        </p>
        {library.stats && library.stats.laps > 0 && (
          <p className="mt-2 text-sm text-slate-500 tabular-nums">
            {library.stats.sessions}{' '}
            {library.stats.sessions === 1 ? 'session' : 'sessions'} ·{' '}
            {lapCountLabel(library.stats.laps)}
          </p>
        )}
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1 pt-5 [scrollbar-gutter:stable]">
        {!library.available ? (
          <p className="px-1 text-slate-400">
            The lap library is not available in this window.
          </p>
        ) : library.loading ? (
          <p className="px-1 text-slate-400">Loading...</p>
        ) : library.sessions.length === 0 ? (
          <div className="rounded-lg border border-slate-700 bg-slate-800/50 px-4 py-8 text-center text-slate-400">
            No laps recorded yet. A lap is kept once you have driven it from the
            line to the line, in iRacing or Le Mans Ultimate.
          </div>
        ) : (
          library.sessions.map((session) => (
            <SessionCard
              key={session.id}
              session={session}
              laps={library.lapsBySession.get(session.id)}
              expanded={expanded.has(session.id)}
              onToggle={toggle}
              onPin={library.pinReference}
              onUnpin={library.unpinReference}
              onDeleteLap={askDeleteLap}
              onDeleteSession={askDeleteSession}
            />
          ))
        )}
      </div>

      <ConfirmDialog
        isOpen={pending !== null}
        title={pending?.title ?? ''}
        message={pending?.message ?? ''}
        confirmText="Delete"
        cancelText="Keep"
        onConfirm={confirmDelete}
        onCancel={() => setPending(null)}
        variant="danger"
      />
    </div>
  );
};
