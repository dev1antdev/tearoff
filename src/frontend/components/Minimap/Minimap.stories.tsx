import { useEffect } from 'react';
import type { Decorator, Meta, StoryObj } from '@storybook/react-vite';
import {
  ChannelSnapshotDecorator,
  TelemetryDecoratorWithConfig,
} from '@irdashies/storybook';
import { useSessionStore } from '@irdashies/context';
import type { LmuTrackMap, MinimapSnapshot, Session } from '@irdashies/types';
import lmuTrackMaps from '../../../app/lmu/lmu-track-maps.json';
import { Minimap } from './Minimap';

/** The fixture session: Interlagos, 41 slots, the player in slot 0. */
const SLOTS = 41;
const PLAYER = 0;

/**
 * A field strung out round the lap from the player's place on it.
 *
 * `offsets` are lap fractions relative to the player, so the same field can be
 * dropped anywhere on the track.
 */
const field = (
  playerProgress: number,
  offsets: Record<number, number>,
  inPits: readonly number[] = []
): MinimapSnapshot => {
  const lapDistPct = new Array<number>(SLOTS).fill(-1);
  const position = new Array<number>(SLOTS).fill(0);
  const classPosition = new Array<number>(SLOTS).fill(0);
  const onPitRoad = new Array<boolean>(SLOTS).fill(false);
  lapDistPct[PLAYER] = playerProgress;
  for (const [carIdx, offset] of Object.entries(offsets)) {
    lapDistPct[Number(carIdx)] = (playerProgress + offset + 1) % 1;
  }
  // Ranked by how far ahead of the player each car is, leader first.
  const gap = (carIdx: number) => (carIdx === PLAYER ? 0 : offsets[carIdx]);
  const ahead = [PLAYER, ...Object.keys(offsets).map(Number)].sort(
    (a, b) => gap(b) - gap(a)
  );
  ahead.forEach((carIdx, index) => {
    position[carIdx] = index + 3;
    classPosition[carIdx] = index + 1;
  });
  for (const carIdx of inPits) onPitRoad[carIdx] = true;
  return {
    focusCarIdx: PLAYER,
    carIdxLapDistPct: lapDistPct,
    carIdxOnPitRoad: onPitRoad,
    carIdxPosition: position,
    carIdxClassPosition: classPosition,
    sessionNum: 0,
    version: 1,
  };
};

/** A handful of cars within a few hundred metres, two classes mixed. */
const battle = { 1: 0.012, 2: 0.004, 21: -0.006, 22: -0.021, 3: 0.03 };

/**
 * Swaps the fixture's track for a Le Mans Ultimate map, the way LMU sends one
 * with the session.
 */
const WithLmuMap = (name: string, lengthKm: number): Decorator => {
  const map = (lmuTrackMaps as unknown as Record<string, LmuTrackMap>)[name];
  const DecoratorComponent: Decorator = (Story) => {
    useEffect(() => {
      const apply = (session: Session | null) => {
        if (!session || session.LmuTrackMap) return;
        useSessionStore.setState({
          session: {
            ...session,
            LmuTrackMap: map,
            WeekendInfo: {
              ...session.WeekendInfo,
              TrackLength: `${lengthKm} km`,
            },
          },
        });
      };
      apply(useSessionStore.getState().session);
      return useSessionStore.subscribe((state) => apply(state.session));
    }, []);
    return <Story />;
  };
  return DecoratorComponent;
};

const story = (
  snapshot: MinimapSnapshot,
  config: Record<string, unknown> = {},
  extra: Decorator[] = []
) => ({
  decorators: [
    ...extra,
    TelemetryDecoratorWithConfig('/test-data/1747384033336', {
      minimap: config,
    }),
    ChannelSnapshotDecorator({ 'minimap.snapshot': snapshot }),
    // The widget fills its overlay window; the story supplies one of the
    // default size, over a mid-grey that stands in for the sim behind it.
    (Story: React.ComponentType) => (
      <div style={{ width: 300, height: 300, background: '#64748b' }}>
        <Story />
      </div>
    ),
  ],
});

const meta: Meta<typeof Minimap> = {
  component: Minimap,
  title: 'widgets/Minimap',
};

export default meta;

type Story = StoryObj<typeof Minimap>;

/** iRacing: a group of cars through the Senna S at Interlagos. */
export const Battle: Story = {
  ...story(field(0.06, battle)),
};

/** The same moment turned so the player's car points up. */
export const HeadingUp: Story = {
  ...story(field(0.06, battle), { orientation: 'heading' }),
};

/** Pulled out to 600 m: more of the lap, smaller neighbours. */
export const WideRange: Story = {
  ...story(field(0.06, battle), { range: 600 }),
};

/** Car numbers in the markers, and a car in the pits drawn faded. */
export const CarNumbersAndPits: Story = {
  ...story(field(0.985, { 1: 0.008, 2: -0.004, 21: -0.012 }, [21]), {
    label: 'carNumber',
    range: 200,
  }),
};

/** Class positions, one colour for every marker. */
export const NoClassColors: Story = {
  ...story(field(0.06, battle), {
    label: 'classPosition',
    useClassColors: false,
  }),
};

/**
 * Le Mans Ultimate: the map comes with the session. The Mulsanne chicane at
 * Le Mans, where the 512-point map is at its coarsest.
 */
export const LeMansUltimate: Story = {
  ...story(field(0.33, { 1: 0.004, 2: -0.003, 21: 0.009 }), {}, [
    WithLmuMap('Circuit de la Sarthe', 13.626),
  ]),
};

/** Laguna Seca in LMU, heading up through the Corkscrew. */
export const LagunaSecaHeadingUp: Story = {
  ...story(
    field(0.74, { 1: 0.01, 2: -0.008, 22: 0.02 }),
    { orientation: 'heading', range: 180 },
    [WithLmuMap('WeatherTech Raceway Laguna Seca', 3.59)]
  ),
};

/** No focus car yet: the disc alone, so the widget can still be placed. */
export const NoCars: Story = {
  ...story({
    focusCarIdx: null,
    carIdxLapDistPct: [],
    carIdxOnPitRoad: [],
    carIdxPosition: [],
    carIdxClassPosition: [],
    sessionNum: null,
    version: 1,
  }),
};
