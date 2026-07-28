# MCP protocol input matrix

`cases.json` is a committed set of transport and envelope mutations derived
from the specification and the official conformance scenarios. It deliberately
stores inputs and expected wire outcomes as data rather than generating them
from the server implementation.

The matrix emphasizes one-field failures: required `_meta` members, version and
method header mirrors, request-id correlation, batching, notification silence,
and optional-method scope. A legacy positive control prevents an over-strict
modern validator from making every case pass by rejecting everything.

When the protocol or official suite changes, update the provenance and each
affected expectation explicitly. The consuming unit test validates unique case
names and requires both success and failure cases so the input set cannot
quietly collapse into a one-sided rejection suite.
