import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    globals: true,
    testTimeout: 10_000,
    // Vitest keeps transformed modules in node_modules/.vitest-cache and
    // reuses them between runs. Its cache key does not notice a file that
    // newly matches an import.meta.glob, and that is how widgets register:
    // a manifest or widget.ts added since the cache was written stays
    // invisible, so the registry specs fail on a new widget ("No default
    // config found") and would pass on a removed one. CI restores
    // node_modules from its cache, stale modules included, unless the
    // lockfile or native sources changed. Slower cold starts are the price of
    // specs that see the files actually on disk.
    fsModuleCache: false,
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          dir: 'src/app',
          environment: 'node',
          // Native addon tests need their own process.
          pool: 'forks',
        },
      },
      {
        extends: true,
        test: {
          name: 'browser',
          environment: 'jsdom',
          // Reuse jsdom per worker while keeping each test file isolated.
          pool: 'vmThreads',
          setupFiles: ['./vitest.setup.ts'],
          // Local extracted apps, archived checkouts and captures are not tests
          // for this checkout (and can contain copies of every source spec).
          exclude: [
            ...configDefaults.exclude,
            'src/app/**',
            'tmp-data/**',
            'perf-results/**',
          ],
        },
      },
    ],
  },
});
