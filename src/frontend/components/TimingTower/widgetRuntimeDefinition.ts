import type { WidgetRuntimeDefinition } from '../../widgetRuntime';

export default {
  id: 'timingtower',
  // The field, its classes, names and teams come from the session's driver
  // list, and the places from its results.
  sessionData: true,
  // Where the pit exit is, for the lap a car is marked OUT on.
  pitLaneData: true,
  channels: [
    // Every car's place, gap, lap times, pit road, energy and compound.
    'standings.snapshot',
    // The laps Avg 5 and Avg 10 are made of. Read only while one is on.
    'lap-times.snapshot',
    // Stops made and laps since the last. Read only while either is on.
    'car-pit.snapshot',
    // Every car's sectors and the bests they are coloured against. Read
    // only while the column is on.
    'car-sectors.snapshot',
    // The pace of each car's stint. Reading it is what has the race
    // recorded, so it is read only while the "vs stint" column is on.
    'race-history.summary',
    // How long each car of our class has run on its tyres, and the tread
    // left. Reading it has the race recorded as well, so it is read only
    // while the Tyres column shows it.
    'class-tyres.snapshot',
    // The driving state the widget hides on.
    'track-state.snapshot',
    // Subscribed transitively by useDriverStandings; the tower never shows
    // it.
    'radio.snapshot',
  ],
  // A table to read from a second screen, not to drive by: twice a second
  // keeps a gap to the tenth current and leaves most rows as they were
  // between two readings.
  channelRates: {
    'standings.snapshot': 2,
    'lap-times.snapshot': 1,
    'car-pit.snapshot': 1,
    'car-sectors.snapshot': 2,
    'race-history.summary': 1,
    'class-tyres.snapshot': 1,
    'track-state.snapshot': 1,
    'radio.snapshot': 1,
  },
} satisfies WidgetRuntimeDefinition;
