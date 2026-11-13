import { Meta, StoryObj } from '@storybook/react-vite';
import {
  ChannelSnapshotDecorator,
  TelemetryDecoratorWithConfig,
} from '@irdashies/storybook';
import {
  NO_CORNER_READING,
  type CornerReading,
  type CornerResult,
} from '@irdashies/domain/cornerDelta/cornerReadings';
import type { SpeedUnit } from '@irdashies/utils/units';
import { CornerDelta, CornerDeltaView } from './CornerDelta';
import { useCornerDeltaSettings } from './hooks/useCornerDeltaSettings';

interface ViewProps {
  results: readonly CornerResult[];
  unit?: SpeedUnit;
  labels?: ReadonlyMap<string, string>;
  hasCorners?: boolean;
}

/**
 * The widget as drawn from a fixed list of corners, with its settings read
 * the way the widget reads them. The corners themselves come from driving,
 * which a story has none of.
 */
const View = ({ results, unit = 'km/h', labels, hasCorners }: ViewProps) => {
  const settings = useCornerDeltaSettings();
  return (
    <CornerDeltaView
      settings={settings}
      unit={unit}
      results={results}
      labels={labels}
      hasCorners={hasCorners}
    />
  );
};

const reading = (
  timeDeltaSec: number | null,
  entrySpeedDeltaKph: number | null,
  exitSpeedDeltaKph: number | null
): CornerReading => ({ timeDeltaSec, entrySpeedDeltaKph, exitSpeedDeltaKph });

const result = (
  serial: number,
  label: string,
  entrySpeedKph: number,
  exitSpeedKph: number,
  readings: Partial<CornerResult['readings']>
): CornerResult => ({
  serial,
  sectionId: `corner-${serial}`,
  label,
  timeSec: 4,
  entrySpeedKph,
  exitSpeedKph,
  readings: {
    allTime: NO_CORNER_READING,
    sessionBest: NO_CORNER_READING,
    lastLap: NO_CORNER_READING,
    ...readings,
  },
});

/** Imola's middle sector, the last corner a gain after two small losses. */
const corners: readonly CornerResult[] = [
  result(5, 'Variante Alta', 171.4, 142.2, {
    sessionBest: reading(-0.084, 3.2, 1.6),
    allTime: reading(0.142, -2.8, -3.9),
    lastLap: reading(-0.211, 5.1, 2.4),
  }),
  result(4, 'Acque Minerali B', 122.7, 118.3, {
    sessionBest: reading(0.031, -1.4, -2.1),
    allTime: reading(0.066, -2.2, -2.6),
    lastLap: reading(-0.018, 0.4, 0.9),
  }),
  result(3, 'Acque Minerali A', 204.1, 122.7, {
    sessionBest: reading(0.012, 0.8, -1.4),
    allTime: reading(0.047, -0.6, -2.2),
    lastLap: reading(0.009, -0.3, 0.4),
  }),
  result(2, 'Piratella', 213.6, 189.2, {
    sessionBest: reading(-0.004, 0.2, 0.8),
    allTime: reading(0.021, -1.1, -0.6),
    lastLap: reading(-0.052, 1.9, 0.2),
  }),
  result(1, 'Tosa', 96.4, 131.8, {
    sessionBest: reading(0.118, -6.3, -0.1),
    allTime: reading(0.156, -7.4, -1.2),
    lastLap: reading(0.094, -4.8, 0),
  }),
];

const story = (
  args: ViewProps,
  config: Record<string, unknown> = {},
  size = { width: 260, height: 190 }
) => ({
  args,
  decorators: [
    TelemetryDecoratorWithConfig('/test-data/1747384033336', {
      cornerdelta: config,
    }),
    // The widget fills its overlay window, so the story supplies one of the
    // default size rather than letting it span the page.
    (Story: React.ComponentType) => (
      <div style={size}>
        <Story />
      </div>
    ),
  ],
});

const meta: Meta<typeof View> = {
  component: View,
  title: 'widgets/CornerDelta',
};

export default meta;

type Story = StoryObj<typeof View>;

/** Time gained through the last corner, with more speed in and out. */
export const Gained: Story = {
  ...story({ results: corners }),
};

/** Time lost: braked too early, and slower all the way through. */
export const Lost: Story = {
  ...story({ results: corners.slice(4) }),
};

/** The same corners against the all-time lap, which was quicker everywhere. */
export const AgainstAllTimeBest: Story = {
  ...story({ results: corners }, { reference: 'allTime' }),
};

/** Against the last time each corner was driven. */
export const AgainstLastLap: Story = {
  ...story({ results: corners }, { reference: 'lastLap' }),
};

/**
 * The chosen reference does not exist yet: the speeds driven are shown, the
 * differences are dashes and no other lap stands in.
 */
export const NoReferenceYet: Story = {
  ...story({
    results: corners.map((corner) => ({
      ...corner,
      readings: { ...corner.readings, sessionBest: NO_CORNER_READING },
    })),
  }),
};

/** The reference lap was recorded without speeds: the time alone compares. */
export const ReferenceWithoutSpeeds: Story = {
  ...story({
    results: corners.map((corner) => ({
      ...corner,
      readings: {
        ...corner.readings,
        sessionBest: reading(
          corner.readings.sessionBest.timeDeltaSec,
          null,
          null
        ),
      },
    })),
  }),
};

/** The first corner of a stint: nothing before it to list. */
export const FirstCorner: Story = {
  ...story({ results: corners.slice(0, 1) }),
};

/** On track, before a corner has been driven from its start to its end. */
export const NothingDrivenYet: Story = {
  ...story({ results: [] }),
};

/** A track the bundled data has no corners for. */
export const NoCornerData: Story = {
  ...story({ results: [], hasCorners: false }),
};

/** Turn numbers instead of names, miles an hour and three decimals. */
export const NumbersAndMph: Story = {
  ...story(
    {
      results: corners,
      unit: 'mph',
      labels: new Map([
        ['corner-5', 'T14'],
        ['corner-4', 'T12B'],
        ['corner-3', 'T12A'],
        ['corner-2', 'T9'],
        ['corner-1', 'T7'],
      ]),
    },
    { cornerLabel: 'number', decimals: 3 }
  ),
};

/** All four earlier corners listed, in a taller window. */
export const LongerList: Story = {
  ...story(
    { results: corners },
    { historyCount: 4 },
    { width: 260, height: 226 }
  ),
};

/** The time alone, with no list: the smallest the widget goes. */
export const TimeOnly: Story = {
  ...story(
    { results: corners },
    { showEntrySpeed: false, showExitSpeed: false, historyCount: 0 },
    { width: 200, height: 76 }
  ),
};

/** Exit speed only, as for a driver working on getting the power down. */
export const ExitSpeedOnly: Story = {
  ...story({ results: corners }, { showEntrySpeed: false }),
};

/** Names too long for the window are cut short, never the figures. */
export const LongNames: Story = {
  ...story({
    results: [
      result(3, 'Curva do Laranjinha e Pinheirinho', 187.3, 164.9, {
        sessionBest: reading(-12.345, 13.4, -11.8),
      }),
      result(2, 'Subida dos Boxes e Arquibancadas A', 156.2, 201.5, {
        sessionBest: reading(3.218, -10.7, 12.2),
      }),
      result(1, 'Descida do Lago', 201.5, 143.1, {
        sessionBest: reading(0.006, 0, 0.1),
      }),
    ],
  }),
};

/**
 * The widget itself, with its own data hooks, in a session where nothing has
 * been driven: what it shows on the way out of the pits.
 */
export const InASession: StoryObj<typeof CornerDelta> = {
  render: () => <CornerDelta />,
  decorators: [
    TelemetryDecoratorWithConfig('/test-data/1747384033336', {
      // The story has no driving state to show the widget for.
      cornerdelta: { showOnlyWhenOnTrack: false },
    }),
    ChannelSnapshotDecorator({}),
    (Story: React.ComponentType) => (
      <div style={{ width: 260, height: 190 }}>
        <Story />
      </div>
    ),
  ],
};
