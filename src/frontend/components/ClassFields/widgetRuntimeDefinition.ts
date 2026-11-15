import type { WidgetRuntimeDefinition } from '../../widgetRuntime';

export default {
  id: 'classfields',
  // The classes, their names and colours and the cars entered in each come
  // from the session's driver list; session visibility resolves the session
  // type from it too.
  sessionData: true,
  channels: [
    // Where each car is, its place and finish status, and the focus car.
    'standings.snapshot',
    // The driving state the widget hides on.
    'track-state.snapshot',
  ],
  // No rate of its own: the counts are re-read at the standings channel's
  // 5 Hz and the widget re-renders only when one of them changes.
  ratePreset: 'static',
} satisfies WidgetRuntimeDefinition;
