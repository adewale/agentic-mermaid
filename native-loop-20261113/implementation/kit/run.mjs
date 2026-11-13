// portable/help.ts
var PORTABLE_HELP = "node portable/run.ts --project obsidianmd/pele --artifact-root INSTALLED_PACKAGE [--adapter pele|agentic|beautiful|ondine] [--out DIR] [--records DIR] [--rounds 5 --samples 31 --cold-samples 20] [--worker-timeout-ms 300000] [--cohort family,scaling,adversarial,invalid] [--observer GNU_TIME] [--mermaid-reference PINNED_MERMAID_INSTALL] [--usage OBSERVED_USAGE_JSON] [--cpu-hour-usd RATE] [--plan] [--force] [--allow-partial]\nDefaults: five rounds,31 warm sample means,20 fresh processes per replica/round/case;300000ms per complete worker, including sampling and qualification. Imported cold workers prepare concurrently then API calls execute serially behind a barrier. No CI execution and no paid/provider calls. Compiled run.mjs works without a source checkout or Git, and refuses to run without the pinned Mermaid oracle (MERMAID_REFERENCE_DIR, default ../mermaid-reference).";

// portable/run.ts
import { gzipSync as gzipSync3 } from "node:zlib";
import { execFileSync as execFileSync2 } from "node:child_process";
import { randomUUID as randomUUID2 } from "node:crypto";
import { appendFileSync, existsSync as existsSync7, mkdirSync as mkdirSync2, readdirSync as readdirSync3, realpathSync as realpathSync3, rmSync, writeFileSync as writeFileSync2, openSync as openSync3, closeSync as closeSync3, unlinkSync as unlinkSync2 } from "node:fs";
import { join as join6, resolve as resolve5, relative as relative3 } from "node:path";
import { fileURLToPath as fileURLToPath3 } from "node:url";

// portable/cohorts.ts
var PORTABLE_COHORT_PROTOCOL = "portable-authored-family-scaling-v1";
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
function scalingCase(family, size) {
  const nodes = Array.from({ length: size }, (_, index) => `N${index}`);
  const edges = nodes.slice(1).map((target, index) => edge(nodes[index], target));
  let source, labels, topology = { nodes, edges };
  if (family === "flowchart") {
    source = "flowchart LR\n" + nodes.map((id) => `${id}[${id}]`).concat(edges.map((item) => `${item.source} --> ${item.target}`)).join("\n");
    labels = nodes;
  } else if (family === "class") {
    source = "classDiagram\n" + nodes.map((id) => `class ${id}`).concat(edges.map((item) => `${item.source} --> ${item.target}`)).join("\n");
    labels = nodes;
  } else if (family === "er") {
    source = "erDiagram\n" + edges.map((item) => `${item.source} ||--o{ ${item.target} : owns`).join("\n");
    labels = [...nodes, "owns"];
  } else if (family === "state") {
    source = "stateDiagram-v2\n" + edges.map((item) => `${item.source} --> ${item.target}`).join("\n");
    labels = nodes;
  } else {
    source = "sequenceDiagram\nparticipant A as Alpha\nparticipant B as Beta\n" + nodes.map((id, index) => index % 2 ? `B-->>A: ${id}` : `A->>B: ${id}`).join("\n");
    labels = ["Alpha", "Beta", ...nodes];
    topology = { nodes: ["A", "B"], edges: nodes.map((_id, index) => index % 2 ? edge("B", "A") : edge("A", "B")) };
  }
  return { id: `scaling:${family}:${size}`, family, source, cohort: "scaling", scale: size, expected: { accept: true, labels, topology: { ...topology, ...family === "flowchart" ? { nodeLabels: Object.fromEntries(nodes.map((id) => [id, id])) } : {} } } };
}
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
var invalidCases = [
  { id: "invalid:unknown-header", family: "invalid-source", cohort: "invalid", source: "This is not Mermaid. @@@ {{{", expected: { accept: false, labels: [] } },
  { id: "invalid:missing-endpoints", family: "flowchart", cohort: "invalid", source: "flowchart LR\n --> -->", expected: { accept: false, labels: [] } },
  { id: "invalid:unfinished-sequence", family: "sequence", cohort: "invalid", source: "sequenceDiagram\nA->>", expected: { accept: false, labels: [] } }
];
function portableCases(selection) {
  const cases = [...familyCases, ...["flowchart", "sequence", "class", "state", "er"].flatMap((family) => [8, 32, 128].map((size) => scalingCase(family, size))), ...adversarialCases, ...invalidCases];
  return selection ? cases.filter((testCase) => selection.includes(testCase.cohort)) : cases;
}
var FAMILY_SUPPORT_PROTOCOL = "family-cohort-source-acceptance-v1";
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

// portable/environment.ts
import { cpus, hostname, release } from "node:os";
import { existsSync as existsSync3, readFileSync as readFileSync3 } from "node:fs";

// portable/artifacts.ts
import { execFileSync } from "node:child_process";
import { createHash as createHash2 } from "node:crypto";
import { closeSync, existsSync as existsSync2, openSync, readFileSync as readFileSync2, readSync, readdirSync as readdirSync2, realpathSync as realpathSync2 } from "node:fs";
import { dirname as dirname2, join as join2, relative as relative2, resolve as resolve2 } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";

// portable/artifact-dependencies.ts
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readdirSync, readFileSync, readlinkSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
var ordered = (items, key) => items.sort((left, right) => key(left) < key(right) ? -1 : key(left) > key(right) ? 1 : 0);
var within = (directory, path) => {
  const name = relative(directory, path);
  return !name || !name.startsWith(".." + sep) && name !== ".." && !isAbsolute(name);
};
function readManifest(root) {
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) throw Error(`Invalid installed package manifest: ${root}`);
  return manifest;
}
var text = (value) => typeof value === "string" ? value : null;
function declarations(manifest) {
  const entries = (key) => {
    const value = manifest[key] ?? {};
    if (Array.isArray(value) && value.length === 0) return {};
    if (!value || typeof value !== "object" || Array.isArray(value)) throw Error(`Invalid ${key} in installed package manifest`);
    const result2 = value;
    for (const [name, range] of Object.entries(result2)) {
      if (!/^(?:@[^/\\\s.][^/\\\s]*\/)?[^/\\\s.][^/\\\s]*$/.test(name) || name === ".." || typeof range !== "string") throw Error(`Invalid installed dependency declaration: ${name}`);
    }
    return result2;
  };
  const dependencies = entries("dependencies"), optional = entries("optionalDependencies"), peers = entries("peerDependencies"), result = [];
  for (const name of [.../* @__PURE__ */ new Set([...Object.keys(dependencies), ...Object.keys(optional)])].sort()) {
    const isOptional = Object.hasOwn(optional, name);
    result.push({ name, kind: isOptional ? "optional" : "dependency", requested: isOptional ? optional[name] : dependencies[name], optional: isOptional });
  }
  const metadata = manifest.peerDependenciesMeta;
  for (const name of Object.keys(peers).sort()) result.push({ name, kind: "peer", requested: peers[name], optional: metadata?.[name]?.optional === true });
  return result;
}
function findInstalledPackage(logicalRoot, realRoot, name) {
  const searched = /* @__PURE__ */ new Set();
  for (const [start, search] of [
    [realRoot, "realpath"],
    [logicalRoot, "logical"]
  ]) {
    let directory = start;
    for (; ; ) {
      if (directory.split(sep).at(-1) !== "node_modules") {
        const candidate = join(directory, "node_modules", name);
        if (!searched.has(candidate)) {
          searched.add(candidate);
          if (existsSync(candidate)) {
            if (!statSync(candidate).isDirectory()) throw Error(`Installed dependency is not a package directory: ${candidate}`);
            return { logicalRoot: candidate, realRoot: realpathSync(candidate), search };
          }
        }
      }
      const parent = dirname(directory);
      if (parent === directory) break;
      directory = parent;
    }
  }
  return null;
}
function captureInstalledDependencyClosure(packageRoot) {
  const logicalRoot = resolve(packageRoot), realRoot = realpathSync(logicalRoot), rootManifest = readManifest(realRoot);
  const nodes = /* @__PURE__ */ new Map(), edges = [], pending = [{ logicalRoot, realRoot, manifest: rootManifest }], visited = /* @__PURE__ */ new Set();
  const rootOwned = (path) => within(realRoot, path) && !within(join(realRoot, "node_modules"), path);
  for (let index = 0; index < pending.length; index++) {
    const current = pending[index];
    if (visited.has(current.realRoot)) continue;
    visited.add(current.realRoot);
    for (const declaration of declarations(current.manifest)) {
      const resolution = findInstalledPackage(current.logicalRoot, current.realRoot, declaration.name);
      if (!resolution && declaration.kind === "dependency") throw Error(`Missing required installed dependency ${declaration.name} from ${current.realRoot}`);
      edges.push({ from: current.realRoot, ...declaration, resolution });
      if (!resolution || resolution.realRoot === realRoot) continue;
      if (rootOwned(resolution.realRoot) || within(resolution.realRoot, realRoot)) throw Error(`Dependency points at candidate-owned source: ${resolution.realRoot}`);
      const known = nodes.get(resolution.realRoot);
      if (known) {
        if (!known.logicalRoots.includes(resolution.logicalRoot)) known.logicalRoots.push(resolution.logicalRoot);
        continue;
      }
      const manifest = readManifest(resolution.realRoot);
      nodes.set(resolution.realRoot, { realRoot: resolution.realRoot, logicalRoots: [resolution.logicalRoot], name: text(manifest.name), version: text(manifest.version), manifest, files: [] });
      pending.push({ ...resolution, manifest });
    }
  }
  const admitted = [...nodes.keys()];
  for (const node of nodes.values()) {
    const walk = (directory, prefix, ancestors) => {
      for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
        if (entry.name === "node_modules" || entry.name === ".git") continue;
        const path = join(directory, entry.name), name = prefix ? prefix + "/" + entry.name : entry.name, stat = lstatSync(path);
        if (stat.isSymbolicLink()) {
          const target = readlinkSync(path), resolvedTarget = realpathSync(path);
          const admittedTarget = admitted.some(
            (root) => within(root, resolvedTarget) && !relative(root, resolvedTarget).split(sep).some((part) => part === "node_modules" || part === ".git")
          );
          if (rootOwned(resolvedTarget) || !admittedTarget) throw Error(`Dependency symlink leaves admitted fetched packages: ${path}`);
          if (statSync(path).isDirectory()) {
            const cycleTo = ancestors.get(resolvedTarget);
            node.files.push({ path: name, kind: "symlink-directory", target, resolvedTarget, ...cycleTo !== void 0 ? { cycleTo } : {} });
            if (cycleTo === void 0) walk(resolvedTarget, name, new Map([...ancestors, [resolvedTarget, name]]));
          } else if (statSync(path).isFile()) {
            const bytes = readFileSync(path);
            node.files.push({ path: name, kind: "symlink-file", target, resolvedTarget, sha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.byteLength });
          } else throw Error(`Unsupported dependency symlink target: ${path}`);
        } else if (stat.isDirectory()) {
          walk(path, name, new Map([...ancestors, [realpathSync(path), name]]));
        } else if (stat.isFile()) {
          const bytes = readFileSync(path);
          node.files.push({ path: name, kind: "file", sha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.byteLength });
        } else throw Error(`Unsupported installed package file: ${path}`);
      }
    };
    walk(node.realRoot, "", /* @__PURE__ */ new Map([[node.realRoot, ""]]));
    node.logicalRoots.sort();
    ordered(node.files, (file) => file.path);
  }
  return { schemaVersion: 1, root: { logicalRoot, realRoot, name: text(rootManifest.name), version: text(rootManifest.version) }, nodes: ordered([...nodes.values()], (node) => node.realRoot), edges: ordered(edges, (edge2) => `${edge2.from}\0${edge2.name}\0${edge2.kind}`) };
}

// portable/artifacts.ts
var portableDirectory = dirname2(fileURLToPath(import.meta.url));
var readJson = (path) => JSON.parse(readFileSync2(path, "utf8"));
function byteDigest(path) {
  const hash = createHash2("sha256"), fd = openSync(path, "r"), buffer = Buffer.alloc(1024 * 1024);
  try {
    let count;
    while (count = readSync(fd, buffer, 0, buffer.length, null)) hash.update(buffer.subarray(0, count));
  } finally {
    closeSync(fd);
  }
  return hash.digest("hex");
}
function resolveArtifact(project, root, adapter, node, entry) {
  const packageRoot = realpathSync2(root), pkg = readJson(join2(packageRoot, "package.json"));
  const actualEntry = entry ? resolve2(packageRoot, entry) : fileURLToPath(execFileSync(node, ["--experimental-import-meta-resolve", "--input-type=module", "-e", "process.stdout.write(import.meta.resolve(process.argv[1], process.argv[2]))", pkg.name, pathToFileURL(join2(packageRoot, "package.json")).href], { encoding: "utf8", timeout: 1e4 }).trim());
  if (!existsSync2(actualEntry) || typeof pkg.version !== "string") throw Error("A real installed package and public module entry are required");
  return { project, root: packageRoot, entry: realpathSync2(actualEntry), version: pkg.version, adapter };
}
function artifactIdentity(artifact) {
  const pkg = readJson(join2(artifact.root, "package.json"));
  const walk = (directory) => readdirSync2(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap((entry) => {
    if (["node_modules", ".git"].includes(entry.name)) return [];
    const path = join2(directory, entry.name);
    if (entry.isDirectory()) return walk(path);
    if (entry.isSymbolicLink()) throw Error("Package-level symlinks require explicit shipped-artifact admission: " + path);
    if (!entry.isFile()) return [];
    const bytes = readFileSync2(path);
    return [{ path: relative2(artifact.root, path), sha256: byteDigest(path), bytes: bytes.byteLength, gzipBytes: gzipSync(bytes, { level: 9 }).byteLength }];
  });
  let payload = artifact.root;
  if (existsSync2(join2(artifact.root, ".git"))) {
    const directory = relative2(artifact.root, artifact.entry).split("/")[0];
    if (!["dist", "build", "pkg"].includes(directory)) throw Error("Use an installed package or a compiled dist/build/pkg artifact, not source files");
    payload = join2(artifact.root, directory);
  }
  const files = walk(payload);
  return { artifact, packageName: pkg.name, packageMetadata: pkg, entrySha256: byteDigest(artifact.entry), files, dependencies: captureInstalledDependencyClosure(artifact.root), deliveryScope: "Per-file package gzip sizes are inventory, not observed network transfer or an npm tarball total." };
}
function harnessIdentity(directory = portableDirectory) {
  const manifest = join2(directory, "harness-artifact.json");
  if (existsSync2(manifest)) {
    const data = readJson(manifest);
    if (data.protocol !== "compiled-portable-harness-v1" || !["worker.mjs", "execution.mjs", "run.mjs"].every((path) => data.files.some((file) => file.path === path))) throw Error("Invalid compiled harness manifest");
    for (const file of data.files) if (!["worker.mjs", "execution.mjs", "run.mjs", "mermaid-oracle-worker.mjs", "package.json"].includes(file.path) || byteDigest(join2(directory, file.path)) !== file.sha256) throw Error("Compiled harness bytes differ from their shipped identity");
    return { kind: "compiled-measurement-artifacts", files: data.files.filter((file) => ["worker.mjs", "execution.mjs"].includes(file.path)) };
  }
  const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: directory, encoding: "utf8" }).trim();
  const paths = ["worker.mjs", "execution.ts", "cohorts.ts", "fidelity.ts", "protocol.ts", "ci-policy.ts", "mermaid-oracle.ts"].map((name) => relative2(root, join2(directory, name)));
  if (execFileSync("git", ["status", "--porcelain", "--", ...paths], { cwd: root, encoding: "utf8" }).trim()) throw Error("Commit measured protocol files before collecting or reusing timings; use the compiled harness outside Git");
  const objects = execFileSync("git", ["ls-tree", "-r", "HEAD", "--", ...paths], { cwd: root, encoding: "utf8" }).trim().split("\n");
  if (objects.length !== paths.length) throw Error("Measured protocol files are not committed");
  return { kind: "git-protocol-objects", objects };
}
function runtimeIdentity(node) {
  return JSON.parse(execFileSync(node, ["-e", "process.stdout.write(JSON.stringify({executable:process.execPath,node:process.versions.node,v8:process.versions.v8,platform:process.platform,arch:process.arch}))"], { encoding: "utf8", timeout: 1e4 }));
}

// portable/environment.ts
function environmentIdentity(node) {
  const runtime = runtimeIdentity(node);
  return {
    runtime,
    nodeSha256: byteDigest(runtime.executable),
    host: hostname(),
    cpu: cpus().map((cpu) => cpu.model),
    kernel: release(),
    cpuLimit: existsSync3("/sys/fs/cgroup/cpu.max") ? readFileSync3("/sys/fs/cgroup/cpu.max", "utf8").trim() : null,
    memoryLimit: existsSync3("/sys/fs/cgroup/memory.max") ? readFileSync3("/sys/fs/cgroup/memory.max", "utf8").trim() : null,
    environment: Object.fromEntries(["NODE_OPTIONS", "NODE_ENV", "TZ", "LANG", "LC_ALL", "LC_NUMERIC", "AGENTIC_MERMAID_EXPERIMENTS"].map((name) => [name, process.env[name] ?? null]))
  };
}

// portable/project-records.ts
import { createHash as createHash3, randomUUID } from "node:crypto";
import { gzipSync as gzipSync2, gunzipSync } from "node:zlib";
import { closeSync as closeSync2, existsSync as existsSync4, mkdirSync, openSync as openSync2, readFileSync as readFileSync4, renameSync, statSync as statSync2, lstatSync as lstatSync2, linkSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname as dirname3, isAbsolute as isAbsolute2, join as join3, resolve as resolve3, sep as sep2 } from "node:path";
var lane = (value) => value.lane ?? "community";
var identityKey = (identity) => stableValue({ ...identity, lane: lane(identity) });
function stableValue(value) {
  const seen = /* @__PURE__ */ new Set();
  const normalize = (item) => {
    if (item === null || typeof item === "string" || typeof item === "boolean") return item;
    if (typeof item === "number" && Number.isFinite(item)) return item;
    if (!item || typeof item !== "object" || seen.has(item) || !Array.isArray(item) && Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null) throw Error("Benchmark identities must contain finite, acyclic JSON values");
    seen.add(item);
    const result = Array.isArray(item) ? item.map(normalize) : Object.fromEntries(
      Object.keys(item).sort().map((key) => [key, normalize(item[key])])
    );
    seen.delete(item);
    return result;
  };
  return JSON.stringify(normalize(value));
}
var fail = (message) => {
  throw Error(`Invalid benchmark record store: ${message}`);
};
function component(value, name) {
  if (typeof value !== "string" || !value || Buffer.byteLength(value) > 160) return fail(`${name} must be a nonempty string of at most160 UTF-8 bytes`);
  return Buffer.from(value).toString("base64url");
}
var projectRecordPath = (store, project, id) => join3(store, "projects", component(project, "project"), component(id, "record id") + ".json");
var strings = (value) => Array.isArray(value) && value.every((item) => typeof item === "string");
function validateIdentity(value) {
  if (!value || typeof value !== "object") fail("identity is missing");
  const identity = value;
  component(identity.project, "project");
  if (identity.lane !== void 0) component(identity.lane, "lane");
  for (const key of ["protocol", "artifact", "measurement"]) {
    if (!Object.hasOwn(identity, key)) fail(`identity.${key} is missing`);
    stableValue(identity[key]);
  }
}
function validateRecord(value) {
  if (!value || typeof value !== "object") fail("record is not an object");
  const record = value;
  if (record.schemaVersion !== 1) fail("unsupported record schema");
  component(record.id, "record id");
  validateIdentity(record.identity);
  const start = Date.parse(record.startedAt), finish = Date.parse(record.finishedAt);
  if (typeof record.startedAt !== "string" || typeof record.finishedAt !== "string" || !Number.isFinite(start) || !Number.isFinite(finish) || finish < start) fail("record needs ordered start/finish timestamps");
  if (!["passed", "failed", "blocked"].includes(record.status)) fail("record has no completed status");
  if (typeof record.evidenceDirectory !== "string" || !isAbsolute2(record.evidenceDirectory)) fail("evidenceDirectory must be absolute");
  if (!strings(record.evidenceFiles) || !record.evidenceFiles.length || new Set(record.evidenceFiles).size !== record.evidenceFiles.length || record.evidenceFiles.some((path) => isAbsolute2(path) || path.includes("\\") || path.split("/").some((part) => !part || part === "." || part === "..")))
    fail("evidenceFiles must contain unique relative file paths");
  if (!Array.isArray(record.observations) || !strings(record.gaps)) fail("observations or gaps are missing");
  if (record.status === "passed" && !record.observations.length) fail("an empty attempt cannot pass");
  const keys = /* @__PURE__ */ new Set();
  for (const row of record.observations) {
    if (!row || typeof row !== "object" || ["suite", "surface", "runtime", "family", "caseId", "operation", "format", "mode"].some((key2) => typeof row[key2] !== "string")) fail("observation dimensions are invalid");
    if (!["passed", "failed", "unsupported", "blocked", "not-applicable", "skipped"].includes(row.status)) fail("observation status is invalid");
    if (row.samplesMs !== void 0 && (!Array.isArray(row.samplesMs) || row.samplesMs.some((value2) => typeof value2 !== "number" || !Number.isFinite(value2) || value2 < 0))) fail("invalid timing samples");
    if (row.bytes !== void 0 && (!Number.isSafeInteger(row.bytes) || row.bytes < 0)) fail("invalid output byte count");
    if (row.metrics?.implementation && row.metrics.implementation !== record.identity.project && row.metrics.variantOf !== record.identity.project) fail("observation belongs to another project");
    const key = stableValue([row.suite, row.surface, row.runtime, row.family, row.caseId, row.operation, row.format, row.mode, row.metrics?.implementation ?? null, row.metrics?.round ?? null, row.metrics?.metricId ?? null]);
    if (keys.has(key)) fail("duplicate observation identity");
    keys.add(key);
  }
  if (record.status === "passed" && record.observations.some((row) => row.status === "failed" || row.status === "blocked")) fail("passed record contains failed or blocked evidence");
}
function readIndex(store) {
  const path = join3(store, "current.json");
  if (!existsSync4(path)) return { schemaVersion: 1, projects: [] };
  const index = JSON.parse(readFileSync4(path, "utf8"));
  if (index.schemaVersion !== 1 || !Array.isArray(index.projects)) fail("unsupported current index");
  const seen = /* @__PURE__ */ new Set();
  for (const entry of index.projects) {
    component(entry.project, "project");
    if (entry.lane !== void 0) component(entry.lane, "lane");
    component(entry.current, "record id");
    const key = stableValue([entry.project, lane(entry)]);
    if (seen.has(key) || !strings(entry.history) || !entry.history.includes(entry.current) || new Set(entry.history).size !== entry.history.length) fail("invalid project history");
    seen.add(key);
    for (const id of entry.history) component(id, "record id");
  }
  return index;
}
var canonicalRecords = /* @__PURE__ */ new WeakSet();
var digest = (bytes) => createHash3("sha256").update(bytes).digest("hex");
var json = (file) => {
  const bytes = readFileSync4(file);
  return JSON.parse((file.endsWith(".gz") ? gunzipSync(bytes) : bytes).toString("utf8"));
};
var outputReference = (file) => {
  if (!lstatSync2(file).isFile()) return fail("canonical output must be a regular file, not a symlink");
  const bytes = readFileSync4(file);
  return { path: resolve3(file), bytes: bytes.length, sha256: digest(bytes) };
};
function verifyOutput(reference, ownerFile) {
  if (!reference || typeof reference.path !== "string" || !reference.path || !Number.isSafeInteger(reference.bytes) || reference.bytes < 0 || typeof reference.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(reference.sha256)) return fail("invalid output reference");
  const absolute = isAbsolute2(reference.path);
  if (!absolute && (!ownerFile || basename(reference.path) !== reference.path || /[\\/]/.test(reference.path) || [".", ".."].includes(reference.path))) return fail("invalid output reference");
  const file = absolute ? reference.path : join3(dirname3(resolve3(ownerFile)), reference.path), actual = outputReference(file);
  if (actual.bytes !== reference.bytes || actual.sha256 !== reference.sha256) return fail("canonical output differs from its immutable reference");
  return file;
}
function immutableWrite(file, bytes) {
  const temporary = file + "." + randomUUID() + ".pending";
  try {
    writeFileSync(temporary, bytes, { flag: "wx" });
    linkSync(temporary, file);
  } finally {
    if (existsSync4(temporary)) unlinkSync(temporary);
  }
}
function writeProjectBenchmarkRecord(file, record) {
  validateRecord(record);
  record = JSON.parse(JSON.stringify(record));
  if (!file.endsWith(".json.gz")) return fail("new canonical record needs a .json.gz path");
  if (existsSync4(file)) {
    if (stableValue(readProjectBenchmarkRecord(file)) !== stableValue(record)) return fail("canonical payload already contains a different attempt");
    return outputReference(file);
  }
  immutableWrite(file, gzipSync2(Buffer.from(JSON.stringify(record))));
  return outputReference(file);
}
function readProjectBenchmarkRecord(file) {
  return hydrateRecord(json(file), file);
}
function hydrateRecord(stored, file) {
  if (stored?.schemaVersion === 2 && stored.kind === "project-benchmark-record-reference") {
    const reference = stored, payload = verifyOutput(reference.payload), record = json(payload);
    validateRecord(record);
    if (record.id !== reference.id || record.identity.project !== reference.project || lane(record.identity) !== lane(reference)) return fail("record identity differs from its reference");
    canonicalRecords.add(record);
    return record;
  }
  validateRecord(stored);
  if (file.endsWith(".gz")) canonicalRecords.add(stored);
  return stored;
}
function readRecord(store, project, id, expectedLane = "community") {
  const record = readProjectBenchmarkRecord(projectRecordPath(store, project, id));
  if (record.id !== id || record.identity.project !== project || lane(record.identity) !== expectedLane) fail("record identity differs from its index");
  return record;
}
function retained(record) {
  return existsSync4(record.evidenceDirectory) && statSync2(record.evidenceDirectory).isDirectory() && record.evidenceFiles.every((file) => existsSync4(join3(record.evidenceDirectory, file)) && statSync2(join3(record.evidenceDirectory, file)).isFile());
}
function findProjectRecord(store, identity) {
  validateIdentity(identity);
  const entry = readIndex(store).projects.find((entry2) => entry2.project === identity.project && lane(entry2) === lane(identity));
  if (!entry) return void 0;
  const key = identityKey(identity);
  for (const id of [...entry.history].reverse()) {
    const record = readRecord(store, entry.project, id, lane(entry));
    if (identityKey(record.identity) === key && retained(record)) return record;
  }
  return void 0;
}
function withWriterLock(store, action) {
  mkdirSync(store, { recursive: true });
  const lock = join3(store, ".writer.lock"), descriptor = openSync2(lock, "wx");
  try {
    action();
  } finally {
    closeSync2(descriptor);
    unlinkSync(lock);
  }
}
function publishIndex(store, index) {
  const temporary = join3(store, `.current-${process.pid}.pending`), descriptor = openSync2(temporary, "wx");
  let published = false;
  try {
    try {
      writeFileSync(descriptor, JSON.stringify(index, null, 2) + "\n");
    } finally {
      closeSync2(descriptor);
    }
    renameSync(temporary, join3(store, "current.json"));
    published = true;
  } finally {
    if (!published && existsSync4(temporary)) unlinkSync(temporary);
  }
}
function publishProjectRecord(store, record, options = {}) {
  validateRecord(record);
  record = JSON.parse(JSON.stringify(record));
  if (!retained(record)) fail("retained evidence directory is missing");
  withWriterLock(store, () => {
    const index = readIndex(store), destination = projectRecordPath(store, record.identity.project, record.id);
    const entry = index.projects.find((entry2) => entry2.project === record.identity.project && lane(entry2) === lane(record.identity));
    if (entry?.history.includes(record.id)) return fail("immutable attempt is already published");
    mkdirSync(dirname3(destination), { recursive: true });
    if (existsSync4(destination)) {
      if (stableValue(readProjectBenchmarkRecord(destination)) !== stableValue(record)) return fail("unpublished record differs from the completed attempt");
    } else {
      const payload = options.payloadFile ?? join3(record.evidenceDirectory, "record-" + digest(gzipSync2(Buffer.from(JSON.stringify(record)))) + ".json.gz");
      if (!resolve3(payload).startsWith(resolve3(record.evidenceDirectory) + sep2)) return fail("canonical payload must belong to the evidence directory");
      if (options.payloadFile) {
        if (stableValue(readProjectBenchmarkRecord(payload)) !== stableValue(record)) return fail("canonical payload differs from the completed attempt");
      } else writeProjectBenchmarkRecord(payload, record);
      const reference = { schemaVersion: 2, kind: "project-benchmark-record-reference", id: record.id, project: record.identity.project, ...record.identity.lane ? { lane: record.identity.lane } : {}, payload: outputReference(payload) };
      immutableWrite(destination, JSON.stringify(reference) + "\n");
    }
    if (entry) {
      entry.current = record.id;
      entry.history.push(record.id);
    } else index.projects.push({ project: record.identity.project, ...record.identity.lane ? { lane: record.identity.lane } : {}, current: record.id, history: [record.id] });
    publishIndex(store, index);
  });
}
function activateProjectRecord(store, record) {
  validateRecord(record);
  withWriterLock(store, () => {
    const index = readIndex(store), entry = index.projects.find((entry2) => entry2.project === record.identity.project && lane(entry2) === lane(record.identity));
    if (!entry || !entry.history.includes(record.id)) return fail("cannot activate an unpublished attempt");
    const stored = readRecord(store, record.identity.project, record.id, lane(record.identity));
    if (stableValue(stored) !== stableValue(record)) fail("activation differs from the immutable attempt");
    if (!retained(stored)) fail("retained evidence is missing for activation");
    if (entry.current === record.id) return;
    entry.current = record.id;
    publishIndex(store, index);
  });
}
function inspectCurrentProjectRecords(store) {
  return readIndex(store).projects.map((entry) => {
    const record = readRecord(store, entry.project, entry.current, lane(entry));
    return { record, evidenceRetained: retained(record) };
  });
}

// portable/run.ts
import { assertPortableRunning, PortableCancelled, resetPortableCancellation, measurePortableProject, terminatePortableWorkers } from "./execution.mjs";

// portable/protocol.ts
var PORTABLE_MEASUREMENT_PROTOCOL = "portable-svg-processes-v3";

// portable/statistics.ts
function median(values) {
  if (!values.length || values.some((value) => !Number.isFinite(value))) throw Error("Finite nonempty samples required");
  const sorted = [...values].sort((a, b) => a - b), middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
function quantile(values, probability) {
  if (probability < 0 || probability > 1 || !values.length || values.some((value) => !Number.isFinite(value))) throw Error("Invalid quantile inputs");
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(probability * sorted.length) - 1))];
}
function summarize(values) {
  if (!values.length) return { samples: 0, medianMs: null, p95Ms: null, minMs: null, maxMs: null };
  return { samples: values.length, medianMs: median(values), p95Ms: quantile(values, 0.95), minMs: Math.min(...values), maxMs: Math.max(...values) };
}
function calibrate(rounds, minimumSamples, maximumControlSpread = 0.25) {
  const gaps = [];
  if (rounds.length < 5) gaps.push("At least five independent rounds are required");
  if (new Set(rounds.map((round) => round.round)).size !== rounds.length) gaps.push("Round identities must be unique");
  if (rounds.some((round) => [round.A0, round.A1, round.B].some((samples) => samples.length < minimumSamples || samples.some((value) => !Number.isFinite(value) || value <= 0)))) gaps.push("Every replica/round needs the declared finite positive sample count");
  if (gaps.length) return { status: "uncalibrated", gaps, controlRatios: [], candidateRatios: [], controlBand: null, candidateRatio: null };
  const controlRatios = rounds.map((round) => median(round.A1) / median(round.A0));
  const candidateRatios = rounds.map((round) => median(round.B) / Math.sqrt(median(round.A0) * median(round.A1)));
  const controlBand = { lower: Math.min(...controlRatios, ...controlRatios.map((value) => 1 / value)), upper: Math.max(...controlRatios, ...controlRatios.map((value) => 1 / value)) };
  if (controlBand.upper - 1 > maximumControlSpread) gaps.push("Observed A/A control spread exceeds the declared noise ceiling");
  const candidateRatio = median(candidateRatios);
  return {
    status: gaps.length ? "uncalibrated" : "calibrated",
    gaps,
    controlRatios,
    candidateRatios,
    controlBand,
    candidateRatio,
    interpretation: candidateRatio < controlBand.lower ? "below observed control band; advisory" : candidateRatio > controlBand.upper ? "above observed control band; advisory" : "within observed control band"
  };
}

// portable/costs.ts
function modelCost(evidence) {
  if (!evidence) return { status: "unavailable", dollars: null, detail: "No actual provider/model transcript and dated token-price evidence supplied" };
  const finite = (value) => Number.isFinite(value) && value >= 0;
  if (![evidence.provider, evidence.model, evidence.transcript, evidence.price?.source].every((value) => typeof value === "string" && value.trim()) || !Number.isFinite(Date.parse(evidence.measuredAt)) || !Number.isFinite(Date.parse(evidence.price.observedAt)) || ![evidence.inputTokens, evidence.outputTokens].every((value) => Number.isSafeInteger(value) && value >= 0) || ![evidence.price.inputPerMillionUsd, evidence.price.outputPerMillionUsd].every(finite))
    throw Error("Actual usage evidence and finite dated prices are required");
  const observed = {
    provider: evidence.provider,
    model: evidence.model,
    transcript: evidence.transcript,
    measuredAt: evidence.measuredAt,
    inputTokens: evidence.inputTokens,
    outputTokens: evidence.outputTokens,
    price: { observedAt: evidence.price.observedAt, source: evidence.price.source, inputPerMillionUsd: evidence.price.inputPerMillionUsd, outputPerMillionUsd: evidence.price.outputPerMillionUsd }
  };
  return { status: "estimated-from-supplied-usage", dollars: (evidence.inputTokens * evidence.price.inputPerMillionUsd + evidence.outputTokens * evidence.price.outputPerMillionUsd) / 1e6, evidence: observed };
}
function processCpuCost(userSeconds, systemSeconds, ratePerCpuHourUsd) {
  if (![userSeconds, systemSeconds].every((value) => Number.isFinite(value) && value >= 0) || ratePerCpuHourUsd !== void 0 && (!Number.isFinite(ratePerCpuHourUsd) || ratePerCpuHourUsd < 0)) throw Error("Finite nonnegative CPU samples and rates required");
  const seconds = userSeconds + systemSeconds, lowerSeconds = Math.max(0, seconds - 0.02), upperSeconds = seconds + 0.02;
  return {
    status: ratePerCpuHourUsd === void 0 ? "rate-unavailable" : seconds === 0 ? "below-counter-resolution" : "estimated-at-supplied-rate",
    seconds,
    lowerSeconds,
    upperSeconds,
    dollars: ratePerCpuHourUsd === void 0 || seconds === 0 ? null : seconds * ratePerCpuHourUsd / 3600,
    lowerDollars: ratePerCpuHourUsd === void 0 ? null : lowerSeconds * ratePerCpuHourUsd / 3600,
    upperDollars: ratePerCpuHourUsd === void 0 ? null : upperSeconds * ratePerCpuHourUsd / 3600,
    scope: "Whole fresh worker CPU, including runtime/import/qualification; 10ms reporting grain per counter. Not an API-only CPU allocation or a provider invoice."
  };
}

// portable/report.ts
function portableSummary(cases, results, settings) {
  if (new Set(results.map((result) => result.protocol)).size > 1) throw Error("Cannot combine different portable measurement protocols");
  const tracks = ["first-use", "warm-repeat", "warm-new-source", "warm-label-edit"];
  const unsupported = new Map(results.filter((result) => result.mode === "probe" && result.status === "unsupported").map((result) => [result.family, result.error ?? "Renderer rejected the canonical family source"]));
  const measured = cases.filter((testCase) => !unsupported.has(testCase.family));
  const rows = measured.flatMap(
    (testCase) => tracks.filter((track) => track !== "warm-label-edit" || testCase.edit).map((track) => {
      const relevant = results.filter((result) => result.caseId === testCase.id && (track === "first-use" ? result.mode === "cold" : result.mode === "warm"));
      const expectedWorkers = settings.rounds * 3 * (track === "first-use" ? settings.coldSamples : 1);
      const keys = new Set(relevant.map((result) => `${result.round}:${result.replica}:${result.sample}`));
      const completeWorkers = relevant.length === expectedWorkers && keys.size === expectedWorkers && relevant.every((result) => Number.isInteger(result.round) && result.round >= 1 && result.round <= settings.rounds && ["A0", "A1", "B"].includes(result.replica) && Number.isInteger(result.sample) && result.sample >= 0 && result.sample < (track === "first-use" ? settings.coldSamples : 1));
      const rounds = Array.from({ length: settings.rounds }, (_, index) => {
        const perReplica = (replica) => relevant.filter((result) => result.round === index + 1 && result.replica === replica).flatMap((result) => result.tracks[track] ?? []);
        return { round: index + 1, A0: perReplica("A0"), A1: perReplica("A1"), B: perReplica("B") };
      });
      const calibration = calibrate(rounds, track === "first-use" ? Math.max(20, settings.coldSamples) : Math.max(31, settings.samples), settings.maximumControlSpread);
      if (!completeWorkers || relevant.some((result) => result.status === "failed" || result.status === "blocked")) {
        calibration.status = "uncalibrated";
        calibration.gaps.push(completeWorkers ? "A worker failed or its declared output checks failed" : "Expected worker identities are missing or duplicated");
      }
      return {
        caseId: testCase.id,
        family: testCase.family,
        cohort: testCase.cohort,
        scale: testCase.scale ?? null,
        expectedAccepted: testCase.expected.accept,
        track,
        ...summarize(rounds.flatMap((round) => round.B)),
        rounds: rounds.map((round) => ({ round: round.round, ...summarize(round.B) })),
        calibration,
        scope: track === "first-use" ? testCase.prelude?.length ? "First final-source API call after the declared prelude in each fresh process; import excluded." : "First API call in each fresh process; import excluded." : (track === "warm-new-source" ? "Comment-varied source bytes with the same semantic graph; cache-key diagnostic, not proof of uncached layout. " : "") + "Distribution of per-call means from bounded adaptive batches; p95 of sample means is not a single-call tail latency.",
        semanticComplete: completeWorkers && relevant.every((result) => result.qualification?.semanticComplete === true),
        nativeAndPaintScopes: [...new Set(relevant.flatMap((result) => result.qualification?.unmeasuredScopes.filter((scope) => !scope.startsWith("Repeated passing")) ?? []))]
      };
    })
  );
  const coverage = cases.map((testCase) => {
    const calls = results.filter((result) => result.caseId === testCase.id && result.mode !== "baseline");
    const failed = calls.filter((result) => result.status === "failed"), blocked = calls.filter((result) => result.status === "blocked");
    const timingComplete = rows.filter((row) => row.caseId === testCase.id).every((row) => !row.calibration.gaps.includes("Expected worker identities are missing or duplicated"));
    return {
      id: testCase.id,
      family: testCase.family,
      cohort: testCase.cohort,
      expectedAccepted: testCase.expected.accept,
      unsupported: unsupported.get(testCase.family) ?? null,
      checkedWorkers: calls.length,
      acceptanceMatches: timingComplete && calls.length > 0 && calls.every((result) => result.qualification?.accepted === testCase.expected.accept),
      failedWorkers: failed.length,
      blockedWorkers: blocked.length,
      semanticComplete: timingComplete && testCase.expected.accept && calls.length > 0 && calls.every((result) => result.qualification?.semanticComplete),
      unmeasuredScopes: [...new Set(calls.flatMap((result) => result.qualification?.unmeasuredScopes.filter((scope) => !scope.startsWith("Repeated passing")) ?? []))],
      failures: failed.slice(0, 3).map((result) => ({ mode: result.mode, round: result.round, replica: result.replica, error: result.error ?? null, checks: result.qualification?.checks.filter((check) => check.status === "failed") ?? [] }))
    };
  });
  const resources = cases.flatMap(
    (testCase) => Array.from({ length: settings.rounds }, (_, index) => {
      const active = results.find((result) => result.caseId === testCase.id && result.mode === "memory" && result.round === index + 1);
      const baseline = results.find((result) => result.caseId === testCase.id && result.mode === "baseline" && result.round === index + 1);
      if (!active?.memory || !baseline?.memory) return [];
      const delta = (left, right) => Object.fromEntries(Object.keys(left).map((key) => [key, left[key] - right[key]]));
      return [
        {
          caseId: testCase.id,
          family: testCase.family,
          cohort: testCase.cohort,
          round: index + 1,
          qualified: active.status !== "failed" && active.status !== "blocked" && baseline.status === "passed",
          before: active.memory.before,
          atReturn: active.memory.atReturn,
          afterGc: active.memory.afterGc,
          apiReturnDelta: delta(active.memory.atReturn, active.memory.before),
          retainedDelta: delta(active.memory.afterGc, active.memory.before),
          baselineAfterGc: baseline.memory.afterGc,
          gcAvailable: active.memory.gcAvailable,
          wholeWorker: active.resource ?? null,
          baselineWholeWorker: baseline.resource ?? null,
          cost: active.resource ? processCpuCost(active.resource.userSeconds, active.resource.systemSeconds, settings.cpuHourUsd) : null
        }
      ];
    }).flat()
  );
  const representativeFamilies = [...new Set(cases.filter((testCase) => testCase.cohort === "family").map((testCase) => testCase.family))];
  const familyTimings = representativeFamilies.map((family) => {
    const row = rows.find((row2) => row2.family === family && row2.cohort === "family" && row2.track === "warm-repeat");
    return { family, supported: !unsupported.has(family), medianMs: row?.medianMs ?? null, calibrated: row?.calibration.status === "calibrated", semanticComplete: row?.semanticComplete ?? false };
  });
  return {
    status: results.some((result) => result.status === "failed") ? "failed" : results.some((result) => result.status === "blocked") ? "blocked" : !measured.length ? "unsupported" : rows.some((row) => row.calibration.status !== "calibrated") ? "uncalibrated" : "measured",
    cases: coverage,
    timing: rows,
    familyTimings,
    resources,
    retention: results.filter((result) => result.mode === "retention").map((result) => ({ caseId: result.caseId, round: result.round, snapshots: result.retention })),
    modelCost: modelCost(settings.usage),
    counts: {
      cases: cases.length,
      positiveCases: cases.filter((testCase) => testCase.expected.accept).length,
      negativeCases: cases.filter((testCase) => !testCase.expected.accept).length,
      families: representativeFamilies.length,
      unsupportedFamilies: [...unsupported.keys()],
      unsupportedCases: cases.length - measured.length,
      workers: results.length,
      failedWorkers: results.filter((result) => result.status === "failed").length,
      blockedWorkers: results.filter((result) => result.status === "blocked").length,
      completeSemanticCases: coverage.filter((row) => row.semanticComplete).length,
      calibratedTimingRows: rows.filter((row) => row.calibration.status === "calibrated").length,
      totalTimingRows: rows.length,
      actualTimedCalls: results.reduce(
        (sum, result) => sum + Object.values(result.iterations ?? {}).flat().reduce((a, b) => a + (b ?? 0), 0) + (result.mode === "cold" ? 1 : 0),
        0
      )
    }
  };
}
var escape = (value) => String(value).replaceAll("|", "\\|").replaceAll("\n", " ");
function portableMarkdown(report) {
  const summary = report.summary;
  const lines = [
    `# ${report.project} benchmark case study`,
    "",
    `Version: ${report.version}. Measured ${report.startedAt} through ${report.finishedAt}. ${report.reused ? "Retained observations reused; no new clocks." : "Fresh retained observations."}`,
    "",
    `Cases: ${summary.counts.cases}; families: ${summary.counts.families}; positive: ${summary.counts.positiveCases}; negative: ${summary.counts.negativeCases}. Failed workers: ${summary.counts.failedWorkers}; blocked workers: ${summary.counts.blockedWorkers}.`,
    "",
    `Timing calibration: ${summary.counts.calibratedTimingRows}/${summary.counts.totalTimingRows} rows calibrated. Declared native-plus-painted correspondence: ${summary.counts.completeSemanticCases}/${summary.counts.positiveCases} positive cases. Acceptance, semantic evidence and timing calibration are separate observations.`,
    "",
    "A0, A1 and B use the same admitted artifact. Their differences diagnose measurement variation; they cannot establish a product speedup. Cold imports may prepare in batches, but first API calls execute one at a time after the complete idle barrier. Timings exclude import and qualification. Cases with a prelude report first-final-source timing after that prelude.",
    "",
    ...summary.counts.unsupportedFamilies.length ? [`Unsupported families: ${summary.counts.unsupportedFamilies.join(", ")}. The renderer rejected each family's canonical source, so their ${summary.counts.unsupportedCases} cases were not run; they are coverage gaps, not failures.`, ""] : [],
    "## Family representatives",
    "",
    "| Family | Warm repeated API median (ms) | Calibrated | Native + painted criteria |",
    "|---|---:|---|---|",
    ...summary.familyTimings.map((row) => `| ${row.family} | ${row.supported ? row.medianMs?.toFixed(4) ?? "unavailable" : "unsupported"} | ${row.calibrated} | ${row.semanticComplete ? "declared criteria complete" : "partial; see case scopes"} |`),
    "",
    "## Scaling",
    "",
    "| Family | Size | Warm repeat median (ms) | Warm calibrated | First-use p95 (ms) | First-use calibrated |",
    "|---|---:|---:|---|---:|---|",
    ...summary.timing.filter((row) => row.cohort === "scaling" && row.track === "warm-repeat").map((row) => {
      const cold = summary.timing.find((candidate) => candidate.caseId === row.caseId && candidate.track === "first-use");
      return `| ${row.family} | ${row.scale} | ${row.medianMs?.toFixed(4) ?? "unavailable"} | ${row.calibration.status === "calibrated"} | ${cold?.p95Ms?.toFixed(4) ?? "unavailable"} | ${cold?.calibration.status === "calibrated"} |`;
    }),
    "",
    "## Individual cases and fidelity",
    "",
    "| Case | Acceptance matches | Failed / blocked workers | Semantic scope |",
    "|---|---|---:|---|",
    ...summary.cases.map(
      (row) => `| ${escape(row.id)} | ${row.acceptanceMatches} | ${row.failedWorkers} / ${row.blockedWorkers} | ${row.unsupported ? "Family unsupported; not run" : row.semanticComplete ? "Declared native + painted checks complete" : row.expectedAccepted ? "Paint/native projection incomplete; never a full fidelity pass" : "Negative-source rejection only"} |`
    ),
    "",
    "## Memory and cost",
    "",
    "API RSS/heap snapshots are read before output qualification, at return and after dropping the output and requesting GC. Signed deltas remain signed. Independent import/prelude-only baseline processes are retained. These snapshots do not measure peak native/WASM/GPU allocation. GNU time peaks and CPU, when available, describe the whole worker, including import, driver, GC and later qualification; they are not API-only peaks or provider invoices.",
    "",
    "| Family representative | Median API-return RSS change (MiB) | Median post-GC heap change (KiB) | Median whole-worker peak RSS (MiB) |",
    "|---|---:|---:|---:|",
    ...summary.cases.filter((row) => row.cohort === "family").map((row) => {
      const resource = summary.resources.filter((resource2) => resource2.caseId === row.id && resource2.qualified);
      const rss = resource.map((resource2) => resource2.apiReturnDelta.rss), heap = resource.map((resource2) => resource2.retainedDelta.heapUsed), peaks = resource.flatMap((resource2) => resource2.wholeWorker ? [resource2.wholeWorker.peakRssBytes] : []);
      return `| ${row.family} | ${rss.length ? (median(rss) / 1048576).toFixed(3) : "unavailable"} | ${heap.length ? (median(heap) / 1024).toFixed(3) : "unavailable"} | ${peaks.length ? (median(peaks) / 1048576).toFixed(3) : "unavailable"} |`;
    }),
    "",
    `Live model cost: ${summary.modelCost.status}. No provider call is made by this runner. CPU cost needs an explicit rate; zero coarse CPU counters are censored, not free. Retention checkpoints at 0/10/100/1000 comment-varied calls of the same semantic graph are available for the declared small flowchart case, not all families or a leak proof.`,
    "",
    "## Uncalibrated or failed timing rows",
    "",
    ...summary.timing.filter((row) => row.calibration.status !== "calibrated").map((row) => `- ${row.caseId} / ${row.track}: ${row.calibration.gaps.join("; ")}`),
    "",
    "## Reproduction and raw evidence",
    "",
    `Evidence directory: ${report.evidenceDirectory}`,
    "",
    "Sampling:",
    "```json",
    JSON.stringify(report.sampling, null, 2),
    "```",
    "",
    "Every individual first-use sample and every warm batch mean is retained. Representative SVG and full qualification payloads accompany raw results; repeated passing payloads are compacted. Dave, the historical fixed core and pinned-Mermaid scores are unchanged. Curves, clipping, full shape boundaries, computed fonts and perceptual quality need separate reviewed evidence.",
    ""
  ];
  return lines.join("\n");
}

// tool-versions.json
var tool_versions_default = {
  schemaVersion: 1,
  aliases: {
    bezel: "crabtalk/bezel",
    "beautiful-mermaid": "lukilabs/beautiful-mermaid"
  },
  mermaidOracle: {
    tool: "mermaid-js/mermaid",
    dependencies: {
      "@mermaid-js/parser": "2.0.1",
      jsdom: "26.1.0"
    }
  },
  tools: {
    "obsidianmd/pele": {
      registry: "npm",
      package: "pele",
      version: "1.9.0"
    },
    "mermaid-js/mermaid": {
      registry: "npm",
      package: "mermaid",
      version: "12.2.0"
    },
    "@mermaid-js/mermaid-zenuml": {
      registry: "npm",
      package: "@mermaid-js/mermaid-zenuml",
      version: "1.0.1"
    }
  }
};

// tool-versions.ts
var benchmarkToolPins = tool_versions_default.tools;
var aliases = { agentic: "adewale/agentic-mermaid", pele: "obsidianmd/pele", "npm:pele": "obsidianmd/pele", mermaid: "mermaid-js/mermaid", "npm:mermaid": "mermaid-js/mermaid", "agentic-mermaid": "adewale/agentic-mermaid" };
var canonicalBenchmarkTool = (tool) => {
  const name = tool.startsWith("npm:") ? tool.slice(4) : tool;
  const normalized = name.includes("/") && !name.startsWith("@") ? name.toLowerCase() : name;
  return aliases[normalized] ?? tool_versions_default.aliases[normalized] ?? Object.entries(tool_versions_default.tools).find(([, pin]) => pin.package === normalized)?.[0] ?? normalized;
};
function assertBenchmarkToolVersion(tool, version, source) {
  const canonical = canonicalBenchmarkTool(tool);
  if (typeof version !== "string" || !version.trim() || version !== version.trim()) throw Error(`Missing artifact version for ${canonical} in ${source}`);
  const expected = tool_versions_default.tools[canonical]?.version;
  if (expected && version !== expected) throw Error(`Benchmark set requires ${canonical} ${expected}; ${source} supplied ${version}`);
}

// portable/time-observer.ts
import { spawnSync } from "node:child_process";
import { existsSync as existsSync5 } from "node:fs";
import { delimiter, join as join4 } from "node:path";
function isGnuTime(path) {
  if (!existsSync5(path)) return false;
  const result = spawnSync(path, ["--version"], { encoding: "utf8", timeout: 1e4, stdio: ["ignore", "pipe", "pipe"] });
  return result.status === 0 && /GNU\s*Time/i.test(result.stdout + result.stderr);
}
function defaultTimeObserver() {
  const onPath = (process.env.PATH ?? "").split(delimiter).filter(Boolean).map((directory) => join4(directory, "gtime"));
  return ["/usr/bin/time", ...onPath].find(isGnuTime);
}

// portable/mermaid-oracle.ts
import { spawn, spawnSync as spawnSync2 } from "node:child_process";
import { existsSync as existsSync6, readFileSync as readFileSync5 } from "node:fs";
import { createRequire } from "node:module";
import { dirname as dirname4, join as join5, resolve as resolve4 } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath as fileURLToPath2 } from "node:url";
var MERMAID_ORACLE_PIN = {
  version: tool_versions_default.tools[tool_versions_default.mermaidOracle.tool].version,
  parser: tool_versions_default.mermaidOracle.dependencies["@mermaid-js/parser"],
  dom: tool_versions_default.mermaidOracle.dependencies.jsdom
};
var here = dirname4(fileURLToPath2(import.meta.url));
var packageName = (directory) => {
  try {
    return JSON.parse(readFileSync5(join5(directory, "package.json"), "utf8")).name;
  } catch {
    return void 0;
  }
};
function harnessRoot(_environment) {
  for (let directory = here, depth = 0; depth < 3; depth++, directory = dirname4(directory)) if (packageName(directory) === "trident") return directory;
  return here;
}
var mermaidOracleDirectory = (environment = process.env) => resolve4(environment.MERMAID_REFERENCE_DIR ?? join5(harnessRoot(environment), "../mermaid-reference"));
function installHint(_environment) {
  return "Install it with `node commands.ts mermaid:install`, or set MERMAID_REFERENCE_DIR to an existing install.";
}
function admitMermaidOracle(directory, environment = process.env) {
  const pin = MERMAID_ORACLE_PIN;
  const refuse = (problem) => {
    throw Error(`Trident needs the pinned Mermaid oracle (mermaid ${pin.version}, @mermaid-js/parser ${pin.parser}, jsdom ${pin.dom}) at ${directory}: ${problem}. ${installHint(environment)}`);
  };
  const manifest = (require3, name) => require3.resolve.paths(name)?.map((directory2) => join5(directory2, name, "package.json")).find((path) => existsSync6(path)) ?? refuse(`${name} is not installed`);
  const version = (require3, name) => JSON.parse(readFileSync5(manifest(require3, name), "utf8")).version;
  if (!existsSync6(join5(directory, "package.json"))) refuse("no install exists");
  const require2 = createRequire(join5(directory, "package.json"));
  const installed = { version: version(require2, "mermaid"), parserVersion: version(createRequire(manifest(require2, "mermaid")), "@mermaid-js/parser"), domVersion: version(require2, "jsdom") };
  if (installed.version !== pin.version || installed.parserVersion !== pin.parser || installed.domVersion !== pin.dom) refuse(`found mermaid ${installed.version}, @mermaid-js/parser ${installed.parserVersion}, jsdom ${installed.domVersion}`);
  let integrity = null;
  try {
    integrity = JSON.parse(readFileSync5(join5(directory, "package-lock.json"), "utf8")).packages?.["node_modules/mermaid"]?.integrity ?? null;
  } catch {
  }
  return { directory, ...installed, integrity };
}
function assertMermaidOracle(environment = process.env) {
  const directory = mermaidOracleDirectory(environment);
  if (environment.TRIDENT_MERMAID_ORACLE === `${MERMAID_ORACLE_PIN.version} ${directory}` && existsSync6(directory)) return { directory, version: MERMAID_ORACLE_PIN.version, parserVersion: MERMAID_ORACLE_PIN.parser, domVersion: MERMAID_ORACLE_PIN.dom, integrity: null };
  const oracle = admitMermaidOracle(directory, environment);
  environment.MERMAID_REFERENCE_DIR = directory;
  environment.TRIDENT_MERMAID_ORACLE = `${oracle.version} ${directory}`;
  return oracle;
}
function mermaidZenumlAddon(directory = mermaidOracleDirectory(), configured = process.env.MERMAID_ZENUML_BENCHMARK_ROOT) {
  const root = resolve4(configured ?? join5(directory, "node_modules/@mermaid-js/mermaid-zenuml"));
  const version = tool_versions_default.tools["@mermaid-js/mermaid-zenuml"].version;
  let manifest;
  try {
    manifest = JSON.parse(readFileSync5(join5(root, "package.json"), "utf8"));
  } catch {
    throw Error(`ZenUML needs the pinned @mermaid-js/mermaid-zenuml ${version}; rerun mermaid:install or set MERMAID_ZENUML_BENCHMARK_ROOT`);
  }
  const entry = "dist/mermaid-zenuml.esm.min.mjs";
  if (manifest.name !== "@mermaid-js/mermaid-zenuml" || manifest.version !== version || !existsSync6(join5(root, entry))) throw Error(`ZenUML addon must be @mermaid-js/mermaid-zenuml ${version} with its public browser distribution: ${root}`);
  return { root, entry, version };
}
async function mermaidVerdicts(oracle, sources, options = {}) {
  if (!sources.length) return [];
  const addon = sources.some((source) => /^\s*zenuml\b/m.test(source)) ? mermaidZenumlAddon(oracle.directory) : void 0;
  const child = spawn(process.env.NODE_BIN ?? "node", [join5(here, "mermaid-oracle-worker.mjs"), oracle.directory, ...addon ? [join5(addon.root, addon.entry)] : []], { stdio: ["pipe", "pipe", "pipe"] });
  let stderr = "";
  child.stderr.on("data", (data) => stderr = (stderr + String(data)).slice(-2e3));
  const replies = [];
  const lines = createInterface({ input: child.stdout });
  const done = new Promise((resolveDone, reject) => {
    lines.on("line", (line) => {
      replies.push(JSON.parse(line));
      if (replies.length === sources.length) child.stdin.end();
    });
    child.once("error", reject);
    child.once("close", (code) => replies.length === sources.length ? resolveDone() : reject(Error(`Mermaid oracle stopped after ${replies.length}/${sources.length} replies (exit ${code}): ${stderr}`)));
  });
  for (const source of sources) child.stdin.write(JSON.stringify({ source, snapshot: options.snapshot === true }).replace(/[\u2028\u2029]/g, (c) => `\\u${c.charCodeAt(0).toString(16)}`) + "\n");
  await done;
  return replies;
}
async function assertOracleAgrees(oracle, expectations) {
  const verdicts = await mermaidVerdicts(oracle, expectations.map((expectation) => expectation.source));
  const disagreements = expectations.flatMap((expectation, index) => verdicts[index].accepted === expectation.accept ? [] : [`${expectation.id} (${expectation.accept ? `rejected: ${verdicts[index].error}` : "accepted"})`]);
  if (disagreements.length) throw Error(`Pinned Mermaid ${oracle.version} contradicts authored expectations; fix these sources before measuring: ${disagreements.join("; ")}`);
  return Object.fromEntries(expectations.flatMap((expectation, index) => verdicts[index].accepted ? [[expectation.id, verdicts[index].diagramType]] : []));
}

// portable/ci-policy.ts
function assertBenchmarkExecutionAllowed(environment = process.env, requirements = {}) {
  const enabled = (value) => value !== void 0 && value !== "" && !/^(?:0|false|no)$/i.test(value);
  const indicators = ["CI", "GITHUB_ACTIONS", "GITLAB_CI", "BUILDKITE", "CIRCLECI", "TF_BUILD", "JENKINS_URL", "TEAMCITY_VERSION"];
  const active = indicators.filter((name) => enabled(environment[name]));
  if (active.length) throw new Error(`Benchmarks are excluded from CI (${active.join(", ")}). Run them in an explicit local measurement session; records can be updated without rerunning unchanged projects.`);
  if (requirements.mermaidOracle ?? true) assertMermaidOracle(environment);
}

// portable/run.ts
function parsePortableOptions(argv) {
  const flags = /* @__PURE__ */ new Set(["--force", "--plan", "--allow-partial"]), values = /* @__PURE__ */ new Map();
  const allowed = /* @__PURE__ */ new Set(["project", "artifact-root", "adapter", "entry", "node", "out", "records", "rounds", "samples", "cold-samples", "min-sample-ms", "worker-timeout-ms", "preparation-concurrency", "maximum-control-spread", "cohort", "observer", "mermaid-reference", "usage", "cpu-hour-usd"]);
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index];
    if (values.has(flag)) throw Error("Duplicate option " + flag);
    if (flags.has(flag)) {
      values.set(flag, "true");
      continue;
    }
    const value = argv[++index];
    if (!flag.startsWith("--") || !allowed.has(flag.slice(2)) || !value || value.startsWith("--")) throw Error("Invalid portable option " + flag);
    values.set(flag, value);
  }
  for (const key of ["--project", "--artifact-root"]) if (!values.has(key)) throw Error("Required " + key);
  const integer = (key, fallback) => {
    const value = Number(values.get(key) ?? fallback);
    if (!Number.isSafeInteger(value) || value < 1) throw Error(key + " needs a positive integer");
    return value;
  };
  const decimal = (key, fallback) => {
    const value = Number(values.get(key) ?? fallback);
    if (!Number.isFinite(value) || value < 0) throw Error(key + " needs a finite nonnegative number");
    return value;
  };
  const adapter = values.get("--adapter") ?? "pele";
  if (!["pele", "agentic", "beautiful", "ondine"].includes(adapter)) throw Error("Unsupported public Node SVG adapter");
  const cohorts = values.has("--cohort") ? values.get("--cohort").split(",") : void 0;
  if (cohorts?.some((cohort) => !["family", "scaling", "adversarial", "invalid"].includes(cohort)) || cohorts && new Set(cohorts).size !== cohorts.length) throw Error("Unknown or repeated cohort");
  return {
    project: values.get("--project"),
    artifactRoot: resolve5(values.get("--artifact-root")),
    adapter,
    entry: values.get("--entry"),
    node: values.get("--node") ?? process.env.NODE_BIN ?? "node",
    out: resolve5(values.get("--out") ?? "bench-report/portable"),
    records: resolve5(values.get("--records") ?? "bench-report/project-records"),
    rounds: integer("--rounds", 5),
    samples: integer("--samples", 31),
    coldSamples: integer("--cold-samples", 20),
    minSampleMs: decimal("--min-sample-ms", 2),
    workerTimeoutMs: integer("--worker-timeout-ms", 3e5),
    preparationConcurrency: integer("--preparation-concurrency", 8),
    maximumControlSpread: decimal("--maximum-control-spread", 0.25),
    cohorts,
    observer: values.has("--observer") ? resolve5(values.get("--observer")) : defaultTimeObserver(),
    mermaidReference: values.has("--mermaid-reference") ? resolve5(values.get("--mermaid-reference")) : void 0,
    usage: values.has("--usage") ? resolve5(values.get("--usage")) : void 0,
    cpuHourUsd: values.has("--cpu-hour-usd") ? decimal("--cpu-hour-usd", 0) : void 0,
    force: values.has("--force"),
    plan: values.has("--plan"),
    allowPartial: values.has("--allow-partial")
  };
}
var now = () => (/* @__PURE__ */ new Date()).toISOString();
var writeJson = (file, value) => writeFileSync2(file, JSON.stringify(value, null, 2) + "\n", { flag: "wx" });
var jsonValue = (value) => JSON.parse(JSON.stringify(value));
function observerIdentity(path) {
  if (!path) return { status: "unavailable", path: null, detail: "No GNU time configured or found (/usr/bin/time, gtime on PATH); current API snapshots still execute" };
  const version = execFileSync2(path, ["--version"], { encoding: "utf8", timeout: 1e4 }).trim();
  if (!/GNU\s*Time/i.test(version)) throw Error("Resource observer must be GNU time");
  return { status: "available", path, version, sha256: byteDigest(path) };
}
function listFiles(directory, root = directory) {
  return readdirSync3(directory, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? listFiles(join6(directory, entry.name), root) : entry.isFile() ? [relative3(root, join6(directory, entry.name))] : []).sort();
}
function observations(project, cases, results) {
  const rejected = new Map(results.filter((result) => result.mode === "probe" && result.status === "unsupported").map((result) => [result.family, result]));
  const unrun = cases.flatMap((testCase) => {
    const probe = rejected.get(testCase.family);
    return probe ? [{ suite: "portable-community", surface: "node:public-svg", runtime: `node:${probe.runtime.node}`, family: testCase.family, caseId: testCase.id, format: "svg", operation: "render", mode: "family-unsupported", status: "unsupported", detail: `Not run: the renderer rejected ${probe.caseId}: ${probe.error}`, metrics: { implementation: project } }] : [];
  });
  return [...results.flatMap((result) => {
    const status = result.status === "partial" ? "blocked" : result.status;
    const metrics = { implementation: project, round: result.round, replica: result.replica, sample: result.sample, accepted: result.qualification?.accepted ?? null, semanticComplete: result.qualification?.semanticComplete ?? false };
    const base = { suite: "portable-community", surface: "node:public-svg", runtime: `node:${result.runtime.node}`, family: result.family, caseId: result.caseId, format: "svg", status, detail: result.qualification?.scope ?? result.error };
    if (result.mode === "probe") return [{ ...base, operation: "family-support", mode: "probe", detail: result.error, metrics: { ...metrics, metricId: `probe:${result.family}` } }];
    if (result.mode === "baseline" || result.mode === "memory" || result.mode === "retention") return [{ ...base, operation: "resource-diagnostic", mode: result.mode, metrics: { ...metrics, metricId: `${result.mode}:${result.round}:${result.replica}:${result.sample}` } }];
    return Object.entries(result.tracks).map(([track, samples]) => ({ ...base, operation: "render", mode: `${result.replica}:${track}`, samplesMs: samples, metrics: { ...metrics, metricId: `${track}:${result.round}:${result.replica}:${result.sample}` } }));
  }), ...unrun];
}
async function runPortable(options) {
  if (options.mermaidReference) process.env.MERMAID_REFERENCE_DIR = options.mermaidReference;
  assertBenchmarkExecutionAllowed();
  resetPortableCancellation();
  const testCases = portableCases(options.cohorts), artifact = resolveArtifact(options.project, options.artifactRoot, options.adapter, options.node, options.entry);
  assertBenchmarkToolVersion(options.project, artifact.version, "portable SVG artifact");
  if (!testCases.length) throw Error("No selected cases");
  const probes = [...new Set(testCases.map((testCase) => testCase.family))].flatMap((family) => familySupportProbe(family) ?? []);
  const diagramTypes = await assertOracleAgrees(
    assertMermaidOracle(),
    [...testCases, ...probes].flatMap((testCase) => [
      { id: testCase.id, source: testCase.source, accept: testCase.expected.accept },
      ...(testCase.prelude ?? []).map((prelude, index) => ({ id: `${testCase.id}#prelude${index}`, source: prelude.source, accept: prelude.accept })),
      ...testCase.edit ? [{ id: `${testCase.id}#edit`, source: testCase.edit.source, accept: testCase.edit.expected.accept }] : []
    ])
  );
  const sampling = {
    rounds: options.rounds,
    samples: options.samples,
    coldSamples: options.coldSamples,
    minSampleMs: options.minSampleMs,
    workerTimeoutMs: options.workerTimeoutMs ?? 3e5,
    preparationConcurrency: options.preparationConcurrency,
    maximumControlSpread: options.maximumControlSpread,
    order: "rotate A0/A1/B by round and case; all warm jobs, then all cold jobs, then serial memory/baseline jobs",
    controls: "A0/A1/B are the exact same admitted artifact, not three tool versions",
    warmScope: "Per-call means from batches bounded by minSampleMs or256calls; every distinct immutable SVG is checked outside clocks, byte-identical admitted returns reuse qualification; individual first-use samples are fresh processes",
    commentVariantScope: "Trailing comment changes only source bytes, never semantic graph; this is a cache-key diagnostic",
    coldScope: "Concurrent import preparation behind an idle barrier; one measured API call at a time and complete child exit before the next",
    memoryScope: "Separate serial fresh processes; API snapshots precede qualification, GNU time describes the whole worker",
    retentionCalls: [0, 10, 100, 1e3]
  };
  const identity = jsonValue({
    project: options.project,
    lane: "portable-svg",
    protocol: { measurement: PORTABLE_MEASUREMENT_PROTOCOL, cohort: PORTABLE_COHORT_PROTOCOL, harness: harnessIdentity(), cases: testCases, familySupport: { protocol: FAMILY_SUPPORT_PROTOCOL, probes, oracle: { pin: MERMAID_ORACLE_PIN, diagramTypes: Object.fromEntries(probes.map((probe) => [probe.family, diagramTypes[probe.id] ?? null])) } } },
    artifact: artifactIdentity(artifact),
    measurement: { sampling: Object.fromEntries(Object.entries(sampling).filter(([key]) => key !== "maximumControlSpread")), environment: environmentIdentity(options.node), observer: observerIdentity(options.observer) }
  });
  const assertIdentityStable = () => {
    if (stableValue(artifactIdentity(artifact)) !== stableValue(identity.artifact) || stableValue(environmentIdentity(options.node)) !== stableValue(identity.measurement.environment) || stableValue(observerIdentity(options.observer)) !== stableValue(identity.measurement.observer))
      throw Error("Artifact/runtime/resource observer changed; no completed record is activated or published");
  };
  mkdirSync2(options.out, { recursive: true });
  mkdirSync2(options.records, { recursive: true });
  const lock = join6(options.records, "portable-campaign.lock"), fd = openSync3(lock, "wx");
  let published = false;
  try {
    writeFileSync2(fd, JSON.stringify({ pid: process.pid, project: options.project, startedAt: now() }));
    const retained2 = options.force ? void 0 : findProjectRecord(options.records, identity);
    const action = retained2 ? "reused" : "measure";
    if (options.plan) return { action, project: options.project, record: retained2?.id ?? null, sampling, cases: testCases.length };
    let record;
    if (retained2) {
      const resultFile = join6(retained2.evidenceDirectory, "results.json"), observationFile = join6(retained2.evidenceDirectory, "observations.json");
      if (existsSync7(resultFile) && stableValue(readJson(resultFile)) !== stableValue(retained2.provenance.results)) throw Error("Retained worker results differ from the immutable project record");
      if (existsSync7(observationFile) && stableValue(readJson(observationFile)) !== stableValue(retained2.observations)) throw Error("Retained raw observation envelope differs from its record");
      assertIdentityStable();
      await new Promise((resolve6) => setImmediate(resolve6));
      assertPortableRunning();
      activateProjectRecord(options.records, retained2);
      record = retained2;
    } else {
      const startedAt = now(), id = randomUUID2(), directory = join6(options.out, "attempts", id);
      writeFileSync2(join6(options.out, "report.json"), JSON.stringify({ status: "running", project: options.project, startedAt, pendingAttempt: id, previousRecordRetained: true }) + "\n");
      mkdirSync2(directory, { recursive: true });
      mkdirSync2(join6(directory, "svg"));
      writeJson(join6(directory, "invocation.json"), { options, artifact, sampling, identity, startedAt });
      const results2 = [];
      const retain = (result) => {
        results2.push(result);
        appendFileSync(join6(directory, "workers.jsonl.gz"), gzipSync3(Buffer.from(JSON.stringify(result) + "\n")));
      };
      await measurePortableProject(artifact, testCases, options, directory, retain);
      assertIdentityStable();
      const actualObservations = observations(options.project, testCases, results2);
      const finishedAt = now();
      record = {
        schemaVersion: 1,
        id,
        identity,
        startedAt,
        finishedAt,
        status: results2.some((result) => result.status === "failed") ? "failed" : results2.some((result) => result.status === "partial" || result.status === "blocked") ? "blocked" : "passed",
        evidenceDirectory: directory,
        evidenceFiles: [...listFiles(directory).filter((file) => !["workers.jsonl.gz", "invocation.json"].includes(file)), "result.json.gz"],
        observations: actualObservations,
        gaps: [...new Set(results2.flatMap((result) => result.qualification?.unmeasuredScopes.filter((scope) => !scope.startsWith("Repeated passing")) ?? []))],
        provenance: { workerProtocol: PORTABLE_MEASUREMENT_PROTOCOL, sampler: sampling, artifact, results: results2 }
      };
      const payloadFile = join6(directory, "result.json.gz");
      writeProjectBenchmarkRecord(payloadFile, record);
      await new Promise((resolve6) => setImmediate(resolve6));
      assertPortableRunning();
      publishProjectRecord(options.records, record, { payloadFile });
      published = true;
      rmSync(join6(directory, "workers.jsonl.gz"), { force: true });
      rmSync(join6(directory, "invocation.json"), { force: true });
    }
    const results = record.provenance.results;
    if (!Array.isArray(results)) throw Error("Retained portable record has no worker results");
    const summary = portableSummary(testCases, results, { ...options, usage: options.usage ? readJson(options.usage) : void 0 });
    const report = {
      schemaVersion: 1,
      protocol: PORTABLE_MEASUREMENT_PROTOCOL,
      status: summary.status === "failed" ? "failed" : summary.status !== "measured" || summary.counts.completeSemanticCases !== summary.counts.positiveCases ? "incomplete" : "passed",
      project: options.project,
      version: artifact.version,
      artifact: identity.artifact,
      sampling,
      startedAt: record.startedAt,
      finishedAt: record.finishedAt,
      evidenceDirectory: record.evidenceDirectory,
      recordId: record.id,
      reused: !!retained2,
      summary
    };
    assertPortableRunning();
    writeFileSync2(join6(options.out, "report.json"), JSON.stringify(report, null, 2) + "\n");
    writeFileSync2(join6(options.out, "report.md"), portableMarkdown(report));
    const current = inspectCurrentProjectRecords(options.records);
    writeFileSync2(
      join6(options.out, "projects.json"),
      JSON.stringify(
        current.map((item) => ({ project: item.record.identity.project, lane: item.record.identity.lane ?? "community", recordId: item.record.id, status: item.record.status, measuredAt: item.record.finishedAt, evidenceRetained: item.evidenceRetained })),
        null,
        2
      ) + "\n"
    );
    return report;
  } catch (error) {
    if (!options.plan) writeFileSync2(join6(options.out, "report.json"), JSON.stringify({ status: error instanceof PortableCancelled ? "cancelled" : "incomplete", project: options.project, finishedAt: now(), error: String(error), completedRecordPublished: published }) + "\n");
    throw error;
  } finally {
    closeSync3(fd);
    unlinkSync2(lock);
  }
}
async function main(argv = process.argv.slice(2)) {
  if (argv.length === 1 && argv[0] === "--help") {
    console.log(
      PORTABLE_HELP
    );
    return;
  }
  const options = parsePortableOptions(argv);
  const cleanup = () => {
    terminatePortableWorkers();
    process.exitCode = 130;
  };
  process.once("SIGINT", cleanup);
  process.once("SIGTERM", cleanup);
  try {
    const result = await runPortable(options);
    console.log(JSON.stringify("summary" in result ? { project: result.project, reused: result.reused, recordId: result.recordId, status: result.summary.status, counts: result.summary.counts, report: join6(options.out, "report.md") } : result, null, 2));
    if ("summary" in result) process.exitCode = result.summary.status === "failed" ? 1 : !options.allowPartial && (result.summary.status !== "measured" || result.summary.counts.completeSemanticCases !== result.summary.counts.positiveCases) ? 2 : 0;
  } catch (error) {
    if (error instanceof PortableCancelled) {
      process.exitCode = 130;
      console.error(error.message);
    } else throw error;
  } finally {
    process.off("SIGINT", cleanup);
    process.off("SIGTERM", cleanup);
  }
}
if (process.argv[1] && realpathSync3(resolve5(process.argv[1])) === realpathSync3(fileURLToPath3(import.meta.url))) await main();
export {
  assertBenchmarkExecutionAllowed as assertPortableLocal,
  main,
  parsePortableOptions,
  runPortable
};
