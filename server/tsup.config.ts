import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  sourcemap: true,
  clean: true,
  noExternal: ['@pokemon-platform/shared', '@pokemon-platform/battle-engine'],
});
