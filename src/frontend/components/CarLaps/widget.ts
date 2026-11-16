import { lazyWidget } from '@irdashies/domain/lazyWidget';
import type { WidgetModule } from '@irdashies/domain';

export default {
  id: 'carlaps',
  component: lazyWidget(() =>
    import('./CarLaps').then((module) => ({ default: module.CarLaps }))
  ),
} satisfies WidgetModule;
