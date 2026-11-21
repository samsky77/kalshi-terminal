const h=require('./h');
const GID='nfl-777c6a605bdb4779';
const clk={};const tick=u=>{clk[u]=(clk[u]||Date.now())+1000;return new Date(clk[u]).toISOString();};
const P='prod_qa';
const E=(u,type,mem,x={},prod=P)=>h.hook(type,{...(mem?{id:mem}:{}),user:{id:u,email:u+'@x.test'},...(prod?{product:{id:prod}}:{}),updated_at:tick(u),...x}).then(r=>r.replace(/^200 /,''));
const A=async u=>{const o=await h.probe(u,GID);return ['/slate','/edges','/game/'+GID,'/api/slate?sport=nba'].map(p=>o[p].slice(0,3)).join('/')+' results:'+o['/results'].slice(0,3)};
const acct=async u=>{const t=await h.page(u,'/account');const m=t.match(/Status.{0,100}/);return m?m[0].replace(/Email.*/,''):'(no account)'};
const land=async u=>{const t=await h.page(u,'/slate');return (t.match(/(You've|You&#x27;ve|You're|You&#x27;re)[^.]*\./)||['?'])[0].slice(0,110)};
const L=(...a)=>console.log(...a);
(async()=>{
const I=d=>h.iso(d);
// 001
let u='qa_tri_v_1';
await E(u,'membership.activated','mem_a',{status:'trialing',renewal_period_end:I(7)});
await E(u,'membership.deactivated','mem_a',{status:'expired'});
L('001 B first',await E(u,'membership.activated','mem_b',{status:'trialing',renewal_period_end:I(7)}),await A(u));
L('001 B updated',await E(u,'membership.updated','mem_b',{status:'trialing',renewal_period_end:I(7)}),await A(u));
L('001 B went_valid',await E(u,'membership.went_valid','mem_b',{status:'trialing',renewal_period_end:I(7)}),await A(u));
// 002
u='qa_tri_v_2';
await E(u,'membership.activated','mem_a',{status:'trialing',renewal_period_end:I(7)});
await E(u,'membership.deactivated','mem_a',{status:'expired'});
L('002 no id',await E(u,'membership.activated',null,{status:'trialing',renewal_period_end:I(7)}),await A(u));
// 003
u='qa_tri_v_3a';await E(u,'membership.deactivated','m3',{status:'expired'});
L('003 failed after exp',await E(u,'payment.failed','m3'),await A(u));
u='qa_tri_v_3b';await E(u,'membership.activated','ma',{status:'trialing',renewal_period_end:I(7)});await E(u,'membership.deactivated','ma',{status:'expired'});await E(u,'membership.activated','mb',{status:'trialing',renewal_period_end:I(7)});
L('003 failed after trial_used',await E(u,'payment.failed','mb'),await A(u));
u='qa_tri_v_3c';
const old=new Date(Date.now()-3600e3).toISOString();
await E(u,'membership.deactivated','m3c',{status:'expired'});
L('003 late activated (older updated_at)',await E(u,'membership.activated','m3c',{status:'trialing',renewal_period_end:I(5),updated_at:old}),await A(u));
L('003 late activated (newer updated_at, future end) ',await E(u,'membership.activated','m3c',{status:'active',renewal_period_end:I(30)}),await A(u));
u='qa_tri_v_3d';await E(u,'membership.deactivated','m3d',{status:'expired'});
L('003 payment.succeeded no status after exp',await E(u,'payment.succeeded','m3d'),await A(u));
L('003 stale activated past end (newer ts)',await E('qa_tri_v_3e','membership.activated','m3e',{status:'trialing',renewal_period_end:I(-5)}),await A('qa_tri_v_3e'));
// no updated_at fallback: signed timestamp. deactivated then activated sent without updated_at
u='qa_tri_v_3f';
L('003 no updated_at: act',await h.hook('membership.activated',{id:'m3f',user:{id:u},product:{id:P},status:'active',renewal_period_end:I(30)}));
L('003 no updated_at: deact',await h.hook('membership.deactivated',{id:'m3f',user:{id:u},product:{id:P},status:'expired'},{ts:Math.floor(Date.now()/1000)+2}),await A(u));
L('003 no updated_at: replay-late activated',await h.hook('membership.activated',{id:'m3f',user:{id:u},product:{id:P},status:'active',renewal_period_end:I(30)},{ts:Math.floor(Date.now()/1000)-100}),await A(u));
// 004
L('004 trialing past end',await E('qa_tri_v_4','membership.activated','m4',{status:'trialing',renewal_period_end:I(-5)}),await A('qa_tri_v_4'));
L('004 trialing ended 6h ago (grace)',await E('qa_tri_v_4b','membership.activated','m4b',{status:'trialing',renewal_period_end:I(-0.25)}),await A('qa_tri_v_4b'));
L('004 active no end',await E('qa_tri_v_4c','membership.activated','m4c',{status:'active'}),await A('qa_tri_v_4c'));
// 005
for(const s of ['paused','drafted']){const u='qa_tri_v_5'+s;L('005',s,await E(u,'membership.activated','m5'+s,{status:s,renewal_period_end:I(30)}),await A(u));}
// 006
u='qa_tri_v_6';await E(u,'membership.activated','m6',{status:'trialing',renewal_period_end:I(1)});
L('006 updated no status',await E(u,'membership.updated','m6',{cancel_at_period_end:true}),await acct(u),await A(u));
u='qa_tri_v_6b';await E(u,'membership.activated','m6b',{status:'trialing',renewal_period_end:I(1)});
L('006 cancel_at_period_end_changed',await E(u,'membership.cancel_at_period_end_changed','m6b',{cancel_at_period_end:true}),await acct(u));
L('006 then deactivated',await E(u,'membership.deactivated','m6b',{status:'expired'}),await A(u));
// 007/008
u='qa_tri_v_7';await E(u,'membership.activated','ma',{status:'trialing',renewal_period_end:I(7)});await E(u,'membership.deactivated','ma',{status:'expired'});await E(u,'membership.activated','mb',{status:'trialing',renewal_period_end:I(7)});
L('007 landing',await land(u),'| account:',await acct(u));
const r=await fetch('http://localhost:3200/slate',{headers:{cookie:h.cookie(u)},redirect:'manual'});L('007 redirect',r.headers.get('location'));
u='qa_tri_v_8';await E(u,'membership.activated','m8',{status:'trialing',renewal_period_end:I(1)});await E(u,'membership.deactivated','m8',{status:'expired'});
const r8=await fetch('http://localhost:3200/slate',{headers:{cookie:h.cookie(u)},redirect:'manual'});L('008 redirect',r8.headers.get('location'),'|',await land(u),'| account:',await acct(u));
u='qa_tri_v_8b';await E(u,'membership.activated','m8b',{status:'active',renewal_period_end:I(5)});await E(u,'payment.failed','m8b');await E(u,'membership.deactivated','m8b',{status:'expired'});L('008 pastdue->expired landing',await land(u));
// 009
for(const [n,v] of [['sec',Math.floor(Date.now()/1000)+30*86400],['ms',Date.now()+30*864e5],['numstr',String(Math.floor(Date.now()/1000)+30*86400)],['garbage','soon'],['dateOnly',I(30).slice(0,10)]]){
 const u='qa_tri_v_9'+n;await E(u,'membership.activated','m9'+n,{status:'active',renewal_period_end:I(1)});
 L('009',n,await E(u,'membership.canceled','m9'+n,{status:'canceled',renewal_period_end:v}),await A(u),await acct(u));}
// 010
L('010 no product',await E('qa_tri_v_10','membership.activated','m10',{status:'active',renewal_period_end:I(30)},null),await A('qa_tri_v_10'));
// 011
u='qa_tri_v_11';await E(u,'membership.activated','ma',{status:'trialing',renewal_period_end:I(7)});
L('011',await E(u,'membership.activated','mb',{status:'trialing',renewal_period_end:I(7)}),await A(u),await acct(u));
// 013
L('013 order of insert (code): insert after apply');
// 014 dates
u='qa_tri_v_14';await E(u,'membership.canceled','m14',{status:'canceled',renewal_period_end:I(30).slice(0,10)});
L('014 (canceled w/o prior is ignored?)',await acct(u));
u='qa_tri_v_14b';await E(u,'membership.activated','m14b',{status:'active',renewal_period_end:I(30).slice(0,10)});L('014b',await acct(u));
// replay & trial convert regressions
u='qa_tri_v_r1';
const id='msg_v_replay';await h.hook('membership.activated',{id:'mr',user:{id:u},product:{id:P},status:'trialing',renewal_period_end:I(7),updated_at:tick(u)},{id});
L('replay',await h.hook('membership.deactivated',{id:'mr',user:{id:u},product:{id:P},status:'expired',updated_at:tick(u)},{id}),await A(u));
u='qa_tri_v_r2';await E(u,'membership.activated','mc',{status:'trialing',renewal_period_end:I(1)});
L('S1 convert',await E(u,'payment.succeeded','mc',{status:'active',renewal_period_end:I(30)}),await A(u),await acct(u));
u='qa_tri_v_r3';await E(u,'membership.activated','md',{status:'trialing',renewal_period_end:I(0.01)});
L('S3 failed',await E(u,'payment.failed','md'),await A(u),await acct(u));
L('S3 deact',await E(u,'membership.deactivated','md',{status:'expired'}),await A(u));
u='qa_tri_v_r4';await E(u,'membership.activated','me',{status:'active',renewal_period_end:I(10)});
L('S4 canceled future',await E(u,'membership.canceled','me',{status:'canceled',cancel_at_period_end:true,renewal_period_end:I(10)}),await A(u),await acct(u));
L('S4 deact w/ canceled',await E(u,'membership.deactivated','me',{status:'canceled',renewal_period_end:I(10)}),await A(u));
u='qa_tri_v_r5';L('S4 canceled past',await E(u,'membership.canceled','mf',{status:'canceled',renewal_period_end:I(-3)}),await A(u));
// repeat trial chain via cancel / payment after trial_used
u='qa_tri_v_r6';await E(u,'membership.activated','ma',{status:'trialing',renewal_period_end:I(7)});await E(u,'membership.deactivated','ma',{status:'expired'});await E(u,'membership.activated','mb',{status:'trialing',renewal_period_end:I(7)});
L('repeat then canceled evt',await E(u,'membership.canceled','mb',{status:'canceled',renewal_period_end:I(7)}),await A(u));
L('repeat then updated expires change',await E(u,'membership.updated','mb',{renewal_period_end:I(7)}),await A(u));
L('repeat then paid',await E(u,'payment.succeeded','mb',{status:'active',renewal_period_end:I(30)}),await A(u));
})();
