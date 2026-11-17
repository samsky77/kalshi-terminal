// Verifies unpaid visitors cannot reach paid data by calling the routes directly (not via the UI).
// Run against a server started WITHOUT DEMO_OPEN:  BASE=http://localhost:3200 node scripts/paywall-check.mjs
import { createHmac } from 'node:crypto';
const base = process.env.BASE || 'http://localhost:3000';
let fail = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${extra}`); if (!ok) fail++; };

const slate = await (await fetch(`${base}/api/results/chain`)).json();
const anyGame = 'nba-0000000000000000';
// 1. No session: paid API routes return 401 and contain no data
for (const path of ['/api/slate?sport=nba', `/api/game/${anyGame}`]) {
  const r = await fetch(base + path);
  const body = await r.text();
  check(`anon ${path} -> 401`, r.status === 401 && !body.includes('best_decimal'), `(got ${r.status})`);
}
for (const [path, method] of [['/api/push', 'POST'], ['/api/me/alerts', 'POST']]) {
  const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json' }, body: '{}' });
  check(`anon ${method} ${path} -> 401`, r.status === 401, `(got ${r.status})`);
}
const adm = await fetch(`${base}/api/admin/settings`, { method: 'POST', body: new URLSearchParams({ a: '0.01', b: '0.01', alert: '0.01' }) });
check('anon POST /api/admin/settings -> 403', adm.status === 403, `(got ${adm.status})`);
// 2. Paid pages redirect to sign-in / sales page
for (const path of ['/slate', `/game/${anyGame}`, '/alerts', '/account', '/admin']) {
  const r = await fetch(base + path, { redirect: 'manual' });
  check(`anon page ${path} -> redirect`, r.status >= 300 && r.status < 400, `(got ${r.status} -> ${r.headers.get('location')})`);
}
// 3. Forged cookie (wrong signature) is rejected
const forged = Buffer.from(JSON.stringify({ uid: 'attacker', email: null, exp: Date.now() + 1e9 })).toString('base64url') + '.' + 'AAAA';
const f = await fetch(`${base}/api/slate?sport=nba`, { headers: { cookie: `sl_session=${forged}` } });
check('forged session -> 401', f.status === 401, `(got ${f.status})`);
// 4. Validly signed session for a user WITHOUT a membership is still rejected (needs SESSION_SECRET of the server)
if (process.env.SESSION_SECRET) {
  const body = Buffer.from(JSON.stringify({ uid: 'user_without_membership', email: 'x@example.com', exp: Date.now() + 1e9 })).toString('base64url');
  const sig = createHmac('sha256', process.env.SESSION_SECRET).update(body).digest('base64url');
  const r = await fetch(`${base}/api/slate?sport=nba`, { headers: { cookie: `sl_session=${body}.${sig}` } });
  check('signed-in non-member -> 401', r.status === 401, `(got ${r.status})`);
}
// 5. Public chain: unstarted picks are sealed for anonymous visitors
const now = Date.now();
const leaked = slate.rows.filter((r) => !r.sealed && Date.parse(r.commence_time) > now);
check('public chain hides unstarted picks', leaked.length === 0, `(${slate.rows.filter((r) => r.sealed).length} sealed)`);
const res = await (await fetch(`${base}/api/results`)).json();
check('public results hide unstarted picks', res.rows.every((r) => Date.parse(r.commence_time) <= now), `(${res.hiddenPending} hidden)`);
check('public results labelled live record', res.label === 'Live record');
process.exit(fail ? 1 : 0);
