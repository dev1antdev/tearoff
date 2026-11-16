import { defineWidgetManifest } from './types';

export default defineWidgetManifest({
  id: 'racelog',
  name: 'Race Log',
  category: 'Session & Weather',
  enabled: false,
  layout: {
    x: 300,
    y: 500,
    // A dozen lines under the row of switches, each long enough for a stop
    // with a driver change on one line.
    width: 460,
    height: 300,
  },
  config: {
    background: { opacity: 80 },
    time: 'timeOfDay',
    scope: 'all',
    kinds: {
      pits: true,
      drivers: true,
      fastestLaps: true,
      flags: true,
      status: true,
    },
    showFilters: true,
    // Off, so it can be read from the garage and the pit wall.
    showOnlyWhenOnTrack: false,
    sessionVisibility: {
      race: true,
      loneQualify: false,
      openQualify: false,
      practice: false,
      offlineTesting: false,
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
    time: {
      type: 'enum',
      label: 'Time On Each Line',
      description:
        'The clock in the sim, to the minute, or the session clock. An event the sim gave no clock time for shows the session clock either way.',
      options: [
        { value: 'timeOfDay', label: 'Clock In The Sim' },
        { value: 'session', label: 'Session Clock' },
      ],
    },
    scope: {
      type: 'enum',
      label: 'Cars Listed',
      description:
        'Whose events the list opens with. Flags and the forecast are about the whole field and are listed whichever is chosen.',
      options: [
        { value: 'all', label: 'All Cars' },
        { value: 'class', label: 'Our Class' },
        { value: 'car', label: 'Our Car' },
      ],
    },
    'kinds.pits': {
      type: 'boolean',
      label: 'Pit Stops',
      description:
        'A car into the pits with its place in class, out again with how long it stood and how long it was in the lane, and a pass down the lane without stopping.',
    },
    'kinds.drivers': {
      type: 'boolean',
      label: 'Driver Changes',
      description:
        'Another driver in a car. One made at a stop is on the line of the stop, which is listed while either this or Pit Stops is on.',
    },
    'kinds.fastestLaps': {
      type: 'boolean',
      label: 'Fastest Laps',
      description:
        'Each class’s fastest lap so far, from the third lap of the class on. When several cars better it within a quarter of a minute, the one that stands is listed.',
    },
    'kinds.flags': {
      type: 'boolean',
      label: 'Flags And Forecast',
      description:
        'The start, a full-course yellow or safety car and how long it lasted, a red flag, the chequered flag, and a change in Le Mans Ultimate’s forecast. Local yellows are not listed.',
    },
    'kinds.status': {
      type: 'boolean',
      label: 'Cars Out, Penalties, Our Place',
      description:
        'A car in its garage or out of the session for five minutes and back again, a penalty given and served where the sim says so, and our car’s place in class once it has held for a little over a lap.',
    },
    showFilters: {
      type: 'boolean',
      label: 'Switches Over The List',
      description:
        'A row over the list to change which cars and which kinds of event are listed. What is switched there is not saved: the list opens as set on this page.',
    },
    showOnlyWhenOnTrack: {
      type: 'boolean',
      label: 'Show Only When On Track',
      description:
        'Hide the widget while the car is in its garage. It stays while a team-mate drives the car.',
    },
  },
});
