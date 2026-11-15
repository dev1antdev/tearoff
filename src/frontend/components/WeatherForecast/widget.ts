import { lazyWidget } from '@irdashies/domain/lazyWidget';
import type { WidgetModule } from '@irdashies/domain';

export default {
  id: 'weatherforecast',
  component: lazyWidget(() =>
    import('./WeatherForecast').then((module) => ({
      default: module.WeatherForecast,
    }))
  ),
} satisfies WidgetModule;
