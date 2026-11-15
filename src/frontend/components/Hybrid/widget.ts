import { lazyWidget } from '@irdashies/domain/lazyWidget';
import type { WidgetModule } from '@irdashies/domain';

export default {
  id: 'hybrid',
  component: lazyWidget(() =>
    import('./Hybrid').then((module) => ({ default: module.Hybrid }))
  ),
} satisfies WidgetModule;
