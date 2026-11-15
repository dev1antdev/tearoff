import type { FlagDetail, FlagKind, FlagStateSnapshot } from '@irdashies/types';
import { distanceFromMetres, type DistanceUnit } from '@irdashies/utils/units';

/** A whole distance and its unit, as the panel prints it: "15 m", "49 ft". */
export const formatFlagDistance = (
  metres: number,
  unit: DistanceUnit
): string =>
  `${Math.round(distanceFromMetres(Math.abs(metres), unit))} ${unit}`;

const START_TITLES: Partial<Record<FlagDetail, string>> = {
  beforeSession: 'SESSION NOT STARTED',
  recon: 'RECON LAPS',
  grid: 'ON THE GRID',
  formationLap: 'FORMATION LAP',
  lights: 'START LIGHTS',
  ready: 'READY',
  set: 'SET',
};

const PENALTY_TITLES: Partial<Record<FlagDetail, string>> = {
  driveThrough: 'DRIVE-THROUGH',
  stopGo: 'STOP-GO',
  timePenalty: 'TIME PENALTY',
  penaltyUnknown: 'PENALTY',
  blackFlag: 'BLACK FLAG',
  slowDown: 'WARNING',
};

export interface FlagTitleOptions {
  /**
   * iRacing's word for a full-course yellow. Its caution is the same state
   * under another name, so only the title changes.
   */
  caution?: boolean;
}

/** The capitals line: what the flag is called. */
export const flagTitle = (
  kind: FlagKind,
  detail: FlagDetail,
  { caution = false }: FlagTitleOptions = {}
): string => {
  switch (kind) {
    case 'disqualified':
      return 'DISQUALIFIED';
    case 'red':
      return 'RED FLAG';
    case 'chequered':
      return 'CHEQUERED FLAG';
    case 'start':
      return START_TITLES[detail] ?? 'SESSION NOT STARTED';
    case 'fullCourseYellow':
      return caution ? 'CAUTION' : 'FULL COURSE YELLOW';
    case 'yellow':
      return 'YELLOW FLAG';
    case 'debris':
      return 'DEBRIS';
    case 'blue':
      return 'BLUE FLAG';
    case 'penalty':
      return PENALTY_TITLES[detail] ?? 'PENALTY';
    case 'meatball':
      return 'MEATBALL';
    case 'white':
      return 'LAST LAP';
    case 'green':
      return 'GREEN FLAG';
    case 'none':
      return 'NO FLAG';
  }
};

/** Explanations that need nothing but the detail. */
const FIXED_EXPLANATIONS: Partial<Record<FlagDetail, string>> = {
  noSession: '',
  trackClear: 'Track clear',
  greenStart: 'Race under way',
  greenRestart: 'Racing resumes',
  yellowBehind: 'Incident behind',
  yellowElsewhere: 'Incident elsewhere on the circuit',
  fcy: 'Slow down, no overtaking',
  fcyPending: 'Full course yellow coming',
  fcyPitsClosed: 'Pit lane closed',
  fcyPitLeadLap: 'Pit lane open for lead-lap cars',
  fcyPitsOpen: 'Pit lane open',
  fcyLastLap: 'Green next time by',
  fcyResume: 'Going green',
  blueLapping: 'Faster car behind, let it by',
  blueFasterClass: 'Faster class behind',
  blueTraffic: 'Traffic approaching',
  lastLap: 'Final lap',
  finishLap: 'Finish this lap',
  finished: 'Race complete',
  sessionOver: 'Session over',
  sessionStopped: 'Session stopped',
  driveThrough: 'Serve it through the pit lane',
  blackFlag: 'Serve your penalty in the pits',
  slowDown: 'Slow down',
  repairRequired: 'Repairs required, pit now',
  debris: 'Slippery surface ahead',
  disqualified: 'Return to the pits',
  beforeSession: 'Pit lane closed',
  recon: 'Make your way to the grid',
  grid: 'Wait for the formation lap',
  formationLap: 'Hold position, no overtaking',
  ready: 'Lights coming on',
  set: 'Go when the lights go out',
};

/** What the explanation reads besides the detail. */
export type FlagExplanationFacts = Pick<
  FlagStateSnapshot,
  'incidentDistM' | 'penalty' | 'startLights' | 'playerSector' | 'yellowSectors'
>;

export interface FlagExplanationOptions {
  distanceUnit?: DistanceUnit;
  /** Name the sector of a yellow where the sim flags sectors. */
  nameSector?: boolean;
}

/**
 * The line under the title: what the flag asks of the driver, with the figure
 * that goes with it where there is one.
 */
export const flagExplanation = (
  detail: FlagDetail,
  facts: FlagExplanationFacts,
  { distanceUnit = 'm', nameSector = false }: FlagExplanationOptions = {}
): string => {
  switch (detail) {
    case 'yellowAhead': {
      const metres = facts.incidentDistM;
      // A distance of nothing is the player's own car standing on the track.
      if (metres === null) return 'Incident ahead';
      if (metres < 1) return 'Incident right here';
      return `Incident ${formatFlagDistance(metres, distanceUnit)} ahead`;
    }
    case 'yellowInSector':
      return facts.playerSector === null
        ? 'Yellow in your sector, no overtaking'
        : `Sector ${facts.playerSector + 1}, no overtaking`;
    case 'yellowElsewhere': {
      const sector = nameSector ? facts.yellowSectors.indexOf(true) : -1;
      return sector >= 0
        ? `Incident in sector ${sector + 1}`
        : 'Incident elsewhere on the circuit';
    }
    case 'lights':
      return facts.startLights
        ? `${facts.startLights.lit} of ${facts.startLights.total} lights`
        : 'Wait for the lights';
    case 'stopGo':
      return facts.penalty?.seconds
        ? `${facts.penalty.seconds} s in your pit box`
        : 'Stop in your pit box';
    case 'timePenalty':
      return facts.penalty?.seconds
        ? `+${facts.penalty.seconds} s at your next stop`
        : 'Added at your next stop';
    case 'penaltyUnknown':
      return `${facts.penalty?.count ?? 1} to serve`;
    default:
      return FIXED_EXPLANATIONS[detail] ?? '';
  }
};
