#!/usr/bin/env python3
"""Coordinator: dedupe QA tickets (same root cause = one ticket, duplicates linked) and write INDEX.md.

STATUS holds the coordinator's decision per ticket: fixed / wont_fix / open, the commit that fixed it,
and `dup_of` when the ticket shares a root cause with another (the primary keeps the highest severity).
Run: python3 sigmaline/tickets/build_index.py
"""
import glob, json, os

HERE = os.path.dirname(os.path.abspath(__file__))

# status, note ('fixed' notes name the fix; 'wont_fix' notes give the reason)
STATUS = {
    # Trial / Whop (TRI, CAN): all re-verified by the persona agents on the fixed build
    **{f'TRI-{i:03d}': ('fixed', 'membership reducer applyEvent + access rules (00f35ba); re-verified') for i in range(1, 15)},
    'TRI-015': ('fixed', 'date-only period end = end of day ET (09527fe)'),
    'CAN-001': ('fixed', "'canceled' only winds down a live membership (b9b32ff); re-verified"),
    'CAN-002': ('fixed', 'deactivation ends access now (b9b32ff); re-verified. Product call: see CHANGES.md decisions'),
    'CAN-003': ('fixed', 'tap-sized banner links, account dates (b9b32ff); re-verified'),
    'CAN-004': ('fixed', 'no renewal row for trial_used / expired (b9b32ff); re-verified'),
    # Security
    'SEC-001': ('fixed', 'no dev session secret with any real DB (9874ba6)'),
    'SEC-002': ('fixed', 'same-origin post-login redirect (9874ba6)'),
    'SEC-003': ('fixed', 'health route trimmed in this branch (7620fd7); live after the next production deploy'),
    'SEC-004': ('fixed', 'Content-Security-Policy header (9874ba6); 0 violations in browser check'),
    # Edge math / grades
    'SHP-001': ('fixed', 'consensus-only rows have no model EV: B at most (cfca4ff)'),
    'SHP-002': ('fixed', 'alt-line rule only for alternate lines, stated in FAQ (cfca4ff)'),
    'SHP-003': ('fixed', 'closing consensus one quote per book (cfca4ff)'),
    'SHP-004': ('wont_fix', 'demo data artifact: replayed closing snapshots copy the opening prices; the CLV code is verified correct'),
    'SHP-005': ('fixed', 'write-up wording (cfca4ff)'),
    'SHP-006': ('wont_fix', 'demo data artifact: no score source in the demo; production ingests finals'),
    'SHP-007': ('fixed', 'full college team names (cfca4ff)'),
    # Data integrity
    'DAT-001': ('fixed', 'unpriced games counted, not listed (e153323)'),
    'DAT-002': ('fixed', 'only edges above +25% are anomalies (e153323)'),
    'DAT-003': ('fixed', 'one sim run per snapshot; anomalies deduped (e153323)'),
    'DAT-004': ('fixed', 'ET slate window and day labels (e153323)'),
    'DAT-005': ('fixed', 'provider timestamps clamped to fetch time (e153323)'),
    'DAT-006': ('fixed', 'read-time cap on consensus-only A (e153323)', 'SHP-001'),
    'DAT-007': ('fixed', 'full college names', 'SHP-007'),
    # Edge Finder
    'EFP-001': ('fixed', 'form remounts on filter change (def07c1)'),
    'EFP-002': ('fixed', 'active book always selectable (def07c1)'),
    'EFP-003': ('fixed', 'non-preset min shown (def07c1)'),
    'EFP-004': ('wont_fix', 'demo replay timestamps; root cause fixed under DAT-005', 'DAT-005'),
    # Casual bettor
    'CAS-001': ('fixed', 'consensus-only pages explain fair % vs chart (4faf385)'),
    'CAS-002': ('fixed', 'no A without a model', 'SHP-001'),
    'CAS-003': ('fixed', 'both sides graded -> neither; one pick per market (4faf385)'),
    'CAS-004': ('fixed', 'write-up wording', 'SHP-005'),
    'CAS-005': ('fixed', 'key factors only from data (4faf385)'),
    'CAS-006': ('fixed', "'Projected total' (4faf385)"),
    'CAS-007': ('fixed', 'game with no prices says so (this commit)'),
        'CAS-008': ('fixed', 'no Top pick heading without a pick (af42e2d)'),
    'CAS-009': ('fixed', 'FAQ glossary + slate legend (4faf385, e153323)'),
    'CAS-010': ('fixed', 'FAQ explains units/CLV and warns on small samples (4faf385)'),
    'CAS-011': ('wont_fix', 'by design: picks (hash chain, graded stakes) and the edge log (every edge, flat 1u) are two records; the Results page says so'),
    'CAS-012': ('wont_fix', 'demo artifact: the demo replays the same recorded slate on two days'),
    'CAS-013': ('wont_fix', 'demo artifact: all demo results settle on one replayed day', 'CAS-012'),
    'CAS-014': ('fixed', 'landing promises alerts for the strongest picks (4faf385)'),
    'CAS-015': ('fixed', 'no Discord placeholder', 'IPH-003'),
        'CAS-016': ('fixed', 'empty states say what to do next (af42e2d)'),
        'CAS-017': ('fixed', 'movement charts explained (af42e2d)'),
    'CAS-018': ('fixed', 'times labelled ET; full college names', 'IPH-005'),
        'CAS-019': ('fixed', 'spreads defined on the game page (af42e2d)'),
    'CAS-020': ('wont_fix', 'by design: the Book filter lists books with live edges (+ the active one, EFP-002)'),
        'CAS-021': ('fixed', 'landing wording (af42e2d)'),
    # iPhone / Android / a11y / slow network
    'IPH-001': ('fixed', 'grey button explains; real disabled button', 'A11-004'),
    'IPH-002': ('fixed', 'first-charge date and amount on Account (e153323)'),
    'IPH-003': ('fixed', 'no Discord placeholder (e153323)'),
    'IPH-004': ('fixed', 'tap-sized help-line links (e153323)'),
    'IPH-005': ('fixed', 'ET label + Fair/Edge legend (e153323)'),
    'AND-001': ('open', 'P1 not reproduced on the demo-open server or for other sports; NHL tab on the paywall QA server idles ~14.5 s client-side while the server answers in ~30 ms. Re-check on a real Netlify deploy before production'),
        'AND-002': ('fixed', 'real brand icons rendered (this commit)'),
    'AND-003': ('fixed', '21+ hint + real disabled button', 'A11-004'),
    'AND-004': ('fixed', 'checkbox no longer shrinks (this commit)'),
        'AND-005': ('fixed', 'manifest id and language (af42e2d)'),
    'AND-006': ('wont_fix', 'not a bug: activate keeps both the shell cache and the public-pages cache (sw.js filters on both names)'),
    'A11-001': ('fixed', 'slate h1 (bae6263)'),
    'A11-002': ('fixed', 'labelled row links (bae6263)'),
    'A11-003': ('fixed', 'plain link with state (bae6263)'),
    'A11-004': ('fixed', 'real disabled button described by the hint (bae6263)'),
    'A11-005': ('fixed', 'badge role=img (bae6263)'),
    'A11-006': ('fixed', 'focusable main (bae6263)'),
        'A11-007': ('fixed', 'control and stale-row borders lightened to 3:1 (af42e2d)'),
    'A11-008': ('fixed', 'th scope (bae6263/4faf385)'),
    'SLO-001': ('fixed', 'pending bar on tap (2f012d3)'),
    'SLO-002': ('fixed', 'pending bar on tabs/toggles (2f012d3)', 'SLO-001'),
    'SLO-003': ('fixed', 'slate capped at 40 rows + Show all (2f012d3)'),
        'SLO-004': ('fixed', 'fonts self-hosted with preload; remaining payload is the Plex files themselves (earlier)'),
    'SLO-005': ('fixed', 'footer links no prefetch (2f012d3)'),
        'SLO-006': ('fixed', 'legal pages precached for offline (af42e2d)'),
    # Props
    'PNBA-001': ('fixed', 'box-score mapping for every requested market (fef8342)'),
    'PNBA-002': ('fixed', 'box-score mappings', 'PNBA-001'),
    'PNBA-003': ('fixed', 'box-score mappings', 'PNBA-001'),
    'PNBA-004': ('fixed', 'post-game box scores for open prop edges (fef8342)'),
    'PNFL-001': ('fixed', 'PropLine player_team stored and used (321c174)'),
    'PNFL-002': ('fixed', 'once-a-day log refresh by fetch time, request caps (321c174)'),
    'PNFL-003': ('wont_fix', 'rule: a Yes-only market has no two-way consensus, so no fair price is invented'),
    'PNFL-004': ('fixed', 'Yes/No wording (321c174)'),
    'PNFL-005': ('wont_fix', 'intended: a live side next to a suspended one keeps its own price and consensus'),
    'PNFL-006': ('open', 'unverified: whether PropLine omits zero stats; check against a live response'),
    'PNHL-001': ('fixed', 'stale books out of best price when fresh exist (321c174)'),
    'PNHL-002': ('wont_fix', 'same rule as PNFL-003', 'PNFL-003'),
    'PNHL-003': ('wont_fix', 'one-book lines are ungraded and show their book count'),
    'PNHL-004': ('fixed', 'deterministic main line; graded alt lines kept (321c174)'),
    'PNHL-005': ('fixed', 'edge % hidden when stale (321c174)'),
        'PNHL-006': ('fixed', 'prop-specific empty text in Edge Finder (af42e2d)'),
    'PNHL-007': ('fixed', 'goals+assists fallback, shot aliases (321c174)'),
    'PSOC-001': ('fixed', 'staleness before sanity cap (09527fe)'),
    'PSOC-002': ('wont_fix', 'same rule as PNFL-003', 'PNFL-003'),
    'PSOC-003': ('wont_fix', 'PropLine has no UCL key; documented in CHANGES.md'),
    'PSOC-004': ('fixed', 'both soccer key styles requested + mapped (09527fe)'),
    'PSOC-005': ('fixed', 'soccer risk lines by side (09527fe)'),
    'PSOC-006': ('wont_fix', 'consensus incl. the bet book is standard; affected rows are ungraded'),
    'PCBB-001': ('fixed', 'stale books dropped from consensus/book count when fresh exist (worker passes nowMs)', 'PNHL-001'),
    'PCBB-002': ('open', 'needs owner decision: show consensus-only props for sports with no player model (CBB/CFB/NHL/soccer)? Currently shown, B at most'),
    'PCBB-003': ('open', 'unverified: PropLine college box-score field names / player-name matching; check against a live response'),
    'PCFB-001': ('fixed', 'storage keeps only gradable lines (main, or >= altLine.minBooks) (this commit)'),
    'PCFB-002': ('fixed', 'consensus-only props on whole-number lines are not graded (this commit)'),
    'PCFB-003': ('fixed', 'stale books out of consensus when fresh exist', 'PNHL-001'),
        'PCFB-004': ('fixed', 'prop-specific empty text (af42e2d)', 'PNHL-006'),
    'PTEN-001': ('fixed', 'ingest keeps only requested prop markets (this commit)'),
    'PTEN-002': ('fixed', 'tennis handicaps/totals never graded or logged (this commit)'),
    'PTEN-003': ('fixed', 'game with no prices says so', 'CAS-007'),
    'PTEN-004': ('fixed', 'best-of sentence only when it supports the pick (this commit)'),
}
SEV = {'P0': 0, 'P1': 1, 'P2': 2, 'P3': 3}


def main():
    tickets = {}
    for f in sorted(glob.glob(os.path.join(HERE, '*.json'))):
        t = json.load(open(f))
        tickets[t['id']] = t
    rows, missing = [], []
    for tid, t in tickets.items():
        st = STATUS.get(tid)
        if not st:
            missing.append(tid)
            st = ('open', 'not yet triaged')
        status, note = st[0], st[1]
        dup = st[2] if len(st) > 2 else None
        rows.append((SEV.get(t.get('severity'), 9), tid, t, status, note, dup))
    rows.sort(key=lambda r: (r[0], r[1]))
    by_sev = {s: {'filed': 0, 'fixed': 0, 'wont_fix': 0, 'open': 0} for s in SEV}
    for _, tid, t, status, _, dup in rows:
        s = t.get('severity')
        by_sev[s]['filed'] += 1
        by_sev[s][status] += 1
    primaries = [r for r in rows if not r[5]]
    out = ['# QA tickets — index', '',
           'Generated by `build_index.py` from the ticket JSON files. Duplicates (same root cause) are linked to their primary ticket and listed under it.', '',
           '| Severity | Filed | Fixed | Won\'t fix | Open |', '|---|---|---|---|---|']
    for s in SEV:
        c = by_sev[s]
        out.append(f"| {s} | {c['filed']} | {c['fixed']} | {c['wont_fix']} | {c['open']} |")
    tot = {k: sum(by_sev[s][k] for s in SEV) for k in ('filed', 'fixed', 'wont_fix', 'open')}
    out.append(f"| **Total** | **{tot['filed']}** | **{tot['fixed']}** | **{tot['wont_fix']}** | **{tot['open']}** |")
    out += ['', f'{len(primaries)} distinct root causes after deduplication.', '']
    for sev in SEV:
        group = [r for r in primaries if r[2].get('severity') == sev]
        if not group:
            continue
        out += [f'## {sev}', '', '| Ticket | Title | Persona | Status | Note | Duplicates |', '|---|---|---|---|---|---|']
        for _, tid, t, status, note, _ in group:
            dups = ', '.join(d[1] for d in rows if d[5] == tid)
            title = (t.get('title') or '').replace('|', '/')
            out.append(f"| [{tid}]({tid}.json) | {title} | {t.get('persona', '')} | {status.replace('_', ' ')} | {note.replace('|', '/')} | {dups} |")
        out.append('')
    if missing:
        out += ['## Not yet triaged', '', ', '.join(missing), '']
    open(os.path.join(HERE, 'INDEX.md'), 'w').write('\n'.join(out) + '\n')
    print(json.dumps(tot), 'untriaged:', missing)


if __name__ == '__main__':
    main()
