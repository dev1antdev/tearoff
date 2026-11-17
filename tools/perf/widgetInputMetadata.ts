import { promises as fs } from 'node:fs';
import path from 'node:path';

export type WidgetInputRequirements = Readonly<
  Record<string, readonly string[]>
>;

/**
 * A definition's source with its comments taken out. The lists are read as
 * text, and a comment inside one may hold an apostrophe ("the car's
 * place") or a bracket, which is neither the start of a name nor the end of
 * the list.
 */
const withoutComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

/** The quoted names of the list a field of a definition holds. */
const namesOf = (source: string, field: string): string[] => {
  const block = source.match(
    new RegExp(`\\b${field}:\\s*\\[([\\s\\S]*?)\\]`)
  )?.[1];
  return block
    ? [...block.matchAll(/'([^']+)'/g)].map((match) => match[1])
    : [];
};

/**
 * The channels each widget has to be seen to receive in a performance run:
 * those its runtime definition lists under `channels`, less those it lists
 * under `conditionalChannels`, which it reads only under some settings or
 * one simulator and which a run may rightly never see published.
 */
export async function readWidgetInputRequirements(
  repositoryRoot = process.cwd()
): Promise<WidgetInputRequirements> {
  const componentsDirectory = path.join(
    repositoryRoot,
    'src/frontend/components'
  );
  const entries = await fs.readdir(componentsDirectory, {
    withFileTypes: true,
  });
  const requirements: Record<string, string[]> = {};

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const definitionPath = path.join(
      componentsDirectory,
      entry.name,
      'widgetRuntimeDefinition.ts'
    );
    const text = await fs.readFile(definitionPath, 'utf8').catch(() => '');
    if (!text) continue;
    const source = withoutComments(text);
    const id = source.match(/\bid:\s*'([^']+)'/)?.[1];
    if (!id) continue;
    const conditional = new Set(namesOf(source, 'conditionalChannels'));
    requirements[id] = namesOf(source, 'channels').filter(
      (channel) => !conditional.has(channel)
    );
  }

  return requirements;
}
