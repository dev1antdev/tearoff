/**
 * Runs tools/telemetry-replay/lmu-fixture.ts through Vite's module loader.
 *
 * The other replay tools run under tsx. This one cannot: it runs the LMU
 * session mapping, which imports the types barrel, and the barrel discovers
 * the widget manifests with import.meta.glob -- a Vite feature plain Node
 * does not have. The specs get it from Vitest; this gets it the same way.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer, createServerModuleRunner } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const server = await createServer({
  root,
  configFile: false,
  appType: 'custom',
  logLevel: 'error',
  resolve: { tsconfigPaths: true },
  server: { middlewareMode: true, hmr: false, ws: false, watch: null },
  optimizeDeps: { noDiscovery: true, include: [] },
});

try {
  const runner = createServerModuleRunner(server.environments.ssr, {
    hmr: false,
  });
  const { main } = await runner.import('/tools/telemetry-replay/lmu-fixture.ts');
  process.exitCode = await main(process.argv.slice(2));
  await runner.close();
} finally {
  await server.close();
}
// The replay addon keeps the process alive after its tape has ended.
process.exit();
