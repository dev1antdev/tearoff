import { lazyWidget } from '@irdashies/domain/lazyWidget';
import type { WidgetModule } from '@irdashies/domain';

export default {
  id: 'flagpanel',
  component: lazyWidget(() =>
    import('./FlagPanel').then((module) => ({ default: module.FlagPanel }))
  ),
} satisfies WidgetModule;
