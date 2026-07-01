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

import { runUserCode } from './harness-runtime.ts'

export default {
  async fetch(): Promise<Response> {
    // Dynamic form only because the bundler must leave the specifier alone
    // (the module is injected per-isolate); workerd compiled it at startup.
    const userFn = (await import('./user.js')).default
    return new Response(JSON.stringify(runUserCode(userFn)), { headers: { 'content-type': 'application/json' } })
  },
}
