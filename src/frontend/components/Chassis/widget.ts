import { lazyWidget } from '@irdashies/domain/lazyWidget';
import type { WidgetModule } from '@irdashies/domain';

export default {
  id: 'chassis',
  component: lazyWidget(() =>
    import('./Chassis').then((module) => ({ default: module.Chassis }))
  ),
} satisfies WidgetModule;
