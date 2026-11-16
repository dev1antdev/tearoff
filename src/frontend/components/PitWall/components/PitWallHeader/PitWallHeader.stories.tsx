import type { Meta, StoryObj } from '@storybook/react-vite';
import { PitWallHeader } from './PitWallHeader';
import type { PitWallHeaderData } from '../../hooks/usePitWallHeader';

const racing: PitWallHeaderData = {
  simulator: 'Le Mans Ultimate',
  inSession: true,
  session: 'Race · Circuit de la Sarthe',
  timeLeft: '3:26:56',
  timeOfDay: '18:33',
  flag: { label: 'GREEN', tone: 'green' },
  car: {
    number: '77',
    classColor: '#00ff6a',
    place: { position: 'P3', field: 'of 8 in LMGT3', overall: 'P14 overall' },
    driver: 'Alex Mercer',
    team: 'Iron Coast Racing',
  },
  watching: false,
};

const meta: Meta<typeof PitWallHeader> = {
  component: PitWallHeader,
  title: 'widgets/PitWall/PitWallHeader',
  parameters: { layout: 'fullscreen' },
  args: {
    data: racing,
    layout: 'race',
    fullscreen: false,
    onLayoutChange: () => undefined,
    onToggleFullscreen: () => undefined,
    onOpenSettings: () => undefined,
  },
};
export default meta;
type Story = StoryObj<typeof PitWallHeader>;

/** At the wheel in a race under green. */
export const Racing: Story = {};

/** A team-mate's stint, under a full-course yellow. */
export const TeamMateDriving: Story = {
  args: {
    layout: 'watching',
    data: {
      ...racing,
      flag: { label: 'FULL COURSE YELLOW', tone: 'yellow' },
      car: racing.car && { ...racing.car, driver: 'Nadia Volkova' },
      watching: true,
    },
  },
};

/** The Compact layout: the same strip with touch-sized buttons. */
export const CompactLayout: Story = {
  args: { layout: 'compact', fullscreen: true },
  decorators: [
    (Story) => (
      <div className="w-[1180px]">
        <Story />
      </div>
    ),
  ],
};

/**
 * The strip in a browser: no gear, because there is no settings window for
 * a browser to open.
 */
export const InABrowser: Story = {
  args: { layout: 'compact', onOpenSettings: undefined },
  decorators: [
    (Story) => (
      <div className="w-[1180px]">
        <Story />
      </div>
    ),
  ],
};

/**
 * Practice under iRacing: no in-game clock, and a car the sim has not ranked
 * yet, which shows a placeholder rather than a place.
 */
export const UnrankedInPractice: Story = {
  args: {
    data: {
      ...racing,
      simulator: 'iRacing',
      session: 'Practice · Sebring International Raceway',
      timeLeft: '42:10',
      timeOfDay: undefined,
      flag: null,
      car: {
        number: '12',
        classColor: '#ffda59',
        place: { position: '--', field: 'GT3', overall: '' },
        driver: 'Alex Mercer',
      },
    },
  },
};

/** Each flag the strip can show. */
export const Flags: Story = {
  render: (args) => (
    <div className="flex flex-col gap-px">
      {(
        [
          { label: 'YELLOW', tone: 'yellow' },
          { label: 'BLUE', tone: 'blue' },
          { label: 'RED', tone: 'red' },
          { label: 'LAST LAP', tone: 'white' },
          { label: 'MEATBALL', tone: 'orange' },
          { label: 'DRIVE-THROUGH', tone: 'neutral' },
        ] as const
      ).map((flag) => (
        <PitWallHeader key={flag.label} {...args} data={{ ...racing, flag }} />
      ))}
    </div>
  ),
};

/** A simulator is connected and in no session: nothing about a race. */
export const NoSession: Story = {
  args: {
    data: {
      simulator: 'Le Mans Ultimate',
      inSession: false,
      session: '',
      timeLeft: '--',
      flag: null,
      car: null,
      watching: false,
    },
  },
};

/** Nothing is running: the wordmark and the page's own controls. */
export const NoSimulator: Story = {
  args: {
    data: { ...NoSession.args?.data, simulator: null } as PitWallHeaderData,
  },
};
