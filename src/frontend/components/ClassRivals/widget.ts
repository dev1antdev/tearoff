import { lazyWidget } from '@irdashies/domain/lazyWidget';
import type { WidgetModule } from '@irdashies/domain';

export default {
  id: 'classrivals',
  component: lazyWidget(() =>
    import('./ClassRivals').then((module) => ({
      default: module.ClassRivals,
    }))
  ),
} satisfies WidgetModule;
