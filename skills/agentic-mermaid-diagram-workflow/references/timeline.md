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

MutationOps (10): set_title (pass `null` to clear), add_section,
remove_section, set_section_label, add_period, remove_period,
set_period_label, add_event, remove_event, set_event_text.

Sections/periods/events are referenced by integer index. Indices shift
after a remove — re-parse if you batch deletes.

Fidelity fallback: a timeline with unmodeled syntax (anything beyond
title/section/period/event/continuation) falls back to opaque body
(`asTimeline` returns null). Round-trips losslessly via preserved `body.source`.

Verify Tier 1: EMPTY_DIAGRAM (no title + no periods), LABEL_OVERFLOW on
title / section / period / event over the char cap.

Upstream: https://mermaid.js.org/syntax/timeline.html
