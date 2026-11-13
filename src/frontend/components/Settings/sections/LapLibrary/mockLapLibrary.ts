import type {
  LapLibraryBridge,
  LapLibraryLap,
  LapLibrarySession,
} from '@irdashies/types';

/**
 * A lap library held in memory, for stories and specs. It behaves like the
 * real one where the page can tell: deleting the last lap removes its
 * session, a pin moves the reference, and every change is announced.
 */

const lap = (
  id: number,
  sessionId: number,
  lapNumber: number,
  lapTime: number,
  overrides: Partial<LapLibraryLap> = {}
): LapLibraryLap => {
  const merged = {
    id,
    sessionId,
    lapNumber,
    lapTime,
    completedAt: Date.UTC(2026, 10, 13, 16, 0, 0) + id * 100_000,
    complete: true,
    pit: false,
    voided: false,
    own: true,
    incidents: 0 as number | null,
    fuelUsed: null as number | null,
    energyUsed: null as number | null,
    airTemp: 21,
    trackTemp: 30,
    isReference: false,
    isPinned: false,
    ...overrides,
  };
  return {
    ...merged,
    eligible:
      merged.complete &&
      !merged.pit &&
      !merged.voided &&
      merged.own &&
      (merged.incidents === null || merged.incidents === 0),
  };
};

export const SAMPLE_SESSIONS: LapLibrarySession[] = [
  {
    id: 3,
    simulator: 'lmu',
    startedAt: Date.UTC(2026, 10, 13, 19, 12),
    trackId: 694510461,
    trackName: 'WeatherTech Raceway Laguna Seca',
    trackConfig: null,
    trackLengthM: 3590,
    carKey: 'Ferrari 296 LMGT3 Evo',
    carName: 'Kessel Racing #74',
    sessionType: 'Race',
    sessionName: 'Race',
    lapCount: 6,
    bestLapTime: 86.216,
  },
  {
    id: 2,
    simulator: 'lmu',
    startedAt: Date.UTC(2026, 10, 13, 18, 40),
    trackId: 694510461,
    trackName: 'WeatherTech Raceway Laguna Seca',
    trackConfig: null,
    trackLengthM: 3590,
    carKey: 'Ferrari 296 LMGT3 Evo',
    carName: 'Kessel Racing #74',
    sessionType: 'Practice',
    sessionName: 'Practice',
    lapCount: 3,
    bestLapTime: 86.671,
  },
  {
    id: 1,
    simulator: 'iracing',
    startedAt: Date.UTC(2026, 10, 11, 20, 5),
    trackId: 18,
    trackName: 'Road America',
    trackConfig: 'Full Course',
    trackLengthM: 6413,
    carKey: 'bmwm4gt3',
    carName: 'BMW M4 GT3',
    sessionType: 'Race',
    sessionName: 'RACE',
    lapCount: 3,
    bestLapTime: 129.284,
  },
];

export const SAMPLE_LAPS: LapLibraryLap[] = [
  lap(31, 3, 1, 88.934, { energyUsed: 0.0241, pit: true }),
  lap(32, 3, 2, 86.512, { energyUsed: 0.0228 }),
  lap(33, 3, 3, 86.216, { energyUsed: 0.0231, isReference: true }),
  lap(34, 3, 4, 85.902, { energyUsed: 0.0236, voided: true }),
  lap(35, 3, 5, 86.744, { energyUsed: 0.0225 }),
  lap(36, 3, 6, 91.305, { energyUsed: 0.0219, complete: false }),
  lap(21, 2, 1, 87.42, { energyUsed: 0.0233 }),
  lap(22, 2, 2, 86.671, { energyUsed: 0.0229 }),
  lap(23, 2, 3, 87.015, { energyUsed: 0.0227, own: false }),
  lap(11, 1, 2, 139.735, { fuelUsed: 3.41, incidents: 1 }),
  lap(12, 1, 3, 131.301, { fuelUsed: 3.36, isReference: true }),
  lap(13, 1, 4, 129.284, { fuelUsed: 3.39, incidents: 2 }),
];

export const createMockLapLibrary = (
  initialSessions: readonly LapLibrarySession[] = SAMPLE_SESSIONS,
  initialLaps: readonly LapLibraryLap[] = SAMPLE_LAPS
): LapLibraryBridge => {
  let sessions = [...initialSessions];
  let laps = [...initialLaps];
  const listeners = new Set<() => void>();
  const emit = () => {
    for (const listener of listeners) listener();
  };

  /** The laps sharing a lap's track and car, across sessions. */
  const peersOf = (target: LapLibraryLap): LapLibraryLap[] => {
    const session = sessions.find((entry) => entry.id === target.sessionId);
    if (!session) return [];
    const sessionIds = new Set(
      sessions
        .filter(
          (entry) =>
            entry.simulator === session.simulator &&
            entry.trackId === session.trackId &&
            entry.carKey === session.carKey
        )
        .map((entry) => entry.id)
    );
    return laps.filter((entry) => sessionIds.has(entry.sessionId));
  };

  /** Re-marks the reference among a group of laps: pinned, else quickest. */
  const markReference = (group: LapLibraryLap[]) => {
    const pinned = group.find((entry) => entry.isPinned);
    const quickest = group
      .filter((entry) => entry.eligible)
      .sort((a, b) => a.lapTime - b.lapTime)[0];
    const reference = pinned ?? quickest;
    const ids = new Set(group.map((entry) => entry.id));
    laps = laps.map((entry) =>
      ids.has(entry.id)
        ? { ...entry, isReference: entry.id === reference?.id }
        : entry
    );
  };

  const refreshCounts = () => {
    sessions = sessions
      .map((session) => {
        const own = laps.filter((entry) => entry.sessionId === session.id);
        const complete = own.filter((entry) => entry.complete);
        return {
          ...session,
          lapCount: own.length,
          bestLapTime: complete.length
            ? Math.min(...complete.map((entry) => entry.lapTime))
            : null,
        };
      })
      .filter((session) => session.lapCount > 0);
  };

  return {
    listSessions: (limit = 200, offset = 0) =>
      Promise.resolve(sessions.slice(offset, offset + limit)),
    listLaps: (sessionId) =>
      Promise.resolve(laps.filter((entry) => entry.sessionId === sessionId)),
    deleteLap: (lapId) => {
      const target = laps.find((entry) => entry.id === lapId);
      if (!target) return Promise.resolve(false);
      const group = peersOf(target).filter((entry) => entry.id !== lapId);
      laps = laps.filter((entry) => entry.id !== lapId);
      markReference(group);
      refreshCounts();
      emit();
      return Promise.resolve(true);
    },
    deleteSession: (sessionId) => {
      const target = laps.find((entry) => entry.sessionId === sessionId);
      if (!sessions.some((session) => session.id === sessionId)) {
        return Promise.resolve(false);
      }
      const group = target
        ? peersOf(target).filter((entry) => entry.sessionId !== sessionId)
        : [];
      laps = laps.filter((entry) => entry.sessionId !== sessionId);
      sessions = sessions.filter((session) => session.id !== sessionId);
      markReference(group);
      emit();
      return Promise.resolve(true);
    },
    pinReference: (lapId) => {
      const target = laps.find((entry) => entry.id === lapId);
      if (!target || !target.complete) return Promise.resolve(false);
      const ids = new Set(peersOf(target).map((entry) => entry.id));
      laps = laps.map((entry) =>
        ids.has(entry.id) ? { ...entry, isPinned: entry.id === lapId } : entry
      );
      markReference(laps.filter((entry) => ids.has(entry.id)));
      emit();
      return Promise.resolve(true);
    },
    unpinReference: (lapId) => {
      const target = laps.find((entry) => entry.id === lapId);
      if (!target) return Promise.resolve(false);
      const ids = new Set(peersOf(target).map((entry) => entry.id));
      const hadPin = laps.some((entry) => ids.has(entry.id) && entry.isPinned);
      laps = laps.map((entry) =>
        ids.has(entry.id) ? { ...entry, isPinned: false } : entry
      );
      markReference(laps.filter((entry) => ids.has(entry.id)));
      if (hadPin) emit();
      return Promise.resolve(hadPin);
    },
    getStats: () =>
      Promise.resolve({ sessions: sessions.length, laps: laps.length }),
    onChanged: (callback) => {
      listeners.add(callback);
      return () => {
        listeners.delete(callback);
      };
    },
  };
};
