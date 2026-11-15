import { describe, expect, it } from 'vitest';
import {
  EMPTY_FLAG_STATE,
  LMU_PENALTY_CODE,
  type FlagDetail,
  type FlagKind,
} from '@irdashies/types';
import {
  flagExplanation,
  flagTitle,
  formatFlagDistance,
  type FlagExplanationFacts,
} from './flagText';

const facts = (
  overrides: Partial<FlagExplanationFacts> = {}
): FlagExplanationFacts => ({ ...EMPTY_FLAG_STATE, ...overrides });

describe('flagTitle', () => {
  it.each<[FlagKind, FlagDetail, string]>([
    ['disqualified', 'disqualified', 'DISQUALIFIED'],
    ['red', 'sessionStopped', 'RED FLAG'],
    ['chequered', 'finished', 'CHEQUERED FLAG'],
    ['start', 'beforeSession', 'SESSION NOT STARTED'],
    ['start', 'recon', 'RECON LAPS'],
    ['start', 'grid', 'ON THE GRID'],
    ['start', 'formationLap', 'FORMATION LAP'],
    ['start', 'lights', 'START LIGHTS'],
    ['start', 'ready', 'READY'],
    ['start', 'set', 'SET'],
    ['fullCourseYellow', 'fcyPitsOpen', 'FULL COURSE YELLOW'],
    ['yellow', 'yellowAhead', 'YELLOW FLAG'],
    ['yellow', 'yellowElsewhere', 'YELLOW FLAG'],
    ['debris', 'debris', 'DEBRIS'],
    ['blue', 'blueLapping', 'BLUE FLAG'],
    ['penalty', 'driveThrough', 'DRIVE-THROUGH'],
    ['penalty', 'stopGo', 'STOP-GO'],
    ['penalty', 'timePenalty', 'TIME PENALTY'],
    ['penalty', 'penaltyUnknown', 'PENALTY'],
    ['penalty', 'blackFlag', 'BLACK FLAG'],
    ['penalty', 'slowDown', 'WARNING'],
    ['meatball', 'repairRequired', 'MEATBALL'],
    ['white', 'lastLap', 'LAST LAP'],
    ['green', 'trackClear', 'GREEN FLAG'],
    ['green', 'greenStart', 'GREEN FLAG'],
    ['none', 'noSession', 'NO FLAG'],
  ])('names %s / %s', (kind, detail, title) => {
    expect(flagTitle(kind, detail)).toBe(title);
  });

  it('calls a full-course yellow a caution under iRacing', () => {
    expect(flagTitle('fullCourseYellow', 'fcy', { caution: true })).toBe(
      'CAUTION'
    );
    // Only that state changes its name.
    expect(flagTitle('yellow', 'yellowAhead', { caution: true })).toBe(
      'YELLOW FLAG'
    );
  });
});

describe('flagExplanation', () => {
  it.each<[FlagDetail, string]>([
    ['noSession', ''],
    ['trackClear', 'Track clear'],
    ['greenStart', 'Race under way'],
    ['greenRestart', 'Racing resumes'],
    ['yellowBehind', 'Incident behind'],
    ['yellowElsewhere', 'Incident elsewhere on the circuit'],
    ['fcy', 'Slow down, no overtaking'],
    ['fcyPending', 'Full course yellow coming'],
    ['fcyPitsClosed', 'Pit lane closed'],
    ['fcyPitLeadLap', 'Pit lane open for lead-lap cars'],
    ['fcyPitsOpen', 'Pit lane open'],
    ['fcyLastLap', 'Green next time by'],
    ['fcyResume', 'Going green'],
    ['blueLapping', 'Faster car behind, let it by'],
    ['blueFasterClass', 'Faster class behind'],
    ['blueTraffic', 'Traffic approaching'],
    ['lastLap', 'Final lap'],
    ['finishLap', 'Finish this lap'],
    ['finished', 'Race complete'],
    ['sessionOver', 'Session over'],
    ['sessionStopped', 'Session stopped'],
    ['driveThrough', 'Serve it through the pit lane'],
    ['blackFlag', 'Serve your penalty in the pits'],
    ['slowDown', 'Slow down'],
    ['repairRequired', 'Repairs required, pit now'],
    ['debris', 'Slippery surface ahead'],
    ['disqualified', 'Return to the pits'],
    ['beforeSession', 'Pit lane closed'],
    ['recon', 'Make your way to the grid'],
    ['grid', 'Wait for the formation lap'],
    ['formationLap', 'Hold position, no overtaking'],
  ])('explains %s', (detail, explanation) => {
    expect(flagExplanation(detail, facts())).toBe(explanation);
  });

  it('gives the distance to an incident ahead in the chosen unit', () => {
    const ahead = facts({ incidentDistM: 320 });

    expect(flagExplanation('yellowAhead', ahead)).toBe('Incident 320 m ahead');
    expect(flagExplanation('yellowAhead', ahead, { distanceUnit: 'ft' })).toBe(
      'Incident 1050 ft ahead'
    );
  });

  it('says so when the stopped car is the player’s own', () => {
    expect(flagExplanation('yellowAhead', facts({ incidentDistM: 0 }))).toBe(
      'Incident right here'
    );
  });

  it('names the player’s sector, counted from one', () => {
    expect(flagExplanation('yellowInSector', facts({ playerSector: 1 }))).toBe(
      'Sector 2, no overtaking'
    );
  });

  it('names the sector of a yellow elsewhere only when asked to', () => {
    const elsewhere = facts({ yellowSectors: [false, false, true] });

    expect(flagExplanation('yellowElsewhere', elsewhere)).toBe(
      'Incident elsewhere on the circuit'
    );
    expect(
      flagExplanation('yellowElsewhere', elsewhere, { nameSector: true })
    ).toBe('Incident in sector 3');
    // iRacing flags no sectors: there is none to name.
    expect(
      flagExplanation('yellowElsewhere', facts(), { nameSector: true })
    ).toBe('Incident elsewhere on the circuit');
  });

  it('counts the start lights', () => {
    expect(
      flagExplanation('lights', facts({ startLights: { lit: 3, total: 5 } }))
    ).toBe('3 of 5 lights');
    expect(flagExplanation('lights', facts())).toBe('Wait for the lights');
  });

  it('gives the seconds of a stop-go and of a time penalty', () => {
    const stopGo = { count: 1, kind: LMU_PENALTY_CODE.stopGo, seconds: 10 };
    const time = { count: 1, kind: LMU_PENALTY_CODE.time, seconds: 5 };

    expect(flagExplanation('stopGo', facts({ penalty: stopGo }))).toBe(
      '10 s in your pit box'
    );
    expect(flagExplanation('timePenalty', facts({ penalty: time }))).toBe(
      '+5 s at your next stop'
    );
  });

  it('does without the seconds when the sim has not given them', () => {
    const unnamed = { count: 1, kind: LMU_PENALTY_CODE.stopGo, seconds: null };

    expect(flagExplanation('stopGo', facts({ penalty: unnamed }))).toBe(
      'Stop in your pit box'
    );
    expect(flagExplanation('timePenalty', facts({ penalty: unnamed }))).toBe(
      'Added at your next stop'
    );
  });

  it('counts the penalties it cannot name', () => {
    const two = { count: 2, kind: LMU_PENALTY_CODE.none, seconds: null };

    expect(flagExplanation('penaltyUnknown', facts({ penalty: two }))).toBe(
      '2 to serve'
    );
  });
});

describe('formatFlagDistance', () => {
  it('prints whole metres or feet with the unit', () => {
    expect(formatFlagDistance(15, 'm')).toBe('15 m');
    expect(formatFlagDistance(15, 'ft')).toBe('49 ft');
    expect(formatFlagDistance(0.4, 'm')).toBe('0 m');
  });

  it('prints a distance behind without its sign', () => {
    expect(formatFlagDistance(-30, 'm')).toBe('30 m');
  });
});
