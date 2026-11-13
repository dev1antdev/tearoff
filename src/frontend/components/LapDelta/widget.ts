import { lazyWidget } from '@irdashies/domain/lazyWidget';
import type { WidgetModule } from '@irdashies/domain';

export default {
  id: 'lapdelta',
  component: lazyWidget(() =>
    import('./LapDelta').then((module) => ({ default: module.LapDelta }))
  ),
} satisfies WidgetModule;
