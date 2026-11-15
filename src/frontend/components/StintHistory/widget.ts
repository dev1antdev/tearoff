import { lazyWidget } from '@irdashies/domain/lazyWidget';
import type { WidgetModule } from '@irdashies/domain';

export default {
  id: 'stinthistory',
  component: lazyWidget(() =>
    import('./StintHistory').then((module) => ({
      default: module.StintHistory,
    }))
  ),
} satisfies WidgetModule;
