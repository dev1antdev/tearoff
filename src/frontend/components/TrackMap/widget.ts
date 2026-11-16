import { lazyWidget } from '@irdashies/domain/lazyWidget';
import type { WidgetModule } from '@irdashies/domain';

export default [
  {
    id: 'map',
    component: lazyWidget(() =>
      import('./MapWidgets').then((module) => ({
        default: module.TrackMapWidget,
      }))
    ),
  },
  {
    id: 'flatmap',
    component: lazyWidget(() =>
      import('./MapWidgets').then((module) => ({
        default: module.FlatTrackMapWidget,
      }))
    ),
  },
] satisfies WidgetModule[];
