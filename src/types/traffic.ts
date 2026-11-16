import type { SessionVisibilitySettings } from './widgetConfigs';

/**
 * The traffic widget: the cars closing from behind with a forecast of when
 * and where the soonest arrives, the table of laps until the player meets
 * the car ahead, the leader and the car behind, and the cars coming while
 * the player is in the pit lane or slow on the track.
 *
 * Times are in seconds, the unit the snapshot carries.
 */
export interface TrafficConfig {
  background: { opacity: number };
  /** The mirror: the cars closing from behind, nearest first. */
  showMirror: boolean;
  /** Rows of the mirror, 1 to 4. */
  mirrorRows: number;
  /**
   * Show the car right behind when it is racing the player for position
   * rather than traffic. It is drawn muted and never forecast as traffic.
   */
  showRival: boolean;
  /** How much of a lap each car in the mirror gains, beside its arrow. */
  showClosingRate: boolean;
  /** The line that says when and where the car catching the player arrives. */
  showForecast: boolean;
  /** How the corner of a forecast is written: its name, or its number. */
  cornerLabel: 'name' | 'number';
  /** The three columns of the table of contacts. */
  showSlowerAhead: boolean;
  showLeader: boolean;
  showFasterBehind: boolean;
  /** What names a car beside its number. */
  label: 'driver' | 'class' | 'number';
  /** Contacts further off than this many laps are drawn as a dash. */
  maxLaps: number;
  /** Mark a contact that falls inside the lap under way. */
  highlightThisLap: boolean;
  /** The mirror and the table in practice and qualifying as well. */
  showOutsideRace: boolean;
  /** The pit exit block: who is coming while the player is in the lane. */
  showPitExit: boolean;
  /** How far ahead of the player's arrival at the exit a car is listed. */
  aheadWindow: number;
  /** How far behind it. */
  behindWindow: number;
  /** Cars listed behind. */
  behindCount: number;
  /** A car arriving closer behind than this is a caution, */
  careGap: number;
  /** and closer than this a danger. */
  dangerGap: number;
  /** How long the block stays after the pit exit, and after being slow. */
  exitHold: number;
  /** The same block when slower than 8 m/s on the track, or off it. */
  showWhenSlow: boolean;
  showOnlyWhenOnTrack: boolean;
  sessionVisibility: SessionVisibilitySettings;
}
