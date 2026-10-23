// Filesystem-only fixtures, NO actual product/package import.
import assert from'node:assert/strict';
import{mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,symlinkSync}from'node:fs';
import{spawnSync}from'node:child_process';import{tmpdir}from'node:os';import{join}from'node:path';import{createHash}from'node:crypto';import{createRequire}from'node:module';
import{resolveRuntimeClosure}from'./resolve-runtime-closure.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex'),cases=[];
function test(name,fn){fn();cases.push({name,passed:true})}
function fixture(fn){const project=mkdtempSync(join(tmpdir(),'pr449-consumer-fixture-'));
 try{
  const put=(p,s)=>{mkdirSync(join(p,'..'),{recursive:true});writeFileSync(p,s)};
  const pkg=(p,name,version,extra={})=>{const json=JSON.stringify({name,version,main:'entry.js',...extra});put(join(p,'package.json'),json);put(join(p,'entry.js'),"throw Error('PACKAGE_CODE_MUST_NOT_EXECUTE');\n");return sha(Buffer.from(json))};
  const projectMeta=JSON.stringify({name:'fixture-project',version:'1.0.0'});put(join(project,'package.json'),projectMeta);put(join(project,'bun.lock'),'fixture-lock');
  const parent=join(project,'node_modules/parent'),nested=join(parent,'node_modules/dep'),other=join(project,'node_modules/dep');
  const parentSHA=pkg(parent,'parent','1.0.0'),nestedSHA=pkg(nested,'dep','1.0.0',{exports:{'.':'./entry.js'}});pkg(other,'dep','3.0.0');
  const spec={protocol:'consumer-root-runtime-dependency-location@2',projectPackageJSONSHA256:sha(Buffer.from(projectMeta)),lockSHA256:sha(Buffer.from('fixture-lock')),
   packages:{parent:{name:'parent',version:'1.0.0',packageJSONSHA256:parentSHA},dep:{name:'dep',version:'1.0.0',packageJSONSHA256:nestedSHA}},
   roots:[{consumer:'$project',specifier:'parent',target:'parent',lockKey:'parent'}],edges:[{consumer:'parent',specifier:'dep',target:'dep',lockKey:'parent/dep'}],
   lockedRecords:{parent:['parent@1.0.0'], 'parent/dep':['dep@1.0.0']}};
  fn({project,parent,nested,other,spec,pkg,put});
 }finally{rmSync(project,{recursive:true,force:true})}}
test('Conflicting root3 and nested1 select actual consumer1 without executing throw-only modules',()=>fixture(({project,nested,spec})=>{const r=resolveRuntimeClosure(project,spec);assert.equal(r.packages.dep,nested);assert.equal(r.edges.length,2);assert.equal(r.noPackageCodeImported,true)}));
test('Private package.json export does not block entry-to-root discovery',()=>fixture(({project,parent,spec})=>{assert.throws(()=>createRequire(join(parent,'package.json')).resolve('dep/package.json'),{code:'ERR_PACKAGE_PATH_NOT_EXPORTED'});assert.equal(resolveRuntimeClosure(project,spec).edges[1].packageVersion,'1.0.0')}));
test('Missing nested version does not select conflicting root3',()=>fixture(({project,nested,spec})=>{rmSync(nested,{recursive:true});assert.throws(()=>resolveRuntimeClosure(project,spec),/identity mismatch/)}));
test('Matching version in unrelated tree is not globally selected',()=>fixture(({project,nested,spec,pkg})=>{rmSync(nested,{recursive:true});pkg(join(project,'unrelated/node_modules/dep'),'dep','1.0.0',{exports:{'.':'./entry.js'}});assert.throws(()=>resolveRuntimeClosure(project,spec),/identity mismatch/)}));
test('Exact package JSON bytes required, not only name/version',()=>fixture(({project,nested,spec,put})=>{put(join(nested,'package.json'),JSON.stringify({name:'dep',version:'1.0.0',main:'entry.js',extra:true}));assert.throws(()=>resolveRuntimeClosure(project,spec),/identity mismatch/)}));
test('Wrong fixed lock fails before resolution',()=>fixture(({project,spec,put})=>{put(join(project,'bun.lock'),'different');assert.throws(()=>resolveRuntimeClosure(project,spec),/package\/lock mismatch/)}));
test('Unknown target and unreachable graph rejected',()=>fixture(({project,spec})=>{spec.edges[0].target='missing';assert.throws(()=>resolveRuntimeClosure(project,spec),/Unknown consumer\/target/)}));
test('Lock identity mismatch rejected',()=>fixture(({project,spec})=>{spec.lockedRecords['parent/dep']=['dep@3.0.0'];assert.throws(()=>resolveRuntimeClosure(project,spec),/consumer-lock identity mismatch/)}));
test('Native binary filename resolves without loading invalid binary',()=>fixture(({project,nested,spec,put})=>{const raw=JSON.stringify({name:'dep',version:'1.0.0',main:'binary.node'});put(join(nested,'package.json'),raw);put(join(nested,'binary.node'),'NOT_A_NATIVE_LIBRARY');spec.packages.dep.packageJSONSHA256=sha(Buffer.from(raw));assert.equal(resolveRuntimeClosure(project,spec).edges[1].resolvedEntry,join(nested,'binary.node'))}));
test('Escaping dependency links rejected',()=>fixture(({project,nested,spec,pkg})=>{const outside=mkdtempSync(join(tmpdir(),'pr449-outside-fixture-'));try{pkg(outside,'dep','1.0.0',{exports:{'.':'./entry.js'}});rmSync(nested,{recursive:true});symlinkSync(outside,nested);assert.throws(()=>resolveRuntimeClosure(project,spec),/escapes/)}finally{rmSync(outside,{recursive:true,force:true})}}));
test('CLI preserves actual failed version/path observations without importing package code',()=>fixture(({project,nested,spec,put})=>{rmSync(nested,{recursive:true});const specPath=join(project,'spec.json'),out=join(project,'result.json');put(specPath,JSON.stringify(spec));const child=spawnSync(process.execPath,[new URL('./resolve-runtime-closure.mjs',import.meta.url).pathname,project,specPath,out],{encoding:'utf8'});assert.equal(child.status,1);const report=JSON.parse(readFileSync(out));assert.equal(report.qualified,false);assert.equal(report.actualPackageObservations.at(-1).actualVersion,'3.0.0');assert.equal(report.noPackageCodeImported,true)}));
console.log(JSON.stringify({protocol:'filesystem-only-consumer-resolution-fixtures@2',passed:cases.length,rendererImported:false,packageCodeImported:false,cases},null,2));
