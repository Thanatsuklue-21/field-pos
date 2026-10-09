import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {runInNewContext} from "node:vm";
import ts from "typescript";

const exports={};
runInNewContext(ts.transpileModule(await readFile(new URL("../lib/pwa-update-safety.ts",import.meta.url),"utf8"),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
}).outputText,{exports});
const {getPwaUpdateBlockReason:reason,activateSafePwaUpdate:activate}=exports;
const safe=()=>({cartCount:0,busy:false,syncing:false,readLocal:()=>null,readSession:()=>null});

test("idle state permits update",()=>assert.equal(reason(safe()),""));
for(const key of ["field-pos-pending-promptpay-v1","field-pos-pending-cash-v1","field-pos-split-group-v1","field-pos-edit-cash-v1"]){
  for(const read of ["readLocal","readSession"]){
    test(`${key} in ${read} blocks update even when malformed or empty`,()=>{
      for(const value of ["","{broken","{}"]){assert.notEqual(reason({...safe(),[read]:candidate=>candidate===key?value:null}),"")}
    });
  }
}
for(const read of ["readLocal","readSession"]){
  test(`${read} access failure blocks update`,()=>assert.notEqual(reason({...safe(),[read]:()=>{throw Error("SecurityError")}}),""));
}
for(const [key,value] of [["cartCount",1],["busy",true],["syncing",true]]){
  test(`${key} blocks update`,()=>assert.notEqual(reason({...safe(),[key]:value}),""));
}
test("new transaction during registration lookup prevents activation",async()=>{
  let unsafe=false,sent=false,initiated=false;
  const result=await activate({unsafeReason:()=>unsafe?"busy":"",getRegistration:async()=>{unsafe=true;return {waiting:{postMessage(){sent=true}}}},setInitiated:value=>{initiated=value}});
  assert.equal(result,false);assert.equal(sent,false);assert.equal(initiated,false);
});
test("safe update marks initiated before sending activation",async()=>{
  let initiated=false,sent=0;
  assert.equal(await activate({unsafeReason:()=>"",getRegistration:async()=>({waiting:{postMessage(message){assert.equal(initiated,true);assert.equal(message.type,"SKIP_WAITING");sent++}}}),setInitiated:value=>{initiated=value}}),true);
  assert.equal(sent,1);
});
test("postMessage failure resets initiated state",async()=>{
  let initiated=false;
  assert.equal(await activate({unsafeReason:()=>"",getRegistration:async()=>({waiting:{postMessage(){throw Error("worker unavailable")}}}),setInitiated:value=>{initiated=value}}),false);
  assert.equal(initiated,false);
});
test("already unsafe update never looks up registration",async()=>{
  assert.equal(await activate({unsafeReason:()=>"payment",getRegistration:async()=>assert.fail("lookup"),setInitiated:()=>assert.fail("initiation")}),false);
});
test("missing worker and rejected lookup do not activate or throw",async()=>{
  for(const getRegistration of [async()=>undefined,async()=>({waiting:null}),async()=>{throw Error("lookup failed")}]){
    assert.equal(await activate({unsafeReason:()=>"",getRegistration,setInitiated:()=>assert.fail("initiation")}),false);
  }
});

const runtimeSource=ts.transpileModule(await readFile(new URL("../components/pwa-runtime.tsx",import.meta.url),"utf8"),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX},
}).outputText;
function runtime({storageFails=false,newCartDuringLookup=false,cartAlreadyChanged=false}={}){
  const callbacks=[],exportsRuntime={};let sent=0,items=cartAlreadyChanged?[{qty:1}]:[];
  const cart=()=>0;cart.getState=()=>({items});
  const storage={getItem(){if(storageFails)throw Error("SecurityError");return null}};
  const registration={waiting:{postMessage(){sent++}}};
  runInNewContext(runtimeSource,{
    exports:exportsRuntime,process:{env:{NODE_ENV:"test"}},
    localStorage:storage,sessionStorage:storage,
    window:{matchMedia:()=>({matches:false}),dispatchEvent(){}},
    navigator:{onLine:true,serviceWorker:{async getRegistration(){if(newCartDuringLookup)items=[{qty:1}];return registration}}},
    CustomEvent:class{},
    require(path){
      if(path==="react")return {useCallback:fn=>{callbacks.push(fn);return fn},useEffect(){},useRef:value=>({current:value}),useState:value=>[value,()=>{}]};
      if(path==="react/jsx-runtime"||path==="lucide-react")return {};
      if(path==="@/stores/cart-store")return {useCartStore:cart};
      if(path==="@/lib/offline-db")return {clientStorageStatus:async()=>({})};
      if(path==="@/lib/client-telemetry")return {captureClientTelemetry(){}};
      if(path==="@/lib/recovery-diagnostics")return {readRecoveryDiagnostics:()=>({})};
      if(path==="@/lib/pwa-meta")return {};
      if(path==="@/lib/recovery-storage")return {hasRecovery:()=>false};
      if(path==="@/lib/pwa-update-safety")return exports;
      throw Error("unexpected import: "+path);
    },
  });
  exportsRuntime.default();
  return {requestUpdate:callbacks[4],get sent(){return sent}};
}
for(const options of [{storageFails:true},{newCartDuringLookup:true},{cartAlreadyChanged:true}]){
  test(`runtime blocks activation with ${Object.keys(options)[0]}`,async()=>{
    const app=runtime(options);await app.requestUpdate();assert.equal(app.sent,0);
  });
}
