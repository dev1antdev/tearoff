import { lazyWidget } from '@irdashies/domain/lazyWidget';
import type { WidgetModule } from '@irdashies/domain';

export default {
  id: 'elevation',
  component: lazyWidget(() =>
    import('./Elevation').then((module) => ({ default: module.Elevation }))
  ),
} satisfies WidgetModule;
