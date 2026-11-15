import type { WidgetRuntimeDefinition } from '../../widgetRuntime';

export default {
  id: 'stinthistory',
  // Session visibility resolves the session type through SessionStore.
  sessionData: true,
  // Finished stints and their laps come with the ledger, the stint under way
  // on its own channel. track-state carries the driving state the widget
  // hides by. Neither ledger channel has a processor to wake: the runtime
  // behind them follows every lap whether or not this widget is on screen.
  channels: [
    'player-ledger.snapshot',
    'player-stint.snapshot',
    'track-state.snapshot',
  ],
  ratePreset: 'static',
  // The ledger moves when a lap or a stint ends; the stint under way about
  // once a second, which is as often as its figures change.
  channelRates: {
    'player-ledger.snapshot': 2,
    'player-stint.snapshot': 2,
  },
} satisfies WidgetRuntimeDefinition;
