import { defineWidgetManifest } from './types';

export default defineWidgetManifest({
  id: 'weatherforecast',
  name: 'Weather Forecast',
  category: 'Session & Weather',
  enabled: false,
  layout: {
    x: 6,
    y: 6,
    // Low and wide: "Now" and four coming points side by side.
    width: 300,
    height: 100,
  },
  config: {
    background: { opacity: 80 },
    nodes: 4,
    showNow: true,
    reverse: false,
    timeLabel: 'countdown',
    units: 'auto',
    temperature: { enabled: true },
    rainChance: { enabled: true, showValue: false },
    humidity: { enabled: false },
    wind: { enabled: false },
    trend: { enabled: true },
    hideEmptyColumns: true,
    showOnlyWhenOnTrack: false,
    sessionVisibility: {
      race: true,
      loneQualify: true,
      openQualify: true,
      practice: true,
      offlineTesting: true,
    },
  },
  properties: {
    'background.opacity': {
      type: 'number',
      label: 'Background Opacity',
      description: 'Opacity of the widget background.',
      min: 0,
      max: 100,
      step: 5,
      units: '%',
    },
    nodes: {
      type: 'number',
      label: 'Forecast Columns',
      description:
        'How many coming points of the forecast to show after "Now". The sim gives four for a session.',
      min: 1,
      max: 4,
      step: 1,
    },
    showNow: {
      type: 'boolean',
      label: 'Show Now',
      description: 'The weather as it is, as the first column.',
    },
    reverse: {
      type: 'boolean',
      label: 'Right To Left',
      description: 'Puts "Now" on the right and the latest point on the left.',
    },
    timeLabel: {
      type: 'enum',
      label: 'Column Heading',
      description:
        'When each point starts: as time from now, or as the in-game clock time it starts at. Either is an estimate, and marked with ~.',
      options: [
        { value: 'countdown', label: 'Time To Go' },
        { value: 'clock', label: 'Clock Time' },
      ],
    },
    units: {
      type: 'enum',
      label: 'Units',
      description: 'For the temperature and the wind speed.',
      options: [
        { value: 'auto', label: 'Auto' },
        { value: 'Metric', label: '°C, km/h' },
        { value: 'Imperial', label: '°F, mph' },
      ],
    },
    'temperature.enabled': {
      type: 'boolean',
      label: 'Show Temperature',
      description: 'The air temperature now and at each point.',
    },
    'rainChance.enabled': {
      type: 'boolean',
      label: 'Show Rain',
      description:
        'A bar under each column: how hard it is raining now, and the chance of rain at each point.',
    },
    'rainChance.showValue': {
      type: 'boolean',
      label: 'Show Rain Percentage',
      description: 'The figure beside the bar.',
    },
    'humidity.enabled': {
      type: 'boolean',
      label: 'Show Humidity',
      description: 'For the forecast points; the sim states none for now.',
    },
    'wind.enabled': {
      type: 'boolean',
      label: 'Show Wind',
      description:
        'The wind the forecast states. Le Mans Ultimate does not apply wind on track, so it is not felt in the car.',
    },
    'trend.enabled': {
      type: 'boolean',
      label: 'Show Trend Arrows',
      description:
        'Arrows in "Now" while the temperature or the rain is on the move, for a minute after each change.',
    },
    hideEmptyColumns: {
      type: 'boolean',
      label: 'Hide Empty Columns',
      description:
        'Leaves out a column once its point has begun, so the row gets shorter as the session goes on. Off keeps the row at its full width with dashes.',
    },
    showOnlyWhenOnTrack: {
      type: 'boolean',
      label: 'Show only when on track',
      description:
        'Hidden in the garage and in the menus. Shown while you drive and while you watch a car on track.',
    },
  },
});
