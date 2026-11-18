import { lazyWidget } from '@irdashies/domain/lazyWidget';
import type { WidgetModule } from '@irdashies/domain';

export default {
  id: 'widgetgroup',
  component: lazyWidget(() =>
    import('./WidgetGroup').then((module) => ({
      default: module.WidgetGroup,
    }))
  ),
} satisfies WidgetModule;
