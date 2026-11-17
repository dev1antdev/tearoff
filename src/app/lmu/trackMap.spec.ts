import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  findBundledLmuTrackMap,
  findTinyPedalTrackMap,
  loadLmuTrackMap,
  LmuTrackMapRecorder,
  LmuTrackMapStorage,
  lmuGroundPosition,
  normalizeLmuTrackMap,
  parseTinyPedalTrackMap,
  rotateLmuMapPointCounterClockwise,
  type LmuMapFrame,
} from './trackMap';

const temporaryDirectories: string[] = [];

function frame(
  progress: number,
  overrides: Partial<LmuMapFrame> = {}
): LmuMapFrame {
  return {
    trackName: 'Lusail International Circuit',
    lapDist: 1000,
    playerHasVehicle: true,
    playerVehicleIdx: 0,
    lapStartET: 100,
    lapInvalidated: false,
    pos: [progress * 1000, 12, -progress * 500],
    vehLapDistPct: [progress],
    vehLastLapTime: [90],
    ...overrides,
  };
}

/**
 * A recorder that has seen a lap begin: nothing is recorded before the car
 * first crosses the line, so the frames a spec feeds next, from a later
 * `lapStartET`, are a lap from its beginning.
 */
function recorderBeforeTheLine(): LmuTrackMapRecorder {
  const recorder = new LmuTrackMapRecorder();
  recorder.update(frame(0.99, { lapStartET: 50 }));
  return recorder;
}

afterEach(() => {
  temporaryDirectories
    .splice(0)
    .forEach((directory) =>
      fs.rmSync(directory, { recursive: true, force: true })
    );
});

describe('LMU track map', () => {
  it('uses LMU X and negated Z as the ground plane', () => {
    expect(lmuGroundPosition([12, 99, -34])).toEqual({ x: 12, y: 34 });
  });

  it('rotates LMU map coordinates 90 degrees counter-clockwise on screen', () => {
    expect(rotateLmuMapPointCounterClockwise({ x: 12, y: 34 })).toEqual({
      x: 34,
      y: -12,
    });
    expect(
      rotateLmuMapPointCounterClockwise({ x: 12, y: 0, distance: 5 })
    ).toEqual({ x: 0, y: -12, distance: 5 });
  });

  it('turns a wide track into a tall one and keeps markers on the rotated path', () => {
    const map = normalizeLmuTrackMap(
      [
        { x: 0, y: 0, distance: 0 },
        { x: 1000, y: 0, distance: 1000 },
        { x: 1000, y: 100, distance: 1100 },
        { x: 0, y: 100, distance: 1200 },
        { x: 0, y: 0, distance: 1300 },
      ],
      1300
    );
    const points = map.active.trackPathPoints;
    const width =
      Math.max(...points.map((p) => p.x)) - Math.min(...points.map((p) => p.x));
    const height =
      Math.max(...points.map((p) => p.y)) - Math.min(...points.map((p) => p.y));

    expect(height).toBeGreaterThan(width);
    expect(map.startFinish.point).toMatchObject({
      x: points[0].x,
      y: points[0].y,
    });
    expect(map.active.inside.startsWith(`M${points[0].x},${points[0].y}`)).toBe(
      true
    );
  });

  it('normalizes and centers coordinates in the track canvas', () => {
    const map = normalizeLmuTrackMap(
      [
        { x: -100, y: -50, distance: 0 },
        { x: 100, y: -50, distance: 250 },
        { x: 100, y: 50, distance: 500 },
        { x: -100, y: 50, distance: 750 },
        { x: -100, y: -50, distance: 1000 },
      ],
      1000
    );

    expect(map.active.trackPathPoints).toHaveLength(512);
    expect(
      map.active.trackPathPoints.every(
        ({ x, y }) => x >= 80 && x <= 1840 && y >= 80 && y <= 1000
      )
    ).toBe(true);
    expect(map.active.inside).toMatch(/^M.+ Z$/);
    expect(map.startFinish.point.length).toBe(0);
    expect(map.orientation).toBe('lmu-ccw-v1');
  });

  it('promotes one full valid lap', () => {
    const recorder = recorderBeforeTheLine();
    for (let index = 0; index <= 100; index++) {
      expect(recorder.update(frame(index / 100))).toBeNull();
    }

    const map = recorder.update(frame(0, { lapStartET: 200, pos: [0, 12, 0] }));

    expect(map?.active.trackPathPoints).toHaveLength(512);
  });

  it('records from the smoothed fraction when scoring has not moved', () => {
    // LMU publishes lap distance at 5 Hz, so across a 64 Hz poll the scoring
    // fraction is repeatedly identical -- and sample() drops any point whose
    // distance has not advanced. Pinning vehLapDistPct reproduces that: the
    // recorder collects a single point, far short of the twenty it needs.
    const stalled = recorderBeforeTheLine();
    for (let index = 0; index <= 100; index++) {
      stalled.update(frame(index / 100, { vehLapDistPct: [0] }));
    }
    expect(
      stalled.update(frame(0, { vehLapDistPct: [0], lapStartET: 200 }))
    ).toBeNull();

    // The same frames, with the reconstructed fraction supplied, promote a map.
    const smoothed = recorderBeforeTheLine();
    for (let index = 0; index <= 100; index++) {
      smoothed.update(frame(index / 100, { vehLapDistPct: [0] }), index / 100);
    }
    const map = smoothed.update(
      frame(0, { vehLapDistPct: [0], lapStartET: 200, pos: [0, 12, 0] }),
      0
    );

    expect(map?.active.trackPathPoints).toHaveLength(512);
  });

  it('ignores a smoothed fraction that is negative or not finite', () => {
    // The bridge passes telemetry.LapDistPct, which is 0 with no player car
    // and could be NaN from a garbage frame. Either must fall back to scoring
    // rather than pinning progress.
    const recorder = recorderBeforeTheLine();
    for (let index = 0; index <= 100; index++) {
      expect(recorder.update(frame(index / 100), NaN)).toBeNull();
    }
    const map = recorder.update(
      frame(0, { lapStartET: 200, pos: [0, 12, 0] }),
      -1
    );

    expect(map?.active.trackPathPoints).toHaveLength(512);
  });

  it('accepts a timed lap even when LMU marks it invalidated', () => {
    const recorder = recorderBeforeTheLine();
    for (let index = 0; index <= 100; index++) {
      recorder.update(frame(index / 100, { lapInvalidated: index === 50 }));
    }
    expect(recorder.update(frame(0, { lapStartET: 200 }))).not.toBeNull();
  });

  it('records nothing of the lap a race starts with, which begins behind the line', () => {
    // As on the recorded race: the lap is timed from the green flag, the car
    // is on the grid behind the line, and the game reads its distance as
    // zero until it crosses. Where it stood was taken for the start of the
    // lap, so the outline began well short of the line.
    const fromTheGrid = new LmuTrackMapRecorder();
    for (let step = 0; step < 10; step++) {
      fromTheGrid.update(frame(0, { pos: [-139 + step * 13.9, 12, 0] }));
    }
    for (let index = 0; index <= 100; index++) {
      fromTheGrid.update(frame(index / 100));
    }
    // The first lap is timed, and is not a lap from the line: no map of it.
    expect(
      fromTheGrid.update(frame(0, { lapStartET: 200, pos: [0, 12, 0] }))
    ).toBeNull();

    // The lap after it is, and is the map a lap from the line gives.
    for (let index = 1; index <= 100; index++) {
      fromTheGrid.update(frame(index / 100, { lapStartET: 200 }));
    }
    const map = fromTheGrid.update(
      frame(0, { lapStartET: 300, pos: [0, 12, 0] })
    );

    const fromTheLine = recorderBeforeTheLine();
    for (let index = 0; index <= 100; index++) {
      fromTheLine.update(frame(index / 100));
    }
    const expected = fromTheLine.update(
      frame(0, { lapStartET: 200, pos: [0, 12, 0] })
    );
    expect(map).not.toBeNull();
    expect(map).toEqual(expected);
  });

  it('records a lap whose first frame still reads the end of the last one', () => {
    // On the recorded race the lap's clock starts a few frames before the
    // lap fraction goes back to nought. The first of those, 0.9996 of a
    // lap, taken as the first sample, left every later sample behind it and
    // the lap with one point.
    const recorder = recorderBeforeTheLine();
    recorder.update(frame(0.9996));
    recorder.update(frame(0.9998));
    for (let index = 1; index <= 100; index++) {
      recorder.update(frame(index / 100));
    }

    const map = recorder.update(frame(0, { lapStartET: 200, pos: [0, 12, 0] }));

    expect(map?.active.trackPathPoints).toHaveLength(512);
  });

  it('records nothing of a lap it did not see begin', () => {
    const recorder = new LmuTrackMapRecorder();
    // Joined two hundredths into a lap: its start was not seen.
    for (let index = 2; index <= 100; index++) {
      recorder.update(frame(index / 100));
    }
    expect(
      recorder.update(frame(0, { lapStartET: 200, pos: [0, 12, 0] }))
    ).toBeNull();
  });

  it('parses TinyPedal raw map coordinates', () => {
    const points = Array.from(
      { length: 20 },
      (_, index) => `${index},${index % 2}`
    ).join(' ');
    const map = parseTinyPedalTrackMap(
      `<svg><polyline id="map" points="${points}"/></svg>`
    );

    expect(map?.active.trackPathPoints).toHaveLength(512);
  });

  it('matches TinyPedal SVG names without accents or punctuation', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tinypedal-'));
    temporaryDirectories.push(directory);
    const points = Array.from(
      { length: 20 },
      (_, index) => `${index},${index % 2}`
    ).join(' ');
    fs.writeFileSync(
      path.join(directory, 'Autódromo José Carlos Pace.svg'),
      `<svg><polyline id="map" points="${points}"/></svg>`
    );

    expect(
      findTinyPedalTrackMap('Autodromo Jose Carlos Pace', [directory])?.filePath
    ).toBe(path.join(directory, 'Autódromo José Carlos Pace.svg'));
  });

  it.each([
    'Algarve International Circuit',
    'Autodromo Enzo e Dino Ferrari',
    'Autodromo Nazionale Monza',
    'Autódromo José Carlos Pace',
    'Bahrain Endurance Circuit',
    'Bahrain International Circuit',
    'Bahrain Outer Circuit',
    'Bahrain Paddock Circuit',
    'Circuit de Barcelona',
    'Circuit de la Sarthe',
    'Circuit de la Sarthe Mulsanne',
    'Circuit de Spa-Francorchamps',
    'Circuit of the Americas',
    'COTA National Circuit',
    'Daytona International Speedway Road Course',
    'Fuji Speedway',
    'Fuji Speedway Classic',
    'Lusail International Circuit',
    'Lusail Short Circuit',
    'Monza Curva Grande Circuit',
    'Paul Ricard - 1A',
    'Paul Ricard - 1A-V2',
    'Paul Ricard - 1A-V2-Short',
    'Paul Ricard - 3A',
    'Paul Ricard - ELMS',
    'Sebring International Raceway',
    'Sebring School Circuit',
    'Silverstone Grand Prix Circuit - WEC',
    'Silverstone International Circuit',
    'Silverstone National Circuit',
    'WeatherTech Raceway Laguna Seca',
  ])('loads the bundled TinyPedal map for %s', (trackName) => {
    const map = findBundledLmuTrackMap(trackName);

    expect(map?.orientation).toBe('lmu-ccw-v1');
    expect(map?.active.trackPathPoints).toHaveLength(512);
  });

  it.each([
    'Algarve International Circuit',
    'Autodromo Enzo e Dino Ferrari',
    'Autodromo Nazionale Monza',
    'Autódromo José Carlos Pace',
    'Circuit de Barcelona',
    'Circuit de la Sarthe',
    'Circuit de la Sarthe Mulsanne',
    'Circuit de Spa-Francorchamps',
    'Circuit of the Americas',
    'Daytona International Speedway Road Course',
    'Sebring International Raceway',
    'Silverstone Grand Prix Circuit - WEC',
    'WeatherTech Raceway Laguna Seca',
  ])('attaches trustworthy turn metadata for %s', (trackName) => {
    expect(findBundledLmuTrackMap(trackName)?.turns?.length).toBeGreaterThan(0);
  });

  it('loads bundled maps through tolerant aliases', () => {
    expect(findBundledLmuTrackMap('Portimão')).not.toBeNull();
    expect(findBundledLmuTrackMap('Qatar')).not.toBeNull();
    expect(
      findBundledLmuTrackMap('Bahrain International Endurance Circuit')
    ).not.toBeNull();
    expect(findBundledLmuTrackMap('Fuji Classic')).not.toBeNull();
  });

  it('loads bundled maps with iRacing-style turn labels', () => {
    const map = findBundledLmuTrackMap('Autodromo Nazionale Monza');

    expect(map?.turns?.some((turn) => turn.content === '1')).toBe(true);
    expect(
      map?.turns?.some((turn) => turn.content?.includes('Parabolica'))
    ).toBe(true);
  });

  it('loads storage before bundled maps and bundled maps before TinyPedal', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'irdashies-lmu-'));
    temporaryDirectories.push(directory);
    const storage = new LmuTrackMapStorage(path.join(directory, 'maps.json'));
    const stored = normalizeLmuTrackMap(
      [
        { x: 0, y: 0, distance: 0 },
        { x: 100, y: 0, distance: 500 },
        { x: 0, y: 0, distance: 1000 },
      ],
      1000
    );
    storage.save('Silverstone Circuit', stored);
    const points = Array.from(
      { length: 20 },
      (_, index) => `${index},${index % 2}`
    ).join(' ');
    fs.writeFileSync(
      path.join(directory, 'Silverstone Circuit.svg'),
      `<svg><polyline id="map" points="${points}"/></svg>`
    );
    fs.writeFileSync(
      path.join(directory, 'Monza.svg'),
      `<svg><polyline id="map" points="${points}"/></svg>`
    );

    expect(
      loadLmuTrackMap('Silverstone Circuit', storage, [directory])
    ).toMatchObject({ map: stored, source: 'storage' });
    expect(loadLmuTrackMap('Monza', storage, [directory])?.source).toBe(
      'bundled'
    );
  });

  it('persists maps by exact LMU track name', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'irdashies-lmu-'));
    temporaryDirectories.push(directory);
    const storage = new LmuTrackMapStorage(path.join(directory, 'maps.json'));
    const map = normalizeLmuTrackMap(
      [
        { x: 0, y: 0, distance: 0 },
        { x: 100, y: 0, distance: 500 },
        { x: 0, y: 0, distance: 1000 },
      ],
      1000
    );

    fs.writeFileSync(path.join(directory, 'maps.json'), '[]');
    storage.save('Autódromo José Carlos Pace', map);

    expect(storage.load('Autódromo José Carlos Pace')).toEqual(map);
    expect(storage.load('Lusail International Circuit')).toBeNull();
  });
});
