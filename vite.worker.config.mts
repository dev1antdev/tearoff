import { defineConfig } from 'vite';

// Worker threads of the main process: built like main.ts, each to its own
// file beside main.js, so the main process can start them by path. They share
// none of main's plugins: nothing here loads a native addon.
export default defineConfig({
  resolve: {
    mainFields: ['module', 'jsnext:main', 'jsnext'],
    tsconfigPaths: true,
  },
});
