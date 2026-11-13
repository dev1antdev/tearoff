import { lazyWidget } from '@irdashies/domain/lazyWidget';
import type { WidgetModule } from '@irdashies/domain';

export default {
  id: 'minimap',
  component: lazyWidget(() =>
    import('./Minimap').then((module) => ({ default: module.Minimap }))
  ),
} satisfies WidgetModule;
