import { describe, expect, it } from 'vitest';
import { PIT_STOP_READER, PIT_STOP_WIDGETS } from './app/pitStopDemand';
import { RACE_PLAN_WIDGETS } from './app/racePlanDemand';
import { getWidgetRuntimeDefinition } from './frontend/widgetRuntime';
import { KNOWN_WIDGET_IDS, PIT_WALL_WIDGET_ID } from './types';
import type { ChannelName } from './types';

/**
 * The main process records pit stops and fetches the race plan only while
 * the running simulator can show a widget they are for. It knows which
 * widgets those are from two lists of its own, because it may not import the
 * renderer's widget definitions. This spec sits above both and holds the
 * lists to what the widgets declare.
 */
const readersOf = (channel: ChannelName): string[] =>
  KNOWN_WIDGET_IDS.filter((id) =>
    getWidgetRuntimeDefinition(id).channels?.includes(channel)
  ).sort();

describe('main-process work done for sim-gated widgets', () => {
  it('records pit stops for every widget that reads them', () => {
    // A reader that is not on the list would be shown under a simulator
    // the stops are not recorded for, and get nothing.
    const readers = readersOf('pit-stops.snapshot');

    expect(readers).toEqual([PIT_STOP_READER]);
    for (const reader of readers) expect(PIT_STOP_WIDGETS).toContain(reader);
  });

  it('records them for the Pit Wall as well, which reads none itself', () => {
    // On the list so that a race's stops are on record while the page is
    // switched on, under either simulator. The day the page declares the
    // channel it is a reader like the Gantry, and this case goes.
    expect([...PIT_STOP_WIDGETS].sort()).toEqual(
      [...readersOf('pit-stops.snapshot'), PIT_WALL_WIDGET_ID].sort()
    );
    expect(
      getWidgetRuntimeDefinition(PIT_WALL_WIDGET_ID).channels ?? []
    ).not.toContain('pit-stops.snapshot');
  });

  it('fetches the race plan for every widget that follows one', () => {
    // A reader missing from the list could be shown under a simulator the
    // plan is never fetched for.
    expect(readersOf('race-plan.progress')).toEqual(
      [...RACE_PLAN_WIDGETS].sort()
    );
  });
});
