import { lazyWidget } from '@irdashies/domain/lazyWidget';
import type { WidgetModule } from '@irdashies/domain';

export default {
  id: 'wear',
  component: lazyWidget(() =>
    import('./Wear').then((module) => ({ default: module.Wear }))
  ),
} satisfies WidgetModule;
