// portable/execution.ts
import { StringDecoder } from "node:string_decoder";
import { fork, spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname as dirname2, join as join2 } from "node:path";

// portable/artifacts.ts
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
var portableDirectory = dirname(fileURLToPath(import.meta.url));

// portable/cohorts.ts
var edge = (source, target) => ({ source, target });
var familyCases = [
  {
    id: "family:flowchart",
    family: "flowchart",
    cohort: "family",
    source: "flowchart LR\nA[Alpha] --> B[Beta]\nB --> C[Gamma]",
    expected: { accept: true, labels: ["Alpha", "Beta", "Gamma"], topology: { nodes: ["A", "B", "C"], edges: [edge("A", "B"), edge("B", "C")], nodeLabels: { A: "Alpha", B: "Beta", C: "Gamma" } } }
  },
  { id: "family:sequence", family: "sequence", cohort: "family", source: "sequenceDiagram\nparticipant A as Alpha\nparticipant B as Beta\nA->>B: Request\nB-->>A: Reply", expected: { accept: true, labels: ["Alpha", "Beta", "Request", "Reply"], topology: { nodes: ["A", "B"], edges: [edge("A", "B"), edge("B", "A")] } } },
  { id: "family:state", family: "state", cohort: "family", source: 'stateDiagram-v2\nstate "Alpha" as A\nstate "Beta" as B\nA --> B: advance', expected: { accept: true, labels: ["Alpha", "Beta", "advance"], topology: { nodes: ["A", "B"], edges: [edge("A", "B")] } } },
  { id: "family:class", family: "class", cohort: "family", source: "classDiagram\nclass Alpha\nclass Beta\nAlpha --> Beta: uses", expected: { accept: true, labels: ["Alpha", "Beta", "uses"], topology: { nodes: ["Alpha", "Beta"], edges: [edge("Alpha", "Beta")] } } },
  { id: "family:er", family: "er", cohort: "family", source: "erDiagram\nALPHA ||--o{ BETA : owns", expected: { accept: true, labels: ["ALPHA", "BETA", "owns"], topology: { nodes: ["ALPHA", "BETA"], edges: [edge("ALPHA", "BETA")] } } },
  { id: "family:timeline", family: "timeline", cohort: "family", source: "timeline\ntitle Delivery\n2026 : Launch : Review", expected: { accept: true, labels: ["Delivery", "2026", "Launch", "Review"], model: [{ path: ["periods", 0, "events"], value: ["Launch", "Review"], comparison: "display-text" }] } },
  {
    id: "family:journey",
    family: "journey",
    cohort: "family",
    source: "journey\ntitle Delivery\nsection Plan\nReview: 4: Builder",
    expected: {
      accept: true,
      labels: ["Delivery", "Plan", "Review", "Builder"],
      model: [
        { path: ["tasks", 0, "score"], value: 4 },
        { path: ["tasks", 0, "people"], value: ["Builder"] }
      ]
    }
  },
  {
    id: "family:architecture",
    family: "architecture",
    cohort: "family",
    source: "architecture-beta\ngroup app(cloud)[App]\nservice api(server)[API] in app\nservice db(database)[Data] in app\napi:R --> L:db",
    expected: { accept: true, labels: ["App", "API", "Data"], topology: { nodes: ["api", "db"], edges: [edge("api", "db")], groups: [{ id: "app", members: ["api", "db"] }] } }
  },
  {
    id: "family:xychart",
    family: "xychart",
    cohort: "family",
    source: 'xychart-beta\ntitle "Series"\nx-axis [One, Two, Three]\ny-axis "Count" 0 --> 10\nbar [3, 7, 5]\nline [2, 6, 4]',
    expected: {
      accept: true,
      labels: ["Series", "One", "Two", "Three", "Count"],
      model: [
        { path: ["xAxis", "categories"], value: ["One", "Two", "Three"] },
        {
          path: ["plots", 0, "data"],
          value: [
            ["One", 3],
            ["Two", 7],
            ["Three", 5]
          ]
        },
        {
          path: ["plots", 1, "data"],
          value: [
            ["One", 2],
            ["Two", 6],
            ["Three", 4]
          ]
        }
      ]
    }
  },
  {
    id: "family:pie",
    family: "pie",
    cohort: "family",
    source: 'pie title Shares\n"Alpha" : 7\n"Beta" : 3',
    expected: {
      accept: true,
      labels: ["Shares", "Alpha", "Beta"],
      model: [
        { path: ["sections", { map: "Alpha" }], value: 7 },
        { path: ["sections", { map: "Beta" }], value: 3 }
      ]
    }
  },
  {
    id: "family:quadrant",
    family: "quadrant",
    cohort: "family",
    source: "quadrantChart\ntitle Priority\nx-axis Low effort --> High effort\ny-axis Low value --> High value\nAlpha: [0.2, 0.8]\nBeta: [0.8, 0.2]",
    expected: {
      accept: true,
      labels: ["Priority", "Alpha", "Beta", "Low effort", "High effort", "Low value", "High value"],
      model: [
        { path: ["points", 0, "x"], value: 0.2 },
        { path: ["points", 0, "y"], value: 0.8 },
        { path: ["points", 1, "x"], value: 0.8 },
        { path: ["points", 1, "y"], value: 0.2 }
      ]
    }
  },
  {
    id: "family:gantt",
    family: "gantt",
    cohort: "family",
    source: "gantt\ntitle Delivery\ndateFormat YYYY-MM-DD\ntodayMarker off\nsection Build\nDesign :taskAlpha, 2026-01-01, 2d\nReview :taskBeta, after taskAlpha, 3d",
    expected: {
      accept: true,
      labels: ["Delivery", "Build", "Design", "Review"],
      model: [
        { path: ["tasks", 0, "id"], value: "taskAlpha" },
        { path: ["tasks", 1, "id"], value: "taskBeta" },
        { path: ["tasks", 1, "raw", "start"], value: "after taskAlpha" }
      ]
    }
  },
  {
    id: "family:mindmap",
    family: "mindmap",
    cohort: "family",
    source: "mindmap\nroot((Root))\n  Alpha\n    Beta\n  Gamma",
    expected: {
      accept: true,
      labels: ["Root", "Alpha", "Beta", "Gamma"],
      model: [
        { path: ["nodes", 0, "descr"], value: "Root" },
        { path: ["nodes", 0, "children", 0, "descr"], value: "Alpha" },
        { path: ["nodes", 0, "children", 0, "children", 0, "descr"], value: "Beta" }
      ]
    }
  },
  {
    id: "family:gitgraph",
    family: "gitgraph",
    cohort: "family",
    source: 'gitGraph\ncommit id:"Alpha" tag:"v1"\nbranch feature\ncommit id:"Beta"\ncheckout main\nmerge feature id:"Gamma"',
    expected: {
      accept: true,
      labels: ["Alpha", "Beta", "Gamma", "v1"],
      model: [
        { path: ["commits", { map: "Alpha" }, "tags"], value: ["v1"] },
        { path: ["commits", { map: "Gamma" }, "parents"], value: ["Alpha", "Beta"] }
      ]
    }
  },
  {
    id: "family:radar",
    family: "radar",
    cohort: "family",
    source: 'radar-beta\ntitle Skills\naxis speed["Speed"], power["Power"], range["Range"]\ncurve now["Current"]{3, 4, 2}\nmax 5\nshowLegend true',
    expected: {
      accept: true,
      labels: ["Skills", "Speed", "Power", "Range", "Current"],
      model: [
        { path: ["curves", 0, "entries"], value: [3, 4, 2] },
        { path: ["axes", 0, "label"], value: "Speed" }
      ]
    }
  },
  {
    id: "family:sankey",
    family: "sankey",
    cohort: "family",
    source: "sankey-beta\nAlpha,Beta,5\nBeta,Gamma,5",
    expected: {
      accept: true,
      labels: ["Alpha", "Beta", "Gamma"],
      topology: { nodes: ["Alpha", "Beta", "Gamma"], edges: [edge("Alpha", "Beta"), edge("Beta", "Gamma")] },
      model: [
        { path: ["links", 0, "value"], value: 5 },
        { path: ["links", 1, "value"], value: 5 }
      ]
    }
  },
  { id: "family:c4", family: "c4", cohort: "family", source: 'C4Context\nPerson(user, "User")\nSystem(api, "API", "Service")\nRel(user, api, "Uses")', expected: { accept: true, labels: ["User", "API", "Service", "Uses"], topology: { nodes: ["user", "api"], edges: [edge("user", "api")] } } },
  {
    id: "family:packet",
    family: "packet",
    cohort: "family",
    source: 'packet\n0-7: "Header"\n8-15: "Payload"',
    expected: {
      accept: true,
      labels: ["Header", "Payload"],
      model: [
        { path: ["rows", 0, 0, "bits"], value: 8 },
        { path: ["rows", 0, 1, "start"], value: 8 },
        { path: ["rows", 0, 1, "end"], value: 15 }
      ]
    }
  },
  {
    id: "family:kanban",
    family: "kanban",
    cohort: "family",
    source: "kanban\nbacklog[Backlog]\n  TaskA[Build]\ndone[Done]\n  TaskB[Test]",
    expected: {
      accept: true,
      labels: ["Backlog", "Build", "Done", "Test"],
      model: [
        { path: ["sections", 0, "id"], value: "backlog" },
        { path: ["sections", 0, "items", 0, "id"], value: "TaskA" },
        { path: ["sections", 1, "items", 0, "id"], value: "TaskB" }
      ]
    }
  },
  {
    id: "family:requirement",
    family: "requirement",
    cohort: "family",
    source: 'requirementDiagram\nrequirement reliable {\nid: R1\ntext: Requests retain meaning\nrisk: high\nverifymethod: test\n}\nelement suite {\ntype: "test"\n}\nsuite - verifies -> reliable',
    expected: {
      accept: true,
      labels: ["reliable", "suite", "Requests retain meaning"],
      topology: { nodes: ["reliable", "suite"], edges: [edge("suite", "reliable")] },
      model: [
        { path: ["requirements", { map: "reliable" }, "requirementId"], value: "R1" },
        { path: ["requirements", { map: "reliable" }, "text"], value: "Requests retain meaning" }
      ]
    }
  },
  {
    id: "family:treemap",
    family: "treemap",
    cohort: "family",
    source: 'treemap\n"Root"\n  "Alpha": 7\n  "Beta": 3',
    expected: {
      accept: true,
      labels: ["Root", "Alpha", "Beta"],
      model: [
        { path: ["roots", 0, "children", 0, "value"], value: 7 },
        { path: ["roots", 0, "children", 1, "value"], value: 3 }
      ]
    }
  },
  {
    id: "family:ishikawa",
    family: "ishikawa",
    cohort: "family",
    source: "ishikawa\n  Delay\n  Process\n    Review\n  Tooling\n    Build",
    expected: {
      accept: true,
      labels: ["Delay", "Process", "Review", "Tooling", "Build"],
      model: [
        { path: ["root", "text"], value: "Delay" },
        { path: ["root", "children", 0, "text"], value: "Process" },
        { path: ["root", "children", 0, "children", 0, "text"], value: "Review" }
      ]
    }
  },
  {
    id: "family:block",
    family: "block",
    cohort: "family",
    source: 'block\ncolumns 2\nAlpha["Alpha"] Beta["Beta"]\nAlpha --> Beta',
    expected: {
      accept: true,
      labels: ["Alpha", "Beta"],
      model: [
        { path: ["byId", { map: "Alpha" }, "label"], value: "Alpha" },
        { path: ["edges", 0, "start"], value: "Alpha" },
        { path: ["edges", 0, "end"], value: "Beta" }
      ]
    }
  }
];
var adversarialCases = [
  {
    id: "adversarial:label-edit",
    family: "flowchart",
    cohort: "adversarial",
    source: "flowchart LR\nA[Base label] --> B[Stable label]",
    expected: { accept: true, labels: ["Base label", "Stable label"], topology: { nodes: ["A", "B"], edges: [edge("A", "B")], nodeLabels: { A: "Base label", B: "Stable label" } } },
    edit: { source: "flowchart LR\nA[Edited label] --> B[Stable label]", expected: { accept: true, labels: ["Edited label", "Stable label"], topology: { nodes: ["A", "B"], edges: [edge("A", "B")], nodeLabels: { A: "Edited label", B: "Stable label" } } } }
  },
  {
    id: "adversarial:parallel-reciprocal",
    family: "flowchart",
    cohort: "adversarial",
    source: "flowchart LR\nA[Alpha] --> B[Beta]\nA --> B\nB --> A\nB --> C[Gamma]",
    expected: { accept: true, labels: ["Alpha", "Beta", "Gamma"], topology: { nodes: ["A", "B", "C"], edges: [edge("A", "B"), edge("A", "B"), edge("B", "A"), edge("B", "C")] } }
  },
  {
    id: "adversarial:nested-groups",
    family: "flowchart",
    cohort: "adversarial",
    source: "flowchart TB\nsubgraph Outer[Outer group]\nsubgraph Inner[Inner group]\nA[Alpha] --> B[Beta]\nend\nC[Gamma]\nend\nB --> C",
    expected: {
      accept: true,
      labels: ["Outer group", "Inner group", "Alpha", "Beta", "Gamma"],
      topology: {
        nodes: ["A", "B", "C"],
        edges: [edge("A", "B"), edge("B", "C")],
        groups: [
          { id: "Inner", members: ["A", "B"] },
          { id: "Outer", members: ["Inner", "C"] }
        ]
      }
    }
  },
  {
    id: "adversarial:wide-unicode",
    family: "flowchart",
    cohort: "adversarial",
    source: 'flowchart LR\nA["\u5DE5\u7A0B \u{1F9D1}\u200D\u{1F4BB} e\u0301 A very long authored label that must survive"] --> B["\u90E8\u7F72 \u{1F680}"]',
    expected: { accept: true, labels: ["\u5DE5\u7A0B", "\u{1F9D1}\u200D\u{1F4BB}", "e\u0301", "A very long authored label that must survive", "\u90E8\u7F72", "\u{1F680}"], topology: { nodes: ["A", "B"], edges: [edge("A", "B")] } }
  },
  {
    id: "adversarial:generated-looking-ids",
    family: "flowchart",
    cohort: "adversarial",
    source: "flowchart LR\nL_A_B_0[First] --> A_B[Second]\nA_B --> C[Third]",
    expected: { accept: true, labels: ["First", "Second", "Third"], topology: { nodes: ["L_A_B_0", "A_B", "C"], edges: [edge("L_A_B_0", "A_B"), edge("A_B", "C")] } }
  },
  { id: "adversarial:quoted-labels", family: "flowchart", cohort: "adversarial", source: 'flowchart LR\nA["Authored A & B"] --> B["Less than #60; stays text"]', expected: { accept: true, labels: ["Authored A & B", "Less than < stays text"], topology: { nodes: ["A", "B"], edges: [edge("A", "B")] } } },
  { id: "adversarial:invalid-recovery", family: "flowchart", cohort: "adversarial", prelude: [{ source: "flowchart LR\n --> -->", accept: false }], source: "flowchart LR\nA[Recovered] --> B[Ready]", expected: { accept: true, labels: ["Recovered", "Ready"], topology: { nodes: ["A", "B"], edges: [edge("A", "B")] } } },
  {
    id: "adversarial:configuration-reset",
    family: "flowchart",
    cohort: "adversarial",
    prelude: [{ source: '%%{init: {"flowchart": {"nodeSpacing": 100}}}%%\nflowchart LR\nA[Previous] --> B[Configuration]', accept: true }],
    source: "flowchart TB\nA[Current] --> B[Configuration]",
    renderOptions: { fontSize: 14 },
    expected: { accept: true, labels: ["Current", "Configuration"], topology: { nodes: ["A", "B"], edges: [edge("A", "B")] }, model: [{ path: ["direction"], value: "TB" }] },
    edit: { source: "flowchart TB\nA[Current] --> B[Configuration]", renderOptions: { fontSize: 24 }, expected: { accept: true, labels: ["Current", "Configuration"], topology: { nodes: ["A", "B"], edges: [edge("A", "B")] }, model: [{ path: ["direction"], value: "TB" }] } }
  }
];
var newerFamilyCases = [
  { id: "family:venn", family: "venn", cohort: "family", source: 'venn-beta\n  set Alpha\n  set Beta\n  union Alpha,Beta["Both"]', expected: { accept: true, labels: ["Alpha", "Beta", "Both"] } },
  { id: "family:treeview", family: "treeview", cohort: "family", source: "treeView-beta\n\u251C\u2500\u2500 Alpha\n\u2502   \u2514\u2500\u2500 Beta.txt\n\u2514\u2500\u2500 Gamma.txt", expected: { accept: true, labels: ["Alpha", "Beta.txt", "Gamma.txt"] } },
  { id: "family:wardley", family: "wardley", cohort: "family", source: "wardley-beta\ntitle Value\ncomponent Alpha [0.80, 0.30]\ncomponent Beta [0.40, 0.60]\nAlpha -> Beta", expected: { accept: true, labels: ["Value", "Alpha", "Beta"] } },
  { id: "family:eventmodeling", family: "eventmodeling", cohort: "family", source: "eventmodeling\n\ntf 01 ui AlphaScreen\ntf 02 cmd BetaCommand\ntf 03 evt GammaEvent", expected: { accept: true, labels: ["AlphaScreen", "BetaCommand", "GammaEvent"] } },
  { id: "family:cynefin", family: "cynefin", cohort: "family", source: 'cynefin-beta\n  title Alpha\n  complex\n    "Beta"\n  clear\n    "Gamma"\n  complex --> clear : "Delta"', expected: { accept: true, labels: ["Alpha", "Beta", "Gamma", "Delta"] } },
  { id: "family:railroad", family: "railroad", cohort: "family", source: 'railroad-ebnf-beta\nalpha = "beta" | gamma ;\ngamma = "delta" ;', expected: { accept: true, labels: ["alpha", "beta", "gamma", "delta"] } },
  { id: "family:swimlane", family: "swimlane", cohort: "family", source: "swimlane-beta LR\n  subgraph Alpha\n    A[Beta]\n  end\n  subgraph Gamma\n    B[Delta]\n  end\n  A --> B", expected: { accept: true, labels: ["Alpha", "Beta", "Gamma", "Delta"] } },
  { id: "family:agentflow", family: "agentflow", cohort: "family", source: 'agentflow-beta TB\n  flow alpha["Alpha"]\n    b["Beta"]@{ shape: task }\n    c["Gamma"]@{ shape: tool }\n    b --> c\n  end', expected: { accept: true, labels: ["Alpha", "Beta", "Gamma"] } },
  { id: "family:usecase", family: "usecase", cohort: "family", source: 'usecase-beta\nactor Alpha("Alpha")\nsystemBoundary "Beta"\n  Gamma("Gamma")\nend\nAlpha --> Gamma', expected: { accept: true, labels: ["Alpha", "Beta", "Gamma"] } }
];
var requiredExternalFamilyCases = () => [
  { id: "family:zenuml", family: "zenuml", cohort: "family", source: "zenuml\ntitle Demo\nAlice->John: Hello John, how are you?\nJohn->Alice: Great!", expected: { accept: true, labels: ["Alice", "John", "Hello John, how are you?", "Great!"] } }
];
function familySupportProbe(family) {
  const canonical = familyCases.find((testCase) => testCase.family === family) ?? newerFamilyCases.find((testCase) => testCase.family === family) ?? requiredExternalFamilyCases().find((testCase) => testCase.family === family);
  return canonical && { ...canonical, id: `family-support:${family}` };
}

// portable/protocol.ts
var PORTABLE_MEASUREMENT_PROTOCOL = "portable-svg-processes-v3";

// portable/execution.ts
var active = /* @__PURE__ */ new Set();
var cancelled = false;
var PortableCancelled = class extends Error {
  constructor() {
    super("Portable benchmark cancelled; no completed record is published");
    this.name = "PortableCancelled";
  }
};
function resetPortableCancellation() {
  if (active.size) throw Error("A portable campaign is already active");
  cancelled = false;
}
function assertPortableRunning() {
  if (cancelled) throw new PortableCancelled();
}
function kill(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  try {
    if (process.platform !== "win32" && child.pid) process.kill(-child.pid, "SIGKILL");
    else child.kill("SIGKILL");
  } catch {
  }
}
function terminatePortableWorkers() {
  cancelled = true;
  for (const child of active) kill(child);
}
function validateResult(job, result) {
  if (result.protocol !== PORTABLE_MEASUREMENT_PROTOCOL || result.caseId !== job.testCase.id || result.mode !== job.mode || result.round !== job.round || result.replica !== job.replica || result.sample !== job.sample || !["passed", "partial", "failed", "blocked", ...job.mode === "probe" ? ["unsupported"] : []].includes(result.status))
    throw Error("Worker evidence does not match the declared job");
  return result;
}
function failureEvidence(job, error, diagnostics, result) {
  const file = job.diagnosticFile ?? (job.resultFile ? job.resultFile + ".failure.json" : void 0);
  if (!file || existsSync(file)) return;
  try {
    mkdirSync(dirname2(file), { recursive: true });
    writeFileSync(file, JSON.stringify({ job, error: String(error), diagnostics, result }) + "\n", { flag: "wx" });
  } catch (failure) {
    if (error instanceof Error) error.message += "; Could not retain worker diagnostic: " + String(failure);
  }
}
function assertExit(result, code, signal) {
  assertPortableRunning();
  if (signal || code !== (result.status === "blocked" ? 2 : 0)) throw Error(`Worker lifecycle failed after reporting${result.status}: exit${code}, signal${signal}`);
}
async function runSerialJob(job, node, observer) {
  assertPortableRunning();
  const input = JSON.stringify(job);
  const budget = job.workerTimeoutMs ?? 3e5;
  const args = ["--expose-gc", join2(portableDirectory, "worker.mjs"), "--stdio"];
  const child = spawn(observer ?? node, observer ? ["-f", "\nTRIDENT_RESOURCE %U %S %M", "--", node, ...args] : args, { detached: process.platform !== "win32", stdio: ["pipe", "ignore", "pipe", "pipe"] });
  active.add(child);
  const decoder = new StringDecoder("utf8");
  let diagnostics = "", payload = "", payloadBytes = 0, transportError;
  child.stderr?.on("data", (data) => {
    diagnostics = (diagnostics + String(data)).slice(-2e3);
  });
  child.stdio[3]?.on("data", (data) => {
    payload += decoder.write(data);
    payloadBytes += data.length;
    if (payloadBytes > 64 * 1024 * 1024) {
      transportError = Error("Worker evidence exceeded64MiB");
      kill(child);
    }
  });
  child.stdin?.on("error", (error) => {
    transportError ??= error;
  });
  child.stdin?.end(input);
  let result;
  try {
    const exit = await new Promise((resolve2, reject) => {
      let deadline;
      const timeout = setTimeout(() => {
        deadline = Error(`Fresh worker exceeded ${budget} ms`);
        kill(child);
      }, budget);
      child.once("error", (error) => {
        clearTimeout(timeout);
        active.delete(child);
        reject(error);
      });
      child.once("close", (code, signal) => {
        clearTimeout(timeout);
        active.delete(child);
        if (deadline) reject(deadline);
        else resolve2({ code, signal });
      });
    });
    assertPortableRunning();
    if (transportError) throw transportError;
    payload += decoder.end();
    if (!payload) throw Error("Fresh worker failed without completed evidence: " + diagnostics);
    result = validateResult(job, JSON.parse(payload));
    assertExit(result, exit.code, exit.signal);
    if (observer) {
      const counters = /\nTRIDENT_RESOURCE ([^\s]+) ([^\s]+) ([^\s]+)\n$/.exec(diagnostics);
      const values = counters?.slice(1).map(Number);
      if (exit.code !== 0 || !values || values.some((value) => !Number.isFinite(value) || value < 0)) throw Error("Invalid GNU time child evidence");
      result.resource = { userSeconds: values[0], systemSeconds: values[1], peakRssBytes: values[2] * 1024, scope: "Whole fresh process, including import, driver, GC and post-snapshot qualification; not an API-only allocation peak." };
    }
    return result;
  } catch (error) {
    failureEvidence(job, error, diagnostics, result);
    throw error;
  }
}
async function runFirstUseBatch(jobs, node, concurrency, retain) {
  assertPortableRunning();
  const wireJobs = jobs.map((job) => JSON.parse(JSON.stringify(job)));
  const results = [];
  for (let start = 0; start < wireJobs.length; start += concurrency) {
    assertPortableRunning();
    const launched = [];
    const prepare = (job) => {
      const child = fork(join2(portableDirectory, "worker.mjs"), ["--ipc"], { execPath: node, execArgv: ["--expose-gc"], detached: process.platform !== "win32", stdio: ["ignore", "ignore", "pipe", "ipc"] });
      active.add(child);
      launched.push(child);
      let diagnostics = "", ready = false, started = false, result, transportError;
      child.stderr?.on("data", (data) => {
        diagnostics = (diagnostics + String(data)).slice(-2e3);
      });
      let resolveReady, rejectReady;
      const readiness = new Promise((resolve2, reject) => {
        resolveReady = resolve2;
        rejectReady = reject;
      });
      void readiness.catch(() => {
      });
      let timeout = setTimeout(() => {
        kill(child);
        rejectReady(Error("First-use import barrier timed out"));
      }, job.workerTimeoutMs ?? 3e5);
      child.on("message", (message) => {
        const value = message;
        try {
          if (value?.phase === "ready" && !ready && !started) {
            clearTimeout(timeout);
            ready = true;
            resolveReady();
          } else if (value?.phase === "result" && !result && value.result) {
            result = validateResult(job, value.result);
            if (!started) {
              if (result.status !== "blocked" || result.apiWindow || Object.keys(result.tracks).length) throw Error("First-use evidence arrived before its API start");
              rejectReady(Error("First-use worker blocked before readiness: " + result.error));
            }
          } else throw Error("Invalid first-use worker message");
        } catch (error) {
          transportError = error;
          rejectReady(transportError);
          kill(child);
        }
      });
      let exit;
      const completion = new Promise((resolve2, reject) => {
        child.once("error", (error) => {
          clearTimeout(timeout);
          active.delete(child);
          rejectReady(error);
          reject(error);
        });
        child.once("close", (code, signal) => {
          exit = { code, signal };
          clearTimeout(timeout);
          active.delete(child);
          if (!ready) rejectReady(Error("Worker exited before the first-use barrier: " + diagnostics));
          if (transportError || signal || code === null || code > 2) reject(transportError ?? Error("First-use worker failed: " + diagnostics));
          else resolve2();
        });
      });
      void completion.catch(() => {
      });
      try {
        child.send({ phase: "job", job }, (error) => {
          if (error) {
            transportError = error;
            rejectReady(error);
            kill(child);
          }
        });
      } catch (error) {
        transportError = error;
        rejectReady(transportError);
        kill(child);
      }
      return { child, job, readiness, completion, get result() {
        return result;
      }, get exit() {
        return exit;
      }, get diagnostics() {
        return diagnostics;
      }, get started() {
        return started;
      }, start() {
        started = true;
        timeout = setTimeout(() => {
          transportError = Error(`First-use worker exceeded ${job.workerTimeoutMs ?? 3e5} ms`);
          kill(child);
        }, job.workerTimeoutMs ?? 3e5);
        child.send({ phase: "start" });
      } };
    };
    let prepared;
    try {
      prepared = wireJobs.slice(start, start + concurrency).map(prepare);
    } catch (error) {
      await Promise.all(launched.map((child) => new Promise((resolve2) => {
        if (child.exitCode !== null || child.signalCode !== null) resolve2();
        else {
          child.once("close", () => resolve2());
          kill(child);
        }
      })));
      throw error;
    }
    try {
      await Promise.all(prepared.map((item) => item.readiness));
      for (const item of prepared) {
        assertPortableRunning();
        item.start();
        await item.completion;
        if (!item.result) throw Error("First-use worker exited without completed evidence");
        const result = validateResult(item.job, item.result);
        assertExit(result, item.exit.code, item.exit.signal);
        results.push(result);
        retain?.(result);
      }
    } catch (error) {
      for (const item of prepared) kill(item.child);
      await Promise.allSettled(prepared.map((item) => item.completion));
      for (const item of prepared) if (!item.started || !item.result || item.exit?.signal || item.exit?.code !== (item.result.status === "blocked" ? 2 : 0)) failureEvidence(item.job, error, item.diagnostics, item.result);
      assertPortableRunning();
      throw error;
    }
  }
  return results;
}
async function measurePortableProject(artifact, testCases, options, directory, retain) {
  const makeJob = (testCase, round, replica, mode, sample) => {
    const stem = `${testCase.id.replaceAll(":", "_")}-${mode}-r${round}-${replica}-${sample}`;
    return {
      artifact,
      testCase,
      mode,
      samples: options.samples,
      minSampleMs: options.minSampleMs,
      workerTimeoutMs: options.workerTimeoutMs ?? 3e5,
      round,
      replica,
      sample,
      diagnosticFile: join2(directory, "failures", stem + ".json"),
      fullEvidence: mode === "warm" && round === 1 && replica === "B",
      ...mode === "warm" && round === 1 && replica === "B" ? { svgFile: join2(directory, "svg", testCase.id.replaceAll(":", "_") + ".svg") } : {}
    };
  };
  const unsupported = /* @__PURE__ */ new Set();
  for (const family of new Set(testCases.map((testCase) => testCase.family))) {
    const probe = familySupportProbe(family);
    if (!probe) continue;
    const result = await runSerialJob(makeJob(probe, 1, "B", "probe", 0), options.node);
    retain(result);
    if (result.status === "unsupported") unsupported.add(family);
    console.log(JSON.stringify({ phase: "family-support", project: options.project, family, supported: result.status !== "unsupported" }));
  }
  testCases = testCases.filter((testCase) => !unsupported.has(testCase.family));
  const order = (round, index) => {
    const values = ["A0", "A1", "B"];
    const offset = (round + index) % values.length;
    return [...values.slice(offset), ...values.slice(0, offset)];
  };
  for (let round = 1; round <= options.rounds; round++)
    for (const [index, testCase] of testCases.entries()) {
      for (const replica of order(round, index)) retain(await runSerialJob(makeJob(testCase, round, replica, "warm", 0), options.node));
      console.log(JSON.stringify({ phase: "warm", project: options.project, round, caseId: testCase.id, completedCasesInRound: index + 1 }));
    }
  for (let round = 1; round <= options.rounds; round++)
    for (const [index, testCase] of testCases.entries()) {
      for (const replica of order(round, index)) {
        const jobs = Array.from({ length: options.coldSamples }, (_, sample) => makeJob(testCase, round, replica, "cold", sample));
        await runFirstUseBatch(jobs, options.node, options.preparationConcurrency, retain);
      }
      console.log(JSON.stringify({ phase: "first-use", project: options.project, round, caseId: testCase.id, completedCasesInRound: index + 1 }));
    }
  const observer = options.observer;
  for (let round = 1; round <= options.rounds; round++)
    for (const testCase of testCases) {
      const modes = round % 2 ? ["baseline", "memory"] : ["memory", "baseline"];
      for (const mode of modes) retain(await runSerialJob(makeJob(testCase, round, "B", mode, 0), options.node, observer));
      if (testCase.cohort === "scaling" && testCase.family === "flowchart" && testCase.scale === 8) retain(await runSerialJob(makeJob(testCase, round, "B", "retention", 0), options.node, observer));
      console.log(JSON.stringify({ phase: "memory", project: options.project, round, caseId: testCase.id }));
    }
}
export {
  PortableCancelled,
  assertPortableRunning,
  measurePortableProject,
  resetPortableCancellation,
  runFirstUseBatch,
  runSerialJob,
  terminatePortableWorkers
};
