// Reference-only syntax and rendered-text boundaries. The addon parser is a no-op;
// acceptance must also come from the real pinned public ZenUml.parse API.
import { readFileSync } from 'node:fs';

export function resolveZenUMLReferenceModules() {
  const addonURL = import.meta.resolve('@mermaid-js/mermaid-zenuml');
  const coreURL = import.meta.resolve('@zenuml/core');
  for (const [url, name, version] of [[addonURL, '@mermaid-js/mermaid-zenuml', '1.0.1'], [coreURL, '@zenuml/core', '3.47.9']]) {
    const metadata = JSON.parse(readFileSync(new URL('../package.json', url), 'utf8'));
    if (metadata.name !== name || metadata.version !== version) throw Error(`ZenUML reference requires ${name}@${version}; installed ${metadata.name}@${metadata.version}`);
  }
  return { addonURL, coreURL };
}

export function createZenUMLReference(mermaid, mermaidVersion) {
  let loaded;
  let renderToSvg;
  const identity = {
    mermaid: `mermaid@${mermaidVersion}`,
    addon: '@mermaid-js/mermaid-zenuml@1.0.1',
    parser: '@zenuml/core@3.47.9',
    api: 'public ZenUml.parse: pass/errorDetails only',
    packageSource: 'exact project devDependencies, not the reference installation transitive range',
  };
  const load = () => loaded ??= (async () => {
    const { addonURL, coreURL } = resolveZenUMLReferenceModules();
    const [{ default: addon }, core] = await Promise.all([import(addonURL), import(coreURL)]);
    const { default: ZenUml } = core;
    renderToSvg = core.renderToSvg;
    // Register on the supplied runtime, including the separately instrumented
    // Mermaid data-module instance used by selected-grammar controls.
    await mermaid.registerExternalDiagrams([addon]);
    const host = document.createElement('div');
    document.body.append(host);
    return new ZenUml(host, true);
  })();
  const payload = text => text.replace(/^\s*zenuml\b/, '');
  const parsePayload = async text => {
    const parser = await load();
    const result = await parser.parse(text);
    if (result?.pass !== true) throw Error(`${identity.parser} rejected source: ${(result?.errorDetails ?? []).map(error => error.msg).join('; ') || 'syntax error'}`);
  };
  return {
    identity,
    load,
    payload,
    parsePayload,
    async renderedLabels(text) {
      await load();
      const origin = `${identity.parser} public named renderToSvg: returned SVG DOM text`;
      const provenance = {
        kind: 'rendered-svg-text', origin,
        limitations: 'Rendered semantic text only, not a parser AST, identity/multiplicity proof or geometry oracle. Uses the public SSR renderer with its built-in font fallback; excludes sequence numbers, notes and fragment control labels.',
      };
      try {
        const rendered = renderToSvg(payload(text));
        if (typeof rendered?.svg !== 'string') throw Error('Public renderToSvg did not return SVG');
        const svg = new window.DOMParser().parseFromString(rendered.svg, 'image/svg+xml');
        if (svg.querySelector('parsererror') || svg.documentElement.localName !== 'svg') throw Error('Public renderToSvg returned invalid SVG');
        const labels = [...svg.querySelectorAll('text.participant-label, text.message-label, text.return-label, text.frame-title')].map((node, index) => ({
          path: `renderToSvg.semanticText[${index}].${node.getAttribute('class')}`,
          text: node.textContent ?? '',
        })).filter(label => label.text.trim());
        return { ...provenance, labels };
      } catch (error) {
        return { ...provenance, error: String(error?.message ?? error) };
      }
    },
    async diagram(source) {
      if (/(?:^|\n)\s*zenuml\b/.test(source)) await load();
      await mermaid.parse(source);
      const diagram = await mermaid.mermaidAPI.getDiagramFromText(source);
      if (diagram.type === 'zenuml') await parsePayload(payload(diagram.text));
      return diagram;
    },
  };
}
