import { describe, expect, it } from 'vitest';
import type { Session, Telemetry } from '@irdashies/types';
import { SectorTimingProcessor } from './SectorTimingProcessor';

const session = {
  SplitTimeInfo: {
    Sectors: [
      { SectorNum: 0, SectorStartPct: 0 },
      { SectorNum: 1, SectorStartPct: 0.5 },
    ],
  },
} as Session;

const frame = (
  lapDistPct: number,
  sessionTime: number,
  isOnTrack = true,
  sessionNum = 1
) =>
  ({
    LapDistPct: { value: [lapDistPct] },
    SessionTime: { value: [sessionTime] },
    IsOnTrack: { value: [isOnTrack] },
    SessionNum: { value: [sessionNum] },
  }) as unknown as Telemetry;

describe('SectorTimingProcessor', () => {
  it('interpolates crossings and records clean and inclusive timing views', () => {
    const processor = new SectorTimingProcessor();
    processor.init(session);
    processor.onFrame(frame(0.9, 90));
    processor.onFrame(frame(0.1, 110));
    processor.onFrame(frame(0.4, 140));
    processor.onFrame(frame(0.6, 160));

    const snapshot = processor.snapshot();
    expect(snapshot.currentSectorIdx).toBe(1);
    expect(snapshot.inclusive.currentLapSectorTimes[0]).toBeCloseTo(50);
    expect(snapshot.clean.currentLapSectorTimes[0]).toBeCloseTo(50);
    expect(snapshot.inclusive.sessionBestSectorTimes[0]).toBeCloseTo(50);
  });

  it('keeps incident-inclusive and clean-only histories independent', () => {
    const processor = new SectorTimingProcessor();
    processor.init(session);
    processor.onFrame(frame(0.9, 90));
    processor.onFrame(frame(0.1, 110));
    processor.onFrame(frame(0.3, 130));
    processor.onFrame(frame(0.31, 131, false));
    processor.onFrame(frame(0.4, 140));
    processor.onFrame(frame(0.6, 160));

    const snapshot = processor.snapshot();
    expect(snapshot.inclusive.currentLapSectorTimes[0]).toBeCloseTo(50);
    expect(snapshot.inclusive.currentLapSectorUnclean[0]).toBe(true);
    expect(snapshot.clean.currentLapSectorTimes[0]).toBeNull();
    expect(snapshot.clean.sessionBestSectorTimes[0]).toBeNull();
  });

  it('times nothing across a long spell out of the car', () => {
    // A team-mate's stint under Le Mans Ultimate: the player leaves the car
    // in the first sector and is back in it most of two hours later, a
    // little further round. The boundary they then cross closes nothing.
    const processor = new SectorTimingProcessor();
    processor.init(session);
    processor.onFrame(frame(0.9, 90));
    processor.onFrame(frame(0.1, 110));
    processor.onFrame(frame(0.2, 120));
    processor.onFrame(frame(0.2, 121, false));
    processor.onFrame(frame(0.35, 6500, false));
    processor.onFrame(frame(0.4, 6510));
    expect(processor.snapshot().sectorEntryValid).toBe(false);
    processor.onFrame(frame(0.6, 6530));

    const snapshot = processor.snapshot();
    expect(snapshot.currentSectorIdx).toBe(1);
    expect(snapshot.inclusive.currentLapSectorTimes[0]).toBeNull();
    expect(snapshot.inclusive.sessionBestSectorTimes[0]).toBeNull();
    expect(snapshot.clean.sessionBestSectorTimes[0]).toBeNull();

    // The sector entered at that boundary is theirs, and it is timed.
    processor.onFrame(frame(0.95, 6565));
    processor.onFrame(frame(0.05, 6575));
    expect(
      processor.snapshot().inclusive.sessionBestSectorTimes[1]
    ).toBeCloseTo(50);
  });

  it('does not carry a sector over a return further round the lap', () => {
    // Out at the end of the lap, back in the car at the start of the next:
    // not a line crossed, and not a lap of sector times.
    const processor = new SectorTimingProcessor();
    processor.init(session);
    processor.onFrame(frame(0.4, 40));
    processor.onFrame(frame(0.6, 60));
    processor.onFrame(frame(0.9, 90));
    processor.onFrame(frame(0.9, 91, false));
    processor.onFrame(frame(0.1, 400));
    processor.onFrame(frame(0.3, 420));

    const snapshot = processor.snapshot();
    expect(snapshot.sectorEntryValid).toBe(false);
    expect(snapshot.inclusive.previousLapSectorTimes[1]).toBeNull();
    expect(snapshot.inclusive.sessionBestSectorTimes[1]).toBeNull();
  });

  describe('LMU lap void flag', () => {
    const lmuFrame = (
      lapDistPct: number,
      sessionTime: number,
      voided: boolean
    ) =>
      ({
        ...frame(lapDistPct, sessionTime),
        LmuLapInvalidated: { value: [voided] },
      }) as unknown as Telemetry;

    it('keeps a sector voided by a track cut out of the clean bests', () => {
      // LMU voids the lap without the car leaving the track.
      const processor = new SectorTimingProcessor();
      processor.init(session);
      processor.onFrame(lmuFrame(0.9, 90, false));
      processor.onFrame(lmuFrame(0.1, 110, false));
      processor.onFrame(lmuFrame(0.3, 130, true));
      processor.onFrame(lmuFrame(0.6, 160, true));

      const snapshot = processor.snapshot();
      expect(snapshot.inclusive.currentLapSectorTimes[0]).toBeCloseTo(50);
      expect(snapshot.inclusive.currentLapSectorUnclean[0]).toBe(true);
      expect(snapshot.clean.currentLapSectorTimes[0]).toBeNull();
      expect(snapshot.clean.sessionBestSectorTimes[0]).toBeNull();
    });

    it("ignores the flag just after the line, where it is the previous lap's", () => {
      const processor = new SectorTimingProcessor();
      processor.init(session);
      processor.onFrame(lmuFrame(0.9, 90, true));
      processor.onFrame(lmuFrame(0.02, 102, true));
      processor.onFrame(lmuFrame(0.3, 130, false));
      processor.onFrame(lmuFrame(0.6, 160, false));

      const snapshot = processor.snapshot();
      expect(snapshot.inclusive.currentLapSectorUnclean[0]).toBe(false);
      expect(snapshot.clean.sessionBestSectorTimes[0]).not.toBeNull();
    });
  });

  it('resets state for session changes and disconnects', () => {
    const processor = new SectorTimingProcessor();
    processor.init(session);
    processor.onFrame(frame(0.9, 90));
    processor.onFrame(frame(0.1, 110));
    processor.onFrame(frame(0.6, 160, true, 2));
    expect(processor.snapshot().sessionNum).toBe(2);
    expect(processor.snapshot().inclusive.sessionBestSectorTimes).toEqual([
      null,
      null,
    ]);

    processor.onLifecycle({ type: 'disconnect' });
    expect(processor.snapshot().sectors).toEqual([]);
    expect(processor.snapshot().sessionNum).toBeNull();
  });

  it('does not aggregate replay scrubbing unless the runtime opts in', () => {
    const processor = new SectorTimingProcessor();
    processor.init(session);
    processor.onLifecycle({ type: 'enter', replay: true });
    processor.onFrame(frame(0.9, 90));
    processor.onFrame(frame(0.1, 110));
    expect(processor.snapshot().inclusive.sessionBestSectorTimes).toEqual([
      null,
      null,
    ]);
  });

  it('does not record a sector entered from an unknown mid-lap position', () => {
    const processor = new SectorTimingProcessor();
    processor.init(session);
    processor.onFrame(frame(0.2, 20));
    processor.onFrame(frame(0.6, 60));
    expect(processor.snapshot().inclusive.currentLapSectorTimes).toEqual([
      null,
      null,
    ]);
  });

  it('keeps the public snapshot stable between sector events', () => {
    const processor = new SectorTimingProcessor();
    processor.init(session);
    processor.onFrame(frame(0.1, 10));
    const snapshot = processor.snapshot();

    processor.onFrame(frame(0.2, 20));
    processor.onFrame(frame(0.3, 30));

    expect(processor.snapshot()).toBe(snapshot);
    expect(processor.snapshot().version).toBe(snapshot.version);
  });

  it('invalidates active resets without discarding completed sectors', () => {
    const processor = new SectorTimingProcessor();
    processor.init(session);
    processor.onFrame(frame(0.9, 90));
    processor.onFrame(frame(0.1, 110));
    processor.onFrame(frame(0.6, 160));
    expect(processor.snapshot().inclusive.currentLapSectorTimes[0]).toBe(50);

    processor.onFrame(frame(0.95, 161));
    expect(processor.snapshot().sectorEntryValid).toBe(false);
    expect(processor.snapshot().inclusive.currentLapSectorTimes[0]).toBe(50);
  });

  it('does not invalidate sector entry on sub-MIN_PROGRESS backward jitter', () => {
    const processor = new SectorTimingProcessor();
    processor.init(session);
    processor.onFrame(frame(0.9, 90));
    processor.onFrame(frame(0.1, 110));
    processor.onFrame(frame(0.6, 160));
    expect(processor.snapshot().sectorEntryValid).toBe(true);

    // A sub-MIN_PROGRESS step backward — the kind of position-signal noise
    // heavy/early braking produces at near-zero ground speed. Unlike the
    // large forward jump above, this must not be mistaken for a teleport.
    processor.onFrame(frame(0.6 - 1e-6, 161));

    expect(processor.snapshot().sectorEntryValid).toBe(true);
    expect(processor.snapshot().inclusive.currentLapSectorTimes[0]).toBe(50);
  });

  it('keeps timing state when identical sector data is republished', () => {
    const processor = new SectorTimingProcessor();
    processor.init(session);
    processor.onFrame(frame(0.9, 90));
    processor.onFrame(frame(0.1, 110));
    processor.onFrame(frame(0.6, 160));
    processor.init({
      SplitTimeInfo: { Sectors: [...session.SplitTimeInfo.Sectors] },
    } as Session);
    expect(processor.snapshot().inclusive.currentLapSectorTimes[0]).toBe(50);
  });

  it('resets timing when sector boundaries change', () => {
    const processor = new SectorTimingProcessor();
    processor.init(session);
    processor.onFrame(frame(0.9, 90));
    processor.onFrame(frame(0.1, 110));
    processor.init({
      SplitTimeInfo: {
        Sectors: [
          { SectorNum: 0, SectorStartPct: 0 },
          { SectorNum: 1, SectorStartPct: 0.4 },
        ],
      },
    } as Session);
    expect(processor.snapshot().inclusive.sessionBestSectorTimes).toEqual([
      null,
      null,
    ]);
    expect(processor.snapshot().sectorEntryValid).toBe(false);
  });

  describe("under LMU's own sector timing", () => {
    // The sim's sectors start at 40 % and 80 % of this lap, which it does not
    // say; the session says thirds. Its sector index and times come from a
    // block written five times a second, so they move a tenth of a second
    // after the car does here, and the lap clock says by how much.
    type Times = [number | null, number | null, number | null];
    interface SimOptions {
      voided?: boolean;
      isOnTrack?: boolean;
    }
    const NONE: Times = [null, null, null];
    /** The lap before the one driven here, and the one driven here. */
    const OLD: Times = [41.5, 31.5, 21.5];
    const LAP: Times = [40.012, 30.034, 19.954];
    const thirds = {
      SplitTimeInfo: {
        Sectors: [
          { SectorNum: 0, SectorStartPct: 0 },
          { SectorNum: 1, SectorStartPct: 1 / 3 },
          { SectorNum: 2, SectorStartPct: 2 / 3 },
        ],
      },
    } as Session;

    const sim = (
      sessionTime: number,
      lapDistPct: number,
      sectorIdx: number,
      lapClock: number | null,
      current: Times,
      last: Times,
      { voided = false, isOnTrack = true }: SimOptions = {}
    ) =>
      ({
        ...frame(lapDistPct, sessionTime, isOnTrack),
        LmuSectorIdx: { value: [sectorIdx] },
        LmuCurrentSectorTimes: { value: current },
        LmuLastSectorTimes: { value: last },
        LmuLapInvalidated: { value: [voided] },
        ...(lapClock === null
          ? {}
          : { LapCurrentLapTime: { value: [lapClock] } }),
      }) as unknown as Telemetry;

    const start = () => {
      const processor = new SectorTimingProcessor();
      processor.init(thirds);
      return processor;
    };

    /** Over the line at 100 s, watched from the end of the lap before. */
    const crossLine = (processor: SectorTimingProcessor) => {
      processor.onFrame(sim(99.9, 0.999, 2, 92.9, [41.5, 31.5, null], NONE));
      processor.onFrame(sim(100.1, 0.001, 0, 0.1, NONE, OLD));
    };

    /** The first sector of that lap, which the sim times at 40.012 s. */
    const driveFirstSector = (
      processor: SectorTimingProcessor,
      options: SimOptions = {}
    ) => {
      processor.onFrame(sim(139.9, 0.399, 0, 39.9, NONE, OLD, options));
      processor.onFrame(
        sim(140.112, 0.4016, 1, 40.112, [40.012, null, null], OLD, options)
      );
    };

    /** The second, at 30.034 s. */
    const driveSecondSector = (
      processor: SectorTimingProcessor,
      options: SimOptions = {}
    ) => {
      processor.onFrame(
        sim(169.9, 0.798, 1, 69.9, [40.012, null, null], OLD, options)
      );
      processor.onFrame(
        sim(170.146, 0.801, 2, 70.146, [40.012, 30.034, null], OLD, options)
      );
    };

    /** The third, at 19.954 s, and the line: a lap of exactly 90 s. */
    const driveThirdSector = (
      processor: SectorTimingProcessor,
      options: SimOptions = {}
    ) => {
      processor.onFrame(
        sim(189.9, 0.999, 2, 89.9, [40.012, 30.034, null], OLD, options)
      );
      processor.onFrame(sim(190.1, 0.001, 0, 0.1, NONE, LAP));
    };

    /** The first sector of the lap after, quicker at 39.612 s. */
    const driveQuickerFirstSector = (processor: SectorTimingProcessor) => {
      processor.onFrame(sim(229.5, 0.399, 0, 39.5, NONE, LAP));
      processor.onFrame(
        sim(229.71, 0.4016, 1, 39.71, [39.612, null, null], LAP)
      );
    };

    it("records the sim's sector times through a lap and over the line", () => {
      const processor = start();
      crossLine(processor);
      driveFirstSector(processor);
      expect(processor.snapshot().currentSectorIdx).toBe(1);
      expect(processor.snapshot().inclusive.currentLapSectorTimes).toEqual([
        40.012,
        null,
        null,
      ]);

      driveSecondSector(processor);
      expect(processor.snapshot().currentSectorIdx).toBe(2);
      expect(processor.snapshot().inclusive.currentLapSectorTimes).toEqual([
        40.012,
        30.034,
        null,
      ]);

      driveThirdSector(processor);
      const snapshot = processor.snapshot();
      expect(snapshot.currentSectorIdx).toBe(0);
      expect(snapshot.inclusive.currentLapSectorTimes).toEqual(NONE);
      expect(snapshot.inclusive.previousLapSectorTimes).toEqual(LAP);
      expect(snapshot.inclusive.sessionBestSectorTimes).toEqual(LAP);
      expect(snapshot.clean.previousLapSectorTimes).toEqual(LAP);
      expect(snapshot.inclusive.previousLapSectorUnclean).toEqual([
        false,
        false,
        false,
      ]);
    });

    it('keeps a quicker sector as the session best and the old one behind it', () => {
      const processor = start();
      crossLine(processor);
      driveFirstSector(processor);
      driveSecondSector(processor);
      driveThirdSector(processor);
      driveQuickerFirstSector(processor);

      const { inclusive } = processor.snapshot();
      expect(inclusive.currentLapSectorTimes).toEqual([39.612, null, null]);
      expect(inclusive.sessionBestSectorTimes[0]).toBe(39.612);
      expect(inclusive.previousSessionBestSectorTimes[0]).toBe(40.012);
      // The other two cards still hold the lap before.
      expect(inclusive.previousLapSectorTimes).toEqual([
        39.612, 30.034, 19.954,
      ]);
    });

    it("follows the sim's sector index, not the session's thirds", () => {
      const processor = start();
      // 36 % round the lap is the second third and the sim's first sector.
      processor.onFrame(sim(136, 0.36, 0, 36, NONE, OLD));
      expect(processor.snapshot().currentSectorIdx).toBe(0);
      processor.onFrame(sim(175, 0.85, 2, 75, [40.012, 30.034, null], OLD));
      expect(processor.snapshot().currentSectorIdx).toBe(2);
    });

    it('dates a sector entry at the crossing, not at the late index', () => {
      const processor = start();
      crossLine(processor);
      expect(processor.snapshot().sectorEntryValid).toBe(true);
      expect(processor.snapshot().sectorEntryTime).toBeCloseTo(100, 6);

      // The line plus the sim's own sector times, a tenth of a second
      // before the frames that carried them.
      driveFirstSector(processor);
      expect(processor.snapshot().sectorEntryTime).toBeCloseTo(140.012, 6);
      driveSecondSector(processor);
      expect(processor.snapshot().sectorEntryTime).toBeCloseTo(170.046, 6);
      driveThirdSector(processor);
      expect(processor.snapshot().sectorEntryTime).toBeCloseTo(190, 6);
    });

    it('dates the entry at the index change when the lap clock cannot place it', () => {
      const processor = start();
      crossLine(processor);
      processor.onFrame(sim(139.9, 0.399, 0, null, NONE, OLD));
      processor.onFrame(sim(140.1, 0.4013, 1, null, [40.012, null, null], OLD));
      expect(processor.snapshot().sectorEntryTime).toBe(140.1);

      // A lap clock still on the lap before is no measure of this crossing.
      processor.onFrame(sim(169.9, 0.798, 1, 69.9, [40.012, null, null], OLD));
      processor.onFrame(
        sim(170.1, 0.801, 2, 160.1, [40.012, 30.034, null], OLD)
      );
      expect(processor.snapshot().sectorEntryTime).toBe(170.1);
      expect(processor.snapshot().inclusive.currentLapSectorTimes[1]).toBe(
        30.034
      );
    });

    it('learns where the sectors start from where the car crosses into them', () => {
      const processor = start();
      crossLine(processor);
      const starts = () =>
        processor.snapshot().sectors.map((sector) => sector.SectorStartPct);
      expect(starts()).toEqual([0, 1 / 3, 2 / 3]);

      driveFirstSector(processor);
      expect(starts()[1]).toBeCloseTo(0.4, 3);
      expect(starts()[2]).toBe(2 / 3);
      driveSecondSector(processor);
      expect(starts()[1]).toBeCloseTo(0.4, 3);
      expect(starts()[2]).toBeCloseTo(0.8, 3);
      expect(processor.snapshot().sectors.map((s) => s.SectorNum)).toEqual([
        0, 1, 2,
      ]);

      // The session comes round again unchanged: nothing learned is lost.
      processor.init({
        SplitTimeInfo: { Sectors: [...thirds.SplitTimeInfo.Sectors] },
      } as Session);
      expect(starts()[2]).toBeCloseTo(0.8, 3);
      expect(processor.snapshot().inclusive.currentLapSectorTimes[1]).toBe(
        30.034
      );
    });

    it('keeps an unseen sector start on its own side of one just learned', () => {
      // A first sector of three quarters of the lap: its end is past the
      // third the next one is still assumed to start at.
      const processor = start();
      crossLine(processor);
      processor.onFrame(sim(174.9, 0.749, 0, 74.9, NONE, OLD));
      processor.onFrame(sim(175.1, 0.751, 1, 75.1, [75, null, null], OLD));

      const [, second, third] = processor
        .snapshot()
        .sectors.map((sector) => sector.SectorStartPct);
      expect(second).toBeCloseTo(0.75, 3);
      expect(third).toBeGreaterThan(second);
      expect(third).toBeLessThan(1);
    });

    it('does not record the sector the car is first seen in', () => {
      // Joined in the middle of the first sector: the sim has a time for it,
      // but how it was driven was not seen.
      const processor = start();
      processor.onFrame(sim(120, 0.2, 0, 20, NONE, OLD));
      expect(processor.snapshot().sectorEntryValid).toBe(false);
      driveFirstSector(processor);
      expect(processor.snapshot().sectorEntryValid).toBe(true);
      expect(processor.snapshot().inclusive.currentLapSectorTimes).toEqual(
        NONE
      );

      driveSecondSector(processor);
      expect(processor.snapshot().inclusive.currentLapSectorTimes).toEqual([
        null,
        30.034,
        null,
      ]);
    });

    it('marks the sectors of a lap the sim voided and keeps them out of the clean view', () => {
      const processor = start();
      crossLine(processor);
      driveFirstSector(processor);
      // A track cut in the second sector; the flag stays up to the line.
      driveSecondSector(processor, { voided: true });
      driveThirdSector(processor, { voided: true });

      const { inclusive, clean } = processor.snapshot();
      expect(inclusive.previousLapSectorTimes).toEqual(LAP);
      expect(inclusive.previousLapSectorUnclean).toEqual([false, true, true]);
      expect(clean.previousLapSectorTimes).toEqual([40.012, null, null]);
      expect(clean.sessionBestSectorTimes).toEqual([40.012, null, null]);

      // The next lap starts clean.
      driveQuickerFirstSector(processor);
      expect(processor.snapshot().clean.currentLapSectorTimes[0]).toBe(39.612);
      expect(processor.snapshot().inclusive.currentLapSectorUnclean[0]).toBe(
        false
      );
    });

    it('records nothing on an out-lap the sim does not time', () => {
      // Out of the pits in the third sector, over the line in the pit lane
      // and round the lap, with no time from the sim for any of it and the
      // lap before still in its last-lap times.
      const processor = start();
      processor.onFrame(sim(8, 0.95, 2, 8, NONE, OLD));
      processor.onFrame(sim(9.9, 0.999, 2, 9.9, NONE, OLD));
      processor.onFrame(sim(10.1, 0.001, 0, 0.1, NONE, OLD));
      processor.onFrame(sim(59.9, 0.399, 0, 49.9, NONE, OLD));
      processor.onFrame(sim(60.1, 0.4013, 1, 50.1, NONE, OLD));

      let snapshot = processor.snapshot();
      expect(snapshot.currentSectorIdx).toBe(1);
      expect(snapshot.inclusive.currentLapSectorTimes).toEqual(NONE);
      // The sector entered there is watched from its start all the same,
      // from the frame the index moved: there is no sector time to date it by.
      expect(snapshot.sectorEntryValid).toBe(true);
      expect(snapshot.sectorEntryTime).toBe(60.1);

      processor.onFrame(sim(89.9, 0.798, 1, 79.9, NONE, OLD));
      processor.onFrame(sim(90.1, 0.801, 2, 80.1, NONE, OLD));
      processor.onFrame(sim(99.9, 0.999, 2, 89.9, NONE, OLD));
      processor.onFrame(sim(100.1, 0.001, 0, 0.1, NONE, OLD));
      snapshot = processor.snapshot();
      expect(snapshot.inclusive.previousLapSectorTimes).toEqual(NONE);
      expect(snapshot.inclusive.sessionBestSectorTimes).toEqual(NONE);

      // The flying lap after it is timed from its first sector.
      driveFirstSector(processor);
      expect(processor.snapshot().inclusive.currentLapSectorTimes[0]).toBe(
        40.012
      );
    });

    it('leaves the last sector empty when the sim does not time the lap', () => {
      const processor = start();
      crossLine(processor);
      driveFirstSector(processor);
      driveSecondSector(processor);
      processor.onFrame(
        sim(189.9, 0.999, 2, 89.9, [40.012, 30.034, null], OLD)
      );
      // Over the line with the last-lap times still those of the lap before.
      processor.onFrame(sim(190.1, 0.001, 0, 0.1, NONE, OLD));

      const { inclusive } = processor.snapshot();
      expect(inclusive.currentLapSectorTimes).toEqual(NONE);
      expect(inclusive.previousLapSectorTimes).toEqual([40.012, 30.034, null]);
      expect(inclusive.sessionBestSectorTimes[2]).toBeNull();
      expect(processor.snapshot().sectorEntryValid).toBe(true);
    });

    describe('after a lap the sim did not time', () => {
      /** A whole timed lap, then the first two sectors of the next. */
      const lapAndTwoSectors = () => {
        const processor = start();
        crossLine(processor);
        driveFirstSector(processor);
        driveSecondSector(processor);
        driveThirdSector(processor);
        expect(processor.snapshot().inclusive.previousLapSectorTimes).toEqual(
          LAP
        );
        driveQuickerFirstSector(processor);
        processor.onFrame(
          sim(259.5, 0.798, 1, 69.5, [39.612, null, null], LAP)
        );
        processor.onFrame(
          sim(259.746, 0.801, 2, 69.746, [39.612, 29.934, null], LAP)
        );
        processor.onFrame(
          sim(279.5, 0.999, 2, 89.5, [39.612, 29.934, null], LAP)
        );
        return processor;
      };

      it.each([
        // An out-lap, or a lap not counted: the lap before still stands in
        // the sim's last-lap times.
        ['left as the lap before', LAP],
        // A lap it voided: the lap time reads as not set.
        ['cleared', [39.612, 29.934, null] as Times],
        ['all cleared', NONE],
      ])(
        'has no third sector for it when the last-lap times are %s',
        (_, lastLapTimes) => {
          const processor = lapAndTwoSectors();
          processor.onFrame(sim(279.7, 0.001, 0, 0.1, NONE, lastLapTimes));

          const { inclusive, clean } = processor.snapshot();
          // The lap that has just ended, as it was timed.
          expect(inclusive.finishedLapSectorTimes).toEqual([
            39.612,
            29.934,
            null,
          ]);
          // And nothing of the lap before left where its third sector
          // would be read as this lap's.
          expect(inclusive.previousLapSectorTimes).toEqual([
            39.612,
            29.934,
            null,
          ]);
          expect(clean.previousLapSectorTimes).toEqual([39.612, 29.934, null]);
          expect(inclusive.previousLapSectorUnclean).toEqual([
            false,
            false,
            false,
          ]);
          // The best third sector is still the timed lap's.
          expect(inclusive.sessionBestSectorTimes[2]).toBe(19.954);
          expect(processor.snapshot().sectorEntryValid).toBe(true);
        }
      );

      it('has none of the lap before left after an out-lap with no times at all', () => {
        const processor = start();
        crossLine(processor);
        driveFirstSector(processor);
        driveSecondSector(processor);
        driveThirdSector(processor);
        // Round again with the sim timing nothing: every index moves, no
        // sector time appears, and the last-lap times stay the lap before's.
        processor.onFrame(sim(229.9, 0.399, 0, 39.9, NONE, LAP));
        processor.onFrame(sim(230.1, 0.4013, 1, 40.1, NONE, LAP));
        processor.onFrame(sim(259.9, 0.798, 1, 69.9, NONE, LAP));
        processor.onFrame(sim(260.1, 0.801, 2, 70.1, NONE, LAP));
        // Until the line the lap before still stands in, sector by sector.
        expect(processor.snapshot().inclusive.previousLapSectorTimes).toEqual(
          LAP
        );
        processor.onFrame(sim(279.9, 0.999, 2, 89.9, NONE, LAP));
        processor.onFrame(sim(280.1, 0.001, 0, 0.1, NONE, LAP));

        const { inclusive, clean } = processor.snapshot();
        expect(inclusive.finishedLapSectorTimes).toEqual(NONE);
        expect(inclusive.previousLapSectorTimes).toEqual(NONE);
        expect(clean.previousLapSectorTimes).toEqual(NONE);
        // What was driven before it is still the session's best.
        expect(inclusive.sessionBestSectorTimes).toEqual(LAP);
        expect(inclusive.sessionBestLapSectorTimes).toEqual(LAP);
      });

      it('keeps a sector that was timed and left the track in the clean view as before', () => {
        // Not the same thing: this sector has a time, which the clean view
        // leaves out, and its last clean one goes on standing in there.
        const processor = lapAndTwoSectors();
        processor.onFrame(
          sim(279.6, 0.9995, 2, 89.6, [39.612, 29.934, null], LAP, {
            voided: true,
          })
        );
        processor.onFrame(
          sim(279.7, 0.001, 0, 0.1, NONE, [39.612, 29.934, 20.1])
        );

        const { inclusive, clean } = processor.snapshot();
        expect(inclusive.previousLapSectorTimes).toEqual([
          39.612, 29.934, 20.1,
        ]);
        expect(inclusive.previousLapSectorUnclean).toEqual([
          false,
          false,
          true,
        ]);
        expect(clean.previousLapSectorTimes).toEqual([39.612, 29.934, 19.954]);
      });
    });

    it('takes a figure that is missing, zero, negative or not a number as no time', () => {
      for (const missing of [null, 0, -1, Number.NaN]) {
        const processor = start();
        crossLine(processor);
        processor.onFrame(sim(139.9, 0.399, 0, 39.9, NONE, OLD));
        processor.onFrame(
          sim(140.1, 0.4013, 1, 40.1, [missing, null, null], OLD)
        );
        const snapshot = processor.snapshot();
        expect(snapshot.currentSectorIdx).toBe(1);
        expect(snapshot.inclusive.currentLapSectorTimes).toEqual(NONE);
        expect(snapshot.inclusive.sessionBestSectorTimes).toEqual(NONE);
      }

      // The times not published at all, with only the index to go by.
      const processor = start();
      const bare = (
        sessionTime: number,
        lapDistPct: number,
        sectorIdx: number
      ) =>
        ({
          ...frame(lapDistPct, sessionTime),
          LmuSectorIdx: { value: [sectorIdx] },
        }) as unknown as Telemetry;
      processor.onFrame(bare(99.9, 0.999, 2));
      processor.onFrame(bare(100.1, 0.001, 0));
      processor.onFrame(bare(140.1, 0.4013, 1));
      processor.onFrame(bare(170.1, 0.801, 2));
      processor.onFrame(bare(190.1, 0.001, 0));
      expect(processor.snapshot().currentSectorIdx).toBe(0);
      expect(processor.snapshot().sectorEntryTime).toBe(190.1);
      expect(processor.snapshot().inclusive.previousLapSectorTimes).toEqual(
        NONE
      );
    });

    it('times nothing across a long spell out of the car', () => {
      const processor = start();
      crossLine(processor);
      processor.onFrame(sim(120, 0.2, 0, 20, NONE, OLD));
      processor.onFrame(sim(121, 0.2, 0, 21, NONE, OLD, { isOnTrack: false }));
      // A team-mate's stint later, back in the car in the same sector.
      processor.onFrame(sim(6500, 0.3, 0, 30, NONE, OLD));
      expect(processor.snapshot().sectorEntryValid).toBe(false);
      processor.onFrame(sim(6539.9, 0.399, 0, 69.9, NONE, OLD));
      processor.onFrame(
        sim(6540.1, 0.4013, 1, 70.1, [70.012, null, null], OLD)
      );

      const snapshot = processor.snapshot();
      expect(snapshot.inclusive.currentLapSectorTimes).toEqual(NONE);
      expect(snapshot.inclusive.sessionBestSectorTimes).toEqual(NONE);
      expect(snapshot.sectorEntryValid).toBe(true);
    });

    it('keeps timing through a moment out of the car and marks the sector', () => {
      const processor = start();
      crossLine(processor);
      processor.onFrame(sim(120, 0.2, 0, 20, NONE, OLD));
      processor.onFrame(sim(121, 0.21, 0, 21, NONE, OLD, { isOnTrack: false }));
      processor.onFrame(sim(125, 0.25, 0, 25, NONE, OLD));
      driveFirstSector(processor);

      const { inclusive, clean } = processor.snapshot();
      expect(inclusive.currentLapSectorTimes[0]).toBe(40.012);
      expect(inclusive.currentLapSectorUnclean[0]).toBe(true);
      expect(clean.currentLapSectorTimes[0]).toBeNull();
    });

    it('does not time a sector the car did not drive into', () => {
      const processor = start();
      crossLine(processor);
      driveFirstSector(processor);
      // Out of the car in the second sector and back in it ten seconds
      // later in the pits, which are in the first.
      processor.onFrame(
        sim(150, 0.5, 1, 50, [40.012, null, null], OLD, { isOnTrack: false })
      );
      processor.onFrame(sim(160, 0.02, 0, 60, NONE, OLD));

      let snapshot = processor.snapshot();
      expect(snapshot.currentSectorIdx).toBe(0);
      expect(snapshot.sectorEntryValid).toBe(false);
      // What was completed before stands.
      expect(snapshot.inclusive.previousLapSectorTimes[0]).toBe(40.012);

      processor.onFrame(sim(199.9, 0.399, 0, 99.9, NONE, OLD));
      processor.onFrame(
        sim(200.1, 0.4013, 1, 100.1, [100.012, null, null], OLD)
      );
      snapshot = processor.snapshot();
      expect(snapshot.inclusive.previousLapSectorTimes[0]).toBe(40.012);
      expect(snapshot.inclusive.currentLapSectorTimes[0]).toBeNull();
    });

    it('does not time a sector entered backwards or after the clock went back', () => {
      const processor = start();
      crossLine(processor);
      driveFirstSector(processor);
      // The index steps back a sector: a car put back, not one driven on.
      processor.onFrame(sim(150, 0.3, 0, 50, NONE, OLD));
      expect(processor.snapshot().sectorEntryValid).toBe(false);

      // A session started again: the clock is back near zero.
      const restarted = start();
      crossLine(restarted);
      restarted.onFrame(sim(5, 0.001, 0, 5, NONE, NONE));
      expect(restarted.snapshot().sectorEntryValid).toBe(false);
      restarted.onFrame(sim(44.9, 0.399, 0, 44.9, NONE, NONE));
      restarted.onFrame(sim(45.1, 0.4013, 1, 45.1, [45, null, null], NONE));
      expect(restarted.snapshot().inclusive.currentLapSectorTimes).toEqual(
        NONE
      );
    });

    it('keeps the public snapshot stable between sector events', () => {
      const processor = start();
      crossLine(processor);
      const snapshot = processor.snapshot();

      processor.onFrame(sim(110, 0.1, 0, 10, NONE, OLD));
      processor.onFrame(sim(120, 0.2, 0, 20, NONE, OLD));

      expect(processor.snapshot()).toBe(snapshot);
    });

    it('goes back to timing by position when the sim stops timing', () => {
      const processor = start();
      crossLine(processor);
      driveFirstSector(processor);
      processor.onFrame(frame(0.5, 300));

      const snapshot = processor.snapshot();
      expect(snapshot.sectors).toEqual(thirds.SplitTimeInfo.Sectors);
      expect(snapshot.currentSectorIdx).toBe(1);
      expect(snapshot.inclusive.sessionBestSectorTimes).toEqual(NONE);
    });
  });
});
