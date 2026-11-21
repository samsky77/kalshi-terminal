const crypto=require('crypto');
const B='http://localhost:3200';
const SS='qa-session-secret-qa-session-secret-000000', WS='qa_webhook_secret_for_local_tests';
const b64u=b=>Buffer.from(b).toString('base64url');
exports.cookie=(uid,email)=>{const body=b64u(JSON.stringify({uid,email:email||uid+'@x.test',exp:Date.now()+864e5}));return 'sl_session='+body+'.'+crypto.createHmac('sha256',SS).update(body).digest('base64url');};
let n=0;
exports.hook=async(type,data,{id,ts}={})=>{const body=JSON.stringify({type,data});id=id||'msg_'+Date.now()+'_'+(n++)+Math.random().toString(36).slice(2,6);ts=ts||Math.floor(Date.now()/1000);
 const sig=crypto.createHmac('sha256',WS).update(`${id}.${ts}.${body}`).digest('base64');
 const r=await fetch(B+'/api/webhooks/whop',{method:'POST',headers:{'content-type':'application/json','webhook-id':id,'webhook-timestamp':String(ts),'webhook-signature':'v1,'+sig},body});return r.status+' '+await r.text();};
exports.probe=async(uid,gid)=>{const c=exports.cookie(uid);const o={};
 for(const p of ['/slate','/edges','/game/'+gid,'/api/slate?sport=nba','/results','/account']){const r=await fetch(B+p,{headers:{cookie:c},redirect:'manual'});o[p]=r.status+(r.headers.get('location')?'->'+r.headers.get('location'):'');}
 return o;};
exports.page=async(uid,p)=>{const r=await fetch(B+p,{headers:{cookie:exports.cookie(uid)},redirect:'follow'});return (await r.text()).replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g,'').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ');};
exports.iso=d=>new Date(Date.now()+d*864e5).toISOString();
