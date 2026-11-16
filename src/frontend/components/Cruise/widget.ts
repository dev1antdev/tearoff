import { lazyWidget } from '@irdashies/domain/lazyWidget';
import type { WidgetModule } from '@irdashies/domain';

export default {
  id: 'cruise',
  component: lazyWidget(() =>
    import('./Cruise').then((module) => ({ default: module.Cruise }))
  ),
} satisfies WidgetModule;
