import { lazyWidget } from '@irdashies/domain/lazyWidget';
import type { WidgetModule } from '@irdashies/domain';

export default {
  id: 'tyres',
  component: lazyWidget(() =>
    import('./Tyres').then((module) => ({ default: module.Tyres }))
  ),
} satisfies WidgetModule;
