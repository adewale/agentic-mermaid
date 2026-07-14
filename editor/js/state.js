var THEMES = window.__mermaid.THEMES;
var knownStyleDescriptors = window.__mermaid.knownStyleDescriptors;
var renderMermaidWithReceipt = window.__mermaid.renderMermaidSVGWithReceipt;
var verifyNoExternalRefs = window.__mermaid.verifyNoExternalRefs;
var verifyMermaid = window.__mermaid.verifyMermaid;
var renderMermaidAsciiWithReceipt = window.__mermaid.renderMermaidASCIIWithReceipt;
var renderMermaidUnicodeWithReceipt = window.__mermaid.renderMermaidUnicodeWithReceipt;
var renderMermaidPngInBrowserWithReceipt = window.__mermaid.renderMermaidPNGInBrowserWithReceipt;

// Palette state stores the registry's stable input name. The legacy THEMES
// object remains a compatibility projection for older saved links only; it is
// never expanded into explicit render colors because that would change
// precedence relative to Mermaid themeVariables.
function editorPaletteDescriptor(key) {
  if (!key || typeof knownStyleDescriptors !== "function") return null;
  var descriptors = knownStyleDescriptors();
  for (var i = 0; i < descriptors.length; i++) {
    var descriptor = descriptors[i];
    if (descriptor.kind !== "palette") continue;
    var localName = descriptor.identity.id.slice(descriptor.identity.id.indexOf(":") + 1);
    if (descriptor.inputName === key || descriptor.identity.id === key || localName === key) return descriptor;
  }
  return null;
}

function editorPaletteInput(key) {
  var descriptor = editorPaletteDescriptor(key);
  return descriptor ? descriptor.inputName : "";
}

function editorPaletteColors(key) {
  var descriptor = editorPaletteDescriptor(key);
  return descriptor && descriptor.spec && descriptor.spec.colors
    ? descriptor.spec.colors
    : (key && THEMES[key]) || null;
}

var DEFAULT_EDITOR_PALETTE = "paper";

var state = {
  palette: DEFAULT_EDITOR_PALETTE,
  style: "crisp",
  seed: 0,
  zoom: 1,
  config: {},
};
