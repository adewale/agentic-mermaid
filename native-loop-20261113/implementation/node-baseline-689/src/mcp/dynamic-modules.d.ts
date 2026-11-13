// The dynamic-worker harness imports the agent-code module that exists only
// inside the Worker Loader's module registry (supplied per-isolate by the
// website Worker). Declare it so dynamic-harness.ts typechecks.
declare module '*user.js' {
  const fn: unknown
  export default fn
}
