var THEMES = window.__mermaid.THEMES;
var renderMermaidWithReceipt = window.__mermaid.renderMermaidSVGWithReceipt;
var verifyNoExternalRefs = window.__mermaid.verifyNoExternalRefs;
var verifyMermaid = window.__mermaid.verifyMermaid;
var renderMermaidAsciiWithReceipt = window.__mermaid.renderMermaidASCIIWithReceipt;
var renderMermaidUnicodeWithReceipt = window.__mermaid.renderMermaidUnicodeWithReceipt;
var renderMermaidPngInBrowserWithReceipt = window.__mermaid.renderMermaidPNGInBrowserWithReceipt;

var DEFAULT_EDITOR_THEME = "paper";

var state = {
  theme: DEFAULT_EDITOR_THEME,
  style: "crisp",
  seed: 0,
  zoom: 1,
  config: {},
};
