import { defineConfig } from 'tsup';

export default defineConfig([
  // Default build for npm package (external dependencies)
  {
    entry: ['src/index.ts'],
    format: ['esm'],
    dts: true,
    clean: true,
    shims: true,
  },
  // Bundled build for mcpb (all dependencies included in single file)
  {
    entry: ['src/index.ts'],
    outDir: 'dist-bundle',
    format: ['esm'],
    dts: false,
    clean: true,
    shims: true,
    noExternal: [/.*/], // Bundle all dependencies
    splitting: false, // Single file output
  },
]);
