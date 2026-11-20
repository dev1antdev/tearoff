import { numberOptions } from './properties';
import { defineWidgetManifest } from './types';

export default defineWidgetManifest({
  id: 'traffic',
  name: 'Traffic',
  category: 'Spotter & Safety',
  enabled: false,
  layout: {
    x: 300,
    y: 160,
    // Three rows of the mirror, the forecast line and the table under them.
    width: 330,
    height: 184,
  },
  config: {
    background: { opacity: 80 },
    showMirror: true,
    mirrorRows: 3,
    showRival: true,
    showClosingRate: true,
    showForecast: true,
    cornerLabel: 'name',
    showSlowerAhead: true,
    showLeader: true,
    showFasterBehind: true,
    label: 'driver',
    maxLaps: 10,
    highlightThisLap: true,
    showOutsideRace: false,
    showPitExit: true,
    aheadWindow: 10,
    behindWindow: 15,
    behindCount: 2,
    careGap: 2,
    dangerGap: 1,
    exitHold: 10,
    showWhenSlow: true,
    showOnlyWhenOnTrack: true,
    sessionVisibility: {
      race: true,
      loneQualify: false,
      openQualify: false,
      practice: true,
      offlineTesting: true,
    },
  },
  properties: {
    'background.opacity': {
      type: 'number',
      label: 'Background Opacity',
      min: 0,
      max: 100,
      step: 5,
      units: '%',
    },
    showMirror: {
      type: 'boolean',
      label: 'Show Cars Behind',
      description:
        'The cars closing from behind, nearest first: number by its class colour, gap, and an arrow for how fast it is closing.',
    },
    mirrorRows: {
      type: 'enum',
      label: 'Rows',
      description: 'Cars listed behind. More are counted, not drawn.',
      options: numberOptions(1, 4),
      control: 'select',
    },
    showRival: {
      type: 'boolean',
      label: 'Show The Rival Right Behind',
      description:
        'A car of your class on your lap within three seconds. It is racing you, not traffic, and is drawn muted.',
    },
    showClosingRate: {
      type: 'boolean',
      label: 'Show Closing Rate',
      description: 'Seconds a lap each car is gaining, beside its arrow.',
    },
    showForecast: {
      type: 'boolean',
      label: 'Show Arrival Forecast',
      description:
        'When and where the car catching you arrives. Only once it has closed steadily for a few seconds, and with a corner only for an arrival within about twenty seconds.',
    },
    cornerLabel: {
      type: 'enum',
      label: 'Corner',
      description: 'Name the corner of a forecast, or number it.',
      options: [
        { value: 'name', label: 'Name' },
        { value: 'number', label: 'Number' },
      ],
    },
    label: {
      type: 'enum',
      label: 'Car Label',
      description: 'What is written beside the car number.',
      options: [
        { value: 'driver', label: 'Driver' },
        { value: 'class', label: 'Class' },
        { value: 'number', label: 'Number Only' },
      ],
    },
    showSlowerAhead: {
      type: 'boolean',
      label: 'Show Catching',
      description: 'The car ahead you reach soonest, in laps.',
    },
    showLeader: {
      type: 'boolean',
      label: 'Show Leader',
      description: 'Laps until the race leader comes round to lap you.',
    },
    showFasterBehind: {
      type: 'boolean',
      label: 'Show Caught By',
      description: 'The car behind that reaches you soonest, in laps.',
    },
    maxLaps: {
      type: 'number',
      label: 'Furthest Contact',
      description: 'A meeting further off than this is drawn as a dash.',
      min: 1,
      max: 50,
      step: 1,
      units: 'laps',
    },
    highlightThisLap: {
      type: 'boolean',
      label: 'Highlight This Lap',
      description: 'Mark a meeting that falls inside the lap under way.',
    },
    showOutsideRace: {
      type: 'boolean',
      label: 'Show Outside Races',
      description:
        'The cars behind and the table in practice and qualifying too. There a car counts as traffic when it is closing.',
    },
    showPitExit: {
      type: 'boolean',
      label: 'Show Pit Exit Traffic',
      description:
        'While you are in the pit lane, who comes past the pit exit ahead of you and who arrives behind. It needs the pit exit of the track to have been seen once.',
    },
    showWhenSlow: {
      type: 'boolean',
      label: 'Also When Slow Or Off Track',
      description:
        'The car arriving behind when you are slower than 29 km/h on the track, or off it.',
    },
    aheadWindow: {
      type: 'number',
      label: 'Listed Ahead',
      description:
        'A car passing the pit exit this long before you get there is listed.',
      min: 0,
      max: 30,
      step: 1,
      units: 's',
    },
    behindWindow: {
      type: 'number',
      label: 'Listed Behind',
      description: 'And one arriving this long after you.',
      min: 1,
      max: 60,
      step: 1,
      units: 's',
    },
    behindCount: {
      type: 'enum',
      label: 'Cars Behind',
      options: numberOptions(1, 4),
      control: 'select',
    },
    careGap: {
      type: 'number',
      label: 'Caution Gap',
      description:
        'A car arriving closer behind than this turns the block amber.',
      min: 0,
      max: 10,
      step: 0.5,
      units: 's',
    },
    dangerGap: {
      type: 'number',
      label: 'Danger Gap',
      description: 'Closer than this turns it red.',
      min: 0,
      max: 10,
      step: 0.5,
      units: 's',
    },
    exitHold: {
      type: 'number',
      label: 'Stay After The Exit',
      description:
        'How long the block stays after the pit exit, and after being slow.',
      min: 0,
      max: 30,
      step: 1,
      units: 's',
    },
    showOnlyWhenOnTrack: {
      type: 'boolean',
      label: 'Show only when on track',
      description:
        'Hidden in the garage and in the menus. Shown while you drive, and for your own car while a team-mate drives it.',
    },
  },
});
