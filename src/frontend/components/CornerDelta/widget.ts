import { lazyWidget } from '@irdashies/domain/lazyWidget';
import type { WidgetModule } from '@irdashies/domain';

export default {
  id: 'cornerdelta',
  component: lazyWidget(() =>
    import('./CornerDelta').then((module) => ({ default: module.CornerDelta }))
  ),
} satisfies WidgetModule;
