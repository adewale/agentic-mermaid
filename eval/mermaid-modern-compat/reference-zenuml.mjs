// Reference-only adapter for the exact ZenUML engine locked by the pinned
// Mermaid source. Mermaid's addon parser is deliberately a no-op: acceptance
// and semantic evidence must come from the engine that actually renders it.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

export async function loadZenReference(referenceDir) {
  const require = createRequire(join(referenceDir, 'package.json'));
  const entry = require.resolve('@zenuml/core').replace(/zenuml\.js$/, 'zenuml.esm.mjs');
  const version = JSON.parse(readFileSync(join(dirname(entry), '../package.json'), 'utf8')).version;
  if (version !== '3.49.2') throw new Error(`Expected pinned ZenUML engine 3.49.2; received ${version}`);
  let source = readFileSync(entry, 'utf8');
  // Export existing private parser/helper bindings; never replace grammar or
  // semantic implementations. Refuse an unreviewed package build/seam.
  if (!source.includes('RootContext: _8,') || !source.includes('class x extends Q.Parser') || !source.includes('function NM(e)')) throw new Error('Unsupported pinned ZenUML observation seam');
  source = source.replace(/(\bfrom\s*)(["'])(\.\/[^"']+)\2/g, (_, prefix, quote, name) => `${prefix}${quote}${new URL(name, pathToFileURL(entry)).href}${quote}`);
  source += '\nexport { hc as referenceParser, x as referenceGrammar, NM as referenceMessages, Jl as referenceParticipants, he as referenceExternal };\n';
  const engine = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  const external = value => value === engine.referenceExternal ? '' : value ?? '';
  const call = context => {
    const message = context.message?.(), asynchronous = context.asyncMessage?.(), returned = context.ret?.(), creation = context.creation?.();
    if (message) return ['message', external(message.From?.()), external(message.Owner?.()), message.SignatureText?.()?.trim() ?? '', 'sync'];
    if (asynchronous) return ['message', external(asynchronous.From?.() || asynchronous.ProvidedFrom?.() || asynchronous.Origin?.()), external(asynchronous.Owner?.() || asynchronous.to?.()?.getFormattedText?.()), asynchronous.content?.()?.getText?.()?.trim() ?? '', 'async'];
    if (returned) return ['return', external(returned.From?.()), external(returned.ReturnTo?.()), returned.SignatureText?.()?.trim() ?? ''];
    if (creation) return ['message', external(creation.From?.()), external(creation.Owner?.()), creation.SignatureText?.()?.trim() ?? '', 'create'];
  };
  return {
    version,
    parse(source, observe = false) {
      const code = source.replace(/^\s*zenuml\b/, ''), actions = [];
      const prototype = engine.referenceGrammar.prototype, original = prototype.exitRule;
      const descriptor = Object.getOwnPropertyDescriptor(prototype, 'exitRule');
      if (observe) prototype.exitRule = function (...args) {
        // Snapshot a real completed grammar-rule commit at its call boundary,
        // before exitRule releases its context. No returned-model walk is used
        // as a substitute for these observed commits.
        if (engine.referenceGrammar.ruleNames[this._ctx?.ruleIndex] === 'stat') {
          const value = call(this._ctx);
          if (value) actions.push(['commitStatement', value]);
        }
        return Reflect.apply(original, this, args);
      };
      try {
        engine.referenceParser.ErrorDetails.length = 0;
        const root = engine.referenceParser.RootContext(code);
        const errors = [...engine.referenceParser.ErrorDetails];
        if (!root || errors.length) throw new Error(`ZenUML syntax rejected: ${JSON.stringify(errors)}`);
        const participants = engine.referenceParticipants(root);
        const messages = engine.referenceMessages(root).filter(item => ['sync', 'async', 'return', 'creation'].includes(item.kind)).map(item => ({ from: external(item.from), to: external(item.to), label: item.label, kind: item.kind }));
        return { actions, model: { participants: [...participants.participants].map(([id, value]) => ({ id, label: value.label || id })), messages } };
      } finally {
        if (observe) { if (descriptor) Object.defineProperty(prototype, 'exitRule', descriptor); else delete prototype.exitRule; }
        engine.referenceParser.ErrorDetails.length = 0;
      }
    },
  };
}
