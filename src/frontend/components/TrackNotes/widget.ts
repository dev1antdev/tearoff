import { lazyWidget } from '@irdashies/domain/lazyWidget';
import type { WidgetModule } from '@irdashies/domain';

export default {
  id: 'tracknotes',
  component: lazyWidget(() =>
    import('./TrackNotes').then((module) => ({ default: module.TrackNotes }))
  ),
} satisfies WidgetModule;
