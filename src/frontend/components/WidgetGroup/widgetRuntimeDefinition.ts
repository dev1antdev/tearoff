import type { WidgetRuntimeDefinition } from '../../widgetRuntime';

export default {
  id: 'widgetgroup',
  // For its own visibility rules. Each member reads its channels at the
  // rates of its own definition.
  sessionData: true,
  channels: ['track-state.snapshot'],
  ratePreset: 'gapTiming',
} satisfies WidgetRuntimeDefinition;
