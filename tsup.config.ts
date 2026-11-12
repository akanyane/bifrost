import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { bifrost: 'src/bin/bifrost.ts' },
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  banner: { js: '#!/usr/bin/env node' },
});
