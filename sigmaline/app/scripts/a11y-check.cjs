// Accessibility + layout check at 360px: axe-core (contrast etc.), 44px touch targets, no horizontal scroll.
// Usage: BASE=http://localhost:3100 node scripts/a11y-check.cjs [outDir]
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const base = process.env.BASE || 'http://localhost:3000';
const out = process.argv[2] || '.';
const axeSrc = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 360, height: 780 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const slate = await (await fetch(`${base}/api/slate?sport=nba`)).json().catch(() => ({ rows: [] }));
  const gameId = slate.rows?.find((r) => r.top)?.event.id || slate.rows?.[0]?.event.id;
  const pages = ['/', '/slate?sport=nba', gameId && `/game/${gameId}`, '/results', '/alerts', '/account', '/admin', '/login', '/legal/terms'].filter(Boolean);
  let failures = 0;
  for (const p of pages) {
    await page.goto(base + p, { waitUntil: 'networkidle' });
    await page.addScriptTag({ content: axeSrc });
    const axe = await page.evaluate(async () => {
      const r = await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] } });
      return r.violations.map((v) => ({ id: v.id, impact: v.impact, n: v.nodes.length, sample: v.nodes.slice(0, 3).map((x) => x.target.join(' ')) }));
    });
    const small = await page.evaluate(() => {
      const els = [...document.querySelectorAll('a[href], button, input:not([type=hidden]), select, summary, [role=switch]')];
      return els.filter((e) => {
        const r = e.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) return false; // hidden
        const cs = getComputedStyle(e);
        if (cs.position === 'absolute' && e.classList.contains('sr-only')) return false;
        // checkboxes sit inside a 44px label; measure the label instead
        const t = e.matches('input[type=checkbox]') && e.closest('label') ? e.closest('label').getBoundingClientRect() : r;
        return t.height < 44 - 0.5 || t.width < 44 - 0.5;
      }).map((e) => `${e.tagName.toLowerCase()}:${(e.textContent || e.getAttribute('aria-label') || e.name || '').trim().slice(0, 30)} ${Math.round(e.getBoundingClientRect().width)}x${Math.round(e.getBoundingClientRect().height)}`);
    });
    const hscroll = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    const name = p.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '') || 'home';
    await page.screenshot({ path: path.join(out, `360-${name}.png`), fullPage: true });
    const bad = axe.length + small.length + (hscroll ? 1 : 0);
    failures += bad;
    console.log(`${bad ? 'FAIL' : 'PASS'} ${p}  axe:${axe.length} small-targets:${small.length} hscroll:${hscroll}`);
    for (const v of axe) console.log(`   axe ${v.id} (${v.impact}) x${v.n}: ${v.sample.join(' | ')}`);
    for (const s of small.slice(0, 8)) console.log(`   target ${s}`);
  }
  await browser.close();
  process.exit(failures ? 1 : 0);
})();
