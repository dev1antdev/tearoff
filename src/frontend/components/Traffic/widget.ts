import { lazyWidget } from '@irdashies/domain/lazyWidget';
import type { WidgetModule } from '@irdashies/domain';

export default {
  id: 'traffic',
  component: lazyWidget(() =>
    import('./Traffic').then((module) => ({ default: module.Traffic }))
  ),
} satisfies WidgetModule;
