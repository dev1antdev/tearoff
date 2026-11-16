import { lazyWidget } from '@irdashies/domain/lazyWidget';
import type { WidgetModule } from '@irdashies/domain';

export default {
  id: 'stinttimeline',
  component: lazyWidget(() =>
    import('./StintTimeline').then((module) => ({
      default: module.StintTimeline,
    }))
  ),
} satisfies WidgetModule;
