import { lazyWidget } from '@irdashies/domain/lazyWidget';
import type { WidgetModule } from '@irdashies/domain';

export default {
  id: 'racelog',
  component: lazyWidget(() =>
    import('./RaceLog').then((module) => ({ default: module.RaceLog }))
  ),
} satisfies WidgetModule;
