const h=require('./h');
(async()=>{
const GID=require('/home/user/kalshi-terminal/sigmaline/app/.data/demo-db.json').events.find(e=>e.status!=='final')?.id||require('/home/user/kalshi-terminal/sigmaline/app/.data/demo-db.json').events[0].id;
console.log('gid',GID);
const U=(u,m)=>({id:m,user:{id:u,email:u+'@x.test'},product:{id:'prod_qa'}});
const acct=async u=>{const t=await h.page(u,'/account');const m=t.match(/Status.{0,200}/);return m?m[0]:t.slice(0,200)};
// S1
let u='qa_tri_1';
console.log('S1 pre',await h.probe(u,GID));
console.log(await h.hook('membership.activated',{...U(u,'mem_1'),status:'trialing',renewal_period_end:h.iso(1)}));
console.log('S1 trial',await h.probe(u,GID),await acct(u));
console.log(await h.hook('payment.succeeded',{...U(u,'mem_1'),status:'active',renewal_period_end:h.iso(30)}));
console.log('S1 active',await h.probe(u,GID),await acct(u));
// S2
u='qa_tri_2';
console.log(await h.hook('membership.activated',{...U(u,'mem_2'),status:'trialing',renewal_period_end:h.iso(1)}));
console.log(await h.hook('membership.updated',{...U(u,'mem_2'),cancel_at_period_end:true}));
console.log('S2 cancel',await h.probe(u,GID),await acct(u));
console.log(await h.hook('membership.deactivated',{...U(u,'mem_2'),status:'expired'}));
console.log('S2 expired',await h.probe(u,GID));
console.log('S2 landing',(await h.page(u,'/slate')).match(/You're signed in.{0,120}|signed in.{0,120}/)?.[0]);
// S3
u='qa_tri_3';
console.log(await h.hook('membership.activated',{...U(u,'mem_3'),status:'trialing',renewal_period_end:h.iso(0.01)}));
console.log(await h.hook('payment.failed',{...U(u,'mem_3')}));
console.log('S3 pastdue',await h.probe(u,GID),await acct(u));
console.log(await h.hook('membership.deactivated',{...U(u,'mem_3')}));
console.log('S3 removed',await h.probe(u,GID));
})();
