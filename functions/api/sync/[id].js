const json = (data, status=200) => Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const hash = async text => [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))].map(n=>n.toString(16).padStart(2,'0')).join('');
export async function onRequest({request,env,params}) {
  const id=params.id, bearer=request.headers.get('Authorization') || '';
  if (!/^[a-f0-9]{64}$/.test(id) || !/^Bearer [a-f0-9]{64}$/.test(bearer)) return json({error:'同步码无效。'},401);
  const origin=request.headers.get('Origin');
  if(origin && origin!==new URL(request.url).origin) return json({error:'请求来源不允许。'},403);
  if(!['GET','PUT','DELETE'].includes(request.method)) return json({error:'请求方式不支持。'},405);
  if(!env.DB) return json({error:'同步服务尚未配置。'},503);
  try {
    const now=Date.now(), ip=request.headers.get('CF-Connecting-IP') || 'local';
    const limitId=await hash(`${ip}:${Math.floor(now/60000)}`);
    const allowed=await env.DB.prepare('INSERT INTO request_limits(id,count,expires) VALUES (?,1,?) ON CONFLICT(id) DO UPDATE SET count=count+1 WHERE count<60 RETURNING count').bind(limitId,now+120000).first();
    if(!allowed) return json({error:'请求较频繁，请稍后再试。'},429);
    await env.DB.prepare('DELETE FROM request_limits WHERE expires<?').bind(now).run();
    const authHash=await hash(bearer.slice(7));
    const row=await env.DB.prepare('SELECT * FROM memories WHERE id=?').bind(id).first();
    if(row && row.auth_hash!==authHash) return json({error:'同步码无效。'},401);
    if(request.method==='GET') return row ? json({revision:row.revision,cipher:row.cipher,updatedAt:row.updated_at}) : json({error:'未找到同步存档，请检查同步码。'},404);
    if(request.method==='DELETE') {
      if(!row) return json({error:'未找到同步存档。'},404);
      await env.DB.prepare('DELETE FROM memories WHERE id=? AND auth_hash=?').bind(id,authHash).run();
      return json({deleted:true});
    }
    if(!request.headers.get('Content-Type')?.startsWith('application/json')) return json({error:'存档格式无效。'},415);
    // ponytail: one encrypted snapshot is capped at 1 MB; segment history if real saves approach the ceiling.
    if(Number(request.headers.get('Content-Length'))>1050000) return json({error:'同步存档超过 1 MB，请先下载备份。'},413);
    const reader=request.body?.getReader();
    if(!reader) return json({error:'存档为空。'},400);
    const chunks=[]; let size=0;
    while(true) { const {done,value}=await reader.read(); if(done) break; size+=value.byteLength; if(size>1050000) {await reader.cancel();return json({error:'同步存档超过 1 MB，请先下载备份。'},413);} chunks.push(value); }
    const bytes=new Uint8Array(size); let offset=0; for(const chunk of chunks) {bytes.set(chunk,offset);offset+=chunk.length;}
    let body; try { body=JSON.parse(new TextDecoder().decode(bytes)); } catch {return json({error:'存档格式无效。'},400);}
    if(!Number.isSafeInteger(body.revision) || body.revision<0 || typeof body.cipher!=='string' || !/^[A-Za-z0-9+/=]+$/.test(body.cipher) || body.cipher.length<40 || body.cipher.length>1048576) return json({error:'存档格式无效。'},400);
    if(!row) {
      if(body.revision!==0) return json({error:'云端存档已移除。'},409);
      const daily=await hash(`create:${ip}:${Math.floor(now/86400000)}`);
      const creation=await env.DB.prepare('INSERT INTO request_limits(id,count,expires) VALUES (?,1,?) ON CONFLICT(id) DO UPDATE SET count=count+1 WHERE count<5 RETURNING count').bind(daily,now+86400000).first();
      if(!creation) return json({error:'今天创建同步存档较多，请明天再试。'},429);
      const result=await env.DB.prepare('INSERT OR IGNORE INTO memories VALUES (?,?,1,?,?)').bind(id,authHash,body.cipher,now).run();
      return result.meta.changes ? json({revision:1,updatedAt:now}) : json({error:'另一台设备刚更新了存档，请重新同步。'},409);
    }
    const result=await env.DB.prepare('UPDATE memories SET cipher=?,revision=revision+1,updated_at=? WHERE id=? AND auth_hash=? AND revision=?').bind(body.cipher,now,id,authHash,body.revision).run();
    return result.meta.changes ? json({revision:body.revision+1,updatedAt:now}) : json({error:'另一台设备刚更新了存档，请重新同步。'},409);
  } catch { return json({error:'同步暂时不可用，本机经历仍保留。'},503); }
}
