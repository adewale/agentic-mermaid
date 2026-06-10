# Sample B (nested, .markdown extension)

A pie with frontmatter and showData — header is on a later line:

```mermaid
---
title: Key elements
---
pie showData
  "Calcium" : 42.96
  "Potassium" : 50.05
```

A gantt:

~~~mermaid
gantt
  title A Gantt
  section S
  Task :a1, 2024-01-01, 30d
~~~

A mindmap:

```mermaid
mindmap
  root((mindmap))
    A
    B
```

A gitGraph (note the capital G in source):

```mermaid
gitGraph
  commit
  branch develop
```

A block we don't render but should still count:

```mermaid
%% a comment first
quadrantChart
  title Reach and engagement
```
