import { beforeAll, describe, expect, it } from 'vitest';
import { sessionClock } from '@irdashies/domain/sessionClock/sessionClock';
import { isCleanLap } from '@irdashies/shared';
import {
  RACE_LOG_SNAPSHOT_EVENTS,
  TREAD_MEASURED,
  type ChannelName,
  type ChannelPayloads,
  type RaceEvent,
  type RaceLap,
  type RaceStint,
} from '@irdashies/types';
import {
  PIT_WALL_RACE_USER,
  pitWallRace,
  type PitWallRaceOptions,
} from '../../../../.storybook/pitWallRaceStage';
import carLaps from '../CarLaps/widgetRuntimeDefinition';
import classRivals from '../ClassRivals/widgetRuntimeDefinition';
import crew from '../Crew/widgetRuntimeDefinition';
import ourCar from '../OurCar/widgetRuntimeDefinition';
import raceCharts from '../RaceCharts/widgetRuntimeDefinition';
import raceLog from '../RaceLog/widgetRuntimeDefinition';
import stintTimeline from '../StintTimeline/widgetRuntimeDefinition';
import timingTower from '../TimingTower/widgetRuntimeDefinition';
import trackMap from '../TrackMap/widgetRuntimeDefinition';
import weatherForecast from '../WeatherForecast/widgetRuntimeDefinition';
import pitWall from './widgetRuntimeDefinition';

/**
 * The race the Pit Wall page's stories are told with, held to itself.
 *
 * The page hosts a dozen panels, and each reads a few of the same things
 * from another channel: our car's place is in the standings, in the
 * forecast and in the header; a car's stops are in the pit tracker's
 * figures, in the race history's summary, in the forecast and in the log.
 * A page whose panels disagree about the car in front of us is a page
 * nobody can read, and no single panel's spec would notice. This one reads
 * what every channel is staged with and checks that they tell one race.
 *
 * Nothing here was recorded: the race is staged, and its records are the
 * ones `raceHistoryStage.ts` writes out.
 */

const OWN_CAR = '77';
const CARS = 22;
const CLASS_SIZE = 14;
const WHEELS = 4;
const SECTORS = 3;

/** The widgets the page hosts, and the page itself for its header. */
const HOSTED = [
  timingTower,
  ourCar,
  classRivals,
  stintTimeline,
  crew,
  carLaps,
  raceCharts,
  raceLog,
  trackMap,
  weatherForecast,
  pitWall,
];

/**
 * The channels a hosted widget reads that the stage leaves without a
 * snapshot on purpose, and why.
 */
const absentOnPurpose = (
  options: PitWallRaceOptions
): Partial<Record<ChannelName, string>> =>
  options.iracing
    ? {
        'weather-forecast.snapshot':
          'iRacing publishes the weather as it is and no forecast, so the channel has nothing on it',
      }
    : {};

interface CarRecords {
  laps: RaceLap[];
  stints: RaceStint[];
}

/** Every value under a key that names one car, anywhere in a snapshot. */
const carIndicesIn = (value: unknown, found: unknown[] = []): unknown[] => {
  if (Array.isArray(value)) {
    for (const entry of value) carIndicesIn(entry, found);
  } else if (value !== null && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) {
      if (/(^c|C)arIdx$/.test(key)) found.push(entry);
      else carIndicesIn(entry, found);
    }
  }
  return found;
};

/** Every array under a key that says it is indexed by car. */
const perCarArraysIn = (
  value: unknown,
  found: [string, unknown[]][] = []
): [string, unknown[]][] => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return found;
  }
  for (const [key, entry] of Object.entries(value)) {
    if (Array.isArray(entry) && key.startsWith('carIdx')) {
      found.push([key, entry]);
    } else perCarArraysIn(entry, found);
  }
  return found;
};

const mean = (values: readonly number[]): number =>
  values.reduce((sum, value) => sum + value, 0) / values.length;

/**
 * How far apart two tellings of one figure may be when one of them is
 * published rounded: to a tenth, or to a thousandth.
 */
const TENTH = 0.051;
const THOUSANDTH = 0.00051;

const expectWithin = (
  actual: number,
  expected: number,
  tolerance: number
): void => {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tolerance);
};

const CASES: [string, PitWallRaceOptions][] = [
  ['162 laps in, under Le Mans Ultimate', { ownLaps: 162 }],
  ['141 laps in, under Le Mans Ultimate', { ownLaps: 141 }],
  ['162 laps in, under iRacing', { ownLaps: 162, iracing: true }],
  ['141 laps in, under iRacing', { ownLaps: 141, iracing: true }],
];

describe.each(CASES)(
  'the staged race of the Pit Wall page, %s',
  (_, options) => {
    const race = pitWallRace(options);
    const { session, snapshots, sessionTime } = race;
    const own = race.slotOf(OWN_CAR);
    const drivers = session.DriverInfo.Drivers;

    const read = <K extends ChannelName>(channel: K): ChannelPayloads[K] => {
      const snapshot = snapshots[channel];
      if (snapshot === undefined) throw new Error(`no ${channel} is staged`);
      return snapshot;
    };
    const standings = read('standings.snapshot');
    const forecast = read('race-forecast.snapshot');
    const carPit = read('car-pit.snapshot');
    const summary = read('race-history.summary');
    const bar = read('session-bar.snapshot');
    const timing = read('session-timing.snapshot');
    const trackState = read('track-state.snapshot');
    const lapTimes = read('lap-times.snapshot');
    const tyres = read('class-tyres.snapshot');

    const ownClass = drivers
      .filter((driver) => driver.CarClassID === drivers[own].CarClassID)
      .map((driver) => driver.CarIdx);

    // What the race history holds, read as a panel reads it: over its bridge.
    const records = new Map<number, CarRecords>();
    let log: RaceEvent[] = [];
    beforeAll(async () => {
      for (const driver of drivers) {
        records.set(driver.CarIdx, {
          laps: (await race.historyBridge.getCarLaps(driver.CarIdx)).laps,
          stints: await race.historyBridge.getCarStints(driver.CarIdx),
        });
      }
      // The log as a reader gets all of it: the channel's events, then page
      // after page of the ones before them.
      log = [...read('race-log.snapshot').events];
      for (let page = 0; page < 20; page += 1) {
        const earlier = await race.historyBridge.getEvents(
          undefined,
          log[0].seq
        );
        if (earlier.length === 0) break;
        log = [...earlier, ...log];
      }
    });
    const recordsOf = (slot: number): CarRecords => {
      const held = records.get(slot);
      if (!held) throw new Error(`no records for slot ${slot}`);
      return held;
    };
    const stopsOf = (slot: number): RaceStint[] =>
      recordsOf(slot).stints.filter((stint) => stint.closedBy === 'stop');
    const openStintOf = (slot: number): RaceStint => {
      const { stints } = recordsOf(slot);
      return stints[stints.length - 1];
    };
    /** When a car crossed the line at the end of a lap. */
    const lineAt = (slot: number, lap: number): number => {
      const crossed = recordsOf(slot).laps.find((entry) => entry.lap === lap);
      if (!crossed) throw new Error(`slot ${slot} has no lap ${lap}`);
      return crossed.sessionTime;
    };
    /**
     * How far a car was behind ours at the last line both have crossed,
     * seconds; negative ahead.
     */
    const behindUsAtTheLine = (slot: number): number => {
      const lap = Math.min(
        recordsOf(slot).laps.length,
        recordsOf(own).laps.length
      );
      return lineAt(slot, lap) - lineAt(own, lap);
    };

    it('is a field of twenty-two with our #77 the car the session is about', () => {
      expect(drivers).toHaveLength(CARS);
      expect(drivers[own].CarNumber).toBe(OWN_CAR);
      expect(session.DriverInfo.DriverCarIdx).toBe(own);
      expect(session.WeekendInfo.TeamRacing).toBe(1);
      expect(ownClass).toHaveLength(CLASS_SIZE);
    });

    it('names our car by its slot in every snapshot that names it', () => {
      expect(standings.focusCarIdx).toBe(own);
      expect(trackState.focusCarIdx).toBe(own);
      expect(bar.playerCarIdx).toBe(own);
      expect(forecast.ownCarIdx).toBe(own);
      expect(tyres.ownCarIdx).toBe(own);
      expect(
        forecast.cars.filter((car) => car.own).map((car) => car.carIdx)
      ).toEqual([own]);
    });

    it('names no car that is not one of the twenty-two', () => {
      const named = [
        ...carIndicesIn(snapshots),
        ...log.map((event) => event.carIdx),
      ].filter((carIdx) => carIdx !== null);
      expect(named.length).toBeGreaterThan(CARS);
      for (const carIdx of named) {
        expect(Number.isInteger(carIdx)).toBe(true);
        expect(carIdx).toBeGreaterThanOrEqual(0);
        expect(carIdx).toBeLessThan(CARS);
      }
      // A list by car has a place for each of them, or says nothing at all.
      for (const [key, list] of perCarArraysIn(snapshots)) {
        const perCar = key === 'carIdxWheelCompounds' ? WHEELS : 1;
        expect([key, list.length]).toEqual([
          key,
          list.length === 0 ? 0 : CARS * perCar,
        ]);
      }
      for (const list of [
        carPit.where,
        carPit.stops,
        carPit.stintLaps,
        carPit.lastStopLap,
        summary.laps,
        summary.stops,
        summary.stintDriver,
        lapTimes.lapTimes,
        lapTimes.lapTimeHistory,
        tyres.setLaps,
        standings.lastPitLap,
      ]) {
        expect(list).toHaveLength(CARS);
      }
      expect(tyres.compounds).toHaveLength(CARS * WHEELS);
    });

    it('orders our class the same in the standings, the forecast and the records', () => {
      const byStandings = [...ownClass].sort(
        (a, b) =>
          standings.carIdxClassPosition[a] - standings.carIdxClassPosition[b]
      );
      // By the records: the car with more laps, and of two on the same lap
      // the one that crossed the line first.
      const byRecords = [...ownClass].sort((a, b) => {
        const lapsA = recordsOf(a).laps.length;
        const lapsB = recordsOf(b).laps.length;
        return lapsB - lapsA || lineAt(a, lapsA) - lineAt(b, lapsB);
      });
      expect(byStandings).toEqual(byRecords);
      expect(forecast.cars.map((car) => car.carIdx)).toEqual(byRecords);
      expect(forecast.cars.map((car) => car.classPosition)).toEqual(
        byRecords.map((_, index) => index + 1)
      );
      expect(trackState.carIdxClassPosition).toEqual(
        standings.carIdxClassPosition
      );
    });

    it('gives our car one place: in the header, the standings and the forecast', () => {
      const place = standings.carIdxClassPosition[own];
      expect(bar.playerClassPosition).toBe(place);
      expect(bar.playerOverallPosition).toBe(standings.carIdxPosition[own]);
      expect(bar.playerClassSize).toBe(CLASS_SIZE);
      expect(bar.playerClassified).toBe(true);
      expect(forecast.place?.now).toBe(place);
      // The last change of place the log says is the place it holds.
      const said = log.filter(
        (event) => event.kind === 'position' && event.carIdx === own
      );
      const last = said[said.length - 1];
      expect(last?.kind === 'position' && last.to).toBe(place);
    });

    it('has the standings, the forecast and the records agree on the gaps', () => {
      const gapOf = (slot: number): number =>
        standings.carIdxF2Time[slot] - standings.carIdxF2Time[own];
      for (const car of forecast.cars) {
        // The forecast publishes a gap to the tenth.
        expect(Math.abs(car.gapS - gapOf(car.carIdx))).toBeLessThanOrEqual(
          0.051
        );
        // Against the gap at the last line both cars crossed, which is what
        // the records hold. The standings turn laps of progress into seconds
        // at the class leader's pace, so a slower car a lap or two back is a
        // second or two out; the cars around us are not.
        const atTheLine = behindUsAtTheLine(car.carIdx);
        expect(Math.abs(car.gapS - atTheLine)).toBeLessThan(
          1 + 0.02 * Math.abs(atTheLine)
        );
      }
      const at = forecast.cars.findIndex((car) => car.own);
      for (const beside of [forecast.cars[at - 1], forecast.cars[at + 1]]) {
        expect(beside).toBeDefined();
        expect(
          Math.abs(beside.gapS - behindUsAtTheLine(beside.carIdx))
        ).toBeLessThan(1);
      }
      expect(forecast.cars[at - 1].gapS).toBeLessThan(0);
      expect(forecast.cars[at + 1].gapS).toBeGreaterThan(0);
    });

    it('counts a car’s stops and its laps since the last one the same everywhere', () => {
      for (const { CarIdx: slot } of drivers) {
        const stops = stopsOf(slot);
        const lastStop = stops[stops.length - 1];
        const open = openStintOf(slot);
        const counted = [slot, stops.length, open.laps];
        expect([slot, carPit.stops[slot], carPit.stintLaps[slot]]).toEqual(
          counted
        );
        expect([slot, summary.stops[slot], summary.stintLaps[slot]]).toEqual(
          counted
        );
        expect(carPit.lastStopLap[slot]).toBe(lastStop.lastLap);
        expectWithin(
          carPit.standingS[slot],
          lastStop.stop?.standingTime ?? 0,
          TENTH
        );
        expectWithin(
          carPit.laneTimeS[slot],
          lastStop.stop?.laneTime ?? 0,
          TENTH
        );
        // Le Mans Ultimate counts every car's stops itself; iRacing does not.
        expect(standings.carIdxPitStops[slot]).toBe(
          options.iracing ? undefined : stops.length
        );
      }
      for (const car of forecast.cars) {
        const stops = stopsOf(car.carIdx);
        const lastStop = stops[stops.length - 1];
        expect([car.carIdx, car.stops, car.sinceStopLaps]).toEqual([
          car.carIdx,
          stops.length,
          openStintOf(car.carIdx).laps,
        ]);
        expect(car.lastStopLap).toBe(lastStop.lastLap);
        expectWithin(
          car.lastStopLaneS ?? 0,
          lastStop.stop?.laneTime ?? 0,
          TENTH
        );
      }
    });

    it('forecasts the next stop on the lap the records have every stint end on', () => {
      for (const car of forecast.cars) {
        const longest = Math.max(
          ...stopsOf(car.carIdx).map((stint) => stint.laps)
        );
        // The lap the car comes in on is the first of its next stint.
        const due = (openStintOf(car.carIdx).firstLap ?? 0) + longest;
        // From the length of a stint, which is all iRacing allows for a
        // rival, the count is of laps completed at the stop: one fewer, and
        // never a lap that is already behind the car.
        const underWay = recordsOf(car.carIdx).laps.length + 1;
        const counted =
          options.iracing && !car.own ? Math.max(underWay, due - 1) : due;
        expect([car.carIdx, car.nextStopLap]).toEqual([car.carIdx, counted]);
      }
    });

    it('names one driver at the wheel of our car', () => {
      const atTheWheel =
        options.ownLaps === 162 ? PIT_WALL_RACE_USER : 'Dmitri Sokolov';
      const { laps } = recordsOf(own);
      expect(drivers[own].UserName).toBe(atTheWheel);
      expect(summary.stintDriver[own]).toBe(atTheWheel);
      expect(openStintOf(own).driver).toBe(atTheWheel);
      expect(laps[laps.length - 1].driver).toBe(atTheWheel);
      // Every car's, for that matter.
      for (const { CarIdx: slot, UserName } of drivers) {
        expect(summary.stintDriver[slot]).toBe(UserName);
        expect(openStintOf(slot).driver).toBe(UserName);
      }
    });

    it('gives our car the laps the records hold', () => {
      const { laps } = recordsOf(own);
      const lastLap = laps[laps.length - 1];
      const clean = laps
        .filter((lap) => lap.lapTime !== null && isCleanLap(lap.flags))
        .map((lap) => lap.lapTime ?? 0);
      expect(laps).toHaveLength(options.ownLaps ?? 0);
      expect(summary.laps[own]).toBe(laps.length);
      expect(timing.lapsCompleted).toBe(laps.length);
      expect(forecast.ownLap).toBe(laps.length + 1);
      expect(standings.carIdxLap[own]).toBe(laps.length);
      for (const last of [
        bar.lastLapTime,
        standings.carIdxLastLapTime[own],
        forecast.ownLastLapS,
      ]) {
        expect(last).toBe(lastLap.lapTime);
      }
      for (const best of [
        bar.bestLapTime,
        standings.carIdxBestLapTime[own],
        forecast.ownBestLapS,
      ]) {
        expect(best).toBe(Math.min(...clean));
      }
      // The mean of five the rivals table and Our Car show is of the last
      // five clean laps of the records, and so is the pace we are forecast at.
      const ownForecast = forecast.cars.find((car) => car.own);
      expectWithin(ownForecast?.avg5S ?? 0, mean(clean.slice(-5)), THOUSANDTH);
      expectWithin(ownForecast?.paceS ?? 0, mean(clean.slice(-5)), THOUSANDTH);
      expect(lapTimes.cleanLapTimeHistory?.[own].slice(-5)).toEqual(
        clean.slice(-5)
      );
    });

    it('keeps one clock', () => {
      expect(timing.time).toBe(sessionTime);
      expect(trackState.sessionTime).toBe(sessionTime);
      expect(standings.sessionTime).toBe(sessionTime);
      expect(forecast.sessionTimeS).toBe(Math.floor(sessionTime));
      // The time left as the header counts it, from the green flag.
      const { remaining, total } = sessionClock({
        ...timing,
        sessionType: timing.sessionType,
      });
      expect(total).toBe(8 * 3600);
      expectWithin(timing.timeRemaining, remaining, THOUSANDTH);
      expectWithin(forecast.timeLeftS ?? 0, remaining, TENTH);
      expect(log[0].sessionTime).toBe(timing.greenFlagTimestamp);

      // Nothing has happened that the clock has not reached, and every
      // event is told at the one time of day the header shows.
      const newest = log[log.length - 1];
      expect(newest.sessionTime).toBeLessThanOrEqual(sessionTime);
      expect(sessionTime - newest.sessionTime).toBeLessThan(600);
      const offset = (bar.sessionTimeOfDay ?? 0) - sessionTime;
      for (const event of log) {
        expect(
          Math.abs((event.timeOfDay ?? 0) - event.sessionTime - offset)
        ).toBeLessThanOrEqual(1);
      }
      for (const lap of recordsOf(own).laps) {
        expect(lap.sessionTime).toBeLessThanOrEqual(sessionTime);
      }
      expect(
        read('sector-timing.snapshot').sectorEntryTime
      ).toBeLessThanOrEqual(sessionTime);
      expect(read('flag-state.snapshot').since).toBeLessThanOrEqual(
        sessionTime
      );
      expect(read('flag-state.snapshot').kind).toBe('green');
    });

    it('logs our car’s stops as the records hold them', () => {
      const stops = stopsOf(own);
      const stints = recordsOf(own).stints;
      const entries = log.filter(
        (event) => event.kind === 'pit-entry' && event.carIdx === own
      );
      const exits = log.filter(
        (event) => event.kind === 'pit-exit' && event.carIdx === own
      );
      expect(entries).toHaveLength(stops.length);
      expect(exits).toHaveLength(stops.length);
      let changes = 0;
      stops.forEach((stint, index) => {
        const exit = exits[index];
        const next = stints[stints.indexOf(stint) + 1];
        if (exit.kind !== 'pit-exit' || !stint.stop) {
          throw new Error('not a stop');
        }
        expectWithin(entries[index].sessionTime, stint.endTime ?? 0, TENTH);
        expect(exit.standingTime).toBe(stint.stop.standingTime);
        expect(exit.laneTime).toBe(stint.stop.laneTime);
        expectWithin(exit.sessionTime, next.startTime, TENTH);
        const changed = stint.driver !== next.driver;
        expect(stint.stop.driverChanged).toBe(changed);
        expect([exit.driverFrom, exit.driverTo]).toEqual(
          changed ? [stint.driver, next.driver] : ['', '']
        );
        if (changed) changes += 1;
      });
      expect(summary.driverChanges[own]).toBe(changes);
      expect(changes).toBeGreaterThan(1);
    });

    it('logs the race from the green flag, a page at a time', () => {
      const channel = read('race-log.snapshot');
      expect(channel.raceToken).toBe(summary.raceToken);
      expect(channel.events.length).toBeLessThanOrEqual(
        RACE_LOG_SNAPSHOT_EVENTS
      );
      expect(channel.events).toEqual(log.slice(-channel.events.length));
      expect(log).toHaveLength(channel.total);
      // Numbered from 1 with none missing, in the order things happened.
      expect(log.map((event) => event.seq)).toEqual(
        log.map((_, index) => index + 1)
      );
      for (let index = 1; index < log.length; index += 1) {
        expect(log[index].sessionTime).toBeGreaterThanOrEqual(
          log[index - 1].sessionTime
        );
      }
      expect(log[0]).toMatchObject({
        seq: 1,
        kind: 'flag',
        flag: 'green',
        after: 'start',
      });
      // A full-course yellow, and the green that ended it.
      const flags = log.filter((event) => event.kind === 'flag');
      expect(flags.map((event) => event.kind === 'flag' && event.flag)).toEqual(
        ['green', 'caution', 'green']
      );
      expect(flags[2]).toMatchObject({
        after: 'caution',
        durationS: flags[2].sessionTime - flags[1].sessionTime,
      });

      // Every stop of every car, in and out.
      const allStops = drivers.reduce(
        (sum, driver) => sum + stopsOf(driver.CarIdx).length,
        0
      );
      for (const kind of ['pit-entry', 'pit-exit']) {
        expect(log.filter((event) => event.kind === kind)).toHaveLength(
          allStops
        );
      }
      // The quickest lap the log gives a class is the quickest it has driven.
      const classBest = Math.min(
        ...ownClass.map((slot) => standings.carIdxBestLapTime[slot])
      );
      const fastest = log.filter(
        (event) =>
          event.kind === 'fastest-lap' && ownClass.includes(event.carIdx)
      );
      const quickest = fastest[fastest.length - 1];
      expect(quickest.kind === 'fastest-lap' && quickest.lapTime).toBe(
        classBest
      );
    });

    it('tells the weather to come the same in the forecast and in the log', () => {
      const changes = log.filter((event) => event.kind === 'forecast');
      if (options.iracing) {
        // iRacing has no forecast to change.
        expect(snapshots['weather-forecast.snapshot']).toBeUndefined();
        expect(changes).toHaveLength(0);
        return;
      }
      const weather = read('weather-forecast.snapshot');
      expect(weather.available).toBe(true);
      expect(weather.now.airTempC).toBe(bar.airTemp);
      expect(weather.nodes.length).toBeGreaterThan(0);
      for (const node of weather.nodes) {
        expect(node.startsInMinutes).toBeGreaterThanOrEqual(0);
        expect(
          Math.abs(
            (node.startsAtTimeOfDay ?? 0) -
              ((bar.sessionTimeOfDay ?? 0) + (node.startsInMinutes ?? 0) * 60)
          )
        ).toBeLessThanOrEqual(90);
      }
      // One change, to rain; and the rain it spoke of is the rain forecast.
      expect(changes).toHaveLength(1);
      const [change] = changes;
      const rain = weather.nodes.find((node) => node.skyType >= 5);
      if (change.kind !== 'forecast' || !rain) throw new Error('no rain');
      expect(change.rain).toBe(true);
      expect(change.rainChance).toBe(rain.rainChance);
      const rainAtByTheLog = change.sessionTime + (change.inMinutes ?? 0) * 60;
      const rainAtByTheForecast =
        sessionTime + (rain.startsInMinutes ?? 0) * 60;
      expect(
        Math.abs(rainAtByTheLog - rainAtByTheForecast)
      ).toBeLessThanOrEqual(120);
    });

    it('stages the circuit once: in the session, the header and the profile', () => {
      const { TrackDisplayName, TrackLength, TrackID } = session.WeekendInfo;
      const profile = read('track-profile.snapshot');
      expect(bar.trackDisplayName).toBe(TrackDisplayName);
      expect(TrackDisplayName).toMatch(/Silverstone/);
      const [length, unit] = TrackLength.split(' ');
      const metres = Number(length) * (unit === 'km' ? 1000 : 1);
      expect(Math.abs(metres - profile.trackLengthM)).toBeLessThan(10);
      expect(profile.trackKey).toBe(
        `${options.iracing ? 'iracing' : 'lmu'}:${TrackID}`
      );
      // Le Mans Ultimate's circuit is drawn from the outline in the session;
      // iRacing's from the drawing that ships under its track id.
      expect(session.LmuTrackMap !== undefined).toBe(!options.iracing);
      expect(profile.sectorStartPct).toHaveLength(SECTORS);
      expect(session.SplitTimeInfo.Sectors).toHaveLength(SECTORS);
      expect(trackState.carIdxLapDistPct).toEqual(
        standings.carIdxLapDistPct.map((pct) => Math.round(pct * 1000) / 1000)
      );
    });

    it('says of the cars only what the sim says of them', () => {
      const { laps } = recordsOf(own);
      const lastLap = laps[laps.length - 1];
      const sectors = read('car-sectors.snapshot');
      const wear = read('wear.snapshot');
      const damage = read('damage.snapshot');
      const ownForecast = forecast.cars.find((car) => car.own);
      expect(forecast.valid).toBe(true);
      expect(trackState.watching).toBe(false);
      expect(trackState.isOnTrack).toBe(true);

      if (options.iracing) {
        // No energy, no sectors, one compound, no tread and no damage; the
        // stops of a rival counted from the stints it has been seen to drive.
        expect(standings.carIdxEnergyRemaining).toEqual([]);
        expect(standings.carIdxWheelCompounds).toEqual([]);
        expect(carPit.usedAverage).toEqual([]);
        expect(sectors.available).toBe(false);
        expect(lastLap.sectors).toEqual([null, null, null]);
        expect(lastLap.energy).toBeNull();
        expect(wear.available).toBe(false);
        expect(damage.available).toBe(false);
        expect(bar.virtualEnergy).toBeUndefined();
        expect(forecast.stint?.isVirtualEnergy).toBe(false);
        expectWithin(forecast.stint?.aboard ?? 0, bar.fuelLevel ?? -1, TENTH);
        expect(
          forecast.cars.filter((car) => !car.own).map((car) => car.basis)
        ).toEqual(forecast.cars.slice(1).map(() => 'observed'));
        return;
      }

      // What our car has left: at the line by the records, and a little less
      // by now in the standings, the header and the forecast.
      const energy = standings.carIdxEnergyRemaining[own];
      expect(energy).toBeLessThanOrEqual(lastLap.energy ?? 0);
      expect((lastLap.energy ?? 0) - energy).toBeLessThan(0.04);
      expect(bar.virtualEnergy).toBe(energy);
      expect(forecast.stint?.isVirtualEnergy).toBe(true);
      expectWithin((forecast.stint?.aboard ?? 0) / 100, energy, THOUSANDTH);
      expect(ownForecast?.basis).toBe('energy');
      for (const slot of ownClass) {
        expect(standings.carIdxEnergyRemaining[slot]).toBeGreaterThan(0);
        expect(standings.carIdxEnergyRemaining[slot]).toBeLessThanOrEqual(1);
        expect(carPit.usedAverage[slot]).toBeGreaterThan(0.02);
        expect(carPit.usedAverage[slot]).toBeLessThan(0.05);
      }

      // Its compound, in the records, the standings and the tyre table.
      const wheels = [own * WHEELS, own * WHEELS + WHEELS] as const;
      expect(standings.carIdxWheelCompounds.slice(...wheels)).toEqual(
        lastLap.compounds
      );
      expect(tyres.compounds.slice(...wheels)).toEqual(lastLap.compounds);
      expect(wear.wheels.map((wheel) => wheel.compound)).toEqual(
        lastLap.compounds
      );
      // And its tread, which the sim reads while the user drives the car.
      expect(wear.available).toBe(true);
      expect(damage.available).toBe(true);
      expect(tyres.treadSource[own]).toBe(TREAD_MEASURED);
      expect(tyres.treadPct[own]).toBe(
        Math.round(mean(wear.wheels.map((wheel) => wheel.treadPct ?? 0)))
      );
      expect(tyres.setLaps[own]).toBe(openStintOf(own).laps);

      // Its last lap's sectors, in the records, the tower's and its own.
      const ownSectors = [own * SECTORS, own * SECTORS + SECTORS] as const;
      expect(sectors.available).toBe(true);
      expect(sectors.last.slice(...ownSectors)).toEqual(lastLap.sectors);
      expect(
        read('sector-timing.snapshot').clean.previousLapSectorTimes
      ).toEqual(lastLap.sectors);
      // The quickest it has done each sector is of the whole race.
      expect(sectors.best.slice(...ownSectors)).toEqual(
        [0, 1, 2].map((sector) =>
          Math.min(...laps.map((lap) => lap.sectors[sector] ?? Infinity))
        )
      );
    });

    it('has a snapshot for every channel the hosted widgets read', () => {
      const absent = absentOnPurpose(options);
      const read = new Set<ChannelName>(
        HOSTED.flatMap(
          (definition) => definition.channels as readonly ChannelName[]
        )
      );
      expect(HOSTED.map((definition) => definition.id)).toEqual([
        'timingtower',
        'ourcar',
        'classrivals',
        'stinttimeline',
        'crew',
        'carlaps',
        'racecharts',
        'racelog',
        'map',
        'weatherforecast',
        'pitwall',
      ]);
      const staged = Object.entries(snapshots)
        .filter(([, snapshot]) => snapshot !== undefined)
        .map(([channel]) => channel);
      const expected = [...read].filter((channel) => !(channel in absent));
      expect(staged).toEqual(expect.arrayContaining(expected));
      // A channel is left out for the reason given, and for no other.
      for (const channel of Object.keys(absent)) {
        expect(read.has(channel as ChannelName)).toBe(true);
        expect(staged).not.toContain(channel);
      }
      // And the stage has no channel nobody reads.
      expect([...read]).toEqual(expect.arrayContaining(staged));
    });
  }
);

describe('the staged race of the Pit Wall page, while a team-mate drives', () => {
  const race = pitWallRace({ watching: true });
  const atTheWheel = pitWallRace({ ownLaps: 141 });
  const own = race.slotOf(OWN_CAR);
  const { snapshots } = race;

  it('is the stint of a team-mate, whom the session names', () => {
    const driver = race.session.DriverInfo.Drivers[own].UserName;
    expect(driver).toBe('Dmitri Sokolov');
    expect(driver).not.toBe(PIT_WALL_RACE_USER);
    expect(snapshots['race-history.summary']?.stintDriver[own]).toBe(driver);
    expect(snapshots['track-state.snapshot']).toMatchObject({
      focusCarIdx: own,
      isOnTrack: false,
      outOfCar: true,
      watching: true,
      watchingOwnCar: true,
    });
  });

  it('has no tread and no damage to show, and a forecast all the same', () => {
    const forecast = snapshots['race-forecast.snapshot'];
    expect(snapshots['wear.snapshot']?.available).toBe(false);
    expect(snapshots['damage.snapshot']?.available).toBe(false);
    expect(snapshots['class-tyres.snapshot']?.treadSource[own]).not.toBe(
      TREAD_MEASURED
    );
    expect(forecast?.valid).toBe(true);
    // The sim goes on writing the car's virtual energy, and not its tank.
    expect(forecast?.stint).toMatchObject({
      isVirtualEnergy: true,
      tankLapsLeft: null,
    });
    expect(forecast?.place?.now).toBe(
      snapshots['standings.snapshot']?.carIdxClassPosition[own]
    );
  });

  it('is otherwise the race of the same moment with the user at the wheel', () => {
    expect(race.sessionTime).toBe(atTheWheel.sessionTime);
    for (const channel of [
      'standings.snapshot',
      'race-history.summary',
      'car-pit.snapshot',
      'lap-times.snapshot',
      'race-log.snapshot',
      'session-bar.snapshot',
      'session-timing.snapshot',
    ] as const) {
      expect(snapshots[channel]).toEqual(atTheWheel.snapshots[channel]);
    }
    expect(
      snapshots['race-forecast.snapshot']?.cars.map((car) => car.carIdx)
    ).toEqual(
      atTheWheel.snapshots['race-forecast.snapshot']?.cars.map(
        (car) => car.carIdx
      )
    );
  });

  it('is left aside under iRacing, where the app watches nobody yet', () => {
    const iracing = pitWallRace({ watching: true, iracing: true });
    expect(iracing.sessionTime).toBe(race.sessionTime);
    expect(iracing.snapshots['track-state.snapshot']).toMatchObject({
      isOnTrack: true,
      watching: false,
      watchingOwnCar: false,
    });
  });
});
