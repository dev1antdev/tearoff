import { lazyWidget } from '@irdashies/domain/lazyWidget';
import type { WidgetModule } from '@irdashies/domain';

export default {
  id: 'crew',
  component: lazyWidget(() =>
    import('./Crew').then((module) => ({ default: module.Crew }))
  ),
} satisfies WidgetModule;
