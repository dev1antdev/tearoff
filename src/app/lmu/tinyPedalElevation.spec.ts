import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  findTinyPedalElevation,
  parseTinyPedalElevation,
} from './tinyPedalElevation';

/** A track map as TinyPedal lays one out: the outline, then the heights. */
const trackMap = (pairs: number): string => {
  const outline = Array.from(
    { length: pairs },
    (_, index) => `${(index * 1.5).toFixed(4)},${(index * -2).toFixed(4)}`
  ).join(' ');
  const heights = Array.from(
    { length: pairs },
    (_, index) => `${(index * 12.5).toFixed(4)},${(-10 + index / 4).toFixed(4)}`
  ).join(' ');
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<svg xmlns="http://www.w3.org/2000/svg">',
    '<title>WeatherTech Raceway Laguna Seca</title>',
    '<desc>112,228</desc>',
    `<polyline id="map" fill="none" points="${outline}"/>`,
    `<polyline id="dist" fill="none" points="${heights}"/>`,
    '</svg>',
  ].join('\n');
};

describe('parseTinyPedalElevation', () => {
  it('reads the distance and height pairs, in lap order', () => {
    const pairs = parseTinyPedalElevation(trackMap(280));

    expect(pairs).toHaveLength(280);
    expect(pairs?.[0]).toEqual([0, -10]);
    expect(pairs?.[4]).toEqual([50, -9]);
    expect(pairs?.[279]).toEqual([3487.5, 59.75]);
  });

  it('gives nothing for a map that has only its outline', () => {
    const outlineOnly = trackMap(280).replace(/<polyline id="dist".*\n/, '');

    expect(parseTinyPedalElevation(outlineOnly)).toBeNull();
  });

  it('gives nothing for a handful of pairs, or for none that are numbers', () => {
    expect(parseTinyPedalElevation(trackMap(19))).toBeNull();
    expect(
      parseTinyPedalElevation('<polyline id="dist" points="a,b c,d"/>')
    ).toBeNull();
    expect(parseTinyPedalElevation('')).toBeNull();
  });
});

describe('findTinyPedalElevation', () => {
  let directory: string;

  beforeEach(async () => {
    directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'tearoff-tinypedal-'));
  });

  afterEach(async () => {
    // directory is the exact mkdtemp result.
    await fsp.rm(directory, { recursive: true, force: true });
  });

  it('finds the map named after the track, whatever its case and accents', async () => {
    await fsp.writeFile(
      path.join(directory, 'WeatherTech Raceway Laguna Seca.svg'),
      trackMap(280)
    );
    await fsp.writeFile(path.join(directory, 'Sebring.svg'), trackMap(30));

    const pairs = await findTinyPedalElevation(
      'weathertech raceway laguna-seca',
      [path.join(directory, 'no-such-folder'), directory]
    );
    expect(pairs).toHaveLength(280);
  });

  it('gives nothing for a track with no map, or with no folder to look in', async () => {
    await fsp.writeFile(path.join(directory, 'Sebring.svg'), trackMap(30));

    expect(await findTinyPedalElevation('Monza', [directory])).toBeNull();
    expect(await findTinyPedalElevation('Sebring', [])).toBeNull();
    expect(await findTinyPedalElevation('', [directory])).toBeNull();
  });

  it('gives nothing for a map without heights', async () => {
    await fsp.writeFile(
      path.join(directory, 'Sebring.svg'),
      trackMap(280).replace(/<polyline id="dist".*\n/, '')
    );

    expect(await findTinyPedalElevation('Sebring', [directory])).toBeNull();
  });
});
