# Timeline syntax

```
timeline
  title History
  section Phase 1
  2020 : First
  2021 : Second
  section Phase 2
  2022 : Third
```

Lines: `title <text>`, `section <label>`, `<period-label> : <event>`
(multi-event via `: <event2> : <event3>`), and continuation `: <event>`
that adds an event to the previous period.

MutationOps: the live list and field shapes come from `am capabilities --json`
or `describeOps('timeline')` — title, section, period, and event add/remove/
relabel ops, move ops (order is the chronology), and accessibility title/
description. `set_title` takes `null` to clear.

Sections/periods/events are referenced by integer index. Indices shift
after a remove — re-parse if you batch deletes.

Fidelity fallback: a timeline with syntax the parser does not model falls back
to an opaque body (`asTimeline` returns null; `accTitle`/`accDescr` are
modeled). Round-trips losslessly via preserved `body.source`.

Verify Tier 1: EMPTY_DIAGRAM (no title + no periods), LABEL_OVERFLOW on
title / section / period / event over the char cap.

Upstream: https://mermaid.js.org/syntax/timeline.html
