import type { ActiveSimulator } from '../../types';
import type { LmuRestTransport } from '../lmu/rest/poller';
import { trackFolderFromSummary } from '../lmu/setupLibrary/parse';
import logger from '../logger';

/**
 * Copies the library's setups for the session's track into the game while
 * Le Mans Ultimate is being played.
 *
 * The track comes from LMU's own REST answer (`/rest/garage/summary`,
 * `currentTrackFolder`), so no name mapping lives in Tearoff. Nothing runs
 * for a tape, a replay or demo mode: the connected-simulator signal never
 * counts them.
 */

export const LMU_SETUP_SYNC_INTERVAL_MS = 10_000;

const errorCode = (error: unknown): string =>
  (error as NodeJS.ErrnoException)?.code ?? 'UNKNOWN';

/**
 * The track folder LMU reports, null when it reports none or refuses the
 * request, and 'unreachable' when its REST API did not answer.
 */
export const readSessionTrackFolder = async (
  transport: LmuRestTransport
): Promise<string | null | 'unreachable'> => {
  const response = await transport('/rest/garage/summary');
  if (response.ok) return trackFolderFromSummary(response.body);
  if (response.reason === 'status') return null;
  return 'unreachable';
};

export interface LmuSetupAutoInstallDeps {
  onConnectedSimulatorChanged: (
    callback: (simulator: ActiveSimulator | undefined) => void
  ) => () => void;
  readTrackFolder: () => Promise<string | null | 'unreachable'>;
  /** Installs the library's setups for a track folder into the game. */
  syncTrack: (trackFolder: string) => Promise<unknown>;
  isEnabled: () => boolean;
  intervalMs?: number;
}

export interface LmuSetupAutoInstallStatus {
  lmuConnected: boolean;
  sessionTrackFolder: string | null;
  restReachable: boolean | null;
}

export interface LmuSetupAutoInstall {
  setEnabled: (enabled: boolean) => void;
  status: () => LmuSetupAutoInstallStatus;
  dispose: () => void;
}

export function createLmuSetupAutoInstall(
  deps: LmuSetupAutoInstallDeps
): LmuSetupAutoInstall {
  const intervalMs = deps.intervalMs ?? LMU_SETUP_SYNC_INTERVAL_MS;

  let connected = false;
  let enabled = deps.isEnabled();
  let running = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  let inFlight = false;
  /**
   * Bumped whenever the loop stops (disconnect, disable, dispose). A tick
   * still waiting on LMU's REST answer is then stale: it must not enqueue a
   * write after the loop stopped, which at quit would start work after the
   * library's queue was drained.
   */
  let generation = 0;
  let sessionTrackFolder: string | null = null;
  let restReachable: boolean | null = null;
  let unreachableLogged = false;

  const tick = async (): Promise<void> => {
    if (inFlight) return;
    const run = generation;
    inFlight = true;
    try {
      const folder = await deps.readTrackFolder();
      if (run !== generation) return;
      if (folder === 'unreachable') {
        restReachable = false;
        sessionTrackFolder = null;
        if (!unreachableLogged) {
          unreachableLogged = true;
          logger.info(
            '[Setups] Le Mans Ultimate did not answer its REST API, so nothing is installed automatically'
          );
        }
        return;
      }
      restReachable = true;
      unreachableLogged = false;
      if (folder === null) {
        sessionTrackFolder = null;
        return;
      }
      if (folder !== sessionTrackFolder) {
        logger.info(
          `[Setups] Le Mans Ultimate reports the track folder ${folder}`
        );
      }
      sessionTrackFolder = folder;
      await deps.syncTrack(folder);
    } catch (error) {
      // The error's message may name a file; only its code is logged.
      logger.warn('[Setups] Automatic install failed', errorCode(error));
    } finally {
      inFlight = false;
    }
  };

  const stop = (): void => {
    generation += 1;
    if (timer !== undefined) clearInterval(timer);
    timer = undefined;
    running = false;
    sessionTrackFolder = null;
    restReachable = null;
    unreachableLogged = false;
  };

  const start = (): void => {
    if (running) return;
    running = true;
    void tick();
    timer = setInterval(() => void tick(), intervalMs);
  };

  const apply = (): void => {
    if (connected && enabled) start();
    else stop();
  };

  const unsubscribe = deps.onConnectedSimulatorChanged((simulator) => {
    connected = simulator === 'lmu';
    apply();
  });

  return {
    setEnabled(next) {
      enabled = next;
      apply();
    },

    status: () => ({
      lmuConnected: connected,
      sessionTrackFolder,
      restReachable,
    }),

    dispose() {
      unsubscribe();
      stop();
    },
  };
}
