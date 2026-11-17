import { lazyWidget } from '@irdashies/domain/lazyWidget';
import type { WidgetModule } from '@irdashies/domain';

export default {
  id: 'racecharts',
  component: lazyWidget(() =>
    import('./RaceCharts').then((module) => ({ default: module.RaceCharts }))
  ),
} satisfies WidgetModule;
