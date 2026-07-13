var THEMES = window.__mermaid.THEMES;
var renderMermaid = window.__mermaid.renderMermaidSVGAsync;
var verifyNoExternalRefs = window.__mermaid.verifyNoExternalRefs;
var verifyMermaid = window.__mermaid.verifyMermaid;
var renderMermaidAscii = window.__mermaid.renderMermaidASCII;

var DEFAULT_EDITOR_THEME = "paper";

var state = {
  theme: DEFAULT_EDITOR_THEME,
  style: "crisp",
  seed: 0,
  zoom: 1,
  config: {},
};
