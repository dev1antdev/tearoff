import { describe, expect, it } from 'vitest';
import { PIT_STOP_WIDGET } from './app/pitStopDemand';
import { RACE_PLAN_WIDGETS } from './app/racePlanDemand';
import { getWidgetRuntimeDefinition } from './frontend/widgetRuntime';
import { KNOWN_WIDGET_IDS } from './types';
import type { ChannelName } from './types';

/**
 * The main process records pit stops and fetches the race plan only while
 * the running simulator can show a widget that reads them. It knows which
 * widgets those are from two lists of its own, because it may not import the
 * renderer's widget definitions. This spec sits above both and holds the
 * lists to what the widgets declare.
 */
const readersOf = (channel: ChannelName): string[] =>
  KNOWN_WIDGET_IDS.filter((id) =>
    getWidgetRuntimeDefinition(id).channels?.includes(channel)
  ).sort();

describe('main-process work done for sim-gated widgets', () => {
  it('records pit stops for the only widget that reads them', () => {
    // Another reader added later would be shown under a simulator that
    // hides the Gantry, and get nothing.
    expect(readersOf('pit-stops.snapshot')).toEqual([PIT_STOP_WIDGET]);
  });

  it('fetches the race plan for every widget that follows one', () => {
    // A reader missing from the list could be shown under a simulator the
    // plan is never fetched for.
    expect(readersOf('race-plan.progress')).toEqual(
      [...RACE_PLAN_WIDGETS].sort()
    );
  });
});
