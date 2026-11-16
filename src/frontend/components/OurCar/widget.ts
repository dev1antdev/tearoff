import { lazyWidget } from '@irdashies/domain/lazyWidget';
import type { WidgetModule } from '@irdashies/domain';

export default {
  id: 'ourcar',
  component: lazyWidget(() =>
    import('./OurCar').then((module) => ({ default: module.OurCar }))
  ),
} satisfies WidgetModule;
