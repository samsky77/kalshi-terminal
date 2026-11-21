/**
 * Whop membership states and the one access rule (item 1). Pure functions: no I/O, unit-tested.
 *
 * Whop membership `status` values (their API): trialing, active, past_due, unresolved, completed,
 * expired, canceled, drafted. We collapse them to the states the app knows about. Webhooks are
 * applied through `applyEvent`, a reducer that ignores out-of-order events and impossible
 * transitions, so a late or replayed event can never hand access back.
 */
export type MemberStatus = 'trialing' | 'active' | 'past_due' | 'canceled' | 'expired' | 'trial_used' | 'none';

export interface MemberState {
  status: MemberStatus | string;
  /** End of the current trial / paid period (renewal date). */
  expires_at?: string | null;
  cancel_at_period_end?: boolean | null;
  /** Set the first time this Whop account started a trial; a second trial is not honoured. */
  first_trial_at?: string | null;
  membership_id?: string | null;
  trial_ends_at?: string | null;
  /** Time of the newest webhook applied (provider event time); older events are ignored. */
  last_event_at?: string | null;
}

/** After the period end, how long renewal webhooks may lag before access stops (active / trialing). */
export const RENEWAL_GRACE_MS = 12 * 3600000;
/** past_due keeps access while Whop retries the card, at most this long after the period end. */
export const PAST_DUE_GRACE_MS = 3 * 86400000;

/** Map Whop's own membership status string. Unknown values (drafted, paused, …) mean no access. */
export function fromWhopStatus(s: unknown): MemberStatus | null {
  const v = String(s ?? '').toLowerCase();
  switch (v) {
    case '': return null;
    case 'trialing': return 'trialing';
    case 'active': return 'active';
    case 'past_due': case 'unresolved': return 'past_due';
    case 'canceled': case 'cancelled': return 'canceled';
    case 'expired': case 'completed': return 'expired';
    default: return 'none';
  }
}

/**
 * Status from a webhook: Whop's `data.status` wins when present; otherwise the event type decides.
 * null = the event doesn't set a status (e.g. a cancel-at-period-end toggle; see applyEvent).
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

/** Timestamps from Whop arrive as unix seconds, unix milliseconds, numeric strings or ISO strings. */
export function toIso(x: unknown): string | null {
  if (x === null || x === undefined || x === '') return null;
  const n = typeof x === 'number' ? x : typeof x === 'string' && /^\d+(\.\d+)?$/.test(x.trim()) ? Number(x) : NaN;
  if (Number.isFinite(n)) {
    const ms = n > 1e12 ? n : n * 1000;
    const d = new Date(ms);
    return Number.isFinite(d.getTime()) && d.getUTCFullYear() < 2200 ? d.toISOString() : null;
  }
  if (typeof x === 'string') { const t = Date.parse(x); return Number.isFinite(t) ? new Date(t).toISOString() : null; }
  return null;
}

/**
 * The access rule.
 * - trialing / active: yes, until the period end (+12 h for a late renewal webhook). No end date
 *   known = yes (Whop's own access check, every 10 minutes, is the backstop).
 * - past_due: yes while Whop retries the card, at most 3 days after the period end.
 * - canceled: only until the end of the period already paid for (or the trial end).
 * - expired / none / trial_used / anything else: no.
 */
export function hasAccess(m: MemberState | null | undefined, now = Date.now()): boolean {
  if (!m) return false;
  const end = m.expires_at ? Date.parse(m.expires_at) : NaN;
  const known = Number.isFinite(end);
  if (m.status === 'trialing' || m.status === 'active') return !known || end + RENEWAL_GRACE_MS > now;
  if (m.status === 'past_due') return !known || end + PAST_DUE_GRACE_MS > now;
  if (m.status === 'canceled') return known && end > now;
  return false;
}

export interface WebhookEvent {
  type: string;
  data: any;
  /** Event time (Whop's data.updated_at, else the signed webhook-timestamp). */
  at: string;
}

/**
 * Apply one verified webhook to the stored member row. Returns the new row, or null to ignore:
 *  - events older than the newest applied one (out of order / replayed late);
 *  - impossible transitions: payment.failed only moves a live trialing/active member to past_due,
 *    and nothing but a real payment (active) revives an expired / trial_used account;
 *  - one free trial per account: a trial on a different membership after the first one never grants
 *    access, and stays locked for every later trialing event on that membership. A second trial that
 *    arrives while the first is still live is ignored (the first trial keeps running).
 */
export function applyEvent(prev: MemberState | null, evt: WebhookEvent): MemberState | null {
  const at = toIso(evt.at) ?? new Date().toISOString();
  if (prev?.last_event_at && Date.parse(at) < Date.parse(prev.last_event_at)) return null;
  const d = evt.data ?? {};
  const membershipId: string | null = (d.id && String(d.id).startsWith('mem_') ? String(d.id) : null) ?? d.membership_id ?? d.membership?.id ?? null;
  const expires = toIso(d.renewal_period_end ?? d.expires_at ?? d.valid_until);
  const cancelFlag: boolean | undefined = typeof d.cancel_at_period_end === 'boolean' ? d.cancel_at_period_end : undefined;
  let status = statusFromWebhook(evt.type, d);
  const prevStatus = (prev?.status ?? 'none') as string;
  const nowMs = Date.parse(at);

  // A cancel-at-period-end toggle (or any event without a status) only updates the flags/dates.
  if (!status) {
    if (!prev || (cancelFlag === undefined && !expires)) return null;
    return { ...prev, cancel_at_period_end: cancelFlag ?? prev.cancel_at_period_end ?? false, expires_at: expires ?? prev.expires_at ?? null, last_event_at: at };
  }

  if (status === 'past_due' && !(prevStatus === 'active' || prevStatus === 'trialing' || prevStatus === 'past_due')) return null;

  const otherMembership = !!membershipId && !!prev?.membership_id && membershipId !== prev.membership_id;
  if (status === 'trialing' && prev?.first_trial_at) {
    const sameLockedMembership = prevStatus === 'trial_used' && (!membershipId || membershipId === prev.membership_id);
    const firstTrialLive = prevStatus === 'trialing' && hasAccess(prev, nowMs);
    if (firstTrialLive && otherMembership) return null; // keep the running trial; ignore the second one
    if (sameLockedMembership || otherMembership || (!membershipId && prevStatus !== 'trialing')) status = 'trial_used';
  }
  // Only a real payment brings back an account that has expired or used its trial.
  if ((status === 'trialing') && (prevStatus === 'expired' || prevStatus === 'trial_used') && !otherMembership && membershipId === (prev?.membership_id ?? membershipId)) {
    if (prevStatus === 'trial_used' || !prev?.first_trial_at) status = prevStatus === 'trial_used' ? 'trial_used' : status;
  }

  return {
    ...(prev ?? {}),
    status,
    expires_at: expires ?? (status === prevStatus ? prev?.expires_at ?? null : null),
    cancel_at_period_end: cancelFlag ?? (status === 'active' && prevStatus !== 'active' ? false : prev?.cancel_at_period_end ?? false),
    trial_ends_at: status === 'trialing' ? expires : prev?.trial_ends_at ?? null,
    first_trial_at: prev?.first_trial_at ?? (status === 'trialing' ? at : null),
    membership_id: status === 'trial_used' ? prev?.membership_id ?? membershipId : membershipId ?? prev?.membership_id ?? null,
    last_event_at: at,
  };
}

const ET = (x?: string | null) => (x ? new Date(x).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' }) : null);
export { ET as memberDate };

export function statusLabel(m: MemberState | null | undefined, now = Date.now()): string {
  if (!m) return 'No membership';
  switch (m.status) {
    case 'trialing': return `Free trial${ET(m.trial_ends_at ?? m.expires_at) ? ` · ends ${ET(m.trial_ends_at ?? m.expires_at)}` : ''}${m.cancel_at_period_end ? ' · won’t renew' : ''}`;
    case 'active': return `Active${ET(m.expires_at) ? ` · ${m.cancel_at_period_end ? 'ends' : 'renews'} ${ET(m.expires_at)}` : ''}`;
    case 'past_due': return 'Payment failed · update your card on Whop to keep access';
    case 'canceled': return hasAccess(m, now) ? `Canceled · access until ${ET(m.expires_at)}` : 'Canceled';
    case 'expired': return 'Expired';
    case 'trial_used': return 'Free trial already used · subscribe to continue';
    default: return 'No membership';
  }
}

/** Why a signed-in user has no access, for the landing-page banner. */
export function noAccessReason(m: MemberState | null | undefined): 'trial_used' | 'expired' | 'past_due' | 'inactive' {
  if (m?.status === 'trial_used') return 'trial_used';
  if (m?.status === 'expired' || m?.status === 'canceled') return 'expired';
  if (m?.status === 'past_due') return 'past_due';
  return 'inactive';
}

/** Kept for older call sites/tests. */
export function isRepeatTrial(prev: MemberState | null | undefined, next: { status: MemberStatus; membership_id?: string | null }): boolean {
  return applyEvent(prev ?? null, { type: 'membership.activated', data: { status: next.status, membership_id: next.membership_id }, at: new Date().toISOString() })?.status === 'trial_used';
}
