import os from 'node:os';
import { configDefaults, defineConfig } from 'vitest/config';

/**
 * The most spec files of the node project run at once.
 *
 * The recorded-session specs each play a four-minute tape through the real
 * addon, some of them several times: ten seconds of one core a replay, most
 * of it the addon copying the sim's 325 KB snapshot for every frame. That is
 * memory traffic, and it does not scale with cores. Started all at once, as
 * the default does with twenty-odd such files on a 24-thread machine, the
 * replays slowed each other three to five times: one that takes 10 s alone
 * ran past the 90 s its test allows, and the project as a whole took longer
 * than it does with a third of the workers. Measured there: 187 s with
 * Vitest's own choice of workers, 169 s at 12, 144 s at 8, where every
 * replay is back near the time it takes alone.
 *
 * Vitest runs projects with different worker counts one after the other,
 * which is what the two `groupOrder`s below say: the node project first,
 * then the browser one with every core to itself.
 */
const NODE_PROJECT_WORKERS = Math.max(
  1,
  Math.min(8, os.availableParallelism() - 1)
);

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
          maxWorkers: NODE_PROJECT_WORKERS,
          sequence: { groupOrder: 0 },
        },
      },
      {
        extends: true,
        test: {
          name: 'browser',
          environment: 'jsdom',
          // Reuse jsdom per worker while keeping each test file isolated.
          pool: 'vmThreads',
          sequence: { groupOrder: 1 },
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
