/**
 * Whop membership states and the one access rule (item 1). Pure functions: no I/O, unit-tested.
 *
 * Whop membership `status` values (their API): trialing, active, past_due, unresolved, completed,
 * expired, canceled, drafted. We collapse them to the five states the app knows about.
 */
export type MemberStatus = 'trialing' | 'active' | 'past_due' | 'canceled' | 'expired' | 'none';

export interface MemberState {
  status: MemberStatus | string;
  /** End of the current paid period / trial (access ends here once canceled). */
  expires_at?: string | null;
  cancel_at_period_end?: boolean | null;
  /** Set when this Whop user first started a trial; a second trial is not honoured. */
  first_trial_at?: string | null;
  membership_id?: string | null;
  trial_ends_at?: string | null;
}

/** Map Whop's own membership status string. */
export function fromWhopStatus(s: unknown): MemberStatus | null {
  switch (String(s ?? '').toLowerCase()) {
    case 'trialing': return 'trialing';
    case 'active': return 'active';
    case 'past_due': case 'unresolved': return 'past_due';
    case 'canceled': case 'cancelled': return 'canceled';
    case 'expired': case 'completed': return 'expired';
    default: return null;
  }
}

/**
 * Status from a webhook: Whop's `data.status` wins when present; otherwise the event type decides.
 * Returns null for events that don't change membership (e.g. cancel_at_period_end toggles keep the
 * current status; access still ends at the period end via the later deactivation event).
 */
export function statusFromWebhook(type: string, data: any): MemberStatus | null {
  const t = type.toLowerCase();
  const fromData = fromWhopStatus(data?.status);
  // Expiry first: 'deactivated' contains 'activated'.
  if (/went_invalid|deactivated|expired/.test(t)) return fromData === 'canceled' ? 'canceled' : 'expired';
  if (/payment[._]failed/.test(t)) return 'past_due';
  if (fromData) return fromData;
  if (/went_valid|\bactivated|membership\.created|renew|payment[._]succeeded/.test(t)) return 'active';
  if (/cancel/.test(t)) return data?.valid === false ? 'canceled' : null;
  return null;
}

/**
 * The access rule. trialing and active: yes. past_due: yes, while Whop retries the card (grace).
 * canceled: only until the end of the period already paid for (or the trial end). expired / none: no.
 */
export function hasAccess(m: MemberState | null | undefined, now = Date.now()): boolean {
  if (!m) return false;
  if (m.status === 'trialing' || m.status === 'active' || m.status === 'past_due') return true;
  if (m.status === 'canceled') return !!m.expires_at && Date.parse(m.expires_at) > now;
  return false;
}

/**
 * Repeat-trial rule: a Whop account gets one free trial. If a user who already had a trial (on a
 * different membership) starts another, the new trial does not unlock the app; they are asked to
 * subscribe. (Whop doesn't expose card fingerprints to us, so per-card blocking is Whop's job.)
 */
export function isRepeatTrial(prev: MemberState | null | undefined, next: { status: MemberStatus; membership_id?: string | null }): boolean {
  return next.status === 'trialing' && !!prev?.first_trial_at && !!next.membership_id && !!prev.membership_id && prev.membership_id !== next.membership_id;
}

export function statusLabel(m: MemberState | null | undefined, now = Date.now()): string {
  if (!m) return 'No membership';
  const d = (x?: string | null) => (x ? new Date(x).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' }) : null);
  switch (m.status) {
    case 'trialing': return `Free trial${d(m.trial_ends_at ?? m.expires_at) ? ` · ends ${d(m.trial_ends_at ?? m.expires_at)}` : ''}${m.cancel_at_period_end ? ' · won’t renew' : ''}`;
    case 'active': return `Active${d(m.expires_at) ? ` · ${m.cancel_at_period_end ? 'ends' : 'renews'} ${d(m.expires_at)}` : ''}`;
    case 'past_due': return 'Payment failed · update your card on Whop to keep access';
    case 'canceled': return hasAccess(m, now) ? `Canceled · access until ${d(m.expires_at)}` : 'Canceled';
    case 'expired': return 'Expired';
    case 'trial_used': return 'Free trial already used · subscribe to continue';
    default: return 'No membership';
  }
}
