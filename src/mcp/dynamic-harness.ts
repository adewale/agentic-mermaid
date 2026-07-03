// Entry module for the Code Mode dynamic-worker isolate. website/build.ts
// bundles this file (plus the SDK it imports) into a single text asset that
// the website Worker passes to the Worker Loader as `harness.js`, alongside
// the agent code as `user.js` (one wrap variant per isolate; see
// userModuleSources and execute-loader.ts).
//
// workerd compiles every module in the registry eagerly at isolate startup,
// so a user module that does not parse fails the whole worker start — the
// parent catches that and retries with the statement-form wrap. By the time
// this fetch handler runs, `user.js` compiled.
//
// The isolate is created with `globalOutbound: null`, an empty env, and cpuMs
// limits — the harness only has to run the code and report the result.

import { runUserCode, hardenIsolateGlobals } from './harness-runtime.ts'

// Run at isolate startup — BEFORE the dynamic import below evaluates user.js —
// so a wrapper breakout into top-level module scope sees stripped capability
// globals. This is the harness (main) module's top level; user.js is not a
// static dependency, so it evaluates only at the `import()` in fetch(), after
// this has run. Defense in depth on top of the isolate's `globalOutbound: null`.
hardenIsolateGlobals()

export default {
  async fetch(): Promise<Response> {
    // Dynamic form only because the bundler must leave the specifier alone
    // (the module is injected per-isolate); workerd compiled it at startup.
    const userFn = (await import('./user.js')).default
    return new Response(JSON.stringify(runUserCode(userFn)), { headers: { 'content-type': 'application/json' } })
  },
}
