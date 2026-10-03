import { parseState, mergeMemories, habits } from './companion.mjs';
const encoder=new TextEncoder();
const hex = bytes => [...bytes].map(n=>n.toString(16).padStart(2,'0')).join('');
export const makeCode = () => hex(crypto.getRandomValues(new Uint8Array(32)));
export const normalizeCode = code => code.toLowerCase().replace(/[\s-]/g,'');
export function validateCode(code) { if(!/^[a-f0-9]{64}$/.test(code)) throw new Error('请输入完整的 64 位私密同步码。'); }
const digest = async value => hex(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(value))));
export async function credentials(code) { validateCode(code); return {id:await digest('foxkin:id:'+code),token:await digest('foxkin:auth:'+code)}; }
async function key(code) { validateCode(code); return crypto.subtle.importKey('raw',Uint8Array.from(code.match(/../g),n=>parseInt(n,16)),'AES-GCM',false,['encrypt','decrypt']); }
export async function encrypt(state,code) {
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const data=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},await key(code),encoder.encode(JSON.stringify(state))));
  const packed=new Uint8Array(iv.length+data.length);packed.set(iv);packed.set(data,12);
  let binary='';for(const byte of packed) binary+=String.fromCharCode(byte);
  return btoa(binary);
}
export async function decrypt(cipher,code) {
  try {
    const packed=Uint8Array.from(atob(cipher),ch=>ch.charCodeAt(0));
    const data=await crypto.subtle.decrypt({name:'AES-GCM',iv:packed.slice(0,12)},await key(code),packed.slice(12));
    return parseState(new TextDecoder().decode(data));
  } catch { throw new Error('云端存档无法解密，请确认同步码；本机经历未被覆盖。'); }
}
export const cloudState = state => ({...state,active:null,quiet:false,volume:0.65});
export function mergeForSync(local,remote,base,choice) {
  const l=habits(local), r=habits(remote);
  if(l!==r && (!base || (l!==base && r!==base)) && !choice) throw new Error('HABIT_CONFLICT');
  return mergeMemories(local,remote,choice || (base && l!==base ? 'local' : 'remote'));
}
export function createSync({read,apply,status,conflict,storage=localStorage,fetcher=fetch}) {
  const configKey='foxkin.sync.v1';
  let config=null,busy=false,timer,deleted=false,again=false;
  try {config=JSON.parse(storage.getItem(configKey)); if(config) {validateCode(config.code); if(typeof config.base!=='string') config.base='';}} catch {config=null;}
  function persist() {storage.setItem(configKey,JSON.stringify(config));}
  async function request(method,body,configOverride=config) {
    const {id,token}=await credentials(configOverride.code);
    const response=await fetcher('/api/sync/'+id,{method,headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,cache:'no-store',signal:AbortSignal.timeout(15000)});
    let data;
    try {data=await response.json();} catch {throw new Error('同步服务暂时没有响应，请稍后再试；本机经历仍保留。');}
    if(!response.ok) { const error=new Error(data.error || '同步暂时不可用。'); error.status=response.status; throw error; }
    return data;
  }
  async function run(choice) {
    if(!config || deleted) return;
    if(busy) {again=true;return;}
    busy=true;status('正在同步…');
    try {
      let remote;
      try {remote=await request('GET');} catch(error) {
        if(error.status!==404 || !config.creating) throw error;
        const result=await request('PUT',{revision:0,cipher:await encrypt(cloudState(read()),config.code)});
        config.creating=false;config.revision=result.revision;config.base=habits(read());persist();status('自动备份已开启，请保管私密同步码。');return;
      }
      const decoded=await decrypt(remote.cipher,config.code);
      const before=parseState(JSON.stringify(read())); let merged;
      try { merged=mergeForSync(before,decoded,config.base,choice); }
      catch(error) {if(error.message==='HABIT_CONFLICT') {conflict(decoded.name);status('两端的名字或习惯不同，请选择保留哪一端；经历会合并。');return;}throw error;}
      const payload=cloudState(merged);
      let revision=remote.revision;
      // Never upload active timers or device volume; unchanged snapshots need no write.
      if(JSON.stringify(payload)!==JSON.stringify(cloudState(decoded))) {
        const result=await request('PUT',{revision,cipher:await encrypt(payload,config.code)}); revision=result.revision;
      }
      // Edits made during a network request remain local and are included on the next pass.
      const current=read();
      const safe=mergeMemories(current,merged,habits(current)===habits(before)?'remote':'local');
      apply(safe);config.creating=false;config.revision=revision;config.base=habits(merged);persist();
      status('已同步 · '+new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}));
      if(habits(current)!==habits(before) || current.records.length!==before.records.length) changed();
    } catch(error) {
      status(error.status===409 ? '另一台设备正在更新，将自动重试；本机经历仍保留。' : navigator.onLine===false ? '离线中，本机已保存；联网后自动同步。' : error.message);
      if(error.status===409) timer=setTimeout(()=>run(),1500);
    } finally {busy=false;if(again){again=false;changed();}}
  }
  function changed() {if(!config || deleted)return;clearTimeout(timer);timer=setTimeout(()=>run(),1200);}
  return {
    get enabled(){return !!config;},get code(){return config?.code || '';},
    run,changed,
    async create(){
      if(config || busy) return;
      busy=true;deleted=false;
      const next={code:makeCode(),base:habits(read()),revision:0,creating:true};
      // Persist credentials before upload, so even a reload during creation cannot orphan a backup.
      config=next;try {persist();const result=await request('PUT',{revision:0,cipher:await encrypt(cloudState(read()),next.code)});config.creating=false;config.revision=result.revision;persist();status('自动备份已开启，请保管私密同步码。');}
      catch(error) {status(error.message+' 同步码已保留，可稍后重试。');}finally{busy=false;if(again){again=false;changed();}}
    },
    async join(code){validateCode(code);if(busy)throw new Error('请等当前同步完成。');const next={code,base:'',revision:0};const remote=await request('GET',null,next);await decrypt(remote.cipher,code);deleted=false;config=next;persist();await run();},
    disconnect(){if(busy)throw new Error('请等当前同步完成。');clearTimeout(timer);config=null;storage.removeItem(configKey);status('已断开。本机经历和云端备份仍保留。');},
    async remove(){if(!config)return;if(busy)throw new Error('请等当前同步完成，再删除云端备份。');busy=true;try{await request('DELETE');deleted=true;clearTimeout(timer);config=null;storage.removeItem(configKey);status('云端备份已删除。本机经历仍保留。');}finally{busy=false;}}
  };
}
