import { lazyWidget } from '@irdashies/domain/lazyWidget';
import type { WidgetModule } from '@irdashies/domain';

export default {
  id: 'pitwall',
  component: lazyWidget(() =>
    import('./PitWall').then((module) => ({ default: module.PitWall }))
  ),
} satisfies WidgetModule;
