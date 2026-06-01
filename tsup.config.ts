import { defineConfig } from 'tsup'

export default defineConfig({
  entry: { index: 'src/index.ts', agent: 'src/agent/index.ts' },
  format: ['esm'],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  target: 'es2022',
  outDir: 'dist',
  external: ['elkjs', 'entities', 'node:vm', 'node:fs', 'node:path'],
})
