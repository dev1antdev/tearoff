import { lazyWidget } from '@irdashies/domain/lazyWidget';
import type { WidgetModule } from '@irdashies/domain';

export default {
  id: 'fuelsaver',
  component: lazyWidget(() =>
    import('./FuelSaver').then((module) => ({ default: module.FuelSaver }))
  ),
} satisfies WidgetModule;
