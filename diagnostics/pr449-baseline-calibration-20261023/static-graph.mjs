// Lexical module-edge catalogue ONLY: no application import or execution.
import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {join,relative} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const[root,out]=process.argv.slice(2);
const{parse}=await import(pathToFileURL(join(root,'node_modules/acorn/dist/acorn.mjs')).href);
const hash=b=>createHash('sha256').update(b).digest('hex');
const records=[];
function walk(dir){for(const e of readdirSync(dir,{withFileTypes:true})){const p=join(dir,e.name);if(e.isDirectory())walk(p);else if(e.isFile()&&e.name.endsWith('.js')){
 const bytes=readFileSync(p),text=bytes.toString('utf8'),edges=[],computed=[];
 const ast=parse(text,{ecmaVersion:'latest',sourceType:'module',locations:true});
 const pending=[ast];while(pending.length){const n=pending.pop();let expression,kind;
  if(n.type==='ImportDeclaration'||n.type==='ExportNamedDeclaration'||n.type==='ExportAllDeclaration'){if(n.source){expression=n.source;kind=n.type}}
  else if(n.type==='ImportExpression'){expression=n.source;kind='ImportExpression'}
  else if(n.type==='CallExpression'&&n.callee.type==='Identifier'&&/^(require|__require\d*)$/.test(n.callee.name)){expression=n.arguments[0];kind=n.callee.name}
  if(kind){const row={kind,line:n.loc.start.line,column:n.loc.start.column};if(expression?.type==='Literal'&&typeof expression.value==='string')edges.push({...row,specifier:expression.value});else computed.push({...row,expressionType:expression?.type??null,expressionSHA256:hash(text.slice(expression?.start??n.start,expression?.end??n.end))})}
  for(const v of Object.values(n)){if(Array.isArray(v)){for(const x of v)if(x?.type)pending.push(x)}else if(v?.type)pending.push(v)}
 }
 records.push({path:relative(root,p),sha256:hash(bytes),literalEdges:edges,computedEdges:computed});
}}}
walk(join(root,'dist'));records.sort((a,b)=>a.path.localeCompare(b.path));
writeFileSync(out,JSON.stringify({protocol:'source-only-lexical-distribution-module-edges@1',rendererImported:false,
 scope:'All emitted distribution JS: import/export source literals, import expressions and require/__require identifier calls. Lexical catalogue, not actual resolution or all possible execution.',
 files:records,localActualLoaderGraph:'UNAVAILABLE_NOT_CAPTURED',noJSNormalization:true},null,2)+'\n',{flag:'wx'});
