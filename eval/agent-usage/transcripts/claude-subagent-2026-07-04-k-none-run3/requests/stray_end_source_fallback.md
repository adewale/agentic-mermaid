Diagram task eval. The request below is your complete task; do not use any product documentation beyond it.

Task ID: stray_end_source_fallback
Task:
Append the message B-->>A: ok as the final top-level message, preserving every existing line exactly as written.

Context:
This sequence diagram contains a stray end line with no opening block — keep it: it is part of the diagram as the user maintains it. Use structured mutation if the tooling supports it on this input; otherwise make the smallest source-level edit and say so.

Existing Mermaid source to edit:
```mermaid
sequenceDiagram
  A->>B: hi
  end
  B-->>A: yo
```

Return your final Mermaid diagram source in a ```mermaid fence.
