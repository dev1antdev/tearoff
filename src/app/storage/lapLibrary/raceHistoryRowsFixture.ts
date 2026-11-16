import type {
  RaceDriverChange,
  RaceInfo,
  RaceLap,
  RaceStint,
  RaceWriteBatch,
} from '../../../types/raceHistory';
import { RACE_HISTORY_MAX_RACES } from '../../../types/raceHistory';
import type { RaceEvent, RacePitEntryEvent } from '../../../types/raceLog';

/**
 * Rows of a race as the recorder hands them to the file, for the specs of
 * the race tables and of the store in front of them. Figures that a float
 * holds exactly, so that what is read back can be compared as it is.
 */

export const T0 = Date.UTC(2026, 10, 16, 14, 0, 0);
export const MINUTE = 60_000;

export const raceInfo = (overrides: Partial<RaceInfo> = {}): RaceInfo => ({
  id: null,
  simulator: 'lmu',
  sessionKey: '',
  sessionNum: 10,
  sessionType: 'Race',
  sessionName: 'Race',
  trackId: 694510461,
  trackName: 'Circuit de la Sarthe',
  trackConfig: null,
  trackLengthM: 13626,
  startedAt: T0,
  updatedAt: T0,
  sessionTime: 0,
  entries: [
    {
      carIdx: 0,
      carNumber: '51',
      car: 'ferrari499p.veh',
      classId: 1,
      className: 'Hypercar',
      teamName: 'Ferrari AF Corse',
    },
    {
      carIdx: 7,
      carNumber: '77',
      car: 'porsche911.veh',
      classId: 5,
      className: 'LMGT3',
      teamName: 'Proton Compétition',
    },
  ],
  tyres: [
    { index: 0, name: 'Medium' },
    { index: 1, name: 'Hard' },
  ],
  ...overrides,
});

export const raceLap = (
  carIdx: number,
  lap: number,
  overrides: Partial<RaceLap> = {}
): RaceLap => ({
  carIdx,
  lap,
  sessionTime: lap * 210.5 + carIdx,
  lapTime: 210.5 - carIdx * 0.125,
  sectors: [70.25, 80.125, 60.125],
  position: carIdx + 1,
  classPosition: 1,
  classGap: carIdx === 0 ? 0 : 12.75,
  flags: 0,
  driver: `Driver ${carIdx}`,
  energy: 0.5 - lap * 0.03125,
  energyIsVirtual: carIdx === 0,
  compounds: [0, 0, 1, 1],
  ...overrides,
});

export const raceStint = (
  carIdx: number,
  ordinal: number,
  overrides: Partial<RaceStint> = {}
): RaceStint => ({
  carIdx,
  ordinal,
  driver: `Driver ${carIdx}`,
  openedBy: ordinal === 1 ? 'start' : 'stop',
  closedBy: null,
  firstLap: (ordinal - 1) * 10 + 1,
  lastLap: (ordinal - 1) * 10 + 3,
  startTime: (ordinal - 1) * 2100,
  endTime: null,
  laps: 3,
  cleanLaps: 2,
  avgLap: 210.75,
  bestLap: 210.5,
  stop: null,
  ...overrides,
});

export const raceChange = (
  carIdx: number,
  seq: number,
  overrides: Partial<RaceDriverChange> = {}
): RaceDriverChange => ({
  carIdx,
  seq,
  sessionTime: seq * 2100,
  lap: seq * 10,
  from: `Driver ${seq}`,
  to: `Driver ${seq + 1}`,
  atStop: true,
  ...overrides,
});

/** A car into the pits: the plainest event there is. */
export const raceEvent = (
  seq: number,
  carIdx = 0,
  overrides: Partial<RacePitEntryEvent> = {}
): RacePitEntryEvent => ({
  seq,
  sessionTime: seq * 60.5,
  timeOfDay: 50_400 + seq * 60.5,
  carIdx,
  kind: 'pit-entry',
  classPosition: 3,
  ...overrides,
});

/** One event of every kind, numbered from 1, with every field in use. */
export const everyKindOfEvent = (): RaceEvent[] => {
  const at = (seq: number) => ({
    seq,
    sessionTime: seq * 60.5,
    timeOfDay: 50_400 + seq * 60.5,
  });
  return [
    {
      ...at(1),
      carIdx: null,
      kind: 'flag',
      flag: 'green',
      after: 'start',
      durationS: null,
      late: false,
    },
    { ...at(2), carIdx: 7, kind: 'pit-entry', classPosition: 5 },
    {
      ...at(3),
      carIdx: 7,
      kind: 'pit-exit',
      standingTime: 31.5,
      laneTime: 58.25,
      driverFrom: 'A. Petrov',
      driverTo: 'M. Ivanov',
    },
    { ...at(4), carIdx: 0, kind: 'drive-through', laneTime: 24.5 },
    {
      ...at(5),
      carIdx: 0,
      kind: 'driver-change',
      driverFrom: 'J\u00e9r\u00f4me d\u2019\u00c9t\u00e9',
      driverTo: 'B. Driver',
    },
    {
      ...at(6),
      carIdx: 0,
      kind: 'fastest-lap',
      lap: 12,
      lapTime: 113.604,
      driver: 'B. Driver',
    },
    {
      ...at(7),
      carIdx: null,
      kind: 'flag',
      flag: 'caution',
      after: null,
      durationS: null,
      late: true,
    },
    {
      ...at(8),
      carIdx: null,
      kind: 'flag',
      flag: 'green',
      after: 'caution',
      durationS: 362.5,
      late: false,
    },
    { ...at(9), carIdx: 7, kind: 'retired', reason: 'garage' },
    { ...at(10), carIdx: 7, kind: 'rejoined', awayS: 912.5 },
    { ...at(11), carIdx: 0, kind: 'position', from: 5, to: 4 },
    {
      ...at(12),
      carIdx: 0,
      kind: 'penalty',
      change: 'given',
      penalty: 'TIME',
      seconds: 10,
      pending: 2,
    },
    {
      ...at(13),
      carIdx: null,
      kind: 'forecast',
      rain: true,
      inMinutes: 118,
      rainChance: 0.75,
    },
    // Every figure that can be unknown, unknown.
    {
      ...at(14),
      timeOfDay: null,
      carIdx: 7,
      kind: 'pit-exit',
      standingTime: null,
      laneTime: null,
      driverFrom: '',
      driverTo: '',
    },
  ];
};

export const raceBatch = (
  overrides: Partial<RaceWriteBatch> = {}
): RaceWriteBatch => ({
  raceId: null,
  token: 'boot1:1',
  info: raceInfo(),
  laps: [],
  stints: [],
  driverChanges: [],
  replacedCars: [],
  maxRaces: RACE_HISTORY_MAX_RACES,
  ...overrides,
});
