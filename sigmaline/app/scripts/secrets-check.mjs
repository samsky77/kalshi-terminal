#!/usr/bin/env node
/**
 * No secret may ship to the browser. Scans everything the client can download (.next/static and the
 * public folder) for (1) the VALUES of server-only secrets present in the build environment and
 * (2) references to server-only variable names. CI builds with recognisable dummy values, so a leak
 * is caught even without real keys. Exit 1 on any hit.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SERVER_ONLY = [
  'WHOP_API_KEY', 'WHOP_CLIENT_SECRET', 'WHOP_WEBHOOK_SECRET', 'WHOP_CLIENT_ID', 'SESSION_SECRET', 'DATABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY', 'ODDS_API_KEY', 'PROPLINE_API_KEY', 'SHARPAPI_KEY', 'VAPID_PRIVATE_KEY', 'GH_DISPATCH_TOKEN',
  'DISCORD_WEBHOOK_URL', 'DISCORD_ERROR_WEBHOOK_URL',
];
const roots = ['.next/static', 'public'];
const files = [];
const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (/\.(js|css|html|json|txt|map|webmanifest)$/.test(f)) files.push(p); } };
for (const r of roots) { try { walk(r); } catch { /* missing folder */ } }
if (!files.length) { console.error('secrets-check: no build output found; run `next build` first'); process.exit(1); }

const values = SERVER_ONLY.map((k) => [k, process.env[k]]).filter(([, v]) => v && v.length >= 8);
const hits = [];
for (const f of files) {
  const s = readFileSync(f, 'utf8');
  for (const [k, v] of values) if (s.includes(v)) hits.push(`${f}: contains the value of ${k}`);
  for (const k of SERVER_ONLY) if (new RegExp(`\\b${k}\\b`).test(s)) hits.push(`${f}: references ${k}`);
}
console.log(`secrets-check: scanned ${files.length} client files for ${values.length} secret values and ${SERVER_ONLY.length} names`);
if (hits.length) { console.error(hits.join('\n')); process.exit(1); }
console.log('secrets-check: OK, no server secret in the client bundle');
