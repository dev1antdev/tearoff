import { lazyWidget } from '@irdashies/domain/lazyWidget';
import type { WidgetModule } from '@irdashies/domain';

export default {
  id: 'timingtower',
  component: lazyWidget(() =>
    import('./TimingTower').then((module) => ({ default: module.TimingTower }))
  ),
} satisfies WidgetModule;
