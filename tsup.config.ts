import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { bifrost: 'src/bin/bifrost.ts' },
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  // Keep "node:" imports: node:sqlite only exists with the prefix.
  removeNodeProtocol: false,
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  banner: { js: '#!/usr/bin/env node' },
});
