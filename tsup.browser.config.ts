import { defineConfig } from 'tsup'

// Browser artifact: one self-contained IIFE for `<script src>` and CDN use,
// so a browser consumer never has to invent a bundling step (BUILD-30). The
// ESM entries stay the supported path for anyone who already bundles.
//
// Everything is inlined — elkjs and entities are runtime deps of the Node
// entries but there is no resolver in a plain script tag. `platform: 'browser'`
// makes an accidental node: import a build error rather than a runtime one;
// src/index.ts is browserless by contract, so nothing should reach for it.
//
// This build runs after the ESM build, never concurrently. `clean: false`
// preserves those outputs, while disabling source maps avoids shipping a
// browser file that advertises a map excluded from the npm package.
export default defineConfig({
  entry: { browser: 'src/index.ts' },
  format: ['iife'],
  globalName: 'agenticMermaid',
  platform: 'browser',
  dts: false,
  splitting: false,
  sourcemap: false,
  clean: false,
  minify: true,
  target: 'es2022',
  outDir: 'dist',
  noExternal: [/.*/],
  external: [],
})
