import type { ComponentType } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import {
  ChannelSnapshotDecorator,
  createMockBridgeWithConfig,
  trackStateStorySnapshot,
} from '@irdashies/storybook';
import { DashboardProvider, useSessionStore } from '@irdashies/context';
import {
  EMPTY_FLAG_STATE,
  FLAG_ACTIVE_BLUE,
  FLAG_ACTIVE_BLUE_TRAFFIC,
  FLAG_ACTIVE_CHEQUERED,
  FLAG_ACTIVE_DEBRIS,
  FLAG_ACTIVE_DISQUALIFIED,
  FLAG_ACTIVE_FCY_PHASE_SHIFT,
  FLAG_ACTIVE_FULL_COURSE_YELLOW,
  FLAG_ACTIVE_GREEN,
  FLAG_ACTIVE_GREEN_RESTART,
  FLAG_ACTIVE_GREEN_START,
  FLAG_ACTIVE_MEATBALL,
  FLAG_ACTIVE_PENALTY,
  FLAG_ACTIVE_RED,
  FLAG_ACTIVE_START,
  FLAG_ACTIVE_WARNING,
  FLAG_ACTIVE_WHITE,
  FLAG_ACTIVE_YELLOW,
  FLAG_ACTIVE_YELLOW_NEAR,
  LMU_CLASS_COLOURS,
  LMU_PENALTY_CODE,
  type ActiveSimulator,
  type DashboardBridge,
  type FlagBlueCar,
  type FlagPanelConfig,
  type FlagStateSnapshot,
  type Session,
} from '@irdashies/types';
import { FlagPanel } from './FlagPanel';

/** The widget's default box: stories show what the driver gets. */
const BOX = { width: 440, height: 92 };

const PLAYER = 0;
const HYPERCAR = 1;
const HYPERCAR_LONG_NAME = 2;
const LMP2 = 3;
const GT3_THREE_DIGITS = 4;

const entry = (
  carIdx: number,
  number: string,
  driver: string,
  team: string,
  carClass: keyof typeof LMU_CLASS_COLOURS
) => ({
  CarIdx: carIdx,
  CarNumber: number,
  UserName: driver,
  TeamName: team,
  CarClassShortName: carClass,
  CarClassColor: LMU_CLASS_COLOURS[carClass],
});

/**
 * A three-class Le Mans Ultimate grid, made up. Only what the panel reads:
 * the number, driver, team and class of each entry.
 */
const multiClassSession = {
  WeekendInfo: { NumCarClasses: 3, TeamRacing: 1 },
  SessionInfo: { Sessions: [{ SessionNum: 0, SessionType: 'Race' }] },
  DriverInfo: {
    DriverCarIdx: PLAYER,
    Drivers: [
      entry(PLAYER, '77', 'Alex Mercer', 'Iron Coast Racing', 'LMGT3'),
      entry(
        HYPERCAR,
        '8',
        'Dominik Gessler',
        'Northstar Motorsport',
        'Hypercar'
      ),
      entry(
        HYPERCAR_LONG_NAME,
        '51',
        'Matteo Alessandro Ferrante-Villanova di Castelnuovo',
        'Scuderia Monte Rosso Endurance Racing Team',
        'Hypercar'
      ),
      entry(LMP2, '22', 'Jonas Lindqvist', 'United Nordic', 'LMP2'),
      entry(
        GT3_THREE_DIGITS,
        '777',
        'Kenji Watanabe',
        'Akashi Racing',
        'LMGT3'
      ),
    ],
  },
} as unknown as Session;

const singleClassSession = {
  ...multiClassSession,
  WeekendInfo: { NumCarClasses: 1, TeamRacing: 0 },
} as unknown as Session;

const flagState = (
  overrides: Partial<FlagStateSnapshot>
): FlagStateSnapshot => ({
  ...EMPTY_FLAG_STATE,
  yellowSectors: [false, false, false],
  playerSector: 1,
  sessionNum: 0,
  version: 1,
  ...overrides,
});

const blueCar = (overrides: Partial<FlagBlueCar>): FlagBlueCar => ({
  carIdx: HYPERCAR,
  distanceM: 120,
  gapS: 2.4,
  closingMs: 6.5,
  lapsAhead: 1,
  fasterClass: true,
  confirmed: true,
  othersCount: 0,
  ...overrides,
});

interface StoryOptions {
  config?: Partial<FlagPanelConfig>;
  session?: Session;
  simulator?: ActiveSimulator;
  displayUnits?: number;
}

const story = (
  snapshot: FlagStateSnapshot,
  {
    config = {},
    session = multiClassSession,
    simulator = 'lmu',
    displayUnits = 1,
  }: StoryOptions = {}
) => {
  const bridge: DashboardBridge = {
    ...createMockBridgeWithConfig({ flagpanel: config }),
    getActiveSimulator: async () => simulator,
  };
  return {
    // The grid the car a blue is for is looked up in.
    loaders: [
      async () => {
        useSessionStore.setState({ session });
      },
    ],
    decorators: [
      (Story: ComponentType) => (
        <DashboardProvider bridge={bridge}>
          {/* The overlay clips each widget to its own box, as here. */}
          <div style={{ ...BOX, contain: 'layout style paint' }}>
            <Story />
          </div>
        </DashboardProvider>
      ),
      ChannelSnapshotDecorator({
        'flag-state.snapshot': snapshot,
        'track-state.snapshot': { ...trackStateStorySnapshot, displayUnits },
      }),
    ],
  };
};

const meta: Meta<typeof FlagPanel> = {
  component: FlagPanel,
  title: 'widgets/FlagPanel',
};

export default meta;

type Story = StoryObj<typeof FlagPanel>;

const green = flagState({
  kind: 'green',
  detail: 'trackClear',
  active: FLAG_ACTIVE_GREEN,
});

const blueOne = flagState({
  kind: 'blue',
  detail: 'blueLapping',
  active: FLAG_ACTIVE_BLUE | FLAG_ACTIVE_GREEN,
  blue: blueCar({}),
});

const yellowElsewhere = flagState({
  kind: 'yellow',
  detail: 'yellowElsewhere',
  active: FLAG_ACTIVE_YELLOW | FLAG_ACTIVE_GREEN,
  yellowSectors: [false, false, true],
});

/** The calm state: the track is clear and the card stays dark. */
export const GreenTrackClear: Story = { ...story(green) };

/** The five seconds after the lights go out. */
export const GreenStart: Story = {
  ...story(
    flagState({
      kind: 'green',
      detail: 'greenStart',
      active: FLAG_ACTIVE_GREEN | FLAG_ACTIVE_GREEN_START,
    })
  ),
};

/** The five seconds after a yellow of either kind ends. */
export const GreenRestart: Story = {
  ...story(
    flagState({
      kind: 'green',
      detail: 'greenRestart',
      active: FLAG_ACTIVE_GREEN | FLAG_ACTIVE_GREEN_RESTART,
    })
  ),
};

/** No session, or data the sim has stopped writing. */
export const NoFlag: Story = { ...story(flagState({})) };

/** A Hypercar a lap ahead coming through, alone. */
export const BlueOneCar: Story = { ...story(blueOne) };

/** The same with two more queued behind it. */
export const BlueQueue: Story = {
  ...story(
    flagState({
      ...blueOne,
      blue: blueCar({ carIdx: LMP2, distanceM: 86, othersCount: 2 }),
    })
  ),
};

/** Under 50 m the distance turns red; the car is still closing. */
export const BlueClose: Story = {
  ...story(
    flagState({
      ...blueOne,
      blue: blueCar({ distanceM: 15, closingMs: 3.1 }),
    })
  ),
};

/** A long name truncates; a three-digit number takes the smaller size. */
export const BlueLongName: Story = {
  ...story(
    flagState({
      ...blueOne,
      blue: blueCar({ carIdx: HYPERCAR_LONG_NAME, distanceM: 240 }),
    })
  ),
};

/** Team events can name the team instead of the driver. */
export const BlueTeamName: Story = {
  ...story(
    flagState({
      ...blueOne,
      blue: blueCar({
        carIdx: GT3_THREE_DIGITS,
        distanceM: 64,
        fasterClass: false,
        closingMs: 0.4,
      }),
    }),
    { config: { blueName: 'team' } }
  ),
};

/**
 * No car met the lapping rule, so the nearest one behind is named, greyed:
 * the sim says blue but this may not be the car it means.
 */
export const BlueUnconfirmed: Story = {
  ...story(
    flagState({
      ...blueOne,
      blue: blueCar({
        carIdx: GT3_THREE_DIGITS,
        distanceM: 32,
        lapsAhead: 0,
        fasterClass: false,
        confirmed: false,
        closingMs: 0.2,
      }),
    })
  ),
};

/** The sim says blue and there is no car to name. */
export const BlueNoCar: Story = {
  ...story(flagState({ ...blueOne, blue: null })),
};

/** Blue at the pit exit: traffic to rejoin into. */
export const BlueTraffic: Story = {
  ...story(
    flagState({
      kind: 'blue',
      detail: 'blueTraffic',
      active: FLAG_ACTIVE_BLUE | FLAG_ACTIVE_BLUE_TRAFFIC,
      blue: null,
    })
  ),
};

/** A single-class session draws the class label in the highlight colour. */
export const BlueSingleClassFeet: Story = {
  ...story(
    flagState({
      ...blueOne,
      blue: blueCar({ carIdx: GT3_THREE_DIGITS, fasterClass: false }),
    }),
    { session: singleClassSession, config: { distanceUnit: 'ft' } }
  ),
};

/** A stopped car 320 m ahead: the yellow is the player's. */
export const YellowAhead: Story = {
  ...story(
    flagState({
      kind: 'yellow',
      detail: 'yellowAhead',
      active: FLAG_ACTIVE_YELLOW | FLAG_ACTIVE_YELLOW_NEAR | FLAG_ACTIVE_GREEN,
      yellowSectors: [false, true, false],
      incidentDistM: 320,
      incidentCarIdx: LMP2,
    })
  ),
};

/** Within 200 m the block pulses. */
export const YellowClose: Story = {
  ...story(
    flagState({
      kind: 'yellow',
      detail: 'yellowAhead',
      active: FLAG_ACTIVE_YELLOW | FLAG_ACTIVE_YELLOW_NEAR | FLAG_ACTIVE_GREEN,
      yellowSectors: [false, true, false],
      incidentDistM: 85,
      incidentCarIdx: LMP2,
    })
  ),
};

/** Just past the incident. */
export const YellowBehind: Story = {
  ...story(
    flagState({
      kind: 'yellow',
      detail: 'yellowBehind',
      active: FLAG_ACTIVE_YELLOW | FLAG_ACTIVE_YELLOW_NEAR | FLAG_ACTIVE_GREEN,
      yellowSectors: [false, true, false],
      incidentDistM: -30,
      incidentCarIdx: LMP2,
    })
  ),
};

/** A yellow in the player's own sector with no stopped car in range. */
export const YellowInSector: Story = {
  ...story(
    flagState({
      kind: 'yellow',
      detail: 'yellowInSector',
      active: FLAG_ACTIVE_YELLOW | FLAG_ACTIVE_YELLOW_NEAR | FLAG_ACTIVE_GREEN,
      yellowSectors: [false, true, false],
    }),
    { config: { yellow: { nameSector: true } } as Partial<FlagPanelConfig> }
  ),
};

/** A yellow somewhere else: named, and the card stays dark. */
export const YellowElsewhere: Story = { ...story(yellowElsewhere) };

export const FullCourseYellow: Story = {
  ...story(
    flagState({
      kind: 'fullCourseYellow',
      detail: 'fcy',
      active: FLAG_ACTIVE_FULL_COURSE_YELLOW,
    })
  ),
};

/** A sub-phase, with the pit lane closed to the player. */
export const FullCourseYellowPitLeadLap: Story = {
  ...story(
    flagState({
      kind: 'fullCourseYellow',
      detail: 'fcyPitLeadLap',
      active:
        FLAG_ACTIVE_FULL_COURSE_YELLOW | (3 << FLAG_ACTIVE_FCY_PHASE_SHIFT),
      pitLaneClosed: true,
    })
  ),
};

/** iRacing calls it a caution. */
export const CautionOneLapToGreen: Story = {
  ...story(
    flagState({
      kind: 'fullCourseYellow',
      detail: 'fcyLastLap',
      active:
        FLAG_ACTIVE_FULL_COURSE_YELLOW | (5 << FLAG_ACTIVE_FCY_PHASE_SHIFT),
      yellowSectors: [],
      playerSector: null,
    }),
    { simulator: 'iracing' }
  ),
};

export const Debris: Story = {
  ...story(
    flagState({
      kind: 'debris',
      detail: 'debris',
      active: FLAG_ACTIVE_DEBRIS | FLAG_ACTIVE_GREEN,
      yellowSectors: [],
      playerSector: null,
    }),
    { simulator: 'iracing' }
  ),
};

export const PenaltyDriveThrough: Story = {
  ...story(
    flagState({
      kind: 'penalty',
      detail: 'driveThrough',
      active: FLAG_ACTIVE_PENALTY | FLAG_ACTIVE_GREEN,
      penalty: { count: 1, kind: LMU_PENALTY_CODE.driveThrough, seconds: null },
    })
  ),
};

export const PenaltyStopGo: Story = {
  ...story(
    flagState({
      kind: 'penalty',
      detail: 'stopGo',
      active: FLAG_ACTIVE_PENALTY | FLAG_ACTIVE_GREEN,
      penalty: { count: 1, kind: LMU_PENALTY_CODE.stopGo, seconds: 10 },
    })
  ),
};

export const PenaltyTime: Story = {
  ...story(
    flagState({
      kind: 'penalty',
      detail: 'timePenalty',
      active: FLAG_ACTIVE_PENALTY | FLAG_ACTIVE_GREEN,
      penalty: { count: 1, kind: LMU_PENALTY_CODE.time, seconds: 10 },
    })
  ),
};

/** The sim counts penalties but has not named them. */
export const PenaltyUnknown: Story = {
  ...story(
    flagState({
      kind: 'penalty',
      detail: 'penaltyUnknown',
      active: FLAG_ACTIVE_PENALTY | FLAG_ACTIVE_GREEN,
      penalty: { count: 2, kind: LMU_PENALTY_CODE.none, seconds: null },
    })
  ),
};

/** iRacing's black flag: no kind, no seconds. */
export const BlackFlag: Story = {
  ...story(
    flagState({
      kind: 'penalty',
      detail: 'blackFlag',
      active: FLAG_ACTIVE_PENALTY | FLAG_ACTIVE_GREEN,
      yellowSectors: [],
      playerSector: null,
    }),
    { simulator: 'iracing' }
  ),
};

/** iRacing's furled black flag. */
export const Warning: Story = {
  ...story(
    flagState({
      kind: 'penalty',
      detail: 'slowDown',
      active: FLAG_ACTIVE_PENALTY | FLAG_ACTIVE_WARNING | FLAG_ACTIVE_GREEN,
      yellowSectors: [],
      playerSector: null,
    }),
    { simulator: 'iracing' }
  ),
};

export const Meatball: Story = {
  ...story(
    flagState({
      kind: 'meatball',
      detail: 'repairRequired',
      active: FLAG_ACTIVE_MEATBALL | FLAG_ACTIVE_GREEN,
      yellowSectors: [],
      playerSector: null,
    }),
    { simulator: 'iracing' }
  ),
};

export const LastLap: Story = {
  ...story(
    flagState({
      kind: 'white',
      detail: 'lastLap',
      active: FLAG_ACTIVE_WHITE | FLAG_ACTIVE_GREEN,
    })
  ),
};

export const ChequeredFinished: Story = {
  ...story(
    flagState({
      kind: 'chequered',
      detail: 'finished',
      active: FLAG_ACTIVE_CHEQUERED,
    })
  ),
};

export const ChequeredFinishLap: Story = {
  ...story(
    flagState({
      kind: 'chequered',
      detail: 'finishLap',
      active: FLAG_ACTIVE_CHEQUERED,
    })
  ),
};

export const RedFlag: Story = {
  ...story(
    flagState({
      kind: 'red',
      detail: 'sessionStopped',
      active: FLAG_ACTIVE_RED,
    })
  ),
};

export const Disqualified: Story = {
  ...story(
    flagState({
      kind: 'disqualified',
      detail: 'disqualified',
      active: FLAG_ACTIVE_DISQUALIFIED,
    })
  ),
};

/** Before the session: the pit lane is closed. */
export const SessionNotStarted: Story = {
  ...story(
    flagState({
      kind: 'start',
      detail: 'beforeSession',
      active: FLAG_ACTIVE_START,
      pitLaneClosed: true,
    })
  ),
};

export const ReconLaps: Story = {
  ...story(
    flagState({ kind: 'start', detail: 'recon', active: FLAG_ACTIVE_START })
  ),
};

export const OnTheGrid: Story = {
  ...story(
    flagState({ kind: 'start', detail: 'grid', active: FLAG_ACTIVE_START })
  ),
};

export const FormationLap: Story = {
  ...story(
    flagState({
      kind: 'start',
      detail: 'formationLap',
      active: FLAG_ACTIVE_START,
    })
  ),
};

/** Three of five red lights lit. */
export const StartLights: Story = {
  ...story(
    flagState({
      kind: 'start',
      detail: 'lights',
      active: FLAG_ACTIVE_START,
      startLights: { lit: 3, total: 5 },
    })
  ),
};

/** iRacing gives no light count, only ready and set. */
export const StartSet: Story = {
  ...story(
    flagState({
      kind: 'start',
      detail: 'set',
      active: FLAG_ACTIVE_START,
      yellowSectors: [],
      playerSector: null,
    }),
    { simulator: 'iracing' }
  ),
};

/** Tint off: only the block is coloured, whatever the flag. */
export const TintOff: Story = {
  ...story(blueOne, { config: { tintCard: 'off' } }),
};

/** Tint active, the default: a blue tints the card, a clear track does not. */
export const TintActive: Story = {
  ...story(blueOne, { config: { tintCard: 'active' } }),
};

/** Tint always: a clear track is tinted green. */
export const TintAlwaysGreen: Story = {
  ...story(green, { config: { tintCard: 'always' } }),
};

/** Tint always: so is a yellow elsewhere on the circuit. */
export const TintAlwaysYellowElsewhere: Story = {
  ...story(yellowElsewhere, { config: { tintCard: 'always' } }),
};

/** A see-through card stays see-through when tinted. */
export const TintFollowsOpacity: Story = {
  ...story(blueOne, { config: { background: { opacity: 30 } } }),
};

/** Without the right-hand pair and the explanation line. */
export const Compact: Story = {
  ...story(green, { config: { bluePair: 'hidden', showExplanation: false } }),
};

/** With the start states switched off, the flag that ranks next is shown. */
export const StartSwitchedOff: Story = {
  ...story(
    flagState({
      kind: 'start',
      detail: 'formationLap',
      active: FLAG_ACTIVE_START | FLAG_ACTIVE_PENALTY,
      penalty: { count: 1, kind: LMU_PENALTY_CODE.driveThrough, seconds: null },
    }),
    { config: { showStartLights: false } }
  ),
};
