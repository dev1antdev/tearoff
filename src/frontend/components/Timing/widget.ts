import { lazyWidget } from '@irdashies/domain/lazyWidget';
import type { WidgetModule } from '@irdashies/domain';

export default {
  id: 'timing',
  component: lazyWidget(() =>
    import('./Timing').then((module) => ({ default: module.Timing }))
  ),
} satisfies WidgetModule;
