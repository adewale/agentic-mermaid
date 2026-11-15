export var knownStyleDescriptors, renderMermaidWithReceipt, verifyNoExternalRefs, verifyMermaid, renderMermaidAsciiWithReceipt, renderMermaidUnicodeWithReceipt, renderMermaidPngInBrowserWithReceipt, DEFAULT_EDITOR_PALETTE, state;


// Palette state stores the registry's stable input name.
export function editorPaletteDescriptor(key) {
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


export function editorPaletteInput(key) {
  var descriptor = editorPaletteDescriptor(key);
  return descriptor ? descriptor.inputName : "";
}


export function editorPaletteColors(key) {
  var descriptor = editorPaletteDescriptor(key);
  return descriptor && descriptor.spec && descriptor.spec.colors
    ? descriptor.spec.colors
    : null;
}

export function initialize() {
knownStyleDescriptors = window.__mermaid.knownStyleDescriptors;

renderMermaidWithReceipt = window.__mermaid.renderMermaidSVGWithReceipt;

verifyNoExternalRefs = window.__mermaid.verifyNoExternalRefs;

verifyMermaid = window.__mermaid.verifyMermaid;

renderMermaidAsciiWithReceipt = window.__mermaid.renderMermaidASCIIWithReceipt;

renderMermaidUnicodeWithReceipt = window.__mermaid.renderMermaidUnicodeWithReceipt;

renderMermaidPngInBrowserWithReceipt = window.__mermaid.renderMermaidPNGInBrowserWithReceipt;


DEFAULT_EDITOR_PALETTE = "paper";


state = {
  palette: DEFAULT_EDITOR_PALETTE,
  style: "crisp",
  seed: 0,
  zoom: 1,
  config: {},
  fitLabelsToPane: false,
};
}
