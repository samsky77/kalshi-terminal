const h=require('./h');
const GID='nfl-777c6a605bdb4779';
const U=(u,m,x={})=>({id:m,user:{id:u,email:u+'@x.test'},product:{id:'prod_qa'},...x});
const short=o=>Object.entries(o).filter(([k])=>k!='/results').map(([k,v])=>k.slice(0,9)+':'+v.slice(0,3)).join(' ');
const acct=async u=>{const t=await h.page(u,'/account');const m=t.match(/Status.{0,110}/);return m?m[0]:'(no account)'};
(async()=>{
let u='qa_tri_12';
await h.hook('membership.activated',{...U(u,'mem_12a'),status:'trialing',renewal_period_end:h.iso(7)});
await h.hook('membership.deactivated',{...U(u,'mem_12a'),status:'expired'});
await h.hook('membership.activated',{...U(u,'mem_12b'),status:'trialing',renewal_period_end:h.iso(7)});
console.log('repeat locked',short(await h.probe(u,GID)));
console.log('mem B 2nd trialing event (updated)',await h.hook('membership.updated',{...U(u,'mem_12b'),status:'trialing',renewal_period_end:h.iso(7)}),short(await h.probe(u,GID)));
// replay
u='qa_tri_13';
const id='msg_replay_13';
console.log('replay1',await h.hook('membership.activated',{...U(u,'mem_13'),status:'trialing',renewal_period_end:h.iso(7)},{id}));
console.log('replay2 same id diff body(deactivate)',await h.hook('membership.deactivated',{...U(u,'mem_13'),status:'expired'},{id}),short(await h.probe(u,GID)));
// out of order
u='qa_tri_14';
console.log('deact first',await h.hook('membership.deactivated',{...U(u,'mem_14'),status:'expired'}));
console.log('then stale activated',await h.hook('membership.activated',{...U(u,'mem_14'),status:'trialing',renewal_period_end:h.iso(-1)}),short(await h.probe(u,GID)));
u='qa_tri_15';
await h.hook('membership.deactivated',{...U(u,'mem_15'),status:'expired'});
console.log('deact first, then late activated (active, future)',await h.hook('membership.activated',{...U(u,'mem_15'),status:'active',renewal_period_end:h.iso(30)}),short(await h.probe(u,GID)));
// trialing with past end date
u='qa_tri_16';
console.log('trialing w/ past end',await h.hook('membership.activated',{...U(u,'mem_16'),status:'trialing',renewal_period_end:h.iso(-5)}),short(await h.probe(u,GID)),await acct(u));
// other product
u='qa_tri_17';
console.log('other product',await h.hook('membership.activated',{id:'mem_17',user:{id:u},product:{id:'prod_other'},status:'active',renewal_period_end:h.iso(30)}),short(await h.probe(u,GID)));
// other product via access_pass / product_id
console.log('other product_id flat',await h.hook('membership.activated',{id:'mem_17',user_id:u,product_id:'prod_other',status:'active'}));
// no product at all
u='qa_tri_18';
console.log('no product id',await h.hook('membership.activated',{id:'mem_18',user:{id:u},status:'active',renewal_period_end:h.iso(30)}),short(await h.probe(u,GID)));
// no user
console.log('no user',await h.hook('membership.activated',{id:'mem_19',product:{id:'prod_qa'},status:'active'}));
// member.user.id path / user_id
u='qa_tri_20';
console.log('flat user_id',await h.hook('membership.activated',{id:'mem_20',user_id:u,product_id:'prod_qa',status:'active',renewal_period_end:h.iso(30)}),short(await h.probe(u,GID)));
// dates: unix seconds, ms, string numeric, ISO, no tz
for(const [n,v] of [['sec',Math.floor(Date.now()/1000)+30*86400],['ms',Date.now()+30*864e5],['isoNoTZ',new Date(Date.now()+30*864e5).toISOString().slice(0,19)],['dateOnly',new Date(Date.now()+30*864e5).toISOString().slice(0,10)],['numstr',String(Math.floor(Date.now()/1000)+30*86400)],['garbage','soon']]){
 u='qa_tri_d_'+n; await h.hook('membership.canceled',{...U(u,'mem_d'+n),status:'canceled',renewal_period_end:v});
 console.log('date',n,v,short(await h.probe(u,GID)),await acct(u));}
// ISO vs sec for active/canceled with exp in past in sec
// bad signature / old ts
console.log('stale ts',await h.hook('membership.activated',{...U('qa_tri_21','mem_21'),status:'active'},{ts:Math.floor(Date.now()/1000)-400}));
// status mixed-case / unknown status
u='qa_tri_22';
console.log('unknown status "paused"',await h.hook('membership.activated',{...U(u,'mem_22'),status:'paused',renewal_period_end:h.iso(30)}),short(await h.probe(u,GID)));
u='qa_tri_23';
console.log('drafted status w/ activated type',await h.hook('membership.activated',{...U(u,'mem_23'),status:'drafted'}),short(await h.probe(u,GID)));
// payment.succeeded for a user previously expired with no status
u='qa_tri_24';
await h.hook('membership.deactivated',{...U(u,'mem_24'),status:'expired'});
console.log('payment.succeeded no status after expired',await h.hook('payment.succeeded',{...U(u,'mem_24')}),short(await h.probe(u,GID)));
// payment.failed after canceled -> past_due resurrects access?
u='qa_tri_25';
await h.hook('membership.deactivated',{...U(u,'mem_25'),status:'expired'});
console.log('payment.failed after expired',await h.hook('payment.failed',{...U(u,'mem_25')}),short(await h.probe(u,GID)));
// payment.failed for non-membership payment (no membership id) ... 
// active with missing renewal_period_end then cancel
// payment.failed on a trial_used row
u='qa_tri_26';
await h.hook('membership.activated',{...U(u,'mem_26a'),status:'trialing',renewal_period_end:h.iso(7)});
await h.hook('membership.deactivated',{...U(u,'mem_26a'),status:'expired'});
await h.hook('membership.activated',{...U(u,'mem_26b'),status:'trialing',renewal_period_end:h.iso(7)});
console.log('trial_used then payment.failed',await h.hook('payment.failed',{...U(u,'mem_26b')}),short(await h.probe(u,GID)));
})();
