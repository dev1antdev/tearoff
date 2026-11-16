import { lazyWidget } from '@irdashies/domain/lazyWidget';
import type { WidgetModule } from '@irdashies/domain';

export default {
  id: 'finishorder',
  component: lazyWidget(() =>
    import('./FinishProjection').then((module) => ({
      default: module.FinishProjection,
    }))
  ),
} satisfies WidgetModule;
