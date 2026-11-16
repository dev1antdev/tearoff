import {
  SIMULATOR_IDS,
  SIMULATOR_LABELS,
  type ActiveSimulator,
} from './simulators';

/**
 * Which widgets cannot work under a given simulator, and what to tell the user.
 *
 * The live values come from `simWidgetSupport.json` in the app's user-data
 * folder, next to config.json — edit that file and restart to change them, no
 * rebuild needed. The defaults below seed it on first run and stand in if it is
 * missing or unreadable.
 *
 * Nothing here touches the user's own enabled/disabled choice. A widget listed
 * for the running sim is hidden and rendered as if it were switched off, and
 * its saved setting is left exactly as it was, so it comes back when the sim
 * changes or the widget gains support.
 */
export interface SimWidgetSupportConfig {
  /** Shown when hovering a disabled widget, and under its greyed-out toggle. */
  message: string;
  /**
   * Widget ids as used in WIDGET_MAP and in menuItems.ts (`widgetType`), not
   * display names.
   */
  disabledWidgets: Record<ActiveSimulator, string[]>;
}

/**
 * The widgets verified to work under Le Mans Ultimate.
 *
 * LMU's data comes from a shared-memory block and a local REST API that carry
 * a fraction of what iRacing publishes, so support is per widget and has to be
 * established one at a time. This is the list that has been, and it is the
 * reason for the one below rather than a second opinion about it: a spec
 * asserts the two are exact complements over WIDGET_MAP, so a widget added to
 * the app cannot quietly appear under LMU without someone deciding which list
 * it belongs in.
 */
export const LMU_SUPPORTED_WIDGETS: readonly string[] = [
  'battle',
  // Braking zones from the pedal, the car's speed and its longitudinal
  // acceleration, with LMU's own impact time to discard a stop that hit
  // something and its wheel speeds for the lock times iRacing cannot give.
  'brakeperformance',
  // LMU's own dials, each with the top of its scale: brake bias, ABS, the
  // three traction dials, brake migration and the map, under names the sim
  // fixes for every car. It has a list of rows of its own in the settings.
  'carsystems',
  // Ride height, camber and toe at each wheel from LMU's per-wheel telemetry
  // block, and the rake and roll they add up to.
  'chassis',
  // The cars entered and still running in each class, from LMU's scoring:
  // class, place, garage stall and finish status for every car.
  'classfields',
  // Timed from the car's lap fraction and speed, which LMU publishes, over
  // the corners of the bundled track data: the same data Corner Names uses.
  'cornerdelta',
  'cornername',
  // The heading from the car's orientation, with the track model's +Z axis
  // standing for north, the height from its world position, and the metres
  // and seconds driven from its speed and the session clock.
  'cruise',
  // Dents, what has come off or gone flat and the last impact from the
  // player's telemetry block; aero and suspension damage and the repair the
  // pit menu is set to from LMU's REST API.
  'damage',
  'deltaspeed',
  // The height of the road from the car's world position, recorded on the
  // first clean lap of a track, with the sector starts learned on the same
  // lap. Under iRacing the profile is added up from the car's motion.
  'elevation',
  // The cars behind by the Relative's own gaps and the session's class
  // speeds, both of which LMU's scoring gives. Its optional licence badge
  // has nothing to show here.
  'fastercarsfrombehind',
  // Where the race ends for a set of stop lengths, from the fuel
  // projection's own pace and progress; the stop that adds exactly what is
  // needed from the refuelling rates LMU's REST API states; the class
  // rivals' remaining stops from the fuel or energy scoring gives each car.
  'finishorder',
  // The three strategy panels of the Pit Wall, made of the finish
  // projection's reckoning run over the whole class: Our Car, with the
  // tread and the damage LMU alone publishes; Class Rivals; and the Stint
  // Timeline, whose driven stints are the race history's.
  'ourcar',
  'classrivals',
  'stinttimeline',
  // Two panels about one car, read from the race history: who has driven
  // it and every stint, and its laps one by one. LMU alone gives the sector
  // times and what each car has left to run on, so under iRacing they have
  // no sector and no energy columns.
  'crew',
  'carlaps',
  'flag',
  // The flag in force and the car a blue is for, from LMU's session phase,
  // sector flags and scoring. Each sim has states the other cannot report.
  'flagpanel',
  // Every car on a straight line by its lap fraction, which needs no map of
  // the circuit, with cars in the pit lane greyed and the sector under
  // yellow marked once the track profile has learned where sectors start.
  'flatmap',
  // Lateral and longitudinal g from LMU's own acceleration, in the same
  // signs as iRacing's, with its impact time to keep a kerb strike out of
  // the maxima.
  'frictioncircle',
  // Counts virtual energy in percent for a Hypercar, LMDh or LMGT3, which
  // stop when that runs out, and litres for the fuel-limited classes.
  'fuel',
  // The fuel projection's own figures, read again as targets per lap:
  // percent of virtual energy for a car that runs on it, litres otherwise.
  'fuelsaver',
  'garagecover',
  // The battery charge and the motor's state from LMU's telemetry block. It
  // draws nothing for a car that shows neither, which is most of them.
  'hybrid',
  'infobar',
  'input',
  // Timed from where the lap fraction wraps, which is where the reference
  // laps are recorded from, rather than from LMU's own lap clock.
  'lapdelta',
  'laptimelog',
  'laptrace',
  // LMU's own lift-and-coast light, with the traction control and ABS flags.
  'liftcoast',
  // The whole circuit from the map LMU sends with the session, in place of
  // the iRacing drawing. LMU says where none of its sectors starts, so the
  // sector marks and the sector under yellow wait for the track profile to
  // learn that from a clean lap; a circuit with no map yet says so.
  'map',
  // Drawn from the same map, sent with the session.
  'minimap',
  'pitlanehelper',
  // LMU's own estimate of the stop and its eight parts from REST, the pit
  // menu's level, and a pit lane learned from the cars seen crossing its
  // lines. Under iRacing the stop is learned from the player's own.
  'pitstop',
  // A page of its own made of the widgets in this list. A panel whose
  // widget is in the list below is left out of the page, so the page shows
  // under LMU exactly what the overlay could.
  'pitwall',
  // The gap to the car behind while the player is slow on the track, from
  // the Relative's gaps and the player's own speed.
  'rejoin',
  'relative',
  // LMU's own sector times, which it publishes for the player. It gives no
  // boundary distances, so where the sectors start is learned from where
  // the car is when the sim moves it into the next one.
  'sectordelta',
  // Shift point from shiftPoints.ts for GT3 and LMP2, else 95% of the rev
  // limit. LMU publishes no shift point of its own.
  'shiftlight',
  // A slow or stopped car ahead, from the speed each car's lap fraction
  // moves at. LMU never says a rival is off the road, so the bar is never
  // drawn in its off-track colour here.
  'slowcarahead',
  'standings',
  // The player's own stints from the always-on ledger: laps, time, fuel or
  // virtual energy, compounds, tread and brake discs read live, and the
  // stop that ended each. Under iRacing the same widget has no energy, no
  // discs and no wear on track.
  'stinthistory',
  // The machine's and Tearoff's own CPU and memory, which come from the
  // operating system. LMU publishes no frame rate and no CPU or GPU meters,
  // so the widget leaves its Sim row out here.
  'systemperformance',
  // Not a sim-specific widget: it reports whatever channels the running sim
  // publishes, which is how LMU's own mapping gets checked. It is also the
  // one widget absent from the settings menu, so there would be no toggle to
  // grey out if it were listed as unsupported.
  'telemetryinspector',
  // Lap, delta, last and best lap and LMU's own three sector times, all from
  // channels the lap and sector widgets above already read. A last lap the
  // sim gave no time is shown as the measured one, marked.
  'timing',
  // The whole field in one table, from what the Standings already read of
  // LMU's scoring, with every car's sector times, which only LMU gives, and
  // the pace of each stint from the race history. Under iRacing it has no
  // sector marks and no energy column.
  'timingtower',
  // The driver's own notes by distance into the lap, which is LMU's lap
  // distance, so a TinyPedal notes file comes in as it is. Pit notes follow
  // the pit-road flag.
  'tracknotes',
  // Who is closing and when it arrives, measured from lap fractions and
  // the clock, never from LMU's estimated lap time, which is one constant
  // for the whole grid. Off the road is all four wheels on grass or gravel.
  'traffic',
  // Tyre and brake temperatures from LMU's per-wheel telemetry block.
  'tyres',
  // Tread from the same block, which LMU writes while the car is moving, and
  // disc thickness from its REST API; forecast from the player's own laps.
  'wear',
  // Without its wind cell, which the widget drops under LMU.
  'weather',
  // LMU's own forecast for the session, from its REST API: five points
  // across practice, qualifying or the race, with the weather as it is.
  'weatherforecast',
];

/**
 * Widgets with nothing to show under iRacing.
 *
 * Short on purpose: iRacing is the sim most widgets were written against. A
 * widget lands here only when iRacing does not publish what it draws at all.
 */
export const IRACING_DISABLED_WIDGETS: readonly string[] = [
  // iRacing publishes no ride height, camber or toe while the car is moving:
  // only the shock deflections, and a pitch and roll against the world that
  // contain the gradient and the banking of the track.
  'chassis',
  // iRacing publishes no dent, aero or suspension state: only the seconds
  // of repair left during a stop, which is a pit-service figure.
  'damage',
  // iRacing publishes a battery charge for its hybrid cars, but under names
  // and scales no capture here has confirmed. Held back until one has.
  'hybrid',
  // iRacing has no lift-and-coast signal and no flag for traction control
  // cutting; a strip that could only ever show ABS is not this widget.
  'liftcoast',
  // iRacing reports tyre temperatures as they were when the car last stopped
  // in the pits, not while it is moving, so there is no live reading.
  'tyres',
  // iRacing publishes the weather as it is and the session's settings, but
  // no forecast: there would be a "Now" column and nothing after it.
  'weatherforecast',
  // Nor does it refresh tread anywhere but in the pits, so there is no wear
  // per lap to forecast from; and it publishes nothing about brake discs.
  'wear',
];

/** Everything else, hidden while LMU is the running sim. */
export const LMU_DISABLED_WIDGETS: readonly string[] = [
  'blindspotmonitor',
  // Broadcast reads iRacing's standings, timing and race control; not yet
  // checked against LMU's data.
  'broadcast',
  'broadcastevents',
  'broadcastpodium',
  'broadcastticker',
  'broadcastweather',
  'gantry',
  'heartrate',
  'radar',
  // Race plans name drivers by iRacing customer id.
  'stintplan',
  'strategytimeline',
  'tachometer',
  'streamchat',
  // LMU simulates no wind: its wind vector is always zero.
  'wind',
];

/**
 * Seeds the JSON on first run, and the fallback if it cannot be read.
 *
 * Only widgets that exist in this build may be named here — a spec asserts it,
 * because a typo in a list of ids otherwise disables nothing at all and does it
 * silently. A simulator whose source is not in the tree still gets an entry:
 * the list is knowledge about that sim, not code for it, and having it here
 * means the entry is already correct when the source arrives.
 */
export const DEFAULT_SIM_WIDGET_SUPPORT: SimWidgetSupportConfig = {
  message: 'This widget is not compatible with the running sim',
  disabledWidgets: {
    iracing: [...IRACING_DISABLED_WIDGETS],
    lmu: [...LMU_DISABLED_WIDGETS],
  },
};

/**
 * Bumped whenever the lists above change.
 *
 * The file is seeded once and then belongs to the user, so a shipped change
 * would otherwise never reach anyone who had already run the app -- the whole
 * point of these lists is that the app ships knowledge about which widgets
 * work under which sim, and that knowledge improves between releases. The
 * storage layer replaces an older file with the current defaults and logs that
 * it did, which costs a user their hand edits once per change and is why the
 * number is bumped only for a real one.
 */
export const SIM_WIDGET_SUPPORT_VERSION = 16;

/**
 * Whether a widget is unavailable under the running sim.
 *
 * An unknown simulator — nothing detected yet, or demo mode — disables
 * nothing: with no sim to be incompatible with, hiding widgets would be
 * guessing.
 */
export const isWidgetDisabledForSim = (
  config: SimWidgetSupportConfig,
  widgetId: string | undefined,
  simulator: ActiveSimulator | null | undefined
): boolean =>
  !!widgetId &&
  !!simulator &&
  (config.disabledWidgets[simulator] ?? []).includes(widgetId);

/**
 * Whether the running sim can show at least one of these widgets.
 *
 * For work the main process does on a widget's behalf: a recorder or a poll
 * whose only readers are hidden under the running sim has nobody to work for.
 */
export const isAnyWidgetAvailableForSim = (
  config: SimWidgetSupportConfig,
  widgetIds: readonly string[],
  simulator: ActiveSimulator | null | undefined
): boolean =>
  widgetIds.some((id) => !isWidgetDisabledForSim(config, id, simulator));

/** The hover text for a disabled widget, or null when it is available. */
export const widgetDisabledMessage = (
  config: SimWidgetSupportConfig,
  widgetId: string | undefined,
  simulator: ActiveSimulator | null | undefined
): string | null =>
  isWidgetDisabledForSim(config, widgetId, simulator) ? config.message : null;

/** The label under a greyed-out toggle, e.g. "Not iRacing compatible". */
export const widgetIncompatibleLabel = (
  simulator: ActiveSimulator | null | undefined
): string | null =>
  simulator ? `Not ${SIMULATOR_LABELS[simulator]} compatible` : null;

/**
 * Every widget id this build has.
 *
 * Derived from the two LMU lists rather than kept as a third one, because a
 * spec already asserts those two are exact complements over WIDGET_MAP -- so
 * this set is correct for free, and cannot drift from the widgets that exist.
 *
 * Needed because the config comes from a file a user edits by hand, and a
 * misspelled id used to do nothing at all: it stayed in the list, matched no
 * widget, and the widget it was meant to hide simply stayed on screen with
 * nothing said anywhere.
 */
export const KNOWN_WIDGET_IDS: readonly string[] = [
  ...LMU_SUPPORTED_WIDGETS,
  ...LMU_DISABLED_WIDGETS,
];

/** What a hand-edited file got wrong, for the caller to report. */
export interface SimWidgetSupportProblems {
  /** Ids no widget in this build answers to, with the sim that listed them. */
  unknownWidgets: { simulator: string; id: string }[];
  /** Keys under disabledWidgets that are not simulators. */
  unknownSimulators: string[];
}

export interface NormalizedSimWidgetSupport {
  config: SimWidgetSupportConfig;
  problems: SimWidgetSupportProblems;
}

/**
 * Repairs whatever was read from disk, and says what it had to repair.
 *
 * Unknown ids are dropped rather than kept. Keeping them was harmless to the
 * lookup -- nothing matches -- but it made a typo indistinguishable from a
 * widget that genuinely has no support, which is the one mistake a hand-edited
 * list of ids invites. Dropping them and naming them in the log turns a silent
 * no-op into a line that says which word was wrong.
 *
 * An unrecognised simulator key is worth reporting for a sharper reason: the
 * list for a simulator the file does not mention falls back to the shipped
 * defaults, so a misspelled "Imu" does not disable nothing -- it quietly
 * reinstates the whole bundled list.
 */
export const normalizeSimWidgetSupportVerbose = (
  raw: unknown
): NormalizedSimWidgetSupport => {
  const source = (raw ?? {}) as Partial<SimWidgetSupportConfig>;
  const known = new Set(KNOWN_WIDGET_IDS);
  const unknownWidgets: { simulator: string; id: string }[] = [];

  const listFor = (simulator: ActiveSimulator): string[] => {
    const value = source.disabledWidgets?.[simulator];
    if (!Array.isArray(value)) {
      return [...DEFAULT_SIM_WIDGET_SUPPORT.disabledWidgets[simulator]];
    }
    const ids = value.filter((id): id is string => typeof id === 'string');
    for (const id of ids) {
      if (!known.has(id)) unknownWidgets.push({ simulator, id });
    }
    return ids.filter((id) => known.has(id));
  };

  const simulators = new Set<string>(SIMULATOR_IDS);
  const unknownSimulators = Object.keys(
    (source.disabledWidgets ?? {}) as Record<string, unknown>
  ).filter((key) => !simulators.has(key));

  return {
    config: {
      message:
        typeof source.message === 'string' && source.message.length > 0
          ? source.message
          : DEFAULT_SIM_WIDGET_SUPPORT.message,
      disabledWidgets: Object.fromEntries(
        SIMULATOR_IDS.map((simulator) => [simulator, listFor(simulator)])
      ) as Record<ActiveSimulator, string[]>,
    },
    problems: { unknownWidgets, unknownSimulators },
  };
};

/**
 * Repairs a hand-edited file rather than crashing on it. Unknown keys are
 * dropped, missing ones fall back to the defaults, and non-string entries are
 * ignored. An empty list is honoured as a deliberate "disable nothing" rather
 * than treated as absent.
 */
export const normalizeSimWidgetSupport = (
  raw: unknown
): SimWidgetSupportConfig => normalizeSimWidgetSupportVerbose(raw).config;
