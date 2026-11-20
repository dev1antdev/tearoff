/**
 * Main Rejoin Indicator Component
 * Displays a widget showing the gap to the car behind and if its safe to rejoin, need to exercise caution or you should not rejoin until the car has passed
 * Hidden until player is at a user defined speed (Default 30) and not in the pit lane. The gap thresholds are user configured as well
 */

import {
  useTrackStateSnapshot,
  useFocusCarIdx,
  useDrivingState,
  useSessionVisibility,
  useDashboard,
} from '@irdashies/context';
import { useDriverRelatives, type Standings } from '@irdashies/domain';
import { useRejoinSettings } from './hooks/useRejoinSettings';
import { getDemoRejoinData } from './demoData';
import { speedFromMs } from '@irdashies/utils/units';
import {
  stateOf,
  type RejoinState,
} from '@irdashies/domain/traffic/pitExitTraffic';
import { REJOIN_LOOK } from '../shared/rejoinLook';

export const RejoinIndicator = () => {
  const { isDemoMode } = useDashboard();
  const settings = useRejoinSettings();

  // Must call all hooks in same order every render
  const isSessionVisible = useSessionVisibility(
    settings?.config?.sessionVisibility
  );
  const playerIndex = useFocusCarIdx();
  const trackState = useTrackStateSnapshot();
  const playerInPitStall = trackState?.playerCarInPitStall ?? false;
  const carIdxOnPitRoad = trackState?.carIdxOnPitRoad ?? [];
  const carSpeedForPlayer = trackState?.speed;
  const sessionTime = trackState?.sessionTime ?? 0;
  const sessionState = trackState?.sessionState ?? 0;
  const { isDriving } = useDrivingState();
  const drivers = useDriverRelatives({ buffer: 3 });

  // Generate demo data when in demo mode
  if (isDemoMode) {
    const demoData = getDemoRejoinData(settings);
    return <RejoinIndicatorDisplay gap={demoData.gap} state={demoData.state} />;
  }

  // If we don't have dashboard settings or no focused player, hide
  if (!settings) return null;
  if (!settings.enabled) return null;
  if (playerIndex === undefined) return null;

  if (!isSessionVisible) return null;

  if (!isDriving) return null;
  // Choose the first car behind the player that is not in the pit lane or off-track
  let carBehind: Standings | undefined = undefined;
  let behindList: Standings[];
  if (drivers && drivers.length) {
    const playerArrIndex = drivers.findIndex((d) => d.carIdx === playerIndex);
    if (playerArrIndex >= 0) {
      behindList = drivers.slice(playerArrIndex + 1);
      // Prefer the nearest car that is explicitly on-track (onTrack !== false) and not on pit road.
      // This skips pit-road/off-track cars and uses the next on-track car further back if present.
      const candidate = behindList.find(
        (d) => d.onTrack !== false && !d.onPitRoad
      );

      // If we found a non-pit, on-track car behind the player, use it.
      // Otherwise, set carBehind to undefined so we don't fall back to a pit car.
      if (candidate) {
        carBehind = candidate;
      } else {
        carBehind = undefined;
      }
    }
  }

  // Read telemetry and computed car speed for the focused car index
  const speedKmH = speedFromMs(carSpeedForPlayer ?? 0, 'km/h');

  const gap = Math.abs(carBehind?.delta ?? Number.POSITIVE_INFINITY);
  const gapLabel = Number.isFinite(gap) ? gap.toFixed(1) : '--';

  const state = stateOf(
    Number.isFinite(gap) ? gap : undefined,
    settings.config.careGap,
    settings.config.stopGap
  );

  // Player on pit road uses previously read telemetry
  const playerOnPitRoad =
    playerIndex !== undefined ? !!carIdxOnPitRoad?.[playerIndex] : false;

  // Decide visibility based on configured speed (km/h)
  const isHiddenBySpeed = speedKmH > settings.config.showAtSpeed;

  // Decide visibility based on player location (garage / pit stall / on pit road)
  const isHiddenByLocation = playerInPitStall || playerOnPitRoad;

  // Decide visibility when there is no valid on-track car behind
  const isHiddenByNoCarBehind = !Number.isFinite(gap);

  // Hide during standing start: pre-race session states (< 4) or session time < 3 seconds during racing
  // SessionState 2 = WarmUp/ParadeLaps (pre-race), 3 = GetInCar (unlikely), 4 = Racing
  const isHiddenBySessionStart =
    sessionState < 4 || (sessionState === 4 && sessionTime < 3);

  if (isHiddenBySpeed) return null;
  if (isHiddenByLocation) return null;
  if (isHiddenByNoCarBehind) return null;
  if (isHiddenBySessionStart) return null;

  return <RejoinIndicatorDisplay gap={`${gapLabel}s`} state={state} />;
};

const REJOIN_WORD: Record<RejoinState, string> = {
  clear: 'Clear',
  caution: 'Caution',
  danger: 'Do Not Rejoin',
};

export const RejoinIndicatorDisplay = ({
  gap,
  state,
}: {
  gap?: number | string;
  state?: RejoinState;
}) => {
  // An unknown state is drawn as the danger, as the red block was.
  const look = REJOIN_LOOK[state ?? 'danger'];
  const gapLabel = gap ?? '--s';

  // Opaque, as the coloured block was, so the warning reads over any scene.
  return (
    <div
      className={`w-full flex items-center justify-between overlay-panel [--bg-opacity:100%] p-2 font-bold text-white ${look.outline}`}
    >
      <div className="text-lg tabular-nums">{gapLabel}</div>
      {/* Partly into the panel's padding, clear of the outline. */}
      <div className={`-mr-1 px-2 text-lg ${look.pill}`}>
        {state && REJOIN_WORD[state]}
      </div>
    </div>
  );
};
