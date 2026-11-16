import { defineWidgetManifest } from './types';

const decimalOptions = [
  { value: 1, label: '0.0' },
  { value: 2, label: '0.00' },
  { value: 3, label: '0.000' },
] as const;

export default defineWidgetManifest({
  id: 'timing',
  name: 'Timing',
  category: 'Lap Timing',
  enabled: false,
  // Sized for the three default rows; each optional row wants about 48 px
  // more height.
  layout: {
    x: 240,
    y: 640,
    width: 300,
    height: 170,
  },
  config: {
    background: { opacity: 80 },
    tiles: {
      lap: true,
      delta: true,
      lastLap: true,
      bestLap: true,
      sectors: true,
      currentLap: false,
      predictedLap: false,
      sessionBest: false,
      allTimeBest: false,
      stintBest: false,
      pace: false,
    },
    deltaReference: 'sessionBest',
    deltaDecimals: 3,
    lapTimeDecimals: 3,
    sectorDecimals: 3,
    sectorSource: 'live',
    sectorIncidents: 'mark',
    sectorTilesMax: 6,
    sessionBestScope: 'class',
    scale: 100,
    showOnlyWhenOnTrack: true,
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
    scale: {
      type: 'number',
      label: 'Text Scale',
      description:
        'Size of the labels and figures. Resize the widget to give larger text more room.',
      min: 50,
      max: 200,
      step: 5,
      units: '%',
    },
    'tiles.lap': {
      type: 'boolean',
      label: 'Lap',
      description: 'The lap you are driving.',
    },
    'tiles.delta': {
      type: 'boolean',
      label: 'Delta',
      description:
        'How far up or down you are on the reference lap at this point of the track.',
    },
    'tiles.lastLap': {
      type: 'boolean',
      label: 'Last Lap',
      description:
        'Purple when it is the best of the session, green when it is your own best. A lap that did not count is greyed with a warning mark.',
    },
    'tiles.bestLap': {
      type: 'boolean',
      label: 'Best Lap',
      description:
        'Your best lap of the session. A crown marks it when it is also the best of the session.',
    },
    'tiles.sectors': {
      type: 'boolean',
      label: 'Sector Times',
      description:
        'One tile per sector, with a bar coloured against your best time for that sector.',
    },
    'tiles.currentLap': {
      type: 'boolean',
      label: 'Current Lap',
      description: 'The running time of the lap in progress.',
    },
    'tiles.predictedLap': {
      type: 'boolean',
      label: 'Predicted Lap',
      description:
        'The lap time you are heading for: the reference lap plus the current delta.',
    },
    'tiles.sessionBest': {
      type: 'boolean',
      label: 'Session Best',
      description: "The fastest lap of the session, yours or anyone's.",
    },
    'tiles.allTimeBest': {
      type: 'boolean',
      label: 'All-Time Best',
      description:
        'Your best clean lap on this track in this car, kept between sessions.',
    },
    'tiles.stintBest': {
      type: 'boolean',
      label: 'Stint Best',
      description:
        'Your best clean lap since the stint began: since your last stop for fuel, energy, tyres or a driver change.',
    },
    'tiles.pace': {
      type: 'boolean',
      label: 'Pace',
      description: 'Your recent pace: the median of your last laps.',
    },
    deltaReference: {
      type: 'enum',
      label: 'Reference Lap',
      description:
        'The lap the delta and the predicted lap are measured against. Session best is your best clean lap since the session began. All-time best is your best clean lap on this track in this car, kept between sessions. Stint best is your best clean lap since your last stop. Last lap is the lap you have just driven, clean or not. Until the chosen lap exists the tiles show dashes.',
      options: [
        { value: 'sessionBest', label: 'Session Best' },
        { value: 'allTime', label: 'All-Time Best' },
        { value: 'stintBest', label: 'Stint Best' },
        { value: 'lastLap', label: 'Last Lap' },
      ],
    },
    deltaDecimals: {
      type: 'enum',
      label: 'Delta Precision',
      options: [
        { value: 2, label: '0.00' },
        { value: 3, label: '0.000' },
      ],
    },
    lapTimeDecimals: {
      type: 'enum',
      label: 'Lap Time Precision',
      options: decimalOptions,
    },
    sectorDecimals: {
      type: 'enum',
      label: 'Sector Time Precision',
      options: decimalOptions,
    },
    sectorSource: {
      type: 'enum',
      label: 'Sector Tiles Show',
      description:
        "This Lap shows each sector once you complete it and the previous lap's time, dimmed, until then. This Lap Only leaves a sector empty until you complete it. Best shows your best time for each sector this session.",
      options: [
        { value: 'live', label: 'This Lap' },
        { value: 'liveOnly', label: 'This Lap Only' },
        { value: 'best', label: 'Best' },
      ],
    },
    sectorIncidents: {
      type: 'enum',
      label: 'Sectors With An Incident',
      description:
        'Mark keeps the time of a sector where you left the track or the lap was voided, with a warning mark. Leave Out ignores it, as if the sector had not been driven.',
      options: [
        { value: 'mark', label: 'Mark' },
        { value: 'drop', label: 'Leave Out' },
      ],
    },
    sectorTilesMax: {
      type: 'number',
      label: 'Sector Tiles In The Row',
      description:
        'On a track with more sectors than this, the row follows you round the lap.',
      min: 3,
      max: 8,
      step: 1,
    },
    sessionBestScope: {
      type: 'enum',
      label: 'Session Best Among',
      description:
        'Whose laps count as the session best, for the Session Best tile and for the purple of a lap that matches it.',
      options: [
        { value: 'class', label: 'My Class' },
        { value: 'overall', label: 'All Cars' },
      ],
    },
    showOnlyWhenOnTrack: {
      type: 'boolean',
      label: 'Show Only When On Track',
      description:
        'Hidden in the garage and in the menus. Shown while you drive, and while you watch your own car with a team-mate driving it.',
    },
  },
});
