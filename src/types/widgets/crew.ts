import { CREW_DRIVE_TIME_MAX_MINUTES } from '../widgetConfigs';
import { defineWidgetManifest } from './types';

export default defineWidgetManifest({
  id: 'crew',
  name: 'Crew and Stints',
  category: 'Standings',
  enabled: false,
  layout: {
    x: 300,
    y: 300,
    // Three drivers with their bars, and six stints without scrolling.
    width: 660,
    height: 420,
  },
  config: {
    background: { opacity: 80 },
    // Off: the limits are a league's, and nothing in a sim states them.
    driveTime: { enabled: false, maxMinutes: 240, minMinutes: 90 },
    showDrivers: true,
    showStints: true,
    // Off, so it can be read from the garage and the pit wall.
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
    showDrivers: {
      type: 'boolean',
      label: 'Drivers',
      description:
        'A row for each driver who has been at the wheel: stints, time at the wheel, mean clean lap and best lap.',
    },
    showStints: {
      type: 'boolean',
      label: 'Stints',
      description:
        'Every stint of the car, newest first, with the stop that ended it.',
    },
    'driveTime.enabled': {
      type: 'boolean',
      label: 'Drive-Time Limits',
      description:
        'A bar for each driver of time driven against the maximum, with a mark at the minimum and what the driver still owes. Enter the limits your league sets: neither simulator states them.',
    },
    'driveTime.maxMinutes': {
      type: 'number',
      control: 'input',
      label: 'Maximum per Driver',
      description:
        'The most one driver may drive in the race. The bar is full at this, and turns red past it.',
      min: 1,
      max: CREW_DRIVE_TIME_MAX_MINUTES,
      step: 5,
      units: 'min',
    },
    'driveTime.minMinutes': {
      type: 'number',
      control: 'input',
      label: 'Minimum per Driver',
      description:
        'The least each driver must drive. A driver short of it reads "needs" with the time still owed. 0 for no minimum.',
      min: 0,
      max: CREW_DRIVE_TIME_MAX_MINUTES,
      step: 5,
      units: 'min',
    },
    showOnlyWhenOnTrack: {
      type: 'boolean',
      label: 'Show Only When On Track',
      description:
        'Hide the widget while the car is in its garage. It stays while a team-mate drives the car.',
    },
  },
});
