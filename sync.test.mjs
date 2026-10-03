import assert from 'node:assert/strict';
import {newState,beginSession,pauseSession,finishSession,parseState,reunion,mergeMemories,habits} from './companion.mjs';
import {encrypt,decrypt,makeCode,credentials,cloudState,mergeForSync,createSync} from './sync.mjs';
const now=Date.now();
const a=newState();
assert.equal(reunion(a,now),'first');
beginSession(a,{minutes:1,id:'visit',station:'深夜 Lo-fi',now});
assert.equal(a.active.kind,'visit');pauseSession(a,'closing',now+1200);finishSession(a,'head','',now+1500);
assert.equal(a.records[0].kind,'visit');assert.equal(a.records[0].elapsedMs,1200);assert.equal(reunion(a,now+10000),'return');assert.equal(reunion(a,now+8*86400000),'long');
const b=newState();b.name='另一只';beginSession(b,{minutes:10,id:'session',station:'深夜 Lo-fi',now:now+2000});pauseSession(b,'closing',now+3000);finishSession(b,'nose','',now+4000);
assert.throws(()=>mergeForSync(a,b,''),/HABIT_CONFLICT/);
const merged=mergeForSync(a,b,'','local');assert.equal(merged.records.length,2);assert.equal(merged.name,a.name);
assert.equal(mergeMemories(merged,b,'remote').name,b.name);assert.equal(mergeMemories(merged,b).records.length,2);
assert.throws(()=>mergeMemories(a,{...a,records:[{...a.records[0],intent:'conflicting'}]}),/不同版本/);
assert.throws(()=>parseState(JSON.stringify({...a,records:[{...a.records[0],kind:'unknown'}]})));
const code=makeCode();assert.equal(code.length,64);const cipher=await encrypt(a,code);assert(!cipher.includes(a.name));assert.deepEqual(await decrypt(cipher,code),a);
await assert.rejects(decrypt(cipher,makeCode()),/无法解密/);
await assert.rejects(decrypt(cipher.slice(0,-8)+'AAAA',code),/无法解密/);
assert.notEqual((await credentials(code)).id,(await credentials(code)).token);
beginSession(a,{minutes:25,id:'active',station:'深夜 Lo-fi'});assert.equal(cloudState(a).active,null);
const map=new Map(),storage={getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)};
let server=null,local=a,notice='',writes=0;
const fetcher=async(_url,options)=>{
 const body=options.body && JSON.parse(options.body);
 if(options.method==='GET')return Response.json(server || {error:'missing'},{status:server?200:404});
 if(options.method==='PUT'){
  if(body.revision!==(server?.revision || 0)) return Response.json({error:'conflict'},{status:409});
  writes++;server={cipher:body.cipher,revision:(server?.revision||0)+1};return Response.json({revision:server.revision});
 }
 server=null;return Response.json({deleted:true});
};
const sync=createSync({read:()=>local,apply:v=>local=v,status:s=>notice=s,conflict:()=>{},storage,fetcher});
await sync.create();assert.equal(sync.enabled,true);assert.equal(writes,1);
await sync.run();assert.equal(local.active.id,'active','local active session is preserved');assert.equal(writes,1,'unchanged cloud data is not reuploaded');
local.name='新名字';await sync.run();assert.equal((await decrypt(server.cipher,sync.code)).name,'新名字');assert.equal(writes,2);
await sync.remove();assert.equal(server,null);assert.equal(sync.enabled,false);assert.equal(local.records.length,1);
console.log('PASS: short visits, reunion, encrypted round trip/tamper, record merge/conflicts, local timer and cloud deletion');

// Run against Wrangler or the published API when a target is explicitly provided.
if(process.env.TEST_SYNC_ORIGIN) {
  const origin=process.env.TEST_SYNC_ORIGIN, testCode=makeCode(),{id,token}=await credentials(testCode),url=origin+'/api/sync/'+id;
  const headers={Authorization:'Bearer '+token,'Content-Type':'application/json'};
  const put=revision=>fetch(url,{method:'PUT',headers,body:JSON.stringify({revision,cipher})});
  assert.equal((await fetch(url)).status,401);
  assert.equal((await fetch(url,{headers:{...headers,Origin:'https://untrusted.example'}})).status,403);
  assert.equal((await put(0)).status,200);
  assert.equal((await fetch(url,{headers:{Authorization:'Bearer '+'f'.repeat(64)}})).status,401);
  const race=await Promise.all([put(1),put(1)]);assert.deepEqual(race.map(r=>r.status).sort(),[200,409],'only one concurrent revision wins');
  const saved=await fetch(url,{headers}).then(r=>r.json());assert.equal(saved.revision,2);assert.equal(saved.cipher,cipher);
  assert.equal((await fetch(url,{method:'PUT',headers,body:JSON.stringify({revision:2,cipher:'plaintext'})})).status,400);
  assert.equal((await fetch(url,{method:'DELETE',headers})).status,200);
  assert.equal((await fetch(url,{headers})).status,404);
  console.log('PASS: live API auth, origin, atomic concurrent writes, malformed payload and deletion');
}
const offlineStore=new Map(), unavailable=createSync({read:()=>newState(),apply:()=>{},status:s=>notice=s,conflict:()=>{},storage:{getItem:k=>offlineStore.get(k)||null,setItem:(k,v)=>offlineStore.set(k,v),removeItem:k=>offlineStore.delete(k)},fetcher:async()=>new Response('temporarily unavailable',{status:503})});
await unavailable.create();assert.match(notice,/本机经历仍保留/);assert.equal(unavailable.enabled,true,'retry credentials survive an interrupted creation');
console.log('PASS: non-JSON service failure keeps local memories and retry credentials');
