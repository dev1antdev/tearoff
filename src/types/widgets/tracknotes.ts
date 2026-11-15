import { defineWidgetManifest } from './types';

export default defineWidgetManifest({
  id: 'tracknotes',
  name: 'Track Notes',
  category: 'Track & Navigation',
  enabled: false,
  layout: {
    x: 760,
    y: 260,
    width: 350,
    height: 80,
  },
  config: {
    background: { opacity: 80 },
    showPaceNotes: true,
    showTrackNotes: true,
    showComment: false,
    showNextDistance: false,
    uppercase: false,
    paceLeadMeters: 0,
    paceLeadSeconds: 0,
    displaySeconds: 0,
    showPitNotes: true,
    hideWhenNoNotes: true,
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
    showPaceNotes: {
      type: 'boolean',
      label: 'Pace Notes',
      description: 'The line that says what is coming.',
    },
    showTrackNotes: {
      type: 'boolean',
      label: 'Track Notes',
      description: 'The line that says where the car is.',
    },
    showComment: {
      type: 'boolean',
      label: 'Comment',
      description:
        'The comment of the note on the first line shown, up to three lines.',
    },
    showNextDistance: {
      type: 'boolean',
      label: 'Distance To Next Note',
      description: 'How far it is to the next note of the first line shown.',
    },
    uppercase: {
      type: 'boolean',
      label: 'Capitals',
      description: 'Draw note text in capitals.',
    },
    paceLeadMeters: {
      type: 'number',
      label: 'Pace Note Lead',
      description:
        'Pace notes appear this many metres before the point they were written for. A negative lead shows them late.',
      min: -500,
      max: 500,
      step: 10,
      units: 'm',
    },
    paceLeadSeconds: {
      type: 'number',
      label: 'Pace Note Lead Time',
      description:
        'On top of the metres: pace notes appear this many seconds early at the speed the car is doing.',
      min: 0,
      max: 10,
      step: 0.5,
      units: 's',
    },
    displaySeconds: {
      type: 'number',
      label: 'Show For',
      description:
        'Hide a note this long after it appeared. 0 keeps it until the next one.',
      min: 0,
      max: 60,
      step: 1,
      units: 's',
    },
    showPitNotes: {
      type: 'boolean',
      label: 'Pit Notes',
      description:
        'On pit road, show the notes marked Pit, or "Pit lane" when there is none.',
    },
    hideWhenNoNotes: {
      type: 'boolean',
      label: 'Hide Without Notes',
      description: 'Hide the widget on a track with no notes.',
    },
    showOnlyWhenOnTrack: {
      type: 'boolean',
      label: 'Show only when on track',
      description:
        'Hidden in the garage and in the menus. Shown while you drive and while you watch a car on track.',
    },
  },
});
