import { describe, expect, it } from 'vitest';
import { channelRegistry, SessionState } from '@irdashies/types';
import type { Session, Telemetry } from '@irdashies/types';
import { createProcessorDefinitions } from './processorRegistry';

/**
 * Snapshot channels owned by a standalone runtime instead of the host.
 * LapHistoryRuntime and PitStopRuntime record outside demand gating so an enabled
 * Gantry keeps recording with its window closed; registering them here as well
 * would run a second processor and publish a competing snapshot.
 * ReplayContextRuntime is read by the incident and lap-history runtimes, so it
 * must run whether or not a window subscribes.
 * StreamChatService holds the Twitch and YouTube connections and reads no
 * telemetry, so it has nothing to do with the frame loop.
 * PlayerLedgerRuntime keeps the player's laps and stints, which are stored:
 * a record with a hole for every minute no widget was showing is no record.
 * Its wear forecast is made from those laps, so it is published from there.
 * RaceHistoryRuntime keeps every lap of every car for the whole race, which
 * is stored too, and publishes what it holds of each car. The race's log is
 * kept by the same runtime, for the same reason, and published by it.
 * ClassTyresRuntime reads those records and watches the cars' wear beside
 * it: a set of tyres that went on while no window looked still went on.
 */
const RUNTIME_OWNED_CHANNELS = [
  'lap-history.snapshot',
  'pit-stops.snapshot',
  'player-ledger.snapshot',
  'player-stint.snapshot',
  'wear.snapshot',
  'class-tyres.snapshot',
  'race-history.summary',
  'race-log.snapshot',
  'replay.context',
  'streamchat.messages',
  'streamchat.emotes',
];

describe('processor registry', () => {
  it('registers every host-owned snapshot channel exactly once', () => {
    const definitions = createProcessorDefinitions({
      referenceLapPersistence: {
        load: () => null,
        save: () => undefined,
      },
    });
    const snapshotChannels = Object.entries(channelRegistry)
      .filter(([, channel]) => channel.kind === 'snapshot')
      .map(([channel]) => channel)
      .filter((channel) => !RUNTIME_OWNED_CHANNELS.includes(channel))
      .sort();

    expect(definitions.map(({ channel }) => channel).sort()).toEqual(
      snapshotChannels
    );
    expect(new Set(definitions.map(({ channel }) => channel)).size).toBe(
      definitions.length
    );
  });

  it('leaves runtime-owned channels out of the host registry', () => {
    const definitions = createProcessorDefinitions({
      referenceLapPersistence: {
        load: () => null,
        save: () => undefined,
      },
    });
    const channels = definitions.map(({ channel }) => channel);

    for (const runtimeOwned of RUNTIME_OWNED_CHANNELS) {
      expect(channels).not.toContain(runtimeOwned);
    }
  });

  it('gives the race plan processor no plan unless a bridge hands one in', () => {
    // As the Le Mans Ultimate bridge builds the registry: without `racePlan`.
    // A plan is keyed to iRacing, and the stint history to a session id that
    // names one event, so there the processor follows nothing and has
    // nowhere to write.
    const definition = createProcessorDefinitions({
      referenceLapPersistence: {
        load: () => null,
        save: () => undefined,
      },
    }).find(({ channel }) => channel === 'race-plan.progress');
    const processor = definition?.create({
      aggregateReplay: false,
      sourceReplay: false,
      snapshot: () => undefined,
    });

    processor?.init({
      WeekendInfo: {
        SubSessionID: 99,
        TrackID: 7,
        SimMode: 'Le Mans Ultimate',
      },
      SessionInfo: { Sessions: [{ SessionNum: 10, SessionType: 'Race' }] },
      DriverInfo: {
        DriverCarIdx: 0,
        Drivers: [{ CarIdx: 0, UserID: 0, TeamID: 0 }],
      },
    } as unknown as Session);
    for (const sessionTime of [10, 20, 30]) {
      processor?.onFrame({
        SessionTime: { value: [sessionTime] },
        SessionNum: { value: [10] },
        SessionState: { value: [SessionState.Racing] },
        CarIdxLapCompleted: { value: [sessionTime / 10] },
        FuelLevel: { value: [50] },
      } as unknown as Telemetry);
    }

    expect(processor?.snapshot()).toMatchObject({
      status: 'no-plan',
      planningId: null,
      stints: [],
    });
  });

  it('declares the processor dependency graph explicitly', () => {
    const definitions = createProcessorDefinitions({
      referenceLapPersistence: {
        load: () => null,
        save: () => undefined,
      },
    });
    const dependencies = Object.fromEntries(
      definitions.map(({ channel, dependencies: required = [] }) => [
        channel,
        required,
      ])
    );

    expect(dependencies['relative-gaps.snapshot']).toEqual([
      'reference-laps.snapshot',
    ]);
    expect(dependencies['session-timing.snapshot']).toEqual([
      'lap-times.snapshot',
    ]);
  });
});
