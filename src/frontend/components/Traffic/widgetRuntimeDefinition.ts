import type { WidgetRuntimeDefinition } from '../../widgetRuntime';

export default {
  id: 'traffic',
  // The number, driver and class of each car are looked up in the session,
  // and so are the track's corners, its length and its pit speed limit.
  sessionData: true,
  // Where the pit exit is on the lap, as the Pit Lane Helper learns it.
  pitLaneData: true,
  channels: [
    // Who is coming, and when.
    'traffic.snapshot',
    // The driving state the widget hides on, the session clock the pit exit
    // block is held by, and the player's place and speed in the pit lane.
    'track-state.snapshot',
  ],
  ratePreset: 'gapTiming',
} satisfies WidgetRuntimeDefinition;
