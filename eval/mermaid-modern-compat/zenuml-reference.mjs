// Reference-only syntax boundary. The addon's Mermaid parser is a no-op;
// acceptance must also come from the real pinned public ZenUml.parse API.
import { readFileSync } from 'node:fs';

export function createZenUMLReference(mermaid, mermaidVersion) {
  let loaded;
  const identity = {
    mermaid: `mermaid@${mermaidVersion}`,
    addon: '@mermaid-js/mermaid-zenuml@1.0.1',
    parser: '@zenuml/core@3.47.9',
    api: 'public ZenUml.parse: pass/errorDetails only',
    packageSource: 'exact project devDependencies, not the reference installation transitive range',
  };
  const load = () => loaded ??= (async () => {
    const addonURL = import.meta.resolve('@mermaid-js/mermaid-zenuml');
    const coreURL = import.meta.resolve('@zenuml/core');
    for (const [url, name, version] of [[addonURL, '@mermaid-js/mermaid-zenuml', '1.0.1'], [coreURL, '@zenuml/core', '3.47.9']]) {
      const metadata = JSON.parse(readFileSync(new URL('../package.json', url), 'utf8'));
      if (metadata.name !== name || metadata.version !== version) throw Error(`ZenUML reference requires ${name}@${version}; installed ${metadata.name}@${metadata.version}`);
    }
    const [{ default: addon }, { default: ZenUml }] = await Promise.all([import(addonURL), import(coreURL)]);
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
    async diagram(source) {
      if (/(?:^|\n)\s*zenuml\b/.test(source)) await load();
      await mermaid.parse(source);
      const diagram = await mermaid.mermaidAPI.getDiagramFromText(source);
      if (diagram.type === 'zenuml') await parsePayload(payload(diagram.text));
      return diagram;
    },
  };
}
