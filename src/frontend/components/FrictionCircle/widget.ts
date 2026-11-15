import { lazyWidget } from '@irdashies/domain/lazyWidget';
import type { WidgetModule } from '@irdashies/domain';

export default {
  id: 'frictioncircle',
  component: lazyWidget(() =>
    import('./FrictionCircle').then((module) => ({
      default: module.FrictionCircle,
    }))
  ),
} satisfies WidgetModule;
