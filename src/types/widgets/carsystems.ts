import {
  DEFAULT_CAR_SYSTEM_ROWS,
  DEFAULT_LMU_CAR_SYSTEM_ROWS,
} from '../carSystems';
import { defineWidgetManifest } from './types';

export default defineWidgetManifest({
  id: 'carsystems',
  name: 'Car Systems',
  category: 'Car & Controls',
  enabled: false,
  layout: {
    x: 6,
    y: 620,
    // Wide and short: the systems read left to right as columns, so the
    // default slot is shaped for a strip rather than the tall table this
    // widget used to be.
    width: 380,
    height: 70,
  },
  config: {
    rows: [...DEFAULT_CAR_SYSTEM_ROWS],
    lmuRows: [...DEFAULT_LMU_CAR_SYSTEM_ROWS],
    displayMode: 'always',
    changeHoldSeconds: 4,
    flashOnChange: true,
    highlightActive: true,
    showScale: false,
    showBrakeBiasDelta: false,
    showUnsupportedRows: true,
    showOffRows: true,
    background: { opacity: 80 },
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
    displayMode: {
      type: 'enum',
      label: 'Show',
      description:
        'Always keeps the widget on screen. When a dial changes shows it only for a while after you move one, with every column in its usual place.',
      options: [
        { value: 'always', label: 'Always' },
        { value: 'onChange', label: 'When a dial changes' },
      ],
    },
    changeHoldSeconds: {
      type: 'number',
      label: 'Stay On Screen For',
      description: 'How long the widget stays after the last dial you moved.',
      min: 1,
      max: 15,
      step: 0.5,
      units: 's',
    },
    flashOnChange: {
      type: 'boolean',
      label: 'Highlight the dial that moved',
      description: 'Briefly lights the value of the column you just changed.',
    },
    highlightActive: {
      type: 'boolean',
      label: 'Light ABS and TC while they work',
      description:
        'Turns the column header yellow while the system is intervening. iRacing reports this for ABS only.',
    },
    showScale: {
      type: 'boolean',
      label: 'Show the top of the scale',
      description:
        'Adds the highest position after the value, as in 6/11. Le Mans Ultimate only: iRacing does not state it.',
    },
    showBrakeBiasDelta: {
      type: 'boolean',
      label: 'Show brake bias change',
      description:
        'A small signed figure under the brake bias: how far it is from where it stood when the car was last at rest in the pits.',
    },
    showUnsupportedRows: {
      type: 'boolean',
      label: 'Keep rows the car does not have',
      description:
        'Shows a blank row so each adjustment keeps the same position between cars. Turn off to show only what the current car exposes.',
    },
    showOffRows: {
      type: 'boolean',
      label: 'Keep rows switched off',
      description:
        'Shows a system the driver has turned off, greyed and reading zero. Turn off to leave only the systems actually in use.',
    },
    showOnlyWhenOnTrack: {
      type: 'boolean',
      label: 'Show only when on track',
      description: 'If enabled, widget will only be shown when driving.',
    },
  },
});
