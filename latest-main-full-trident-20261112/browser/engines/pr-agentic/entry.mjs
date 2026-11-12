import * as api from './browser-lazy/index.js';
import {declaredRenderer} from './declared-adapter.mjs';
const observed={async renderMermaidSVGWithReceiptAsync(source,options){let product;try{product=await api.renderMermaidSVGWithReceiptAsync(source,options)}catch(error){await globalThis.__tridentStoreProduct({status:'error',source,error:{name:error?.name,code:error?.code,message:String(error)}});throw error}try{const productJSON=JSON.stringify(product);await globalThis.__tridentStoreProduct({status:'returned',source,productJSON})}catch(error){await globalThis.__tridentStoreProduct({status:'receipt-observer-error',source,error:String(error)})}return product}};
export async function createRenderer(){return declaredRenderer(observed,{"export":"renderMermaidSVGWithReceiptAsync","options":{"graphLayout":{"backend":"agentic","fallback":"none"}}},'svg')}
globalThis.unifiedMermaid={createRenderer};
