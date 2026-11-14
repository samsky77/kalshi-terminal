import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// Acceptance check 5: no order, trade or portfolio endpoints anywhere in the repo.
// Patterns are assembled from pieces so this file does not match itself.
const FORBIDDEN = [
  ['/port', 'folio'], ['/ord', 'ers'], ['create', '_order'], ['cancel', '_order'], ['amend', '_order'],
  ['batch', '_orders'], ['/trad', 'es'], ['place', 'Order'], ['KALSHI-', 'ACCESS-SIGNATURE'], ['/rfq', 's'], ['/quo', 'tes'],
].map((p) => p.join(''));

function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    if (['node_modules', '.next', '.git', 'fixtures', '.vercel'].includes(f)) continue;
    const p = path.join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|js|mjs|json|md)$/.test(f) && f !== 'package-lock.json') out.push(p);
  }
  return out;
}

describe('read-only', () => {
  it('has no order, trade or account endpoint strings', () => {
    const hits: string[] = [];
    for (const f of walk(process.cwd())) {
      const text = readFileSync(f, 'utf8');
      for (const pat of FORBIDDEN) if (text.includes(pat)) hits.push(`${path.relative(process.cwd(), f)}: ${pat}`);
    }
    expect(hits).toEqual([]);
  });
});
