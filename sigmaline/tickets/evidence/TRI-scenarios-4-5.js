const h=require('./h');
const GID='nfl-777c6a605bdb4779';
const U=(u,m,x={})=>({id:m,user:{id:u,email:u+'@x.test'},product:{id:'prod_qa'},...x});
const short=o=>Object.entries(o).filter(([k])=>k!='/results').map(([k,v])=>k.slice(0,9)+':'+v.slice(0,3)).join(' ');
const acct=async u=>{const t=await h.page(u,'/account');const m=t.match(/Status.{0,110}/);return m?m[0]:'(no account page) '+t.slice(0,80)};
(async()=>{
let u='qa_tri_4';
console.log('S2b cancel w/ status', await h.hook('membership.updated',{...U(u,'mem_4a'),status:'trialing',cancel_at_period_end:true,renewal_period_end:h.iso(2)}), await acct(u));
console.log('S2c type cancel_at_period_end_changed no status', await h.hook('membership.cancel_at_period_end_changed',{...U('qa_tri_4b','mem_4b'),cancel_at_period_end:true,renewal_period_end:h.iso(2)}));
// S4 canceled future
u='qa_tri_5';
await h.hook('membership.activated',{...U(u,'mem_5'),status:'active',renewal_period_end:h.iso(10)});
console.log(await h.hook('membership.canceled',{...U(u,'mem_5'),status:'canceled',cancel_at_period_end:true,renewal_period_end:h.iso(10)}));
console.log('S4 canceled future',short(await h.probe(u,GID)),await acct(u));
console.log(await h.hook('membership.deactivated',{...U(u,'mem_5'),status:'canceled',renewal_period_end:h.iso(10)}));
console.log('S4 deactivated(canceled) future',short(await h.probe(u,GID)),await acct(u));
u='qa_tri_6';
console.log(await h.hook('membership.canceled',{...U(u,'mem_6'),status:'canceled',renewal_period_end:h.iso(-3)}));
console.log('S4 canceled past',short(await h.probe(u,GID)),await acct(u));
// canceled w/ no date
u='qa_tri_7';
console.log(await h.hook('membership.canceled',{...U(u,'mem_7'),status:'canceled'}));
console.log('S4 canceled nodate',short(await h.probe(u,GID)));
// deactivated with future end date but status expired
u='qa_tri_8';
await h.hook('membership.activated',{...U(u,'mem_8'),status:'active',renewal_period_end:h.iso(10)});
console.log(await h.hook('membership.deactivated',{...U(u,'mem_8'),status:'expired',renewal_period_end:h.iso(10)}));
console.log('S4 expired w/ future end',short(await h.probe(u,GID)));
// S5 repeat trial
u='qa_tri_9';
await h.hook('membership.activated',{...U(u,'mem_9a'),status:'trialing',renewal_period_end:h.iso(7)});
await h.hook('membership.deactivated',{...U(u,'mem_9a'),status:'expired'});
console.log(await h.hook('membership.activated',{...U(u,'mem_9b'),status:'trialing',renewal_period_end:h.iso(7)}));
console.log('S5 repeat',short(await h.probe(u,GID)),await acct(u));
const t=await h.page(u,'/slate');console.log('landing:',t.match(/already used[^.]*\./)||t.match(/signed in.{0,90}/)[0]);
// repeat: what happens after payment.succeeded on mem B?
console.log(await h.hook('payment.succeeded',{...U(u,'mem_9b'),status:'active',renewal_period_end:h.iso(30)}));
console.log('S5 repeat then paid',short(await h.probe(u,GID)));
// repeat variant: trial on A while still trialing, then B without expiry in between
u='qa_tri_10';
await h.hook('membership.activated',{...U(u,'mem_10a'),status:'trialing',renewal_period_end:h.iso(7)});
console.log('S5b second trial while first live',await h.hook('membership.activated',{...U(u,'mem_10b'),status:'trialing',renewal_period_end:h.iso(7)}),short(await h.probe(u,GID)));
// repeat via payload w/o mem_ id prefix
u='qa_tri_11';
await h.hook('membership.activated',{...U(u,'mem_11a'),status:'trialing',renewal_period_end:h.iso(7)});
await h.hook('membership.deactivated',{...U(u,'mem_11a'),status:'expired'});
console.log('S5c no membership id on 2nd', await h.hook('membership.activated',{user:{id:u},product:{id:'prod_qa'},status:'trialing',renewal_period_end:h.iso(7)}),short(await h.probe(u,GID)));
})();
