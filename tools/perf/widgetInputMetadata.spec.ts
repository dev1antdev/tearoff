import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readWidgetInputRequirements } from './widgetInputMetadata';

describe('widget input metadata', () => {
  it('reads channel requirements from widget runtime definitions', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'irdashies-perf-'));
    const widgetDirectory = path.join(
      root,
      'src/frontend/components/TestWidget'
    );
    await mkdir(widgetDirectory, { recursive: true });
    await writeFile(
      path.join(widgetDirectory, 'widgetRuntimeDefinition.ts'),
      "export default { id: 'test', channels: ['one.snapshot', 'two.snapshot'] };",
      'utf8'
    );

    await expect(readWidgetInputRequirements(root)).resolves.toEqual({
      test: ['one.snapshot', 'two.snapshot'],
    });
  });

  const definitionOf = async (source: string) => {
    const root = await mkdtemp(path.join(tmpdir(), 'irdashies-perf-'));
    const widgetDirectory = path.join(
      root,
      'src/frontend/components/TestWidget'
    );
    await mkdir(widgetDirectory, { recursive: true });
    await writeFile(
      path.join(widgetDirectory, 'widgetRuntimeDefinition.ts'),
      source,
      'utf8'
    );
    return readWidgetInputRequirements(root);
  };

  it('reads the names past a comment that holds an apostrophe or a bracket', async () => {
    // As the definitions are written. The apostrophe of "car's" was taken
    // for the start of a name: the comment became a required input, and the
    // channel after it was lost.
    await expect(
      definitionOf(`export default {
  id: 'test',
  channels: [
    // Every car's place, gap and lap times.
    'standings.snapshot',
    /* The driver's own [first] channel. */
    'track-state.snapshot',
  ],
};`)
    ).resolves.toEqual({
      test: ['standings.snapshot', 'track-state.snapshot'],
    });
  });

  it('leaves out a channel the widget says it reads only sometimes', async () => {
    await expect(
      definitionOf(`export default {
  id: 'test',
  channels: [
    'standings.snapshot',
    // The pace of each car's stint; read only while that column is on.
    'race-history.summary',
  ],
  // Read only while the "vs stint" column is on.
  conditionalChannels: ['race-history.summary'],
  channelRates: { 'race-history.summary': 1 },
};`)
    ).resolves.toEqual({ test: ['standings.snapshot'] });
  });

  it('requires only channel names of the real definitions', async () => {
    const requirements = await readWidgetInputRequirements();
    expect(Object.keys(requirements).length).toBeGreaterThan(40);
    for (const [widget, channels] of Object.entries(requirements)) {
      for (const channel of channels) {
        expect(channel, widget).toMatch(/^[a-z-]+\.[a-z]+$/);
      }
    }
    // The two the "vs stint" column and the sun's countdown read.
    expect(requirements.standings).not.toContain('race-history.summary');
    expect(requirements.standings).not.toContain('track-profile.snapshot');
    expect(requirements.standings).toContain('standings.snapshot');
  });
});
