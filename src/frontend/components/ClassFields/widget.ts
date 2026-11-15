import { lazyWidget } from '@irdashies/domain/lazyWidget';
import type { WidgetModule } from '@irdashies/domain';

export default {
  id: 'classfields',
  component: lazyWidget(() =>
    import('./ClassFields').then((module) => ({ default: module.ClassFields }))
  ),
} satisfies WidgetModule;
