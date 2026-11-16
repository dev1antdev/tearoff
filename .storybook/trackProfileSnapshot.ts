import type { TrackNote, TrackProfileSnapshot } from '@irdashies/types';

/**
 * A lap of Laguna Seca as the track profile channel publishes it: 360
 * buckets of ten metres, the heights shifted so the lowest point is 0.
 *
 * Drawn through a handful of heights along the lap rather than recorded:
 * the line 4.8 m above the flat run after the Andretti Hairpin, the climb
 * up the back of the hill to the Corkscrew at 55.2 m some 2.4 km round, and
 * the drop from it back to the line.
 */
const SHAPE: readonly (readonly [bucket: number, heightM: number])[] = [
  [0, 4.8],
  [20, 3],
  [53, 0.3],
  [66, 0],
  [79, 0.4],
  [100, 6],
  [130, 14],
  [150, 20.5],
  [180, 30],
  [210, 44],
  [232, 53.5],
  [239, 55.2],
  [246, 49],
  [255, 38],
  [270, 27],
  [290, 18],
  [310, 11],
  [335, 6.5],
  [360, 4.8],
];

const lagunaSecaElevation: readonly number[] = Array.from(
  { length: 360 },
  (_, bucket) => {
    const upper = SHAPE.findIndex(([at]) => at > bucket);
    const [fromAt, from] = SHAPE[upper - 1];
    const [toAt, to] = SHAPE[upper];
    // Eased between the two, so the profile has no corners of its own.
    const share =
      (1 - Math.cos(((bucket - fromAt) / (toAt - fromAt)) * Math.PI)) / 2;
    return Math.round((from + (to - from) * share) * 10) / 10;
  }
);

const note = (
  id: string,
  distanceM: number,
  kind: TrackNote['kind'],
  text: string,
  extra: Partial<TrackNote> = {}
): TrackNote => ({
  id,
  distanceM,
  kind,
  text,
  comment: '',
  pit: false,
  ...extra,
});

/** Notes for the same lap: both kinds, one with a comment, one for the pits. */
export const lagunaSecaStoryNotes: readonly TrackNote[] = [
  note('n01', 62, 'track', 'Pit exit: stay right of the line', {
    pit: true,
    comment: 'Blend in after the bridge',
  }),
  note('n02', 180.5, 'pace', 'Brake at the 100 board'),
  note('n03', 285, 'track', 'Andretti Hairpin', {
    comment: 'Double apex\nLate on the power',
  }),
  note('n04', 705.2, 'pace', 'Flat through Turn 3'),
  note('n05', 1010, 'track', 'Turn 4'),
  note('n06', 1480, 'pace', 'Lift, then brake uphill'),
  note('n07', 1540, 'track', 'Turn 5'),
  note('n08', 2150, 'pace', 'Blind crest: brake at the bridge', {
    comment: 'Turn in before you can see the apex\nAim at the tree',
  }),
  note('n09', 2390.4, 'track', 'The Corkscrew'),
  note('n10', 2725, 'track', 'Rainey Curve'),
  note('n11', 3190, 'pace', 'Brake late into Turn 11'),
  note('n12', 3260, 'track', 'Turn 11'),
];

/** The recorded profile of Laguna Seca under Le Mans Ultimate, with notes. */
export const trackProfileStorySnapshot: TrackProfileSnapshot = {
  trackKey: 'lmu:694510461',
  trackLengthM: 3590.35,
  elevationM: lagunaSecaElevation,
  lineElevationM: 4.8,
  elevationRangeM: 55.2,
  elevationSource: 'recorded',
  recordingProgress: null,
  sectorStartPct: [0, 0.39, 0.792],
  sectorSource: 'learned',
  notes: lagunaSecaStoryNotes,
  sessionNum: 0,
  version: 1,
};

/** The same track before any lap of it has been driven: nothing known. */
export const emptyTrackProfileStorySnapshot: TrackProfileSnapshot = {
  ...trackProfileStorySnapshot,
  elevationM: [],
  lineElevationM: 0,
  elevationRangeM: 0,
  elevationSource: null,
  sectorStartPct: [],
  sectorSource: 'nominal',
  notes: [],
};
