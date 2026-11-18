import { alertText, inQuietHours, shortName, selectionLabel, type Selection } from '@sigmaline/core';
import type { MemberRow, PickRow } from '@sigmaline/db';
import type { Ctx } from './context';

function parseSel(key: string): Selection {
  const [market, side, line, player, stat] = key.split(':');
  return { market: market as Selection['market'], side: side as Selection['side'], line: line === '' ? undefined : Number(line), player: player || undefined, stat: stat || undefined };
}

export function alertLabel(p: PickRow): string {
  const [away, home] = p.event_name.split(' @ ');
  return selectionLabel(parseSel(p.selection), shortName(home ?? ''), shortName(away ?? ''));
}

/** Claim a (pick, channel, target) slot. Returns false if an alert was already sent there. */
async function claim(ctx: Ctx, pickId: string, channel: 'push' | 'discord', target: string): Promise<boolean> {
  const n = await ctx.db.insertIgnore('alert_log', [{ pick_id: pickId, channel, target, status: 'sending', sent_at: ctx.now().toISOString() }], 'pick_id,channel,target');
  return n === 1;
}

async function mark(ctx: Ctx, pickId: string, channel: string, target: string, status: string) {
  await ctx.db.update('alert_log', { pick_id: pickId, channel, target }, { status });
}

export interface AlertReport { picks: number; push: number; discord: number; skippedQuiet: number; failed: number }

/**
 * Alert on newly published picks with EV ≥ the alert threshold. Each (pick, destination) is
 * claimed in alert_log before sending, so a retry or a second worker can never double-send.
 */
export async function sendAlerts(ctx: Ctx, picks: PickRow[]): Promise<AlertReport> {
  const rep: AlertReport = { picks: 0, push: 0, discord: 0, skippedQuiet: 0, failed: 0 };
  const due = picks.filter((p) => Number(p.ev) >= ctx.settings.alertEv && Date.parse(p.commence_time) > ctx.now().getTime());
  if (!due.length) return rep;
  rep.picks = due.length;
  const appUrl = (ctx.env.APP_URL ?? '').replace(/\/$/, '');
  let webpush: typeof import('web-push') | null = null;
  if (ctx.env.VAPID_PUBLIC_KEY && ctx.env.VAPID_PRIVATE_KEY) {
    webpush = (await import('web-push')).default as unknown as typeof import('web-push');
    webpush.setVapidDetails(ctx.env.VAPID_SUBJECT ?? 'mailto:admin@example.com', ctx.env.VAPID_PUBLIC_KEY, ctx.env.VAPID_PRIVATE_KEY);
  }
  const members = await ctx.db.select<MemberRow>('members', { eq: { status: 'active', push_enabled: true } });
  const subs = await ctx.db.select<{ id: number; whop_user_id: string; endpoint: string; p256dh: string; auth: string }>('push_subscriptions');
  for (const p of due) {
    const text = alertText({ grade: p.grade, label: alertLabel(p), decimal: Number(p.price_decimal), ev: Number(p.ev), commence: p.commence_time });
    const url = `${appUrl}/game/${encodeURIComponent(p.event_id)}`;
    if (ctx.env.DISCORD_WEBHOOK_URL && (await claim(ctx, p.id, 'discord', 'members'))) {
      try {
        const res = await fetch(ctx.env.DISCORD_WEBHOOK_URL, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ content: `**${text}**\n${p.event_name}\n${url}\n-# 21+ · Information only, not a guarantee. 1-800-GAMBLER`, allowed_mentions: { parse: [] } }),
        });
        await mark(ctx, p.id, 'discord', 'members', res.ok ? 'sent' : `http ${res.status}`);
        if (res.ok) rep.discord++; else rep.failed++;
      } catch (e) { rep.failed++; await mark(ctx, p.id, 'discord', 'members', `error ${(e as Error).message}`.slice(0, 200)); }
    }
    if (!webpush) continue;
    for (const m of members) {
      if (inQuietHours(ctx.now().toISOString(), m.quiet_start, m.quiet_end, m.time_zone)) { rep.skippedQuiet++; continue; }
      for (const s of subs.filter((x) => x.whop_user_id === m.whop_user_id && x.auth !== 'expired')) {
        if (!(await claim(ctx, p.id, 'push', s.endpoint))) continue;
        try {
          await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify({ title: 'Sigmaline', body: text, url: `/game/${encodeURIComponent(p.event_id)}`, tag: p.id }), { TTL: 3600 });
          await mark(ctx, p.id, 'push', s.endpoint, 'sent');
          rep.push++;
        } catch (e) {
          const code = (e as { statusCode?: number }).statusCode;
          await mark(ctx, p.id, 'push', s.endpoint, `error ${code ?? ''}`);
          rep.failed++;
          // 404/410: subscription is gone; remove it
          if (code === 404 || code === 410) await ctx.db.update('push_subscriptions', { id: s.id }, { auth: 'expired' });
        }
      }
    }
  }
  return rep;
}

/** Post a job failure to the private error channel. */
export async function notifyError(env: Record<string, string | undefined>, job: string, err: unknown): Promise<void> {
  const url = env.DISCORD_ERROR_WEBHOOK_URL;
  if (!url) return;
  const msg = err instanceof Error ? `${err.message}\n${(err.stack ?? '').split('\n').slice(1, 6).join('\n')}` : String(err);
  await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: `Sigmaline job **${job}** failed:\n\`\`\`${msg.slice(0, 1700)}\`\`\`` }) }).catch(() => {});
}
