import {
  lapAveragesOverProperty,
  numberOptions,
  stintPaceAgainstProperty,
  timeFormatOptions,
} from './properties';
import { defineWidgetManifest } from './types';

export default defineWidgetManifest({
  id: 'standings',
  name: 'Standings',
  category: 'Standings',
  enabled: true,
  layout: {
    x: 6,
    y: 10,
    width: 560,
    height: 774,
  },
  config: {
    customClassOrdering: false,
    useLivePosition: false,
    iratingChange: {
      enabled: true,
      estimateInPractice: false,
    },
    positionChange: {
      enabled: false,
    },
    lmuBadge: {
      enabled: true,
    },
    badge: {
      enabled: true,
      badgeFormat: 'license-color-rating-bw',
      lmuFormat: 'plates',
    },
    delta: {
      enabled: true,
    },
    gap: {
      reference: 'classLeader',
      enabled: false,
      decimalPlaces: 1,
    },
    interval: {
      enabled: false,
      decimalPlaces: 1,
      // A car more than a lap behind the one ahead reads "-2L", not "3:35".
      // A dashboard that already stores 'time' keeps it: loading only fills
      // in fields that are missing.
      displayMode: 'laps',
    },
    lastTime: {
      enabled: true,
      timeFormat: 'full',
      markInvalid: true,
    },
    fastestTime: {
      enabled: true,
      timeFormat: 'full',
    },
    background: {
      opacity: 80,
    },
    foreground: {
      opacity: 70,
    },
    driverRow: {
      opacity: 70,
    },
    countryFlags: {
      enabled: true,
    },
    carNumber: {
      enabled: true,
    },
    driverName: {
      enabled: true,
      showStatusBadges: true,
      removeNumbersFromName: false,
      subtext: 'teamName',
    },
    teamName: {
      enabled: false,
      subtext: 'none',
    },
    pitStatus: {
      enabled: true,
      showPitTime: true,
      pitLapDisplayMode: 'lastPitLap',
    },
    position: {
      enabled: true,
    },
    compound: {
      enabled: true,
    },
    carManufacturer: {
      enabled: true,
      hideIfSingleMake: false,
    },
    radio: {
      persistenceSeconds: 3,
    },
    lapTimeDeltas: {
      enabled: false,
      numLaps: 3,
      decimalPlaces: 1,
    },
    avgLapTime: {
      enabled: false,
      numLaps: 5,
      timeFormat: 'mixed',
      excludePitLaps: false,
    },
    // Off by default: two more time columns do not fit the default width.
    avgLast5: {
      enabled: false,
      timeFormat: 'full',
    },
    avgLast10: {
      enabled: false,
      timeFormat: 'full',
    },
    averagesOver: 'clean',
    // Off by default: while it is on the race is recorded for it.
    stintPace: { enabled: false },
    paceAgainst: 'stint',
    lapCount: {
      enabled: false,
    },
    classHeaderStyle: {
      className: { colorBackground: false },
      classInfo: { colorBackground: false },
      estimatedLaps: {
        enabled: false,
        numLaps: 5,
      },
    },
    stylingOptions: {
      driverPosition: { background: false },
      driverNumber: { background: false, border: true },
    },
    driverStandings: {
      buffer: 3,
      numNonClassDrivers: 3,
      minPlayerClassDrivers: 10,
      numTopDrivers: 3,
      topDriverDivider: 'theme',
      showAll: false,
    },
    titleBar: {
      enabled: false,
      progressBar: {
        enabled: true,
      },
    },
    headerBar: {
      enabled: true,
      sessionName: {
        enabled: true,
      },
      sessionTime: {
        enabled: true,
        mode: 'Remaining',
      },
      sessionLaps: {
        enabled: true,
      },
      incidentCount: {
        enabled: true,
      },
      brakeBias: {
        enabled: false,
      },
      localTime: {
        enabled: false,
      },
      sessionClockTime: {
        enabled: false,
      },
      trackWetness: {
        enabled: false,
      },
      precipitation: {
        enabled: false,
      },
      humidity: {
        enabled: false,
      },
      airTemperature: {
        enabled: false,
        unit: 'Metric',
      },
      trackTemperature: {
        enabled: false,
        unit: 'Metric',
      },
      wind: {
        enabled: false,
      },
      trackName: {
        enabled: false,
      },
      fuelLevel: {
        enabled: false,
      },
      lastLap: {
        enabled: false,
      },
      bestLap: {
        enabled: false,
      },
      topSpeed: {
        enabled: false,
      },
      manufacturerPosition: {
        enabled: false,
      },
      classRank: {
        enabled: false,
      },
      position: {
        enabled: false,
      },
      positionChange: {
        enabled: false,
        scope: 'class',
      },
      displayOrder: [
        'sessionName',
        'sessionTime',
        'sessionLaps',
        'incidentCount',
        'brakeBias',
        'localTime',
        'sessionClockTime',
        'trackWetness',
        'precipitation',
        'humidity',
        'airTemperature',
        'trackTemperature',
        'wind',
        'trackName',
        'fuelLevel',
        'lastLap',
        'bestLap',
        'topSpeed',
        'manufacturerPosition',
        'classRank',
        'position',
        'positionChange',
        'trackLimits',
      ],
    },
    footerBar: {
      enabled: true,
      sessionName: {
        enabled: false,
      },
      sessionTime: {
        enabled: false,
        mode: 'Remaining',
      },
      sessionLaps: {
        enabled: true,
      },
      incidentCount: {
        enabled: false,
      },
      brakeBias: {
        enabled: false,
      },
      localTime: {
        enabled: true,
      },
      sessionClockTime: {
        enabled: false,
      },
      trackWetness: {
        enabled: true,
      },
      precipitation: {
        enabled: false,
      },
      humidity: {
        enabled: false,
      },
      airTemperature: {
        enabled: true,
        unit: 'Metric',
      },
      trackTemperature: {
        enabled: true,
        unit: 'Metric',
      },
      wind: {
        enabled: false,
      },
      trackName: {
        enabled: false,
      },
      fuelLevel: {
        enabled: false,
      },
      lastLap: {
        enabled: false,
      },
      bestLap: {
        enabled: false,
      },
      topSpeed: {
        enabled: false,
      },
      manufacturerPosition: {
        enabled: false,
      },
      classRank: {
        enabled: false,
      },
      position: {
        enabled: false,
      },
      positionChange: {
        enabled: false,
        scope: 'class',
      },
      displayOrder: [
        'sessionName',
        'sessionTime',
        'sessionLaps',
        'incidentCount',
        'brakeBias',
        'localTime',
        'sessionClockTime',
        'trackWetness',
        'precipitation',
        'humidity',
        'airTemperature',
        'trackTemperature',
        'wind',
        'trackName',
        'fuelLevel',
        'lastLap',
        'bestLap',
        'topSpeed',
        'manufacturerPosition',
        'classRank',
        'position',
        'positionChange',
        'trackLimits',
      ],
    },
    showOnlyWhenOnTrack: false,
    pushToPass: { enabled: false },
    // Off by default: only LMU reports these, so on iRacing the column
    // would be permanently blank.
    trackLimits: { enabled: false },
    // Off by default: no iRacing car has virtual energy, and iRacing
    // reports no per-car fuel either, so the column would be blank.
    lmuVirtualEnergy: { enabled: false },
    displayOrder: [
      'position',
      'carNumber',
      'countryFlags',
      'driverName',
      'driverTag',
      'teamName',
      'pitStatus',
      'carManufacturer',
      'lmuBadge',
      'badge',
      'iratingChange',
      'positionChange',
      'gap',
      'interval',
      'fastestTime',
      'lastTime',
      'compound',
      'lapTimeDeltas',
      'avgLapTime',
      'avgLast5',
      'avgLast10',
      'stintPace',
      'lapCount',
      'trackLimits',
      'lmuVirtualEnergy',
      'pushToPass',
    ],
    driverTag: { enabled: false },
    sessionVisibility: {
      race: true,
      loneQualify: true,
      openQualify: true,
      practice: true,
      offlineTesting: true,
    },
  },
  properties: {
    customClassOrdering: {
      type: 'boolean',
      label: 'Position-based class ordering',
      description:
        "If enabled, classes are ordered based on the class's leader's overall position (does not override class colors).",
    },
    'driverStandings.buffer': {
      type: 'enum',
      control: 'select',
      label: 'Drivers to show around player',
      options: numberOptions(1, 10),
    },
    'driverStandings.numNonClassDrivers': {
      type: 'enum',
      control: 'select',
      label: 'Drivers to show in other classes',
      options: numberOptions(0, 63),
    },
    'driverStandings.minPlayerClassDrivers': {
      type: 'enum',
      control: 'select',
      label: "Minimum drivers in player's class",
      options: numberOptions(1, 63),
    },
    'driverStandings.numTopDrivers': {
      type: 'enum',
      control: 'select',
      label: "Top drivers to always show in player's class",
      options: numberOptions(0, 63),
    },
    'driverStandings.topDriverDivider': {
      type: 'enum',
      control: 'select',
      label: 'Top driver divider',
      options: [
        { value: 'none', label: 'None' },
        { value: 'theme', label: 'Theme Color' },
        { value: 'highlight', label: 'Highlight Color' },
      ],
    },
    'driverStandings.showAll': {
      type: 'boolean',
      label: 'Show every driver',
      description:
        'Lists the whole field instead of the drivers around you. Meant for the tall Gantry panel.',
    },
    useLivePosition: {
      type: 'boolean',
      label: 'Use Live Position Standings',
      description:
        'If enabled, live telemetry will be used to compute driver positions. This may be less stable but will update live and not only on start/finish line.',
    },
    'radio.persistenceSeconds': {
      type: 'number',
      label: 'Radio Icon Duration',
      description:
        'How long the speaker icon keeps showing after a driver stops talking. Set to 0 to only show it while they are actively transmitting.',
      min: 0,
      max: 10,
      step: 0.5,
      units: 's',
    },
    'titleBar.enabled': { type: 'boolean', label: 'Show Title Bar' },
    'titleBar.progressBar.enabled': {
      type: 'boolean',
      label: 'Show Progress Bar',
    },
    'background.opacity': {
      type: 'number',
      label: 'Background Opacity',
      min: 0,
      max: 100,
      step: 1,
      units: '%',
    },
    'foreground.opacity': {
      type: 'number',
      label: 'Session Bar Opacity',
      min: 0,
      max: 100,
      step: 1,
      units: '%',
    },
    'classHeaderStyle.className.colorBackground': {
      type: 'boolean',
      label: 'Class Name Background',
      description: 'Show a colored background on the class name badge',
    },
    'classHeaderStyle.classInfo.colorBackground': {
      type: 'boolean',
      label: 'Class Info Background',
      description:
        'Show a colored background on the SOF and driver count badges',
    },
    'stylingOptions.driverPosition.background': {
      type: 'boolean',
      label: 'Position Background',
      description:
        "Highlight the player's position cell with a colored background",
    },
    'stylingOptions.driverNumber.background': {
      type: 'boolean',
      label: 'Number Background',
      description: 'Show a colored background on the car number cell',
    },
    'stylingOptions.driverNumber.border': {
      type: 'boolean',
      label: 'Number Left Border',
      description: 'Show a colored left border on the car number cell',
    },
    'driverRow.opacity': {
      type: 'number',
      label: 'Player Highlight Opacity',
      description: 'How strongly your own row is tinted',
      min: 0,
      max: 100,
      step: 1,
      units: '%',
    },
    'headerBar.enabled': { type: 'boolean', label: 'Show Header Bar' },
    'footerBar.enabled': { type: 'boolean', label: 'Show Footer Bar' },
    'classHeaderStyle.estimatedLaps.enabled': {
      type: 'boolean',
      label: 'Show Estimated Laps',
      description:
        "Show each class's projected total lap count in timed sessions, based on the class leader's current pace",
    },
    'classHeaderStyle.estimatedLaps.numLaps': {
      type: 'enum',
      control: 'select',
      label: 'Laps to average',
      description:
        "Median of the class leader's most recent laps — pit stops and other outlier laps are left out",
      options: numberOptions(3, 10),
    },
    showOnlyWhenOnTrack: {
      type: 'boolean',
      label: 'Show only when on track',
      description:
        'Hidden in the garage and in the menus. Shown while you drive and while you watch a car on track.',
    },
    'iratingChange.estimateInPractice': {
      type: 'boolean',
      label: 'Estimate During Practice',
    },
    'lapTimeDeltas.numLaps': {
      type: 'enum',
      label: 'Number of Laps to Show',
      options: numberOptions(1, 5),
    },
    'lapTimeDeltas.decimalPlaces': {
      type: 'enum',
      label: 'Decimal Places',
      options: numberOptions(1, 3),
    },
    'avgLapTime.numLaps': {
      type: 'number',
      control: 'input',
      label: 'Laps to Average',
      description:
        'Uses the available laps until the selected count is recorded.',
      min: 1,
      max: 100,
      step: 1,
    },
    'avgLapTime.excludePitLaps': {
      type: 'boolean',
      label: 'Exclude in-laps and out-laps',
      description:
        'Average the most recent eligible laps, skipping laps that include pit road. Opponent incident invalidations are not available in iRacing.',
    },
    'avgLapTime.timeFormat': {
      type: 'enum',
      label: 'Time Format',
      options: timeFormatOptions,
    },
    'avgLast5.timeFormat': {
      type: 'enum',
      label: 'Time Format',
      options: timeFormatOptions,
    },
    'avgLast10.timeFormat': {
      type: 'enum',
      label: 'Time Format',
      options: timeFormatOptions,
    },
    averagesOver: lapAveragesOverProperty,
    paceAgainst: stintPaceAgainstProperty,
    'pitStatus.showPitTime': { type: 'boolean', label: 'Pit Time' },
    'pitStatus.pitLapDisplayMode': {
      type: 'enum',
      label: 'Pitlap display mode',
      options: [
        { value: 'lastPitLap', label: 'Last pit lap' },
        { value: 'lapsSinceLastPit', label: 'Laps since last pit' },
      ],
    },
    'carManufacturer.hideIfSingleMake': {
      type: 'boolean',
      label: 'Hide If Single Make',
    },
    'gap.reference': {
      type: 'enum',
      label: 'Gap Reference',
      description:
        'Player gaps are negative ahead and positive behind, across all classes. Uses the camera car when spectating; practice and qualifying compare best laps.',
      options: [
        { value: 'classLeader', label: 'Class Leader' },
        { value: 'player', label: 'Player' },
      ],
    },
    'gap.decimalPlaces': {
      type: 'enum',
      label: 'Decimal Places',
      options: numberOptions(1, 3),
    },
    'interval.displayMode': {
      type: 'enum',
      control: 'select',
      label: 'Interval Display',
      description:
        'How the interval reads for a car more than a lap behind the one ahead: in laps ("-2L"), or as a time. Cars on the same lap always show seconds.',
      options: [
        { value: 'time', label: 'Time' },
        { value: 'laps', label: 'Laps When Lapped' },
      ],
    },
    'lastTime.markInvalid': {
      type: 'boolean',
      label: 'Mark Laps That Did Not Count',
      description:
        'Dims a last lap the sim gave no time and marks it with a warning sign: a lap voided for track limits or a cut, or an out-lap. Le Mans Ultimate only.',
    },
    'interval.decimalPlaces': {
      type: 'enum',
      label: 'Decimal Places',
      options: numberOptions(1, 3),
    },
    'driverName.subtext': {
      type: 'enum',
      control: 'select',
      label: 'Driver Name Subtext',
      options: [
        { value: 'none', label: 'None' },
        { value: 'teamName', label: 'Team Name' },
      ],
    },
    'teamName.subtext': {
      type: 'enum',
      control: 'select',
      label: 'Team Name Subtext',
      options: [
        { value: 'none', label: 'None' },
        { value: 'driverName', label: 'Driver Name' },
      ],
    },
    'driverName.removeNumbersFromName': {
      type: 'boolean',
      label: 'Remove Numbers From Names',
    },
    'driverName.showStatusBadges': {
      type: 'boolean',
      label: 'Status Badges',
    },
  },
});
