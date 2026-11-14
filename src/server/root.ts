import { existsSync } from 'node:fs';
import path from 'node:path';

let memo: string | null = null;
/** Directory holding fixtures/: process.cwd() normally, else found by walking up from the server bundle. */
export function fixturesDir(): string {
  if (memo) return memo;
  const candidates = [process.cwd()];
  let d = __dirname;
  for (let i = 0; i < 8; i++) { candidates.push(d); d = path.dirname(d); }
  for (const c of candidates) {
    const f = path.join(c, 'fixtures');
    if (existsSync(path.join(f, 'kalshi'))) return (memo = f);
  }
  return (memo = path.join(process.cwd(), 'fixtures'));
}
