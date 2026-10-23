// Untimed main-thread graph observation only; not a Node --import preload.
// Child worker threads therefore do not inherit this diagnostic via execArgv.
await import('./graph-recorder.mjs');
await import('./source-assets/capture-baseline.mjs');
