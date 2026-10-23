// Tagged acyclic plain-data value fingerprint. V8 encoding is NOT canonical.
import {createHash} from 'node:crypto';
import {isProxy} from 'node:util/types';
export const PROTOCOL='tagged-own-data-structure-SHA256@1';
export function structuralDigest(value,{maxNodes=2000000,maxDepth=256,maxCanonicalBytes=67108864}={}){
 const h=createHash('sha256'),active=new WeakSet();let nodes=0,bytes=0;
 const stats={objects:0,arrays:0,undefined:0,negativeZero:0,nan:0,infinities:0,arrayHoles:0};
 function emit(text){bytes+=Buffer.byteLength(text);if(bytes>maxCanonicalBytes)throw Error('Canonical byte budget exceeded');h.update(text)}
 const q=value=>JSON.stringify(value);
 function walk(v,depth){
  if(++nodes>maxNodes||depth>maxDepth)throw Error('Structural node/depth budget exceeded');
  if(v===null){emit('["null"]');return}
  switch(typeof v){
   case'undefined':stats.undefined++;emit('["undefined"]');return;
   case'boolean':emit('["boolean",'+q(v)+']');return;
   case'string':emit('["string",'+q(v)+']');return;
   case'number':{
    let n;if(Object.is(v,-0)){stats.negativeZero++;n='-0'}else if(Number.isNaN(v)){stats.nan++;n='NaN'}else if(v===Infinity||v===-Infinity){stats.infinities++;n=v===Infinity?'+Infinity':'-Infinity'}else n=String(v);
    emit('["number",'+q(n)+']');return;
   }
   case'bigint':emit('["bigint",'+q(v.toString())+']');return;
   case'object':break;
   default:throw Error('Unsupported structural value type: '+typeof v);
  }
  if(isProxy(v))throw Error('Proxy unsupported');
  if(active.has(v))throw Error('Cycle unsupported');
  const array=Array.isArray(v),proto=Object.getPrototypeOf(v);
  if(array?proto!==Array.prototype:proto!==Object.prototype&&proto!==null)throw Error('Unsupported object prototype');
  const keys=Reflect.ownKeys(v);
  if(keys.some(k=>typeof k!=='string'))throw Error('Symbol own key unsupported');
  if(array){stats.arrays++;stats.arrayHoles+=v.length-keys.filter(k=>/^(0|[1-9]\d*)$/.test(k)&&Number(k)<v.length&&String(Number(k))===k).length}
  else stats.objects++;
  active.add(v);
  try{
   emit('['+q(array?'array':'object')+','+q(array?'Array.prototype':proto===null?'null':'Object.prototype')+',[');
   let first=true;for(const key of keys){
    const d=Object.getOwnPropertyDescriptor(v,key);
    if(!d||!Object.hasOwn(d,'value')||Object.hasOwn(d,'get')||Object.hasOwn(d,'set'))throw Error('Accessor/unsupported descriptor');
    if(!first)emit(',');first=false;
    emit('['+q(key)+',['+[d.enumerable,d.writable,d.configurable].map(x=>x?'true':'false').join(',')+'],');
    walk(d.value,depth+1);emit(']');
   }
   emit(']]');
  }finally{active.delete(v)}
 }
 walk(value,0);
 return{protocol:PROTOCOL,sha256:h.digest('hex'),canonicalBytes:bytes,nodes,statistics:stats,
        scope:'Acyclic plain arrays/objects/null prototypes and primitives, retained own-key order/data descriptor state. Repeated acyclic references compare by value; live identity/aliasing and pre-V8 descriptors are not claimed.'};
}
