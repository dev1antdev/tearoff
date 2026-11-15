import { lazyWidget } from '@irdashies/domain/lazyWidget';
import type { WidgetModule } from '@irdashies/domain';

export default {
  id: 'brakeperformance',
  component: lazyWidget(() =>
    import('./BrakePerformance').then((module) => ({
      default: module.BrakePerformance,
    }))
  ),
} satisfies WidgetModule;
