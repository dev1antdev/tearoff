import { lazyWidget } from '@irdashies/domain/lazyWidget';
import type { WidgetModule } from '@irdashies/domain';

export default {
  id: 'pitstop',
  component: lazyWidget(() =>
    import('./PitStop').then((module) => ({ default: module.PitStop }))
  ),
} satisfies WidgetModule;
