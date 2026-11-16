import { ipcRenderer } from 'electron';
import type { RaceHistoryBridge } from '../../types/raceHistory';
import { defineBridge } from './defineBridge';

/**
 * The preload side of the race history: what a window calls to read the
 * laps and stints of a car. What is small and current about every car
 * comes over the `race-history.summary` channel instead.
 */
export const exposeRaceHistoryBridge = () =>
  defineBridge<RaceHistoryBridge>('raceHistoryBridge', {
    getCarLaps: (carIdx, raceId) =>
      ipcRenderer.invoke('raceHistory:getCarLaps', carIdx, raceId),
    getCarStints: (carIdx, raceId) =>
      ipcRenderer.invoke('raceHistory:getCarStints', carIdx, raceId),
    getDriverChanges: (raceId) =>
      ipcRenderer.invoke('raceHistory:getDriverChanges', raceId),
    listRaces: () => ipcRenderer.invoke('raceHistory:listRaces'),
  });
