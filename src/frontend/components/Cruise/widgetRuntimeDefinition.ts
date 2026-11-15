import type { WidgetRuntimeDefinition } from '../../widgetRuntime';

export default {
  id: 'cruise',
  // Session visibility resolves the session type through SessionStore.
  sessionData: true,
  // The readings, session-bar for the display units, and track-state for
  // the driving state the widget hides on.
  channels: ['cruise.snapshot', 'session-bar.snapshot', 'track-state.snapshot'],
  // Figures to read. The dial eases between snapshots rather than asking
  // for a faster channel.
  ratePreset: 'gapTiming',
} satisfies WidgetRuntimeDefinition;
