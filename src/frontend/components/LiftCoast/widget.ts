import { lazyWidget } from '@irdashies/domain/lazyWidget';
import type { WidgetModule } from '@irdashies/domain';

export default {
  id: 'liftcoast',
  component: lazyWidget(() =>
    import('./LiftCoast').then((module) => ({ default: module.LiftCoast }))
  ),
} satisfies WidgetModule;
