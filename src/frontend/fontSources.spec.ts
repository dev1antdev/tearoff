import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (file: string): string =>
  fs.readFileSync(path.resolve(process.cwd(), file), 'utf8');

/** The stylesheets theme.css asks another server for. */
const remoteImports = (): URL[] =>
  [
    ...read('src/frontend/theme.css').matchAll(
      /@import url\('(https?:[^']+)'\)/g
    ),
  ].map((match) => new URL(match[1]));

/** The widget preview's policy, as directive name -> sources. */
const previewPolicy = (): Map<string, string[]> => {
  const content =
    /http-equiv="Content-Security-Policy"\s+content="([^"]+)"/.exec(
      read('index-widget-preview.html')
    )?.[1];
  expect(content).toBeDefined();
  return new Map(
    (content ?? '').split(';').map((directive) => {
      const [name, ...sources] = directive.trim().split(/\s+/);
      return [name, sources];
    })
  );
};

describe('font sources', () => {
  it('takes every web font from Google Fonts', () => {
    const imports = remoteImports();
    expect(imports.length).toBeGreaterThan(0);
    for (const url of imports) {
      expect(url.origin).toBe('https://fonts.googleapis.com');
    }
  });

  it('asks for Figtree in the weights the family has', () => {
    // Figtree starts at 300. Google answers a wider range with HTTP 400 and
    // an HTML page, and the font never loads.
    const figtree = remoteImports().find((url) =>
      url.searchParams.get('family')?.startsWith('Figtree')
    );
    expect(figtree?.searchParams.get('family')).toBe(
      'Figtree:ital,wght@0,300..900;1,300..900'
    );
  });

  describe('the widget preview', () => {
    it('may load the stylesheets and the fonts the other windows load', () => {
      const policy = previewPolicy();
      expect(policy.get('style-src')).toContain('https://fonts.googleapis.com');
      expect(policy.get('font-src')).toContain('https://fonts.gstatic.com');
    });

    it('allows nothing else from outside', () => {
      const policy = previewPolicy();
      expect(policy.get('style-src')).toEqual([
        "'self'",
        "'unsafe-inline'",
        'https://fonts.googleapis.com',
      ]);
      expect(policy.get('font-src')).toEqual([
        "'self'",
        'data:',
        'https://fonts.gstatic.com',
      ]);
      expect(policy.get('default-src')).toEqual(["'self'"]);
      expect(policy.get('script-src')).toEqual(["'self'"]);
      expect(policy.get('connect-src')).toEqual(["'self'"]);
      expect(policy.get('frame-src')).toEqual(["'none'"]);
    });
  });
});
