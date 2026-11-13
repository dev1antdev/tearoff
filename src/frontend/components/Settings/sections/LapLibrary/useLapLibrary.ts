import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  LapLibraryBridge,
  LapLibraryLap,
  LapLibrarySession,
  LapLibraryStats,
} from '@irdashies/types';
import logger from '@irdashies/utils/logger';

export interface LapLibraryState {
  /** False where the app has no lap library, as in the browser preview. */
  available: boolean;
  loading: boolean;
  sessions: LapLibrarySession[];
  stats: LapLibraryStats | null;
  /** The laps of each session that has been opened, by session id. */
  lapsBySession: ReadonlyMap<number, LapLibraryLap[]>;
  /** Loads a session's laps and keeps them fresh while the page is open. */
  openSession: (sessionId: number) => void;
  closeSession: (sessionId: number) => void;
  deleteLap: (lapId: number) => Promise<void>;
  deleteSession: (sessionId: number) => Promise<void>;
  pinReference: (lapId: number) => Promise<void>;
  unpinReference: (lapId: number) => Promise<void>;
}

/**
 * The lap library as the settings page sees it: the session list, the laps
 * of whichever sessions are open, and the changes the page can make.
 *
 * Everything is reloaded when the library says it changed -- a lap recorded
 * while the page is open appears without a refresh, and a delete or a pin is
 * shown as the library has it rather than as the page guessed.
 */
export const useLapLibrary = (
  bridge: LapLibraryBridge | undefined = window.lapLibraryBridge
): LapLibraryState => {
  const [sessions, setSessions] = useState<LapLibrarySession[]>([]);
  const [stats, setStats] = useState<LapLibraryStats | null>(null);
  const [loading, setLoading] = useState(Boolean(bridge));
  const [lapsBySession, setLapsBySession] = useState<
    ReadonlyMap<number, LapLibraryLap[]>
  >(new Map());
  /** Which sessions are open, read by reloads that outlive a render. */
  const openIds = useRef(new Set<number>());

  const loadLaps = useCallback(
    async (sessionId: number) => {
      if (!bridge) return;
      const laps = await bridge.listLaps(sessionId);
      // Closed while the request was in flight: nothing to show them in.
      if (!openIds.current.has(sessionId)) return;
      setLapsBySession((previous) => new Map(previous).set(sessionId, laps));
    },
    [bridge]
  );

  const reload = useCallback(async () => {
    if (!bridge) return;
    try {
      const [nextSessions, nextStats] = await Promise.all([
        bridge.listSessions(),
        bridge.getStats(),
      ]);
      setSessions(nextSessions);
      setStats(nextStats);
      // A session that is gone takes its open state with it.
      const present = new Set(nextSessions.map((session) => session.id));
      for (const id of [...openIds.current]) {
        if (!present.has(id)) openIds.current.delete(id);
      }
      setLapsBySession(
        (previous) =>
          new Map([...previous].filter(([id]) => openIds.current.has(id)))
      );
      await Promise.all([...openIds.current].map(loadLaps));
    } catch (error) {
      logger.warn('Could not read the lap library', error);
    } finally {
      setLoading(false);
    }
  }, [bridge, loadLaps]);

  useEffect(() => {
    if (!bridge) return;
    void reload();
    return bridge.onChanged(() => void reload());
  }, [bridge, reload]);

  const openSession = useCallback(
    (sessionId: number) => {
      openIds.current.add(sessionId);
      loadLaps(sessionId).catch((error: unknown) =>
        logger.warn('Could not read a session from the lap library', error)
      );
    },
    [loadLaps]
  );

  const closeSession = useCallback((sessionId: number) => {
    openIds.current.delete(sessionId);
    setLapsBySession((previous) => {
      const next = new Map(previous);
      next.delete(sessionId);
      return next;
    });
  }, []);

  /** Runs a change. The library announces it and the page reloads from that. */
  const change = useCallback(
    async (operation: (target: LapLibraryBridge) => Promise<boolean>) => {
      if (!bridge) return;
      try {
        await operation(bridge);
      } catch (error) {
        logger.warn('The lap library refused a change', error);
      }
    },
    [bridge]
  );

  return {
    available: Boolean(bridge),
    loading,
    sessions,
    stats,
    lapsBySession,
    openSession,
    closeSession,
    deleteLap: useCallback(
      (lapId: number) => change((target) => target.deleteLap(lapId)),
      [change]
    ),
    deleteSession: useCallback(
      (sessionId: number) =>
        change((target) => target.deleteSession(sessionId)),
      [change]
    ),
    pinReference: useCallback(
      (lapId: number) => change((target) => target.pinReference(lapId)),
      [change]
    ),
    unpinReference: useCallback(
      (lapId: number) => change((target) => target.unpinReference(lapId)),
      [change]
    ),
  };
};
