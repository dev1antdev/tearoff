import { lazyWidget } from '@irdashies/domain/lazyWidget';
import type { WidgetModule } from '@irdashies/domain';

export default {
  id: 'systemperformance',
  component: lazyWidget(() =>
    import('./SystemPerformance').then((module) => ({
      default: module.SystemPerformance,
    }))
  ),
} satisfies WidgetModule;
