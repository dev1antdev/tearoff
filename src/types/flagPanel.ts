import type { NameFormat, SessionVisibilitySettings } from './widgetConfigs';

/**
 * The flag panel: a wide card that names the flag that applies to the player
 * and explains it in one line, and under a blue flag the car it is for.
 *
 * Distances are held in metres, the unit the snapshot carries; `distanceUnit`
 * only changes what is drawn.
 */
export interface FlagPanelConfig {
  background: { opacity: number };
  /**
   * The line under the title. Under a blue that line is the name of the car
   * to let by and is always shown.
   */
  showExplanation: boolean;
  /**
   * Who the line under BLUE FLAG names: the driver at the wheel or, for team
   * events, the team. An entry with no team name shows the driver.
   */
  blueName: 'driver' | 'team';
  driverNameFormat: NameFormat;
  /** The right-hand pair while no blue is out: dashes, or not drawn. */
  bluePair: 'dashes' | 'hidden';
  /** Metres or feet; `auto` follows the sim's own units. */
  distanceUnit: 'auto' | 'm' | 'ft';
  /**
   * Which states tint the whole card: none, the ones that need attention, or
   * every one that has a colour, the clear track's green included.
   */
  tintCard: 'off' | 'active' | 'always';
  blue: {
    /** Show the blue flag in races only. */
    raceOnly: boolean;
  };
  yellow: {
    /** Show local yellows in races only. */
    raceOnly: boolean;
    /** How far ahead a stopped car makes the yellow the player's, metres. */
    rangeAhead: number;
    /** The same behind. */
    rangeBehind: number;
    /**
     * Name the sector a yellow is in, and treat a yellow in the player's own
     * sector as theirs. Off until the order of the sim's sector flags is
     * confirmed.
     */
    nameSector: boolean;
  };
  /** The states before the start: the grid, the formation lap, the lights. */
  showStartLights: boolean;
  showPenalty: boolean;
  showLastLap: boolean;
  /** Draw GREEN FLAG while the track is clear, or hide the card. */
  whenClear: 'green' | 'hide';
  /** The glow of the colour block and of a tinted card. */
  enableGlow: boolean;
  /** Pulse the block for a near yellow and a blue. */
  animate: boolean;
  showOnlyWhenOnTrack: boolean;
  sessionVisibility: SessionVisibilitySettings;
}
