import type { WidgetRuntimeDefinition } from '../../widgetRuntime';

export default {
  id: 'laptimelog',
  sessionData: true,
  // The timer runs on the lap log. The history is the player's ledger, and
  // the lap under way is read from the stint the ledger has open.
  channels: [
    'lap-log.snapshot',
    'player-ledger.snapshot',
    'player-stint.snapshot',
  ],
  ratePreset: 'driverFocused',
  // The ledger moves once or twice a lap and the stint about once a second:
  // neither needs the timer's rate.
  channelRates: {
    'player-ledger.snapshot': 2,
    'player-stint.snapshot': 5,
  },
} satisfies WidgetRuntimeDefinition;
