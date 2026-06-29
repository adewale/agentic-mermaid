var THEMES = window.__mermaid.THEMES;
var renderMermaid = window.__mermaid.renderMermaidSVGAsync;
var verifyMermaid = window.__mermaid.verifyMermaid;
var renderMermaidAscii = window.__mermaid.renderMermaidASCII;

var DEFAULT_EDITOR_THEME = "salmon";

var state = {
  theme: DEFAULT_EDITOR_THEME,
  zoom: 1,
  config: {},
};
